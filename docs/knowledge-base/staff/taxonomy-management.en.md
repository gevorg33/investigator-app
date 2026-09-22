---
id: kb-staff-taxonomy-management
title: Maintaining the taxonomy
audience: staff
visibility: staff
locale: en
version: 1
status: current
updated: 2026-09-23
source_of_truth: database
implementation_status: implemented
related_code:
  - apps/api/src/modules/taxonomy
tags: [staff, taxonomy, categories, specialties, risk-band, labels]
---

# Maintaining the taxonomy

> This article explains how the taxonomy is maintained. The tree itself — which nodes exist, their
> labels and their risk bands — lives in the database and is read from there.

## What is the taxonomy, and why does changing it matter?

It is the single tree of kinds of investigation that both sides use. A customer files a mission
under a node; an investigator declares the nodes they practise. Matching is a join over those
nodes, walking the tree in both directions, and it decides who is eligible for work.

So a taxonomy change is not cosmetic. It changes what customers can choose, what investigators
can declare, and — through the risk band — how missions are moderated.

## Who can change it?

Staff holding the **taxonomy** scope, and nobody else. Being staff is not enough: a moderator
without the taxonomy scope is refused, and the refusal is recorded. Every change is made inside
platform access, which is recorded separately, and each one requires a written reason.

## What can I change about a node, and what can I not?

You can add a node, change its risk band, reorder it among its siblings, retire it, restore it,
and set its label in English, Russian or Armenian.

You cannot rename a node's slug or move it under a different parent. The slug is its permanent
name, and the parent is what matching walks: moving a node would silently change which
investigators every past mission under it could reach. If the tree needs restructuring, add the
new nodes and retire the old ones.

Nothing is ever deleted.

## How do I retire part of the tree?

Leaf first. A node that still has active children cannot be retired, because every active node
must sit under an active parent; retire the children, then the parent. The same rule works in
reverse: a node cannot be restored while its parent is retired.

Retiring a node removes it from every list customers and investigators choose from. It does not
touch anything that already uses it: missions filed under it keep it, investigators who declared
it keep it and still match, and it still displays wherever it is shown. Investigators simply
cannot newly add it.

## How do I choose a risk band?

The band decides how missions under the node are moderated. It is required when you add a node
— there is no default, because a node nobody banded would be treated as high risk anyway, and
the decision belongs to whoever is adding the node.

There are four, each at least as sensitive as the one before: **standard**, **elevated**,
**high** and **restricted**. Restricted is surveillance of a private individual in a personal
matter, including partner investigation.

Every mission is read by a moderator before it is published, whatever its band. A band of
**high** or **restricted** puts it in the priority queue. Which band a given kind of work belongs
in is decided in the taxonomy review, with licensing in view, not at the moment a node is added —
if you are unsure, the node is not ready to add.

## What happens if a label is missing in a language?

Customers and investigators see the English label instead, and the application knows it is
showing English. A node cannot be added without an English label for exactly this reason.

## What does the reason I write get used for?

It is stored with the change in the audit log, next to what changed — for example the band before
and after. When someone later asks why a category started going to priority review, that line is
the answer. Write it for that reader: a reference to the review or decision behind the change, not
"update".
