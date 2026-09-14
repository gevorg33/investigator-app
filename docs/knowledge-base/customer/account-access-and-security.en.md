---
id: kb-customer-account-access-and-security
title: Signing in, verifying your email, resetting your password and managing sessions
audience: customer
visibility: authenticated
locale: en
version: 1
status: current
updated: 2026-09-13
source_of_truth: docs
implementation_status: implemented
related_code:
  - apps/api/src/modules/auth
tags: [account, sign-in, password, email-verification, sessions, security]
---

# Account access and security

## How do I verify my email address?

When you register we send a verification link to the address you signed up with. Opening it
confirms the address and activates the account.

The link works once. Opening it a second time does nothing, because it is consumed the
moment it is used — if it still worked afterwards, anyone who later saw the message could
use it too.

It stays valid for 24 hours. After that you can ask for a new one, and requesting a new
link cancels the previous one, so only the most recent message works.

## I never received the verification email. What now?

Ask for a new link from the sign-in screen. A few things to check first:

- Look in spam or promotions — verification mail often lands there.
- Confirm the address you typed. A mistyped address means the message went somewhere else,
  and we cannot tell you whether an address is registered, so nothing will look wrong.
- Wait a few minutes. Delivery is usually quick but not instant.

There is a limit on how often a new link can be requested for the same address, so if you
ask repeatedly in quick succession, later requests are declined for a while.

## How do I reset my password?

Ask for a reset link from the sign-in screen and open it. The link lets you set a new
password once, and expires after one hour.

The window is shorter than for verification on purpose: a reset link is effectively a
temporary key to the account, so it should be usable for as little time as possible.

## Why does the reset screen say the same thing whether or not my address is registered?

Because telling you otherwise would tell anyone else too. If the response differed, someone
could enter addresses one at a time and learn which belong to accounts here — and given
what this platform is used for, that alone can be sensitive.

So the confirmation is identical either way. If the address is registered, a message
arrives. If it is not, nothing is sent.

## What happens to my other devices when I reset my password?

Every session is signed out — every browser, every device, including the one you used to
do the reset.

This is deliberate. People often reset a password precisely because someone else may have
had it. Leaving existing sessions alive would let whoever it was keep their access, since
an active session does not need the password again.

You will need to sign in with the new password afterwards.

## Where can I see the devices that are signed in?

Your account settings list every active session with the approximate location, the browser
or app, when it started, and when it was last used. The session you are currently using is
marked.

The list never shows anything that could be used to sign in — only a description of the
session.

## How do I sign out a device I do not recognise?

Select it in that list and revoke it. It stops working immediately rather than at the end
of some countdown, so a revoked session cannot be used again even seconds later.

If you see a session you cannot account for, revoke it and change your password. Changing
the password sweeps every other session as well, which is the surer move if you are unsure
which entry is the problem.

## Why was I signed out of one device but not the others?

Signing out affects only the session you sign out. Each browser and device holds its own,
so the rest stay active. To end all of them, either revoke them individually or change your
password.

## My email address was rejected and I cannot see anything wrong with it

Some characters have no visible form — zero-width marks, direction overrides, and a few
kinds of invisible space. They can be picked up by copying an address out of a document or
a chat message without anyone intending it.

We reject addresses containing them. Two addresses that differ only by an invisible
character look identical to everyone who reads them but are different addresses, which
would let one account be mistaken for another. Given what this platform is used for, being
sure which account you are dealing with matters more than accepting an unusual address.

If this happens, type the address by hand rather than pasting it.

Addresses in other scripts are fine — this is not a restriction to English or to Latin
characters, and surrounding spaces are simply trimmed rather than refused.

## Why does signing in sometimes stop working after several failed attempts?

Repeated failures against the same account, or from the same network, are slowed down for a
while. It protects accounts from having passwords guessed at speed.

Waiting clears it. If you cannot recall the password, a reset is faster than continuing to
guess.
