#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
echo "== 01 depdoctor";  (cd "$here/01-depdoctor-agent" && python3 -m unittest discover -s tests)
echo "== 02 leaselens";  (cd "$here/02-leaselens-ainative" && node --test tests/engine.test.js)
echo "== 03 issue triage"; (cd "$here/03-issue-triage-automation" && python3 -m unittest discover -s tests)
echo "All passed. (Browser test for 02 is optional: see its README.)"
