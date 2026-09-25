"""Decision-making agents. Every agent answers DecisionPoint dicts (see atc/decisions.py)."""

from .base import Agent
from .rules import RuleAgent
from .jev import JevAgent

REGISTRY = {"rules": RuleAgent, "jev": JevAgent}


def create(name):
    if name not in REGISTRY:
        raise ValueError("unknown agent %r (available: %s)" % (name, ", ".join(REGISTRY)))
    return REGISTRY[name]()


__all__ = ["Agent", "RuleAgent", "JevAgent", "REGISTRY", "create"]
