import csv
import json
import os
import re
import sys
import unicodedata
import zipfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import openpyxl
except Exception:
    openpyxl = None


ROMAN_TO_ARABIC = {
    "vi": "6",
    "iv": "4",
    "iii": "3",
    "ii": "2",
    "v": "5",
    "i": "1",
}

METADATA_MARKERS = (
    "nr inregistrare",
    "numar inregistrare",
    "emisa la data",
    "emis la data",
    "situatie scolara",
    "foaie matricola",
    "universitatea",
    "facultatea",
    "secretariat",
    "nume student",
    "prenume student",
    "program de studiu",
    "specializare",
    "an universitar",
    "pagina ",
    "semnatura",
    "intocmit",
    "eliberat",
)

HEADER_NAME_MARKERS = (
    "disciplina",
    "materie",
    "denumire",
    "nume disciplina",
    "denumirea disciplinei",
)

HEADER_GRADE_MARKERS = (
    "nota",
    "grade",
    "punctaj",
    "calificativ",
    "rezultat",
)

HEADER_ECTS_MARKERS = (
    "ects",
    "credite",
    "credit",
)

HEADER_YEAR_MARKERS = (
    "an studiu",
    "anul de studiu",
    "an",
)

HEADER_SEMESTER_MARKERS = (
    "semestru",
    "sem",
)


def as_text(value) -> str:
    """Converteste in siguranta orice valoare celula la text."""
    if value is None:
        return ""
    return str(value).strip()


def fold_text(value: str) -> str:
    """
    Lowercase fara diacritice, pastrand separat semnele de punctuatie.
    Este folosita pentru detectii; nu este cheia finala de matching.
    """
    text = as_text(value)
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.lower()


def roman_to_arabic(text: str) -> str:
    """Transforma doar numeralele romane standalone: I, II, III, IV etc."""
    def replace(match):
        return ROMAN_TO_ARABIC[match.group(0)]

    return re.sub(
        r"\b(?:vi|iv|iii|ii|v|i)\b",
        replace,
        text,
        flags=re.IGNORECASE,
    )


def normalize_spaces(text: str) -> str:
    return " ".join(text.split())


def extract_abbreviations(value: str) -> list[str]:
    """
    Extrage continuturi scurte din paranteze, utile ulterior pentru matching.
    Exemple: ASD I, TGC, DB, P3.
    """
    abbreviations = []

    for raw in re.findall(r"\(([^)]{1,40})\)", as_text(value)):
        folded = roman_to_arabic(fold_text(raw))
        clean = re.sub(r"[^a-z0-9\s]", " ", folded)
        clean = normalize_spaces(clean)

        # Pastram doar valori scurte, fara detalii administrative lungi.
        if clean and len(clean) <= 20:
            abbreviations.append(clean)

    return list(dict.fromkeys(abbreviations))


def canonical_name(value: str) -> str:
    """
    Cheie generala de comparatie pentru denumirea unei discipline.

    Elimina:
    - diacritice;
    - statusuri precum "- Echivalata";
    - prescurtari sau detalii dintre paranteze;
    - simboluri si punctuatie;
    - diferenta dintre I/II/III si 1/2/3.

    Pastreaza denumirea principala, de exemplu:
    "Teoria grafurilor si combinatorica - Echivalata (TGC)"
    -> "teoria grafurilor si combinatorica"
    """
    text = fold_text(value)

    # Continutul dintre paranteze este pastrat separat prin extract_abbreviations.
    text = re.sub(r"\([^)]*\)", " ", text)

    # Statusuri care apar frecvent in exporturi, nu in numele disciplinei.
    text = re.sub(
        r"\b(?:echivalata|echivalat|recunoscuta|recunoscut)\b",
        " ",
        text,
    )

    # Eliminam expresii de tip "nota 7" incluse accidental in text.
    text = re.sub(r"\bnota\s+\d+(?:[.,]\d+)?\b", " ", text)

    text = roman_to_arabic(text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)

    return normalize_spaces(text)


