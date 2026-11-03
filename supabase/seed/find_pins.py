"""List skateparks, pump tracks and skate spots that OpenStreetMap has mapped in
an area, with their centre points, so pins for new seed parks can come from
OSM (which allows storing coordinates) rather than Google.

Usage:
  python3 supabase/seed/find_pins.py --bbox 35.15,-83.25,35.95,-82.25

--bbox is south,west,north,east in degrees. Uses only the Python standard
library. Data © OpenStreetMap contributors (ODbL); keep the credit in the app.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# Public Overpass servers, tried in order. The main one is often busy (502,
# 504 or 429), so the script retries and then falls back to the mirrors.
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
UA = "grindylocks-seed/1.0 (https://grindylocks.com)"


def fetch(query):
    body = urllib.parse.urlencode({"data": query}).encode()
    errors = []
    for url in OVERPASS:
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = json.load(r)
                print(f"(from {url})", file=sys.stderr)
                return data
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
                errors.append(f"{url}: {getattr(e, 'code', '')} {getattr(e, 'reason', e)}")
                time.sleep(5 * (attempt + 1))
    sys.exit("No Overpass server answered:\n  " + "\n  ".join(errors))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", required=True, help="south,west,north,east")
    args = ap.parse_args()
    s, w, n, e = (float(x) for x in args.bbox.split(","))
    box = f"{s},{w},{n},{e}"
    query = f"""[out:json][timeout:60];
(
  nwr["sport"~"skateboard|roller_skating|pump_track"]({box});
  nwr["leisure"="pitch"]["name"~"skate",i]({box});
  nwr["cycling"="pump_track"]({box});
  nwr["leisure"]["name"~"skate|pump ?track",i]({box});
);
out center tags;"""
    data = fetch(query)

    rows = []
    for el in data.get("elements", []):
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None:
            continue
        t = el.get("tags", {})
        rows.append((t.get("name", "(no name)"), lat, lon, f"{el['type']}/{el['id']}",
                     "; ".join(f"{k}={v}" for k, v in t.items()
                               if k in ("leisure", "sport", "surface", "lit", "addr:street",
                                        "addr:city", "cycling", "access", "operator"))))
    rows.sort(key=lambda r: (round(r[1], 2), r[0]))
    print(f"{len(rows)} OSM features in {box}")
    for name, lat, lon, osm, tags in rows:
        print(f"{lat:.7f},{lon:.7f}  {osm:<18} {name}  [{tags}]")


if __name__ == "__main__":
    main()
