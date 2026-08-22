import React from "react";
import Svg, { Path } from "react-native-svg";

// The FurlPay mark — two stacked hooks that read as an `F`.
//
// The SAME traced paths the web app ships in components/trips/FurlPayLogo.tsx,
// so the mark is identical pixel-for-pixel across web, Android and iOS. The
// viewBox is the glyph's tight bounding box, so the rendered mark is exactly
// `size` tall with no invisible padding to align around.
//
// Two flat greens rather than a gradient: it reproduces the sheen the artwork
// has, and react-native-svg gradients need a document-unique id per instance —
// a footgun in a list where the same mark renders many times.

const UPPER = "M18 5H59V9A10 11 0 0 1 49 20H20C15.8 23.4 11 26.4 5 29V18A13 13 0 0 1 18 5Z";
const LOWER = "M18 27H43V35A7 7 0 0 1 36 42H20C18.5 43.9 18 45.5 18 47.6V50C18 55.6 13.4 60 5 60V37A13 10 0 0 1 18 27Z";

export function FurlPayMark({ size = 24, color }: { size?: number; color?: string }) {
  return (
    <Svg width={(size * 54) / 55} height={size} viewBox="5 5 54 55">
      <Path d={UPPER} fill={color ?? "#66DE9C"} />
      <Path d={LOWER} fill={color ?? "#74E9AC"} />
    </Svg>
  );
}
