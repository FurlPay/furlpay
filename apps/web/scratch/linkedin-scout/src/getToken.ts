// ---------------------------------------------------------------------------
// getToken.ts — Quick OAuth2 token generator for LinkedIn API.
//
// Usage:  npm run get-token
//
// Opens your browser to LinkedIn's authorization page. After you approve,
// it captures the auth code and exchanges it for an access token.
// ---------------------------------------------------------------------------

import http from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";
import { ROOT } from "./config.js";
import { banner } from "./utils.js";

// ---------------------------------------------------------------------------
// Config — from .env or hardcoded for first-time setup
// ---------------------------------------------------------------------------

const ENV_PATH = path.join(ROOT, ".env");

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    const lines = fs.readFileSync(ENV_PATH, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const [key, ...rest] = trimmed.split("=");
      env[key.trim()] = rest.join("=").trim().replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = loadEnv();

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID ?? env.LINKEDIN_CLIENT_ID ?? "77oaxyc0zjiquo";
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET ?? env.LINKEDIN_CLIENT_SECRET ?? "";
const REDIRECT_URI = "http://localhost:3000/callback";

// Scopes — use only the ones currently approved for your app.
// Once Community Management API is approved, add:
//   "w_organization_social", "r_organization_social", "rw_organization_admin"
const SCOPES = [
  "openid",
  "profile",
  "email",
  "w_member_social",
].join(" ");

// ---------------------------------------------------------------------------
// OAuth2 Flow
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  banner("LinkedIn OAuth2 Token Generator");

  if (!CLIENT_SECRET) {
    console.log("❌ Missing CLIENT_SECRET.\n");
    console.log(`Edit your .env file at: ${ENV_PATH}`);
    console.log("Add these lines:\n");
    console.log('LINKEDIN_CLIENT_ID="77oaxyc0zjiquo"');
    console.log('LINKEDIN_CLIENT_SECRET="your_client_secret_here"');
    console.log('LINKEDIN_ORG_ID="your_company_page_id"');
    console.log("");
    return;
  }

  // Build the authorization URL
  const authUrl = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("state", "furlpay_oauth_" + Date.now());

  console.log("🔑 Step 1: Open this URL in your browser:\n");
  console.log(`   ${authUrl.toString()}\n`);
  console.log("🔑 Step 2: Sign in and click 'Allow'");
  console.log("🔑 Step 3: You'll be redirected to localhost — the script will capture the code.\n");
  console.log("⏳ Waiting for callback on http://localhost:3000/callback …\n");

  // Start a local server to capture the redirect
  const code = await waitForAuthCode();

  if (!code) {
    console.log("❌ No authorization code received.");
    return;
  }

  console.log(`✅ Got authorization code: ${code.slice(0, 20)}…\n`);
  console.log("📤 Exchanging for access token…\n");

  // Exchange auth code for access token
  const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.log(`❌ Token exchange failed: HTTP ${tokenRes.status}`);
    console.log(`   ${errText}`);
    return;
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    scope?: string;
  };

  console.log("🎉 SUCCESS! Here is your access token:\n");
  console.log("═".repeat(60));
  console.log(tokenData.access_token);
  console.log("═".repeat(60));
  console.log(`\n⏰ Expires in: ${Math.round(tokenData.expires_in / 86400)} days`);
  if (tokenData.scope) {
    console.log(`📋 Scopes: ${tokenData.scope}`);
  }

  // Auto-save to .env
  let envContent = "";
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, "utf-8");
  }

  // Update or add the access token
  if (envContent.includes("LINKEDIN_ACCESS_TOKEN=")) {
    envContent = envContent.replace(
      /LINKEDIN_ACCESS_TOKEN=.*/,
      `LINKEDIN_ACCESS_TOKEN="${tokenData.access_token}"`
    );
  } else {
    envContent += `\nLINKEDIN_ACCESS_TOKEN="${tokenData.access_token}"\n`;
  }

  fs.writeFileSync(ENV_PATH, envContent);
  console.log(`\n💾 Token saved to ${ENV_PATH}`);
  console.log("\n✅ You're all set! Try: npm run api-test");
}

function waitForAuthCode(): Promise<string | null> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:3000`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:white;text-align:center">
              <h1>❌ Authorization Failed</h1>
              <p>${url.searchParams.get("error_description") ?? error}</p>
              <p>You can close this tab.</p>
            </body></html>
          `);
          server.close();
          resolve(null);
          return;
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html><body style="font-family:system-ui;padding:40px;background:#0a0a0a;color:#34C759;text-align:center">
            <h1>✅ Authorization Successful!</h1>
            <p style="color:#999">FurlPay LinkedIn API is now connected.</p>
            <p style="color:#666">You can close this tab and return to your terminal.</p>
          </body></html>
        `);
        server.close();
        resolve(code);
      }
    });

    server.listen(3000, () => {
      console.log("🌐 Local server running on http://localhost:3000");
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      resolve(null);
    }, 5 * 60 * 1000);
  });
}

run().catch(console.error);
