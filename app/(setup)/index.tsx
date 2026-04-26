import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { BrandButton } from '@/components/ui/BrandButton';
import { BrandWordmark } from '@/components/ui/BrandWordmark';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

export default function SetupHome() {
  const router = useRouter();
  const c = useColors();

  return (
    <ThemedView style={styles.container}>
      <View style={styles.hero}>
        <View style={styles.eyebrowRow}>
          <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrow, { color: c.secondaryText }]}
          >
            WELCOME
          </ThemedText>
          <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
        </View>

        <BrandWordmark width={s(240)} />

        <ThemedText
          type="display"
          style={[styles.title, { color: c.text }]}
          accessibilityRole="header"
        >
          Tip-off.
        </ThemedText>

        <ThemedText
          style={[styles.subtitle, { color: c.secondaryText }]}
        >
          Create your own league or join one a friend has already started.
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <BrandButton
          label="Create a League"
          icon="add-circle-outline"
          onPress={() => router.push('/create-league' as any)}
          variant="primary"
          size="large"
          fullWidth
          accessibilityLabel="Create a league"
        />
        <BrandButton
          label="Join a League"
          icon="people-outline"
          onPress={() => router.push('/join-league' as any)}
          variant="secondary"
          size="large"
          fullWidth
          accessibilityLabel="Join a league"
        />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: s(32),
  },
  hero: {
    alignItems: 'center',
    marginBottom: s(40),
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(14),
  },
  eyebrowRule: {
    height: 2,
    width: s(20),
  },
  eyebrow: {
    fontSize: ms(11),
    letterSpacing: 1.6,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(26),
    lineHeight: ms(30),
    letterSpacing: -0.3,
    textAlign: 'center',
    marginTop: s(20),
  },
  subtitle: {
    marginTop: s(12),
    textAlign: 'center',
    fontSize: ms(14),
    lineHeight: ms(20),
    paddingHorizontal: s(8),
  },
  actions: {
    gap: s(12),
  },
});
