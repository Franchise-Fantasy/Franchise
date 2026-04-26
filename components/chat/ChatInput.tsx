import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { type ModalAction } from '@/components/ui/InlineAction';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { Brand } from '@/constants/Colors';
import { useActionPicker } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { logger } from '@/utils/logger';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';


interface Props {
  conversationId: string;
  onSend: (text: string) => void;
  sending: boolean;
  isCommissioner?: boolean;
  isLeagueChat?: boolean;
  onCreatePoll?: () => void;
  onCreateSurvey?: () => void;
  onPickImage?: (source: 'gallery' | 'camera') => void;
  onOpenGifPicker?: () => void;
  isUploading?: boolean;
}

const DRAFT_PREFIX = 'chat_draft_';

export function ChatInput({ conversationId, onSend, sending, isCommissioner, isLeagueChat, onCreatePoll, onCreateSurvey, onPickImage, onOpenGifPicker, isUploading }: Props) {
  const c = useColors();
  const pickAction = useActionPicker();
  const [text, setText] = useState('');
  const draftLoaded = useRef(false);

  // Restore draft on mount
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DRAFT_PREFIX + conversationId)
      .then((saved) => {
        if (cancelled) return;
        if (saved) setText(saved);
        draftLoaded.current = true;
      })
      .catch((e) => logger.warn('Restore chat draft failed', e));
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Persist draft as user types (debounced via ref to avoid excessive writes)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const handleTextChange = useCallback((val: string) => {
    setText(val);
    if (!draftLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (val.trim()) {
        AsyncStorage.setItem(DRAFT_PREFIX + conversationId, val);
      } else {
        AsyncStorage.removeItem(DRAFT_PREFIX + conversationId);
      }
    }, 400);
  }, [conversationId]);

  const canSend = text.trim().length > 0 && !sending;

  // Animate send button scale — smooth ease, no spring overshoot
  const sendScale = useSharedValue(0.6);
  useEffect(() => {
    sendScale.value = withTiming(canSend ? 1 : 0.6, { duration: 200 });
  }, [canSend, sendScale]);

  const sendAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    opacity: sendScale.value,
  }));

  const handleSend = async () => {
    if (!canSend) return;
    const msg = text.trim();
    if (containsBlockedContent(msg)) {
      Alert.alert('Message blocked', 'Your message contains language that isn’t allowed.');
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setText('');
    await AsyncStorage.removeItem(DRAFT_PREFIX + conversationId);
    onSend(msg);
  };

  const showCommishOptions = !!(isCommissioner && isLeagueChat);
  const openAttachPicker = () => {
    const attachActions: ModalAction[] = [
      {
        id: 'gallery',
        label: 'Photo Library',
        icon: 'images-outline',
        onPress: () => onPickImage?.('gallery'),
      },
      {
        id: 'camera',
        label: 'Take Photo',
        icon: 'camera-outline',
        onPress: () => onPickImage?.('camera'),
      },
      {
        id: 'gif',
        label: 'GIF',
        icon: 'film-outline',
        onPress: () => onOpenGifPicker?.(),
      },
      {
        id: 'poll',
        label: 'Poll',
        icon: 'bar-chart-outline',
        hidden: !showCommishOptions || !onCreatePoll,
        onPress: () => onCreatePoll?.(),
      },
      {
        id: 'survey',
        label: 'Survey',
        icon: 'clipboard-outline',
        hidden: !showCommishOptions || !onCreateSurvey,
        onPress: () => onCreateSurvey?.(),
      },
    ];
    pickAction({ title: 'Attach', actions: attachActions });
  };

  return (
    <View style={[styles.container, { borderTopColor: c.border }]}>
      {isUploading ? (
        <View style={styles.attachBtn}>
          <LogoSpinner size={18} />
        </View>
      ) : (
        <TouchableOpacity
          onPress={openAttachPicker}
          style={styles.attachBtn}
          accessibilityRole="button"
          accessibilityLabel="Attach photo, GIF, or more"
        >
          <Ionicons name="add-circle" size={ms(28)} color={c.gold} accessible={false} />
        </TouchableOpacity>
      )}
      <TextInput
        style={[
          styles.input,
          {
            backgroundColor: c.input,
            borderColor: c.border,
            color: c.text,
          },
        ]}
        placeholder="Message…"
        placeholderTextColor={c.secondaryText}
        value={text}
        onChangeText={handleTextChange}
        multiline
        maxLength={2000}
        returnKeyType="default"
        accessibilityLabel="Type a message"
      />
      <Animated.View style={sendAnimStyle}>
        <TouchableOpacity
          onPress={handleSend}
          disabled={!canSend}
          style={[
            styles.sendBtn,
            { backgroundColor: canSend ? c.gold : c.buttonDisabled },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
        >
          <Ionicons name="arrow-up" size={ms(20)} color={Brand.ink} accessible={false} />
        </TouchableOpacity>
      </Animated.View>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: s(8),
    gap: s(8),
    borderTopWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: s(16),
    paddingVertical: s(8),
    fontSize: ms(15),
    maxHeight: s(100),
  },
  attachBtn: {
    width: s(34),
    height: s(34),
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: s(34),
    height: s(34),
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
