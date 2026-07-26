import { describe, it, expect, vi, beforeEach } from "vitest"
import { CommitMessageGenerator } from "../CommitMessageGenerator"
import { ProviderSettingsManager } from "../../../core/config/ProviderSettingsManager"
import { ContextProxy } from "../../../core/config/ContextProxy"
import { singleCompletionHandler } from "../../../utils/single-completion-handler"
import { GenerateMessageParams, ProgressUpdate } from "../types/core"

vi.mock("../../../core/config/ContextProxy")
vi.mock("../../../utils/single-completion-handler")
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: { instance: { captureEvent: vi.fn() } },
}))

describe("CommitMessageGenerator", () => {
	let generator: CommitMessageGenerator
	let mockProviderSettingsManager: ProviderSettingsManager

	const mockGitContext = `
diff --git a/src/test.ts b/src/test.ts
new file mode 100644
index 0000000..123
--- /dev/null
+++ b/src/test.ts
@@ -0,0 +1,3 @@
+export function test() {
+  console.log('test');
+}
`

	beforeEach(() => {
		vi.clearAllMocks()

		Object.defineProperty(ContextProxy, "instance", {
			get: vi.fn(() => ({
				isInitialized: true,
				getProviderSettings: vi.fn().mockReturnValue({
					apiProvider: "openai",
					openAiModelId: "gpt-5.6-sol",
				}),
				getValue: vi.fn((key: string) => {
					if (key === "listApiConfigMeta") return []
					if (key === "customSupportPrompts") return {}
					return undefined
				}),
			})),
			configurable: true,
		})

		// Mock ProviderSettingsManager with minimal required methods
		mockProviderSettingsManager = {
			getProfile: vi.fn().mockResolvedValue({
				apiProvider: "anthropic",
				model: "claude-3-haiku-20240307",
			}),
		} as any

		vi.mocked(singleCompletionHandler).mockResolvedValue("fix: 恢复 Git 提交建议")
		generator = new CommitMessageGenerator(mockProviderSettingsManager)
	})

	describe("class instantiation", () => {
		it("should create CommitMessageGenerator instance", () => {
			expect(generator).toBeInstanceOf(CommitMessageGenerator)
		})

		it("should implement ICommitMessageGenerator interface", () => {
			expect(generator.generateMessage).toBeDefined()
			expect(generator.buildPrompt).toBeDefined()
			expect(typeof generator.generateMessage).toBe("function")
			expect(typeof generator.buildPrompt).toBe("function")
		})
	})

	describe("state management", () => {
		it("should initialize with null previous context and message", () => {
			// Private fields, but we can test behavior through public methods
			expect(generator).toHaveProperty("previousGitContext")
			expect(generator).toHaveProperty("previousCommitMessage")
		})
	})

	describe("progress callback support", () => {
		it("should accept onProgress callback in generateMessage params", () => {
			const progressUpdates: ProgressUpdate[] = []
			const params: GenerateMessageParams = {
				workspacePath: "/test/workspace",
				selectedFiles: ["src/test.ts"],
				gitContext: mockGitContext,
				onProgress: (progress) => progressUpdates.push(progress),
			}

			expect(params.onProgress).toBeDefined()
			expect(typeof params.onProgress).toBe("function")

			params.onProgress?.({
				message: "test progress",
				percentage: 50,
			})

			expect(progressUpdates).toHaveLength(1)
			expect(progressUpdates[0].message).toBeDefined()
			expect(progressUpdates[0].message).toBe("test progress")
			expect(progressUpdates[0].percentage).toBe(50)
		})
	})

	describe("IDE independence", () => {
		it("should accept IDE-agnostic parameters", () => {
			const params: GenerateMessageParams = {
				workspacePath: "/any/workspace",
				selectedFiles: ["file1.ts", "file2.js"],
				gitContext: mockGitContext,
			}

			// Parameters should be well-formed
			expect(params.workspacePath).toBe("/any/workspace")
			expect(params.selectedFiles).toEqual(["file1.ts", "file2.js"])
			expect(params.gitContext).toBe(mockGitContext)
		})
	})

	describe("buildPrompt method", () => {
		it("should accept gitContext and options", async () => {
			const options = {
				customSupportPrompts: { COMMIT_MESSAGE: "Custom template" },
				previousContext: "some previous context",
				previousMessage: "previous message",
			}

			// Should not throw when called with valid parameters
			expect(async () => {
				await generator.buildPrompt(mockGitContext, options)
			}).not.toThrow()
		})

		it("should request Simplified Chinese commit messages by default", async () => {
			const prompt = await generator.buildPrompt(mockGitContext, {})

			expect(prompt).toContain("Use Simplified Chinese for the description and body by default")
			expect(prompt).toContain("<type>[optional scope]: <description>")
		})
	})

	describe("AI completion route", () => {
		it("uses the normalized stream first for commit message generation", async () => {
			const result = await generator.generateMessage({
				workspacePath: "/test/workspace",
				selectedFiles: ["src/test.ts"],
				gitContext: mockGitContext,
			})

			expect(result).toBe("fix: 恢复 Git 提交建议")
			expect(singleCompletionHandler).toHaveBeenCalledWith(
				expect.objectContaining({ apiProvider: "openai", openAiModelId: "gpt-5.6-sol" }),
				expect.stringContaining("Conventional Commit Message Generator"),
				{ preferStream: true },
			)
		})
	})

	describe("error handling", () => {
		it("should handle errors in generateMessage gracefully", async () => {
			vi.mocked(singleCompletionHandler).mockRejectedValueOnce(new Error("AI unavailable"))
			const invalidParams: GenerateMessageParams = {
				workspacePath: "",
				selectedFiles: [],
				gitContext: "",
			}

			await expect(generator.generateMessage(invalidParams)).rejects.toThrow(
				"Failed to generate commit message: AI unavailable",
			)
		})
	})
})
