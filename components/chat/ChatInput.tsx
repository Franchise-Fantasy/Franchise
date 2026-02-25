import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

interface Props {
  onSend: (text: string) => void;
  sending: boolean;
}

export function ChatInput({ onSend, sending }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [text, setText] = useState('');

  const canSend = text.trim().length > 0 && !sending;

  const handleSend = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText('');
  };

  return (
    <View style={[styles.container, { borderTopColor: c.border }]}>
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
      />
      <TouchableOpacity
        onPress={handleSend}
        disabled={!canSend}
        style={[
          styles.sendBtn,
          { backgroundColor: canSend ? c.accent : c.buttonDisabled },
        ]}
      >
        <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
      </TouchableOpacity>
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
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
