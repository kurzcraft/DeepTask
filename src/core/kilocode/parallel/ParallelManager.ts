/**
 * ParallelManager - orchestrates parallel subagent sessions (kilocode_change - new file)
 *
 * Subagents are real in-process Task instances so they keep the full chat UI
 * semantics of the main task: integrated terminals, checkpoints, and the same
 * message rendering. Their webview messages are routed here instead of the
 * main chat stream, and are re-broadcast to the webview as parallel session
 * messages that the left rail and right slide-over panel render.
 */

import { randomUUID } from "crypto"
import * as path from "path"
import * as vscode from "vscode"
import type {
	ClineMessage,
	ParallelConversation,
	ParallelFolder,
	ParallelSession,
	ParallelWorkspace,
} from "@roo-code/types"

import type { ClineProvider } from "../../webview/ClineProvider"
import { Task } from "../../task/Task"
import { WorkspaceRegistry } from "./WorkspaceRegistry"
import { collectWorkspaceOccupants, type WorkspaceOccupant } from "./workspaceOccupancy"

export interface SubagentSpec {
	label: string
	task: string
	workspaceName?: string
	workspacePath?: string
	branch?: string
}

export interface SubagentContext {
	sessionId: string
	depth: number
	manager: ParallelManager
}

interface SessionState {
	info: ParallelSession
	messages: ClineMessage[]
	task?: Task
}

export type { SessionState as ParallelSessionState }

export const MAX_PARALLEL_SUBAGENTS = 5
export const MAX_SUBAGENT_DEPTH = 1

const FOLDERS_STORAGE_KEY = "parallelFolders"
const CONVERSATIONS_STORAGE_KEY = "parallelConversations"
const ACTIVE_CONVERSATION_STORAGE_KEY = "parallelActiveConversationId"
const ARCHIVED_FOLDERS_STORAGE_KEY = "parallelArchivedFolders"

export class ParallelManager {
	private sessions: Map<string, SessionState> = new Map()
	private mainFolders: ParallelFolder[] | undefined
	private conversations: ParallelConversation[] | undefined
	private activeConversationId: string | undefined

	get focusedConversationId(): string | undefined {
		return this.activeConversationId
	}
	private archivedFolders: Set<string> | undefined
	private workspacesHydrated = false
	private worktreeWatchers = new Map<string, vscode.Disposable>()
	private worktreeRefreshTimer: ReturnType<typeof setTimeout> | undefined

	constructor(
		private readonly provider: ClineProvider,
		private readonly registry: WorkspaceRegistry,
	) {}

	getSession(sessionId: string): SessionState | undefined {
		return this.sessions.get(sessionId)
	}

	sessionsForParent(parentTaskId: string): SessionState[] {
		return [...this.sessions.values()].filter((s) => s.info.parentTaskId === parentTaskId)
	}

	listRunning(): SessionState[] {
		return [...this.sessions.values()].filter((s) => s.info.status === "running")
	}

	/** Spawns a subagent Task; resolves when the subagent fully settles. */
	spawn(parentTask: Task, spec: SubagentSpec): { sessionId: string; done: Promise<void> } {
		const sessionId = `sa-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`
		const workspacePath = spec.workspacePath ?? parentTask.cwd
		const info: ParallelSession = {
			sessionId,
			taskId: sessionId,
			parentTaskId: parentTask.taskId,
			label: spec.label,
			task: spec.task,
			status: "running",
			workspaceName: spec.workspaceName,
			workspacePath,
			branch: spec.branch,
			startedAt: Date.now(),
		}
		const state: SessionState = { info, messages: [] }
		this.sessions.set(sessionId, state)

		const provider = this.provider

		const [child, runPromise] = Task.create({
			context: this.provider.context, // kilocode_change: Task.context is private
			provider,
			apiConfiguration: parentTask.apiConfiguration,
			task: spec.task,
			workspacePath,
			enableDiff: parentTask.diffEnabled,
			enableCheckpoints: parentTask.enableCheckpoints,
			checkpointTimeout: parentTask.checkpointTimeout,
			subagent: { sessionId, depth: (parentTask.subagent?.depth ?? 0) + 1, manager: this },
			startTask: true,
		})
		state.task = child
		state.info.taskId = child.taskId
		if (typeof this.provider.addBackgroundClineToStack === "function") {
			void this.provider.addBackgroundClineToStack(child)
		}
		this.attachSubagentConversation(parentTask, spec, child.taskId, workspacePath)
		const registered = this.registerSubagentConversation(parentTask, spec, child.taskId, workspacePath)

		const done = runPromise
			.then(() => {
				state.info.status = "completed"
				state.info.result = this.extractResult(state)
			})
			.catch((error) => {
				state.info.status = child.abort ? "cancelled" : "error"
				state.info.error = error instanceof Error ? error.message : String(error)
				state.info.result = this.extractResult(state)
			})
			.finally(() => {
				state.info.endedAt = Date.now()
				if (spec.workspaceName) {
					// Release the exclusive claim; merge decisions come after all subagents finish.
					this.registry.release(spec.workspaceName, "available").catch(() => undefined)
				}
				void this.broadcast()
			})

		void registered.finally(() => {
			void this.broadcast()
		})
		return { sessionId, done }
	}

