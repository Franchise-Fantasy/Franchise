import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
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

import { PremiumGate } from '@/components/account/PremiumGate';
import { RichTextRenderer } from '@/components/cms/RichTextRenderer';
import { LandingSpotBar } from '@/components/prospects/LandingSpotBar';
import { ProspectNewsSection } from '@/components/prospects/ProspectNewsSection';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useProspect } from '@/hooks/useProspect';
import { useSubscription } from '@/hooks/useSubscription';
import { scoutingReportPreview } from '@/lib/prospect-mappers';
import { ms, s } from '@/utils/scale';

// Embroidered F watermark — same asset used by HomeHero. Bundled at module
// scope so the require runs once, not on every render.
const PATCH_SOURCE = require('../../assets/images/patch_logo.png');


export default function ProspectProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const themed = useColors();
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

  // Eyebrow: "PG · DUKE · FRESHMAN" — varsity caps tied together by
  // mid-dots, gold-tinted, sits above the Alfa Slab name.
  const eyebrowSegments = [
    prospect.position,
    prospect.school,
    prospect.classYear,
  ].filter(Boolean) as string[];

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title={prospect.name} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero — HomeHero rhythm: turfGreen surface, top-left gold rule,
            embroidered F watermark, eyebrow → display name → stat row. */}
        <View style={[styles.hero, { backgroundColor: themed.heroSurface }, themed.heroShadow]}>
          <ExpoImage
            source={PATCH_SOURCE}
            style={styles.patch}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={0}
            accessible={false}
          />
          <View style={styles.topRule} />

          <View style={styles.eyebrowRow}>
            <ThemedText
              type="varsity"
              style={styles.eyebrow}
              numberOfLines={1}
            >
              {eyebrowSegments.join(' · ')}
            </ThemedText>
            {prospect.projectedDraftYear ? (
              <View style={styles.draftPill}>
                <ThemedText type="varsity" style={styles.draftPillText}>
                  {`${prospect.projectedDraftYear} CLASS`}
                </ThemedText>
              </View>
            ) : null}
          </View>

          <View style={styles.heroBody}>
            <View style={styles.heroAvatarRing}>
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
              <ThemedText
                type="display"
                style={styles.heroName}
                numberOfLines={2}
              >
                {prospect.name}.
              </ThemedText>
            </View>
          </View>

          {prospect.dynastyValueScore > 0 && (
            <View style={styles.statRow}>
              <Text style={styles.statValue}>{prospect.dynastyValueScore}</Text>
              <View style={styles.statDivider} />
              <ThemedText type="varsitySmall" style={styles.statLabel}>
                Dynasty Score
              </ThemedText>
            </View>
          )}
        </View>

        {/* Quick stats bar — mono values, varsity caps labels.
            Pulled up under the hero for the broadcast scoreboard feel. */}
        <View style={[styles.statsBar, { backgroundColor: c.card, borderColor: c.border }]}>
          {[
            { label: 'Height', value: prospect.height },
            { label: 'Weight', value: prospect.weight },
            { label: 'Class', value: prospect.classYear },
            {
              label: 'ESPN',
              value: prospect.recruitingRank ? `#${prospect.recruitingRank}` : undefined,
            },
          ].map((stat, i) => (
            <View
              key={stat.label}
              style={[
                styles.statCell,
                i < 3 && { borderRightWidth: 1, borderRightColor: c.border },
              ]}
              accessibilityLabel={`${stat.label}: ${stat.value ?? 'not available'}`}
            >
              <Text style={[styles.statVal, { color: c.text }]}>{stat.value ?? '—'}</Text>
              <ThemedText
                type="varsitySmall"
                style={[styles.statBarLabel, { color: c.secondaryText }]}
              >
                {stat.label}
              </ThemedText>
            </View>
          ))}
        </View>

        {/* YouTube highlights */}
        {prospect.youtubeId ? (
          <View style={styles.sectionWrap}>
            <Section title="Highlights">
              <TouchableOpacity
                style={styles.videoCard}
                onPress={() => Linking.openURL(`https://youtube.com/watch?v=${prospect.youtubeId}`)}
                accessibilityRole="link"
                accessibilityLabel="Watch highlights on YouTube"
              >
                <Ionicons name="logo-youtube" size={24} color="#FF0000" />
                <Text style={[styles.videoText, { color: c.text }]}>Watch highlights</Text>
                <Ionicons name="open-outline" size={16} color={c.secondaryText} />
              </TouchableOpacity>
            </Section>
          </View>
        ) : null}

        {/* External links (Hudl, X) */}
        {(prospect.hudlUrl || prospect.xEmbedUrl) && (
          <View style={[styles.linksRow, styles.sectionWrap]}>
            {prospect.hudlUrl && (
              <TouchableOpacity
                style={[styles.linkChip, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => Linking.openURL(prospect.hudlUrl!)}
                accessibilityRole="link"
                accessibilityLabel="View Hudl profile"
              >
                <Ionicons name="play-circle-outline" size={16} color={c.gold} />
                <ThemedText
                  type="varsity"
                  style={[styles.linkText, { color: c.text }]}
                >
                  Hudl Film
                </ThemedText>
              </TouchableOpacity>
            )}
            {prospect.xEmbedUrl && (
              <TouchableOpacity
                style={[styles.linkChip, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={() => Linking.openURL(prospect.xEmbedUrl!)}
                accessibilityRole="link"
                accessibilityLabel="View scout clip on X"
              >
                <Ionicons name="logo-twitter" size={16} color={c.gold} />
                <ThemedText
                  type="varsity"
                  style={[styles.linkText, { color: c.text }]}
                >
                  Scout Clip
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Scouting report */}
        {prospect.scoutingReport && (
          <View style={styles.sectionWrap}>
            <Section title="Scouting Report">
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
            </Section>
          </View>
        )}

        {/* Landing spot projections */}
        {prospect.projectedTeams.length > 0 && (
          <View style={styles.sectionWrap}>
            <Section title="Landing Spots">
              {prospect.projectedTeams.map((spot, i) => (
                <LandingSpotBar key={spot.team} spot={spot} index={i} />
              ))}
              {prospect.landingSpotAnalysis && isPremium && (
                <View style={styles.analysisBlock}>
                  <RichTextRenderer document={prospect.landingSpotAnalysis} />
                </View>
              )}
            </Section>
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

  // Hero — HomeHero pattern: turfGreen surface, top gold rule, embroidered
  // F watermark in the corner, ecru/cream type stack. Bottom is square so
  // the quick-stats bar can butt cleanly against it without exposing the
  // hero's bottom curvature.
  hero: {
    position: 'relative',
    paddingHorizontal: s(20),
    paddingTop: s(20),
    paddingBottom: s(18),
    marginHorizontal: s(16),
    marginTop: s(8),
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
  },
  topRule: {
    position: 'absolute',
    top: 0,
    left: s(20),
    height: 3,
    width: s(48),
    backgroundColor: Brand.vintageGold,
  },
  patch: {
    position: 'absolute',
    right: s(-18),
    bottom: s(-22),
    width: s(150),
    height: s(150),
    opacity: 0.16,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(8),
    marginBottom: s(10),
  },
  eyebrow: {
    color: Brand.vintageGold,
    flexShrink: 1,
  },
  draftPill: {
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(233, 226, 203, 0.45)',
    backgroundColor: 'rgba(233, 226, 203, 0.08)',
  },
  draftPillText: {
    color: Brand.ecru,
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(14),
  },
  heroAvatarRing: {
    width: s(72),
    height: s(72),
    borderRadius: s(36),
    borderWidth: 2.5,
    borderColor: Brand.vintageGold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatar: {
    width: s(64),
    height: s(64),
    borderRadius: s(32),
  },
  heroFallback: {
    backgroundColor: 'rgba(233, 226, 203, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitials: {
    fontSize: ms(20),
    fontWeight: '700',
    color: Brand.ecru,
  },
  heroInfo: {
    flex: 1,
  },
  heroName: {
    color: Brand.ecru,
    fontSize: ms(28),
    lineHeight: ms(34),
    letterSpacing: -0.4,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: s(14),
  },
  statValue: {
    color: Brand.ecru,
    fontFamily: Fonts.mono,
    fontSize: ms(20),
    letterSpacing: 0.3,
  },
  statDivider: {
    width: s(10),
    height: 1,
    backgroundColor: Brand.vintageGold,
    marginHorizontal: s(10),
    opacity: 0.7,
  },
  statLabel: {
    color: 'rgba(233, 226, 203, 0.78)',
    fontSize: ms(10),
    letterSpacing: 1.2,
  },

  // Quick stats bar — mono numerics + varsity caps. Top edge sits flush
  // against the hero's square bottom; only the bottom corners round so
  // the surface reads as a single layered scoreboard block.
  statsBar: {
    flexDirection: 'row',
    marginHorizontal: s(16),
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    borderWidth: 1,
    borderTopWidth: 0,
    overflow: 'hidden',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: s(12),
  },
  statVal: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    letterSpacing: 0.3,
  },
  statBarLabel: {
    fontSize: ms(9),
    letterSpacing: 1.2,
    marginTop: s(2),
  },

  // Sections — wrapped at the page level so Section primitive's gold rule
  // sits flush at the same horizontal inset as the hero / stats bar.
  sectionWrap: {
    paddingHorizontal: s(16),
    marginTop: s(18),
  },

  bodyText: {
    fontSize: ms(13),
    lineHeight: ms(20),
  },

  // Video chip
  videoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingVertical: s(4),
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
    fontSize: ms(11),
    letterSpacing: 1.0,
  },

  analysisBlock: {
    marginTop: s(8),
    paddingTop: s(8),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.25)',
  },
});
