"""Navaids and airports inside the simulated area, from OurAirports (public domain) CSV files."""

import csv
import logging

from . import config
from .geo import distance_nm

log = logging.getLogger("visor.navdata")

NAVAID_TYPES = {"VOR", "VOR-DME", "VORTAC", "DME", "TACAN", "NDB", "NDB-DME"}


def _in_area(lat, lon, margin=0.0):
    b = config.EUROPE
    return (b["lat_min"] - margin <= lat <= b["lat_max"] + margin
            and b["lon_min"] - margin <= lon <= b["lon_max"] + margin)


class NavData:
    def __init__(self):
        self.fixes = []          # dicts: ident, name, kind, lat, lon
        self.by_ident = {}       # ident -> [fix, ...] (idents are not globally unique)
        self._load_navaids(config.DATA_DIR / "navaids.csv")
        self._load_airports(config.DATA_DIR / "airports.csv")
        log.info("navdata: %d fixes", len(self.fixes))

    def _add(self, fix):
        self.fixes.append(fix)
        self.by_ident.setdefault(fix["ident"], []).append(fix)

    def _load_navaids(self, path):
        if not path.exists():
            log.warning("%s missing — run scripts/fetch_navdata.py", path)
            return
        with open(path, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["type"] not in NAVAID_TYPES or not r["latitude_deg"]:
                    continue
                lat, lon = float(r["latitude_deg"]), float(r["longitude_deg"])
                if not _in_area(lat, lon):
                    continue
                kind = "NDB" if r["type"].startswith("NDB") else (
                    "DME" if r["type"] in ("DME", "TACAN") else "VOR")
                self._add({"ident": r["ident"].upper(), "name": r["name"], "kind": kind,
                           "lat": lat, "lon": lon})

    def _load_airports(self, path):
        if not path.exists():
            log.warning("%s missing — run scripts/fetch_navdata.py", path)
            return
        with open(path, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["type"] not in ("large_airport", "medium_airport"):
                    continue
                if r["scheduled_service"] != "yes":
                    continue
                ident = (r.get("icao_code") or r["gps_code"] or r["ident"]).upper()
                if len(ident) != 4 or not ident.isalpha():
                    continue
                lat, lon = float(r["latitude_deg"]), float(r["longitude_deg"])
                if not _in_area(lat, lon):
                    continue
                self._add({"ident": ident, "name": r["name"],
                           "kind": "APT" if r["type"] == "medium_airport" else "APT_L",
                           "lat": lat, "lon": lon})

    def find(self, ident, near_lat=None, near_lon=None):
        """Resolve an identifier; when ambiguous, pick the one nearest to the given position."""
        cands = self.by_ident.get(ident.upper())
        if not cands:
            return None
        if near_lat is None or len(cands) == 1:
            return cands[0]
        return min(cands, key=lambda f: distance_nm(near_lat, near_lon, f["lat"], f["lon"]))

    def nearby(self, lat, lon, radius_nm, kinds=None, limit=40):
        out = []
        for f in self.fixes:
            if kinds and f["kind"] not in kinds:
                continue
            if abs(f["lat"] - lat) * 60 > radius_nm:
                continue
            d = distance_nm(lat, lon, f["lat"], f["lon"])
            if d <= radius_nm:
                out.append((d, f))
        out.sort(key=lambda x: x[0])
        return [dict(f, dist_nm=round(d, 1)) for d, f in out[:limit]]
