"""Adapter for Jev (TypeSafe AI's decision model) or any HTTP decision service.

Jev takes application state plus typed questions (choice / score / probability) and returns typed
answers with probabilities and a confidence value. Decision points in this simulator already have
that shape, so this adapter only has to translate the wire format.

Configuration (environment variables):
    JEV_ENDPOINT   URL that accepts a POST with the JSON body built by `build_request`
    JEV_API_KEY    sent as "Authorization: Bearer <key>" (optional)
    JEV_MODEL      model identifier, default "typesafe-ai/jev"
    JEV_TIMEOUT    seconds, default 5

The exact Jev request/response schema is not public here, so `build_request` and `parse_response`
are the two functions to adjust once you have the provider's API reference. The defaults use a
neutral format:

    request  {"model", "state", "questions": [{"id", "type": "choice"|"score"|"probability", ...}]}
    response {"answers": {"<question id>": {"value": ..., "probabilities": {...}, "confidence": 0.8}}}
"""

import json
import os
import urllib.request

from .base import Agent


def build_request(decision, model):
    questions = []
    for q in decision["questions"]:
        if q["type"] == "choice":
            questions.append({
                "id": q["id"], "type": "choice", "prompt": q["prompt"],
                "options": [{"id": o["id"], "label": o["label"], "predicted": o["predicted"]}
                            for o in q["options"]],
            })
        elif q["type"] == "score":
            questions.append({"id": q["id"], "type": "score", "prompt": q["prompt"], "scale": q["scale"]})
        elif q["type"] == "probability":
            questions.append({"id": q["id"], "type": "probability", "statement": q["statement"]})
    return {"model": model, "state": decision["state"], "questions": questions}


def parse_response(body):
    answers = body.get("answers", body)
    out = {}
    conf = None
    for qid, a in answers.items():
        if isinstance(a, dict):
            out[qid] = a.get("value", a.get("choice"))
            if qid == "action":
                conf = a.get("confidence")
        else:
            out[qid] = a
    if conf is not None:
        out["confidence"] = conf
    return out if out.get("action") else None


class JevAgent(Agent):
    name = "jev"

    def __init__(self):
        self.endpoint = os.environ.get("JEV_ENDPOINT") or None
        self.api_key = os.environ.get("JEV_API_KEY") or None
        self.model = os.environ.get("JEV_MODEL") or "typesafe-ai/jev"
        self.timeout = float(os.environ.get("JEV_TIMEOUT") or 5)
        self.available = bool(self.endpoint)
        self.last_error = None

    def status(self):
        s = super().status()
        s.update(model=self.model, endpoint_configured=self.available, last_error=self.last_error)
        return s

    def decide(self, decision):
        if not self.available:
            self.last_error = "JEV_ENDPOINT not configured"
            return None
        body = json.dumps(build_request(decision, self.model)).encode()
        req = urllib.request.Request(self.endpoint, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", "Bearer " + self.api_key)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                answer = parse_response(json.load(resp))
            self.last_error = None
            return answer
        except Exception as exc:
            self.last_error = str(exc)
            return None
