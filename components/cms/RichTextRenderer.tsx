/* ──────────────────────────────────────────────
 *  Lightweight Contentful Rich Text → React Native
 *  Handles the node types we actually use:
 *  paragraphs, headings, bold/italic, lists,
 *  hyperlinks, embedded assets, horizontal rules.
 * ────────────────────────────────────────────── */

import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { RichTextDocument, RichTextNode } from '@/types/cms';
import React from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';

interface Props {
  document: RichTextDocument;
  /** Limit the total number of top-level blocks rendered. */
  maxBlocks?: number;
}

const HEADING_SIZES: Record<string, { fontSize: number; fontWeight: '700' | '600' }> = {
  'heading-1': { fontSize: 24, fontWeight: '700' },
  'heading-2': { fontSize: 22, fontWeight: '700' },
  'heading-3': { fontSize: 20, fontWeight: '700' },
  'heading-4': { fontSize: 18, fontWeight: '600' },
  'heading-5': { fontSize: 16, fontWeight: '600' },
  'heading-6': { fontSize: 14, fontWeight: '600' },
};

export function RichTextRenderer({ document, maxBlocks }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  let blocks = document.content ?? [];
  if (maxBlocks) blocks = blocks.slice(0, maxBlocks);

  function renderNode(node: RichTextNode, index: number): React.ReactNode {
    // Text leaf
    if (node.nodeType === 'text') {
      const marks = node.marks ?? [];
      let style: any = {};
      for (const m of marks) {
        if (m.type === 'bold') style.fontWeight = '700';
        if (m.type === 'italic') style.fontStyle = 'italic';
        if (m.type === 'underline') style.textDecorationLine = 'underline';
        if (m.type === 'code') {
          style.fontFamily = 'monospace';
          style.backgroundColor = c.cardAlt;
          style.paddingHorizontal = 3;
          style.borderRadius = 3;
        }
      }
      return (
        <Text key={index} style={style}>
          {node.value}
        </Text>
      );
    }

    // Hyperlink
    if (node.nodeType === 'hyperlink') {
      const uri = node.data?.uri ?? '';
      return (
        <Text
          key={index}
          style={{ color: c.accent, textDecorationLine: 'underline' }}
          onPress={() => Linking.openURL(uri)}
          accessibilityRole="link"
          accessibilityLabel={`Link to ${uri}`}
        >
          {node.content.map(renderNode)}
        </Text>
      );
    }

    // Embedded asset (image)
    if (node.nodeType === 'embedded-asset-block') {
      const file = node.data?.target?.fields?.file;
      if (!file?.url) return null;
      const url = file.url.startsWith('//') ? `https:${file.url}` : file.url;
      const dims = file.details?.image;
      const aspectRatio = dims ? dims.width / dims.height : 16 / 9;
      const alt = node.data.target.fields.description || node.data.target.fields.title || 'Embedded image';
      return (
        <Image
          key={index}
          source={{ uri: url }}
          style={[styles.embeddedImage, { aspectRatio }]}
          resizeMode="cover"
          accessibilityLabel={alt}
        />
      );
    }

    // Horizontal rule
    if (node.nodeType === 'hr') {
      return <View key={index} style={[styles.hr, { borderBottomColor: c.border }]} />;
    }

    // Block nodes with children
    const children = ('content' in node && Array.isArray(node.content))
      ? node.content.map(renderNode)
      : null;

    // Headings
    if (HEADING_SIZES[node.nodeType]) {
      const h = HEADING_SIZES[node.nodeType];
      return (
        <ThemedText key={index} style={[styles.heading, h]} accessibilityRole="header">
          {children}
        </ThemedText>
      );
    }

    // Paragraph
    if (node.nodeType === 'paragraph') {
      return (
        <ThemedText key={index} style={styles.paragraph}>
          {children}
        </ThemedText>
      );
    }

    // Blockquote
    if (node.nodeType === 'blockquote') {
      return (
        <View key={index} style={[styles.blockquote, { borderLeftColor: c.accent }]}>
          {children}
        </View>
      );
    }

    // Lists
    if (node.nodeType === 'unordered-list' || node.nodeType === 'ordered-list') {
      return (
        <View key={index} style={styles.list}>
          {('content' in node ? node.content : []).map((item, i) => {
            const bullet = node.nodeType === 'ordered-list' ? `${i + 1}.` : '•';
            return (
              <View key={i} style={styles.listItem}>
                <ThemedText style={styles.bullet}>{bullet}</ThemedText>
                <View style={styles.listItemContent}>
                  {('content' in item && Array.isArray(item.content))
                    ? item.content.map(renderNode)
                    : null}
                </View>
              </View>
            );
          })}
        </View>
      );
    }

    // List item rendered standalone (shouldn't happen, but safe fallback)
    if (node.nodeType === 'list-item') {
      return <View key={index}>{children}</View>;
    }

    // Fallback — just render children
    return <React.Fragment key={index}>{children}</React.Fragment>;
  }

  return <View accessibilityRole="text">{blocks.map(renderNode)}</View>;
}

const styles = StyleSheet.create({
  paragraph: {
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  heading: {
    marginTop: 12,
    marginBottom: 6,
  },
  embeddedImage: {
    width: '100%',
    borderRadius: 8,
    marginVertical: 8,
  },
  hr: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  blockquote: {
    borderLeftWidth: 3,
    paddingLeft: 12,
    marginVertical: 8,
    opacity: 0.85,
  },
  list: {
    marginBottom: 8,
    paddingLeft: 4,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  bullet: {
    width: 20,
    fontSize: 14,
    lineHeight: 21,
  },
  listItemContent: {
    flex: 1,
  },
});
