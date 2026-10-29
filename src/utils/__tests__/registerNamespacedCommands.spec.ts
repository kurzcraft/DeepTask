// kilocode_change - new file
import * as vscode from "vscode"
import { registerNamespacedCommands } from "../registerNamespacedCommands"

vi.mock("vscode", () => ({
	commands: { registerCommand: vi.fn() },
	extensions: { getExtension: vi.fn() },
}))

describe("registerNamespacedCommands", () => {
	const callbacks = new Map<string, (...args: any[]) => unknown>()
	const disposers: ReturnType<typeof vi.fn>[] = []
	const command = "deeptask.test"
	const legacyCommand = "kilo-code.test"

	beforeEach(() => {
		vi.resetAllMocks()
		callbacks.clear()
		disposers.length = 0
		vi.mocked(vscode.commands.registerCommand).mockImplementation((id, callback) => {
			if (callbacks.has(id)) throw new Error(`command '${id}' already exists`)
			callbacks.set(id, callback)
			const dispose = vi.fn(() => {
				if (callbacks.get(id) === callback) callbacks.delete(id)
			})
			disposers.push(dispose)
			return { dispose }
		})
	})

	it("preserves arguments, reference identity, and async results through both IDs", async () => {
		const result = { text: "完整结果" }
		const callback = vi.fn(async (..._args: unknown[]) => result)
		const owner = registerNamespacedCommands([{ command, legacyCommand, callback }])
		const input = { nested: [1, "原文"] }
		expect(await callbacks.get(command)!(input, 2)).toBe(result)
		expect(await callbacks.get(legacyCommand)!(input, 2)).toBe(result)
		expect(callback).toHaveBeenNthCalledWith(1, input, 2)
		expect(callback).toHaveBeenNthCalledWith(2, input, 2)
		owner.dispose()
		expect(callbacks.size).toBe(0)
	})

	it.each([false, true])("does not claim aliases when original extension exists (active=%s)", (isActive) => {
		vi.mocked(vscode.extensions.getExtension).mockReturnValue({ isActive } as vscode.Extension<unknown>)
		const owner = registerNamespacedCommands([{ command, legacyCommand, callback: vi.fn() }])
		expect(callbacks.has(command)).toBe(true)
		expect(callbacks.has(legacyCommand)).toBe(false)
		expect(vscode.extensions.getExtension).toHaveBeenCalledWith("kilocode.kilo-code")
		owner.dispose()
	})

	it.each(["kilo-first", "deeptask-first"])("supports both activation orders: %s", (order) => {
		vi.mocked(vscode.extensions.getExtension).mockReturnValue({ isActive: false } as vscode.Extension<unknown>)
		const kilo = vi.fn()
		if (order === "kilo-first") vscode.commands.registerCommand(legacyCommand, kilo)
		const owner = registerNamespacedCommands([{ command, legacyCommand, callback: vi.fn() }])
		if (order === "deeptask-first") vscode.commands.registerCommand(legacyCommand, kilo)
		expect(callbacks.get(legacyCommand)).toBe(kilo)
		owner.dispose()
		expect(callbacks.get(legacyCommand)).toBe(kilo)
		expect(callbacks.has(command)).toBe(false)
	})

	it("leaves an occupied legacy alias untouched without hiding the warning", () => {
		const other = vi.fn()
		callbacks.set(legacyCommand, other)
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
		try {
			const owner = registerNamespacedCommands([{ command, legacyCommand, callback: vi.fn() }])
			expect(callbacks.get(legacyCommand)).toBe(other)
			expect(warn).toHaveBeenCalledWith(expect.stringContaining(legacyCommand))
			owner.dispose()
			expect(callbacks.get(legacyCommand)).toBe(other)
		} finally {
			warn.mockRestore()
		}
	})

	it("rolls back primary commands when a later primary registration fails", () => {
		const other = vi.fn()
		callbacks.set("deeptask.occupied", other)
		expect(() =>
			registerNamespacedCommands([
				{ command, legacyCommand, callback: vi.fn() },
				{ command: "deeptask.occupied", callback: vi.fn() },
			]),
		).toThrow("already exists")
		expect([...callbacks.keys()]).toEqual(["deeptask.occupied"])
		expect(callbacks.get("deeptask.occupied")).toBe(other)
	})

	it("rolls back all owned registrations for unexpected alias errors", () => {
		const register = vi.mocked(vscode.commands.registerCommand).getMockImplementation()!
		const failure = new Error("transport unavailable")
		vi.mocked(vscode.commands.registerCommand).mockImplementation((id, callback) => {
			if (id === "kilo-code.second") throw failure
			return register(id, callback)
		})
		expect(() =>
			registerNamespacedCommands([
				{ command, legacyCommand, callback: vi.fn() },
				{ command: "deeptask.second", legacyCommand: "kilo-code.second", callback: vi.fn() },
			]),
		).toThrow(failure)
		expect(callbacks.size).toBe(0)
		for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1)
	})

	it("disposes once and allows a fresh owner without stale removal", () => {
		const spec = [{ command, legacyCommand, callback: vi.fn() }]
		const first = registerNamespacedCommands(spec)
		first.dispose()
		const second = registerNamespacedCommands(spec)
		first.dispose()
		expect(callbacks.size).toBe(2)
		second.dispose()
		second.dispose()
		expect(callbacks.size).toBe(0)
		for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1)
	})

	it("preserves callback rejections instead of turning them into success", async () => {
		const failure = new Error("generation failed")
		const owner = registerNamespacedCommands([
			{
				command,
				legacyCommand,
				callback: async () => {
					throw failure
				},
			},
		])
		await expect(callbacks.get(command)!()).rejects.toBe(failure)
		await expect(callbacks.get(legacyCommand)!()).rejects.toBe(failure)
		owner.dispose()
	})
})
