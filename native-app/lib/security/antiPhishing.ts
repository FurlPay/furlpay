import * as SecureStore from 'expo-secure-store';
import { DEVICE_ONLY } from '../storageOptions';

const ANTI_PHISHING_KEY = 'anti_phishing_phrase';

export async function getAntiPhishingPhrase(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ANTI_PHISHING_KEY, DEVICE_ONLY);
  } catch {
    return null;
  }
}

export async function setAntiPhishingPhrase(phrase: string): Promise<void> {
  const cleanPhrase = phrase.trim();
  if (cleanPhrase.length < 3 || cleanPhrase.length > 32) {
    throw new Error('Phrase must be between 3 and 32 characters');
  }
  if (!/^[a-zA-Z0-9 ]+$/.test(cleanPhrase)) {
    throw new Error('Phrase can only contain letters, numbers, and spaces');
  }
  await SecureStore.setItemAsync(ANTI_PHISHING_KEY, cleanPhrase, DEVICE_ONLY);
}

export async function hasAntiPhishingPhrase(): Promise<boolean> {
  const phrase = await getAntiPhishingPhrase();
  return phrase !== null;
}
