import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface SegmentedControlProps {
  options: readonly string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SegmentedControl({ options, selectedIndex, onSelect }: SegmentedControlProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={[styles.container, { backgroundColor: c.cardAlt, borderColor: c.border }]} accessibilityRole="radiogroup">
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <TouchableOpacity
            key={option}
            onPress={() => onSelect(index)}
            style={[
              styles.option,
              selected && { backgroundColor: c.accent },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option}
          >
            <Text
              style={[
                styles.optionText,
                { color: selected ? c.accentText : c.text },
              ]}
            >
              {option}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  option: {
    flex: 1,
    paddingVertical: s(10),
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
