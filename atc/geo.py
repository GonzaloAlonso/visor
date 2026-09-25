"""Small-scale geodesy on a spherical Earth, in aviation units (NM, degrees, feet)."""

import math

EARTH_RADIUS_NM = 3440.065
FT_PER_M = 3.28084
KT_PER_MS = 1.943844


def wrap360(a):
    return a % 360.0


def angle_diff(target, current):
    """Signed smallest difference target - current, in (-180, 180]."""
    return (target - current + 540.0) % 360.0 - 180.0


def distance_nm(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_NM * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return wrap360(math.degrees(math.atan2(y, x)))


def move(lat, lon, hdg_deg, dist_nm):
    """Advance a position along a heading. Flat-earth step, fine for steps of a few NM."""
    h = math.radians(hdg_deg)
    dlat = dist_nm * math.cos(h) / 60.0
    lat2 = lat + dlat
    coslat = max(0.01, math.cos(math.radians((lat + lat2) / 2)))
    lon2 = lon + dist_nm * math.sin(h) / (60.0 * coslat)
    return lat2, lon2


def local_xy_nm(lat0, lon0, lat, lon):
    """Equirectangular offset (east, north) of a point from a reference, in NM."""
    return ((lon - lon0) * 60.0 * math.cos(math.radians(lat0)), (lat - lat0) * 60.0)


def velocity_nm_s(hdg_deg, gs_kt):
    h = math.radians(hdg_deg)
    v = gs_kt / 3600.0
    return v * math.sin(h), v * math.cos(h)


def point_in_polygon(lat, lon, poly):
    """poly: list of (lat, lon). Ray casting in lat/lon space."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        yi, xi = poly[i]
        yj, xj = poly[j]
        if (yi > lat) != (yj > lat):
            x_cross = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_cross:
                inside = not inside
        j = i
    return inside
