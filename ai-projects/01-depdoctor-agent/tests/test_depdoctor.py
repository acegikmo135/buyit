import io
import json
import unittest
from contextlib import redirect_stdout

from depdoctor import agent, cli, manifests, semver, triage
from depdoctor.registries import NPM, PYPI, Registries


def fake_http(npm_vuln_ranges, npm_versions, pypi=None):
    """npm_vuln_ranges: {pkg: [(severity, range)]}; npm_versions: {pkg: [versions]}."""
    calls = []

    def http(url, data=None, headers=None, timeout=30):
        calls.append(url)
        if url.endswith("/advisories/bulk"):
            (pkg, [ver]), = data.items()
            return {pkg: [{"id": i, "url": f"https://github.com/advisories/GHSA-{i}", "title": f"vuln {i}", "severity": sev, "vulnerable_versions": rng}
                          for i, (sev, rng) in enumerate(npm_vuln_ranges.get(pkg, [])) if semver.satisfies(ver, rng)]}
        if url.startswith(NPM + "/"):
            pkg = url[len(NPM) + 1:]
            return {"versions": {v: ({"deprecated": "old"} if v == "1.0.0" else {}) for v in npm_versions[pkg]}}
        if url.startswith(PYPI):
            return pypi[url]
        raise AssertionError(url)
    http.calls = calls
    return http


class SemverTests(unittest.TestCase):
    def test_compare_and_prerelease(self):
        self.assertLess(semver.cmp("1.2.3", "1.10.0"), 0)
        self.assertLess(semver.cmp("2.0.0-beta.1", "2.0.0"), 0)
        self.assertTrue(semver.is_prerelease("2.0.0rc1"))

    def test_ranges(self):
        self.assertTrue(semver.satisfies("4.17.15", ">=3.7.0 <4.17.19"))
        self.assertFalse(semver.satisfies("4.17.19", ">=3.7.0 <4.17.19"))
        self.assertTrue(semver.satisfies("2.0.5", "<1.0.0 || >=2.0.0 <2.1.0"))
        self.assertTrue(semver.satisfies("9.9.9", "*"))
        self.assertTrue(semver.satisfies("4.17.23", "<=4.17.23"))

    def test_bump_and_lower_bound(self):
        self.assertEqual(semver.bump_kind("1.2.0", "1.2.6"), "patch")
        self.assertEqual(semver.bump_kind("1.2.0", "1.3.0"), "minor")
        self.assertEqual(semver.bump_kind("1.2.0", "2.0.0"), "major")
        self.assertEqual(semver.lower_bound("^4.21.2"), ("4.21.2", False))
        self.assertEqual(semver.lower_bound("4.17.15"), ("4.17.15", True))
        self.assertEqual(semver.lower_bound("1.x"), ("1.0.0", False))
        self.assertEqual(semver.lower_bound("github:foo/bar"), (None, False))
        self.assertEqual(semver.lower_bound("latest"), (None, False))


class ManifestTests(unittest.TestCase):
    def test_package_json_with_lock(self):
        pj = json.dumps({"dependencies": {"a": "^1.0.0"}, "devDependencies": {"b": "2.0.0"}})
        lock = json.dumps({"packages": {"": {}, "node_modules/a": {"version": "1.4.2"}, "node_modules/a/node_modules/x": {"version": "9.0.0"}}})
        deps = {d.name: d for d in manifests.parse_package_json(pj, lock)}
        self.assertEqual((deps["a"].version, deps["a"].exact, deps["a"].dev), ("1.4.2", True, False))
        self.assertEqual((deps["b"].version, deps["b"].exact, deps["b"].dev), ("2.0.0", True, True))

    def test_requirements(self):
        deps = {d.name: d for d in manifests.parse_requirements("Django==3.0\nrequests>=2.31.0  # c\n-r other.txt\nPyYAML[extra]~=6.0\nfoo\n")}
        self.assertEqual((deps["django"].version, deps["django"].exact), ("3.0", True))  # PyPI needs the string as written
        self.assertEqual((deps["requests"].version, deps["requests"].exact), ("2.31.0", False))
        self.assertEqual(deps["pyyaml"].version, "6.0.0")
        self.assertIsNone(deps["foo"].version)


VERSIONS = {"lib": ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "2.0.0", "2.1.0-beta.1"]}


