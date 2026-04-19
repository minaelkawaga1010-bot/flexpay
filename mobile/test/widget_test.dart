import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:flexpay/main.dart';

void main() {
  testWidgets('FlexPay launches to login screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: FlexPayApp()));
    await tester.pumpAndSettle();
    expect(find.text('FlexPay'), findsWidgets);
  });
}
