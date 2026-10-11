# SETUP: install and use all three projects on your laptop

This guide takes you from a clean laptop to all three projects working. Plan on 15 minutes for the basics (Parts 0 to 3 and 5). The optional AI model (Part 4) and the GitHub Action (Part 6) add another 10 to 15 minutes each.

Commands are shown for **macOS / Linux** first, then **Windows (PowerShell)** where they differ.

**Nothing here costs money, and nothing needs an API key.** An AI model (Gemini free tier or Ollama) is an optional upgrade, covered in Part 4.

Steps I could not run myself are marked **(unverified)**: the free-AI and GitHub-Action steps, because the sandbox where I built this had no API keys and no live repository. Everything else in this guide I ran.

---

## Part 0. What you need installed

| Tool | Needed for | Minimum | Check with |
|---|---|---|---|
| Git | getting the code | any | `git --version` |
| Python | projects 1 and 3 | 3.10 | `python3 --version` (Windows: `py --version`) |
| Node.js | project 2 tests only | 18 (20+ recommended) | `node --version` |

The LeaseLens app itself needs **no Node**. It is a static web page, and Python's built-in web server is enough to serve it. Node is only used to run its tests. If you skip the tests you can skip Node.

All three projects have **zero third-party packages**. There is no `pip install` or `npm install` anywhere.

**Install the missing ones:**

* macOS: `brew install git python node` (or download from python.org and nodejs.org).
* Windows: `winget install Git.Git Python.Python.3.12 OpenJS.NodeJS.LTS`, then **open a new terminal** so PATH updates.
* Ubuntu/Debian: `sudo apt install git python3 nodejs`. Check `node --version`: if it is older than 18, install a newer Node from nodejs.org.

> Windows note: use `python` or `py` wherever this guide says `python3`.

---

## Part 1. Get the code

```bash
git clone https://github.com/acegikmo135/buyit.git
cd buyit
git checkout claude/stoic-heisenberg-fitc49
cd ai-projects
ls
```

