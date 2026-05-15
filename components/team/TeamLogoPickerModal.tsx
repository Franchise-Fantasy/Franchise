import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Alert,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

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
  const c = useColors();
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

      if (error) {
        // FunctionsHttpError stashes the Response on err.context — pull the real message out.
        const serverMessage = await extractServerError(error);
        Alert.alert('Upload Failed', serverMessage ?? error.message ?? 'Something went wrong');
        setPreview(null);
        return;
      }
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

  const extractServerError = async (err: any): Promise<string | null> => {
    try {
      const res: Response | undefined = err?.context;
      if (res && typeof res.json === 'function') {
        const body = await res.json();
        if (body?.error) return body.error;
      }
    } catch {
      // body wasn't JSON or already consumed — fall through
    }
    return null;
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
    <BottomSheet visible={visible} onClose={onClose} title="Team Logo">
      {/* Preview card — brand chrome (rounded 12, hairline, cardShadow) */}
      <View
        style={[
          styles.previewCard,
          { backgroundColor: c.card, borderColor: c.border },
        ]}
      >
        <View style={styles.previewArea}>
          {uploading ? (
            <View
              style={[
                styles.previewCircle,
                { backgroundColor: c.cardAlt, borderColor: c.gold },
              ]}
            >
              <LogoSpinner />
            </View>
          ) : preview ? (
            <View style={[styles.previewCircle, { borderColor: c.gold }]}>
              <Image
                source={{ uri: preview }}
                style={styles.previewImg}
                accessibilityIgnoresInvertColors
              />
            </View>
          ) : (
            <TeamLogo
              logoKey={currentLogoKey}
              teamName={teamName}
              size="large"
            />
          )}
          <ThemedText
            type="defaultSemiBold"
            style={[styles.previewName, { color: c.text }]}
            numberOfLines={1}
          >
            {teamName}
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.previewEyebrow, { color: c.secondaryText }]}
          >
            {uploading ? 'CHECKING IMAGE...' : 'CURRENT LOGO'}
          </ThemedText>
        </View>
      </View>

      {/* Actions — leagueInfoPill chrome (gold icon + varsity caps) */}
      <View style={styles.buttonArea}>
        <TouchableOpacity
          style={[
            styles.actionPill,
            {
              backgroundColor: c.cardAlt,
              borderColor: c.border,
              opacity: uploading ? 0.5 : 1,
            },
          ]}
          onPress={() => pickImage('gallery')}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Choose photo from gallery"
        >
          <Ionicons name="images-outline" size={ms(16)} color={c.gold} />
          <Text style={[styles.actionPillText, { color: c.text }]}>
            CHOOSE PHOTO
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionPill,
            {
              backgroundColor: c.cardAlt,
              borderColor: c.border,
              opacity: uploading ? 0.5 : 1,
            },
          ]}
          onPress={() => pickImage('camera')}
          disabled={uploading}
          accessibilityRole="button"
          accessibilityLabel="Take a photo"
        >
          <Ionicons name="camera-outline" size={ms(16)} color={c.gold} />
          <Text style={[styles.actionPillText, { color: c.text }]}>
            TAKE PHOTO
          </Text>
        </TouchableOpacity>

        {hasLogo && (
          <TouchableOpacity
            style={[
              styles.removePill,
              {
                backgroundColor: c.danger + '14',
                borderColor: c.danger,
                opacity: uploading ? 0.5 : 1,
              },
            ]}
            onPress={handleRemove}
            disabled={uploading}
            accessibilityRole="button"
            accessibilityLabel="Remove current logo"
          >
            <Ionicons name="trash-outline" size={ms(14)} color={c.danger} />
            <Text style={[styles.removePillText, { color: c.danger }]}>
              REMOVE LOGO
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // Preview card — brand chrome
  previewCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    ...cardShadow,
  },
  previewArea: {
    alignItems: 'center',
    paddingVertical: s(20),
    gap: s(8),
  },
  previewCircle: {
    width: s(80),
    height: s(80),
    borderRadius: s(40),
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewImg: {
    width: '100%',
    height: '100%',
  },
  previewName: {
    fontSize: ms(16),
    marginTop: s(4),
  },
  previewEyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },

  // Action buttons — leagueInfoPill chrome
  buttonArea: {
    paddingTop: s(14),
    gap: s(8),
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(8),
    paddingHorizontal: s(12),
    paddingVertical: s(11),
    borderRadius: 8,
    borderWidth: 1,
  },
  actionPillText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.0,
  },
  removePill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(6),
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderRadius: 8,
    borderWidth: 1,
    marginTop: s(4),
  },
  removePillText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
});
