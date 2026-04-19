import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import 'token_store.dart';

class AuthState {
  const AuthState({required this.isAuthenticated, this.phone});
  final bool isAuthenticated;
  final String? phone;

  AuthState copyWith({bool? isAuthenticated, String? phone}) =>
      AuthState(isAuthenticated: isAuthenticated ?? this.isAuthenticated, phone: phone ?? this.phone);
}

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    // Hydrate from storage on startup.
    ref.read(tokenStoreProvider).readAccess().then((t) {
      if (t != null && t.isNotEmpty) state = state.copyWith(isAuthenticated: true);
    });
    return const AuthState(isAuthenticated: false);
  }

  Future<String> requestOtp(String phone) async {
    final dio = ref.read(apiClientProvider);
    final r = await dio.post('/auth/otp/request', data: {'phone': phone, 'channel': 'sms'});
    state = state.copyWith(phone: phone);
    return r.data['request_id'] as String;
  }

  Future<void> verifyOtp(String requestId, String code, {required String deviceId}) async {
    final dio = ref.read(apiClientProvider);
    try {
      final r = await dio.post('/auth/otp/verify', data: {
        'request_id': requestId,
        'code': code,
        'device_id': deviceId,
      });
      final access = r.data['access_token'] as String;
      final refresh = r.data['refresh_token'] as String;
      await ref.read(tokenStoreProvider).save(access, refresh);
      state = state.copyWith(isAuthenticated: true);
    } on DioException catch (e) {
      throw AuthException(e.response?.data?['detail']?.toString() ?? 'login failed');
    }
  }

  Future<void> logout() async {
    await ref.read(tokenStoreProvider).clear();
    state = const AuthState(isAuthenticated: false);
  }
}

class AuthException implements Exception {
  AuthException(this.message);
  final String message;

  @override
  String toString() => message;
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
