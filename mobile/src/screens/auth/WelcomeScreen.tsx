import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { Button, Text } from '@components/ui';
import { AuthStackParamList } from '@/types/navigation';
import { colors, spacing } from '@theme';

type Nav = NativeStackNavigationProp<AuthStackParamList, 'Welcome'>;

export const WelcomeScreen: React.FC = () => {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.hero}>
        <Text variant="h1" style={styles.title}>
          FlexPay
        </Text>
        <Text variant="body" color="secondary" style={styles.subtitle}>
          {t('auth.phone.subtitle')}
        </Text>
      </View>

      <View style={styles.cta}>
        <Button title={t('common.continue')} size="large" onPress={() => navigation.navigate('PhoneInput')} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, padding: spacing.xl, justifyContent: 'space-between' },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { marginBottom: spacing.md },
  subtitle: { textAlign: 'center' },
  cta: { paddingBottom: spacing.lg },
});
