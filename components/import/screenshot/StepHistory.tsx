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
import { SortableList } from '@/components/ui/SortableList';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors, Fonts } from '@/constants/Colors';
import { formatSeason, parseSeasonStartYear, type Sport } from '@/constants/LeagueDefaults';
import { useActionPicker } from '@/context/ConfirmProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { HistoryExtractionResult, HistoryTeam, ImageData } from '@/hooks/useImportScreenshot';
import { PLAYOFF_RESULT } from '@/types/playoff';
import { ms, s } from '@/utils/scale';

import type { HistorySeasonData } from './state';

const PLAYOFF_RESULT_LABELS: Record<string, string> = {
  [PLAYOFF_RESULT.CHAMPION]: 'Champion',
  [PLAYOFF_RESULT.RUNNER_UP]: 'Runner-up',
  [PLAYOFF_RESULT.THIRD_PLACE]: '3rd Place',
  [PLAYOFF_RESULT.FOURTH_PLACE]: '4th Place',
  [PLAYOFF_RESULT.MISSED_PLAYOFFS]: 'Missed Playoffs',
};

function formatPlayoffResult(result: string): string {
  return PLAYOFF_RESULT_LABELS[result] ?? result;
}

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
  const enteredCount = historySeasons.filter((h) => h.extracted?.teams?.length).length;

  // Season 1 (index 0) is the most recent past season — one before the league's
  // current season; each subsequent index steps another year back.
  const pastSeasonLabel = (index: number) =>
    formatSeason(parseSeasonStartYear(season) - (index + 1), sport);

  const saveManual = (index: number, teams: HistoryTeam[]) => {
    onSetExtracted(index, { season: pastSeasonLabel(index), teams });
    setManualIndex(null);
  };

  const pickAction = useActionPicker();

  // ─── Reconcile extracted standings to league teams ──────────────────
  // OCR / typed names are rewritten to a current team name so the importer
  // exact-matches the right franchise. A row is "matched" once its team_name
  // is one of the league's team names; tapping a row re-picks the team.
  const extractedTeams = currentSeason?.extracted?.teams ?? [];
  const matchedCount = extractedTeams.filter((t) => teamNames.includes(t.team_name)).length;
  const allMatched = extractedTeams.length > 0 && matchedCount === extractedTeams.length;

  const assignTeam = (rowIndex: number, leagueName: string | null) => {
    if (!currentSeason?.extracted) return;
    const next = currentSeason.extracted.teams.map((t, i) => {
      // null = leave unmatched: revert this row to its original extracted name.
      if (i === rowIndex) return { ...t, team_name: leagueName ?? t.source_name ?? t.team_name };
      // Each league team maps to one row — steal it back from whoever held it.
      if (leagueName && teamNames.includes(t.team_name) && t.team_name === leagueName) {
        return { ...t, team_name: t.source_name ?? t.team_name };
      }
      return t;
    });
    onSetExtracted(currentHistoryIndex, { ...currentSeason.extracted, teams: next });
  };

  const openTeamPicker = (rowIndex: number) => {
    const row = currentSeason?.extracted?.teams[rowIndex];
    if (!row) return;
    const source = row.source_name ?? row.team_name;
    const takenByOthers = new Set(
      extractedTeams
        .filter((x, i) => i !== rowIndex && teamNames.includes(x.team_name))
        .map((x) => x.team_name),
    );
    pickAction({
      title: 'Match to a team',
      subtitle: `Standings row “${source}”`,
      actions: [
        ...teamNames.map((name) => ({
          id: name,
          label: takenByOthers.has(name) ? `${name} · reassign` : name,
          icon: (row.team_name === name
            ? 'checkmark-circle'
            : 'ellipse-outline') as keyof typeof Ionicons.glyphMap,
          onPress: () => assignTeam(rowIndex, name),
        })),
        {
          id: '__skip__',
          label: 'Leave unmatched (skip this row)',
          icon: 'close-circle-outline' as keyof typeof Ionicons.glyphMap,
          destructive: true,
          onPress: () => assignTeam(rowIndex, null),
        },
      ],
    });
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
              : `${enteredCount} of ${historySeasons.length} entered so far.`
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
              <View style={styles.pipProgress}>
                {enteredCount > 0 && (
                  <Ionicons name="checkmark-circle" size={ms(12)} color={c.success} accessible={false} />
                )}
                <ThemedText
                  type="varsitySmall"
                  style={[styles.pipLabel, { color: c.secondaryText }]}
                >
                  {enteredCount} of {historySeasons.length} entered
                </ThemedText>
              </View>
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

              <View style={styles.matchStatusRow}>
                <Ionicons
                  name={allMatched ? 'checkmark-circle' : 'alert-circle'}
                  size={ms(13)}
                  color={allMatched ? c.success : c.warning}
                />
                <ThemedText
                  style={[styles.matchStatusText, { color: allMatched ? c.success : c.warning }]}
                >
                  {allMatched
                    ? `All ${extractedTeams.length} teams matched to your league`
                    : `${matchedCount} of ${extractedTeams.length} matched — tap a team to fix the rest`}
                </ThemedText>
              </View>

              {currentSeason.extracted.bracket?.rounds?.length ? (
                <View style={styles.matchStatusRow}>
                  <Ionicons name="git-network-outline" size={ms(13)} color={c.success} accessible={false} />
                  <ThemedText style={[styles.matchStatusText, { color: c.success }]}>
                    Playoff bracket captured — it'll show in Playoffs history
                  </ThemedText>
                </View>
              ) : null}

              {currentSeason.extracted.teams.map((t, i, arr) => {
                const isMatched = teamNames.includes(t.team_name);
                const src = t.source_name ?? t.team_name;
                return (
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
                    <TouchableOpacity
                      style={styles.resultTeamCol}
                      onPress={() => openTeamPicker(i)}
                      accessibilityRole="button"
                      accessibilityLabel={
                        isMatched
                          ? `${t.team_name}, matched. Tap to change which team this row imports as.`
                          : `${src}, not matched to a team. Tap to match to one of your teams.`
                      }
                    >
                      <View style={styles.resultTeamNameRow}>
                        <ThemedText
                          style={[styles.resultTeam, { color: isMatched ? c.text : c.warning }]}
                          numberOfLines={1}
                        >
                          {t.team_name}
                        </ThemedText>
                        <Ionicons name="chevron-down" size={ms(12)} color={c.secondaryText} />
                      </View>
                      {isMatched && src !== t.team_name ? (
                        <ThemedText
                          style={[styles.resultDivision, { color: c.secondaryText }]}
                          numberOfLines={1}
                        >
                          from “{src}”
                        </ThemedText>
                      ) : !isMatched ? (
                        <ThemedText
                          style={[styles.resultDivision, { color: c.warning }]}
                          numberOfLines={1}
                        >
                          Not matched — tap to fix
                        </ThemedText>
                      ) : t.division ? (
                        <ThemedText
                          style={[styles.resultDivision, { color: c.secondaryText }]}
                          numberOfLines={1}
                        >
                          {t.division}
                        </ThemedText>
                      ) : null}
                    </TouchableOpacity>
                    {t.playoff_result && (
                      <Text
                        style={[styles.resultPlayoff, { color: c.secondaryText, borderColor: c.border }]}
                        numberOfLines={1}
                      >
                        {formatPlayoffResult(t.playoff_result)}
                      </Text>
                    )}
                    <Text style={[styles.resultRecord, { color: c.secondaryText }]}>
                      {t.wins ?? 0}-{t.losses ?? 0}
                    </Text>
                  </View>
                );
              })}
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
                  variant="secondary"
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

const MANUAL_CELL_H = s(38);
const MANUAL_ROW_H = s(90);

const PLACEMENT_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: 'No playoff result' },
  { value: PLAYOFF_RESULT.CHAMPION, label: 'Champion' },
  { value: PLAYOFF_RESULT.RUNNER_UP, label: 'Runner-up' },
  { value: PLAYOFF_RESULT.THIRD_PLACE, label: '3rd Place' },
  { value: PLAYOFF_RESULT.FOURTH_PLACE, label: '4th Place' },
  { value: PLAYOFF_RESULT.MISSED_PLAYOFFS, label: 'Missed Playoffs' },
];

