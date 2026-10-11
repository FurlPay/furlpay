# 07 — Infrastructure security

- **Hosting:** Vercel project `web` (root `apps/web`). Production deploys go
  through `npm run deploy:prod`, whose gate requires a clean, pushed tree and a
  green CI run, or a logged `FURLPAY_DEPLOY_FORCE` reason.
- **AWS path (F-25):** CloudFront + ALB is designed but not deployed. The same
  middleware enforces the same controls on both paths; origin verification
  applies only when `ORIGIN_VERIFY_REQUIRED` is set.
- **Secrets:** registered in `apps/web/src/lib/env.ts`, documented in
  `.env.example`, never `NEXT_PUBLIC_` (F-22 verified). `envRegistry.spec.ts`
  fails on an unregistered read.
- **Cron (F-26):** two credentials on two separate channels, constant time,
  fail closed.
- **Known gaps:** GitHub Actions billing lock (no CI evidence); Upstash over
  its plan limit, so Redis-backed endpoints answer 503; production migration
  state for 0031–0050 unverified; production credentials still present in the
  Vercel preview scope; `SOLANA_PAYER_SECRET` present in production but unused.
