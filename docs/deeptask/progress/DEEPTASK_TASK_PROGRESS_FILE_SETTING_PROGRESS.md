# Deeptask task progress file setting progress

- [x] Create progress record for task progress file setting
- [x] Locate checkpoint settings UI, global settings types, and state sync path
- [x] Add create/read task progress file setting as first checkpoint option
- [x] Inject task-start instruction when setting is enabled
- [x] Add focused tests and local verification
- [x] Package, install, and update GitHub release
- [x] Store learning

## User Request

Add an option in the plugin's checkpoint/archive settings: create task progress file. When checked, it should notify the model at task start to create or read a task progress file so progress can be restored across sessions. Put it as the first setting in that section.

## Working Hypothesis

This likely needs a persisted global setting, a UI checkbox/toggle in the checkpoint settings section, and a system prompt or task-start custom instruction injection path. The instruction should be explicit but scoped: create a markdown progress file if missing, read it if present, and update it as milestones complete.

## Constraints

- Preserve existing checkpoint settings behavior.
- Follow current settings state patterns and i18n conventions.
- Add tests at the closest stable layer.
- Use kilocode_change markers for core/shared/webview changes where appropriate.

## Verification

- `cd src && pnpm exec vitest run core/prompts/__tests__/system-prompt.spec.ts`: passed, 19 tests.
- `cd webview-ui && pnpm exec vitest run src/components/settings/__tests__/SettingsView.change-detection.spec.tsx src/components/settings/__tests__/SettingsView.unsaved-changes.spec.tsx`: passed, 3 tests, 5 skipped.
- `pnpm check-types`: passed across 22 tasks after aligning existing Deeptask type/schema drift.
- `./scripts_package_deeptask_vsix.sh`: built `deeptask-5.5.0.vsix`, size 42,398,341 bytes after rebuilding webview assets.
- VSIX content check: extension bundle contains `taskProgressFileEnabled` and `TASK PROGRESS FILE`; webview bundle contains `taskProgressFileEnabled`, `Create task progress file`, and `创建任务进度文件`.
- Installed with `code --install-extension deeptask-5.5.0.vsix --force` and `codium --install-extension deeptask-5.5.0.vsix --force`; both installed bundles contain the extension and webview task progress strings.
