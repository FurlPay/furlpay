import { notFound,redirect } from "next/navigation";
import MerchantWorkspace,{type MerchantSection} from "@/components/merchant/MerchantWorkspace";
import "@/app/settlement/os.css";
import "@/components/merchant/merchant.css";
export const metadata={title:"Merchant payments | FurlPay",robots:{index:false,follow:false}};
export default async function MerchantPage({params}:{params:Promise<{merchant:string[]}>}) {
  const {merchant}=await params;
  const aliases:Record<string,string>={balances:"/settlement/treasury/balances",settlements:"/settlement/payouts/send",developers:"/settlement/developers","developers/webhooks":"/dashboard/webhooks", "admin/reconciliation":"/settlement/reconcile"};
  const key=merchant.join("/");if(Object.hasOwn(aliases,key))redirect(aliases[key]);
  if(!["payments","payment-links","invoices","qr"].includes(merchant[0])||merchant.length>2||(merchant.length===2&&(merchant[0]!=="payments"||! /^[0-9a-f-]{36}$/i.test(merchant[1]))))notFound();
  return <MerchantWorkspace section={merchant[0] as MerchantSection} initialPaymentId={merchant[1]}/>;
}
