# FlexPay Mobile

React Native client for the [FlexPay backend](../README.md). The app
ships the full P0 employee experience — phone-OTP auth, wallet (balance
+ P2P transfer with optimistic UI), virtual/physical cards, offers, and
profile — wired to the backend's `/api/v1` surface.

## Stack

- **React Native 0.73 + TypeScript** with path aliases (`@components/*`,
  `@screens/*`, `@services/*`, `@store/*`, `@theme`, `@types/*`,
  `@navigation/*`, `@config/*`, `@i18n/*`)
- **React Navigation v6** — root stack swap (Auth/App), bottom tabs,
  per-tab native stacks, deep-linking config under `flexpay://` and
  `https://flexpay.ae`
- **Zustand + immer** — `useUserStore`, `useWalletStore`,
  `useCardsStore`, `useUIStore`. Wallet store has an
  `optimisticTransfer` / `rollbackOptimistic` pair so P2P feels instant
- **TanStack Query** — installed and provided at the root for
  data-fetching screens that prefer it over the Zustand slices
- **axios + interceptors** — bearer token injection, `Idempotency-Key`
  stamp on POST/PUT/PATCH, automatic refresh-once-and-retry on 401, and
  a `FORCE_LOGOUT` event when refresh fails
- **react-native-keychain** — `tokenManager` stores `accessToken`,
  `refreshToken`, and the user payload with biometric protection on iOS
  (`BIOMETRY_ANY_OR_DEVICE_PASSCODE`)
- **Firebase Messaging + Notifee** — push permission, FCM token
  registration with the backend, foreground/background handlers, deep
  linking, and Android channels (default / transactions / offers)
- **i18n** — `react-i18next` with `en` and `ar` (RTL toggle on
  language change) detected via `react-native-localize`
- **react-native-haptic-feedback** — wrapped in `services/utils/haptics`
- **Sentry + Amplitude (Analytics)** — wired via thin facades; falls
  back to console in dev so you can run without prod keys
- **Detox + Jest** — Detox config for iOS sim e2e; Jest preset for unit

## Project layout

```
mobile/
├── App.tsx
├── package.json, tsconfig.json, babel.config.js, metro.config.js
├── jest.config.js, __tests__/setup.ts
└── src/
    ├── config/
    │   └── api.ts                       # base URL per env
    ├── theme/                           # colors, typography, spacing, shadows, radii
    ├── types/                           # api, user, transaction, card, navigation
    ├── i18n/
    │   ├── index.ts                     # i18next + RTL hook
    │   └── locales/{en,ar}.json
    ├── services/
    │   ├── api/
    │   │   ├── client.ts                # axios + interceptors
    │   │   ├── auth.ts, wallet.ts, cards.ts,
    │   │   ├── offers.ts, savings.ts, remittance.ts
    │   ├── auth/
    │   │   ├── tokenManager.ts          # Keychain-backed
    │   │   ├── useAuth.tsx              # AuthProvider + hook
    │   │   ├── authEvents.ts            # FORCE_LOGOUT bus
    │   │   └── secureStorage.ts         # generic encrypted KV
    │   ├── notifications/pushService.ts # FCM + Notifee
    │   ├── analytics/{events,analytics}.ts
    │   └── utils/{logger,haptics,currency,date,validation}.ts
    ├── store/
    │   ├── useUserStore.ts, useWalletStore.ts,
    │   ├── useCardsStore.ts, useUIStore.ts
    ├── hooks/{useBiometrics,useKeyboard,useDebounce,useRefresh}.ts
    ├── components/
    │   ├── ui/{Button,Input,Card,Text,LoadingSpinner,EmptyState}.tsx
    │   ├── forms/{PhoneInput,OTPInput,AmountInput}.tsx
    │   └── cards/{VirtualCardVisual,CardShimmer}.tsx
    ├── navigation/
    │   ├── RootNavigator.tsx, AuthStack.tsx, AppStack.tsx
    │   ├── linking.ts, NavigationService.ts
    └── screens/
        ├── auth/{Welcome,PhoneInput,OTP}Screen.tsx
        ├── home/HomeScreen.tsx
        ├── wallet/{Wallet,Transfer}Screen.tsx
        ├── cards/{Cards,OrderPhysicalCard}Screen.tsx
        ├── offers/OffersScreen.tsx
        └── profile/ProfileScreen.tsx
```

