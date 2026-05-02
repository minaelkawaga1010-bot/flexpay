import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button, LoadingSpinner, Text } from '@components/ui';
import { OTPInput, OTPInputHandle } from '@components/forms/OTPInput';
import { authService } from '@services/api/auth';
import { useAuth } from '@services/auth/useAuth';
import { handleApiError } from '@services/api/client';
import { haptics } from '@services/utils/haptics';
import { useBiometrics } from '@hooks/useBiometrics';
import * as Analytics from '@services/analytics/analytics';
import { EVENTS } from '@services/analytics/events';
import { AuthStackParamList } from '@types/navigation';
import { colors, spacing } from '@theme';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'OTP'>;
type RoutePropType = RouteProp<AuthStackParamList, 'OTP'>;

export const OTPScreen: React.FC = () => {
  const route = useRoute<RoutePropType>();
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { login } = useAuth();
  const { enableBiometrics } = useBiometrics();
  const otpRef = useRef<OTPInputHandle>(null);

  const { phone } = route.params;
  const [otp, setOtp] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  const verify = async (code: string) => {
    setIsLoading(true);
    haptics.selection();
    try {
      const response = await authService.verifyOTP({ phone, otp: code });
      await login(response.accessToken, response.refreshToken, response.user);
      void enableBiometrics();
      Analytics.logEvent(EVENTS.AUTH_SUCCESS, {
        is_new_user: response.user.status === 'PENDING_KYC',
        plan: response.user.plan,
      });
      // RootNavigator swaps stacks once isAuthenticated flips.
    } catch (err) {
      const apiError = handleApiError(err);

      if (apiError.error === 'FULL_NAME_REQUIRED') {
        // First-time user — collect their profile and re-verify there.
        navigation.navigate('ProfileSetup', { phone, otp: code });
        return;
      }

      if (
        apiError.error === 'UNAUTHORIZED' ||
        apiError.error === 'INVALID_OR_EXPIRED_OTP' ||
        apiError.statusCode === 401
      ) {
        Alert.alert(t('auth.otp.invalid_title'), t('auth.otp.invalid_message'));
        setOtp('');
        otpRef.current?.focus();
      } else {
        Alert.alert(t('common.error'), apiError.message ?? 'Something went wrong');
      }
      Analytics.logError('otp_verify_error', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendTimer > 0) return;
    try {
      await authService.requestOTP({ phone });
      setResendTimer(30);
      haptics.success();
      Analytics.logEvent(EVENTS.OTP_RESENT);
    } catch {
      Alert.alert(t('common.error'), t('auth.otp.resend_failed'));
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="otp-screen">
      <View style={styles.content}>
        <Button
          title="←"
          variant="ghost"
          onPress={() => navigation.goBack()}
          style={styles.back}
          testID="otp-back-button"
        />

        <Text variant="h2" style={styles.title}>
          {t('auth.otp.title')}
        </Text>
        <Text variant="body" color="secondary" style={styles.subtitle}>
          {t('auth.otp.subtitle', { phone })}
        </Text>

        <OTPInput
          ref={otpRef}
          value={otp}
          onChange={setOtp}
          length={6}
          onComplete={verify}
          disabled={isLoading}
        />

        <View style={styles.actions}>
          <Button
            title={t('auth.otp.verify')}
            onPress={() => verify(otp)}
            loading={isLoading}
            disabled={otp.length !== 6 || isLoading}
            size="large"
            testID="verify-otp-button"
          />
          <Button
            variant="link"
            title={
              resendTimer > 0
                ? t('auth.otp.resend_wait', { seconds: resendTimer })
                : t('auth.otp.resend')
            }
            onPress={handleResend}
            disabled={resendTimer > 0 || isLoading}
            style={styles.resend}
            testID="resend-otp-button"
          />
        </View>
      </View>

      {isLoading ? <LoadingSpinner overlay /> : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  content: { flex: 1, padding: spacing.xl, justifyContent: 'center' },
  back: { position: 'absolute', top: spacing['2xl'], left: spacing.base, width: 44 },
  title: { marginBottom: spacing.sm },
  subtitle: { marginBottom: spacing['2xl'] },
  actions: { marginTop: spacing['2xl'], alignItems: 'center' },
  resend: { marginTop: spacing.base },
});
