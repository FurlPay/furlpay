// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import VoiceInputButton from "../VoiceInputButton";

// ---------------------------------------------------------------------------
// The microphone's contract is mostly about ABSENCE.
//
// SpeechRecognition is prefixed, unevenly implemented, and missing entirely in
// Firefox. A control that renders anyway and does nothing when tapped is worse
// than no control, so "renders nothing when unsupported" is the first test, and
// the one most likely to regress silently — it regresses into a button that
// looks perfectly fine.
// ---------------------------------------------------------------------------

/** Minimal stand-in for the browser's SpeechRecognition, driven by the test. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    this.started = true;
  }
  stop() {
    this.started = false;
    this.onend?.();
  }
  abort() {
    this.started = false;
  }

  /** Deliver a final transcript the way the real API shapes it. */
  say(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript }], { isFinal: true, length: 1 })],
    });
    this.onend?.();
  }
}

function withSpeechRecognition() {
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
}

function withoutSpeechRecognition() {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
}

afterEach(() => {
  cleanup();
  withoutSpeechRecognition();
  FakeRecognition.last = null;
});

describe("microphone visibility follows real capability", () => {
  it("renders NOTHING when SpeechRecognition is unavailable", async () => {
    // Firefox, and anywhere the API is switched off. A dead mic in the search
    // bar is the failure this prevents.
    withoutSpeechRecognition();
    render(<VoiceInputButton onResult={() => {}} label="Search by voice" />);
    await waitFor(() => {
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  it("renders the button when SpeechRecognition exists", async () => {
    withSpeechRecognition();
    render(<VoiceInputButton onResult={() => {}} label="Search by voice" />);
    const btn = await screen.findByRole("button", { name: "Search by voice" });
    expect(btn).toBeTruthy();
  });

  it("carries the accessible name it was given", async () => {
    withSpeechRecognition();
    render(<VoiceInputButton onResult={() => {}} label="Search destinations by voice" />);
    expect(await screen.findByRole("button", { name: "Search destinations by voice" })).toBeTruthy();
  });
});

describe("transcript reaches the caller", () => {
  it("hands the final transcript to onResult", async () => {
    withSpeechRecognition();
    const onResult = vi.fn();
    render(<VoiceInputButton onResult={onResult} label="Search by voice" />);

    fireEvent.click(await screen.findByRole("button", { name: "Search by voice" }));
    await waitFor(() => expect(FakeRecognition.last?.started).toBe(true));

    FakeRecognition.last!.say("bali");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith("bali"));
  });

  it("does not fire onResult before anything has been said", async () => {
    withSpeechRecognition();
    const onResult = vi.fn();
    render(<VoiceInputButton onResult={onResult} label="Search by voice" />);
    fireEvent.click(await screen.findByRole("button", { name: "Search by voice" }));
    await waitFor(() => expect(FakeRecognition.last?.started).toBe(true));
    expect(onResult).not.toHaveBeenCalled();
  });

  it("announces listening state to a screen reader", async () => {
    // The visual cue is a colour change on a small icon; without a live region
    // there is nothing at all to tell a non-visual user the mic is open.
    withSpeechRecognition();
    render(<VoiceInputButton onResult={() => {}} label="Search by voice" />);
    fireEvent.click(await screen.findByRole("button", { name: "Search by voice" }));
    const status = await screen.findByRole("status");
    expect(status).toBeTruthy();
  });
});
