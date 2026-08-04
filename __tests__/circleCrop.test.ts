import { coverScale, cropRectForCircle } from '../utils/image/circleCrop';

describe('coverScale', () => {
  it('scales by the short edge so the circle is always filled', () => {
    // Landscape: height is the constraint.
    expect(coverScale({ width: 400, height: 200 }, 100)).toBe(0.5);
    // Portrait: width is the constraint.
    expect(coverScale({ width: 200, height: 400 }, 100)).toBe(0.5);
  });

  it('scales small images up to cover', () => {
    expect(coverScale({ width: 50, height: 50 }, 200)).toBe(4);
  });
});

describe('cropRectForCircle', () => {
  it('takes the centred square of a landscape image at rest', () => {
    const rect = cropRectForCircle({ width: 400, height: 200 }, 100, 1, 0, 0);
    expect(rect).toEqual({ originX: 100, originY: 0, width: 200, height: 200 });
  });

  it('takes the centred square of a portrait image at rest', () => {
    const rect = cropRectForCircle({ width: 200, height: 400 }, 100, 1, 0, 0);
    expect(rect).toEqual({ originX: 0, originY: 100, width: 200, height: 200 });
  });

  it('takes the whole square image at rest', () => {
    const rect = cropRectForCircle({ width: 300, height: 300 }, 100, 1, 0, 0);
    expect(rect).toEqual({ originX: 0, originY: 0, width: 300, height: 300 });
  });

  it('halves the crop when zoomed 2x', () => {
    const rect = cropRectForCircle({ width: 300, height: 300 }, 100, 2, 0, 0);
    expect(rect).toEqual({ originX: 75, originY: 75, width: 150, height: 150 });
  });

  it('converts pan from screen px to source px', () => {
    // coverScale = 100/400 = 0.25 at zoom 2 => 0.5 screen px per source px.
    // Dragging the image 25px right moves the crop window 50 source px LEFT.
    const rect = cropRectForCircle({ width: 400, height: 400 }, 100, 2, 25, 0);
    expect(rect.originX).toBe(50); // centred would be 100
    expect(rect.originY).toBe(100);
  });

  it('never runs off the image, even with an out-of-range pan', () => {
    const source = { width: 400, height: 400 };
    const far = cropRectForCircle(source, 100, 2, 1000, -1000);
    expect(far.originX).toBe(0);
    expect(far.originY).toBe(200); // 400 - 200
  });

  it('keeps the crop inside the source after rounding', () => {
    // Odd dimensions + a zoom that lands on a fraction.
    const source = { width: 401, height: 267 };
    const rect = cropRectForCircle(source, 137, 1.37, 13.5, -7.25);
    expect(rect.originX).toBeGreaterThanOrEqual(0);
    expect(rect.originY).toBeGreaterThanOrEqual(0);
    expect(rect.originX + rect.width).toBeLessThanOrEqual(source.width);
    expect(rect.originY + rect.height).toBeLessThanOrEqual(source.height);
  });
});
