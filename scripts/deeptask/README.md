# Deeptask Automation

Deeptask-specific packaging, release, diagnostics, and migration tools live in this directory.
Run commands from the repository root unless a script states otherwise.

Stable release workflow:

1. `bash scripts/deeptask/scripts_package_deeptask_vsix.sh`
2. `node scripts/deeptask/scripts_publish_github_release.mjs`
3. `node scripts/deeptask/scripts_verify_authenticated_release_asset.mjs`

All other files are focused maintenance or historical verification tools. New reusable project-wide
automation belongs in the existing top-level `scripts/` hierarchy; new Deeptask-only tools belong
here, never in the repository root.
