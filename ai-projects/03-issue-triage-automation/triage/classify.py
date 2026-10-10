"""Rule-based classification + completeness checks. Deterministic and explainable."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

LABELS = ["bug", "enhancement", "question", "documentation"]

_SIGNALS = {
    "bug": [r"\b(crash(?:es|ed)?|exception|traceback|stack ?trace|segfault|panic)\b", r"\b(error|fails?|failed|failing|broken|regression)\b",
            r"\b(doesn'?t|does not|won'?t|cannot|can'?t|unable to)\b.{0,30}\b(work|start|run|load|build|install|compile)", r"\b\w*(Error|Exception)\b", r"\bsteps to reproduce\b", r"\bunexpected\b"],
    "enhancement": [r"\b(feature request|enhancement|proposal|rfc)\b", r"\b(would be (?:nice|great|useful|helpful)|it would be nice|i'?d like|please add|add support|support for)\b", r"\b(allow|ability to|option to)\b"],
    "question": [r"^\s*(how|what|why|where|which|is it possible|can i|can you|does)\b", r"\bhow (?:do|can|to|should)\b", r"\b(help|confused|not sure how|documentation unclear)\b", r"\?\s*$"],
    "documentation": [r"\b(typo|docs?|documentation|readme|tutorial|example)\b.{0,40}\b(wrong|outdated|missing|incorrect|typo|unclear|broken link)\b", r"\b(typo|broken link|outdated docs?)\b"],
}
_TITLE_PREFIX = {"bug": r"^\s*\[?(bug|defect|crash)\]?", "enhancement": r"^\s*\[?(feature|feat|enhancement|request|proposal)\]?", "question": r"^\s*\[?(question|help|q&a)\]?", "documentation": r"^\s*\[?(docs?|documentation)\]?"}

SECURITY = re.compile(r"\b(vulnerab\w*|cve-\d{4}-\d+|exploit\w*|remote code execution|\brce\b|xss|sql injection|csrf|privilege escalation|auth(?:entication)? bypass|leak(?:s|ed|ing)? (?:secrets?|tokens?|passwords?|credentials?)|security (?:issue|hole|bug))\b", re.I)


@dataclass
class Result:
    label: str | None
    confidence: float
    scores: dict
    missing: list = field(default_factory=list)
    security: bool = False
    low_effort: bool = False


def classify(title: str, body: str) -> Result:
    text = f"{title}\n{body or ''}"
    scores = {k: 0.0 for k in LABELS}
    for label, pats in _SIGNALS.items():
        for p in pats:
            hay = title if p.startswith("^") else text
            if re.search(p, hay, re.I | re.M):
                scores[label] += 1.0
    for label, p in _TITLE_PREFIX.items():
        if re.search(p, title, re.I):
            scores[label] += 2.5
    # issue-template checkboxes: "- [x] Bug report"
    for label, p in (("bug", r"-\s*\[[xX]\]\s*bug"), ("enhancement", r"-\s*\[[xX]\]\s*(feature|enhancement)"), ("question", r"-\s*\[[xX]\]\s*question")):
        if re.search(p, body or "", re.I):
            scores[label] += 3
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    top, second = ranked[0], ranked[1]
    if top[1] == 0:
        label, conf = None, 0.0
    else:
        label = top[0]
        conf = round((top[1] - second[1]) / top[1] * min(1.0, top[1] / 2), 2)
    r = Result(label, conf, scores)
    r.security = bool(SECURITY.search(text))
    r.low_effort = len(re.sub(r"\W+", " ", (body or "")).split()) < 5
    if label == "bug":
        r.missing = missing_bug_info(body or "")
    return r


_CHECKS = [
    ("steps", "Steps to reproduce", r"(steps? to reproduce|how to reproduce|reproduc\w+|repro\b|minimal (?:example|repro)|^\s*1[.)]\s)"),
    ("expected", "Expected vs. actual behavior", r"(expected|actual|should (?:be|have|return)|instead of|but (?:got|get|received))"),
    ("version", "Version (of this project)", r"(version|\bv?\d+\.\d+(?:\.\d+)?\b|commit [0-9a-f]{7}|\bmain\b branch)"),
    ("env", "Environment (OS / runtime / browser)", r"(windows|macos|mac os|linux|ubuntu|debian|alpine|docker|node(?:js)?\b|python|java\b|chrome|firefox|safari|browser|\bos\b)"),
    ("logs", "Error output or logs", r"(```|traceback|stack ?trace|\bat \S+:\d+|\w+Error\b|exception|log)"),
]


def missing_bug_info(body: str) -> list[str]:
    """Which key facts a maintainer would need are absent from the bug report?"""
    return [label for key, label, pat in _CHECKS if not re.search(pat, body, re.I | re.M)]
