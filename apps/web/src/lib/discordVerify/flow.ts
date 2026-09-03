// ---------------------------------------------------------------------------
// The verification flow, as three signed HTTP interactions.
//
//   [Verify]  ──▶  ephemeral: captcha image + [Enter code]
//                                   │
//                                   ▼
//                              MODAL: type the code
//                                   │
//                                   ▼
//                     grant Verified, then point at the role picker
//
// ── WHY THREE STEPS AND NOT TWO ────────────────────────────────────────────
//
// The obvious design is "click Verify, get a modal, type the code". It cannot
// work: a Discord modal contains text inputs and nothing else — no image, no
// embed — so there is nowhere to show the picture. The captcha therefore has to
// live in an ephemeral MESSAGE, and the modal is opened from a button on it.
//
// ── WHY A MODAL AT ALL ─────────────────────────────────────────────────────
//
// The alternative is a row of buttons with candidate answers, which is one
// interaction shorter and 1-in-4 guessable. A typed answer over a 31-character
// alphabet is not guessable, and the whole point of the gate is to cost
// automation more than it costs a person.
//
// ── EVERY BRANCH ANSWERS ───────────────────────────────────────────────────
//
// Discord gives three seconds and shows the member a red "interaction failed"
// if nothing arrives. Every path below returns a reply, including the ones that
// are really server faults, because "something went wrong, try again" is
// strictly more useful to a new member than a generic failure they cannot act
// on.
// ---------------------------------------------------------------------------

import { log } from "@/lib/log";
import { kvIncr } from "@/lib/kv";
import { VERIFIED_ROLE_NAME } from "@/lib/discordRoles/catalog";
import { addRole, botHighestRolePosition, botUserId, canManageRole, listRoles } from "@/lib/discordRoles/rest";
import { CAPTCHA_CODE_LENGTH, checkChallenge, issueChallenge } from "./challenge";

const EPHEMERAL = 1 << 6;
const BRAND_GREEN = 0x00e599;
const RED = 0xed4245;

/** Component and callback type ids used here. */
const ACTION_ROW = 1;
const BUTTON = 2;
const TEXT_INPUT = 4;
const CHANNEL_MESSAGE_WITH_SOURCE = 4;
const MODAL = 9;

export const VERIFY_START_ID = "verify:v1:start";
const OPEN_PREFIX = "verify:v1:open:";
const SUBMIT_PREFIX = "verify:v1:submit:";
const CODE_INPUT_ID = "code";

/** How many challenges one member may request per window. Stops someone
 *  spinning the button to farm images or burn KV writes. */
const START_LIMIT = 6;
const START_WINDOW_SECONDS = 300;

type Reply = { type: number; data: Record<string, unknown> };

