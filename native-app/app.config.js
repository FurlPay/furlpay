const fs = require("fs");
const path = require("path");

// Layered on top of app.json: adds the Firebase config ONLY when
// google-services.json is present, so the app builds before the Firebase
// project exists (push then fails soft — see lib/push.ts). Drop the file in
// from Firebase console → Project settings → your Android app, and the next
// prebuild picks it up. The file is gitignored (it contains API key IDs).
module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, "google-services.json");
  if (fs.existsSync(googleServices)) {
    config.android = { ...config.android, googleServicesFile: "./google-services.json" };
  }
  return config;
};
