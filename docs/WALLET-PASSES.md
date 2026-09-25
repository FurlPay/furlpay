# Wallet passes — status and blockers

**As of 2026-09-25.** Wallet *passes* (`.pkpass`, Google Wallet objects) are a
different thing from **payment card provisioning** — see
`native-app/lib/cards/provisioning.ts` for that, which is blocked on a card
issuer. Passes are blocked on different credentials, listed below.

## What exists

`apps/web/src/lib/passes/content.ts` — a platform-neutral **pass content model**
with a disclosure redactor. Built because it needs no credentials and it is
where the bugs actually are: what gets disclosed, which instant a countdown
derives from, and which timezone a printed time belongs to.

- `safeBoardingPassContent(pass)` — maps a `BoardingPass` to pass content and
  validates it. The only entry point production should use.
- `assertNoOverDisclosure(content)` — **throws** on money keys, full EVM/Solana
  addresses, E.164 numbers, PAN-shaped digit runs and email addresses, in every
  field group including the back, plus raw addresses in the barcode.

**VERIFIED:** 34 tests, `apps/web` 1782 passed / 116 files, `tsc --noEmit` clean.

## What is blocked, and on what

| | Needs | Status |
|---|---|---|
| Apple `.pkpass` | Pass Type ID certificate from an Apple Developer account, + Apple WWDR intermediate | **BLOCKED** — no Apple Developer account (`native-app/eas.json`: "BLOCKED ON AN APPLE DEVELOPER ACCOUNT"). Same blocker as the iOS release. Certificates expire every **398 days** — a renewal obligation, not one-time. |
| Google Wallet | Issuer ID + service-account key | **BLOCKED** — neither declared in `apps/web/.env.example`. |
| PassKit web service (dynamic updates) | The above, plus an APNs push certificate for the pass topic | **NOT STARTED** |
| NFC hotel room keys | A certified lock vendor (Salto / ASSA ABLOY / Dormakaba) **and** Apple/Google hospitality-programme onboarding | **OUT OF REACH** — this is a commercial certification, not an integration. |
| Identity credentials (ISO 18013-5 / mDL) | Issuing-authority status | **OUT OF SCOPE** — regulatory, not technical. |

## Two design decisions already made

**No money on a pass.** Enforced by the redactor, not by convention. A pass
shows on a lock screen, surfaces itself by time or proximity, and is a *file*
that can be AirDropped or mailed. FurlPay ships Discreet Mode
(`native-app/lib/privacy/balanceVisibility.ts`) so a user can hide their balance
in public — a pass printing portfolio value contradicts a feature the product
already has. This rules out the "Dynamic Shareholder Pass" design as specified;
a portfolio pass would need to carry a link, not a number.

**No geofences without real coordinates.** `boardingPassContent` returns
`locations: []` because `lib/travel/airports.ts` carries `iata/name/city/country`
and no latitude or longitude. A guessed geofence surfaces the pass in the wrong
place, which is worse than not surfacing it. Hotel data may have coordinates —
check before building the hotel pass.

## What the redactor does not catch

Stated so its coverage is not overread: opaque tokens (a JWT is not base58, and
every pattern broad enough to catch one also catches booking references), and
semantics (it knows "Ada Lovelace" is not an address; it cannot judge whether
printing a full legal name suits a given pass type).

## To unblock

1. Apple Developer account → create a Pass Type ID → CSR on a Mac → download
   `.cer` → export `.p12` with the private key. Also unblocks the iOS release.
2. Google Wallet issuer account → service account → declare
   `GOOGLE_WALLET_ISSUER_ID` and the key in `.env.example` and `lib/env.ts`.
3. Then write the two renderers (`pass.json`, `genericObject`) against this
   content model, and the signer. The rendering is mechanical; the content model
   is the part that already exists and is tested.
