/**
 * Free-text fit, as an ordering (T-018, `investigator-discovery`).
 *
 * The one legitimate use of prose in discovery: among investigators who already passed every
 * filter and every eligibility rule, put the ones whose own description fits the request first.
 * It takes a list and returns the same list in another order — it has no way to add anyone,
 * which is how "a highly relevant profile description" is kept from surfacing an ineligible one.
 *
 * Lexical, not semantic: profiles have no embeddings, and a word match is explainable. The score
 * is how many of the hint's words the text contains, compared on their first five letters so
 * "investigations" meets "investigator" and "fraud" meets "fraudulent".
 */
export function rankByRelevance<T>(
  items: readonly T[],
  hint: string,
  text: (item: T) => string,
): { items: T[]; reordered: boolean } {
  const wanted = stems(hint);
  const scored = items.map((item, index) => {
    const have = stems(text(item));
    return { item, index, score: [...wanted].filter((w) => have.has(w)).length };
  });
  // Ties keep the order the search gave them: distance or experience still decides among equals.
  const sorted = [...scored].sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    items: sorted.map((s) => s.item),
    reordered: sorted.some((s, i) => s.index !== i),
  };
}

/** Words of three letters or more, cut to five — enough to meet a word's other forms. */
function stems(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKC')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3)
      .map((w) => w.slice(0, 5)),
  );
}
