import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/token_store.dart';

const String kApiBaseUrl = String.fromEnvironment(
  'FLEXPAY_API_BASE',
  defaultValue: 'http://localhost:8000/v1',
);

final apiClientProvider = Provider<Dio>((ref) {
  final dio = Dio(BaseOptions(
    baseUrl: kApiBaseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 15),
    headers: {'content-type': 'application/json'},
  ));

  dio.interceptors.add(InterceptorsWrapper(
    onRequest: (options, handler) async {
      final token = await ref.read(tokenStoreProvider).readAccess();
      if (token != null && token.isNotEmpty) {
        options.headers['authorization'] = 'Bearer $token';
      }
      handler.next(options);
    },
    onError: (err, handler) async {
      if (err.response?.statusCode == 401) {
        // TODO: refresh-token flow; for now, clear and let router redirect to login.
        await ref.read(tokenStoreProvider).clear();
      }
      handler.next(err);
    },
  ));

  return dio;
});
