import os from "os"
import * as path from "path"
import fs from "fs/promises"
import EventEmitter from "events"

import { Anthropic } from "@anthropic-ai/sdk"
import delay from "delay"
import axios from "axios"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import {
	type TaskProviderLike,
	type TaskProviderEvents,
	type GlobalState,
	type ProviderName,
	type ProviderSettings,
	type RooCodeSettings,
	type ProviderSettingsEntry,
	type StaticAppProperties,
	type DynamicAppProperties,
	type CloudAppProperties,
	type TaskProperties,
	type GitProperties,
	type TelemetryProperties,
	type TelemetryPropertiesProvider,
	type CodeActionId,
	type CodeActionName,
	type TerminalActionId,
	type TerminalActionPromptType,
	type HistoryItem,
	type CloudUserInfo,
	type CloudOrganizationMembership,
	type CreateTaskOptions,
	type ParallelWorkspace,
	type TokenUsage,
	type ToolUsage,
	type ExtensionMessage,
	type ExtensionState,
	type MarketplaceInstalledMetadata,
	RooCodeEventName,
	TelemetryEventName, // kilocode_change
	requestyDefaultModelId,
	openRouterDefaultModelId,
	glamaDefaultModelId, // kilocode_change
	DEFAULT_TERMINAL_OUTPUT_CHARACTER_LIMIT,
	DEFAULT_WRITE_DELAY_MS,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_MODES,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	getModelId,
	isTypicalProvider,
	modelIdKeys,
	modelIdKeysByProvider,
} from "@roo-code/types"
import { aggregateTaskCostsRecursive, type AggregatedCosts } from "./aggregateTaskCosts"
import { TelemetryService } from "@roo-code/telemetry"
import { CloudService, BridgeOrchestrator, getRooCodeApiUrl } from "@roo-code/cloud"

import { Package } from "../../shared/package"
import { findLast } from "../../shared/array"
import { supportPrompt } from "../../shared/support-prompt"
import { GlobalFileNames } from "../../shared/globalFileNames"
import { Mode, defaultModeSlug, getModeBySlug } from "../../shared/modes"
import { experimentDefault } from "../../shared/experiments"
import { formatLanguage } from "../../shared/language"
import { WebviewMessage } from "../../shared/WebviewMessage"
import { EMBEDDING_MODEL_PROFILES } from "../../shared/embeddingModels"
import { ProfileValidator } from "../../shared/ProfileValidator"
import { checkExistKey } from "../../shared/checkExistApiConfig"

import { Terminal } from "../../integrations/terminal/Terminal"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry" // kilocode_change
import { downloadTask } from "../../integrations/misc/export-markdown"
import { getTheme } from "../../integrations/theme/getTheme"
import WorkspaceTracker from "../../integrations/workspace/WorkspaceTracker"

import { McpHub } from "../../services/mcp/McpHub"
import { McpServerManager } from "../../services/mcp/McpServerManager"
import { MarketplaceManager } from "../../services/marketplace"
import { ShadowCheckpointService } from "../../services/checkpoints/ShadowCheckpointService"
import { ParallelManager } from "../kilocode/parallel/ParallelManager"
import { LiveTaskCoordinator } from "../kilocode/parallel/LiveTaskCoordinator"
import { WorkspaceRegistry } from "../kilocode/parallel/WorkspaceRegistry"
import {
	FileParallelStateStore,
	MementoParallelStateStore,
	type ParallelStateStorage,
} from "../kilocode/parallel/ParallelStateStore"
import { WorkspaceService } from "../kilocode/parallel/WorkspaceService"
import { CodeIndexManager } from "../../services/code-index/manager"
import type { IndexProgressUpdate } from "../../services/code-index/interfaces/manager"
import { MdmService } from "../../services/mdm/MdmService"
import { SessionManager } from "../../shared/kilocode/cli-sessions/core/SessionManager"
import { SkillsManager } from "../../services/skills/SkillsManager"

import { fileExistsAtPath } from "../../utils/fs"
import { setTtsEnabled, setTtsSpeed } from "../../utils/tts"
import { getWorkspaceGitInfo } from "../../utils/git"
import { getWorkspacePath } from "../../utils/path"
import { OrganizationAllowListViolationError } from "../../utils/errors"

import { setPanel } from "../../activate/registerCommands"

import { t } from "../../i18n"

import { buildApiHandler } from "../../api"
import { forceFullModelDetailsLoad, hasLoadedFullDetails } from "../../api/providers/fetchers/lmstudio"
import { VirtualQuotaFallbackHandler } from "../../api/providers/virtual-quota-fallback"

import { ContextProxy } from "../config/ContextProxy"
import { getEnabledRules } from "./kilorules"
import {
	DEEPTASK_DEFAULT_OPENAI_CUSTOM_MODEL_INFO,
	DEEPTASK_DEFAULT_OPENAI_MODEL_ID,
	ProviderSettingsManager,
} from "../config/ProviderSettingsManager"
import { CustomModesManager } from "../config/CustomModesManager"
import { Task, type UserContinuationOptions } from "../task/Task"
import { getSystemPromptFilePath } from "../prompts/sections/custom-system-prompt"

import { webviewMessageHandler } from "./webviewMessageHandler"
import type { ClineMessage, TodoItem } from "@roo-code/types"
import { readApiMessages, saveApiMessages, saveTaskMessages } from "../task-persistence"
import { readTaskMessages } from "../task-persistence/taskMessages"
import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { REQUESTY_BASE_URL } from "../../shared/utils/requesty"
import { validateAndFixToolResultIds } from "../task/validateToolResultIds"

//kilocode_change start
import { McpDownloadResponse, McpMarketplaceCatalog } from "../../shared/kilocode/mcp"
import { McpServer } from "../../shared/mcp"
import { OpenRouterHandler } from "../../api/providers"
import { stringifyError } from "../../shared/kilocode/errorUtils"
import isWsl from "is-wsl"
import { getKilocodeDefaultModel } from "../../api/providers/kilocode/getKilocodeDefaultModel"
import { getEffectiveTelemetrySetting, getKiloCodeWrapperProperties } from "../../core/kilocode/wrapper"
import { getKilocodeConfig, KilocodeConfig } from "../../utils/kilo-config-file"
import { resolveToolProtocol } from "../../utils/resolveToolProtocol"
import { kilo_execIfExtension } from "../../shared/kilocode/cli-sessions/extension/session-manager-utils"
import { DeviceAuthHandler } from "../kilocode/webview/deviceAuthHandler"

export type ClineProviderState = Awaited<ReturnType<ClineProvider["getState"]>>

const DEEPTASK_DEFAULT_GLOBAL_SETTINGS: Partial<GlobalState> = {
	allowedCommands: ["git log", "git diff", "git show", "* "],
	deniedCommands: [],
	autoApprovalEnabled: true,
	alwaysAllowReadOnly: true,
	alwaysAllowReadOnlyOutsideWorkspace: true,
	alwaysAllowWrite: true,
	alwaysAllowWriteOutsideWorkspace: true,
	alwaysAllowWriteProtected: true,
	alwaysAllowExecute: true,
	alwaysAllowBrowser: false,
	alwaysAllowMcp: false,
	alwaysAllowModeSwitch: true,
	alwaysAllowProviderProfileSwitch: true, // kilocode_change
	alwaysAllowSubtasks: true,
	showAutoApproveMenu: true,
	terminalShellIntegrationDisabled: false,
	terminalShellIntegrationTimeout: 5000,
	terminalOutputCharacterLimit: 50000,
	terminalOutputLineLimit: 500,
	terminalCompletedTerminalLimitEnabled: true,
	terminalCompletedTerminalLimit: 3,
	terminalCommandDelay: 0,
	terminalCompressProgressBar: true,
	browserToolEnabled: false,
	enableCheckpoints: false,
	reasoningBlockCollapsed: true,
	autoCondenseContext: true,
	autoCondenseContextPercent: 100,
	followupAutoApproveTimeoutMs: 60000,
}

const DEEPTASK_LEGACY_ALLOWED_COMMANDS = ["git log", "git diff", "git show"]
// kilocode_change end

/**
 * https://github.com/microsoft/vscode-webview-ui-toolkit-samples/blob/main/default/weather-webview/src/providers/WeatherViewProvider.ts
 * https://github.com/KumarVariable/vscode-extension-sidebar-html/blob/master/src/customSidebarViewProvider.ts
 */

export type ClineProviderEvents = {
	clineCreated: [cline: Task]
}

interface PendingEditOperation {
	messageTs: number
	editedContent: string
	images?: string[]
	messageIndex: number
	apiConversationHistoryIndex: number
	timeoutId: NodeJS.Timeout
	createdAt: number
}

interface PendingCancelledTaskContinuation {
	text: string
	images?: string[]
	options?: UserContinuationOptions
	createdAt: number
}

