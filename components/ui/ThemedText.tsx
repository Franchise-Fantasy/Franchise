import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts } from '@/constants/Colors';
import { useThemeColor } from '@/hooks/useThemeColor';
import { ms } from '@/utils/scale';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?:
    | 'default'
    | 'title'
    | 'defaultSemiBold'
    | 'subtitle'
    | 'link'
    | 'display'
    | 'sectionLabel'
    | 'varsity'
    | 'varsitySmall'
    | 'mono';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');
  const linkColor = useThemeColor({}, 'link');

  return (
    <Text
      style={[
        { color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? [styles.link, { color: linkColor }] : undefined,
        type === 'display' ? styles.display : undefined,
        type === 'sectionLabel' ? styles.sectionLabel : undefined,
        type === 'varsity' ? styles.varsity : undefined,
        type === 'varsitySmall' ? styles.varsitySmall : undefined,
        type === 'mono' ? styles.mono : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: ms(16),
    lineHeight: ms(24),
  },
  defaultSemiBold: {
    fontSize: ms(16),
    lineHeight: ms(24),
    fontWeight: '600',
  },
  title: {
    fontSize: ms(32),
    fontWeight: 'bold',
    lineHeight: ms(32),
  },
  subtitle: {
    fontSize: ms(20),
    fontWeight: 'bold',
  },
  link: {
    lineHeight: ms(30),
    fontSize: ms(16),
  },
  display: {
    fontFamily: Fonts.display,
    fontSize: ms(34),
    lineHeight: ms(42),
    letterSpacing: -0.3,
  },
  sectionLabel: {
    fontFamily: Fonts.display,
    fontSize: ms(17),
    lineHeight: ms(22),
    letterSpacing: -0.1,
  },
  varsity: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  varsitySmall: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  mono: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    letterSpacing: 0.5,
  },
});
