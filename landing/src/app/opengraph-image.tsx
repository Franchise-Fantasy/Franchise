import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Branded social-share card shown when franchisefantasy.co is unfurled in
// messages, Slack, Discord, etc. Mirrors the landing-page brand: ecru field,
// full-colour F patch, wordmark, and tagline.
export const alt = "Franchise — Own the dynasty.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const patch = await readFile(join(process.cwd(), "public/patch-f.png"));
  const patchSrc = `data:image/png;base64,${patch.toString("base64")}`;

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
            top: 64,
            left: "50%",
            transform: "translateX(-50%)",
            width: 96,
            height: 3,
            background: "#B57B30",
          }}
        />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={patchSrc} width={300} height={281} alt="" />

        <div
          style={{
            marginTop: 36,
            fontSize: 92,
            fontWeight: 800,
            letterSpacing: -2,
            color: "#1C552E",
          }}
        >
          Franchise
        </div>

        <div
          style={{
            marginTop: 8,
            fontSize: 34,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "rgba(20, 16, 16, 0.6)",
          }}
        >
          Own the dynasty.
        </div>
      </div>
    ),
    { ...size },
  );
}
