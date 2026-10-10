"""Tiny stdlib HTTP helper. Tests inject a fake with the same signature."""
from __future__ import annotations

import json
import urllib.request
from typing import Any, Optional


class HttpError(Exception):
    pass


def http_json(url: str, data: Optional[dict] = None, headers: Optional[dict] = None, timeout: float = 30) -> Any:
    body = json.dumps(data).encode() if data is not None else None
    h = {"accept": "application/json", "user-agent": "depdoctor/0.1"}
    if body is not None:
        h["content-type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=body, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001 - surface as one error type
        raise HttpError(f"{url}: {e}") from e
