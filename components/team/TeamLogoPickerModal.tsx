import { ThemedText } from '@/components/ThemedText';
import { TeamLogo } from '@/components/team/TeamLogo';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

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
    uploadImage(asset.base64);
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
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>
              Team Logo
            </ThemedText>
            <TouchableOpacity
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close logo picker"
            >
              <ThemedText style={styles.closeText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {/* Preview */}
          <View style={styles.previewArea}>
            {uploading ? (
              <View style={[styles.previewCircle, { backgroundColor: c.cardAlt }]}>
                <ActivityIndicator size="large" />
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
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 18,
  },
  closeText: {
    fontSize: 20,
    lineHeight: 24,
    paddingHorizontal: 4,
  },
  previewArea: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  previewCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: {
    fontSize: 18,
    marginTop: 4,
  },
  uploadingText: {
    fontSize: 13,
  },
  buttonArea: {
    paddingHorizontal: 16,
    gap: 10,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
  },
  actionBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  removeBtn: {
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  removeBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
