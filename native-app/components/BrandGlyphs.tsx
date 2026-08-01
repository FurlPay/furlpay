import React from "react";
import Svg, { Path } from "react-native-svg";

// Brand glyphs for the social share row — WhatsApp, Telegram, X.
//
// These are the SAME vector paths the web app ships in ScanToPay.tsx, drawn
// with react-native-svg so they render identically here. Official brand marks,
// no emoji: an emoji brand icon is off-brand and, on Android, frequently a tofu
// box. Each is a single white path meant to sit on the brand's own colour tile.

export function WhatsAppGlyph({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <Path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .3-3.4-.7-2.9-1.2-4.7-4.1-4.9-4.3-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .6l-.4.6-.5.5c-.1.2-.3.3-.1.7.2.3.8 1.4 1.8 2.2 1.2 1.1 2.3 1.4 2.6 1.6.3.2.5.1.7-.1l1-1.2c.2-.3.4-.2.7-.1l2 1c.3.1.5.2.6.3 0 .2 0 .8-.2 1.4Z" />
    </Svg>
  );
}

export function TelegramGlyph({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <Path d="m21.9 4.6-3 14.3c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.3.3-.5.5-.9.5l.3-4.7L18.4 6c.4-.3-.1-.5-.6-.2L7.3 12.4l-4.5-1.4c-1-.3-1-1 .2-1.4L20.6 3.2c.8-.3 1.5.2 1.3 1.4Z" />
    </Svg>
  );
}

export function XGlyph({ size = 17 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
      <Path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.2l7.3-8.3L1.4 2h6.5l4.4 5.9L18.9 2Zm-1.1 18.1h1.7L7 3.8H5.1l12.7 16.3Z" />
    </Svg>
  );
}
