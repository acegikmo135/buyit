"""Optional free LLM backends. Never required: every caller has a rule-based fallback.

* gemini  - Google AI Studio free tier. Needs GEMINI_API_KEY (free to create).
* ollama  - local model via http://localhost:11434, no key, fully offline.
"""
from __future__ import annotations

import os
from typing import Callable

from .http import http_json


class LLMError(Exception):
    pass


def generate(prompt: str, provider: str, http: Callable = http_json, model: str | None = None) -> str:
    try:
        if provider == "gemini":
            key = os.environ.get("GEMINI_API_KEY")
            if not key:
                raise LLMError("GEMINI_API_KEY not set")
            model = model or os.environ.get("DEPDOCTOR_GEMINI_MODEL", "gemini-2.5-flash")
            r = http(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                     data={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0.1}},
                     headers={"x-goog-api-key": key})
            return r["candidates"][0]["content"]["parts"][0]["text"].strip()
        if provider == "ollama":
            model = model or os.environ.get("DEPDOCTOR_OLLAMA_MODEL", "llama3.2")
            host = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
            r = http(f"{host}/api/generate", data={"model": model, "prompt": prompt, "stream": False, "options": {"temperature": 0.1}}, timeout=120)
            return r["response"].strip()
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001
        raise LLMError(f"{provider} call failed: {e}") from e
    raise LLMError(f"unknown provider {provider!r}")