	private extractResult(state: SessionState): string | undefined {
		const completion = [...state.messages]
			.reverse()
			.find((m) => m.type === "say" && m.say === "completion_result" && m.partial !== true)
		if (completion?.text) {
			return completion.text
		}
		const lastText = [...state.messages]
			.reverse()
			.find((m) => m.type === "say" && m.say === "text" && m.partial !== true && m.text)
		return lastText?.text ? lastText.text.slice(-2000) : undefined
	}

	recordMessageCreated(sessionId: string, message: ClineMessage): void {
		const state = this.sessions.get(sessionId)
		if (!state) {
			return
		}
		state.messages.push(message)
		void this.provider
			.postMessageToWebview({
				type: "parallelSessionMessage",
				parallelSessionId: sessionId,
				clineMessage: message,
			})
			.catch(() => undefined)
	}

	recordMessageUpdated(sessionId: string, message: ClineMessage): void {
		const state = this.sessions.get(sessionId)
		if (!state) {
			return
		}
		const index = state.messages.findIndex((m) => m.ts === message.ts)
		if (index === -1) {
			state.messages.push(message)
		} else {
			state.messages[index] = message
		}
		void this.provider
			.postMessageToWebview({
				type: "parallelSessionMessageUpdated",
				parallelSessionId: sessionId,
				clineMessage: message,
			})
			.catch(() => undefined)
	}

	cancel(sessionId: string): boolean {
		const state = this.sessions.get(sessionId)
		if (!state?.task || state.info.status !== "running") {
			return false
		}
		void state.task.abortTask(true)
		return true
	}

	cancelChildrenOf(parentTaskId: string): void {
		for (const state of this.sessions.values()) {
			if (state.info.parentTaskId === parentTaskId && state.info.status === "running" && state.task) {
				void state.task.abortTask(true)
			}
		}
	}

	/**
	 * Sidebar folders are the user-opened project roots only. Git worktrees
	 * nest under their parent folder as workspaces, not as sibling folders.
	 */
	async getFolders(): Promise<ParallelFolder[]> {
		if (this.mainFolders === undefined) {
			try {
				this.mainFolders = await this.provider.context.globalState.get<ParallelFolder[]>(
					FOLDERS_STORAGE_KEY,
					[],
				)
			} catch (error) {
				console.error("[ParallelManager] failed to load folders:", error)
				this.mainFolders = []
			}
		}
		await this.loadArchivedFolders()
		const archivedAt = (folderPath: string): number | undefined =>
			this.archivedFolders?.has(folderPath) ? 1 : undefined
		const seen = new Set<string>()
		return (this.mainFolders ?? [])
			.map((folder) => ({
				...folder,
				kind: "main" as const,
				archivedAt: folder.archivedAt ?? archivedAt(folder.path),
			}))
			.filter((folder) => {
				if (seen.has(folder.path)) {
					return false
				}
				seen.add(folder.path)
				return true
			})
	}

