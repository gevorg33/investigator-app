#!/usr/bin/env python3
"""Validate knowledge-base frontmatter before ingestion.

Enforces .claude/skills/documentation-first/SKILL.md. Run in CI and before /ship.
Exit 1 on any error.
"""
import pathlib, re, sys, datetime

KB = pathlib.Path("docs/knowledge-base")
REQUIRED = ["id", "title", "audience", "visibility", "locale", "version",
            "status", "updated", "source_of_truth"]
ENUMS = {
    "audience":        {"customer", "investigator", "agency", "staff", "public"},
    "visibility":      {"public", "authenticated", "participant", "staff"},
    "locale":          {"en", "ru", "hy"},
    "status":          {"current", "superseded", "draft"},
    "source_of_truth": {"docs", "database"},
    # Optional, but when present it tells a reader whether the product does this yet — so a typo
    # that reads as neither must not pass (T-015).
    "implementation_status": {"specified", "partial", "implemented"},
}
# Folder -> the visibilities that make sense there. A staff runbook marked public
# is the failure this catches.
FOLDER_VIS = {
    "customer":     {"authenticated", "participant"},
    "investigator": {"authenticated", "participant"},
    # An agency owner need not be an investigator, so their articles are their own (T-083).
    "agency":       {"authenticated", "participant"},
    "staff":        {"staff"},
    "policies":     {"public"},
}

def parse_frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---\n", 3)
    if end == -1:
        return None
    fm = {}
    for line in text[4:end].splitlines():
        m = re.match(r"^([a-z_]+):\s*(.*)$", line)
        if m:
            fm[m.group(1)] = m.group(2).strip()
    return fm

# docs/operations/ is never ingested (T-015), and that is held by construction rather than by
# where a file happens to sit. Every operations document carries this marker; a file that carries
# it is refused here, so copying a runbook into the knowledge base fails CI rather than reaching
# the Assistant. The marker is an HTML comment: invisible when rendered, unmissable to this.
NOT_FOR_INGESTION = "<!-- not-for-ingestion -->"

errors, warnings, ids = [], [], {}
meta = {}  # (id, locale) -> {"version", "status"}, for the translation checks after the loop

if not KB.exists():
    # Not a pass: a knowledge base that has gone missing is not one that validates.
    print("docs/knowledge-base/ not found")
    sys.exit(1)

# A symlink is how a file outside the knowledge base — a runbook in docs/operations/ — would reach
# ingestion without being copied. Refused whatever it points at: nothing here needs one.
for link in sorted(p for p in KB.rglob("*") if p.is_symlink()):
    errors.append(f"{link.as_posix()}: symlinks are not allowed in the knowledge base")

files = sorted(p for p in KB.rglob("*.md") if p.name != "README.md" and not p.is_symlink())

