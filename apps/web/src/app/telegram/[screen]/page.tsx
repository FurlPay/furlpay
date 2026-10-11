import { notFound } from "next/navigation";
import { ActivityScreen, CardsScreen, HomeScreen, ProfileScreen, TravelScreen, WalletScreen } from "@/components/telegram/AccountScreens";
import PayScreen from "@/components/telegram/PayScreen";

export default async function TelegramScreen({ params, searchParams }: { params: Promise<{ screen: string }>; searchParams: Promise<{ filter?: string; detail?: string }> }) {
  const { screen } = await params;
  switch (screen) {
    case "home": return <HomeScreen />;
    case "cards": { const { detail } = await searchParams; return <CardsScreen openDetails={detail === "subscriptions"} />; }
    case "pay": return <PayScreen />;
    case "activity": { const { filter } = await searchParams; return <ActivityScreen initialFilter={filter === "card" ? "card" : "all"} />; }
    case "wallet": return <WalletScreen />;
    case "profile": return <ProfileScreen />;
    case "travel": return <TravelScreen />;
    default: notFound();
  }
}
