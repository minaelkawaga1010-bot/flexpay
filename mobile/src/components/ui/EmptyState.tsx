import React from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@theme';
import { Text } from './Text';

interface Props {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<Props> = ({ title, subtitle, icon }) => (
  <View style={styles.root}>
    {icon ? <View style={{ marginBottom: spacing.base }}>{icon}</View> : null}
    <Text variant="h3" style={styles.title}>
      {title}
    </Text>
    {subtitle ? (
      <Text variant="body" color="secondary" style={styles.subtitle}>
        {subtitle}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  title: { textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { textAlign: 'center' },
});
