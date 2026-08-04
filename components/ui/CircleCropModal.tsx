/**
 * Circular photo cropper.
 *
 * Every avatar/logo in the app renders inside a circle, but the OS picker's
 * built-in editor (`allowsEditing`) crops to a SQUARE — so the frame you chose
 * lost its corners the moment it landed in the app, and there was no way to see
 * what would survive. This replaces that step with an in-app one whose viewport
 * is the final shape.
 *
 * Pan + pinch position the source image behind a circular window; confirming
 * crops the square that circumscribes the circle (the round mask itself is a
 * render-time `borderRadius` on `TeamLogo`, so the stored file stays square)
 * and resizes to `outputSize` before handing back JPEG base64.
 *
 * The photo is measured (and downscaled if huge) through `ImageManipulator`
 * before anything is drawn — see `prepareWorkingImage`.
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Mask, Rect } from 'react-native-svg';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { coverScale, cropRectForCircle } from '@/utils/image/circleCrop';
import { ms, s } from '@/utils/scale';

const MAX_SCALE = 5;
/** Longest edge the cropper works with — anything bigger is downscaled first. */
const MAX_WORKING_EDGE = 1600;

interface CircleCropModalProps {
  visible: boolean;
  /** Local URI of the picked image. */
  uri: string | null;
  onCancel: () => void;
  onConfirm: (result: { uri: string; base64: string }) => void;
  /** Edge length of the square JPEG handed back. */
  outputSize?: number;
  title?: string;
}

const clamp = (value: number, lo: number, hi: number) => {
  'worklet';
  return Math.min(Math.max(value, lo), hi);
};