export class ClineProvider
	extends EventEmitter<TaskProviderEvents>
	implements vscode.WebviewViewProvider, TelemetryPropertiesProvider, TaskProviderLike
{
	// Used in package.json as the view's id. This value cannot be changed due
	// to how VSCode caches views based on their id, and updating the id would
	// break existing instances of the extension.
	public static readonly sideBarId = `${Package.name}.SidebarProvider`
	public static readonly tabPanelId = `${Package.name}.TabPanelProvider`
	private static activeInstances: Set<ClineProvider> = new Set()
	private disposables: vscode.Disposable[] = []
	private webviewDisposables: vscode.Disposable[] = []
	private view?: vscode.WebviewView | vscode.WebviewPanel
	private clineStack: Task[] = []
	private codeIndexStatusSubscription?: vscode.Disposable
	private codeIndexManager?: CodeIndexManager
	private _workspaceTracker?: WorkspaceTracker // workSpaceTracker read-only for access outside this class
	protected mcpHub?: McpHub // Change from private to protected
	protected skillsManager?: SkillsManager
	private marketplaceManager: MarketplaceManager
	private mdmService?: MdmService
	private taskCreationCallback: (task: Task) => void
	private taskEventListeners: WeakMap<Task, Array<() => void>> = new WeakMap()
	private currentWorkspacePath: string | undefined
	private autoPurgeScheduler?: any // kilocode_change - (Any) Prevent circular import
	private deviceAuthHandler?: DeviceAuthHandler // kilocode_change - Device auth handler

	private recentTasksCache?: string[]
	private pendingOperations: Map<string, PendingEditOperation> = new Map()
	private pendingCancelledTaskContinuation?: PendingCancelledTaskContinuation // kilocode_change
	private pendingCancelledTaskContinuationChain: Promise<void> = Promise.resolve() // kilocode_change
	private static readonly PENDING_OPERATION_TIMEOUT_MS = 30000 // 30 seconds

	private cloudOrganizationsCache: CloudOrganizationMembership[] | null = null
	private cloudOrganizationsCacheTimestamp: number | null = null
	private static readonly CLOUD_ORGANIZATIONS_CACHE_DURATION_MS = 5 * 1000 // 5 seconds

	public isViewLaunched = false
	public settingsImportedAt?: number
	public readonly latestAnnouncementId = "jan-2026-v3.41.0-openai-codex-provider-gpt52-fixes" // v3.41.0 OpenAI Codex Provider, GPT-5.2-codex, Bug Fixes
	public readonly providerSettingsManager: ProviderSettingsManager
	public readonly customModesManager: CustomModesManager

	constructor(
		readonly context: vscode.ExtensionContext,
		private readonly outputChannel: vscode.OutputChannel,
		private readonly renderContext: "sidebar" | "editor" = "sidebar",
		public readonly contextProxy: ContextProxy,
		mdmService?: MdmService,
	) {
		super()
		this.currentWorkspacePath = getWorkspacePath()

		ClineProvider.activeInstances.add(this)

		this.mdmService = mdmService
		this.updateGlobalState("codebaseIndexModels", EMBEDDING_MODEL_PROFILES)

		// Start configuration loading (which might trigger indexing) in the background.
		// Don't await, allowing activation to continue immediately.

		// Register this provider with the telemetry service to enable it to add
		// properties like mode and provider.
		TelemetryService.instance.setProvider(this)

		this._workspaceTracker = new WorkspaceTracker(this)

		this.providerSettingsManager = new ProviderSettingsManager(this.context)

		this.customModesManager = new CustomModesManager(this.context, async () => {
			await this.postStateToWebview()
		})

		// Initialize MCP Hub through the singleton manager
		McpServerManager.getInstance(this.context, this)
			.then((hub) => {
				this.mcpHub = hub
				this.mcpHub.registerClient()
			})
			.catch((error) => {
				this.log(`Failed to initialize MCP Hub: ${error}`)
			})

		// Initialize Skills Manager for skill discovery
		this.skillsManager = new SkillsManager(this)
		this.skillsManager.initialize().catch((error) => {
			this.log(`Failed to initialize Skills Manager: ${error}`)
		})

		this.marketplaceManager = new MarketplaceManager(this.context, this.customModesManager)

		// Forward <most> task events to the provider.
		// We do something fairly similar for the IPC-based API.
		this.taskCreationCallback = (instance: Task) => {
			this.emit(RooCodeEventName.TaskCreated, instance)

			// Create named listener functions so we can remove them later.
			const onTaskStarted = () => this.emit(RooCodeEventName.TaskStarted, instance.taskId)
			const onTaskCompleted = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
				kilo_execIfExtension(() => {
					SessionManager.init()?.doSync(true)
				})
				void this.parallelManager.markConversationCompleted(taskId)

				return this.emit(RooCodeEventName.TaskCompleted, taskId, tokenUsage, toolUsage) // kilocode_change: return
			}
			const onTaskAborted = async () => {
				this.emit(RooCodeEventName.TaskAborted, instance.taskId)

				try {
					// Only rehydrate on genuine streaming failures.
					// User-initiated cancels are handled by cancelTask().
					if (instance.abortReason === "streaming_failed") {
						// Defensive safeguard: if another path already replaced this instance, skip
						const current = this.getCurrentTask()
						if (current && current.instanceId !== instance.instanceId) {
							this.log(
								`[onTaskAborted] Skipping rehydrate: current instance ${current.instanceId} != aborted ${instance.instanceId}`,
							)
							return
						}

						const { historyItem } = await this.getTaskWithId(instance.taskId)
						const rootTask = instance.rootTask
						const parentTask = instance.parentTask
						await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
					}
				} catch (error) {
					this.log(
						`[onTaskAborted] Failed to rehydrate after streaming failure: ${
							error instanceof Error ? error.message : String(error)
						}`,
					)
				}
			}
			const onTaskFocused = () => this.emit(RooCodeEventName.TaskFocused, instance.taskId)
			const onTaskUnfocused = () => this.emit(RooCodeEventName.TaskUnfocused, instance.taskId)
			const onTaskActive = (taskId: string) => this.emit(RooCodeEventName.TaskActive, taskId)
			const onTaskInteractive = (taskId: string) => this.emit(RooCodeEventName.TaskInteractive, taskId)
			const onTaskResumable = (taskId: string) => this.emit(RooCodeEventName.TaskResumable, taskId)
			const onTaskIdle = (taskId: string) => this.emit(RooCodeEventName.TaskIdle, taskId)
			const onTaskPaused = (taskId: string) => this.emit(RooCodeEventName.TaskPaused, taskId)
			const onTaskUnpaused = (taskId: string) => this.emit(RooCodeEventName.TaskUnpaused, taskId)
			const onTaskSpawned = (taskId: string) => this.emit(RooCodeEventName.TaskSpawned, taskId)
			const onTaskUserMessage = (taskId: string) => this.emit(RooCodeEventName.TaskUserMessage, taskId)
			const onTaskTokenUsageUpdated = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) =>
				this.emit(RooCodeEventName.TaskTokenUsageUpdated, taskId, tokenUsage, toolUsage)
			const onModelChanged = () => this.postStateToWebview() // kilocode_change: Listen for model changes in virtual quota fallback

			// Attach the listeners.
			instance.on(RooCodeEventName.TaskStarted, onTaskStarted)
			instance.on(RooCodeEventName.TaskCompleted, onTaskCompleted)
			instance.on(RooCodeEventName.TaskAborted, onTaskAborted)
			instance.on(RooCodeEventName.TaskFocused, onTaskFocused)
			instance.on(RooCodeEventName.TaskUnfocused, onTaskUnfocused)
			instance.on(RooCodeEventName.TaskActive, onTaskActive)
			instance.on(RooCodeEventName.TaskInteractive, onTaskInteractive)
			instance.on(RooCodeEventName.TaskResumable, onTaskResumable)
			instance.on(RooCodeEventName.TaskIdle, onTaskIdle)
			instance.on(RooCodeEventName.TaskPaused, onTaskPaused)
			instance.on(RooCodeEventName.TaskUnpaused, onTaskUnpaused)
			instance.on(RooCodeEventName.TaskSpawned, onTaskSpawned)
			instance.on(RooCodeEventName.TaskUserMessage, onTaskUserMessage)
			instance.on(RooCodeEventName.TaskTokenUsageUpdated, onTaskTokenUsageUpdated)
			instance.on("modelChanged", onModelChanged) // kilocode_change: Listen for model changes in virtual quota fallback

			// Store the cleanup functions for later removal.
			this.taskEventListeners.set(instance, [
				() => instance.off(RooCodeEventName.TaskStarted, onTaskStarted),
				() => instance.off(RooCodeEventName.TaskCompleted, onTaskCompleted),
				() => instance.off(RooCodeEventName.TaskAborted, onTaskAborted),
				() => instance.off(RooCodeEventName.TaskFocused, onTaskFocused),
				() => instance.off(RooCodeEventName.TaskUnfocused, onTaskUnfocused),
				() => instance.off(RooCodeEventName.TaskActive, onTaskActive),
				() => instance.off(RooCodeEventName.TaskInteractive, onTaskInteractive),
				() => instance.off(RooCodeEventName.TaskResumable, onTaskResumable),
				() => instance.off(RooCodeEventName.TaskIdle, onTaskIdle),
				() => instance.off(RooCodeEventName.TaskUserMessage, onTaskUserMessage),
				() => instance.off(RooCodeEventName.TaskPaused, onTaskPaused),
				() => instance.off(RooCodeEventName.TaskUnpaused, onTaskUnpaused),
				() => instance.off(RooCodeEventName.TaskSpawned, onTaskSpawned),
				() => instance.off(RooCodeEventName.TaskTokenUsageUpdated, onTaskTokenUsageUpdated),
				() => instance.off("modelChanged", onModelChanged), // kilocode_change: Clean up model change listener
			])
		}

		// kilocode_change start: Ensure seeded provider profiles are reflected in active webview state.
		this.initializeDefaultProviderProfile().catch((error) => {
			this.log(
				`Failed to initialize default provider profile: ${error instanceof Error ? error.message : String(error)}`,
			)
		})
		// kilocode_change end

		// Initialize Roo Code Cloud profile sync.
		if (CloudService.hasInstance()) {
			this.initializeCloudProfileSync().catch((error) => {
				this.log(`Failed to initialize cloud profile sync: ${error}`)
			})
		} else {
			this.log("CloudService not ready, deferring cloud profile sync")
		}

		// kilocode_change start - Initialize auto-purge scheduler
		this.initializeAutoPurgeScheduler()
		// kilocode_change end
	}

	// kilocode_change start
	private defaultProviderProfileInitialization?: Promise<ProviderSettings | undefined>
	private _workspaceRegistry?: WorkspaceRegistry
	private _workspaceServices?: Map<string, WorkspaceService>
	private _parallelManager?: ParallelManager
	private _parallelInit?: Promise<void>
	private _parallelRegisteredCwd?: string
	private conversationRestoreDone = false
	public pendingNewConversation: { id: string; folderPath: string; workspacePath?: string } | undefined
	private _liveTaskCoordinator?: LiveTaskCoordinator
	private _parallelStateStore?: ParallelStateStorage

	/**
	 * Cross-window shared file store for all parallel state. Every window of
	 * the extension host uses the same file, so reads see the freshest data
	 * and writes serialize on the same advisory lock instead of clobbering
	 * each other through per-window globalState blob snapshots.
	 */
	private get parallelStateStore(): ParallelStateStorage {
		if (!this._parallelStateStore) {
			// kilocode_change: globalState blob writes from other windows roll
			// back parallel keys (round-16 root cause); use a dedicated shared
			// file guarded by an inter-process lock instead. Tests run with
			// mocked storages, so keep the in-memory Memento wrapper there.
			if (process.env.NODE_ENV === "test" || process.env.VITEST) {
				this._parallelStateStore = new MementoParallelStateStore(this.context.globalState)
			} else {
				this._parallelStateStore = new FileParallelStateStore({
					filePath: path.join(
						this.contextProxy?.globalStorageUri?.fsPath ?? this.context.globalStorageUri.fsPath,
						"parallel-state.json",
					),
					legacy: this.context.globalState,
				})
			}
		}
		return this._parallelStateStore
	}

	get workspaceRegistry(): WorkspaceRegistry {
		if (!this._workspaceRegistry) {
			this._workspaceRegistry = new WorkspaceRegistry(this.parallelStateStore)
		}
		return this._workspaceRegistry
	}

	get workspaceService(): WorkspaceService {
		return this.getWorkspaceService()
	}

	getWorkspaceService(projectRoot?: string): WorkspaceService {
		const root = projectRoot ?? this.cwd
		if (!this._workspaceServices) {
			this._workspaceServices = new Map()
		}
		let service = this._workspaceServices.get(root)
		if (!service) {
			service = new WorkspaceService(root, this.workspaceRegistry)
			this._workspaceServices.set(root, service)
		}
		return service
	}

	get parallelManager(): ParallelManager {
		if (!this._parallelManager) {
			this._parallelManager = new ParallelManager(this, this.workspaceRegistry, this.parallelStateStore)
			this._parallelRegisteredCwd = this.cwd
			this._parallelInit = (
				this.cwd ? this._parallelManager.registerMainFolder(this.cwd) : Promise.resolve(false)
			).then(() => this._parallelManager!.hydrateRegisteredWorkspaces())
		} else if (this.cwd && this.cwd !== this._parallelRegisteredCwd) {
			const folderPath = this.cwd
			this._parallelRegisteredCwd = folderPath
			this._parallelInit = (this._parallelInit ?? Promise.resolve()).then(async () => {
				await this._parallelManager!.registerMainFolder(folderPath)
			})
		}
		return this._parallelManager
	}

	get liveTaskCoordinator(): LiveTaskCoordinator {
		if (!this._liveTaskCoordinator) {
			this._liveTaskCoordinator = new LiveTaskCoordinator({
				storageDir: this.contextProxy.globalStorageUri.fsPath,
			})
			this._liveTaskCoordinator.onChange(() => {
				void this.parallelManager.broadcast().catch((error) => {
					console.error("[ClineProvider] remote live-task broadcast failed:", error)
				})
			})
			this._liveTaskCoordinator.start()
		}
		return this._liveTaskCoordinator
	}

	/** Serialize cancellation rehydration so consecutive human messages cannot overwrite one payload. */
	public async rehydrateTaskWithUserMessage(
		text: string,
		images?: string[],
		options?: UserContinuationOptions,
	): Promise<void> {
		const run = this.pendingCancelledTaskContinuationChain
			.catch(() => undefined)
			.then(async () => {
				this.setPendingCancelledTaskContinuation(text, images, options)
				await this.cancelTask()
			})
		this.pendingCancelledTaskContinuationChain = run.catch((error) => {
			this.log(
				`[rehydrateTaskWithUserMessage] Failed to deliver user message: ${error instanceof Error ? error.message : String(error)}`,
			)
		})
		await run
	}

	public setPendingCancelledTaskContinuation(
		text: string,
		images?: string[],
		options?: UserContinuationOptions,
	): void {
		this.pendingCancelledTaskContinuation = { text, images, options, createdAt: Date.now() }
	}

	private consumePendingCancelledTaskContinuation(): PendingCancelledTaskContinuation | undefined {
		const continuation = this.pendingCancelledTaskContinuation
		this.pendingCancelledTaskContinuation = undefined
		return continuation
	}

	private async initializeDefaultProviderProfile() {
		const providerSettings = await this.ensureDefaultProviderProfileInActiveState()

		if (providerSettings) {
			this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })
			await this.postStateToWebview()
			await TelemetryService.instance.updateIdentity(providerSettings.kilocodeToken ?? "")
		}

		return providerSettings
	}

	private async ensureDefaultProviderProfileInActiveState(): Promise<ProviderSettings | undefined> {
		if (this.defaultProviderProfileInitialization) {
			return this.defaultProviderProfileInitialization
		}

		this.defaultProviderProfileInitialization = this.activateDefaultProviderProfileIfNeeded().finally(() => {
			this.defaultProviderProfileInitialization = undefined
		})

		return this.defaultProviderProfileInitialization
	}

	private isLegacyDefaultAllowedCommands(commands: unknown): boolean {
		return (
			Array.isArray(commands) &&
			commands.length === DEEPTASK_LEGACY_ALLOWED_COMMANDS.length &&
			DEEPTASK_LEGACY_ALLOWED_COMMANDS.every((command, index) => commands[index] === command)
		)
	}

	private async ensureDeeptaskDefaultGlobalSettings(): Promise<void> {
		const stateValues = this.contextProxy.getValues()
		const updates: Partial<GlobalState> = {}

		for (const [key, defaultValue] of Object.entries(DEEPTASK_DEFAULT_GLOBAL_SETTINGS) as [
			keyof GlobalState,
			GlobalState[keyof GlobalState],
		][]) {
			const currentValue = stateValues[key]

			if (key === "allowedCommands") {
				if (currentValue === undefined || this.isLegacyDefaultAllowedCommands(currentValue)) {
					updates[key] = defaultValue as any
				}
				continue
			}

			if (currentValue === undefined) {
				updates[key] = defaultValue as any
			}
		}

		if (Object.keys(updates).length > 0) {
			await this.contextProxy.setValues(updates)
		}
	}

	private syncRuntimeTerminalSettings(
		state: Pick<GlobalState, "terminalCompletedTerminalLimitEnabled" | "terminalCompletedTerminalLimit">,
	): void {
		// kilocode_change start
		TerminalRegistry.setCompletedTerminalLimitEnabled(state.terminalCompletedTerminalLimitEnabled ?? true)
		TerminalRegistry.setCompletedTerminalLimit(state.terminalCompletedTerminalLimit ?? 3)
		// kilocode_change end
	}

	private async activateDefaultProviderProfileIfNeeded(): Promise<ProviderSettings | undefined> {
		await this.providerSettingsManager.initialize()
		await this.contextProxy.refreshSecrets()
		await this.ensureDeeptaskDefaultGlobalSettings()

		const profiles = await this.providerSettingsManager.listConfig()
		if (profiles.length === 0) {
			return undefined
		}

		const currentName = this.contextProxy.getValue("currentApiConfigName")
		const listApiConfigMeta = this.contextProxy.getValue("listApiConfigMeta") ?? []
		const currentSettings = this.contextProxy.getProviderSettings()
		const hasActiveSettings = checkExistKey(currentSettings)
		const hasSyncedProfileList = profiles.every(({ name, id }) =>
			listApiConfigMeta.some((entry) => entry.name === name && entry.id === id),
		)
		const currentProfileExists = Boolean(currentName && profiles.some(({ name }) => name === currentName))
		// kilocode_change start: Treat old Deeptask defaults as unconfigured.
		const isLegacyBundledKilocodeDefault =
			currentName === "default" &&
			currentSettings.apiProvider === "kilocode" &&
			(currentSettings.kilocodeModel === "minimax/minimax-m2.1:free" ||
				currentSettings.kilocodeModel === "minimax-m2.1:free") &&
			!currentSettings.kilocodeToken
		const isLegacyDeeptaskOpenAiDefault =
			currentName === "default" &&
			currentSettings.apiProvider === "openai" &&
			currentSettings.openAiModelId === "gpt-4o" &&
			!currentSettings.openAiBaseUrl &&
			!currentSettings.openAiApiKey
		const shouldUpgradeLegacyDefault = isLegacyBundledKilocodeDefault || isLegacyDeeptaskOpenAiDefault
		// kilocode_change end

		if (hasActiveSettings && hasSyncedProfileList && currentProfileExists && !shouldUpgradeLegacyDefault) {
			return undefined
		}

		let profileToActivate = profiles.find(({ name }) => name === currentName) ?? profiles[0]

		if (!profileToActivate?.name) {
			return undefined
		}

		// kilocode_change start: Upgrade the stored legacy default before activation.
		if (shouldUpgradeLegacyDefault && profileToActivate.name === "default") {
			await this.providerSettingsManager.saveConfig("default", {
				id: profileToActivate.id,
				apiProvider: "openai",
				openAiModelId: DEEPTASK_DEFAULT_OPENAI_MODEL_ID,
				openAiStreamingEnabled: true,
				openAiR1FormatEnabled: true,
				openAiCustomModelInfo: DEEPTASK_DEFAULT_OPENAI_CUSTOM_MODEL_INFO,
				includeMaxTokens: true,
				todoListEnabled: true,
				diffEnabled: true,
				fuzzyMatchThreshold: 1.0,
				toolProtocol: "native",
			} as any)
			profileToActivate =
				(await this.providerSettingsManager.listConfig()).find(({ name }) => name === "default") ??
				profileToActivate
		}
		// kilocode_change end

		const { name, ...providerSettings } = await this.providerSettingsManager.activateProfile({
			name: profileToActivate.name,
		}).catch(() => this.providerSettingsManager.activateProfile({ name: "default" }))
		const updatedProfiles = await this.providerSettingsManager.listConfig()

		await Promise.all([
			this.contextProxy.setValue("listApiConfigMeta", updatedProfiles),
			this.contextProxy.setValue("currentApiConfigName", name),
			this.contextProxy.setProviderSettings(providerSettings),
		])

		return providerSettings
	}
	// kilocode_change end

	// kilocode_change start
	/**
	 * Initialize the auto-purge scheduler
	 */
	private async initializeAutoPurgeScheduler() {
		try {
			const { AutoPurgeScheduler } = await import("../../services/auto-purge")
			this.autoPurgeScheduler = new AutoPurgeScheduler(this.contextProxy.globalStorageUri.fsPath)

			// Start the scheduler with functions to get current settings and task history
			this.autoPurgeScheduler.start(
				async () => {
					const state = await this.getState()
					return {
						enabled: state.autoPurgeEnabled ?? false,
						defaultRetentionDays: state.autoPurgeDefaultRetentionDays ?? 30,
						favoritedTaskRetentionDays: state.autoPurgeFavoritedTaskRetentionDays ?? null,
						completedTaskRetentionDays: state.autoPurgeCompletedTaskRetentionDays ?? 30,
						incompleteTaskRetentionDays: state.autoPurgeIncompleteTaskRetentionDays ?? 7,
						lastRunTimestamp: state.autoPurgeLastRunTimestamp,
					}
				},
				async () => {
					return this.getTaskHistory()
				},
				() => this.getCurrentTask()?.taskId,
				async (taskId: string) => {
					// Remove task from state when purged
					await this.deleteTaskFromState(taskId)
				},
			)

			this.log("Auto-purge scheduler initialized")
		} catch (error) {
			this.log(
				`Failed to initialize auto-purge scheduler: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}
	// kilocode_change end

	/**
	 * Override EventEmitter's on method to match TaskProviderLike interface
	 */
	override on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.on(event, listener as any)
	}

	/**
	 * Override EventEmitter's off method to match TaskProviderLike interface
	 */
	override off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this {
		return super.off(event, listener as any)
	}

	/**
	 * Initialize cloud profile synchronization
	 */
	private async initializeCloudProfileSync() {
		try {
			// Check if authenticated and sync profiles
			if (CloudService.hasInstance() && CloudService.instance.isAuthenticated()) {
				await this.syncCloudProfiles()
			}

			// Set up listener for future updates
			if (CloudService.hasInstance()) {
				CloudService.instance.on("settings-updated", this.handleCloudSettingsUpdate)
			}
		} catch (error) {
			this.log(`Error in initializeCloudProfileSync: ${error}`)
		}
	}

	/**
	 * Handle cloud settings updates
	 */
	private handleCloudSettingsUpdate = async () => {
		try {
			await this.syncCloudProfiles()
		} catch (error) {
			this.log(`Error handling cloud settings update: ${error}`)
		}
	}

	/**
	 * Synchronize cloud profiles with local profiles.
	 */
	private async syncCloudProfiles() {
		try {
			const settings = CloudService.instance.getOrganizationSettings()

			if (!settings?.providerProfiles) {
				return
			}

			const currentApiConfigName = this.getGlobalState("currentApiConfigName")

			const result = await this.providerSettingsManager.syncCloudProfiles(
				settings.providerProfiles,
				currentApiConfigName,
			)

			if (result.hasChanges) {
				// Update list.
				await this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig())

				if (result.activeProfileChanged && result.activeProfileId) {
					// Reload full settings for new active profile.
					const profile = await this.providerSettingsManager.getProfile({
						id: result.activeProfileId,
					})
					await this.activateProviderProfile({ name: profile.name })
				}

				await this.postStateToWebview()
			}
		} catch (error) {
			this.log(`Error syncing cloud profiles: ${error}`)
		}
	}

	/**
	 * Initialize cloud profile synchronization when CloudService is ready
	 * This method is called externally after CloudService has been initialized
	 */
	public async initializeCloudProfileSyncWhenReady(): Promise<void> {
		try {
			if (CloudService.hasInstance() && CloudService.instance.isAuthenticated()) {
				await this.syncCloudProfiles()
			}

			if (CloudService.hasInstance()) {
				CloudService.instance.off("settings-updated", this.handleCloudSettingsUpdate)
				CloudService.instance.on("settings-updated", this.handleCloudSettingsUpdate)
			}
		} catch (error) {
			this.log(`Failed to initialize cloud profile sync when ready: ${error}`)
		}
	}

	// Adds a new Task instance to clineStack,king the start of a new task.
	// The instance is pushed to the top of the stack (LIFO order).
	// When the task is completed, the top instance is removed, reactivating the
	// previous task.
	async addClineToStack(task: Task) {
		// Add this cline instance into the stack that represents the order of
		// all the called tasks.
		this.clineStack.push(task)
		task.emit(RooCodeEventName.TaskFocused)

		// Perform special setup provider specific tasks.
		await this.performPreparationTasks(task)

		if (!task.subagent) {
			const title = task.metadata?.task?.slice(0, 60)
			await this.parallelManager.ensureTaskConversation({
				sessionId: task.taskId,
				title,
				workspacePath: task.cwd,
			})
		}

		// Ensure getState() resolves correctly.
		const state = await this.getState()

		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	/** Inserts a live subagent without making it the focused current task. */
	async addBackgroundClineToStack(task: Task) {
		this.clineStack.unshift(task)
		await this.performPreparationTasks(task)
		const state = await this.getState()
		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	async performPreparationTasks(cline: Task) {
		// LMStudio: We need to force model loading in order to read its context
		// size; we do it now since we're starting a task with that model selected.
		if (cline.apiConfiguration && cline.apiConfiguration.apiProvider === "lmstudio") {
			try {
				if (!hasLoadedFullDetails(cline.apiConfiguration.lmStudioModelId!)) {
					await forceFullModelDetailsLoad(
						cline.apiConfiguration.lmStudioBaseUrl ?? "http://localhost:1234",
						cline.apiConfiguration.lmStudioModelId!,
					)
				}
			} catch (error) {
				this.log(`Failed to load full model details for LM Studio: ${error}`)
				vscode.window.showErrorMessage(error.message)
			}
		}
	}

	// Removes and destroys the top Cline instance (the current finished task),
	// activating the previous one (resuming the parent task).
	async removeClineFromStack() {
		if (this.clineStack.length === 0) {
			return
		}

		// Pop the top Cline instance from the stack.
		let task = this.clineStack.pop()

		if (task) {
			task.emit(RooCodeEventName.TaskUnfocused)

			try {
				// Mirror windows must not abort a task that is still inferring
				// in another VSCodium window. Only the owner host may abandon it.
				if (!this.liveTaskCoordinator.isLiveElsewhere(task.taskId)) {
					await task.abortTask(true)
				}
			} catch (e) {
				this.log(
					`[ClineProvider#removeClineFromStack] abortTask() failed ${task.taskId}.${task.instanceId}: ${e.message}`,
				)
			}

			// Remove event listeners before clearing the reference.
			const cleanupFunctions = this.taskEventListeners.get(task)

			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(task)
			}

			// Make sure no reference kept, once promises end it will be
			// garbage collected.
			task = undefined
		}
	}

	// kilocode_change start: abort a parallel conversation that is not the top of the stack
	public async abortAndRemoveTask(taskId: string): Promise<void> {
		const index = this.clineStack.findIndex((task) => task.taskId === taskId)
		if (index === -1) {
			return
		}
		const [task] = this.clineStack.splice(index, 1)
		task.emit(RooCodeEventName.TaskUnfocused)
		try {
			if (!this.liveTaskCoordinator.isLiveElsewhere(task.taskId)) {
				await task.abortTask(true)
			}
		} catch (error) {
			this.log(
				`[ClineProvider#abortAndRemoveTask] abortTask() failed ${task.taskId}.${task.instanceId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
		const cleanupFunctions = this.taskEventListeners.get(task)
		if (cleanupFunctions) {
			cleanupFunctions.forEach((cleanup) => cleanup())
			this.taskEventListeners.delete(task)
		}
	}
	// kilocode_change end

	getTaskStackSize(): number {
		return this.clineStack.length
	}

	public getCurrentTaskStack(): string[] {
		return this.clineStack.map((cline) => cline.taskId)
	}

	// kilocode_change start: occupancy across parallel conversations and subagents
	public getLiveTasks(): Array<{
		taskId: string
		cwd: string
		abort: boolean
		abandoned: boolean
		isStreaming: boolean
		isActivelyRunning: boolean
	}> {
		const local = this.clineStack
			.filter((task) => !task.abort && !task.abandoned)
			.map((task) => ({
				taskId: task.taskId,
				cwd: task.cwd,
				abort: task.abort,
				abandoned: task.abandoned,
				isStreaming: task.isStreaming,
				// Command/tool waits keep the task loop active after HTTP streaming ends.
				isActivelyRunning: task.isActivelyRunningTaskLoop(),
			}))
		const remote = this._liveTaskCoordinator
			? this._liveTaskCoordinator.listRemoteTasks().map((task) => ({
					taskId: task.taskId,
					cwd: task.cwd,
					abort: task.abort,
					abandoned: task.abandoned,
					isStreaming: true,
					isActivelyRunning: true,
				}))
			: []
		const byId = new Map(local.map((task) => [task.taskId, task]))
		for (const task of remote) {
			if (!byId.has(task.taskId)) {
				byId.set(task.taskId, task)
			}
		}
		return [...byId.values()]
	}

	public shouldBroadcastTaskToChat(task: Task): boolean {
		if (this.pendingNewConversation) {
			return false
		}
		const focused = this.getFocusedChatTask()
		if (!focused) {
			return false
		}
		return focused.taskId === task.taskId
	}

	public syncLiveTask(task: Task): void {
		void this.liveTaskCoordinator
			.upsertTask({
				taskId: task.taskId,
				cwd: task.cwd,
				abort: task.abort,
				abandoned: task.abandoned,
			})
			.catch((error) => {
				console.error("[ClineProvider] live-task upsert failed:", error)
			})
		void this.parallelManager.broadcast().catch((error) => {
			console.error("[ClineProvider] live-task broadcast failed:", error)
		})
	}

	/**
	 * If another live task already occupies `workspacePath`, create a sibling
	 * git worktree under the same folder and move this conversation there.
	 * Completed integrated terminals stay in the process-wide prune pool.
	 */
	public async ensureUnoccupiedWorkspace(params: {
		workspacePath: string
		folderPath?: string
		task?: Task
		conversationId?: string
		name?: string
		description?: string
	}): Promise<{
		path: string
		created?: ParallelWorkspace
		occupants: Array<{ kind: string; id: string; label?: string }>
	}> {
		const manager = this.parallelManager
		await manager.getFolders()
		const folderPath = params.folderPath ?? manager.folderPathForPath(params.workspacePath)
		const occupants = await manager.occupantsOf(params.workspacePath, {
			taskId: params.task?.taskId,
			conversationId: params.conversationId,
		})
		if (occupants.length === 0) {
			return { path: params.workspacePath, occupants }
		}
		const state = await this.getState()
		if (state?.agentWorkspaceManagementEnabled === false) {
			return { path: params.workspacePath, occupants }
		}
		try {
			const created = await this.getWorkspaceService(folderPath).create({
				name: params.name,
				description: params.description,
				folderPath,
			})
			if (params.task) {
				await this.getWorkspaceService(folderPath).claim(created.name, `task:${params.task.taskId}`)
				await params.task.switchWorkspace(created.path)
			}
			if (params.conversationId) {
				await manager.updateConversationWorkspace(params.conversationId, folderPath, created.path)
				if (this.pendingNewConversation?.id === params.conversationId) {
					this.pendingNewConversation = {
						...this.pendingNewConversation,
						folderPath,
						workspacePath: created.path,
					}
				}
			}
			await this.postMessageToWebview({ type: "parallelWorkspaceChanged", text: created.path })
			await manager.broadcast()
			return { path: created.path, created, occupants }
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			console.error("[ClineProvider] failed to relocate occupied workspace:", error)
			vscode.window.showWarningMessage(
				`Workspace is already in use; could not create an isolated git worktree: ${detail}`,
			)
			return { path: params.workspacePath, occupants }
		}
	}
	// kilocode_change end

	// Pending Edit Operations Management

	/**
	 * Sets a pending edit operation with automatic timeout cleanup
	 */
	public setPendingEditOperation(
		operationId: string,
		editData: {
			messageTs: number
			editedContent: string
			images?: string[]
			messageIndex: number
			apiConversationHistoryIndex: number
		},
	): void {
		// Clear any existing operation with the same ID
		this.clearPendingEditOperation(operationId)

		// Create timeout for automatic cleanup
		const timeoutId = setTimeout(() => {
			this.clearPendingEditOperation(operationId)
			this.log(`[setPendingEditOperation] Automatically cleared stale pending operation: ${operationId}`)
		}, ClineProvider.PENDING_OPERATION_TIMEOUT_MS)

		// Store the operation
		this.pendingOperations.set(operationId, {
			...editData,
			timeoutId,
			createdAt: Date.now(),
		})

		this.log(`[setPendingEditOperation] Set pending operation: ${operationId}`)
	}

	/**
	 * Gets a pending edit operation by ID
	 */
	private getPendingEditOperation(operationId: string): PendingEditOperation | undefined {
		return this.pendingOperations.get(operationId)
	}

	/**
	 * Clears a specific pending edit operation
	 */
	private clearPendingEditOperation(operationId: string): boolean {
		const operation = this.pendingOperations.get(operationId)
		if (operation) {
			clearTimeout(operation.timeoutId)
			this.pendingOperations.delete(operationId)
			this.log(`[clearPendingEditOperation] Cleared pending operation: ${operationId}`)
			return true
		}
		return false
	}

	/**
	 * Clears all pending edit operations
	 */
	private clearAllPendingEditOperations(): void {
		for (const [operationId, operation] of this.pendingOperations) {
			clearTimeout(operation.timeoutId)
		}
		this.pendingOperations.clear()
		this.log(`[clearAllPendingEditOperations] Cleared all pending operations`)
	}

	/*
	VSCode extensions use the disposable pattern to clean up resources when the sidebar/editor tab is closed by the user or system. This applies to event listening, commands, interacting with the UI, etc.
	- https://vscode-docs.readthedocs.io/en/stable/extensions/patterns-and-principles/
	- https://github.com/microsoft/vscode-extension-samples/blob/main/webview-sample/src/extension.ts
	*/
	private clearWebviewResources() {
		while (this.webviewDisposables.length) {
			const x = this.webviewDisposables.pop()
			if (x) {
				x.dispose()
			}
		}
	}

	async dispose() {
		this.log("Disposing ClineProvider...")

		// Clear all tasks from the stack.
		while (this.clineStack.length > 0) {
			await this.removeClineFromStack()
		}

		this.log("Cleared all tasks")

		// Clear all pending edit operations to prevent memory leaks
		this.clearAllPendingEditOperations()
		this.log("Cleared pending operations")

		if (this.view && "dispose" in this.view) {
			this.view.dispose()
			this.log("Disposed webview")
		}

		this.clearWebviewResources()

		// Clean up cloud service event listener
		if (CloudService.hasInstance()) {
			CloudService.instance.off("settings-updated", this.handleCloudSettingsUpdate)
		}

		while (this.disposables.length) {
			const x = this.disposables.pop()

			if (x) {
				x.dispose()
			}
		}

		this._workspaceTracker?.dispose()
		this._workspaceTracker = undefined
		await this.mcpHub?.unregisterClient()
		this.mcpHub = undefined
		await this.skillsManager?.dispose()
		this.skillsManager = undefined
		this.marketplaceManager?.cleanup()
		this.customModesManager?.dispose()
		if (this._liveTaskCoordinator) {
			await this._liveTaskCoordinator.dispose().catch(() => undefined)
			this._liveTaskCoordinator = undefined
		}

		// kilocode_change start - Stop auto-purge scheduler and device auth service
		if (this.autoPurgeScheduler) {
			this.autoPurgeScheduler.stop()
			this.autoPurgeScheduler = undefined
		}
		// kilocode_change end

		this.log("Disposed all disposables")
		ClineProvider.activeInstances.delete(this)

		// Clean up any event listeners attached to this provider
		this.removeAllListeners()

		McpServerManager.unregisterProvider(this)
	}

	public static getVisibleInstance(): ClineProvider | undefined {
		return findLast(Array.from(this.activeInstances), (instance) => instance.view?.visible === true)
	}

	public static async getInstance(): Promise<ClineProvider | undefined> {
		let visibleProvider = ClineProvider.getVisibleInstance()

		// If no visible provider, try to show the sidebar view
		if (!visibleProvider) {
			await vscode.commands.executeCommand(`${Package.name}.SidebarProvider.focus`)
			// Wait briefly for the view to become visible
			await delay(100)
			visibleProvider = ClineProvider.getVisibleInstance()
		}

		// If still no visible provider, return
		if (!visibleProvider) {
			return
		}

		return visibleProvider
	}

	public static async isActiveTask(): Promise<boolean> {
		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return false
		}

		// Check if there is a cline instance in the stack (if this provider has an active task)
		if (visibleProvider.getCurrentTask()) {
			return true
		}

		return false
	}

	public static async handleCodeAction(
		command: CodeActionId,
		promptType: CodeActionName,
		params: Record<string, string | any[]>,
	): Promise<void> {
		// Capture telemetry for code action usage
		TelemetryService.instance.captureCodeActionUsed(promptType)

		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()

		// TODO: Improve type safety for promptType.
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "addToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		await visibleProvider.createTask(prompt)
	}

	public static async handleTerminalAction(
		command: TerminalActionId,
		promptType: TerminalActionPromptType,
		params: Record<string, string | any[]>,
	): Promise<void> {
		TelemetryService.instance.captureCodeActionUsed(promptType)

		const visibleProvider = await ClineProvider.getInstance()

		if (!visibleProvider) {
			return
		}

		const { customSupportPrompts } = await visibleProvider.getState()
		const prompt = supportPrompt.create(promptType, params, customSupportPrompts)

		if (command === "terminalAddToContext") {
			await visibleProvider.postMessageToWebview({
				type: "invoke",
				invoke: "setChatBoxMessage",
				text: `${prompt}\n\n`,
			})
			await visibleProvider.postMessageToWebview({ type: "action", action: "focusInput" })
			return
		}

		try {
			await visibleProvider.createTask(prompt)
		} catch (error) {
			if (error instanceof OrganizationAllowListViolationError) {
				// Errors from terminal commands seem to get swallowed / ignored.
				vscode.window.showErrorMessage(error.message)
			}

			throw error
		}
	}

	async resolveWebviewView(webviewView: vscode.WebviewView | vscode.WebviewPanel) {
		this.view = webviewView

		// kilocode_change start: extract constant inTabMode
		// Set panel reference according to webview type
		const inTabMode = "onDidChangeViewState" in webviewView

		if (inTabMode) {
			setPanel(webviewView, "tab")
		} else if ("onDidChangeVisibility" in webviewView) {
			setPanel(webviewView, "sidebar")
		}
		// kilocode_change end

		// Initialize out-of-scope variables that need to receive persistent
		// global state values.
		this.getState().then(
			({
				terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
				terminalShellIntegrationDisabled = false, // kilocode_change: match product/runtime default
				terminalCompletedTerminalLimitEnabled = true,
				terminalCompletedTerminalLimit = 3,
				terminalCommandDelay = 0,
				terminalZshClearEolMark = true,
				terminalZshOhMy = false,
				terminalZshP10k = false,
				terminalPowershellCounter = false,
				terminalZdotdir = false,
			}) => {
				Terminal.setShellIntegrationTimeout(terminalShellIntegrationTimeout)
				Terminal.setShellIntegrationDisabled(terminalShellIntegrationDisabled)
				TerminalRegistry.setCompletedTerminalLimitEnabled(terminalCompletedTerminalLimitEnabled)
				TerminalRegistry.setCompletedTerminalLimit(terminalCompletedTerminalLimit)
				Terminal.setCommandDelay(terminalCommandDelay)
				Terminal.setTerminalZshClearEolMark(terminalZshClearEolMark)
				Terminal.setTerminalZshOhMy(terminalZshOhMy)
				Terminal.setTerminalZshP10k(terminalZshP10k)
				Terminal.setPowershellCounter(terminalPowershellCounter)
				Terminal.setTerminalZdotdir(terminalZdotdir)
			},
		)

		this.getState().then(({ ttsEnabled }) => {
			setTtsEnabled(ttsEnabled ?? false)
		})

		this.getState().then(({ ttsSpeed }) => {
			setTtsSpeed(ttsSpeed ?? 1)
		})

		// Set up webview options with proper resource roots
		const resourceRoots = [this.contextProxy.extensionUri]

		// Add workspace folders to allow access to workspace files
		if (vscode.workspace.workspaceFolders) {
			resourceRoots.push(...vscode.workspace.workspaceFolders.map((folder) => folder.uri))
		}

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: resourceRoots,
		}

		webviewView.webview.html =
			this.contextProxy.extensionMode === vscode.ExtensionMode.Development
				? await this.getHMRHtmlContent(webviewView.webview)
				: await this.getHtmlContent(webviewView.webview)

		// Sets up an event listener to listen for messages passed from the webview view context
		// and executes code based on the message that is received.
		this.setWebviewMessageListener(webviewView.webview)

		// Initialize code index status subscription for the current workspace.
		this.updateCodeIndexStatusSubscription()

		// Listen for active editor changes to update code index status for the
		// current workspace.
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {
			// Update subscription when workspace might have changed.
			this.updateCodeIndexStatusSubscription()
		})
		this.webviewDisposables.push(activeEditorSubscription)

		// Listen for when the panel becomes visible.
		// https://github.com/microsoft/vscode-discussions/discussions/840
		if ("onDidChangeViewState" in webviewView) {
			// WebviewView and WebviewPanel have all the same properties except
			// for this visibility listener panel.
			const viewStateDisposable = webviewView.onDidChangeViewState(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				}
			})

			this.webviewDisposables.push(viewStateDisposable)
		} else if ("onDidChangeVisibility" in webviewView) {
			// sidebar
			const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
				if (this.view?.visible) {
					this.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				}
			})

			this.webviewDisposables.push(visibilityDisposable)
		}

		// Listen for when the view is disposed
		// This happens when the user closes the view or when the view is closed programmatically
		webviewView.onDidDispose(
			async () => {
				if (inTabMode) {
					this.log("Disposing ClineProvider instance for tab view")
					await this.dispose()
				} else {
					this.log("Clearing webview resources for sidebar view")
					this.clearWebviewResources()
					// Reset current workspace manager reference when view is disposed
					this.codeIndexManager = undefined
				}
			},
			null,
			this.disposables,
		)

		// Listen for when color changes
		const configDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e && e.affectsConfiguration("workbench.colorTheme")) {
				// Sends latest theme name to webview
				await this.postMessageToWebview({ type: "theme", text: JSON.stringify(await getTheme()) })
			}
		})
		this.webviewDisposables.push(configDisposable)

		// If the extension is starting a new session, clear previous task state.
		await this.removeClineFromStack()
	}

	public async createTaskWithHistoryItem(
		historyItem: HistoryItem & { rootTask?: Task; parentTask?: Task },
		options?: { startTask?: boolean; keepRunningTask?: boolean }, // kilocode_change
	) {
		// Check if we're rehydrating the current task to avoid flicker
		const currentTask = this.getCurrentTask()
		const isRehydratingCurrentTask = currentTask && currentTask.taskId === historyItem.id
		let oldTaskForRehydration: Task | undefined
		let stackIndexForRehydration = -1

		if (isRehydratingCurrentTask) {
			stackIndexForRehydration = this.clineStack.length - 1
			oldTaskForRehydration = this.clineStack[stackIndexForRehydration]

			// kilocode_change start
			// Detach the old task before aborting it. abortTask() emits TaskAborted synchronously,
			// and leaving the listener attached can re-enter createTaskWithHistoryItem while a
			// history resend/edit is replacing a still-streaming model response.
			const cleanupFunctions = this.taskEventListeners.get(oldTaskForRehydration)
			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup) => cleanup())
				this.taskEventListeners.delete(oldTaskForRehydration)
			}

			oldTaskForRehydration.abortReason = "user_cancelled"
			oldTaskForRehydration.cancelCurrentRequest()
			if (!oldTaskForRehydration.abort) {
				try {
					await oldTaskForRehydration.abortTask(true)
				} catch (e) {
					this.log(
						`[createTaskWithHistoryItem] abortTask() failed for old task ${oldTaskForRehydration.taskId}.${oldTaskForRehydration.instanceId}: ${e.message}`,
					)
				}
			}
			// kilocode_change end
		} else if (!options?.keepRunningTask) {
			// kilocode_change: parallel conversations keep the running task alive
			await this.removeClineFromStack()
		}

		// If the history item has a saved mode, restore it and its associated API configuration.
		if (historyItem.mode) {
			// Validate that the mode still exists
			const customModes = await this.customModesManager.getCustomModes()
			const modeExists = getModeBySlug(historyItem.mode, customModes) !== undefined

			if (!modeExists) {
				// Mode no longer exists, fall back to default mode.
				this.log(
					`Mode '${historyItem.mode}' from history no longer exists. Falling back to default mode '${defaultModeSlug}'.`,
				)
				historyItem.mode = defaultModeSlug
			}

			await this.updateGlobalState("mode", historyItem.mode)

			// Load the saved API config for the restored mode if it exists.
			// Skip mode-based profile activation if historyItem.apiConfigName exists,
			// since the task's specific provider profile will override it anyway.
			if (!historyItem.apiConfigName) {
				const savedConfigId = await this.providerSettingsManager.getModeConfigId(historyItem.mode)
				const listApiConfig = await this.providerSettingsManager.listConfig()

				// Update listApiConfigMeta first to ensure UI has latest data.
				await this.updateGlobalState("listApiConfigMeta", listApiConfig)

				// If this mode has a saved config, use it.
				if (savedConfigId) {
					const profile = listApiConfig.find(({ id }) => id === savedConfigId)

					if (profile?.name) {
						try {
							// Check if the profile has actual API configuration (not just an id).
							// In CLI mode, the ProviderSettingsManager may return empty default profiles
							// that only contain 'id' and 'name' fields. Activating such a profile would
							// overwrite the CLI's working API configuration with empty settings.
							const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
							const hasActualSettings = !!fullProfile.apiProvider
	
							if (hasActualSettings) {
								// kilocode_change start: per-session profile stickiness
								// Mode-default activation must not persist: at this point the new
								// task is not on the stack yet, so persisting would overwrite the
								// previously focused/restored task's sticky profile (chain pollution
								// when multiple sessions are restored in the background).
								await this.activateProviderProfile(
									{ name: profile.name },
									{ persistModeConfig: false, persistTaskHistory: false },
								)
								// kilocode_change end
							} else {
								// The task will continue with the current/default configuration.
							}
						} catch (error) {
							// Log the error but continue with task restoration.
							this.log(
								`Failed to restore API configuration for mode '${historyItem.mode}': ${
									error instanceof Error ? error.message : String(error)
								}. Continuing with default configuration.`,
							)
							// The task will continue with the current/default configuration.
						}
					}
				}
			}
		}

		// If the history item has a saved API config name (provider profile), restore it.
		// This overrides any mode-based config restoration above, because the task's
		// specific provider profile takes precedence over mode defaults.
		if (historyItem.apiConfigName) {
			const listApiConfig = await this.providerSettingsManager.listConfig()
			// Keep global state/UI in sync with latest profiles for parity with mode restoration above.
			await this.updateGlobalState("listApiConfigMeta", listApiConfig)
			const profile = listApiConfig.find(({ name }) => name === historyItem.apiConfigName)

			if (profile?.name) {
				try {
					await this.activateProviderProfile(
						{ name: profile.name },
						{ persistModeConfig: false, persistTaskHistory: false },
					)
				} catch (error) {
					// Log the error but continue with task restoration.
					this.log(
						`Failed to restore API configuration '${historyItem.apiConfigName}' for task: ${
							error instanceof Error ? error.message : String(error)
						}. Continuing with current configuration.`,
					)
				}
			} else {
				// Profile no longer exists, log warning but continue
				this.log(
					`Provider profile '${historyItem.apiConfigName}' from history no longer exists. Using current configuration.`,
				)
			}
		}

		const {
			apiConfiguration,
			diffEnabled: enableDiff,
			enableCheckpoints,
			checkpointTimeout,
			fuzzyMatchThreshold,
			experiments,
			cloudUserInfo,
			taskSyncEnabled,
		} = await this.getState()

		const shouldStartTask = options?.startTask ?? true
		const task = new Task({
			context: this.context, // kilocode_change
			provider: this,
			apiConfiguration,
			enableDiff,
			enableCheckpoints,
			checkpointTimeout,
			fuzzyMatchThreshold,
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			historyItem,
			experiments,
			rootTask: historyItem.rootTask,
			parentTask: historyItem.parentTask,
			taskNumber: historyItem.number,
			workspacePath: historyItem.workspace,
			onCreated: this.taskCreationCallback,
			// kilocode_change start
			// History restoration must start only after this instance is installed in
			// the stack and listeners are ready. Starting it in the constructor races
			// with cancelled-task continuation consumption below.
			startTask: false,
			// kilocode_change end
			enableBridge: BridgeOrchestrator.isEnabled(cloudUserInfo, taskSyncEnabled),
			// Preserve the status from the history item to avoid overwriting it when the task saves messages
			initialStatus: historyItem.status,
		})

		if (isRehydratingCurrentTask) {
			// Replace the current task in-place to avoid UI flicker
			// kilocode_change start
			const stackIndex = stackIndexForRehydration
			if (stackIndex === -1 || this.clineStack[stackIndex] !== oldTaskForRehydration) {
				this.log(
					`[createTaskWithHistoryItem] Rehydration stack changed before replacement for task ${task.taskId}.${task.instanceId}`,
				)
				this.clineStack[this.clineStack.length - 1] = task
			} else {
				this.clineStack[stackIndex] = task
			}
			// kilocode_change end
			task.emit(RooCodeEventName.TaskFocused)

			// Perform preparation tasks and set up event listeners
			await this.performPreparationTasks(task)

			this.log(
				`[createTaskWithHistoryItem] rehydrated task ${task.taskId}.${task.instanceId} in-place (flicker-free)`,
			)
		} else {
			await this.addClineToStack(task)

			this.log(
				`[createTaskWithHistoryItem] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
			)
		}

		// kilocode_change start
		// A checkpoint edit already persisted a strict UI/API prefix before triggering
		// cancellation. Feed its replacement text directly into the one restoration
		// flow. The former delayed second-pass cleanup raced resumeTaskFromHistory(),
		// allowing a request to be built from the discarded branch.
		const operationId = `task-${task.taskId}`
		const pendingEdit = this.getPendingEditOperation(operationId)
		if (pendingEdit) {
			this.clearPendingEditOperation(operationId)
			this.log(`[createTaskWithHistoryItem] Injecting pending checkpoint edit into history restoration`)
		}

		// Start exactly one restoration flow after stack replacement and listener
		// setup. Consume both payload holders so a stale cancellation continuation
		// cannot survive a checkpoint-edit replacement; the explicit edit wins.
		const liveElsewhere = this.liveTaskCoordinator.isLiveElsewhere(task.taskId)
		if (liveElsewhere) {
			await task.hydratePersistedMessages()
			await this.postStateToWebview()
		} else if (shouldStartTask) {
			const pendingCancelledContinuation = this.consumePendingCancelledTaskContinuation()
			const pendingContinuation = pendingEdit
				? {
						text: pendingEdit.editedContent,
						images: pendingEdit.images,
						options: { kind: "edited_resend" as const },
						createdAt: pendingEdit.createdAt,
					}
				: pendingCancelledContinuation
			try {
				await task.resumeTaskFromHistory(pendingContinuation)
			} catch (error) {
				this.log(`[createTaskWithHistoryItem] Error restoring task history: ${error}`)

				// Any captured human payload must have a live delivery path. A rehydrated
				// task whose restoration failed has no reliable loop, so retaining it would
				// consume the message while leaving the composer stuck on a dead instance.
				if (pendingContinuation) {
					const current = this.getCurrentTask()
					if (current === task) {
						task.abortReason = "streaming_failed"
						task.abandoned = true
						await this.removeClineFromStack()
					}
					try {
						await this.createTask(pendingContinuation.text, pendingContinuation.images)
						await this.postMessageToWebview({ type: "invoke", invoke: "newChat" })
					} catch (fallbackError) {
						this.log(
							`[createTaskWithHistoryItem] Failed to deliver pending human message after restore failure: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
						)
						await this.postStateToWebview()
					}
				} else {
					await this.postStateToWebview()
					vscode.window.showErrorMessage(
						`Failed to restore task history: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
		}
		// kilocode_change end

		return task
	}

	public async postMessageToWebview(message: ExtensionMessage) {
		// NOTE: Changing this? Update effects.ts in the cli too.
		kilo_execIfExtension(() => {
			if (message.type === "apiMessagesSaved" && message.payload) {
				const [taskId, filePath] = message.payload as [string, string]

				SessionManager.init()?.handleFileUpdate(taskId, "apiConversationHistoryPath", filePath)
			} else if (message.type === "taskMessagesSaved" && message.payload) {
				const [taskId, filePath] = message.payload as [string, string]

				SessionManager.init()?.handleFileUpdate(taskId, "uiMessagesPath", filePath)
			} else if (message.type === "taskMetadataSaved" && message.payload) {
				const [taskId, filePath] = message.payload as [string, string]

				SessionManager.init()?.handleFileUpdate(taskId, "taskMetadataPath", filePath)
			} else if (message.type === "currentCheckpointUpdated") {
				SessionManager.init()?.doSync()
			}
		})

		await this.view?.webview.postMessage(message)
	}

	private async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		let localPort = "5173"

		try {
			const fs = require("fs")
			const path = require("path")
			const portFilePath = path.resolve(__dirname, "../../.vite-port")

			if (fs.existsSync(portFilePath)) {
				localPort = fs.readFileSync(portFilePath, "utf8").trim()
				console.log(`[ClineProvider:Vite] Using Vite server port from ${portFilePath}: ${localPort}`)
			} else {
				console.log(
					`[ClineProvider:Vite] Port file not found at ${portFilePath}, using default port: ${localPort}`,
				)
			}
		} catch (err) {
			console.error("[ClineProvider:Vite] Failed to read Vite port file:", err)
		}

		const localServerUrl = `localhost:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`)
		} catch (error) {
			vscode.window.showErrorMessage(t("common:errors.hmr_not_running"))
			return this.getHtmlContent(webview)
		}

		const nonce = getNonce()

		// Get the OpenRouter base URL from configuration
		const { apiConfiguration } = await this.getState()
		const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
		// Extract the domain for CSP
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])

		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"assets",
			"vscode-material-icons",
			"icons",
		])
		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])
		const iconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "icons"]) // kilocode_change
		const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])

		const file = "src/index.tsx"
		const scriptUri = `http://${localServerUrl}/${file}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline' https://* http://${localServerUrl} http://0.0.0.0:${localPort}`,
			`img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data: https://*.googleusercontent.com https://*.googleapis.com https://*.githubusercontent.com`, // kilocode_change: add https://*.googleusercontent.com and https://*.googleapis.com and https://*.githubusercontent.com
			`media-src ${webview.cspSource}`,
			`script-src 'unsafe-eval' ${webview.cspSource} https://* https://*.posthog.com http://${localServerUrl} http://0.0.0.0:${localPort} 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource} ${openRouterDomain} https://* http://localhost:3000 https://*.posthog.com ws://${localServerUrl} ws://0.0.0.0:${localPort} http://${localServerUrl} http://0.0.0.0:${localPort}`, // kilocode_change: add http://localhost:3000
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
						window.ICONS_BASE_URI = "${iconsUri}"
						window.AUDIO_BASE_URI = "${audioUri}"
						window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
						window.KILOCODE_BACKEND_BASE_URL = "${process.env.KILOCODE_BACKEND_BASE_URL ?? ""}"
					</script>
					<title>Kilo Code</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	/**
	 * Defines and returns the HTML that should be rendered within the webview panel.
	 *
	 * @remarks This is also the place where references to the React webview build files
	 * are created and inserted into the webview HTML.
	 *
	 * @param webview A reference to the extension webview
	 * @param extensionUri The URI of the directory containing the extension
	 * @returns A template string literal containing the HTML that should be
	 * rendered within the webview panel
	 */
	private async getHtmlContent(webview: vscode.Webview): Promise<string> {
		// Get the local path to main script run in the webview,
		// then convert it to a uri we can use in the webview.

		// The CSS file from the React build output
		const stylesUri = getUri(webview, this.contextProxy.extensionUri, [
			"webview-ui",
			"build",
			"assets",
			"index.css",
		])

		const scriptUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "build", "assets", "index.js"])
		const codiconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.contextProxy.extensionUri, [
			"assets",
			"vscode-material-icons",
			"icons",
		])
		const imagesUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "images"])
		const iconsUri = getUri(webview, this.contextProxy.extensionUri, ["assets", "icons"]) // kilocode_changes
		const audioUri = getUri(webview, this.contextProxy.extensionUri, ["webview-ui", "audio"])

		// Use a nonce to only allow a specific script to be run.
		/*
		content security policy of your webview to only allow scripts that have a specific nonce
		create a content security policy meta tag so that only loading scripts with a nonce is allowed
		As your extension grows you will likely want to add custom styles, fonts, and/or images to your webview. If you do, you will need to update the content security policy meta tag to explicitly allow for these resources. E.g.
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
		- 'unsafe-inline' is required for styles due to vscode-webview-toolkit's dynamic style injection
		- since we pass base64 images to the webview, we need to specify img-src ${webview.cspSource} data:;

		in meta tag we add nonce attribute: A cryptographic nonce (only used once) to allow scripts. The server must generate a unique nonce value each time it transmits a policy. It is critical to provide a nonce that cannot be guessed as bypassing a resource's policy is otherwise trivial.
		*/
		const nonce = getNonce()

		// Get the OpenRouter base URL from configuration
		const { apiConfiguration } = await this.getState()
		const openRouterBaseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai"
		// Extract the domain for CSP
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"

		// Tip: Install the es6-string-html VS Code extension to enable code highlighting below
		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
			<!-- kilocode_change: add https://*.googleusercontent.com https://*.googleapis.com https://*.githubusercontent.com to img-src, https://*, http://localhost:3000 to connect-src -->
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://*.googleusercontent.com https://storage.googleapis.com https://*.githubusercontent.com https://img.clerk.com data: https://*.googleapis.com; media-src ${webview.cspSource}; script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}' ${openRouterDomain} https://us-assets.i.posthog.com 'strict-dynamic'; connect-src ${webview.cspSource} https://* http://localhost:3000 https://api.requesty.ai https://us.i.posthog.com https://us-assets.i.posthog.com;">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
			<script nonce="${nonce}">
				window.IMAGES_BASE_URI = "${imagesUri}"
				window.ICONS_BASE_URI = "${iconsUri}"
				window.AUDIO_BASE_URI = "${audioUri}"
				window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
				window.KILOCODE_BACKEND_BASE_URL = "${process.env.KILOCODE_BACKEND_BASE_URL ?? ""}"
			</script>
            <title>Kilo Code</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
          </body>
        </html>
      `
	}

	/**
	 * Sets up an event listener to listen for messages passed from the webview context and
	 * executes code based on the message that is received.
	 *
	 * @param webview A reference to the extension webview
	 */
	private setWebviewMessageListener(webview: vscode.Webview) {
		const onReceiveMessage = async (message: WebviewMessage) =>
			webviewMessageHandler(this, message, this.marketplaceManager)

		const messageDisposable = webview.onDidReceiveMessage(onReceiveMessage)
		this.webviewDisposables.push(messageDisposable)
	}

	/* kilocode_change start */
	/**
	 * Handle messages from CLI ExtensionHost
	 * This method allows the CLI to send messages directly to the webviewMessageHandler
	 */
	public async handleCLIMessage(message: WebviewMessage): Promise<void> {
		try {
			await webviewMessageHandler(this, message, this.marketplaceManager)
		} catch (error) {
			this.log(`Error handling CLI message: ${error instanceof Error ? error.message : String(error)}`)
			throw error
		}
	}
	/* kilocode_change end */

	/**
	 * Handle switching to a new mode, including updating the associated API configuration
	 * @param newMode The mode to switch to
	 */
	public async handleModeSwitch(newMode: Mode) {
		const task = this.getCurrentTask()

		if (task) {
			TelemetryService.instance.captureModeSwitch(task.taskId, newMode)
			task.emit(RooCodeEventName.TaskModeSwitched, task.taskId, newMode)

			try {
				// Update the task history with the new mode first.
				const history = this.getGlobalState("taskHistory") ?? []
				const taskHistoryItem = history.find((item) => item.id === task.taskId)

				if (taskHistoryItem) {
					taskHistoryItem.mode = newMode
					await this.updateTaskHistory(taskHistoryItem)
				}

				// Only update the task's mode after successful persistence.
				;(task as any)._taskMode = newMode
			} catch (error) {
				// If persistence fails, log the error but don't update the in-memory state.
				this.log(
					`Failed to persist mode switch for task ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
				)

				// Optionally, we could emit an event to notify about the failure.
				// This ensures the in-memory state remains consistent with persisted state.
				throw error
			}
		}

		await this.updateGlobalState("mode", newMode)

		this.emit(RooCodeEventName.ModeChanged, newMode)

		// Load the saved API config for the new mode if it exists.
		const savedConfigId = await this.providerSettingsManager.getModeConfigId(newMode)
		const listApiConfig = await this.providerSettingsManager.listConfig()

		// Update listApiConfigMeta first to ensure UI has latest data.
		await this.updateGlobalState("listApiConfigMeta", listApiConfig)

		// If this mode has a saved config, use it.
		if (savedConfigId) {
			const profile = listApiConfig.find(({ id }) => id === savedConfigId)

			if (profile?.name) {
				// Check if the profile has actual API configuration (not just an id).
				// In CLI mode, the ProviderSettingsManager may return empty default profiles
				// that only contain 'id' and 'name' fields. Activating such a profile would
				// overwrite the CLI's working API configuration with empty settings.
				// Skip activation if the profile has no apiProvider set - this indicates
				// an unconfigured/empty profile.
				const fullProfile = await this.providerSettingsManager.getProfile({ name: profile.name })
				const hasActualSettings = !!fullProfile.apiProvider

				if (hasActualSettings) {
					await this.activateProviderProfile({ name: profile.name })
				} else {
					// The task will continue with the current/default configuration.
				}
			} else {
				// The task will continue with the current/default configuration.
			}
		} else {
			// If no saved config for this mode, save current config as default.
			const currentApiConfigNameAfter = this.getGlobalState("currentApiConfigName")

			if (currentApiConfigNameAfter) {
				const config = listApiConfig.find((c) => c.name === currentApiConfigNameAfter)

				if (config?.id) {
					await this.providerSettingsManager.setModeConfig(newMode, config.id)
				}
			}
		}

		await this.postStateToWebview()

		// kilocode_change start: Review mode scope selection
		if (newMode === "review") {
			await this.triggerReviewScopeSelection()
		}
		// kilocode_change end
	}

	// Provider Profile Management

	/**
	 * Updates the current task's API handler.
	 * Rebuilds when:
	 * - provider or model changes, OR
	 * - explicitly forced (e.g., user-initiated profile switch/save to apply changed settings like headers/baseUrl/tier).
	 * Always synchronizes task.apiConfiguration with latest provider settings.
	 * @param providerSettings The new provider settings to apply
	 * @param options.forceRebuild Force rebuilding the API handler regardless of provider/model equality
	 */
	private updateTaskApiHandlerIfNeeded(
		providerSettings: ProviderSettings,
		options: { forceRebuild?: boolean } = {},
	): void {
		const task = this.getCurrentTask()
		if (!task) return

		const { forceRebuild = false } = options

		// Determine if we need to rebuild using the previous configuration snapshot
		const prevConfig = task.apiConfiguration
		const prevProvider = prevConfig?.apiProvider
		const prevModelId = prevConfig ? getModelId(prevConfig) : undefined
		const prevToolProtocol = prevConfig?.toolProtocol
		const newProvider = providerSettings.apiProvider
		const newModelId = getModelId(providerSettings)
		const newToolProtocol = providerSettings.toolProtocol

		const needsRebuild =
			forceRebuild ||
			prevProvider !== newProvider ||
			prevModelId !== newModelId ||
			prevToolProtocol !== newToolProtocol

		if (needsRebuild) {
			// Use updateApiConfiguration which handles both API handler rebuild and parser sync.
			// This is important when toolProtocol changes - the assistantMessageParser needs to be
			// created/destroyed to match the new protocol (XML vs native).
			// Note: updateApiConfiguration is declared async but has no actual async operations,
			// so we can safely call it without awaiting.
			task.updateApiConfiguration(providerSettings)
		} else {
			// No rebuild needed, just sync apiConfiguration
			;(task as any).apiConfiguration = providerSettings
		}
	}

	getProviderProfileEntries(): ProviderSettingsEntry[] {
		return this.contextProxy.getValues().listApiConfigMeta || []
	}

	getProviderProfileEntry(name: string): ProviderSettingsEntry | undefined {
		return this.getProviderProfileEntries().find((profile) => profile.name === name)
	}

	public hasProviderProfileEntry(name: string): boolean {
		return !!this.getProviderProfileEntry(name)
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		try {
			// TODO: Do we need to be calling `activateProfile`? It's not
			// clear to me what the source of truth should be; in some cases
			// we rely on the `ContextProxy`'s data store and in other cases
			// we rely on the `ProviderSettingsManager`'s data store. It might
			// be simpler to unify these two.
			const id = await this.providerSettingsManager.saveConfig(name, providerSettings)

			if (activate) {
				const { mode } = await this.getState()

				// These promises do the following:
				// 1. Adds or updates the list of provider profiles.
				// 2. Sets the current provider profile.
				// 3. Sets the current mode's provider profile.
				// 4. Copies the provider settings to the context.
				//
				// Note: 1, 2, and 4 can be done in one `ContextProxy` call:
				// this.contextProxy.setValues({ ...providerSettings, listApiConfigMeta: ..., currentApiConfigName: ... })
				// We should probably switch to that and verify that it works.
				// I left the original implementation in just to be safe.
				await Promise.all([
					this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
					this.updateGlobalState("currentApiConfigName", name),
					this.providerSettingsManager.setModeConfig(mode, id),
					this.contextProxy.setProviderSettings(providerSettings),
				])

				// kilocode_change start
				// Route every live-task client update through Task.updateApiConfiguration.
				// Direct assignment here used to replace credentials underneath an active
				// stream before the request-boundary deferral could protect it.
				await TelemetryService.instance.updateIdentity(providerSettings.kilocodeToken ?? "")

				this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })
				// kilocode_change end

				// Keep the current task's sticky provider profile in sync with the newly-activated profile.
				await this.persistStickyProviderProfileToCurrentTask(name)
			} else {
				// kilocode_change start
				// A non-activating upsert can still target the *currently active* profile
				// (e.g. manage_provider_profile set_reasoning / update). The webview and
				// running tasks read settings from contextProxy, so without syncing here
				// the bottom reasoning-effort selector kept showing the stale value and
				// the next request never picked up the change.
				const currentName = this.contextProxy.getValue("currentApiConfigName")
				if (currentName === name) {
					await this.contextProxy.setProviderSettings(providerSettings)
					// Keep any live task's API handler aware the profile contents changed
					// (reasoning effort etc. are read from state at request-build time).
					this.updateTaskApiHandlerIfNeeded(providerSettings, {})
				}
				// kilocode_change end
				await this.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig())
			}

			await this.postStateToWebview()
			return id
		} catch (error) {
			this.log(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			vscode.window.showErrorMessage(t("common:errors.create_api_config"))
			return undefined
		}
	}

	async deleteProviderProfile(profileToDelete: ProviderSettingsEntry) {
		const globalSettings = this.contextProxy.getValues()
		let profileToActivate: string | undefined = globalSettings.currentApiConfigName

		if (profileToDelete.name === profileToActivate) {
			profileToActivate = this.getProviderProfileEntries().find(({ name }) => name !== profileToDelete.name)?.name
		}

		if (!profileToActivate) {
			throw new Error("You cannot delete the last profile")
		}

		const entries = this.getProviderProfileEntries().filter(({ name }) => name !== profileToDelete.name)

		await this.contextProxy.setValues({
			...globalSettings,
			currentApiConfigName: profileToActivate,
			listApiConfigMeta: entries,
		})

		await this.postStateToWebview()
	}

	private async persistStickyProviderProfileToCurrentTask(apiConfigName: string): Promise<void> {
		const task = this.getCurrentTask()
		if (!task) {
			return
		}

		try {
			// Update in-memory state immediately so sticky behavior works even before the task has
			// been persisted into taskHistory (it will be captured on the next save).
			task.setTaskApiConfigName(apiConfigName)

			const history = this.getGlobalState("taskHistory") ?? []
			const taskHistoryItem = history.find((item) => item.id === task.taskId)

			if (taskHistoryItem) {
				await this.updateTaskHistory({ ...taskHistoryItem, apiConfigName })
			}
		} catch (error) {
			// If persistence fails, log the error but don't fail the profile switch.
			this.log(
				`Failed to persist provider profile switch for task ${task.taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	/**
	 * Validate a provider profile against the live task before committing it.
	 * The current profile remains untouched until both checks pass.
	 */
	async switchProviderProfileWithPreflight(
		name: string,
		task: Task,
		modelId?: string,
	): Promise<{ ok: true; modelId: string } | { ok: false; reason: string }> {
		try {
			const profile = await this.providerSettingsManager.getProfile({ name })
			const { name: _name, id: _id, ...storedProviderSettings } = profile
			if (!storedProviderSettings.apiProvider) {
				return { ok: false, reason: `Provider profile "${name}" is not configured.` }
			}

			const providerSettings: ProviderSettings = { ...storedProviderSettings }
			if (modelId) {
				const existingModelKey = modelIdKeys.find((key) => key in providerSettings)
				const providerModelKey = isTypicalProvider(providerSettings.apiProvider)
					? modelIdKeysByProvider[providerSettings.apiProvider]
					: providerSettings.apiProvider === "openai" || providerSettings.apiProvider === "openai-responses"
						? "openAiModelId"
						: undefined
				const modelKey = existingModelKey ?? providerModelKey
				if (!modelKey) {
					return {
						ok: false,
						reason: `Provider profile "${name}" does not support direct model selection.`,
					}
				}
				providerSettings[modelKey] = modelId
			}

			const candidate = buildApiHandler(providerSettings)
			const candidateModel = candidate.getModel()
			const targetContextWindow = candidateModel.info.contextWindow
			const currentContextTokens = task.getTokenUsage().contextTokens ?? 0
			if (!Number.isFinite(targetContextWindow) || targetContextWindow <= 0) {
				return { ok: false, reason: `Model "${candidateModel.id}" did not report a valid context window.` }
			}
			if (currentContextTokens >= targetContextWindow) {
				return {
					ok: false,
					reason: `Current context (${currentContextTokens} tokens) exceeds model "${candidateModel.id}" context window (${targetContextWindow} tokens).`,
				}
			}

			const probeStream = candidate.createMessage(
				"Respond with one short confirmation.",
				[{ role: "user", content: "Connectivity probe. Reply with OK." }],
				{ taskId: task.taskId, store: false, suppressPreviousResponseId: true },
			)
			const iterator = probeStream[Symbol.asyncIterator]()
			const firstChunk = await iterator.next()
			if (firstChunk.done || firstChunk.value?.type === "error") {
				return { ok: false, reason: `Model "${candidateModel.id}" did not return a valid response.` }
			}
			await iterator.return?.(undefined)

			if (modelId) {
				await this.providerSettingsManager.saveConfig(name, providerSettings)
			}
			await this.activateProviderProfile({ name })
			return { ok: true, modelId: candidateModel.id }
		} catch (error) {
			return {
				ok: false,
				reason: `Provider preflight failed: ${error instanceof Error ? error.message : String(error)}`,
			}
		}
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	) {
		// kilocode_change start: capture the focused task BEFORE any await.
		// New-conversation creation or focus switches can land mid-activation;
		// without this capture the sticky write below would attribute the
		// newly activated profile to the WRONG (previous) conversation.
		const focusedTaskAtEntry = this.getCurrentTask()
		// kilocode_change end
		const { name, id, ...providerSettings } = await this.providerSettingsManager.activateProfile(args)

		const persistModeConfig = options?.persistModeConfig ?? true
		const persistTaskHistory = options?.persistTaskHistory ?? true

		// See `upsertProviderProfile` for a description of what this is doing.
		await Promise.all([
			this.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
			this.contextProxy.setValue("currentApiConfigName", name),
			this.contextProxy.setProviderSettings(providerSettings),
		])

		const { mode } = await this.getState()

		if (id && persistModeConfig) {
			await this.providerSettingsManager.setModeConfig(mode, id)
		}

		// kilocode_change start: verify focus did not drift across the awaits.
		// Only mutate the handler of the task that was focused when the user
		// initiated the switch; a conversation created meanwhile gets its own
		// configuration from task creation, not from this stale activation.
		const focusedTaskNow = this.getCurrentTask()
		if (focusedTaskNow === focusedTaskAtEntry) {
			// Change the provider for the current task.
			this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

			// Update the current task's sticky provider profile, unless this activation is
			// being used purely as a non-persisting restoration (e.g., reopening a task from history).
			if (persistTaskHistory) {
				await this.persistStickyProviderProfileToCurrentTask(name)
			}
		}
		// kilocode_change end

		await this.postStateToWebview()
		await TelemetryService.instance.updateIdentity(providerSettings.kilocodeToken ?? "") // kilocode_change

		if (providerSettings.apiProvider) {
			this.emit(RooCodeEventName.ProviderProfileChanged, { name, provider: providerSettings.apiProvider })
		}
	}

	async updateCustomInstructions(instructions?: string) {
		// User may be clearing the field.
		await this.updateGlobalState("customInstructions", instructions || undefined)
		await this.postStateToWebview()
	}

	// MCP

	async ensureMcpServersDirectoryExists(): Promise<string> {
		// Get platform-specific application data directory
		let mcpServersDir: string
		if (process.platform === "win32") {
			// Windows: %APPDATA%\Kilo-Code\MCP
			mcpServersDir = path.join(os.homedir(), "AppData", "Roaming", "Kilo-Code", "MCP")
		} else if (process.platform === "darwin") {
			// macOS: ~/Documents/Kilo-Code/MCP
			mcpServersDir = path.join(os.homedir(), "Documents", "Kilo-Code", "MCP")
		} else {
			// Linux: ~/.local/share/Kilo-Code/MCP
			mcpServersDir = path.join(os.homedir(), ".local", "share", "Kilo-Code", "MCP")
		}

		try {
			await fs.mkdir(mcpServersDir, { recursive: true })
		} catch (error) {
			// Fallback to a relative path if directory creation fails
			return path.join(os.homedir(), ".kilocode", "mcp")
		}
		return mcpServersDir
	}

	async ensureSettingsDirectoryExists(): Promise<string> {
		const { getSettingsDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		return getSettingsDirectoryPath(globalStoragePath)
	}

	// OpenRouter

	async handleOpenRouterCallback(code: string) {
		let { apiConfiguration, currentApiConfigName = "default" } = await this.getState()

		let apiKey: string

		try {
			const baseUrl = apiConfiguration.openRouterBaseUrl || "https://openrouter.ai/api/v1"
			// Extract the base domain for the auth endpoint.
			const baseUrlDomain = baseUrl.match(/^(https?:\/\/[^\/]+)/)?.[1] || "https://openrouter.ai"
			const response = await axios.post(`${baseUrlDomain}/api/v1/auth/keys`, { code })

			if (response.data && response.data.key) {
				apiKey = response.data.key
			} else {
				throw new Error("Invalid response from OpenRouter API")
			}
		} catch (error) {
			this.log(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			throw error
		}

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "openrouter",
			openRouterApiKey: apiKey,
			openRouterModelId: apiConfiguration?.openRouterModelId || openRouterDefaultModelId,
		}

		await this.upsertProviderProfile(currentApiConfigName, newConfiguration)
	}

	// kilocode_change: Glama

	async handleGlamaCallback(code: string) {
		let apiKey: string

		try {
			const response = await axios.post("https://glama.ai/api/gateway/v1/auth/exchange-code", { code })

			if (response.data && response.data.apiKey) {
				apiKey = response.data.apiKey
			} else {
				throw new Error("Invalid response from Glama API")
			}
		} catch (error) {
			this.log(
				`Error exchanging code for API key: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			throw error
		}

		const { apiConfiguration, currentApiConfigName = "default" } = await this.getState()

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "glama",
			glamaApiKey: apiKey,
			glamaModelId: apiConfiguration?.glamaModelId || glamaDefaultModelId,
		}

		await this.upsertProviderProfile(currentApiConfigName, newConfiguration)
	}
	// kilocode_change end

	// Requesty

	async handleRequestyCallback(code: string, baseUrl: string | null) {
		let { apiConfiguration } = await this.getState()

		const newConfiguration: ProviderSettings = {
			...apiConfiguration,
			apiProvider: "requesty",
			requestyApiKey: code,
			requestyModelId: apiConfiguration?.requestyModelId || requestyDefaultModelId,
		}

		// set baseUrl as undefined if we don't provide one
		// or if it is the default requesty url
		if (!baseUrl || baseUrl === REQUESTY_BASE_URL) {
			newConfiguration.requestyBaseUrl = undefined
		} else {
			newConfiguration.requestyBaseUrl = baseUrl
		}

		const profileName = `Requesty (${new Date().toLocaleString()})`
		await this.upsertProviderProfile(profileName, newConfiguration)
	}

	// kilocode_change start
	async handleKiloCodeCallback(token: string) {
		const kilocode: ProviderName = "kilocode"
		let { apiConfiguration, currentApiConfigName = "default" } = await this.getState()

		await this.upsertProviderProfile(currentApiConfigName, {
			...apiConfiguration,
			apiProvider: "kilocode",
			kilocodeToken: token,
		})

		vscode.window.showInformationMessage("Kilo Code successfully configured!")

		if (this.getCurrentTask()) {
			this.getCurrentTask()!.api = buildApiHandler({
				apiProvider: kilocode,
				kilocodeToken: token,
			})
		}
	}
	// kilocode_change end

	// kilocode_change start - Device Auth Flow
	async startDeviceAuth() {
		if (!this.deviceAuthHandler) {
			this.deviceAuthHandler = new DeviceAuthHandler({
				postMessageToWebview: (msg) => this.postMessageToWebview(msg),
				log: (msg) => this.log(msg),
				showInformationMessage: (msg) => vscode.window.showInformationMessage(msg),
			})
		}
		await this.deviceAuthHandler.startDeviceAuth()
	}

	cancelDeviceAuth() {
		this.deviceAuthHandler?.cancelDeviceAuth()
	}
	// kilocode_change end

	// Task history

	async getTaskWithId(
		id: string,
		kilo_withMessage = true, // kilocode_change session manager uses this method in the background
	): Promise<{
		historyItem: HistoryItem
		taskDirPath: string
		apiConversationHistoryFilePath: string
		uiMessagesFilePath: string
		apiConversationHistory: Anthropic.MessageParam[]
	}> {
		const history = this.getGlobalState("taskHistory") ?? []
		const historyItem = history.find((item) => item.id === id)

		if (historyItem) {
			const { getTaskDirectoryPath } = await import("../../utils/storage")
			const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
			const taskDirPath = await getTaskDirectoryPath(globalStoragePath, id)
			const apiConversationHistoryFilePath = path.join(taskDirPath, GlobalFileNames.apiConversationHistory)
			const uiMessagesFilePath = path.join(taskDirPath, GlobalFileNames.uiMessages)
			const fileExists = await fileExistsAtPath(apiConversationHistoryFilePath)

			if (fileExists) {
				const apiConversationHistory = JSON.parse(await fs.readFile(apiConversationHistoryFilePath, "utf8"))

				return {
					historyItem,
					taskDirPath,
					apiConversationHistoryFilePath,
					uiMessagesFilePath,
					apiConversationHistory,
				}
			} else {
				// kilocode_change start
				// Missing persistence can occur while a newly-created task is still being
				// written or after an interrupted write. Keep this an internal diagnostic:
				// callers such as cancelTask must remain usable as recovery paths and must
				// never expose storage paths as a red user-facing error.
				if (kilo_withMessage) {
					this.log(`Task persistence missing for task ${id}: ${apiConversationHistoryFilePath}`)
				}
				// kilocode_change end
			}
		} else {
			// kilocode_change start
			if (kilo_withMessage) {
				this.log(`Task ${id} is not present in task history`)
			}
			// kilocode_change end
		}

		// if we tried to get a task that doesn't exist, remove it from state
		// FIXME: this seems to happen sometimes when the json file doesnt save to disk for some reason
		// kilocode_change start
		// commented out deleting the task, because in the previous version we made this task red
		// instead of deleting, and people were confused because the task was actually working fine
		// which leads us to believe that this is triggered to often somehow, or that the task will turn up later
		// via some sync ( context https://github.com/Kilo-Org/kilocode/pull/4880 )
		// await this.deleteTaskFromState(id)
		// kilocode_change end
		throw new Error("Task not found")
	}

	async getTaskWithAggregatedCosts(taskId: string): Promise<{
		historyItem: HistoryItem
		aggregatedCosts: AggregatedCosts
	}> {
		const { historyItem } = await this.getTaskWithId(taskId)

		const aggregatedCosts = await aggregateTaskCostsRecursive(taskId, async (id: string) => {
			const result = await this.getTaskWithId(id)
			return result.historyItem
		})

		return { historyItem, aggregatedCosts }
	}

	async showTaskWithId(id: string) {
		// Switch the chat tab immediately so a history click does not appear to
		// no-op while the task is focused in the background.
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		// kilocode_change start: never let rail registration depend on history
		// load success. A torn api_conversation_history.json used to throw in
		// getTaskWithId BEFORE ensureTaskConversation ran, so the conversation
		// never appeared in the left folder rail.
		let taskTitle: string | undefined
		let taskWorkspace: string | undefined
		try {
			const { historyItem } = await this.getTaskWithId(id)
			taskTitle = historyItem.task?.slice(0, 60)
			taskWorkspace = historyItem.workspace
		} catch (historyError) {
			this.log(
				`Failed to load history for task ${id} while opening from history: ${
					historyError instanceof Error ? historyError.message : String(historyError)
				}`,
			)
		}
		await this.parallelManager.ensureTaskConversation({
			sessionId: id,
			title: taskTitle,
			// Fall back to the current cwd when the history item carries no
			// usable workspace so the conversation groups under a real folder
			// instead of a ghost path.
			workspacePath: taskWorkspace || this.cwd,
		})
		// kilocode_change end
		if (id !== this.getCurrentTask()?.taskId) {
			// Keep any already-running conversation alive; history opens in parallel.
			await this.focusTask(id)
		} else {
			await this.parallelManager.setActiveConversation(
				this.parallelManager.conversationForSession(id)?.id,
			)
			await this.postStateToWebview()
		}
		await this.parallelManager.broadcast()
	}

	async exportTaskWithId(id: string) {
		const { historyItem, apiConversationHistory } = await this.getTaskWithId(id)
		await downloadTask(historyItem.ts, apiConversationHistory)
	}

	/* Condenses a task's message history to use fewer tokens. */
	async condenseTaskContext(taskId: string) {
		let task: Task | undefined
		for (let i = this.clineStack.length - 1; i >= 0; i--) {
			if (this.clineStack[i].taskId === taskId) {
				task = this.clineStack[i]
				break
			}
		}
		if (!task) {
			throw new Error(`Task with id ${taskId} not found in stack`)
		}

		try {
			await task.condenseContext()
		} catch (error) {
			console.error(`[ClineProvider] Failed to condense task context for ${taskId}:`, error)
			await this.postStateToWebview()
		} finally {
			await this.postMessageToWebview({ type: "condenseTaskContextResponse", text: taskId })
		}
	}

	// this function deletes a task from task hidtory, and deletes it's checkpoints and delete the task folder
	async deleteTaskWithId(id: string) {
		try {
			// get the task directory full path
			const { taskDirPath } = await this.getTaskWithId(id)

			// remove task from stack if it's the current task
			if (id === this.getCurrentTask()?.taskId) {
				// Close the current task instance; delegation flows will be handled via metadata if applicable.
				await this.removeClineFromStack()
			}

			// delete task from the task history state
			await this.deleteTaskFromState(id)

			// Delete associated shadow repository or branch.
			// TODO: Store `workspaceDir` in the `HistoryItem` object.
			const globalStorageDir = this.contextProxy.globalStorageUri.fsPath
			const workspaceDir = this.cwd

			try {
				await ShadowCheckpointService.deleteTask({ taskId: id, globalStorageDir, workspaceDir })
			} catch (error) {
				console.error(
					`[deleteTaskWithId${id}] failed to delete associated shadow repository or branch: ${error instanceof Error ? error.message : String(error)}`,
				)
			}

			// delete the entire task directory including checkpoints and all content
			try {
				await fs.rm(taskDirPath, { recursive: true, force: true })
				console.log(`[deleteTaskWithId${id}] removed task directory`)
			} catch (error) {
				console.error(
					`[deleteTaskWithId${id}] failed to remove task directory: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		} catch (error) {
			// If task is not found, just remove it from state
			if (error instanceof Error && error.message === "Task not found") {
				await this.deleteTaskFromState(id)
				return
			}
			throw error
		}
	}

	async deleteTaskFromState(id: string) {
		const taskHistory = this.getGlobalState("taskHistory") ?? []
		const updatedTaskHistory = taskHistory.filter((task) => task.id !== id)
		await this.updateGlobalState("taskHistory", updatedTaskHistory)
		this.kiloCodeTaskHistoryVersion++
		this.recentTasksCache = undefined
		try {
			await this.parallelManager.deleteConversationsForSession(id)
		} catch (error) {
			console.error(
				`[deleteTaskFromState ${id}] failed to drop parallel conversation: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
		await this.postStateToWebview()
	}

	async refreshWorkspace() {
		this.currentWorkspacePath = getWorkspacePath()

		await kilo_execIfExtension(() => {
			if (this.currentWorkspacePath) {
				SessionManager.init()?.setWorkspaceDirectory(this.currentWorkspacePath)
			}
		})

		if (this.cwd) {
			await this.parallelManager.registerMainFolder(this.cwd)
			await this.parallelManager.broadcast()
		}

		await this.postStateToWebview()
	}

	async postStateToWebview() {
		const state = await this.getStateToPostToWebview()
		this.postMessageToWebview({ type: "state", state })

		// kilocode_change start: construct manager on startup and restore folders/conversations
		try {
			const manager = this.parallelManager
			void (this._parallelInit ?? Promise.resolve())
				.then(() => manager.broadcast())
				.catch((error) => {
					console.error("[ClineProvider] parallel broadcast failed:", error)
				})
		} catch (error) {
			console.error("[ClineProvider] parallel broadcast failed:", error)
		}
		// kilocode_change end

		// Check MDM compliance and send user to account tab if not compliant
		// Only redirect if there's an actual MDM policy requiring authentication
		if (this.mdmService?.requiresCloudAuth() && !this.checkMdmCompliance()) {
			await this.postMessageToWebview({ type: "action", action: "cloudButtonClicked" })
		}
	}

	// kilocode_change start
	async postRulesDataToWebview() {
		const workspacePath = this.cwd
		if (workspacePath) {
			this.postMessageToWebview({
				type: "rulesData",
				...(await getEnabledRules(workspacePath, this.contextProxy, this.context)),
			})
		}
	}

	async postSkillsDataToWebview() {
		const skills = this.skillsManager?.getAllSkills() ?? []
		this.postMessageToWebview({ type: "skillsData", skills })
	}
	// kilocode_change end

	/**
	 * Fetches marketplace dataon demand to avoid blocking main state updates
	 */
	async fetchMarketplaceData() {
		try {
			const [marketplaceResult, marketplaceInstalledMetadata] = await Promise.all([
				this.marketplaceManager.getMarketplaceItems().catch((error) => {
					console.error("Failed to fetch marketplace items:", error)
					return { organizationMcps: [], marketplaceItems: [], errors: [error.message] }
				}),
				this.marketplaceManager.getInstallationMetadata().catch((error) => {
					console.error("Failed to fetch installation metadata:", error)
					return { project: {}, global: {} } as MarketplaceInstalledMetadata
				}),
			])

			// Send marketplace data separately
			this.postMessageToWebview({
				type: "marketplaceData",
				organizationMcps: marketplaceResult.organizationMcps || [],
				marketplaceItems: marketplaceResult.marketplaceItems || [],
				marketplaceInstalledMetadata: marketplaceInstalledMetadata || { project: {}, global: {} },
				errors: marketplaceResult.errors,
			})
		} catch (error) {
			console.error("Failed to fetch marketplace data:", error)

			// Send empty data on error to prevent UI from hanging
			this.postMessageToWebview({
				type: "marketplaceData",
				organizationMcps: [],
				marketplaceItems: [],
				marketplaceInstalledMetadata: { project: {}, global: {} },
				errors: [error instanceof Error ? error.message : String(error)],
			})

			// Show user-friendly error notification for network issues
			if (error instanceof Error && error.message.includes("timeout")) {
				vscode.window.showWarningMessage(
					"Marketplace data could not be loaded due to network restrictions. Core functionality remains available.",
				)
			}
		}
	}

	/**
	 * Checks if there is a file-based system prompt override for the given mode
	 */
	async hasFileBasedSystemPromptOverride(mode: Mode): Promise<boolean> {
		const promptFilePath = getSystemPromptFilePath(this.cwd, mode)
		return await fileExistsAtPath(promptFilePath)
	}

	/**
	 * Merges allowed commands from global state and workspace configuration
	 * with proper validation and deduplication
	 */
	private mergeAllowedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("allowedCommands", "allowed", globalStateCommands)
	}

	/**
	 * Merges denied commands from global state and workspace configuration
	 * with proper validation and deduplication
	 */
	private mergeDeniedCommands(globalStateCommands?: string[]): string[] {
		return this.mergeCommandLists("deniedCommands", "denied", globalStateCommands)
	}

	/**
	 * Common utility for merging command lists from global state and workspace configuration.
	 * Implements the Command Denylist feature's merging strategy with proper validation.
	 *
	 * @param configKey - VSCode workspace configuration key
	 * @param commandType - Type of commands for error logging
	 * @param globalStateCommands - Commands from global state
	 * @returns Merged and deduplicated command list
	 */
	private mergeCommandLists(
		configKey: "allowedCommands" | "deniedCommands",
		commandType: "allowed" | "denied",
		globalStateCommands?: string[],
	): string[] {
		try {
			// Validate and sanitize global state commands
			const validGlobalCommands = Array.isArray(globalStateCommands)
				? globalStateCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Get workspace configuration commands
			const workspaceCommands = vscode.workspace.getConfiguration(Package.name).get<string[]>(configKey) || []

			// Validate and sanitize workspace commands
			const validWorkspaceCommands = Array.isArray(workspaceCommands)
				? workspaceCommands.filter((cmd) => typeof cmd === "string" && cmd.trim().length > 0)
				: []

			// Combine and deduplicate commands
			// Global state takes precedence over workspace configuration
			const mergedCommands = [...new Set([...validGlobalCommands, ...validWorkspaceCommands])]

			return mergedCommands
		} catch (error) {
			console.error(`Error merging ${commandType} commands:`, error)
			// Return empty array as fallback to prevent crashes
			return []
		}
	}

	async getStateToPostToWebview(): Promise<ExtensionState> {
		const {
			apiConfiguration,
			customInstructions,
			alwaysAllowReadOnly,
			alwaysAllowReadOnlyOutsideWorkspace,
			alwaysAllowWrite,
			alwaysAllowWriteOutsideWorkspace,
			alwaysAllowWriteProtected,
			alwaysAllowDelete, // kilocode_change
			alwaysAllowExecute,
			allowedCommands,
			deniedCommands,
			alwaysAllowBrowser,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowProviderProfileSwitch, // kilocode_change
			alwaysAllowSubtasks,
			allowedMaxRequests,
			allowedMaxCost,
			autoCondenseContext,
			autoCondenseContextPercent,
			soundEnabled,
			ttsEnabled,
			ttsSpeed,
			diffEnabled,
			enableCheckpoints,
			taskProgressFileEnabled,
			checkpointTimeout,
			// taskHistory, // kilocode_change
			soundVolume,
			browserViewportSize,
			screenshotQuality,
			remoteBrowserHost,
			remoteBrowserEnabled,
			cachedChromeHostUrl,
			writeDelayMs,
			terminalOutputLineLimit,
			terminalOutputCharacterLimit,
			terminalCompletedTerminalLimitEnabled,
			terminalCompletedTerminalLimit,
			terminalShellIntegrationTimeout,
			terminalShellIntegrationDisabled,
			terminalCommandDelay,
			terminalPowershellCounter,
			terminalZshClearEolMark,
			terminalZshOhMy,
			terminalZshP10k,
			terminalZdotdir,
			fuzzyMatchThreshold,
			// mcpEnabled,  // kilocode_change: always true
			enableMcpServerCreation,
			requestDelaySeconds,
			currentApiConfigName,
			listApiConfigMeta,
			pinnedApiConfigs,
			mode,
			customModePrompts,
			customSupportPrompts,
			enhancementApiConfigId,
			commitMessageApiConfigId, // kilocode_change
			terminalCommandApiConfigId, // kilocode_change
			autoApprovalEnabled,
			customModes,
			experiments,
			maxOpenTabsContext,
			maxWorkspaceFiles,
			browserToolEnabled,
			telemetrySetting,
			showRooIgnoredFiles,
			enableSubfolderRules,
			language,
			showAutoApproveMenu, // kilocode_change
			showTaskTimeline, // kilocode_change
			sendMessageOnEnter, // kilocode_change
			showTimestamps, // kilocode_change
			hideCostBelowThreshold, // kilocode_change
			maxReadFileLine,
			maxImageFileSize,
			maxTotalImageSize,
			terminalCompressProgressBar,
			historyPreviewCollapsed,
			reasoningBlockCollapsed,
			enterBehavior,
			cloudUserInfo,
			cloudIsAuthenticated,
			sharingEnabled,
			publicSharingEnabled,
			organizationAllowList,
			organizationSettingsVersion,
			maxConcurrentFileReads,
			allowVeryLargeReads, // kilocode_change
			ghostServiceSettings, // kilocode_changes
			condensingApiConfigId,
			customCondensingPrompt,
			codebaseIndexConfig,
			codebaseIndexModels,
			profileThresholds,
			systemNotificationsEnabled, // kilocode_change
			dismissedNotificationIds, // kilocode_change
			morphApiKey, // kilocode_change
			fastApplyModel, // kilocode_change: Fast Apply model selection
			fastApplyApiProvider, // kilocode_change: Fast Apply model api base url
			alwaysAllowFollowupQuestions,
			followupAutoApproveTimeoutMs,
			includeDiagnosticMessages,
			maxDiagnosticMessages,
			includeTaskHistoryInEnhance,
			includeCurrentTime,
			includeCurrentCost,
			maxGitStatusFiles,
			taskSyncEnabled,
			remoteControlEnabled,
			imageGenerationProvider,
			openRouterImageApiKey,
			kiloCodeImageApiKey,
			openRouterImageGenerationSelectedModel,
			featureRoomoteControlEnabled,
			yoloMode, // kilocode_change
			yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
			selectedMicrophoneDevice, // kilocode_change: Selected microphone device for STT
			isBrowserSessionActive,
		} = await this.getState()

		// kilocode_change start: Get active model for virtual quota fallback UI display
		const virtualQuotaActiveModel =
			apiConfiguration?.apiProvider === "virtual-quota-fallback" && this.getCurrentTask()
				? {
						...this.getCurrentTask()!.api.getModel(),
						activeProfileNumber:
							this.getCurrentTask()!.api instanceof VirtualQuotaFallbackHandler
								? (this.getCurrentTask()!.api as VirtualQuotaFallbackHandler).getActiveProfileNumber()
								: undefined,
					}
				: undefined
		// kilocode_change end

		let cloudOrganizations: CloudOrganizationMembership[] = []

		try {
			if (!CloudService.instance.isCloudAgent) {
				const now = Date.now()

				if (
					this.cloudOrganizationsCache !== null &&
					this.cloudOrganizationsCacheTimestamp !== null &&
					now - this.cloudOrganizationsCacheTimestamp < ClineProvider.CLOUD_ORGANIZATIONS_CACHE_DURATION_MS
				) {
					cloudOrganizations = this.cloudOrganizationsCache!
				} else {
					cloudOrganizations = await CloudService.instance.getOrganizationMemberships()
					this.cloudOrganizationsCache = cloudOrganizations
					this.cloudOrganizationsCacheTimestamp = now
				}
			}
		} catch (error) {
			// Ignore this error.
		}

		const telemetryKey = process.env.KILOCODE_POSTHOG_API_KEY
		const machineId = vscode.env.machineId

		const mergedAllowedCommands = this.mergeAllowedCommands(allowedCommands)
		const mergedDeniedCommands = this.mergeDeniedCommands(deniedCommands)
		const cwd = this.cwd

		// Check if there's a system prompt override for the current mode
		const currentMode = mode ?? defaultModeSlug
		const hasSystemPromptOverride = await this.hasFileBasedSystemPromptOverride(currentMode)

		// kilocode_change start wrapper information
		const kiloCodeWrapperProperties = getKiloCodeWrapperProperties()
		const taskHistory = this.getTaskHistory()
		this.kiloCodeTaskHistorySizeForTelemetryOnly = taskHistory.length
		// kilocode_change end

		return {
			version: this.context.extension?.packageJSON?.version ?? "",
			apiConfiguration,
			customInstructions,
			alwaysAllowReadOnly: alwaysAllowReadOnly ?? true,
			alwaysAllowReadOnlyOutsideWorkspace: alwaysAllowReadOnlyOutsideWorkspace ?? true,
			alwaysAllowWrite: alwaysAllowWrite ?? true,
			alwaysAllowWriteOutsideWorkspace: alwaysAllowWriteOutsideWorkspace ?? true,
			alwaysAllowWriteProtected: alwaysAllowWriteProtected ?? true,
			alwaysAllowDelete: alwaysAllowDelete ?? false, // kilocode_change
			alwaysAllowExecute: alwaysAllowExecute ?? true,
			alwaysAllowBrowser: alwaysAllowBrowser ?? false,
			alwaysAllowMcp: alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: alwaysAllowModeSwitch ?? true,
			alwaysAllowProviderProfileSwitch: alwaysAllowProviderProfileSwitch ?? true, // kilocode_change
			alwaysAllowSubtasks: alwaysAllowSubtasks ?? true,
			isBrowserSessionActive,
			yoloMode: yoloMode ?? false, // kilocode_change
			allowedMaxRequests,
			allowedMaxCost,
			autoCondenseContext: autoCondenseContext ?? true,
			autoCondenseContextPercent: autoCondenseContextPercent ?? 100,
			uriScheme: vscode.env.uriScheme,
			uiKind: vscode.UIKind[vscode.env.uiKind], // kilocode_change
			kiloCodeWrapperProperties, // kilocode_change wrapper information
			kilocodeDefaultModel: (
				await getKilocodeDefaultModel(apiConfiguration.kilocodeToken, apiConfiguration.kilocodeOrganizationId)
			).defaultModel,
			currentTaskItem: this.pendingNewConversation
				? undefined
				: this.getFocusedChatTask()?.taskId
					? (taskHistory || []).find((item: HistoryItem) => item.id === this.getFocusedChatTask()?.taskId)
					: undefined,
			clineMessages: this.pendingNewConversation ? [] : this.getFocusedChatTask()?.clineMessages || [],
			currentTaskTodos: this.pendingNewConversation ? [] : this.getFocusedChatTask()?.todoList || [],
			// kilocode_change start
			// Visible message queues are disabled. Do not expose stale queue state to
			// ChatView; user input is routed through direct askResponse/terminal paths.
			messageQueue: [],
			// kilocode_change end
			taskHistoryFullLength: taskHistory.length, // kilocode_change
			taskHistoryVersion: this.kiloCodeTaskHistoryVersion, // kilocode_change
			soundEnabled: soundEnabled ?? false,
			ttsEnabled: ttsEnabled ?? false,
			ttsSpeed: ttsSpeed ?? 1.0,
			diffEnabled: diffEnabled ?? true,
			enableCheckpoints: enableCheckpoints ?? false,
			taskProgressFileEnabled: taskProgressFileEnabled ?? true, // kilocode_change
			checkpointTimeout: checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
			shouldShowAnnouncement: false, // kilocode_change
			allowedCommands: mergedAllowedCommands,
			deniedCommands: mergedDeniedCommands,
			soundVolume: soundVolume ?? 0.5,
			browserViewportSize: browserViewportSize ?? "900x600",
			screenshotQuality: screenshotQuality ?? 75,
			remoteBrowserHost,
			remoteBrowserEnabled: remoteBrowserEnabled ?? false,
			cachedChromeHostUrl: cachedChromeHostUrl,
			writeDelayMs: writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
			terminalOutputLineLimit: terminalOutputLineLimit ?? 500,
			terminalOutputCharacterLimit: terminalOutputCharacterLimit ?? 50000,
			terminalCompletedTerminalLimitEnabled: terminalCompletedTerminalLimitEnabled ?? true,
			terminalCompletedTerminalLimit: terminalCompletedTerminalLimit ?? 3,
			terminalShellIntegrationTimeout: terminalShellIntegrationTimeout ?? 5000,
			terminalShellIntegrationDisabled: terminalShellIntegrationDisabled ?? false,
			terminalCommandDelay: terminalCommandDelay ?? 0,
			terminalPowershellCounter: terminalPowershellCounter ?? false,
			terminalZshClearEolMark: terminalZshClearEolMark ?? true,
			terminalZshOhMy: terminalZshOhMy ?? false,
			terminalZshP10k: terminalZshP10k ?? false,
			terminalZdotdir: terminalZdotdir ?? false,
			fuzzyMatchThreshold: fuzzyMatchThreshold ?? 1.0,
			mcpEnabled: true, // kilocode_change: always true
			enableMcpServerCreation: enableMcpServerCreation ?? true,
			currentApiConfigName: currentApiConfigName ?? "default",
			listApiConfigMeta: listApiConfigMeta ?? [],
			pinnedApiConfigs: pinnedApiConfigs ?? {},
			mode: mode ?? defaultModeSlug,
			customModePrompts: customModePrompts ?? {},
			customSupportPrompts: customSupportPrompts ?? {},
			enhancementApiConfigId,
			commitMessageApiConfigId, // kilocode_change
			terminalCommandApiConfigId, // kilocode_change
			autoApprovalEnabled: autoApprovalEnabled ?? true,
			customModes,
			experiments: experiments ?? experimentDefault,
			mcpServers: this.mcpHub?.getAllServers() ?? [],
			maxOpenTabsContext: maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: maxWorkspaceFiles ?? 200,
			cwd,
			browserToolEnabled: browserToolEnabled ?? false,
			telemetrySetting,
			telemetryKey,
			machineId,
			showRooIgnoredFiles: showRooIgnoredFiles ?? false,
			showAutoApproveMenu: showAutoApproveMenu ?? true, // kilocode_change
			showTaskTimeline: showTaskTimeline ?? true, // kilocode_change
			sendMessageOnEnter: sendMessageOnEnter ?? true, // kilocode_change
			showTimestamps: showTimestamps ?? true, // kilocode_change
			hideCostBelowThreshold, // kilocode_change
			language, // kilocode_change
			enableSubfolderRules: enableSubfolderRules ?? false,
			renderContext: this.renderContext,
			maxReadFileLine: maxReadFileLine ?? 500 /*kilocode_change*/,
			maxImageFileSize: maxImageFileSize ?? 5,
			maxTotalImageSize: maxTotalImageSize ?? 20,
			maxConcurrentFileReads: maxConcurrentFileReads ?? 5,
			allowVeryLargeReads: allowVeryLargeReads ?? false, // kilocode_change
			settingsImportedAt: this.settingsImportedAt,
			terminalCompressProgressBar: terminalCompressProgressBar ?? true,
			hasSystemPromptOverride,
			historyPreviewCollapsed: historyPreviewCollapsed ?? false,
			reasoningBlockCollapsed: reasoningBlockCollapsed ?? true,
			enterBehavior: enterBehavior ?? "send",
			cloudUserInfo,
			cloudIsAuthenticated: cloudIsAuthenticated ?? false,
			cloudAuthSkipModel: this.context.globalState.get<boolean>("roo-auth-skip-model") ?? false,
			cloudOrganizations,
			sharingEnabled: sharingEnabled ?? false,
			publicSharingEnabled: publicSharingEnabled ?? false,
			organizationAllowList,
			// kilocode_change start
			ghostServiceSettings: ghostServiceSettings,
			// kilocode_change end
			organizationSettingsVersion,
			condensingApiConfigId,
			customCondensingPrompt,
			yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
			codebaseIndexModels: codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
			codebaseIndexConfig: {
				codebaseIndexEnabled: codebaseIndexConfig?.codebaseIndexEnabled ?? false,
				codebaseIndexQdrantUrl: codebaseIndexConfig?.codebaseIndexQdrantUrl ?? "http://localhost:6333",
				// kilocode_change start
				codebaseIndexVectorStoreProvider: codebaseIndexConfig?.codebaseIndexVectorStoreProvider ?? "qdrant",
				codebaseIndexLancedbVectorStoreDirectory: codebaseIndexConfig?.codebaseIndexLancedbVectorStoreDirectory,
				// kilocode_change end
				codebaseIndexEmbedderProvider: codebaseIndexConfig?.codebaseIndexEmbedderProvider ?? "openai",
				codebaseIndexEmbedderBaseUrl: codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
				codebaseIndexEmbedderModelId: codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
				codebaseIndexEmbedderModelDimension: codebaseIndexConfig?.codebaseIndexEmbedderModelDimension ?? 1536,
				codebaseIndexOpenAiCompatibleBaseUrl: codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
				codebaseIndexSearchMaxResults: codebaseIndexConfig?.codebaseIndexSearchMaxResults,
				codebaseIndexSearchMinScore: codebaseIndexConfig?.codebaseIndexSearchMinScore,
				// kilocode_change start
				codebaseIndexEmbeddingBatchSize: codebaseIndexConfig?.codebaseIndexEmbeddingBatchSize,
				codebaseIndexScannerMaxBatchRetries: codebaseIndexConfig?.codebaseIndexScannerMaxBatchRetries,
				// kilocode_change end
				codebaseIndexBedrockRegion: codebaseIndexConfig?.codebaseIndexBedrockRegion,
				codebaseIndexBedrockProfile: codebaseIndexConfig?.codebaseIndexBedrockProfile,
				codebaseIndexOpenRouterSpecificProvider: codebaseIndexConfig?.codebaseIndexOpenRouterSpecificProvider,
			},
			// Only set mdmCompliant if there's an actual MDM policy
			// undefined means no MDM policy, true means compliant, false means non-compliant
			mdmCompliant: this.mdmService?.requiresCloudAuth() ? this.checkMdmCompliance() : undefined,
			profileThresholds: profileThresholds ?? {},
			cloudApiUrl: getRooCodeApiUrl(),
			hasOpenedModeSelector: this.getGlobalState("hasOpenedModeSelector") ?? false,
			hasCompletedOnboarding: this.getGlobalState("hasCompletedOnboarding") ?? true, // kilocode_change: fresh installs skip onboarding
			systemNotificationsEnabled: systemNotificationsEnabled ?? false, // kilocode_change
			dismissedNotificationIds: dismissedNotificationIds ?? [], // kilocode_change
			morphApiKey, // kilocode_change
			fastApplyModel: fastApplyModel ?? "auto", // kilocode_change: Fast Apply model selection
			fastApplyApiProvider: fastApplyApiProvider ?? "current", // kilocode_change: Fast Apply model api base url
			alwaysAllowFollowupQuestions: alwaysAllowFollowupQuestions ?? false,
			followupAutoApproveTimeoutMs: followupAutoApproveTimeoutMs ?? 60000,
			includeDiagnosticMessages: includeDiagnosticMessages ?? true,
			maxDiagnosticMessages: maxDiagnosticMessages ?? 50,
			includeTaskHistoryInEnhance: includeTaskHistoryInEnhance ?? true,
			includeCurrentTime: includeCurrentTime ?? true,
			includeCurrentCost: includeCurrentCost ?? true,
			maxGitStatusFiles: maxGitStatusFiles ?? 0,
			taskSyncEnabled,
			remoteControlEnabled,
			imageGenerationProvider,
			openRouterImageApiKey,
			// kilocode_change start - Auto-purge settings
			autoPurgeEnabled: await this.getState().then((s) => s.autoPurgeEnabled),
			autoPurgeDefaultRetentionDays: await this.getState().then((s) => s.autoPurgeDefaultRetentionDays),
			autoPurgeFavoritedTaskRetentionDays: await this.getState().then(
				(s) => s.autoPurgeFavoritedTaskRetentionDays,
			),
			autoPurgeCompletedTaskRetentionDays: await this.getState().then(
				(s) => s.autoPurgeCompletedTaskRetentionDays,
			),
			autoPurgeIncompleteTaskRetentionDays: await this.getState().then(
				(s) => s.autoPurgeIncompleteTaskRetentionDays,
			),
			autoPurgeLastRunTimestamp: await this.getState().then((s) => s.autoPurgeLastRunTimestamp),
			selectedMicrophoneDevice, // kilocode_change: Selected microphone device for STT
			// kilocode_change end
			kiloCodeImageApiKey,
			openRouterImageGenerationSelectedModel,
			featureRoomoteControlEnabled,
			virtualQuotaActiveModel, // kilocode_change: Include virtual quota active model in state
			claudeCodeIsAuthenticated: await (async () => {
				try {
					const { claudeCodeOAuthManager } = await import("../../integrations/claude-code/oauth")
					return await claudeCodeOAuthManager.isAuthenticated()
				} catch {
					return false
				}
			})(),
			openAiCodexIsAuthenticated: await (async () => {
				try {
					const { openAiCodexOAuthManager } = await import("../../integrations/openai-codex/oauth")
					return await openAiCodexOAuthManager.isAuthenticated()
				} catch {
					return false
				}
			})(),
			debug: vscode.workspace.getConfiguration(Package.name).get<boolean>("debug", false),
		}
	}

	/**
	 * Storage
	 * https://dev.to/kompotkot/how-to-use-secretstorage-in-your-vscode-extensions-2hco
	 * https://www.eliostruyf.com/devhack-code-extension-storage-options/
	 */

	async getState(): Promise<
		Omit<
			ExtensionState,
			| "clineMessages"
			| "renderContext"
			| "hasOpenedModeSelector"
			| "hasCompletedOnboarding" // kilocode_change
			| "version"
			| "shouldShowAnnouncement"
			| "hasSystemPromptOverride"
			// kilocode_change start
			| "taskHistoryFullLength"
			| "taskHistoryVersion"
			// kilocode_change end
		>
	> {
		await this.ensureDefaultProviderProfileInActiveState()

		const stateValues = this.contextProxy.getValues()
		const customModes = await this.customModesManager.getCustomModes()

		// Determine apiProvider with the same logic as before.
		const apiProvider: ProviderName = stateValues.apiProvider ? stateValues.apiProvider : "openai" // kilocode_change: default to OpenAI Compatible

		// Build the apiConfiguration object combining state values and secrets.
		const providerSettings = this.contextProxy.getProviderSettings()

		// Ensure apiProvider is set properly if not already in state
		if (!providerSettings.apiProvider) {
			providerSettings.apiProvider = apiProvider
		}

		let organizationAllowList = ORGANIZATION_ALLOW_ALL

		try {
			organizationAllowList = await CloudService.instance.getAllowList()
		} catch (error) {
			console.error(
				`[getState] failed to get organization allow list: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let cloudUserInfo: CloudUserInfo | null = null

		try {
			cloudUserInfo = CloudService.instance.getUserInfo()
		} catch (error) {
			console.error(
				`[getState] failed to get cloud user info: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let cloudIsAuthenticated: boolean = false

		try {
			cloudIsAuthenticated = CloudService.instance.isAuthenticated()
		} catch (error) {
			console.error(
				`[getState] failed to get cloud authentication state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let sharingEnabled: boolean = false

		try {
			sharingEnabled = await CloudService.instance.canShareTask()
		} catch (error) {
			console.error(
				`[getState] failed to get sharing enabled state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let publicSharingEnabled: boolean = false

		try {
			publicSharingEnabled = await CloudService.instance.canSharePublicly()
		} catch (error) {
			console.error(
				`[getState] failed to get public sharing enabled state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let organizationSettingsVersion: number = -1

		try {
			if (CloudService.hasInstance()) {
				const settings = CloudService.instance.getOrganizationSettings()
				organizationSettingsVersion = settings?.version ?? -1
			}
		} catch (error) {
			console.error(
				`[getState] failed to get organization settings version: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		let taskSyncEnabled: boolean = false

		try {
			taskSyncEnabled = CloudService.instance.isTaskSyncEnabled()
		} catch (error) {
			console.error(
				`[getState] failed to get task sync enabled state: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		// Get actual browser session state
		const isBrowserSessionActive = this.getCurrentTask()?.browserSession?.isSessionActive() ?? false

		this.syncRuntimeTerminalSettings(stateValues)

		// Return the same structure as before.
		return {
			apiConfiguration: providerSettings,
			kilocodeDefaultModel: (
				await getKilocodeDefaultModel(providerSettings.kilocodeToken, providerSettings.kilocodeOrganizationId)
			).defaultModel, // kilocode_change
			lastShownAnnouncementId: stateValues.lastShownAnnouncementId,
			customInstructions: stateValues.customInstructions,
			apiModelId: stateValues.apiModelId,
			alwaysAllowReadOnly: stateValues.alwaysAllowReadOnly ?? true,
			alwaysAllowReadOnlyOutsideWorkspace: stateValues.alwaysAllowReadOnlyOutsideWorkspace ?? true,
			alwaysAllowWrite: stateValues.alwaysAllowWrite ?? true,
			alwaysAllowWriteOutsideWorkspace: stateValues.alwaysAllowWriteOutsideWorkspace ?? true,
			alwaysAllowWriteProtected: stateValues.alwaysAllowWriteProtected ?? true,
			alwaysAllowDelete: stateValues.alwaysAllowDelete ?? false, // kilocode_change
			alwaysAllowExecute: stateValues.alwaysAllowExecute ?? true,
			alwaysAllowBrowser: stateValues.alwaysAllowBrowser ?? false,
			alwaysAllowMcp: stateValues.alwaysAllowMcp ?? false,
			alwaysAllowModeSwitch: stateValues.alwaysAllowModeSwitch ?? true,
			alwaysAllowProviderProfileSwitch: stateValues.alwaysAllowProviderProfileSwitch ?? true, // kilocode_change
			alwaysAllowSubtasks: stateValues.alwaysAllowSubtasks ?? true,
			alwaysAllowFollowupQuestions: stateValues.alwaysAllowFollowupQuestions ?? false,
			isBrowserSessionActive,
			yoloMode: stateValues.yoloMode ?? false, // kilocode_change
			followupAutoApproveTimeoutMs: stateValues.followupAutoApproveTimeoutMs ?? 60000,
			diagnosticsEnabled: stateValues.diagnosticsEnabled ?? true,
			allowedMaxRequests: stateValues.allowedMaxRequests,
			allowedMaxCost: stateValues.allowedMaxCost,
			autoCondenseContext: stateValues.autoCondenseContext ?? true,
			autoCondenseContextPercent: stateValues.autoCondenseContextPercent ?? 100,
			// taskHistory: stateValues.taskHistory ?? [], // kilocode_change
			allowedCommands: this.mergeAllowedCommands(stateValues.allowedCommands),
			deniedCommands: this.mergeDeniedCommands(stateValues.deniedCommands),
			soundEnabled: stateValues.soundEnabled ?? false,
			ttsEnabled: stateValues.ttsEnabled ?? false,
			ttsSpeed: stateValues.ttsSpeed ?? 1.0,
			diffEnabled: stateValues.diffEnabled ?? true,
			enableCheckpoints: stateValues.enableCheckpoints ?? false,
			taskProgressFileEnabled: stateValues.taskProgressFileEnabled ?? true, // kilocode_change
			checkpointTimeout: stateValues.checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
			soundVolume: stateValues.soundVolume,
			browserViewportSize: stateValues.browserViewportSize ?? "900x600",
			screenshotQuality: stateValues.screenshotQuality ?? 75,
			remoteBrowserHost: stateValues.remoteBrowserHost,
			remoteBrowserEnabled: stateValues.remoteBrowserEnabled ?? true,
			cachedChromeHostUrl: stateValues.cachedChromeHostUrl as string | undefined,
			fuzzyMatchThreshold: stateValues.fuzzyMatchThreshold ?? 1.0,
			writeDelayMs: stateValues.writeDelayMs ?? DEFAULT_WRITE_DELAY_MS,
			terminalOutputLineLimit: stateValues.terminalOutputLineLimit ?? 500,
			terminalOutputCharacterLimit: stateValues.terminalOutputCharacterLimit ?? 50000,
			terminalCompletedTerminalLimitEnabled: stateValues.terminalCompletedTerminalLimitEnabled ?? true,
			terminalCompletedTerminalLimit: stateValues.terminalCompletedTerminalLimit ?? 3,
			terminalShellIntegrationTimeout: stateValues.terminalShellIntegrationTimeout ?? 5000,
			terminalShellIntegrationDisabled: stateValues.terminalShellIntegrationDisabled ?? false,
			terminalCommandDelay: stateValues.terminalCommandDelay ?? 0,
			terminalPowershellCounter: stateValues.terminalPowershellCounter ?? false,
			terminalZshClearEolMark: stateValues.terminalZshClearEolMark ?? true,
			terminalZshOhMy: stateValues.terminalZshOhMy ?? false,
			terminalZshP10k: stateValues.terminalZshP10k ?? false,
			terminalZdotdir: stateValues.terminalZdotdir ?? false,
			terminalCompressProgressBar: stateValues.terminalCompressProgressBar ?? true,
			mode: stateValues.mode ?? defaultModeSlug,
			language: stateValues.language ?? formatLanguage(vscode.env.language),
			mcpEnabled: true, // kilocode_change: always true
			enableMcpServerCreation: stateValues.enableMcpServerCreation ?? true,
			mcpServers: this.mcpHub?.getAllServers() ?? [],
			currentApiConfigName: stateValues.currentApiConfigName ?? "default",
			listApiConfigMeta: stateValues.listApiConfigMeta ?? [],
			pinnedApiConfigs: stateValues.pinnedApiConfigs ?? {},
			modeApiConfigs: stateValues.modeApiConfigs ?? ({} as Record<Mode, string>),
			customModePrompts: stateValues.customModePrompts ?? {},
			customSupportPrompts: stateValues.customSupportPrompts ?? {},
			enhancementApiConfigId: stateValues.enhancementApiConfigId,
			commitMessageApiConfigId: stateValues.commitMessageApiConfigId, // kilocode_change
			terminalCommandApiConfigId: stateValues.terminalCommandApiConfigId, // kilocode_change
			// kilocode_change start
			ghostServiceSettings: stateValues.ghostServiceSettings,
			// kilocode_change end
			// kilocode_change start - Auto-purge settings
			autoPurgeEnabled: stateValues.autoPurgeEnabled ?? false,
			autoPurgeDefaultRetentionDays: stateValues.autoPurgeDefaultRetentionDays ?? 30,
			autoPurgeFavoritedTaskRetentionDays: stateValues.autoPurgeFavoritedTaskRetentionDays ?? null,
			autoPurgeCompletedTaskRetentionDays: stateValues.autoPurgeCompletedTaskRetentionDays ?? 30,
			autoPurgeIncompleteTaskRetentionDays: stateValues.autoPurgeIncompleteTaskRetentionDays ?? 7,
			autoPurgeLastRunTimestamp: stateValues.autoPurgeLastRunTimestamp,
			selectedMicrophoneDevice: stateValues.selectedMicrophoneDevice, // kilocode_change: Selected microphone device for STT
			// kilocode_change end
			experiments: stateValues.experiments ?? experimentDefault,
			autoApprovalEnabled: stateValues.autoApprovalEnabled ?? true,
			customModes,
			maxOpenTabsContext: stateValues.maxOpenTabsContext ?? 20,
			maxWorkspaceFiles: stateValues.maxWorkspaceFiles ?? 200,
			browserToolEnabled: stateValues.browserToolEnabled ?? false,
			telemetrySetting: getEffectiveTelemetrySetting(stateValues.telemetrySetting), // kilocode_change
			showRooIgnoredFiles: stateValues.showRooIgnoredFiles ?? false,
			showAutoApproveMenu: stateValues.showAutoApproveMenu ?? true, // kilocode_change
			showTaskTimeline: stateValues.showTaskTimeline ?? true, // kilocode_change
			sendMessageOnEnter: stateValues.sendMessageOnEnter ?? true, // kilocode_change
			showTimestamps: stateValues.showTimestamps ?? true, // kilocode_change
			hideCostBelowThreshold: stateValues.hideCostBelowThreshold ?? 0, // kilocode_change
			enableSubfolderRules: stateValues.enableSubfolderRules ?? false,
			maxReadFileLine: stateValues.maxReadFileLine ?? 500 /*kilocode_change*/,
			maxImageFileSize: stateValues.maxImageFileSize ?? 5,
			maxTotalImageSize: stateValues.maxTotalImageSize ?? 20,
			maxConcurrentFileReads: stateValues.maxConcurrentFileReads ?? 5,
			allowVeryLargeReads: stateValues.allowVeryLargeReads ?? false, // kilocode_change
			systemNotificationsEnabled: stateValues.systemNotificationsEnabled ?? true, // kilocode_change
			dismissedNotificationIds: stateValues.dismissedNotificationIds ?? [], // kilocode_change
			morphApiKey: stateValues.morphApiKey, // kilocode_change
			fastApplyModel: stateValues.fastApplyModel ?? "auto", // kilocode_change: Fast Apply model selection
			fastApplyApiProvider: stateValues.fastApplyApiProvider ?? "current", // kilocode_change: Fast Apply model api config id
			historyPreviewCollapsed: stateValues.historyPreviewCollapsed ?? false,
			reasoningBlockCollapsed: stateValues.reasoningBlockCollapsed ?? true,
			enterBehavior: stateValues.enterBehavior ?? "send",
			cloudUserInfo,
			cloudIsAuthenticated,
			sharingEnabled,
			publicSharingEnabled,
			organizationAllowList,
			organizationSettingsVersion,
			condensingApiConfigId: stateValues.condensingApiConfigId,
			customCondensingPrompt: stateValues.customCondensingPrompt,
			yoloGatekeeperApiConfigId: stateValues.yoloGatekeeperApiConfigId, // kilocode_change: AI gatekeeper for YOLO mode
			codebaseIndexModels: stateValues.codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
			codebaseIndexConfig: {
				codebaseIndexEnabled: stateValues.codebaseIndexConfig?.codebaseIndexEnabled ?? false,
				codebaseIndexQdrantUrl:
					stateValues.codebaseIndexConfig?.codebaseIndexQdrantUrl ?? "http://localhost:6333",
				codebaseIndexEmbedderProvider:
					stateValues.codebaseIndexConfig?.codebaseIndexEmbedderProvider ?? "openai",
				// kilocode_change start
				codebaseIndexVectorStoreProvider:
					stateValues.codebaseIndexConfig?.codebaseIndexVectorStoreProvider ?? "qdrant",
				codebaseIndexLancedbVectorStoreDirectory:
					stateValues.codebaseIndexConfig?.codebaseIndexLancedbVectorStoreDirectory,
				// kilocode_change end
				codebaseIndexEmbedderBaseUrl: stateValues.codebaseIndexConfig?.codebaseIndexEmbedderBaseUrl ?? "",
				codebaseIndexEmbedderModelId: stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelId ?? "",
				codebaseIndexEmbedderModelDimension:
					stateValues.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension,
				codebaseIndexOpenAiCompatibleBaseUrl:
					stateValues.codebaseIndexConfig?.codebaseIndexOpenAiCompatibleBaseUrl,
				codebaseIndexSearchMaxResults: stateValues.codebaseIndexConfig?.codebaseIndexSearchMaxResults,
				codebaseIndexSearchMinScore: stateValues.codebaseIndexConfig?.codebaseIndexSearchMinScore,
				// kilocode_change start
				codebaseIndexEmbeddingBatchSize: stateValues.codebaseIndexConfig?.codebaseIndexEmbeddingBatchSize,
				codebaseIndexScannerMaxBatchRetries:
					stateValues.codebaseIndexConfig?.codebaseIndexScannerMaxBatchRetries,
				// kilocode_change end
				codebaseIndexBedrockRegion: stateValues.codebaseIndexConfig?.codebaseIndexBedrockRegion,
				codebaseIndexBedrockProfile: stateValues.codebaseIndexConfig?.codebaseIndexBedrockProfile,
				codebaseIndexOpenRouterSpecificProvider:
					stateValues.codebaseIndexConfig?.codebaseIndexOpenRouterSpecificProvider,
			},
			profileThresholds: stateValues.profileThresholds ?? {},
			includeDiagnosticMessages: stateValues.includeDiagnosticMessages ?? true,
			maxDiagnosticMessages: stateValues.maxDiagnosticMessages ?? 50,
			includeTaskHistoryInEnhance: stateValues.includeTaskHistoryInEnhance ?? true,
			includeCurrentTime: stateValues.includeCurrentTime ?? true,
			includeCurrentCost: stateValues.includeCurrentCost ?? true,
			maxGitStatusFiles: stateValues.maxGitStatusFiles ?? 0,
			taskSyncEnabled,
			remoteControlEnabled: (() => {
				try {
					const cloudSettings = CloudService.instance.getUserSettings()
					return cloudSettings?.settings?.extensionBridgeEnabled ?? false
				} catch (error) {
					console.error(
						`[getState] failed to get remote control setting from cloud: ${error instanceof Error ? error.message : String(error)}`,
					)
					return false
				}
			})(),
			imageGenerationProvider: stateValues.imageGenerationProvider,
			openRouterImageApiKey: stateValues.openRouterImageApiKey,
			kiloCodeImageApiKey: stateValues.kiloCodeImageApiKey,
			openRouterImageGenerationSelectedModel: stateValues.openRouterImageGenerationSelectedModel,
			featureRoomoteControlEnabled: (() => {
				try {
					const userSettings = CloudService.instance.getUserSettings()
					const hasOrganization = cloudUserInfo?.organizationId != null
					return hasOrganization || (userSettings?.features?.roomoteControlEnabled ?? false)
				} catch (error) {
					console.error(
						`[getState] failed to get featureRoomoteControlEnabled: ${error instanceof Error ? error.message : String(error)}`,
					)
					return false
				}
			})(),
			appendSystemPrompt: stateValues.appendSystemPrompt, // kilocode_change: CLI append system prompt
		}
	}

	async updateTaskHistory(item: HistoryItem): Promise<HistoryItem[]> {
		const history = (this.getGlobalState("taskHistory") as HistoryItem[] | undefined) || []
		const existingItemIndex = history.findIndex((h) => h.id === item.id)

		if (existingItemIndex !== -1) {
			// Preserve existing metadata (e.g., delegation fields) unless explicitly overwritten.
			// This prevents loss of status/awaitingChildId/delegatedToId when tasks are reopened,
			// terminated, or when routine message persistence occurs.
			history[existingItemIndex] = {
				...history[existingItemIndex],
				...item,
			}
		} else {
			history.push(item)
		}

		await this.updateGlobalState("taskHistory", history)
		this.kiloCodeTaskHistoryVersion++
		this.recentTasksCache = undefined

		return history
	}

	// ContextProxy

	// @deprecated - Use `ContextProxy#setValue` instead.
	private async updateGlobalState<K extends keyof GlobalState>(key: K, value: GlobalState[K]) {
		await this.contextProxy.setValue(key, value)
	}

	// @deprecated - Use `ContextProxy#getValue` instead.
	private getGlobalState<K extends keyof GlobalState>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public async setValue<K extends keyof RooCodeSettings>(key: K, value: RooCodeSettings[K]) {
		await this.contextProxy.setValue(key, value)
	}

	public getValue<K extends keyof RooCodeSettings>(key: K) {
		return this.contextProxy.getValue(key)
	}

	public getValues() {
		return this.contextProxy.getValues()
	}

	public async setValues(values: RooCodeSettings) {
		await this.contextProxy.setValues(values)
	}

	// dev

	async resetState() {
		const answer = await vscode.window.showInformationMessage(
			t("common:confirmation.reset_state"),
			{ modal: true },
			t("common:answers.yes"),
		)

		if (answer !== t("common:answers.yes")) {
			return
		}

		// Logout from Kilo Code provider before resetting (same approach as ProfileView logout)
		const { apiConfiguration, currentApiConfigName = "default" } = await this.getState()
		if (apiConfiguration.kilocodeToken) {
			await this.upsertProviderProfile(currentApiConfigName, {
				...apiConfiguration,
				kilocodeToken: "",
			})
		}

		await this.contextProxy.resetAllState()
		await this.providerSettingsManager.resetAllConfigs()
		await this.customModesManager.resetCustomModes()

		await this.removeClineFromStack()
		await this.postStateToWebview()
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
	}

	// logging

	public log(message: string) {
		this.outputChannel.appendLine(message)
		console.log(message)
	}

	// getters

	public get workspaceTracker(): WorkspaceTracker | undefined {
		return this._workspaceTracker
	}

	get viewLaunched() {
		return this.isViewLaunched
	}

	get messages() {
		return this.getCurrentTask()?.clineMessages || []
	}

	public getMcpHub(): McpHub | undefined {
		return this.mcpHub
	}

	public getSkillsManager(): SkillsManager | undefined {
		return this.skillsManager
	}

	/**
	 * Check if the current state is compliant with MDM policy
	 * @returns true if compliant or no MDM policy exists, false if MDM policy exists and user is non-compliant
	 */
	public checkMdmCompliance(): boolean {
		if (!this.mdmService) {
			return true // No MDM service, allow operation
		}

		const compliance = this.mdmService.isCompliant()

		if (!compliance.compliant) {
			return false
		}

		return true
	}

	public async remoteControlEnabled(enabled: boolean) {
		if (!enabled) {
			await BridgeOrchestrator.disconnect()
			return
		}

		const userInfo = CloudService.instance.getUserInfo()

		if (!userInfo) {
			this.log("[ClineProvider#remoteControlEnabled] Failed to get user info, disconnecting")
			await BridgeOrchestrator.disconnect()
			return
		}

		const config = await CloudService.instance.cloudAPI?.bridgeConfig().catch(() => undefined)

		if (!config) {
			this.log("[ClineProvider#remoteControlEnabled] Failed to get bridge config")
			return
		}

		await BridgeOrchestrator.connectOrDisconnect(userInfo, enabled, {
			...config,
			provider: this,
			sessionId: vscode.env.sessionId,
			isCloudAgent: CloudService.instance.isCloudAgent,
		})

		const bridge = BridgeOrchestrator.getInstance()

		if (bridge) {
			const currentTask = this.getCurrentTask()

			if (currentTask && !currentTask.enableBridge) {
				try {
					currentTask.enableBridge = true
					await BridgeOrchestrator.subscribeToTask(currentTask)
				} catch (error) {
					const message = `[ClineProvider#remoteControlEnabled] BridgeOrchestrator.subscribeToTask() failed: ${error instanceof Error ? error.message : String(error)}`
					this.log(message)
					console.error(message)
				}
			}
		} else {
			for (const task of this.clineStack) {
				if (task.enableBridge) {
					try {
						await BridgeOrchestrator.getInstance()?.unsubscribeFromTask(task.taskId)
					} catch (error) {
						const message = `[ClineProvider#remoteControlEnabled] BridgeOrchestrator#unsubscribeFromTask() failed: ${error instanceof Error ? error.message : String(error)}`
						this.log(message)
						console.error(message)
					}
				}
			}
		}
	}

	/**
	 * Gets the CodeIndexManager for the current active workspace
	 * @returns CodeIndexManager instance for the current workspace or the default one
	 */
	public getCurrentWorkspaceCodeIndexManager(): CodeIndexManager | undefined {
		return CodeIndexManager.getInstance(this.context)
	}

	/**
	 * Updates the code index status subscription to listen to the current workspace manager
	 */
	private updateCodeIndexStatusSubscription(): void {
		// Get the current workspace manager
		const currentManager = this.getCurrentWorkspaceCodeIndexManager()

		// If the manager hasn't changed, no need to update subscription
		if (currentManager === this.codeIndexManager) {
			return
		}

		// Dispose the old subscription if it exists
		if (this.codeIndexStatusSubscription) {
			this.codeIndexStatusSubscription.dispose()
			this.codeIndexStatusSubscription = undefined
		}

		// Update the current workspace manager reference
		this.codeIndexManager = currentManager

		// Subscribe to the new manager's progress updates if it exists
		if (currentManager) {
			this.codeIndexStatusSubscription = currentManager.onProgressUpdate((update: IndexProgressUpdate) => {
				// Only send updates if this manager is still the current one
				if (currentManager === this.getCurrentWorkspaceCodeIndexManager()) {
					// Get the full status from the manager to ensure we have all fields correctly formatted
					const fullStatus = currentManager.getCurrentStatus()
					this.postMessageToWebview({
						type: "indexingStatusUpdate",
						values: fullStatus,
					})
				}
			})

			if (this.view) {
				this.webviewDisposables.push(this.codeIndexStatusSubscription)
			}

			// Send initial status for the current workspace
			this.postMessageToWebview({
				type: "indexingStatusUpdate",
				values: currentManager.getCurrentStatus(),
			})
		}
	}

	/**
	 * TaskProviderLike, TelemetryPropertiesProvider
	 */

	public getCurrentTask(): Task | undefined {
		if (this.clineStack.length === 0) {
			return undefined
		}

		return this.clineStack[this.clineStack.length - 1]
	}

	/** Chat UI follows the focused/pending conversation, never the stack-top background task. */
	public getFocusedChatTask(): Task | undefined {
		if (this.pendingNewConversation) {
			return undefined
		}
		const focusedId = this.parallelManager?.focusedConversationId
		if (!focusedId) {
			return this.getCurrentTask()
		}
		const sessionId = this.parallelManager.getConversationById(focusedId)?.sessionId
		if (!sessionId) {
			return undefined
		}
		return this.clineStack.find((task) => task.taskId === sessionId || task.subagent?.sessionId === sessionId)
	}

	// kilocode_change start: parallel conversations
	public async focusTask(taskId: string): Promise<void> {
		const index = this.clineStack.findIndex(
			(task) => task.taskId === taskId || task.subagent?.sessionId === taskId,
		)
		if (index === -1) {
			const { historyItem } = await this.getTaskWithId(taskId)
			await this.createTaskWithHistoryItem(historyItem, { keepRunningTask: true })
			const boundAfterCreate = this.parallelManager.conversationForSession(taskId)
			if (boundAfterCreate) {
				await this.parallelManager.setActiveConversation(boundAfterCreate.id)
			}
			// kilocode_change start: per-session profile stickiness
			// A task rebuilt from history adopts its own saved provider profile.
			await this.restoreFocusedTaskProviderProfile()
			// kilocode_change end
			await this.postStateToWebview()
			await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
			await this.parallelManager.broadcast()
			return
		}
		if (index !== this.clineStack.length - 1) {
			const [task] = this.clineStack.splice(index, 1)
			this.clineStack.push(task)
		}
		const bound = this.parallelManager.conversationForSession(taskId)
		if (bound) {
			await this.parallelManager.setActiveConversation(bound.id)
		}
		// kilocode_change start: per-session profile stickiness
		// Re-activate the focused conversation's saved provider profile so
		// switching conversations keeps independent provider configurations.
		await this.restoreFocusedTaskProviderProfile()
		// kilocode_change end
		await this.postStateToWebview()
		await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
		await this.parallelManager.broadcast()
	}

	/**
		* kilocode_change start: per-session profile stickiness
		*
		* Re-activates the focused task's saved provider profile when it differs
		* from the current global one, so each conversation keeps its own provider
		* configuration. Uses the non-persisting restoration path (no mode config
		* or task-history rewrite); only the runtime API handler and UI state
		* follow the focused conversation.
		*/
	private async restoreFocusedTaskProviderProfile(): Promise<void> {
		// kilocode_change start: capture the focused task BEFORE any await.
		// focusTask itself awaits; if focus drifted during those awaits this
		// restoration must not write another conversation's profile.
		const taskAtEntry = this.getCurrentTask()
		if (!taskAtEntry) {
			return
		}
		const savedName = await taskAtEntry.getTaskApiConfigName()
		if (!savedName) {
			return
		}
		// Re-check focus after the await: the user may have switched to a
		// different conversation while the saved name was loading.
		if (this.getCurrentTask() !== taskAtEntry) {
			return
		}
		const { currentApiConfigName } = await this.getState()
		if (savedName === currentApiConfigName) {
			return
		}
		// Re-check focus once more after the second await.
		if (this.getCurrentTask() !== taskAtEntry) {
			return
		}
		const profile = this.getProviderProfileEntry(savedName)
		if (!profile) {
			return
		}
		try {
			await this.activateProviderProfile(
				{ name: savedName },
				{ persistModeConfig: false, persistTaskHistory: false },
			)
		} catch (error) {
			this.log(
				`Failed to restore provider profile '${savedName}' for focused task: ${
					error instanceof Error ? error.message : String(error)
				}. Continuing with current configuration.`,
			)
		}
	}
	// kilocode_change end

	public async forkTaskIntoNewSession(sourceTaskId: string): Promise<HistoryItem> {
		const { historyItem, apiConversationHistoryFilePath, uiMessagesFilePath } =
			await this.getTaskWithId(sourceTaskId)
		const { randomUUID } = await import("crypto")
		const newTaskId = randomUUID()
		const { getTaskDirectoryPath } = await import("../../utils/storage")
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath
		const taskDirPath = await getTaskDirectoryPath(globalStoragePath, newTaskId)
		await fs.mkdir(taskDirPath, { recursive: true })
		const copyOrEmpty = async (source: string, destination: string): Promise<void> => {
			try {
				await fs.copyFile(source, destination)
			} catch {
				await fs.writeFile(destination, "[]")
			}
		}
		await copyOrEmpty(
			apiConversationHistoryFilePath,
			path.join(taskDirPath, GlobalFileNames.apiConversationHistory),
		)
		await copyOrEmpty(uiMessagesFilePath, path.join(taskDirPath, GlobalFileNames.uiMessages))
		const newItem: HistoryItem = {
			...historyItem,
			id: newTaskId,
			ts: Date.now(),
			task: `${historyItem.task ?? ""} (fork)`.trim(),
		}
		await this.updateTaskHistory(newItem)
		return newItem
	}
	// kilocode_change end

	public getRecentTasks(): string[] {
		if (this.recentTasksCache) {
			return this.recentTasksCache
		}

		const history = this.getGlobalState("taskHistory") ?? []
		const workspaceTasks: HistoryItem[] = []

		for (const item of history) {
			if (!item.ts || !item.task || item.workspace !== this.cwd) {
				continue
			}

			workspaceTasks.push(item)
		}

		if (workspaceTasks.length === 0) {
			this.recentTasksCache = []
			return this.recentTasksCache
		}

		workspaceTasks.sort((a, b) => b.ts - a.ts)
		let recentTaskIds: string[] = []

		if (workspaceTasks.length >= 100) {
			// If we have at least 100 tasks, return tasks from the last 7 days.
			const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

			for (const item of workspaceTasks) {
				// Stop when we hit tasks older than 7 days.
				if (item.ts < sevenDaysAgo) {
					break
				}

				recentTaskIds.push(item.id)
			}
		} else {
			// Otherwise, return the most recent 100 tasks (or all if less than 100).
			recentTaskIds = workspaceTasks.slice(0, Math.min(100, workspaceTasks.length)).map((item) => item.id)
		}

		this.recentTasksCache = recentTaskIds
		return this.recentTasksCache
	}

	// When initializing a new task, (not from history but from a tool command
	// new_task) there is no need to remove the previous task since the new
	// task is a subtask of the previous one, and when it finishes it is removed
	// from the stack and the caller is resumed in this way we can have a chain
	// of tasks, each one being a sub task of the previous one until the main
	// task is finished.
	public async createTask(
		text?: string,
		images?: string[],
		parentTask?: Task,
		options: CreateTaskOptions = {},
		configuration: RooCodeSettings = {},
	): Promise<Task> {
		if (configuration) {
			await this.setValues(configuration)

			if (configuration.allowedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("allowedCommands", configuration.allowedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.deniedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("deniedCommands", configuration.deniedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.commandExecutionTimeout !== undefined) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update(
						"commandExecutionTimeout",
						configuration.commandExecutionTimeout,
						vscode.ConfigurationTarget.Global,
					)
			}

			if (configuration.currentApiConfigName) {
				await this.setProviderProfile(configuration.currentApiConfigName)
			}
		}

		const {
			apiConfiguration,
			organizationAllowList,
			diffEnabled: enableDiff,
			enableCheckpoints,
			checkpointTimeout,
			fuzzyMatchThreshold,
			experiments,
			cloudUserInfo,
			remoteControlEnabled,
		} = await this.getState()

		// kilocode_change start
		// The fresh-install OpenAI-compatible profile contains model metadata for the
		// settings UI, but it is deliberately not callable until an endpoint or key is
		// supplied. Guard again at the backend boundary so a hydration/UI race cannot
		// create a half-persisted Task that retries forever and later breaks cancel.
		if (
			apiConfiguration.apiProvider === "openai" &&
			!apiConfiguration.openAiBaseUrl?.trim() &&
			!apiConfiguration.openAiApiKey?.trim()
		) {
			throw new Error(
				"OpenAI Compatible is not configured. Add an API key or custom endpoint in Provider settings.",
			)
		}
		// kilocode_change end

		// Single-open-task invariant: always enforce for user-initiated top-level tasks
		if (!parentTask && !options.keepRunningTask) {
			// kilocode_change: parallel conversations keep the previous task running
			try {
				await this.removeClineFromStack()
			} catch {
				// Non-fatal
			}
		}

		if (!ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList)) {
			throw new OrganizationAllowListViolationError(t("common:errors.violated_organization_allowlist"))
		}

		// kilocode_change start
		// A Task constructor cannot safely fire-and-forget startTask(): an early
		// persistence, prompt, or provider failure would leave a half-created task
		// in the stack while the webview stays busy forever. Keep the long-running
		// loop asynchronous, but make its rejection an owned provider transaction.
		const [task, taskStartup] = Task.create({
			provider: this,
			context: this.context,
			apiConfiguration,
			enableDiff,
			enableCheckpoints,
			checkpointTimeout,
			fuzzyMatchThreshold,
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			task: text,
			images,
			experiments,
			rootTask: this.clineStack.length > 0 ? this.clineStack[0] : undefined,
			parentTask,
			taskNumber: this.clineStack.length + 1,
			onCreated: this.taskCreationCallback,
			enableBridge: BridgeOrchestrator.isEnabled(cloudUserInfo, remoteControlEnabled),
			initialTodos: options.initialTodos,
			...options,
		})

		let finishRegistration!: () => void
		const registrationFinished = new Promise<void>((resolve) => {
			finishRegistration = resolve
		})
		let rolledBack = false
		const rollbackFailedStartup = async (error: unknown) => {
			await registrationFinished
			const message = error instanceof Error ? error.message : String(error)
			this.log(`[DEEPTASK_STARTUP_TRANSACTION_V1] task ${task.taskId}.${task.instanceId} failed: ${message}`)

			// A newer continuation or task must never be removed by an older loop's
			// delayed rejection. Roll back only the exact instance that owns it.
			if (rolledBack || this.getCurrentTask() !== task) {
				return
			}

			rolledBack = true
			task.abortReason = "streaming_failed"
			task.abandoned = true
			task.cancelCurrentRequest()
			await this.removeClineFromStack()
			await this.postStateToWebview()
			await this.postMessageToWebview({ type: "invoke", invoke: "newChat" })
			vscode.window.showErrorMessage(`Task failed to start: ${message}`)
		}

		// Attach the rejection owner before registration awaits any provider work.
		void taskStartup.catch(rollbackFailedStartup)

		try {
			await this.addClineToStack(task)
			this.log(
				`[DEEPTASK_STARTUP_TRANSACTION_V1] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} started`,
			)
		} catch (error) {
			finishRegistration()
			await rollbackFailedStartup(error)
			throw error
		} finally {
			finishRegistration()
		}
		// kilocode_change end

		return task
	}

	public async cancelTask(): Promise<void> {
		const task = this.getCurrentTask()

		if (!task) {
			return
		}

		console.log(`[cancelTask] cancelling task ${task.taskId}.${task.instanceId}`)

		// kilocode_change start
		// Close the old task synchronously before any history I/O. A follow-up message
		// can arrive immediately after the cancel IPC; it must observe cancellation and
		// be parked for the rehydrated task instead of satisfying a stale pending ask.
		task.abortReason = "user_cancelled"
		task.abandoned = true
		const originalInstanceId = task.instanceId
		task.cancelCurrentRequest()
		await task.abortTask()
		// kilocode_change end

		// kilocode_change start
		// Cancellation is the emergency exit for a stalled or half-created task. It
		// must not depend on persistence that may be exactly what failed. Rehydrate
		// when history is complete; otherwise clear the runtime task and release the
		// webview without surfacing a secondary "Task not found" error.
		let historyItem: HistoryItem
		try {
			;({ historyItem } = await this.getTaskWithId(task.taskId, false))
		} catch (error) {
			this.log(
				`[cancelTask] Task ${task.taskId} could not be rehydrated after cancellation: ${error instanceof Error ? error.message : String(error)}`,
			)

			// Persistence failure must not turn a real human message into a no-op. The
			// pending continuation is already the complete user payload, so deliver it
			// through a fresh task when the old history cannot be restored.
			const pendingContinuation = this.consumePendingCancelledTaskContinuation()
			await this.removeClineFromStack()
			if (pendingContinuation) {
				try {
					await this.createTask(pendingContinuation.text, pendingContinuation.images)
					await this.postMessageToWebview({ type: "invoke", invoke: "newChat" })
				} catch (fallbackError) {
					this.log(
						`[cancelTask] Failed to deliver pending human message after persistence failure: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
					)
					await this.postStateToWebview()
				}
			} else {
				await this.postStateToWebview()
				await this.postMessageToWebview({ type: "action", action: "chatButtonClicked" })
			}
			return
		}
		// kilocode_change end

		// Preserve parent and root task information for history item.
		const rootTask = task.rootTask
		const parentTask = task.parentTask

		await pWaitFor(
			() =>
				this.getCurrentTask()! === undefined ||
				this.getCurrentTask()!.isStreaming === false ||
				this.getCurrentTask()!.didFinishAbortingStream ||
				// If only the first chunk is processed, then there's no
				// need to wait for graceful abort (closes edits, browser,
				// etc).
				this.getCurrentTask()!.isWaitingForFirstChunk,
			{
				timeout: 3_000,
			},
		).catch(() => {
			console.error("Failed to abort task")
		})

		// Defensive safeguard: if current instance already changed, skip rehydrate
		const current = this.getCurrentTask()
		if (current && current.instanceId !== originalInstanceId) {
			this.log(
				`[cancelTask] Skipping rehydrate: current instance ${current.instanceId} != original ${originalInstanceId}`,
			)
			return
		}

		// Final race check before rehydrate to avoid duplicate rehydration
		{
			const currentAfterCheck = this.getCurrentTask()
			if (currentAfterCheck && currentAfterCheck.instanceId !== originalInstanceId) {
				this.log(
					`[cancelTask] Skipping rehydrate after final check: current instance ${currentAfterCheck.instanceId} != original ${originalInstanceId}`,
				)
				return
			}
		}

		// Clears task again, so we need to abortTask manually above.
		await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
	}

	// Clear the current task without treating it as a subtask.
	// This is used when the user cancels a task that is not a subtask.
	public async clearTask(): Promise<void> {
		if (this.clineStack.length > 0) {
			const task = this.clineStack[this.clineStack.length - 1]
			console.log(`[clearTask] clearing task ${task.taskId}.${task.instanceId}`)
			await this.removeClineFromStack()
		}
	}

	public resumeTask(taskId: string): void {
		// Use the existing showTaskWithId method which handles both current and
		// historical tasks.
		this.showTaskWithId(taskId).catch((error) => {
			this.log(`Failed to resume task ${taskId}: ${error.message}`)
		})
	}

	// Modes

	public async getModes(): Promise<{ slug: string; name: string }[]> {
		try {
			const customModes = await this.customModesManager.getCustomModes()
			return [...DEFAULT_MODES, ...customModes].map(({ slug, name }) => ({ slug, name }))
		} catch (error) {
			return DEFAULT_MODES.map(({ slug, name }) => ({ slug, name }))
		}
	}

	public async getMode(): Promise<string> {
		const { mode } = await this.getState()
		return mode
	}

	public async setMode(mode: string): Promise<void> {
		await this.setValues({ mode })
	}

	// kilocode_change start: Review mode
	/**
	 * Triggers the review scope selection UI
	 * Called when user enters review mode
	 */
	public async triggerReviewScopeSelection(): Promise<void> {
		try {
			const cwd = getWorkspacePath()
			if (!cwd) {
				this.log("Cannot start review: no workspace folder open")
				return
			}

			const { ReviewService } = await import("../../services/review")
			const reviewService = new ReviewService({ cwd })
			const scopeInfo = await reviewService.getScopeInfo()

			await this.postMessageToWebview({
				type: "askReviewScope",
				reviewScopeInfo: scopeInfo,
			})
		} catch (error) {
			this.log(
				`Error triggering review scope selection: ${error instanceof Error ? error.message : String(error)}`,
			)
		}
	}

	/**
	 * Handles the user's review scope selection
	 * Gets lightweight summary and starts the review task
	 * The agent will dynamically explore changes using tools
	 */
	public async handleReviewScopeSelected(scope: "uncommitted" | "branch"): Promise<void> {
		try {
			const cwd = getWorkspacePath()
			if (!cwd) {
				this.log("Cannot start review: no workspace folder open")
				vscode.window.showErrorMessage("Cannot start review: no workspace folder open")
				return
			}

			const { ReviewService, buildReviewPrompt } = await import("../../services/review")
			const reviewService = new ReviewService({ cwd })

			// Get lightweight summary - agent will explore details with tools
			const summary = await reviewService.getReviewSummary(scope)

			// Build the review prompt and start the task
			// Let the agent handle cases with no changes - it can explain and offer alternatives
			const reviewPrompt = buildReviewPrompt(summary)
			await this.createTask(reviewPrompt)
		} catch (error) {
			this.log(`Error handling review scope selection: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	// kilocode_change end: Review mode

	// Provider Profiles

	public async getProviderProfiles(): Promise<{ name: string; provider?: string }[]> {
		const { listApiConfigMeta = [] } = await this.getState()
		return listApiConfigMeta.map((profile) => ({ name: profile.name, provider: profile.apiProvider }))
	}

	public async getProviderProfile(): Promise<string> {
		const { currentApiConfigName = "default" } = await this.getState()
		return currentApiConfigName
	}

	public async setProviderProfile(name: string): Promise<void> {
		await this.activateProviderProfile({ name })
	}

	// Telemetry

	private _appProperties?: StaticAppProperties
	private _gitProperties?: GitProperties

	private getAppProperties(): StaticAppProperties {
		if (!this._appProperties) {
			const packageJSON = this.context.extension?.packageJSON
			// kilocode_change start
			const {
				kiloCodeWrapped,
				kiloCodeWrapper,
				kiloCodeWrapperCode,
				kiloCodeWrapperVersion,
				kiloCodeWrapperTitle,
			} = getKiloCodeWrapperProperties()
			// kilocode_change end

			this._appProperties = {
				appName: packageJSON?.name ?? Package.name,
				appVersion: packageJSON?.version ?? Package.version,
				vscodeVersion: vscode.version,
				platform: isWsl ? "wsl" /* kilocode_change */ : process.platform,
				// kilocode_change start
				editorName: kiloCodeWrapperTitle ? kiloCodeWrapperTitle : vscode.env.appName,
				wrapped: kiloCodeWrapped,
				wrapper: kiloCodeWrapper,
				wrapperCode: kiloCodeWrapperCode,
				wrapperVersion: kiloCodeWrapperVersion,
				wrapperTitle: kiloCodeWrapperTitle,
				machineId: vscode.env.machineId,
				vscodeIsTelemetryEnabled: vscode.env.isTelemetryEnabled,
				// kilocode_change end
			}
		}

		return this._appProperties
	}

	public get appProperties(): StaticAppProperties {
		return this._appProperties ?? this.getAppProperties()
	}

	private getCloudProperties(): CloudAppProperties {
		let cloudIsAuthenticated: boolean | undefined

		try {
			if (CloudService.hasInstance()) {
				cloudIsAuthenticated = CloudService.instance.isAuthenticated()
			}
		} catch (error) {
			// Silently handle errors to avoid breaking telemetry collection.
			this.log(`[getTelemetryProperties] Failed to get cloud auth state: ${error}`)
		}

		return {
			cloudIsAuthenticated,
		}
	}

	private async getTaskProperties(): Promise<DynamicAppProperties & TaskProperties> {
		const { language = "en", mode, apiConfiguration } = await this.getState()

		const task = this.getCurrentTask()
		const todoList = task?.todoList
		let todos: { total: number; completed: number; inProgress: number; pending: number } | undefined

		if (todoList && todoList.length > 0) {
			todos = {
				total: todoList.length,
				completed: todoList.filter((todo) => todo.status === "completed").length,
				inProgress: todoList.filter((todo) => todo.status === "in_progress").length,
				pending: todoList.filter((todo) => todo.status === "pending").length,
			}
		}

		return {
			language,
			mode,
			taskId: task?.taskId,
			parentTaskId: task?.parentTaskId,
			apiProvider: apiConfiguration?.apiProvider,
			diffStrategy: task?.diffStrategy?.getName(),
			isSubtask: task ? !!task.parentTaskId : undefined,
			...(todos && { todos }),
			// kilocode_change start
			currentTaskSize: task?.clineMessages.length,
			taskHistorySize: this.kiloCodeTaskHistorySizeForTelemetryOnly || undefined,
			toolStyle: resolveToolProtocol(apiConfiguration, task?.api?.getModel().info),
			// kilocode_change end
		}
	}

	private async getGitProperties(): Promise<GitProperties> {
		if (!this._gitProperties) {
			this._gitProperties = await getWorkspaceGitInfo()
		}

		return this._gitProperties
	}

	public get gitProperties(): GitProperties | undefined {
		return this._gitProperties
	}

	// kilocode_change start
	private _kiloConfig: KilocodeConfig | null = null
	public async getKiloConfig(): Promise<KilocodeConfig | null> {
		if (this._kiloConfig === null) {
			const { repositoryUrl } = await this.getGitProperties()
			this._kiloConfig = await getKilocodeConfig(this.cwd, repositoryUrl)
			console.log("getKiloConfig", this._kiloConfig)
		}
		return this._kiloConfig
	}
	// kilocode_change end

	public async getTelemetryProperties(): Promise<TelemetryProperties> {
		// kilocode_change start
		const state = await this.getState()
		const { apiConfiguration, experiments } = state
		const task = this.getCurrentTask()

		async function getModelId() {
			try {
				if (task?.api instanceof OpenRouterHandler) {
					return { modelId: (await task.api.fetchModel()).id }
				} else {
					return { modelId: task?.api?.getModel().id }
				}
			} catch (error) {
				return {
					modelException: stringifyError(error),
				}
			}
		}

		function getOpenRouter() {
			if (
				apiConfiguration &&
				(apiConfiguration.apiProvider === "openrouter" || apiConfiguration.apiProvider === "kilocode")
			) {
				return {
					openRouter: {
						sort: apiConfiguration.openRouterProviderSort,
						dataCollection: apiConfiguration.openRouterProviderDataCollection,
						specificProvider: apiConfiguration.openRouterSpecificProvider,
					},
				}
			}
			return {}
		}

		function getMemory() {
			try {
				return { memory: { ...process.memoryUsage() } }
			} catch (error) {
				return {
					memoryException: stringifyError(error),
				}
			}
		}

		const getFastApply = () => {
			try {
				return {
					fastApply: {
						morphFastApply: Boolean(experiments.morphFastApply),
						morphApiKey: Boolean(this.contextProxy.getValue("morphApiKey")),
						selectedModel: this.contextProxy.getValue("fastApplyModel") || "auto",
						fastApplyApiProvider: this.contextProxy.getValue("fastApplyApiProvider") || "current",
					},
				}
			} catch (error) {
				return {
					fastApplyException: stringifyError(error),
				}
			}
		}

		const getAutoApproveSettings = () => {
			try {
				return {
					autoApprove: {
						autoApprovalEnabled: !!state.autoApprovalEnabled,
						alwaysAllowBrowser: !!state.alwaysAllowBrowser,
						alwaysAllowExecute: !!state.alwaysAllowExecute,
						alwaysAllowFollowupQuestions: !!state.alwaysAllowFollowupQuestions,
						alwaysAllowMcp: !!state.alwaysAllowMcp,
						alwaysAllowModeSwitch: !!state.alwaysAllowModeSwitch,
						alwaysAllowProviderProfileSwitch: !!state.alwaysAllowProviderProfileSwitch, // kilocode_change
						alwaysAllowReadOnly: !!state.alwaysAllowReadOnly,
						alwaysAllowReadOnlyOutsideWorkspace: !!state.alwaysAllowReadOnlyOutsideWorkspace,
						alwaysAllowSubtasks: !!state.alwaysAllowSubtasks,

						alwaysAllowWrite: !!state.alwaysAllowWrite,
						alwaysAllowWriteOutsideWorkspace: !!state.alwaysAllowWriteOutsideWorkspace,
						alwaysAllowWriteProtected: !!state.alwaysAllowWriteProtected,
						alwaysAllowDelete: !!state.alwaysAllowDelete, // kilocode_change
						yoloMode: !!state.yoloMode,
					},
				}
			} catch (error) {
				return {
					autoApproveException: stringifyError(error),
				}
			}
		}
		// kilocode_change end

		return {
			...this.getAppProperties(),
			// ...this.getCloudProperties(), kilocode_change: disable
			// kilocode_change start
			...(await getModelId()),
			...getMemory(),
			...getFastApply(),
			...getOpenRouter(),
			...getAutoApproveSettings(),
			// Add organization ID if available
			...(apiConfiguration.kilocodeOrganizationId && {
				kilocodeOrganizationId: apiConfiguration.kilocodeOrganizationId,
			}),
			// kilocode_change end
			...(await this.getTaskProperties()),
			...(await this.getGitProperties()),
		}
	}

	// kilocode_change:
	// MCP Marketplace
	private async fetchMcpMarketplaceFromApi(silent: boolean = false): Promise<McpMarketplaceCatalog | undefined> {
		try {
			const response = await axios.get("https://api.cline.bot/v1/mcp/marketplace", {
				headers: {
					"Content-Type": "application/json",
				},
			})

			if (!response.data) {
				throw new Error("Invalid response from MCP marketplace API")
			}

			const catalog: McpMarketplaceCatalog = {
				items: (response.data || []).map((item: any) => ({
					...item,
					githubStars: item.githubStars ?? 0,
					downloadCount: item.downloadCount ?? 0,
					tags: item.tags ?? [],
				})),
			}

			await this.updateGlobalState("mcpMarketplaceCatalog", catalog)
			return catalog
		} catch (error) {
			console.error("Failed to fetch MCP marketplace:", error)
			if (!silent) {
				const errorMessage = error instanceof Error ? error.message : "Failed to fetch MCP marketplace"
				await this.postMessageToWebview({
					type: "mcpMarketplaceCatalog",
					error: errorMessage,
				})
				vscode.window.showErrorMessage(errorMessage)
			}
			return undefined
		}
	}

	async silentlyRefreshMcpMarketplace() {
		try {
			const catalog = await this.fetchMcpMarketplaceFromApi(true)
			if (catalog) {
				await this.postMessageToWebview({
					type: "mcpMarketplaceCatalog",
					mcpMarketplaceCatalog: catalog,
				})
			}
		} catch (error) {
			console.error("Failed to silently refresh MCP marketplace:", error)
		}
	}

	async fetchMcpMarketplace(forceRefresh: boolean = false) {
		try {
			// Check if we have cached data
			const cachedCatalog = (await this.getGlobalState("mcpMarketplaceCatalog")) as
				| McpMarketplaceCatalog
				| undefined
			if (!forceRefresh && cachedCatalog?.items) {
				await this.postMessageToWebview({
					type: "mcpMarketplaceCatalog",
					mcpMarketplaceCatalog: cachedCatalog,
				})
				return
			}

			const catalog = await this.fetchMcpMarketplaceFromApi(false)
			if (catalog) {
				await this.postMessageToWebview({
					type: "mcpMarketplaceCatalog",
					mcpMarketplaceCatalog: catalog,
				})
			}
		} catch (error) {
			console.error("Failed to handle cached MCP marketplace:", error)
			const errorMessage = error instanceof Error ? error.message : "Failed to handle cached MCP marketplace"
			await this.postMessageToWebview({
				type: "mcpMarketplaceCatalog",
				error: errorMessage,
			})
			vscode.window.showErrorMessage(errorMessage)
		}
	}

	async downloadMcp(mcpId: string) {
		try {
			// First check if we already have this MCP server installed
			const servers = this.mcpHub?.getServers() || []
			const isInstalled = servers.some((server: McpServer) => server.name === mcpId)

			if (isInstalled) {
				throw new Error("This MCP server is already installed")
			}

			// Fetch server details from marketplace
			const response = await axios.post<McpDownloadResponse>(
				"https://api.cline.bot/v1/mcp/download",
				{ mcpId },
				{
					headers: { "Content-Type": "application/json" },
					timeout: 10000,
				},
			)

			if (!response.data) {
				throw new Error("Invalid response from MCP marketplace API")
			}

			console.log("[downloadMcp] Response from download API", { response })

			const mcpDetails = response.data

			// Validate required fields
			if (!mcpDetails.githubUrl) {
				throw new Error("Missing GitHub URL in MCP download response")
			}
			if (!mcpDetails.readmeContent) {
				throw new Error("Missing README content in MCP download response")
			}

			// Send details to webview
			await this.postMessageToWebview({
				type: "mcpDownloadDetails",
				mcpDownloadDetails: mcpDetails,
			})

			// Create task with context from README and added guidelines for MCP server installation
			const task = `Set up the MCP server from ${mcpDetails.githubUrl} while adhering to these MCP server installation rules:
- Use "${mcpDetails.mcpId}" as the server name in ${GlobalFileNames.mcpSettings}.
- Create the directory for the new MCP server before starting installation.
- Use commands aligned with the user's shell and operating system best practices.
- The following README may contain instructions that conflict with the user's OS, in which case proceed thoughtfully.
- Once installed, demonstrate the server's capabilities by using one of its tools.
Here is the project's README to help you get started:\n\n${mcpDetails.readmeContent}\n${mcpDetails.llmsInstallationContent}`

			// Initialize task and show chat view
			await this.createTask(task)
			await this.postMessageToWebview({
				type: "action",
				action: "chatButtonClicked",
			})
		} catch (error) {
			console.error("Failed to download MCP:", error)
			let errorMessage = "Failed to download MCP"

			if (axios.isAxiosError(error)) {
				if (error.code === "ECONNABORTED") {
					errorMessage = "Request timed out. Please try again."
				} else if (error.response?.status === 404) {
					errorMessage = "MCP server not found in marketplace."
				} else if (error.response?.status === 500) {
					errorMessage = "Internal server error. Please try again later."
				} else if (!error.response && error.request) {
					errorMessage = "Network error. Please check your internet connection."
				}
			} else if (error instanceof Error) {
				errorMessage = error.message
			}

			// Show error in both notification and marketplace UI
			vscode.window.showErrorMessage(errorMessage)
			await this.postMessageToWebview({
				type: "mcpDownloadDetails",
				error: errorMessage,
			})
		}
	}
	// end kilocode_change

	// kilocode_change start
	// Add new methods for favorite functionality
	async toggleTaskFavorite(id: string) {
		const history = this.getGlobalState("taskHistory") ?? []
		const updatedHistory = history.map((item) => {
			if (item.id === id) {
				return { ...item, isFavorited: !item.isFavorited }
			}
			return item
		})
		await this.updateGlobalState("taskHistory", updatedHistory)
		this.kiloCodeTaskHistoryVersion++
		await this.postStateToWebview()
	}

	async getFavoriteTasks(): Promise<HistoryItem[]> {
		const history = this.getGlobalState("taskHistory") ?? []
		return history.filter((item) => item.isFavorited)
	}

	// Modify batch delete to respect favorites
	async deleteMultipleTasks(taskIds: string[], excludeFavorites?: boolean) {
		const history = this.getGlobalState("taskHistory") ?? []

		// kilocode_change start
		// Filter out favorited tasks if excludeFavorites is true
		let idsToDelete = taskIds
		if (excludeFavorites) {
			idsToDelete = taskIds.filter((id) => !history.find((item) => item.id === id)?.isFavorited)
		}
		// kilocode_change end

		for (const id of idsToDelete) {
			await this.deleteTaskWithId(id)
		}
	}

	private kiloCodeTaskHistoryVersion = 0
	private kiloCodeTaskHistorySizeForTelemetryOnly = 0

	public getTaskHistory(): HistoryItem[] {
		return this.getGlobalState("taskHistory") || []
	}
	// kilocode_change end

	public get cwd() {
		return this.currentWorkspacePath || getWorkspacePath()
	}

	/**
	 * Delegate parent task and open child task.
	 *
	 * - Enforce single-open invariant
	 * - Persist parent delegation metadata
	 * - Emit TaskDelegated (task-level; API forwards to provider/bridge)
	 * - Create child as sole active and switch mode to child's mode
	 */
	public async delegateParentAndOpenChild(params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
	}): Promise<Task> {
		const { parentTaskId, message, initialTodos, mode } = params

		// Metadata-driven delegation is always enabled

		// 1) Get parent (must be current task)
		const parent = this.getCurrentTask()
		if (!parent) {
			throw new Error("[delegateParentAndOpenChild] No current task")
		}
		if (parent.taskId !== parentTaskId) {
			throw new Error(
				`[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
			)
		}
		// 2) Flush pending tool results to API history BEFORE disposing the parent.
		//    This is critical for native tool protocol: when tools are called before new_task,
		//    their tool_result blocks are in userMessageContent but not yet saved to API history.
		//    If we don't flush them, the parent's API conversation will be incomplete and
		//    cause 400 errors when resumed (missing tool_result for tool_use blocks).
		//
		//    NOTE: We do NOT pass the assistant message here because the assistant message
		//    is already added to apiConversationHistory by the normal flow in
		//    recursivelyMakeClineRequests BEFORE tools start executing. We only need to
		//    flush the pending user message with tool_results.
		try {
			await parent.flushPendingToolResultsToHistory()
		} catch (error) {
			this.log(
				`[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		// 3) Enforce single-open invariant by closing/disposing the parent first
		//    This ensures we never have >1 tasks open at any time during delegation.
		//    Await abort completion to ensure clean disposal and prevent unhandled rejections.
		try {
			await this.removeClineFromStack()
		} catch (error) {
			this.log(
				`[delegateParentAndOpenChild] Error during parent disposal (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			// Non-fatal: proceed with child creation even if parent cleanup had issues
		}

		// 3) Switch provider mode to child's requested mode BEFORE creating the child task
		//    This ensures the child's system prompt and configuration are based on the correct mode.
		//    The mode switch must happen before createTask() because the Task constructor
		//    initializes its mode from provider.getState() during initializeTaskMode().
		try {
			await this.handleModeSwitch(mode as any)
		} catch (e) {
			this.log(
				`[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
					(e as Error)?.message ?? String(e)
				}`,
			)
		}

		// 4) Create child as sole active (parent reference preserved for lineage)
		// Pass initialStatus: "active" to ensure the child task's historyItem is created
		// with status from the start, avoiding race conditions where the task might
		// call attempt_completion before status is persisted separately.
		const child = await this.createTask(message, undefined, parent as any, {
			initialTodos,
			initialStatus: "active",
		})

		// 5) Persist parent delegation metadata
		try {
			const { historyItem } = await this.getTaskWithId(parentTaskId)
			const childIds = Array.from(new Set([...(historyItem.childIds ?? []), child.taskId]))
			const updatedHistory: typeof historyItem = {
				...historyItem,
				status: "delegated",
				delegatedToId: child.taskId,
				awaitingChildId: child.taskId,
				childIds,
			}
			await this.updateTaskHistory(updatedHistory)
		} catch (err) {
			this.log(
				`[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 6) Emit TaskDelegated (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegated, parentTaskId, child.taskId)
		} catch {
			// non-fatal
		}

		return child
	}

	/**
	 * Reopen parent task from delegation with write-back and events.
	 */
	public async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void> {
		const { parentTaskId, childTaskId, completionResultSummary } = params
		const globalStoragePath = this.contextProxy.globalStorageUri.fsPath

		// 1) Load parent from history and current persisted messages
		const { historyItem } = await this.getTaskWithId(parentTaskId)

		let parentClineMessages: ClineMessage[] = []
		try {
			parentClineMessages = await readTaskMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})
		} catch {
			parentClineMessages = []
		}

		let parentApiMessages: any[] = []
		try {
			parentApiMessages = (await readApiMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})) as any[]
		} catch {
			parentApiMessages = []
		}

		// 2) Inject synthetic records: UI subtask_result and update API tool_result
		const ts = Date.now()

		// Defensive: ensure arrays
		if (!Array.isArray(parentClineMessages)) parentClineMessages = []
		if (!Array.isArray(parentApiMessages)) parentApiMessages = []

		const subtaskUiMessage: ClineMessage = {
			type: "say",
			say: "subtask_result",
			text: completionResultSummary,
			ts,
		}
		parentClineMessages.push(subtaskUiMessage)
		await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })

		// Find the tool_use_id from the last assistant message's new_task tool_use
		let toolUseId: string | undefined
		for (let i = parentApiMessages.length - 1; i >= 0; i--) {
			const msg = parentApiMessages[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use" && block.name === "new_task") {
						toolUseId = block.id
						break
					}
				}
				if (toolUseId) break
			}
		}

		// The API expects: user → assistant (with tool_use) → user (with tool_result)
		// We need to add a NEW user message with the tool_result AFTER the assistant's tool_use
		// NOT add it to an existing user message
		if (toolUseId) {
			// Check if the last message is already a user message with a tool_result for this tool_use_id
			// (in case this is a retry or the history was already updated)
			const lastMsg = parentApiMessages[parentApiMessages.length - 1]
			let alreadyHasToolResult = false
			if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
				for (const block of lastMsg.content) {
					if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
						// Update the existing tool_result content
						block.content = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
						alreadyHasToolResult = true
						break
					}
				}
			}

			// If no existing tool_result found, create a NEW user message with the tool_result
			if (!alreadyHasToolResult) {
				parentApiMessages.push({
					role: "user",
					content: [
						{
							type: "tool_result" as const,
							tool_use_id: toolUseId,
							content: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
						},
					],
					ts,
				})
			}
		} else {
			// Fallback for XML protocol or when toolUseId couldn't be found:
			// Add a text block (not ideal but maintains backward compatibility)
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "text",
						text: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
					},
				],
				ts,
			})
		}

		// Validate the newly injected tool_result against the preceding assistant message.
		// This ensures the tool_result's tool_use_id matches a tool_use in the immediately
		// preceding assistant message (Anthropic API requirement).
		const lastMessage = parentApiMessages[parentApiMessages.length - 1]
		if (lastMessage?.role === "user") {
			const validatedMessage = validateAndFixToolResultIds(lastMessage, parentApiMessages.slice(0, -1))
			parentApiMessages[parentApiMessages.length - 1] = validatedMessage
		}

		await saveApiMessages({ messages: parentApiMessages as any, taskId: parentTaskId, globalStoragePath })

		// 3) Update child metadata to "completed" status
		try {
			const { historyItem: childHistory } = await this.getTaskWithId(childTaskId)
			await this.updateTaskHistory({
				...childHistory,
				status: "completed",
			})
		} catch (err) {
			this.log(
				`[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 4) Update parent metadata and persist BEFORE emitting completion event
		const childIds = Array.from(new Set([...(historyItem.childIds ?? []), childTaskId]))
		const updatedHistory: typeof historyItem = {
			...historyItem,
			status: "active",
			completedByChildId: childTaskId,
			completionResultSummary,
			awaitingChildId: undefined,
			childIds,
		}
		await this.updateTaskHistory(updatedHistory)

		// 5) Emit TaskDelegationCompleted (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationCompleted, parentTaskId, childTaskId, completionResultSummary)
		} catch {
			// non-fatal
		}

		// 6) Close child instance if still open (single-open-task invariant)
		const current = this.getCurrentTask()
		if (current?.taskId === childTaskId) {
			await this.removeClineFromStack()
		}

		// 7) Reopen the parent from history as the sole active task (restores saved mode)
		//    IMPORTANT: startTask=false to suppress resume-from-history ask scheduling
		const parentInstance = await this.createTaskWithHistoryItem(updatedHistory, { startTask: false })

		// 8) Inject restored histories into the in-memory instance before resuming
		if (parentInstance) {
			try {
				await parentInstance.overwriteClineMessages(parentClineMessages)
			} catch {
				// non-fatal
			}
			try {
				await parentInstance.overwriteApiConversationHistory(parentApiMessages as any)
			} catch {
				// non-fatal
			}

			// Auto-resume parent without ask("resume_task")
			await parentInstance.resumeAfterDelegation()
		}

		// 9) Emit TaskDelegationResumed (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		} catch {
			// non-fatal
		}
	}

	/**
	 * Convert a file path to a webview-accessible URI
	 * This method safely converts file paths to URIs that can be loaded in the webview
	 *
	 * @param filePath - The absolute file path to convert
	 * @returns The webview URI string, or the original file URI if conversion fails
	 * @throws {Error} When webview is not available
	 * @throws {TypeError} When file path is invalid
	 */
	public convertToWebviewUri(filePath: string): string {
		try {
			const fileUri = vscode.Uri.file(filePath)

			// Check if we have a webview available
			if (this.view?.webview) {
				const webviewUri = this.view.webview.asWebviewUri(fileUri)
				return webviewUri.toString()
			}

			// Specific error for no webview available
			const error = new Error("No webview available for URI conversion")
			console.error(error.message)
			// Fallback to file URI if no webview available
			return fileUri.toString()
		} catch (error) {
			// More specific error handling
			if (error instanceof TypeError) {
				console.error("Invalid file path provided for URI conversion:", error)
			} else {
				console.error("Failed to convert to webview URI:", error)
			}
			// Return file URI as fallback
			return vscode.Uri.file(filePath).toString()
		}
	}
}
