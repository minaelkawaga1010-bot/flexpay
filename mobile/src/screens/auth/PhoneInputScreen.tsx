import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button, Text } from '@components/ui';
import { PhoneInput } from '@components/forms';
import { authService } from '@services/api/auth';
import { handleApiError } from '@services/api/client';
import { validatePhone } from '@services/utils/validation';
import { haptics } from '@services/utils/haptics';
import { useKeyboard } from '@hooks/useKeyboard';
import * as Analytics from '@services/analytics/analytics';
import { EVENTS } from '@services/analytics/events';
import { AuthStackParamList } from '@types/navigation';
import { colors, spacing } from '@theme';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'PhoneInput'>;

export const PhoneInputScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { keyboardHeight } = useKeyboard();

  const [phone, setPhone] = useState('+971');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    if (!validatePhone(phone)) {
      setError(t('auth.errors.invalid_phone'));
      haptics.notification('error');
      return;
    }

    setError(null);
    setIsLoading(true);
    haptics.selection();

    try {
      Analytics.logEvent(EVENTS.OTP_REQUESTED, { phone_country: phone.slice(0, 4) });
      await authService.requestOTP({ phone });
      navigation.navigate('OTP', { phone });
    } catch (err) {
      const apiError = handleApiError(err);
      setError(apiError.message ?? t('auth.errors.otp_request_failed'));
      haptics.notification('error');
      Analytics.logError('otp_request_error', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: keyboardHeight + spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.content}>
            <Text variant="h1" style={styles.title}>
              {t('auth.phone.title')}
            </Text>
            <Text variant="body" color="secondary" style={styles.subtitle}>
              {t('auth.phone.subtitle')}
            </Text>

            <PhoneInput
              value={phone}
              onChange={setPhone}
              error={error}
              editable={!isLoading}
            />

            <View style={styles.cta}>
              <Button
                title={t('common.continue')}
                onPress={handleContinue}
                loading={isLoading}
                disabled={isLoading || phone.length < 12}
                size="large"
              />
            </View>

            <Text variant="caption" color="secondary" style={styles.terms}>
              {t('auth.phone.terms')}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.xl },
  content: { flex: 1, justifyContent: 'center' },
  title: { marginBottom: spacing.sm },
  subtitle: { marginBottom: spacing['2xl'] },
  cta: { marginTop: spacing['2xl'] },
  terms: { marginTop: spacing.xl, textAlign: 'center' },
});
