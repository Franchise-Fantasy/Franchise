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

// Sources disagree on generational suffixes — NBADraft.net prints "Darius
// Acuff" where RotoBaller prints "Darius Acuff Jr." Those produce different
// slugs, which used to split one player into two board entries, each penalized
// for being "missing" from the other source. Matching on the suffix-stripped
// slug keeps them as one person.
//
// Only ever used as a MERGE key inside a single draft class; the player's
// stored slug and display name still keep whichever form the sources use.
// (Two same-named relatives in one draft class would collide, but that pair
// doesn't exist in any current board — and a same-class father/son is not a
// real scenario.)
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function canonicalSlug(slug) {
  const parts = slug.split("-");
  while (parts.length > 2 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join("-");
}
