import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  currentTeamId: string;
  onSelect: (teamId: string) => void;
  onClose: () => void;
}

export function NewDMPicker({ visible, currentTeamId, onSelect, onClose }: Props) {
  const c = useColors();
  const { data: league, isLoading } = useLeague();

  const teams = (league?.league_teams ?? []).filter(
    (t: any) => t.id !== currentTeamId,
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="New Message"
      subtitle={teams.length > 0 ? `${teams.length} TEAMS` : undefined}
    >
      {isLoading ? (
        <View style={styles.loader}><LogoSpinner /></View>
      ) : teams.length === 0 ? (
        <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
          No other teams in this league
        </ThemedText>
      ) : (
        teams.map((item: any, index: number) => (
          <TouchableOpacity
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Message ${item.name}`}
            style={[
              styles.row,
              { borderBottomColor: c.border },
              index === teams.length - 1 && { borderBottomWidth: 0 },
            ]}
            onPress={() => onSelect(item.id)}
            activeOpacity={0.65}
          >
            <TeamLogo
              logoKey={item.logo_key}
              teamName={item.name}
              tricode={item.tricode ?? undefined}
              size="medium"
            />
            <View style={styles.rowText}>
              <ThemedText style={[styles.teamName, { color: c.text }]} numberOfLines={1}>
                {item.name}
              </ThemedText>
              {item.tricode ? (
                <ThemedText
                  type="varsitySmall"
                  style={[styles.teamTricode, { color: c.secondaryText }]}
                >
                  {item.tricode}
                </ThemedText>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={ms(18)} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        ))
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  loader: {
    paddingVertical: s(28),
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  teamTricode: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginTop: s(1),
  },
  empty: {
    textAlign: 'center',
    marginTop: s(24),
    fontSize: ms(14),
  },
});
