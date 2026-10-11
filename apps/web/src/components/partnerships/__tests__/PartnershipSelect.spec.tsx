/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import PartnershipSelect from "../PartnershipSelect";
import PartnershipModal from "../PartnershipModal";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/analytics/vercelEvents", () => ({ trackEvent: vi.fn() }));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  // jsdom has no layout; give every box an on-screen rect so the list is positioned as in a browser.
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 20, y: 100, left: 20, top: 100, right: 420, bottom: 146, width: 400, height: 46, toJSON: () => ({}) } as DOMRect);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const OPTIONS = [{ value: "a", label: "Alpha" }, { value: "b", label: "Bravo" }, { value: "c", label: "Charlie" }];
function Harness({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState("");
  return <>
    <span id="lbl">Pick</span>
    <PartnershipSelect id="sel" labelId="lbl" value={value} options={OPTIONS} placeholder="Choose one"
      onValueChange={v => { setValue(v); onChange(v); }} />
    <button type="button">elsewhere</button>
  </>;
}
const trigger = () => screen.getByRole("combobox", { name: /^Pick/ });
const listbox = () => document.getElementById("sel-list");
const isOpen = () => trigger().getAttribute("aria-expanded") === "true";

describe("PartnershipSelect", () => {
  it("renders a custom listbox, never a native <select>", () => {
    render(<Harness />);
    expect(document.querySelector("select")).toBeNull();
    fireEvent.click(trigger());
    expect(isOpen()).toBe(true);
    expect(listbox()?.getAttribute("role")).toBe("listbox");
    expect(listbox()?.className).toContain("fp-listbox");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("selects with the mouse, marks the choice and closes", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("option", { name: "Bravo" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(isOpen()).toBe(false);
    expect(trigger().textContent).toContain("Bravo");
    fireEvent.click(trigger());
    expect(screen.getByRole("option", { name: "Bravo" }).getAttribute("aria-selected")).toBe("true");
  });

  it("supports the keyboard: arrows, Home/End, Enter, typeahead", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    trigger().focus();
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(isOpen()).toBe(true);
    fireEvent.keyDown(trigger(), { key: "ArrowDown" });
    expect(trigger().getAttribute("aria-activedescendant")).toBe("sel-option-1");
    fireEvent.keyDown(trigger(), { key: "End" });
    expect(trigger().getAttribute("aria-activedescendant")).toBe("sel-option-2");
    fireEvent.keyDown(trigger(), { key: "Home" });
    fireEvent.keyDown(trigger(), { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(trigger(), { key: "c" });
    expect(trigger().getAttribute("aria-activedescendant")).toBe("sel-option-2");
  });

  it("closes on Escape without letting it reach an enclosing dialog", () => {
    render(<Harness />);
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.click(trigger());
    fireEvent.keyDown(trigger(), { key: "Escape" });
    document.removeEventListener("keydown", outer);
    expect(isOpen()).toBe(false);
    expect(outer).not.toHaveBeenCalled();
  });

  it("closes on an outside press", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));
    expect(isOpen()).toBe(false);
  });

  it.each(["touch", "mouse", "pen"])("a %s press on the list cannot take focus off the trigger", (pointerType) => {
    // An uncancelled touch pointerdown makes the browser fire a compatibility
    // mousedown after pointerup; that blurred the trigger and closed the list
    // before the tap's click landed (found driving a 390px touch viewport).
    // jsdom lacks PointerEvent; carry pointerType on a plain event as a browser would.
    render(<Harness />);
    fireEvent.click(trigger());
    const press = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(press, "pointerType", { value: pointerType });
    fireEvent(screen.getByRole("option", { name: "Charlie" }), press);
    expect(press.defaultPrevented).toBe(true);
  });

  it("a plain blur (tabbing away) closes the list", () => {
    render(<Harness />);
    fireEvent.click(trigger());
    act(() => { fireEvent.blur(trigger()); });
    expect(isOpen()).toBe(false);
  });
});

describe("partnership modal backdrop", () => {
  it("closes on a press and release on the backdrop", () => {
    const close = vi.fn();
    render(<PartnershipModal open onClose={close} source="partners_hero" />);
    const dialog = document.querySelector("dialog")!;
    fireEvent.pointerDown(dialog); fireEvent.click(dialog);
    expect(close).toHaveBeenCalledOnce();
  });
  it("ignores a click that only ENDS on the backdrop (press started inside)", () => {
    const close = vi.fn();
    render(<PartnershipModal open onClose={close} source="partners_hero" />);
    fireEvent.pointerDown(screen.getByLabelText(/Company \/ Project/));
    fireEvent.click(document.querySelector("dialog")!);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("contact method in the partnership modal", () => {
  it("re-picking the current method keeps the typed contact detail; a new method clears it", () => {
    render(<PartnershipModal open onClose={() => {}} source="partners_hero" />);
    const method = () => screen.getByRole("combobox", { name: /^Contact method/ });
    const detail = () => screen.getByLabelText(/contact detail/) as HTMLInputElement;
    fireEvent.change(detail(), { target: { value: "acme_ops" } });
    fireEvent.click(method());
    fireEvent.click(screen.getByRole("option", { name: "Telegram" }));
    expect(detail().value).toBe("acme_ops");
    fireEvent.click(method());
    fireEvent.click(screen.getByRole("option", { name: "Discord" }));
    expect(detail().value).toBe("");
    expect(method().textContent).toContain("Discord");
  });
});
