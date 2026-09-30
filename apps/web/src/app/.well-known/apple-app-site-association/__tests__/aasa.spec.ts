import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../route";

// The AASA must never name a team that does not own the app. With no (or a
// malformed) APPLE_TEAM_ID it 404s; with one it associates exactly the paths
// Android claims (/l/*) plus passkey webcredentials.

const SAVED = process.env.APPLE_TEAM_ID;
afterEach(() => {
  if (SAVED === undefined) delete process.env.APPLE_TEAM_ID;
  else process.env.APPLE_TEAM_ID = SAVED;
});

describe("apple-app-site-association", () => {
  it("404s without a Team ID rather than inventing one", () => {
    delete process.env.APPLE_TEAM_ID;
    expect(GET().status).toBe(404);
  });

  it("404s on a malformed Team ID", () => {
    process.env.APPLE_TEAM_ID = "not-a-team";
    expect(GET().status).toBe(404);
  });

  it("associates /l/* and passkeys for the configured team", async () => {
    process.env.APPLE_TEAM_ID = "ABCDE12345";
    const res = GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.applinks.details).toEqual([
      { appIDs: ["ABCDE12345.com.furlpay.app"], components: [{ "/": "/l/*" }] },
    ]);
    expect(body.webcredentials.apps).toEqual(["ABCDE12345.com.furlpay.app"]);
  });
});