interface ManualRow {
  /** Stable id so drag-reorder keeps working while the team name is edited. */
  id: string;
  team_name: string;
  wins: string;
  losses: string;
  points_for: string;
  points_against: string;
  // Carried through an edit so it never wipes the OCR'd extras.
  ties: number;
  division: string | null;
  playoff_result: string | null;
  source_name: string | null;
}

/**
 * Type or fine-tune past-season standings. Rows drag to set the finishing order
 * (top = 1st, which becomes the final standing) and each carries an explicit
 * playoff placement — so a typed season and a screenshot season are
 * interchangeable. W/L/PF/PA are optional counting stats; ties, division, the
 * original name, and placement ride through an edit rather than being wiped.
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
  const pickAction = useActionPicker();

  const seed = (): ManualRow[] => {
    if (existing?.teams.length) {
      return existing.teams.map((t, i) => ({
        id: `r${i}`,
        team_name: t.team_name,
        wins: t.wins != null ? String(t.wins) : '',
        losses: t.losses != null ? String(t.losses) : '',
        points_for: t.points_for != null ? String(t.points_for) : '',
        points_against: t.points_against != null ? String(t.points_against) : '',
        ties: t.ties ?? 0,
        division: t.division ?? null,
        playoff_result: t.playoff_result ?? null,
        source_name: t.source_name ?? t.team_name,
      }));
    }
    return teamNames.map((name, i) => ({
      id: `r${i}`,
      team_name: name,
      wins: '',
      losses: '',
      points_for: '',
      points_against: '',
      ties: 0,
      division: null,
      playoff_result: null,
      source_name: name,
    }));
  };
  const [rows, setRows] = useState<ManualRow[]>(seed);

  const setRow = (id: string, patch: Partial<ManualRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const namedRows = rows.filter((r) => r.team_name.trim().length > 0);
  const canSave = namedRows.length >= 2;

  const openPlacementPicker = (id: string) =>
    pickAction({
      title: 'Playoff result',
      actions: PLACEMENT_OPTIONS.map((o) => ({
        id: o.value ?? '__none__',
        label: o.label,
        icon: 'trophy-outline' as keyof typeof Ionicons.glyphMap,
        onPress: () => setRow(id, { playoff_result: o.value }),
      })),
    });

  const handleSave = () => {
    const toNum = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 0;
    };
    // Final standing = the drag order (top = 1st). Placement, division, ties,
    // and the original name ride along so an edit never wipes them.
    const ranked = namedRows.map((r, i): HistoryTeam => ({
      team_name: r.team_name.trim(),
      wins: toNum(r.wins),
      losses: toNum(r.losses),
      ties: r.ties,
      points_for: r.points_for.trim() ? toNum(r.points_for) : 0,
      points_against: r.points_against.trim() ? toNum(r.points_against) : 0,
      division: r.division,
      playoff_result: r.playoff_result,
      source_name: r.source_name,
      standing: i + 1,
    }));
    onSave(ranked);
  };

  return (
    <View style={styles.manualEditor}>
      <ThemedText style={[styles.manualHint, { color: c.secondaryText }]}>
        Drag the handle to set the finishing order (top = 1st). Tap a row's result
        chip to set a playoff placement. W/L/PF/PA are optional.
      </ThemedText>

      <SortableList
        data={rows}
        keyExtractor={(r) => r.id}
        onReorder={setRows}
        itemHeight={MANUAL_ROW_H}
        gap={s(8)}
        slotLabelWidth={s(22)}
        accessibilityItemLabel={(r, i) => `${r.team_name || 'Unnamed team'}, finishing ${i + 1}`}
        renderSlotLabel={(i) => (
          <Text style={[styles.manualRank, { color: c.secondaryText }]}>{i + 1}</Text>
        )}
        renderItem={({ item }) => {
          const placement = item.playoff_result
            ? PLAYOFF_RESULT_LABELS[item.playoff_result] ?? 'Result'
            : null;
          const teamLabel = item.team_name || 'Unnamed team';
          return (
            <View style={styles.manualCard}>
              <View style={styles.manualLine}>
                <BrandTextInput
                  value={item.team_name}
                  onChangeText={(v) => setRow(item.id, { team_name: v })}
                  placeholder="Team name"
                  containerStyle={styles.manualNameCol}
                  inputStyle={styles.manualNameInput}
                  accessibilityLabel="Team name"
                />
                <TouchableOpacity
                  onPress={() => openPlacementPicker(item.id)}
                  style={[
                    styles.placementChip,
                    { borderColor: placement ? c.gold : c.border, backgroundColor: c.input },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${teamLabel} playoff result: ${placement ?? 'none'}. Tap to change.`}
                >
                  <Ionicons name="trophy-outline" size={ms(12)} color={placement ? c.gold : c.secondaryText} />
                  <Text
                    style={[styles.placementChipText, { color: placement ? c.text : c.secondaryText }]}
                    numberOfLines={1}
                  >
                    {placement ?? 'Result'}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.manualLine}>
                <ManualStat label="W" team={teamLabel} value={item.wins} onChange={(v) => setRow(item.id, { wins: v })} />
                <ManualStat label="L" team={teamLabel} value={item.losses} onChange={(v) => setRow(item.id, { losses: v })} />
                <ManualStat label="PF" team={teamLabel} value={item.points_for} onChange={(v) => setRow(item.id, { points_for: v })} wide />
                <ManualStat label="PA" team={teamLabel} value={item.points_against} onChange={(v) => setRow(item.id, { points_against: v })} wide />
              </View>
            </View>
          );
        }}
      />

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

/** One compact number field on the manual editor's second row. */
function ManualStat({
  label,
  team,
  value,
  onChange,
  wide,
}: {
  label: string;
  team: string;
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  return (
    <BrandTextInput
      value={value}
      onChangeText={(v) => onChange(v.replace(/[^0-9]/g, ''))}
      placeholder={label}
      keyboardType="number-pad"
      containerStyle={wide ? styles.manualStatWide : styles.manualStatNarrow}
      inputStyle={styles.manualCellInput}
      accessibilityLabel={`${team} ${label}`}
    />
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
  pipProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    marginLeft: 'auto',
  },
  pipLabel: {
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
  matchStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingHorizontal: s(12),
    paddingBottom: s(8),
  },
  matchStatusText: {
    fontSize: ms(11),
    flexShrink: 1,
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
  resultTeamCol: {
    flex: 1,
    minWidth: 0,
  },
  resultTeamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  resultTeam: {
    fontSize: ms(13),
    fontWeight: '500',
    flexShrink: 1,
  },
  resultDivision: {
    fontSize: ms(10),
  },
  resultRecord: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  resultPlayoff: {
    fontSize: ms(10),
    fontWeight: '600',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },

  // ─── Season nav ────────────────────────────────────────────
  seasonNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: s(4),
  },

  // ─── Manual standings editor (drag-to-order) ───────────────
  manualEditor: {
    gap: s(10),
  },
  manualHint: {
    fontSize: ms(11),
    fontStyle: 'italic',
    lineHeight: ms(15),
  },
  manualRank: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
    textAlign: 'center',
  },
  // Content column inside a SortableList card — two lines, centred to the row.
  manualCard: {
    flex: 1,
    justifyContent: 'center',
    gap: s(6),
  },
  manualLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  manualNameCol: {
    flex: 1,
  },
  manualCellInput: {
    height: MANUAL_CELL_H,
    paddingVertical: 0,
    fontSize: ms(14),
    textAlign: 'center',
  },
  manualNameInput: {
    height: MANUAL_CELL_H,
    paddingVertical: 0,
    fontSize: ms(14),
  },
  manualStatNarrow: {
    width: s(42),
  },
  manualStatWide: {
    width: s(52),
  },
  placementChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    height: MANUAL_CELL_H,
    paddingHorizontal: s(8),
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: s(124),
  },
  placementChipText: {
    fontSize: ms(11),
    fontWeight: '600',
    flexShrink: 1,
  },
  manualActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingTop: s(2),
  },
});
