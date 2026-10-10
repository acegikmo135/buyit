from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict

from .triage import BUCKETS, Finding

TITLES = {"fix-now": "Fix now", "schedule": "Schedule", "defer": "Safe to defer", "no-fix": "No fix published", "unknown": "Could not check"}


def summary_line(findings: list[Finding], scanned: int) -> str:
    c = Counter(f.bucket for f in findings)
    if not findings:
        return f"Scanned {scanned} dependencies: no known vulnerabilities."
    parts = ", ".join(f"{c[b]} {TITLES[b].lower()}" for b in BUCKETS if c[b])
    return f"Scanned {scanned} dependencies: {len(findings)} with findings ({parts})."


def to_markdown(findings: list[Finding], scanned: int, ai_summary: str | None = None, trace: list | None = None) -> str:
    out = ["# DepDoctor report", "", summary_line(findings, scanned), ""]
    if ai_summary:
        out += ["> **AI-written summary** (verify against the table below): " + ai_summary.replace("\n", " "), ""]
    for b in BUCKETS:
        group = [f for f in findings if f.bucket == b]
        if not group:
            continue
        out += [f"## {TITLES[b]} ({len(group)})", ""]
        for f in group:
            fix = f"upgrade to **{f.target}** ({f.bump})" if f.target else "no verified fix"
            scope = "dev" if f.dev else "prod"
            out.append(f"- **{f.name}** {f.installed} [{f.ecosystem}, {scope}, {f.max_severity}]: {fix}. {f.reason}.")
            for v in f.vulns[:5]:
                out.append(f"  - {v['id']}: {v['title'][:110]} {v['url']}".rstrip())
            if len(f.vulns) > 5:
                out.append(f"  - ... and {len(f.vulns) - 5} more")
            for n in f.notes:
                out.append(f"  - note: {n}")
        out.append("")
    if trace:
        out += ["<details><summary>Agent trace</summary>", ""] + [f"- {t}" for t in trace] + ["", "</details>"]
    return "\n".join(out) + "\n"


def to_json(findings: list[Finding], scanned: int) -> str:
    return json.dumps({"scanned": scanned, "findings": [asdict(f) for f in findings]}, indent=2)
