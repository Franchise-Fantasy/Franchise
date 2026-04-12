export default function Footer() {
  return (
    <footer className="border-t border-b px-6 py-8">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 text-xs text-t-muted sm:flex-row sm:justify-between">
        <p className="text-t-primary">
          Franchise<span className="text-vintage-gold">Fantasy</span>
        </p>
        <nav className="flex gap-5" aria-label="Footer">
          <a href="/privacy" className="transition-colors hover:text-t-primary">
            Privacy
          </a>
          <a href="/terms" className="transition-colors hover:text-t-primary">
            Terms
          </a>
        </nav>
        <p>&copy; {new Date().getFullYear()}</p>
      </div>
    </footer>
  );
}
