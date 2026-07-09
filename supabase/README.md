# Supabase (Postgres) — durable store migration

The web app's user/account data lives in an in-memory store
(`apps/web/src/lib/store.ts`). This directory holds the Postgres schema that
replaces it, plus the steps to stand the database up. The client adapter is
`apps/web/src/lib/supabase.ts` — plain PostgREST over fetch, no SDK.

## Apply the schema

With the Supabase CLI (recommended — tracks migration history):

```sh
npx supabase db push --db-url "$DATABASE_URL"
```

(or `npx supabase link --project-ref <ref>` + `npx supabase db push` when
logged in). Connection-string gotcha: the **direct** host
(`db.<ref>.supabase.co:5432`) resolves to IPv6 only — on an IPv4-only network
(most Windows/home setups) use the **Session pooler** string instead:
host `aws-<n>-<region>.pooler.supabase.com`, port `5432`, user
`postgres.<project-ref>` (Dashboard → Connect → Session pooler).

## Environment

Set in Vercel (project `web`) and `.env.local`:

| Var | Where to find it | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Dashboard → Settings → API | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Settings → API Keys | **Server-side only.** Never `NEXT_PUBLIC_`. |

Key formats: use the new **secret key** (`sb_secret_…`) as
`SUPABASE_SERVICE_ROLE_KEY` — the legacy `service_role` JWT also still works
(deprecated end of 2026). The **publishable key** (`sb_publishable_…`) does
NOT work here: `/rest/v1/` returns 403 for publishable/anon keys, and this app
is server-side-only by design anyway.

The app never uses the anon/publishable key: RLS is enabled on every table
with no policies, so anon access reads nothing. All queries go through API
routes with the service role.

## Cutover plan (not yet flipped)

1. Apply `0001_init.sql`; set the two env vars in Preview first.
2. Swap `store.ts` accessors (`getAccount`, `findOrCreateUserByIdentity`,
   `recordTransaction`, …) to the Supabase adapter behind
   `supabaseBackend === "supabase"`, keeping the in-memory path as the
   zero-credential dev fallback — same pattern as `kv.ts`.
3. Seed the demo account (deterministic `DEMO_USER_ID`) via upsert on boot.
4. Verify auth flows (OTP, Google, Apple, passkey) create/resolve users, then
   promote env vars to Production and deploy.
