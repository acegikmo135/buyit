import json
import os
import tempfile
import unittest

from triage import classify as C
from triage import duplicates, run
from triage.llm import gemini_classify
from triage.text import TfIdf

BUG_FULL = """## Steps to reproduce
1. Run `app serve --port 80`
## Expected
Server starts
## Actual
Crashes with TypeError: Cannot read properties of undefined (reading 'port')
Version 2.3.1 on Ubuntu 22.04, Node 20
```
TypeError: Cannot read properties of undefined
    at start (server.js:41:12)
```"""

# (title, body, expected label): hand-written, realistic issue shapes
LABELED = [
    ("App crashes on startup with TypeError", "After upgrading, running serve throws TypeError: x is undefined. Traceback attached.", "bug"),
    ("[Bug] Login fails when password contains &", "Steps to reproduce: sign in with a& as password. Error 500.", "bug"),
    ("Build broken on Windows", "npm install fails with ENOENT, it doesn't build anymore since 2.0", "bug"),
    ("Regression: export no longer works", "Worked in 1.9, now throws an exception when exporting CSV.", "bug"),
    ("Feature request: dark mode", "It would be nice to have a dark theme. Please add support for prefers-color-scheme.", "enhancement"),
    ("Add support for YAML config", "I'd like to be able to configure the tool with YAML instead of JSON. Proposal below.", "enhancement"),
    ("Enhancement: allow custom headers", "Ability to set custom headers per request would be great.", "enhancement"),
    ("How do I configure a proxy?", "I can't figure out how to use this behind a corporate proxy. Is it possible?", "question"),
    ("Question: difference between sync and async API", "What is the difference between the two? Not sure how to choose.", "question"),
    ("Is it possible to run this in Docker?", "Can I run it in a container?", "question"),
    ("Typo in README", "The install section has a typo: 'instal'. Docs wrong.", "documentation"),
    ("Docs outdated: broken link in tutorial", "The tutorial link is a broken link and the example is outdated.", "documentation"),
]


class ClassifierTests(unittest.TestCase):
    def test_labeled_examples(self):
        wrong = [(t, C.classify(t, b).label, exp) for t, b, exp in LABELED if C.classify(t, b).label != exp]
        # small hand-made set: we require >= 11/12, and print misses so regressions are visible
        self.assertLessEqual(len(wrong), 1, wrong)

    def test_missing_info_detection(self):
        self.assertEqual(C.missing_bug_info(BUG_FULL), [])
        miss = C.missing_bug_info("it crashes sometimes")
        self.assertIn("Steps to reproduce", miss)
        self.assertIn("Version (of this project)", miss)

    def test_security_flag(self):
        self.assertTrue(C.classify("XSS in comment box", "stored xss lets attackers run script").security)
        self.assertTrue(C.classify("RCE via config", "remote code execution if you load a crafted file").security)
        self.assertFalse(C.classify("Button color", "Make the button blue").security)

    def test_low_effort_and_empty(self):
        self.assertTrue(C.classify("help", "").low_effort)
        r = C.classify("hello", "")
        self.assertIsNone(r.label)

    def test_template_checkbox_wins(self):
        r = C.classify("Something", "- [x] Bug report\n- [ ] Feature request")
        self.assertEqual(r.label, "bug")


EXISTING = [
    {"number": 10, "title": "Crash on startup: TypeError cannot read properties of undefined", "state": "open", "body": "app serve crashes with TypeError Cannot read properties of undefined reading port", "html_url": "u/10"},
    {"number": 11, "title": "Add dark mode", "state": "closed", "body": "support prefers-color-scheme dark theme", "html_url": "u/11"},
    {"number": 12, "title": "Docs: explain proxy configuration", "state": "open", "body": "how to use behind a corporate proxy", "html_url": "u/12"},
    {"number": 13, "title": "Pull request thing", "state": "open", "body": "x", "pull_request": {}},
]


