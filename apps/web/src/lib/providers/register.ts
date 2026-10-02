import { providerRegistry } from "./router";
import { furlgatewayOnrampAdapter } from "./adapters/furlgateway-onramp";
import { furlgatewayOfframpAdapter } from "./adapters/furlgateway-offramp";
import { furlbridgeOnramp } from "./adapters/furlbridge-onramp";
import { furlbridgeOfframp } from "./adapters/furlbridge-offramp";
import { rampEnv } from "./rampEnv";

// ---------------------------------------------------------------------------
// Provider registration — idempotent, called by the ramp routes.
//
// An adapter is registered only when its credentials are present. Registration
// does NOT make money move: the capability matrix (capability.ts) still gates
// every corridor on contractStatus "live", VDA acceptance, credentials and
// amount bounds, and ONRAMP_LIVE / OFFRAMP_LIVE are `unimplemented`.
//
// HEALTH IS NOT ASSUMED. An earlier draft marked every registered adapter
// "healthy" at boot. The router treats an unprobed provider as unusable
// ("unknown"), and that is the right default: health is earned by a probe or a
// successful call, never declared by having an API key.
//
// FurlPayout (Echo) is deliberately never registered: its API and webhook
// scheme are unverified (adapters/furlpayout-offramp.ts).
// ---------------------------------------------------------------------------

let registered = false;

export function registerProviders(): void {
  if (registered) return;
  registered = true;

  if (rampEnv("FURLGATEWAY_API_KEY_ID") && rampEnv("FURLGATEWAY_API_KEY_SECRET")) {
    providerRegistry.register(furlgatewayOnrampAdapter);
    providerRegistry.register(furlgatewayOfframpAdapter);
  }

  if (rampEnv("FURLBRIDGE_API_KEY") && rampEnv("FURLBRIDGE_ACCESS_TOKEN")) {
    providerRegistry.register(furlbridgeOnramp);
    if (rampEnv("FURLBRIDGE_SECRET_KEY")) providerRegistry.register(furlbridgeOfframp);
  }
}

