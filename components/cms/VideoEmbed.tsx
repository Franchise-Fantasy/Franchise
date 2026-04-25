/* ──────────────────────────────────────────────
 *  Video embed component
 *  YouTube/Vimeo → inline WebView.
 *  Other URLs → thumbnail with play overlay → open in browser.
 * ────────────────────────────────────────────── */

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Linking, StyleSheet, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

interface Props {
  url: string;
  thumbnailUrl?: string;
}

/** Try to convert a YouTube or Vimeo URL into an embeddable one. */
function toEmbedUrl(url: string): string | null {
  // YouTube: youtube.com/watch?v=ID or youtu.be/ID
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
  );
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?playsinline=1`;

  // Vimeo: vimeo.com/ID
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;

  return null;
}

export function VideoEmbed({ url, thumbnailUrl }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const embedUrl = useMemo(() => toEmbedUrl(url), [url]);

  // Embeddable video — render inline WebView
  if (embedUrl) {
    return (
      <View
        style={[styles.container, { backgroundColor: c.cardAlt }]}
        accessibilityLabel="Embedded video player"
      >
        <WebView
          source={{ uri: embedUrl }}
          style={styles.webview}
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction
          javaScriptEnabled
        />
      </View>
    );
  }

  // Fallback — play button that opens in browser
  return (
    <TouchableOpacity
      style={[styles.container, styles.fallback, { backgroundColor: c.cardAlt }]}
      onPress={() => Linking.openURL(url)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Play video in browser"
    >
      <Ionicons name="play-circle" size={48} color={c.accent} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
    overflow: 'hidden',
    marginVertical: 8,
  },
  webview: {
    flex: 1,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
