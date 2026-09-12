# Brief for counsel — platform facts and open questions

Prepared by engineering to support drafting of the Privacy Policy, Terms of Service,
Terms & Conditions and Lawful Use Policy. Not legal advice.

Purpose: state what the platform actually does, so the drafting starts from the product
rather than from assumptions, and identify the decisions that block completion.

---

## 1. What the platform is

A marketplace connecting customers with independent private investigators. Customers post
missions; verified investigators submit quotes; the customer accepts one and pays; the
investigator delivers evidence and a written report through the platform.

Launch locales are English, Russian and Armenian. Launch countries are not yet fixed.

## 2. What the platform actually does — relevant to the "mere conduit" position

The intended positioning is a neutral connection platform. Counsel should assess that
against what the platform in fact does, since several of these go beyond passive
facilitation:

- **Verifies investigators.** Identity and professional documents are checked by staff, and
  a "verified" status is displayed to customers. This is a representation.
- **Excludes investigators from results** on verification, licensing scope and availability.
  This is editorial control over who is presented.
- **Screens missions** and rejects those assessed as unlawful, deterministically and by
  staff review. This is content moderation with recorded decisions.
- **Holds funds** between customer payment and investigator payout.
- **Adjudicates disputes** and can order full or partial refunds.
- **Stores the evidence** produced by investigations, including personal data about third
  parties who are not users.
- **Suspends and terminates accounts** for conduct.

Each of these is defensible and probably desirable. Together they may make a pure
intermediary shield unavailable in some jurisdictions. Counsel should advise on how far the
marketplace framing can be asserted, and what the documents must say instead where it cannot.

## 3. Personal data processed

**Account data** — name, email, password hash, phone where provided, locale, role(s),
session and device metadata, IP addresses.

**Investigator data** — identity documents, professional licences and registrations, service
areas (geographic), specialties, services, languages, availability, pricing, ratings.

**Mission data** — free-text descriptions written by customers, which routinely contain
personal data about **third parties who are not users of the platform and have not
consented**. Locations. Attachments.

**Evidence** — photographs, video, documents and records produced by investigators.
Frequently contains identifiable third parties, including incidental bystanders. Capture
timestamps and, where lawful, capture locations.

**Reports** — findings about identifiable people.

**Communications** — messages between customer and investigator, and their attachments.

**Financial** — payment and payout records, ledger entries. No raw card data is stored; card
handling is with the payment provider.

**Operational** — audit logs of significant actions, including staff access to evidence.

The third-party data point is the most significant. The people an investigation concerns are
data subjects with rights, and they have no account, no notice, and no relationship with the
platform.

## 4. Access model

- Evidence and reports are private by default, with no public URLs. Access is by short-lived
  authorized link issued after a permission check.
- Customer and assigned investigator see an assignment's evidence. Nobody else by default.
- Staff access requires an explicit recorded grant tied to a reason, and is visible to the
  customer in their access log. There is no administrative browse mode.
- All sensitive access is audited.

## 5. Retention

Retention periods are **not yet set** and are a blocking decision. Categories requiring a
period:

identity and verification documents · evidence · reports · mission descriptions · messages
and attachments · financial and ledger records · audit logs · consent records · data of
deleted accounts

Note that consent records are intended to survive account deletion, as proof of the basis on
which processing occurred.

## 6. Consent mechanism (built by engineering)

Versioned documents with immutable published text. Append-only consent records storing the
document type, version, **content hash of the exact text shown**, locale shown, timestamp,
IP and user agent, and the context (registration, re-acceptance, role activation).

Registration cannot complete without acceptance, enforced server-side in the same
transaction that creates the account. Investigator-specific documents are accepted at role
activation. Material changes require re-acceptance; materiality is flagged by the compliance
owner, never inferred by code.

---

## Open questions blocking completion

### Jurisdiction and governing law
1. Which countries at launch? This determines nearly everything below.
2. Governing law and forum for platform–user disputes.
3. Does the platform contract with users from one entity, or per-region entities?
4. Consumer-protection regimes that override chosen law for customers.

### Regulatory status of the activity
5. Do any launch jurisdictions regulate private investigation such that **facilitating** it
   is itself a regulated or licensed activity?
6. Where investigator licensing is required, what is the platform's obligation — verify
   only, or verify and monitor? Our verification creates a representation either way.
7. Any obligation to report suspected unlawful requests to authorities, and in which
   jurisdictions?

### Data protection
8. Is the platform controller, processor, or joint controller for evidence content? The
   investigator determines what is collected; the platform determines storage, access and
   retention. This is likely joint controllership and drives most of the privacy policy.
9. Lawful basis for processing third-party data in missions, evidence and reports —
   legitimate interests assessment presumably required, and it needs documenting.
10. Do we owe notice to third parties who are investigation subjects? Under GDPR-style
    regimes the indirect-collection notice obligation has exemptions, and which applies
    matters a great deal here.
11. How are subject access, erasure and objection requests handled when the requester is an
    investigation subject rather than a user? An erasure request against evidence in an
    active dispute is a foreseeable conflict.
12. Cross-border transfer mechanism, given Armenian, Russian and other data-protection
    regimes plus the hosting location.
13. Russian data-localisation requirements, if Russian users are in scope.

### Commercial terms
14. Refund and cancellation floor — is there a platform-level minimum, or is it entirely per
    quote?
15. Platform fee structure and how it is disclosed.
16. Whether the platform is party to the customer–investigator contract or merely
    facilitates it. This determines who the customer's counterparty actually is.
17. Chargeback allocation between platform and investigator.
18. Tax treatment and any reporting obligations regarding investigator earnings.

### Enforcement and bans
19a. **Lawful basis for retaining a ban record after account deletion.** A permanent ban that a
    user defeats by deleting and re-registering is not a ban. The proposed mechanism stores a
    **salted hash of the verified identity** — enough to block re-registration, not enough to
    identify the person. Confirm the basis (fraud and safety prevention under legitimate
    interests is the expected route), the retention period, and whether the hash is personal
    data in the launch jurisdictions.
19b. **Notice, response and appeal periods** for a permanent ban.
19c. **Evidentiary standard** for a career-affecting ban.
19d. **Set-off** — whether withholding amounts owed against a customer refund claim is
    enforceable in each launch jurisdiction. A ban is not a fine, and money earned for work
    delivered is owed.

### Liability
19. How far can liability be limited for each user class, given consumer protections in
    scope?
20. Insurance requirements for investigators — required, recommended, or verified?
21. Platform exposure where a verified investigator acts unlawfully. Verification is the
    exposure point.

### Documents
22. Single combined instrument or separate ToS / T&C as drafted here?
23. **Which locale is authoritative** where the three translations differ?
24. Notice period for material changes.
25. Minimum age, and any capacity requirements.
