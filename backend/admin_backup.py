import json
import os
import sys
import zipfile
from pathlib import PurePosixPath


def validate_archive_path(value):
    path = PurePosixPath(str(value or ""))

    if not str(path) or path.is_absolute() or ".." in path.parts:
        raise ValueError(f"Cale invalida in arhiva: {value}")

    return str(path)


def main():
    payload = json.load(sys.stdin)
    output_path = os.path.abspath(payload["output_path"])
    entries = payload.get("entries") or []

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    temporary_path = f"{output_path}.tmp"

    if os.path.exists(temporary_path):
        os.remove(temporary_path)

    try:
        with zipfile.ZipFile(
            temporary_path,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
            allowZip64=True,
        ) as archive:
            used_paths = set()

            for entry in entries:
                entry_type = entry.get("type")
                archive_path = validate_archive_path(
                    entry.get("archive_path")
                )

                if archive_path in used_paths:
                    raise ValueError(
                        f"Intrare duplicata in arhiva: {archive_path}"
                    )

                used_paths.add(archive_path)

                if entry_type == "file":
                    source_path = os.path.abspath(
                        entry.get("source_path") or ""
                    )

                    if not os.path.isfile(source_path):
                        continue

                    archive.write(source_path, archive_path)
                    continue

                if entry_type == "json":
                    content = json.dumps(
                        entry.get("data"),
                        ensure_ascii=False,
                        indent=2,
                    )
                    archive.writestr(archive_path, content.encode("utf-8"))
                    continue

                if entry_type == "text":
                    content = str(entry.get("data") or "")
                    archive.writestr(archive_path, content.encode("utf-8"))
                    continue

                raise ValueError(f"Tip de intrare necunoscut: {entry_type}")

        os.replace(temporary_path, output_path)
    except Exception:
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
        raise


if __name__ == "__main__":
    main()
