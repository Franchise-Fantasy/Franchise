import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

/**
 * Web-only HTML shell. `ScrollViewStyleReset` provides the react-native-web root
 * reset (full-height html/body/#root, body overflow hidden). No effect on native.
 *
 * HEADS UP: this file only runs for STATIC rendering. The app's web output is
 * `"single"` (SPA — see app.json), where Expo serves its own default HTML shell
 * and never evaluates `+html.tsx`, so nothing here currently reaches the page.
 * Global CSS that must actually apply is injected at runtime instead — see
 * components/web/globalWebStyles.ts. Kept for the day web output goes `static`.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: `body { background-color: #1B3D2F; }` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
