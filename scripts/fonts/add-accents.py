"""Synthesize the Latin Extended-A glyphs Desporm ships without. Run from repo root.

    pip install fonttools brotli
    python scripts/fonts/add-accents.py

Desporm (the `display` face — player names on the detail sheet, headlines, hero
moments) covers Latin-1 but none of Latin Extended-A, so every Dončić / Jokić /
Porziņģis / Šarić renders its accented letters in the OS fallback font
mid-word (or as tofu). The vendor's accent artwork is already in the file,
baked into the Latin-1 glyphs (Aacute, Acircumflex, Adieresis, …), so every
missing glyph can be assembled from parts the designer drew:

  acute    Ć ć Ń ń          lifted from Aacute
  caron    Č č Š š Ž ž      the circumflex, flipped upside down
  breve    Ğ ğ              same flipped circumflex (angular cup, fits the face)
  macron   Ā ā Ē ē Ī ī Ū ū  the hyphen bar, thinned and raised
  comma    Ģ ģ Ķ ķ Ļ ļ Ņ ņ  the comma, scaled and hung under the baseline
  cedilla  Ş ş              comma below (the Romanian-style compromise)
  dot      İ ı              one Adieresis dot over I; ı is a straight copy of i
  stroke   Đ đ Ł ł          the hyphen bar through the stem (slanted for Ł ł)

Desporm is unicase — a/A, i/I, etc. are the same cap-height outline, and i has
no dot — so one accent band serves both cases, ģ takes the capital-form comma
below, and ī/ū never collide with a dot. Everything is a scaled / flipped /
translated copy of an existing outline, nothing is drawn from scratch, so the
additions inherit the face's weight and finish. Idempotent: targets are rebuilt
from the untouched Latin-1 sources every run. New vendor delivery: drop it in
at the path above and re-run.
"""
import math

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

PATH = "assets/fonts/Desporm-Regular.ttf"

font = TTFont(PATH)
cmap = font.getBestCmap()
glyphset = font.getGlyphSet()
glyf = font["glyf"]
hmtx = font["hmtx"]


def contours(name):
    """A glyph's outline as a list of contours, each a list of pen ops."""
    pen = RecordingPen()
    glyphset[name].draw(pen)
    out, cur = [], []
    for op, args in pen.value:
        cur.append((op, args))
        if op in ("closePath", "endPath"):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def outline(char):
    """contours() for a character rather than a glyph name."""
    return contours(cmap[ord(char)])


def bounds(contour_list):
    pen = BoundsPen(glyphset)
    for contour in contour_list:
        for op, args in contour:
            getattr(pen, op)(*args)
    return pen.bounds  # (xmin, ymin, xmax, ymax)


def center_x(b):
    return (b[0] + b[2]) / 2


def accent_of(composed, base):
    """The contours of glyph `composed` that float above the top of the char
    `base` (i.e. the accent, in the vendor's own size and vertical position)."""
    base_top = bounds(outline(base))[3]
    acc = [c for c in contours(composed) if bounds([c])[1] > base_top * 0.9]
    assert acc, f"no accent found in {composed}"
    return acc


# Affine tuples for TransformPen: x' = xx*x + yx*y + dx, y' = xy*x + yy*y + dy.
def translate(dx, dy=0.0):
    return (1, 0, 0, 1, dx, dy)


def scale_about(b, sx, sy, dx=0.0, dy=0.0):
    """Scale about the bbox center (negative s flips in place), then shift."""
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    return (sx, 0, 0, sy, cx - sx * cx + dx, cy - sy * cy + dy)


def rotate_about(b, degrees):
    cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    cos, sin = math.cos(math.radians(degrees)), math.sin(math.radians(degrees))
    return (cos, sin, -sin, cos,
            cx - (cos * cx - sin * cy),
            cy - (sin * cx + cos * cy))


def compose(outer, inner):
    """outer ∘ inner as affine tuples (inner applies to the point first)."""
    ixx, ixy, iyx, iyy, idx, idy = inner
    oxx, oxy, oyx, oyy, odx, ody = outer
    return (
        ixx * oxx + ixy * oyx, ixx * oxy + ixy * oyy,
        iyx * oxx + iyy * oyx, iyx * oxy + iyy * oyy,
        idx * oxx + idy * oyx + odx, idx * oxy + idy * oyy + ody,
    )


def apply(contour_list, xform):
    return [(c, xform) for c in contour_list]


def base_pieces(base):
    return apply(outline(base), translate(0))