## Getting started

```bash
# 1. Install deps
cd mobile
npm install
npm run pod-install            # iOS only

# 2. Start the backend (from repo root)
cd ..
npm run docker:up              # postgres + redis
npx prisma migrate deploy
npm run dev                    # API at http://localhost:3000/api/v1

# 3. Run the app
cd mobile
npm run ios                    # or: npm run android
```

By default the dev build points at `http://localhost:3000/api/v1` on iOS
and `http://10.0.2.2:3000/api/v1` on Android (the emulator's loopback to
the host). See `src/config/api.ts` to override.

## Auth → app flow

```
WelcomeScreen
  └─ PhoneInputScreen
       └─ POST /auth/employee/request-otp        # rate-limited 3/h per phone
       └─ OTPScreen (per-cell OTPInput, auto-advance + Backspace nav)
            └─ POST /auth/employee/verify-otp    # phone + otp only
                 ├─ existing user → login        ──┐
                 └─ 422 FULL_NAME_REQUIRED       ──┤  backend re-stores OTP
                      └─ ProfileSetupScreen        │  for the next call
                            └─ POST verify-otp     │  (phone + otp + fullName)
                                 └─ creates ──────┤
                                                  ▼
                                          tokenManager.storeTokens
                                          useAuth.login → setUser
                                          RootNavigator swaps Auth → App
            ⇒ RootNavigator swaps Auth → App stack
```

The backend returns both `accessToken` and `refreshToken` in the JSON
body for mobile clients (the HttpOnly cookie is harmless overhead but
mobile axios can't read it).

## P2P transfer with optimistic UI

`TransferScreen` calls `walletStore.optimisticTransfer(amount, phone)`
which inserts a `PENDING` row at the top of the list and decrements the
balance immediately. On API success the screen re-fetches to replace the
temp row; on failure `rollbackOptimistic(tempId)` restores the balance
and pulls the temp row out.

The axios client stamps an `Idempotency-Key` on every POST so a network
retry never causes a double-debit — the backend's wallet service
de-dupes against `EmployeeTransaction.idempotencyKey`.

## Push notifications

`pushService` requests permission, fetches the FCM token, and registers
it with `POST /api/v1/notifications/register`. Listeners cover
foreground messages (re-displayed via Notifee with channel routing),
background-tap navigation, and cold-start "launched from notification"
handling. The teardown function is returned from `setupNotificationListeners`
so the App root can clean up on unmount or logout.

## Tests

```bash
npm test                  # Jest unit tests under __tests__/unit/
npm run test:e2e:build    # Detox build: `detox build -c ios.sim.debug`
npm run test:e2e          # Detox runner against the simulator
```

Unit tests use `@testing-library/react-native` with `@testing-library/jest-native`
matchers (`toBeFocused`, etc). Native modules are mocked in
`__tests__/setup.ts`.

The Detox suite at `e2e/auth.e2e.test.ts` walks the full
PhoneInput → OTP → ProfileSetup → Home flow against a real build; the
config lives in `detox.config.js` (iOS simulator + Android emulator
profiles). The OTP suite expects a backend that accepts a fixed test
OTP for the test phone — typically a dev/staging build with an OTP
override flag, or a Twilio Magic Number.

## Distribution

EAS profiles (see `eas.json`):

```bash
eas build --profile development   # internal sim/dev-client
eas build --profile preview       # staging, internal distribution
eas build --profile production    # store-bound build, autoIncrement
eas submit --profile production
```

For more advanced iOS workflows (TestFlight upload + Slack notification +
date-based versioning), the `ios/fastlane/Fastfile` exposes:

```bash
bundle exec fastlane ios beta       # build + upload to TestFlight
bundle exec fastlane ios increment  # bump marketing + build numbers
```

`bundle exec fastlane ios beta` reads `RELEASE_NOTES`, `MATCH_PASSWORD`,
and `SLACK_URL` from the environment — set them in CI secrets, never
commit them.
