# Translation glossary — en / ru / hy

The words the product uses for its own concepts, in each launch language, so every screen **and
every help article** says the same thing the same way (T-128, ADR-0013; T-026). Catalogs:
`packages/i18n/src/messages/`. Knowledge base: `docs/knowledge-base/**/*.{ru,hy}.md`.

**Status: written by agents, not yet reviewed by native speakers** (ACTIONS-FOR-ME #23 for the
app, #22 for the knowledge base). The choices below are reasoned and sourced, not final. A reviewer
changes the catalog, the articles and this table together.

## Terms

| Concept | English | Russian | Armenian | Why, and the alternatives |
|---|---|---|---|---|
| Investigator (the professional) | investigator | **детектив** | **դետեկտիվ** in the app · «խուզարկու» in the knowledge base — **open conflict**, below | Russian: «частный детектив» is the everyday word and the legal one (Law No. 2487-1, «О частной детективной и охранной деятельности»); both sides agree. Rejected: «следователь» (a state investigator) |
| Mission (what a customer asks for) | mission | **задание** | «գործ» in the app · **առաջադրանք** in the knowledge base — **open conflict**, below | Russian «задание» in both, and the navigation label «Задания» fits the tab. Not «заказ», which means the assignment (next row). **Alternative for both: «заявка»** — agencies ask customers to «подать заявку». Rejected: «миссия», «առաքելություն» (literal, reads oddly) |
| Assignment (a hired investigator's engagement) | assignment | **заказ** | **պատվեր** | The knowledge base's words. The app says «обновления по заказам» for assignment updates |
| Messages (the conversations area) | Messages | **Чаты** | **Զրույցներ** | Navigation label. «Сообщения» is the fuller Russian word but is clipped in the phone tab; «Чаты» is common in Russian apps. Armenian «Զրույցներ» (conversations). Body text may use the fuller words: «переписка», «հաղորդագրություններ» |
| Assistant | Assistant | **Ассистент** | **Օգնական** | Russian «Помощник» is an alternative; «Ассистент» matches how AI assistants are commonly named |
| Conversation with the assistant (T-056) | conversation | **разговор** | **զրույց** | Russian «разговор», kept apart from «чат», which names the Messages area. Armenian has no such pair in the app yet: «զրույց» is also the Messages label («Զրույցներ»). They are different screens, so it reads, but a reviewer may prefer «խոսակցություն» here |
| Account | Account | **Аккаунт** | **Հաշիվ** | Russian «Профиль» is an alternative, but the page will hold sign-in and privacy settings, not only a profile |
| Home | Home | **Главная** | **Գլխավոր** | Standard in both |
| Quote (an investigator's price for a mission) | quote | **предложение** | **գնառաջարկ** | Russian «коммерческое предложение» shortened; «смета» is an estimate, not an offer. Armenian «գնառաջարկ» is the procurement word for a price offer |
| Customer | customer | **заказчик** | **պատվիրատու** | The party ordering the work |
| Product name | Investigator | Investigator | Investigator | A name, untranslated until there is a brand |

## Open conflicts between the app and the knowledge base

Both sides are unreviewed drafts and neither is shown to a reader yet (the app is not deployed; the
translated articles are `draft` and not ingested). The reviewer settles each once, and the other
side is then changed to match.

1. **Investigator, Armenian: «դետեկտիվ» (app) or «խուզարկու» (knowledge base).** Evidence for
   «դետեկտիվ»: the one lawful, registered business in Armenia calls itself «դետեկտիվ բյուրո»; a
   Hraparak article uses «մասնավոր խուզարկու» for unlicensed private surveillance of individuals;
   classified listings use both («Մասնավոր դետեկտիվ/խուզարկու»); «խուզարկել» also means a police
   search. If «դետեկտիվ» wins, 36 Armenian articles change; if «խուզարկու» wins, three app strings.
2. **Mission, Armenian: «գործ» (app) or «առաջադրանք» (knowledge base).** The navigation tab holds
   about 60px at 12px; «Առաջադրանքներ» does not fit. Either both use «գործ», or the app keeps a
   short navigation label beside the knowledge base's term in body text.

## Constraints a translation must meet

- **Bottom-bar labels fit a 75px tab at 12px** — about 60px of text. Measured at 375px wide in
  T-128: «Ассистент» 63px and «Օգնական» 62px are the widest that fit; «Сообщения» (≈66) and
  «Պատվերներ» (≈75) did not. Check any changed navigation label at 375px.
- **Plurals** use every category the language has: Russian `one / few / many / other`, Armenian
  and English `one / other`. The catalog test fails otherwise.
- **Armenian sentences end with `։`** (verjaket), not a full stop.
- **Arguments** (`{name}`, `{count}`) are the same in every language — the test checks — and
  never concatenated into sentences.

## Sources consulted (T-128)

- Russian usage and law: agency sites such as [criminalist.agency](https://www.criminalist.agency/services/)
  and [detektive.ru](https://detektive.ru/uslugi.htm) («частный детектив», «подать заявку»).
- Armenian usage: [list.am listing](https://www.list.am/en/item/22391422) («Մասնավոր
  դետեկտիվ/խուզարկու»), [turn.am](https://turn.am/service/masnavor-detektiv-gabrielyan/detail)
  («Մասնավոր Դետեկտիվ ... Դետեկտիվ Բյուրո»), and a
  [Hraparak article](https://hraparak.am/post/e1754420828e46e64d08b287d2fcaf51) using
  «մասնավոր խուզարկու» for unlicensed private surveillance. That article also makes a **legal claim
  about Armenia** relevant far beyond wording — see ACTIONS-FOR-ME #2.
