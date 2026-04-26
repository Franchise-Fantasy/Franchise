import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import type { ReadReceipt } from '@/hooks/chat/useReadReceipts';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

type Entry = {
  team_id: string;
  team_name: string;
  tricode: string;
  online: boolean;
  isMe?: boolean;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Read-receipt list for the conversation (other teams only). */
  readReceipts: ReadReceipt[];
  myTeamId: string;
  myTeamName: string;
  myTricode: string | null;
  teamLogoMap: Record<string, string | null> | undefined;
  memberCount?: number;
}

export function PresenceListSheet({
  visible,
  onClose,
  readReceipts,
  myTeamId,
  myTeamName,
  myTricode,
  teamLogoMap,
  memberCount,
}: Props) {
  const c = useColors();

  const { online, offline, onlineCount, total } = useMemo(() => {
    const all: Entry[] = [
      { team_id: myTeamId, team_name: myTeamName, tricode: myTricode ?? '', online: true, isMe: true },
      ...readReceipts.map((r) => ({
        team_id: r.team_id,
        team_name: r.team_name,
        tricode: r.tricode ?? '',
        online: r.online,
      })),
    ];
    const onlineList = all.filter((e) => e.online);
    const offlineList = all.filter((e) => !e.online);
    return {
      online: onlineList,
      offline: offlineList,
      onlineCount: onlineList.length,
      total: memberCount ?? all.length,
    };
  }, [readReceipts, myTeamId, myTeamName, myTricode, memberCount]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Who's Here"
      subtitle={`${onlineCount} OF ${total} ONLINE`}
    >
      {online.length > 0 && (
        <View style={styles.section}>
          <ThemedText
            type="varsitySmall"
            style={[styles.sectionLabel, { color: c.success }]}
          >
            ONLINE · {online.length}
          </ThemedText>
          {online.map((entry, i) => (
            <PresenceRow
              key={entry.team_id}
              entry={entry}
              logoKey={teamLogoMap?.[entry.team_id] ?? null}
              isLast={i === online.length - 1}
              borderColor={c.border}
              textColor={c.text}
              dotColor={c.success}
            />
          ))}
        </View>
      )}

      {offline.length > 0 && (
        <View style={[styles.section, online.length > 0 && styles.sectionSpaced]}>
          <ThemedText
            type="varsitySmall"
            style={[styles.sectionLabel, { color: c.secondaryText }]}
          >
            OFFLINE · {offline.length}
          </ThemedText>
          {offline.map((entry, i) => (
            <PresenceRow
              key={entry.team_id}
              entry={entry}
              logoKey={teamLogoMap?.[entry.team_id] ?? null}
              isLast={i === offline.length - 1}
              borderColor={c.border}
              textColor={c.secondaryText}
              dotColor={null}
            />
          ))}
        </View>
      )}
    </BottomSheet>
  );
}

function PresenceRow({
  entry,
  logoKey,
  isLast,
  borderColor,
  textColor,
  dotColor,
}: {
  entry: Entry;
  logoKey: string | null;
  isLast: boolean;
  borderColor: string;
  textColor: string;
  dotColor: string | null;
}) {
  return (
    <View
      style={[
        styles.row,
        !isLast && { borderBottomColor: borderColor, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
      accessibilityLabel={`${entry.team_name} is ${entry.online ? 'online' : 'offline'}`}
    >
      <View style={[!entry.online && styles.dimmed]}>
        <TeamLogo
          logoKey={logoKey}
          teamName={entry.team_name}
          tricode={entry.tricode}
          size="small"
        />
      </View>
      <View style={styles.rowText}>
        <ThemedText style={[styles.teamName, { color: textColor }]} numberOfLines={1}>
          {entry.team_name}
          {entry.isMe ? ' (you)' : ''}
        </ThemedText>
        {entry.tricode ? (
          <ThemedText
            type="varsitySmall"
            style={[styles.tricode, { color: textColor, opacity: 0.7 }]}
          >
            {entry.tricode}
          </ThemedText>
        ) : null}
      </View>
      {dotColor ? (
        <View style={[styles.onlineDot, { backgroundColor: dotColor }]} />
      ) : (
        <View style={[styles.offlineDot, { borderColor: borderColor }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingHorizontal: 0,
  },
  sectionSpaced: {
    marginTop: s(18),
  },
  sectionLabel: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginBottom: s(8),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingVertical: s(10),
  },
  dimmed: {
    opacity: 0.5,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  teamName: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(19),
    letterSpacing: -0.2,
  },
  tricode: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginTop: s(1),
  },
  onlineDot: {
    width: s(8),
    height: s(8),
    borderRadius: 4,
  },
  offlineDot: {
    width: s(8),
    height: s(8),
    borderRadius: 4,
    borderWidth: 1,
    backgroundColor: 'transparent',
  },
});

