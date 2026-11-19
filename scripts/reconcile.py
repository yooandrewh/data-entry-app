#!/usr/bin/python3
"""Bracket reconcile: inventory(start) + deliveries/transfers/goodwill in (start, end] - inventory(end)
= implied units sold, compared with the Sales tab for the days the window covers.

Read-only: only GETs /api/entries and /api/sales. Never writes to the sheet, never adjusts counts.

  reconcile.py            latest window per location in full, older windows condensed (flagged rows only)
  reconcile.py --all      every window, every non-empty product row
  reconcile.py --since 2026-10-01 --loc Stanton

Rules (Andrew, 2026-11-09): variance over 5% of units sold = RE-OCR that window; exit code 2 if any.
Counts are never adjusted. Blank/None count = no count for that product (skipped for the window).
A count row that is all zero, or nearly (<=1 product non-zero when a neighbouring count has >=4), is
treated as a bad count: it is dropped from the chain, windows touching it are reported as SKIP, and the
windows on either side are bridged (previous good count -> next good count).
Date-only entries have no time: on the first/last day of a window their position is ambiguous, so the
expected range widens instead of failing (marked ~).
"""
import json, sys, urllib.request, datetime as D
try:
    from zoneinfo import ZoneInfo
    LA = ZoneInfo("America/Los_Angeles")
except Exception:
    LA = None

U = "https://data-entry-app-roan.vercel.app/api/"
P = ['Lemon Poppy', 'Sea Salt', 'Maple Pecan', 'Pumpkin Muffin', 'Blueberry Muffin', 'Pumpkin Bundt', 'Cake Pop', 'Chookie']
LOCS = ['La Mirada', 'Stanton']
THRESH = 5.0


