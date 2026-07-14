"""Make a purchased numerals face usable as an app font. Run from the repo root.

    pip install fonttools brotli
    python scripts/fonts/normalize-numerals.py

Every numerals face we've bought has arrived with the same two faults, and both
are invisible until the app is on a device:

1. OPTICALLY SMALL. A font's `fontSize` is the em box, not the ink. Two faces at
   the same fontSize can differ wildly in how tall the digits actually draw.
   Every `Fonts.mono` size in the app was tuned against Space Mono, whose digits
   are TARGET_DIGIT_EM tall — so a face that draws shorter renders as unreadable
   stats with no error anywhere. (Bloomy, the first attempt, was 35% short.)
   Fixed by scaling the outlines until the digits match Space Mono.

2. NOT TABULAR. Retail display faces ship proportional digits and no `tnum`
   feature: a '1' is narrower than an '8'. Fantasy scores are full of 1s, so
   columns fray and a live score changes width as it ticks. Fixed by giving the
   digits a shared advance box, with each outline centered inside it.

Both passes are metrics-only — glyph shapes are never redrawn, only scaled
uniformly and repositioned — and both target ABSOLUTE values, so this is
idempotent. To take a new delivery from a designer: drop their file in at the
vendored path below and re-run. Handles TrueType (glyf) and OpenType (CFF).
"""
import string

from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

# Space Mono's digit height as a fraction of the em. The number every mono/score
# fontSize in the app is implicitly tuned against. Don't change it without
# re-tuning those call sites.
TARGET_DIGIT_EM = 0.728

# `keep` subsets the font to those characters. Only set it for a face with a
# genuinely closed character set — Dothed is 755KB of dot contours and is only
# ever asked to render a score, so keeping digits alone saves ~710KB. A face that
# gets asked for a glyph outside `keep` renders tofu, so leave it None otherwise.
FONTS = [
    {"path": "assets/fonts/Fascond-Regular.ttf", "keep": None},
    {"path": "assets/fonts/DothedPixel-Score.otf", "keep": "0123456789.,:-+ "},
]


def is_cff(font):
    return "CFF " in font


def digit_height_em(font, char="8"):
    glyphs = font.getGlyphSet()
    pen = BoundsPen(glyphs)
    glyphs[font.getBestCmap()[ord(char)]].draw(pen)
    if not pen.bounds:
        return 0.0
    return (pen.bounds[3] - pen.bounds[1]) / font["head"].unitsPerEm


def transform_glyphs(font, scale=1.0, shifts=None):
    """Scale every glyph by `scale`, then nudge named glyphs by shifts[name].

    Vertical metrics are deliberately left alone: the scaled outlines still fit
    inside the existing ascent/descent, so the line box doesn't grow and no fixed
    lineHeight in the app starts clipping.
    """
    shifts = shifts or {}
    glyphs, hmtx = font.getGlyphSet(), font["hmtx"]
    charstrings, outlines, metrics = {}, {}, {}

    for name in font.getGlyphOrder():
        dx = shifts.get(name, 0)
        advance, lsb = hmtx[name]
        transform = (scale, 0, 0, scale, dx, 0)
        if is_cff(font):
            pen = T2CharStringPen(round(advance * scale), glyphs)
            glyphs[name].draw(TransformPen(pen, transform))
            charstrings[name] = pen.getCharString()
        else:
            pen = TTGlyphPen(glyphs)
            glyphs[name].draw(TransformPen(pen, transform))
            outlines[name] = pen.glyph()
        metrics[name] = (round(advance * scale), round(lsb * scale + dx))

    if is_cff(font):
        top = font["CFF "].cff.topDictIndex[0]
        for name, charstring in charstrings.items():
            # A pen-built charstring carries no Private dict, and CFF compilation
            # reads nominalWidthX off it. Re-attach the font's before swapping in.
            charstring.private = top.Private
            top.CharStrings[name] = charstring
    else:
        for name, glyph in outlines.items():
            font["glyf"][name] = glyph

    for name, entry in metrics.items():
        hmtx[name] = entry


def normalize(path, keep=None):
    """Scale to TARGET_DIGIT_EM and square up the digits, in a single pass.

    One pass, not two: rewriting a CFF charstring detaches it from the Private
    dict, so drawing the rewritten glyphs a second time raises. The scale and the
    tabular centering shift therefore fold into one transform.
    """
    font = TTFont(path)

    current = digit_height_em(font)
    scale = TARGET_DIGIT_EM / current
    print(f"  digit height {current:.3f}em -> {TARGET_DIGIT_EM:.3f}em (scale x{scale:.4f})")

    cmap, hmtx = font.getBestCmap(), font["hmtx"]
    digits = [cmap[ord(d)] for d in string.digits]

    # Work out the shared advance box from the POST-scale widths, then center each
    # digit in it. Target the width most digits already use, so only the outliers
    # move and the face's natural rhythm survives.
    scaled = {name: round(hmtx[name][0] * scale) for name in digits}
    widths = list(scaled.values())
    box = max(set(widths), key=widths.count)
    shifts = {n: (box - scaled[n]) // 2 for n in digits if scaled[n] != box}

    transform_glyphs(font, scale=scale, shifts=shifts)
    for name in digits:
        font["hmtx"][name] = (box, font["hmtx"][name][1])

    if keep:
        options = subset.Options()
        options.desubroutinize = True
        options.name_IDs = ["*"]
        options.notdef_outline = True
        subsetter = subset.Subsetter(options)
        subsetter.populate(text=keep)
        subsetter.subset(font)

    font.save(path)
    font.close()


def verify(path):
    font = TTFont(path)
    cmap = font.getBestCmap()
    advances = {font["hmtx"][cmap[ord(d)]][0] for d in string.digits}
    tabular = "TABULAR" if len(advances) == 1 else "RAGGED"
    print(f"  VERIFY height {digit_height_em(font):.3f}em | advances {advances} -> {tabular}")
    font.close()


for entry in FONTS:
    print(entry["path"])
    normalize(entry["path"], entry["keep"])
    verify(entry["path"])
