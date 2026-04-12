type LegalPageProps = {
  title: string;
  body: string;
};

export default function LegalPage({ title, body }: LegalPageProps) {
  return (
    <main className="min-h-screen">
      <header className="border-b px-6 py-4">
        <nav
          className="mx-auto flex max-w-3xl items-center justify-between"
          aria-label="Main navigation"
        >
          <a
            href="/"
            className="text-base font-bold tracking-tight text-t-primary"
          >
            Franchise<span className="text-vintage-gold">Fantasy</span>
          </a>
          <div className="flex gap-5 text-xs text-t-muted">
            <a href="/privacy" className="transition-colors hover:text-t-primary">
              Privacy
            </a>
            <a href="/terms" className="transition-colors hover:text-t-primary">
              Terms
            </a>
          </div>
        </nav>
      </header>
      <section className="mx-auto max-w-3xl px-6 pt-12 pb-16">
        <h1 className="mb-6 text-3xl font-bold tracking-tight text-t-primary sm:text-4xl">
          {title}
        </h1>
        <article
          className="whitespace-pre-wrap text-sm leading-relaxed text-t-muted sm:text-base"
          aria-label={title}
        >
          {body}
        </article>
      </section>
    </main>
  );
}
