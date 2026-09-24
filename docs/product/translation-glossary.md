# Translation glossary — en / ru / hy

The words the product uses for its own concepts, in each launch language, so every screen says the
same thing the same way (T-128, ADR-0013). Catalogs: `packages/i18n/src/messages/`.

**Status: written by an agent, not yet reviewed by native speakers** (ACTIONS-FOR-ME #22). The
choices below are reasoned and sourced, not final. A reviewer changes the catalog and this table
together.

## Terms

| Concept | English | Russian | Armenian | Why, and the alternatives |
|---|---|---|---|---|
| Investigator (the professional) | investigator | **детектив** | **դետեկտիվ** | Russian: «частный детектив» is the everyday word and the legal one (Law No. 2487-1, «О частной детективной и охранной деятельности»). Armenian: the registered, lawful business in Armenia calls itself «դետեկտիվ բյուրո», while press coverage uses «մասնավոր խուզարկու» for unlicensed private surveillance; «խուզարկել» also means a police search. Rejected: «խուզարկու», «следователь» (a state investigator) |
| Mission (what a customer asks for) | mission | **заказ** | **գործ** | A customer's request for an investigation. Russian «заказ» is the marketplace word (an order; «мои заказы»). **Alternative: «заявка»** — agencies ask customers to «подать заявку», and it fits the tab. Armenian «գործ» (a case) fits investigation work and the phone tab; «պատվեր» (order) is the literal marketplace word but is clipped in the tab (see below). Rejected: «миссия», «առաքելություն» (literal, reads oddly) |
| Messages (the conversations area) | Messages | **Чаты** | **Զրույցներ** | Navigation label. «Сообщения» is the fuller Russian word but is clipped in the phone tab; «Чаты» is common in Russian apps. Armenian «Զրույցներ» (conversations). Body text may use the fuller words: «переписка», «հաղորդագրություններ» |
| Assistant | Assistant | **Ассистент** | **Օգնական** | Russian «Помощник» is an alternative; «Ассистент» matches how AI assistants are commonly named |
| Account | Account | **Аккаунт** | **Հաշիվ** | Russian «Профиль» is an alternative, but the page will hold sign-in and privacy settings, not only a profile |
| Home | Home | **Главная** | **Գլխավոր** | Standard in both |
| Quote (an investigator's price for a mission) | quote | **предложение** | **գնառաջարկ** | Russian «коммерческое предложение» shortened; «смета» is an estimate, not an offer. Armenian «գնառաջարկ» is the procurement word for a price offer |
| Customer | customer | **заказчик** | **պատվիրատու** | The party ordering the work |
| Product name | Investigator | Investigator | Investigator | A name, untranslated until there is a brand |

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
