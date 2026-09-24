---
id: kb-customer-account-access-and-security
title: Signing in, verifying your email, resetting your password and managing sessions
audience: customer
visibility: authenticated
locale: en
version: 2
status: current
updated: 2026-09-25
source_of_truth: docs
implementation_status: implemented
related_code:
  - apps/api/src/modules/account
  - apps/app-web
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

Ask for a new link. Right after signing up, the **Check your email** page has a **Nothing
arrived?** form for it. Once signed in, **Account → Your details** shows whether your address is
confirmed and offers **Send the confirmation link again**. A few things to check first:

- Look in spam or promotions — verification mail often lands there.
- Confirm the address you typed. A mistyped address means the message went somewhere else,
  and we cannot tell you whether an address is registered, so nothing will look wrong.
- Wait a few minutes. Delivery is usually quick but not instant.

There is a limit on how often a new link can be requested for the same address, so if you
ask repeatedly in quick succession, later requests are declined for a while.

Opening the link does not confirm the address by itself: the page asks you to press **Confirm my
email address**. Email services open links to check them for danger, and a link that confirmed on
opening would be used up before you ever saw it.

## How do I reset my password?

Choose **Forgot your password?** on the sign-in screen, enter your address, and open the link that
arrives. The link lets you set a new password once, and expires after one hour.

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

Under **Account → Where you are signed in**. Each session shows the browser and operating system
(for example "Chrome on macOS"), when it was last used, and when it signed in — in your time zone.
The device you are using now is listed first and marked **This device**.

The list does not show IP addresses or locations: a device and a time are what you need to
recognise a session. It never shows anything that could be used to sign in.

## How do I sign out a device I do not recognise?

Press **Sign out** next to it. It stops working immediately rather than at the end of some
countdown, so a revoked session cannot be used again even seconds later.

If you see a session you cannot account for, sign it out and change your password. Changing
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

## Where does signing in take me?

Back to the page you were trying to open. If you followed a link into the platform while signed
out, you are asked to sign in and then taken to that page, not to the start.

When you are already signed in, the sign-in and sign-up pages send you straight on.

## Why does the sign-in screen not say whether my email or my password was wrong?

For the same reason the reset screen answers the same for every address: saying "no such account"
would tell anyone who typed your address that you have none — and saying "wrong password" would
tell them you do. Every refusal reads the same.

## Does the platform remember my language on another device?

Yes. The language you choose while signed in is saved to your account, and signing in on another
device or browser switches to it. The language you sign up in is saved as your first choice.

Before you sign in, the language buttons at the bottom of the sign-in screen change the language
for that browser only.

## Which time zone are dates and times shown in?

Your account's. It is set from your device when you sign up, and you can change it under
**Account → Time zone**. If your device is set to a different zone — after travelling, say — the
page offers to switch to it in one press, or you can choose any zone from the list.

## Why am I asked to accept a document again?

When a new version of a document you accepted comes into force and the change is significant, you
are asked to read and accept the new version. A notice appears at the top of every screen with a
**Review** link to **Account → Documents to accept**, where each document can be read in full
before you accept it.

This does not lock you out. Only the actions a document covers wait for it — adding the
investigator role, for example, asks you to accept the investigator agreement first. The
documents themselves are what govern; this article only describes how acceptance works.
