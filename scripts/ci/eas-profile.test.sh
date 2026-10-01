#!/usr/bin/env bash
# T-C2: bash scripts/ci/eas-profile.test.sh
set -u
here="$(cd "$(dirname "$0")" && pwd)"
fail=0
expect() {
  local got; got="$(bash "$here/eas-profile.sh" "$1" 2>/dev/null)"; local code=$?
  if [ "$got" != "$2" ] || [ "$code" != "$3" ]; then echo "FAIL $1 -> '$got' (exit $code), want '$2' (exit $3)"; fail=1; else echo "ok   $1 -> '$got'"; fi
}
expect prod production 0
expect staging staging 0
expect dev development 0
expect "" "" 64
expect production "" 64
# The bug this replaced, reproduced so the test explains itself:
old="$(e=prod; [ "$e" = "prod" ] && echo production || [ "$e" = "staging" ] && echo staging || echo development)"
[ "$old" = "$(printf 'production\nstaging')" ] && echo "note the old inline chain gave: $(echo $old)"
exit $fail
