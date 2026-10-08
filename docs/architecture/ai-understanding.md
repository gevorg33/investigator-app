# Understanding a message, before anything answers it (T-220, P-9)

The first stages of the assistant's planner (AI-EXECUTION-PLAN §4), in
`apps/api/src/modules/ai/understanding/`. Each has one job, decides from structure and closed lists
of phrasings, and **never chooses an action**: no stage returns a tool, a command or a plan, and none
imports one (`ai-normalize.spec.ts` holds both). A model is never asked anything here.

| Stage | File | Where it runs today |
|---|---|---|
| Normalize text | `normalize.ts` | Every turn, before the screen; what is stored is this text |
| Credential screen | `credentials.ts` | Every turn, before storing; `/ai/knowledge/answer` and `/ai/discovery/answer` |
| Structural routing | `routing.ts` | Every turn, before storing |
| A relative time | `when.ts` | Nothing yet: the slot for T-095's commands |
| An amount | `amount.ts` | Nothing yet: the slot for T-095's commands |

## Normalize text

`normalizeText` puts the words in one Unicode form (NFC). It removes zero-width, directional and
control characters, and makes every run of spaces one ordinary space. Line breaks are kept, at most
one blank line in a row, and the text is trimmed. It runs first, so a key split by an invisible
character is still found by the screen. It decides nothing, and never shortens what was said.

## The credential screen

`screenCredentials(text)` → `{ found: kinds[], masked }`. Every secret becomes `•••••`, and it reports
what it found by kind only: `api_key`, `access_token`, `jwt`, `private_key` or `password`.

- **Keys and tokens** by their issuers' prefixes: OpenAI `sk-`, Stripe `sk_live_`/`rk_`/`pk_`/
  `whsec_`, Resend `re_`, Google `AIza`, AWS `AKIA`, Slack `xox?-`, GitHub `ghp_`/`github_pat_`,
  GitLab `glpat-`. Also JWTs (`eyJ….eyJ….…`) and PEM private keys, from header to footer, or to the
  end of what was pasted.
- **A password**, only where it is introduced — `password`, `пароль…`, `գաղտնաբառ…`:
  - after `:` `=` `՝`, whatever follows;
  - after "is", "это", "—", "է" or nothing at all, only a value that looks like one: six or more
    characters with a digit, a symbol, or mixed case.

  So "my password is not working" passes and "my password is Hunter2!" does not. A password of plain
  lowercase words after "is" passes: catching it would refuse every sentence that describes one. The
  whole token is masked, any punctuation it ends in included.

**In a conversation** (`AssistantTurnService.ask`), a message with a secret is stored masked, with
`metadata.screened: kinds`, and answered at once by the screen. The reply is
`{ source: 'screen', status: 'credential', kinds }`, with no words of its own; the client says it. No
model is called and no allowance is spent. A retry of that message is answered by the screen again.
**The answers that store nothing** (`/ai/knowledge/answer`, `/ai/discovery/answer`) refuse instead:
`422 VALIDATION_FAILED`, with a detail `{ field, code: 'CREDENTIAL', messageKey:
'error.validation.assistant.credential' }`. That runs before any model call or allowance.

A secret reaches no stored message, plan step, audit row, outbox event, session title or model
request (`ai-normalize.turn.spec.ts` searches each one). Request logs carry the method and path only
(`logging.md`).

## Structural routing

`routeMessage(text, { waiting, clarifies })`:
- **`empty` / `too_long`** — fewer than 3 or more than 2,000 characters once normalized. Refused before
  anything is stored: `422`, with code `TOO_SHORT` or `TOO_LONG` on `content`. Invisible characters
  alone pass the DTO's "not blank" check, so this is what catches them.
- **`confirm_pointer`** — the whole message is only a yes (`yes`, `confirm`, `go ahead`,
  `подтверждаю`, `ага`, `այո`, `հաստատում եմ`…, ignoring punctuation and emoji), while a plan in the
  conversation waits for an answer. The yes is stored, and the reply points at the plan:
  `{ source: 'routing', status: 'confirm_pointer', planId }`. **Nothing is confirmed**: confirming is
  the person's authenticated request for exactly the plan they were shown (T-048, T-058). The open
  plans are read only for a yes. A yes answering discovery's own question (`clarifies`) is that
  answer, not this. A yes shorter than three characters ("да", "ok") is never sent: the composer and
  `AskTurnDto` hold the same bound.
- **`ask`** — everything else goes on to be answered.

## A relative time — `resolveWhen(expr, { now, zones })`

Read **where the thing happens**: the mission's zone when there is one, else the person's
`users.timezone`. That column defaults to `UTC`, so `UTC` counts as never set. A zone the runtime
does not know is skipped.

| Result | When |
|---|---|
| `{ kind: 'instant', at, zone }` | A time of day on a day, or "in N minutes/hours" |
| `{ kind: 'date', date, zone }` | A day with no time |
| `{ kind: 'question', reason: 'zone_unknown' }` | No zone to read it in |
| `{ kind: 'question', reason: 'dst_gap' }` | A wall-clock time the change to summer time skips |
| `{ kind: 'question', reason: 'dst_overlap' }` | One the change back repeats |
| `{ kind: 'question', reason: 'not_understood' }` | Anything else — never a guess |

Understood, in English, Russian and Armenian:
- today, tomorrow, the day after, yesterday;
- a weekday — the next one after today, so the one named today is a week away;
- "in N minutes, hours, days or weeks" (`через …`, `… օրից`);
- a time of day — "at 10", "10:30", "3pm", "в 10 вечера", "ժամը 10-ին".

Armenian's "շաբաթ" is the week after a number ("2 շաբաթից"), and Saturday standing alone. Daylight
saving is read from `Intl` alone. The instants at which a zone's clock shows a wall time are found by
trying the offsets that hold a day either side: none is a gap, two is an overlap.

## An amount — `parseAmount(text)`

`{ kind: 'amount', minor, currency }`: integer minor units and an ISO code, with the digits
`formatMoney` uses. Currencies are USD, EUR, RUB, AMD and GBP, by symbol, code or word in three
languages. `k`, `тыс`, `հազար`, `млн`, `million` and `միլիոն` scale the number. Separators are read
one way only:
- with both `,` and `.`, the later one is the decimal point;
- a lone `,` before exactly three digits separates thousands, and before one or two it is the
  decimal point;
- a `.` is the decimal point unless it separates two or more groups of three.

It is a question when there is no currency (`currency_unknown`), and `not_understood` for: two
currencies, more decimals than the currency has, separators that read no one way, no number, or a
number past `Number.MAX_SAFE_INTEGER`. The arithmetic is in integers, never floating point.

## What holds it

- `ai-normalize.credentials.spec.ts` — every kind; passwords in three languages, and the sentences
  that only mention one; overlapping finds masked once; the refusal names the field, never the secret.
- `ai-normalize.when.spec.ts` — trilingual phrasings; one phrase across New York, Moscow and Yerevan;
  the mission's zone first; unknown zones; New York's spring gap and autumn overlap, and Berlin's.
- `ai-normalize.spec.ts` — amounts; text; routing in three languages; **no stage returns an action**,
  and none imports a tool, a plan, a model or the database.
- `ai-normalize.turn.spec.ts` — in a real conversation:
  - a pasted key is masked, answered by the screen, reaches no model and is written nowhere (a
    positive control proves the search finds what is there);
  - a retry stays screened;
  - the stateless answers refuse it;
  - a yes while a plan waits is pointed at it, and the plan stays `PROPOSED`;
  - empty or too long is refused, storing nothing.
