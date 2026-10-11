import JoinPayroll from "@/components/payroll/JoinPayroll";
import "@/app/settlement/os.css";
import "@/components/merchant/merchant.css";
// Public: the invite token lives in the URL fragment; the page sends people to sign in only when the API asks.
export const metadata = { title: "Join payroll | FurlPay", robots: { index: false, follow: false } };
export default function JoinPayrollPage() {
  return <JoinPayroll />;
}