	/** Parent folder for a worktree path (`.../.kilocode/worktrees/<name>` -> `...`). */
	inferParentFolder(workspacePath: string): string | undefined {
		const normalized = workspacePath.replace(/[\\/]+$/, "")
		const posix = `${normalized}`.replace(/\\/g, "/")
		const marker = "/.kilocode/worktrees"
		const idx = posix.indexOf(marker)
		if (idx > 0) {
			const parentPosix = posix.slice(0, idx)
			if (normalized.includes("\\")) {
				return parentPosix.replace(/\//g, "\\")
			}
			return parentPosix
		}
		return (this.mainFolders ?? []).find((folder) => folder.path === normalized)?.path
	}

	folderPathForWorkspace(workspace: ParallelWorkspace): string | undefined {
		return workspace.folderPath || this.inferParentFolder(workspace.path)
	}

	folderPathForPath(targetPath: string): string {
		const inferred = this.inferParentFolder(targetPath)
		if (inferred) {
			return inferred
		}
		const match = (this.mainFolders ?? []).find((folder) => folder.path === targetPath)
		return match?.path ?? targetPath
	}

	annotatedWorkspaces(): ParallelWorkspace[] {
		return this.registry.list().map((workspace) => ({
			...workspace,
			folderPath: this.folderPathForWorkspace(workspace) ?? workspace.folderPath,
		}))
	}

	/** Load persisted workspaces and discover on-disk Deeptask worktrees for every folder. */
	async hydrateRegisteredWorkspaces(): Promise<void> {
		if (this.workspacesHydrated) {
			this.watchWorktreeFolders()
			return
		}
		await this.refreshWorkspacesFromDisk()
	}

	/** Re-scan disk so deleted/created worktrees show up in the left rail immediately. */
	async refreshWorkspacesFromDisk(): Promise<void> {
		await this.registry.load()
		const folders = await this.getFolders()
		for (const folder of folders) {
			if (typeof this.provider.getWorkspaceService !== "function") {
				continue
			}
			try {
				await this.provider.getWorkspaceService(folder.path).hydrateFromDisk()
			} catch (error) {
				console.error(`[ParallelManager] failed to hydrate workspaces for ${folder.path}:`, error)
			}
		}
		this.workspacesHydrated = true
		this.watchWorktreeFolders()
	}

	private watchWorktreeFolders(): void {
		if (process.env.NODE_ENV === "test" || typeof vscode.workspace?.createFileSystemWatcher !== "function") {
			return
		}
		const folders = this.mainFolders ?? []
		const keep = new Set(folders.map((folder) => folder.path))
		for (const [folderPath, disposable] of this.worktreeWatchers) {
			if (!keep.has(folderPath)) {
				disposable.dispose()
				this.worktreeWatchers.delete(folderPath)
			}
		}
		for (const folder of folders) {
			if (this.worktreeWatchers.has(folder.path)) {
				continue
			}
			try {
				const pattern = new vscode.RelativePattern(folder.path, ".kilocode/worktrees/*")
				const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, true, false)
				const refresh = () => this.queueWorktreeRefresh()
				watcher.onDidCreate(refresh)
				watcher.onDidDelete(refresh)
				this.worktreeWatchers.set(folder.path, watcher)
			} catch (error) {
				console.error(`[ParallelManager] failed to watch worktrees for ${folder.path}:`, error)
			}
		}
	}

	private queueWorktreeRefresh(): void {
		if (this.worktreeRefreshTimer) {
			clearTimeout(this.worktreeRefreshTimer)
		}
		this.worktreeRefreshTimer = setTimeout(() => {
			this.worktreeRefreshTimer = undefined
			void this.refreshWorkspacesFromDisk()
				.then(() => this.broadcast())
				.catch((error) => console.error("[ParallelManager] worktree refresh failed:", error))
		}, 50)
	}

	private async loadArchivedFolders(): Promise<void> {
		if (this.archivedFolders === undefined) {
			try {
				const list =
					(await this.provider.context.globalState.get<string[]>(ARCHIVED_FOLDERS_STORAGE_KEY, [])) ?? []
				this.archivedFolders = new Set(list)
			} catch (error) {
				console.error("[ParallelManager] failed to load archived folders:", error)
				this.archivedFolders = new Set()
			}
		}
	}