for f in files:
    rel = f.as_posix()
    text = f.read_text(encoding="utf-8")
    if NOT_FOR_INGESTION in text:
        errors.append(f"{rel}: marked not-for-ingestion — operations content cannot be ingested")
    fm = parse_frontmatter(text)
    if fm is None:
        errors.append(f"{rel}: missing or unterminated frontmatter")
        continue

    for k in REQUIRED:
        if k not in fm or not fm[k]:
            errors.append(f"{rel}: missing required field '{k}'")

    for k, allowed in ENUMS.items():
        if k in fm and fm[k] not in allowed:
            errors.append(f"{rel}: {k}='{fm[k]}' not in {sorted(allowed)}")

    folder = f.relative_to(KB).parts[0] if len(f.relative_to(KB).parts) > 1 else ""
    vis = fm.get("visibility")
    if folder in FOLDER_VIS and vis and vis not in FOLDER_VIS[folder]:
        errors.append(f"{rel}: visibility='{vis}' is wrong for {folder}/ "
                      f"(expected one of {sorted(FOLDER_VIS[folder])})")

    if fm.get("updated"):
        try:
            datetime.date.fromisoformat(fm["updated"])
        except ValueError:
            errors.append(f"{rel}: updated='{fm['updated']}' is not YYYY-MM-DD")

    key = (fm.get("id"), fm.get("locale"))
    if key[0]:
        if key in ids:
            errors.append(f"{rel}: duplicate id+locale, also in {ids[key]}")
        ids[key] = rel
        meta[key] = {"version": fm.get("version", ""), "status": fm.get("status")}

    if fm.get("status") == "current" and fm.get("version") in (None, "", "0"):
        errors.append(f"{rel}: current document needs a version")

    body = text
    # An English draft is unfinished work, and says so. A translation draft is the state every
    # translation waits in until a native speaker has reviewed it (T-026), so it is counted in the
    # coverage line instead — otherwise a whole locale awaiting review is 36 lines of noise.
    if fm.get("status") == "draft" and fm.get("locale") == "en":
        warnings.append(f"{rel}: status=draft — not ingested until set to current")
    # Headings should be in the user's voice, so a chunk matches how someone asks.
    # Two valid shapes: a question ("Can I cancel?") or a first-person symptom
    # statement ("I cannot sign in"), which is how troubleshooting is searched. Armenian marks a
    # question with `՞` over the stressed word, not `?` at the end, so it is looked for anywhere.
    user_voice = re.search(r"^##\s+.+\?\s*$", body, re.M) or \
                 re.search(r"^##\s+.*\u055e", body, re.M) or \
                 re.search(r"^##\s+(I|My|Nothing|Something"
                           r"|Я|Мой|Моя|Моё|Мои|Мне|Не|Ничего|Что-то"
                           r"|Ես|Իմ|Չեմ|Ոչինչ|Ինչ-որ)(?=\s|$)", body, re.M)
    if not user_voice:
        warnings.append(f"{rel}: no user-voice '## ' heading (a question, or a first-person "
                        f"symptom) — chunks retrieve worse")

# --- Locale parity -----------------------------------------------------------
# Translations share an `id` with their source and differ in `locale`. A missing
# translation is reported as coverage, not as a warning per file — otherwise an
# untranslated corpus produces pure noise. An *orphan* (a translation whose `en`
# source is gone) is a real error: retrieval would serve content with no
# authoritative original.
LOCALES = ["en", "ru", "hy"]
by_id = {}
for (doc_id, loc), path in ids.items():
    by_id.setdefault(doc_id, {})[loc] = path

for doc_id, locs in sorted(by_id.items()):
    if "en" not in locs:
        for loc, path in sorted(locs.items()):
            errors.append(f"{path}: orphan translation — no 'en' source for id '{doc_id}'")

# A translation carries the version of the English it was translated from (T-026). Newer than its
# source is impossible, so an error. Older means the English has moved on: a *current* translation
# would then answer from superseded text, so that is a warning; a draft is not served, so it is
# counted with the drafts and reviewed with them.
stale_drafts = {loc: 0 for loc in LOCALES}
drafts = {loc: 0 for loc in LOCALES}
for doc_id, locs in sorted(by_id.items()):
    src = meta.get((doc_id, "en"))
    for loc, path in sorted(locs.items()):
        if loc == "en" or src is None:
            continue
        tr = meta[(doc_id, loc)]
        if tr["status"] == "draft":
            drafts[loc] += 1
        if not (tr["version"].isdigit() and src["version"].isdigit()):
            continue
        if int(tr["version"]) > int(src["version"]):
            errors.append(f"{path}: version {tr['version']} is newer than its English source "
                          f"({src['version']})")
        elif int(tr["version"]) < int(src["version"]):
            if tr["status"] == "draft":
                stale_drafts[loc] += 1
            else:
                warnings.append(f"{path}: translated from version {tr['version']}, but the "
                                f"English is at {src['version']} — retranslate before it answers "
                                f"from superseded text")

coverage = {loc: sum(1 for l in by_id.values() if loc in l) for loc in LOCALES}
total = len(by_id)

def describe(loc):
    notes = []
    if coverage[loc] != total:
        notes.append("incomplete")
    if drafts[loc]:
        notes.append(f"{drafts[loc]} draft" + (f", {stale_drafts[loc]} behind English"
                                               if stale_drafts[loc] else ""))
    return f"{loc} {coverage[loc]}/{total}" + (f" ({'; '.join(notes)})" if notes else "")

print(f"knowledge-base: {len(files)} document(s), {total} unique id(s)")
print("locale coverage: " + "  ".join(describe(loc) for loc in LOCALES))

for w in warnings:
    print(f"  WARN  {w}")
for e in errors:
    print(f"  ERROR {e}")
print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)
