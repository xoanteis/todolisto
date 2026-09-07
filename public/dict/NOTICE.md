# Bundled spelling dictionaries

These Hunspell dictionaries are shipped unchanged from the LibreOffice
`dictionaries` repository (https://github.com/LibreOffice/dictionaries),
except for `gl_ES.dic`, whose morphological annotations were stripped with
`scripts/slim-dictionary.py` (spelling results are identical; the file is a
quarter of the size).

| Files | Source | Licence |
|---|---|---|
| `en_US.aff`, `en_US.dic` | SCOWL (Kevin Atkinson et al.) via LibreOffice | see `README_en_US.txt` (permissive, SCOWL) |
| `es_ES.aff`, `es_ES.dic` | RLA-ES (Recursos Lingüísticos Abiertos del Español) | GPLv3 / LGPLv3 / MPL 1.1 tri-licence, see `README_es.txt` and `LICENSE_es.md` |
| `gl_ES.aff`, `gl_ES.dic` | hunspell-gl 20.08, Proxecto Trasno | GPLv3, see `README_gl.txt` and `GPLv3.txt` |

The dictionaries are data files loaded at run time; todolisto itself is
licensed under the Apache License 2.0 (see the repository `LICENSE`).
