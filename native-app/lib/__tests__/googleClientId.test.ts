import { isRealGoogleClientId } from "../googleClientId";

// Guards the "don't show a dead Google button" rule. A build that carries a
// placeholder client id (to pass app.config.js's format-only release guard so a
// device-test AAB can build) must still HIDE the button — otherwise the user
// taps it and hits Google's "Error 401: invalid_client".

describe("isRealGoogleClientId", () => {
  it("accepts a real client id", () => {
    expect(isRealGoogleClientId("123456789-abcdef.apps.googleusercontent.com")).toBe(true);
  });

  it("rejects a placeholder that is otherwise well-formed", () => {
    expect(isRealGoogleClientId("000000000000-androidplaceholder.apps.googleusercontent.com")).toBe(false);
    expect(isRealGoogleClientId("placeholder-android-client-id")).toBe(false);
    expect(isRealGoogleClientId("000-webPLACEHOLDER.apps.googleusercontent.com")).toBe(false);
  });

  it("rejects ids that do not end in the Google suffix", () => {
    expect(isRealGoogleClientId("123-abc.example.com")).toBe(false);
    expect(isRealGoogleClientId("just-an-id")).toBe(false);
  });

  it("rejects empty / missing", () => {
    expect(isRealGoogleClientId(undefined)).toBe(false);
    expect(isRealGoogleClientId(null)).toBe(false);
    expect(isRealGoogleClientId("")).toBe(false);
  });
});
