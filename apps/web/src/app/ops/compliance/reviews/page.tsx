import type { Metadata } from "next";
import "../../../settlement/settlement.css";
import "../../../settlement/os.css";
import "../../../settlement/os-app.css";
import ReviewQueue from "@/components/settlement/review/ReviewQueue";

// Access is enforced by the API (requireRole("compliance_officer")); the page
// renders nothing case-specific until the server answers.
export const metadata: Metadata = { title: "Onboarding reviews · FurlPay", robots: { index: false, follow: false } };

export default function ComplianceReviewsPage() {
  return <ReviewQueue />;
}
