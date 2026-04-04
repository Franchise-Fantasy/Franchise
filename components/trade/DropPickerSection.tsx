import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PlayerSeasonStats } from '@/types/player';
import { getPlayerHeadshotUrl } from '@/utils/playerHeadshot';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, TouchableOpacity, View } from 'react-native';

interface DropPickerSectionProps {
  roster: (PlayerSeasonStats & { roster_slot: string | null })[];
  selectedPlayerIds: string[];
  maxSelections: number;
  onSelect: (playerIds: string[]) => void;
}

export function DropPickerSection({ roster, selectedPlayerIds, maxSelections, onSelect }: DropPickerSectionProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const handleToggle = (playerId: string) => {
    if (selectedPlayerIds.includes(playerId)) {
      onSelect(selectedPlayerIds.filter((id) => id !== playerId));
    } else if (selectedPlayerIds.length < maxSelections) {
      onSelect([...selectedPlayerIds, playerId]);
    }
  };

  const label = maxSelections === 1
    ? 'Select a player to drop'
    : `Select ${maxSelections} players to drop`;
  const hint = maxSelections === 1
    ? 'This trade would exceed your roster limit. Choose a player to release.'
    : `This trade would exceed your roster limit by ${maxSelections}. Choose ${maxSelections} players to release.`;

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <View style={styles.headerLeft}>
          <Ionicons name="alert-circle" size={18} color={c.warning} />
          <ThemedText type="defaultSemiBold" style={styles.headerTitle}>
            {label}
          </ThemedText>
        </View>
        {maxSelections > 1 && (
          <ThemedText style={[styles.counter, { color: c.secondaryText }]}>
            {selectedPlayerIds.length}/{maxSelections}
          </ThemedText>
        )}
      </View>
      <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
        {hint}
      </ThemedText>
      <View style={styles.list}>
        {roster.map((p) => {
          const isSelected = selectedPlayerIds.includes(p.player_id);
          const headshotUrl = getPlayerHeadshotUrl(p.external_id_nba);
          const atLimit = selectedPlayerIds.length >= maxSelections && !isSelected;

          return (
            <TouchableOpacity
              key={p.player_id}
              accessibilityRole="checkbox"
              accessibilityLabel={`${p.name}, ${p.position}${p.roster_slot ? `, ${p.roster_slot}` : ''}`}
              accessibilityState={{ checked: isSelected, disabled: atLimit }}
              style={[
                styles.row,
                { borderBottomColor: c.border },
                isSelected && { backgroundColor: c.activeCard },
                atLimit && { opacity: 0.4 },
              ]}
              onPress={() => handleToggle(p.player_id)}
              disabled={atLimit}
              activeOpacity={0.7}
            >
              <View style={[styles.headshot, { borderColor: c.border, backgroundColor: c.cardAlt }]}>
                {headshotUrl ? (
                  <Image source={{ uri: headshotUrl }} style={styles.headshotImg} resizeMode="cover" />
                ) : (
                  <Ionicons name="person" size={16} color={c.secondaryText} style={{ alignSelf: 'center', marginTop: s(5) }} />
                )}
              </View>
              <View style={styles.info}>
                <ThemedText type="defaultSemiBold" style={styles.name} numberOfLines={1}>
                  {p.name}
                </ThemedText>
                <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
                  {p.position} · {p.roster_slot ?? 'BE'}
                </ThemedText>
              </View>
              <View style={[styles.checkOuter, { borderColor: isSelected ? c.danger : c.border }]}>
                {isSelected && <Ionicons name="checkmark" size={14} color={c.danger} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  headerTitle: {
    fontSize: ms(14),
  },
  counter: {
    fontSize: ms(13),
  },
  hint: {
    fontSize: ms(12),
    paddingHorizontal: s(14),
    paddingTop: s(8),
    paddingBottom: s(4),
  },
  list: {
    paddingHorizontal: s(10),
    paddingBottom: s(6),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  headshot: {
    width: s(36),
    height: s(36),
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden' as const,
    marginRight: s(10),
  },
  headshotImg: {
    position: 'absolute' as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(30),
  },
  info: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: ms(14),
  },
  sub: {
    fontSize: ms(11),
  },
  checkOuter: {
    width: s(20),
    height: s(20),
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: s(8),
  },
});
