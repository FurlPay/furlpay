import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMobileClient } from "@/lib/clientKind";

// ---------------------------------------------------------------------------
// The `X-Furlpay-Client: mobile-*` contract, pinned across all four codebases.
//
// WHY THIS IS A TEST AND NOT A COMMENT. Native clients have no cookie jar, so
// the auth routes return the session JWT in the response BODY only when this
// header starts with "mobile" (lib/clientKind.ts). Browsers get an HttpOnly
// cookie and nothing else, which is correct — a bearer token reachable from
// page JS is a bearer token reachable from XSS.
//
// The failure mode when a client gets its own header wrong is silent and total:
//
//   POST /api/auth/otp/check  ->  200 OK, body has no `token` field
//   client decodes a non-optional `token`  ->  decode error
//   user cannot sign in. At all. Ever.
//
// Nothing fails to compile, no route errors, no log line says why. The iOS
// client shipped with `ios-guardian/1.0.0` for exactly this reason: it reads
// like a version string, and nothing anywhere enforced the prefix. So the
// prefix is enforced here, against the real source files, for every client.
//
// If you are renaming a client header, this test is the thing telling you that
// the string is load-bearing.
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/web/src/lib/__tests__
const REPO = join(HERE, "..", "..", "..", "..", "..");

interface Client {
  name: string;
  file: string;
  /** Captures the header literal actually assigned in that file. */
  pattern: RegExp;
}

const CLIENTS: Client[] = [
  {
    name: "React Native (native-app)",
    file: join(REPO, "native-app", "lib", "api.ts"),
    pattern: /const CLIENT_HEADER\s*=\s*"([^"]+)"/,
  },
  {
    name: "Android Guardian (Kotlin)",
    file: join(
      REPO, "guardian", "core", "network", "src", "main", "kotlin",
      "com", "furlpay", "guardian", "network", "FurlPayClient.kt"
    ),
    pattern: /const val CLIENT_HEADER\s*=\s*"([^"]+)"/,
  },
  {
    name: "iOS Guardian (Swift)",
    file: join(
      REPO, "ios", "FurlPayGuardian", "Shared", "Network", "FurlPayAPIClient.swift"
    ),
    pattern: /static let defaultClientHeader\s*=\s*"([^"]+)"/,
  },
];

describe("X-Furlpay-Client contract", () => {
  describe("isMobileClient", () => {
    it("accepts every shipped native client header", () => {
      for (const header of [
        "mobile-android/2.1.0",
        "mobile-guardian/0.1.0",
        "mobile-ios-guardian/1.0.0",
      ]) {
        expect(isMobileClient(headers(header)), header).toBe(true);
      }
    });

    it("treats a browser, an absent header and a near-miss as web", () => {
      for (const header of [
        undefined,
        "",
        "web",
        // The literal the iOS client shipped with. It looks like a version
        // string and is not one — it is the difference between a session and
        // no session.
        "ios-guardian/1.0.0",
        "Mobile-android/2.1.0", // case-sensitive by design: startsWith, not a regex
        " mobile-android/2.1.0", // leading space is not the prefix
      ]) {
        expect(isMobileClient(headers(header)), String(header)).toBe(false);
      }
    });

    it("is not an authorization boundary", () => {
      // Anyone can send this header. It selects a DELIVERY CHANNEL for a token
      // the caller already earned by completing the ceremony; it must never
      // gate who may do so. Documented in clientKind.ts and restated here so a
      // future reader does not mistake it for a security check.
      expect(isMobileClient(headers("mobile-anything"))).toBe(true);
    });
  });

  describe("shipped client headers", () => {
    for (const client of CLIENTS) {
      it(`${client.name} sends a mobile-* header`, () => {
        // A missing file means the client moved; that is a real failure, not a
        // reason to skip — a silently-skipped test on this invariant is worth
        // less than no test at all.
        expect(existsSync(client.file), `not found: ${client.file}`).toBe(true);

        const match = client.pattern.exec(readFileSync(client.file, "utf8"));
        expect(match, `no client-header literal matched in ${client.file}`).toBeTruthy();

        const header = match![1];
        expect(isMobileClient(headers(header)), `${client.name} sends "${header}"`).toBe(true);
      });
    }

    it("keeps the clients distinguishable in server logs", () => {
      // Same prefix, different identities. Collapsing these to a shared literal
      // would satisfy the check above and destroy the ability to tell which app
      // a reported failure came from.
      const headers = CLIENTS.map((c) => {
        const match = c.pattern.exec(readFileSync(c.file, "utf8"));
        return match![1];
      });
      expect(new Set(headers).size).toBe(CLIENTS.length);
    });
  });
});

function headers(value: string | undefined) {
  return { headers: { get: (name: string) => (name === "x-furlpay-client" ? (value ?? null) : null) } };
}
