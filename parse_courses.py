#!/usr/bin/env python3
"""
parse_courses.py
================
Parses document.md to extract curriculum tables into a flattened, contextualized
JSON array (zhcet_courses.json) and splits out non-table general information
into zhcet_general_info.md.

Usage:
    python3 parse_courses.py
"""

import re
import json
import os
import sys

INPUT_FILE = "document.md"
COURSES_OUTPUT = "zhcet_courses.json"
GENERAL_INFO_OUTPUT = "zhcet_general_info.md"

# ── Category full-form mapping ──────────────────────────────────────────────
CATEGORY_MAP = {
    "PC":  "Programme Core",
    "PE":  "Programme Elective",
    "BS":  "Basic Sciences",
    "ESA": "Engineering Sciences & Arts",
    "HM":  "Humanities & Management",
    "OE":  "Open Elective",
    "PSI": "Project, Seminar, Internship",
    "AU":  "Audit Course",
}

# ── Heading where curriculum tables begin ────────────────────────────────────
COURSE_STRUCTURE_HEADING = "COURSE STRUCTURE"


def atomic_write_json(path: str, data: list, min_records: int = 1) -> None:
    """Write a JSON file atomically (tmp → verify → rename).

    Refuses to overwrite if the extracted record count is below *min_records*,
    preventing a bad parse run from destroying previously-good output.
    """
    if len(data) < min_records:
        raise ValueError(
            f"[Logic Gate] Refusing to write '{path}': only {len(data)} record(s) "
            f"found (minimum required: {min_records}). "
            "Check document structure or COURSE_STRUCTURE_HEADING."
        )
    tmp_path = path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        # ── Integrity check: verify the file round-trips correctly ────────────
        with open(tmp_path, "r", encoding="utf-8") as f:
            verify = json.load(f)
        if len(verify) != len(data):
            raise RuntimeError(
                f"[Logic Gate] Write verification failed for '{path}': "
                f"wrote {len(data)} records but read back {len(verify)}."
            )
        # Atomic promotion (rename is atomic on POSIX)
        os.replace(tmp_path, path)
        print(f"✅ Atomically saved {len(data)} records → {path}")
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def atomic_write_text(path: str, lines: list) -> None:
    """Write a text file atomically (tmp → rename)."""
    tmp_path = path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        os.replace(tmp_path, path)
        print(f"✅ Atomically saved general info → {path}")
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def clean_cell(cell: str) -> str:
    """Strip whitespace and remove bold markdown from a table cell."""
    cell = cell.strip()
    cell = re.sub(r"\*\*(.+?)\*\*", r"\1", cell)   # remove **bold**
    return cell


def is_separator_row(cells: list[str]) -> bool:
    """Check if a row is a Markdown table separator like | :--- | :--- |."""
    return all(re.match(r"^:?-+:?$", c.strip()) for c in cells if c.strip())


def is_header_row(cells: list[str]) -> bool:
    """Check if a row is the column header (contains 'S.No.' or 'Course title')."""
    joined = " ".join(c.lower() for c in cells)
    return "s.no" in joined or "course title" in joined


def is_total_row(cells: list[str]) -> bool:
    """Check if a row is the TOTAL CREDITS summary row."""
    joined = " ".join(c.lower() for c in cells)
    return "total credits" in joined


def parse_branch_from_heading(line: str) -> str | None:
    """
    Extract the branch name from heading lines like:
      ## B.TECH. (COMPUTER ENGINEERING)
      ### B.TECH: ARTIFICIAL INTELLIGENCE
      ## FIRST YEAR-ALL BRANCHES (Section A1A, A1B & A1C)
    """
    # Match B.TECH variations
    m = re.match(
        r"^#{2,4}\s+B\.?\s*TECH\.?\s*[:\-]?\s*(.+?)\s*$",
        line.strip(),
        re.IGNORECASE,
    )
    if m:
        branch = m.group(1).strip()
        if branch.startswith("(") and branch.endswith(")"):
            branch = branch[1:-1].strip()
        return branch

    # Match FIRST YEAR-ALL BRANCHES
    m = re.match(r"^#{2,4}\s+(FIRST YEAR.+)$", line.strip(), re.IGNORECASE)
    if m:
        return "All Branches (First Year)"

    return None


def parse_semester_from_heading(line: str) -> int | None:
    """Extract semester number from headings like ### Semester 3: or #### Semester 6:"""
    m = re.match(r"^#{2,4}\s+Semester\s+(\d+)\s*:", line.strip(), re.IGNORECASE)
    if m:
        return int(m.group(1))
    return None