def detect_level(canonical: str) -> int | None:
    """
    Returneaza nivelul academic 1..6 numai cand este un sufix clar.

    Nu considera nivel numerele din durate:
    - 4 sapt x 6 ore/zi
    - 120 ore/semestru
    """
    match = re.search(
        r"\b([1-6])(?:\s+(?:optional|facultativ|obligatoriu))?\s*$",
        canonical,
    )
    return int(match.group(1)) if match else None


def detect_family(canonical: str) -> str | None:
    """Clasifica familii recurente de discipline."""
    if (
        "limba straina" in canonical
        or "limba engleza" in canonical
        or "english language" in canonical
    ):
        return "language"

    if "educatie fizica" in canonical or "physical education" in canonical:
        return "physical_education"

    if "stagiu de practica" in canonical or canonical.startswith("practica "):
        return "practice"

    if "consiliere" in canonical or "orientare in cariera" in canonical:
        return "counselling"

    return None


def split_package_options(value: str) -> list[str]:
    """
    Un pachet tinta poate contine mai multe optiuni separate prin "/".
    Expunem structura pentru pasul de scoring.
    """
    raw_parts = re.split(r"\s*/\s*", as_text(value))
    options = [canonical_name(part) for part in raw_parts]
    options = [option for option in options if option]
    return list(dict.fromkeys(options))


def analyse_name(value: str) -> dict:
    canonical = canonical_name(value)
    package_options = split_package_options(value)

    return {
        "name_norm": canonical,
        "abbreviations": extract_abbreviations(value),
        "family": detect_family(canonical),
        "level": detect_level(canonical),
        "is_package": len(package_options) > 1,
        "package_options": package_options,
    }


def looks_like_metadata(value: str) -> bool:
    """
    Filtreaza randuri de metadata care nu reprezinta discipline.
    Exemplu bun si sa am grija: "Nr. inregistrare Emisa la data ...".
    """
    raw = as_text(value)
    folded = normalize_spaces(fold_text(raw))
    canonical = canonical_name(raw)

    if not canonical:
        return True

    if len(re.sub(r"[^a-z]", "", canonical)) < 3:
        return True

    if any(marker in folded for marker in METADATA_MARKERS):
        return True

    if re.match(r"^(?:nr|numar)\s*\d*\b", canonical):
        return True

    if "inregistrare" in canonical and ("data" in canonical or "emis" in canonical):
        return True

    return False


def detect_year_heading(values: list[str]) -> int | None:
    """
    Detecteaza heading-uri explicite precum:
    - Anul I
    - Anul de studiu II
    - An 3

    aici avem grija sa nu foloseasca ideea gresita "al doilea header = anul II".
    """
    text = normalize_spaces(fold_text(" ".join(as_text(v) for v in values)))

    match = re.search(
        r"\b(?:an|anul)(?:\s+de\s+studiu)?\s+"
        r"(vi|iv|iii|ii|v|i|[1-6])\b",
        text,
    )

    if not match:
        return None

    token = roman_to_arabic(match.group(1).lower())

    try:
        year = int(token)
    except ValueError:
        return None

    return year if 1 <= year <= 6 else None


def index_headers(values: list[str]) -> dict | None:
    """
    Identifica un header real doar cand exista coloana de disciplina
    plus cel putin o coloana auxiliara (nota, credite/ECTS, an sau semestru).

    Astfel, "Disciplina complementara optionala..." nu este confundata
    cu un header de tabel.
    """
    headers = {}
    values_norm = [normalize_spaces(canonical_name(value)) for value in values]

    for index, value in enumerate(values_norm):
        if not value:
            continue

        if (
            any(marker in value for marker in HEADER_NAME_MARKERS)
            and "name" not in headers
        ):
            headers["name"] = index

        if (
            any(marker in value for marker in HEADER_ECTS_MARKERS)
            and "ects" not in headers
        ):
            headers["ects"] = index

        if (
            any(marker in value for marker in HEADER_GRADE_MARKERS)
            and "grade" not in headers
        ):
            headers["grade"] = index

        if (
            any(marker == value or marker in value for marker in HEADER_YEAR_MARKERS)
            and "year" not in headers
        ):
            headers["year"] = index

        if (
            any(marker in value for marker in HEADER_SEMESTER_MARKERS)
            and "semester" not in headers
        ):
            headers["semester"] = index

    has_name = "name" in headers
    has_supporting_column = any(
        key in headers for key in ("grade", "ects", "year", "semester")
    )

    return headers if has_name and has_supporting_column else None


