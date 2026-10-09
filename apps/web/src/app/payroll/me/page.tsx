import ContractorProfile from "@/components/payroll/ContractorProfile";
import "@/app/settlement/os.css";
import "@/components/merchant/merchant.css";
export const metadata = { title: "Your payroll | FurlPay", robots: { index: false, follow: false } };
export default function ContractorPayrollPage() {
  return <ContractorProfile />;
}
