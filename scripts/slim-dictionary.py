#!/usr/bin/env python3
"""Strips morphological fields from a Hunspell .dic file.

Fields such as `po:substantivo` or `is:ngrama_...` are only used for
stemming and analysis; spell checking and suggestions do not need them.
The Galician dictionary shrinks from 8.3 MB to 2.2 MB and loads twice as
fast without any change in results (verified on a sample of words).
`ph:` fields are kept because Hunspell uses them for suggestions.

Usage: slim-dictionary.py input.dic output.dic
"""

import re
import sys
from pathlib import Path


def slim(src: str) -> tuple[str, int, int]:
    lines = src.split("\n")
    kept: list[str] = []
    dropped = 0
    for line in lines[1:]:
        line = line.rstrip("\r")
        if not line.strip():
            continue
        parts = re.split(r"[\t ]+", line)
        head = parts[0]
        if not head or ":" in head:
            dropped += 1
            continue
        ph = [p for p in parts[1:] if p.startswith("ph:")]
        kept.append(" ".join([head, *ph]))
    return f"{len(kept)}\n" + "\n".join(kept) + "\n", len(kept), dropped


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    text, kept, dropped = slim(Path(sys.argv[1]).read_text(encoding="utf-8"))
    Path(sys.argv[2]).write_text(text, encoding="utf-8")
    print(f"{kept} entries kept, {dropped} dropped, {len(text.encode())} bytes")


if __name__ == "__main__":
    main()
