// kilocode_change - new file
import * as vscode from "vscode"

interface NamespacedCommand {
	command: string
	legacyCommand?: string
	callback: (...args: any[]) => unknown
}

/**
 * Register DeepTask-owned commands without claiming a co-installed Kilo extension's IDs.
 * Legacy aliases are best-effort only for duplicate IDs; all other errors roll back
 * this registration group and propagate. The returned owner is safe to dispose twice.
 */
export function registerNamespacedCommands(commands: readonly NamespacedCommand[]): vscode.Disposable {
	const registrations: vscode.Disposable[] = []
	const owner = {
		dispose: () => {
			for (const registration of registrations.splice(0).reverse()) {
				registration.dispose()
			}
		},
	}

	try {
		for (const { command, callback } of commands) {
			registrations.push(vscode.commands.registerCommand(command, callback))
		}

		// Presence, not isActive: Kilo may activate after DeepTask in this host.
		if (!vscode.extensions.getExtension("kilocode.kilo-code")) {
			for (const { legacyCommand, callback } of commands) {
				if (!legacyCommand) continue
				try {
					registrations.push(vscode.commands.registerCommand(legacyCommand, callback))
				} catch (error) {
					// Registration is synchronous; an occupied alias must never replace its owner.
					if (!(error instanceof Error) || error.message !== `command '${legacyCommand}' already exists`) {
						throw error
					}
					console.warn(`[DeepTask] Legacy command already owned; alias skipped: ${legacyCommand}`)
				}
			}
		}
		return owner
	} catch (error) {
		owner.dispose()
		throw error
	}
}
