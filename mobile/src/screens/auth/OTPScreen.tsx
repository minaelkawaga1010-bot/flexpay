import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button, Input, LoadingSpinner, Text } from '@components/ui';
import { OTPInput } from '@components/forms';
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
  const inputRef = useRef<TextInput>(null);

  const { phone } = route.params;
  const [otp, setOtp] = useState('');
  const [fullName, setFullName] = useState('');
  const [salary, setSalary] = useState('');
  const [step, setStep] = useState<'verify' | 'profile'>('verify');
  const [isLoading, setIsLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      haptics.notification('warning');
      return;
    }
    if (step === 'profile' && (!fullName.trim() || !salary)) return;

    setIsLoading(true);
    haptics.selection();

    try {
      const response = await authService.verifyOTP({
        phone,
        otp,
        fullName: step === 'profile' ? fullName.trim() : 'New User',
        salary: step === 'profile' && salary ? parseFloat(salary) : undefined,
      });

      await login(response.accessToken, response.refreshToken, response.user);
      // Best-effort biometric setup; user can decline.
      void enableBiometrics();

      Analytics.logEvent(EVENTS.AUTH_SUCCESS, {
        is_new_user: response.user.status === 'PENDING_KYC',
        plan: response.user.plan,
      });
      // RootNavigator will swap stacks once `isAuthenticated` flips.
    } catch (err) {
      const apiError = handleApiError(err);

      // The backend creates the employee on the first verify, so a
      // missing-name response only happens if validation rejects us. The
      // user-facing case here is just "invalid OTP".
      if (apiError.error === 'UNAUTHORIZED' || apiError.error === 'INVALID_OR_EXPIRED_OTP') {
        Alert.alert(t('auth.otp.invalid_title'), t('auth.otp.invalid_message'));
        setOtp('');
        inputRef.current?.focus();
      } else if (apiError.error === 'BAD_REQUEST' && step === 'verify') {
        // Backend's verifyOtpSchema requires fullName — escalate to profile step.
        setStep('profile');
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
    <SafeAreaView style={styles.root}>
      <View style={styles.content}>
        <Button
          title="←"
          variant="ghost"
          onPress={() => navigation.goBack()}
          style={styles.back}
        />

        <Text variant="h2" style={styles.title}>
          {step === 'verify' ? t('auth.otp.title') : t('auth.profile.title')}
        </Text>
        <Text variant="body" color="secondary" style={styles.subtitle}>
          {step === 'verify' ? t('auth.otp.subtitle', { phone }) : t('auth.profile.subtitle')}
        </Text>

        {step === 'verify' ? (
          <>
            <OTPInput
              value={otp}
              onChange={setOtp}
              length={6}
              inputRef={inputRef}
              onComplete={handleVerify}
              disabled={isLoading}
            />
            <View style={styles.actions}>
              <Button
                title={t('auth.otp.verify')}
                onPress={handleVerify}
                loading={isLoading}
                disabled={otp.length !== 6 || isLoading}
                size="large"
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
              />
            </View>
          </>
        ) : (
          <>
            <Input
              label={t('auth.profile.full_name')}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Ahmed Mohamed"
              autoCapitalize="words"
              editable={!isLoading}
            />
            <Input
              label={t('auth.profile.salary')}
              value={salary}
              onChangeText={setSalary}
              placeholder="3500"
              keyboardType="numeric"
              prefix="AED"
              editable={!isLoading}
              containerStyle={styles.salary}
            />
            <Button
              title={t('common.continue')}
              onPress={handleVerify}
              loading={isLoading}
              disabled={!fullName || !salary || isLoading}
              size="large"
              style={styles.cta}
            />
          </>
        )}
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
  salary: { marginTop: spacing.base },
  cta: { marginTop: spacing['2xl'] },
});
