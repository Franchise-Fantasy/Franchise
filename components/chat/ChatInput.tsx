import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { TouchableOpacity } from 'react-native';

interface Props {
  onSend: (text: string) => void;
  sending: boolean;
  isCommissioner?: boolean;
  isLeagueChat?: boolean;
  onCreatePoll?: () => void;
}

export function ChatInput({ onSend, sending, isCommissioner, isLeagueChat, onCreatePoll }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [text, setText] = useState('');

  const canSend = text.trim().length > 0 && !sending;

  // Animate send button scale
  const sendScale = useSharedValue(0.6);
  useEffect(() => {
    sendScale.value = withSpring(canSend ? 1 : 0.6, { damping: 12, stiffness: 200 });
  }, [canSend]);

  const sendAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: sendScale.value }],
    opacity: sendScale.value,
  }));

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <View style={[styles.container, { borderTopColor: c.border }]}>
      {isCommissioner && isLeagueChat && onCreatePoll && (
        <TouchableOpacity
          onPress={onCreatePoll}
          style={styles.pollBtn}
          accessibilityRole="button"
          accessibilityLabel="Create a poll"
        >
          <Ionicons name="bar-chart-outline" size={22} color={c.accent} />
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
        onChangeText={setText}
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
    padding: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 15,
    maxHeight: 100,
  },
  pollBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
