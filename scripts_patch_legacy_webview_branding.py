#!/usr/bin/env python3
"""Patch legacy prebuilt webview bundles for Deeptask branding.

This repository may package from existing build artifacts when dependencies are
not installed. Source files are already rebranded, but stale built assets can
still contain user-visible Kilo Code branding. This script applies narrow,
repeatable replacements to those prebuilt assets before VSIX packaging.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent
ASSETS = ROOT / "src" / "webview-ui" / "build" / "assets"

DEEPTASK_LOGO_50 = (
    'n.jsx("svg",{id:"Deeptask_Branding",xmlns:"http://www.w3.org/2000/svg",'
    'version:"1.1",viewBox:"0 0 256 256",className:"mb-4 mt-4",width:o,height:i,'
    '"aria-label":"Deeptask",children:n.jsxs("g",{children:['
    'n.jsx("path",{d:"M128 10L62 220L128 182L128 10Z",fill:"none",stroke:"currentColor",strokeWidth:10,strokeLinejoin:"round"}),'
    'n.jsx("path",{fill:"currentColor",fillOpacity:.72,d:"M128 10L194 220L128 182V10Z"})]})})'
)

DEEPTASK_LOGO_AGENT = (
    'o.jsx("svg",{id:"Deeptask_Branding","data-name":"Deeptask Branding",'
    'xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 256 256",width:"100%",height:"100%",'
    'style:r,"aria-label":"Deeptask",children:o.jsxs("g",{children:['
    'o.jsx("path",{d:"M128 10L62 220L128 182L128 10Z",fill:"none",stroke:i,strokeWidth:10,strokeLinejoin:"round"}),'
    'o.jsx("path",{fill:i,fillOpacity:.72,d:"M128 10L194 220L128 182V10Z"})]})})'
)

REPLACEMENTS = {
    ASSETS / "chunk-Bew6GbSe.js": [
        ('about:"About Kilo Code"', 'about:"About Deeptask"'),
        ("Kilo Code will", "Deeptask will"),
        ('testTitle:"Kilo Code"', 'testTitle:"Deeptask"'),
        ('testMessage:"This is a test notification from Kilo Code."', 'testMessage:"This is a test notification from Deeptask."'),
        ("other Kilo Code users", "other Deeptask users"),
        ("https://kilo.ai/support", "https://github.com/kurzgesagtcraft/deeptask/issues"),
        ("github.com/Kilo-Org/kilocode", "github.com/kurzgesagtcraft/deeptask"),
        ("reddit.com/r/kilocode", "github.com/kurzgesagtcraft/deeptask/discussions"),
        ("kilo.ai/discord", "github.com/kurzgesagtcraft/deeptask/discussions"),
    ],
    ASSETS / "index.js": [
        ("https://kilo.ai/support", "https://github.com/kurzgesagtcraft/deeptask/issues"),
        (
            'let C;e[29]===Symbol.for("react.memo_cache_sentinel")?(C=n.jsx("div",{children:n.jsx(ft,{i18nKey:"settings:footer.feedback",components:{githubLink:n.jsx(yt,{href:"https://github.com/Kilo-Org/kilocode"}),redditLink:n.jsx(yt,{href:"https://reddit.com/r/kilocode"}),discordLink:n.jsx(yt,{href:"https://kilo.ai/discord"})}})}),e[29]=C):C=e[29];let S;e[30]===Symbol.for("react.memo_cache_sentinel")?(S=n.jsx("div",{children:n.jsx(ft,{i18nKey:"settings:footer.support",components:{supportLink:n.jsx(yt,{href:"https://kilo.ai/support"})}})}),e[30]=S):S=e[30];',
            'let C;e[29]===Symbol.for("react.memo_cache_sentinel")?(C=null,e[29]=C):C=e[29];let S;e[30]===Symbol.for("react.memo_cache_sentinel")?(S=null,e[30]=S):S=e[30];',
        ),
        (
            'n.jsx("svg",{id:"Kilo_Code_Branding",xmlns:"http://www.w3.org/2000/svg",version:"1.1",viewBox:"0 0 50 50",className:"mb-4 mt-4",width:o,height:i,children:l})',
            DEEPTASK_LOGO_50,
        ),
    ],
    ASSETS / "agent-manager.js": [
        (
            'o.jsx("svg",{id:"Layer_2","data-name":"Layer 2",xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 100 100",width:"100%",height:"100%",style:r,children:o.jsx("g",{id:"Kilo_Code_Branding","data-name":"Kilo Code Branding",children:o.jsx("path",{id:"Logo_Outline_-_White","data-name":"Logo Outline - White",fill:i,d:"M0,0v100h100V0H0ZM92.5925926,92.5925926H7.4074074V7.4074074h85.1851852v85.1851852ZM61.1111044,71.9096084h9.2592593v7.4074074h-11.6402116l-5.026455-5.026455v-11.6402116h7.4074074v9.2592593ZM77.7777711,71.9096084h-7.4074074v-9.2592593h-9.2592593v-7.4074074h11.6402116l5.026455,5.026455v11.6402116ZM46.2962963,61.1114207h-7.4074074v-7.4074074h7.4074074v7.4074074ZM22.2222222,53.7040133h7.4074074v16.6666667h16.6666667v7.4074074h-19.047619l-5.026455-5.026455v-19.047619ZM77.7777711,38.8888889v7.4074074h-24.0740741v-7.4074074h8.2781918v-9.2592593h-8.2781918v-7.4074074h10.6591442l5.026455,5.026455v11.6402116h8.3884749ZM29.6296296,30.5555556h9.2592593l7.4074074,7.4074074v8.3333333h-7.4074074v-8.3333333h-9.2592593v8.3333333h-7.4074074v-24.0740741h7.4074074v8.3333333ZM46.2962963,30.5555556h-7.4074074v-8.3333333h7.4074074v8.3333333Z"})})})',
            DEEPTASK_LOGO_AGENT,
        ),
    ],
}

RESIDUE_PATTERNS = [
    "About Kilo Code",
    'alt="Kilo Code"',
    "Kilo_Code_Branding",
    "Kilo Code Branding",
    "Development: Allocate memory",
    "settings:footer.support",
    "https://kilo.ai/support",
]


def patch_file(path: Path, replacements: list[tuple[str, str]]) -> int:
    text = path.read_text()
    count = 0
    for old, new in replacements:
        occurrences = text.count(old)
        if occurrences == 0:
            print(f"WARN no match in {path}: {old[:80]!r}")
            continue
        text = text.replace(old, new)
        count += occurrences
        print(f"patched {path}: {occurrences} replacement(s)")
    path.write_text(text)
    return count


def main() -> None:
    total = 0
    checked_paths: list[Path] = []
    for path, replacements in REPLACEMENTS.items():
        if not path.exists():
            print(f"WARN missing build asset, skipped legacy patch: {path}")
            continue
        checked_paths.append(path)
        total += patch_file(path, replacements)

    failures: list[str] = []
    for path in checked_paths:
        text = path.read_text(errors="ignore")
        for pattern in RESIDUE_PATTERNS:
            if pattern in text:
                failures.append(f"{path}: {pattern}")
    if failures:
        raise SystemExit("branding residue remains:\n" + "\n".join(failures))
    print(f"legacy webview branding patch complete: {total} replacement(s)")


if __name__ == "__main__":
    main()
