// kilocode_change - new file
import * as vscode from "vscode"
import { GhostServiceManager } from "./GhostServiceManager"
import { ClineProvider } from "../../core/webview/ClineProvider"
import { registerGhostJetbrainsBridge } from "./GhostJetbrainsBridge"
import { registerNamespacedCommands } from "../../utils/registerNamespacedCommands"

export const registerGhostProvider = (context: vscode.ExtensionContext, cline: ClineProvider) => {
	const ghost = new GhostServiceManager(context, cline)
	context.subscriptions.push(ghost)

	// Register JetBrains Bridge if applicable
	registerGhostJetbrainsBridge(context, cline, ghost)

	// Keep primary commands and legacy aliases under one disposable owner.
	context.subscriptions.push(
		registerNamespacedCommands([
			{ command: "deeptask.ghost.reload", legacyCommand: "kilo-code.ghost.reload", callback: () => ghost.load() },
			{
				command: "deeptask.ghost.codeActionQuickFix",
				legacyCommand: "kilo-code.ghost.codeActionQuickFix",
				callback: async () => undefined,
			},
			{
				command: "deeptask.ghost.generateSuggestions",
				legacyCommand: "kilo-code.ghost.generateSuggestions",
				callback: () => ghost.codeSuggestion(),
			},
			{
				command: "deeptask.ghost.showIncompatibilityExtensionPopup",
				legacyCommand: "kilo-code.ghost.showIncompatibilityExtensionPopup",
				callback: () => ghost.showIncompatibilityExtensionPopup(),
			},
			{
				command: "deeptask.ghost.disable",
				legacyCommand: "kilo-code.ghost.disable",
				callback: () => ghost.disable(),
			},
		]),
	)

	// Register GhostServiceManager Code Actions
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider("*", ghost.codeActionProvider, {
			providedCodeActionKinds: Object.values(ghost.codeActionProvider.providedCodeActionKinds),
		}),
	)
}
