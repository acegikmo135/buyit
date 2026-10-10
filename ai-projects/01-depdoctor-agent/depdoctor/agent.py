"""The agent loop: observe -> plan -> act (tool call) -> observe, per dependency.

The planner chooses the next action from the *legal* actions for the current
state. `RulePlanner` is deterministic. `LLMPlanner` lets a free LLM choose among
the same legal actions; anything illegal or malformed falls back to the rules,
so the LLM can steer but never break the loop.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Callable, Optional

from . import semver
from .http import HttpError
from .manifests import Dependency
from .registries import SEV_RANK, Registries

MAX_FIX_ATTEMPTS = 3
MAX_STEPS_PER_DEP = 12


@dataclass
class DepState:
    dep: Dependency
    checked: bool = False
    vulns: list = field(default_factory=list)
    target: Optional[str] = None
    floor: Optional[str] = None          # search for fixes strictly above this
    fix_attempts: int = 0
    verified: bool = False
    remaining: list = field(default_factory=list)
    deprecated: Optional[str] = None
    done: bool = False
    deferred: bool = False
    error: Optional[str] = None
    trace: list = field(default_factory=list)

    @property
    def max_sev(self) -> int:
        return max((SEV_RANK.get(v["severity"], 1) for v in self.vulns), default=0)


def legal_actions(s: DepState) -> list[str]:
    if s.done:
        return []
    if not s.checked:
        return ["check"]
    if not s.vulns:
        return ["finish"]
    if s.target and not s.verified:
        work = "verify"
    elif s.verified and s.remaining and s.fix_attempts < MAX_FIX_ATTEMPTS:
        work = "find_fix"
    elif s.fix_attempts == 0:
        work = "find_fix"
    else:
        return ["finish"]
    # Guardrail: a planner may never walk away from an unfinished fix on a
    # production dependency with high/critical advisories.
    must_fix = (not s.dep.dev) and s.max_sev >= SEV_RANK["high"]
    return [work] if must_fix else [work, "finish"]


class RulePlanner:
    name = "rules"

    def next(self, s: DepState) -> str:
        return legal_actions(s)[0]


class LLMPlanner:
    name = "llm"

    def __init__(self, generate: Callable[[str], str], fallback: Optional[RulePlanner] = None):
        self.generate = generate
        self.fallback = fallback or RulePlanner()
        self.llm_calls = self.llm_fallbacks = 0

    def next(self, s: DepState) -> str:
        legal = legal_actions(s)
        if len(legal) == 1:
            return legal[0]
        prompt = (
            "You are a dependency-security triage agent. Choose the next action.\n"
            f"Package: {s.dep.name} ({s.dep.ecosystem}) version {s.dep.version}, {'dev' if s.dep.dev else 'production'} dependency.\n"
            f"Known vulnerabilities: {len(s.vulns)} (max severity rank {s.max_sev}/4). Fix target: {s.target}. Verified: {s.verified}.\n"
            f"Legal actions: {legal}. 'finish' means stop investigating this package.\n"
            'Reply with JSON only: {"action": "<one legal action>"}'
        )
        self.llm_calls += 1
        try:
            m = re.search(r"\{.*?\}", self.generate(prompt), re.S)
            action = json.loads(m.group(0))["action"]
            if action in legal:
                return action
        except Exception:  # noqa: BLE001
            pass
        self.llm_fallbacks += 1
        return self.fallback.next(s)


class Tools:
    """The agent's tool belt. Each tool returns a short observation string."""

    def __init__(self, reg: Registries):
        self.reg = reg

    def check(self, s: DepState) -> str:
        s.vulns = self.reg.vulns(s.dep.ecosystem, s.dep.name, s.dep.version)
        s.checked = True
        s.deprecated = self.reg.deprecated(s.dep.ecosystem, s.dep.name, s.dep.version)
        return f"{len(s.vulns)} known vulnerabilities" + (" (version is deprecated)" if s.deprecated else "")

    def find_fix(self, s: DepState) -> str:
        s.fix_attempts += 1
        floor = s.floor or s.dep.version
        eco = s.dep.ecosystem
        for cand in self.reg.versions(eco, s.dep.name):
            if semver.cmp(cand, floor) <= 0:
                continue
            if all(self._fixed_by(v, cand, s.dep.version) for v in s.vulns):
                s.target, s.verified, s.remaining = cand, False, []
                return f"lowest candidate that clears all advisories: {cand}"
        s.target = None
        return "no published version clears all advisories"

    @staticmethod
    def _fixed_by(vuln: dict, cand: str, current: str) -> bool:
        if vuln["range"]:
            return not semver.satisfies(cand, vuln["range"])
        return any(semver.cmp(f, current) > 0 and semver.cmp(cand, f) >= 0 for f in vuln["fixed_in"])

    def verify(self, s: DepState) -> str:
        s.remaining = self.reg.vulns(s.dep.ecosystem, s.dep.name, s.target)
        s.verified = True
        if s.remaining:
            s.floor = s.target
            return f"{s.target} still has {len(s.remaining)} advisories; widening search"
        return f"{s.target} verified clean against live advisory data"


def run(deps: list[Dependency], reg: Registries, planner=None, on_event: Callable[[str], None] = lambda _: None) -> list[DepState]:
    planner = planner or RulePlanner()
    tools = Tools(reg)
    states = []
    for dep in deps:
        s = DepState(dep)
        states.append(s)
        if not dep.version:
            s.done, s.error = True, "no resolvable version (unpinned/URL/workspace spec); skipped"
            s.trace.append(("skip", s.error))
            continue
        for _ in range(MAX_STEPS_PER_DEP):
            legal = legal_actions(s)
            if not legal:
                break
            action = planner.next(s)
            if action == "finish":
                s.done = True
                s.deferred = bool(s.vulns) and s.fix_attempts == 0
                s.trace.append(("finish", "stop"))
                break
            try:
                obs = getattr(tools, action)(s)
            except HttpError as e:
                s.error, s.done = str(e), True
                s.trace.append((action, f"error: {e}"))
                break
            s.trace.append((action, obs))
            on_event(f"{dep.name}: {action} -> {obs}")
        s.done = True
    return states
