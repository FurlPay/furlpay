/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PartnershipModal from "../PartnershipModal";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/analytics/vercelEvents", () => ({ trackEvent: vi.fn() }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (initialInterest?: "developer-api") => {
  const close = vi.fn();
  render(<PartnershipModal open onClose={close} source="partners_hero" initialInterest={initialInterest} />);
  return close;
};
const fill = () => {
  fireEvent.change(screen.getByLabelText(/Company \/ Project/), { target: { value: "Acme Labs" } });
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: "ops@acme.example" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Contact method" }), { target: { value: "email" } });
};
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Submit partnership inquiry" }));

describe("partnership modal regressions", () => {
  it("uses the native modal top layer and restores scroll on unmount", () => {
    mount();
    expect(document.querySelector("dialog")?.hasAttribute("open")).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    cleanup();
    expect(document.body.style.overflow).toBe("");
  });
  it("repeated Escape never discards entered details without an explicit choice", () => {
    const close = mount(); fill();
    fireEvent(document.querySelector("dialog")!, new Event("cancel", { bubbles: true, cancelable: true }));
    fireEvent(document.querySelector("dialog")!, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(close).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Company \/ Project/) as HTMLInputElement).value).toBe("Acme Labs");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(close).toHaveBeenCalledOnce();
  });
  it("focuses the first invalid field and does not send invalid input", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); mount(); submit();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/Company \/ Project/)));
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preselects the category and preserves details on a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: "Storage unavailable" }) }));
    mount("developer-api"); fill(); submit();
    await screen.findByText("Storage unavailable");
    expect((screen.getByLabelText(/Company \/ Project/) as HTMLInputElement).value).toBe("Acme Labs");
    expect((screen.getByLabelText(/Partnership interest/) as HTMLSelectElement).value).toBe("developer-api");
  });
  it("sends once during a pending request and focuses confirmed success", async () => {
    let resolve!: (v: unknown) => void;
    const fetcher = vi.fn(() => new Promise(r => { resolve = r; })); vi.stubGlobal("fetch", fetcher);
    mount("developer-api"); fill(); submit();
    fireEvent.submit(document.querySelector("form")!);
    expect(fetcher).toHaveBeenCalledOnce();
    resolve({ ok: true, json: async () => ({ ok: true, id: "test-reference", duplicate: false }) });
    const heading = await screen.findByRole("heading", { name: "Inquiry received" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