	/** Archives a folder (hidden in the sidebar until unarchived). */
	async setFolderArchived(path: string, archived: boolean): Promise<void> {
		await this.loadArchivedFolders()
		if (archived) {
			this.archivedFolders?.add(path)
		} else {
			this.archivedFolders?.delete(path)
		}
		await this.getFolders()
		this.mainFolders = (this.mainFolders ?? []).map((folder) =>
			folder.path === path ? { ...folder, archivedAt: archived ? Date.now() : undefined } : folder,
		)
		try {
			await this.provider.context.globalState.update(FOLDERS_STORAGE_KEY, this.mainFolders)
		} catch (error) {
			console.error("[ParallelManager] failed to persist folders:", error)
		}
		try {
			await this.provider.context.globalState.update(ARCHIVED_FOLDERS_STORAGE_KEY, [
				...(this.archivedFolders ?? []),
			])
		} catch (error) {
			console.error("[ParallelManager] failed to persist archived folders:", error)
		}
	}

	/** Registers a main workspace folder (idempotent by path). Returns true when newly added. */
	async registerMainFolder(folderPath: string): Promise<boolean> {
		await this.getFolders()
		const folders = this.mainFolders ?? []
		const existing = folders.find((folder) => folder.path === folderPath)
		if (existing) {
			if (existing.archivedAt || this.archivedFolders?.has(folderPath)) {
				await this.setFolderArchived(folderPath, false)
				void this.broadcast()
			}
			return false
		}
		const name = folderPath.split(/[\\/]/).filter(Boolean).pop() ?? folderPath
		this.mainFolders = [...folders, { name, path: folderPath, kind: "main", createdAt: Date.now() }]
		try {
			await this.provider.context.globalState.update(FOLDERS_STORAGE_KEY, this.mainFolders)
		} catch (error) {
			console.error("[ParallelManager] failed to persist folders:", error)
		}
		if (typeof this.provider.getWorkspaceService === "function") {
			try {
				await this.provider.getWorkspaceService(folderPath).hydrateFromDisk()
			} catch (error) {
				console.error(`[ParallelManager] failed to hydrate workspaces for ${folderPath}:`, error)
			}
		}
		void this.broadcast()
		return true
	}

	private conversationWrite: Promise<void> = Promise.resolve()
	private conversationsDirty = false

