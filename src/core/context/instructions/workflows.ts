import path from "path"
import os from "os"
import fs from "fs/promises"
import * as vscode from "vscode"
import { ClineRulesToggles } from "../../../shared/cline-rules"
import { ContextProxy } from "../../config/ContextProxy"
import { GlobalFileNames } from "../../../shared/globalFileNames"
import { synchronizeRuleToggles } from "./rule-helpers"

// kilocode_change start: seed built-in git workflows shipped with the extension
// into the unified global workflows dir on first run (never overwrite user files).
export async function seedBuiltinWorkflows(context: vscode.ExtensionContext): Promise<void> {
	try {
		const globalWorkflowsDir = path.join(os.homedir(), GlobalFileNames.workflows)
		await fs.mkdir(globalWorkflowsDir, { recursive: true })
		// Resolve the bundled defaults/workflows dir: packaged VSIX puts it under
		// dist/defaults, development mode serves it straight from src/defaults.
		const extRoot = context.extensionUri.fsPath
		const candidates = [
			path.join(extRoot, "dist", "defaults", "workflows"),
			path.join(extRoot, "defaults", "workflows"),
		]
		let builtinDir: string | undefined
		for (const candidate of candidates) {
			if (await fs.stat(candidate).then(() => true).catch(() => false)) {
				builtinDir = candidate
				break
			}
		}
		if (!builtinDir) {
			return
		}
		const entries = await fs.readdir(builtinDir, { withFileTypes: true }).catch(() => [])
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
				continue
			}
			const source = path.join(builtinDir, entry.name)
			const target = path.join(globalWorkflowsDir, entry.name)
			// Only seed when the target does not exist yet (user edits always win).
			const exists = await fs.stat(target).then(() => true).catch(() => false)
			if (!exists) {
				await fs.copyFile(source, target)
			}
		}
	} catch {
		// Seeding is best-effort and must never break toggle refresh.
	}
}
// kilocode_change end

async function refreshLocalWorkflowToggles(
	proxy: ContextProxy,
	context: vscode.ExtensionContext,
	workingDirectory: string,
) {
	const workflowRulesToggles =
		((await proxy.getWorkspaceState(context, "localWorkflowToggles")) as ClineRulesToggles) || {}
	const workflowsDirPath = path.resolve(workingDirectory, GlobalFileNames.workflows)
	const updatedWorkflowToggles = await synchronizeRuleToggles(workflowsDirPath, workflowRulesToggles)
	await proxy.updateWorkspaceState(context, "localWorkflowToggles", updatedWorkflowToggles)
	return updatedWorkflowToggles
}

async function refreshGlobalWorkflowToggles(proxy: ContextProxy) {
	const globalWorkflowToggles = ((await proxy.getGlobalState("globalWorkflowToggles")) as ClineRulesToggles) || {}
	const globalWorkflowsDir = path.join(os.homedir(), GlobalFileNames.workflows)
	const updatedGlobalWorkflowToggles = await synchronizeRuleToggles(globalWorkflowsDir, globalWorkflowToggles)
	await proxy.updateGlobalState("globalWorkflowToggles", updatedGlobalWorkflowToggles)
	return updatedGlobalWorkflowToggles
}

export async function refreshWorkflowToggles(
	context: vscode.ExtensionContext,
	workingDirectory: string,
): Promise<{
	globalWorkflowToggles: ClineRulesToggles
	localWorkflowToggles: ClineRulesToggles
}> {
	const proxy = new ContextProxy(context)
	await seedBuiltinWorkflows(context) // kilocode_change: ensure built-in workflows exist before syncing
	return {
		globalWorkflowToggles: await refreshGlobalWorkflowToggles(proxy),
		localWorkflowToggles: await refreshLocalWorkflowToggles(proxy, context, workingDirectory),
	}
}
