"""Parse dependency manifests into Dependency records."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional

from . import semver


@dataclass
class Dependency:
    name: str
    ecosystem: str          # "npm" | "pypi"
    spec: str               # what the manifest says
    version: Optional[str]  # best-known installed version
    exact: bool             # True if version is pinned/locked, False if range lower bound
    dev: bool = False


def parse_package_json(text: str, lock_text: Optional[str] = None) -> list[Dependency]:
    data = json.loads(text)
    locked: dict[str, str] = {}
    if lock_text:
        lock = json.loads(lock_text)
        for path, info in (lock.get("packages") or {}).items():
            if path.startswith("node_modules/") and path.count("node_modules/") == 1 and info.get("version"):
                locked[path[len("node_modules/"):]] = info["version"]
        for name, info in (lock.get("dependencies") or {}).items():  # lockfile v1
            if isinstance(info, dict) and info.get("version") and name not in locked:
                locked[name] = info["version"]
    out = []
    for section, dev in (("dependencies", False), ("optionalDependencies", False), ("devDependencies", True)):
        for name, spec in (data.get(section) or {}).items():
            if name in locked:
                out.append(Dependency(name, "npm", spec, locked[name], True, dev))
                continue
            ver, exact = semver.lower_bound(spec)
            out.append(Dependency(name, "npm", spec, ver, exact, dev))
    return out


_REQ = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*((?:[<>=!~]=?|===)\s*[^;#\s,]+(?:\s*,\s*(?:[<>=!~]=?|===)\s*[^;#\s,]+)*)?")


def parse_requirements(text: str) -> list[Dependency]:
    out = []
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith(("-", "git+", "http")):
            continue
        m = _REQ.match(line)
        if not m:
            continue
        name, spec = m.group(1), (m.group(2) or "").replace(" ", "")
        exact = bool(re.fullmatch(r"===?\d[\w.]*", spec))
        if exact:
            ver = spec.lstrip("=")
        else:
            lb = re.search(r"(?:>=|~=|>)(\d[\w.]*)", spec)
            ver = lb.group(1) if lb else None
            if ver:
                p = semver.parse(ver)
                ver = f"{p[0]}.{p[1]}.{p[2]}" if p else None
        out.append(Dependency(name.lower().replace("_", "-"), "pypi", spec or "*", ver, exact, False))
    return out


def load(path: str, lock_path: Optional[str] = None) -> list[Dependency]:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if path.endswith("package.json"):
        lock = None
        if lock_path:
            with open(lock_path, encoding="utf-8") as f:
                lock = f.read()
        return parse_package_json(text, lock)
    return parse_requirements(text)
