# FlexPay Mobile — local setup checklist

The repo ships a complete TypeScript codebase with stubbed integrations
that fall back to safe defaults when their API keys are absent. To run
the full P0 flow against real services you need to provision the
following credentials yourself.

## 1. Backend env (`.env` at the repo root)

The backend reads `.env.example` as its template. Copy it and fill in:

| Variable | Where to get it | Used by |
| --- | --- | --- |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` | [Twilio console](https://console.twilio.com/) → Account → API keys; SMS-capable phone number | `twilioService.sendOTP`, `sendWelcomeSMS` |
| `NYMCARD_API_KEY` / `NYMCARD_WEBHOOK_SECRET` | NymCard sandbox onboarding (request via `partnerships@nymcard.com`); generate the webhook secret in their dashboard and mirror it here | virtual + physical card issuance, transaction webhooks |
| `MONEYHASH_API_KEY` / `MONEYHASH_WEBHOOK_SECRET` | [MoneyHash](https://moneyhash.io/) sandbox keys | international remittance |
| `FLEXXPAY_API_KEY` / `FLEXXPAY_REDIRECT_URL` | FlexxPay partnership onboarding | EWA salary advance redirect |
| `FIREBASE_PROJECT_ID` / `FIREBASE_PRIVATE_KEY` / `FIREBASE_CLIENT_EMAIL` | Firebase Console → Project Settings → Service Accounts → "Generate new private key" | server-side push (`getFirebaseMessaging()`) |

Without these the backend falls through to log-only stubs — the auth
flow still works end-to-end against the in-memory OTP store, but no
real SMS / card / push is delivered.

## 2. Twilio sandbox testing

For UAE phone OTPs:

1. Buy/port a phone number with SMS capability in Twilio's UAE region
   (or use a US/UK long code for sandbox-only testing — UAE delivery
   may be limited).
2. In Twilio Console, add the test phone number to the **Verified
   Caller IDs** list to bypass the trial-account warning.
3. Test against the backend:
   ```bash
   curl -X POST http://localhost:3000/api/v1/auth/employee/request-otp \
     -H 'Content-Type: application/json' \
     -d '{"phone":"+971501234567"}'
   ```
4. Observe the SMS on the recipient handset. The OTP is also visible
   in `redis-cli GET otp:+971501234567` while you're developing.

For E2E / Detox, override the OTP via a dev-only endpoint or seed
Redis directly — never ship that override to production.

## 3. NymCard sandbox cards

1. Register at the NymCard partner portal and request a sandbox tenant.
2. Drop the API key into `NYMCARD_API_KEY`. Without it, the backend
   stubs return synthetic card metadata (`card_<uuid>`, fake `last4`)
   so the rest of the pipeline runs unobstructed.
3. To test the real issuance flow:
   ```bash
   # 1. Register and get a JWT
   ACCESS_TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/employee/verify-otp \
     -H 'Content-Type: application/json' \
     -d '{"phone":"+971501234567","otp":"123456","fullName":"Test User"}' \
     | jq -r '.accessToken')

   # 2. Inspect issued cards
   curl http://localhost:3000/api/v1/cards \
     -H "Authorization: Bearer $ACCESS_TOKEN" | jq
   ```
4. Configure NymCard's webhook URL to
   `https://<your-backend>/webhooks/nymcard` and copy the signing
   secret into `NYMCARD_WEBHOOK_SECRET`. The handler verifies an
   `x-nymcard-signature` header (HMAC-SHA256) before any DB write.

## 4. Firebase project setup

For push notifications:

1. Create a project at <https://console.firebase.google.com>.
2. Add an **iOS app** with bundle id `ae.flexpay.mobile`. Download
   `GoogleService-Info.plist` and drop it into `ios/FlexPay/`.
3. Add an **Android app** with package `ae.flexpay.mobile`. Download
   `google-services.json` and drop it into `android/app/`.
4. Generate a service account key (Project Settings → Service
   accounts → "Generate new private key") and configure the backend's
   `FIREBASE_*` env vars.
5. Run the app once on a real device (or a properly-provisioned
   simulator) — `pushService.registerForRemoteNotifications()` will
   POST the FCM token to `/api/v1/notifications/register`.

> The two `GoogleService-*` files are gitignored by convention. Don't
> commit them. Use EAS secrets / 1Password references for CI builds.

## 5. Deep linking

The deep-linking config is in three places:

- **`mobile/app.json`** — declares `scheme: "flexpay"`, iOS
  `associatedDomains` for `flexpay.ae` / `dashboard.flexpay.ae`, and
  Android `intentFilters` (with `autoVerify: true`).
- **`mobile/src/navigation/linking.ts`** — maps URLs onto the navigator
  tree (e.g. `https://flexpay.ae/wallet/transactions` → `Wallet >
  Transactions`).
- **`mobile/src/services/notifications/pushService.ts`** — reads
  `data.deepLink` from FCM payloads and prefers it over type-based
  routing.

For Apple Universal Links + Android App Links to *actually* match
without prompting the user, the apex domain must serve the right
association files:

- iOS: `https://flexpay.ae/.well-known/apple-app-site-association`
- Android: `https://flexpay.ae/.well-known/assetlinks.json`

Until those are hosted, custom-scheme links (`flexpay://...`) work in
dev but `https://flexpay.ae/...` will open the browser instead of the
app. See Apple's [Supporting universal links](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
and Google's [Verify Android App Links](https://developer.android.com/training/app-links/verify-site-associations).

Test locally:

```bash
# iOS simulator
xcrun simctl openurl booted "flexpay://login"
xcrun simctl openurl booted "flexpay://wallet/transactions"

# Android emulator
adb shell am start -W -a android.intent.action.VIEW -d "flexpay://login"
```

## 6. Typecheck both surfaces

From the repo root:

```bash
# Backend
npm install
npx prisma generate
npx tsc --noEmit

# Mobile
cd mobile
npm install --legacy-peer-deps
npx tsc --noEmit
```

Both pass cleanly on the current branch — keep this command in your
pre-push hook to catch contract drift between mobile types and the
backend's response shapes.
