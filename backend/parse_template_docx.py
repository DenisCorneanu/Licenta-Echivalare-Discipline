# backend/parse_template_docx.py
import json
import re
import sys
import unicodedata

from docx import Document


def norm(value: str) -> str:
    """Normalizeaza textul pentru comparatii robuste."""
    if not value:
        return ""

    value = unicodedata.normalize("NFKD", str(value))
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = "".join(
        ch if (ch.isalnum() or ch.isspace()) else " "
        for ch in value.lower()
    )
    return " ".join(value.split())


SKIP_PATTERNS = [
    "disciplina echivalata din planul de invatamant al promotiei in care se reinmatriculeaza",
    "disciplina echivalata din planul de invatamant",
    "disciplina echivalata",
]

ROMAN_VALUES = {
    "i": 1,
    "ii": 2,
    "iii": 3,
    "iv": 4,
    "v": 5,
    "vi": 6,
}


def extract_int(value):
    """Extrage primul numar arab, folosit pentru ECTS."""
    if value is None:
        return None

    match = re.search(r"\d+", str(value))
    return int(match.group(0)) if match else None


def extract_study_number(value):
    """Extrage 1..6 din forme arabe sau romane, pentru an/semestru."""
    if value is None:
        return None

    normalized = norm(value)

    match = re.search(r"\b([1-6])\b", normalized)
    if match:
        return int(match.group(1))

    for roman, number in ROMAN_VALUES.items():
        if re.search(rf"\b{roman}\b", normalized):
            return number

    return None


def detect_year_heading(value):
    """
    Recunoaste doar heading-uri care INCEP cu anul de studiu.
    Exemple:
    - Anul I
    - Anul de studiu I
    - Anul II - semestrul 1
    - An 3

    Ancora ^ este importanta: in antetul tabelelor apare textul
    "anul I", dar acel text nu reprezinta anul tabelului curent.
    """
    normalized = norm(value)

    match = re.search(
        r"^(?:an|anul)(?:\s+de\s+studiu)?\s+([1-6]|vi|iv|iii|ii|i)\b",
        normalized,
    )

    if not match:
        return None

    return extract_study_number(match.group(1))


def is_skipped_row(name):
    normalized_name = norm(name)
    return any(normalized_name.startswith(pattern) for pattern in SKIP_PATTERNS)


def detect_headers(table):
    """
    Cauta header-ul in primele 3 randuri.
    Pentru formularul de echivalare alegem coloana din partea dreapta:
    "Disciplina echivalata ..." si "Credite ECTS" aferente acesteia.
    """
    max_header_rows = min(3, len(table.rows))

    for row_index in range(max_header_rows):
        cells = [cell.text.strip() for cell in table.rows[row_index].cells]
        headers = {}

        for index, text in enumerate(cells):
            normalized = norm(text)

            if not normalized:
                continue

            if (
                normalized.startswith("disc")
                or "materie" in normalized
                or "curs" in normalized
                or "denumire" in normalized
            ):
                headers["name"] = index

            if "ects" in normalized or "cred" in normalized:
                headers["ects"] = index

            if normalized in ("an", "anul") or normalized.startswith("an "):
                headers["year"] = index

            if "sem" in normalized:
                headers["semester"] = index

            if (
                "identif" in normalized
                or normalized in ("id", "cod", "cod disciplina")
            ):
                headers["identifier"] = index

        if "name" in headers:
            return headers, row_index

    return {"name": 0}, 0


def parse_docx(path: str):
    doc = Document(path)
    courses = []
    current_year = None

    from docx.table import Table
    from docx.text.paragraph import Paragraph

    body = doc._body._element

    # Parcurgem paragrafele si tabelele in ordinea documentului.
    for child in body.iterchildren():
        if child.tag.endswith("p"):
            paragraph = Paragraph(child, doc)
            detected_year = detect_year_heading(paragraph.text)

            if detected_year is not None:
                current_year = detected_year

            continue

        if not child.tag.endswith("tbl"):
            continue

        table = Table(child, doc)

        # Fallback pentru documente unde heading-ul anului se afla singur
        # intr-o celula deasupra tabelului. Nu cautam "anul I" oriunde in
        # textul header-ului, pentru ca ar reseta gresit anul la 1.
        for row in table.rows[:2]:
            for cell in row.cells[:3]:
                detected_year = detect_year_heading(cell.text.strip())

                if detected_year is not None:
                    current_year = detected_year
                    break

            if detected_year is not None:
                break

        headers, header_row_index = detect_headers(table)

        for row in table.rows[header_row_index + 1 :]:
            cells = [cell.text.strip() for cell in row.cells]

            def value_for(header_name):
                index = headers.get(header_name)

                if index is None or index >= len(cells):
                    return None

                return cells[index].strip()

            name = value_for("name") or ""

            if not name or is_skipped_row(name):
                continue

            year_from_column = extract_study_number(value_for("year"))
            semester = extract_study_number(value_for("semester"))
            ects = extract_int(value_for("ects"))
            identifier = (value_for("identifier") or "").strip() or None

            courses.append(
                {
                    "year": year_from_column or current_year,
                    "semester": semester,
                    "name": name,
                    "ects": ects,
                    "identifier": identifier,
                }
            )

    return courses


if __name__ == "__main__":
    data = json.loads(sys.stdin.read() or "{}")
    template_path = data.get("template_path")

    if not template_path:
        sys.stderr.write("template_path lipseste")
        sys.exit(1)

    try:
        parsed_courses = parse_docx(template_path)
    except Exception as error:
        sys.stderr.write(str(error))
        sys.exit(1)

    print(json.dumps({"courses": parsed_courses}, ensure_ascii=False))
