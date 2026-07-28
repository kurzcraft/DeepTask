from __future__ import annotations

import hashlib
import re
from pathlib import Path
from zipfile import ZipFile

ROOT = Path("/media/kurz/aleber/vscode/deeptask")
VSIX = ROOT / "deeptask-5.5.0.vsix"
INSTALLED = Path(
    "/home/kurz/.vscode-oss/extensions/deeptask.deeptask-5.5.0/"
    "webview-ui/build/assets/index.js"
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


with ZipFile(VSIX) as archive:
    bundle_name = next(
        name
        for name in archive.namelist()
        if name == "extension/webview-ui/build/assets/index.js"
    )
    packaged = archive.read(bundle_name)

installed = INSTALLED.read_bytes()
text = installed.decode(errors="ignore")

checks = {
    "installed_matches_vsix_index": installed == packaged,
    "submit_edited_message_present": "submitEditedMessage" in text,
    "edited_resend_callback_before_submit": bool(
        re.search(
            r"[A-Za-z_$][\w$]*==null\|\|[A-Za-z_$][\w$]*\([^,]+,[^)]+\),"
            r"[A-Za-z_$][\w$]*\.postMessage\(\{type:\"submitEditedMessage\"",
            text,
        )
    ),
    "edited_resend_feedback_factory_present": bool(
        re.search(
            r"useCallback\(\([^)]*\)=>\{const [A-Za-z_$][\w$]*="
            r"\{ts:Date\.now\(\),type:\"say\",say:\"user_feedback\",text:",
            text,
        )
    ),
    "empty_conversation_clear_boundary_present": bool(
        re.search(r"\.length===0.{0,300}user_feedback", text)
        or re.search(r"user_feedback.{0,300}\.length===0", text)
    ),
    "legacy_visible_queue_absent": "queued-messages" not in text,
}

for name, passed in checks.items():
    print(f"{name}={passed}")

print(f"vsix_size={VSIX.stat().st_size}")
print(f"vsix_sha256={sha256(VSIX)}")
print(f"installed_index_size={INSTALLED.stat().st_size}")

if not all(checks.values()):
    raise SystemExit("edited resend installed bundle verification failed")
