// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/CommandExecution.spec.tsx

import React from "react"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { useEvent } from "react-use"

import { CommandExecution } from "../CommandExecution"
import {
	ExtensionStateContext,
	ExtensionMessageSliceContext,
} from "../../../context/ExtensionStateContext"

// Mock dependencies
vi.mock("react-use", () => ({
	useEvent: vi.fn(),
}))

import { vscode } from "../../../utils/vscode"

vi.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("../../kilocode/common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <div data-testid="code-block">{source}</div>,
}))

vi.mock("../CommandPatternSelector", () => ({
	CommandPatternSelector: ({ patterns, onAllowPatternChange, onDenyPatternChange }: any) => (
		<div data-testid="command-pattern-selector">
			{patterns.map((pattern: any, index: number) => (
				<span key={index}>{pattern.pattern}</span>
			))}
			<button onClick={() => onAllowPatternChange(patterns[0]?.pattern)}>Allow</button>
			<button onClick={() => onDenyPatternChange(patterns[0]?.pattern)}>Deny</button>
		</div>
	),
}))

// Mock ExtensionStateContext
const mockExtensionState = {
	terminalShellIntegrationDisabled: true,
	allowedCommands: ["npm"],
	deniedCommands: ["rm"],
	setAllowedCommands: vi.fn(),
	setDeniedCommands: vi.fn(),
}

const mockMessageSlice = {
	clineMessages: [],
	parallelSessionMessages: {},
}

const ExtensionStateWrapper = ({
	children,
	value = mockExtensionState,
}: {
	children: React.ReactNode
	value?: typeof mockExtensionState | Record<string, unknown>
}) => (
	<ExtensionStateContext.Provider value={value as any}>
		<ExtensionMessageSliceContext.Provider value={mockMessageSlice as any}>
			{children}
		</ExtensionMessageSliceContext.Provider>
	</ExtensionStateContext.Provider>
)

