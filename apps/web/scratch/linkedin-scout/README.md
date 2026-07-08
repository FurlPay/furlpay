# LinkedIn Scout — FurlPay Lead Gen & Content Tool

A local, cookie-based LinkedIn People Search scraper + official API content publisher built with **Playwright + Stealth** and the **LinkedIn REST API**. Designed for safe, low-volume B2B prospecting during your 30-day LinkedIn Premium sprint.

> **Disclaimer:** Automating LinkedIn browsing may violate their Terms of Service. The scraping features are designed for low-volume, educational purposes. The API posting features use LinkedIn's official REST API and are fully compliant.

---

## Quick Start

### 1. Install Dependencies
```bash
cd apps/web/scratch/linkedin-scout
npm install
npm run setup   # installs Chromium for Playwright
```

### 2. Export Your LinkedIn Cookies (for scraping)
1. Log into LinkedIn in Chrome.
2. Install the **[Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm)** extension.
3. Navigate to `linkedin.com` → click the extension icon → **Export** (JSON).
4. Save the file as `cookies.json` in this directory (`linkedin-scout/cookies.json`).

### 3. Set Up LinkedIn API (for posting)
1. Go to [developer.linkedin.com](https://developer.linkedin.com) and create an app.
2. Apply for **Community Management API** access.
3. Generate an OAuth2 token with `w_organization_social` scope.
4. Copy `.env.example` to `.env` and fill in your credentials:
```bash
cp .env.example .env
# Edit .env with your LINKEDIN_ACCESS_TOKEN and LINKEDIN_ORG_ID
```
5. Test the connection:
```bash
npm run api-test
```

---

## Commands

### Scrape Leads
```bash
# Scrape AI Agent CTOs (Segment A — default)
npm run scout

# Scrape Cross-Border SaaS Founders (Segment B)
npm run scout -- --segment segmentB

# Scrape Stablecoin Finance Leaders (Segment C)
npm run scout -- --segment segmentC

# Use a custom LinkedIn search URL
npm run scout -- --url "https://www.linkedin.com/search/results/people/?keywords=..." --segment custom
```

### Warm Up Profiles
Visit scraped profiles to appear in their "Who viewed your profile" feed:
```bash
# Visit first 15 profiles from Segment A
npm run warm

# Visit 10 profiles from Segment B
npm run warm -- --segment segmentB --limit 10
```

### Export Leads to CSV
```bash
# Export all segments to a single CSV
npm run export -- --all

# Export a single segment
npm run export -- --segment segmentA
```

### Publish Posts to Company Page
Posts use the official LinkedIn REST API (Community Management API):
```bash
# View available pre-drafted posts
npm run post

# Publish a specific draft (0-4)
npm run post -- --draft 0    # x402 Protocol security post
npm run post -- --draft 1    # FurlPay Connect interchange savings
npm run post -- --draft 2    # WebAuthn / Death of the Seed Phrase
npm run post -- --draft 3    # Build in Public — Portfolio Heatmap
npm run post -- --draft 4    # MiCA Compliance Auto-Swap Engine

# Publish custom text
npm run post -- --text "Your custom post content here"
```

### Test API Connection
```bash
npm run api-test
```

---

## Project Structure
```
linkedin-scout/
├── .env.example              ← Template for API credentials
├── .env                      ← Your credentials (NEVER commit)
├── cookies.json              ← Your LinkedIn session (NEVER commit)
├── data/
│   ├── segmentA.json         ← Scraped leads (auto-created)
│   ├── segmentB.json
│   └── leads_all.csv         ← CSV export
├── src/
│   ├── config.ts             ← Delays, limits, search URLs
│   ├── utils.ts              ← Cookie loader, helpers, persistence
│   ├── scout.ts              ← Main scraper (npm run scout)
│   ├── warm.ts               ← Profile warm-up (npm run warm)
│   ├── exportCsv.ts          ← JSON → CSV (npm run export)
│   ├── linkedinApi.ts        ← Official LinkedIn REST API client
│   └── post.ts               ← Content publisher with pre-drafted posts
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Configuration

Edit `src/config.ts` to tune scraper settings:

| Setting | Default | Description |
|---|---|---|
| `MAX_LEADS_PER_RUN` | 50 | Max profiles scraped per session |
| `MIN_DELAY_MS` | 3,000 | Minimum pause between page loads |
| `MAX_DELAY_MS` | 7,000 | Maximum pause between page loads |
| `MAX_SEARCH_PAGES` | 5 | Pages to paginate through |
| `MAX_CONNECTIONS_PER_DAY` | 20 | Safe daily connection limit |

---

## LinkedIn API Reference

This tool uses LinkedIn's official REST API (via Microsoft Learn documentation):

| API | Endpoint | Purpose |
|---|---|---|
| **Posts API** | `POST /rest/posts` | Create posts on Company Page |
| **Follower Stats** | `GET /rest/organizationalEntityFollowerStatistics` | Get follower counts |
| **Delete Post** | `DELETE /rest/posts/{urn}` | Remove a published post |

**Required OAuth Scope:** `w_organization_social`

**Official Docs:**
- [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
- [Community Management Overview](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview)
- [Developer Portal](https://developer.linkedin.com)

---

## Pre-Drafted Content (5 Posts Ready)

All posts follow the **Hook-Connection-Value-CTA** formula:

| # | Topic | Pillar | Article Link |
|---|---|---|---|
| 0 | x402 Protocol Security | Agentic Economy | `/blog/five-ways-to-rob-an-ai-agent` |
| 1 | FurlPay Connect (0.5% fees) | Product Launch | `/blog/announcing-furlpay-connect` |
| 2 | Death of the Seed Phrase | Build in Public | `/blog/death-of-the-seed-phrase-webauthn` |
| 3 | Portfolio Heatmap | Build in Public | — |
| 4 | MiCA Auto-Swap Engine | Compliance | `/blog/navigating-mica-auto-swaps-eurc-usdc` |

---

## Safety Best Practices
- **Never run headless** — LinkedIn detects headless browsers more aggressively.
- **Keep delays high** — 20–40 seconds between profile visits during warm-up.
- **Limit to 50 scrapes per run** — spread across the day.
- **Do not auto-send messages** — draft InMails manually for best results.
- **Re-export cookies** if the script says "Not logged in" — sessions expire.
- **API posting is safe** — uses the official LinkedIn REST API with proper OAuth2.
