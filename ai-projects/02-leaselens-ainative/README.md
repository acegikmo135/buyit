# LeaseLens: read your lease before you sign it

**Problem:** most tenants sign without fully reading or understanding the lease, and the traps (auto-renewal, entry without notice, liability waivers, huge deposits) are exactly what people miss.

**Free & private:** a static page, no build, no server, no CDN. Optional AI: Gemini free tier (key from aistudio.google.com) or Ollama on your own machine.

## Use

```bash
python3 -m http.server 8000     # then open http://localhost:8000
```
Paste lease text (or load the samples). You get: overall concern, flagged clauses (quoted, with why and **what to ask the landlord**), **missing protections** (e.g. deposit taken but no return deadline), and an "Ask your lease" box.

## Why "AI-native"

The whole experience is a conversation with a document: retrieval picks the 1-3 relevant clauses, and in AI mode the model answers **only from them**, must cite `[C#]`, and the citations are checked: an answer citing a clause it wasn't shown is marked unverified. Only the question and those clauses are sent to a provider, never the full lease (the UI says exactly which). Offline mode (default) quotes the clauses with no model at all, so it works with no key and no network.

## Honest limits

Rules are common tenant-protection rules of thumb (24h entry notice, ~5% late fees, deposit ≤ 2 months, ...), **not legal advice**, and they vary by place. Pattern-based detection will miss unusual wording and can misfire. Absence of flags ≠ a fair lease. Not run against a live Gemini/Ollama; request shape is unit-tested and the UI test uses a stubbed endpoint.

## Test

```bash
node --test tests/engine.test.js                                   # engine + LLM glue
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/ui.smoke.mjs   # optional, headless Chromium
```
