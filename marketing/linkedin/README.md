# FurlPay LinkedIn Growth Workspace

Goal: grow `linkedin.com/company/furlpay` from **65 → 10k+** followers and land **pilot customers** for the stablecoin checkout + x402 machine-payment product — **without violating LinkedIn's ToS**.

## What's here

| File | Purpose |
| :--- | :--- |
| `content-calendar.md` | 30-day posting schedule across the 3 content pillars |
| `post-drafts.md` | Ready-to-post drafts using the Hook → Connection → Value → CTA formula |
| `outreach-templates.md` | Manual InMail / connection-note blueprints for Segment A & B |
| `leads.csv` | Manual lead-tracking sheet (fill by hand from LinkedIn) |
| `competitor-research.md` | How to monitor competitors + live findings |
| `profile-optimization.md` | Day-1 personal + company page setup checklist |

## Ground rules (non-negotiable, from your own playbook)

- **No scraping, no stealth automation, no bots.** LinkedIn bans these aggressively — especially Premium accounts. Building the account's reputation and then losing it to a ban is the worst possible outcome at 65 followers.
- **15–20 personalized, human-sent touches per day.** Quality over volume. This is the safe, high-reply-rate path.
- **Automation is allowed only for drafting and organizing** (what's in this folder), never for acting on LinkedIn on your behalf.
- **Competitor monitoring uses official, sanctioned channels**: the LinkedIn Ad Library (public), native Page Analytics → Competitors, and the authenticated LinkedIn MCP available in this Claude Code session.

## Real product facts to anchor all content (from `apps/web`)

- **x402 FX API**: `GET /api/x402/fx` — mid-market FX quote for **$0.01 USDC/call**, hardened against all four documented x402 attack classes (authorization, binding, replay, web-layer). Live: `curl https://furlpay.com/api/x402/fx` returns a 402 quote.
- **Furlpay Connect**: single-integration B2B settlement gateway, **flat 0.5%**, deposits local currency to bank.
- Chains: **Base + Solana**. Asset: **USDC**. Compliance angle: **MiCA**.
- Open source: `github.com/FurlPay`.
