import { render, screen, fireEvent } from "@/utils/test-utils"
import { ParallelRail } from "../ParallelRail"
import type { ParallelConversation, ParallelFolder, ParallelSession, ParallelWorkspace } from "@roo-code/types"
import { vscode } from "@/utils/vscode"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
	}),
}))

const makeSession = (overrides?: Partial<ParallelSession>): ParallelSession => ({
	sessionId: "sa-1",
	taskId: "sa-1",
	parentTaskId: "parent-1",
	label: "impl-x",
	task: "Implement X",
	status: "running",
	startedAt: 1,
	...overrides,
})

const makeFolder = (overrides?: Partial<ParallelFolder>): ParallelFolder => ({
	name: "my-project",
	path: "/home/user/my-project",
	kind: "main",
	createdAt: 1,
	...overrides,
})

const makeWorkspace = (overrides?: Partial<ParallelWorkspace>): ParallelWorkspace => ({
	name: "refactor-auth",
	path: "/home/user/my-project/.kilocode/worktrees/refactor-auth",
	branch: "deeptask/refactor-auth",
	baseBranch: "main",
	status: "available",
	folderPath: "/home/user/my-project",
	createdAt: 1,
	updatedAt: 1,
	...overrides,
})

const makeConversation = (overrides?: Partial<ParallelConversation>): ParallelConversation => ({
	id: "cv-1",
	folderPath: "/home/user/my-project",
	workspacePath: "/home/user/my-project",
	title: "Fix the login bug",
	sessionId: "task-1",
	createdAt: 1,
	lastActiveAt: 2,
	...overrides,
})

