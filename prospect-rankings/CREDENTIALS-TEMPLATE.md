# Credentials Handoff Sheet

Four values are needed to run the weekly job. Noah supplies the two Contentful
ones; the Supabase ones come from the project dashboard.

> **Send this filled-in sheet through a password manager share or another
> secure channel — not plain email, Slack, or text.** All four values allow
> writes to production data.
>
> **Do not commit a filled-in copy.** Save your working copy as
> `CREDENTIALS-FILLED.md` (already gitignored) or paste the values straight
> into GitHub Secrets and keep nothing on disk.

---

## 1. CONTENTFUL_MANAGEMENT_TOKEN

Fill in: `_________________________________________________`

- Provided by: **Noah**
- Current token is named `rankings-pipeline`, expires **25 Jul 2031**
- Where it comes from: Contentful → gear icon (top right) → API keys →
  **Content management tokens** tab → *Create personal access token*
- **After generating, click "Authorize" on the token row for the Franchise
  Fantasy organization** — the org requires this, and skipping it produces a
  confusing `401 Access token invalid` error
- Shown only once at creation. If lost, revoke and generate a new one.

## 2. CONTENTFUL_SPACE_ID

Fill in: `652mhs62v69t`

- Not secret, but required
- Where it comes from: Contentful → Settings → General settings

## 3. SUPABASE_URL

Fill in: `_________________________________________________`

- Where it comes from: Supabase dashboard → project → Settings → API →
  **Project URL**

## 4. SUPABASE_SERVICE_ROLE_KEY

Fill in: `_________________________________________________`

- Where it comes from: Supabase dashboard → project → Settings → API → the key
  labeled **`service_role`**
- **Not** the `anon` key. The job needs write access; the app uses `anon`.
- Treat like a database password — it bypasses row-level security.

---

## Where these go

GitHub repo → Settings → Secrets and variables → **Actions** → *New repository
secret*, one per value, named exactly as above.

Non-secret settings (content type id, environment, locale) are already hardcoded
in `.github/workflows/weekly-scrape.yml` and need no changes.

Full setup steps: **HANDOFF.md**
