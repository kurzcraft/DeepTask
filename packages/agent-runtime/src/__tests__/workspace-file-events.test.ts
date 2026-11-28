import { describe, expect, it } from "vitest"
import { ExtensionContext, Uri, WorkspaceAPI } from "../host/VSCode.js"

describe("WorkspaceAPI file events", () => {
	it("exposes onDidCreateFiles/onDidDeleteFiles/onDidRenameFiles/onDidSaveTextDocument", () => {
		const ctx = new ExtensionContext("/tmp/deeptask-ext", "/tmp/deeptask-ws", true)
		const workspace = new WorkspaceAPI("/tmp/deeptask-ws", ctx)

		expect(typeof workspace.onDidCreateFiles).toBe("function")
		expect(typeof workspace.onDidDeleteFiles).toBe("function")
		expect(typeof workspace.onDidRenameFiles).toBe("function")
		expect(typeof workspace.onDidSaveTextDocument).toBe("function")

		const created: string[] = []
		const deleted: string[] = []
		const renamed: string[] = []
		const saved: string[] = []

		workspace.onDidCreateFiles((event) => {
			created.push(...event.files.map((u) => u.fsPath))
		})
		workspace.onDidDeleteFiles((event) => {
			deleted.push(...event.files.map((u) => u.fsPath))
		})
		workspace.onDidRenameFiles((event) => {
			renamed.push(...event.files.map((f) => `${f.oldUri.fsPath}->${f.newUri.fsPath}`))
		})
		workspace.onDidSaveTextDocument((doc) => {
			saved.push(doc.uri.fsPath)
		})

		const createdUri = Uri.file("/tmp/deeptask-ws/a.py")
		const deletedUri = Uri.file("/tmp/deeptask-ws/b.py")
		const oldUri = Uri.file("/tmp/deeptask-ws/old.py")
		const newUri = Uri.file("/tmp/deeptask-ws/new.py")

		;(
			workspace as unknown as { _onDidCreateFiles: { fire: (e: { files: readonly Uri[] }) => void } }
		)._onDidCreateFiles.fire({
			files: [createdUri],
		})
		;(
			workspace as unknown as { _onDidDeleteFiles: { fire: (e: { files: readonly Uri[] }) => void } }
		)._onDidDeleteFiles.fire({
			files: [deletedUri],
		})
		;(
			workspace as unknown as {
				_onDidRenameFiles: { fire: (e: { files: ReadonlyArray<{ oldUri: Uri; newUri: Uri }> }) => void }
			}
		)._onDidRenameFiles.fire({ files: [{ oldUri, newUri }] })
		;(
			workspace as unknown as { _onDidSaveTextDocument: { fire: (e: { uri: Uri }) => void } }
		)._onDidSaveTextDocument.fire({ uri: createdUri })

		expect(created).toEqual(["/tmp/deeptask-ws/a.py"])
		expect(deleted).toEqual(["/tmp/deeptask-ws/b.py"])
		expect(renamed).toEqual(["/tmp/deeptask-ws/old.py->/tmp/deeptask-ws/new.py"])
		expect(saved).toEqual(["/tmp/deeptask-ws/a.py"])
	})
})
