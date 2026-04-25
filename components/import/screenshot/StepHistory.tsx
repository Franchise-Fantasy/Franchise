import type { UseMutationResult } from '@tanstack/react-query';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ScreenshotCapture } from '@/components/import/ScreenshotCapture';
import { BrandButton } from '@/components/ui/BrandButton';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import type { Action, HistorySeasonData } from './state';

interface StepHistoryProps {
  historySeasons: HistorySeasonData[];
  currentHistoryIndex: number;
  dispatch: React.Dispatch<Action>;
  onExtractHistory: (seasonIndex: number) => void;
  extractHistoryMutation: UseMutationResult<unknown, unknown, unknown, unknown>;
  scrollToTop: () => void;
}

export function StepHistory({
  historySeasons,
  currentHistoryIndex,
  dispatch,
  onExtractHistory,
  extractHistoryMutation,
  scrollToTop,
}: StepHistoryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const currentSeason = historySeasons[currentHistoryIndex];

  return (
    <View style={styles.container}>
      <FormSection title="Seasons of History">
        <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
          Optional — import past standings so your league history shows
          up on day one. Skip if you're starting fresh.
        </ThemedText>

        <NumberStepper
          label="Past Seasons"
          value={historySeasons.length}
          onValueChange={(v) => dispatch({ type: 'SET_HISTORY_SEASON_COUNT', count: v })}
          min={0}
          max={10}
          helperText={
            historySeasons.length === 0
              ? '0 = skip history import entirely.'
              : undefined
          }
          last
        />
      </FormSection>

      {historySeasons.length > 0 && currentSeason && (
        <Section title={`Season ${currentHistoryIndex + 1} Standings`}>
          {historySeasons.length > 1 && (
            <View style={styles.pipRow}>
              {historySeasons.map((s, i) => (
                <TouchableOpacity
                  key={i}
                  onPress={() => dispatch({ type: 'SET_CURRENT_HISTORY', index: i })}
                  style={[
                    styles.pip,
                    {
                      backgroundColor:
                        i === currentHistoryIndex
                          ? Brand.vintageGold
                          : s.extracted
                            ? c.success
                            : 'transparent',
                      borderColor:
                        i === currentHistoryIndex
                          ? Brand.vintageGold
                          : s.extracted
                            ? c.success
                            : c.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Season ${i + 1}${s.extracted ? ', extracted' : ''}`}
                />
              ))}
              <ThemedText
                type="varsitySmall"
                style={[styles.pipLabel, { color: c.secondaryText }]}
              >
                {currentHistoryIndex + 1} of {historySeasons.length}
              </ThemedText>
            </View>
          )}

          <ScreenshotCapture
            images={currentSeason.images}
            onImagesChange={(imgs) =>
              dispatch({ type: 'SET_HISTORY_IMAGES', seasonIndex: currentHistoryIndex, images: imgs })
            }
            maxImages={3}
            label="Standings Screenshots"
          />

          {currentSeason.images.length > 0 && !currentSeason.extracted && (
            <BrandButton
              label="Extract History"
              variant="primary"
              size="default"
              fullWidth
              onPress={() => onExtractHistory(currentHistoryIndex)}
              loading={extractHistoryMutation.isPending}
              accessibilityLabel={`Extract history for season ${currentHistoryIndex + 1}`}
            />
          )}

          {currentSeason.extracted && currentSeason.extracted.teams.length > 0 && (
            <View style={[styles.resultCard, { backgroundColor: c.input, borderColor: c.border }]}>
              <ThemedText
                type="varsitySmall"
                style={[styles.resultHeader, { color: c.secondaryText }]}
              >
                Extracted Standings
                {currentSeason.extracted.season ? ` · ${currentSeason.extracted.season}` : ''}
              </ThemedText>
              {currentSeason.extracted.teams.map((t, i, arr) => (
                <View
                  key={i}
                  style={[
                    styles.resultRow,
                    { borderBottomColor: c.border },
                    i === arr.length - 1 && { borderBottomWidth: 0 },
                  ]}
                >
                  <Text style={[styles.resultRank, { color: c.text }]}>
                    {t.standing ?? i + 1}
                  </Text>
                  <ThemedText
                    style={[styles.resultTeam, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {t.team_name}
                  </ThemedText>
                  <Text style={[styles.resultRecord, { color: c.secondaryText }]}>
                    {t.wins ?? 0}-{t.losses ?? 0}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {historySeasons.length > 1 && (
            <View style={styles.seasonNavRow}>
              {currentHistoryIndex > 0 ? (
                <BrandButton
                  label="Prev Season"
                  variant="secondary"
                  size="small"
                  icon="chevron-back"
                  onPress={() => {
                    dispatch({ type: 'SET_CURRENT_HISTORY', index: currentHistoryIndex - 1 });
                    scrollToTop();
                  }}
                  accessibilityLabel="Previous season"
                />
              ) : (
                <View />
              )}
              {currentHistoryIndex < historySeasons.length - 1 ? (
                <BrandButton
                  label="Next Season"
                  variant="primary"
                  size="small"
                  onPress={() => {
                    dispatch({ type: 'SET_CURRENT_HISTORY', index: currentHistoryIndex + 1 });
                    scrollToTop();
                  }}
                  accessibilityLabel="Next season"
                />
              ) : (
                <View />
              )}
            </View>
          )}
        </Section>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  desc: {
    fontSize: ms(12),
    lineHeight: ms(17),
  },

  // ─── Season pip stepper ────────────────────────────────────
  pipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
  },
  pip: {
    width: s(8),
    height: s(8),
    borderRadius: s(4),
    borderWidth: 1,
  },
  pipLabel: {
    marginLeft: 'auto',
    fontSize: ms(10),
  },

  // ─── Extracted standings card ──────────────────────────────
  resultCard: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  resultHeader: {
    paddingHorizontal: s(12),
    paddingTop: s(10),
    paddingBottom: s(6),
    fontSize: ms(10),
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    gap: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultRank: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
    width: s(22),
  },
  resultTeam: {
    flex: 1,
    fontSize: ms(13),
    fontWeight: '500',
  },
  resultRecord: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // ─── Season nav ────────────────────────────────────────────
  seasonNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: s(4),
  },
});
