// node --test scripts/security/check-actions-pinned.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mutableRefs } from "./check-actions-pinned.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

test("tags, branches and missing refs are mutable", () => {
  const yaml = ["- uses: actions/checkout@v7", "  uses: org/act@main", "      uses: foo/bar", `- uses: a/b@${SHA.slice(0, 12)}`].join("\n");
  assert.deepEqual(mutableRefs(yaml).map((r) => r.ref), ["actions/checkout@v7", "org/act@main", "foo/bar", `a/b@${SHA.slice(0, 12)}`]);
});

test("a full SHA (with or without a version comment) is pinned", () => {
  assert.deepEqual(mutableRefs(`- uses: actions/checkout@${SHA} # v7\n  uses: "github/codeql-action/upload-sarif@${SHA}"`), []);
});

test("local actions and docker images are not checked", () => {
  assert.deepEqual(mutableRefs("- uses: ./.github/actions/setup\n- uses: docker://alpine:3.20"), []);
});
