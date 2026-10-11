import OperationsConsole from "@/components/merchant/OperationsConsole";
import "@/app/settlement/os.css";
import "@/components/merchant/merchant.css";
// Data comes from /api/merchant/operations, which requires the admin or compliance role.
export const metadata = { title: "Merchant operations | FurlPay", robots: { index: false, follow: false } };
export default function OperationsPage() {
  return <OperationsConsole />;
}
