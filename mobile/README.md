# FlexPay Mobile

Flutter + Riverpod + GoRouter. Targets iOS and Android.

## Quick start

```bash
flutter pub get
flutter run --dart-define=FLEXPAY_API_BASE=http://10.0.2.2:8000/v1
```

(`10.0.2.2` is the Android emulator host address. On iOS simulator use `http://localhost:8000/v1`.)

## Layout

```
lib/
  main.dart
  src/
    theme.dart
    app_router.dart
    api/api_client.dart        # Dio with auth interceptor
    auth/
      auth_controller.dart     # Riverpod notifier: OTP flow, tokens
      token_store.dart         # flutter_secure_storage wrapper
    wallet/
      wallet_controller.dart   # FutureProvider for wallet snapshot
    screens/
      login_screen.dart
      home_screen.dart
test/
  widget_test.dart
```

## Adding a screen

1. Create `lib/src/screens/foo_screen.dart`.
2. Register in `lib/src/app_router.dart`.
3. If it calls the API, add a provider under the relevant feature folder (e.g., `lib/src/remittance/`).
