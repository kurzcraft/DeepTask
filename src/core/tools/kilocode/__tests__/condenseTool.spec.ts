import { condenseTool } from "../condenseTool"

describe("condenseTool", () => {
	const makeBlock = () =>
		({
			name: "condense",
			partial: false,
			params: { message: "Please summarize the conversation" },
		}) as any

	const makeTask = () =>
		({
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: undefined, images: undefined }),
			condenseContext: vi.fn().mockResolvedValue(true),
		}) as any

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("uses the shared transactional manual condense entrypoint", async () => {
		const task = makeTask()
		const pushToolResult = vi.fn()

		await condenseTool(task, makeBlock(), vi.fn(), vi.fn(), pushToolResult, vi.fn())

		expect(task.condenseContext).toHaveBeenCalledTimes(1)
		expect(pushToolResult).toHaveBeenCalledTimes(1)
		expect(String(pushToolResult.mock.calls[0][0])).not.toContain("did not commit")
	})

	it("does not acknowledge success when shared manual condensation does not commit", async () => {
		const task = makeTask()
		task.condenseContext.mockResolvedValue(false)
		const pushToolResult = vi.fn()

		await condenseTool(task, makeBlock(), vi.fn(), vi.fn(), pushToolResult, vi.fn())

		expect(String(pushToolResult.mock.calls[0][0])).toContain("did not commit")
		expect(String(pushToolResult.mock.calls[0][0])).toContain("original conversation was preserved")
	})
})
