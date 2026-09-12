# The harness

How the pieces fit, and how to change them.

## Layers

```
CLAUDE.md          Always in context. Small on purpose — principles and pointers only.
AGENTS.md          Who does what. Delegation, concurrency, approval gates.
TODO.md            The work queue. One task at a time.

.claude/
├── settings.json  Permissions and hook wiring. Checked in, shared.
├── agents/        12 specialists. Loaded when delegated to.
├── skills/        18 procedures. Loaded on demand by name or description match.
├── commands/      9 slash commands. Explicit entry points.
└── hooks/         4 scripts. Deterministic enforcement — these do not rely on the model.
```

The division that matters: **CLAUDE.md is for things that must always be true. Skills are
for procedures you follow sometimes.** Putting a procedure in CLAUDE.md costs context on
every turn and gets skimmed; putting it in a skill means it arrives complete, when needed.

## Why the hooks exist

Instructions are advisory — a model can misread one. Hooks are not. `guard-secrets.sh`
blocks reading `.env`, private keys and backups, and blocks destructive SQL, force pushes
and remote-pipe-to-shell, regardless of what any instruction says.

It scans a *command skeleton* with heredoc bodies stripped, so documentation that mentions
a dangerous string is not blocked while a command hidden after a heredoc still is.

Test it after changing it:

```bash
python3 .claude/hooks/test-guard.py
```

Hooks fail closed. If a legitimate command is blocked, amend the hook deliberately — do
not work around it.

## Adding a skill

```
.claude/skills/<name>/SKILL.md
```

```yaml
---
name: <name>
description: <what it covers AND when to use it — this is what triggers loading>
---
```

The description does the work. Write it as "X — use when Y", naming the concrete triggers
(file paths, operations, symptoms). A vague description means the skill never loads.

Keep a skill to one coherent procedure. Two procedures means two skills.

## Adding an agent

```
.claude/agents/<name>.md
```

```yaml
---
name: <name>
description: <what it does and when to delegate to it>
tools: Read, Grep, Glob, Bash, Edit, Write   # omit Edit/Write for reviewers
model: opus
---
```

Review agents get read-only tools. That is not a formality — it keeps review independent
of authorship, so a reviewer cannot quietly fix what it should be reporting.

## Adding a command

```
.claude/commands/<name>.md   →   /<name>
```

Frontmatter: `description`, `argument-hint`, `allowed-tools`. Body uses `$ARGUMENTS`, or
`$1`/`$2` for positional args.

## Day-to-day

```
/task-status     What's in flight, blocked, or next
/next-task       Select and start the next eligible task
/verify          Run the task's validation, report real output
/ship            Pre-merge gate, then update TODO.md
```

And when the work calls for it:

```
/new-module <name>        Scaffold a NestJS module
/new-migration <change>    Reversible migration, approval-gated if destructive
/authz-audit [scope]       Find IDOR gaps and missing authorization tests
/ai-tool <name>            Add or review an AI tool against the registry contract
/threat-model [scope]      Security review of the current diff
```

## Local overrides

```bash
cp .claude/settings.local.json.example .claude/settings.local.json
```

Gitignored. Per-developer permissions and non-secret env. **Never put a secret there** —
Claude Code reads that file.

## Keeping it honest

This harness encodes decisions from `plan.md`. When a decision changes, the skill changes
with it. A skill that contradicts the code is worse than no skill: it is confidently wrong
and it will be followed.

If you find a rule here that the codebase no longer follows, that is a finding — either
the code drifted or the rule did. Resolve it rather than leaving both.