export function CircleCropModal({
  visible,
  uri,
  onCancel,
  onConfirm,
  outputSize = 512,
  title = 'Position Photo',
}: CircleCropModalProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <View
          style={[
            styles.shell,
            { paddingTop: insets.top + s(12), paddingBottom: insets.bottom + s(16) },
          ]}
        >
          <ThemedText type="display" style={styles.title} accessibilityRole="header">
            {title}
          </ThemedText>
          <Text style={styles.hint}>DRAG TO REPOSITION · PINCH TO ZOOM</Text>

          {/* Keyed by uri so each new photo gets a fresh, centred transform —
              cheaper and safer than resetting six shared values by hand. */}
          {uri ? (
            <CropStage
              key={uri}
              uri={uri}
              outputSize={outputSize}
              onCancel={onCancel}
              onConfirm={onConfirm}
            />
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

interface CropStageProps {
  uri: string;
  outputSize: number;
  onCancel: () => void;
  onConfirm: (result: { uri: string; base64: string }) => void;
}

interface WorkingImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Load the picked photo and, if it's larger than the cropper can make use of,
 * hand back a downscaled copy. A modern camera photo is 12MP+; displaying one
 * at full resolution costs tens of MB of bitmap for a 512px result.
 *
 * Dimensions come back from the manipulator rather than `Image.getSize` so the
 * displayed image and the final crop are measured in the same (orientation-
 * corrected) space — `manipulate` fixes EXIF orientation as it loads, which
 * would otherwise rotate the crop box on camera photos.
 */
async function prepareWorkingImage(uri: string): Promise<WorkingImage> {
  const loaded = await ImageManipulator.manipulate(uri).renderAsync();
  const longestEdge = Math.max(loaded.width, loaded.height);
  if (longestEdge <= MAX_WORKING_EDGE) {
    return { uri, width: loaded.width, height: loaded.height };
  }

  const ratio = MAX_WORKING_EDGE / longestEdge;
  const scaled = await ImageManipulator.manipulate(loaded)
    .resize({
      width: Math.round(loaded.width * ratio),
      height: Math.round(loaded.height * ratio),
    })
    .renderAsync();
  const saved = await scaled.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
  return { uri: saved.uri, width: scaled.width, height: scaled.height };
}

function CropStage({ uri, outputSize, onCancel, onConfirm }: CropStageProps) {
  const c = useColors();
  const { width: winW, height: winH } = useWindowDimensions();

  const [source, setSource] = useState<WorkingImage | null>(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [processing, setProcessing] = useState(false);

  const circle = Math.min(winW - s(48), winH * 0.42);

  const base = source ? coverScale(source, circle) : 1;
  const displayW = source ? source.width * base : 0;
  const displayH = source ? source.height * base : 0;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  useEffect(() => {
    let cancelled = false;
    prepareWorkingImage(uri)
      .then((image) => {
        if (!cancelled) setSource(image);
      })
      .catch(() => {
        if (!cancelled) {
          Alert.alert('Could not open photo', 'Please pick a different image.');
          onCancel();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [uri, onCancel]);

  // Furthest the image can travel before its edge would enter the circle.
  const panLimits = (atScale: number) => {
    'worklet';
    return {
      x: Math.max(0, (displayW * atScale - circle) / 2),
      y: Math.max(0, (displayH * atScale - circle) / 2),
    };
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      const limit = panLimits(scale.value);
      tx.value = clamp(savedTx.value + e.translationX, -limit.x, limit.x);
      ty.value = clamp(savedTy.value + e.translationY, -limit.y, limit.y);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      const next = clamp(savedScale.value * e.scale, 1, MAX_SCALE);
      scale.value = next;
      const limit = panLimits(next);
      tx.value = clamp(tx.value, -limit.x, limit.x);
      ty.value = clamp(ty.value, -limit.y, limit.y);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const imageStyle = useAnimatedStyle(() => ({
    // translate BEFORE scale in the array so the offsets stay in screen px,
    // which is the space `panLimits` and the crop math both work in.
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const handleConfirm = async () => {
    if (!source) return;

    const crop = cropRectForCircle(source, circle, scale.value, tx.value, ty.value);

    setProcessing(true);
    try {
      const image = await ImageManipulator.manipulate(source.uri)
        .crop(crop)
        .resize({ width: outputSize, height: outputSize })
        .renderAsync();
      const result = await image.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.8,
        base64: true,
      });
      onConfirm({ uri: result.uri, base64: result.base64! });
    } catch {
      Alert.alert('Crop Failed', 'Could not process that photo. Try another one.');
      setProcessing(false);
    }
  };

  return (
    <>
      <View
        style={styles.stage}
        onLayout={(e) =>
          setStage({
            width: e.nativeEvent.layout.width,
            height: e.nativeEvent.layout.height,
          })
        }
        accessible
        accessibilityLabel="Photo crop area"
        accessibilityHint="Drag to reposition the photo inside the circle, pinch to zoom"
      >
        {source ? (
          <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
            <View style={styles.stageFill}>
              <Animated.View style={[{ width: displayW, height: displayH }, imageStyle]}>
                <Image
                  source={{ uri: source.uri }}
                  style={styles.photo}
                  accessibilityIgnoresInvertColors
                />
              </Animated.View>
            </View>
          </GestureDetector>
        ) : (
          <LogoSpinner />
        )}

        {/* Circular window: everything outside it dims, and a gold ring marks
            exactly what the avatar will show. */}
        {stage.width > 0 && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg width={stage.width} height={stage.height}>
              <Defs>
                <Mask id="circle-window">
                  <Rect
                    x={0}
                    y={0}
                    width={stage.width}
                    height={stage.height}
                    fill="white"
                  />
                  <Circle
                    cx={stage.width / 2}
                    cy={stage.height / 2}
                    r={circle / 2}
                    fill="black"
                  />
                </Mask>
              </Defs>
              <Rect
                x={0}
                y={0}
                width={stage.width}
                height={stage.height}
                fill={Brand.ink}
                opacity={0.72}
                mask="url(#circle-window)"
              />
              <Circle
                cx={stage.width / 2}
                cy={stage.height / 2}
                r={circle / 2}
                stroke={c.gold}
                strokeWidth={2}
                fill="none"
              />
            </Svg>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.pill, styles.cancelPill, { opacity: processing ? 0.5 : 1 }]}
          onPress={onCancel}
          disabled={processing}
          accessibilityRole="button"
          accessibilityLabel="Cancel and pick a different photo"
        >
          <Text style={[styles.pillText, { color: Brand.ecruMuted }]}>CANCEL</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.pill,
            { backgroundColor: c.gold, opacity: processing || !source ? 0.5 : 1 },
          ]}
          onPress={handleConfirm}
          disabled={processing || !source}
          accessibilityRole="button"
          accessibilityLabel="Use this photo"
          accessibilityState={{ disabled: processing || !source, busy: processing }}
        >
          <Text style={[styles.pillText, { color: Brand.ink }]}>
            {processing ? 'CROPPING...' : 'USE PHOTO'}
          </Text>
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  shell: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 16, 0.97)', // Brand.ink, near-opaque
    paddingHorizontal: s(20),
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    color: Brand.ecru,
    textAlign: 'center',
  },
  hint: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 1.2,
    color: Brand.ecruFaint,
    textAlign: 'center',
    marginTop: s(4),
  },
  stage: {
    flex: 1,
    marginVertical: s(16),
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stageFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  actions: {
    flexDirection: 'row',
    gap: s(10),
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(13),
    borderRadius: 8,
  },
  cancelPill: {
    borderWidth: 1,
    borderColor: Brand.ecruFaint,
  },
  pillText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.0,
  },
});
