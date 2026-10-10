"""Text utilities: cleaning, tokenizing, TF-IDF cosine similarity (stdlib only)."""
from __future__ import annotations

import math
import re
from collections import Counter

STOP = set("a an the and or of to in on for is are be was were it this that these those with as at by from my me i we you your our can could would should may might will do does did if then than so not no any all about what when how there their they them its but have has had get got just also".split())
_CODE = re.compile(r"```.*?```", re.S)
_URL = re.compile(r"https?://\S+")
_COMMENT = re.compile(r"<!--.*?-->", re.S)


def clean(markdown: str) -> str:
    t = _COMMENT.sub(" ", markdown or "")
    t = _URL.sub(" ", t)
    return t


def tokens(text: str) -> list[str]:
    # keep identifiers like TypeError / ECONNRESET intact: they are the best duplicate signal
    out = []
    for w in re.findall(r"[A-Za-z][A-Za-z0-9_]{2,}", clean(text)):
        lw = w.lower()
        if lw in STOP:
            continue
        out.append(re.sub(r"(ing|ed|es|s)$", "", lw) if len(lw) > 5 else lw)
    return out


class TfIdf:
    """Fit on a corpus once, then compare any text against it."""

    def __init__(self, docs: list[str]):
        self.toks = [tokens(d) for d in docs]
        n = len(docs)
        df = Counter(t for d in self.toks for t in set(d))
        self.idf = {t: math.log((1 + n) / (1 + c)) + 1 for t, c in df.items()}
        self.vecs = [self._vec(d) for d in self.toks]

    def _vec(self, toks: list[str]) -> dict[str, float]:
        tf = Counter(toks)
        v = {t: (1 + math.log(c)) * self.idf.get(t, 1.0) for t, c in tf.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {t: x / norm for t, x in v.items()}

    def similar(self, text: str, top: int = 3) -> list[tuple[int, float]]:
        q = self._vec(tokens(text))
        scored = []
        for i, v in enumerate(self.vecs):
            if len(q) < len(v):
                s = sum(x * v.get(t, 0.0) for t, x in q.items())
            else:
                s = sum(x * q.get(t, 0.0) for t, x in v.items())
            if s > 0:
                scored.append((i, s))
        return sorted(scored, key=lambda p: -p[1])[:top]
