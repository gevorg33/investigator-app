---
id: kb-agency-employees
title: Your agency's employees — inviting, roles, teams, suspending and removing
audience: agency
visibility: authenticated
locale: en
version: 4
status: current
updated: 2026-10-02
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/tenants/employees
  - apps/api/src/database/migrations/0028_add_employees.sql
  - apps/api/src/modules/teams
  - apps/app-web/src/app/(auth)/invitations
  - apps/app-web/src/components/agency/console
tags: [agency, employees, invitations, roles, members, suspend, remove, teams]
---

# Your agency's employees — inviting, roles, teams, suspending and removing

## How does someone join my agency?

By invitation. An owner or admin invites them by email and chooses the role they start with. They
get a link that works once and for 7 days. They join by opening it while signed in to an account
with that email address, confirmed. Nobody can join an agency any other way.

If they have no account yet, they create one with that address, confirm it, and then open the link.

## What happens when I open an invitation link?

A page asks you to join, with a **Join the agency** button. Nothing happens until you press it, so a
mail program that checks links cannot use the invitation up. Once you join, the app switches you
into the agency and says so on Home; the agency is then in your workspace menu, next to Personal.

If you are signed out, the page asks you to sign in or create an account with the address the
invitation was sent to, and brings you back to it afterwards. If you have just created the account,
confirm your address from the email first, then choose **Continue** on the "check your email" page.
If the page says the invitation cannot be used, it was sent to another address than the one you are
signed in with, or it was used, cancelled or has expired: ask the agency to send it again.

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

## What are teams for?

A team groups members of your agency — by place, by kind of work, however you organise. A member can
be in several teams. Teams do not give anyone extra permissions; what someone may do comes from
their roles. As features arrive, teams decide which cases a member sees and who is notified.

Owners, admins and managers create, rename and delete teams and put members in or take them out;
every member can see them. Two teams in one agency cannot have the same name. Deleting a team does
not remove anyone from the agency.

A suspended member stays in their teams. A removed member is taken out of every team, and cannot be
put back in one unless they rejoin the agency.

## Can the last owner leave?

No. An agency always keeps at least one active owner. To step down, make someone else an owner first.

## What details can be kept about an employee?

A job title and a department, and a language and time zone for their work in this agency that differ
from their account's own. Their name and email are always their account's — the agency does not keep
its own copy.

## Where is this in the app?

Working in your agency, open **Account** and choose **People**, **Teams** or **Investigators** — or
move between them, and the agency's profile, with the links at the top of each of those pages.

- **People** lists every member: their roles, whether they are active or suspended, and their job
  title. On a phone each member is a card; on a wide screen, a row. **Manage** opens a sheet with their
  details, their roles and their access. Suspending or removing someone is asked first, in that sheet,
  by their name, and says what follows; reactivating is not asked, because it takes nothing away.
- **Invitations**, on the same page, sends an invitation by email with the role it starts with, and
  lists the invitations still waiting or expired, each with **Send again** and **Cancel**. Cancelling
  is asked first. An accepted invitation is a member in the list above.
- **Teams** creates a team, renames it, puts members in and takes them out, and deletes a team once
  you confirm its name.

If your role does not include an action, the page says so where you tried it: ask an owner or admin.
Every action works by tapping — nothing depends on hovering.
