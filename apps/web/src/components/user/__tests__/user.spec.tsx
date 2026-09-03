/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import UserAvatar, { AVATAR_SIZES, userInitials } from "../UserAvatar";
import { formatCount, accountAge } from "../ProfileStats";
import { MASK, maskValue } from "../BalanceVisibility";
import { deriveHandle, shortAddress } from "@/app/u/page";

// ---------------------------------------------------------------------------
// Two things are load-bearing here and neither is obvious from reading the JSX:
// the avatar must be a CIRCLE in every case (a rounded rectangle is the classic
// failure), and a hidden balance must be ABSENT from the DOM rather than blurred
// over.
// ---------------------------------------------------------------------------

describe("avatar shape", () => {
  it("is square and circular whether it renders a photo, initials or a silhouette", () => {
    // aspect-square + rounded-full + overflow-hidden together are what make it
    // a circle. Any one missing gives an ellipse or a clipped rectangle.
    for (const props of [
      { avatarUrl: "https://example.test/a.png", name: "Ada Lovelace" },
      { name: "Ada Lovelace" },
      {},
    ]) {
      const { container, unmount } = render(<UserAvatar {...props} />);
      const shell = container.firstElementChild as HTMLElement;
      expect(shell.className).toContain("aspect-square");
      expect(shell.className).toContain("rounded-full");
      expect(shell.className).toContain("overflow-hidden");
      unmount();
    }
  });

  it("never lets the image dictate the box shape", () => {
    const { container } = render(<UserAvatar avatarUrl="https://example.test/a.png" name="Ada" />);
    const img = container.querySelector("img")!;
    // object-cover centre-crops; without it a portrait photo is squashed.
    expect(img.className).toContain("object-cover");
    expect(img.className).toContain("rounded-full");
    expect(img.className).toContain("h-full");
    expect(img.className).toContain("w-full");
  });

  it("renders an exact square at every named size", () => {
    for (const [name, px] of Object.entries(AVATAR_SIZES)) {
      const { container, unmount } = render(<UserAvatar size={name as keyof typeof AVATAR_SIZES} />);
      const shell = container.firstElementChild as HTMLElement;
      expect(shell.style.width).toBe(`${px}px`);
      expect(shell.style.height).toBe(shell.style.width);
      unmount();
    }
  });

  it("falls back photo → initials → silhouette", () => {
    const { container: withInitials } = render(<UserAvatar name="Ada Lovelace" />);
    expect(withInitials.textContent).toBe("AL");

    // No name at all: a silhouette, not two invented letters.
    const { container: bare } = render(<UserAvatar />);
    expect(bare.textContent).toBe("");
    expect(bare.querySelector("svg")).not.toBeNull();
  });

  it("exposes a label only when it is not decorative", () => {
    render(<UserAvatar name="Ada Lovelace" decorative={false} />);
    expect(screen.getByRole("img", { name: /Ada Lovelace/ })).toBeTruthy();
  });
});

describe("initials", () => {
  it("reads a name the way a person would", () => {
    expect(userInitials("Ada Lovelace")).toBe("AL");
    expect(userInitials("Ada")).toBe("A");
    expect(userInitials("ada byron king lovelace")).toBe("AL");
  });

  it("ignores emoji and punctuation rather than rendering an empty box", () => {
    expect(userInitials("🦊 fox")).toBe("F");
    expect(userInitials("!!!")).toBeNull();
    expect(userInitials("")).toBeNull();
    expect(userInitials(null)).toBeNull();
  });
});

describe("balance masking", () => {
  it("replaces the value rather than obscuring it", () => {
    // A CSS blur leaves the number in the DOM for anyone with an inspector or
    // a screen reader. Masking has to remove it.
    expect(maskValue("$12,480.22", true)).toBe(MASK);
    expect(maskValue("$12,480.22", false)).toBe("$12,480.22");
  });

  it("uses a fixed-width mask so length does not leak magnitude", () => {
    expect(maskValue("$1.00", true)).toBe(maskValue("$9,999,999.00", true));
  });
});

describe("stat formatting", () => {
  it("compacts counts the way a social product does", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1K");
    expect(formatCount(1204)).toBe("1.2K");
    expect(formatCount(1_500_000)).toBe("1.5M");
  });

  it("refuses to render a negative or non-finite count", () => {
    expect(formatCount(-5)).toBe("0");
    expect(formatCount(NaN)).toBe("0");
  });

  it("reports account age in the coarsest honest unit", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    expect(accountAge("2026-09-03T01:00:00Z", now)).toBe("Today");
    expect(accountAge("2026-08-20T12:00:00Z", now)).toBe("14 days");
    expect(accountAge("2026-05-03T12:00:00Z", now)).toBe("4 months");
    expect(accountAge("2024-09-03T12:00:00Z", now)).toBe("2 years");
  });

  it("returns null rather than guessing when there is no date", () => {
    expect(accountAge(null)).toBeNull();
    expect(accountAge("not a date")).toBeNull();
  });
});

describe("derived handle", () => {
  it("comes from the email local part, deterministically", () => {
    expect(deriveHandle("ada.lovelace@example.com")).toBe("ada.lovelace");
    expect(deriveHandle("Ada+tag@example.com")).toBe("adatag");
  });

  it("returns null rather than a one-character handle", () => {
    expect(deriveHandle("a@example.com")).toBeNull();
    expect(deriveHandle(null)).toBeNull();
  });

  it("strips characters a handle cannot contain", () => {
    expect(deriveHandle("a b<script>@x.com")).toMatch(/^[a-z0-9._-]+$/);
  });
});

describe("address shortening", () => {
  it("keeps both ends, which is what people check", () => {
    expect(shortAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });

  it("leaves a short value alone", () => {
    expect(shortAddress("0x1234")).toBe("0x1234");
    expect(shortAddress(null)).toBeNull();
  });
});
