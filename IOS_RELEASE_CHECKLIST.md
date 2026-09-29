# FurlPay Guardian — iOS Release Checklist

_This host is Windows: no Xcode. Nothing below is verified by a build. Every item requires macOS + Xcode 26 SDK (mandatory since Apr 2026)._

## Project

- Location: `ios/FurlPayGuardian/` — **XcodeGen** (`project.yml`), no committed `.xcodeproj` (generate it).
- Targets: app + Watch (`.watchkitapp`) + Widgets (`.watchkitapp.widgets`) + Live Activities (`.activities`).
- `MARKETING_VERSION = 1.0.0`, `CURRENT_PROJECT_VERSION = 1`.
- Bundle id via env: `$(FURLPAY_BUNDLE_ID_BASE)$(FURLPAY_BUNDLE_SUFFIX)`.

## Statically verifiable (do on any host)
- [ ] Confirm `FURLPAY_BUNDLE_ID_BASE` / suffix resolve to the intended App Store bundle id.
- [ ] Confirm the production API base URL points at `https://furlpay.com` (no localhost/staging).
- [ ] Info.plist: ATS — no arbitrary-loads exception; push (`aps-environment`), associated-domains, Keychain access group present and correct.
- [ ] Privacy manifest (`PrivacyInfo.xcprivacy`) present for app + each extension, with required-reason APIs declared.

## Requires macOS + Xcode (cannot be done here)
1. `cd ios/FurlPayGuardian && ./bootstrap.sh` (or `xcodegen generate`).
2. Open in Xcode 26; resolve SPM packages.
3. Select scheme → **Product ▸ Archive** for each target.
4. Signing: automatic or manual with the distribution cert + provisioning profiles for all four bundle ids.
5. Validate the archive (Organizer ▸ Validate App).
6. Upload to App Store Connect / TestFlight.
7. Verify Watch app + Widgets + Live Activities install from the paired build.

## Status
- Source: present · Build: **BLOCKED (no macOS/Xcode)** · Archive: BLOCKED · TestFlight/Store: UNKNOWN.
- Do NOT claim the iOS release passes until an actual archive succeeds on macOS.
