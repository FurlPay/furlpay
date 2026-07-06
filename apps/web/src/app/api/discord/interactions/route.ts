import { NextRequest, NextResponse } from "next/server";
import {
  verifyDiscordSignature,
  handleCommand,
  handleAutocomplete,
  PING,
  PONG,
  APPLICATION_COMMAND,
  APPLICATION_COMMAND_AUTOCOMPLETE,
  type Interaction,
} from "@/lib/discord";

export const dynamic = "force-dynamic";

// POST /api/discord/interactions — Discord's HTTP interactions endpoint.
// Auth IS the Ed25519 signature: invalid/missing signatures get a 401
// (Discord probes with bad signatures and removes endpoints that accept
// them). PING answers PONG so the Developer Portal can verify the URL.
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
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

  // Autocomplete must respond within 3s and cannot be deferred.
  if (interaction.type === APPLICATION_COMMAND_AUTOCOMPLETE) {
    return NextResponse.json(handleAutocomplete(interaction));
  }

  if (interaction.type === APPLICATION_COMMAND) {
    return NextResponse.json(await handleCommand(interaction));
  }

  // Components/modals arrive here once we ship them; acknowledge for now.
  return NextResponse.json({
    type: 4,
    data: { content: "This interaction isn't supported yet. Try /help.", flags: 64 },
  });
}