def get(path):
    req = urllib.request.Request(U + path, headers={"User-Agent": "x"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def parse(s):
    """-> (date 'YYYY-MM-DD', naive local datetime or None for date-only)"""
    if len(s) <= 10:
        return s[:10], None
    try:
        d = D.datetime.fromisoformat(s.replace('Z', '+00:00'))
        if d.tzinfo is not None:
            d = d.astimezone(LA) if LA else d
            d = d.replace(tzinfo=None)
        return d.strftime('%Y-%m-%d'), d
    except Exception:
        return s[:10], None


class Row:
    def __init__(self, x):
        self.x = x
        self.type = x['type']
        self.loc = x['location']
        self.raw = x['datetime']
        self.date, self.t = parse(x['datetime'])
        self.am = x.get('amounts') or {}

    def key(self):
        return (self.date, self.t or D.datetime.min)

    def label(self):
        return self.t.strftime('%Y-%m-%d %H:%M') if self.t else self.date + ' (date only)'


def count(row, p):
    """Count for a product, or None when blank/missing."""
    v = row.am.get(p)
    return None if v is None or v == '' else v


def bad_count(row, neighbours):
    vals = [count(row, p) for p in P]
    nz = sum(1 for v in vals if v)
    if nz == 0:
        return 'all-zero'
    if nz <= 1:
        for n in neighbours:
            if n is not None and sum(1 for p in P if count(n, p)) >= 4:
                return 'near-all-zero (%d of %d products non-zero)' % (nz, len(P))
    return None


def position(m, a, b):
    """Is movement m inside (a, b]?  -> 'in' | 'out' | 'amb'"""
    if m.date < a.date or m.date > b.date:
        return 'out'
    if a.date < m.date < b.date:
        return 'in'
    # m is on the first and/or last day of the window
    on_a, on_b = m.date == a.date, m.date == b.date
    need = [m.t] + ([a.t] if on_a else []) + ([b.t] if on_b else [])
    if any(t is None for t in need):
        return 'amb'
    if on_a and not m.t > a.t:
        return 'out'
    if on_b and not m.t <= b.t:
        return 'out'
    return 'in'


def window(loc, a, b, moves, S, tag=''):
    """Evaluate one window. Returns dict with rows, notes and flags."""
    da, db = a.date, b.date
    ins, ambs = [], []
    for m in moves:
        r = position(m, a, b)
        if r == 'in':
            ins.append(m)
        elif r == 'amb':
            ambs.append(m)
    sales = [s for s in S if s['location'] == loc]
    edge = {da, db}
    out = []
    for p in P:
        sa, sb = count(a, p), count(b, p)
        full = sum(s['amounts'].get(p, 0) or 0 for s in sales if da < s['date'] < db)
        ends = sum(s['amounts'].get(p, 0) or 0 for s in sales if s['date'] in edge)
        mv = sum(m.am.get(p, 0) or 0 for m in ins)
        am = sum(m.am.get(p, 0) or 0 for m in ambs)
        r = dict(p=p, start=sa, mv=mv, amb=am, end=sb, full=full, ends=ends, skip=None)
        if sa is None or sb is None:
            r['skip'] = 'no %s count' % ('start' if sa is None else 'end')
        else:
            i0 = sa + mv - sb                                  # implied sold, ambiguous rows excluded
            i_lo, i_hi = sorted((i0, i0 + am))                 # ambiguous rows may or may not be in
            lo, hi = full, full + ends                         # sales on edge days may or may not belong
            if i_hi < lo:
                miss = lo - i_hi
            elif i_lo > hi:
                miss = i_lo - hi
            else:
                miss = 0
            sign = 1 if i_lo > hi else -1
            r.update(implied=i0, i_lo=i_lo, i_hi=i_hi, miss=sign * miss,
                     pct=100.0 * miss / max(hi, 1))
            r['flag'] = r['pct'] > THRESH
        out.append(r)
    # suspected duplicate deliveries: same location+date, identical non-zero amounts, both live
    dups = []
    seen = {}
    for m in ins + ambs:
        if m.type != 'delivery':
            continue
        sig = tuple(m.am.get(p, 0) or 0 for p in P)
        if not any(sig):
            continue
        k = (m.date, sig)
        if k in seen:
            dups.append(m.date)
        seen[k] = 1
    return dict(loc=loc, a=a, b=b, rows=out, n_in=len(ins), n_amb=len(ambs), dups=sorted(set(dups)),
                days=(da, db), tag=tag)


def fmt_row(r):
    if r['skip']:
        return "  %-17s %s -- skipped: %s" % (r['p'], ' ' * 33, r['skip'])
    imp = str(r['implied'])
    if r['i_lo'] != r['i_hi']:
        imp = "%d..%d~" % (r['i_lo'], r['i_hi'])
    sales = str(r['full']) if not r['ends'] else "%d(+%d)" % (r['full'], r['ends'])
    mark = "RE-OCR" if r['flag'] else "OK"
    return "  %-17s %5s %+5d %5s %9s %9s %+5d %5.0f%%  %s" % (
        r['p'], r['start'], r['mv'], r['end'], imp, sales, r['miss'], r['pct'], mark)


HDR = "  %-17s %5s %5s %5s %9s %9s %5s %6s  %s" % ('product', 'start', 'in', 'end', 'implied', 'sales', 'diff', '%', '')


def trivial(r):
    return not r['skip'] and not any((r['start'], r['mv'], r['end'], r['full'], r['ends'], r['amb']))


def header(w):
    a, b = w['a'], w['b']
    s = "%s: %s -> %s" % (w['loc'], a.label(), b.label())
    if w['tag']:
        s += "  [%s]" % w['tag']
    return s


def main(argv):
    show_all = '--all' in argv
    since = argv[argv.index('--since') + 1] if '--since' in argv else None
    only = argv[argv.index('--loc') + 1] if '--loc' in argv else None
    e = get("entries")
    e = e.get('entries') or e.get('rows')
    S = get("sales")["sales"]
    rows = [Row(x) for x in e if not x.get('taggedForDeletion')]

    wins, notes = [], []
    for loc in LOCS:
        if only and loc != only:
            continue
        inv = sorted([r for r in rows if r.type == 'inventory' and r.loc == loc], key=Row.key)
        moves = [r for r in rows if r.type != 'inventory' and r.loc == loc]
        good, skipped = [], []
        for i, r in enumerate(inv):
            nb = [inv[i - 1] if i else None, inv[i + 1] if i + 1 < len(inv) else None]
            why = bad_count(r, nb)
            (skipped if why else good).append((r, why) if why else r)
        # rows dropped from the chain: report them as SKIP windows (start and end side) and bridge over them
        for r, why in skipped:
            notes.append("%s: count %s is %s, treat as no start/end count (windows touching it skipped, neighbours bridged)"
                         % (loc, r.label(), why))
            idx = inv.index(r)
            if idx + 1 < len(inv):
                n = inv[idx + 1]
                wins.append(dict(loc=loc, a=r, b=n, rows=[], n_in=0, n_amb=0, dups=[], days=(r.date, n.date),
                                 tag='SKIP: %s start, treat as no start count' % why, skipwhy=why))
            if idx:
                p = inv[idx - 1]
                wins.append(dict(loc=loc, a=p, b=r, rows=[], n_in=0, n_amb=0, dups=[], days=(p.date, r.date),
                                 tag='SKIP: %s end, treat as no end count' % why, skipwhy=why))
        for a, b in zip(good, good[1:]):
            bridged = any(a.key() < r.key() < b.key() for r, _ in skipped)
            wins.append(window(loc, a, b, moves, S, 'bridged over bad count' if bridged else ''))

    wins = [w for w in wins if not since or w['b'].date >= since]
    # newest first per location; the latest window of each location is printed in full
    by_loc = {}
    for w in wins:
        by_loc.setdefault(w['loc'], []).append(w)
    ordered = []
    for loc in LOCS:
        ws = sorted(by_loc.get(loc, []), key=lambda w: (w['b'].key(), w['a'].key()), reverse=True)
        first = next((i for i, w in enumerate(ws) if 'skipwhy' not in w), -1)
        ordered += [(w, i == first) for i, w in enumerate(ws)]

    flagged = skipped_n = dup_n = amb_n = checked = 0
    older_hdr = False
    for n in notes:
        print("NOTE " + n)
    for w, latest in ordered:
        if 'skipwhy' in w:
            skipped_n += 1
            print("\n" + header(w))
            continue
        checked += 1
        bad = [r for r in w['rows'] if not r['skip'] and r['flag']]
        flagged += bool(bad)
        dup_n += bool(w['dups'])
        amb_n += bool(w['n_amb'])
        full_view = show_all or latest
        status = "RE-OCR (%d)" % len(bad) if bad else "OK"
        extra = []
        if w['n_amb']:
            extra.append("%d date-only row(s) on edge days, ranges marked ~" % w['n_amb'])
        if w['dups']:
            extra.append("DUPLICATE? identical delivery rows on %s" % ", ".join(w['dups']))
        skips = [r['p'] for r in w['rows'] if r['skip'] and not trivial_skip(r)]
        if skips:
            extra.append("no count for: " + ", ".join(skips))
        if full_view:
            print("\n" + header(w) + "  => " + status)
            for x in extra:
                print("  ! " + x)
            print(HDR)
            for r in w['rows']:
                if not trivial(r) and not (r['skip'] and trivial_skip(r)):
                    print(fmt_row(r))
        elif bad or w['dups']:
            if not older_hdr:
                print("\nOlder windows (flagged only; diff = implied sold minus sales, + means sales under-counted):")
                older_hdr = True
            line = "%s: %s -> %s  => %s: " % (w['loc'], w['a'].label().replace(' (date only)', ' d'), w['b'].label().replace(' (date only)', ' d'), status)
            line += "; ".join("%s %+d (%.0f%%)" % (r['p'], r['miss'], r['pct']) for r in bad) if bad else "counts OK"
            if w['dups']:
                line += "  ! DUPLICATE? identical delivery rows on %s" % ", ".join(w['dups'])
            if w['n_amb']:
                line += "  ! %d date-only edge row(s)" % w['n_amb']
            print(line)
    print("\nSummary: %d windows checked, %d flagged RE-OCR, %d skipped (bad count), %d with DUPLICATE? warning, %d with ambiguous date-only edge rows."
          % (checked, flagged, skipped_n, dup_n, amb_n))
    if not show_all:
        print("(older windows show only flagged rows; --all prints every row)")
    if flagged:
        print("\n*** NEEDS YOUR ATTENTION: variance over %d%% -> re-OCR the sales videos for the RE-OCR windows ***" % THRESH)
        return 2
    print("\nAll within %d%% variance." % THRESH)
    return 0


def trivial_skip(r):
    # a product with a blank count and nothing else happening is not worth a line
    return not any((r['start'], r['end'], r['mv'], r['full'], r['ends'], r['amb']))


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