def to_float(value):
    try:
        return float(str(value).replace(",", "."))
    except Exception:
        return None


def parse_academic_result(value) -> dict:
    """Pastreaza valoarea originala si separa rezultatul numeric de status."""
    raw = as_text(value)
    folded = normalize_spaces(fold_text(raw))

    if not raw or folded in {"-", "--"}:
        return {
            "grade_raw": raw or "-",
            "grade_numeric": None,
            "academic_status": "unknown",
        }

    numeric = to_float(raw)
    if numeric is not None:
        return {
            "grade_raw": raw,
            "grade_numeric": numeric,
            "academic_status": "passed" if numeric >= 5 else "failed",
        }

    if folded in {"p", "promovat", "promovata", "admis", "admisa"}:
        return {
            "grade_raw": "P",
            "grade_numeric": None,
            "academic_status": "passed",
        }

    if folded in {"n", "nepromovat", "nepromovata", "respins", "respinsa"}:
        return {
            "grade_raw": "N",
            "grade_numeric": None,
            "academic_status": "failed",
        }

    return {
        "grade_raw": raw,
        "grade_numeric": None,
        "academic_status": "unknown",
    }


def cell(values: list[str], index: int | None) -> str:
    if index is None or index < 0 or index >= len(values):
        return ""
    return as_text(values[index])


def rows_to_transcript_lines(rows: list[list[object]]) -> list[dict]:
    """
    Transforma o matrice de celule intr-o lista curata de discipline.
    Este folosita atat pentru CSV, cat si pentru XLSX.
    """
    headers = None
    current_year = None
    lines = []
    next_id = 0

    for raw_row in rows:
        values = [as_text(value) for value in raw_row]

        if not any(values):
            continue

        detected_year = detect_year_heading(values)
        if detected_year is not None:
            current_year = detected_year

        detected_headers = index_headers(values)
        if detected_headers is not None:
            headers = detected_headers
            continue

        if not headers:
            continue

        name = cell(values, headers.get("name"))

        if looks_like_metadata(name):
            continue

        analysis = analyse_name(name)

        if not analysis["name_norm"]:
            continue

        ects = to_float(cell(values, headers.get("ects")))
        grade_result = parse_academic_result(cell(values, headers.get("grade")))

        # Daca foaia studentului are explicit o coloana "An", preferam acea valoare.
        row_year = detect_year_heading([cell(values, headers.get("year"))])
        effective_year = row_year if row_year is not None else current_year

        next_id += 1
        lines.append(
            {
                "id": next_id,
                "name": name,
                "name_norm": analysis["name_norm"],
                "ects": ects,
                # Campul grade ramane numeric pentru compatibilitate cu backend-ul existent.
                "grade": grade_result["grade_numeric"],
                "grade_numeric": grade_result["grade_numeric"],
                "grade_raw": grade_result["grade_raw"],
                "academic_status": grade_result["academic_status"],
                "year_of_study": effective_year,
                # Campuri pregatite pentru scoring explicabil
                "abbreviations": analysis["abbreviations"],
                "family": analysis["family"],
                "level": analysis["level"],
                "is_package": analysis["is_package"],
                "package_options": analysis["package_options"],
            }
        )

    return lines


