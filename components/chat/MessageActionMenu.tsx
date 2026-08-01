/**
 * iMessage-style action menu that appears when a chat message is long-pressed.
 *
 * The long-pressed message is lifted above a frosted scrim and stays exactly
 * where it was on screen; the reaction group hangs above it and the action menu
 * below, both aligned to whichever edge the bubble sits on. The message only
 * moves at all when one of them wouldn't otherwise fit, and then only far
 * enough to make room.
 *
 * Nothing here lives in a flex column — every layer is absolutely positioned
 * off the measured frame, and the reaction group is anchored by its BOTTOM
 * edge. That is what lets the emoji catalog open upward out of the group's own
 * top while the bar, the message and the action menu all stay put. There is no
 * layout animation anywhere in this file, so there is nothing to bounce.
 *
 * Call sites own the measurement — see the `focused` prop.
 */
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { DialogHost } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
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

/**
 * The long-pressed message, lifted above the scrim.
 *
 * `render` returns a fresh copy of the bubble to draw in the overlay — the
 * real one stays in the list underneath the blur. It's a snapshot: rendered
 * inert (`pointerEvents="none"`) and never updated while the menu is open.
 */
export type FocusedMessage = {
  rect: { x: number; y: number; width: number; height: number };
  isOwn: boolean;
  render: () => React.ReactNode;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  onReactionSelect: (emoji: string) => void;
  actions: MessageAction[];
  existingReactions?: ReactionGroup[];
  focused?: FocusedMessage | null;
}

const GRID_COLUMNS = 7;
const CLOSE_DELAY_MS = 180;
const EXIT_MS = 110;

const CARD_RADIUS = s(18);
const GAP = s(10);
const EDGE = s(12);

// The bar holds 6 reactions + the expand button at a fixed 40pt each, so its
// width is deterministic — needed up front to align it against the bubble.
const SLOT = s(40);
const BAR_PAD = s(5);
const BAR_WIDTH = SLOT * 7 + BAR_PAD * 2;
const MENU_WIDTH = s(216);
// The catalog scrolls, so it takes whatever room is left below the message
// between these bounds instead of a fixed height that would force a reflow.
const GRID_MIN = s(190);
const GRID_MAX = s(300);

const EASE = Easing.out(Easing.cubic);
const SHIFT_MS = 260;

// Worklets run on the UI thread and can't call `s()`, so scaled offsets are
// resolved at module load and closed over as plain numbers.
const CARD_RISE = s(10);

