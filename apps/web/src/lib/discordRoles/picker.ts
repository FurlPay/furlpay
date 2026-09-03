// ---------------------------------------------------------------------------
// The role picker message.
//
// A STRING SELECT, NOT REACTION ROLES. Reaction roles are the familiar pattern
// and they are the wrong one here: they need a gateway connection to observe
// MESSAGE_REACTION_ADD, which this deployment does not have. A select menu
// arrives as a MESSAGE_COMPONENT interaction over the SAME signed HTTP endpoint
// that already serves slash commands, so the whole feature works on the
// architecture that exists. It is also the better interface — a member sees
// their current roles pre-selected, and picks several at once.
//
// `min_values: 0` is what makes it a toggle rather than a one-way grant:
// clearing the menu and submitting removes every role in that group. Without
// it there is no way to give a role back.
//
// TWO MENUS, NOT ONE. Identity ("I am a developer") changes once; notification
// subscriptions ("ping me for hackathons") change often. One menu of fourteen
// options makes both harder to read, and Discord caps a select at 25 anyway.
// ---------------------------------------------------------------------------

import { selfAssignable, type RoleSpec } from "./catalog";

/** Component type ids from Discord's message-component spec. */
const ACTION_ROW = 1;
const STRING_SELECT = 3;

const BRAND_GREEN = 0x00e599;

/** Version prefix so an old message's custom_id can be recognised and, if the
 *  shape ever changes, refused rather than misread. */
export const IDENTITY_CUSTOM_ID = "roles:v1:identity";
export const NOTIFY_CUSTOM_ID = "roles:v1:notify";

/** Which group a custom_id addresses, or null if it is not ours. */
export function groupForCustomId(customId: string): "identity" | "notify" | null {
  if (customId === IDENTITY_CUSTOM_ID) return "identity";
  if (customId === NOTIFY_CUSTOM_ID) return "notify";
  return null;
}

/**
 * Custom guild emoji, keyed by role key.
 *
 * Absent entries fall back to the catalog's unicode emoji, so the picker still
 * renders correctly on a server where the icons have not been uploaded — the
 * icons are an upgrade, not a dependency.
 */
export type EmojiMap = Record<string, { id: string; name: string }>;

/** The `emoji` field for a select option: a real icon when we have one. */
function optionEmoji(spec: RoleSpec, icons: EmojiMap) {
  const custom = icons[spec.key];
  if (custom) return { emoji: { id: custom.id, name: custom.name } };
  return spec.emoji ? { emoji: { name: spec.emoji } } : {};
}

/** How an icon is written inside embed TEXT, which is a different syntax from
 *  the select option's structured field. */
function inlineIcon(spec: RoleSpec, icons: EmojiMap): string {
  const custom = icons[spec.key];
  if (custom) return `<:${custom.name}:${custom.id}>`;
  return spec.emoji ?? "•";
}

function selectMenu(
  customId: string,
  placeholder: string,
  specs: RoleSpec[],
  selectedKeys: ReadonlySet<string>,
  icons: EmojiMap
) {
  return {
    type: ACTION_ROW,
    components: [
      {
        type: STRING_SELECT,
        custom_id: customId,
        placeholder,
        // 0 so a member can clear the group entirely — see the header.
        min_values: 0,
        max_values: specs.length,
        options: specs.map((s) => ({
          label: s.name,
          value: s.key,
          description: s.description.slice(0, 100),
          ...optionEmoji(s, icons),
          // Pre-ticks what the member already has, so the menu shows current
          // state rather than an empty box they have to reconstruct.
          default: selectedKeys.has(s.key),
        })),
      },
    ],
  };
}

/**
 * Build the picker message.
 *
 * `selectedKeys` is empty for the posted message — it is a shared message and
 * cannot show per-viewer state. Discord re-renders the menu with the viewer's
 * own submission after they interact, and the ephemeral confirmation reports
 * what they now have.
 */
export function buildRolePicker(
  selectedKeys: ReadonlySet<string> = new Set(),
  icons: EmojiMap = {}
): Record<string, unknown> {
  const identity = selfAssignable("identity");
  const notify = selfAssignable("notify");

  return {
    embeds: [
      {
        color: BRAND_GREEN,
        title: "Pick your roles",
        description:
          "Tell the server who you are and what you want to hear about. " +
          "Pick as many as you like — choosing again updates them, and clearing a menu removes them.",
        fields: [
          {
            name: "What you do",
            value: identity.map((r) => `${inlineIcon(r, icons)} **${r.name}** — ${r.description}`).join("\n"),
          },
          {
            name: "What to ping you for",
            value: notify.map((r) => `${inlineIcon(r, icons)} **${r.name}** — ${r.description}`).join("\n"),
          },
        ],
        footer: {
          text: "Roles like Moderator, Team and Contributor are assigned by the team, not here.",
        },
      },
    ],
    components: [
      selectMenu(IDENTITY_CUSTOM_ID, "What you do — pick any", identity, selectedKeys, icons),
      selectMenu(NOTIFY_CUSTOM_ID, "What to ping you for — pick any", notify, selectedKeys, icons),
    ],
    // A shared message that pings nobody.
    allowed_mentions: { parse: [] },
  };
}