function ephemeral(data: Record<string, unknown>): Reply {
  return {
    type: CHANNEL_MESSAGE_WITH_SOURCE,
    data: { ...data, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}

/** Where Discord should fetch the captcha image from. */
function origin(): string {
  const o = process.env.FURLPAY_ORIGIN?.trim();
  return o && /^https:\/\//.test(o) ? o.replace(/\/$/, "") : "https://furlpay.com";
}

// ---------------------------------------------------------------------------
// The panel that lives permanently in the verify channel.
// ---------------------------------------------------------------------------
export function buildVerifyPanel(): Record<string, unknown> {
  return {
    embeds: [
      {
        color: BRAND_GREEN,
        title: "🔐 Verification required",
        description:
          "Welcome to FurlPay. To keep the server free of spam and scam accounts, " +
          "please verify before you get access.\n\n" +
          "Click **Verify**, read the code in the picture, and type it in.",
        fields: [
          {
            name: "Before you go any further",
            value:
              "FurlPay will **never** DM you first, never ask for your seed phrase or private key, " +
              "and never ask you to \"verify\" a wallet. Anyone who does is not us.",
          },
        ],
        footer: { text: "FurlPay Community" },
      },
    ],
    components: [
      {
        type: ACTION_ROW,
        components: [
          { type: BUTTON, style: 3 /* success/green */, label: "Verify", custom_id: VERIFY_START_ID, emoji: { name: "🔐" } },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

// ---------------------------------------------------------------------------
// Step 1 — issue a challenge and show its picture.
// ---------------------------------------------------------------------------
async function startVerification(userId: string, guildId: string): Promise<Reply> {
  // Per-member throttle. Keyed on the member, not the IP: every one of these
  // requests arrives from Discord's infrastructure, so an IP limit would
  // throttle the whole server together.
  try {
    const n = await kvIncr(`discord:verify:start:${userId}`, START_WINDOW_SECONDS);
    if (n > START_LIMIT) {
      return ephemeral({ content: "You've requested a lot of codes just now. Wait a few minutes and try again." });
    }
  } catch {
    // A counter outage must not lock people out of the server.
  }

  const issued = await issueChallenge(userId, guildId);
  if (!issued) {
    return ephemeral({ content: "Couldn't start verification just now. Please try again in a moment." });
  }

  return ephemeral({
    embeds: [
      {
        color: BRAND_GREEN,
        title: "Solve the captcha",
        description: `Read the ${CAPTCHA_CODE_LENGTH} characters in the image, then click **Enter code**.`,
        image: { url: `${origin()}/api/og/captcha/${issued.id}` },
        footer: { text: "The code is not case sensitive and expires in 5 minutes." },
      },
    ],
    components: [
      {
        type: ACTION_ROW,
        components: [
          {
            type: BUTTON,
            style: 1 /* primary */,
            label: "Enter code",
            custom_id: `${OPEN_PREFIX}${issued.id}`,
          },
        ],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Step 2 — open the modal. No state changes here; the id just rides along.
// ---------------------------------------------------------------------------
function openCodeModal(challengeId: string): Reply {
  return {
    type: MODAL,
    data: {
      custom_id: `${SUBMIT_PREFIX}${challengeId}`,
      title: "Enter the captcha code",
      components: [
        {
          type: ACTION_ROW,
          components: [
            {
              type: TEXT_INPUT,
              custom_id: CODE_INPUT_ID,
              label: `The ${CAPTCHA_CODE_LENGTH} characters in the image`,
              style: 1 /* short */,
              min_length: CAPTCHA_CODE_LENGTH,
              max_length: CAPTCHA_CODE_LENGTH,
              required: true,
              placeholder: "e.g. K7M2Q",
            },
          ],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Step 3 — check the answer and grant the role.
// ---------------------------------------------------------------------------
async function submitCode(
  challengeId: string,
  userId: string,
  guildId: string,
  answer: string,
  token: string
): Promise<Reply> {
  const result = await checkChallenge(challengeId, userId, answer);

  if (!result.ok) {
    const message =
      result.reason === "expired"
        ? "That code has expired. Click **Verify** again for a new one."
        : result.reason === "wrong-user"
          ? "That challenge was issued to someone else. Click **Verify** to get your own."
          : result.reason === "exhausted"
            ? "Too many wrong attempts. Click **Verify** for a fresh code."
            : `That's not right — ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? "" : "s"} left. Click **Enter code** to try again.`;
    return ephemeral({ embeds: [{ color: RED, title: "Not verified", description: message }] });
  }

  // Solved. Now the part that can still fail for reasons the member cannot fix.
  const roles = await listRoles(token, guildId);
  if (!roles.ok) {
    return ephemeral({
      content: "✅ Captcha solved, but I couldn't reach the server's roles. Please ping a moderator.",
    });
  }

  const verified = roles.data.find((r) => r.name.toLowerCase() === VERIFIED_ROLE_NAME.toLowerCase());
  if (!verified) {
    log.error("verify: Verified role missing", { guildId });
    return ephemeral({
      content: `✅ Captcha solved, but the **${VERIFIED_ROLE_NAME}** role does not exist yet. Please ping a moderator.`,
    });
  }

  const self = await botUserId(token);
  if (self) {
    const pos = await botHighestRolePosition(token, guildId, self);
    if (pos.ok && !canManageRole(verified, pos.data).ok) {
      log.error("verify: blocked by role hierarchy", { guildId });
      return ephemeral({
        content:
          `✅ Captcha solved, but I can't assign **${VERIFIED_ROLE_NAME}** — my role needs to sit above it ` +
          "in Server Settings → Roles. Please ping a moderator.",
      });
    }
  }

  const granted = await addRole(token, guildId, userId, verified.id);
  if (!granted.ok) {
    log.error("verify: role grant failed", { guildId, error: granted.error });
    return ephemeral({ content: "✅ Captcha solved, but the role couldn't be applied. Please ping a moderator." });
  }

  log.info("verify: member verified", { guildId, userId });

  return ephemeral({
    embeds: [
      {
        color: BRAND_GREEN,
        title: "✅ Verification successful",
        description:
          "You now have access to the server.\n\n" +
          "**Next:** head to the roles channel and pick what you do and what you want to be pinged for.",
        footer: { text: "FurlPay Community" },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface VerifyInteraction {
  data?: {
    custom_id?: string;
    /** Modal submissions nest their inputs in action rows. */
    components?: { components?: { custom_id?: string; value?: string }[] }[];
  };
  guild_id?: string;
  member?: { user?: { id?: string } };
}

/** Pull a modal text input's value out of the nested action-row shape. */
export function modalValue(i: VerifyInteraction, customId: string): string {
  for (const row of i.data?.components ?? []) {
    for (const c of row.components ?? []) {
      if (c.custom_id === customId) return c.value ?? "";
    }
  }
  return "";
}

/**
 * Route a component or modal interaction into the flow.
 *
 * Returns null when the interaction is not ours, so the caller can try the
 * other handlers rather than swallowing it.
 */
export async function handleVerify(i: VerifyInteraction, token: string): Promise<Reply | null> {
  const customId = i.data?.custom_id ?? "";
  const isOurs =
    customId === VERIFY_START_ID || customId.startsWith(OPEN_PREFIX) || customId.startsWith(SUBMIT_PREFIX);
  if (!isOurs) return null;

  const guildId = i.guild_id;
  const userId = i.member?.user?.id;
  if (!guildId || !userId) {
    return ephemeral({ content: "Verification only works inside the FurlPay server." });
  }

  if (customId === VERIFY_START_ID) return startVerification(userId, guildId);

  if (customId.startsWith(OPEN_PREFIX)) {
    return openCodeModal(customId.slice(OPEN_PREFIX.length));
  }

  const challengeId = customId.slice(SUBMIT_PREFIX.length);
  return submitCode(challengeId, userId, guildId, modalValue(i, CODE_INPUT_ID), token);
}
