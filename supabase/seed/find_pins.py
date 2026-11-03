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
import math
import urllib.parse
import urllib.request

OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "grindylocks-seed/1.0 (https://grindylocks.com)"


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
  nwr["name"~"skate ?park|pump ?track|skate spot",i]({box});
);
out center tags;"""
    req = urllib.request.Request(OVERPASS, data=urllib.parse.urlencode({"data": query}).encode(),
                                 headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = json.load(r)

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