def build(new_name, pieces, advance_like):
    """Bake `pieces` — (contour, affine) pairs — into a new simple glyph."""
    pen = TTGlyphPen(glyphset)
    for contour, xform in pieces:
        tpen = TransformPen(pen, xform)
        for op, args in contour:
            getattr(tpen, op)(*args)
    glyph = pen.glyph()
    if new_name not in glyf.keys():
        font.setGlyphOrder(font.getGlyphOrder() + [new_name])
    glyf[new_name] = glyph
    glyph.recalcBounds(glyf)
    advance, _ = hmtx[cmap[ord(advance_like)]]
    hmtx[new_name] = (advance, glyph.xMin if glyph.numberOfContours else 0)


# ---------------------------------------------------------------------------
# Accent parts, in the vendor's own size and vertical position.
ACUTE = accent_of("Aacute", "A")
CIRC = accent_of("Acircumflex", "A")
DOTS = accent_of("Adieresis", "A")
COMMA = contours(cmap[ord(",")])
HYPHEN = contours(cmap[ord("-")])
PERIOD = contours(cmap[ord(".")])


def above(base, accent, flip=False):
    """Center an accent (already at accent height) over the base letter."""
    ab = bounds(accent)
    dx = center_x(bounds(outline(base))) - center_x(ab)
    xform = scale_about(ab, 1, -1, dx=dx) if flip else translate(dx)
    return base_pieces(base) + apply(accent, xform)


def macron(base):
    """A flat bar over the letter: the hyphen, thinned, raised into the accent
    band, and widened to the dieresis' footprint."""
    hb, db, ab = bounds(HYPHEN), bounds(DOTS), bounds(ACUTE)
    sx = (db[2] - db[0]) / (hb[2] - hb[0])
    dy = (ab[1] + ab[3]) / 2 - (hb[1] + hb[3]) / 2
    dx = center_x(bounds(outline(base))) - center_x(hb)
    return base_pieces(base) + apply(HYPHEN, scale_about(hb, sx, 0.6, dx=dx, dy=dy))


def comma_below(base, gap=30, scale=0.85):
    """The comma, scaled and hung just under the baseline, centered on base."""
    cb = bounds(COMMA)
    cy = (cb[1] + cb[3]) / 2
    scaled_top = cy + scale * (cb[3] - cy)
    dx = center_x(bounds(outline(base))) - center_x(cb)
    return base_pieces(base) + apply(
        COMMA, scale_about(cb, scale, scale, dx=dx, dy=-gap - scaled_top))


def raised_period():
    """U+00B7 middle dot — Desporm lacks it, and any 'X · Y' display string
    rendered tofu. The period, lifted to the vertical center of the caps."""
    pb = bounds(PERIOD)
    cap_top = bounds(outline("I"))[3]
    return apply(PERIOD, translate(0, cap_top / 2 - (pb[1] + pb[3]) / 2))


def stroke(base, x_frac, y_frac, width_frac, degrees=0.0, thin=0.75):
    """The hyphen bar laid through the letter — Đ đ Ł ł. Positions are
    fractions of the base glyph's bbox; degrees slants the bar for Ł ł."""
    bb, hb = bounds(outline(base)), bounds(HYPHEN)
    sx = width_frac * (bb[2] - bb[0]) / (hb[2] - hb[0])
    dx = bb[0] + x_frac * (bb[2] - bb[0]) - center_x(hb)
    dy = bb[1] + y_frac * (bb[3] - bb[1]) - (hb[1] + hb[3]) / 2
    bar = scale_about(hb, sx, thin, dx=dx, dy=dy)
    if degrees:
        placed = (hb[0] + dx, hb[1] + dy, hb[2] + dx, hb[3] + dy)
        bar = compose(rotate_about(placed, degrees), bar)
    return base_pieces(base) + apply(HYPHEN, bar)


