import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import type { AnnouncementBannerProps } from '@/types/cms';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

const SEVERITY_CONFIG = {
  info: { icon: 'information-circle-outline' as const, colorKey: 'accent' as const },
  warning: { icon: 'warning-outline' as const, colorKey: 'warning' as const },
  urgent: { icon: 'alert-circle-outline' as const, colorKey: 'danger' as const },
};

export function AnnouncementBanner({
  title,
  bodyExcerpt,
  severity,
  pinned,
  onPress,
}: AnnouncementBannerProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const config = SEVERITY_CONFIG[severity] ?? SEVERITY_CONFIG.info;
  const severityColor = c[config.colorKey];

  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? { onPress, activeOpacity: 0.7, accessibilityRole: 'button' as const }
    : {};

  return (
    <Wrapper
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.border, borderLeftColor: severityColor },
      ]}
      accessibilityRole={severity === 'urgent' ? 'alert' : 'summary'}
      accessibilityLabel={`${severity} announcement: ${title}`}
      {...wrapperProps}
    >
      <View style={styles.header}>
        <Ionicons name={config.icon} size={20} color={severityColor} />
        <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={1}>
          {title}
        </ThemedText>
        {pinned ? (
          <Ionicons
            name="pin"
            size={14}
            color={c.secondaryText}
            style={styles.pin}
            accessibilityLabel="Pinned"
          />
        ) : null}
      </View>
      {bodyExcerpt ? (
        <ThemedText style={[styles.body, { color: c.secondaryText }]} numberOfLines={2}>
          {bodyExcerpt}
        </ThemedText>
      ) : null}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    borderWidth: 1,
    borderLeftWidth: 4,
    padding: 14,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 14,
    flex: 1,
  },
  pin: {
    marginLeft: 4,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
    paddingLeft: 28, // align with title text (icon width + gap)
  },
});
