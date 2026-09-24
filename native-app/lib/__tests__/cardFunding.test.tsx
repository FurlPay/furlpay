import { readFileSync } from "fs";
import { join } from "path";
import React from "react";
import { Pressable } from "react-native";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

// `Sheet` is mocked to render its children inline rather than mocking
// react-native itself. Mutating the real RN module (as some sibling tests do)
// breaks its `Platform` getter, which Sheet reads — and the subject here is
// AddMoneySheet's ROUTING, not the modal shell's presentation.
jest.mock("@/components/ui", () => {
  const actual = jest.requireActual("@/components/ui");
  const React_ = jest.requireActual("react") as typeof import("react");
  return {
    ...actual,
    Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? React_.createElement(React_.Fragment, null, children) : null,
  };
});

// Ionicons loads its font asynchronously and setStates when it resolves, which
// lands outside act() and then crashes this renderer. The icons are decoration
// here; a stub removes the async entirely.
jest.mock("@expo/vector-icons", () => {
  const React_ = jest.requireActual("react") as typeof import("react");
  const { View } = jest.requireActual("react-native");
  const Stub = (props: Record<string, unknown>) => React_.createElement(View, props);
  return { Ionicons: Stub, MaterialCommunityIcons: Stub, Feather: Stub };
});

jest.mock("expo-router", () => {
  const push = jest.fn();
  return { useRouter: () => ({ push }), __push: push };
});
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Medium: "medium" },
}));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => {}) }));
// useQuery is stubbed rather than driven through a real QueryClient. The live
// client schedules its notifications on a timer, which fires after Jest tears
// the environment down and crashes the run — and the bank-details fetch is not
// the subject here. The three loading/error/empty branches are asserted against
// the source instead, below.
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { accounts: [] }, isLoading: false, isError: false }),
}));
jest.mock("@/lib/api", () => ({
  api: jest.fn(async () => ({ accounts: [] })),
  API_BASE: "https://furlpay.com/api",
  ApiError: class extends Error {},
  NetworkError: class extends Error {},
}));

import { AddMoneySheet } from "@/components/AddMoneySheet";
import * as routerMod from "expo-router";

const push = (routerMod as unknown as { __push: jest.Mock }).__push;

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(node);
  });
  return tree;
}

/** A pressable carrying this accessibility label. */
function byLabel(tree: ReactTestRenderer, label: string): ReactTestInstance | null {
  return (
    tree.root
      .findAll((n: ReactTestInstance) => n.type === Pressable)
      .find((n: ReactTestInstance) => n.props.accessibilityLabel === label) ?? null
  );
}

beforeEach(() => push.mockClear());

// ---------------------------------------------------------------------------
// Funding a card.
//
// A card has no balance of its own — PaymentCard carries `settlementCurrency`,
// not an amount — so "top up this card" is funding the account it settles from.
// That is the same operation as the home screen's "Add money", which is why
// both screens share ONE sheet instead of each owning a funding flow.
//
// These tests pin the shape that makes that true: the sheet routes to the real
// destinations, and the cards tab reaches it through the shared component
// rather than a copy.
// ---------------------------------------------------------------------------

