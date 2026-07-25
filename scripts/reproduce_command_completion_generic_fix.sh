#!/usr/bin/env bash
set -o pipefail

python3 -m py_compile \
  /home/kurz/.kilocode/skills/lol-enhancement-evaluation/scripts/evaluate_lol.py \
  /media/kurz/aleber/vscode/ZeroIG/enhance_inference.py \
  /media/kurz/aleber/vscode/Zero-HVI/test.py && \
python3 - <<'PY'
from pathlib import Path

root = Path('/media/kurz/aleber/vscode/data/LOL/_extracted/lol_dataset/eval15')
low = {p.name for p in (root / 'low').iterdir() if p.is_file()}
high = {p.name for p in (root / 'high').iterdir() if p.is_file()}
print('low', len(low), 'high', len(high), 'paired', len(low & high), 'mismatch', len(low ^ high))
for project in ('Zero-HVI', 'ZeroIG'):
    path = Path('/media/kurz/aleber/vscode') / project
    print(project, 'requirements=', (path / 'requirements.txt').is_file())
    print(project, 'run_script=', (path / 'run_lol_eval15.sh').is_file())
PY
status=$?
printf 'exit_code=%s\n' "$status"
exit "$status"