	private enqueueConversationWrite<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.conversationWrite.then(fn, fn)
		this.conversationWrite = run.then(
			() => undefined,
			() => undefined,
		)
		return run
	}

	private migrateConversation(conversation: ParallelConversation): ParallelConversation {
		if (conversation.workspacePath) {
			const folderPath = this.folderPathForPath(conversation.folderPath)
			return folderPath === conversation.folderPath ? conversation : { ...conversation, folderPath }
		}
		const inferred = this.inferParentFolder(conversation.folderPath)
		if (inferred && inferred !== conversation.folderPath) {
			return { ...conversation, folderPath: inferred, workspacePath: conversation.folderPath }
		}
		return { ...conversation, workspacePath: conversation.folderPath }
	}

	private conversationScore(conversation: ParallelConversation): number {
		return (conversation.sessionId ? 4 : 0) + (conversation.title ? 2 : 0) + (conversation.completedAt ? 1 : 0)
	}

	private mergeConversationPair(
		kept: ParallelConversation,
		incoming: ParallelConversation,
	): ParallelConversation {
		const incomingScore = this.conversationScore(incoming)
		const keptScore = this.conversationScore(kept)
		const preferIncoming =
			incomingScore > keptScore ||
			(incomingScore === keptScore && incoming.createdAt < kept.createdAt)
		const primary = preferIncoming ? incoming : kept
		const secondary = preferIncoming ? kept : incoming
		return {
			...secondary,
			...primary,
			id: primary.id,
			title: primary.title || secondary.title,
			sessionId: primary.sessionId || secondary.sessionId,
			completedAt: primary.completedAt ?? secondary.completedAt,
			createdAt: Math.min(primary.createdAt, secondary.createdAt),
			lastActiveAt: Math.max(primary.lastActiveAt, secondary.lastActiveAt),
		}
	}

	private dedupeConversations(conversations: ParallelConversation[]): ParallelConversation[] {
		const byId = new Map<string, ParallelConversation>()
		const bySession = new Map<string, string>()
		for (const conversation of conversations) {
			const existingById = byId.get(conversation.id)
			const mergedById = existingById ? this.mergeConversationPair(existingById, conversation) : conversation
			if (existingById && existingById.id !== mergedById.id) {
				byId.delete(existingById.id)
			}
			byId.set(mergedById.id, mergedById)
			if (!mergedById.sessionId) {
				continue
			}
			const existingSessionId = bySession.get(mergedById.sessionId)
			if (!existingSessionId || existingSessionId === mergedById.id) {
				bySession.set(mergedById.sessionId, mergedById.id)
				continue
			}
			const existing = byId.get(existingSessionId)
			if (!existing) {
				bySession.set(mergedById.sessionId, mergedById.id)
				continue
			}
			const merged = this.mergeConversationPair(existing, mergedById)
			byId.delete(existing.id)
			byId.delete(mergedById.id)
			byId.set(merged.id, merged)
			bySession.set(merged.sessionId!, merged.id)
		}
		return Array.from(byId.values()).sort((left, right) => right.lastActiveAt - left.lastActiveAt)
	}

	private async loadConversations(force = false): Promise<ParallelConversation[]> {
		if (this.conversations === undefined || (force && !this.conversationsDirty)) {
			try {
				this.conversations = await this.provider.context.globalState.get<ParallelConversation[]>(
					CONVERSATIONS_STORAGE_KEY,
					[],
				)
			} catch (error) {
				console.error("[ParallelManager] failed to load conversations:", error)
				this.conversations = []
			}
			const beforeCount = (this.conversations ?? []).length
			this.conversations = this.dedupeConversations(
				(this.conversations ?? []).map((conversation) => this.migrateConversation(conversation)),
			)
			if ((this.conversations ?? []).length !== beforeCount) {
				this.conversationsDirty = true
				await this.persistConversations()
			} else {
				this.conversationsDirty = false
			}
		}
		return this.conversations
	}

	/** Re-read persisted conversations so extra windows pick up new tasks. */
	async reloadConversationsFromStorage(): Promise<ParallelConversation[]> {
		await this.conversationWrite
		return this.loadConversations(true)
	}

	private async persistConversations(): Promise<void> {
		this.conversationsDirty = true
		try {
			await this.provider.context.globalState.update(CONVERSATIONS_STORAGE_KEY, this.conversations ?? [])
			this.conversationsDirty = false
		} catch (error) {
			console.error("[ParallelManager] failed to persist conversations:", error)
		}
	}

	/** Registers a new conversation under a folder workspace and makes it the active one. */
	async createConversation(
		folderPath: string,
		init?: { sessionId?: string; title?: string; workspacePath?: string; activate?: boolean },
	): Promise<ParallelConversation> {
		return this.enqueueConversationWrite(async () => {
			await this.getFolders()
			await this.loadConversations()
			if (init?.sessionId) {
				const existing = (this.conversations ?? []).find((conversation) => conversation.sessionId === init.sessionId)
				if (existing) {
					if (init.activate !== false) {
						await this.setActiveConversation(existing.id)
					}
					void this.broadcast()
					return existing
				}
			}
			const now = Date.now()
			const resolvedFolder = this.folderPathForPath(folderPath)
			const workspacePath = init?.workspacePath ?? resolvedFolder
			const conversation: ParallelConversation = {
				id: `cv-${now.toString(36)}-${randomUUID().slice(0, 6)}`,
				folderPath: resolvedFolder,
				workspacePath,
				title: init?.title,
				sessionId: init?.sessionId,
				createdAt: now,
				lastActiveAt: now,
			}
			this.conversations = [conversation, ...(this.conversations ?? [])]
			this.conversationsDirty = true
			if (init?.activate !== false) {
				await this.setActiveConversation(conversation.id)
			}
			await this.persistConversations()
			void this.broadcast()
			return conversation
		})
	}

	/** Immediately attach a subagent conversation so the rail does not wait on persistence. */
	private attachSubagentConversation(
		parentTask: Task,
		spec: SubagentSpec,
		sessionId: string,
		workspacePath: string,
	): ParallelConversation {
		const existing = this.conversationForSession(sessionId)
		if (existing) {
			return existing
		}
		const parentConversation = this.conversationForSession(parentTask.taskId)
		const folderPath = parentConversation?.folderPath ?? this.folderPathForPath(workspacePath)
		const now = Date.now()
		const conversation: ParallelConversation = {
			id: `cv-${now.toString(36)}-${randomUUID().slice(0, 6)}`,
			folderPath,
			workspacePath,
			title: spec.label ?? spec.task.slice(0, 48),
			sessionId,
			createdAt: now,
			lastActiveAt: now,
		}
		this.conversations = [conversation, ...(this.conversations ?? [])]
		this.conversationsDirty = true
		return conversation
	}

	/** Registers a subagent as a normal archivable conversation under the current folder workspace. */
	private async registerSubagentConversation(
		parentTask: Task,
		spec: SubagentSpec,
		sessionId: string,
		workspacePath: string,
	): Promise<void> {
		try {
			const attached = this.attachSubagentConversation(parentTask, spec, sessionId, workspacePath)
			if (!this.conversationForSession(sessionId)) {
				const parentConversation = this.conversationForSession(parentTask.taskId)
				const folderPath = parentConversation?.folderPath ?? this.folderPathForPath(workspacePath)
				await this.createConversation(folderPath, {
					sessionId,
					title: spec.label ?? spec.task.slice(0, 48),
					workspacePath,
					activate: false,
				})
			} else {
				await this.enqueueConversationWrite(async () => {
					await this.persistConversations()
					void this.broadcast()
				})
			}
			void attached
			await this.provider.postStateToWebview()
		} catch (error) {
			console.error("[ParallelManager] failed to register subagent conversation:", error)
		}
	}

	getActiveConversationId(): string | undefined {
		return this.activeConversationId
	}

	/** Restores the persisted active conversation (used on window startup). */
	async restoreActiveConversation(): Promise<string | undefined> {
		if (this.activeConversationId !== undefined) {
			return this.activeConversationId
		}
		try {
			this.activeConversationId = await this.provider.context.globalState.get<string | undefined>(
				ACTIVE_CONVERSATION_STORAGE_KEY,
				undefined,
			)
		} catch (error) {
			console.error("[ParallelManager] failed to load active conversation:", error)
		}
		return this.activeConversationId
	}

	async setActiveConversation(id: string | undefined): Promise<void> {
		this.activeConversationId = id
		try {
			await this.provider.context.globalState.update(ACTIVE_CONVERSATION_STORAGE_KEY, id)
		} catch (error) {
			console.error("[ParallelManager] failed to persist active conversation:", error)
		}
	}

	async getConversation(id: string): Promise<ParallelConversation | undefined> {
		await this.conversationWrite
		const list = await this.loadConversations()
		return list.find((c) => c.id === id)
	}

	getConversationById(id: string | undefined): ParallelConversation | undefined {
		if (!id) {
			return undefined
		}
		return (this.conversations ?? []).find((c) => c.id === id)
	}

	conversationForSession(sessionId: string): ParallelConversation | undefined {
		return (this.conversations ?? []).find((c) => c.sessionId === sessionId)
	}

	/**
	 * Make a history/task session visible in the left rail: register its folder,
	 * create or reuse a conversation, and mark it active.
	 */
	async ensureTaskConversation(params: {
		sessionId: string
		title?: string
		workspacePath?: string
		folderPath?: string
	}): Promise<ParallelConversation> {
		await this.getFolders()
		await this.loadConversations()
		const workspacePath = params.workspacePath || params.folderPath || this.provider.cwd
		const folderPath = params.folderPath || this.folderPathForPath(workspacePath)
		if (folderPath) {
			await this.registerMainFolder(folderPath)
		}
		const existing = this.conversationForSession(params.sessionId)
		if (existing) {
			await this.setActiveConversation(existing.id)
			if (params.title && !existing.title) {
				await this.bindConversation(existing.id, params.sessionId, params.title)
			}
			const refreshed = await this.getConversation(existing.id)
			return refreshed ?? existing
		}
		return this.createConversation(folderPath, {
			sessionId: params.sessionId,
			title: params.title,
			workspacePath,
		})
	}

	/** Binds a conversation to its Task and records the display title. */
	async bindConversation(id: string, sessionId: string, title?: string): Promise<void> {
		await this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			this.conversations = (this.conversations ?? []).map((c) =>
				c.id === id
					? { ...c, sessionId, title: title ?? c.title, lastActiveAt: Date.now(), completedAt: undefined }
					: c,
			)
			this.conversations = this.dedupeConversations(this.conversations)
			this.conversationsDirty = true
			await this.persistConversations()
			void this.broadcast()
		})
	}

	/** Mark a conversation as having a green completion summary. */
	async markConversationCompleted(sessionId: string): Promise<void> {
		await this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			const now = Date.now()
			this.conversations = (this.conversations ?? []).map((c) =>
				c.sessionId === sessionId ? { ...c, completedAt: now, lastActiveAt: now } : c,
			)
			for (const state of this.sessions.values()) {
				if (state.info.sessionId === sessionId || state.info.taskId === sessionId) {
					if (state.info.status === "running") {
						state.info.status = "completed"
						state.info.endedAt = now
					}
				}
			}
			this.conversationsDirty = true
			await this.persistConversations()
			void this.broadcast()
		})
	}

	/** Re-parents a not-yet-started conversation after a manual workspace switch. */
	async updateConversationFolder(id: string, folderPath: string): Promise<void> {
		await this.updateConversationWorkspace(id, this.folderPathForPath(folderPath), folderPath)
	}

	async updateConversationWorkspace(id: string, folderPath: string, workspacePath: string): Promise<void> {
		await this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			this.conversations = (this.conversations ?? []).map((c) =>
				c.id === id ? { ...c, folderPath, workspacePath, lastActiveAt: Date.now() } : c,
			)
			this.conversationsDirty = true
			await this.persistConversations()
			void this.broadcast()
		})
	}

	/**
	 * Bind a session to the workspace its task now runs in: reuse the existing
	 * conversation or create one, then re-parent it. Without this, switching a
	 * workspace for a session that has no conversation yet silently drops it
	 * from the left rail (kilocode_change).
	 */
	async syncSessionWorkspace(sessionId: string, workspacePath: string): Promise<void> {
		if (!sessionId || !workspacePath) {
			return
		}
		const folderPath = this.folderPathForPath(workspacePath)
		const existing = this.conversationForSession(sessionId)
		const conversation =
			existing ??
			(await this.ensureTaskConversation({
				sessionId,
				workspacePath,
				folderPath,
			}))
		await this.updateConversationWorkspace(conversation.id, folderPath, workspacePath)
	}

	/** Live occupants already writing in this workspace, excluding the caller. */
	async occupantsOf(
		workspacePath: string,
		except?: { taskId?: string; conversationId?: string },
	): Promise<WorkspaceOccupant[]> {
		await this.conversationWrite
		await this.loadConversations()
		await this.registry.load()
		const liveTasks = typeof this.provider.getLiveTasks === "function" ? this.provider.getLiveTasks() : []
		return collectWorkspaceOccupants({
			workspacePath,
			conversations: this.conversations ?? [],
			runningTasks: liveTasks,
			runningSubagents: this.listRunning().map((session) => ({
				sessionId: session.info.sessionId,
				workspacePath: session.info.workspacePath,
				workspaceName: session.info.workspaceName,
				label: session.info.label,
			})),
			workspaces: this.annotatedWorkspaces(),
			except,
		})
	}

	async isWorkspaceOccupied(
		workspacePath: string,
		except?: { taskId?: string; conversationId?: string },
	): Promise<boolean> {
		return (await this.occupantsOf(workspacePath, except)).length > 0
	}

	/** After a workspace is deleted, keep its conversations under the folder's main workspace. */
	async moveConversationsToWorkspace(fromWorkspacePath: string, toWorkspacePath: string): Promise<void> {
		await this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			this.conversations = (this.conversations ?? []).map((c) =>
				(c.workspacePath ?? c.folderPath) === fromWorkspacePath
					? { ...c, workspacePath: toWorkspacePath, lastActiveAt: Date.now() }
					: c,
			)
			this.conversationsDirty = true
			await this.persistConversations()
			void this.broadcast()
		})
	}

	/** Permanently drop conversations bound to a deleted history task. */
	async deleteConversationsForSession(sessionId: string): Promise<ParallelConversation[]> {
		return this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			const removed = (this.conversations ?? []).filter((conversation) => conversation.sessionId === sessionId)
			if (removed.length === 0) {
				return removed
			}
			const removedIds = new Set(removed.map((conversation) => conversation.id))
			this.conversations = (this.conversations ?? []).filter((conversation) => !removedIds.has(conversation.id))
			this.conversationsDirty = true
			if (this.activeConversationId && removedIds.has(this.activeConversationId)) {
				await this.setActiveConversation(this.conversations[0]?.id)
			}
			await this.persistConversations()
			void this.broadcast()
			return removed
		})
	}

	/** Permanently drop conversations that live in a workspace (used by "delete all"). */
	async deleteConversationsInWorkspace(workspacePath: string): Promise<ParallelConversation[]> {
		return this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			const removed = (this.conversations ?? []).filter(
				(conversation) => (conversation.workspacePath ?? conversation.folderPath) === workspacePath,
			)
			const removedIds = new Set(removed.map((conversation) => conversation.id))
			this.conversations = (this.conversations ?? []).filter((conversation) => !removedIds.has(conversation.id))
			this.conversationsDirty = true
			if (this.activeConversationId && removedIds.has(this.activeConversationId)) {
				await this.setActiveConversation(this.conversations[0]?.id)
			}
			await this.persistConversations()
			void this.broadcast()
			return removed
		})
	}

	/** Archives a conversation (hidden in the sidebar until unarchived). */
	async setConversationArchived(id: string, archived: boolean): Promise<void> {
		await this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			this.conversations = (this.conversations ?? []).map((c) =>
				c.id === id ? { ...c, archivedAt: archived ? Date.now() : undefined } : c,
			)
			this.conversationsDirty = true
			await this.persistConversations()
			void this.broadcast()
		})
	}

	async renameConversation(id: string, title: string): Promise<void> {
		await this.enqueueConversationWrite(async () => {
			await this.loadConversations()
			const trimmed = title.trim()
			this.conversations = (this.conversations ?? []).map((c) =>
				c.id === id ? { ...c, title: trimmed || undefined, lastActiveAt: Date.now() } : c,
			)
			this.conversationsDirty = true
			await this.persistConversations()
			void this.broadcast()
		})
	}

	async listConversations(includeArchived = false): Promise<ParallelConversation[]> {
		await this.conversationWrite
		const list = await this.loadConversations()
		return [...list].filter((c) => includeArchived || !c.archivedAt).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
	}

	async broadcast(): Promise<void> {
		if (this.workspacesHydrated) {
			await this.registry.prune()
			this.watchWorktreeFolders()
		} else {
			await this.hydrateRegisteredWorkspaces()
		}
		await this.reloadConversationsFromStorage()
		const sessions = [...this.sessions.values()].map((s) => ({ ...s.info }))
		const liveTasks = typeof this.provider.getLiveTasks === "function" ? this.provider.getLiveTasks() : []
		for (const task of liveTasks) {
			const isActivelyRunning = task.isActivelyRunning ?? task.isStreaming
			if (!isActivelyRunning) {
				continue
			}
			if (sessions.some((session) => session.sessionId === task.taskId || session.taskId === task.taskId)) {
				continue
			}
			const conversation = this.conversationForSession(task.taskId)
			if (!conversation || conversation.completedAt) {
				continue
			}
			sessions.push({
				sessionId: task.taskId,
				taskId: task.taskId,
				parentTaskId: conversation.id,
				label: conversation.title ?? conversation.id,
				task: conversation.title ?? conversation.id,
				status: "running",
				workspacePath: conversation.workspacePath ?? task.cwd,
				startedAt: conversation.lastActiveAt ?? Date.now(),
			})
		}
		const folders = await this.getFolders()
		const workspaces: ParallelWorkspace[] = this.annotatedWorkspaces()
		const conversations = await this.listConversations(true)
		if (sessions.length === 0 && workspaces.length === 0 && folders.length === 0 && conversations.length === 0) {
			return
		}
		await this.provider
			.postMessageToWebview({
				type: "parallelSessionsUpdated",
				parallelSessions: sessions,
				parallelWorkspaces: workspaces,
				parallelFolders: folders,
				parallelConversations: conversations,
				parallelActiveConversationId: this.activeConversationId,
			})
			.catch(() => undefined)
	}
}
