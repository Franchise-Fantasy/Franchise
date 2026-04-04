import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ImageData } from '@/hooks/useImportScreenshot';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useCallback } from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

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
        `Please allow ${useCamera ? 'camera' : 'photo library'} access to capture screenshots.`
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
      .filter(a => a.base64)
      .slice(0, remaining)
      .map(a => ({ base64: a.base64!, media_type: a.mimeType ?? 'image/jpeg' }));

    if (newImages.length > 0) {
      onImagesChange([...images, ...newImages]);
    }
  }, [images, maxImages, onImagesChange]);

  const removeImage = useCallback((index: number) => {
    onImagesChange(images.filter((_, i) => i !== index));
  }, [images, onImagesChange]);

  return (
    <View style={styles.container}>
      <ThemedText type="defaultSemiBold" style={styles.label} accessibilityRole="header">
        {label} ({images.length}/{maxImages})
      </ThemedText>

      {/* Image thumbnails */}
      {images.length > 0 && (
        <View style={styles.thumbnails}>
          {images.map((img, index) => (
            <View key={index} style={styles.thumbnailWrapper}>
              <Image
                source={{ uri: `data:${img.media_type};base64,${img.base64}` }}
                style={styles.thumbnail}
                accessibilityLabel={`Screenshot ${index + 1}`}
              />
              <TouchableOpacity
                style={[styles.removeBtn, { backgroundColor: c.danger }]}
                onPress={() => removeImage(index)}
                accessibilityRole="button"
                accessibilityLabel={`Remove screenshot ${index + 1}`}
              >
                <Ionicons name="close" size={14} color="#fff" accessible={false} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {/* Capture buttons */}
      {images.length < maxImages && (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.captureBtn, { backgroundColor: c.accent }]}
            onPress={() => pickImage(true)}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
          >
            <Ionicons name="camera-outline" size={20} color={c.accentText} accessible={false} />
            <ThemedText style={[styles.captureBtnText, { color: c.accentText }]}>
              Take Photo
            </ThemedText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.captureBtn, { borderColor: c.border, borderWidth: 1 }]}
            onPress={() => pickImage(false)}
            accessibilityRole="button"
            accessibilityLabel="Choose from photo library"
          >
            <Ionicons name="images-outline" size={20} color={c.text} accessible={false} />
            <ThemedText style={styles.captureBtnText}>Library</ThemedText>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: s(10),
  },
  label: {
    fontSize: ms(15),
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
  captureBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingVertical: s(10),
    paddingHorizontal: s(16),
    borderRadius: 8,
  },
  captureBtnText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
});
