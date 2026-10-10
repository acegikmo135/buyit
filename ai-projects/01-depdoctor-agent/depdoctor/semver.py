"""Minimal semver / PEP 440-ish version handling (stdlib only).

Only what the agent needs: parse, compare, match advisory ranges, and
extract a lower bound from a manifest specifier.
"""
from __future__ import annotations

import re
from typing import Optional

_NUM = re.compile(r"^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-.]?((?:a|b|rc|alpha|beta|pre|dev|post)[\w.]*|[-+].*))?$")


def parse(v: str) -> Optional[tuple]:
    """Return (major, minor, patch, is_prerelease) or None if unparseable."""
    m = _NUM.match(v.strip())
    if not m:
        return None
    nums = [0 if (g is None or g in "xX*") else int(g) for g in m.groups()[:3]]
    tail = m.group(4) or ""
    pre = bool(re.match(r"^[-.]?(a|b|rc|alpha|beta|pre|dev)", tail)) or (tail.startswith("-") and not tail.startswith("-post"))
    return (nums[0], nums[1], nums[2], pre)


def key(v: str) -> tuple:
    p = parse(v)
    # prereleases sort before the release they precede
    return (p[0], p[1], p[2], 0 if p[3] else 1) if p else (-1, -1, -1, -1)


def is_prerelease(v: str) -> bool:
    p = parse(v)
    return bool(p and p[3])


def cmp(a: str, b: str) -> int:
    ka, kb = key(a), key(b)
    return (ka > kb) - (ka < kb)


_COMP = re.compile(r"^(>=|<=|>|<|=)?\s*(.+)$")


def satisfies(version: str, rng: str) -> bool:
    """Does `version` satisfy an npm-style advisory range?

    Supports comparators joined by spaces (AND) and `||` (OR), plus `*`.
    """
    rng = rng.strip()
    if rng in ("", "*", "x"):
        return True
    for clause in rng.split("||"):
        ok = True
        for tok in re.findall(r"(?:>=|<=|>|<|=)?\s*[\w.*+-]+", clause.strip()):
            m = _COMP.match(tok.strip())
            if not m:
                ok = False
                break
            op, ver = m.group(1) or "=", m.group(2).strip()
            c = cmp(version, ver)
            ok &= {">=": c >= 0, "<=": c <= 0, ">": c > 0, "<": c < 0, "=": c == 0}[op]
            if not ok:
                break
        if ok:
            return True
    return False


def bump_kind(current: str, target: str) -> str:
    """'patch' | 'minor' | 'major' | 'none' describing the upgrade size."""
    a, b = parse(current), parse(target)
    if not a or not b or cmp(current, target) >= 0:
        return "none"
    if a[0] != b[0]:
        return "major"
    if a[1] != b[1]:
        return "minor"
    return "patch"


def lower_bound(spec: str) -> tuple[Optional[str], bool]:
    """Best-known installed version from a manifest specifier.

    Returns (version, exact). `exact` is False when the spec is a range, in
    which case the lower bound is only the *oldest* version that could be
    installed.
    """
    s = spec.strip()
    if not s or s in ("*", "latest", "x") or re.match(r"^(git|http|file|link|workspace|npm:|github:)", s) or "/" in s.split()[0]:
        return None, False
    first = s.split("||")[0].strip()
    m = re.search(r"(\d+(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?[\w.+-]*)", first)
    if not m:
        return None, False
    ver = m.group(1)
    p = parse(ver)
    if not p:
        return None, False
    exact = bool(re.fullmatch(r"=?v?\d+\.\d+\.\d+[\w.+-]*", first)) or bool(re.fullmatch(r"==\s*\d+\.\d+(\.\d+)?", first))
    return f"{p[0]}.{p[1]}.{p[2]}", exact
