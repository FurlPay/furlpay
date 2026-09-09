// Custom entry point. Import order here is load-bearing three times over.
//
// 1. `@walletconnect/react-native-compat` MUST be the very first import in the
//    process. It installs the globals the relay client assumes exist before it
//    is constructed — TextEncoder/TextDecoder, a `global.Buffer`, URL/
//    URLSearchParams and the crypto surface it probes at module scope. Imported
//    later, WalletKit.init() fails with errors that name none of that, and
//    pairing dies with "cannot read property of undefined" from inside a
//    minified vendor bundle.
//
// 2. `react-native-get-random-values` backs the compat layer's crypto
//    expectations with a native CSPRNG. It is imported explicitly rather than
//    relied upon transitively, so the dependency is visible at the entry point
//    where the ordering matters.
//
// 3. Our own crypto polyfill still runs before any APP module (Hermes has no
//    global `crypto` — see lib/cryptoPolyfill.ts). It is deliberately AFTER the
//    two above: both install their own crypto surface, and cryptoPolyfill only
//    fills what is still missing (every assignment is guarded by a typeof
//    check), so it completes the picture rather than fighting over it.
import "@walletconnect/react-native-compat";
import "react-native-get-random-values";
import "./lib/cryptoPolyfill";
import "expo-router/entry";
