#!/usr/bin/env bash
# Map a deploy environment to its EAS build profile (audit P1-6).
#
#   scripts/ci/eas-profile.sh <prod|staging|dev>   -> prints the profile
#
# This replaced an inline `A && x || B && y || z` chain in mobile-release.yml.
# Shell && and || have EQUAL precedence and associate left, so for "prod" it
# printed BOTH "production" and "staging", `eas build --profile` received a
# two-line profile name, and no production build could ever come out of CI.
# An unknown environment is an error, not a silent development build.
set -euo pipefail
case "${1:-}" in
  prod)    echo production ;;
  staging) echo staging ;;
  dev)     echo development ;;
  *)       echo "eas-profile: unknown environment '${1:-}' (want prod|staging|dev)" >&2; exit 64 ;;
esac
