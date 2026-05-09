import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button, Input, LoadingSpinner, Text } from '@components/ui';
import { authService } from '@services/api/auth';
import { useAuth } from '@services/auth/useAuth';
import { handleApiError } from '@services/api/client';
import { haptics } from '@services/utils/haptics';
import { useBiometrics } from '@hooks/useBiometrics';
import * as Analytics from '@services/analytics/analytics';
import { EVENTS } from '@services/analytics/events';
import { AuthStackParamList } from '@/types/navigation';
import { colors, spacing } from '@theme';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'ProfileSetup'>;
type RoutePropType = RouteProp<AuthStackParamList, 'ProfileSetup'>;

export const ProfileSetupScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RoutePropType>();
  const { t } = useTranslation();
  const { login } = useAuth();
  const { enableBiometrics } = useBiometrics();

  const { phone, otp } = route.params;
  const [fullName, setFullName] = useState('');
  const [salary, setSalary] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const isValid = fullName.trim().length >= 2;

  const handleContinue = async () => {
    if (!isValid || isLoading) return;
    setIsLoading(true);
    haptics.selection();
    try {
      const parsedSalary = salary ? parseFloat(salary) : undefined;
      const response = await authService.verifyOTP({
        phone,
        otp,
        fullName: fullName.trim(),
        salary: Number.isFinite(parsedSalary as number) ? parsedSalary : undefined,
      });
      await login(response.accessToken, response.refreshToken, response.user);
      void enableBiometrics();
      Analytics.logEvent(EVENTS.AUTH_SUCCESS, { is_new_user: true });
      // RootNavigator swaps the stack once isAuthenticated flips.
    } catch (err) {
      const apiError = handleApiError(err);
      // The OTP gets re-stored when the backend raises FULL_NAME_REQUIRED,
      // so a TTL miss here means the user lingered too long. Send them back.
      if (apiError.error === 'UNAUTHORIZED' || apiError.statusCode === 401) {
        Alert.alert(t('auth.otp.invalid_title'), t('auth.otp.expired_message'));
        navigation.popToTop();
        return;
      }
      Alert.alert(t('common.error'), apiError.message ?? 'Something went wrong');
      Analytics.logError('profile_setup_error', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} testID="profile-setup-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text variant="h2" style={styles.title}>
            {t('auth.profile.title')}
          </Text>
          <Text variant="body" color="secondary" style={styles.subtitle}>
            {t('auth.profile.subtitle')}
          </Text>

          <Input
            label={t('auth.profile.full_name')}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Ahmed Mohamed"
            autoCapitalize="words"
            editable={!isLoading}
            testID="full-name-input"
          />

          <View style={styles.salary}>
            <Input
              label={t('auth.profile.salary')}
              value={salary}
              onChangeText={setSalary}
              placeholder="3500"
              keyboardType="numeric"
              prefix="AED"
              editable={!isLoading}
              testID="salary-input"
            />
          </View>

          <Button
            title={t('common.continue')}
            onPress={handleContinue}
            loading={isLoading}
            disabled={!isValid || isLoading}
            size="large"
            style={styles.cta}
            testID="continue-button"
          />
        </ScrollView>
      </KeyboardAvoidingView>

      {isLoading ? <LoadingSpinner overlay /> : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  flex: { flex: 1 },
  scroll: { padding: spacing.xl },
  title: { marginBottom: spacing.sm },
  subtitle: { marginBottom: spacing.xl },
  salary: { marginTop: spacing.base },
  cta: { marginTop: spacing['2xl'] },
});