class DuplicateTests(unittest.TestCase):
    def test_finds_true_duplicate_not_unrelated(self):
        issue = {"number": 99, "title": "Server crashes: TypeError Cannot read properties of undefined (reading 'port')", "body": "Running app serve throws TypeError reading port of undefined"}
        m = duplicates.find(issue, EXISTING)
        self.assertEqual(m[0].number, 10)
        self.assertGreaterEqual(m[0].score, duplicates.LIKELY)
        self.assertNotIn(11, [x.number for x in m])

    def test_unrelated_issue_has_no_match(self):
        self.assertEqual(duplicates.find({"number": 99, "title": "Memory leak in worker pool", "body": "heap grows over hours"}, EXISTING), [])

    def test_ignores_self_and_pull_requests(self):
        issue = dict(EXISTING[0])
        self.assertEqual([m.number for m in duplicates.find(issue, EXISTING)], [])
        self.assertEqual(duplicates.find({"number": 99, "title": "Pull request thing", "body": "x"}, EXISTING), [])

    def test_tfidf_empty_corpus_safe(self):
        self.assertEqual(TfIdf([]).similar("anything"), [])


class FakeGH:
    def __init__(self, issue, others=(), comments=()):
        self.issue, self.others, self._comments = issue, list(others), list(comments)
        self.labeled, self.posted = [], []

    def get_issue(self, n): return self.issue
    def recent_issues(self, limit=300): return self.others
    def comments(self, n): return self._comments
    def add_labels(self, n, labels): self.labeled.append((n, labels))
    def comment(self, n, body): self.posted.append((n, body))


def issue(title, body, labels=(), user_type="User", number=99):
    return {"number": number, "title": title, "body": body, "labels": [{"name": l} for l in labels], "user": {"type": user_type}}


class DecideTests(unittest.TestCase):
    def test_vague_bug_gets_needs_info_checklist(self):
        gh = FakeGH(issue("App crashes", "it crashes when I click save"))
        plan = run.triage_issue(gh, 99)
        self.assertIn("bug", plan["labels"])
        self.assertIn("needs-info", plan["labels"])
        self.assertEqual(gh.labeled[0][0], 99)
        self.assertIn(run.MARKER, gh.posted[0][1])
        self.assertIn("- [ ] Steps to reproduce", gh.posted[0][1])

    def test_complete_bug_gets_label_only(self):
        gh = FakeGH(issue("Server crashes on start", BUG_FULL))
        plan = run.triage_issue(gh, 99)
        self.assertEqual(plan["labels"], ["bug"])
        self.assertEqual(gh.posted, [])

    def test_duplicate_comment_links_and_never_closes(self):
        gh = FakeGH(issue("Server crashes: TypeError Cannot read properties of undefined (reading 'port')", BUG_FULL), EXISTING)
        plan = run.triage_issue(gh, 99)
        self.assertIn("possible-duplicate", plan["labels"])
        self.assertIn("#10", plan["comment"])
        self.assertIn("not closed automatically", plan["comment"])

    def test_security_report_redirects_privately(self):
        plan = run.triage_issue(FakeGH(issue("Auth bypass vulnerability", "I found an authentication bypass in /admin, exploit below")), 99)
        self.assertIn("security", plan["labels"])
        self.assertIn("Report a vulnerability", plan["comment"])

    def test_idempotent(self):
        gh = FakeGH(issue("App crashes", "it crashes"), comments=[{"body": run.MARKER + " earlier"}])
        self.assertEqual(run.triage_issue(gh, 99), {"skipped": "already triaged"})
        self.assertEqual((gh.labeled, gh.posted), ([], []))

    def test_skips_bots_and_prs(self):
        self.assertIn("skipped", run.triage_issue(FakeGH(issue("x", "y", user_type="Bot")), 99))
        pr = issue("x", "y"); pr["pull_request"] = {}
        self.assertIn("skipped", run.triage_issue(FakeGH(pr), 99))

    def test_respects_maintainer_labels(self):
        gh = FakeGH(issue("Add dark mode please", "it would be nice", labels=["question"]))
        plan = run.triage_issue(gh, 99)
        self.assertNotIn("enhancement", plan["labels"])

    def test_dry_run_changes_nothing(self):
        gh = FakeGH(issue("App crashes", "it crashes"))
        plan = run.triage_issue(gh, 99, dry_run=True)
        self.assertTrue(plan["labels"])
        self.assertEqual((gh.labeled, gh.posted), ([], []))

    def test_titles_of_other_issues_cannot_ping_users(self):
        others = [{"number": 5, "title": "ping @octocat [click](http://evil)\nnewline", "state": "open", "body": "Server crashes TypeError reading port undefined", "html_url": ""}]
        plan = run.decide(issue("Server crashes TypeError reading port undefined", "TypeError reading port undefined"), others)
        self.assertNotIn("@octocat", plan["comment"])
        self.assertNotIn("http://evil", plan["comment"])
        self.assertNotRegex(plan["comment"], r"(?<!\\)\]\(")  # no unescaped markdown link

    def test_llm_only_consulted_when_rules_unsure(self):
        calls = []
        llm = lambda t, b: calls.append(t) or "question"
        run.decide(issue("Server crashes with TypeError", BUG_FULL), [], llm)
        self.assertEqual(calls, [])
        plan = run.decide(issue("hmm", "something about the tool, not sure what to say about it really"), [], llm)
        self.assertEqual(plan["classification"], {"label": "question", "confidence": 0.0, "llm": True})

    def test_llm_not_used_for_security_reports(self):
        calls = []
        run.decide(issue("XSS", "stored xss vulnerability"), [], lambda t, b: calls.append(1))
        self.assertEqual(calls, [])


