from __future__ import annotations

import os
import subprocess
from pathlib import Path

commands = [
    ["ps", "-eo", "pid,lstart,args"],
    ["find", "/home/kurz/.config", "/home/kurz/.vscode-oss", "/home/kurz/.var/app", "-type", "f", "-mmin", "-120"],
]

for command in commands:
    print("===", " ".join(command), "===")
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if command[0] == "ps":
        lines = [line for line in result.stdout.splitlines() if "codium" in line.lower() or "extensionhost" in line.lower()]
        print("\n".join(lines))
    else:
        lines = [line for line in result.stdout.splitlines() if any(x in line.lower() for x in ("log", "exthost", "renderer"))]
        print("\n".join(lines[:300]))

print("=== extension candidates ===")
for root in (Path("/home/kurz/.vscode-oss/extensions"), Path("/home/kurz/.config/VSCodium/User/extensions")):
    if root.is_dir():
        for path in sorted(root.glob("deeptask.deeptask*")):
            print(path, "mtime", path.stat().st_mtime)
