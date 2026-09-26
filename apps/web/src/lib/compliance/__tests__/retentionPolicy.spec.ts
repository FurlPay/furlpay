import { describe, expect, it } from "vitest";
import {
  RETENTION_MATRIX,
  UNVERIFIED,
  mayAutoDelete,
  unverifiedRetention,
} from "../retentionPolicy";

// ---------------------------------------------------------------------------
// The retention matrix is a questionnaire that refuses to be answered by guess.
//
// The danger here is not under-documenting. It is a plausible-looking number:
// "5 years" written from memory of the AML directive reads as researched, gets
// copied into a privacy policy, and a sweep job built on it destroys records the
// business was required to keep. Irreversibly.
//
// So these tests enforce the discipline rather than the content.
// ---------------------------------------------------------------------------

describe("nothing is deleted on an unconfirmed period", () => {
  it("refuses auto-deletion wherever legal has not answered", () => {
    // THE LOAD-BEARING TEST. Without it, `UNVERIFIED` is a comment.
    for (const r of RETENTION_MATRIX) {
      if (r.legalBasis === UNVERIFIED || r.retention === UNVERIFIED) {
        const eventTriggered =
          r.deletionTrigger === "immediate_on_use" ||
          r.deletionTrigger === "immediate_on_rejection" ||
          r.deletionTrigger === "session_end";
        if (!eventTriggered) {
          expect(mayAutoDelete(r), `${r.id} would be swept on an unconfirmed period`).toBe(false);
        }
      }
    }
  });

  it("allows event-triggered deletion, which guesses nothing", () => {
    // A package destroyed when it is redeemed, or a token cleared at sign-out,
    // is not on a clock — there is no period to get wrong.
    const pkg = RETENTION_MATRIX.find((r) => r.id === "authority_disclosure_package")!;
    const watch = RETENTION_MATRIX.find((r) => r.id === "watch_session_token")!;
    expect(mayAutoDelete(pkg)).toBe(true);
    expect(mayAutoDelete(watch)).toBe(true);
  });

  it("no row states a retention period in days, months or years", () => {
    // Catches the exact regression this file exists to prevent: someone filling
    // in a number to make the matrix look finished.
    const periodish = /\b\d+\s*(day|days|month|months|year|years|yr|yrs)\b/i;
    for (const r of RETENTION_MATRIX) {
      if (r.retention === UNVERIFIED) continue;
      expect(
        periodish.test(r.retention),
        `${r.id} states a concrete period ("${r.retention}") — has legal actually confirmed it?`
      ).toBe(false);
    }
  });
});

describe("the matrix is complete as a questionnaire", () => {
  it("every row names an owner, a location and who can read it", () => {
    // A data class with no accountable owner is one nobody will ever answer for.
    for (const r of RETENTION_MATRIX) {
      expect(r.owner.length, `${r.id} has no owner`).toBeGreaterThan(2);
      expect(r.storageLocation.length, `${r.id} has no storage location`).toBeGreaterThan(2);
      expect(r.accessRoles.length, `${r.id} lists nobody who can read it`).toBeGreaterThan(0);
      expect(r.purpose.length, `${r.id} has no stated purpose`).toBeGreaterThan(10);
    }
  });

  it("covers every sensitive class the audit identified", () => {
    const ids = RETENTION_MATRIX.map((r) => r.id);
    for (const required of [
      "identity_document",
      "kyc_result",
      "transaction_history",
      "authority_disclosure_package",
      "authority_audit_chain",
      "role_grants",
      "security_events",
      "watch_session_token",
      "support_conversations",
    ]) {
      expect(ids, `missing data class: ${required}`).toContain(required);
    }
  });

  it("ids are unique", () => {
    const ids = RETENTION_MATRIX.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reports the outstanding legal queue rather than hiding it", () => {
    // The point of the file: the unanswered rows are enumerable, so "waiting on
    // legal" is a list someone can work through instead of a vague caveat.
    const pending = unverifiedRetention();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.map((r) => r.id)).toContain("transaction_history");
    // And the two that genuinely are answered are NOT in it.
    expect(pending.map((r) => r.id)).not.toContain("authority_disclosure_package");
    expect(pending.map((r) => r.id)).not.toContain("watch_session_token");
  });

  it("only claims deletionImplemented where deletion actually exists", () => {
    // Both of these are verified by other suites in this repository — the
    // package by revolutAttack.spec.ts, the watch token by the Wear listener's
    // sign-out path. Nothing else may claim it.
    const implemented = RETENTION_MATRIX.filter((r) => r.deletionImplemented).map((r) => r.id);
    expect(implemented.sort()).toEqual(["authority_disclosure_package", "watch_session_token"]);
  });
});