def extract_course_from_row(cells: list[str], num_cols: int) -> dict | None:
    """
    Extract course data from a table row.

    Handles two table formats:
      7-col:  S.No | Category | Course No | Course title | LTP | Credits | Marks
      10-col: S.No | Category | Course No | Course title | LTP | Credits | CW | Int | End-Sem | Total
    """
    if num_cols >= 10:
        # 10-column format
        _, cat, code, title, ltp, credits, cw, internal, end_sem, total = [
            clean_cell(c) for c in cells[:10]
        ]
        marks = f"{cw}/{internal}/{end_sem}/{total}" if cw else ""
    elif num_cols >= 7:
        # 7-column compact format
        _, cat, code, title, ltp, credits, marks_raw = [
            clean_cell(c) for c in cells[:7]
        ]
        marks = marks_raw
    else:
        return None

    # Skip rows with empty or invalid data
    if not cat or not title:
        return None

    # Clean up credits: handle "1.5", "4", etc.
    try:
        credits_val = float(credits) if credits and credits != "-" else 0
    except ValueError:
        credits_val = 0

    return {
        "course_category": cat,
        "course_category_full": CATEGORY_MAP.get(cat, cat),
        "course_code": code if code and code != "-" else None,
        "course_title": title,
        "contact_periods": ltp if ltp and ltp != "-" else None,
        "credits": credits_val,
        "marks": marks if marks else None,
    }


def main():
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()

    courses = []
    general_info_lines = []

    # ── State tracking ───────────────────────────────────────────────────────
    current_branch = None
    current_semester = None
    in_course_section = False      # True once we pass COURSE STRUCTURE heading
    inside_table = False

    # Track number of columns in the current table from its header row
    current_table_cols = 7

    for line in lines:
        stripped = line.strip()

        # ── Detect start of course structure section ─────────────────────────
        if not in_course_section:
            if re.match(r"^#+\s+" + COURSE_STRUCTURE_HEADING, stripped, re.IGNORECASE):
                in_course_section = True
            else:
                general_info_lines.append(line)
            continue

        # ── Inside course structure section ──────────────────────────────────

        # Check for branch heading
        branch = parse_branch_from_heading(stripped)
        if branch is not None:
            current_branch = branch
            current_semester = None
            inside_table = False
            continue

        # Check for semester heading
        sem = parse_semester_from_heading(stripped)
        if sem is not None:
            current_semester = sem
            inside_table = False
            continue

        # ── Table row processing ─────────────────────────────────────────────
        if stripped.startswith("|"):
            cells = [c for c in stripped.split("|")]
            # Remove leading/trailing empty strings from split
            if cells and cells[0].strip() == "":
                cells = cells[1:]
            if cells and cells[-1].strip() == "":
                cells = cells[:-1]

            num_cells = len(cells)

            if is_separator_row(cells):
                inside_table = True
                current_table_cols = num_cells
                continue

            if is_header_row(cells):
                inside_table = True
                current_table_cols = num_cells
                continue

            if is_total_row(cells):
                inside_table = False
                continue

            if not inside_table:
                continue

            # ── Extract course data ──────────────────────────────────────────
            course_data = extract_course_from_row(cells, current_table_cols)
            if course_data is None:
                continue

            # Build the full course record
            branch_display = current_branch or "Unknown Branch"
            semester_display = current_semester or 0

            record = {
                "program": "B.Tech",
                "branch": branch_display,
                "semester": semester_display,
                **course_data,
            }

            # ── Build the searchable_text field ──────────────────────────────
            code_part = (
                f"{course_data['course_code']}: " if course_data["course_code"] else ""
            )
            credits_str = (
                int(course_data["credits"])
                if course_data["credits"] == int(course_data["credits"])
                else course_data["credits"]
            )
            ltp_part = (
                f" with contact periods {course_data['contact_periods']}"
                if course_data["contact_periods"]
                else ""
            )

            record["searchable_text"] = (
                f"In B.Tech {branch_display}, Semester {semester_display}, "
                f"students take the course {code_part}{course_data['course_title']}. "
                f"This is a {course_data['course_category_full']} ({course_data['course_category']}) "
                f"category course worth {credits_str} credits{ltp_part}."
            )

            courses.append(record)
        else:
            inside_table = False

    # ── Logic Gate: refuse to overwrite good data with empty output ─────────
    if len(courses) == 0:
        print(
            "❌ No courses were extracted. Aborting write to prevent overwriting "
            "existing data. Check that the COURSE STRUCTURE heading exists in "
            f"{INPUT_FILE} and that the table format matches the parser.",
            file=sys.stderr,
        )
        sys.exit(1)

    # ── Write outputs (atomic: write to .tmp, verify, then rename) ───────────
    atomic_write_json(COURSES_OUTPUT, courses, min_records=50)

    general_content = "".join(general_info_lines)
    if len(general_content) < 500:
        print(
            "⚠️  Warning: zhcet_general_info.md content is suspiciously short "
            f"({len(general_content)} chars). Check COURSE_STRUCTURE_HEADING match."
        )
    atomic_write_text(GENERAL_INFO_OUTPUT, general_info_lines)

    # ── Summary stats ────────────────────────────────────────────────────────
    branches = sorted(set(c["branch"] for c in courses))
    print(f"✅ Extracted {len(courses)} courses across {len(branches)} branches.")
    print(f"📄 Course data saved to: {COURSES_OUTPUT}")
    print(f"📄 General info saved to: {GENERAL_INFO_OUTPUT}")
    print(f"\n📊 Branches found:")
    for b in branches:
        count = sum(1 for c in courses if c["branch"] == b)
        semesters = sorted(set(c["semester"] for c in courses if c["branch"] == b))
        print(f"   • {b}: {count} courses (Semesters {', '.join(map(str, semesters))})")


if __name__ == "__main__":
    main()
