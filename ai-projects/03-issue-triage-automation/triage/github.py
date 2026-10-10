"""Minimal GitHub REST client (stdlib). Uses only the workflow's built-in GITHUB_TOKEN."""
from __future__ import annotations

import json
import urllib.request


class GitHubError(Exception):
    pass


class GitHub:
    def __init__(self, repo: str, token: str, api: str = "https://api.github.com", opener=urllib.request.urlopen):
        self.repo, self.token, self.api, self.opener = repo, token, api, opener

    def _req(self, method: str, path: str, data=None):
        req = urllib.request.Request(
            f"{self.api}/repos/{self.repo}{path}", method=method,
            data=json.dumps(data).encode() if data is not None else None,
            headers={"authorization": f"Bearer {self.token}", "accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "issue-triage-bot", "content-type": "application/json"})
        try:
            with self.opener(req, timeout=30) as r:
                return json.loads(r.read().decode() or "null")
        except Exception as e:  # noqa: BLE001
            raise GitHubError(f"{method} {path}: {e}") from e

    def get_issue(self, number: int) -> dict:
        return self._req("GET", f"/issues/{number}")

    def recent_issues(self, limit: int = 300) -> list[dict]:
        out, page = [], 1
        while len(out) < limit:
            batch = self._req("GET", f"/issues?state=all&sort=updated&direction=desc&per_page=100&page={page}")
            if not batch:
                break
            out += [i for i in batch if "pull_request" not in i]
            page += 1
            if len(batch) < 100:
                break
        return out[:limit]

    def comments(self, number: int) -> list[dict]:
        return self._req("GET", f"/issues/{number}/comments?per_page=100") or []

    def add_labels(self, number: int, labels: list[str]):
        return self._req("POST", f"/issues/{number}/labels", {"labels": labels})

    def comment(self, number: int, body: str):
        return self._req("POST", f"/issues/{number}/comments", {"body": body})
