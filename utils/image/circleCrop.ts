/**
 * Crop geometry for the circular photo cropper ([CircleCropModal](../../components/ui/CircleCropModal.tsx)).
 *
 * Pure so it can be unit-tested — an off-by-a-factor here silently crops the
 * wrong part of someone's photo, which is invisible until a user complains.
 * Screen-space (what the cropper draws) and source-space (what
 * `ImageManipulator` cuts) are related by a single factor: `coverScale × zoom`.
 */

export interface ImageSize {
  width: number;
  height: number;
}

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Smallest scale at which the image fully covers the crop circle. Used both to
 * size the on-screen image and as the base of the user's zoom (zoom 1 = cover).
 */
export function coverScale(source: ImageSize, circle: number): number {
  return Math.max(circle / source.width, circle / source.height);
}

/**
 * The square of source pixels sitting behind the crop circle, in whole pixels.
 *
 * @param source     Source image size, EXIF orientation already applied.
 * @param circle     Diameter of the on-screen circle, in screen px.
 * @param zoom       User zoom, where 1 is the cover fit.
 * @param translateX Pan offset in screen px (positive moves the image right).
 * @param translateY Pan offset in screen px (positive moves the image down).
 */
export function cropRectForCircle(
  source: ImageSize,
  circle: number,
  zoom: number,
  translateX: number,
  translateY: number,
): CropRect {
  const effective = coverScale(source, circle) * zoom; // screen px per source px
  const size = Math.min(circle / effective, source.width, source.height);
  const side = Math.max(1, Math.round(size));

  // The circle sits at the image's centre, displaced by the pan.
  const originX = source.width / 2 - translateX / effective - size / 2;
  const originY = source.height / 2 - translateY / effective - size / 2;

  return {
    width: side,
    height: side,
    originX: clamp(Math.round(originX), 0, Math.max(0, source.width - side)),
    originY: clamp(Math.round(originY), 0, Math.max(0, source.height - side)),
  };
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}
