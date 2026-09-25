"""Minimal OpenSky Network REST client (https://openskynetwork.github.io/opensky-api/rest.html)."""

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config

API_BASE = "https://opensky-network.org/api"
TOKEN_URL = (
    "https://auth.opensky-network.org/auth/realms/opensky-network"
    "/protocol/openid-connect/token"
)


class RateLimited(Exception):
    def __init__(self, retry_after):
        super().__init__("rate limited, retry in %ds" % retry_after)
        self.retry_after = retry_after


class OpenSkyClient:
    def __init__(self):
        self.authenticated = config.OPENSKY_AUTHENTICATED
        self.credits_left = None
        self._token = None
        self._token_expiry = 0.0
        self._lock = threading.Lock()

    def _bearer(self):
        with self._lock:
            if self._token and time.time() < self._token_expiry - 30:
                return self._token
            body = urllib.parse.urlencode({
                "grant_type": "client_credentials",
                "client_id": config.OPENSKY_CLIENT_ID,
                "client_secret": config.OPENSKY_CLIENT_SECRET,
            }).encode()
            req = urllib.request.Request(TOKEN_URL, data=body, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")
            with urllib.request.urlopen(req, timeout=20) as resp:
                data = json.load(resp)
            self._token = data["access_token"]
            self._token_expiry = time.time() + data.get("expires_in", 1800)
            return self._token

    def states(self, bbox, at_time=None):
        """GET /states/all for a bounding box. Returns the decoded JSON ({time, states})."""
        params = {
            "lamin": bbox["lat_min"], "lamax": bbox["lat_max"],
            "lomin": bbox["lon_min"], "lomax": bbox["lon_max"],
            "extended": 1,
        }
        if at_time is not None:
            params["time"] = int(at_time)
        req = urllib.request.Request(API_BASE + "/states/all?" + urllib.parse.urlencode(params))
        if self.authenticated:
            req.add_header("Authorization", "Bearer " + self._bearer())
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                remaining = resp.headers.get("X-Rate-Limit-Remaining")
                if remaining is not None:
                    self.credits_left = int(remaining)
                return json.load(resp)
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                self.credits_left = 0
                raise RateLimited(float(exc.headers.get("X-Rate-Limit-Retry-After-Seconds", 900)))
            raise
