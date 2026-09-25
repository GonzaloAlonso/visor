"""Control sectors the player (or an AI agent) can take responsibility for.

Boundaries are simplified approximations inspired by real European airspace, not official data.
"""

from .geo import point_in_polygon

SECTORS = [
    {
        "id": "MUAC-DECO", "name": "Maastricht Upper — Delta/Coastal",
        "fl_min": 245, "fl_max": 660,
        "poly": [(53.6, 3.0), (53.9, 7.2), (52.3, 9.2), (50.3, 8.4), (49.6, 6.0), (50.2, 2.6), (51.6, 2.0)],
    },
    {
        "id": "ALPS-UPPER", "name": "Alps Upper",
        "fl_min": 245, "fl_max": 660,
        "poly": [(48.2, 5.8), (48.5, 9.8), (48.2, 13.5), (46.6, 14.6), (45.5, 12.4), (45.3, 8.2), (46.2, 5.6)],
    },
    {
        "id": "LONDON-TMA", "name": "London Terminal",
        "fl_min": 0, "fl_max": 245,
        "poly": [(52.4, -1.6), (52.5, 0.6), (51.9, 1.6), (50.9, 1.2), (50.6, -0.6), (51.0, -1.9)],
    },
    {
        "id": "PARIS-EST", "name": "Paris East",
        "fl_min": 195, "fl_max": 660,
        "poly": [(50.0, 2.0), (49.9, 5.4), (48.2, 5.8), (46.9, 4.8), (47.2, 2.2), (48.6, 1.4)],
    },
    {
        "id": "IBERIA-N", "name": "Iberia North",
        "fl_min": 195, "fl_max": 660,
        "poly": [(43.8, -9.4), (43.5, -1.8), (42.5, 3.2), (40.8, 1.0), (40.0, -4.0), (41.0, -8.8)],
    },
    {
        "id": "BALKANS", "name": "Balkans Upper",
        "fl_min": 285, "fl_max": 660,
        "poly": [(47.0, 15.8), (46.6, 21.5), (44.4, 23.0), (42.0, 22.6), (41.6, 19.4), (43.6, 15.4)],
    },
]

BY_ID = {s["id"]: s for s in SECTORS}


def contains(sector, lat, lon, alt_ft):
    if sector is None:
        return True
    fl = alt_ft / 100.0
    if fl < sector["fl_min"] or fl > sector["fl_max"]:
        return False
    return point_in_polygon(lat, lon, sector["poly"])
