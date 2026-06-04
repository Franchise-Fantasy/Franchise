import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Branded social-share card shown when franchisefantasy.co is unfurled in
// messages, Slack, Discord, etc. Built from FLAT brand elements (solid-colour
// wordmark + tagline) so it stays crisp after the platform recompresses it —
// the embroidered patch is kept small/secondary because its photographic
// texture is what blurs under that recompression.
export const alt = "Franchise — Own the dynasty.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function dataUri(relPath: string) {
  const buf = await readFile(join(process.cwd(), relPath));
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export default async function OpengraphImage() {
  const [patchSrc, wordmarkSrc] = await Promise.all([
    dataUri("public/patch-f.png"),
    dataUri("public/wordmark-green.png"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#E9E2CB",
          position: "relative",
        }}
      >
        {/* Gold top rule — brand motif */}
        <div
          style={{
            position: "absolute",
            top: 60,
            left: "50%",
            transform: "translateX(-50%)",
            width: 96,
            height: 3,
            background: "#B57B30",
          }}
        />

        {/* Embroidered emblem — kept small so its texture isn't the focal point */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={patchSrc} width={192} height={180} alt="" />

        {/* Flat script wordmark — the crisp hero element (6796x1789 native) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={wordmarkSrc} width={760} height={200} alt="" style={{ marginTop: 28 }} />

        <div
          style={{
            marginTop: 20,
            fontSize: 34,
            fontWeight: 600,
            letterSpacing: 10,
            textTransform: "uppercase",
            color: "rgba(20, 16, 16, 0.62)",
          }}
        >
          Own the dynasty.
        </div>
      </div>
    ),
    { ...size },
  );
}
