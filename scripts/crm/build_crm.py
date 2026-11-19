#!/usr/bin/env python3
"""Build a local SQLite CRM from the OCR receipt CSVs (stdlib only).

Reads  $KAIROS_OCR_DIR (default ~/kairos-ocr): kairos_transactions.csv, kairos_items.csv
Writes $KAIROS_CRM_DIR (default ~/.kairos-crm): crm.db  (rebuilt from scratch every run)

Personal data (names, phones) never goes in the repo and is never printed: only counts.
  --push   send Orders and OrderItems to <KAIROS_API>/api/orders (needs ~/.kairos-ledger-code)
  --dry    with --push: show counts and sizes only, send nothing
"""
import argparse, csv, json, os, re, sqlite3, sys, urllib.request, urllib.error

OCR = os.path.expanduser(os.environ.get('KAIROS_OCR_DIR', '~/kairos-ocr'))
OUT = os.path.expanduser(os.environ.get('KAIROS_CRM_DIR', '~/.kairos-crm'))
API = os.environ.get('KAIROS_API', 'https://data-entry-app-roan.vercel.app').rstrip('/')
STORES = {'LM': 'La Mirada', 'STN': 'Stanton'}
MAX_BODY = int(3.5 * 1024 * 1024)

ORDER_HEADER = ['Id', 'Date', 'Time', 'Store', 'Cashier', 'Customer', 'Phone', 'Payment', 'Total', 'Fee',
                'Basket', 'Madeleines', 'Flavors', 'Categories', 'Source']
ITEM_HEADER = ['Order', 'Item', 'Modifiers', 'Qty', 'Price', 'Category', 'Product']


def norm_date(s):
    """M/D/YY or M/D/YYYY -> yyyy-mm-dd; '' when missing or not a real date."""
    m = re.fullmatch(r'\s*(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})\s*', s or '')
    if not m:
        return ''
    mo, d, y = int(m.group(1)), int(m.group(2)), m.group(3)
    y = int(y) + 2000 if len(y) == 2 else int(y)
    if not (1 <= mo <= 12 and 1 <= d <= 31 and 2000 <= y <= 2100):
        return ''
    return '%04d-%02d-%02d' % (y, mo, d)


def norm_time(s):
    """10:32AM -> 10:32, 1:05 PM -> 13:05; '' when missing."""
    m = re.fullmatch(r'\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s*', s or '')
    if not m:
        return ''
    h, mi, ap = int(m.group(1)), int(m.group(2)), (m.group(3) or '').upper()
    if mi > 59:
        return ''
    if ap:
        if not 1 <= h <= 12:
            return ''
        h = h % 12 + (12 if ap == 'PM' else 0)
    elif h > 23:
        return ''
    return '%02d:%02d' % (h, mi)


def num(s, default=None):
    try:
        return float(str(s).replace('$', '').replace(',', '').strip())
    except ValueError:
        return default


def intn(s):
    n = num(s)
    return int(round(n)) if n is not None else None


def store_code(loc):
    return (loc or '').strip().upper()


def order_id(loc, rid):
    return '%s-%s' % (store_code(loc), (rid or '').strip())


def read_csv(name):
    with open(os.path.join(OCR, name), newline='', encoding='utf-8') as f:
        return list(csv.DictReader(f))


SCHEMA = """
CREATE TABLE orders(id TEXT PRIMARY KEY, date TEXT, time TEXT, store TEXT, cashier TEXT, customer TEXT, phone TEXT,
  payment TEXT, total REAL, fee REAL, basket INTEGER, madeleines INTEGER, flavors TEXT, categories TEXT, source TEXT);
CREATE TABLE items(order_id TEXT, item TEXT, modifiers TEXT, qty INTEGER, price REAL, category TEXT, product TEXT);
CREATE INDEX orders_date ON orders(date);
CREATE INDEX orders_phone ON orders(phone);
CREATE INDEX orders_customer ON orders(lower(trim(customer)));
CREATE INDEX items_order ON items(order_id);
CREATE INDEX items_item ON items(item);
CREATE VIEW customers AS
  SELECT key, MAX(name) AS name, MAX(phone) AS phone, COUNT(*) AS visits, ROUND(SUM(COALESCE(total,0)),2) AS spent,
         MIN(NULLIF(date,'')) AS first_visit, MAX(NULLIF(date,'')) AS last_visit, GROUP_CONCAT(DISTINCT store) AS stores
  FROM (SELECT CASE WHEN phone_digits<>'' THEN phone_digits ELSE lower(trim(customer)) END AS key,
               customer AS name, phone, total, date, store
        FROM (SELECT *, REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,'(',''),')',''),'-',''),' ',''),'+','') AS phone_digits FROM orders))
  WHERE key<>'' GROUP BY key;
CREATE VIEW daily AS
  SELECT o.date AS date, o.store AS store, COUNT(DISTINCT o.id) AS orders, ROUND(SUM(COALESCE(o.total,0)),2) AS revenue,
         (SELECT COALESCE(SUM(i.qty),0) FROM items i JOIN orders o2 ON o2.id=i.order_id WHERE o2.date=o.date AND o2.store=o.store) AS items
  FROM orders o WHERE o.date<>'' GROUP BY o.date, o.store;
"""


