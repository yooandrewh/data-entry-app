#!/usr/bin/env python3
"""Write the Food Corridor 2026 rate card to the sheet's "Kitchen Rates" tab (replaces the tab's contents).
Source: Kitchen_Rental_Rates_2026.docx. Key path via KAIROS_SA_KEY. Dry run unless --write."""
import os, sys, json, time, base64, urllib.request, urllib.parse
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

KEY = os.environ.get("KAIROS_SA_KEY", os.path.expanduser("~/Downloads/premium-griffin-500920-s0-9b62a092a732.json"))
SHEET_ID = os.environ.get("SHEET_ID", "1kmJHEIKkJ3HTvqmIlx2BwSEYZPNbHt28le3LrPQOuIA")
TAB = "Kitchen Rates"
H = ["Category", "Item", "Detail", "Peak $/hr", "Off-peak $/hr", "Monthly $", "Weekly $", "Note"]
R = [
 ["Kitchen use", "2-3 prep tables", "4 people max; 1 convection oven + 1 mixer", 35, 28.5, "", "", "Min 4 hr/session; min $120 kitchen use/month; extra oven +$10/hr"],
 ["Kitchen use", "5-6 prep tables", "8 people max; 2 convection ovens + 2 mixers", 56, 46, "", "", "Min 4 hr/session; min $120 kitchen use/month"],
 ["Kitchen use", "Entire kitchen south", "15 people max; 4 convection ovens + 2 mixers", 70, 57, "", "", "Min 4 hr/session; extra mixer +$10/hr"],
 ["Prep only", "Small group, 2-3 tables", "4 people max, no cooking", 22, "", "", "", ""],
 ["Prep only", "Large group, 5-6 tables", "8 people max, no cooking", 36, "", "", "", ""],
 ["Add-on", "Extra oven", "", 10, 10, "", "", "per hour"],
 ["Add-on", "Extra mixer", "", 10, 10, "", "", "per hour"],
 ["Hours", "Peak = 6am-6pm; off-peak = 6pm-6am", "", "", "", "", "", "Entire-kitchen sheet prints peak as '6 am to 6 am' (likely a typo for 6pm)"],
]
for h, d in [(20, 0), (40, 10), (50, 12), (60, 15), (80, 20), (100, 25), (160, 30)]:
    R.append(["Monthly discount", f"{h} hr/month", f"{d}% off", "", "", "", "", "Monthly users: no 4 hr/session minimum; hours can be split between prep and cook"])
def st(cat, item, detail, m, w): R.append([cat, item, detail, "", "", m, w, ""])
for it, m, w in [("Shelf ~9 cu ft", 64, 28.75), ("Shelf ~12 cu ft", 85.5, 37), ("Shelf ~15 cu ft", 107, 46), ("Speed rack ~21 cu ft", 150, 64),
                 ("Shelving 4x(2x5) ~55 cu ft", 385, 165), ("Shelving 5x(2x3) ~42 cu ft", 294, 126.5), ("Shelving 4x(2x3) ~33 cu ft", 231, 100),
                 ("Shelving 5x(1.5x3) ~30 cu ft", 210, 90), ("Shelving 4x(2x2) ~24 cu ft", 168, 72), ("Metro rack ~45 cu ft", "", 135)]:
    st("Storage: cooler/freezer", it, "", m, w)
for it, m in [("Gated area ~102 cu ft", 350), ("Gated area ~112 cu ft", 385), ("Pallet 64 cu ft", 235), ("Pallet 56 cu ft", 206),
              ("Shelving 5x(2x2) ~30 cu ft", 112), ("Shelving 4x(2x2) ~36 cu ft", 134), ("Shelving 5x(2x3) ~42 cu ft", 156),
              ("Shelf 8-9 cu ft", 34), ("Shelf 12 cu ft", 51), ("Shelf 15 cu ft", 64), ("Shelf 20 cu ft", 85)]:
    st("Storage: dry", it, "", m, "")
for it, m, w in [("Shelving 5x(2x2) ~30 cu ft", 173, 73.5), ("Speed rack ~21 cu ft", 120.75, 52.5), ("Metro rack ~60 cu ft", "", 152)]:
    st("Storage: inside kitchen", it, "", m, w)

def token():
    c = json.load(open(KEY)); bu = lambda b: base64.urlsafe_b64encode(b).rstrip(b"="); n = int(time.time())
    si = bu(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()) + b"." + bu(json.dumps({"iss": c["client_email"], "scope": "https://www.googleapis.com/auth/spreadsheets", "aud": "https://oauth2.googleapis.com/token", "iat": n, "exp": n + 3600}).encode())
    pk = serialization.load_pem_private_key(c["private_key"].encode(), password=None)
    a = (si + b"." + bu(pk.sign(si, padding.PKCS1v15(), hashes.SHA256()))).decode()
    return json.load(urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": a}).encode())))["access_token"]
def api(tok, path, method="GET", body=None):
    req = urllib.request.Request(f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET_ID}{path}", data=json.dumps(body).encode() if body is not None else None, headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"}, method=method)
    return json.load(urllib.request.urlopen(req))

print(f"{len(R)} rows")
if "--write" not in sys.argv: print("DRY RUN"); sys.exit()
tok = token()
if TAB not in [s["properties"]["title"] for s in api(tok, "/?fields=sheets.properties.title")["sheets"]]:
    api(tok, ":batchUpdate", "POST", {"requests": [{"addSheet": {"properties": {"title": TAB}}}]})
q = urllib.parse.quote(TAB)
api(tok, f"/values/{q}:clear", "POST", {})
api(tok, f"/values/{q}!A1?valueInputOption=RAW", "PUT", {"values": [H] + R})
print("wrote", TAB)
