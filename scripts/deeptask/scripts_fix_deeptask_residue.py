#!/usr/bin/env python3
"""Remove remaining user-facing Kilo branding from Deeptask legacy artifacts."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

README = """<p align=\"center\">\n  <img src=\"../logo.png\" alt=\"Deeptask\" width=\"302\" />\n</p>\n\n# Deeptask\n\nDeeptask is an AI coding agent packaged from the verified 5.5.0 legacy source line for Deeptask distribution.\n\n- Generate code from natural language\n- Check and iterate on its own work\n- Run terminal commands\n- Automate browser workflows\n- Provide inline autocomplete suggestions\n- Work with modern AI model providers\n\n## Key Features\n\n- **Code Generation:** Deeptask can generate code from natural language.\n- **Inline Autocomplete:** Get intelligent code completions as you type.\n- **Task Automation:** Deeptask can automate repetitive coding tasks.\n- **Automated Refactoring:** Deeptask can refactor and improve existing code.\n- **MCP Server Marketplace:** Deeptask can use MCP servers to extend agent capabilities.\n- **Multi Mode:** Plan with Architect, code with Coder, debug with Debugger, and define custom modes.\n\n## Release Highlights\n\n- New installs start directly in the normal Deeptask workspace instead of the onboarding screen.\n- The default provider profile is OpenAI Compatible, ready for a user-supplied endpoint and key.\n- No model API base URI or API key is embedded in the release default profile.\n- The default profile keeps practical non-secret defaults, including model id, streaming, max-token inclusion, diff support, todo list support, mistake limit, and native tool protocol.\n- Regression tests cover both the seeded default provider profile and the welcome-screen configuration gate.\n\n## Source Layout\n\n- `src/` contains the VS Code extension host, provider configuration, task runtime, tools, services, and webview message handling.\n- `webview-ui/` contains the React webview application used by the chat, settings, onboarding, marketplace, and agent-manager surfaces.\n- `packages/` contains shared libraries such as provider types, telemetry, IPC, cloud integration, and build tooling.\n- `cli/` contains the standalone command-line package.\n- `apps/` contains documentation, Storybook, and end-to-end test applications.\n- `jetbrains/` contains the JetBrains plugin and Node.js host.\n\n## Code Quality Notes\n\n- Deeptask-specific changes in shared upstream areas should be small and marked with `kilocode_change` comments.\n- Provider defaults are centralized in `src/core/config/ProviderSettingsManager.ts`.\n- Welcome and onboarding gates are kept separate: API configuration completeness is checked in `src/shared/checkExistApiConfig.ts`, while Kilo onboarding state is exposed from `src/core/webview/ClineProvider.ts` and rendered by `webview-ui/src/App.tsx`.\n- Provider profile tests live beside the configuration manager, and shared API configuration gate tests live under `src/shared/__tests__/`.\n\n## Get Started\n\n1. Install the generated `deeptask-5.5.0.vsix` package in VS Code.\n2. Open Deeptask and enter your OpenAI-compatible API base URI and key in provider settings.\n3. Start coding with AI that adapts to your workflow.\n\n## Developer Setup\n\nIf you want to modify the extension locally, see `DEVELOPMENT.md` for build and setup instructions.\n\nFor release verification, run focused tests from the `src` workspace, for example:\n\n```bash\npnpm test core/config/__tests__/ProviderSettingsManager.spec.ts shared/__tests__/checkExistApiConfig.spec.ts\n```\n\nBuild the release VSIX with:\n\n```bash\n./scripts_package_deeptask_vsix.sh\n```\n\n## License\n\nThis project is licensed under the Apache License 2.0. See `LICENSE` for details.\n"""

ICON_SVGS = {
    "src/assets/icons/kilo-light.svg": "#141414",
    "src/assets/icons/kilo-dark.svg": "#F5F5F5",
    "src/assets/icons/kilo-white.svg": "#FFFFFF",
}

TEXT_REPLACEMENTS = [
    ("Kilo Code", "Deeptask"),
    ("Kilo Coders", "Deeptask users"),
    ("Kilo coder", "Deeptask user"),
    ("Kilo coders", "Deeptask users"),
    ("Kilo users", "Deeptask users"),
    ("Kilo user", "Deeptask user"),
    ("Kilo is", "Deeptask is"),
    ("Kilo can", "Deeptask can"),
    ("Kilo will", "Deeptask will"),
    ("with Kilo", "with Deeptask"),
    ("Kilo ", "Deeptask "),
    (" Kilo", " Deeptask"),
    ("github.com/Kilo-Org/kilocode", "github.com/kurzcraft/DeepTask"),
    ("https://github.com/Kilo-Org/kilocode", "https://github.com/kurzcraft/DeepTask"),
    ("https://kilo.ai/support", "https://github.com/kurzcraft/DeepTask/issues"),
    ("support@kilo.ai", "support@deeptask.local"),
    ("https://kilo.ai/discord", "https://github.com/kurzcraft/DeepTask/discussions"),
    ("https://discord.gg/kilocode", "https://github.com/kurzcraft/DeepTask/discussions"),
    ("https://www.reddit.com/r/kilocode/", "https://github.com/kurzcraft/DeepTask/discussions"),
    ("reddit.com/r/kilocode", "github.com/kurzcraft/DeepTask/discussions"),
    ("https://x.com/kilocode", "https://github.com/kurzcraft/DeepTask"),
    ("https://blog.kilo.ai", "https://github.com/kurzcraft/DeepTask"),
    ("https://kilo.ai", "https://github.com/kurzcraft/DeepTask"),
    ("kilocode.Kilo-Code", "deeptask.deeptask"),
    ("Kilo-Code", "deeptask"),
]

