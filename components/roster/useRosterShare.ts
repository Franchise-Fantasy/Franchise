import { useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';

/**
 * Hook for capturing the roster as a shareable image.
 *
 * Usage:
 *   const { shareRef, isSharing, shareRoster } = useRosterShare();
 *   <View ref={shareRef} collapsable={false}>...content to capture...</View>
 *   <Button onPress={shareRoster} disabled={isSharing} />
 *
 * The wrapped View must have `collapsable={false}` so the native view is
 * preserved (otherwise Android may optimize the wrapper away and captureRef
 * can't find a ref target).
 */
export function useRosterShare() {
  const shareRef = useRef<View>(null);
  const [isSharing, setIsSharing] = useState(false);

  const shareRoster = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      const uri = await captureRef(shareRef, {
        format: 'png',
        quality: 1,
        result: 'tmpfile',
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing unavailable', 'This device does not support sharing.');
        return;
      }

      await Sharing.shareAsync(uri, {
        mimeType: 'image/png',
        dialogTitle: 'Share your roster',
        UTI: 'public.png',
      });
    } catch (err) {
      console.error('[useRosterShare] capture failed', err);
      Alert.alert('Could not share', 'Failed to capture your roster image. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  return { shareRef, isSharing, shareRoster };
}