def build():
    tx, it = read_csv('kairos_transactions.csv'), read_csv('kairos_items.csv')
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(OUT, 'crm.db.tmp')
    if os.path.exists(tmp):
        os.remove(tmp)
    db = sqlite3.connect(tmp)
    db.executescript(SCHEMA)
    seen = set()
    for r in tx:
        oid = order_id(r['location'], r['receipt_id'])
        if oid in seen or oid.endswith('-'):
            continue
        seen.add(oid)
        db.execute('INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (
            oid, norm_date(r['date']), norm_time(r['time']), STORES.get(store_code(r['location']), r['location']),
            r['cashier'].strip(), r['customer_name'].strip(), r['customer_phone'].strip(), r['payment_method'].strip(),
            num(r['total']), num(r['fee']), intn(r['basket_size']), intn(r['n_madeleines']),
            r['flavors'].strip(), r['categories'].strip(), r['source_video'].strip()))
    # Item rows are kept exactly as they are. The one repeated row text in the data has no price and could be
    # two real lines, so nothing is dropped or summed.
    for r in it:
        oid = order_id(r['location'], r['receipt_id'])
        if oid not in seen:
            continue
        db.execute('INSERT INTO items VALUES (?,?,?,?,?,?,?)', (
            oid, r['item_name'].strip(), r['item_modifiers'].strip(), intn(r['item_qty']), num(r['item_price']),
            r['item_category'].strip(), (r['kb_product'] or r['madeleine_flavor']).strip()))
    db.commit()
    db.close()
    final = os.path.join(OUT, 'crm.db')
    os.replace(tmp, final)
    return final


def counts(path):
    db = sqlite3.connect(path)
    q = lambda s: db.execute(s).fetchone()[0]
    out = {'orders': q('select count(*) from orders'), 'items': q('select count(*) from items'),
           'days': q("select count(distinct date) from orders where date<>''"),
           'customers': q('select count(*) from customers')}
    db.close()
    return out


def payloads(path):
    db = sqlite3.connect(path)
    orders = [['' if v is None else v for v in r] for r in db.execute(
        'select id,date,time,store,cashier,customer,phone,payment,total,fee,basket,madeleines,flavors,categories,source '
        'from orders order by date,time,id')]
    items = [['' if v is None else v for v in r] for r in db.execute(
        'select order_id,item,modifiers,qty,price,category,product from items order by rowid')]
    db.close()
    return [{'action': 'replace', 'tab': 'Orders', 'rows': orders},
            {'action': 'replace', 'tab': 'OrderItems', 'rows': items}]


def push(path, dry):
    bodies = payloads(path)
    sizes = []
    for b in bodies:
        raw = json.dumps(b, separators=(',', ':')).encode()
        sizes.append(len(raw))
        print('%s: %d rows, %d bytes' % (b['tab'], len(b['rows']), len(raw)))
        if len(raw) > MAX_BODY:
            sys.exit('Aborted: %s body is over 3.5 MB' % b['tab'])
    if dry:
        print('dry run: nothing sent')
        return
    with open(os.path.expanduser('~/.kairos-ledger-code')) as f:
        code = f.read().strip()
    for b in bodies:
        req = urllib.request.Request(API + '/api/orders', data=json.dumps(b, separators=(',', ':')).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'x-ledger-code': code})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                print('%s: HTTP %d' % (b['tab'], r.status))
        except urllib.error.HTTPError as e:
            sys.exit('%s: HTTP %d (stopped)' % (b['tab'], e.code))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--push', action='store_true')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    path = build()
    c = counts(path)
    print('orders %(orders)d, items %(items)d, days %(days)d, customers %(customers)d' % c)
    if a.push or a.dry:
        push(path, a.dry or not a.push)


if __name__ == '__main__':
    main()