# ---------- CSV ----------
def read_csv_rows(path: str) -> list[list[str]]:
    last_error = None

    for encoding in ("utf-8-sig", "utf-8", "cp1250", "latin1"):
        try:
            with open(path, "r", encoding=encoding, newline="") as file:
                sample = file.read(8192)
                file.seek(0)

                try:
                    dialect = csv.Sniffer().sniff(sample, delimiters=";,|\t,")
                except Exception:
                    class FallbackDialect(csv.excel):
                        delimiter = ";" if sample.count(";") > sample.count(",") else ","

                    dialect = FallbackDialect

                return list(csv.reader(file, dialect))
        except UnicodeDecodeError as error:
            last_error = error

    raise last_error or Exception("Nu pot citi CSV-ul.")


def parse_csv(path: str) -> list[dict]:
    return rows_to_transcript_lines(read_csv_rows(path))


# ---------- XLSX ----------
def parse_xlsx(path: str) -> list[dict]:
    if openpyxl is None:
        raise Exception(
            "openpyxl is not installed in the Python environment used by backend"
        )

    try:
        workbook = openpyxl.load_workbook(
            path,
            data_only=True,
            read_only=True,
        )
    except Exception as error:
        raise Exception(
            "Fisierul .xlsx nu este un workbook Excel valid sau nu poate fi citit. "
            "Salveaza-l din nou ca Excel Workbook (.xlsx)."
        ) from error

    try:
        best_lines = []
        best_sheet_name = None

        # Alegem foaia cu cele mai multe discipline valide.
        # Este mai sigur decat a combina automat foi de sumar cu foi de note.
        for worksheet in workbook.worksheets:
            rows = [list(row) for row in worksheet.iter_rows(values_only=True)]
            parsed = rows_to_transcript_lines(rows)

            if len(parsed) > len(best_lines):
                best_lines = parsed
                best_sheet_name = worksheet.title

        sys.stderr.write(
            f"matcher.py: selected worksheet={best_sheet_name!r}, "
            f"courses={len(best_lines)}\n"
        )

        return best_lines
    finally:
        workbook.close()


# ---------- orchestrare ----------
def parse_transcript(path: str) -> list[dict]:
    try:
        size = os.path.getsize(path)
    except FileNotFoundError:
        size = -1

    extension = os.path.splitext(path)[1].lower()
    is_zip = zipfile.is_zipfile(path)

    sys.stderr.write("matcher.py: parser xlsx/csv loaded\n")
    sys.stderr.write(
        f"DEBUG path={path} extension={extension} "
        f"size={size} iszip={is_zip}\n"
    )

    if size <= 0:
        raise Exception("Fisierul incarcat este gol sau nu mai exista.")

    if extension == ".xlsx":
        if not is_zip:
            raise Exception(
                "Fisierul .xlsx nu este un workbook Excel valid. "
                "Salveaza-l din nou ca Excel Workbook (.xlsx)."
            )

        return parse_xlsx(path)

    if extension == ".csv":
        try:
            return parse_csv(path)
        except Exception as error:
            raise Exception("Nu pot citi CSV-ul incarcat.") from error

    # Fallback pentru fisiere temporare care si-au pierdut extensia.
    if is_zip:
        return parse_xlsx(path)

    try:
        return parse_csv(path)
    except Exception as error:
        raise Exception(
            "File is not a valid .xlsx or .csv. "
            "Deschide-l in Excel/LibreOffice si salveaza-l ca .xlsx sau .csv."
        ) from error


if __name__ == "__main__":
    data = json.loads(sys.stdin.read() or "{}")

    if data.get("mode") == "match":
        transcript_path = data.get("xlsx_path")

        if not transcript_path:
            sys.stderr.write("xlsx_path lipseste")
            sys.exit(1)

        try:
            transcript_lines = parse_transcript(transcript_path)
        except Exception as error:
            sys.stderr.write(str(error))
            sys.exit(1)

        payload = {"transcript_lines": transcript_lines}
        sys.stdout.buffer.write(
            json.dumps(payload, ensure_ascii=False).encode("utf-8")
        )
        sys.stdout.flush()
        sys.exit(0)

    sys.stdout.buffer.write(
        json.dumps({"error": "unknown mode"}).encode("utf-8")
    )
    sys.stdout.flush()
    sys.exit(1)
