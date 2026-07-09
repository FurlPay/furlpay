# Supabase (Postgres) — durable store migration

The web app's user/account data lives in an in-memory store
(`apps/web/src/lib/store.ts`). This directory holds the Postgres schema that
replaces it, plus the steps to stand the database up. The client adapter is
`apps/web/src/lib/supabase.ts` — plain PostgREST over fetch, no SDK.

## Apply the schema

With the Supabase CLI (recommended — tracks migration history):

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Or directly with psql against the connection string from
Dashboard → Settings → Database:

```sh
psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql
```

## Environment

Set in Vercel (project `web`) and `.env.local`:

| Var | Where to find it | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Dashboard → Settings → API | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Dashboard → Settings → API | **Server-side only.** Never `NEXT_PUBLIC_`. |

The app never uses the anon key: RLS is enabled on every table with no
policies, so anon access reads nothing. All queries go through API routes with
the service role.

## Cutover plan (not yet flipped)

1. Apply `0001_init.sql`; set the two env vars in Preview first.
2. Swap `store.ts` accessors (`getAccount`, `findOrCreateUserByIdentity`,
   `recordTransaction`, …) to the Supabase adapter behind
   `supabaseBackend === "supabase"`, keeping the in-memory path as the
   zero-credential dev fallback — same pattern as `kv.ts`.
3. Seed the demo account (deterministic `DEMO_USER_ID`) via upsert on boot.
4. Verify auth flows (OTP, Google, Apple, passkey) create/resolve users, then
   promote env vars to Production and deploy.
