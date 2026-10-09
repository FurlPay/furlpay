import { seoMetadata } from "@/lib/seo/meta";

export const metadata = seoMetadata({
  title: "Restaurant Reservations",
  description: "Find restaurants at your destination while you travel.",
  path: "/travel/restaurants",
});

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
