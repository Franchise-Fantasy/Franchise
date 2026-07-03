import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ImageData } from '@/hooks/useImportScreenshot';
import { ms, s } from '@/utils/scale';

interface ScreenshotCaptureProps {
  images: ImageData[];
  onImagesChange: (images: ImageData[]) => void;
  maxImages?: number;
  label?: string;
}

export function ScreenshotCapture({
  images,
  onImagesChange,
  maxImages = 3,
  label = 'Screenshots',
}: ScreenshotCaptureProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();

  // Index of the screenshot shown in the full-screen preview, or null when closed.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const previewImage = previewIndex !== null ? images[previewIndex] : null;

  const pickImage = useCallback(async (useCamera: boolean) => {
    if (images.length >= maxImages) {
      Alert.alert('Maximum reached', `You can add up to ${maxImages} screenshots.`);
      return;
    }

    const permFn = useCamera
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
    const { status } = await permFn();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        `Please allow ${useCamera ? 'camera' : 'photo library'} access to capture screenshots.`,
      );
      return;
    }

    const remaining = maxImages - images.length;

    const launchFn = useCamera
      ? ImagePicker.launchCameraAsync
      : ImagePicker.launchImageLibraryAsync;

    const result = await launchFn({
      mediaTypes: ['images'],
      quality: 0.35,
      base64: true,
      allowsMultipleSelection: !useCamera,
      selectionLimit: useCamera ? 1 : remaining,
    });

    if (result.canceled || !result.assets?.length) return;

    const newImages = result.assets
      .filter((a) => a.base64)
      .slice(0, remaining)
      .map((a) => ({ base64: a.base64!, media_type: a.mimeType ?? 'image/jpeg' }));

    if (newImages.length > 0) {
      onImagesChange([...images, ...newImages]);
    }
  }, [images, maxImages, onImagesChange]);

  const removeImage = useCallback(
    (index: number) => {
      onImagesChange(images.filter((_, i) => i !== index));
    },
    [images, onImagesChange],
  );

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <ThemedText
          type="varsitySmall"
          style={[styles.label, { color: c.secondaryText }]}
          accessibilityRole="header"
        >
          {label}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[styles.count, { color: c.secondaryText }]}
        >
          {images.length} / {maxImages}
        </ThemedText>
      </View>

      {images.length > 0 && (
        <View style={styles.thumbnails}>
          {images.map((img, index) => (
            <View key={index} style={styles.thumbnailWrapper}>
              <TouchableOpacity
                onPress={() => setPreviewIndex(index)}
                accessibilityRole="imagebutton"
                accessibilityLabel={`Screenshot ${index + 1}`}
                accessibilityHint="Opens a full-screen preview"
              >
                <Image
                  source={{ uri: `data:${img.media_type};base64,${img.base64}` }}
                  style={[styles.thumbnail, { borderColor: c.border }]}
                  accessible={false}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.removeBtn, { backgroundColor: c.danger }]}
                onPress={() => removeImage(index)}
                accessibilityRole="button"
                accessibilityLabel={`Remove screenshot ${index + 1}`}
              >
                <Ionicons name="close" size={ms(14)} color={Brand.ecru} accessible={false} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {images.length < maxImages && (
        <View style={styles.buttonRow}>
          <BrandButton
            label="Take Photo"
            variant="primary"
            size="default"
            icon="camera-outline"
            onPress={() => pickImage(true)}
            accessibilityLabel="Take a photo"
          />
          <BrandButton
            label="Library"
            variant="secondary"
            size="default"
            icon="images-outline"
            onPress={() => pickImage(false)}
            accessibilityLabel="Choose from photo library"
          />
        </View>
      )}

      <Modal
        visible={previewImage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewIndex(null)}
      >
        {/* Tap anywhere (backdrop or image) to dismiss. The image uses
            pointerEvents="none" so taps fall through to this Pressable. */}
        <Pressable
          style={styles.previewBackdrop}
          onPress={() => setPreviewIndex(null)}
          accessibilityRole="button"
          accessibilityLabel="Close preview"
        >
          {previewImage && (
            <View style={styles.previewImage} pointerEvents="none">
              <Image
                source={{
                  uri: `data:${previewImage.media_type};base64,${previewImage.base64}`,
                }}
                style={styles.previewImage}
                resizeMode="contain"
                accessibilityLabel={
                  previewIndex !== null ? `Screenshot ${previewIndex + 1}` : undefined
                }
              />
            </View>
          )}
          <TouchableOpacity
            style={[styles.previewClose, { top: insets.top + s(8) }]}
            onPress={() => setPreviewIndex(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Close preview"
          >
            <Ionicons name="close" size={ms(28)} color={Brand.ecru} />
          </TouchableOpacity>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: s(10),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: ms(10),
    letterSpacing: 0.9,
  },
  count: {
    fontSize: ms(10),
    letterSpacing: 0.5,
  },
  thumbnails: {
    flexDirection: 'row',
    gap: s(10),
    flexWrap: 'wrap',
  },
  thumbnailWrapper: {
    position: 'relative',
  },
  thumbnail: {
    width: s(90),
    height: s(160),
    borderRadius: 8,
    borderWidth: 1,
  },
  removeBtn: {
    position: 'absolute',
    top: s(-6),
    right: s(-6),
    width: s(22),
    height: s(22),
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: s(10),
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 16, 0.94)', // Brand.ink @ 94%
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewClose: {
    position: 'absolute',
    right: s(16),
    width: s(40),
    height: s(40),
    borderRadius: s(20),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
});
