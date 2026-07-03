import { Ionicons } from '@expo/vector-icons';
import type { UseMutationResult } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { ScreenshotCapture } from '@/components/import/ScreenshotCapture';
import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors, Fonts } from '@/constants/Colors';
import { formatSeason, parseSeasonStartYear, type Sport } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { HistoryExtractionResult, HistoryTeam, ImageData } from '@/hooks/useImportScreenshot';
import { ms, s } from '@/utils/scale';

import type { HistorySeasonData } from './state';

interface StepHistoryProps {
  historySeasons: HistorySeasonData[];
  currentHistoryIndex: number;
  onSetSeasonCount: (count: number) => void;
  onSetImages: (seasonIndex: number, images: ImageData[]) => void;
  onSetExtracted: (seasonIndex: number, data: HistoryExtractionResult) => void;
  onSelectSeason: (index: number) => void;
  onExtractHistory: (seasonIndex: number) => void;
  extractHistoryMutation: UseMutationResult<unknown, unknown, unknown, unknown>;
  scrollToTop: () => void;
  /** Team names to pre-fill manual standings rows. */
  teamNames: string[];
  /** The league's current season + sport, used to label past seasons. */
  season: string;
  sport: Sport;
}

export function StepHistory({
  historySeasons,
  currentHistoryIndex,
  onSetSeasonCount,
  onSetImages,
  onSetExtracted,
  onSelectSeason,
  onExtractHistory,
  extractHistoryMutation,
  scrollToTop,
  teamNames,
  season,
  sport,
}: StepHistoryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Which season index is currently being entered manually (null = none).
  const [manualIndex, setManualIndex] = useState<number | null>(null);

  const currentSeason = historySeasons[currentHistoryIndex];

  // Season 1 (index 0) is the most recent past season — one before the league's
  // current season; each subsequent index steps another year back.
  const pastSeasonLabel = (index: number) =>
    formatSeason(parseSeasonStartYear(season) - (index + 1), sport);

  const saveManual = (index: number, teams: HistoryTeam[]) => {
    onSetExtracted(index, { season: pastSeasonLabel(index), teams });
    setManualIndex(null);
  };

  return (
    <View style={styles.container}>
      <FormSection title="Seasons of History">
        <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
          Optional — import past standings so your league history shows
          up on day one. You don't have to do this now: skip it and, as
          commissioner, add past seasons anytime from League Info →
          "Add Season History."
        </ThemedText>

        <NumberStepper
          label="Past Seasons"
          value={historySeasons.length}
          onValueChange={onSetSeasonCount}
          min={0}
          max={10}
          helperText={
            historySeasons.length === 0
              ? '0 = skip for now — you can add history later.'
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
                  onPress={() => onSelectSeason(i)}
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

          {manualIndex === currentHistoryIndex ? (
            <ManualStandingsEditor
              teamNames={teamNames}
              existing={currentSeason.extracted}
              onSave={(teams) => saveManual(currentHistoryIndex, teams)}
              onCancel={() => setManualIndex(null)}
            />
          ) : (
            <>
              <ScreenshotCapture
                images={currentSeason.images}
                onImagesChange={(imgs) => onSetImages(currentHistoryIndex, imgs)}
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

              {!currentSeason.extracted && (
                <BrandButton
                  label="Enter Standings Manually"
                  variant="secondary"
                  size="default"
                  fullWidth
                  icon="create-outline"
                  onPress={() => setManualIndex(currentHistoryIndex)}
                  accessibilityLabel={`Enter standings manually for season ${currentHistoryIndex + 1}`}
                  style={styles.manualBtn}
                />
              )}
            </>
          )}

          {manualIndex !== currentHistoryIndex && currentSeason.extracted && currentSeason.extracted.teams.length > 0 && (
            <View style={[styles.resultCard, { backgroundColor: c.input, borderColor: c.border }]}>
              <View style={styles.resultHeaderRow}>
                <ThemedText
                  type="varsitySmall"
                  style={[styles.resultHeader, { color: c.secondaryText }]}
                >
                  Standings
                  {currentSeason.extracted.season ? ` · ${currentSeason.extracted.season}` : ''}
                </ThemedText>
                <TouchableOpacity
                  onPress={() => setManualIndex(currentHistoryIndex)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit standings for season ${currentHistoryIndex + 1}`}
                  style={styles.resultEditBtn}
                >
                  <Ionicons name="create-outline" size={ms(16)} color={c.secondaryText} />
                </TouchableOpacity>
              </View>
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
                    onSelectSeason(currentHistoryIndex - 1);
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
                    onSelectSeason(currentHistoryIndex + 1);
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

// ─── Manual standings editor ────────────────────────────────────────

interface ManualRow {
  team_name: string;
  wins: string;
  losses: string;
  points_for: string;
  points_against: string;
}

/**
 * Type past-season standings instead of OCR-ing a screenshot. Rows pre-fill
 * with the league's team names. The final standing is derived on save by
 * sorting on wins (then points-for) — the same ordering reverse-standings draft
 * seeding uses — so a typed season and a screenshot season are interchangeable.
 */
function ManualStandingsEditor({
  teamNames,
  existing,
  onSave,
  onCancel,
}: {
  teamNames: string[];
  existing: HistoryExtractionResult | null;
  onSave: (teams: HistoryTeam[]) => void;
  onCancel: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const seed = (): ManualRow[] => {
    if (existing?.teams.length) {
      return existing.teams.map((t) => ({
        team_name: t.team_name,
        wins: t.wins != null ? String(t.wins) : '',
        losses: t.losses != null ? String(t.losses) : '',
        points_for: t.points_for != null ? String(t.points_for) : '',
        points_against: t.points_against != null ? String(t.points_against) : '',
      }));
    }
    return teamNames.map((name) => ({ team_name: name, wins: '', losses: '', points_for: '', points_against: '' }));
  };
  const [rows, setRows] = useState<ManualRow[]>(seed);

  const setRow = (index: number, patch: Partial<ManualRow>) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const namedRows = rows.filter((r) => r.team_name.trim().length > 0);
  const canSave = namedRows.length >= 2;

  const handleSave = () => {
    const toNum = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    };
    // Final standing = sort by wins desc, then points-for desc.
    const ranked = namedRows
      .map((r) => ({
        team_name: r.team_name.trim(),
        wins: toNum(r.wins),
        losses: toNum(r.losses),
        ties: 0,
        points_for: r.points_for.trim() ? toNum(r.points_for) : 0,
        points_against: r.points_against.trim() ? toNum(r.points_against) : 0,
      }))
      .sort((a, b) => b.wins - a.wins || b.points_for - a.points_for)
      .map((t, i): HistoryTeam => ({ ...t, standing: i + 1 }));
    onSave(ranked);
  };

  return (
    <View style={styles.manualEditor}>
      <View style={[styles.manualHeaderRow, { borderBottomColor: c.border }]}>
        <ThemedText type="varsitySmall" style={[styles.manualHeadTeam, { color: c.secondaryText }]}>
          Team
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.manualHeadStat, { color: c.secondaryText }]}>W</ThemedText>
        <ThemedText type="varsitySmall" style={[styles.manualHeadStat, { color: c.secondaryText }]}>L</ThemedText>
        <ThemedText type="varsitySmall" style={[styles.manualHeadPf, { color: c.secondaryText }]}>PF</ThemedText>
        <ThemedText type="varsitySmall" style={[styles.manualHeadPf, { color: c.secondaryText }]}>PA</ThemedText>
      </View>

      {rows.map((row, index) => (
        <View key={index} style={styles.manualRow}>
          <View style={styles.manualTeamCell}>
            <BrandTextInput
              value={row.team_name}
              onChangeText={(v) => setRow(index, { team_name: v })}
              placeholder={`Team ${index + 1}`}
              accessibilityLabel={`Team ${index + 1} name`}
            />
          </View>
          <View style={styles.manualStatCell}>
            <BrandTextInput
              value={row.wins}
              onChangeText={(v) => setRow(index, { wins: v.replace(/[^0-9]/g, '') })}
              placeholder="0"
              keyboardType="number-pad"
              inputStyle={styles.manualInput}
              accessibilityLabel={`${row.team_name || `Team ${index + 1}`} wins`}
            />
          </View>
          <View style={styles.manualStatCell}>
            <BrandTextInput
              value={row.losses}
              onChangeText={(v) => setRow(index, { losses: v.replace(/[^0-9]/g, '') })}
              placeholder="0"
              keyboardType="number-pad"
              inputStyle={styles.manualInput}
              accessibilityLabel={`${row.team_name || `Team ${index + 1}`} losses`}
            />
          </View>
          <View style={styles.manualPfCell}>
            <BrandTextInput
              value={row.points_for}
              onChangeText={(v) => setRow(index, { points_for: v.replace(/[^0-9]/g, '') })}
              placeholder="—"
              keyboardType="number-pad"
              inputStyle={styles.manualInput}
              accessibilityLabel={`${row.team_name || `Team ${index + 1}`} points for`}
            />
          </View>
          <View style={styles.manualPfCell}>
            <BrandTextInput
              value={row.points_against}
              onChangeText={(v) => setRow(index, { points_against: v.replace(/[^0-9]/g, '') })}
              placeholder="—"
              keyboardType="number-pad"
              inputStyle={styles.manualInput}
              accessibilityLabel={`${row.team_name || `Team ${index + 1}`} points against`}
            />
          </View>
        </View>
      ))}

      <ThemedText style={[styles.manualHint, { color: c.secondaryText }]}>
        Final standings are ordered by wins, then points-for. PF and PA are optional; PF breaks ties.
      </ThemedText>

      <View style={styles.manualActions}>
        <BrandButton
          label="Save Standings"
          variant="primary"
          size="small"
          onPress={handleSave}
          disabled={!canSave}
          accessibilityLabel="Save manual standings"
        />
        <BrandButton
          label="Cancel"
          variant="ghost"
          size="small"
          onPress={onCancel}
          accessibilityLabel="Cancel manual standings"
        />
      </View>
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

  manualBtn: {
    marginTop: s(4),
  },

  // ─── Extracted standings card ──────────────────────────────
  resultCard: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  resultHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resultEditBtn: {
    paddingHorizontal: s(10),
    paddingVertical: s(8),
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

  // ─── Manual standings editor ───────────────────────────────
  manualEditor: {
    gap: s(8),
  },
  manualHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingBottom: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  manualHeadTeam: {
    flex: 1,
    fontSize: ms(10),
  },
  manualHeadStat: {
    width: s(44),
    textAlign: 'center',
    fontSize: ms(10),
  },
  manualHeadPf: {
    width: s(56),
    textAlign: 'center',
    fontSize: ms(10),
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  manualTeamCell: {
    flex: 1,
  },
  manualStatCell: {
    width: s(44),
  },
  manualPfCell: {
    width: s(56),
  },
  manualInput: {
    paddingHorizontal: s(6),
    textAlign: 'center',
  },
  manualHint: {
    fontSize: ms(11),
    fontStyle: 'italic',
    lineHeight: ms(15),
  },
  manualActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingTop: s(2),
  },
});
