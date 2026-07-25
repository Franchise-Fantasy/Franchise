import Footer from "./Footer";
import Header from "./Header";
import JsonLd from "./JsonLd";
import { breadcrumbSchema } from "@/lib/structuredData";

type Crumb = { name: string; path: string };

type ContentPageProps = {
  title: string;
  intro?: string;
  // Full breadcrumb trail including Home and the current page. Rendered as a
  // visible nav and emitted as BreadcrumbList JSON-LD.
  breadcrumb: Crumb[];
  children: React.ReactNode;
};

// Shared chrome for the long-form content pages (FAQ, glossary, explainers):
// fixed Header + top offset, a single <h1>, a visible breadcrumb, and the
// Footer — matching the marketing site's type system.
export default function ContentPage({
  title,
  intro,
  breadcrumb,
  children,
}: ContentPageProps) {
  const current = breadcrumb[breadcrumb.length - 1];
  const trail = breadcrumb.slice(0, -1);

  return (
    <>
      <JsonLd data={breadcrumbSchema(breadcrumb)} />
      <Header />
      <main className="px-6 pt-28 pb-20 sm:pt-32">
        <div className="mx-auto max-w-3xl">
          <nav
            aria-label="Breadcrumb"
            className="mono-stat mb-8 flex flex-wrap items-center gap-2 text-[11px] text-t-faint"
          >
            {trail.map((crumb) => (
              <span key={crumb.path} className="flex items-center gap-2">
                <a
                  href={crumb.path}
                  className="transition-colors hover:text-[var(--heading)]"
                >
                  {crumb.name}
                </a>
                <span aria-hidden="true">/</span>
              </span>
            ))}
            <span aria-current="page" className="text-t-muted">
              {current.name}
            </span>
          </nav>

          <h1 className="display mb-6 text-4xl leading-[0.98] text-[var(--heading)] sm:text-5xl">
            {title}
          </h1>

          {intro && (
            <p className="mb-12 max-w-2xl text-[15px] leading-relaxed text-t-secondary sm:text-base">
              {intro}
            </p>
          )}

          {children}
        </div>
      </main>
      <Footer />
    </>
  );
}
