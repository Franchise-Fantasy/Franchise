import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { GIPHY_API_KEY } from '@/constants/ApiKeys';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

const GIPHY_BASE = 'https://api.giphy.com/v1/gifs';
const NUM_COLUMNS = 3;
const SCREEN_WIDTH = Dimensions.get('window').width;
const ITEM_SIZE = (SCREEN_WIDTH - 24 - (NUM_COLUMNS - 1) * 4) / NUM_COLUMNS;

interface GiphyGif {
  id: string;
  url: string; // full-size GIF URL (original or downsized)
  preview: string; // small preview for grid
}

async function fetchGiphy(
  endpoint: 'search' | 'trending',
  query?: string,
): Promise<GiphyGif[]> {
  if (!GIPHY_API_KEY) return [];

  const params = new URLSearchParams({
    api_key: GIPHY_API_KEY,
    limit: '30',
    rating: 'pg-13',
  });
  if (endpoint === 'search' && query) params.set('q', query);

  const res = await fetch(`${GIPHY_BASE}/${endpoint}?${params}`);
  if (!res.ok) return [];

  const data = await res.json();
  return (data.data ?? []).map((r: any) => ({
    id: r.id,
    url: r.images?.downsized?.url ?? r.images?.original?.url ?? '',
    preview: r.images?.fixed_width_small?.url ?? r.images?.preview_gif?.url ?? '',
  }));
}

interface Props {
  visible: boolean;
  onSelect: (gifUrl: string) => void;
  onClose: () => void;
}

export function GifPicker({ visible, onSelect, onClose }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load trending on open
  useEffect(() => {
    if (!visible) {
      setQuery('');
      setGifs([]);
      return;
    }
    setLoading(true);
    fetchGiphy('trending').then((results) => {
      setGifs(results);
      setLoading(false);
    });
  }, [visible]);

  // Debounced search
  useEffect(() => {
    if (!visible) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      fetchGiphy('trending').then(setGifs);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      fetchGiphy('search', query.trim()).then((results) => {
        setGifs(results);
        setLoading(false);
      });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, visible]);

  const handleSelect = useCallback(
    (gifUrl: string) => {
      onSelect(gifUrl);
    },
    [onSelect],
  );

  const renderItem = useCallback(
    ({ item }: { item: GiphyGif }) => (
      <TouchableOpacity
        onPress={() => handleSelect(item.url)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel="Send GIF"
      >
        <Image
          source={{ uri: item.preview }}
          style={styles.gifThumb}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      </TouchableOpacity>
    ),
    [handleSelect],
  );

  const keyExtractor = useCallback((item: GiphyGif) => item.id, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.overlay} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border }]}>
          <View style={styles.header}>
            <ThemedText type="defaultSemiBold" style={styles.title}>
              GIFs
            </ThemedText>
            <TouchableOpacity
              onPress={onClose}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close GIF picker"
            >
              <Ionicons name="close" size={22} color={c.text} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={[
              styles.searchInput,
              {
                backgroundColor: c.input,
                borderColor: c.border,
                color: c.text,
              },
            ]}
            placeholder="Search GIFs..."
            placeholderTextColor={c.secondaryText}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search GIFs"
          />

          {loading && gifs.length === 0 ? (
            <View style={styles.loader}><LogoSpinner /></View>
          ) : (
            <FlatList
              data={gifs}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              numColumns={NUM_COLUMNS}
              contentContainerStyle={styles.grid}
              columnWrapperStyle={styles.columnWrapper}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            />
          )}

          <ThemedText style={[styles.attribution, { color: c.secondaryText }]}>
            Powered by GIPHY
          </ThemedText>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: {
    flex: 1,
  },
  sheet: {
    height: '60%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: s(8),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(8),
  },
  title: {
    fontSize: ms(17),
  },
  searchInput: {
    marginHorizontal: s(12),
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    fontSize: ms(15),
    marginBottom: s(8),
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
  },
  grid: {
    paddingHorizontal: s(12),
  },
  columnWrapper: {
    gap: s(4),
    marginBottom: s(4),
  },
  gifThumb: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: 8,
  },
  attribution: {
    textAlign: 'center',
    fontSize: ms(11),
    paddingVertical: s(4),
  },
});
