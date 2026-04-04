import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ReactionGroup } from '@/types/chat';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F525}'];

const MORE_EMOJIS = [
  // Faces
  '\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F606}', '\u{1F605}', '\u{1F923}',
  '\u{1F642}', '\u{1F609}', '\u{1F60A}', '\u{1F607}', '\u{1F970}', '\u{1F60D}', '\u{1F929}',
  '\u{1F618}', '\u{1F617}', '\u{1F61A}', '\u{1F60B}', '\u{1F61C}', '\u{1F61D}', '\u{1F911}',
  '\u{1F917}', '\u{1F914}', '\u{1F910}', '\u{1F928}', '\u{1F610}', '\u{1F611}', '\u{1F636}',
  '\u{1F644}', '\u{1F62C}', '\u{1F60C}', '\u{1F614}', '\u{1F62A}', '\u{1F634}', '\u{1F637}',
  '\u{1F912}', '\u{1F915}', '\u{1F922}', '\u{1F92E}', '\u{1F927}', '\u{1F975}', '\u{1F976}',
  '\u{1F974}', '\u{1F92F}', '\u{1F920}', '\u{1F973}', '\u{1F60E}', '\u{1F913}', '\u{1F9D0}',
  '\u{1F615}', '\u{1F61F}', '\u{1F641}', '\u{2639}\u{FE0F}', '\u{1F62F}', '\u{1F632}', '\u{1F633}',
  '\u{1F97A}', '\u{1F626}', '\u{1F627}', '\u{1F628}', '\u{1F630}', '\u{1F625}', '\u{1F62D}',
  '\u{1F631}', '\u{1F616}', '\u{1F623}', '\u{1F61E}', '\u{1F613}', '\u{1F629}', '\u{1F62B}',
  '\u{1F624}', '\u{1F621}', '\u{1F620}', '\u{1F92C}', '\u{1F608}', '\u{1F47F}', '\u{1F480}',
  // Gestures
  '\u{1F44D}', '\u{1F44E}', '\u{1F44A}', '\u{270A}', '\u{1F44F}', '\u{1F64C}', '\u{1F64F}',
  '\u{1F91D}', '\u{270C}\u{FE0F}', '\u{1F918}', '\u{1F919}', '\u{1F448}', '\u{1F449}', '\u{1F4AA}',
  // Hearts & symbols
  '\u{2764}\u{FE0F}', '\u{1F9E1}', '\u{1F49B}', '\u{1F49A}', '\u{1F499}', '\u{1F49C}', '\u{1F5A4}',
  '\u{1F494}', '\u{2728}', '\u{1F4AF}', '\u{1F525}', '\u{1F389}', '\u{1F38A}', '\u{1F3C6}',
  '\u{1F3C0}', '\u{1F3C8}', '\u{26BE}', '\u{26BD}', '\u{1F4A9}', '\u{1F47B}', '\u{1F31F}',
];

interface Props {
  visible: boolean;
  onSelect: (emoji: string) => void;
  onClose: () => void;
  existingReactions?: ReactionGroup[];
  extraActions?: React.ReactNode;
}

export function ReactionPicker({ visible, onSelect, onClose, existingReactions, extraActions }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [expanded, setExpanded] = useState(false);

  if (!visible) return null;

  const handleClose = () => {
    setExpanded(false);
    onClose();
  };

  const handleSelect = (emoji: string) => {
    setExpanded(false);
    onSelect(emoji);
  };

  return (
    <Pressable style={styles.overlay} onPress={handleClose}>
      {/* Expanded grid above the bar */}
      {expanded && (
        <View
          style={[styles.grid, { backgroundColor: c.card, borderColor: c.border }]}
          onStartShouldSetResponder={() => true}
        >
          <ScrollView contentContainerStyle={styles.gridContent}>
            {MORE_EMOJIS.map((emoji, i) => (
              <TouchableOpacity
                key={`${emoji}-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
                onPress={() => handleSelect(emoji)}
                style={styles.gridEmoji}
              >
                <Text style={styles.gridEmojiText}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Quick reaction bar */}
      <View
        style={[styles.bar, { backgroundColor: c.card, borderColor: c.border }]}
        onStartShouldSetResponder={() => true}
      >
        {QUICK_REACTIONS.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            accessibilityRole="button"
            accessibilityLabel={`React with ${emoji}`}
            onPress={() => handleSelect(emoji)}
            style={styles.emojiBtn}
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse emoji picker' : 'Show more emojis'}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={[styles.expandBtn, expanded && { backgroundColor: c.activeCard }]}
        >
          <Ionicons
            name={expanded ? 'chevron-down' : 'add'}
            size={20}
            color={c.secondaryText}
          />
        </TouchableOpacity>
      </View>

      {/* Existing reaction attribution */}
      {existingReactions && existingReactions.length > 0 && (
        <View
          style={[styles.attributionCard, { backgroundColor: c.card, borderColor: c.border }]}
          onStartShouldSetResponder={() => true}
        >
          {existingReactions.map((rr) => (
            <View key={rr.emoji} style={styles.attributionRow} accessibilityLabel={`${rr.emoji} by ${rr.team_names.join(', ')}`}>
              <Text style={styles.attributionEmoji}>{rr.emoji}</Text>
              <ThemedText style={[styles.attributionNames, { color: c.secondaryText }]}>
                {rr.team_names.join(', ')}
              </ThemedText>
            </View>
          ))}
        </View>
      )}

      {/* Extra actions (e.g. pin) */}
      {extraActions}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(6),
    paddingVertical: s(6),
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    gap: s(2),
  },
  emojiBtn: {
    width: s(40),
    height: s(40),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  emoji: {
    fontSize: ms(24),
  },
  expandBtn: {
    width: s(36),
    height: s(36),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: 'rgba(128,128,128,0.15)',
  },
  grid: {
    width: s(310),
    maxHeight: s(260),
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: s(8),
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    overflow: 'hidden',
  },
  gridContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: s(8),
  },
  gridEmoji: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridEmojiText: {
    fontSize: ms(22),
  },
  attributionCard: {
    marginTop: s(8),
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    gap: s(6),
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    minWidth: s(160),
  },
  attributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  attributionEmoji: {
    fontSize: ms(18),
  },
  attributionNames: {
    fontSize: ms(13),
    fontWeight: '500',
    flexShrink: 1,
  },
});
