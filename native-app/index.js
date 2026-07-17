// Custom entry point. The crypto polyfill MUST run before any app module loads
// (Hermes has no global `crypto` — see lib/cryptoPolyfill.ts), so it is imported
// before expo-router/entry, which registers the app root.
import "./lib/cryptoPolyfill";
import "expo-router/entry";