class EventTests(unittest.TestCase):
    def write(self, obj):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump(obj, f); f.close()
        self.addCleanup(os.unlink, f.name)
        return f.name

    def test_event_parsing(self):
        self.assertEqual(run.issue_number_from_event(self.write({"action": "opened", "issue": {"number": 7}})), 7)
        self.assertIsNone(run.issue_number_from_event(self.write({"action": "closed", "issue": {"number": 7}})))
        self.assertEqual(run.issue_number_from_event(self.write({"inputs": {"issue": "12"}})), 12)

    def test_main_dry_run_uses_injected_client(self):
        gh = FakeGH(issue("App crashes", "it crashes"))
        self.assertEqual(run.main(["--issue", "99", "--dry-run"], gh=gh), 0)
        self.assertEqual(gh.posted, [])


class MainEnvTests(unittest.TestCase):
    def test_missing_env_is_a_clear_error_not_a_traceback(self):
        saved = {k: os.environ.pop(k, None) for k in ("GITHUB_REPOSITORY", "GITHUB_TOKEN")}
        self.addCleanup(lambda: [os.environ.__setitem__(k, v) for k, v in saved.items() if v])
        self.assertEqual(run.main(["--issue", "5", "--dry-run"]), 2)


class LLMTests(unittest.TestCase):
    class Resp:
        def __init__(self, text): self.t = text
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps({"candidates": [{"content": {"parts": [{"text": self.t}]}}]}).encode()

    def test_requires_key_and_validates_label(self):
        os.environ.pop("GEMINI_API_KEY", None)
        self.assertIsNone(gemini_classify("t", "b", opener=lambda *a, **k: self.fail("no key => no network")))
        os.environ["GEMINI_API_KEY"] = "k"
        self.addCleanup(os.environ.pop, "GEMINI_API_KEY")
        seen = {}
        def op(req, timeout):
            seen["h"] = dict(req.header_items()); seen["url"] = req.full_url
            return self.Resp('{"label": "bug"}')
        self.assertEqual(gemini_classify("t", "b", opener=op), "bug")
        self.assertNotIn("key=", seen["url"])
        self.assertIsNone(gemini_classify("t", "b", opener=lambda *a, **k: self.Resp('{"label": "delete-everything"}')))
        self.assertIsNone(gemini_classify("t", "b", opener=lambda *a, **k: self.Resp("not json")))


class GitHubClientTests(unittest.TestCase):
    def test_pagination_auth_and_pr_filtering(self):
        from triage.github import GitHub, GitHubError
        calls = []

        class R:
            def __init__(self, obj): self.o = obj
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self): return json.dumps(self.o).encode()

        pages = {1: [{"number": i} for i in range(100)] + [], 2: [{"number": 100}, {"number": 101, "pull_request": {"url": "x"}}]}

        def opener(req, timeout):
            calls.append((req.get_method(), req.full_url, req.get_header("Authorization")))
            if "/issues?" in req.full_url:
                return R(pages[int(req.full_url.rsplit("page=", 1)[1])])
            return R({"ok": True})

        gh = GitHub("o/r", "tok", opener=opener)
        issues = gh.recent_issues()
        self.assertEqual(len(issues), 101)  # PR dropped
        self.assertTrue(all(c[2] == "Bearer tok" for c in calls))
        self.assertTrue(calls[0][1].startswith("https://api.github.com/repos/o/r/issues?"))
        gh.add_labels(5, ["bug"])
        self.assertEqual(calls[-1][:2], ("POST", "https://api.github.com/repos/o/r/issues/5/labels"))

        def boom(req, timeout): raise OSError("403")
        with self.assertRaises(GitHubError):
            GitHub("o/r", "t", opener=boom).get_issue(1)


if __name__ == "__main__":
    unittest.main()
