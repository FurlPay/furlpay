import { DocTitle, Lead, H2, P, UL, LI, Code, Callout, EndpointTable, ParameterTable, DocPager } from "@/components/docs/prose";
import { docMeta } from "@/lib/docs/meta";

export const metadata = docMeta("/docs/integrations/telegram");

export default function TelegramPage() {
  return (
    <article>
      <DocTitle eyebrow="Integrations">Telegram Mini App</DocTitle>
      <Lead>
        The Mini App at <Code>/telegram</Code> is a compact view of an existing FurlPay account
        inside Telegram. It adds a way to sign in from Telegram. It does not create a second
        account, a second session system or a separate balance.
      </Lead>

      <Callout type="warning" title="Read-only for money">
        The Mini App reports <Code>transfers: false</Code>. It shows balances and activity from the
        same account the web app uses; it cannot send a payment. Cards appear only if card issuing
        is enabled on the deployment, which it currently is not.
      </Callout>

      <H2 id="screens">Screens</H2>
      <P>
        Home, cards, pay, activity, profile, wallet and travel, each at{" "}
        <Code>/telegram/&lt;screen&gt;</Code>. A launch link may carry a start parameter naming one
        of these screens. The start parameter is a navigation hint only; it never carries an
        account, a token or a payment.
      </P>

      <H2 id="auth">How sign-in works</H2>
      <UL>
        <LI>Telegram passes the Mini App a signed launch string. The server verifies it with the bot token (HMAC-SHA256), rejects duplicate or malformed fields, rejects bots, and requires the launch to be recent (default 300 seconds, configurable from 30 to 600).</LI>
        <LI>If the Telegram user is not linked to a FurlPay account, the response is <Code>link_required</Code> and no session is created.</LI>
        <LI>If it is linked, the server issues the normal FurlPay session cookie. A signed launch is a one-use credential: it is recorded when used, including when the browser already holds a session, and a second attempt to create a session from it is refused.</LI>
        <LI>Inside Telegram&apos;s embedded browser the session cookie is issued with attributes suited to an embedded context. Remembering that context does not grant authentication.</LI>
        <LI>Locked or deleted accounts are refused. If a different FurlPay account is already signed in, the response is <Code>409</Code> and the user must sign out first.</LI>
      </UL>

      <H2 id="linking">Linking an account</H2>
      <P>
        Linking proves the person controls both identities. The user must be signed in to FurlPay
        and must have completed a fresh step-up (passkey, or email or phone code) within the last
        five minutes; guest sessions cannot link. A Telegram account can be linked to one FurlPay
        account. Neither side can be claimed twice, even by concurrent requests.
      </P>
      <P>
        The signed-in account can remove its own link. Unlinking needs the same fresh authentication,
        so a stolen session cannot quietly detach the owner&apos;s sign-in method. Sessions already
        issued are not revoked by unlinking; signing out of FurlPay does that.
      </P>

      <H2 id="api">API</H2>
      <EndpointTable
        rows={[
          { method: "POST", path: "/api/auth/telegram", desc: "Verify a launch and sign in; returns active or link_required" },
          { method: "POST", path: "/api/miniapp/telegram-link", desc: "Link the verified Telegram user to the signed-in account (fresh authentication required)" },
          { method: "DELETE", path: "/api/miniapp/telegram-link", desc: "Remove the signed-in account's own link (fresh authentication required)" },
          { method: "GET", path: "/api/miniapp/account", desc: "Narrow account view: profile name, verification state, balances, last 200 activity rows, capabilities" },
          { method: "POST", path: "/api/telegram/webhook", desc: "Bot updates from Telegram, authenticated by the secret-token header" },
        ]}
      />
      <P>
        The account view is a whitelist. It never returns a full profile, card numbers, the security
        object, a placeholder deposit address or an invented blockchain receipt.
      </P>

      <H2 id="setup">Setup</H2>
      <ParameterTable
        params={[
          { name: "TELEGRAM_BOT_TOKEN", type: "secret", required: true, desc: "Server-only. Used to verify launches." },
          { name: "TELEGRAM_WEBHOOK_SECRET", type: "secret", required: true, desc: "Must match the secret token registered with Telegram's setWebhook. Requests without it get 401." },
          { name: "TELEGRAM_AUTH_MAX_AGE_SECONDS", type: "number", required: false, desc: "Launch freshness window, 30 to 600. Default 300." },
          { name: "NEXT_PUBLIC_TELEGRAM_BOT_USERNAME", type: "public", required: false, desc: "Bot username without the @, as confirmed by BotFather. Leave unset until the Mini App is configured; browser preview still works." },
          { name: "NEXT_PUBLIC_TELEGRAM_APP_SHORT_NAME", type: "public", required: false, desc: "Short name for a named Mini App. Leave blank for the bot's main Mini App." },
        ]}
      />
      <UL>
        <LI>Migration <Code>0050_telegram_account_links</Code> stores identity links only.</LI>
        <LI>It reuses <Code>FURLPAY_SESSION_SECRET</Code>, the Supabase credentials and the Upstash Redis credentials. There is no second auth store.</LI>
        <LI>In BotFather, set the Mini App URL to <Code>https://&lt;your-domain&gt;/telegram</Code>. <Code>npm run telegram:setup</Code> is an operator command that configures the bot; <Code>TELEGRAM_MINI_APP_URL</Code> is read by that command only, not by the app.</LI>
      </UL>

      <H2 id="troubleshooting">Troubleshooting</H2>
      <ParameterTable
        params={[
          { name: "503 temporarily_unavailable", type: "sign-in", required: true, desc: "The rate limiter could not reach its key-value store and refused the request. Sign-in is rate limited before anything else runs, and in production it fails closed without that store." },
          { name: "503 Telegram sign-in is temporarily unavailable", type: "sign-in", required: true, desc: "The bot token is missing, the database is not configured, or the production key-value store is not available." },
          { name: "401 Invalid or expired Telegram session", type: "sign-in", required: true, desc: "The launch string failed verification or is older than the freshness window. Close and reopen the Mini App." },
          { name: "401 This launch was already used", type: "sign-in", required: true, desc: "The launch string has already created a session. Close and reopen the Mini App." },
          { name: "403 Invalid request origin", type: "sign-in", required: true, desc: "The request did not come from the deployment's own origin." },
          { name: "409", type: "sign-in / link", required: true, desc: "A different FurlPay account is signed in, or one of the two accounts is already linked." },
          { name: "401 on the webhook", type: "bot", required: true, desc: "The secret-token header does not match TELEGRAM_WEBHOOK_SECRET." },
        ]}
      />

      <DocPager pathname="/docs/integrations/telegram" />
    </article>
  );
}
