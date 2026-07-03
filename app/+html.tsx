import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

/**
 * Web-only HTML shell for the static/single export. `ScrollViewStyleReset`
 * provides the react-native-web root reset (full-height html/body/#root,
 * body overflow hidden) — keep it so the app fills the viewport. The extra
 * style sets the page (gutter) background to the brand turf green so the
 * centered app column in AppFrame reads as an intentional frame on wide
 * desktops instead of a white band. This file has no effect on native.
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
