# Three free AI projects, three real problems

Everything here runs on free, keyless APIs or free tiers. No paid service is required, and every project works with **no AI key at all**; a free LLM is an optional upgrade.

| # | Kind | Problem | Project |
|---|------|---------|---------|
| 1 | **AI agent** | Developers drown in dependency-vulnerability alerts, many of them noise ([InfoQ on Dependabot false positives](https://www.infoq.com/news/2023/09/GitHub-dependabot-auto-triage/), [The Register, Feb 2026](https://www.theregister.com/2026/02/24/github_dependabot_noise_machine/)). | [`01-depdoctor-agent`](01-depdoctor-agent) |
| 2 | **AI-native app** | Most tenants sign leases they haven't read or understood ([Weightmans survey: 24% read it, 39% signed something they didn't understand](https://thenegotiator.co.uk/news/rental-market/shock-most-people-dont-read-tenancy-agreements/); [Citizens Advice](https://www.citizensadvice.org.uk/wales/about-us/about-us1/media/press-releases/rental-roulette-24-million-households-in-england-only-shown-tenancy-agreement-after-putting-down-money-citizens-advice-reveals/)). | [`02-leaselens-ainative`](02-leaselens-ainative) |
| 3 | **AI automation** | Maintainer burnout; issue triage (duplicates, missing repro info) is a constant tax ([Tidelift survey via Sonar: 58% of maintainers quit or considered quitting](https://www.sonarsource.com/blog/maintainer-burnout-is-real/)). | [`03-issue-triage-automation`](03-issue-triage-automation) |

## What each one is (and isn't)

* **Agent**: a loop that decides which tool to call next, observes the result, **verifies its own proposed fix against live advisory data**, widens the search if verification fails, then prioritizes. The planner is rule-based by default; an optional free LLM may steer it inside guardrails.
* **AI-native**: the product is a conversation with a document (flag clauses, ask questions, cited answers). Offline mode uses rules + BM25 retrieval and quotes the lease; with Gemini free tier or local Ollama it answers in plain English from only the retrieved clauses, and answers are checked for valid citations.
* **Automation**: a GitHub Action that triages every new issue with no human trigger, idempotently, and never closes or deletes anything.

## Verification status (honest version)

| Piece | How verified |
|---|---|
| Agent vs npm advisory API + PyPI JSON API | **Live** runs (see `01-.../README.md`) plus 22 offline tests |
| Agent LLM planner (Gemini / Ollama) | Unit-tested with stubs only. **Not run against a real LLM** (no key in the build sandbox) |
| LeaseLens engine, retrieval, LLM prompt/citation logic | 10 Node tests; UI driven in headless Chromium (`tests/ui.smoke.mjs`, 9 checks) incl. XSS check and a stubbed Gemini endpoint |
| LeaseLens with real Gemini/Ollama | **Not run live** (no key); request shape unit-tested |
| Issue triage | 24 tests with a fake GitHub client. **Not run on a live repo/Actions** |
| Classifier accuracy | Small hand-written set (12 examples). Not a benchmark; rules are heuristics |

Known limits: the agent checks **direct** dependencies only; PyPI's feed has no severity; LeaseLens rules are US/UK-style rules of thumb, **not legal advice**.

## Run all tests

```bash
./run_tests.sh
```
