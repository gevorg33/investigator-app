---
description: Security review of the current changes against the platform threat model
argument-hint: "[path or module to focus on]"
allowed-tools: Read, Grep, Glob, Bash
---

Load the `platform-security-review` skill. If the scope is a deploy, an environment, CI, or the repository rather than a code change, load `launch-hardening` instead. Scope: $ARGUMENTS (if empty, `git diff` against the
base branch).

Read-only. You report; the owning agent fixes.

Work the checklist in order — authorization, media and evidence, input, data exposure, AI,
payments, operational. Do not skip a section because it "looks unrelated"; check it and
say it is clean.

Pay particular attention to the adversaries that actually apply here:
- A customer reaching another customer's mission or evidence
- An investigator reaching an assignment they were not given
- Evidence served without a grant, or a delivery URL that outlives its purpose
- A prompt injection making the assistant act outside the caller's scope
- Staff viewing evidence without an audited, customer-visible grant
- A webhook replay producing a second payout

For each finding give: severity, the **concrete failing scenario** with specific actor,
inputs and state, file and line, and the smallest correct fix. If you cannot state the
failing scenario, it is not a finding — leave it out.

End with an explicit verdict: **safe to merge** or **blocked**, and if blocked, the
minimum set of fixes that unblocks it.
