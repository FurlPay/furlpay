// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import HotelMapSearchHeader, { type Destination } from "../HotelMapSearchHeader";

// ---------------------------------------------------------------------------
// The map's search bar, and specifically that the microphone is IN it.
//
// The mic went missing from this bar for a while — the component existed and
// worked, and was simply never mounted here, which no typecheck or unit test
// could notice. These tests exist so that failure mode is loud next time.
// ---------------------------------------------------------------------------

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
  say(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript }], { isFinal: true, length: 1 })],
    });
    this.onend?.();
  }
}

const BALI: Destination = {
  label: "Bali",
  sublabel: "Indonesia",
  latitude: -8.4,
  longitude: 115.2,
  count: 12,
  kind: "destination",
};

function renderHeader(over: Partial<Parameters<typeof HotelMapSearchHeader>[0]> = {}) {
  const onQuery = vi.fn();
  const onPick = vi.fn();
  const props = {
    query: "",
    onQuery,
    suggestions: [] as Destination[],
    onPick,
    families: [] as never[],
    minStars: 0,
    filtersOpen: false,
    onToggleFilters: () => {},
    moreFilterCount: 0,
    recent: [] as Destination[],
    onClearRecent: () => {},
    ...over,
  };
  render(<HotelMapSearchHeader {...props} />);
  return { onQuery, onPick };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  FakeRecognition.last = null;
});

describe("the search field itself", () => {
  it("renders a combobox with the search placeholder", () => {
    renderHeader();
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("placeholder")).toBe("Search destinations, hotels, resorts...");
  });
});

describe("the microphone is present in the map search bar", () => {
  it("appears when SpeechRecognition exists", async () => {
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    renderHeader();
    expect(await screen.findByRole("button", { name: "Search destinations by voice" })).toBeTruthy();
  });

  it("is absent — not broken — when SpeechRecognition is missing", async () => {
    renderHeader();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Search destinations by voice" })).toBeNull();
    });
    // The rest of the bar still works without it.
    expect(screen.getByRole("combobox")).toBeTruthy();
  });
});

describe("transcript reaches the search field", () => {
  it("routes a spoken phrase into onQuery rather than searching directly", async () => {
    // Deliberate: dictation fills the field and opens the list. It must NOT fly
    // the map on its own, because speech recognition mishears place names and
    // an automatic jump would strand someone with no obvious way back.
    (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
    const { onQuery, onPick } = renderHeader();

    fireEvent.click(await screen.findByRole("button", { name: "Search destinations by voice" }));
    await waitFor(() => expect(FakeRecognition.last?.started).toBe(true));
    FakeRecognition.last!.say("bali");

    await waitFor(() => expect(onQuery).toHaveBeenCalledWith("bali"));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe("suggestions", () => {
  it("lists a matching destination once the field has a query and focus", async () => {
    renderHeader({ query: "bal", suggestions: [BALI] });
    fireEvent.focus(screen.getByRole("combobox"));
    expect(await screen.findByRole("listbox")).toBeTruthy();
    expect(screen.getByText("Bali")).toBeTruthy();
  });

  it("hands the chosen destination back to the map", async () => {
    const { onPick } = renderHeader({ query: "bal", suggestions: [BALI] });
    fireEvent.focus(screen.getByRole("combobox"));
    await screen.findByRole("listbox");
    // The row is a role="option" with an onClick — click the option itself
    // rather than the text node inside it.
    fireEvent.click(screen.getByRole("option", { name: /Bali/ }));
    await waitFor(() =>
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ label: "Bali" }))
    );
  });
});