# ---------------------------------------------------------------------------
# (codepoint, AGL glyph name, recipe, advance source)
TARGETS = [
    # acute
    (0x0106, "Cacute", above("C", ACUTE), "C"),
    (0x0107, "cacute", above("c", ACUTE), "c"),
    (0x0143, "Nacute", above("N", ACUTE), "N"),
    (0x0144, "nacute", above("n", ACUTE), "n"),
    # caron (flipped circumflex)
    (0x010C, "Ccaron", above("C", CIRC, flip=True), "C"),
    (0x010D, "ccaron", above("c", CIRC, flip=True), "c"),
    (0x0160, "Scaron", above("S", CIRC, flip=True), "S"),
    (0x0161, "scaron", above("s", CIRC, flip=True), "s"),
    (0x017D, "Zcaron", above("Z", CIRC, flip=True), "Z"),
    (0x017E, "zcaron", above("z", CIRC, flip=True), "z"),
    # breve rendered as the same flipped circumflex
    (0x011E, "Gbreve", above("G", CIRC, flip=True), "G"),
    (0x011F, "gbreve", above("g", CIRC, flip=True), "g"),
    # macron
    (0x0100, "Amacron", macron("A"), "A"),
    (0x0101, "amacron", macron("a"), "a"),
    (0x0112, "Emacron", macron("E"), "E"),
    (0x0113, "emacron", macron("e"), "e"),
    (0x012A, "Imacron", macron("I"), "I"),
    (0x012B, "imacron", macron("i"), "i"),
    (0x016A, "Umacron", macron("U"), "U"),
    (0x016B, "umacron", macron("u"), "u"),
    # comma below (and the Romanian-style comma standing in for Ş ş cedilla)
    (0x0122, "Gcommaaccent", comma_below("G"), "G"),
    (0x0123, "gcommaaccent", comma_below("g"), "g"),
    (0x0136, "Kcommaaccent", comma_below("K"), "K"),
    (0x0137, "kcommaaccent", comma_below("k"), "k"),
    (0x013B, "Lcommaaccent", comma_below("L"), "L"),
    (0x013C, "lcommaaccent", comma_below("l"), "l"),
    (0x0145, "Ncommaaccent", comma_below("N"), "N"),
    (0x0146, "ncommaaccent", comma_below("n"), "n"),
    (0x015E, "Scedilla", comma_below("S"), "S"),
    (0x015F, "scedilla", comma_below("s"), "s"),
    # Turkish dotted/dotless i — İ borrows one Adieresis dot; i is already dotless
    (0x0130, "Idotaccent", above("I", DOTS[:1]), "I"),
    (0x0131, "dotlessi", base_pieces("i"), "i"),
    # stroke
    (0x0110, "Dcroat", stroke("D", x_frac=0.2, y_frac=0.5, width_frac=0.6, thin=0.95), "D"),
    (0x0111, "dcroat", stroke("d", x_frac=0.2, y_frac=0.5, width_frac=0.6, thin=0.95), "d"),
    (0x0141, "Lslash", stroke("L", x_frac=0.24, y_frac=0.45, width_frac=0.5, degrees=28, thin=0.9), "L"),
    (0x0142, "lslash", stroke("l", x_frac=0.24, y_frac=0.45, width_frac=0.5, degrees=28, thin=0.9), "l"),
    # not Latin Extended-A, but free to fix while we're in here
    (0x00B7, "periodcentered", raised_period(), "."),
]

for codepoint, name, pieces, advance_like in TARGETS:
    build(name, pieces, advance_like)
    for table in font["cmap"].tables:
        if table.isUnicode():
            table.cmap[codepoint] = name

# Extend the class-based kern lookup so each new glyph spaces exactly like its
# base letter ("DONČIĆ" kerns as "DONCIC"). A glyph missing from the class defs
# falls into class 0, which kerns differently. New glyphs sit at the end of the
# glyph order, so appending to Coverage keeps it sorted by glyph ID.
for lookup in font["GPOS"].table.LookupList.Lookup:
    if lookup.LookupType != 2:  # pair positioning
        continue
    for subtable in lookup.SubTable:
        if subtable.Format != 2:  # class-based pairs
            continue
        for _, name, _, base_char in TARGETS:
            base = cmap[ord(base_char)]
            if base in subtable.Coverage.glyphs and name not in subtable.Coverage.glyphs:
                subtable.Coverage.glyphs.append(name)
            for classdef in (subtable.ClassDef1.classDefs, subtable.ClassDef2.classDefs):
                if base in classdef:
                    classdef[name] = classdef[base]

font.save(PATH)
font.close()

# Verify: every target must resolve to its own glyph in the saved file.
check = TTFont(PATH)
saved = check.getBestCmap()
missing = [f"U+{cp:04X}" for cp, name, _, _ in TARGETS if saved.get(cp) != name]
print(f"{PATH}: +{len(TARGETS)} glyphs, {len(saved)} chars mapped")
print("VERIFY " + ("OK" if not missing else f"MISSING {missing}"))
check.close()
