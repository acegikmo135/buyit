"""Entry point for the GitHub Action: triage one issue, idempotently."""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

from . import classify as C
from . import duplicates, llm
from .github import GitHub

MARKER = "<!-- issue-triage-bot -->"


def _safe(title: str) -> str:
    """Other people's titles go into our comment: no @-mentions, newlines or markdown links."""
    t = re.sub(r"https?://\S+", "<link removed>", " ".join(title.split())[:100])
    return t.replace("@", "@\u200b").replace("[", "\\[").replace("]", "\\]").replace("`", "'")


FOOTER = "\n\n<sub>Automated first-pass triage. A maintainer will review; reply here if anything above is wrong.</sub>"


def decide(issue: dict, others: list[dict], llm_classify=lambda t, b: None) -> dict:
    """Pure function: issue + context -> {labels, comment}. No network."""
    title, body = issue["title"], issue.get("body") or ""
    res = C.classify(title, body)
    label, used_llm = res.label, False
    if (label is None or res.confidence < 0.4) and not res.security:
        guess = llm_classify(title, body)
        if guess:
            label, used_llm = guess, True
    dups = duplicates.find(issue, others)
    labels, parts = [], []

    if res.security:
        labels.append("security")
        parts.append("**This may be a security report.** Please don't post exploit details publicly. Use this repository's *Security → Report a vulnerability* page (private advisory) instead, and a maintainer will follow up.")
    if label:
        labels.append(label)
    if res.low_effort and not res.security:
        labels.append("needs-info")
        parts.append("The description is very short. Could you add more detail about what you were trying to do and what happened?")
    if label == "bug" and res.missing and len(res.missing) >= 2:
        labels.append("needs-info")
        parts.append("Thanks for the report! To help us reproduce it, could you add:\n" + "\n".join(f"- [ ] {m}" for m in res.missing))
    if dups:
        likely = dups[0].score >= duplicates.LIKELY
        if likely:
            labels.append("possible-duplicate")
        lines = [f"- #{d.number} {_safe(d.title)} ({d.state}, {int(d.score * 100)}% similar)" for d in dups]
        parts.append(("This looks like it may duplicate an existing issue" if likely else "These existing issues look related") + ":\n" + "\n".join(lines) + "\nIf one of these is the same problem, please add your details there. This issue was not closed automatically.")
    labels = list(dict.fromkeys(labels))
    comment = (MARKER + "\n" + "\n\n".join(parts) + FOOTER) if parts else None
    return {"labels": labels, "comment": comment, "classification": {"label": label, "confidence": res.confidence, "llm": used_llm}}


def triage_issue(gh, number: int, dry_run: bool = False, llm_classify=lambda t, b: None) -> dict:
    issue = gh.get_issue(number)
    if "pull_request" in issue or (issue.get("user") or {}).get("type") == "Bot":
        return {"skipped": "pull request or bot author"}
    if any(MARKER in (c.get("body") or "") for c in gh.comments(number)):
        return {"skipped": "already triaged"}
    existing = {l["name"] if isinstance(l, dict) else l for l in issue.get("labels", [])}
    plan = decide(issue, gh.recent_issues(), llm_classify)
    # respect maintainers: never touch an issue they have already labeled
    if existing & {"bug", "enhancement", "question", "documentation", "duplicate", "wontfix", "invalid"}:
        plan["labels"] = [l for l in plan["labels"] if l not in C.LABELS]
    plan["labels"] = [l for l in plan["labels"] if l not in existing]
    if not dry_run:
        if plan["labels"]:
            gh.add_labels(number, plan["labels"])
        if plan["comment"]:
            gh.comment(number, plan["comment"])
    return plan


def issue_number_from_event(path: str) -> int | None:
    with open(path, encoding="utf-8") as f:
        ev = json.load(f)
    if ev.get("action") not in (None, "opened", "reopened") and "inputs" not in ev:
        return None
    n = (ev.get("issue") or {}).get("number") or (ev.get("inputs") or {}).get("issue")
    return int(n) if n else None


def main(argv=None, gh=None) -> int:
    p = argparse.ArgumentParser(prog="issue-triage")
    p.add_argument("--issue", type=int, help="issue number (default: from the GitHub event payload)")
    p.add_argument("--dry-run", action="store_true", default=os.environ.get("TRIAGE_DRY_RUN") == "1")
    a = p.parse_args(argv)
    number = a.issue
    if number is None and os.environ.get("GITHUB_EVENT_PATH"):
        number = issue_number_from_event(os.environ["GITHUB_EVENT_PATH"])
    if number is None:
        print("nothing to triage")
        return 0
    gh = gh or GitHub(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"])
    plan = triage_issue(gh, number, a.dry_run, llm.gemini_classify)
    print(json.dumps(plan, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
