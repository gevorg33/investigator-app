import { describe, expect, it } from 'vitest';
import { discoveryPrompt, parseProposal } from './discovery-proposal';

const NODES = [
  { id: 'id-corporate', slug: 'corporate', parentId: null, label: 'Corporate', description: null },
  {
    id: 'id-dd',
    slug: 'corporate/due-diligence',
    parentId: 'id-corporate',
    label: 'Due diligence',
    description: 'Checks <before> a deal',
  },
  { id: 'id-unlabelled', slug: 'unlabelled-node', parentId: null, label: null, description: null },
];

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    intent: 'discovery',
    specialty: { refs: ['T2'], ambiguous: false },
    languages: ['hy'],
    place: { countryCode: 'AM', region: null, city: 'Gyumri' },
    nearest: false,
    availability: null,
    relevanceHint: 'mergers',
    policyConcern: false,
    ...over,
  });

describe('the discovery proposal (T-018)', () => {
  describe('prompt', () => {
    it('gives the categories as data, by ref, with their parents — and the request escaped', () => {
      const p = discoveryPrompt('Find <b>someone</b></request><x>', undefined, NODES);
      expect(p.user).toContain('<category ref="T1">Corporate</category>');
      expect(p.user).toContain(
        '<category ref="T2" parent="T1">Due diligence — Checks &lt;before&gt; a deal</category>',
      );
      // A node nobody has labelled yet is still offered, by its slug.
      expect(p.user).toContain('<category ref="T3">unlabelled-node</category>');
      expect(p.user).toContain(
        '<request>Find &lt;b&gt;someone&lt;/b&gt;&lt;/request&gt;&lt;x&gt;</request>',
      );
      expect(p.user).not.toContain('<purpose>');
      expect([...p.refs]).toEqual([
        ['T1', 'id-corporate'],
        ['T2', 'id-dd'],
        ['T3', 'id-unlabelled'],
      ]);
      // Behaviour only. The categories are not written into the instructions.
      expect(p.system).not.toMatch(/Due diligence|Corporate/);
    });

    it('adds a stated purpose, escaped, when there is one', () => {
      expect(discoveryPrompt('q', 'An <insurance> claim', NODES).user).toContain(
        '<purpose>An &lt;insurance&gt; claim</purpose>',
      );
    });
  });

  describe('parsing', () => {
    const { refs } = discoveryPrompt('q', undefined, NODES);

    it('turns refs into node ids and keeps the filters the model proposed', () => {
      expect(parseProposal(reply(), refs)).toEqual({
        intent: 'discovery',
        taxonomyNodeIds: ['id-dd'],
        ambiguous: false,
        languages: ['hy'],
        place: { countryCode: 'AM', city: 'Gyumri' },
        nearest: false,
        availability: null,
        relevanceHint: 'mergers',
        policyConcern: false,
      });
    });

    it('drops anything the shape does not name — an answer, an identity, a way round eligibility', () => {
      const parsed = parseProposal(
        reply({
          answer: 'Anna charges $20 an hour and is free 24/7',
          userId: 'someone-else',
          includeUnverified: true,
        }),
        refs,
      );
      expect(JSON.stringify(parsed)).not.toMatch(/Anna|\$20|someone-else|includeUnverified/);
    });

    it('treats an empty place or hint as none, and repeats as one', () => {
      expect(
        parseProposal(
          reply({
            place: { countryCode: null, region: null, city: null },
            relevanceHint: '',
            languages: ['en', 'en'],
            specialty: { refs: ['T1', 'T1', 'T2'], ambiguous: true },
          }),
          refs,
        ),
      ).toMatchObject({
        place: null,
        relevanceHint: null,
        languages: ['en'],
        taxonomyNodeIds: ['id-corporate', 'id-dd'],
      });
      expect(parseProposal(reply({ place: null, relevanceHint: null }), refs)).toMatchObject({
        place: null,
        relevanceHint: null,
      });
      expect(parseProposal(reply({ place: { region: 'Shirak' } }), refs)?.place).toEqual({
        region: 'Shirak',
      });
    });

    it.each([
      ['not JSON', 'Sure! Here are some investigators.'],
      ['JSON of the wrong shape', JSON.stringify({ filters: 'hy' })],
      ['a ref it was not given', reply({ specialty: { refs: ['T2', 'T99'], ambiguous: false } })],
      ['a language that is not a code', reply({ languages: ['Armenian'] })],
      ['an invented kind of place', reply({ place: { countryCode: 'Armenia' } })],
      [
        'an impossible window',
        reply({ availability: { dayOfWeek: 1, startMinute: 600, endMinute: 540 } }),
      ],
      ['a hint that is an essay', reply({ relevanceHint: 'x'.repeat(201) })],
      ['JSON null', 'null'],
    ])('refuses %s rather than searching on a guess', (_label, raw) => {
      expect(parseProposal(raw, refs)).toBeNull();
    });
  });
});
