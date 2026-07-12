import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";

// Entry route: hand off to the right group. The root layout has already
// handled the loading/locked states before this renders.
export default function Index() {
  const status = useAuth((s) => s.status);
  return <Redirect href={status === "signedIn" ? "/(tabs)" : "/(auth)/login"} />;
}
