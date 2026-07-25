// Name normalization so "A.J. Dybantsa" (site A) and "AJ Dybantsa" (site B)
// resolve to the same slug, which is also the join key with Contentful.
export function slugify(name) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cleanName(raw) {
  return raw.replace(/\s+/g, " ").trim();
}
