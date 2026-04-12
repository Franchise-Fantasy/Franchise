import { RumorBubble } from '@/components/chat/RumorBubble';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useToast } from '@/context/ToastProvider';
import { RUMOR_TEMPLATES, useLeakRumor } from '@/hooks/chat/useLeakRumor';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface LeakRumorSheetProps {
  proposalId: string;
  leagueId: string;
  teamId: string;
  players: Array<{ id: string; name: string; position: string }>;
  onDone: () => void;
}

export function LeakRumorSheet({ proposalId, leagueId, teamId, players, onDone }: LeakRumorSheetProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { showToast } = useToast();
  const leak = useLeakRumor();
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<number>(0);

  const selectedPlayerObj = players.find((p) => p.id === selectedPlayer);
  const previewText = selectedPlayerObj
    ? RUMOR_TEMPLATES[selectedTemplate].replace('{player}', selectedPlayerObj.name)
    : RUMOR_TEMPLATES[selectedTemplate].replace('{player}', '______');

  const handleLeak = async () => {
    if (!selectedPlayer || !selectedPlayerObj) return;
    try {
      await leak.mutateAsync({
        proposalId,
        leagueId,
        teamId,
        playerId: selectedPlayer,
        playerName: selectedPlayerObj.name,
        template: RUMOR_TEMPLATES[selectedTemplate],
      });
      showToast('success', 'Rumor leaked to league chat');
      onDone();
    } catch (err: any) {
      const msg = err.message ?? '';
      if (msg.includes('idx_trade_rumors_manual') || msg.includes('duplicate key') || msg.includes('unique constraint')) {
        showToast('error', 'This trade negotiation has already been leaked');
        onDone();
        return;
      }
      showToast('error', msg || 'Failed to leak rumor');
    }
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} style={styles.scroll}>
        {/* Player selection */}
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Select player</ThemedText>
        <View style={styles.chipRow}>
          {players.map((p) => {
            const isActive = selectedPlayer === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: isActive ? c.accent : c.cardAlt,
                    borderColor: isActive ? c.accent : c.border,
                  },
                ]}
                onPress={() => setSelectedPlayer(p.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${p.name}, ${p.position}`}
                activeOpacity={0.7}
              >
                <ThemedText style={{
                  fontSize: ms(14),
                  fontWeight: '500',
                  color: isActive ? c.statusText : c.text,
                }}>
                  {p.name} ({p.position})
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Template selection */}
        <ThemedText type="defaultSemiBold" style={[styles.sectionTitle, { marginTop: s(18) }]}>
          Choose message
        </ThemedText>
        {RUMOR_TEMPLATES.map((tmpl, i) => {
          const display = selectedPlayerObj
            ? tmpl.replace('{player}', selectedPlayerObj.name)
            : tmpl.replace('{player}', '______');
          const isActive = selectedTemplate === i;
          return (
            <TouchableOpacity
              key={i}
              style={[
                styles.templateRow,
                {
                  backgroundColor: isActive ? c.activeCard : c.cardAlt,
                  borderColor: isActive ? c.activeBorder : c.border,
                },
              ]}
              onPress={() => setSelectedTemplate(i)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={display}
              activeOpacity={0.7}
            >
              <ThemedText style={{ fontSize: ms(14), lineHeight: ms(20), fontStyle: 'italic' }}>
                &ldquo;{display}&rdquo;
              </ThemedText>
            </TouchableOpacity>
          );
        })}

        {/* Preview */}
        <View style={{ marginTop: s(18) }}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Preview</ThemedText>
          <RumorBubble rumorText={previewText} />
        </View>
      </ScrollView>

      {/* Submit */}
      <View style={[styles.actionArea, { borderTopColor: c.border }]}>
        {leak.isPending ? (
          <LogoSpinner size={18} />
        ) : (
          <TouchableOpacity
            style={[
              styles.leakBtn,
              { backgroundColor: selectedPlayer ? c.warning : c.buttonDisabled },
            ]}
            onPress={handleLeak}
            disabled={!selectedPlayer || leak.isPending}
            accessibilityRole="button"
            accessibilityLabel="Leak rumor to league chat"
            accessibilityState={{ disabled: !selectedPlayer }}
            activeOpacity={0.7}
          >
            <Ionicons name="megaphone" size={18} color={c.statusText} />
            <ThemedText style={[styles.leakBtnText, { color: c.statusText }]}>Leak to Chat</ThemedText>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: s(16),
    paddingBottom: s(24),
  },
  sectionTitle: {
    fontSize: ms(14),
    marginBottom: s(8),
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  chip: {
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderRadius: 8,
    borderWidth: 1,
  },
  templateRow: {
    padding: s(12),
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: s(8),
  },
  actionArea: {
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(32),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  leakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(8),
    paddingVertical: s(14),
    borderRadius: 10,
  },
  leakBtnText: {
    fontSize: ms(16),
    fontWeight: '700',
  },
});
