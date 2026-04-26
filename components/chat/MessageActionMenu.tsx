/**
 * iMessage-style action menu that appears when a chat message is long-pressed.
 * Two stacked cards: a reaction pill bar at top, an action list below.
 *
 * Replaces the previous ReactionPicker which mixed quick-reactions and a
 * bag of stacked TouchableOpacity actions in a loose vertical column. This
 * unifies the chrome (rounded cards, hairline dividers, brand typography)
 * and groups reactions vs. message actions visually.
 *
 * Future v2: anchor the menu near the selected bubble's screen Y (requires
 * MessageBubble to measure its position on long-press and forward it up).
 * For now the menu is centered, which matches the current ReactionPicker
 * behavior.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { DialogHost } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import type { ReactionGroup } from '@/types/chat';
import { ms, s } from '@/utils/scale';

const QUICK_REACTIONS = ['\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F525}'];

// Comprehensive emoji set covering the major Unicode categories. Order is
// faces → gestures → people → animals → plants/nature → food → travel →
// activities → objects → symbols, so the grid reads roughly the way iOS's
// emoji picker does.
const MORE_EMOJIS = [
  // Smileys & emotion — faces
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','🫠','😉','😊','😇',
  '🥰','😍','🤩','😘','😗','☺️','😚','😙','🥲','😋','😛','😜','🤪','😝',
  '🤑','🤗','🫡','🤔','🫣','🤭','🫢','🤫','🤥','😶','😶‍🌫️','😐','😑','😬',
  '🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','😵‍💫','🤐','🥴',
  '🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩',
  '👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀',
  '😿','😾',
  // Hearts & symbols of affection
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️‍🩹','💕','💞',
  '💓','💗','💖','💘','💝','💟','♥️','💯','💢','💥','💫','💦','💨','🕳️',
  '💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤',
  // Hand gestures & body
  '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙',
  '👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏',
  '🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶',
  '👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','💋',
  // People (no skin-tone variants — avoid combinatorial explosion)
  '👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎',
  '🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','💃','🕺','👯','🧖','🧗','🤺',
  '🏇','⛷️','🏂','🏌️','🏄','🚣','🏊','⛹️','🏋️','🚴','🚵','🤸','🤼','🤽',
  '🤾','🤹','🧘','🛀','🛌',
  // Animals & nature
  '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷',
  '🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆',
  '🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜',
  '🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙',
  '🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🦭','🐊','🐅',
  '🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🦬','🐃',
  '🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈',
  '🐈‍⬛','🪶','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡',
  '🦫','🦦','🦥','🐁','🐀','🐿️','🦔','🐾',
  // Plants & weather
  '🌵','🎄','🌲','🌳','🌴','🪵','🌱','🌿','☘️','🍀','🎍','🪴','🎋','🍃',
  '🍂','🍁','🍄','🐚','🪨','🌾','💐','🌷','🌹','🥀','🪷','🌺','🌸','🌼',
  '🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔',
  '🌙','🌎','🌍','🌏','🪐','💫','⭐','🌟','✨','⚡','☄️','💥','🔥','🌪️',
  '🌈','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄',
  '🌬️','💨','💧','💦','☔','☂️','🌊','🌫️',
  // Food & drink
  '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭',
  '🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒',
  '🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞',
  '🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮',
  '🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪',
  '🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁',
  '🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼',
  '🫖','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹',
  '🧉','🍾','🧊','🥄','🍴','🍽️','🥣','🥡','🥢','🧂',
  // Activities & sports
  '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒',
  '🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹',
  '🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🤾',
  '🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉',
  '🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧',
  '🎼','🎵','🎶','🎙️','🎚️','🎛️','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🪗',
  '🎲','♟️','🎯','🎳','🎮','🎰','🧩',
  // Travel & places
  '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜',
  '🏍️','🛵','🚲','🛴','🛹','🛼','🚏','🛣️','🛤️','⛽','🚨','🚥','🚦','🛑',
  '🚧','⚓','⛵','🛶','🚤','🛳️','⛴️','🛥️','🚢','✈️','🛩️','🛫','🛬','🪂',
  '💺','🚁','🚟','🚠','🚡','🛰️','🚀','🛸','🛎️','🧳','⌛','⏳','⌚','⏰',
  '⏱️','⏲️','🕰️','🌡️','🗺️','🧭','🌋','⛰️','🏔️','🗻','🏕️','🏖️','🏜️','🏝️',
  '🏞️','🏟️','🏛️','🏗️','🧱','🪨','🪵','🛖','🏘️','🏚️','🏠','🏡','🏢','🏣',
  '🏤','🏥','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','💒','🗼','🗽',
  '⛪','🕌','🕍','🛕','🕋','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇',
  '🌉','♨️','🎠','🎡','🎢','💈','🎪',
  // Objects
  '⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿',
  '📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻',
  '🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯️','🪔',
  '🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰',
  '🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','🪤','🧱','⛓️','🧲','🔫',
  '💣','🧨','🪓','🔪','🗡️','⚔️','🛡️','🚬','⚰️','🪦','⚱️','🏺','🔮','📿',
  '🧿','🪬','💈','⚗️','🔭','🔬','🕳️','🩻','🩹','🩺','💊','💉','🩸','🧬',
  '🦠','🧫','🧪','🌡️','🧹','🪠','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼',
  '🪥','🪒','🧽','🪣','🧴','🛎️','🔑','🗝️','🚪','🪑','🛋️','🛏️','🛌','🧸',
  '🪆','🖼️','🪞','🪟','🛍️','🛒','🎁','🎈','🎏','🎀','🪄','🪅','🎊','🎉',
  '🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪',
  '📫','📬','📭','📮','📯','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️',
  '🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰',
  '📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️',
  '📐','📏','🧮','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍',
  '🔎','🔏','🔐','🔒','🔓',
  // Symbols & flags (sample)
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓',
  '💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️',
  '☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓',
  '🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚',
  '💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘',
  '❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞',
  '📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱',
  '⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤',
  '🏧','🚾','♿','🅿️','🛗','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼',
  '⚧','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙',
  '🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟',
  '🔢','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','⏫',
  '⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️',
  '↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗',
  '✖️','♾️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝',
  '🔜','✔️','☑️','🔘','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺',
  '🔻','🔸','🔹','🔶','🔷','🔳','🔲','▪️','▫️','◾','◽','◼️','◻️','⬛',
  '⬜','🟧','🟨','🟩','🟦','🟪','🟫','🔈','🔇','🔉','🔊','🔔','🔕','📣',
  '📢','👁️‍🗨️','💬','💭','🗯️','♠️','♣️','♥️','♦️','🃏','🎴','🀄',
];

export type MessageAction = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onReactionSelect: (emoji: string) => void;
  actions: MessageAction[];
  existingReactions?: ReactionGroup[];
}

const GRID_COLUMNS = 7;
const CLOSE_DELAY_MS = 180;

export function MessageActionMenu({
  visible,
  onClose,
  onReactionSelect,
  actions,
  existingReactions,
}: Props) {
  const c = useColors();
  const [expanded, setExpanded] = useState(false);

  const handleClose = useCallback(() => {
    setExpanded(false);
    onClose();
  }, [onClose]);

  // Close-first, fire-after pattern. The menu lives inside a native Modal,
  // so any action that opens another Modal (ConfirmModal, navigate, etc.)
  // collides with this one's dismiss animation on iOS — the second Modal
  // refuses to present and a stuck scrim eats every subsequent tap. Closing
  // first and firing on the next tick lets the system fully dismiss before
  // the next surface tries to mount.
  const handleReaction = useCallback(
    (emoji: string) => {
      handleClose();
      setTimeout(() => onReactionSelect(emoji), CLOSE_DELAY_MS);
    },
    [handleClose, onReactionSelect],
  );

  const handleSelectAction = useCallback(
    (action: MessageAction) => {
      handleClose();
      setTimeout(action.onPress, CLOSE_DELAY_MS);
    },
    [handleClose],
  );

  const renderEmojiCell = useCallback(
    ({ item }: { item: string }) => (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`React with ${item}`}
        onPress={() => handleReaction(item)}
        style={styles.gridEmoji}
      >
        <ThemedText style={styles.gridEmojiText}>{item}</ThemedText>
      </TouchableOpacity>
    ),
    [handleReaction],
  );

  const keyExtractor = useCallback((item: string, index: number) => `${item}-${index}`, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
    >
      {visible ? (
        <Animated.View
          entering={FadeIn.duration(100)}
          exiting={FadeOut.duration(120)}
          style={styles.scrim}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} accessibilityLabel="Close" accessibilityRole="button" />

          <View style={styles.center} pointerEvents="box-none">
            {/* Reaction grid (when expanded) — FlatList virtualized so the
                ~600-emoji catalog mounts in O(viewport) rather than O(all). */}
            {expanded && (
              <Animated.View
                entering={FadeIn.duration(120)}
                exiting={FadeOut.duration(100)}
                style={[
                  styles.grid,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
                onStartShouldSetResponder={() => true}
              >
                <FlatList
                  data={MORE_EMOJIS}
                  keyExtractor={keyExtractor}
                  renderItem={renderEmojiCell}
                  numColumns={GRID_COLUMNS}
                  contentContainerStyle={styles.gridContent}
                  showsVerticalScrollIndicator={false}
                  initialNumToRender={49}
                  maxToRenderPerBatch={49}
                  updateCellsBatchingPeriod={30}
                  windowSize={9}
                />
              </Animated.View>
            )}

            {/* Reaction pill bar */}
            <Animated.View
              entering={FadeIn.duration(120)}
              style={[
                styles.reactionBar,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
              onStartShouldSetResponder={() => true}
            >
              {QUICK_REACTIONS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${emoji}`}
                  onPress={() => handleReaction(emoji)}
                  style={styles.emojiBtn}
                >
                  <ThemedText style={styles.emoji}>{emoji}</ThemedText>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={expanded ? 'Hide more emojis' : 'Show more emojis'}
                accessibilityState={{ expanded }}
                onPress={() => setExpanded(!expanded)}
                style={[
                  styles.expandBtn,
                  { backgroundColor: expanded ? c.gold : c.cardAlt },
                ]}
              >
                <Ionicons
                  name={expanded ? 'chevron-up' : 'add'}
                  size={ms(18)}
                  color={expanded ? Brand.ink : c.secondaryText}
                  accessible={false}
                />
              </TouchableOpacity>
            </Animated.View>

            {/* Action card */}
            {actions.length > 0 && (
              <Animated.View
                entering={FadeIn.duration(120)}
                style={[
                  styles.actionCard,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
                onStartShouldSetResponder={() => true}
              >
                {actions.map((action, i) => {
                  const isLast = i === actions.length - 1;
                  const fg = action.destructive ? c.danger : c.text;
                  return (
                    <TouchableOpacity
                      key={action.id}
                      onPress={() => handleSelectAction(action)}
                      style={[
                        styles.actionRow,
                        !isLast && {
                          borderBottomColor: c.border,
                          borderBottomWidth: StyleSheet.hairlineWidth,
                        },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={action.label}
                      activeOpacity={0.65}
                    >
                      <ThemedText style={[styles.actionLabel, { color: fg }]}>
                        {action.label}
                      </ThemedText>
                      <Ionicons
                        name={action.icon}
                        size={ms(18)}
                        color={fg}
                        accessible={false}
                      />
                    </TouchableOpacity>
                  );
                })}
              </Animated.View>
            )}

            {/* Reaction attribution */}
            {existingReactions && existingReactions.length > 0 && (
              <Animated.View
                entering={FadeIn.duration(120)}
                style={[
                  styles.attributionCard,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
                onStartShouldSetResponder={() => true}
              >
                {existingReactions.map((rr) => (
                  <View
                    key={rr.emoji}
                    style={styles.attributionRow}
                    accessibilityLabel={`${rr.emoji} by ${rr.team_names.join(', ')}`}
                  >
                    <ThemedText style={styles.attributionEmoji}>{rr.emoji}</ThemedText>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.attributionNames, { color: c.secondaryText }]}
                      numberOfLines={2}
                    >
                      {rr.team_names.join(' · ').toUpperCase()}
                    </ThemedText>
                  </View>
                ))}
              </Animated.View>
            )}
          </View>
          <DialogHost />
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 16, 0.50)', // Brand.ink @ 50%
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(20),
    gap: s(8),
  },
  // Reaction pill bar
  reactionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(6),
    paddingVertical: s(6),
    borderRadius: 28,
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
    lineHeight: ms(30),
    textAlign: 'center',
    includeFontPadding: false,
  },
  expandBtn: {
    width: s(36),
    height: s(36),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  // Expanded emoji grid
  grid: {
    width: s(310),
    maxHeight: s(260),
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    overflow: 'hidden',
    marginBottom: s(2),
  },
  gridContent: {
    padding: s(8),
  },
  gridEmoji: {
    width: `${100 / GRID_COLUMNS}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridEmojiText: {
    fontSize: ms(22),
    lineHeight: ms(28),
    textAlign: 'center',
    includeFontPadding: false,
  },
  // Action card
  actionCard: {
    width: s(280),
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(16),
    paddingVertical: s(13),
  },
  actionLabel: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(18),
    letterSpacing: -0.2,
  },
  // Reaction attribution
  attributionCard: {
    width: s(280),
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
    fontSize: ms(10),
    letterSpacing: 0.8,
    flex: 1,
  },
});
