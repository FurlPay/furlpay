/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Row } from "../primitives";
import ProfileImageUploader from "@/components/user/ProfileImageUploader";

// ---------------------------------------------------------------------------
// Regression: the "Profile picture" label wrapped every few words.
//
// Row's content column was `shrink-0`, so the uploader (whose requirements
// line has a long max-content width) sized the column to that whole line and
// the label, `flex-1 min-w-0`, was crushed to a sliver. jsdom does no layout,
// so this pins the structural contract that prevents it.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("settings Row layout contract", () => {
  it("label keeps a minimum width; content may shrink and wrap", () => {
    render(
      <Row label="Profile picture" hint="Cropped to a square and stored with your account.">
        <span>control</span>
      </Row>
    );
    const label = screen.getByText("Profile picture").parentElement!;
    const content = screen.getByText("control").parentElement!;
    expect(label.className).toMatch(/sm:min-w-\[14rem\]/);
    expect(content.className).not.toMatch(/\bshrink-0\b/);
    expect(content.className).toMatch(/\bmin-w-0\b/);
    expect(content.className).toMatch(/\bflex-wrap\b/);
  });

  it("stacks on mobile: the label spans the full row below sm", () => {
    render(<Row label="Email">x</Row>);
    expect(screen.getByText("Email").parentElement!.className).toMatch(/\bbasis-full\b/);
  });
});

describe("ProfileImageUploader", () => {
  it("text column can shrink, keeps a readable measure, and labels the upload button", () => {
    render(<ProfileImageUploader name="Ada Lovelace" initials="AL" avatarUrl={null} />);
    const button = screen.getByRole("button", { name: /upload picture/i });
    const hintId = button.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId!)!;
    expect(hint.textContent).toMatch(/JPEG, PNG or WEBP/);
    expect(hint.className).toMatch(/max-w-\[46ch\]/);
    expect(hint.parentElement!.className).toMatch(/\bmin-w-0\b.*\bflex-1\b|\bflex-1\b.*\bmin-w-0\b/);
  });

  it("no picture → initials fallback, and no Remove button", () => {
    render(<ProfileImageUploader name="Ada Lovelace" initials="AL" avatarUrl={null} />);
    expect(screen.getByText("AL")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
