import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ScreenshotCapture } from '@/components/import/ScreenshotCapture';
import { BrandButton } from '@/components/ui/BrandButton';
import { FormSection } from '@/components/ui/FormSection';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { formatSeason, type Sport } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useExtractTradedPicks, type ExtractedTradedPick, type ImageData } from '@/hooks/useImportScreenshot';
import { ms, s } from '@/utils/scale';

import { isDuplicateTradedPick, type ImportTeamRef, type TradedPickDraft } from './draftPhase';

type Palette = (typeof Colors)['light'];

interface Props {
  teams: ImportTeamRef[];
  /** Valid seasons a scanned pick may target (rejects others). */
  seasons: string[];
  rounds: number;
  sport: Sport;
  /** Calendar year of the upcoming rookie draft — fills a pick with no year. */
  defaultDraftYear: number;
  value: TradedPickDraft[];
  onChange: (next: TradedPickDraft[]) => void;
}

/** Normalize a team name for lenient matching (case/space/punctuation-insensitive). */
function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Terminal skip tally — picks the mapping step can't rescue. Team mismatches are
 * NOT counted here: those become `pending` picks the user resolves via the
 * "Match Teams" step below, at which point they either import or fall into one
 * of these buckets.
 */
type ScanSummary = {
  added: number;
  badSeason: number;
  badRound: number;
  duplicate: number;
  sameTeam: number;
};

/** Build the user-facing headline + per-reason breakdown for a scan result. */
function summarizeScan(s: ScanSummary, pendingCount: number): { anyAdded: boolean; headline: string; skipLines: string[] } {
  const skipLines = [
    s.badSeason && `${s.badSeason} skipped — draft year isn't in your league`,
    s.badRound && `${s.badRound} skipped — round isn't in your draft`,
    s.duplicate && `${s.duplicate} skipped — already in your list`,
    s.sameTeam && `${s.sameTeam} skipped — same team on both sides`,
  ].filter(Boolean) as string[];

  const anyAdded = s.added > 0;
  const headline = anyAdded
    ? `Added ${s.added} pick${s.added === 1 ? '' : 's'}.${pendingCount > 0 ? ` ${pendingCount} more need a team match.` : ' Review below.'}`
    : pendingCount > 0
      ? 'Match the teams below to import your picks.'
      : 'No traded picks found. Add them manually below.';

  return { anyAdded, headline, skipLines };
}

/**
 * Scan traded future picks from a screenshot of a league's pick-tracker
 * spreadsheet. Best-effort OCR (Claude Vision) — matched picks merge into the
 * editable TradedPicksEditor below for review, so accuracy isn't critical.
 *
 * Picks whose teams don't auto-match aren't dropped: their team names surface in
 * a "Match Teams" step (like the player-import matcher), and each mapping
 * re-resolves the picks that were waiting on it.
 */
