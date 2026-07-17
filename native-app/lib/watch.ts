import { requireOptionalNativeModule } from "expo-modules-core";
import { Linking } from "react-native";
import * as SecureStore from "expo-secure-store";

// ---------------------------------------------------------------------------
// Watch connectivity for the /watch screen, over the local WearBridge module
// (modules/wear-bridge). Detection is REAL (NodeClient lists paired watches
// for any app); the Data Layer sync itself lives in the FurlPay Guardian
// companion app (com.furlpay.guardian) because Wearable messages only route
// between same-package phone/watch apps — this app is com.furlpay.app.
//
// requireOptionalNativeModule: the bridge is absent in Expo Go / on builds
// that predate the module — every caller must handle `bridgeAvailable=false`
// honestly instead of pretending to search.
// ---------------------------------------------------------------------------

export interface WatchNode {
  id: string;
  name: string;
  isNearby: boolean;
}

interface WearBridge {
  getConnectedWatches(): Promise<WatchNode[]>;
  isGuardianInstalled(): boolean;
  openGuardian(): boolean;
}

const bridge = requireOptionalNativeModule<WearBridge>("WearBridge");

export const bridgeAvailable = bridge != null;

export const GUARDIAN_PACKAGE = "com.furlpay.guardian";
const PLAY_URL = `market://details?id=${GUARDIAN_PACKAGE}`;
const PLAY_WEB_URL = `https://play.google.com/store/apps/details?id=${GUARDIAN_PACKAGE}`;

const PAIRED_KEY = "furlpay.watch.paired";

export async function getConnectedWatches(): Promise<WatchNode[]> {
  if (!bridge) return [];
  try {
    return await bridge.getConnectedWatches();
  } catch {
    return [];
  }
}

export function isGuardianInstalled(): boolean {
  if (!bridge) return false;
  try {
    return bridge.isGuardianInstalled();
  } catch {
    return false;
  }
}

/** Launch Guardian for sign-in + watch sync; Play Store when not installed. */
export async function openGuardianOrStore(): Promise<"opened" | "store"> {
  if (bridge?.openGuardian()) return "opened";
  try {
    await Linking.openURL(PLAY_URL);
  } catch {
    await Linking.openURL(PLAY_WEB_URL).catch(() => {});
  }
  return "store";
}

/** Persisted "the user completed the connect flow" marker + watch name. */
export async function getPairedWatchName(): Promise<string | null> {
  return SecureStore.getItemAsync(PAIRED_KEY);
}

export async function setPairedWatchName(name: string | null): Promise<void> {
  if (name) await SecureStore.setItemAsync(PAIRED_KEY, name);
  else await SecureStore.deleteItemAsync(PAIRED_KEY);
}
