import { Linking } from 'react-native';

export const openPhantomDeepLink = (url: string) => {
  const phantomUrl = `phantom://v1/browse/${encodeURIComponent(url)}`;
  Linking.openURL(phantomUrl);
};

export const openSolflareDeepLink = (url: string) => {
  const solflareUrl = `solflare://browse/${encodeURIComponent(url)}`;
  Linking.openURL(solflareUrl);
};
