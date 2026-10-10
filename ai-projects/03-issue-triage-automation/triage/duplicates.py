from __future__ import annotations

from dataclasses import dataclass

from .text import TfIdf

POSSIBLE = 0.45
LIKELY = 0.70


@dataclass
class Match:
    number: int
    title: str
    state: str
    score: float
    url: str


def find(issue: dict, others: list[dict], top: int = 3) -> list[Match]:
    pool = [o for o in others if o["number"] != issue["number"] and "pull_request" not in o]
    if not pool:
        return []
    doc = lambda i: f"{i['title']} {i['title']} {i.get('body') or ''}"  # title counts double
    model = TfIdf([doc(o) for o in pool])
    out = []
    for idx, score in model.similar(doc(issue), top):
        if score >= POSSIBLE:
            o = pool[idx]
            out.append(Match(o["number"], o["title"], o.get("state", "open"), round(score, 2), o.get("html_url", "")))
    return out
