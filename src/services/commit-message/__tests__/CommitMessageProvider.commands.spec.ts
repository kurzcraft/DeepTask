// kilocode_change - new file
import * as vscode from "vscode"
import { CommitMessageProvider } from "../CommitMessageProvider"

const mocks = vi.hoisted(() => ({
	generateVSCode: vi.fn(),
	generateJetBrains: vi.fn(),
	disposeVSCode: vi.fn(),
	disposeJetBrains: vi.fn(),
}))

vi.mock("vscode", () => ({
	commands: { registerCommand: vi.fn() },
	extensions: { getExtension: vi.fn() },
	workspace: { workspaceFolders: [{ uri: { fsPath: "/workspace" } }] },
	window: { showErrorMessage: vi.fn() },
}))
vi.mock("../../../core/config/ProviderSettingsManager", () => ({ ProviderSettingsManager: class {} }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../CommitMessageGenerator", () => ({ CommitMessageGenerator: class {} }))
vi.mock("../adapters/VSCodeCommitMessageAdapter", () => ({
	VSCodeCommitMessageAdapter: class {
		generateCommitMessage = mocks.generateVSCode
		dispose = mocks.disposeVSCode
	},
}))
vi.mock("../adapters/JetBrainsCommitMessageAdapter", () => ({
	JetBrainsCommitMessageAdapter: class {
		generateCommitMessage = mocks.generateJetBrains
		dispose = mocks.disposeJetBrains
	},
}))

describe("CommitMessageProvider command ownership", () => {
	const callbacks = new Map<string, (...args: any[]) => unknown>()
	let provider: CommitMessageProvider

	beforeEach(() => {
		vi.resetAllMocks()
		callbacks.clear()
		vi.mocked(vscode.commands.registerCommand).mockImplementation((id, callback) => {
			if (callbacks.has(id)) throw new Error(`command '${id}' already exists`)
			callbacks.set(id, callback)
			return {
				dispose: () => {
					if (callbacks.get(id) === callback) callbacks.delete(id)
				},
			}
		})
		provider = new CommitMessageProvider(
			{ subscriptions: [] } as unknown as vscode.ExtensionContext,
			{ appendLine: vi.fn() } as unknown as vscode.OutputChannel,
		)
	})

	afterEach(() => provider.dispose())

	it.each(["kilo-first", "deeptask-first"])("activates without stealing commands: %s", async (order) => {
		vi.mocked(vscode.extensions.getExtension).mockReturnValue({ isActive: false } as vscode.Extension<unknown>)
		const oldCallback = vi.fn()
		const legacy = "kilo-code.vsc.generateCommitMessage"
		if (order === "kilo-first") callbacks.set(legacy, oldCallback)
		await provider.activate()
		if (order === "deeptask-first") vscode.commands.registerCommand(legacy, oldCallback)
		expect(callbacks.get(legacy)).toBe(oldCallback)
		expect(callbacks.has("deeptask.vsc.generateCommitMessage")).toBe(true)
		expect(callbacks.has("kilo-code.jetbrains.generateCommitMessage")).toBe(false)
		provider.dispose()
		expect([...callbacks.keys()]).toEqual([legacy])
	})

	it("preserves SCM target identity through current and legacy commands", async () => {
		await provider.activate()
		const inputBox = { value: "原始内容" }
		const rootUri = { fsPath: "/selected/repository" }
		for (const id of ["deeptask.vsc.generateCommitMessage", "kilo-code.vsc.generateCommitMessage"]) {
			await callbacks.get(id)!({ inputBox, rootUri })
			expect(mocks.generateVSCode).toHaveBeenLastCalledWith({
				workspacePath: rootUri.fsPath,
				vscodeTarget: { inputBox, rootUri },
			})
			expect(mocks.generateVSCode.mock.calls.at(-1)![0].vscodeTarget.inputBox).toBe(inputBox)
		}
	})

	it("preserves JetBrains RPC arguments, results and rejections", async () => {
		await provider.activate()
		const selectedFiles = ["完整.ts"]
		const result = { success: true, message: "完整提交" }
		mocks.generateJetBrains.mockResolvedValue(result)
		for (const id of ["deeptask.jetbrains.generateCommitMessage", "kilo-code.jetbrains.generateCommitMessage"]) {
			expect(await callbacks.get(id)!(["/selected/repository", selectedFiles])).toBe(result)
			expect(mocks.generateJetBrains).toHaveBeenLastCalledWith({
				workspacePath: "/selected/repository",
				selectedFiles,
			})
		}
		const failure = new Error("generation failed")
		mocks.generateJetBrains.mockRejectedValueOnce(failure)
		await expect(callbacks.get("deeptask.jetbrains.generateCommitMessage")!(["/workspace", []])).rejects.toBe(
			failure,
		)
	})

	it("does not register twice and releases commands on dispose", async () => {
		await provider.activate()
		await provider.activate()
		expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(4)
		provider.dispose()
		expect(callbacks.size).toBe(0)
		await provider.activate()
		expect(callbacks.size).toBe(4)
	})

	it("rolls back an incomplete activation without removing another owner", async () => {
		const other = vi.fn()
		callbacks.set("deeptask.jetbrains.generateCommitMessage", other)
		await expect(provider.activate()).rejects.toThrow("already exists")
		expect([...callbacks.keys()]).toEqual(["deeptask.jetbrains.generateCommitMessage"])
		expect(callbacks.get("deeptask.jetbrains.generateCommitMessage")).toBe(other)
	})
})
