#!/usr/bin/env python3
"""Tests for build_crm.py using SYNTHETIC data only. Run: python3 scripts/crm/test_crm.py"""
import csv, importlib.util, io, json, os, sqlite3, subprocess, sys, tempfile, unittest
from contextlib import redirect_stdout

HERE = os.path.dirname(os.path.abspath(__file__))
TX = 'receipt_id,date,time,location,cashier,customer_name,customer_phone,payment_method,total,fee,basket_size,n_madeleines,flavors,categories,source_video'.split(',')
IT = ('receipt_id,date,time,location,cashier,customer_name,customer_phone,payment_method,tx_total,item_name,item_modifiers,'
      'item_qty,item_price,item_category,is_madeleine,madeleine_flavor,basket_size,source_video,kb_product').split(',')


def tx(rid, loc, date, time, name='', phone='', total='10.00', fee=''):
    return dict(zip(TX, [rid, date, time, loc, 'Cashier A', name, phone, 'Cash', total, fee, '2', '1', 'Lemon:1', 'Baked goods', 'v1']))


def item(rid, loc, name, qty='1', price='2.50', kb='', flavor=''):
    d = dict.fromkeys(IT, '')
    d.update(receipt_id=rid, location=loc, item_name=name, item_qty=qty, item_price=price, item_category='Baked goods',
             madeleine_flavor=flavor, kb_product=kb, source_video='v1')
    return d


def write(path, header, rows):
    with open(path, 'w', newline='') as f:
        w = csv.DictWriter(f, header); w.writeheader(); w.writerows(rows)


def load():
    spec = importlib.util.spec_from_file_location('build_crm', os.path.join(HERE, 'build_crm.py'))
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


class Fixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.ocr, cls.out = os.path.join(cls.tmp.name, 'ocr'), os.path.join(cls.tmp.name, 'crm')
        os.makedirs(cls.ocr)
        os.environ['KAIROS_OCR_DIR'], os.environ['KAIROS_CRM_DIR'] = cls.ocr, cls.out
        write(os.path.join(cls.ocr, 'kairos_transactions.csv'), TX, [
            tx('A1', 'LM', '11/4/26', '10:32AM', 'Pat Fake', '(555) 010-0001', '10.00'),
            tx('A1', 'STN', '11/14/2026', '1:05PM', 'Pat Fake', '555-010-0001', '20.00'),   # same id, other store, same phone
            tx('B2', 'LM', '', '', 'Sam Fake', '', '5.00'),                                   # no date / time
            tx('C3', 'LM', '12/5/26', '12:00AM', 'sam fake ', '', '7.00'),                    # same name, no phone
            tx('D4', 'STN', '12/6/26', '11:59PM', '', '', '3.00'),                             # nobody
        ])
        write(os.path.join(cls.ocr, 'kairos_items.csv'), IT, [
            item('A1', 'LM', 'Madeleine', kb='Lemon Poppy'), item('A1', 'STN', 'Madeleine', qty='2', flavor='Sea Salt'),
            item('B2', 'LM', 'Tea'), item('C3', 'LM', 'Tea'), item('C3', 'LM', 'Tea'), item('D4', 'STN', 'Cookie'),
            item('ZZ', 'LM', 'Orphan'),
        ])
        cls.m = load()
        cls.db_path = cls.m.build()
        cls.db = sqlite3.connect(cls.db_path)

    @classmethod
    def tearDownClass(cls):
        cls.db.close(); cls.tmp.cleanup()

    def q(self, sql): return self.db.execute(sql).fetchall()

    def test_date_and_time(self):
        n = self.m
        self.assertEqual(n.norm_date('11/4/26'), '2026-11-04')
        self.assertEqual(n.norm_date('11/14/2026'), '2026-11-14')
        self.assertEqual(n.norm_date(''), ''); self.assertEqual(n.norm_date('13/40/26'), '')
        self.assertEqual(n.norm_time('10:32AM'), '10:32'); self.assertEqual(n.norm_time('1:05PM'), '13:05')
        self.assertEqual(n.norm_time('12:00AM'), '00:00'); self.assertEqual(n.norm_time('12:30PM'), '12:30')
        self.assertEqual(n.norm_time('11:59PM'), '23:59'); self.assertEqual(n.norm_time(''), '')
        self.assertEqual(self.q("select date,time from orders where id='LM-B2'"), [('', '')])
        self.assertEqual(self.q("select date,time,store from orders where id='STN-A1'"), [('2026-11-14', '13:05', 'Stanton')])

    def test_ids_keyed_by_store(self):
        self.assertEqual(self.q("select id from orders where id like '%A1' order by id"), [('LM-A1',), ('STN-A1',)])
        self.assertEqual(self.q("select count(*) from orders"), [(5,)])
        self.assertEqual(self.q("select item,qty from items where order_id='STN-A1'"), [('Madeleine', 2)])
        self.assertEqual(self.q("select product from items where order_id='LM-A1'"), [('Lemon Poppy',)])
        self.assertEqual(self.q("select product from items where order_id='STN-A1'"), [('Sea Salt',)])
        self.assertEqual(self.q("select count(*) from items where item='Orphan'"), [(0,)])      # no matching receipt

    def test_items_kept_as_is(self):
        self.assertEqual(self.q("select count(*) from items where order_id='LM-C3'"), [(2,)])   # repeated row text is not dropped

    def test_customers_view(self):
        rows = {r[0]: r for r in self.q('select key,name,phone,visits,spent,first_visit,last_visit,stores from customers')}
        self.assertEqual(len(rows), 2)                                    # phone group + name group; nobody is skipped
        ph = rows['5550100001']; self.assertEqual(ph[3], 2); self.assertEqual(ph[4], 30.0)
        self.assertEqual((ph[5], ph[6]), ('2026-11-04', '2026-11-14')); self.assertEqual(set(ph[7].split(',')), {'La Mirada', 'Stanton'})
        nm = rows['sam fake']; self.assertEqual(nm[3], 2); self.assertEqual(nm[4], 12.0); self.assertEqual(nm[5], '2026-12-05')

    def test_daily_view(self):
        self.assertEqual(self.q("select date,store,orders,revenue,items from daily order by date,store"),
                         [('2026-11-04', 'La Mirada', 1, 10.0, 1), ('2026-11-14', 'Stanton', 1, 20.0, 2),
                          ('2026-12-05', 'La Mirada', 1, 7.0, 2), ('2026-12-06', 'Stanton', 1, 3.0, 1)])

    def test_indexes(self):
        names = {r[0] for r in self.q("select name from sqlite_master where type='index'")}
        self.assertTrue({'orders_date', 'orders_phone', 'orders_customer', 'items_item'} <= names)

    def test_dry_payload_shape(self):
        bodies = self.m.payloads(self.db_path)
        self.assertEqual([b['tab'] for b in bodies], ['Orders', 'OrderItems'])
        for b in bodies:
            self.assertEqual(b['action'], 'replace')
        self.assertTrue(all(len(r) == len(self.m.ORDER_HEADER) for r in bodies[0]['rows']))
        self.assertTrue(all(len(r) == len(self.m.ITEM_HEADER) for r in bodies[1]['rows']))
        self.assertEqual(len(bodies[0]['rows']), 5); self.assertEqual(len(bodies[1]['rows']), 6)
        for b in bodies:
            for r in b['rows']:
                for v in r:
                    self.assertIsInstance(v, (str, int, float)); self.assertIsNotNone(v)
        a1 = [r for r in bodies[0]['rows'] if r[0] == 'LM-A1'][0]
        self.assertEqual(a1[:4], ['LM-A1', '2026-11-04', '10:32', 'La Mirada'])
        self.assertEqual(a1[8], 10.0)
        json.dumps(bodies)

    def test_cli_dry_prints_counts_only(self):
        env = dict(os.environ, HOME=self.tmp.name)   # a missing ~/.kairos-ledger-code proves --dry never reads it
        p = subprocess.run([sys.executable, os.path.join(HERE, 'build_crm.py'), '--push', '--dry'], env=env, capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('Orders: 5 rows', p.stdout); self.assertIn('OrderItems: 6 rows', p.stdout); self.assertIn('nothing sent', p.stdout)
        self.assertNotIn('Fake', p.stdout); self.assertNotIn('555', p.stdout)

    def test_rebuild_replaces_db(self):
        self.m.build()
        self.assertFalse(os.path.exists(self.db_path + '.tmp'))
        self.assertEqual(sqlite3.connect(self.db_path).execute('select count(*) from orders').fetchone()[0], 5)


class OrdersJs(unittest.TestCase):
    def test_node(self):
        repo = os.path.dirname(os.path.dirname(HERE))
        self.assertEqual(subprocess.run(['node', '--check', os.path.join(repo, 'api', 'orders.js')]).returncode, 0)
        p = subprocess.run(['node', os.path.join(HERE, 'test_orders.mjs')], capture_output=True, text=True)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)


if __name__ == '__main__':
    unittest.main(verbosity=1)
