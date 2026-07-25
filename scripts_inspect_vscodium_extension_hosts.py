from __future__ import annotations

from datetime import datetime
from pathlib import Path

KEYWORDS = ("codium", "vscodium", "extensionhost", "extension-host")
CLK_TCK = 100


def boot_time() -> float:
    for line in Path("/proc/stat").read_text().splitlines():
        if line.startswith("btime "):
            return float(line.split()[1])
    raise RuntimeError("missing btime")


def main() -> None:
    boot = boot_time()
    for proc in sorted(Path("/proc").iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else 10**12):
        if not proc.name.isdigit():
            continue
        try:
            cmd = (proc / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="ignore").strip()
            if not cmd or not any(keyword in cmd.lower() for keyword in KEYWORDS):
                continue
            fields = (proc / "stat").read_text().split()
            started = datetime.fromtimestamp(boot + int(fields[21]) / CLK_TCK).isoformat()
            print(proc.name, started, cmd[:2000])
        except (OSError, ValueError, IndexError):
            continue


if __name__ == "__main__":
    main()
