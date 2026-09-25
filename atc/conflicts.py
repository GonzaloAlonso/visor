"""Separation monitoring: current losses of separation and short-term predicted conflicts."""

import math

from . import config
from .geo import local_xy_nm, velocity_nm_s

SAMPLE_S = 10.0


def _predicted_alt(ac, dt):
    alt = ac.alt + ac.vs * dt / 60.0
    if ac.vert_mode == "ALT" and ac.cleared_alt is not None:
        if (ac.vs > 0 and alt > ac.cleared_alt) or (ac.vs < 0 and alt < ac.cleared_alt):
            alt = ac.cleared_alt
    return max(0.0, alt)


def sep_h(alt_a, alt_b):
    """Horizontal minimum for a pair: 3 NM when both are below FL100, else 5 NM."""
    if alt_a < config.TMA_CEILING_FT and alt_b < config.TMA_CEILING_FT:
        return config.SEP_H_TMA_NM
    return config.SEP_H_NM


def pair_conflict(a, b, lookahead=config.LOOKAHEAD_S):
    """Return None or (t_to_conflict_s, h_nm, v_ft) for the first predicted infringement."""
    dv0 = abs(a.alt - b.alt)
    if dv0 - (abs(a.vs) + abs(b.vs)) * lookahead / 60.0 > config.SEP_V_FT:
        return None
    bx, by = local_xy_nm(a.lat, a.lon, b.lat, b.lon)
    avx, avy = velocity_nm_s(a.hdg, a.tas)
    bvx, bvy = velocity_nm_s(b.hdg, b.tas)
    rvx, rvy = bvx - avx, bvy - avy
    # quick horizontal reject: closest point of approach within the horizon
    v2 = rvx * rvx + rvy * rvy
    tcpa = 0.0 if v2 < 1e-12 else max(0.0, min(lookahead, -(bx * rvx + by * rvy) / v2))
    cx, cy = bx + rvx * tcpa, by + rvy * tcpa
    min_h = sep_h(a.alt, b.alt)
    if math.hypot(cx, cy) >= min_h:
        return None
    t = 0.0
    while t <= lookahead:
        h = math.hypot(bx + rvx * t, by + rvy * t)
        if h < min_h:
            v = abs(_predicted_alt(a, t) - _predicted_alt(b, t))
            if v < config.LOS_V_FT:
                return t, h, v
        t += SAMPLE_S
    return None


def detect(aircraft, lookahead=config.LOOKAHEAD_S):
    """All predicted/current conflicts among `aircraft` (iterable). Uses a 1-degree grid."""
    grid = {}
    for ac in aircraft:
        key = (int(math.floor(ac.lat)), int(math.floor(ac.lon * math.cos(math.radians(ac.lat)))))
        grid.setdefault(key, []).append(ac)
    out = []
    for (gy, gx), cell in grid.items():
        neigh = []
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                neigh.extend(grid.get((gy + dy, gx + dx), ()))
        for a in cell:
            for b in neigh:
                if a.id >= b.id:
                    continue
                res = pair_conflict(a, b, lookahead)
                if res is not None:
                    t_to, h, v = res
                    out.append({
                        "a": a.id, "b": b.id,
                        "kind": "LOS" if t_to == 0 else "STCA",
                        "t_to": t_to, "h_nm": round(h, 2), "v_ft": round(v),
                    })
    return out
