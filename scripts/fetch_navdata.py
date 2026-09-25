#!/usr/bin/env python3
"""Download the OurAirports airport and navaid databases (public domain) into data/."""

import urllib.request
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"
FILES = {
    "airports.csv": "https://davidmegginson.github.io/ourairports-data/airports.csv",
    "navaids.csv": "https://davidmegginson.github.io/ourairports-data/navaids.csv",
}

if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    for name, url in FILES.items():
        print("downloading", url)
        urllib.request.urlretrieve(url, DATA / name)
    print("done")
