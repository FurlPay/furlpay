import { NextRequest, NextResponse } from "next/server";
import { readTextBody } from "@/lib/validate";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { log } from "@/lib/log";
import {
  verifyDiscordSignature,
  handleCommand,
  handleAutocomplete,
  handleComponent,
  handleModalSubmit,
  PING,
  PONG,
  APPLICATION_COMMAND,
  APPLICATION_COMMAND_AUTOCOMPLETE,
  MESSAGE_COMPONENT,
  MODAL_SUBMIT,
  type Interaction,
} from "@/lib/discord";

export const dynamic = "force-dynamic";

// POST /api/discord/interactions — Discord's HTTP interactions endpoint.
// Auth IS the Ed25519 signature: invalid/missing signatures get a 401
// (Discord probes with bad signatures and removes endpoints that accept
// them). PING answers PONG so the Developer Portal can verify the URL.
export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "discord.interactions", { limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const rawBody = await readTextBody(req);
  const ok = verifyDiscordSignature(
    rawBody,
    req.headers.get("x-signature-ed25519"),
    req.headers.get("x-signature-timestamp")
  );
  if (!ok) {
    return NextResponse.json({ error: "invalid_request_signature" }, { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (interaction.type === PING) {
    return NextResponse.json({ type: PONG });
  }

  // EVERY HANDLER RUNS INSIDE A CATCH.
  //
  // Without one, a KV timeout or an upstream error escapes into Next.js and
  // Discord receives an HTML 500 it cannot parse — the member sees only
  // "interaction failed", with nothing said about what happened. Worse, the
  // stack could reach the wire. A thrown error now becomes an ephemeral
  // message that names nothing internal.
  try {
    // Autocomplete must respond within 3s and cannot be deferred.
    if (interaction.type === APPLICATION_COMMAND_AUTOCOMPLETE) {
      return NextResponse.json(handleAutocomplete(interaction));
    }

    if (interaction.type === APPLICATION_COMMAND) {
      return NextResponse.json(await handleCommand(interaction));
    }

    // Buttons and select menus — currently the self-serve role picker. Like a
    // command, this must answer within Discord's three-second window.
    if (interaction.type === MESSAGE_COMPONENT) {
      return NextResponse.json(await handleComponent(interaction));
    }

    // The captcha modal.
    if (interaction.type === MODAL_SUBMIT) {
      return NextResponse.json(await handleModalSubmit(interaction));
    }
  } catch (e) {
    // Logged server-side with the interaction type for triage; the member is
    // told only that it failed. An error message is a disclosure channel, and
    // a stack trace in a payments bot is a map of the backend.
    log.error("discord interaction failed", {
      type: interaction.type,
      error: (e as Error).message,
    });
    return NextResponse.json({
      type: 4,
      data: {
        content: "Something went wrong on FurlPay's side. Nothing was changed. Please try again.",
        flags: 64,
      },
    });
  }

  // Anything else; acknowledge rather than leaving the member with an
  // unexplained "interaction failed".
  return NextResponse.json({
    type: 4,
    data: { content: "This interaction isn't supported yet. Try /help.", flags: 64 },
  });
}
