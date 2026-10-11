// The homepage sections are siblings, so the search panel hands a request to
// the AI Trip Planner with a DOM event instead of lifting state into the page.

export const PLAN_EVENT = "furlpay:travel-plan";

export function requestPlan(query: string): void {
  window.dispatchEvent(new CustomEvent<string>(PLAN_EVENT, { detail: query }));
}
