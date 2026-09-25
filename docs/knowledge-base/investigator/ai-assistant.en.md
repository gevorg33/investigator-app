---
id: kb-investigator-ai-assistant
title: The AI assistant, for investigators
audience: investigator
visibility: authenticated
locale: en
version: 2
status: current
updated: 2026-09-25
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/ai
  - apps/api/src/modules/ai-sessions
  - apps/api/src/modules/knowledge
  - apps/app-web/src/components/assistant
tags: [assistant, ai, help, limitations]
---

# The AI assistant, for investigators

## What can the assistant do for me?

In the app today, it answers questions about how the platform works for investigators — getting
verified, finding and quoting on missions, assignments, evidence, reports and payouts — from the
investigator guidance, and shows which sections it used.

It cannot see your missions, quotes or assignments yet, and it does nothing on your behalf. It does
not give legal advice, and it cannot tell you whether a particular piece of work is lawful where you
work.

It answers in your selected language.

## How do I open it?

Choose **Assistant** in the navigation. On a phone it opens over the screen you are on; on a wider
screen it opens beside the page, so you can keep a mission open while you ask. Closing it keeps the
conversation for when you open it again.

## Which guidance does it answer from?

The guidance written for investigators, and the public policies. If you hold both roles and have
chosen to use the platform as a customer, it answers as a customer until you switch back.

## Does it remember what I asked a moment ago?

Not yet. Each question is answered on its own, so ask each one in full — "how long do I have to
respond to a dispute?", not "and for disputes?". The conversation itself is kept, so you can read it
back.

## What does it show while it works?

What it is doing: searching the guidance, then writing from the sections it found. The answer
appears only once its sources have been checked. If the guidance does not cover your question, it
says so rather than guessing.

## What if I stop it, or it cannot answer?

Stop an answer at any time; your question stays, and **Try again** answers it. If the assistant is
unavailable, a question that reached the platform is kept and Try again answers it; one that never
arrived is shown as not sent, and Try again sends it.

## Who can see my conversations with the assistant?

Only you, in the workspace you started them in. In an agency, not your colleagues and not the
agency's owner.

A conversation is named from the first words of your first question in it — never from anything the
assistant wrote or looked up.

## Can I find an earlier conversation?

Yes. **Your conversations** (the list button at the top of the assistant) shows every conversation,
most recent first, and searches them by name or by anything said in them. A result opens where the
words first appear. From a conversation's options (⋯) you can rename it, archive it — it stays under
**Archived** and can be brought back — or delete it, which asks first and cannot be undone.

## Is what I ask kept?

Your questions and the assistant's answers are kept in your conversation until you delete it. To
write an answer, your question is sent, together with the guidance found for it, to the AI service
that composes the reply; the privacy policy names that service. Do not put a customer's personal details in a question about how
the platform works — the assistant does not need them to explain a rule.
