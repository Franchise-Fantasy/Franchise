import { globalToastRef } from '@/context/ToastProvider';
import { supabase } from '@/lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useCallback, useState } from 'react';
import { useSendMessage } from './useMessages';

export function useSendImage(
  conversationId: string,
  teamId: string,
  teamName: string,
  leagueId: string,
) {
  const sendMessage = useSendMessage(conversationId, teamId, teamName, leagueId);
  const [isUploading, setIsUploading] = useState(false);

  const pickAndSend = useCallback(
    async (source: 'gallery' | 'camera') => {
      try {
        // Request permissions before launching
        const permFn =
          source === 'camera'
            ? ImagePicker.requestCameraPermissionsAsync
            : ImagePicker.requestMediaLibraryPermissionsAsync;
        const { status } = await permFn();
        if (status !== 'granted') {
          globalToastRef.current?.(
            'error',
            `Please allow ${source === 'camera' ? 'camera' : 'photo library'} access to send photos`,
          );
          return;
        }

        const pickerFn =
          source === 'camera'
            ? ImagePicker.launchCameraAsync
            : ImagePicker.launchImageLibraryAsync;

        const result = await pickerFn({
          mediaTypes: ['images'],
          allowsEditing: true,
          quality: 0.7,
        });

        if (result.canceled || !result.assets?.[0]?.uri) return;

        setIsUploading(true);

        // Resize + compress before upload to reduce payload and Cloud Vision cost
        const MAX_DIMENSION = 1200;
        const asset = result.assets[0];
        const needsResize =
          (asset.width && asset.width > MAX_DIMENSION) ||
          (asset.height && asset.height > MAX_DIMENSION);

        const compressed = await manipulateAsync(
          asset.uri,
          needsResize ? [{ resize: { width: MAX_DIMENSION } }] : [],
          { compress: 0.6, format: SaveFormat.JPEG, base64: true },
        );

        if (!compressed.base64) throw new Error('Failed to compress image');

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;
        if (!token) throw new Error('Not authenticated');

        const res = await fetch(
          `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/upload-chat-media`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              league_id: leagueId,
              team_id: teamId,
              image_base64: compressed.base64,
            }),
          },
        );

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({ error: 'Upload failed' }));
          throw new Error(errBody.error ?? `Upload failed (${res.status})`);
        }

        const { media_url } = await res.json();
        sendMessage.mutate({ content: media_url, type: 'image' });
      } catch (err: any) {
        console.error('Image send error:', err);
        globalToastRef.current?.(
          'error',
          err.message?.includes('flagged')
            ? 'Image was blocked by content moderation'
            : 'Failed to send image',
        );
      } finally {
        setIsUploading(false);
      }
    },
    [conversationId, teamId, teamName, leagueId, sendMessage],
  );

  return { pickAndSend, isUploading };
}
