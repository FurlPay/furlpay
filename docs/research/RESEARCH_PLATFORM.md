# FurlPay Research & Intelligence: platform and editorial guide

## What exists

| Surface | Path | Notes |
|---|---|---|
| Library hub | `/research` | Six desks, search, cadence and year filters, and the publishing programme. Filtered views are `noindex, follow`, with the canonical set to `/research`. |
| Desk pages | `/research/[desk]` | Six static pages; `dynamicParams = false`, so an unknown desk is a real 404. |
| Report page | `/reports/[slug]` | Executive summary, evidence-labelled headline figures, findings with reference numbers, body, methodology, sources (numbered as in the report), revisions and disclaimer. |
| Old index | `/reports` | 307 → `/research`. |
| Verify page | `/research/verify` | `noindex`. Reads the token from the URL **fragment** (`#t=`), posts it once, then clears it from the address bar. |
| Request | `POST /api/reports/[slug]/download` | Existing endpoint, extended. Reports with `privatePdf` go through email verification. |
| Verify | `POST /api/research/download-verifications` | `{ token }` → `{ ok, title, downloadUrl, expiresAt }` / 400 invalid or expired / 410 used / 503. |
| Download | `GET /api/research/downloads/[grantId]` | 303 → 60-second signed URL / 410 expired / 503 storage unavailable. |

Content is the repository (`apps/web/src/lib/content/data.ts`): typed records, reviewed in pull requests. There is no CMS database and no admin API. **The status change in a reviewed commit is the editorial approval**, and git history is the audit trail and version record. This was a deliberate choice: the brief's admin endpoints would need new tables, migrations and an editor role that don't exist, while the existing content system already gives review, history and rollback.

## Gated download flow and its guarantees

1. The reader submits the existing lead form. Newsletter consent is a separate checkbox, unchecked by default.
2. The server refuses throwaway mailboxes (`lib/research/disposable.ts`). Consumer providers and small-business domains are accepted.
3. The lead is stored by `captureLead`, under existing consent and retention rules.
4. A 32-byte token is generated. KV stores **only its sha256** plus a hash of the email, with a 30-minute expiry.
5. The email link is `https://furlpay.com/research/verify#t=<token>`. A fragment is never sent to a server, so it can't appear in logs or analytics.
6. Verification consumes the token with an atomic set-if-absent. Two simultaneous clicks mint exactly one grant (tested).
7. The grant (10 minutes) names one report and one object key. On redemption it is re-checked against the currently published record, so unpublishing a report or replacing its file invalidates outstanding links.
8. The server redirects to a **60-second** Supabase signed URL, with `no-store`, `noindex` and `no-referrer`.
9. The response to a request is identical for every address, so it reveals nothing about prior downloads.
10. Every failure is visible: storage not configured, KV down, or email not sent (including a "mocked" send in production) returns 503, never a fake success.

**Rate limits:**
- 5 requests per minute per IP, **failing closed** when Redis is down, because the endpoint sends email;
- 3 per hour per email address, across IPs;
- 20 verifications per minute;
- 30 downloads per minute.

## Setup: manual steps (not done; they need your accounts)

1. **Create a PRIVATE Supabase Storage bucket**, for example `research-private`. Public access must be off.
2. **Upload the PDF** to object key `global-stablecoin-report-2026/v1.0.pdf`. Then check that the stored file's sha256 equals `441219ab3739cabd01bc63a5f6cbc1c5bf0da5bb536b55714f741430e0de2d03` (29,815,276 bytes).
3. **Set env var `RESEARCH_PDF_BUCKET`** to the bucket name. `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` and `KV_REST_API_URL`/`KV_REST_API_TOKEN` must already be set. **The production KV is currently over its Upstash plan limit** (see the incident notes); downloads return 503 until that is resolved.
4. **Editorial approval:** set the report's `status` to `"published"` in `data.ts`. Page 48 of the PDF says FurlPay's capabilities "were not provided" and marks every module "To be confirmed". Decide whether that page should ship as is.

## Publishing cadence

| Cadence | Publication |
|---|---|
| Weekly | Stablecoin & Security Brief |
| Monthly | Global Stablecoin Market Report; Blockchain Security Intelligence |
| Quarterly | Payments & Fintech Infrastructure Review; Regulatory Landscape Report |
| Annual | Global Stablecoin Report; Blockchain Security Year in Review |
| On demand | Research briefs and datasets |

A cadence is a schedule, not permission to publish. A record moves `draft → review → approved → published` (or `scheduled` with a future `publishedAt`, which appears only once the date passes and only if it was approved first). Nothing advances automatically.

**Checklist per edition:**
- Every quantitative claim has a source (organisation, document, date), a period and definition, and an evidence label: `primary`, `independent`, `secondary`, `company-claim`, `estimate` or `law`.
- Never combine figures with different periods or methods. Keep on-chain transfer volume, adjusted volume, settlement and economic payments in separate layers.
- Security reports separate confirmed incidents from allegations and estimates, and contain no exploit instructions.
- Regulatory items state the jurisdiction, the as-of date, and whether each item is enacted, a final rule, a proposal or guidance.
- A correction adds an entry to `revisions[]` and bumps `version`. A new PDF goes to a **new object key** (`.../v1.1.pdf`), so earlier grants can't fetch it and the old version is preserved.
- `lib/research/__tests__/research.spec.ts` fails if a cited reference number isn't in `sources`.

## Rollback

All changes are code. Revert the commit, or set a report's status back to `review` to unpublish it instantly. Outstanding links stop working because grants are re-checked against the published record.
