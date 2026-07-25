// Renders a schema.org JSON-LD block. Server component — the Next.js-recommended
// way to emit structured data is a native <script type="application/ld+json">
// (NOT next/script). The `<` → < escape prevents the JSON string from
// breaking out of the script tag.
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
