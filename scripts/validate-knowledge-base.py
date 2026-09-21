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

errors, warnings, ids = [], [], {}

if not KB.exists():
    print("docs/knowledge-base/ not found")
    sys.exit(0)

files = sorted(p for p in KB.rglob("*.md") if p.name != "README.md")

for f in files:
    rel = f.as_posix()
    fm = parse_frontmatter(f.read_text(encoding="utf-8"))
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

    if fm.get("status") == "current" and fm.get("version") in (None, "", "0"):
        errors.append(f"{rel}: current document needs a version")

    body = f.read_text(encoding="utf-8")
    if fm.get("status") == "draft":
        warnings.append(f"{rel}: status=draft — not ingested until set to current")
    # Headings should be in the user's voice, so a chunk matches how someone asks.
    # Two valid shapes: a question ("Can I cancel?") or a first-person symptom
    # statement ("I cannot sign in"), which is how troubleshooting is searched.
    user_voice = re.search(r"^##\s+.+\?\s*$", body, re.M) or \
                 re.search(r"^##\s+(I|My|Nothing|Something)\b", body, re.M)
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

coverage = {loc: sum(1 for l in by_id.values() if loc in l) for loc in LOCALES}
total = len(by_id)

print(f"knowledge-base: {len(files)} document(s), {total} unique id(s)")
print("locale coverage: " + "  ".join(
    f"{loc} {coverage[loc]}/{total}" + ("" if coverage[loc] == total else " (incomplete)")
    for loc in LOCALES))

for w in warnings:
    print(f"  WARN  {w}")
for e in errors:
    print(f"  ERROR {e}")
print(f"\n{len(errors)} error(s), {len(warnings)} warning(s)")
sys.exit(1 if errors else 0)