class AgentTests(unittest.TestCase):
    def run_agent(self, vuln_ranges, spec="1.0.0", dev=False, planner=None, versions=VERSIONS):
        http = fake_http(vuln_ranges, versions)
        dep = manifests.Dependency("lib", "npm", spec, spec, True, dev)
        return agent.run([dep], Registries(http), planner)[0], http

    def test_finds_lowest_safe_version_and_verifies(self):
        s, _ = self.run_agent({"lib": [("high", "<1.2.0")]})
        self.assertEqual(s.target, "1.2.0")
        self.assertTrue(s.verified and not s.remaining)
        self.assertEqual([t[0] for t in s.trace], ["check", "find_fix", "verify", "finish"])
        self.assertEqual(s.dep.version, "1.0.0")
        self.assertEqual(s.deprecated, "old")

    def test_widens_search_when_verification_fails(self):
        # Advisory data the candidate search can't see (range string lies about 1.2.0): verify catches it.
        http = fake_http({"lib": [("high", "<1.2.0")]}, VERSIONS)
        reg = Registries(http)
        real = reg.vulns
        reg.vulns = lambda eco, n, v: real(eco, n, v) or ([{"id": "X", "title": "t", "severity": "high", "url": "", "range": "", "fixed_in": []}] if v == "1.2.0" else [])
        dep = manifests.Dependency("lib", "npm", "1.0.0", "1.0.0", True, False)
        s = agent.run([dep], reg)[0]
        self.assertEqual(s.target, "1.3.0")
        self.assertEqual([t[0] for t in s.trace].count("verify"), 2)

    def test_no_fix_available(self):
        s, _ = self.run_agent({"lib": [("high", "*")]})
        self.assertIsNone(s.target)
        f = triage.classify(s)
        self.assertEqual(f.bucket, "no-fix")

    def test_clean_package_has_no_finding(self):
        s, _ = self.run_agent({})
        self.assertIsNone(triage.classify(s))

    def test_unresolvable_spec_is_skipped(self):
        dep = manifests.Dependency("x", "npm", "github:a/b", None, False, False)
        s = agent.run([dep], Registries(fake_http({}, {})))[0]
        self.assertIn("skipped", s.error)
        f = triage.classify(s)
        self.assertEqual((f.bucket, f.installed), ("unknown", "?"))  # visible in the report, not silently dropped

    def test_network_error_is_reported_not_raised(self):
        def boom(*a, **k):
            from depdoctor.http import HttpError
            raise HttpError("down")
        dep = manifests.Dependency("x", "npm", "1.0.0", "1.0.0", True, False)
        s = agent.run([dep], Registries(boom))[0]
        self.assertEqual(triage.classify(s).bucket, "unknown")


class PlannerTests(unittest.TestCase):
    def test_llm_cannot_defer_prod_high_severity(self):
        calls = []
        planner = agent.LLMPlanner(lambda p: calls.append(p) or '{"action": "finish"}')
        http = fake_http({"lib": [("critical", "<1.2.0")]}, VERSIONS)
        dep = manifests.Dependency("lib", "npm", "1.0.0", "1.0.0", True, False)
        s = agent.run([dep], Registries(http), planner)[0]
        self.assertEqual(s.target, "1.2.0")  # guardrail removed 'finish' from the legal set at first
        self.assertTrue(s.verified)

    def test_llm_may_defer_dev_low_severity(self):
        planner = agent.LLMPlanner(lambda p: '{"action": "finish"}')
        http = fake_http({"lib": [("low", "<1.2.0")]}, VERSIONS)
        dep = manifests.Dependency("lib", "npm", "1.0.0", "1.0.0", True, True)
        s = agent.run([dep], Registries(http), planner)[0]
        self.assertTrue(s.deferred)
        self.assertEqual(triage.classify(s).bucket, "no-fix")

    def test_garbage_llm_output_falls_back_to_rules(self):
        planner = agent.LLMPlanner(lambda p: "I think we should rm -rf")
        http = fake_http({"lib": [("high", "<1.2.0")]}, VERSIONS)
        dep = manifests.Dependency("lib", "npm", "1.0.0", "1.0.0", True, True)
        s = agent.run([dep], Registries(http), planner)[0]
        self.assertEqual(s.target, "1.2.0")
        self.assertGreater(planner.llm_fallbacks, 0)

    def test_llm_exception_falls_back(self):
        def boom(p):
            raise RuntimeError("quota")
        planner = agent.LLMPlanner(boom)
        http = fake_http({"lib": [("high", "<1.2.0")]}, VERSIONS)
        dep = manifests.Dependency("lib", "npm", "1.0.0", "1.0.0", True, True)
        self.assertEqual(agent.run([dep], Registries(http), planner)[0].target, "1.2.0")


