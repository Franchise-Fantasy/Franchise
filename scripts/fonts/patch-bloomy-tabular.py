"""Give Bloomy tabular (uniform-width) digits.

Metrics-only: each digit keeps its exact outline but is re-centered inside a
shared advance box, so numerals line up in columns and ticking scores don't
reflow. Required because Bloomy ships no `tnum` feature and its '1' is 16%
narrower than every other digit.
"""
import string
from fontTools.ttLib import TTFont

# Run from repo root, against the vendored font:
#   pip install fonttools brotli
#   python scripts/fonts/patch-bloomy-tabular.py
# Idempotent: re-running on an already-patched file is a no-op.
SRC = DST = "assets/fonts/Bloomy-Regular.ttf"

f = TTFont(SRC)
glyf, hmtx = f["glyf"], f["hmtx"]
best = f.getBestCmap()
digits = [best[ord(d)] for d in string.digits]

# Target = the width the majority of digits already use, so only the outlier
# ('1') moves and the face's natural rhythm is preserved.
widths = [hmtx[g][0] for g in digits]
target = max(set(widths), key=widths.count)
print(f"unitsPerEm={f['head'].unitsPerEm}  target advance={target}")

for d, g in zip(string.digits, digits):
    adv, lsb = hmtx[g]
    if adv == target:
        continue
    dx = (target - adv) // 2          # center the glyph in the new box
    glyph = glyf[g]
    if glyph.numberOfContours == 0:
        pass
    elif glyph.isComposite():
        for c in glyph.components:
            c.x += dx
    else:
        glyph.coordinates.translate((dx, 0))
        glyph.recalcBounds(glyf)
    hmtx[g] = (target, lsb + dx)
    print(f"  '{d}': advance {adv} -> {target}  (shifted {dx:+d})")

f.save(DST)

# verify
v = TTFont(DST); vb, vh = v.getBestCmap(), v["hmtx"]
w = {vh[vb[ord(d)]][0] for d in string.digits}
print(f"\nVERIFY digit advances now: {w}  -> {'TABULAR OK' if len(w)==1 else 'STILL RAGGED'}")