describe("ParallelRail", () => {
	const onSelect = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(vscode, "postMessage").mockImplementation(() => undefined as never)
	})

	test("renders header actions with an empty list and no placeholder text", () => {
		render(<ParallelRail sessions={[]} workspaces={[]} folders={[]} conversations={[]} onSelect={onSelect} />)
		expect(screen.getByTestId("parallel-new-conversation")).toBeInTheDocument()
		expect(screen.getByTestId("parallel-open-folder")).toBeInTheDocument()
		expect(screen.queryByTestId("parallel-rail-session")).not.toBeInTheDocument()
		expect(screen.queryByTestId("parallel-rail-folder")).not.toBeInTheDocument()
		expect(screen.queryByTestId("parallel-rail-conversation")).not.toBeInTheDocument()
		expect(screen.queryByText(/conversations/i)).not.toBeInTheDocument()
	})

	test("clicking the header + starts a new conversation in the current folder", () => {
		render(<ParallelRail sessions={[]} workspaces={[]} folders={[]} conversations={[]} onSelect={onSelect} />)
		fireEvent.click(screen.getByTestId("parallel-new-conversation"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "parallel.newConversation" })
	})

	test("nests workspaces under folders and conversations under workspaces", () => {
		render(
			<ParallelRail
				sessions={[makeSession()]}
				workspaces={[makeWorkspace()]}
				folders={[makeFolder()]}
				conversations={[
					makeConversation(),
					makeConversation({
						id: "cv-2",
						workspacePath: "/home/user/my-project/.kilocode/worktrees/refactor-auth",
						title: "Auth work",
					}),
					makeConversation({
						id: "cv-sa",
						sessionId: "sa-1",
						workspacePath: "/home/user/my-project/.kilocode/worktrees/refactor-auth",
						title: "impl-x",
					}),
				]}
				onSelect={onSelect}
			/>,
		)

		expect(screen.queryByTestId("parallel-rail-session")).not.toBeInTheDocument()
		expect(screen.getByText("impl-x")).toBeInTheDocument()
		expect(screen.getAllByTestId("parallel-rail-folder")).toHaveLength(1)
		expect(screen.queryByTestId("parallel-rail-folder")?.getAttribute("data-kind")).toBe("main")
		const workspaces = screen.getAllByTestId("parallel-rail-workspace")
		expect(workspaces).toHaveLength(2)
		expect(workspaces[0]).toHaveAttribute("data-workspace", "main")
		expect(workspaces[1]).toHaveAttribute("data-workspace", "refactor-auth")
		expect(screen.getByText("Fix the login bug")).toBeInTheDocument()
		expect(screen.getByText("Auth work")).toBeInTheDocument()
	})

	test("folder chevron collapses workspaces; folder name starts a main-workspace conversation", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[]}
				folders={[makeFolder()]}
				conversations={[makeConversation()]}
				onSelect={onSelect}
			/>,
		)
		expect(screen.getByText("Fix the login bug")).toBeInTheDocument()
		const chevron = screen.getByTestId("parallel-rail-folder")
		expect(chevron).toHaveAttribute("aria-expanded", "true")
		fireEvent.click(chevron)
		expect(chevron).toHaveAttribute("aria-expanded", "false")
		expect(screen.queryByText("Fix the login bug")).not.toBeInTheDocument()
		expect(onSelect).not.toHaveBeenCalled()
		expect(vscode.postMessage).not.toHaveBeenCalled()

		fireEvent.click(screen.getByTestId("parallel-rail-folder-name"))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.newConversation",
			values: { folderPath: "/home/user/my-project", workspacePath: "/home/user/my-project" },
		})
	})

	test("clicking a workspace title starts a conversation in that workspace", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[makeWorkspace()]}
				folders={[makeFolder()]}
				conversations={[]}
				onSelect={onSelect}
			/>,
		)
		fireEvent.click(screen.getAllByTestId("parallel-rail-workspace")[1])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.newConversation",
			values: {
				folderPath: "/home/user/my-project",
				workspacePath: "/home/user/my-project/.kilocode/worktrees/refactor-auth",
			},
		})
	})

	test("clicking a workspace with an existing conversation opens that conversation", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[makeWorkspace()]}
				folders={[makeFolder()]}
				conversations={[
					{
						...makeConversation(),
						id: "cv-sub",
						sessionId: "task-sub",
						workspacePath: "/home/user/my-project/.kilocode/worktrees/refactor-auth",
						title: "term-probe-a",
					},
				]}
				onSelect={onSelect}
			/>,
		)
		fireEvent.click(screen.getAllByTestId("parallel-rail-workspace")[1])
		expect(onSelect).toHaveBeenCalledWith("cv:cv-sub")
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "parallel.newConversation" }),
		)
	})

	test("create-workspace icon lives on the folder row before archive", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[]}
				folders={[makeFolder()]}
				conversations={[]}
				onSelect={onSelect}
			/>,
		)
		fireEvent.click(screen.getByTestId("parallel-folder-create-workspace"))
		fireEvent.change(screen.getByTestId("parallel-folder-create-workspace-input"), {
			target: { value: "feature-x" },
		})
		fireEvent.click(screen.getByTestId("parallel-folder-create-workspace-confirm"))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.createWorkspace",
			text: "feature-x",
			values: { folderPath: "/home/user/my-project" },
		})
	})

	test("workspace fork and delete post messages; delete asks for confirmation", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[makeWorkspace()]}
				folders={[makeFolder()]}
				conversations={[]}
				onSelect={onSelect}
			/>,
		)
		fireEvent.click(screen.getAllByTestId("parallel-workspace-fork")[1])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.forkWorkspace",
			text: "refactor-auth",
			values: { folderPath: "/home/user/my-project" },
		})
		expect(screen.getByTestId("parallel-workspace-delete")).toBeInTheDocument()
		fireEvent.click(screen.getByTestId("parallel-workspace-delete"))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.deleteWorkspace",
			text: "refactor-auth",
			values: { folderPath: "/home/user/my-project" },
		})
	})

	test("indents workspaces under folders and conversations under workspaces", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[makeWorkspace()]}
				folders={[makeFolder()]}
				conversations={[
					makeConversation(),
					makeConversation({
						id: "cv-2",
						workspacePath: "/home/user/my-project/.kilocode/worktrees/refactor-auth",
						title: "Auth work",
					}),
				]}
				onSelect={onSelect}
			/>,
		)
		const workspaceRows = screen.getAllByTestId("parallel-workspace-row")
		expect(workspaceRows[0].querySelector(".pl-3")).toBeTruthy()
		expect(screen.getAllByTestId("parallel-conversation-row")[0].querySelector(".pl-16")).toBeTruthy()
	})

	test("nests conversations under their workspace and highlights the active one", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[]}
				folders={[makeFolder(), makeFolder({ name: "other", path: "/home/user/other" })]}
				conversations={[
					makeConversation(),
					makeConversation({
						id: "cv-2",
						folderPath: "/home/user/other",
						workspacePath: "/home/user/other",
						title: undefined,
						sessionId: undefined,
					}),
				]}
				activeConversationId="cv-1"
				onSelect={onSelect}
			/>,
		)

		const conversationItems = screen.getAllByTestId("parallel-rail-conversation")
		expect(conversationItems).toHaveLength(2)
		expect(conversationItems[0]).toHaveAttribute("data-active", "true")
		expect(conversationItems[1]).toHaveAttribute("data-active", "false")
		expect(screen.getByText("Fix the login bug")).toBeInTheDocument()
		expect(screen.getByText("chat:parallel.newChat")).toBeInTheDocument()

		fireEvent.click(conversationItems[0])
		expect(onSelect).toHaveBeenCalledWith("cv:cv-1")
	})

	test("hover archive/rename/fork actions post the matching messages", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[]}
				folders={[makeFolder()]}
				conversations={[makeConversation()]}
				onSelect={onSelect}
			/>,
		)

		fireEvent.click(screen.getByTestId("parallel-conversation-archive"))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.archiveConversation",
			text: "cv-1",
			archived: true,
		})

		fireEvent.click(screen.getByTestId("parallel-conversation-fork"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "parallel.forkConversation", text: "cv-1" })

		fireEvent.click(screen.getByTestId("parallel-folder-archive"))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.archiveFolder",
			text: "/home/user/my-project",
			archived: true,
		})
	})

	test("archived folders and conversations live in a collapsed archive section", () => {
		render(
			<ParallelRail
				sessions={[]}
				workspaces={[]}
				folders={[makeFolder({ archivedAt: 10 })]}
				conversations={[makeConversation({ archivedAt: 11 })]}
				onSelect={onSelect}
			/>,
		)

		expect(screen.queryByTestId("parallel-rail-folder")).not.toBeInTheDocument()
		expect(screen.queryByTestId("parallel-rail-conversation")).not.toBeInTheDocument()
		expect(screen.getByTestId("parallel-archived-toggle")).toBeInTheDocument()

		fireEvent.click(screen.getByTestId("parallel-archived-toggle"))
		expect(screen.getByTestId("parallel-archived-folder")).toBeInTheDocument()
		expect(screen.getByTestId("parallel-archived-conversation")).toBeInTheDocument()

		fireEvent.click(screen.getByTestId("parallel-archived-folder-unarchive"))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "parallel.archiveFolder",
			text: "/home/user/my-project",
			archived: false,
		})
	})
})
