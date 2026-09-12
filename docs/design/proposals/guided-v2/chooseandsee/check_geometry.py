"""The marks well must hold the widest mark. This is what overlapped in the Direction C draft.

Widths come from the asset files themselves, not from numbers typed into a board, so a swapped
logo fails this rather than silently overlapping a label again.
"""
import re, struct, sys
import build

svg = open("logo-gnw-badge.svg").read()
w = float(re.search(r'\swidth="([0-9.]+)', svg).group(1))
h = float(re.search(r'\sheight="([0-9.]+)', svg).group(1))
GNW = 24 * (w / h)                                   # drawn at height 24px
png = open("logo-rgo.png", "rb").read()
iw, ih = struct.unpack(">II", png[16:24])
RGO = 11 * (iw / ih)                                 # drawn at height 11px
PLUS, GAP = 11.0, 8.0

widest = GNW + GAP + PLUS + GAP + RGO                # the Dual Boot mark
fails = []
if build.WELL < widest:
    fails.append(
        f"the marks well is {build.WELL}px and the widest mark is {widest:.2f}px, so it "
        f"overflows by {widest - build.WELL:.2f}px into the label beside it"
    )
# the label must still have room: card - borders - padding - well - gap
label = build.CARD - 4 - 36 - build.WELL - 16
if label < 170:
    fails.append(f"the label well is {label}px; 'Retro-Go uniquement' (fr) needs about 170px")

print(f"gnw {GNW:.2f}  plus {PLUS:.2f}  rgo {RGO:.2f}  widest mark {widest:.2f}  "
      f"well {build.WELL}  label {label}")
for f in fails:
    print("FAIL", f)
print("geometry:", "1 FAILED" if fails else "2 checks passed")
sys.exit(1 if fails else 0)
