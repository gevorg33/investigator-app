---
id: kb-agency-profile-and-branding
title: Your agency's public profile, settings and branding
audience: agency
visibility: authenticated
locale: en
version: 3
status: current
updated: 2026-09-27
source_of_truth: docs
implementation_status: partial
related_code:
  - apps/api/src/modules/tenants/profile
  - apps/api/src/modules/tenants/settings
  - apps/api/src/modules/media
  - apps/app-web/src/components/agency
tags: [agency, profile, branding, settings, logo, publishing]
---

# Your agency's public profile, settings and branding

## What is the agency's public profile?

It is how people on the platform see your agency: the name it is shown under, a one-line headline,
an about text, your country, and a logo and a cover image. Nothing else about the agency is part of
it — not your business email, currency or time zone, not your settings, not your employees, and
not your customers or anything about money.

## Where do I edit it?

Switch to your agency, then open **Account → Agencies → Agency profile and colours**. The page has
two parts: the public profile, and the agency's colours.

- Change the name customers see, the headline and the about text, then choose **Save profile**.
- **Preview as customers see it** shows the profile exactly as it will appear — including changes
  you have not saved yet.
- **Publish** shows it to everyone signed in. It is offered once everything publishing needs is
  there, and it publishes what is saved, so save your changes first. Once published, **Open the
  public page** shows it as customers see it.
- Under **Colours**, enter each colour as # and six characters, or leave it empty for the
  platform's own. **How they look** shows the saved colours on a light background, as reports and
  emails will.

If your role in the agency does not include the profile or the settings, the page says so instead
of showing a form.

## Who can see it?

Nobody outside your agency, until you publish it. Before that it is a draft: your members can read
it, and nobody else can — not the profile, and not its logo or cover either.

Once published, anyone signed in to the platform can see it. Unpublishing takes it back to a draft
straight away; nothing you wrote is lost.

A suspended or archived agency's profile is not shown, even if it was published.

## Who can change it?

- **Owners and admins** can change the profile, and publish or unpublish it.
- **Every member** can read it, published or not.

## What does it need before I can publish it?

Two things:

- **The agency is fully set up** — its name, country, business email, time zone and currency are
  all filled in.
- **It has a headline**, so that what people find says what your agency does.

The shown name is optional: without one, your agency's registered name is used. While the profile
is published it must keep its headline; to remove the headline, unpublish first.

## How do the logo and cover work?

Upload them as the agency's own images: JPEG, PNG or WebP, up to 2 MB for the logo and 5 MB for the
cover. Owners and admins can upload them. Then choose them for the profile.

An image is shown only once it has been checked for malware. Until that check reports it clean, the
profile shows no logo or cover rather than an unchecked file. Images are delivered through links that
last a few minutes, so a copied link stops working soon after.

## What are the agency's settings?

Private settings that belong to the agency, grouped into sections: general, branding, localisation,
notifications, AI, investigations, employees, security, privacy, integrations and billing.

**Nothing has to be set to use the platform.** Every section has defaults. Today branding has
settings in it, and general has one — whether the setup checklist on Home is hidden. The other
sections fill in as the features that use them arrive, and billing is reserved.

## What is the checklist on Home?

When you own an agency, Home lists what is left of its setup: completing the agency's details and
publishing its public profile. Each item takes you to where it is done and is ticked when it is.
"Hide this list" hides it for the agency, on every device. Nothing on it is required to keep
working.

Owners and admins can change settings; managers can read them.

## What can I change about how the agency looks?

Two colours, in the branding section:

- **Accent colour** — used for your agency's highlights on light backgrounds, such as reports and
  emails.
- **Report header colour** — the band at the top of your reports.

Colours are checked for contrast before they are saved, so they can never make anything
unreadable. An accent must stand out clearly from a light page, and text on either colour must be
easy to read — white or dark text is chosen for you, whichever reads better. A colour that fails is
refused with the reason.

The platform's own layout and controls never change per agency. Branding is these colours, your
logo and cover, and the name you are shown under.

## If two people edit at once?

The second save is refused rather than silently overwriting the first. Reload to see the latest
version, then make your change again.
