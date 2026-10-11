import WebhookSettings from "@/components/merchant/WebhookSettings";
import "@/app/settlement/os.css";
import "@/components/merchant/merchant.css";
export const metadata = { title: "Webhooks | FurlPay", robots: { index: false, follow: false } };
export default function WebhooksPage() {
  return <WebhookSettings />;
}
