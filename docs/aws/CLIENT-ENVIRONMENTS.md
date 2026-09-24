# Client environments

How each client picks its backend. One row per surface; if a value here and a
value in `infra/aws/envs/<env>` disagree, the Terraform output is authoritative.

| | dev | staging | prod |
|---|---|---|---|
| API base | `api-dev.furlpay.com/api` | `api-staging.furlpay.com/api` | `api.furlpay.com/api` |
| RN app id | `com.furlpay.app.dev` | `com.furlpay.app.staging` | `com.furlpay.app` |
| Guardian app id | `com.furlpay.guardian.dev` | `com.furlpay.guardian.staging` | `com.furlpay.guardian` |
| iOS bundle id | `com.furlpay.guardian.dev` | `com.furlpay.guardian.staging` | `com.furlpay.guardian` |
| APNs | sandbox | **production** | production |

## Where the value comes from

| client | mechanism | file |
|---|---|---|
| React Native (Android + iOS) | `FURLPAY_ENV` → `app.config.js` sets `EXPO_PUBLIC_API_BASE` | `native-app/app.config.js`, `eas.json` |
| Guardian Android | Gradle product flavor → `BuildConfig.API_BASE_URL` | `guardian/app/mobile/build.gradle.kts` |
| Guardian Wear OS | same flavor, same suffix | `guardian/app/wear/build.gradle.kts` |
| iOS + watchOS Guardian | xcconfig → Info.plist → `AppEnvironment` | `ios/FurlPayGuardian/Config/*.xcconfig` |
| Chrome extension | `import.meta.env.DEV`, overridable in Settings | `apps/extension/lib/api.ts` |

## Two invariants that are not optional

**1. The phone and watch apps must share an application/bundle id.**

Android: the Wearable Data Layer pairs by identical `applicationId`, so the
environment suffix is on the *flavor* and is duplicated byte-for-byte in both
`build.gradle.kts` files. CI asserts it with `aapt2 dump packagename`.

iOS: `WKCompanionAppBundleIdentifier` in `project.yml` carries the same
`$(FURLPAY_BUNDLE_SUFFIX)`. Without it a staging watch app pairs with the
tester's **production** phone app and is fed production tokens.

Breaking either produces a watch that shows no data and logs no error.

**2. Staging uses production APNs.**

TestFlight — including internal testers — issues production push tokens.
A staging build registering for the sandbox receives nothing, silently.

## Adding an environment

1. `infra/aws/envs/<name>/main.tf` (copy `staging`, change `env`, `vpc_cidr`, `domain_name`).
2. Add the host to `API_BASE_BY_ENV` / `ENV_SUFFIX` / `ENV_LABEL` in `app.config.js`.
3. Add a product flavor to **both** guardian `build.gradle.kts` files with the same suffix.
4. Add `Config/<Name>.xcconfig` and a `configs:` + `configFiles:` entry in `project.yml`.
5. Add the value to the `environment` choice list in `.github/workflows/mobile-release.yml`.
6. Create a GitHub Environment of the same name — the AWS trust policy pins the deploy role to it.

## Before repointing Android at AWS

`native-app/plugins/withNetworkSecurityConfig.js` pins `furlpay.com`
(`includeSubdomains="true"`) to Let's Encrypt roots. AWS ACM certificates chain
to Amazon Root CA, so **every AWS endpoint will fail the pin check**. Add the
Amazon Root CA SPKI pins to the `<pin-set>` first. The plugin's expiry gate will
not catch this — the pins are valid, they just do not match the new chain.
