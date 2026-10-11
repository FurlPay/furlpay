import { notFound } from "next/navigation";
import HostedCheckout from "@/components/merchant/HostedCheckout";
import "@/app/settlement/os.css";
import "@/components/merchant/merchant.css";
export const metadata={title:"Secure payment | FurlPay",robots:{index:false,follow:false},referrer:"no-referrer" as const};
export default async function PaymentPage({params}:{params:Promise<{slug:string}>}) {
  const {slug}=await params;if(!/^[A-Za-z0-9_-]{24}$/.test(slug))notFound();return <HostedCheckout slug={slug}/>;
}
