---
id: kb-agency-employees
title: Your agency's employees — inviting, roles, suspending and removing
audience: agency
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-27
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/tenants/employees
  - apps/api/src/database/migrations/0028_add_employees.sql
tags: [agency, employees, invitations, roles, members, suspend, remove]
---

# Your agency's employees — inviting, roles, suspending and removing

## How does someone join my agency?

By invitation. An owner or admin invites them by email and chooses the role they start with. They
get a link that works once and for 7 days. They join by opening it while signed in to an account
with that email address, confirmed. Nobody can join an agency any other way.

If they have no account yet, they create one with that address, confirm it, and then open the link.

## Can someone else use the link?

No. An invitation can only be accepted by the account with the address it was sent to, and only once
that address is confirmed. For anyone else — or once the link has been used, cancelled or has
expired — it simply is not found.

## The link did not arrive, or it expired. What now?

An owner or admin can send the invitation again. Sending again creates a new link and gives another
7 days; the old link stops working. They can also cancel an invitation, which ends it straight away.

Inviting an address whose invitation has expired sends a fresh one. An address that already has a
live invitation, or already belongs to a member, cannot be invited again.

## What can each role do?

The roles are owner, admin, manager, investigator, staff and viewer. What each one may do is listed
in the permissions table your agency's owner sees, and it is the same for every agency. A member can
hold more than one role.

## Who can manage employees?

Owners and admins can invite people, change their details and roles, suspend, reactivate and remove
them. Every member can see who is in the agency.

**Nobody can make someone more than they are themselves.** You can only give a role whose every
permission you hold, and you can only act on a member who holds nothing you do not. So an admin can
invite and manage admins and everyone below, but cannot make anyone an owner, and cannot change,
suspend or remove an owner.

## What does suspending do?

A suspended member cannot use the agency from their very next action. Their roles and details are
kept, so reactivating them puts everything back. You cannot suspend yourself.

Their conversations with the assistant in the agency are closed when they are suspended.

## What does removing do?

A removed member loses access from their very next action, and their roles are taken away. The
record that they were a member stays, so what they did is still attributed to them. To have them back,
invite them again: they rejoin as the same member, with the role the new invitation gives.

A suspended member cannot get round a suspension by accepting a new invitation — the agency has to
reactivate them.

## Can the last owner leave?

No. An agency always keeps at least one active owner. To step down, make someone else an owner first.

## What details can be kept about an employee?

A job title and a department, and a language and time zone for their work in this agency that differ
from their account's own. Their name and email are always their account's — the agency does not keep
its own copy.

## Where is this in the app?

The screens for managing employees are still being built. What this article describes is how it
works, and the app will follow it.