class TriageTests(unittest.TestCase):
    def bucket(self, sev, dev, bump_to=None):
        http = fake_http({"lib": [(sev, "<1.2.0")]}, VERSIONS)
        dep = manifests.Dependency("lib", "npm", "1.0.0", "1.0.0", True, dev)
        return triage.classify(agent.run([dep], Registries(http))[0])

    def test_buckets(self):
        self.assertEqual(self.bucket("critical", False).bucket, "fix-now")
        self.assertEqual(self.bucket("high", False).bucket, "fix-now")
        self.assertEqual(self.bucket("moderate", False).bucket, "schedule")
        self.assertEqual(self.bucket("high", True).bucket, "schedule")
        self.assertEqual(self.bucket("moderate", True).bucket, "defer")

    def test_range_spec_adds_caveat(self):
        http = fake_http({"lib": [("high", "<1.2.0")]}, VERSIONS)
        dep = manifests.Dependency("lib", "npm", "^1.0.0", "1.0.0", False, False)
        f = triage.classify(agent.run([dep], Registries(http))[0])
        self.assertTrue(any("assumed oldest" in n for n in f.notes))

    def test_pypi_flow_without_severity(self):
        url = f"{PYPI}/dj/3.0.0/json"
        vuln = {"id": "PYSEC-1", "aliases": ["GHSA-aaa"], "fixed_in": ["3.0.12", "3.1.6"], "summary": "bad", "link": "u"}
        dup = {"id": "GHSA-aaa", "aliases": ["PYSEC-1"], "fixed_in": ["3.0.12"], "summary": "bad", "link": "u2"}
        pypi = {
            url: {"vulnerabilities": [vuln, dup]},
            f"{PYPI}/dj/json": {"releases": {"3.0.0": [{}], "3.0.12": [{}], "3.1.0": [{}], "3.1.6": [{}], "3.2.0": [{"yanked": True}]}},
            f"{PYPI}/dj/3.0.12/json": {"vulnerabilities": []},
        }
        reg = Registries(fake_http({}, {}, pypi))
        dep = manifests.Dependency("dj", "pypi", "==3.0", "3.0.0", True, False)
        s = agent.run([dep], reg)[0]
        self.assertEqual(len(s.vulns), 1)  # alias-merged
        self.assertEqual(s.target, "3.0.12")  # lowest release at/after a fixed_in entry, verified clean
        self.assertEqual(triage.classify(s).bucket, "schedule")


class CliTests(unittest.TestCase):
    def run_cli(self, tmp_manifest, *extra, http=None, gen=None):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = cli.main([tmp_manifest, *extra], reg=Registries(http), gen=gen)
        return code, buf.getvalue()

    def setUp(self):
        import tempfile, os
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "package.json")
        with open(self.path, "w") as f:
            json.dump({"dependencies": {"lib": "1.0.0"}}, f)

    def test_fail_on_and_json(self):
        http = fake_http({"lib": [("high", "<1.2.0")]}, VERSIONS)
        code, out = self.run_cli(self.path, "--format", "json", "--fail-on", "fix-now", http=http)
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out)["findings"][0]["target"], "1.2.0")

    def test_missing_manifest_is_a_clear_error(self):
        import contextlib
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = cli.main(["/nonexistent/package.json"], reg=Registries(fake_http({}, {})))
        self.assertEqual(code, 2)
        self.assertIn("cannot read manifest", err.getvalue())

    def test_clean_exit_zero(self):
        code, out = self.run_cli(self.path, "--fail-on", "any", http=fake_http({}, VERSIONS))
        self.assertEqual(code, 0)
        self.assertIn("no known vulnerabilities", out)

    def test_ai_summary_is_labeled(self):
        http = fake_http({"lib": [("high", "<1.2.0")]}, VERSIONS)
        code, out = self.run_cli(self.path, "--llm", "ollama", http=http, gen=lambda p: "Upgrade lib.")
        self.assertIn("AI-written summary", out)

    def test_llm_summary_failure_is_non_fatal(self):
        def gen(p):
            if p.startswith("Summarize"):
                raise RuntimeError("quota")
            return '{"action":"find_fix"}'
        http = fake_http({"lib": [("high", "<1.2.0")]}, VERSIONS)
        code, out = self.run_cli(self.path, "--llm", "gemini", http=http, gen=gen)
        self.assertEqual(code, 0)
        self.assertNotIn("AI-written", out)


if __name__ == "__main__":
    unittest.main()
