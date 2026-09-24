import { describe, expect, it } from 'vitest';
import { rankByRelevance } from './relevance';

const text = (p: { text: string }) => p.text;

describe('relevance ranking (T-018)', () => {
  const pool = [
    { id: 'a', text: 'Process serving across the region' },
    { id: 'b', text: 'Corporate due diligence and fraudulent accounting' },
    { id: 'c', text: 'Insurance claims' },
  ];

  it('puts the best fit first and keeps the rest in the order they came', () => {
    const ranked = rankByRelevance(pool, 'fraud investigations, due diligence', text);
    expect(ranked.items.map((p) => p.id)).toEqual(['b', 'a', 'c']);
    expect(ranked.reordered).toBe(true);
  });

  it('returns exactly the list it was given — it reorders, it never adds or drops', () => {
    const ranked = rankByRelevance(pool, 'anything at all about claims', text);
    expect([...ranked.items].sort((x, y) => x.id.localeCompare(y.id))).toEqual(pool);
    expect(rankByRelevance([], 'fraud', text)).toEqual({ items: [], reordered: false });
  });

  it('says so when the hint changes nothing', () => {
    expect(rankByRelevance(pool, 'zz', text)).toEqual({ items: pool, reordered: false });
    // The first item already fits best: the order stands.
    expect(rankByRelevance(pool, 'process serving', text).reordered).toBe(false);
  });

  it('compares across case, form and script', () => {
    const cyrillic = [
      { id: 'x', text: 'Semeinye dela' },
      { id: 'y', text: 'Проверка КОНТРАГЕНТОВ' },
    ];
    expect(rankByRelevance(cyrillic, 'контрагент', text).items[0]!.id).toBe('y');
  });
});
