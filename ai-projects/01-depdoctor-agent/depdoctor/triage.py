"""Turn agent state into prioritized, explainable findings."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from . import semver
from .agent import DepState
from .registries import SEV_RANK

BUCKETS = ["fix-now", "schedule", "defer", "no-fix", "unknown"]


@dataclass
class Finding:
    name: str
    ecosystem: str
    installed: str
    exact: bool
    dev: bool
    bucket: str
    reason: str
    max_severity: str
    vulns: list
    target: Optional[str]
    bump: str
    verified_clean: bool
    deprecated: Optional[str]
    notes: list = field(default_factory=list)


def _sev_name(rank: int) -> str:
    return {4: "critical", 3: "high", 2: "moderate", 1: "low/unknown"}.get(rank, "none")


def classify(s: DepState) -> Optional[Finding]:
    if s.error or not s.vulns:
        if s.error and s.dep.version:
            return Finding(s.dep.name, s.dep.ecosystem, s.dep.version, s.dep.exact, s.dep.dev, "unknown",
                           f"could not check: {s.error}", "none", [], None, "none", False, None)
        return None
    rank, prod = s.max_sev, not s.dep.dev
    unknown_sev = all(v["severity"] == "unknown" for v in s.vulns)  # PyPI feed has no severity
    target = s.target if (s.target and s.verified and not s.remaining) else None
    bump = semver.bump_kind(s.dep.version, target) if target else "none"
    notes = []
    if not s.dep.exact:
        notes.append(f"manifest says '{s.dep.spec}': assumed oldest allowed version {s.dep.version}; pin or add a lockfile to confirm")
    if bump == "major":
        notes.append("fix requires a major-version upgrade: budget time for breaking changes")
    if s.target and not target:
        notes.append(f"candidate {s.target} did not verify clean")
    if s.deprecated:
        notes.append(f"installed version is deprecated: {s.deprecated[:120]}")

    if not target:
        bucket, reason = "no-fix", "no published version clears the advisories; monitor or replace the package"
    elif unknown_sev and prod:
        bucket, reason = "schedule", "production dependency; severity not provided by this registry, review the advisory"
    elif prod and rank >= SEV_RANK["high"]:
        bucket, reason = "fix-now", f"{_sev_name(rank)} severity in a production dependency; verified fix {target} ({bump} bump)"
    elif prod or rank >= SEV_RANK["high"]:
        bucket, reason = "schedule", ("moderate/low severity in production" if prod else "high severity but dev-only (affects tooling, not shipped code)")
    else:
        bucket, reason = "defer", "dev-only dependency with moderate/low severity"
    return Finding(s.dep.name, s.dep.ecosystem, s.dep.version, s.dep.exact, s.dep.dev, bucket, reason,
                   _sev_name(rank) if not unknown_sev else "unknown", s.vulns, target, bump, bool(target), s.deprecated, notes)


def triage(states: list[DepState]) -> list[Finding]:
    fs = [f for f in (classify(s) for s in states) if f]
    return sorted(fs, key=lambda f: (BUCKETS.index(f.bucket), -SEV_RANK.get(f.max_severity.split("/")[0], 0), f.name))
