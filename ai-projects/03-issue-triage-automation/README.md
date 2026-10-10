# IssueTriage: free first-pass triage for every new GitHub issue

**Problem:** maintainers spend their time on duplicates, vague bug reports and misfiled questions.

**What it does when an issue is opened** (GitHub Actions, free for public repos, built-in `GITHUB_TOKEN`, Python stdlib only):

* **Labels** it `bug` / `enhancement` / `question` / `documentation` using explainable rules (title prefixes, template checkboxes, keyword signals). If the rules are unsure *and* `GEMINI_API_KEY` is set (free tier), the LLM breaks the tie; its answer must be one of the fixed labels.
* **Bug missing info?** adds `needs-info` and a checklist (steps, expected/actual, version, environment, logs).
* **Duplicates:** TF-IDF similarity against the latest 300 issues; comments links, labels `possible-duplicate` for strong matches. **Never auto-closes.**
* **Security-looking reports:** labels `security` and asks the reporter to use private vulnerability reporting instead of posting exploit details (the LLM is never shown these).

Safety: idempotent (hidden marker comment), skips PRs and bots, never overrides labels a maintainer already set, `--dry-run`, titles of other issues are sanitized (no @mentions or links) before being quoted, and issue text is treated as untrusted in the LLM prompt.

## Install

1. Copy the `triage/` folder to your repo root and `examples/issue-triage.yml` to `.github/workflows/`.
2. (Optional) add the `GEMINI_API_KEY` secret.
3. Try it: `python -m triage.run --issue 123 --dry-run` with `GITHUB_REPOSITORY` and `GITHUB_TOKEN` set, or run the workflow manually with an issue number.

## Honest limits

Heuristic classifier checked on a small hand-written set (12 examples), not a benchmark. Similarity is lexical (no embeddings), so paraphrased duplicates can be missed. **Not yet run on a live repository**: the GitHub client is tested against a fake. Look at the first few dry runs before enabling it.

## Test

```bash
python3 -m unittest discover -s tests
```
