import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { AppState, Platform } from "react-native";
import { API_BASE, getToken } from "@/lib/api";
import { registerSink } from "./index";
import { createFurlpaySink } from "./furlpaySink";

// Wires the FurlPay API sink with the real platform dependencies. Called once
// from the root layout. Uploads every 60s while the app is in the foreground
// and once when it goes to the background; never at launch-critical moments.
let registered = false;

export function registerFurlpaySink(): void {
  if (registered || (Platform.OS !== "android" && Platform.OS !== "ios")) return;
  registered = true;
  const cfg = Constants.expoConfig;
  const sink = createFurlpaySink({
    storage: AsyncStorage,
    fetchImpl: fetch,
    getToken,
    apiBase: API_BASE,
    platform: Platform.OS,
    appVersion: cfg?.version ?? null,
    buildNumber: (Platform.OS === "android" ? String(cfg?.android?.versionCode ?? "") : cfg?.ios?.buildNumber ?? "") || null,
    osVersion: String(Platform.Version).slice(0, 40),
    uuid: () => Crypto.randomUUID(),
    now: () => Date.now(),
  });
  registerSink(sink);
  setInterval(() => {
    if (AppState.currentState === "active") void sink.upload().catch(() => undefined);
  }, 60_000);
  AppState.addEventListener("change", (s) => {
    if (s === "background") void sink.upload().catch(() => undefined);
  });
}
