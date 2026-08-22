import { render, screen } from "@/utils/test-utils"
import { WorkspaceBar } from "../WorkspaceBar"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
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
				workspacePath: "/home/user/my-project/.kilocode/worktrees/feature-x",
				title: "Work",
				createdAt: 1,
				lastActiveAt: 1,
			},
		],
		parallelActiveConversationId: "cv-1",
		parallelActiveWorkspace: "/home/user/my-project/.kilocode/worktrees/feature-x",
	}),
}))

describe("WorkspaceBar", () => {
	test("shows the folder and workspace names without create or switcher controls", () => {
		render(<WorkspaceBar />)
		expect(screen.getByTestId("workspace-bar")).toHaveTextContent("my-project")
		expect(screen.getByTestId("workspace-bar")).toHaveTextContent("feature-x")
		expect(screen.getByTestId("workspace-bar")).toHaveTextContent("deeptask/feature-x")
		expect(screen.queryByTestId("workspace-create-open")).not.toBeInTheDocument()
		expect(screen.queryByTestId("workspace-switcher")).not.toBeInTheDocument()
	})
})