describe("CommandExecution", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(useEvent).mockReset()
	})

	it("should render command without output", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install" />
			</ExtensionStateWrapper>,
		)

		expect(screen.getByTestId("code-block")).toHaveTextContent("npm install")
	})

	it("should render command with output", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install\nOutput:\nInstalling packages..." />
			</ExtensionStateWrapper>,
		)

		const codeBlocks = screen.getAllByTestId("code-block")
		expect(codeBlocks[0]).toHaveTextContent("npm install")
	})

	it("should render with custom icon and title", () => {
		const icon = <span data-testid="custom-icon">📦</span>
		const title = <span data-testid="custom-title">Installing Dependencies</span>

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install" icon={icon} title={title} />
			</ExtensionStateWrapper>,
		)

		expect(screen.getByTestId("custom-icon")).toBeInTheDocument()
		expect(screen.getByTestId("custom-title")).toBeInTheDocument()
	})

	it("should show command pattern selector for commands", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install express" />
			</ExtensionStateWrapper>,
		)

		expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()
		// Check that the command is shown in the pattern selector
		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toHaveTextContent("npm install express")
	})

	it("should handle allow command change", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="git push" />
			</ExtensionStateWrapper>,
		)

		const allowButton = screen.getByText("Allow")
		fireEvent.click(allowButton)

		expect(mockExtensionState.setAllowedCommands).toHaveBeenCalledWith(["npm", "git push"])
		expect(mockExtensionState.setDeniedCommands).toHaveBeenCalledWith(["rm"])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm", "git push"],
				deniedCommands: ["rm"],
			},
		})
	})

	it("should handle deny command change", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="docker run" />
			</ExtensionStateWrapper>,
		)

		const denyButton = screen.getByText("Deny")
		fireEvent.click(denyButton)

		expect(mockExtensionState.setAllowedCommands).toHaveBeenCalledWith(["npm"])
		expect(mockExtensionState.setDeniedCommands).toHaveBeenCalledWith(["rm", "docker run"])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm"],
				deniedCommands: ["rm", "docker run"],
			},
		})
	})

	it("should toggle allowed command", () => {
		// Update the mock state to have "npm test" in allowedCommands
		const stateWithNpmTest = {
			...mockExtensionState,
			allowedCommands: ["npm test"],
			deniedCommands: ["rm"],
		}

		render(
			<ExtensionStateWrapper value={stateWithNpmTest}>
				<CommandExecution executionId="test-1" text="npm test" />
			</ExtensionStateWrapper>,
		)

		const allowButton = screen.getByText("Allow")
		fireEvent.click(allowButton)

		// "npm test" is already in allowedCommands, so it should be removed
		expect(stateWithNpmTest.setAllowedCommands).toHaveBeenCalledWith([])
		expect(stateWithNpmTest.setDeniedCommands).toHaveBeenCalledWith(["rm"])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: [],
				deniedCommands: ["rm"],
			},
		})
	})

	it("should toggle denied command", () => {
		// Update the mock state to have "rm -rf" in deniedCommands
		const stateWithRmRf = {
			...mockExtensionState,
			allowedCommands: ["npm"],
			deniedCommands: ["rm -rf"],
		}

		render(
			<ExtensionStateWrapper value={stateWithRmRf}>
				<CommandExecution executionId="test-1" text="rm -rf" />
			</ExtensionStateWrapper>,
		)

		const denyButton = screen.getByText("Deny")
		fireEvent.click(denyButton)

		// "rm -rf" is already in deniedCommands, so it should be removed
		expect(stateWithRmRf.setAllowedCommands).toHaveBeenCalledWith(["npm"])
		expect(stateWithRmRf.setDeniedCommands).toHaveBeenCalledWith([])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm"],
				deniedCommands: [],
			},
		})
	})

	it("should parse command with Output: separator", () => {
		const commandText = `npm install
Output:
Installing...`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text={commandText} />
			</ExtensionStateWrapper>,
		)

		const codeBlocks = screen.getAllByTestId("code-block")
		expect(codeBlocks[0]).toHaveTextContent("npm install")
	})

	it("should parse command with output", () => {
		const commandText = `npm install
Output:
Suggested patterns: npm, npm install, npm run`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text={commandText} />
			</ExtensionStateWrapper>,
		)

		// First check that the command was parsed correctly
		const codeBlocks = screen.getAllByTestId("code-block")
		expect(codeBlocks[0]).toHaveTextContent("npm install")
		expect(codeBlocks[1]).toHaveTextContent("Suggested patterns: npm, npm install, npm run")

		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toBeInTheDocument()
		// Should show the full command in the selector
		expect(selector).toHaveTextContent("npm install")
	})

	it("should handle commands with pipes", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="ls -la | grep test" />
			</ExtensionStateWrapper>,
		)

		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toBeInTheDocument()
		// Should show one of the individual commands from the pipe
		expect(selector.textContent).toMatch(/ls -la|grep test/)
	})

	it("should handle commands with && operator", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="npm install && npm test" />
			</ExtensionStateWrapper>,
		)

		const selector = screen.getByTestId("command-pattern-selector")
		expect(selector).toBeInTheDocument()
		// Should show one of the individual commands from the && chain
		expect(selector.textContent).toMatch(/npm install|npm test|npm/)
	})

	it("should not show pattern selector for empty commands", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text="" />
			</ExtensionStateWrapper>,
		)

		expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
	})

	it("should expand output when terminal shell integration is disabled", () => {
		const disabledState = {
			...mockExtensionState,
			terminalShellIntegrationDisabled: true,
		}

		const commandText = `npm install
Output:
Output here`

		render(
			<ExtensionStateWrapper value={disabledState}>
				<CommandExecution executionId="test-1" text={commandText} />
			</ExtensionStateWrapper>,
		)

		// Output should be visible when shell integration is disabled
		const codeBlocks = screen.getAllByTestId("code-block")
		expect(codeBlocks).toHaveLength(2) // Command and output blocks
		expect(codeBlocks[1]).toHaveTextContent("Output here")
	})

	it("should handle undefined allowedCommands and deniedCommands", () => {
		const stateWithUndefined = {
			...mockExtensionState,
			allowedCommands: undefined,
			deniedCommands: undefined,
		}

		render(
			<ExtensionStateWrapper value={stateWithUndefined}>
				<CommandExecution executionId="test-1" text="npm install" />
			</ExtensionStateWrapper>,
		)

		// Should show pattern selector when patterns are available
		expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()
	})

	it("should handle command change when moving from denied to allowed", () => {
		// Update the mock state to have "rm file.txt" in deniedCommands
		const stateWithRmInDenied = {
			...mockExtensionState,
			allowedCommands: ["npm"],
			deniedCommands: ["rm file.txt"],
		}

		render(
			<ExtensionStateWrapper value={stateWithRmInDenied}>
				<CommandExecution executionId="test-1" text="rm file.txt" />
			</ExtensionStateWrapper>,
		)

		const allowButton = screen.getByText("Allow")
		fireEvent.click(allowButton)

		// "rm file.txt" should be removed from denied and added to allowed
		expect(stateWithRmInDenied.setAllowedCommands).toHaveBeenCalledWith(["npm", "rm file.txt"])
		expect(stateWithRmInDenied.setDeniedCommands).toHaveBeenCalledWith([])
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "updateSettings",
			updatedSettings: {
				allowedCommands: ["npm", "rm file.txt"],
				deniedCommands: [],
			},
		})
	})

	describe("integration with CommandPatternSelector", () => {
		it("should show complex commands with multiple operators", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-6" text="npm install && npm test || echo 'failed'" />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands from the complex chain
			expect(selector.textContent).toMatch(/npm install|npm test|echo|npm/)
		})

		it("should handle commands with output", () => {
			const commandWithOutput = `npm install
Output:
Installing packages...
Other output here`

			render(
				<ExtensionStateWrapper>
					<CommandExecution
						executionId="test-6"
						text={commandWithOutput}
						icon={<span>icon</span>}
						title={<span>Run Command</span>}
					/>
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show the command in the selector
			expect(selector).toHaveTextContent("npm install")
		})

		it("should handle commands with subshells", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-7" text="echo $(whoami) && git status" />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands
			expect(selector.textContent).toMatch(/echo|whoami|git status|git/)
		})

		it("should handle commands with backtick subshells", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-8" text="git commit -m `date`" />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands
			expect(selector.textContent).toMatch(/git commit|date|git/)
		})

		it("should handle commands with special characters", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-9" text="cd ~/projects && npm start" />
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show one of the individual commands
			expect(selector.textContent).toMatch(/cd ~\/projects|npm start|cd|npm/)
		})

		it("should handle commands with mixed content including output", () => {
			const commandWithMixedContent = `npm test
Output:
Running tests...
✓ Test 1 passed
✓ Test 2 passed`

			render(
				<ExtensionStateWrapper>
					<CommandExecution
						executionId="test-10"
						text={commandWithMixedContent}
						icon={<span>icon</span>}
						title={<span>Run Command</span>}
					/>
				</ExtensionStateWrapper>,
			)

			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			// Should show the command in the selector
			expect(selector).toHaveTextContent("npm test")
		})

		it("should update both allowed and denied lists when commands conflict", () => {
			const conflictState = {
				...mockExtensionState,
				allowedCommands: ["git"],
				deniedCommands: ["git push origin main"],
			}

			render(
				<ExtensionStateWrapper value={conflictState}>
					<CommandExecution executionId="test-11" text="git push origin main" />
				</ExtensionStateWrapper>,
			)

			// Click to allow "git push origin main"
			const allowButton = screen.getByText("Allow")
			fireEvent.click(allowButton)

			// Should add to allowed and remove from denied
			expect(conflictState.setAllowedCommands).toHaveBeenCalledWith(["git", "git push origin main"])
			expect(conflictState.setDeniedCommands).toHaveBeenCalledWith([])
		})

		it("should handle commands with special quotes", () => {
			// Test with a command that has quotes
			const commandWithQuotes = "echo 'test with unclosed quote"

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-12" text={commandWithQuotes} />
				</ExtensionStateWrapper>,
			)

			// Should still render the command
			expect(screen.getByTestId("code-block")).toHaveTextContent("echo 'test with unclosed quote")

			// Should show pattern selector with a command pattern
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			expect(selector.textContent).toMatch(/echo/)
		})

		it("should handle empty or whitespace-only commands", () => {
			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-13" text="   " />
				</ExtensionStateWrapper>,
			)

			// Should render without errors
			expect(screen.getByTestId("code-block")).toBeInTheDocument()

			// Should not show pattern selector for empty commands
			expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
		})

		it("should handle commands with only output and no command prefix", () => {
			const outputOnly = `Some output without a command
Multiple lines of output
Without any command prefix`

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-14" text={outputOnly} />
				</ExtensionStateWrapper>,
			)

			// Should treat the entire text as command when no prefix is found
			const codeBlock = screen.getByTestId("code-block")
			// The mock CodeBlock component renders text content without preserving newlines
			expect(codeBlock.textContent).toContain("Some output without a command")
			expect(codeBlock.textContent).toContain("Multiple lines of output")
			expect(codeBlock.textContent).toContain("Without any command prefix")
		})

		it("should handle simple commands", () => {
			const plainCommand = "docker build ."

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-15" text={plainCommand} />
				</ExtensionStateWrapper>,
			)

			// Should render the command
			expect(screen.getByTestId("code-block")).toHaveTextContent("docker build .")

			// Should show pattern selector with the full command
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()
			expect(selector).toHaveTextContent("docker build .")

			// Verify no output is shown (since there's no Output: separator)
			const codeBlocks = screen.getAllByTestId("code-block")
			expect(codeBlocks).toHaveLength(1) // Only the command block, no output block
		})

		it("should handle commands with numeric output", () => {
			const commandWithNumericOutput = `wc -l *.go *.java
Output:
			   10 file1.go
			   20 file2.go
			   15 Main.java
			   45 total`

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-16" text={commandWithNumericOutput} />
				</ExtensionStateWrapper>,
			)

			// Should render the command and output
			const codeBlocks = screen.getAllByTestId("code-block")
			expect(codeBlocks[0]).toHaveTextContent("wc -l *.go *.java")

			// Should show pattern selector
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()

			// Should show a command pattern
			expect(selector.textContent).toMatch(/wc/)

			// The output should still be displayed in the code block
			expect(codeBlocks.length).toBeGreaterThan(1)
			expect(codeBlocks[1].textContent).toContain("45 total")
		})

		it("should handle commands with zero output", () => {
			const commandWithZeroTotal = `wc -l *.go *.java
Output:
		     0 total`

			render(
				<ExtensionStateWrapper>
					<CommandExecution executionId="test-17" text={commandWithZeroTotal} />
				</ExtensionStateWrapper>,
			)

			// Should show pattern selector
			const selector = screen.getByTestId("command-pattern-selector")
			expect(selector).toBeInTheDocument()

			// Should show a command pattern
			expect(selector.textContent).toMatch(/wc/)

			// The output should still be displayed in the code block
			const codeBlocks = screen.getAllByTestId("code-block")
			expect(codeBlocks.length).toBeGreaterThan(1)
			expect(codeBlocks[1]).toHaveTextContent("0 total")
		})
	})

	it("does not mount truncated historical output until expanded", () => {
		render(
			<ExtensionStateWrapper>
				<CommandExecution
					executionId="test-truncated"
					text={"cat log\nOutput:\ntruncated preview"}
					commandOutputTruncated
					messageTs={42}
				/>
			</ExtensionStateWrapper>,
		)

		expect(screen.getAllByTestId("code-block")).toHaveLength(1)
		expect(vscode.postMessage).not.toHaveBeenCalledWith(
			expect.objectContaining({ type: "requestCommandOutput" }),
		)
	})

	it("fetches and mounts full truncated output only after expand", async () => {
		let messageHandler: ((event: MessageEvent) => void) | undefined
		vi.mocked(useEvent).mockImplementation((_event: string, handler: any) => {
			messageHandler = handler
		})

		render(
			<ExtensionStateWrapper>
				<CommandExecution
					executionId="test-truncated-expand"
					text={"cat log\nOutput:\ntruncated preview"}
					commandOutputTruncated
					messageTs={42}
				/>
			</ExtensionStateWrapper>,
		)

		const expandButton = screen.getAllByRole("button").find((button) => !["Allow", "Deny"].includes(button.textContent || ""))
		expect(expandButton).toBeDefined()
		fireEvent.click(expandButton!)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({ type: "requestCommandOutput", messageTs: 42 })
		})

		messageHandler?.({
			data: {
				type: "commandOutputFull",
				messageTs: 42,
				text: "cat log\nOutput:\nfull restored output",
			},
		} as MessageEvent)

		await waitFor(() => {
			const codeBlocks = screen.getAllByTestId("code-block")
			expect(codeBlocks).toHaveLength(2)
			expect(codeBlocks[1]).toHaveTextContent("full restored output")
		})
	})

	it("drops fetched full output when the command identity changes", async () => {
		let messageHandler: ((event: MessageEvent) => void) | undefined
		vi.mocked(useEvent).mockImplementation((_event: string, handler: any) => {
			messageHandler = handler
		})

		const { rerender } = render(
			<ExtensionStateWrapper>
				<CommandExecution
					executionId="test-truncated-switch"
					text={"cat log\nOutput:\ntruncated preview"}
					commandOutputTruncated
					messageTs={42}
				/>
			</ExtensionStateWrapper>,
		)

		const expandButton = screen
			.getAllByRole("button")
			.find((button) => !["Allow", "Deny"].includes(button.textContent || ""))
		fireEvent.click(expandButton!)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({ type: "requestCommandOutput", messageTs: 42 })
		})

		messageHandler?.({
			data: {
				type: "commandOutputFull",
				messageTs: 42,
				text: "cat log\nOutput:\nfull restored output",
			},
		} as MessageEvent)

		await waitFor(() => {
			expect(screen.getAllByTestId("code-block")[1]).toHaveTextContent("full restored output")
		})

		rerender(
			<ExtensionStateWrapper>
				<CommandExecution
					executionId="test-truncated-switch"
					text={"cat other\nOutput:\nnext preview"}
					commandOutputTruncated
					messageTs={99}
				/>
			</ExtensionStateWrapper>,
		)

		expect(screen.getAllByTestId("code-block")).toHaveLength(1)
		expect(screen.queryByText("full restored output")).not.toBeInTheDocument()
	})
})
