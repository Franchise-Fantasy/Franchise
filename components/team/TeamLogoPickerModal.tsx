import { ThemedText } from '@/components/ui/ThemedText';
import { TeamLogo } from '@/components/team/TeamLogo';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

interface TeamLogoPickerModalProps {
  visible: boolean;
  teamId: string;
  teamName: string;
  currentLogoKey: string | null;
  onClose: () => void;
  onSaved: (logoKey: string | null) => void;
}

export function TeamLogoPickerModal({
  visible,
  teamId,
  teamName,
  currentLogoKey,
  onClose,
  onSaved,
}: TeamLogoPickerModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const pickImage = async (source: 'camera' | 'gallery') => {
    const permFn = source === 'camera'
      ? ImagePicker.requestCameraPermissionsAsync
      : ImagePicker.requestMediaLibraryPermissionsAsync;
    const { status } = await permFn();
    if (status !== 'granted') {
      Alert.alert(
        'Permission needed',
        `Please allow ${source === 'camera' ? 'camera' : 'photo library'} access to set a team logo.`,
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.4,
      base64: true,
      exif: false,
    };

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled || !result.assets?.[0]?.base64) return;

    const asset = result.assets[0];
    setPreview(asset.uri);
    uploadImage(asset.base64!);
  };

  const uploadImage = async (base64: string) => {
    setUploading(true);
    try {
      const { data, error } = await supabase.functions.invoke('upload-team-logo', {
        body: { team_id: teamId, image_base64: base64 },
      });

      if (error) throw error;
      if (data?.error) {
        Alert.alert('Upload Rejected', data.error);
        setPreview(null);
        return;
      }

      onSaved(data.logo_url);
      onClose();
    } catch (err: any) {
      Alert.alert('Upload Failed', err.message ?? 'Something went wrong');
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    setUploading(true);
    try {
      const { error } = await supabase
        .from('teams')
        .update({ logo_key: null })
        .eq('id', teamId);
      if (error) throw error;

      // Delete from storage (non-fatal)
      await supabase.storage.from('team-logos').remove([`${teamId}.jpg`]).catch(() => {});

      onSaved(null);
      onClose();
    } catch {
      Alert.alert('Error', 'Failed to remove logo');
    } finally {
      setUploading(false);
    }
  };

  const hasLogo = !!currentLogoKey;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background }]}>
          {/* Close button */}
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close logo picker"
          >
            <ThemedText style={styles.closeText}>✕</ThemedText>
          </TouchableOpacity>

          {/* Preview */}
          <View style={styles.previewArea}>
            {uploading ? (
              <View style={[styles.previewCircle, { backgroundColor: c.cardAlt }]}>
                <LogoSpinner />
              </View>
            ) : preview ? (
              <Image source={{ uri: preview }} style={styles.previewCircle} />
            ) : (
              <TeamLogo logoKey={currentLogoKey} teamName={teamName} size="large" />
            )}
            <ThemedText type="defaultSemiBold" style={styles.previewName}>
              {teamName}
            </ThemedText>
            {uploading && (
              <ThemedText style={[styles.uploadingText, { color: c.secondaryText }]}>
                Checking image...
              </ThemedText>
            )}
          </View>

          {/* Actions */}
          <View style={styles.buttonArea}>
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.accent }]}
              onPress={() => pickImage('gallery')}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Choose photo from gallery"
            >
              <Ionicons name="images-outline" size={20} color={c.statusText} />
              <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>Choose Photo</ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: c.cardAlt }]}
              onPress={() => pickImage('camera')}
              disabled={uploading}
              accessibilityRole="button"
              accessibilityLabel="Take a photo"
            >
              <Ionicons name="camera-outline" size={20} color={c.text} />
              <ThemedText style={[styles.actionBtnText, { color: c.text }]}>Take Photo</ThemedText>
            </TouchableOpacity>

            {hasLogo && (
              <TouchableOpacity
                style={[styles.removeBtn, { borderColor: c.border }]}
                onPress={handleRemove}
                disabled={uploading}
                accessibilityRole="button"
                accessibilityLabel="Remove current logo"
              >
                <ThemedText style={[styles.removeBtnText, { color: c.danger }]}>Remove Logo</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: s(40),
  },
  closeBtn: {
    position: 'absolute',
    top: s(12),
    right: s(12),
    zIndex: 1,
    padding: s(4),
  },
  closeText: {
    fontSize: ms(20),
    lineHeight: ms(24),
  },
  previewArea: {
    alignItems: 'center',
    paddingVertical: s(24),
    gap: s(8),
  },
  previewCircle: {
    width: s(80),
    height: s(80),
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: {
    fontSize: ms(18),
    marginTop: s(4),
  },
  uploadingText: {
    fontSize: ms(13),
  },
  buttonArea: {
    paddingHorizontal: s(16),
    gap: s(10),
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(8),
    paddingVertical: s(14),
    borderRadius: 10,
  },
  actionBtnText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
  removeBtn: {
    alignItems: 'center',
    paddingVertical: s(12),
    borderRadius: 10,
    borderWidth: 1,
  },
  removeBtnText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
});
