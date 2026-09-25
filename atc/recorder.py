"""Background recorder: polls OpenSky for the European airspace and keeps a rolling 24 h history."""

import logging
import threading
import time

from . import config
from .opensky import OpenSkyClient, RateLimited

log = logging.getLogger("visor.recorder")


class Recorder:
    def __init__(self, store):
        self.store = store
        self.client = OpenSkyClient()
        self.interval = config.POLL_INTERVAL_S
        self.last_error = None
        self.last_poll = None
        self.next_poll = time.time()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="recorder", daemon=True)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()

    def status(self):
        first, last, n = self.store.coverage()
        return {
            "authenticated": self.client.authenticated,
            "interval_s": self.interval,
            "credits_left": self.client.credits_left,
            "last_error": self.last_error,
            "last_poll": self.last_poll,
            "next_poll": self.next_poll,
            "coverage": {"first": first, "last": last, "snapshots": n},
        }

    def _poll(self, at_time=None):
        payload = self.client.states(config.EUROPE, at_time)
        n = self.store.insert_snapshot(payload)
        log.info("snapshot t=%s stored %d airborne aircraft", payload.get("time"), n)
        return payload.get("time")

    def _backfill(self):
        """Authenticated users can fetch up to 1 h of history: seed the store on first run."""
        _, last, _ = self.store.coverage()
        now = time.time()
        start = now - 3600 + 60
        if last is not None and last > now - config.BACKFILL_STEP_S:
            return
        if last is not None:
            start = max(start, last + config.BACKFILL_STEP_S)
        t = start
        while t < now - config.BACKFILL_STEP_S and not self._stop.is_set():
            try:
                self._poll(at_time=t)
            except RateLimited:
                raise
            except Exception as exc:  # history is best effort
                log.warning("backfill at %d failed: %s", t, exc)
            t += config.BACKFILL_STEP_S

    def _run(self):
        if self.client.authenticated:
            try:
                self._backfill()
            except Exception as exc:
                self.last_error = "backfill: %s" % exc
        while not self._stop.is_set():
            delay = self.interval
            try:
                self._poll()
                self.last_error = None
                self.last_poll = time.time()
                self.store.purge_before(time.time() - config.RETENTION_S)
            except RateLimited as exc:
                self.last_error = str(exc)
                delay = max(self.interval, exc.retry_after)
            except Exception as exc:
                self.last_error = "poll failed: %s" % exc
                delay = min(self.interval, 60)
                log.warning(self.last_error)
            self.next_poll = time.time() + delay
            self._stop.wait(delay)
