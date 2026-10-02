import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

// /l/* is the only path Android and iOS verify as an app link. Without the app,
// the browser must land on the same page of the website — and nowhere else.

async function go(path: string[], query = "") {
  const res = await GET(new NextRequest(`https://furlpay.com/l/${path.join("/")}${query}`), {
    params: Promise.resolve({ path }),
  });
  return { status: res.status, location: res.headers.get("location") };
}

describe("GET /l/[...path]", () => {
  it("redirects to the same path on our own origin, keeping the query", async () => {
    expect(await go(["travel", "bookings", "bk_1"], "?ref=mail")).toEqual({
      status: 307,
      location: "https://furlpay.com/travel/bookings/bk_1?ref=mail",
    });
  });

  it.each([
    [["..", "admin"]],
    [["."]],
    [["evil.example%2Fx"]],
    [["a%5Cb"]],
    [["<script>"]],
  ])("refuses an unsafe path %j and goes home", async (path) => {
    expect(await go(path)).toEqual({ status: 307, location: "https://furlpay.com/" });
  });

  it("can never leave the origin", async () => {
    const { location } = await go(["", "evil.example"]);
    expect(new URL(location!).origin).toBe("https://furlpay.com");
  });
});
