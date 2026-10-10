"""Free, keyless registry APIs: npm registry + npm advisory bulk endpoint, PyPI JSON API."""
from __future__ import annotations

from typing import Callable, Optional
from urllib.parse import quote

from . import semver
from .http import HttpError, http_json

NPM = "https://registry.npmjs.org"
PYPI = "https://pypi.org/pypi"
SEV_RANK = {"critical": 4, "high": 3, "moderate": 2, "medium": 2, "low": 1, "unknown": 1}


class Registries:
    def __init__(self, http: Callable = http_json):
        self.http = http
        self._cache: dict = {}

    def _get(self, url: str, **kw):
        if url not in self._cache:
            self._cache[url] = self.http(url, **kw)
        return self._cache[url]

    # ---- vulnerabilities -------------------------------------------------
    def vulns(self, eco: str, name: str, version: str) -> list[dict]:
        return self._npm_vulns(name, version) if eco == "npm" else self._pypi_vulns(name, version)

    def _npm_vulns(self, name: str, version: str) -> list[dict]:
        resp = self.http(f"{NPM}/-/npm/v1/security/advisories/bulk", data={name: [version]})
        out = []
        for a in resp.get(name, []):
            out.append({
                "id": (a.get("url") or "").rsplit("/", 1)[-1] or str(a.get("id")),
                "title": a.get("title", ""),
                "severity": (a.get("severity") or "unknown").lower(),
                "url": a.get("url", ""),
                "range": a.get("vulnerable_versions", "*"),
                "fixed_in": [],
            })
        return out

    def _pypi_vulns(self, name: str, version: str) -> list[dict]:
        data = self._get(f"{PYPI}/{quote(name)}/{quote(version)}/json")
        merged: list[tuple[set, dict]] = []  # PyPI lists one advisory once per alias (PYSEC + GHSA)
        for v in data.get("vulnerabilities", []):
            if v.get("withdrawn"):
                continue
            ids = [i for i in [v.get("id", "")] + list(v.get("aliases", [])) if i]
            entry = {
                "id": next((i for i in ids if i.startswith("GHSA")), ids[0] if ids else "unknown"),
                "title": _title(v),
                "severity": "unknown",  # PyPI's feed carries no severity
                "url": v.get("link", ""),
                "range": "",
                "fixed_in": list(v.get("fixed_in", [])),
            }
            for seen, existing in merged:
                if seen & set(ids):
                    seen.update(ids)
                    existing["fixed_in"] = sorted(set(existing["fixed_in"]) | set(entry["fixed_in"]))
                    break
            else:
                merged.append((set(ids), entry))
        return [e for _, e in merged]

    # ---- versions --------------------------------------------------------
    def versions(self, eco: str, name: str) -> list[str]:
        """Stable versions, ascending."""
        if eco == "npm":
            data = self._get(f"{NPM}/{quote(name, safe='@')}", headers={"accept": "application/vnd.npm.install-v1+json"})
            vs = list(data.get("versions", {}))
        else:
            data = self._get(f"{PYPI}/{quote(name)}/json")
            vs = [v for v, files in data.get("releases", {}).items() if files and not any(f.get("yanked") for f in files)]
        vs = [v for v in vs if semver.parse(v) and not semver.is_prerelease(v)]
        return sorted(vs, key=semver.key)

    def deprecated(self, eco: str, name: str, version: str) -> Optional[str]:
        if eco != "npm":
            return None
        try:
            data = self._get(f"{NPM}/{quote(name, safe='@')}", headers={"accept": "application/vnd.npm.install-v1+json"})
        except HttpError:
            return None
        return (data.get("versions", {}).get(version) or {}).get("deprecated")


def _title(v: dict) -> str:
    if v.get("summary"):
        return v["summary"].strip()
    for line in (v.get("details") or "").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            return line[:140]
    return v.get("id", "")
