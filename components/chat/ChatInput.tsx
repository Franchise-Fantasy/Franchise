import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Platform, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { TouchableOpacity } from 'react-native';

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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [text, setText] = useState('');
  const draftLoaded = useRef(false);

  // Restore draft on mount
  useEffect(() => {
    AsyncStorage.getItem(DRAFT_PREFIX + conversationId).then((saved) => {
      if (saved) setText(saved);
      draftLoaded.current = true;
    });
  }, [conversationId]);

  // Persist draft as user types (debounced via ref to avoid excessive writes)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
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
  }, [canSend]);

  const sendAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    opacity: sendScale.value,
  }));

  const handleSend = async () => {
    if (!canSend) return;
    const msg = text.trim();
    if (containsBlockedContent(msg)) {
      const { Alert } = require('react-native');
      Alert.alert('Message blocked', 'Your message contains language that isn\u2019t allowed.');
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setText('');
    await AsyncStorage.removeItem(DRAFT_PREFIX + conversationId);
    onSend(msg);
  };

  const handleAttachPress = useCallback(() => {
    const options: string[] = ['Photo Library', 'Take Photo', 'GIF'];
    if (isCommissioner && isLeagueChat) {
      if (onCreatePoll) options.push('Poll');
      if (onCreateSurvey) options.push('Survey');
    }
    options.push('Cancel');
    const cancelIndex = options.length - 1;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex },
        (idx) => handleAttachOption(options[idx]),
      );
    } else {
      // On Android, use a simple alert-based menu
      const { Alert } = require('react-native');
      Alert.alert('Attach', undefined, [
        ...options.slice(0, -1).map((label: string) => ({
          text: label,
          onPress: () => handleAttachOption(label),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  }, [isCommissioner, isLeagueChat, onCreatePoll, onCreateSurvey, onPickImage, onOpenGifPicker]);

  const handleAttachOption = useCallback((option: string) => {
    switch (option) {
      case 'Photo Library':
        onPickImage?.('gallery');
        break;
      case 'Take Photo':
        onPickImage?.('camera');
        break;
      case 'GIF':
        onOpenGifPicker?.();
        break;
      case 'Poll':
        onCreatePoll?.();
        break;
      case 'Survey':
        onCreateSurvey?.();
        break;
    }
  }, [onPickImage, onOpenGifPicker, onCreatePoll, onCreateSurvey]);

  return (
    <View style={[styles.container, { borderTopColor: c.border }]}>
      {isUploading ? (
        <View style={styles.attachBtn}>
          <LogoSpinner size={18} />
        </View>
      ) : (
        <TouchableOpacity
          onPress={handleAttachPress}
          style={styles.attachBtn}
          accessibilityRole="button"
          accessibilityLabel="Attach photo, GIF, or more"
        >
          <Ionicons name="add-circle" size={28} color={c.accent} />
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
        placeholder="Message..."
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
            { backgroundColor: canSend ? c.accent : c.buttonDisabled },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend }}
        >
          <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
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
