import * as vscode from "vscode"
import * as path from "path"

/**
 * Checks if a file path is outside the task cwd and all VS Code workspace folders.
 * Parallel worktrees may not be vscode.workspaceFolders[0]; callers must pass task.cwd
 * so a switched conversation is not treated as "outside workspace".
 * @param filePath The file path to check
 * @param cwd Optional task working directory (kilocode_change)
 * @returns true if the path is outside all known workspace roots, false otherwise
 */
export function isPathOutsideWorkspace(filePath: string, cwd?: string): boolean {
	const roots: string[] = []
	if (cwd) {
		roots.push(path.resolve(cwd))
	}
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		roots.push(folder.uri.fsPath)
	}

	// If there are no workspace roots, consider everything outside workspace for safety
	if (roots.length === 0) {
		return true
	}

	// Normalize and resolve the path to handle .. and . components correctly
	const absolutePath = path.resolve(filePath)

	return !roots.some((folderPath) => {
		return absolutePath === folderPath || absolutePath.startsWith(folderPath + path.sep)
	})
}
