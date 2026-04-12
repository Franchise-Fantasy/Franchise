import { DynastyScoreBadge } from '@/components/prospects/DynastyScoreBadge';
import { LandingSpotBar } from '@/components/prospects/LandingSpotBar';
import { ProspectNewsSection } from '@/components/prospects/ProspectNewsSection';
import { PremiumGate } from '@/components/PremiumGate';
import { RichTextRenderer } from '@/components/cms/RichTextRenderer';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useProspect } from '@/hooks/useProspect';
import { scoutingReportPreview } from '@/lib/prospect-mappers';
import { ms, s } from '@/utils/scale';
import { useLocalSearchParams } from 'expo-router';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useSubscription } from '@/hooks/useSubscription';

export default function ProspectProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { canAccess } = useSubscription();
  const isPremium = canAccess('prospects');

  const { data: prospect, isLoading } = useProspect(id);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={['top']}>
        <PageHeader title="Prospect" />
        <View style={styles.center}>
          <LogoSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!prospect) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={['top']}>
        <PageHeader title="Prospect" />
        <View style={styles.center}>
          <ThemedText style={{ color: c.secondaryText }}>Prospect not found</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  const initials = prospect.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title={prospect.name} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero block */}
        <View style={[styles.hero, { backgroundColor: c.tint }]}>
          <View style={styles.heroRow}>
            <View style={[styles.heroAvatarRing, { borderColor: c.gold }]}>
              {prospect.photoUrl ? (
                <Image
                  source={{ uri: prospect.photoUrl }}
                  style={styles.heroAvatar}
                  accessibilityLabel={`${prospect.name} photo`}
                />
              ) : (
                <View style={[styles.heroAvatar, styles.heroFallback]}>
                  <Text style={styles.heroInitials}>{initials}</Text>
                </View>
              )}
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroName}>{prospect.name}</Text>
              <Text style={styles.heroMeta}>
                {prospect.position} · {prospect.school}
              </Text>
              <View style={[styles.draftPill, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                <Text style={styles.draftPillText}>{prospect.projectedDraftYear} Draft Class</Text>
              </View>
            </View>
          </View>
          {prospect.dynastyValueScore > 0 && (
            <View style={styles.scoreRow}>
              <DynastyScoreBadge score={prospect.dynastyValueScore} size="large" />
              <Text style={styles.scoreLabel}>Dynasty score</Text>
            </View>
          )}
        </View>

        {/* Quick stats bar */}
        <View style={[styles.statsBar, { backgroundColor: c.card, borderColor: c.border }]}>
          {[
            { label: 'HEIGHT', value: prospect.height },
            { label: 'WEIGHT', value: prospect.weight },
            { label: 'CLASS', value: prospect.classYear },
            {
              label: 'ESPN',
              value: prospect.recruitingRank ? `#${prospect.recruitingRank}` : undefined,
            },
          ].map((stat, i) => (
            <View
              key={stat.label}
              style={[styles.statCell, i < 3 && { borderRightWidth: 1, borderRightColor: c.border }]}
              accessibilityLabel={`${stat.label}: ${stat.value ?? 'not available'}`}
            >
              <Text style={[styles.statVal, { color: c.text }]}>{stat.value ?? '—'}</Text>
              <Text style={[styles.statLabel, { color: c.secondaryText }]}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* YouTube highlights */}
        {prospect.youtubeId && (
          <View style={styles.section}>
            <Text style={[styles.secLabel, { color: c.tint }]}>HIGHLIGHTS</Text>
            <TouchableOpacity
              style={[styles.videoCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => Linking.openURL(`https://youtube.com/watch?v=${prospect.youtubeId}`)}
              accessibilityRole="link"
              accessibilityLabel="Watch highlights on YouTube"
            >
              <Ionicons name="logo-youtube" size={28} color="#FF0000" />
              <Text style={[styles.videoText, { color: c.text }]}>Watch highlights</Text>
              <Ionicons name="open-outline" size={16} color={c.secondaryText} />
            </TouchableOpacity>
          </View>
        )}

        {/* External links (Hudl, X) */}
        {(prospect.hudlUrl || prospect.xEmbedUrl) && (
          <View style={[styles.linksRow, styles.section]}>
            {prospect.hudlUrl && (
              <TouchableOpacity
                style={[styles.linkChip, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => Linking.openURL(prospect.hudlUrl!)}
                accessibilityRole="link"
                accessibilityLabel="View Hudl profile"
              >
                <Ionicons name="play-circle-outline" size={16} color={c.accent} />
                <Text style={[styles.linkText, { color: c.text }]}>Hudl film</Text>
              </TouchableOpacity>
            )}
            {prospect.xEmbedUrl && (
              <TouchableOpacity
                style={[styles.linkChip, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => Linking.openURL(prospect.xEmbedUrl!)}
                accessibilityRole="link"
                accessibilityLabel="View scout clip on X"
              >
                <Ionicons name="logo-twitter" size={16} color={c.accent} />
                <Text style={[styles.linkText, { color: c.text }]}>Scout clip</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Scouting report */}
        {prospect.scoutingReport && (
          <View style={styles.section}>
            <Text style={[styles.secLabel, { color: c.tint }]}>SCOUTING REPORT</Text>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {isPremium ? (
                <RichTextRenderer document={prospect.scoutingReport} />
              ) : (
                <>
                  <Text style={[styles.bodyText, { color: c.text }]}>
                    {scoutingReportPreview(prospect.scoutingReport)}
                  </Text>
                  <PremiumGate feature="prospects" mode="block" label="Unlock full scouting report">
                    <View />
                  </PremiumGate>
                </>
              )}
            </View>
          </View>
        )}

        {/* Landing spot projections */}
        {prospect.projectedTeams.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.secLabel, { color: c.tint }]}>LANDING SPOT PROJECTIONS</Text>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
              {prospect.projectedTeams.map((spot, i) => (
                <LandingSpotBar key={spot.team} spot={spot} index={i} />
              ))}
            </View>
            {prospect.landingSpotAnalysis && isPremium && (
              <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, marginTop: s(6) }]}>
                <RichTextRenderer document={prospect.landingSpotAnalysis} />
              </View>
            )}
          </View>
        )}

        {/* Latest news */}
        {prospect.playerId && <ProspectNewsSection playerId={prospect.playerId} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingBottom: s(100) },

  // Hero
  hero: {
    paddingHorizontal: s(16),
    paddingVertical: s(16),
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(14),
  },
  heroAvatarRing: {
    width: s(64),
    height: s(64),
    borderRadius: s(32),
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatar: {
    width: s(56),
    height: s(56),
    borderRadius: s(28),
  },
  heroFallback: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitials: {
    fontSize: ms(18),
    fontWeight: '700',
    color: '#fff',
  },
  heroInfo: {
    flex: 1,
  },
  heroName: {
    fontSize: ms(20),
    fontWeight: '700',
    color: '#fff',
  },
  heroMeta: {
    fontSize: ms(12),
    color: 'rgba(255,255,255,0.7)',
    marginTop: s(2),
  },
  draftPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: s(10),
    paddingVertical: s(3),
    borderRadius: 12,
    marginTop: s(6),
  },
  draftPillText: {
    fontSize: ms(10),
    fontWeight: '600',
    color: '#fff',
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginTop: s(12),
  },
  scoreLabel: {
    fontSize: ms(11),
    color: 'rgba(255,255,255,0.7)',
  },

  // Stats bar
  statsBar: {
    flexDirection: 'row',
    marginHorizontal: s(16),
    marginTop: s(-8),
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: s(10),
  },
  statVal: {
    fontSize: ms(14),
    fontWeight: '700',
  },
  statLabel: {
    fontSize: ms(8),
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: s(2),
  },

  // Sections
  section: {
    paddingHorizontal: s(16),
    marginTop: s(16),
  },
  secLabel: {
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: s(8),
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(12),
  },
  bodyText: {
    fontSize: ms(13),
    lineHeight: ms(20),
  },

  // Video
  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    borderRadius: 12,
    borderWidth: 1,
    padding: s(14),
  },
  videoText: {
    flex: 1,
    fontSize: ms(13),
    fontWeight: '600',
  },

  // Links
  linksRow: {
    flexDirection: 'row',
    gap: s(8),
  },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderRadius: 10,
    borderWidth: 1,
  },
  linkText: {
    fontSize: ms(12),
    fontWeight: '500',
  },
});
