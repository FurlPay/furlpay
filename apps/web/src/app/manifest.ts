import type { MetadataRoute } from "next";

// PWA manifest — drives the "Add to Home Screen" name, theme, and icon on
// mobile so the installed web app shows the Furlpay mark.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Furlpay",
    short_name: "Furlpay",
    description: "The on-chain financial operating system.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icon.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
