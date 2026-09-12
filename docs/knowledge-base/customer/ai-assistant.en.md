---
id: kb-customer-ai-assistant
title: What the AI assistant can and cannot do
audience: customer
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-12
source_of_truth: docs
implementation_status: specified
related_code:
  - apps/api/src/modules/ai
tags: [assistant, ai, help, limitations]
---

# The AI assistant

## What can the assistant help me with?

Answering questions about how the platform works, finding investigators who match what you
need, explaining your missions, quotes, assignments and payment status, helping you draft a
mission description, and explaining platform policies.

It answers in your selected language.

## How does it find investigators for me?

It queries live investigator data using the requirements you give — location, specialty,
services, availability, language — and returns those who genuinely match. It then tells you
which of your requirements each one met, and which they did not.

It does not guess. If an investigator does not offer a service you asked for, it says so
rather than omitting it.

## Can it tell me what an investigation will cost?

No. Investigators price each mission individually, and there is no rate list for the
assistant to read. Any figure it produced would be invented.

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

## Can I rely on what it tells me?

For how the platform works, yes — it answers from this documentation, and it cites what it
used.

Not for legal advice, not for whether your specific request is lawful in your jurisdiction,
and not for what an investigation will find or cost. It will tell you when a question is
outside what it can answer.

## Why does it ask me questions?

Only when the answer genuinely depends on something it does not know — most often a
location, when you have asked for investigators nearby.

If it can give you a useful answer with a stated assumption, it should do that instead of
interrogating you. You can always narrow afterwards.
