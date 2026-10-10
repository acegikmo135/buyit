# DepDoctor: a dependency-vulnerability triage agent

**Problem:** alert fatigue. Scanners list everything; developers need *what to fix first, to which version, and whether that fix really works*.

**Free APIs used (no keys):** npm registry + npm bulk advisory endpoint, PyPI JSON API. Optional: Gemini free tier or local Ollama. Python 3.10+, standard library only.

## Use

```bash
python3 -m depdoctor examples/package.json -v          # add --lock package-lock.json for exact versions
python3 -m depdoctor examples/requirements.txt
python3 -m depdoctor package.json --no-dev --fail-on fix-now   # CI gate: exit 1 on fix-now findings
GEMINI_API_KEY=... python3 -m depdoctor package.json --llm gemini   # or --llm ollama
```

## How the agent works

Per dependency: `check` (live advisories) → `find_fix` (lowest published version that clears **all** advisories) → `verify` (re-query advisories for that version; if still vulnerable, search above it, up to 3 attempts) → `finish`.
`legal_actions()` defines what the planner may do in each state. `LLMPlanner` can pick among those, and garbage or illegal output falls back to the rules. **Guardrail:** the planner can never abandon an unfinished fix on a production dependency with high/critical advisories.

Findings are bucketed **fix-now / schedule / defer / no-fix**, using prod vs dev, severity, and whether a verified fix exists. Range specs (`^1.2.0`) are flagged because only the oldest allowed version is known without a lockfile.

## Real output (live, 2026-10-10)

```
minimist 1.2.0 [npm, prod, critical]: upgrade to 1.2.6 (patch)   -> verified clean
lodash   4.17.15 [npm, prod, high]:   upgrade to 4.18.0 (minor)   -> verified clean
django   3.0 [pypi]: 28 advisories -> 5.2.17 (major, verified)
```

## Limits

Direct dependencies only (no transitive tree). PyPI advisories carry no severity, so they land in "schedule". Doesn't know whether your code calls the vulnerable function. The LLM planner path is tested with stubs, not a live model.

## Test

```bash
python3 -m unittest discover -s tests
```
