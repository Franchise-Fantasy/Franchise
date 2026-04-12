import { AnnouncementBanner } from '@/components/cms/AnnouncementBanner';
import { ms, s } from "@/utils/scale";
import { ArticleCard } from '@/components/cms/ArticleCard';
import { PollCard } from '@/components/cms/PollCard';
import { RichTextRenderer } from '@/components/cms/RichTextRenderer';
import { SpotlightCard } from '@/components/cms/SpotlightCard';
import { TipCard } from '@/components/cms/TipCard';
import { ThemedText } from '@/components/ui/ThemedText';
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { contentful } from '@/lib/contentful';
import { mapEntry } from '@/lib/cms-mappers';
import type { CmsMappedEntry } from '@/types/cms';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function CmsTestScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [contentType, setContentType] = useState('');
  const [detailEntry, setDetailEntry] = useState<CmsMappedEntry | null>(null);

  // Fetch all content types for the filter chips
  const typesQuery = useQuery({
    queryKey: queryKeys.contentfulTypes(),
    queryFn: () => contentful.getContentTypes(),
  });

  // Fetch entries, optionally filtered by content type
  const entriesQuery = useQuery({
    queryKey: queryKeys.contentfulEntries(contentType),
    queryFn: () =>
      contentful.getEntries(contentType ? { content_type: contentType } : {}),
  });

  const isLoading = typesQuery.isLoading || entriesQuery.isLoading;

  /** Render a mapped entry using the appropriate template. */
  function renderCard(mapped: CmsMappedEntry, entryId: string) {
    const openDetail = () => setDetailEntry(mapped);

    switch (mapped.type) {
      case 'article':
        return <ArticleCard {...mapped.props} onPress={openDetail} />;
      case 'announcement':
        return <AnnouncementBanner {...mapped.props} onPress={openDetail} />;
      case 'playerSpotlight':
        return <SpotlightCard {...mapped.props} onPress={openDetail} />;
      case 'quickTip':
        return <TipCard {...mapped.props} onPress={openDetail} />;
      case 'poll':
        return <PollCard {...mapped.props} />;
      default:
        return <RawEntryCard entryId={entryId} fields={(entriesQuery.data?.items.find((e: any) => e.sys.id === entryId) as any)?.fields} />;
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="CMS Test" />

      {/* Content type filter chips */}
      <View style={styles.typePicker}>
        <TouchableOpacity
          onPress={() => setContentType('')}
          style={[styles.chip, { borderColor: c.border }, !contentType && { backgroundColor: c.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Show all content types"
        >
          <ThemedText style={[styles.chipText, !contentType && { color: c.statusText }]}>
            All
          </ThemedText>
        </TouchableOpacity>
        {typesQuery.data?.items.map((ct) => {
          const active = contentType === ct.sys.id;
          return (
            <TouchableOpacity
              key={ct.sys.id}
              onPress={() => setContentType(ct.sys.id)}
              style={[styles.chip, { borderColor: c.border }, active && { backgroundColor: c.accent }]}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${ct.name}`}
            >
              <ThemedText style={[styles.chipText, active && { color: c.statusText }]}>
                {ct.name}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Entries */}
      {isLoading ? (
        <View style={styles.loader}><LogoSpinner /></View>
      ) : (
        <FlatList
          data={entriesQuery.data?.items ?? []}
          keyExtractor={(item) => item.sys.id}
          refreshControl={
            <RefreshControl
              refreshing={entriesQuery.isRefetching}
              onRefresh={() => entriesQuery.refetch()}
              tintColor={c.accent}
            />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText style={styles.empty}>
              No entries found. Make sure your Contentful env vars are set and
              you have published content.
            </ThemedText>
          }
          renderItem={({ item }) => renderCard(mapEntry(item), item.sys.id)}
        />
      )}

      {/* Detail modal — shows full rich text body */}
      <DetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />
    </SafeAreaView>
  );
}

// ── Detail modal ───────────────────────────────

function DetailModal({ entry, onClose }: { entry: CmsMappedEntry | null; onClose: () => void }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (!entry || entry.type === 'unknown') return null;

  const props = entry.props as any;
  const title = props.title ?? props.question ?? props.playerName ?? '';
  const doc = props.bodyDocument;

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.modal, { backgroundColor: c.background }]} onPress={() => {}}>
          <View style={styles.modalHeader}>
            <ThemedText type="defaultSemiBold" style={styles.modalTitle} numberOfLines={2}>
              {title}
            </ThemedText>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <ThemedText style={{ color: c.accent, fontSize: ms(16) }}>Done</ThemedText>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {doc ? (
              <RichTextRenderer document={doc} />
            ) : (
              <ThemedText style={{ color: c.secondaryText }}>
                No rich text body available for this entry.
              </ThemedText>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Raw fallback for unknown content types ─────

function RawEntryCard({ entryId, fields }: { entryId: string; fields?: Record<string, any> }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View
      style={[styles.rawCard, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`Unknown entry: ${entryId}`}
    >
      <ThemedText style={[styles.rawTitle, { color: c.secondaryText }]}>
        Unknown type · {entryId}
      </ThemedText>
      {fields
        ? Object.entries(fields).map(([key, value]) => (
            <ThemedText key={key} style={styles.rawField} numberOfLines={2}>
              <ThemedText style={{ fontWeight: '600' }}>{key}: </ThemedText>
              {typeof value === 'string' ? value : JSON.stringify(value)?.slice(0, 80)}
            </ThemedText>
          ))
        : null}
    </View>
  );
}

// ── Styles ─────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  typePicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: { fontSize: ms(13) },
  loader: { marginTop: 40 },
  list: { padding: 16, gap: 12 },
  empty: { textAlign: 'center', marginTop: 40, opacity: 0.6 },

  // Detail modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modal: {
    maxHeight: '85%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  modalTitle: { fontSize: ms(18), flex: 1, marginRight: 12 },
  modalBody: { padding: 16, paddingTop: 0 },

  // Raw fallback
  rawCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  rawTitle: { fontSize: ms(12), marginBottom: 8 },
  rawField: { fontSize: ms(12), marginTop: 2 },
});
