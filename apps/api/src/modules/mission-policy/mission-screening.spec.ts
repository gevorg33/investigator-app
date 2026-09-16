import { describe, expect, it } from 'vitest';
import { RULESET_VERSION, STRUCTURED_FLAGS, TEXT_RULES } from './mission-policy.rules';
import { normaliseForScreening, screenMission, type ScreeningInput } from './mission-screening';

/** A clean, ordinary, banded mission. Each test changes one thing about it. */
const base: ScreeningInput = {
  title: 'Pre-acquisition due diligence on a supplier',
  description: 'Company ownership, filings and litigation history from public registers.',
  purpose: 'Deciding whether to proceed with an acquisition.',
  locationLabel: 'Yerevan',
  subjectRelationship: 'BUSINESS_RELATIONSHIP',
  protectiveOrderDeclared: null,
  categoryBand: 'STANDARD',
};

describe('screening a clean mission', () => {
  it('flags nothing and still sends it to review', () => {
    expect(screenMission(base)).toEqual({
      rulesetVersion: RULESET_VERSION,
      outcome: 'ROUTINE_REVIEW',
      riskBand: 'STANDARD',
      flags: [],
    });
  });

  it('is deterministic — the same text and ruleset always give the same answer', () => {
    expect(screenMission(base)).toEqual(screenMission(base));
  });

  it('keeps the category band when nothing raises it', () => {
    expect(screenMission({ ...base, categoryBand: 'ELEVATED' }).riskBand).toBe('ELEVATED');
    expect(screenMission({ ...base, categoryBand: 'ELEVATED' }).outcome).toBe('ROUTINE_REVIEW');
  });

  it('prioritises a high-band category on its own', () => {
    expect(screenMission({ ...base, categoryBand: 'HIGH' }).outcome).toBe('PRIORITY_REVIEW');
  });
});

describe('an unbanded category', () => {
  it('is treated as HIGH, not as low', () => {
    // Failing closed. T-053 bands the tree; until then an unbanded node is not evidence of
    // anything, and the mission is read first rather than last.
    const result = screenMission({ ...base, categoryBand: null });
    expect(result.riskBand).toBe('HIGH');
    expect(result.flags).toContain(STRUCTURED_FLAGS.categoryUnbanded.id);
    expect(result.outcome).toBe('PRIORITY_REVIEW');
  });
});

describe('structured answers', () => {
  it.each(['PARTNER_OR_SPOUSE', 'FORMER_PARTNER'] as const)(
    'makes a %s mission RESTRICTED',
    (relationship) => {
      // In scope, and moderated every time without exception (ADR-0009).
      const result = screenMission({
        ...base,
        subjectRelationship: relationship,
        protectiveOrderDeclared: false,
      });
      expect(result.flags).toContain(STRUCTURED_FLAGS.partnerInvestigation.id);
      expect(result.riskBand).toBe('RESTRICTED');
      expect(result.outcome).toBe('PRIORITY_REVIEW');
    },
  );

  it('does not flag an ordinary business relationship as partner investigation', () => {
    expect(screenMission(base).flags).not.toContain(STRUCTURED_FLAGS.partnerInvestigation.id);
  });

  it('flags a declared protective order', () => {
    const result = screenMission({ ...base, protectiveOrderDeclared: true });
    expect(result.flags).toContain(STRUCTURED_FLAGS.protectiveOrderDeclared.id);
    expect(result.riskBand).toBe('RESTRICTED');
  });

  it('does not flag an answered "no"', () => {
    expect(screenMission({ ...base, protectiveOrderDeclared: false }).flags).toEqual([]);
  });
});

/**
 * One matching phrase per rule, in English and in Russian, taken from how these requests are
 * actually worded. A rule that matches nothing is a rule that does nothing.
 */
