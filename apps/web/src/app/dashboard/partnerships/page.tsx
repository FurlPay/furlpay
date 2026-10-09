import InquiryConsole from "@/components/partnerships/InquiryConsole";

// Data comes from /api/admin/partnerships, which requires the admin role.
export const metadata = { title: "Partnership inquiries | FurlPay", robots: { index: false, follow: false } };
export default function PartnershipInquiriesPage() {
  return <div className="min-h-screen bg-[#020c09]"><InquiryConsole /></div>;
}
