---
name: localization
description: Working with translation keys and locale formatting for en/ru/hy — key naming, parity enforcement, ICU plurals, locale-aware dates and currencies, and fallback behaviour. Use when adding user-facing strings, adding a locale, or formatting dates, numbers or money.
---

# Localization

Launch locales: `en`, `ru`, `hy`. Adding a fourth must not touch the domain model.

## Rules

1. **No hardcoded user-facing strings.** Keys only. A literal in a component is a defect,
   including error messages, empty states, button labels and accessibility labels.
2. **Parity is enforced.** A key present in one catalog and missing in another fails the
   build. Missing values fall back to `en` and are reported — never render a raw key.
3. **Canonical data is language-neutral.** Store an enum or ID; translate at the edge.
   Never store a translated string as the value of record — it cannot be re-rendered for
   a different reader.
4. **Format at render time**, with the reader's locale and time zone. The server sends an
   ISO timestamp and integer minor units plus a currency code, never a formatted string.

## Key naming

`domain.screen.element.state`

```
mission.create.submit.label
mission.create.submit.disabled_reason
mission.status.under_review
error.validation.budget.max_below_min
```

Group by domain, not by screen. A key reused in two places is fine; a key whose *meaning*
differs in two places is two keys.

## Plurals

Russian and Armenian do not follow English rules. Use ICU plural categories; never
hand-roll `count === 1`.

Russian needs `one / few / many / other` — 1 quote, 2 quotes, 5 quotes and 21 quotes take
different forms. Getting this wrong is immediately visible to a native speaker and reads
as unfinished software.

```json
{
  "mission.quotes.count": "{count, plural, one {# quote} other {# quotes}}"
}
```

```json
{
  "mission.quotes.count": "{count, plural, one {# предложение} few {# предложения} many {# предложений} other {# предложения}}"
}
```

## Never concatenate

```ts
t('mission.you_have') + ' ' + count + ' ' + t('mission.quotes')   // wrong
t('mission.quotes.count', { count })                              // right
```

Word order differs by language. Concatenation produces sentences no translator can fix.

## Formatting

| Value | Rule |
|---|---|
| Date/time | `Intl.DateTimeFormat` with the user's locale **and** time zone |
| Number | `Intl.NumberFormat` |
| Money | Integer minor units + currency code → `Intl.NumberFormat` with `style: 'currency'` |
| Relative time | `Intl.RelativeTimeFormat` |
| Name order | Do not assume given-then-family; render the stored display name |

Time zone matters here: an assignment deadline shown in the server's zone is a support
ticket, and in a legal context, a problem.

## AI responses

The assistant answers in the user's **selected** language, not the language it inferred
from the prompt. Knowledge documents are localized content with independent versions;
retrieval prefers the user's locale and falls back with the fallback stated.

## Do not translate

Audit log entries · application log lines · error *codes* (translate the user-facing
message that maps to the code) · enum values stored in the database · email addresses,
identifiers, currency codes.

## Checklist

- [ ] Every new string is a key, present in en, ru and hy
- [ ] ICU plurals, not `count === 1`
- [ ] No concatenated sentence fragments
- [ ] Dates formatted with locale and time zone at render
- [ ] Money as minor units plus currency code
- [ ] Canonical data language-neutral
- [ ] Fallback reports rather than rendering a key
