import { talsecStart, setThreatListeners } from 'freerasp-react-native';
import { Platform } from 'react-native';

// State to track if freeRASP detected a compromise
let compromised = false;

export function isDeviceCompromised(): boolean {
  return compromised;
}

export async function startTamperDetection(): Promise<void> {
  const config = {
    androidConfig: {
      packageName: 'com.furlpay.mobile',
      certificateHashes: ['TODO_CERT_HASH'],
      supportedAlternativeStores: [],
    },
    iosConfig: {
      appBundleId: 'com.furlpay.mobile',
      appTeamId: 'YOUR_TEAM_ID',
    },
    watcherMail: 'security@furlpay.com',
    isProd: true,
  };

  const actions = {
    privilegedAccess: () => { compromised = true; },
    debug: () => { compromised = true; },
    simulator: () => { compromised = true; },
    appIntegrity: () => { compromised = true; },
    unofficialStore: () => { },
    hooks: () => { compromised = true; },
    deviceBinding: () => { compromised = true; },
    secureHardwareNotAvailable: () => { },
    passcodeNotSet: () => { },
    systemVPN: () => {},
    obfuscationIssues: () => { compromised = true; },
    devMode: () => { compromised = true; }
  };

  try {
    // Attempt cast to any to cover missing action typings if any
    await setThreatListeners(actions as any);
    await talsecStart(config);
  } catch (e) {
    console.warn('Error starting tamper detection', e);
  }
}