describe("AddMoneySheet routes to the real funding destinations", () => {
  it("deposit crypto goes to /receive", () => {
    const tree = render(<AddMoneySheet open onClose={() => {}} />);
    const row = byLabel(tree, "Deposit crypto");
    expect(row).not.toBeNull();
    act(() => row!.props.onPress());
    expect(push).toHaveBeenCalledWith("/receive");
  });

  it("buy with card goes to /banking", () => {
    const tree = render(<AddMoneySheet open onClose={() => {}} />);
    act(() => byLabel(tree, "Buy with card")!.props.onPress());
    expect(push).toHaveBeenCalledWith("/banking");
  });

  it("closes before navigating", () => {
    // Order matters: navigating with the sheet still mounted leaves a modal
    // over the destination screen.
    const order: string[] = [];
    const tree = render(<AddMoneySheet open onClose={() => order.push("close")} />);
    push.mockImplementation(() => order.push("push"));
    act(() => byLabel(tree, "Deposit crypto")!.props.onPress());
    expect(order).toEqual(["close", "push"]);
  });

  it("renders nothing navigable when closed", () => {
    const tree = render(<AddMoneySheet open={false} onClose={() => {}} />);
    expect(byLabel(tree, "Deposit crypto")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source-level invariants.
//
// Asserted against the file text because they are about STRUCTURE, and the
// structure is the point: a second funding sheet, a removed accessibility
// label, or a bypassed simulation guard all pass a rendering test.
// ---------------------------------------------------------------------------

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the cards tab reuses the shared sheet", () => {
  const cards = read("app/(tabs)/cards.tsx");

  it("imports AddMoneySheet rather than defining a funding flow", () => {
    expect(cards).toContain('from "@/components/AddMoneySheet"');
  });

  it("mounts it and offers an Add money action", () => {
    expect(cards).toContain("<AddMoneySheet");
    expect(cards).toMatch(/title="Add money"/);
  });

  it("does not re-declare the deposit rows", () => {
    // The sheet's internals living in two files is the duplication this
    // extraction exists to prevent.
    expect(cards).not.toContain("DepositRow");
    expect(cards).not.toContain("depositRow:");
  });

  it("the home screen also uses the shared sheet, not its old private copy", () => {
    const home = read("app/(tabs)/index.tsx");
    expect(home).toContain('from "@/components/AddMoneySheet"');
    expect(home).not.toContain("function AddMoneySheet");
    expect(home).not.toContain("DepositRow");
  });
});

describe("the bank-details section distinguishes its three empty states", () => {
  const sheet = read("components/AddMoneySheet.tsx");

  it("handles loading, error and genuinely-empty separately", () => {
    // Collapsing them is what the original did: a slow /banking call rendered
    // "No bank details yet", which tells the user something false about their
    // own account.
    expect(sheet).toContain("isLoading ?");
    expect(sheet).toContain("isError ?");
    expect(sheet).toContain("withDetails.length ?");
  });

  it("reads all three flags off the query", () => {
    expect(sheet).toMatch(/const \{ data, isLoading, isError \} = useQuery/);
  });
});

describe("the card tilt respects reduced motion", () => {
  const cards = read("app/(tabs)/cards.tsx");

  it("reads reduceMotion from the theme", () => {
    expect(cards).toContain("const { reduceMotion } = useTheme()");
  });

  it("withholds the pan responder entirely when reduced motion is on", () => {
    // Not "animates to zero". Attaching the responder and animating nothing
    // would still take touches away from the carousel's paging.
    expect(cards).toContain("{...(reduceMotion ? {} : responder.panHandlers)}");
  });

  it("keeps every transform on the native driver", () => {
    // The tilt shares the screen with a horizontally-paging FlatList; a
    // JS-driven transform competes with that scroll for the JS thread.
    const springs = cards.match(/Animated\.spring\([^)]*\)/g) ?? [];
    expect(springs.length).toBeGreaterThan(0);
    for (const s of springs) expect(s).toContain("useNativeDriver: true");
  });

  it("adds no new dependency to achieve the effect", () => {
    // Device-motion tilt would need expo-sensors and Reanimated; this is built
    // on the core Animated API precisely so neither is required.
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["expo-sensors"]).toBeUndefined();
    expect(pkg.dependencies["react-native-reanimated"]).toBeUndefined();
    expect(cards).toContain("PanResponder");
  });
});

describe("wallet provisioning stays gated", () => {
  it("the client still refuses to push a simulated payload", () => {
    // The single most dangerous edit anyone could make to this feature is
    // deleting this branch to "make the button work": an OPC and a
    // nonceSignature are verified against the issuer's signature chain by the
    // secure element, so the simulated values cannot tokenize.
    const provisioning = read("lib/cards/provisioning.ts");
    expect(provisioning).toMatch(/if \(res\.simulated\)/);
    expect((provisioning.match(/if \(res\.simulated\)/g) ?? []).length).toBe(2);
  });

  it("the card screen explains the gate instead of claiming work is missing", () => {
    const detail = read("app/cards/[id].tsx");
    expect(detail).not.toContain("TODO(backend)");
    expect(detail).toContain("NOT A MISSING IMPLEMENTATION");
    expect(detail).toContain("CONTRACTED CARD ISSUER");
  });

  it("no provisioning start call was added to the card surfaces", () => {
    // Out of scope by instruction, and impossible to do correctly without an
    // issuer. A test is cheaper than rediscovering why.
    for (const f of ["app/(tabs)/cards.tsx", "app/cards/[id].tsx"]) {
      expect(read(f)).not.toContain("startApplePayProvisioning");
      expect(read(f)).not.toContain("startGooglePayProvisioning");
    }
  });
});
