/** Normalize a player name for fuzzy matching (strips accents, suffixes, punctuation). */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/\./g, '')
    .replace(/['-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