export function TradedPicksScanner({ teams, seasons, rounds, sport, defaultDraftYear, value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const extract = useExtractTradedPicks();

  const [images, setImages] = useState<ImageData[]>([]);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  // Raw scanned picks still waiting on a team match (fixable via the mapping step).
  const [pending, setPending] = useState<ExtractedTradedPick[]>([]);
  // Manual name→team-key mappings the user has made, keyed by normalized name.
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  const matchKey = (name: string): string | undefined => {
    const n = norm(name);
    if (!n) return undefined;
    const exact = teams.find(t => norm(t.name) === n);
    if (exact) return exact.key;
    const partial = teams.find(t => {
      const tn = norm(t.name);
      return tn.includes(n) || n.includes(tn);
    });
    return partial?.key;
  };

  /** A manual mapping wins over the fuzzy auto-match. */
  const resolveWith = (map: Record<string, string>, name: string): string | undefined =>
    map[norm(name)] ?? matchKey(name);

  /** Split raw scanned picks into imported / terminally-skipped / waiting-on-a-team-match. */
  const partition = (picks: ExtractedTradedPick[], map: Record<string, string>, existing: TradedPickDraft[]) => {
    const added: TradedPickDraft[] = [];
    const skips = { badSeason: 0, badRound: 0, duplicate: 0, sameTeam: 0 };
    const stillPending: ExtractedTradedPick[] = [];

    for (const p of picks) {
      const fromKey = resolveWith(map, p.original_team);
      const toKey = resolveWith(map, p.new_owner);
      const season = formatSeason(p.year ?? defaultDraftYear, sport);
      const round = p.round ?? 1;

      // Only wait on a mapping when a team is genuinely unresolved. Both-resolved-
      // but-identical (a fuzzy-match false positive) can't be fixed by mapping.
      if (!fromKey || !toKey) { stillPending.push(p); continue; }
      if (fromKey === toKey) { skips.sameTeam++; continue; }
      if (!seasons.includes(season)) { skips.badSeason++; continue; }
      if (round < 1 || round > rounds) { skips.badRound++; continue; }

      const draft: TradedPickDraft = { season, round, fromKey, toKey };
      if (isDuplicateTradedPick([...existing, ...added], draft)) { skips.duplicate++; continue; }

      added.push(draft);
    }
    return { added, skips, pending: stillPending };
  };

  const handleScan = async () => {
    if (!images.length) return;
    setSummary(null);
    setPending([]);
    setNameMap({});
    try {
      const result = await extract.mutateAsync({
        images,
        team_names: teams.map(t => t.name),
        draft_year: defaultDraftYear,
      });

      const { added, skips, pending: unresolved } = partition(result.picks ?? [], {}, value);
      if (added.length) onChange([...value, ...added]);
      setPending(unresolved);
      setSummary({ added: added.length, ...skips });
      setImages([]);
    } catch {
      // The error surfaces inline via the mutation's `isError`/`error` state.
      setSummary(null);
    }
  };

  /** Map one scanned team name to a real team, then re-resolve the picks waiting on it. */
  const applyMapping = (rawName: string, teamKey: string) => {
    const nextMap = { ...nameMap, [norm(rawName)]: teamKey };
    setNameMap(nextMap);

    const { added, skips, pending: stillPending } = partition(pending, nextMap, value);
    if (added.length) onChange([...value, ...added]);
    setPending(stillPending);
    setSummary(prev => prev && {
      added: prev.added + added.length,
      badSeason: prev.badSeason + skips.badSeason,
      badRound: prev.badRound + skips.badRound,
      duplicate: prev.duplicate + skips.duplicate,
      sameTeam: prev.sameTeam + skips.sameTeam,
    });
  };

  // Distinct scanned names, across all pending picks, that still don't resolve.
  const unmatchedNames: string[] = [];
  const seenNames = new Set<string>();
  for (const p of pending) {
    for (const raw of [p.original_team, p.new_owner]) {
      const k = norm(raw);
      if (!k || seenNames.has(k)) continue;
      seenNames.add(k);
      if (!resolveWith(nameMap, raw)) unmatchedNames.push(raw);
    }
  }

  const report = summary ? summarizeScan(summary, pending.length) : null;

  return (
    <FormSection title="Scan Traded Picks">
      <ThemedText style={[styles.intro, { color: c.secondaryText }]}>
        Have a spreadsheet of traded picks? Screenshot it and we'll read the picks in for you. It won't be
        perfect — review and fix them in the list below.
      </ThemedText>

      <ScreenshotCapture
        images={images}
        onImagesChange={(imgs) => { setImages(imgs); setSummary(null); setPending([]); setNameMap({}); }}
        maxImages={5}
        label="Pick Sheet Screenshots"
      />

      {images.length > 0 && (
        <BrandButton
          label="Scan Picks"
          variant="primary"
          size="default"
          fullWidth
          icon="scan-outline"
          onPress={handleScan}
          loading={extract.isPending}
          accessibilityLabel="Scan traded picks from the screenshots"
          style={styles.scanBtn}
        />
      )}

      {extract.isError && (
        <ThemedText style={[styles.msg, { color: c.danger }]}>
          {extract.error.message}
        </ThemedText>
      )}

      {report && (
        <View style={styles.summary} accessibilityLiveRegion="polite">
          <View style={styles.summaryRow}>
            <Ionicons
              name={report.anyAdded ? 'checkmark-circle' : 'alert-circle'}
              size={ms(16)}
              color={report.anyAdded ? c.success : c.warning}
              accessible={false}
            />
            <ThemedText style={[styles.summaryHeadline, { color: c.secondaryText }]}>
              {report.headline}
            </ThemedText>
          </View>
          {report.skipLines.map((line) => (
            <ThemedText key={line} style={[styles.skipLine, { color: c.secondaryText }]}>
              {`• ${line}`}
            </ThemedText>
          ))}
        </View>
      )}

      {unmatchedNames.length > 0 && (
        <View style={styles.matchSection}>
          <ThemedText style={[styles.matchIntro, { color: c.secondaryText }]}>
            {`Match ${unmatchedNames.length === 1 ? 'this team' : `these ${unmatchedNames.length} teams`} we read to yours, and their picks will import.`}
          </ThemedText>
          {unmatchedNames.map((name) => (
            <TeamMatchRow
              key={name}
              name={name}
              teams={teams}
              c={c}
              onPick={(teamKey) => applyMapping(name, teamKey)}
            />
          ))}
        </View>
      )}
    </FormSection>
  );
}

// ─── Unmatched-team row (expands to a pick-from-your-teams list) ─────

function TeamMatchRow({
  name,
  teams,
  c,
  onPick,
}: {
  name: string;
  teams: ImportTeamRef[];
  c: Palette;
  onPick: (teamKey: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={[styles.matchRow, { backgroundColor: c.input, borderColor: c.border }]}>
      <View style={styles.matchRowHeader}>
        <Ionicons name="help-circle-outline" size={ms(16)} color={c.warning} accessible={false} />
        <ThemedText style={[styles.matchName, { color: c.text }]} numberOfLines={1}>
          {name}
        </ThemedText>
        <BrandButton
          label={open ? 'Close' : 'Match'}
          variant="secondary"
          size="small"
          onPress={() => setOpen(o => !o)}
          accessibilityLabel={`Match ${name} to one of your teams`}
        />
      </View>

      {open && (
        <View style={styles.teamPills}>
          {teams.map((t) => (
            <TouchableOpacity
              key={t.key}
              onPress={() => onPick(t.key)}
              accessibilityRole="button"
              accessibilityLabel={`Match ${name} to ${t.name}`}
              style={[styles.teamPill, { borderColor: c.border }]}
            >
              <ThemedText style={[styles.teamPillText, { color: c.text }]} numberOfLines={1}>
                {t.name}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(10),
  },
  scanBtn: {
    marginTop: s(10),
  },
  summary: {
    marginTop: s(8),
    gap: s(4),
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  summaryHeadline: {
    flex: 1,
    fontSize: ms(13),
    lineHeight: ms(18),
  },
  skipLine: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginLeft: ms(22),
  },
  msg: {
    flex: 1,
    fontSize: ms(13),
    lineHeight: ms(18),
    marginTop: s(8),
  },

  // ─── Match Teams step ─────────────────────────────────────
  matchSection: {
    marginTop: s(12),
    gap: s(8),
  },
  matchIntro: {
    fontSize: ms(12),
    lineHeight: ms(17),
  },
  matchRow: {
    borderRadius: 10,
    borderWidth: 1,
    padding: s(10),
    gap: s(10),
  },
  matchRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  matchName: {
    flex: 1,
    minWidth: 0,
    fontSize: ms(14),
    fontWeight: '500',
  },
  teamPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  teamPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: s(7),
    paddingHorizontal: s(12),
    maxWidth: '100%',
  },
  teamPillText: {
    fontSize: ms(13),
    fontWeight: '500',
  },
});
