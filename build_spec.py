import base64, pathlib
OUT = pathlib.Path(r"C:\Users\Joe\AppData\Local\Temp\claude\c--Users-Joe-OneDrive-Desktop-franchise-v2\e91fac95-a0d4-47fe-8ecd-67b729878ef7\scratchpad\type-system.html")
A = pathlib.Path("assets/fonts")
RAW = pathlib.Path(r"C:\Users\Joe\Downloads\Font direction overhaul\fonts-for-engineer")

def b64(p): return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

faces = {
  "Desporm":     (A/"Desporm-Regular.ttf",     "truetype"),
  "StonerSport": (A/"StonerSport-Regular.ttf", "truetype"),
  "Bloomy":      (A/"Bloomy-Regular.ttf",      "truetype"),   # patched
  "BloomyRaw":   (RAW/"Bloomy-Regular.ttf",    "truetype"),   # as-shipped, for the proof
  "JustSans400": (A/"JUSTSans-Regular.ttf",    "truetype"),
  "JustSans500": (A/"JUSTSans-Medium.ttf",     "truetype"),
  "JustSans600": (A/"JUSTSans-SemiBold.ttf",   "truetype"),
  "JustSans700": (A/"JUSTSans-Bold.ttf",       "truetype"),
}
ff = "\n".join(
  f"@font-face{{font-family:'{n}';src:url(data:font/ttf;base64,{b64(p)}) format('{f}');font-display:block;}}"
  for n,(p,f) in faces.items()
)
pathlib.Path("_faces.css").write_text(ff, encoding="utf8")
print("faces css bytes:", len(ff))
