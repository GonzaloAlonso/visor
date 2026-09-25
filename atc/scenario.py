"""Builds flight plans incrementally from the recorded snapshots."""

import statistics

from . import config
from .aircraft import FlightPlan


class PlanLoader:
    """Streams recorded states into FlightPlans, a time window at a time.

    An airframe that is missing from a later snapshot gets its plan terminated; if it shows up
    again afterwards it becomes a new plan (a new flight, or a coverage gap).
    """

    def __init__(self, store, start_t, backlog_s=3600.0):
        self.store = store
        self.plans = {}
        self.loaded_until = start_t - backlog_s
        self.snap_times = []

    @property
    def interval(self):
        s = self.snap_times[-20:]
        if len(s) < 3:
            return config.POLL_INTERVAL_S
        return max(5.0, statistics.median(b - a for a, b in zip(s, s[1:])))

    def load(self, t_to):
        """Load snapshots with loaded_until < t <= t_to. Returns number of snapshots read."""
        snaps = self.store.snapshot_times(self.loaded_until, t_to)
        if not snaps:
            return 0
        rows = self.store.states_between(self.loaded_until, snaps[-1])
        by_t = {}
        for r in rows:
            by_t.setdefault(r[0], []).append(r)
        for s in snaps:
            present = set()
            for r in by_t.get(s, ()):
                icao = r[1]
                plan = self.plans.get(icao)
                if plan is None or plan.terminated_at is not None:
                    plan = FlightPlan(icao)
                    self.plans[icao] = plan
                plan.add(r)
                present.add(icao)
            for icao, plan in self.plans.items():
                if plan.terminated_at is None and icao not in present and plan.times and plan.times[-1] < s:
                    plan.terminated_at = plan.times[-1]
        self.snap_times.extend(snaps)
        del self.snap_times[:-50]
        self.loaded_until = snaps[-1]
        return len(snaps)

    def prune(self, t, active_plans):
        for icao, plan in list(self.plans.items()):
            if plan in active_plans:
                continue
            if not plan.times or plan.times[-1] < t - 3600:
                del self.plans[icao]
