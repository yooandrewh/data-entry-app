import json,urllib.request,datetime as D
U="https://data-entry-app-roan.vercel.app/api/"
g=lambda p:json.load(urllib.request.urlopen(urllib.request.Request(U+p,headers={"User-Agent":"x"})))
e=g("entries");e=e.get('entries') or e.get('rows')
S=g("sales")["sales"]
P=['Lemon Poppy','Sea Salt','Maple Pecan','Pumpkin Muffin','Blueberry Muffin']
e=[x for x in e if not x.get('taggedForDeletion')]
BAD=[]   # variance > 5% of units sold = re-OCR that window (Andrew, 2026-11-09)
for loc in ['La Mirada','Stanton']:
    inv=sorted([x for x in e if x['type']=='inventory' and x['location']==loc],key=lambda x:x['datetime'])
    a,b=inv[-2],inv[-1]
    print(f"\n{loc}: {a['datetime'][:16]} -> {b['datetime'][:16]}")
    ta,tb=a['datetime'],b['datetime']
    mv=[x for x in e if x['type']!='inventory' and x['location']==loc and ta<x['datetime']<=tb]
    # sales: days after prev inv date through new inv date (partial on both ends)
    da,db=ta[:10],tb[:10]
    for p in P:
        dl=sum(x['amounts'].get(p,0) for x in mv)
        full=sum(s['amounts'][p] for s in S if s['location']==loc and da<s['date']<db)
        ends=sum(s['amounts'][p] for s in S if s['location']==loc and s['date'] in (da,db))
        exp_hi=a['amounts'].get(p,0)+dl-full   # if none of the end days counted
        exp_lo=exp_hi-ends
        print(f"  {p:17} start {a['amounts'].get(p,0):3} +move {dl:3} -sales {full}(+ends {ends}) => expect {exp_lo}..{exp_hi}  counted {b['amounts'].get(p,0)}",end="")
        c=b['amounts'].get(p,0); miss=max(exp_lo-c,c-exp_hi,0); sold=max(full+ends,1)
        pct=100*miss/sold
        if pct>5: BAD.append((loc,p,miss,pct)); print(f"  <-- OFF {miss} ({pct:.0f}% of {sold} sold) RE-OCR")
        else: print()
if BAD:
    print("\n*** NEEDS YOUR ATTENTION: variance over 5% -> re-OCR the sales videos for these windows ***")
    for loc,p,m,pc in BAD: print(f"  {loc} {p}: off by {m} ({pc:.0f}%)")
    raise SystemExit(2)
print("\nAll within 5% variance.")
