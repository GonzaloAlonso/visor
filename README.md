# Visor ATC

A 3D air traffic control working position for European airspace. It is part game, part proof of concept that a decision-making AI can control airspace.

Real traffic recorded from the [OpenSky Network](https://openskynetwork.github.io/opensky-api/rest.html) is replayed as a living scenario. You, or an AI agent, take a sector and issue clearances. Each aircraft follows its recorded trajectory until it is cleared otherwise, then flies the clearance with a simple performance model.

## Run

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/fetch_navdata.py      # airports + navaids (OurAirports, public domain)
.venv/bin/python server.py                     # http://localhost:8000   (API docs: /docs)
```

The server records OpenSky snapshots of Europe (34–72°N, 25°W–45°E) into `data/traffic.db` and keeps a rolling 24 h window. Leave it running to build up history.

| OpenSky access | Snapshot interval | Notes |
|---|---|---|
| anonymous | 15 min (400 credits/day, 4 per call) | coarse tracks; the replay interpolates between snapshots |
| `OPENSKY_CLIENT_ID` + `OPENSKY_CLIENT_SECRET` | 90 s | backfills the last hour on first start |

## Deploy with Docker

```sh
cp .env.example .env            # optional: OpenSky / Jev credentials
docker compose up -d --build
docker compose logs -f
```

- The image contains the app and the airport and navaid data, which is downloaded at build time.
- Recordings live in the `visor-data` volume (`/data`), so they survive rebuilds and upgrades. Keep the container running to build the 24 h history.
- Run **one** container. The simulation state is held in memory, so do not scale the service.
- The container listens on `127.0.0.1:8000` of the host. Publish it through a reverse proxy on its own (sub)domain; the UI uses absolute `/api` and `/ws` paths, so a sub-path such as `/visor/` won't work.

**The app has no login.** Anyone who can reach it can issue clearances, reset the scenario or switch the AI on. Put authentication in front of it at the proxy. Example nginx site (TLS via certbot or similar):

```nginx
server {
    server_name atc.example.com;
    listen 443 ssl;
    # ssl_certificate ...; ssl_certificate_key ...;

    auth_basic "Visor ATC";
    auth_basic_user_file /etc/nginx/visor.htpasswd;   # htpasswd -c /etc/nginx/visor.htpasswd you

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;         # WebSocket (/ws)
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 1h;
    }
}
```

With Caddy, `atc.example.com { basicauth { you <hash> }  reverse_proxy 127.0.0.1:8000 }` does the same, including TLS and WebSockets. Generate the hash with `caddy hash-password`.

## Playing

- **Scenario:** *Live* runs just behind the newest snapshot. *Replay* starts anywhere in the recorded window and can run at 1–16×.
- **Sector:** take responsibility for a sector volume. Its traffic is labelled, checks in on the radio and counts for your score.
- **Clearances:** use the flight-strip panel or the command line (<kbd>/</kbd>):

  | | |
  |---|---|
  | `DLH4AB C 370` / `D 240` / `FL 350` | climb / descend / either |
  | `TL 270` / `TR 090` / `H 180` | turn left or right to a heading / fly a heading |
  | `TL 30D` / `TR 20D` | turn by N degrees |
  | `DCT KPT` | proceed direct to a navaid or airport, then rejoin the route |
  | `S 280` | speed (IAS) |
  | `RON` | resume own navigation |

  Several clearances can go in one line: `EZY12 D 300 TR 20D S 280`. If an aircraft is selected, you can omit the callsign.
- **Aircraft behaviour:**
  - Pilots respond after 3–8 s.
  - Turn rate is limited by bank angle.
  - Climb and descent rates depend on class and altitude.
  - Impossible clearances get "unable".
  - An aircraft held at a level away from its planned profile, or kept on a heading too long, will ask for a change.
- **Monitoring:** STCA predicts 2 minutes ahead. Separation minima are 5 NM / 1000 ft, or 3 NM when both aircraft are below FL100. Traffic below 4000 ft is ignored.
- **Score:**
  - +2 per aircraft handled
  - +10 per pilot request granted
  - −2 per STCA alert
  - −10 per ignored request
  - −50 per loss of separation, but only if you were warned (at least 45 s of STCA) or you controlled one of the aircraft

Display settings (⚙) cover vertical exaggeration, speed vectors, trails, drop lines and labels. The map style can be Radar (dark) or Satellite.

## AI integration

The simulator is the environment, and humans and agents use the same API.

**Decision points.** When a situation needs a decision (a conflict or a pilot request), the engine publishes a decision point shaped for decision models such as Jev, which take state plus typed questions and return typed answers:

```json
{
  "id": "D12", "kind": "conflict",
  "state": { "conflict": {...}, "aircraft": [...], "neighbours": [...], "separation_minima": {...} },
  "questions": [
    { "id": "action", "type": "choice", "prompt": "...",
      "options": [ { "id": "o3", "label": "DLH4AB climb FL360",
                     "clearances": [ { "aircraft": "DLH4AB", "kind": "CLIMB", "value": 360 } ],
                     "predicted": { "los_duration_s": 0, "min_h_nm": 6.1, "first_los_s": null, ... },
                     "cost": 1.0 } ] },
    { "id": "urgency", "type": "score", "scale": ["low", "medium", "high", "critical"] },
    { "id": "will_lose_separation", "type": "probability", "statement": "..." }
  ]
}
```

Every option is scored by fast-time prediction: the aircraft and their neighbours are cloned and flown 4 minutes ahead with that clearance applied. The agent chooses from explicit consequences. Answering `{"action": "o3"}` executes the option.

**AI modes** (top bar):
- **Advisory:** the agent's choice is highlighted and you click *Accept*.
- **Autonomous:** the agent's choice is executed directly.

The built-in agents are `rules` (the reference baseline) and `jev`.

**Jev.** Set `JEV_ENDPOINT` (plus `JEV_API_KEY` and `JEV_MODEL` if needed) and select the `jev` agent. The request and response mapping lives in two functions in [atc/agents/jev.py](atc/agents/jev.py): `build_request` and `parse_response`. Adapt them to the provider's actual wire format.

**External agents** can use the HTTP API directly. See [examples/agent_client.py](examples/agent_client.py).

| Endpoint | Purpose |
|---|---|
| `GET /api/observation` | full typed state: aircraft, conflicts, open decisions, score |
| `GET /api/decisions`, `POST /api/decisions/{id}` | list and answer decision points |
| `POST /api/clearance`, `POST /api/command` | structured or shorthand clearances (`issuer: "ai:<name>"`) |
| `POST /api/sim` | pause/resume/speed/reset; `lockstep` + `step` so the agent owns the clock |
| `GET /api/events?since=` | radio and alert log |
| `GET /api/schema` | action space description |
| `WS /ws` | 2 Hz state frames (used by the UI) |

## Code map

- `atc/recorder.py`, `atc/store.py`, `atc/opensky.py`: polling, SQLite rolling history, OAuth2 client
- `atc/scenario.py`: streams recorded snapshots into flight plans
- `atc/aircraft.py`, `atc/performance.py`: flight model, autopilot modes, pilot delay, performance classes
- `atc/clearances.py`: clearance model, shorthand parser, readback phrasing
- `atc/conflicts.py`: STCA and loss-of-separation detection
- `atc/decisions.py`: decision points and fast-time prediction
- `atc/engine.py`: simulation loop, traffic life-cycle, requests, scoring, events
- `atc/api.py`: FastAPI REST and WebSocket
- `public/js/`: three.js client
  - `tiles.js`: level-of-detail terrain from AWS Terrain Tiles plus Esri imagery
  - `traffic.js`: instanced aircraft, drop lines, vectors, trails
  - `overlay.js`: ATC symbology and data blocks
  - `ui.js`: panels, strip, radio, command line

## Limitations

- No wind model (ground speed equals true airspeed), no wake-turbulence spacing, and no approach or departure procedures. Aircraft appear when first seen airborne and disappear on landing or when leaving the area.
- Sector boundaries are simplified approximations, not official airspace data.
- With anonymous OpenSky access, recorded tracks are 15 minutes apart, so routes between snapshots are straight lines.
