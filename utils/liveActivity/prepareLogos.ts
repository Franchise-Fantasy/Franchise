/**
 * Pre-stages the two team logos into the App Group container so the
 * Matchup Live Activity widget can render them via `Image uiImage={...}`.
 *
 * Widget `Image` cannot load remote URLs. The expo-widgets package exposes
 * `widgetsDirectory` (an absolute file:// URL into the App Group container's
 * ExpoWidgets/ subdir) — files written there are visible to both the main app
 * and the widget extension. We download each team's logoKey to
 * `${widgetsDirectory}logos/<teamId>.png` and return the full file URIs so the
 * caller can persist them on `activity_tokens.metadata` and the edge dispatch
 * sites can echo them on every contentState push.
 *
 * Fallback path: if anything fails (no widgetsDirectory, missing logoKey,
 * network error, file-write error) we just return undefined for that side
 * and the widget renders the existing styled tricode pill — no crash, no
 * blank space.
 */

import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { createLogger } from '@/utils/logger';

const logger = createLogger('liveActivity:prepareLogos');

let widgetsDirectoryUri: string | null | undefined;

function getWidgetsDirectoryUri(): string | null {
  if (widgetsDirectoryUri !== undefined) return widgetsDirectoryUri;
  if (Platform.OS !== 'ios') {
    widgetsDirectoryUri = null;
    return null;
  }
  try {
    // expo-widgets exposes the App Group container path lazily via a native
    // constant; resolve it once per process.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoWidgets = require('expo-widgets') as { widgetsDirectory?: string };
    widgetsDirectoryUri = expoWidgets.widgetsDirectory ?? null;
  } catch {
    widgetsDirectoryUri = null;
  }
  return widgetsDirectoryUri;
}

export type PreparedLogos = {
  myLogoFileUri?: string;
  opponentLogoFileUri?: string;
  patchFileUri?: string;
};

/**
 * Stages the Franchise patch (app brand mark) into the App Group container
 * so the Live Activity can render it via `Image uiImage={...}`. The asset is
 * bundled with the app — expo-asset gives us a local cache URI, which we
 * copy to a stable shared path the widget extension can read from.
 *
 * Idempotent: once the file exists in the container we don't recopy. The
 * patch is static, so a stale cached copy is fine.
 */
async function prepareAppPatchAsset(): Promise<string | undefined> {
  const baseUri = getWidgetsDirectoryUri();
  if (!baseUri) return undefined;
  try {
    const dest = new File(baseUri, 'patch.png');
    if (dest.exists && (dest.size ?? 0) > 500) return dest.uri;

    const asset = Asset.fromModule(require('@/assets/images/F_patch@3x.png'));
    await asset.downloadAsync();
    if (!asset.localUri) return undefined;

    if (dest.exists) dest.delete();
    new File(asset.localUri).copy(dest);
    return dest.uri;
  } catch (err) {
    logger.warn('Patch asset prep failed (non-fatal)', err);
    return undefined;
  }
}

export async function prepareLogosForLiveActivity(input: {
  myTeamId: string;
  opponentTeamId: string;
  myLogoUrl: string | null | undefined;
  opponentLogoUrl: string | null | undefined;
}): Promise<PreparedLogos> {
  const baseUri = getWidgetsDirectoryUri();
  if (!baseUri) return {};

  let logosDir: Directory;
  try {
    logosDir = new Directory(baseUri, 'logos');
    if (!logosDir.exists) logosDir.create({ intermediates: true });
  } catch (err) {
    logger.warn('Could not prepare logos directory', err);
    return {};
  }

  const downloadOne = async (
    teamId: string,
    url: string | null | undefined,
  ): Promise<string | undefined> => {
    if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) {
      logger.info(`No remote logoKey for team ${teamId}, falling back to tricode pill`);
      return undefined;
    }
    const dest = new File(logosDir, `${teamId}.png`);
    try {
      // Use fetch instead of File.downloadFileAsync — fetch lets us check
      // the HTTP status and Content-Type up front, while downloadFileAsync
      // silently writes whatever body comes back (HTML 4xx pages, etc.)
      // and leaves us holding a "file" iOS can't decode.
      const res = await fetch(url);
      if (!res.ok) {
        logger.warn(`Logo fetch HTTP ${res.status} for team ${teamId}: ${url}`);
        return undefined;
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) {
        logger.warn(
          `Logo content-type "${contentType}" for team ${teamId}: ${url}`,
        );
        return undefined;
      }
      const blob = await res.blob();
      if (blob.size < 500) {
        logger.warn(
          `Logo too small (${blob.size}B) for team ${teamId}: ${url}`,
        );
        return undefined;
      }

      if (dest.exists) dest.delete();
      const buf = new Uint8Array(await blob.arrayBuffer());
      dest.write(buf);
      logger.info(
        `Logo OK for team ${teamId} (${contentType}, ${blob.size}B) -> ${dest.uri}`,
      );
      return dest.uri;
    } catch (err) {
      logger.warn(`Logo download failed for team ${teamId}: ${url}`, err);
      return undefined;
    }
  };

  const [myLogoFileUri, opponentLogoFileUri, patchFileUri] = await Promise.all([
    downloadOne(input.myTeamId, input.myLogoUrl),
    downloadOne(input.opponentTeamId, input.opponentLogoUrl),
    prepareAppPatchAsset(),
  ]);

  return { myLogoFileUri, opponentLogoFileUri, patchFileUri };
}

/**
 * Best-effort cleanup of staged logo files when an activity ends. Failures
 * are non-fatal — files just linger in cache until the next start cycle
 * overwrites them.
 */
export function cleanupLiveActivityLogos(teamIds: string[]): void {
  const baseUri = getWidgetsDirectoryUri();
  if (!baseUri) return;
  try {
    const logosDir = new Directory(baseUri, 'logos');
    if (!logosDir.exists) return;
    for (const teamId of teamIds) {
      const f = new File(logosDir, `${teamId}.png`);
      if (f.exists) f.delete();
    }
  } catch (err) {
    logger.warn('Logo cleanup failed (non-fatal)', err);
  }
}

// Silence "Paths unused" lint — we re-export for callers that want the
// expo-file-system surface from one import path.
export { Paths };
