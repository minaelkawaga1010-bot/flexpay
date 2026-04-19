import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../auth/auth_controller.dart';
import '../wallet/wallet_controller.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final wallet = ref.watch(walletProvider);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Your Wallet'),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(walletProvider),
        child: wallet.when(
          data: (w) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Status: ${w.status}', style: Theme.of(context).textTheme.bodySmall),
                      const SizedBox(height: 12),
                      for (final b in w.balances)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Text(
                            '${b.currency}  ${_fmt(b.available)}',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                        ),
                      if (w.balances.isEmpty)
                        const Text('No balances yet — top up to get started.'),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
              _ActionGrid(),
            ],
          ),
          error: (e, _) => Center(child: Text('Failed: $e')),
          loading: () => const Center(child: CircularProgressIndicator()),
        ),
      ),
    );
  }

  String _fmt(int minorUnits) {
    final f = NumberFormat.decimalPattern();
    return f.format(minorUnits / 100);
  }
}

class _ActionGrid extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final actions = <({IconData icon, String label})>[
      (icon: Icons.add_card, label: 'Top up'),
      (icon: Icons.send, label: 'Send'),
      (icon: Icons.public, label: 'Remit'),
      (icon: Icons.receipt_long, label: 'Bills'),
      (icon: Icons.savings, label: 'Hafiza'),
      (icon: Icons.mic, label: 'Voice'),
    ];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      children: [
        for (final a in actions)
          Card(
            child: InkWell(
              onTap: () {},
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [Icon(a.icon, size: 32), const SizedBox(height: 8), Text(a.label)],
              ),
            ),
          ),
      ],
    );
  }
}
