"""Normalize the vendored Bloomy so it's usable as the app's numerals face.

Bloomy is the type system's stat/ticker font (`Fonts.mono`), but as delivered it
is unusable for stat readouts for two independent reasons:

1. OPTICALLY TINY. Bloomy is unicase — every glyph ('H', 'x', '8', 'A') is the
   same 0.473em tall — and it sits small inside its em box. Space Mono, the font
   it replaces, draws digits at 0.728em. So at an identical `fontSize` Bloomy
   renders 35% smaller, which made every score, standings column and stat cell
   unreadable. Its OS/2 table also lies about this (advertises cap 700 / x-height
   500 against real outlines of 473), so renderers can't compensate either.
   Fixed by scaling the outlines to TARGET_GLYPH_EM. The app's ~112 mono call
   sites were all sized against Space Mono's metrics, so matching it restores
   every one of them without touching a single fontSize.

2. NOT TABULAR. Bloomy ships no `tnum` feature and its '1' is 16% narrower than
   its other digits. Fantasy scores are full of 1s, so columns frayed and live
   scores changed width as they ticked. Fixed by giving every digit a shared
   advance box and centering the outline inside it.

Both passes are metrics-only: glyph SHAPES are never redrawn, only scaled
uniformly and repositioned. Scaling is safe here precisely because Bloomy is
unicase — there's no cap-height-to-x-height relationship to distort. (The other
three brand faces are also smaller than what they replaced, but they'd overflow
their win-metrics if scaled and would need vertical-metric surgery too, so they
are deliberately left alone.)

Both passes target ABSOLUTE values rather than applying a relative factor, so
this is idempotent — re-running on an already-patched file is a no-op, and it
can be re-run against a fresh delivery from the designer.

    pip install fonttools brotli
    python scripts/fonts/patch-bloomy.py
"""
import string

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

FONT = "assets/fonts/Bloomy-Regular.ttf"

# Space Mono's digit height, as a fraction of the em. This is the number every
# `Fonts.mono` fontSize in the app was implicitly tuned against.
TARGET_GLYPH_EM = 0.728


def glyph_height_em(font: TTFont, char: str) -> float:
    pen = BoundsPen(font.getGlyphSet())
    font.getGlyphSet()[font.getBestCmap()[ord(char)]].draw(pen)
    if not pen.bounds:
        return 0.0
    return (pen.bounds[3] - pen.bounds[1]) / font["head"].unitsPerEm


def scale_outlines(font: TTFont, k: float) -> None:
    """Scale every glyph + advance by k, leaving vertical metrics alone.

    Vertical metrics stay put on purpose: the scaled outlines still fit inside
    the existing ascent/descent (verified — max yMax lands at ~954 against a
    1000 winAscent), so the line box is unchanged and no fixed lineHeight in the
    app starts clipping.
    """
    glyf, hmtx = font["glyf"], font["hmtx"]
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours > 0:
            glyph.coordinates.scale((k, k))
            glyph.recalcBounds(glyf)
        elif glyph.isComposite():
            for comp in glyph.components:
                comp.x, comp.y = round(comp.x * k), round(comp.y * k)
        adv, lsb = hmtx[name]
        hmtx[name] = (round(adv * k), round(lsb * k))

    # The OS/2 cap/x-height fields were wrong on delivery; now that we know the
    # real (unicase) glyph height, state it truthfully.
    height = round(TARGET_GLYPH_EM * font["head"].unitsPerEm)
    font["OS/2"].sCapHeight = height
    font["OS/2"].sxHeight = height


def tabularize_digits(font: TTFont) -> None:
    """Give 0-9 a shared advance width, centering each outline inside it."""
    glyf, hmtx = font["glyf"], font["hmtx"]
    names = [font.getBestCmap()[ord(d)] for d in string.digits]

    # Target the width most digits already use, so only the outlier ('1') moves
    # and the face's natural rhythm survives.
    widths = [hmtx[n][0] for n in names]
    target = max(set(widths), key=widths.count)

    for name in names:
        adv, lsb = hmtx[name]
        if adv == target:
            continue
        dx = (target - adv) // 2
        glyph = glyf[name]
        if glyph.numberOfContours > 0:
            glyph.coordinates.translate((dx, 0))
            glyph.recalcBounds(glyf)
        elif glyph.isComposite():
            for comp in glyph.components:
                comp.x += dx
        hmtx[name] = (target, lsb + dx)


font = TTFont(FONT)
upm = font["head"].unitsPerEm

current = glyph_height_em(font, "8")
k = TARGET_GLYPH_EM / current
print(f"digit height {current:.3f}em -> target {TARGET_GLYPH_EM:.3f}em  (scale x{k:.4f})")
if abs(k - 1.0) > 0.001:
    scale_outlines(font, k)
else:
    print("  already at target size, skipping scale")

tabularize_digits(font)
font.save(FONT)

check = TTFont(FONT)
cm, hmtx = check.getBestCmap(), check["hmtx"]
advances = {hmtx[cm[ord(d)]][0] for d in string.digits}
print(f"VERIFY  height {glyph_height_em(check, '8'):.3f}em  |  digit advances {advances}"
      f"  -> {'TABULAR' if len(advances) == 1 else 'RAGGED'}")
