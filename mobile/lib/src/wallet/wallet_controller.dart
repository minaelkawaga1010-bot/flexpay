import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';

class Balance {
  const Balance({required this.currency, required this.available, required this.pending});
  final String currency;
  final int available;
  final int pending;

  factory Balance.fromJson(Map<String, dynamic> json) => Balance(
        currency: json['currency'] as String,
        available: json['available'] as int,
        pending: (json['pending'] ?? 0) as int,
      );
}

class WalletSnapshot {
  const WalletSnapshot({required this.id, required this.status, required this.balances});
  final String id;
  final String status;
  final List<Balance> balances;

  factory WalletSnapshot.fromJson(Map<String, dynamic> json) => WalletSnapshot(
        id: json['id'] as String,
        status: json['status'] as String,
        balances: (json['balances'] as List).map((b) => Balance.fromJson(b as Map<String, dynamic>)).toList(),
      );
}

final walletProvider = FutureProvider<WalletSnapshot>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final r = await dio.get('/wallet');
  return WalletSnapshot.fromJson(r.data as Map<String, dynamic>);
});
