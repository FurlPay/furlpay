/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import Select from "../Select";
import { ChipGroup, FilterPanel, RangeField } from "@/components/travel/Filters";
import EmptyState from "@/components/travel/EmptyState";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 20, y: 100, left: 20, top: 100, right: 220, bottom: 136, width: 200, height: 36, toJSON: () => ({}) } as DOMRect);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const SORTS = [
  { value: "price", label: "Price" },
  { value: "distance", label: "Distance", disabled: true },
  { value: "rating", label: "Rating" },
];
function Sorter({ onChange = () => {} }: { onChange?: (v: string) => void }) {
  const [v, setV] = useState("price");
  return <Select ariaLabel="Sort hotels" value={v} options={SORTS} onValueChange={(x) => { setV(x); onChange(x); }} />;
}

describe("shared Select", () => {
  it("is named by aria-label when there is no visible label, and portals its list to <body>", () => {
    render(<Sorter />);
    const trigger = screen.getByRole("combobox", { name: "Sort hotels" });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox", { name: "Sort hotels" });
    expect(list.parentElement).toBe(document.body);
    expect(list.style.position).toBe("absolute");
  });

  it("skips disabled options with the keyboard and refuses them on click", () => {
    const onChange = vi.fn();
    render(<Sorter onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Sort hotels" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // open on "Price"
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // jumps over "Distance"
    expect(trigger.getAttribute("aria-activedescendant")).toMatch(/option-2$/);
    fireEvent.click(screen.getByRole("option", { name: "Distance" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("option", { name: "Distance" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("rating");
  });

  it("keeps a wider menu inside the viewport", () => {
    render(<Select ariaLabel="Sort" value="a" options={[{ value: "a", label: "A" }]} onValueChange={() => {}} minMenuWidth={5000} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Sort" }));
    const list = screen.getByRole("listbox", { name: "Sort" });
    // style.left is relative to the portal host, whose (mocked) rect starts at x=20.
    const viewportLeft = parseFloat(list.style.left) + 20;
    expect(viewportLeft).toBeGreaterThanOrEqual(12);
    expect(viewportLeft + parseFloat(list.style.width)).toBeLessThanOrEqual(window.innerWidth - 12);
  });
});

describe("travel filter controls", () => {
  it("ChipGroup marks exactly one chip pressed", () => {
    const onChange = vi.fn();
    render(<ChipGroup label="Minimum stars" options={[{ value: 0, label: "Any" }, { value: 4, label: "4★+" }]} value={4} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "4★+" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Any" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Any" }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("RangeField labels the slider, announces the formatted value and fills to the thumb", () => {
    render(<RangeField label="Up to" min={50} max={500} step={10} value={275} onChange={() => {}} format={(v) => `$${v}`} />);
    const slider = screen.getByRole("slider", { name: "Up to" });
    expect(slider.getAttribute("aria-valuetext")).toBe("$275");
    expect(slider.style.getPropertyValue("--range-fill")).toBe("50%");
  });

  it("FilterPanel shows the active count and Reset only when something is set", () => {
    const onReset = vi.fn();
    const { rerender } = render(<FilterPanel activeCount={0} onReset={onReset} resultCount={3}><p>controls</p></FilterPanel>);
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    rerender(<FilterPanel activeCount={2} onReset={onReset} resultCount={3}><p>controls</p></FilterPanel>);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Filters\s*2/ })).toBeTruthy(); // the mobile sheet trigger
  });
});

describe("EmptyState", () => {
  it("renders the title, explanation and actions, as a status by default", () => {
    render(<EmptyState icon={<span />} title="No stays match your filters" actions={<button type="button">Reset filters</button>}>3 properties are hidden.</EmptyState>);
    const box = screen.getByRole("status");
    expect(box.textContent).toContain("No stays match your filters");
    expect(box.textContent).toContain("3 properties are hidden.");
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();
  });
});
