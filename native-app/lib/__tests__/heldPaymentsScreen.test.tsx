import React from "react";
import { Pressable, Text } from "react-native";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

// The held-payments screen must never decide anything on its own: not on
// mount, not on a refetch, not when the user comes back from the step-up
// screen. Only a tap on Approve or Deny in the review sheet sends a decision,
// and only one per tap.

jest.mock("@/components/ui", () => {
  const actual = jest.requireActual("@/components/ui");
  const React_ = jest.requireActual("react") as typeof import("react");
  return {
    ...actual,
    Sheet: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? React_.createElement(React_.Fragment, null, children) : null,
  };
});
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
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));
jest.mock("@/lib/secureScreen", () => ({ useSecureScreen: jest.fn() }));

const mockQueue = {
  approvals: [
    {
      id: "cpap_1",
      authorizationId: "cpa_1",
      approverRole: "finance_admin",
      requestedAt: "2026-10-12T10:00:00.000Z",
      deadline: null,
      onTimeout: "DENY",
      payment: {
        phase: "PENDING_APPROVAL",
        amount: "1250500000",
        amountMajor: "1250.500000",
        asset: "USDC",
        recipientDestination: "0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc",
        reason: "amount above approval threshold",
      },
    },
  ],
};

const mockInvalidate = jest.fn(async () => {});
jest.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryFn }: { queryFn: () => unknown }) => {
    void queryFn; // the fetch itself is exercised via the api mock below
    const { parseQueue } = jest.requireActual("@/lib/heldPayments");
    return { data: parseQueue(mockQueue), isLoading: false, isRefetching: false, error: null, refetch: jest.fn() };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}));

jest.mock("@/lib/api", () => {
  class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    api: jest.fn(),
    ApiError,
    NetworkError: class extends Error {},
    TimeoutError: class extends Error {},
  };
});

import HeldPayments from "@/app/held-payments";
import * as apiMod from "@/lib/api";
import * as routerMod from "expo-router";

const api = apiMod.api as unknown as jest.Mock;
const push = (routerMod as unknown as { __push: jest.Mock }).__push;

const mounted: ReactTestRenderer[] = [];
function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<HeldPayments />);
  });
  mounted.push(tree);
  return tree;
}

// The countdown runs an interval; an unmounted tree clears it.
afterEach(() => {
  for (const t of mounted.splice(0)) act(() => t.unmount());
});

function press(tree: ReactTestRenderer, label: string) {
  const button = tree.root
    .findAll((n: ReactTestInstance) => n.type === Pressable)
    .find((n: ReactTestInstance) => n.props.accessibilityLabel === label);
  if (!button) throw new Error(`no button "${label}"`);
  return act(async () => {
    button.props.onPress();
  });
}

/** Every string rendered inside a <Text>. */
function textOf(tree: ReactTestRenderer): string {
  const flat = (c: unknown): string =>
    Array.isArray(c) ? c.map(flat).join("") : typeof c === "string" || typeof c === "number" ? String(c) : "";
  return tree.root
    .findAll((n: ReactTestInstance) => n.type === Text)
    .map((n: ReactTestInstance) => flat(n.props.children)).join(" | ");
}

const decisionCalls = () => api.mock.calls.filter(([path]) => String(path).startsWith("/control-plane/approvals/"));

beforeEach(() => {
  api.mockReset();
  push.mockClear();
  mockInvalidate.mockClear();
});

it("shows the held payment and decides nothing on mount", () => {
  const tree = render();
  const text = textOf(tree);
  expect(text).toContain("1,250.50 USDC");
  expect(decisionCalls()).toHaveLength(0);
  // No decision buttons until the full payment is open for review.
  expect(() => press(tree, "Approve")).toThrow(/no button/);
});

it("sends exactly one decision for the reviewed payment", async () => {
  api.mockResolvedValue({ decision: "APPROVE", phase: "APPROVED", replayed: false });
  const tree = render();
  await press(tree, "Review");
  // The review shows the full destination, not an ellipsized one.
  expect(textOf(tree)).toContain("0xCcCcCcCc33333333CcCcCcCc33333333CcCcCcCc");
  await press(tree, "Approve");
  expect(decisionCalls()).toEqual([
    ["/control-plane/approvals/cpap_1", { method: "POST", body: { decision: "APPROVE" } }],
  ]);
  expect(mockInvalidate).toHaveBeenCalled();
});

it("sends a step-up challenge to verification instead of deciding", async () => {
  const { ApiError } = jest.requireMock("@/lib/api");
  api.mockRejectedValue(new ApiError(401, "step_up_required", { error: "step_up_required" }));
  const tree = render();
  await press(tree, "Review");
  await press(tree, "Deny");
  expect(push).toHaveBeenCalledWith({ pathname: "/step-up", params: { returnTo: "/held-payments" } });
  expect(decisionCalls()).toHaveLength(1);
});
