import { Ionicons } from '@expo/vector-icons';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

const APP_STORE_URL = 'itms-apps://itunes.apple.com/app/id6748905478';
const PLAY_STORE_URL = 'market://details?id=com.franchisev2';

interface Props {
  installedVersion: string;
  minimumVersion: string;
}

// Full-screen blocker shown when the installed app version is below the
// `min_supported_version` published in app_config. There is no skip — that's
// the whole point: this exists for shipping breaking schema/RPC changes
// safely, knowing old clients will be forced to update.
export function ForceUpdateScreen({ installedVersion, minimumVersion }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  function handleOpenStore() {
    const url = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
    Linking.openURL(url).catch(() => {
      // Fall back to web URLs if the native scheme is somehow unavailable.
      const webUrl = Platform.OS === 'ios'
        ? 'https://apps.apple.com/app/id6748905478'
        : 'https://play.google.com/store/apps/details?id=com.franchisev2';
      Linking.openURL(webUrl).catch(() => {});
    });
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.content}>
        <View style={[styles.iconCircle, { backgroundColor: c.activeCard }]}>
          <Ionicons
            name="cloud-download-outline"
            size={ms(40)}
            color={c.accent}
            accessible={false}
          />
        </View>
        <ThemedText type="title" style={styles.title}>
          Update required
        </ThemedText>
        <ThemedText style={[styles.body, { color: c.secondaryText }]}>
          A newer version of Franchise is required to keep playing. Your installed version ({installedVersion}) is no longer supported — minimum is {minimumVersion}.
        </ThemedText>
        <ThemedText style={[styles.body, { color: c.secondaryText }]}>
          Tap below to update from the {Platform.OS === 'ios' ? 'App Store' : 'Play Store'}, then reopen Franchise.
        </ThemedText>
      </View>

      <View style={styles.actions}>
        <BrandButton
          label={Platform.OS === 'ios' ? 'Open App Store' : 'Open Play Store'}
          onPress={handleOpenStore}
          variant="primary"
          fullWidth
          accessibilityLabel={`Open ${Platform.OS === 'ios' ? 'App Store' : 'Play Store'} to update Franchise`}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: s(24),
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(12),
  },
  iconCircle: {
    width: s(96),
    height: s(96),
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: s(20),
  },
  title: {
    fontSize: ms(24),
    textAlign: 'center',
    marginBottom: s(8),
  },
  body: {
    fontSize: ms(15),
    lineHeight: ms(22),
    textAlign: 'center',
    paddingHorizontal: s(8),
  },
  actions: {
    paddingBottom: s(16),
  },
});