// Gentle rise-and-settle for the menu cards. Timing, not spring — the stack is
// absolutely positioned now, so nothing else moves when it appears and any
// overshoot reads as a wobble rather than as weight.
const cardIn = (delayMs: number) => (() => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: CARD_RISE }, { scale: 0.96 }] },
    animations: {
      opacity: withDelay(delayMs, withTiming(1, { duration: 170, easing: EASE })),
      transform: [
        { translateY: withDelay(delayMs, withTiming(0, { duration: 220, easing: EASE })) },
        { scale: withDelay(delayMs, withTiming(1, { duration: 220, easing: EASE })) },
      ],
    },
  };
});

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function MessageActionMenu({
  visible,
  onClose,
  onReactionSelect,
  actions,
  existingReactions,
  focused,
}: Props) {
  const c = useColors();
  const scheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);

  // Measured once per open. Seeded with the bar's natural height so the first
  // frame lands close and the correction is invisible.
  const [headBaseH, setHeadBaseH] = useState(SLOT + BAR_PAD * 2);
  const [stackH, setStackH] = useState(0);

  // Fade held in shared values rather than an `entering={FadeIn}` prop. A
  // Reanimated entering animation on a view that mounts with its Modal can
  // paint one frame at its final opacity before the animation takes over —
  // the whole scrim and blur appearing at full strength for a frame, which is
  // the flash you see on select. A shared value seeded at 0 can't do that,
  // because the very first render already reads 0.
  //
  // Two values, not one: `enter` is written only in an effect and `exit` only
  // in a callback, which keeps each one's writes in a single place.
  const enter = useSharedValue(0);
  const exit = useSharedValue(0);
  const closingRef = useRef(false);

  useEffect(() => {
    enter.value = withTiming(1, { duration: reducedMotion ? 0 : 150, easing: EASE });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: enter.value * (1 - exit.value),
    transform: [{ scale: 1 - exit.value * 0.03 }],
  }));

  // Close-first, fire-after pattern. The menu lives inside a native Modal,
  // so any action that opens another Modal (ConfirmModal, navigate, etc.)
  // collides with this one's dismiss animation on iOS — the second Modal
  // refuses to present and a stuck scrim eats every subsequent tap. We play
  // the exit, then close, then fire the callback on a later tick so the
  // system fully dismisses before the next surface tries to mount.
  //
  // Note we deliberately do NOT reset `expanded` here: collapsing mid-dismiss
  // remounts the action cards with their entering animation, which read as
  // the menu flickering back to life on the way out. Both call sites unmount
  // this component on close, so the state resets on its own.
  const beginClose = useCallback(
    (after?: () => void) => {
      if (closingRef.current) return;
      closingRef.current = true;
      const exitMs = reducedMotion ? 0 : EXIT_MS;
      exit.value = withTiming(1, { duration: exitMs });
      setTimeout(() => {
        onClose();
        if (after) setTimeout(after, CLOSE_DELAY_MS);
      }, exitMs);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onClose, reducedMotion],
  );

  const handleClose = useCallback(() => beginClose(), [beginClose]);

  const handleReaction = useCallback(
    (emoji: string) => {
      Haptics.selectionAsync();
      beginClose(() => onReactionSelect(emoji));
    },
    [beginClose, onReactionSelect],
  );

  const handleSelectAction = useCallback(
    (action: MessageAction) => beginClose(action.onPress),
    [beginClose],
  );

  const toggleExpanded = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setExpanded((prev) => !prev);
  }, []);

  // ─── Geometry ──────────────────────────────────────────────
  // Three layers around the message: the reaction group above it, the message
  // itself, and the action menu below. Every layer is positioned off the
  // measured frame and shares one `shift`, so there is no flex column to
  // reflow and no layout animation to bounce.
  //
  // The reaction group is anchored by its BOTTOM edge, pinned just above the
  // message. That is what lets the emoji catalog open upward without moving
  // anything: the group grows out of its own top while the bar, the message
  // and the action menu all stay exactly where they were.
  const topLimit = insets.top + EDGE;
  const bottomLimit = winH - insets.bottom - EDGE;

  const geo = useMemo(() => {
    // No measurement (long-press landed before layout) — fall back to a frame
    // in the middle of the screen and let the same math place everything.
    const rect = focused?.rect ?? { x: EDGE, y: winH / 2, width: winW - EDGE * 2, height: 0 };
    const isOwn = focused?.isOwn ?? false;

    // What the group above the message insists on having. The catalog scrolls,
    // so it only needs a floor.
    const aboveMin = headBaseH + (expanded ? GRID_MIN + GAP : 0);

    // Clip an over-tall message rather than pushing the menu off-screen.
    const room = bottomLimit - topLimit - aboveMin - stackH - GAP * 2;
    const bubbleH = Math.min(rect.height, Math.max(room, s(64)));

    // Move the message only as far as it takes to fit the group above it and
    // the menu below — 0 whenever it already fits, so it stays put.
    const minShift = topLimit + aboveMin + GAP - rect.y;
    const maxShift = bottomLimit - stackH - GAP - bubbleH - rect.y;
    const shift = maxShift >= minShift ? clamp(0, minShift, maxShift) : minShift;

    // Hang the reaction group and the action menu off the bubble's own edge.
    const edgeAlign = (w: number) =>
      clamp(isOwn ? rect.x + rect.width - w : rect.x, EDGE, winW - w - EDGE);

    // Whatever is left between the top of the screen and the group's own top.
    const gridH = clamp(
      rect.y + shift - GAP - topLimit - headBaseH - GAP,
      GRID_MIN,
      GRID_MAX,
    );

    const headBottom = winH - (rect.y - GAP);
    return {
      headBottom,
      // The catalog is its own layer rather than a child of the reaction
      // group. As a flex child it would be re-drawn at the group's new top on
      // the way out — the group shrinks the instant it unmounts — which reads
      // as the catalog flashing lower down before it fades.
      gridBottom: headBottom + headBaseH + GAP,
      bubbleTop: rect.y,
      bubbleH,
      menuTop: rect.y + bubbleH + GAP,
      headLeft: edgeAlign(BAR_WIDTH),
      menuLeft: edgeAlign(MENU_WIDTH),
      shift,
      gridH,
    };
  }, [focused, expanded, headBaseH, stackH, topLimit, bottomLimit, winW, winH]);

  // One shared offset for every layer, so on the rare occasion the message does
  // have to move to make room, the whole group travels together.
  const shiftSV = useSharedValue(geo.shift);
  const prevExpanded = useRef(expanded);

  useEffect(() => {
    if (prevExpanded.current === expanded) {
      // Measurements settling on the first frames — snap, don't animate.
      shiftSV.value = geo.shift;
      return;
    }
    prevExpanded.current = expanded;
    shiftSV.value = withTiming(geo.shift, {
      duration: reducedMotion ? 0 : SHIFT_MS,
      easing: EASE,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, geo.shift, reducedMotion]);

  const shiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: shiftSV.value }],
  }));

  const renderEmojiCell = useCallback(
    ({ item }: { item: string }) => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`React with ${item}`}
        onPress={() => handleReaction(item)}
        style={({ pressed }) => [styles.gridEmoji, pressed && { backgroundColor: c.cardAlt }]}
      >
        <ThemedText style={styles.gridEmojiText}>{item}</ThemedText>
      </Pressable>
    ),
    [handleReaction, c.cardAlt],
  );

  const keyExtractor = useCallback((item: string, index: number) => `${item}-${index}`, []);
  const enterCard = (delayMs: number) => (reducedMotion ? FadeIn.duration(0) : cardIn(delayMs));

  return (
    // statusBarTranslucent is load-bearing, not cosmetic: measureInWindow's y
    // includes the status bar, so the modal has to span the whole window or
    // the focused copy lands offset from the real bubble on Android.
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      animationType="none"
      onRequestClose={handleClose}
    >
      {visible ? (
        <Animated.View style={[styles.root, rootStyle]}>
          {/* Frosted scrim: real blur on iOS, deeper flat wash on Android
              (expo-blur's Android path needs an experimental renderer). */}
          {Platform.OS === 'ios' && (
            <BlurView
              intensity={34}
              tint={scheme === 'dark' ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          )}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor:
                  Platform.OS === 'ios'
                    ? scheme === 'dark'
                      ? 'rgba(10, 8, 8, 0.42)'
                      : 'rgba(20, 16, 16, 0.26)'
                    : scheme === 'dark'
                      ? 'rgba(0, 0, 0, 0.60)'
                      : 'rgba(20, 16, 16, 0.50)',
              },
            ]}
          />
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityLabel="Close"
            accessibilityRole="button"
          />

          {/* The long-pressed message, held above the blur at its own place on
              screen. It stays put in every state. */}
          {focused && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.focused,
                {
                  top: geo.bubbleTop,
                  left: focused.rect.x,
                  width: focused.rect.width,
                  maxHeight: geo.bubbleH,
                },
                shiftStyle,
              ]}
            >
              {focused.render()}
            </Animated.View>
          )}

          {/* The emoji catalog, sitting on top of the reaction group. Its own
              layer, bottom-anchored like the group, so unmounting it can't
              relocate it mid-fade. FlatList virtualized so the ~600-emoji set
              mounts in O(viewport) rather than O(all). */}
          {expanded && (
            <Animated.View
              entering={FadeIn.duration(reducedMotion ? 0 : 160)}
              exiting={FadeOut.duration(reducedMotion ? 0 : 100)}
              style={[
                styles.card,
                styles.cardShadow,
                styles.grid,
                {
                  bottom: geo.gridBottom,
                  left: geo.headLeft,
                  height: geo.gridH,
                  backgroundColor: c.card,
                  borderColor: c.border,
                },
                shiftStyle,
              ]}
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

          {/* Everything else about reactions, pinned by its bottom edge just
              above the message: who has already reacted, then the picker. The
              roster of reactors sits with the reactions rather than stranded
              below the destructive actions. Measured (`headBaseH`) to place
              the catalog above it and to decide whether the group fits. */}
          <Animated.View
            onLayout={(e) => setHeadBaseH(e.nativeEvent.layout.height)}
            style={[styles.head, { bottom: geo.headBottom, left: geo.headLeft }, shiftStyle]}
          >
            {existingReactions && existingReactions.length > 0 && (
              <Animated.View
                entering={enterCard(60)}
                style={[
                  styles.card,
                  styles.cardShadow,
                  styles.attributionCard,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
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

            <Animated.View
              entering={enterCard(0)}
              style={[
                styles.reactionBar,
                styles.cardShadow,
                { backgroundColor: c.card, borderColor: c.border },
              ]}
            >
              {QUICK_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={`React with ${emoji}`}
                  onPress={() => handleReaction(emoji)}
                  style={({ pressed }) => [styles.slot, pressed && { backgroundColor: c.cardAlt }]}
                >
                  <ThemedText style={styles.emoji}>{emoji}</ThemedText>
                </Pressable>
              ))}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={expanded ? 'Hide more emojis' : 'Show more emojis'}
                accessibilityState={{ expanded }}
                onPress={toggleExpanded}
                style={({ pressed }) => [styles.slot, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.expandDot, { backgroundColor: expanded ? c.gold : c.cardAlt }]}>
                  <Ionicons
                    name={expanded ? 'chevron-down' : 'add'}
                    size={ms(18)}
                    color={expanded ? Brand.ink : c.secondaryText}
                    accessible={false}
                  />
                </View>
              </Pressable>
            </Animated.View>
          </Animated.View>

          {/* Action menu, below the message and unaffected by the catalog. */}
          {actions.length > 0 && (
            <Animated.View
              entering={enterCard(40)}
              onLayout={(e) => setStackH(e.nativeEvent.layout.height)}
              style={[
                styles.card,
                styles.cardShadow,
                styles.menu,
                {
                  top: geo.menuTop,
                  left: geo.menuLeft,
                  backgroundColor: c.card,
                  borderColor: c.border,
                },
                shiftStyle,
              ]}
            >
              {actions.map((action, i) => {
                const fg = action.destructive ? c.danger : c.text;
                return (
                  <Pressable
                    key={action.id}
                    onPress={() => handleSelectAction(action)}
                    style={({ pressed }) => [
                      styles.actionRow,
                      i > 0 && {
                        borderTopColor: c.border,
                        borderTopWidth: StyleSheet.hairlineWidth,
                      },
                      pressed && { backgroundColor: c.cardAlt },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                  >
                    <Ionicons name={action.icon} size={ms(16)} color={fg} accessible={false} />
                    <ThemedText style={[styles.actionLabel, { color: fg }]}>
                      {action.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </Animated.View>
          )}
          <DialogHost />
        </Animated.View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  // One light source for every floating surface.
  cardShadow: {
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
  },
  // Drawn at exactly the frame the bubble was measured at, unscaled. A lift
  // here would be anchored to the row's centre rather than the bubble's, so a
  // right-aligned bubble would render a few points off from the real one —
  // and holding the message precisely in place is the whole point.
  focused: {
    position: 'absolute',
    overflow: 'hidden',
  },
  // Reaction group above the message: catalog (when open), who reacted, picker
  head: {
    position: 'absolute',
    width: BAR_WIDTH,
    gap: GAP,
  },
  // Its own layer, not a child of `head` — see gridBottom in the geometry.
  grid: {
    position: 'absolute',
    width: BAR_WIDTH,
  },
  card: {
    borderRadius: CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  reactionBar: {
    width: BAR_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    padding: BAR_PAD,
    borderRadius: SLOT / 2 + BAR_PAD,
    borderWidth: StyleSheet.hairlineWidth,
  },
  slot: {
    width: SLOT,
    height: SLOT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: SLOT / 2,
  },
  emoji: {
    fontSize: ms(24),
    lineHeight: ms(30),
    textAlign: 'center',
    includeFontPadding: false,
  },
  expandDot: {
    width: s(30),
    height: s(30),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: s(15),
  },
  gridContent: {
    padding: s(6),
  },
  gridEmoji: {
    width: `${100 / GRID_COLUMNS}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: s(12),
  },
  gridEmojiText: {
    fontSize: ms(22),
    lineHeight: ms(28),
    textAlign: 'center',
    includeFontPadding: false,
  },
  // Action menu below the message
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(14),
    paddingVertical: s(11),
  },
  actionLabel: {
    fontFamily: Fonts.display,
    fontSize: ms(14),
    lineHeight: ms(17),
    letterSpacing: -0.2,
  },
  attributionCard: {
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    gap: s(6),
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
