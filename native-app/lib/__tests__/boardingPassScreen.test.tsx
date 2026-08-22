import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { LiveActivityCard } from "@/components/trips/LiveActivityCard";
import { TripHeroCard } from "@/components/trips/TripHeroCard";
import { BoardingPassCard } from "@/components/trips/BoardingPassCard";
import { FlightStatusCard } from "@/components/trips/FlightStatusCard";
import { PaidWithCard } from "@/components/trips/PaidWithCard";
import { statusLine, type BoardingPass } from "@/lib/boardingPass";

// Render tests, not layout tests. There is no simulator in CI, so these exist to
// prove the Trips components actually mount — that the SVG marks, the gradient
// and the bundled hero image all resolve — and that the facts a passenger needs
// at a gate reach the screen. Pixel work is verified against the reference by
// eye; this is the part that can regress silently.

const MIN = 60_000;
const T0 = Date.parse("2026-08-19T12:00:00.000Z");

const pass: BoardingPass = {
  id: "bp_demo_cdg_u1",
  title: "Paris Trip",
  routeLabel: "New York → Paris",
  flight: {
    number: "GE352",
    aircraft: "A321",
    originCode: "JFK",
    originCity: "New York",
    destinationCode: "CDG",
    destinationCity: "Paris",
    gate: "34",
    seat: "19A",
    boardingTime: "10:20",
    departureTime: "17:20",
    arrivalTime: "07:30",
  },
  passenger: { name: "Arthur Fleck", verified: true },
  payment: { currency: "USDC", amount: 486.2, rewardsRate: 2 },
  boardingAt: new Date(T0 + 18 * MIN).toISOString(),
  departsAt: new Date(T0 + 58 * MIN).toISOString(),
  arrivesAt: new Date(T0 + 500 * MIN).toISOString(),
  status: "boarding_soon",
  createdAt: new Date(T0).toISOString(),
  minutesToBoarding: 18,
  progress: 0,
};

async function render(node: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(node);
  });
  return tree;
}

function allText(root: ReactTestInstance): string {
  return root
    .findAll((n) => n.type === "Text")
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.filter((x) => typeof x === "string").join("") : String(c ?? "");
    })
    .join("\n");
}

describe("LiveActivityCard", () => {
  it("leads with the route, the flight and the live status", async () => {
    const tree = await render(<LiveActivityCard pass={pass} statusText={statusLine(pass, T0)} />);
    const text = allText(tree.root);
    expect(text).toContain("JFK");
    expect(text).toContain("CDG");
    expect(text).toContain("GE352");
    expect(text).toContain("Boarding in 18 min");
  });

  it("carries a screen-reader label with the whole status, not just the codes", async () => {
    const tree = await render(<LiveActivityCard pass={pass} statusText={statusLine(pass, T0)} />);
    const labelled = tree.root.findAll((n) => typeof n.props.accessibilityLabel === "string");
    expect(labelled.some((n) => n.props.accessibilityLabel.includes("Boarding in 18 min"))).toBe(true);
  });
});

describe("TripHeroCard", () => {
  it("mounts with the bundled aircraft image and describes it", async () => {
    const tree = await render(<TripHeroCard title={pass.title} routeLabel={pass.routeLabel} />);
    expect(allText(tree.root)).toContain("Paris Trip");
    const images = tree.root.findAll((n) => n.props.accessibilityLabel?.includes?.("A321"));
    expect(images.length).toBeGreaterThan(0);
  });
});

describe("BoardingPassCard", () => {
  it("shows every field the gate asks for", async () => {
    const tree = await render(<BoardingPassCard pass={pass} expanded={false} onToggle={jest.fn()} />);
    const text = allText(tree.root);
    for (const fact of ["GE352", "A321", "10:20", "17:20", "34", "19A", "07:30", "Arthur Fleck"]) {
      expect(text).toContain(fact);
    }
  });

  it("keeps the origin and destination cities out of the resting state", async () => {
    // They are in the expanded panel. Showing everything at rest is what made
    // the card unscannable in the first place.
    const collapsed = allText((await render(<BoardingPassCard pass={pass} expanded={false} onToggle={jest.fn()} />)).root);
    expect(collapsed).not.toContain("New York (JFK)");

    const expanded = allText((await render(<BoardingPassCard pass={pass} expanded onToggle={jest.fn()} />)).root);
    expect(expanded).toContain("New York (JFK)");
    expect(expanded).toContain("Paris (CDG)");
  });

  it("labels the toggle for its current state", async () => {
    const tree = await render(<BoardingPassCard pass={pass} expanded={false} onToggle={jest.fn()} />);
    const toggles = tree.root.findAll((n) =>
      typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.includes("boarding pass for GE352")
    );
    expect(toggles.length).toBeGreaterThan(0);
    expect(toggles[0].props.accessibilityLabel).toContain("Show");
  });
});

describe("FlightStatusCard", () => {
  it("shows the countdown before boarding and the status label", async () => {
    const tree = await render(<FlightStatusCard pass={pass} now={T0} />);
    const text = allText(tree.root);
    expect(text).toContain("18 min");
    expect(text).toContain("Boarding Soon");
    expect(text).toContain("New York");
    expect(text).toContain("Paris");
  });

  it("falls back to the boarding clock time once boarding has started", async () => {
    const boarding = { ...pass, minutesToBoarding: null };
    const text = allText((await render(<FlightStatusCard pass={boarding} now={T0 + 20 * MIN} />)).root);
    expect(text).toContain("10:20");
    expect(text).toContain("Boarding");
  });

  it("reports the flight as in the air after departure", async () => {
    const text = allText((await render(<FlightStatusCard pass={pass} now={T0 + 90 * MIN} />)).root);
    expect(text).toContain("In the Air");
  });
});

describe("PaidWithCard", () => {
  it("states what was paid and what it earned", async () => {
    const text = allText((await render(<PaidWithCard payment={pass.payment} />)).root);
    expect(text).toContain("PAID WITH FURLPAY");
    expect(text).toContain("USDC");
    expect(text).toContain("$486.20");
    expect(text).toContain("FurlPay Rewards");
  });
});
