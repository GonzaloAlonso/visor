class Agent:
    """Interface for decision-making agents.

    `decide` receives a decision point as a plain dict (DecisionPoint.to_dict()) and returns a
    dict of answers keyed by question id, e.g.

        {"action": "o3", "urgency": "high", "will_lose_separation": 0.92, "confidence": 0.8}

    Only "action" is executed. It may block (it runs in a worker thread); return None to abstain.
    """

    name = "agent"
    available = True

    def status(self):
        return {"name": self.name, "available": self.available}

    def decide(self, decision):
        raise NotImplementedError
