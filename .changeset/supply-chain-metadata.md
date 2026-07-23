---
"@furlpay/cli": patch
"@furlpay/account-kit": patch
"@furlpay/elements": patch
"@furlpay/ui": patch
---

Add repository, homepage, bugs and publishConfig.provenance metadata.

These four packages declared `"license": "MIT"` while shipping no `repository`
field, which breaks publisher verification on every registry that performs it —
a verifier has no repo to check ownership against, so the check cannot pass
regardless of what the publisher runs.

This changeset exists to force a republish. The metadata lives in the repository
already, but registries read the PUBLISHED tarball: npm currently serves
@furlpay/cli 0.2.2 with no repository, homepage, bugs, publishConfig or
provenance attestation. Until a new version is published, the fix is invisible
to anything that scans npm.

`publishConfig.provenance: true` makes the Sigstore attestation the default for
these packages rather than depending on a flag at the call site. The release
workflow already sets `NPM_CONFIG_PROVENANCE`, so this is belt-and-braces for
the case where one of them is published by hand.
