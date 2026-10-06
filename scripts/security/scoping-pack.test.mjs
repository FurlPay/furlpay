// node --test scripts/security/scoping-pack.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sloc } from "./scoping-pack.mjs";

test("blank lines and line comments are not SLOC", () => {
  assert.equal(sloc("// header\n\nconst a = 1; // trailing stays code\n   \n", ".ts"), 1);
});

test("block comments, including multi-line and inline ones, are stripped", () => {
  const src = "/**\n * NatSpec\n */\ncontract A {\n  uint x; /* inline */\n  /* one-line */\n}\n";
  assert.equal(sloc(src, ".sol"), 3);
});

test("code after a closing block comment on the same line still counts", () => {
  assert.equal(sloc("/* start\n end */ let y = 2;\n", ".ts"), 1);
});

test("hash comments count for Python and Terraform, not for TypeScript", () => {
  assert.equal(sloc("# comment\nx = 1\n", ".py"), 1);
  assert.equal(sloc('# comment\nresource "a" "b" {}\n// also a comment\n', ".tf"), 1);
  assert.equal(sloc("#!/usr/bin/env node\nrun();\n", ".ts"), 2);
});
