import PayrollWorkspace from "@/components/payroll/PayrollWorkspace";
import "@/app/settlement/os.css";
import "@/components/merchant/merchant.css";
export const metadata = { title: "Payroll | FurlPay", robots: { index: false, follow: false } };
export default function PayrollPage() {
  return <PayrollWorkspace />;
}
