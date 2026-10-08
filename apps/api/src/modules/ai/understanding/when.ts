/**
 * A relative time, resolved where it happens (T-220, P-9; AI-EXECUTION-PLAN §4 "normalize").
 *
 * "Tomorrow at 10" means 10 o'clock where the thing it describes takes place: the mission's location
 * when there is one, else the person's own time zone — if they set it. `users.timezone` defaults to
 * `UTC`, and a Personal workspace has none, so `UTC` counts as not knowing: an unknown zone becomes a
 * question, never a guess. So does a wall-clock time that a daylight-saving change skips (a gap) or
 * repeats (an overlap). What resolves is stored as an instant plus the IANA zone it was read in.
 *
 * A deterministic slot, as the plan's "structural enrich" stage allows: regular expressions over a
 * closed set of phrasings in English, Russian and Armenian. Anything else is `not_understood` — a
 * question — never a guess. It decides nothing about what to do with the time.
 *
 * Understood: today, tomorrow, the day after, yesterday; a weekday (the next one after today); "in N
 * minutes / hours / days / weeks"; and a time of day — "at 10", "10:30", "3pm", "в 10 вечера",
 * "ժամը 10-ին". A day with no time is a date, read in the zone.
 */

export interface ZoneSources {
  /** The zone of where the thing happens — a mission's location — when it is known. */
  mission?: string | null | undefined;
  /** The person's own (`users.timezone`), `UTC` meaning they never set one. */
  user?: string | null | undefined;
}

export type When =
  | { kind: 'instant'; at: string; zone: string }
  | { kind: 'date'; date: string; zone: string }
  | {
      kind: 'question';
      reason: 'zone_unknown' | 'dst_gap' | 'dst_overlap' | 'not_understood';
    };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** A zone the runtime knows. */
function isZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Where a time is read: the mission's zone, else the person's if they chose one. */
export function zoneFor(sources: ZoneSources): string | null {
  for (const zone of [sources.mission, sources.user === 'UTC' ? null : sources.user]) {
    if (typeof zone === 'string' && zone !== '' && isZone(zone)) return zone;
  }
  return null;
}

interface Wall {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

/** The wall clock in `zone` at `ms`. */
function wallAt(ms: number, zone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return { y: n('year'), mo: n('month'), d: n('day'), h: n('hour'), mi: n('minute') };
}

const asUtc = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi);

/**
 * Every instant at which `zone`'s clock reads `wall`: one, none (skipped by a change to summer
 * time), or two (repeated by a change back). Offsets are read a day either side, where they hold.
 */
function instantsOf(wall: Wall, zone: string): number[] {
  const guess = asUtc(wall);
  const found = new Set<number>();
  for (const probe of [guess - DAY, guess + DAY]) {
    const offset = asUtc(wallAt(probe, zone)) - probe;
    const at = guess - offset;
    if (asUtc(wallAt(at, zone)) === guess) found.add(at);
  }
  return [...found].sort((a, b) => a - b);
}

