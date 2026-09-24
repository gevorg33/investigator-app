---
id: kb-customer-ai-assistant
title: What the AI assistant can and cannot do
audience: customer
visibility: authenticated
locale: en
version: 4
status: current
updated: 2026-09-24
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/ai
  - apps/api/src/modules/ai-sessions
  - apps/api/src/modules/knowledge
  - apps/api/src/modules/search
tags: [assistant, ai, help, limitations]
---

# The AI assistant

## What can the assistant help me with?

Answering questions about how the platform works, finding investigators who match what you
need, explaining your missions, quotes, assignments and payment status, helping you draft a
mission description, and explaining platform policies.

It answers in your selected language.

## How does it find investigators for me?

It turns your request into search requirements — place, distance, specialty, languages, the weekly
hours you need — and searches live investigator data with them, with your permissions. Only
verified investigators who are accepting work can appear. It then tells you which of your
requirements each one met, and which of the specialties you asked for they do not offer.

It does not guess, and it does not write about investigators in its own words. Every reason it
gives comes from what the investigator declared on their profile, so it cannot claim a price, an
availability or a skill that is not there. It also shows you what it searched for, so you can
correct it.

How matching works in detail: see "How investigators are matched to your mission".

## Does it use my location?

Only if you share one, and only to search. Your location is not sent to the AI service that reads
your request, and distances shown to you are rounded to whole kilometres.

## Why did it refuse to search?

Some requests describe something the platform does not allow — for example getting into another
person's accounts or devices, tracking them covertly, or intercepting their communications. Those
are checked by fixed rules, not by the AI, and a request that matches them is not searched. The
lawful use policy explains what is not allowed.

If you believe your request is lawful, describe it as a mission instead: every mission is reviewed
by a person before any investigator sees it.

## Can it tell me what an investigation will cost?

No. Investigators price each mission individually, in a quote. The assistant does not state
rates, even where an investigator shows one on their profile, and any estimate it produced would
be invented.

Request quotes to get real prices.

## Can it act on my behalf — accept a quote or send a message?

Not on its own. It can prepare something and show it to you, but anything that commits you
— accepting a quote, sending a message, making a payment — requires your explicit
confirmation of that specific action.

It cannot change your mission status, grant anyone access to your evidence, or move money.

## Can it see my evidence and reports?

Only what you can see, and only when answering your question. It operates with your
permissions, never broader ones.

It cannot reach another customer's data, another assignment's evidence, or internal staff
material, regardless of how a question is phrased.

## Why does it sometimes say it does not know?

Because it only answers from this documentation and from live platform data. When neither
contains the answer, it says so.

This is deliberate. An assistant that produces a plausible answer when it has no source is
worse than one that admits the gap — particularly on questions about money, evidence or
what is legally permitted.

## Which documentation does it answer from?

Only the guidance written for you. As a customer, that is the customer guidance and the public
policies. An investigator's assistant answers from investigator guidance, and staff procedures are
never used to answer anyone but staff, however a question is worded.

If you have switched to acting as one role, the assistant answers as that role only.

## Where do the sources in an answer come from?

Every answer lists the documents and sections it used, by title: the platform's own guidance that
the answer was written from, and nothing else.

If the assistant cannot point to a page that answers your question, it tells you it does not have
the answer rather than replying without a source.

## Can it answer in my language?

It answers in the language you choose. Where a help page has not been translated into that language
yet, it answers from the English page and says so.

## What happens to the question I ask?

To write an answer, the assistant sends your question, together with the guidance it found, to
the AI service that composes the reply. When you ask it to find investigators, it sends your
request — and your answer, if it asked what the search is for — together with the list of
investigation specialties, so the AI service can turn it into search requirements. The privacy policy names the services that process your
data and governs how they may use it. Where this answer and the privacy policy differ, the privacy
policy is correct.

The platform keeps a record that a question was answered and which pages were used, or, for a
search, which kinds of requirements were used and how many investigators were found. It does not
keep the question, the answer, the places or the results in that record.

Do not include personal details in a question about how the platform works. The assistant does not
need them to explain a rule.

## Can I rely on what it tells me?

For how the platform works, yes — it answers from this documentation, and it cites what it
used.

Not for legal advice, not for whether your specific request is lawful in your jurisdiction,
and not for what an investigation will find or cost. It will tell you when a question is
outside what it can answer.

## Why does it ask me questions?

Only when the answer genuinely depends on something it does not know, and never more than one
question at a time:

- **Where** — when you ask for someone near you but have not shared a location or named a place.
- **Which specialty** — when your request could mean more than one, and the choice changes who is
  listed. If everyone found offers all of them, it does not ask.
- **What it is for** — when a request could be for something the platform does not allow and does
  not say. Your answer is checked by the same fixed rules as your request.

If it can give you a useful answer with a stated assumption, it does that instead — for example,
searching every area when you have not mentioned one, and saying so. You can always narrow
afterwards.

## Who can see my conversations with the assistant?

Only you. A conversation belongs to you and to the workspace you started it in, and nobody else can
open it — not an investigator, not a colleague in an agency, not the agency's owner. If you switch
to another workspace, you see that workspace's conversations and not these.

## Can I come back to a conversation later?

Yes. Conversations are kept, and you can reopen one, rename it, archive it to tidy your list, or
bring an archived one back. When you return, the assistant works from what is true now — the state
of your missions and quotes today — rather than from what it told you last time.

## What happens when I delete a conversation?

Everything you and the assistant said in it is erased at once, and cannot be recovered. What
remains is only a record that a conversation existed and when you deleted it, with no title and no
content.

## Can I search my conversations?

Yes, by words in a conversation's title or in anything said in it. Search works in English, Russian
and Armenian, and matches words as you type them.

