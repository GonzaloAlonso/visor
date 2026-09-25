#!/usr/bin/env python3
"""Download the OurAirports airport and navaid databases (public domain) into data/
(or $VISOR_NAVDATA_DIR)."""

import os
import urllib.request
from pathlib import Path

DATA = Path(os.environ.get("VISOR_NAVDATA_DIR") or Path(__file__).resolve().parent.parent / "data")
FILES = {
    "airports.csv": "https://davidmegginson.github.io/ourairports-data/airports.csv",
    "navaids.csv": "https://davidmegginson.github.io/ourairports-data/navaids.csv",
}

if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        print("downloading", url)
        urllib.request.urlretrieve(url, DATA / name)
    print("done")