/** A calendar date `days` after `wall`'s, as y-m-d. */
function plusDays(wall: Wall, days: number): Pick<Wall, 'y' | 'mo' | 'd'> {
  const t = new Date(Date.UTC(wall.y, wall.mo - 1, wall.d) + days * DAY);
  return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const pad = (n: number) => String(n).padStart(2, '0');

// ── phrasings ─────────────────────────────────────────────────────────────────────────────────

const NUMBER = String.raw`(\d{1,3}|an?|one|один|одну|одна|մեկ)`;
const amount = (word: string): number => (/^\d+$/.test(word) ? Number(word) : 1);

const UNIT_OF: ReadonlyArray<[RegExp, 'minute' | 'hour' | 'day' | 'week']> = [
  [/^(minutes?|минут\p{L}*|րոպե\p{L}*)$/u, 'minute'],
  [/^(hours?|час\p{L}*|ժամ\p{L}*)$/u, 'hour'],
  [/^(days?|день|дня|дней|օր\p{L}*)$/u, 'day'],
  [/^(weeks?|недел\p{L}*|շաբաթ\p{L}+)$/u, 'week'],
];
const unitOf = (word: string) => UNIT_OF.find(([re]) => re.test(word))?.[1];

/** "in 3 days", "через 2 часа", "через час", "3 օրից", "մեկ ժամից". */
const DURATIONS: readonly RegExp[] = [
  new RegExp(String.raw`\bin\s+${NUMBER}\s+(\p{L}+)`, 'iu'),
  new RegExp(String.raw`через\s+(?:${NUMBER}\s+)?(\p{L}+)`, 'iu'),
  new RegExp(String.raw`${NUMBER}\s+(\p{L}+(?:ից|ուց))`, 'iu'),
];

/** Days from today a word names. Longest phrasings first: "day after tomorrow" before "tomorrow". */
const DAY_WORDS: ReadonlyArray<[RegExp, number]> = [
  [/\b(the\s+)?day\s+after\s+tomorrow\b/iu, 2],
  [/послезавтра/iu, 2],
  [/վաղը\s+չէ\s+մյուս\s+օրը/iu, 2],
  [/\btomorrow\b|завтра|վաղը/iu, 1],
  [/\btoday\b|сегодня|այսօր/iu, 0],
  [/\byesterday\b|вчера|երեկ/iu, -1],
];

/** Weekdays, Sunday = 0, as each language names them (with the endings a sentence gives them). */
const WEEKDAYS: ReadonlyArray<[RegExp, number]> = [
  [/\bsunday\b|воскресень\p{L}*|կիրակի\p{L}*/iu, 0],
  [/\bmonday\b|понедельник\p{L}*|երկուշաբթի\p{L}*/iu, 1],
  [/\btuesday\b|вторник\p{L}*|երեքշաբթի\p{L}*/iu, 2],
  [/\bwednesday\b|сред[ауые](?!\p{L})|չորեքշաբթի\p{L}*/iu, 3],
  [/\bthursday\b|четверг\p{L}*|հինգշաբթի\p{L}*/iu, 4],
  [/\bfriday\b|пятниц\p{L}*|ուրբաթ\p{L}*/iu, 5],
  // Armenian's Saturday is also its "week": standing alone, or with a day's ending, it is the day.
  [/\bsaturday\b|суббот\p{L}*|(?:^|\s)շաբաթ(?:ի|ին|օրը)?(?![\p{L}])/iu, 6],
];

/** A time of day, as hours and minutes on a 24-hour clock. */
function timeOfDay(text: string): { h: number; mi: number } | null | 'invalid' {
  const forms: ReadonlyArray<
    [RegExp, (m: RegExpMatchArray) => [number, number, string | undefined]]
  > = [
    // 3pm, 10:30 am, at 10 p.m.
    [
      /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?!\p{L})/iu,
      (m) => [+m[1]!, +(m[2] ?? 0), m[3]!.toLowerCase()],
    ],
    // в 10, в 10:30, в 10 утра / вечера
    [
      /(?:^|\s)в\s+(\d{1,2})(?::(\d{2}))?(?:\s+(утра|дня|вечера|ночи))?/iu,
      (m) => [+m[1]!, +(m[2] ?? 0), m[3]],
    ],
    // ժամը 10-ին, ժամը 10:30-ին
    [/ժամը\s+(\d{1,2})(?::(\d{2}))?/iu, (m) => [+m[1]!, +(m[2] ?? 0), undefined]],
    // at 10, at 10:30
    [/\bat\s+(\d{1,2})(?::(\d{2}))?\b/iu, (m) => [+m[1]!, +(m[2] ?? 0), undefined]],
    // 10:30 standing alone
    [/(?:^|\s)(\d{1,2}):(\d{2})(?!\d)/u, (m) => [+m[1]!, +m[2]!, undefined]],
  ];
  for (const [re, read] of forms) {
    const m = text.match(re);
    if (m === null) continue;
    const [hour, mi, part] = read(m);
    let h = hour;
    if (part === 'p' || part === 'дня' || part === 'вечера') {
      if (h > 12) return 'invalid';
      if (h < 12) h += 12;
    } else if (part === 'a' || part === 'утра' || part === 'ночи') {
      if (h > 12) return 'invalid';
      if (h === 12) h = 0;
    }
    if (h > 23 || mi > 59) return 'invalid';
    return { h, mi };
  }
  return null;
}

/**
 * Reads `expr` as a time, in the zone of what it describes (`zones`), from `now`. Never guesses: a
 * phrasing it does not know, an unknown zone, and a wall-clock time a daylight-saving change skips
 * or repeats are each a question.
 */
export function resolveWhen(expr: string, ctx: { now: Date; zones: ZoneSources }): When {
  const text = expr.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const zone = zoneFor(ctx.zones);

  let days: number | null = null;
  let minutes: number | null = null;
  for (const re of DURATIONS) {
    const m = text.match(re);
    // Group 1 is the count (absent in "через час"), group 2 the unit.
    const unit = m === null ? undefined : unitOf(m[2]!);
    if (m === null || unit === undefined) continue;
    const n = m[1] === undefined ? 1 : amount(m[1]);
    if (unit === 'minute') minutes = n;
    else if (unit === 'hour') minutes = n * 60;
    else days = unit === 'day' ? n : n * 7;
    break;
  }
  if (days === null && minutes === null) {
    days = DAY_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
  }
  let weekday: number | null = null;
  if (days === null && minutes === null) {
    weekday = WEEKDAYS.find(([re]) => re.test(text))?.[1] ?? null;
  }
  const time = minutes === null ? timeOfDay(text) : null;

  if (time === 'invalid') return { kind: 'question', reason: 'not_understood' };
  if (minutes === null && days === null && weekday === null && time === null) {
    return { kind: 'question', reason: 'not_understood' };
  }
  if (zone === null) return { kind: 'question', reason: 'zone_unknown' };

  // A duration in minutes or hours is an exact instant from now; the zone is where it is read.
  if (minutes !== null) {
    return {
      kind: 'instant',
      at: new Date(ctx.now.getTime() + minutes * MINUTE).toISOString(),
      zone,
    };
  }

  const today = wallAt(ctx.now.getTime(), zone);
  if (weekday !== null) {
    const todayIs = new Date(Date.UTC(today.y, today.mo - 1, today.d)).getUTCDay();
    // The next one: a weekday named today means a week from now.
    days = ((weekday - todayIs + 6) % 7) + 1;
  }
  const date = plusDays(today, days ?? 0);
  if (time === null) {
    return { kind: 'date', date: `${date.y}-${pad(date.mo)}-${pad(date.d)}`, zone };
  }
  const instants = instantsOf({ ...date, h: time.h, mi: time.mi }, zone);
  if (instants.length === 0) return { kind: 'question', reason: 'dst_gap' };
  if (instants.length > 1) return { kind: 'question', reason: 'dst_overlap' };
  return { kind: 'instant', at: new Date(instants[0]!).toISOString(), zone };
}
