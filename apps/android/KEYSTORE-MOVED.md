# Signing material has moved (2026-07-14)

`android.keystore` and `.signing-credentials.txt` no longer live in this
repo tree: the repository is OneDrive-synced, and a cloud-replicated signing
key + plaintext password is a custody risk for a financial app.

They now live in the local-only directory:

```
C:\Users\ashut\.furlpay-signing\
  android.keystore           (upload key, alias: furlpay)
  signing-credentials.txt    (store/key password)
```

- `native-app/build-android.sh` reads them from there
  (override with `FURLPAY_SIGNING_DIR` / `FURLPAY_KEYSTORE_PASSWORD`).
- EAS local-credentials builds need `native-app/credentials.json` recreated,
  pointing `keystorePath` at the directory above — do NOT put the password
  back into the repo tree.
- Copies were SHA-256-verified and the keystore functionally checked
  (keytool opens alias `furlpay`) before the originals were removed.
- Keep an offline backup of that directory (password manager / encrypted
  drive). Play App Signing holds the app key; this is the upload key.
