import { describe, expect, it } from "vitest";
import { CONTENT_SCRIPT_MESSAGES, isExtensionPage, messageAllowed } from "../messageGate";

// The runtime half of the content-script boundary. A content script shares the
// extension id, so these tests model the case the static source check cannot:
// a compromised renderer sending whatever type it likes.

const ID = "aeinggnckhnkgpaikcejcgodbdggegjh";
const BASE = `chrome-extension://${ID}/`;
const popup = { id: ID, url: `${BASE}popup.html` };
const sidepanel = { id: ID, url: `${BASE}sidepanel.html` };
const prompt = { id: ID, url: `${BASE}connect-prompt.html?rid=abc&origin=https%3A%2F%2Fdapp.example` };
const page = { id: ID, url: "https://evil.example/checkout" };

const PRIVILEGED = [
  "REVOKE_PASSKEY",
  "LOGOUT",
  "STEP_UP_SEND",
  "STEP_UP_VERIFY",
  "DECLINE_CHALLENGE",
  "RAMP_CHECKOUT",
  "UPGRADE_PLAN",
  "GET_OVERVIEW",
  "GET_TRANSACTIONS",
  "GET_RECEIVE_ADDRESS",
];

describe("messageAllowed", () => {
  it.each(PRIVILEGED)("refuses %s from a content script on a web page", (type) => {
    expect(messageAllowed(type, page, ID, BASE)).toBe(false);
  });

  it.each([...CONTENT_SCRIPT_MESSAGES])("allows %s from a content script", (type) => {
    expect(messageAllowed(type, page, ID, BASE)).toBe(true);
  });

  it.each(PRIVILEGED)("allows %s from the popup and side panel", (type) => {
    expect(messageAllowed(type, popup, ID, BASE)).toBe(true);
    expect(messageAllowed(type, sidepanel, ID, BASE)).toBe(true);
  });

  it("lets only the connect prompt answer a consent prompt", () => {
    expect(messageAllowed("WALLET_CONNECT_DECISION", prompt, ID, BASE)).toBe(true);
    expect(messageAllowed("WALLET_CONNECT_DECISION", popup, ID, BASE)).toBe(false);
    expect(messageAllowed("WALLET_CONNECT_DECISION", page, ID, BASE)).toBe(false);
  });

  it("refuses another extension", () => {
    expect(messageAllowed("GET_OVERVIEW", { ...popup, id: "otherextensionid" }, ID, BASE)).toBe(false);
    expect(messageAllowed("WALLET_CONNECT", { ...page, id: undefined }, ID, BASE)).toBe(false);
  });

  it("refuses a look-alike extension URL", () => {
    expect(messageAllowed("LOGOUT", { id: ID, url: "chrome-extension://otherextensionid/popup.html" }, ID, BASE)).toBe(false);
    expect(messageAllowed("LOGOUT", { id: ID, url: `https://${ID}/popup.html` }, ID, BASE)).toBe(false);
  });

  it("fails closed on missing or malformed input", () => {
    expect(messageAllowed("LOGOUT", { id: ID }, ID, BASE)).toBe(false);
    expect(messageAllowed("LOGOUT", { id: ID, url: "not a url" }, ID, BASE)).toBe(false);
    expect(messageAllowed(undefined, popup, ID, BASE)).toBe(false);
    expect(messageAllowed({ type: "LOGOUT" }, popup, ID, BASE)).toBe(false);
    // An unparseable or hostless base must not make everything "same extension".
    expect(messageAllowed("LOGOUT", { id: ID, url: "data:text/html,x" }, ID, "data:text/html,x")).toBe(false);
  });
});

describe("isExtensionPage", () => {
  it("matches Firefox moz-extension pages by scheme and host", () => {
    const ff = "moz-extension://0f3c9a1e-1111-2222-3333-444455556666/";
    expect(isExtensionPage({ url: `${ff}popup.html` }, ff)).toBe(true);
    expect(isExtensionPage({ url: "moz-extension://ffffffff-1111-2222-3333-444455556666/popup.html" }, ff)).toBe(false);
  });
});