If the repo is private, Git will ask you to sign in. Use your GitHub username with a [personal access token](https://github.com/settings/tokens) as the password, or run `gh auth login` first if you use the GitHub CLI.

You should see:

```
01-depdoctor-agent/   02-leaselens-ainative/   03-issue-triage-automation/
README.md   SETUP.md   run_tests.sh
```

Everything below is run from inside `buyit/ai-projects`.

---

## Part 2. Verify the install (run all tests)

macOS / Linux / Git Bash / WSL:

```bash
./run_tests.sh
```

Windows PowerShell (no bash needed), run each line:

```powershell
cd 01-depdoctor-agent;           py -m unittest discover -s tests; cd ..
cd 02-leaselens-ainative;        node --test tests/engine.test.js; cd ..
cd 03-issue-triage-automation;   py -m unittest discover -s tests; cd ..
```

Expected result: three green blocks (`OK` / `# pass 10 # fail 0` / `OK`). If you see that, everything is installed correctly. **No internet is needed for the tests**; they use fake network responses.

If `./run_tests.sh` says "permission denied": `chmod +x run_tests.sh`.

---

## Part 3. Use each project

### Project 1. DepDoctor (agent that triages dependency vulnerabilities)

**What it does:** reads your `package.json` or `requirements.txt`, asks the free npm/PyPI advisory APIs which packages have known vulnerabilities, finds the lowest version that fixes them, **checks that fix against live data**, and tells you what to fix first.

**Try the bundled example (needs internet):**

```bash
cd 01-depdoctor-agent
python3 -m depdoctor examples/package.json -v
python3 -m depdoctor examples/requirements.txt
```

You should see a report with "Fix now" entries such as `lodash` and `minimist`. The exact versions come from live data and change over time. `-v` prints each agent step (check, find_fix, verify) as it happens.

**Run it on your own project:**

```bash
# from inside 01-depdoctor-agent
python3 -m depdoctor /path/to/your/package.json --lock /path/to/your/package-lock.json
python3 -m depdoctor /path/to/your/requirements.txt
```

* **Always pass `--lock`** for npm projects when you have a lockfile. Without it, `^1.2.0` is treated as "oldest allowed version 1.2.0", which can show vulnerabilities you may not actually have. The report warns you when this happens.
* The tool picks the format from the filename: a file named `package.json` is read as npm, anything else is read as a pip `requirements.txt`.
* `--no-dev` skips devDependencies.
* `--format json` gives machine-readable output.
* `--fail-on fix-now` makes the command exit with code 1 when there are urgent findings, which is useful in CI.

**Run it from any folder (so you don't `cd` into the project each time):**

macOS / Linux, add to `~/.zshrc` or `~/.bashrc`:

```bash
alias depdoctor='PYTHONPATH=$HOME/buyit/ai-projects/01-depdoctor-agent python3 -m depdoctor'
```

Adjust the path to wherever you cloned. Then run `depdoctor package.json --lock package-lock.json` from anywhere.

Windows PowerShell, run once per session or add to your `$PROFILE`:

```powershell
$env:PYTHONPATH = "$HOME\buyit\ai-projects\01-depdoctor-agent"
py -m depdoctor package.json
```

**Reading the report:**

| Bucket | Meaning |
|---|---|
| Fix now | high or critical severity in a *production* dependency, with a verified fix |
| Schedule | production with moderate severity, or high severity in a dev-only tool |
| Safe to defer | dev-only, moderate or low |
| No fix published | no version clears the advisory; consider replacing the package |

**Known limits:** direct dependencies only (not the whole transitive tree), PyPI results show severity as "unknown", and it can't tell whether your code actually calls the vulnerable function.

---

### Project 2. LeaseLens (read a rental lease before you sign it)

**What it does:** you paste a lease; it flags risky clauses (with a suggested thing to ask your landlord), lists protections that are missing, and lets you ask questions answered from the lease text.

**Start it:**

```bash
cd 02-leaselens-ainative
python3 -m http.server 8000
```

Open **http://localhost:8000** in your browser. Leave the terminal running; stop it with Ctrl+C.

> Why a server and not double-clicking `index.html`? The "Sample" buttons load files, and browsers block that from `file://`. Pasting your own lease works either way.

**First 2 minutes:**

1. Click **Sample: risky lease**. You get an overall "high" concern rating and a list of flagged clauses.
2. Click **Sample: fair lease**. You get a "low" concern and no high-severity flags.
3. In "Ask your lease" type `Can I have a dog?` and press Enter. It quotes the pets clause.
4. Click **Download report (.md)** to save the findings.

**Use it on your own lease:**

* Open your lease PDF, select all (Ctrl/Cmd+A), copy, paste into the box, then press **Analyze**.
* A scanned PDF (a photo of paper) has no copyable text. Run it through OCR first (Google Drive, Adobe, or your phone's scanner app) and then copy the text.
* Your text stays in your browser. In the default Offline mode **nothing is sent anywhere**. (Optional AI mode is in Part 4.)

**Important:** LeaseLens is a rule-based reader, not a lawyer. Its thresholds (24-hour entry notice, deposits of 1 to 2 months, and so on) are common rules of thumb. Local law varies, and a lease with no flags is not automatically fair. For anything high-stakes, ask a local tenant union or legal aid.

---

### Issue triage (project 3)

**What it does:** whenever someone opens an issue on a GitHub repository, it labels it (bug / enhancement / question / documentation), spots likely duplicates, asks for missing bug details, and redirects security reports to private reporting. It **never closes or deletes anything.**

It has two modes: a **local dry run** to try it safely, then installing the **GitHub Action** (Part 6).

#### Step A. Try it locally in dry-run mode (nothing is posted)

You need a GitHub token that can **read** issues on a repo you want to test with.

1. Go to https://github.com/settings/personal-access-tokens/new (fine-grained token).
2. Pick **only the one repository** you want to test with. Under *Repository permissions* set **Issues: Read-only**. Generate and copy the token. (Button labels may differ slightly over time.)
3. In your terminal:

macOS / Linux:

```bash
cd 03-issue-triage-automation
export GITHUB_REPOSITORY="your-username/your-repo"
export GITHUB_TOKEN="paste-token-here"
python3 -m triage.run --issue 1 --dry-run
```

Windows PowerShell:

```powershell
cd 03-issue-triage-automation
$env:GITHUB_REPOSITORY = "your-username/your-repo"
$env:GITHUB_TOKEN = "paste-token-here"
py -m triage.run --issue 1 --dry-run
```

Replace `1` with a real issue number in that repo. It prints a JSON plan: the labels it *would* add and the comment it *would* post. With `--dry-run` it makes **no changes**.

If you use the GitHub CLI, `export GITHUB_TOKEN=$(gh auth token)` works too.

**Troubleshooting:** "Set GITHUB_REPOSITORY and GITHUB_TOKEN" means the variables aren't set in *this* terminal window. A 404 or 403 error means the token can't see that repository or lacks the Issues permission, so recheck step 2. This step is **(unverified)** against a live repo.

Do a handful of dry runs on real issues and read the plans before you enable the Action in Part 6.

---

## Part 4. Optional: turn on a free AI model

Everything works without this. A model adds plain-English answers (LeaseLens), smarter agent steering and a summary (DepDoctor), and a tie-breaker for unclear issues (IssueTriage).

You have two free options. **These steps are (unverified)**, because they need an API key or local model that I did not have when building this.

### Option A. Gemini free tier (cloud, easiest)

1. Go to https://aistudio.google.com/apikey, sign in with a Google account, and create an API key. The free tier has rate limits, and Google's terms for free-tier data use apply, so read them before sending anything sensitive.
2. **Never commit the key** to Git or paste it into a screenshot.

Use it:

* **LeaseLens:** in the page, open "AI settings", choose *Gemini free tier*, paste the key. Tick "Remember on this device" only on a computer you own. When you press Ask, **only your question and the 1 to 3 most relevant clauses are sent to Google**, never the whole lease. The page states this.
* **DepDoctor:**

  ```bash
  export GEMINI_API_KEY="paste-key"
  python3 -m depdoctor package.json --llm gemini
  ```

  PowerShell: `$env:GEMINI_API_KEY = "paste-key"`. The report gets a clearly labelled "AI-written summary", and the agent's planner can be steered by the model within its guardrails.
* **IssueTriage:** add it as a repository secret (Part 6).

If a call fails with "model not found", Google has probably renamed the model. Set `DEPDOCTOR_GEMINI_MODEL` (DepDoctor) or `TRIAGE_GEMINI_MODEL` (IssueTriage) to a current model name from the AI Studio docs. For LeaseLens, edit the default model string in `02-leaselens-ainative/llm.js`.

### Option B. Ollama (runs on your laptop, fully private, no account)

1. Install from https://ollama.com and pull a small model:

   ```bash
   ollama pull llama3.2
   ```

   Models are a few GB. A laptop with 8 GB or more RAM is comfortable for small models.
2. **DepDoctor** works immediately: `python3 -m depdoctor package.json --llm ollama` (change the model with `DEPDOCTOR_OLLAMA_MODEL`).
3. **LeaseLens** runs in the browser, so Ollama must allow that page's address (CORS). Stop Ollama, then start it with:

   macOS / Linux:

   ```bash
   OLLAMA_ORIGINS="http://localhost:8000" ollama serve
   ```

   Windows: set a user environment variable `OLLAMA_ORIGINS` to `http://localhost:8000`, then quit and restart Ollama. (For the macOS desktop app, set it with `launchctl setenv OLLAMA_ORIGINS "http://localhost:8000"` and restart the app.)

   Then in LeaseLens choose *Ollama on this computer*.

If the AI call fails for any reason, LeaseLens shows the relevant clauses instead and DepDoctor falls back to its built-in rules, so you are never left without an answer.

---

## Part 5. Daily cheat sheet

```bash
# DepDoctor: scan a project
python3 -m depdoctor package.json --lock package-lock.json
python3 -m depdoctor requirements.txt --fail-on fix-now        # exit 1 if urgent

# LeaseLens: start the app
cd 02-leaselens-ainative && python3 -m http.server 8000        # http://localhost:8000

# Issue triage: safe preview on one issue
python3 -m triage.run --issue 42 --dry-run

# Everything: run all tests
./run_tests.sh
```

---

## Part 6. Install the issue-triage GitHub Action on a repository

Do this only after you are happy with the dry-run output. It runs for free on GitHub Actions for public repositories. Private repos use your plan's included minutes.

This part is **(unverified)**: the workflow file's YAML is valid, but I have not run it on a live repository.

1. In the repository you want to protect (a different repo from this one), copy in:
   * the whole `triage/` folder, into the **repo root**;
   * `examples/issue-triage.yml`, into `.github/workflows/issue-triage.yml`.

   ```bash
   cd /path/to/your-target-repo
   cp -r /path/to/buyit/ai-projects/03-issue-triage-automation/triage ./triage
   mkdir -p .github/workflows
   cp /path/to/buyit/ai-projects/03-issue-triage-automation/examples/issue-triage.yml .github/workflows/
   git add triage .github && git commit -m "Add issue triage automation" && git push
   ```

2. *(Optional)* In the repo go to **Settings → Secrets and variables → Actions → New repository secret**, name it `GEMINI_API_KEY`, and paste your key.
3. Make sure Actions are enabled (**Settings → Actions → General**).
4. **Test it manually first:** go to the **Actions** tab, choose *issue-triage*, click **Run workflow**, enter an existing issue number. Then open a new test issue and watch the run.
5. Check the issue: you should see labels and, where relevant, a comment starting with the hidden marker. Re-running on the same issue does nothing the second time. That is intended (it's idempotent).

**Turning it off:** delete or disable the workflow file. Labels it added stay; remove them by hand if you wish.

**Safety recap:** it never closes issues, never edits your issue text, skips pull requests and bots, and never overrides a label a maintainer already set.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `python3: command not found` (Windows) | Use `py` or `python` instead. Reopen the terminal after installing. |
| `SSL: CERTIFICATE_VERIFY_FAILED` on macOS | Run `/Applications/Python\ 3.x/Install\ Certificates.command` (python.org installs), or use Homebrew Python. |
| DepDoctor says it "could not check" a package | You are offline, behind a proxy, or the registry rate-limited you. Retry. In a corporate network set `HTTPS_PROXY`. |
| `depdoctor: cannot read manifest` | The path to your `package.json` / `requirements.txt` is wrong. |
| A package shows as "skipped (unpinned/URL spec)" | Git URLs, `latest`, and workspace specs have no resolvable version. Pass `--lock`, or pin it. |
| LeaseLens Sample buttons say "need http" | You opened the file directly. Run `python3 -m http.server 8000` and use `http://localhost:8000`. |
| LeaseLens: "Port 8000 already in use" | `python3 -m http.server 8080` and open `http://localhost:8080` (then use that port in `OLLAMA_ORIGINS` too). |
| LeaseLens Ollama says "unavailable" | CORS: restart Ollama with `OLLAMA_ORIGINS` set as in Part 4, and confirm `ollama serve` is running. |
| `node --test` errors on old Node | Upgrade to Node 18 or newer. |
| `./run_tests.sh` doesn't work on Windows | Use the PowerShell commands in Part 2. |
| Issue-triage: HTTP 403 / 404 | Token lacks Issues access on that repo, or the repo name is misspelled (`owner/name`). |

---

## Keeping keys and data safe

* API keys and tokens go in **environment variables or GitHub secrets**, never in files you commit.
* LeaseLens in Offline mode sends nothing anywhere. In AI mode only your question plus the few retrieved clauses are sent; the page tells you which.
* DepDoctor sends only package **names and versions** to npm and PyPI (the same as `npm install`).
* IssueTriage uses the workflow's built-in `GITHUB_TOKEN` in Actions, scoped to that repository.

## Where to read more

* `README.md` in this folder: the problems, sources, and an honest table of what was and wasn't verified.
* Each project's own `README.md`: how it works, limits, and tests.
