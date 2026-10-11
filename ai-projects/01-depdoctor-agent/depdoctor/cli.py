from __future__ import annotations

import argparse
import sys

from . import agent, llm, manifests, report, triage
from .registries import Registries


def main(argv=None, reg: Registries | None = None, gen=None) -> int:
    p = argparse.ArgumentParser(prog="depdoctor", description="Agent that triages dependency vulnerabilities (free npm/PyPI APIs only).")
    p.add_argument("manifest", help="package.json or requirements.txt")
    p.add_argument("--lock", help="package-lock.json (gives exact installed versions)")
    p.add_argument("--llm", choices=["gemini", "ollama"], help="optional free LLM: steers the agent and writes a summary")
    p.add_argument("--format", choices=["md", "json"], default="md")
    p.add_argument("--no-dev", action="store_true", help="skip devDependencies")
    p.add_argument("--fail-on", choices=["fix-now", "schedule", "any"], help="exit 1 if findings at/above this bucket (for CI)")
    p.add_argument("-v", "--verbose", action="store_true")
    a = p.parse_args(argv)

    try:
        deps = manifests.load(a.manifest, a.lock)
    except (OSError, ValueError) as e:
        print(f"depdoctor: cannot read manifest: {e}", file=sys.stderr)
        return 2
    if a.no_dev:
        deps = [d for d in deps if not d.dev]
    reg = reg or Registries()
    log = (lambda m: print(m, file=sys.stderr)) if a.verbose else (lambda _: None)

    planner, ai = agent.RulePlanner(), None
    gen_fn = gen or (lambda prompt: llm.generate(prompt, a.llm)) if a.llm else None
    if gen_fn:
        planner = agent.LLMPlanner(gen_fn)
    states = agent.run(deps, reg, planner, on_event=log)
    findings = triage.triage(states)

    if gen_fn and findings:
        brief = "\n".join(f"{f.name} {f.installed} [{f.bucket}] -> {f.target}: {f.reason}" for f in findings[:25])
        try:
            ai = gen_fn("Summarize these dependency findings for a developer in 3 sentences. Use only these facts.\n" + brief)
        except Exception as e:  # noqa: BLE001
            log(f"LLM summary skipped: {e}")

    trace = [f"{s.dep.name}: " + " | ".join(f"{act}: {obs}" for act, obs in s.trace) for s in states]
    print(report.to_json(findings, len(deps)) if a.format == "json" else report.to_markdown(findings, len(deps), ai, trace))

    if a.fail_on:
        order = {"fix-now": ["fix-now"], "schedule": ["fix-now", "schedule"], "any": triage.BUCKETS}[a.fail_on]
        if any(f.bucket in order for f in findings):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
