"""Coarse aircraft performance classes, derived from the OpenSky emitter category."""

# ias_* in knots IAS, tas_max in knots TAS, climb rates (fpm) for <FL100, <FL250, above.
PERF = {
    "L": dict(name="Light", wake="L", ias_min=60, ias_max=170, tas_max=190, ceiling=18000,
              climb=(800, 600, 400), descent=1000, bank=25, accel=1.0),
    "S": dict(name="Small jet", wake="M", ias_min=120, ias_max=330, tas_max=480, ceiling=41000,
              climb=(3000, 2200, 1200), descent=2500, bank=25, accel=1.5),
    "M": dict(name="Medium jet", wake="M", ias_min=140, ias_max=340, tas_max=500, ceiling=41000,
              climb=(2500, 1800, 1000), descent=2500, bank=25, accel=1.2),
    "H": dict(name="Heavy", wake="H", ias_min=150, ias_max=340, tas_max=520, ceiling=43000,
              climb=(2000, 1500, 800), descent=2200, bank=25, accel=0.9),
    "X": dict(name="High performance", wake="M", ias_min=150, ias_max=450, tas_max=700, ceiling=50000,
              climb=(6000, 5000, 3000), descent=5000, bank=45, accel=3.0),
    "R": dict(name="Rotorcraft", wake="L", ias_min=30, ias_max=140, tas_max=160, ceiling=12000,
              climb=(1000, 800, 500), descent=1000, bank=25, accel=1.5),
}

_CATEGORY_CLASS = {2: "L", 3: "S", 4: "M", 5: "M", 6: "H", 7: "X", 8: "R",
                   9: "L", 10: "L", 11: "L", 12: "L", 14: "L"}


def classify(category, gs_kt, alt_ft):
    cls = _CATEGORY_CLASS.get(category or 0)
    if cls:
        return cls
    if gs_kt is not None and gs_kt < 180 and alt_ft < 15000:
        return "L"
    return "M"


def ias_to_tas(ias, alt_ft):
    return ias * (1.0 + 0.02 * alt_ft / 1000.0)


def tas_to_ias(tas, alt_ft):
    return tas / (1.0 + 0.02 * alt_ft / 1000.0)


def climb_rate(perf, alt_ft):
    lo, mid, hi = perf["climb"]
    return lo if alt_ft < 10000 else (mid if alt_ft < 25000 else hi)
