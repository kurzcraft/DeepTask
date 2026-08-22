import { render, screen, fireEvent } from "@/utils/test-utils"

import { useExtensionState } from "@src/context/ExtensionStateContext"

import HistoryView from "../HistoryView"

vi.mock("@src/context/ExtensionStateContext")
vi.mock("@src/utils/vscode")

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/kilocode/hooks/useTaskHistory")
import { useTaskHistory } from "@/kilocode/hooks/useTaskHistory"

const mockTaskHistory = [
	{
		id: "1",
		task: "Test task 1",
		ts: Date.now(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.002,
		workspace: "/test/workspace",
	},
	{
		id: "2",
		task: "Test task 2",
		ts: Date.now() + 1000,
		tokensIn: 200,
		tokensOut: 100,
		totalCost: 0.003,
		workspace: "/test/workspace",
	},
]

vi.mock("../TaskItem", () => ({
	default: ({ item }: { item: { id: string; task: string } }) => (
		<div data-testid={`task-item-${item.id}`}>{item.task}</div>
	),
}))

describe("HistoryView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		;(useExtensionState as ReturnType<typeof vi.fn>).mockReturnValue({
			taskHistory: mockTaskHistory,
			cwd: "/home/user/my-project",
			parallelFolders: [{ name: "my-project", path: "/home/user/my-project", kind: "main", createdAt: 1 }],
			parallelWorkspaces: [
				{
					name: "feature-x",
					path: "/home/user/my-project/.kilocode/worktrees/feature-x",
					branch: "deeptask/feature-x",
					baseBranch: "main",
					status: "available",
					folderPath: "/home/user/my-project",
					createdAt: 1,
					updatedAt: 1,
				},
			],
			parallelConversations: [
				{
					id: "cv-1",
					folderPath: "/home/user/my-project",
					workspacePath: "/home/user/my-project",
					sessionId: "1",
					title: "Test task 1",
					createdAt: 1,
					lastActiveAt: 1,
				},
				{
					id: "cv-2",
					folderPath: "/home/user/my-project",
					workspacePath: "/home/user/my-project/.kilocode/worktrees/feature-x",
					sessionId: "2",
					title: "Test task 2",
					createdAt: 1,
					lastActiveAt: 1,
				},
			],
			parallelActiveConversationId: "cv-1",
			parallelActiveWorkspace: "/home/user/my-project",
		})

		// kilocode_code start
		;(useTaskHistory as ReturnType<typeof vi.fn>).mockReturnValue({
			data: {
				requestId: "",
				historyItems: [
					{ ...mockTaskHistory[0], workspace: "/home/user/my-project" },
					{
						...mockTaskHistory[1],
						workspace: "/home/user/my-project/.kilocode/worktrees/feature-x",
					},
				],
				pageIndex: 0,
				pageCount: 1,
			},
		})
		// kilocode_code end
	})

	it("renders the history interface", () => {
		const onDone = vi.fn()
		render(<HistoryView onDone={onDone} />)

		// Check for main UI elements
		expect(screen.getByText("history:history")).toBeInTheDocument()
		expect(screen.getByText("history:done")).toBeInTheDocument()
		expect(screen.getByPlaceholderText("history:searchPlaceholder")).toBeInTheDocument()
	})

	it("calls onDone when done button is clicked", () => {
		const onDone = vi.fn()
		render(<HistoryView onDone={onDone} />)

		const doneButton = screen.getByText("history:done")
		fireEvent.click(doneButton)

		expect(onDone).toHaveBeenCalled()
	})

	it("groups the current folder's history by workspace", () => {
		const onDone = vi.fn()
		render(<HistoryView onDone={onDone} />)
		expect(screen.getByTestId("history-workspace-group-main")).toBeInTheDocument()
		expect(screen.getByTestId("history-workspace-group-feature-x")).toBeInTheDocument()
		expect(screen.getByTestId("task-item-1")).toBeInTheDocument()
		expect(screen.getByTestId("task-item-2")).toBeInTheDocument()
	})
})
