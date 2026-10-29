// kilocode_change - new file
import * as vscode from "vscode"
import { registerGhostProvider } from "../index"

const ghost = vi.hoisted(() => ({
	load: vi.fn(),
	codeSuggestion: vi.fn(),
	showIncompatibilityExtensionPopup: vi.fn(),
	disable: vi.fn(),
	dispose: vi.fn(),
	codeActionProvider: { providedCodeActionKinds: {} },
}))
vi.mock("vscode", () => ({
	commands: { registerCommand: vi.fn() },
	extensions: { getExtension: vi.fn() },
	languages: { registerCodeActionsProvider: vi.fn(() => ({ dispose: vi.fn() })) },
}))
vi.mock("../GhostServiceManager", () => ({ GhostServiceManager: vi.fn(() => ghost) }))
vi.mock("../GhostJetbrainsBridge", () => ({ registerGhostJetbrainsBridge: vi.fn() }))

describe("Ghost service command registration", () => {
	const commands = new Map<string, (...args: any[]) => unknown>()
	let subscriptions: vscode.Disposable[]
	beforeEach(() => {
		vi.clearAllMocks()
		commands.clear()
		subscriptions = []
		vi.mocked(vscode.extensions.getExtension).mockReturnValue(undefined)
		vi.mocked(vscode.commands.registerCommand).mockImplementation((id, callback) => {
			if (commands.has(id)) throw new Error(`command '${id}' already exists`)
			commands.set(id, callback)
			return {
				dispose: () => {
					if (commands.get(id) === callback) commands.delete(id)
				},
			}
		})
	})
	afterEach(() => {
		for (const owner of subscriptions.splice(0).reverse()) owner.dispose()
	})

	it.each([false, true])("registers primary controls with Kilo present=%s", async (present) => {
		if (present)
			vi.mocked(vscode.extensions.getExtension).mockReturnValue({ isActive: false } as vscode.Extension<unknown>)
		const other = vi.fn()
		if (present) commands.set("kilo-code.ghost.reload", other)
		registerGhostProvider({ subscriptions } as unknown as vscode.ExtensionContext, {} as any)
		for (const [suffix, callback] of [
			["reload", ghost.load],
			["generateSuggestions", ghost.codeSuggestion],
			["showIncompatibilityExtensionPopup", ghost.showIncompatibilityExtensionPopup],
			["disable", ghost.disable],
		] as const) {
			await commands.get(`deeptask.ghost.${suffix}`)!()
			expect(callback).toHaveBeenCalledTimes(1)
			if (!present) {
				await commands.get(`kilo-code.ghost.${suffix}`)!()
				expect(callback).toHaveBeenCalledTimes(2)
			}
		}
		expect(vscode.languages.registerCodeActionsProvider).toHaveBeenCalledWith("*", ghost.codeActionProvider, {
			providedCodeActionKinds: [],
		})
		for (const owner of subscriptions.splice(0).reverse()) owner.dispose()
		expect(ghost.dispose).toHaveBeenCalledTimes(1)
		expect([...commands.keys()]).toEqual(present ? ["kilo-code.ghost.reload"] : [])
		if (present) expect(commands.get("kilo-code.ghost.reload")).toBe(other)
	})

	it("awaits reload and propagates its failure", async () => {
		registerGhostProvider({ subscriptions } as unknown as vscode.ExtensionContext, {} as any)
		const failure = new Error("reload rejected")
		ghost.load.mockRejectedValueOnce(failure)
		await expect(commands.get("deeptask.ghost.reload")!()).rejects.toBe(failure)
	})
})