describe('the deterministic text rules', () => {
  const matches: Record<string, readonly string[]> = {
    device_or_account_access: [
      'I need you to hack the account and tell me what is inside',
      'Нужно получить доступ к его переписке',
    ],
    covert_monitoring_software: [
      'Please install an app on her phone so I can see the screen',
      'Установить программу на его телефон незаметно',
    ],
    tracking_device: ['Put a GPS tracker on the vehicle', 'Поставить маячок на машину'],
    interception: ['I want to record his calls', 'Нужна прослушка телефона'],
    protected_records: ['Obtain his bank statements and call logs', 'Нужна детализация звонков'],
    impersonation_or_pretext: [
      'Pretend to be a delivery driver to get inside',
      'Выдать себя за сотрудника банка',
    ],
    open_ended_monitoring: ['Ongoing monitoring of where he goes, 24/7', 'Круглосуточная слежка'],
    harassment_or_intimidation: [
      'I want to teach him a lesson and get revenge',
      'Хочу отомстить и запугать',
    ],
    unlawful_entry: ['Break into his apartment while he is away', 'Проникнуть в его квартиру'],
  };

  it('has an example for every rule, so no rule ships untested', () => {
    expect(Object.keys(matches).sort()).toEqual(TEXT_RULES.map((r) => r.id).sort());
  });

  it.each(TEXT_RULES.map((rule) => [rule.id] as const))('%s matches and raises the band', (id) => {
    for (const description of matches[id] ?? []) {
      const result = screenMission({ ...base, description });
      expect(result.flags, description).toContain(id);
      expect(result.riskBand, description).toBe('HIGH');
      expect(result.outcome, description).toBe('PRIORITY_REVIEW');
    }
  });

  it('reads every field a customer can write into', () => {
    const phrase = 'install spyware on the device';
    expect(screenMission({ ...base, title: phrase }).flags).toContain('covert_monitoring_software');
    expect(screenMission({ ...base, purpose: phrase }).flags).toContain(
      'covert_monitoring_software',
    );
    expect(screenMission({ ...base, locationLabel: phrase }).flags).toContain(
      'covert_monitoring_software',
    );
  });

  it('does not match an ordinary word that merely contains a rule word', () => {
    // "hackathon" is not "hack"; boundaries are part of each pattern.
    expect(
      screenMission({ ...base, description: 'Due diligence on a hackathon sponsor.' }).flags,
    ).toEqual([]);
  });

  it('does not treat the customer’s own accounts as somebody else’s', () => {
    const description = 'Someone has been accessing my email; I need to know who.';
    expect(screenMission({ ...base, description }).flags).toEqual([]);
  });

  it('reports several rules when several match, in ruleset order', () => {
    const description = 'Put a tracker on his car and read his messages';
    const flags = screenMission({ ...base, description }).flags;
    expect(flags).toContain('tracking_device');
    expect(flags).toContain('device_or_account_access');
    expect(flags).toEqual([...flags].sort((a, b) => order(a) - order(b)));
  });

  const order = (id: string) => TEXT_RULES.findIndex((r) => r.id === id);
});

describe('normalisation', () => {
  it.each([
    ['upper case', 'INSTALL SPYWARE ON HER PHONE', 'covert_monitoring_software'],
    [
      'a zero-width character inside the word',
      'install spy​ware on her phone',
      'covert_monitoring_software',
    ],
    ['a curly apostrophe', 'read my wife’s messages', 'device_or_account_access'],
    ['full-width characters', 'ｉｎｓｔａｌｌ ｓｐｙｗａｒｅ', 'covert_monitoring_software'],
    ['a line break splitting the phrase', 'install\nspyware', 'covert_monitoring_software'],
  ])('sees through %s', (_label, description, expected) => {
    expect(screenMission({ ...base, description }).flags).toContain(expected);
  });

  it('folds ё to е so a Russian phrase matches either spelling', () => {
    expect(normaliseForScreening('её')).toBe('ее');
    expect(screenMission({ ...base, description: 'Доступ к её переписке' }).flags).toContain(
      'device_or_account_access',
    );
  });

  it('does not pretend to defeat deliberate evasion', () => {
    // Documented, not a gap nobody noticed: spacing out a word gets past the rules. It does not
    // get past review — every mission is read by a moderator, which is why flags may be missed
    // but a mission may not be.
    expect(screenMission({ ...base, description: 'i n s t a l l   s p y w a r e' }).flags).toEqual(
      [],
    );
  });
});

describe('what screening cannot do', () => {
  it('has no outcome that publishes or rejects', () => {
    const outcomes = new Set(
      [base, { ...base, categoryBand: null }, { ...base, description: 'hack his phone' }].map(
        (i) => screenMission(i).outcome,
      ),
    );
    expect([...outcomes].every((o) => o === 'ROUTINE_REVIEW' || o === 'PRIORITY_REVIEW')).toBe(
      true,
    );
  });

  it('takes no AI classification — the signature has nowhere to put one', () => {
    // The real guarantee is the type: screenMission accepts ScreeningInput and nothing else, so
    // no edit can feed a model's opinion into a policy decision without changing this contract.
    expect(screenMission.length).toBe(1);
    const keys = Object.keys(base);
    expect(keys).not.toContain('classification');
    expect(keys).not.toContain('aiClassification');
  });
});