BUNDLE_RESIDUE_REPLACEMENTS = TEXT_REPLACEMENTS + [
    ("Kilo_Code_Branding", "Deeptask_Branding"),
    ("Kilo Code Branding", "Deeptask Branding"),
    ("kilo.ai/discord", "github.com/kurzcraft/DeepTask/discussions"),
    ("kilo.ai", "github.com/kurzcraft/DeepTask"),
]


def replace_text(path: Path, replacements: list[tuple[str, str]]) -> int:
    if not path.exists() or not path.is_file():
        return 0
    text = path.read_text(errors="ignore")
    old = text
    for src, dst in replacements:
        text = text.replace(src, dst)
    if text != old:
        path.write_text(text)
        return 1
    return 0


def patch_package_nls() -> int:
    changed = 0
    for path in ROOT.glob("src/package.nls*.json"):
        data = json.loads(path.read_text())
        for key in [
            "extension.displayName",
            "views.activitybar.title",
            "views.contextMenu.label",
            "views.terminalMenu.label",
            "views.sidebar.name",
            "configuration.title",
        ]:
            if key in data:
                if key == "extension.displayName":
                    data[key] = "Deeptask: AI Coding Agent, Copilot, and Autocomplete"
                else:
                    data[key] = "Deeptask"
        for key, value in list(data.items()):
            if isinstance(value, str):
                new = value
                for src, dst in TEXT_REPLACEMENTS:
                    new = new.replace(src, dst)
                data[key] = new
        path.write_text(json.dumps(data, ensure_ascii=False, indent="\t") + "\n")
        changed += 1
    return changed


def patch_json_tree(root: Path) -> int:
    changed = 0
    for path in root.rglob("*.json"):
        if not path.is_file():
            continue
        try:
            text = path.read_text(errors="ignore")
            data = json.loads(text)
        except Exception:
            changed += replace_text(path, BUNDLE_RESIDUE_REPLACEMENTS)
            continue
        new_text = json.dumps(data, ensure_ascii=False, indent="\t") + "\n"
        for src, dst in TEXT_REPLACEMENTS:
            new_text = new_text.replace(src, dst)
        if new_text != text:
            path.write_text(new_text)
            changed += 1
    return changed


def patch_text_tree(root: Path, suffixes: set[str], replacements: list[tuple[str, str]]) -> int:
    changed = 0
    if not root.exists():
        return changed
    for path in root.rglob("*"):
        if path.is_file() and path.suffix in suffixes:
            changed += replace_text(path, replacements)
    return changed


def write_icons() -> int:
    changed = 0
    for rel, color in ICON_SVGS.items():
        path = ROOT / rel
        content = f'''<svg width="256" height="256" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M128 10L62 220L128 182L128 10Z" stroke="{color}" stroke-width="10" stroke-linejoin="round"/>
  <path d="M128 10L194 220L128 182V10Z" fill="{color}"/>
</svg>
'''
        if path.read_text() != content:
            path.write_text(content)
            changed += 1
    return changed


def main() -> None:
    changed = 0
    # The root README is the release source of truth. Never restore the legacy
    # embedded README constant after esbuild has copied the current Marketplace page.
    root_readme = (ROOT / "README.md").read_text()
    packaged_readme = ROOT / "src/README.md"
    if not packaged_readme.exists() or packaged_readme.read_text() != root_readme:
        packaged_readme.write_text(root_readme)
        changed += 1
    changed += patch_package_nls()
    changed += patch_json_tree(ROOT / "src/dist/i18n/locales")
    changed += patch_text_tree(ROOT / "src/dist/walkthrough", {".md"}, TEXT_REPLACEMENTS)
    changed += patch_text_tree(ROOT / "src/webview-ui/build/assets", {".js", ".html", ".json"}, BUNDLE_RESIDUE_REPLACEMENTS)
    changed += patch_text_tree(ROOT / "src/dist", {".js", ".html", ".json", ".md"}, BUNDLE_RESIDUE_REPLACEMENTS)
    changed += write_icons()
    print(f"patched files groups: {changed}")


if __name__ == "__main__":
    main()
