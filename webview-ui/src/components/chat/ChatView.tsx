import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { useDeepCompareEffect, useEvent } from "react-use"
import debounce from "debounce"
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso"
import removeMd from "remove-markdown"
import { VSCodeButton as Button } from "@vscode/webview-ui-toolkit/react" // kilocode_change: do not use rounded Roo buttons
import useSound from "use-sound"
import { LRUCache } from "lru-cache"
import { Trans } from "react-i18next"

import { useDebounceEffect } from "@src/utils/useDebounceEffect"
import { appendImages } from "@src/utils/imageUtils"

import type { ClineAsk, ClineSayTool, ClineMessage, ExtensionMessage, AudioType } from "@roo-code/types"
import { commandExecutionStatusSchema } from "@roo-code/types"

import { findLast } from "@roo/array"
import { SuggestionItem } from "@roo-code/types"
import { combineApiRequests } from "@roo/combineApiRequests"
import { combineCommandSequences } from "@roo/combineCommandSequences"
import { getApiMetrics } from "@roo/getApiMetrics"
import { getAllModes } from "@roo/modes"
import { ProfileValidator } from "@roo/ProfileValidator"
import { getLatestTodo } from "@roo/todo"

import { safeJsonParse } from "@roo/core"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useSelectedModel } from "@src/components/ui/hooks/useSelectedModel"
// import RooHero from "@src/components/welcome/RooHero" // kilocode_change: unused
// import RooTips from "@src/components/welcome/RooTips" // kilocode_change: unused
import { StandardTooltip } from "@src/components/ui"

// import VersionIndicator from "../common/VersionIndicator" // kilocode_change: unused
// kilocode_change: commercial organization selector removed from Deeptask.
// import { useTaskSearch } from "../history/useTaskSearch" // kilocode_change: unused
// import { CloudUpsellDialog } from "@src/components/cloud/CloudUpsellDialog" // kilocode_change: unused

import TelemetryBanner from "../common/TelemetryBanner"
import { GitHubStarButton } from "../common/GitHubStarButton" // kilocode_change
import HistoryPreview from "../history/HistoryPreview"
import Announcement from "./Announcement"
import BrowserActionRow from "./BrowserActionRow"
import BrowserSessionStatusRow from "./BrowserSessionStatusRow"
import ChatRow from "./ChatRow"
import { ChatTextArea } from "./ChatTextArea"
// import TaskHeader from "./TaskHeader"// kilocode_change
import KiloTaskHeader from "../kilocode/KiloTaskHeader" // kilocode_change
import AutoApproveMenu from "./AutoApproveMenu"
import BottomControls from "../kilocode/BottomControls" // kilocode_change
// kilocode_change start: parallel subagents & workspaces
import { ParallelRail } from "../kilocode/parallel/ParallelRail"
import { resolveParallelSelectTarget } from "../kilocode/parallel/resolveParallelSelect"
import { UserMessageRail } from "../kilocode/parallel/UserMessageRail"
import { WorkspaceBar } from "../kilocode/parallel/WorkspaceBar"
// kilocode_change end
import SystemPromptWarning from "./SystemPromptWarning"
// import ProfileViolationWarning from "./ProfileViolationWarning" kilocode_change: unused
import { CheckpointWarning } from "./CheckpointWarning"
import { IdeaSuggestionsBox } from "../kilocode/chat/IdeaSuggestionsBox" // kilocode_change
import { KilocodeNotifications } from "../kilocode/KilocodeNotifications" // kilocode_change
import { ReviewScopeSelector, type ReviewScopeInfo } from "./ReviewScopeSelector" // kilocode_change: Review mode
import { buildDocLink } from "@/utils/docLinks"
// import DismissibleUpsell from "../common/DismissibleUpsell" // kilocode_change: unused
// import { useCloudUpsell } from "@src/hooks/useCloudUpsell" // kilocode_change: unused
// import { Cloud } from "lucide-react" // kilocode_change: unused

export interface ChatViewProps {
	isHidden: boolean
	showAnnouncement: boolean
	hideAnnouncement: () => void
}

export interface ChatViewRef {
	acceptInput: () => void
	focusInput: () => void // kilocode_change
}

export const MAX_IMAGES_PER_MESSAGE = 20 // This is the Anthropic limit.

const platform = navigator.platform.toUpperCase()
const isMac = platform.includes("MAC")
const isLinux = platform.includes("LINUX")

// kilocode_change start: Deeptask home logo component
const KiloLogo = () => {
	const iconsBaseUri = (window as any).ICONS_BASE_URI || ""
	const isLightTheme =
		document.body.classList.contains("vscode-light") ||
		document.body.classList.contains("vscode-high-contrast-light")
	const iconFile = isLightTheme ? "kilo-light.svg" : "kilo-dark.svg"
	return (
		<div className="flex items-center justify-center" style={{ width: "56px", height: "56px", margin: "0 auto" }}>
			<img
				src={`${iconsBaseUri}/${iconFile}`}
				alt="Deeptask"
				className="w-full h-full object-contain"
				style={{ opacity: 0.85 }}
			/>
		</div>
	)
}
// kilocode_change end

const ChatViewComponent: React.ForwardRefRenderFunction<ChatViewRef, ChatViewProps> = (
	{ isHidden, showAnnouncement, hideAnnouncement },
	ref,
) => {
	const isMountedRef = useRef(true)

	const [audioBaseUri] = useState(() => {
		const w = window as any
		return w.AUDIO_BASE_URI || ""
	})

	const { t } = useAppTranslation()
	const modeShortcutText = `${isMac ? "⌘" : "Ctrl"} + . ${t("chat:forNextMode")}, ${isMac ? "⌘" : "Ctrl"} + Shift + . ${t("chat:forPreviousMode")}`

	const {
		clineMessages: messages,
		currentTaskItem,
		currentTaskTodos,
		taskHistoryFullLength, // kilocode_change
		taskHistoryVersion, // kilocode_change
		apiConfiguration,
		organizationAllowList,
		mode,
		setMode,
		alwaysAllowModeSwitch,
		showAutoApproveMenu, // kilocode_change
		enableCheckpoints, // kilocode_change
		customModes,
		telemetrySetting,
		hasSystemPromptOverride,
		historyPreviewCollapsed, // kilocode_change
		soundEnabled,
		soundVolume,
		// cloudIsAuthenticated, // kilocode_change
		sendMessageOnEnter, // kilocode_change
		isBrowserSessionActive,
	} = useExtensionState()

	const messagesRef = useRef(messages)
	// kilocode_change: reject accidental duplicate submits before host state can round-trip.
	const lastSubmittedMessageRef = useRef<{ signature: string; timestamp: number }>()

	useEffect(() => {
		messagesRef.current = messages
	}, [messages])

	// Leaving this less safe version here since if the first message is not a
	// task, then the extension is in a bad state and needs to be debugged (see
	// Cline.abort).
	const task = useMemo(() => messages.at(0), [messages])

	// kilocode_change start
	// Initialize expanded state based on the persisted setting (default to expanded if undefined)
	const [isExpanded, setIsExpanded] = useState(
		historyPreviewCollapsed === undefined ? true : !historyPreviewCollapsed,
	)

	const toggleExpanded = useCallback(() => {
		const newState = !isExpanded
		setIsExpanded(newState)
		// Send message to extension to persist the new collapsed state
		vscode.postMessage({ type: "setHistoryPreviewCollapsed", bool: !newState })
	}, [isExpanded])
	// kilocode_change end

	const latestTodos = useMemo(() => {
		// First check if we have initial todos from the state (for new subtasks)
		if (currentTaskTodos && currentTaskTodos.length > 0) {
			// Check if there are any todo updates in messages
			const messageBasedTodos = getLatestTodo(messages)
			// If there are message-based todos, they take precedence (user has updated them)
			if (messageBasedTodos && messageBasedTodos.length > 0) {
				return messageBasedTodos
			}
			// Otherwise use the initial todos from state
			return currentTaskTodos
		}
		// Fall back to extracting from messages
		return getLatestTodo(messages)
	}, [messages, currentTaskTodos])

	// kilocode_change: the host message history is the only rendered source of truth.
	// Edited resends must not create a temporary local row because the rewind can make
	// the pre-edit text look like a queued message before the accepted replacement arrives.
	const modifiedMessages = useMemo(() => combineApiRequests(combineCommandSequences(messages.slice(1))), [messages])

	// Has to be after api_req_finished are all reduced into api_req_started messages.
	const apiMetrics = useMemo(() => getApiMetrics(modifiedMessages), [modifiedMessages])

	const [inputValue, setInputValue] = useState("")
	const inputValueRef = useRef(inputValue)
	const textAreaRef = useRef<HTMLTextAreaElement>(null)
	const [sendingDisabled, setSendingDisabled] = useState(false)
	const [selectedImages, setSelectedImages] = useState<string[]>([])

	// We need to hold on to the ask because useEffect > lastMessage will always
	// let us know when an ask comes in and handle it, but by the time
	// handleMessage is called, the last message might not be the ask anymore
	// (it could be a say that followed).
	const [clineAsk, setClineAsk] = useState<ClineAsk | undefined>(undefined)
	const [enableButtons, setEnableButtons] = useState<boolean>(false)
	const [primaryButtonText, setPrimaryButtonText] = useState<string | undefined>(undefined)
	const [secondaryButtonText, setSecondaryButtonText] = useState<string | undefined>(undefined)
	const [didClickCancel, setDidClickCancel] = useState(false)
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})
	const prevExpandedRowsRef = useRef<Record<number, boolean>>()
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	// kilocode_change start: preserve explicit user scroll intent during streaming output
	const chatScrollerRef = useRef<HTMLElement | null>(null)
	const stickyFollowRef = useRef<boolean>(true)
	const followOutputFrameRef = useRef<number>()
	const lastTouchYRef = useRef<number>()
	const pinnedJumpTsRef = useRef<number | null>(null)
	// kilocode_change end
	const [showScrollToBottom, setShowScrollToBottom] = useState(false)
	const [isAtBottom, setIsAtBottom] = useState(false)
	const lastTtsRef = useRef<string>("")
	const [wasStreaming, setWasStreaming] = useState<boolean>(false)
	const [checkpointWarning, setCheckpointWarning] = useState<
		{ type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"; timeout: number } | undefined
	>(undefined)
	const [isCondensing, setIsCondensing] = useState<boolean>(false)
	const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
	const everVisibleMessagesTsRef = useRef<LRUCache<number, boolean>>(
		new LRUCache({
			max: 100,
			ttl: 1000 * 60 * 5,
		}),
	)
	const autoApproveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const userRespondedRef = useRef<boolean>(false)
	// kilocode_change start
	// Keep live shell IDs in both a ref (sync checks) and state (re-render isStreaming /
	// button visibility when start/exit events arrive).
	const activeCommandExecutionIdsRef = useRef<Set<string>>(new Set())
	// Shell exit can precede the final drained output. Tombstones prevent late output
	// from resurrecting Continue/Terminate controls for an already settled command.
	const settledCommandExecutionIdsRef = useRef<Set<string>>(new Set())
	const [activeCommandCount, setActiveCommandCount] = useState(0)
	// A task has at most one terminal command in flight. This task-level barrier handles
	// providers that deliver an exit event with a different/missing execution ID, then
	// replay a stale started/output event after the shell has already exited.
	const commandExitBarrierRef = useRef(false)
	// kilocode_change end
	const currentAskTsRef = useRef<number | undefined>(undefined) // kilocode_change
	const [currentFollowUpTs, setCurrentFollowUpTs] = useState<number | null>(null)
	// kilocode_change: keep map for `taskWithAggregatedCosts` updates (even if not currently displayed)
	const [_aggregatedCostsMap, setAggregatedCostsMap] = useState<
		Map<
			string,
			{
				totalCost: number
				ownCost: number
				childrenCost: number
			}
		>
	>(new Map())

	// kilocode_change start: Review mode state
	const [showReviewScopeSelector, setShowReviewScopeSelector] = useState(false)
	const [reviewScopeInfo, setReviewScopeInfo] = useState<ReviewScopeInfo | null>(null)
	// kilocode_change end: Review mode state

	const clineAskRef = useRef(clineAsk)
	useEffect(() => {
		clineAskRef.current = clineAsk
	}, [clineAsk])

	// kilocode_change start: unused
	// const {
	// 	isOpen: isUpsellOpen,
	// 	openUpsell,
	// 	closeUpsell,
	// 	handleConnect,
	// } = useCloudUpsell({
	// 	autoOpenOnAuth: false,
	// })
	// kilocode_change end

	// Keep inputValueRef in sync with inputValue state
	useEffect(() => {
		inputValueRef.current = inputValue
	}, [inputValue])

	// Compute whether auto-approval is paused (user is typing in a followup)
	const isFollowUpAutoApprovalPaused = useMemo(() => {
		return !!(inputValue && inputValue.trim().length > 0 && clineAsk === "followup")
	}, [inputValue, clineAsk])

	// Cancel auto-approval timeout when user starts typing
	useEffect(() => {
		// Only send cancel if there's actual input (user is typing)
		// and we have a pending follow-up question
		if (isFollowUpAutoApprovalPaused) {
			vscode.postMessage({ type: "cancelAutoApproval" })
		}
	}, [isFollowUpAutoApprovalPaused])

	useEffect(() => {
		isMountedRef.current = true
		return () => {
			isMountedRef.current = false
		}
	}, [])

	const isProfileDisabled = useMemo(
		() => !!apiConfiguration && !ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList),
		[apiConfiguration, organizationAllowList],
	)

	// UI layout depends on the last 2 messages (since it relies on the content
	// of these messages, we are deep comparing) i.e. the button state after
	// hitting button sets enableButtons to false,  and this effect otherwise
	// would have to true again even if messages didn't change.
	const lastMessage = useMemo(() => messages.at(-1), [messages])
	const secondLastMessage = useMemo(() => messages.at(-2), [messages])

	const volume = typeof soundVolume === "number" ? soundVolume : 0.5
	const [playNotification] = useSound(`${audioBaseUri}/notification.wav`, { volume, soundEnabled })
	const [playCelebration] = useSound(`${audioBaseUri}/celebration.wav`, { volume, soundEnabled })
	const [playProgressLoop] = useSound(`${audioBaseUri}/progress_loop.wav`, { volume, soundEnabled })

	const playSound = useCallback(
		(audioType: AudioType) => {
			if (!soundEnabled) {
				return
			}

			// kilocode_change start
			// Linux Electron webviews can block event-driven WebAudio playback before a
			// user gesture. Route through the extension host's PipeWire/Pulse/ALSA player.
			if (isLinux) {
				vscode.postMessage({ type: "playSound", audioType, value: volume })
				return
			}
			// kilocode_change end

			switch (audioType) {
				case "notification":
					playNotification()
					break
				case "celebration":
					playCelebration()
					break
				case "progress_loop":
					playProgressLoop()
					break
				default:
					console.warn(`Unknown audio type: ${audioType}`)
			}
		},
		[soundEnabled, volume, playNotification, playCelebration, playProgressLoop],
	)

	function playTts(text: string) {
		vscode.postMessage({ type: "playTts", text })
	}

	useDeepCompareEffect(() => {
		// if last message is an ask, show user ask UI
		// if user finished a task, then start a new task with a new conversation history since in this moment that the extension is waiting for user response, the user could close the extension and the conversation history would be lost.
		// basically as long as a task is active, the conversation history will be persisted
		if (lastMessage) {
			switch (lastMessage.type) {
				case "ask":
					// Reset user response flag when a new ask arrives to allow auto-approval
					userRespondedRef.current = false
					currentAskTsRef.current = lastMessage.ts // kilocode_change
					const isPartial = lastMessage.partial === true
					switch (lastMessage.ask) {
						case "api_req_failed":
							playSound("progress_loop")
							setSendingDisabled(true)
							setClineAsk("api_req_failed")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:retry.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "mistake_limit_reached":
							playSound("progress_loop")
							setSendingDisabled(false)
							setClineAsk("mistake_limit_reached")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedAnyways.title"))
							setSecondaryButtonText(t("chat:startNewTask.title"))
							break
						case "followup":
							setSendingDisabled(isPartial)
							setClineAsk("followup")
							// setting enable buttons to `false` would trigger a focus grab when
							// the text area is enabled which is undesirable.
							// We have no buttons for this tool, so no problem having them "enabled"
							// to workaround this issue.  See #1358.
							setEnableButtons(true)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "tool":
							// kilocode_change start
							// Auto-approved tool asks are already answered by the host. Keep
							// their buttons hidden so a late click cannot be misrouted as a
							// fresh empty continuation after the switch has already started.
							if (lastMessage.isAnswered) {
								setSendingDisabled(false)
								setClineAsk(undefined)
								setEnableButtons(false)
								setPrimaryButtonText(undefined)
								setSecondaryButtonText(undefined)
								break
							}
							// kilocode_change end
							setSendingDisabled(isPartial)
							setClineAsk("tool")
							setEnableButtons(!isPartial)
							const tool = JSON.parse(lastMessage.text || "{}") as ClineSayTool
							switch (tool.tool) {
								case "editedExistingFile":
								case "appliedDiff":
								case "newFileCreated":
								case "generateImage":
									setPrimaryButtonText(t("chat:save.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
								case "finishTask":
									setPrimaryButtonText(t("chat:completeSubtaskAndReturn"))
									setSecondaryButtonText(undefined)
									break
								case "readFile":
									if (tool.batchFiles && Array.isArray(tool.batchFiles)) {
										setPrimaryButtonText(t("chat:read-batch.approve.title"))
										setSecondaryButtonText(t("chat:read-batch.deny.title"))
									} else {
										setPrimaryButtonText(t("chat:approve.title"))
										setSecondaryButtonText(t("chat:reject.title"))
									}
									break
								default:
									setPrimaryButtonText(t("chat:approve.title"))
									setSecondaryButtonText(t("chat:reject.title"))
									break
							}
							break
						case "browser_action_launch":
							setSendingDisabled(isPartial)
							setClineAsk("browser_action_launch")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command":
							// kilocode_change start
							// An answered command ask is not evidence that a shell is still live.
							// The commandExecutionStatus exit event clears the live set, so only
							// that set may keep Continue/Terminate visible. Otherwise a stale
							// answered command row re-lights the run/terminate controls after the
							// tool finished.
							if (lastMessage.isAnswered) {
								setSendingDisabled(false)
								setClineAsk(undefined)
								setEnableButtons(false)
								setPrimaryButtonText(undefined)
								setSecondaryButtonText(undefined)
								break
							}
							if (activeCommandExecutionIdsRef.current.size > 0) {
								setSendingDisabled(false)
								setClineAsk("command_output")
								setEnableButtons(true)
								setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
								setSecondaryButtonText(t("chat:killCommand.title"))
								break
							}
							// kilocode_change end
							setSendingDisabled(isPartial)
							setClineAsk("command")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:runCommand.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "command_output":
							// kilocode_change start
							// A command_output ask is only actionable while its execution is live.
							// The host may replay an unanswered historical ask after the shell has
							// already emitted exited; allowing that row to restore controls leaves
							// the UI stuck on Continue/Terminate forever.
							if (activeCommandExecutionIdsRef.current.size > 0) {
								setSendingDisabled(false)
								setClineAsk("command_output")
								setEnableButtons(true)
								setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
								setSecondaryButtonText(
									activeCommandExecutionIdsRef.current.size > 0
										? t("chat:killCommand.title")
										: undefined,
								)
							} else {
								setClineAsk(undefined)
								setEnableButtons(false)
								setPrimaryButtonText(undefined)
								setSecondaryButtonText(undefined)
							}
							// kilocode_change end
							break
						case "use_mcp_server":
							setSendingDisabled(isPartial)
							setClineAsk("use_mcp_server")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:approve.title"))
							setSecondaryButtonText(t("chat:reject.title"))
							break
						case "completion_result":
							// Extension waiting for feedback, but we can just present a new task button.
							if (!isPartial) {
								playSound("celebration")
							}
							setSendingDisabled(isPartial)
							setClineAsk("completion_result")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							break
						case "resume_task":
							// kilocode_change start
							// Returning from settings (e.g. after fixing an API key) can leave the
							// same resume_task row as lastMessage. Always re-light Resume even if
							// the row was briefly marked answered during a failed click/save race.
							setSendingDisabled(false)
							setClineAsk("resume_task")
							setEnableButtons(true)
							// For completed subtasks, show "Start New Task" instead of "Resume"
							// A subtask is considered completed if:
							// - It has a parentTaskId AND
							// - Its messages contain a completion_result (either ask or say)
							const isCompletedSubtask =
								currentTaskItem?.parentTaskId &&
								messages.some(
									(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
								)
							if (isCompletedSubtask) {
								setPrimaryButtonText(t("chat:startNewTask.title"))
								setSecondaryButtonText(undefined)
							} else {
								setPrimaryButtonText(t("chat:resumeTask.title"))
								setSecondaryButtonText(t("chat:terminate.title"))
							}
							setDidClickCancel(false) // special case where we reset the cancel button state
							// kilocode_change end
							break
						case "resume_completed_task":
							setSendingDisabled(false)
							setClineAsk("resume_completed_task")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:startNewTask.title"))
							setSecondaryButtonText(undefined)
							setDidClickCancel(false)
							break
						// kilocode_change begin
						case "report_bug":
							if (!isPartial) {
								playSound("notification")
							}
							setSendingDisabled(isPartial)
							setClineAsk("report_bug")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("chat:reportBug.title"))
							break
						case "condense":
							setSendingDisabled(isPartial)
							setClineAsk("condense")
							setEnableButtons(!isPartial)
							setPrimaryButtonText(t("kilocode:chat.condense.condenseConversation"))
							setSecondaryButtonText(undefined)
							break
						// kilocode_change end
					}
					break
				case "say":
					// Don't want to reset since there could be a "say" after
					// an "ask" while ask is waiting for response.
					switch (lastMessage.say) {
						case "api_req_retry_delayed":
						case "api_req_rate_limit_wait":
							setSendingDisabled(true)
							break
						case "api_req_started":
							// Clear button state when a new API request starts
							// This fixes buttons persisting when the task continues
							setSendingDisabled(true)
							setSelectedImages([])
							setClineAsk(undefined)
							setEnableButtons(false)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
							break
						case "command_output":
							// kilocode_change start
							// A final non-interactive output row is evidence, not a wait point.
							// Preserve controls only while an execution ID is still live; otherwise
							// clear stale command UI so the tool result can immediately continue.
							if (!lastMessage.partial && activeCommandExecutionIdsRef.current.size > 0) {
								setSendingDisabled(false)
								setClineAsk("command_output")
								setEnableButtons(true)
								setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
								setSecondaryButtonText(t("chat:killCommand.title"))
							} else if (!lastMessage.partial) {
								setClineAsk(undefined)
								setEnableButtons(false)
								setPrimaryButtonText(undefined)
								setSecondaryButtonText(undefined)
							}
							// kilocode_change end
							break
						case "error":
							// kilocode_change start
							// A tool/model failure is a recovery boundary, not a terminal UI state.
							// Reuse resume_task button semantics so an empty Resume click starts a
							// fresh continuation, while Start New Task remains an explicit escape.
							if (!lastMessage.partial) {
								setSendingDisabled(false)
								setClineAsk("resume_task")
								currentAskTsRef.current = undefined
								setEnableButtons(true)
								setPrimaryButtonText(t("chat:resumeTask.title"))
								setSecondaryButtonText(t("chat:startNewTask.title"))
								setDidClickCancel(false)
							}
							// kilocode_change end
							break
						case "api_req_finished":
						case "text":
						case "browser_action":
						case "browser_action_result":
						case "mcp_server_request_started":
						case "mcp_server_response":
							// kilocode_change start
							// A settled non-ask assistant text/tool result must leave the
							// composer interactive. Soft completion and ordinary text answers
							// both end the model turn without a new ask, so clear stale busy
							// state here; otherwise the next user send never continues work.
							if (!lastMessage.partial) {
								setSendingDisabled(false)
								setClineAsk(undefined)
								setEnableButtons(false)
								setPrimaryButtonText(undefined)
								setSecondaryButtonText(undefined)
							}
							// kilocode_change end
							break
						case "completion_result":
							// Soft completion is a green final-looking answer that must not
							// end the Deeptask lifecycle. Keep the composer open for the next
							// user instruction instead of waiting on a completed-task ask.
							if (!lastMessage.partial) {
								setSendingDisabled(false)
								setClineAsk(undefined)
								setEnableButtons(false)
								setPrimaryButtonText(undefined)
								setSecondaryButtonText(undefined)
							}
							break
					}
					break
			}
		}
	}, [lastMessage, secondLastMessage])

	// Update button text when messages change (e.g., completion_result is added) for subtasks in resume_task state
	useEffect(() => {
		if (clineAsk === "resume_task" && currentTaskItem?.parentTaskId) {
			const hasCompletionResult = messages.some(
				(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
			)
			if (hasCompletionResult) {
				setPrimaryButtonText(t("chat:startNewTask.title"))
				setSecondaryButtonText(undefined)
			}
		}
	}, [clineAsk, currentTaskItem?.parentTaskId, messages, t])

	useEffect(() => {
		if (messages.length === 0) {
			// kilocode_change start
			// Returning to the home / history-list screen must drop any leftover live-shell
			// tracking. Otherwise the first typed message is misrouted as terminal continue
			// and handleChatReset() only empties the input with no new task.
			activeCommandExecutionIdsRef.current.clear()
			settledCommandExecutionIdsRef.current.clear()
			commandExitBarrierRef.current = false
			setActiveCommandCount(0)
			// kilocode_change end
			setSendingDisabled(false)
			setClineAsk(undefined)
			currentAskTsRef.current = undefined // kilocode_change
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		}
	}, [messages.length])

	useEffect(() => {
		// Reset UI states only when task changes
		setExpandedRows({})
		everVisibleMessagesTsRef.current.clear() // Clear for new task
		setCurrentFollowUpTs(null) // Clear follow-up answered state for new task
		setIsCondensing(false) // Reset condensing state when switching tasks
		// Note: sendingDisabled is not reset here as it's managed by message effects
		// kilocode_change start
		// Active command IDs belong to the previous task's shell lifecycle. Keep them
		// across message rows, but never across task switches or home-screen returns.
		activeCommandExecutionIdsRef.current.clear()
		settledCommandExecutionIdsRef.current.clear()
		commandExitBarrierRef.current = false
		setActiveCommandCount(0)
		// kilocode_change end

		// Clear any pending auto-approval timeout from previous task
		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		// Reset user response flag for new task
		userRespondedRef.current = false

		// A task switch can happen immediately after condensation or completion while
		// the old terminal still owns focus. Restore the composer after React commits
		// the new task state so the first instruction cannot enter the shell.
		if (!isHidden && task?.ts) {
			const focusTimer = window.setTimeout(() => {
				textAreaRef.current?.focus()
			}, 0)
			return () => window.clearTimeout(focusTimer)
		}
	}, [task?.ts, isHidden])

	const taskTs = task?.ts

	// Request aggregated costs when task changes and has childIds
	useEffect(() => {
		if (taskTs && currentTaskItem?.childIds && currentTaskItem.childIds.length > 0) {
			vscode.postMessage({
				type: "getTaskWithAggregatedCosts",
				text: currentTaskItem.id,
			})
		}
	}, [taskTs, currentTaskItem?.id, currentTaskItem?.childIds])

	useEffect(() => {
		if (isHidden) {
			everVisibleMessagesTsRef.current.clear()
			return
		}

		// kilocode_change start
		// Returning from settings (API key save, profile edit, etc.) keeps the same
		// lastMessage object, so the deep-compare effect may not re-run. Re-derive
		// actionable controls from the latest row so Resume/Retry cannot stay blank.
		const latest = messagesRef.current.at(-1)
		if (!latest) {
			setSendingDisabled(false)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
			return
		}

		if (latest.type === "ask" && latest.partial !== true) {
			currentAskTsRef.current = latest.ts
			switch (latest.ask) {
				case "api_req_failed":
					setSendingDisabled(true)
					setClineAsk("api_req_failed")
					setEnableButtons(true)
					setPrimaryButtonText(t("chat:retry.title"))
					setSecondaryButtonText(t("chat:startNewTask.title"))
					break
				case "resume_task": {
					setSendingDisabled(false)
					setClineAsk("resume_task")
					setEnableButtons(true)
					const isCompletedSubtask =
						currentTaskItem?.parentTaskId &&
						messagesRef.current.some(
							(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
						)
					if (isCompletedSubtask) {
						setPrimaryButtonText(t("chat:startNewTask.title"))
						setSecondaryButtonText(undefined)
					} else {
						setPrimaryButtonText(t("chat:resumeTask.title"))
						setSecondaryButtonText(t("chat:terminate.title"))
					}
					setDidClickCancel(false)
					break
				}
				case "resume_completed_task":
					setSendingDisabled(false)
					setClineAsk("resume_completed_task")
					setEnableButtons(true)
					setPrimaryButtonText(t("chat:startNewTask.title"))
					setSecondaryButtonText(undefined)
					setDidClickCancel(false)
					break
				case "mistake_limit_reached":
					setSendingDisabled(false)
					setClineAsk("mistake_limit_reached")
					setEnableButtons(true)
					setPrimaryButtonText(t("chat:proceedAnyways.title"))
					setSecondaryButtonText(t("chat:startNewTask.title"))
					break
				default:
					// Keep non-resume asks as-is; only force composer open if controls
					// were wiped into a dead empty state while the panel was hidden.
					if (!enableButtons && !primaryButtonText && sendingDisabled) {
						setSendingDisabled(false)
					}
					break
			}
		} else if (latest.type === "say" && latest.partial !== true) {
			// Settled assistant rows must leave the composer interactive after settings.
			setSendingDisabled(false)
			if (!enableButtons) {
				setClineAsk(undefined)
				setPrimaryButtonText(undefined)
				setSecondaryButtonText(undefined)
			}
		}
		// kilocode_change end
	}, [isHidden, currentTaskItem?.parentTaskId, enableButtons, primaryButtonText, sendingDisabled, t])

	useEffect(() => {
		const cache = everVisibleMessagesTsRef.current
		return () => {
			cache.clear()
		}
	}, [])

	useEffect(() => {
		const prev = prevExpandedRowsRef.current
		let wasAnyRowExpandedByUser = false
		if (prev) {
			// Check if any row transitioned from false/undefined to true
			for (const [tsKey, isExpanded] of Object.entries(expandedRows)) {
				const ts = Number(tsKey)
				if (isExpanded && !(prev[ts] ?? false)) {
					wasAnyRowExpandedByUser = true
					break
				}
			}
		}

		// Expanding a row indicates the user is browsing; disable sticky follow
		if (wasAnyRowExpandedByUser) {
			stickyFollowRef.current = false
		}

		prevExpandedRowsRef.current = expandedRows // Store current state for next comparison
	}, [expandedRows])

	const isStreaming = useMemo(() => {
		// Checking clineAsk isn't enough since messages effect may be called
		// again for a tool for example, set clineAsk to its value, and if the
		// next message is not an ask then it doesn't reset. This is likely due
		// to how much more often we're updating messages as compared to before,
		// and should be resolved with optimizations as it's likely a rendering
		// bug. But as a final guard for now, the cancel button will show if the
		// last message is not an ask.
		const isLastAsk = !!modifiedMessages.at(-1)?.ask

		const isToolCurrentlyAsking =
			isLastAsk && clineAsk !== undefined && enableButtons && primaryButtonText !== undefined

		if (isToolCurrentlyAsking) {
			return false
		}

		const lastApiReqStarted = findLast(
			modifiedMessages,
			(message: ClineMessage) => message.say === "api_req_started",
		)
		const lastCommandRelatedMessage = findLast(
			modifiedMessages,
			(message: ClineMessage) =>
				message.ask === "command" || message.ask === "command_output" || message.say === "command_output",
		)
		const hasFreshApiRequestAfterCommand =
			!!lastApiReqStarted &&
			(lastCommandRelatedMessage === undefined || lastApiReqStarted.ts > lastCommandRelatedMessage.ts)

		// kilocode_change start
		// While a shell is live or a recovery Continue is showing for command_output,
		// do NOT treat a *stale* unfinished api_req_started as "streaming". That flag
		// hides the primary Continue button (primaryButtonText && !isStreaming) and
		// leaves only Cancel — the exact "no continue button while command stuck" bug.
		//
		// But after force-continue, a *new* api_req_started may start while the shell
		// is still tracked as active. That post-continue model turn must show Cancel.
		if (
			!hasFreshApiRequestAfterCommand &&
			(activeCommandCount > 0 ||
				(clineAsk === "command_output" && enableButtons && primaryButtonText !== undefined))
		) {
			return false
		}

		// A settled command can leave the preceding API request row unfinished until
		// the final tool result is persisted. It must not keep the action row in a
		// streaming/cancel state after the command exit barrier has closed.
		if (
			!hasFreshApiRequestAfterCommand &&
			activeCommandCount === 0 &&
			settledCommandExecutionIdsRef.current.size > 0
		) {
			return false
		}
		// kilocode_change end

		const isLastMessagePartial = modifiedMessages.at(-1)?.partial === true

		if (isLastMessagePartial) {
			return true
		} else {
			if (
				lastApiReqStarted &&
				lastApiReqStarted.text !== null &&
				lastApiReqStarted.text !== undefined &&
				lastApiReqStarted.say === "api_req_started"
			) {
				const cost = JSON.parse(lastApiReqStarted.text).cost

				if (cost === undefined) {
					return true // API request has not finished yet.
				}
			}
		}

		return false
	}, [modifiedMessages, clineAsk, enableButtons, primaryButtonText, activeCommandCount])

	const markFollowUpAsAnswered = useCallback(() => {
		const lastFollowUpMessage = messagesRef.current.findLast((msg: ClineMessage) => msg.ask === "followup")
		if (lastFollowUpMessage) {
			setCurrentFollowUpTs(lastFollowUpMessage.ts)
		}
	}, [])

	// kilocode_change start
	// User input must stay actionable while the task is running. The submit button
	// should only be disabled for profile/config problems, not because a command or
	// model request is active; handleSendMessage routes busy input directly.
	const disableChatSubmit = isProfileDisabled
	// kilocode_change end

	const handleChatReset = useCallback(() => {
		// Clear any pending auto-approval timeout
		if (autoApproveTimeoutRef.current) {
			clearTimeout(autoApproveTimeoutRef.current)
			autoApproveTimeoutRef.current = null
		}
		// Reset user response flag for new message
		userRespondedRef.current = false

		// Only reset message-specific state, preserving mode.
		setInputValue("")
		setSendingDisabled(true)
		setSelectedImages([])
		setClineAsk(undefined)
		setEnableButtons(false)
		// Do not reset mode here as it should persist.
		// setPrimaryButtonText(undefined)
		// setSecondaryButtonText(undefined)
	}, [])

	/**
	 * Handles sending messages to the extension
	 * @param text - The message text to send
	 * @param images - Array of image data URLs to send with the message
	 */
	const handleSendMessage = useCallback(
		(text: string, images: string[]) => {
			text = text.trim()

			if (text || images.length > 0) {
				// kilocode_change start
				// React state and extension state both update asynchronously. A fast double
				// Enter used to post the same payload twice, producing duplicate feedback
				// cards and competing continuation/cancellation paths. Suppress only exact
				// duplicates in a short window; distinct follow-up instructions remain valid.
				const submissionSignature = JSON.stringify({ text, images })
				const submittedAt = Date.now()
				if (
					lastSubmittedMessageRef.current?.signature === submissionSignature &&
					submittedAt - lastSubmittedMessageRef.current.timestamp < 1_500
				) {
					return
				}
				lastSubmittedMessageRef.current = { signature: submissionSignature, timestamp: submittedAt }

				// Home / history list has no conversation. Always create a new task first.
				// Never let leftover activeCommand IDs or sticky busy state route the first
				// message into terminal continue / askResponse (input would only clear).
				if (messagesRef.current.length === 0) {
					userRespondedRef.current = true
					activeCommandExecutionIdsRef.current.clear()
					settledCommandExecutionIdsRef.current.clear()
					commandExitBarrierRef.current = false
					setActiveCommandCount(0)
					vscode.postMessage({ type: "newTask", text, images })
					handleChatReset()
					return
				}

				// Command output waits are special: a user message should resume immediately.
				// Only treat a live shell or an unanswered command_output ask as a wait.
				// Recovery Continue buttons can remain after the shell exits so the user has
				// a manual resume path; that UI state must NOT swallow typed text as terminal
				// feedback. Finished `say:command_output` rows are never live waits.
				//
				// If force-continue already started a fresher api_req_started while a shell
				// ID is still tracked, prefer askResponse interrupt so the model receives the
				// typed instruction instead of only a terminal wake/"continue".
				const latestMessage = messagesRef.current.at(-1)
				const hasLiveCommandExecution = activeCommandExecutionIdsRef.current.size > 0
				const hasPendingCommandOutputAsk =
					latestMessage?.type === "ask" &&
					latestMessage.ask === "command_output" &&
					latestMessage.partial !== true &&
					!latestMessage.isAnswered
				const lastApiReqStarted = findLast(
					messagesRef.current,
					(message: ClineMessage) => message.say === "api_req_started",
				)
				const lastCommandRelatedMessage = findLast(
					messagesRef.current,
					(message: ClineMessage) =>
						message.ask === "command" ||
						message.ask === "command_output" ||
						message.say === "command_output",
				)
				const hasFreshApiRequestAfterCommand =
					!!lastApiReqStarted &&
					(lastCommandRelatedMessage === undefined || lastApiReqStarted.ts > lastCommandRelatedMessage.ts)
				const isCommandOutputWait =
					(hasLiveCommandExecution && !hasFreshApiRequestAfterCommand) || hasPendingCommandOutputAsk

				if (isCommandOutputWait) {
					userRespondedRef.current = true
					// The host persists accepted feedback. Do not render a local waiting card:
					// long messages obstruct the conversation and can duplicate the host echo.
					vscode.postMessage({
						type: "terminalOperation",
						terminalOperation: "continue",
						terminalOperationText: text,
						terminalOperationImages: images,
					})
					handleChatReset()
					return
				}
				// kilocode_change end

				// When busy, route input directly without creating a local queue/feedback card.
				// The authoritative host echo appears only after the message is accepted, which
				// prevents long waiting messages from covering the active conversation.
				if ((sendingDisabled || isStreaming) && messagesRef.current.length > 0) {
					try {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "messageResponse",
							text,
							images,
							askTs: currentAskTsRef.current,
						})
						setInputValue("")
						setSelectedImages([])
					} catch (error) {
						console.error(
							`Failed to send busy feedback: ${error instanceof Error ? error.message : String(error)}`,
						)
					}

					return
				}

				// Mark that user has responded - this prevents any pending auto-approvals.
				userRespondedRef.current = true

				if (clineAskRef.current) {
					if (clineAskRef.current === "followup") {
						markFollowUpAsAnswered()
					}

					// Use clineAskRef.current
					switch (
						clineAskRef.current // Use clineAskRef.current
					) {
						case "command_output": {
							// kilocode_change start
							// Live shell waits wake the terminal. Recovery Continue buttons
							// after exit should deliver a real user continuation instead.
							// Same fresh-api guard as the early command-wait path: once a newer
							// model turn has started, do not demote typed text to terminal-only.
							const lastApiReqForCommandOutput = findLast(
								messagesRef.current,
								(message: ClineMessage) => message.say === "api_req_started",
							)
							const lastCommandForCommandOutput = findLast(
								messagesRef.current,
								(message: ClineMessage) =>
									message.ask === "command" ||
									message.ask === "command_output" ||
									message.say === "command_output",
							)
							const hasFreshApiForCommandOutput =
								!!lastApiReqForCommandOutput &&
								(lastCommandForCommandOutput === undefined ||
									lastApiReqForCommandOutput.ts > lastCommandForCommandOutput.ts)
							if (activeCommandExecutionIdsRef.current.size > 0 && !hasFreshApiForCommandOutput) {
								vscode.postMessage({
									type: "terminalOperation",
									terminalOperation: "continue",
									terminalOperationText: text,
									terminalOperationImages: images,
								})
							} else {
								vscode.postMessage({
									type: "askResponse",
									askResponse: "messageResponse",
									text,
									images,
									askTs: currentAskTsRef.current,
								})
							}
							// kilocode_change end
							break
						}
						case "followup":
						case "tool":
						case "browser_action_launch":
						case "command": // User can provide feedback to a tool or command use.
						case "use_mcp_server":
						case "completion_result": // If this happens then the user has feedback for the completion result.
						case "resume_task":
						case "resume_completed_task":
						case "mistake_limit_reached":
							vscode.postMessage({
								type: "askResponse",
								askResponse: "messageResponse",
								text,
								images,
								askTs: currentAskTsRef.current,
							})
							break
						// There is no other case that a textfield should be enabled.
					}
				} else {
					// This is a new message in an ongoing task.
					vscode.postMessage({
						type: "askResponse",
						askResponse: "messageResponse",
						text,
						images,
						askTs: currentAskTsRef.current,
					})
				}

				handleChatReset()
			}
		},
		[handleChatReset, markFollowUpAsAnswered, sendingDisabled, isStreaming], // messagesRef and clineAskRef are stable
	)

	const handleSetChatBoxMessage = useCallback(
		(text: string, images: string[]) => {
			// Avoid nested template literals by breaking down the logic
			let newValue = text

			if (inputValue !== "") {
				newValue = inputValue + " " + text
			}

			setInputValue(newValue)
			setSelectedImages([...selectedImages, ...images])
		},
		[inputValue, selectedImages],
	)

	const startNewTask = useCallback(() => vscode.postMessage({ type: "clearTask" }), [])

	// This logic depends on the useEffect[messages] above to set clineAsk,
	// after which buttons are shown and we then send an askResponse to the
	// extension.
	const handlePrimaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			switch (clineAsk) {
				case "api_req_failed":
				case "command": {
					// kilocode_change start
					// If the shell is already running, a leftover Run button must act like
					// Continue instead of replaying a settled yesButtonClicked.
					if (clineAsk === "command" && activeCommandExecutionIdsRef.current.size > 0) {
						if (trimmedInput || (images && images.length > 0)) {
							vscode.postMessage({
								type: "terminalOperation",
								terminalOperation: "continue",
								terminalOperationText: trimmedInput,
								terminalOperationImages: images,
							})
							setInputValue("")
							setSelectedImages([])
						} else {
							vscode.postMessage({ type: "terminalOperation", terminalOperation: "continue" })
						}
						break
					}
					// kilocode_change end

					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
							askTs: currentAskTsRef.current,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							askTs: currentAskTsRef.current,
						})
					}
					break
				}
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
				case "mistake_limit_reached":
				case "report_bug":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							text: trimmedInput,
							images: images,
							askTs: currentAskTsRef.current,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							askTs: currentAskTsRef.current,
						})
					}
					break
				case "resume_task":
					// For completed subtasks (tasks with a parentTaskId and a completion_result),
					// start a new task instead of resuming since the subtask is done
					const isCompletedSubtaskForClick =
						currentTaskItem?.parentTaskId &&
						messagesRef.current.some(
							(msg) => msg.ask === "completion_result" || msg.say === "completion_result",
						)
					if (isCompletedSubtaskForClick) {
						startNewTask()
					} else {
						// Only send text/images if they exist
						if (trimmedInput || (images && images.length > 0)) {
							vscode.postMessage({
								type: "askResponse",
								askResponse: "yesButtonClicked",
								text: trimmedInput,
								images: images,
								askTs: currentAskTsRef.current,
							})
							// Clear input state after sending
							setInputValue("")
							setSelectedImages([])
						} else {
							vscode.postMessage({
								type: "askResponse",
								askResponse: "yesButtonClicked",
								askTs: currentAskTsRef.current,
							})
						}
					}
					break
				case "completion_result":
				case "resume_completed_task":
					// Waiting for feedback, but we can just present a new task button
					startNewTask()
					break
				case "command_output":
					// kilocode_change start
					// Live shell: wake terminal (optionally with typed feedback).
					// After exit, recovery Continue must start a real continuation so the
					// model receives finished command output already in history, not a
					// terminal-only wake that can race an empty still-running tool path.
					if (trimmedInput || (images && images.length > 0)) {
						if (activeCommandExecutionIdsRef.current.size > 0) {
							vscode.postMessage({
								type: "terminalOperation",
								terminalOperation: "continue",
								terminalOperationText: trimmedInput,
								terminalOperationImages: images,
							})
						} else {
							vscode.postMessage({
								type: "askResponse",
								askResponse: "messageResponse",
								text: trimmedInput,
								images,
								askTs: currentAskTsRef.current,
							})
						}
						setInputValue("")
						setSelectedImages([])
					} else if (activeCommandExecutionIdsRef.current.size > 0) {
						vscode.postMessage({ type: "terminalOperation", terminalOperation: "continue" })
					} else {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "yesButtonClicked",
							askTs: currentAskTsRef.current,
						})
					}
					// kilocode_change end
					break
				// kilocode_change start
				case "condense":
					vscode.postMessage({
						type: "condense",
						text: lastMessage?.text,
					})
					break
				// kilocode_change end
			}

			setSendingDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
			setPrimaryButtonText(undefined)
			setSecondaryButtonText(undefined)
		},
		[clineAsk, startNewTask, currentTaskItem?.parentTaskId, lastMessage?.text], // kilocode_change: add lastMessage?.text
	)

	const handleSecondaryButtonClick = useCallback(
		(text?: string, images?: string[]) => {
			// Mark that user has responded
			userRespondedRef.current = true

			const trimmedInput = text?.trim()

			if (isStreaming) {
				vscode.postMessage({ type: "cancelTask" })
				setDidClickCancel(true)
				return
			}

			switch (clineAsk) {
				case "api_req_failed":
				case "mistake_limit_reached":
				case "resume_task":
					startNewTask()
					break
				case "command":
				case "tool":
				case "browser_action_launch":
				case "use_mcp_server":
					// Only send text/images if they exist
					if (trimmedInput || (images && images.length > 0)) {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							text: trimmedInput,
							images: images,
							askTs: currentAskTsRef.current,
						})
						// Clear input state after sending
						setInputValue("")
						setSelectedImages([])
					} else {
						// Responds to the API with a "This operation failed" and lets it try again
						vscode.postMessage({
							type: "askResponse",
							askResponse: "noButtonClicked",
							askTs: currentAskTsRef.current,
						})
					}
					break
				case "command_output":
					vscode.postMessage({ type: "terminalOperation", terminalOperation: "abort" })
					break
			}
			setSendingDisabled(true)
			setClineAsk(undefined)
			setEnableButtons(false)
		},
		[clineAsk, startNewTask, isStreaming],
	)

	const handleTaskCloseButtonClick = useCallback(() => startNewTask(), [startNewTask]) // kilocode_change

	const { info: model } = useSelectedModel(apiConfiguration)

	const selectImages = useCallback(() => vscode.postMessage({ type: "selectImages" }), [])

	const shouldDisableImages = !model?.supportsImages || selectedImages.length >= MAX_IMAGES_PER_MESSAGE

	const handleMessage = useCallback(
		(e: MessageEvent) => {
			const message: ExtensionMessage = e.data

			switch (message.type) {
				case "action":
					switch (message.action!) {
						case "didBecomeVisible":
							if (!isHidden && !sendingDisabled && !enableButtons) {
								textAreaRef.current?.focus()
							}
							break
						case "focusInput":
							textAreaRef.current?.focus()
							break
					}
					break
				case "selectedImages":
					// Only handle selectedImages if it's not for editing context
					// When context is "edit", ChatRow will handle the images
					if (message.context !== "edit") {
						setSelectedImages((prevImages: string[]) =>
							appendImages(prevImages, message.images, MAX_IMAGES_PER_MESSAGE),
						)
					}
					break
				case "invoke":
					switch (message.invoke!) {
						case "newChat":
							handleChatReset()
							break
						case "sendMessage":
							handleSendMessage(message.text ?? "", message.images ?? [])
							break
						case "setChatBoxMessage":
							handleSetChatBoxMessage(message.text ?? "", message.images ?? [])
							break
						case "primaryButtonClick":
							handlePrimaryButtonClick(message.text ?? "", message.images ?? [])
							break
						case "secondaryButtonClick":
							handleSecondaryButtonClick(message.text ?? "", message.images ?? [])
							break
					}
					break
				case "commandExecutionStatus": {
					const result = commandExecutionStatusSchema.safeParse(safeJsonParse(message.text, {}))
					if (result.success) {
						const { executionId, status } = result.data
						// kilocode_change start
						// A shell exit can precede the final drained output. Once an execution
						// reaches any terminal status, ignore all later live-looking events for
						// that ID so the UI cannot get stuck on Continue/Terminate again.
						if (status === "started") {
							if (settledCommandExecutionIdsRef.current.has(executionId)) {
								break
							}
							// A new execution in the same task starts a fresh lifecycle after
							// the previous command's exit barrier has closed.
							commandExitBarrierRef.current = false
							activeCommandExecutionIdsRef.current.add(executionId)
							setActiveCommandCount(activeCommandExecutionIdsRef.current.size)
							setSendingDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
							setSecondaryButtonText(t("chat:killCommand.title"))
						} else if (status === "output") {
							if (
								commandExitBarrierRef.current ||
								settledCommandExecutionIdsRef.current.has(executionId)
							) {
								break
							}
							activeCommandExecutionIdsRef.current.add(executionId)
							setActiveCommandCount(activeCommandExecutionIdsRef.current.size)
							setSendingDisabled(false)
							setClineAsk("command_output")
							setEnableButtons(true)
							setPrimaryButtonText(t("chat:proceedWhileRunning.title"))
							setSecondaryButtonText(t("chat:killCommand.title"))
						} else {
							commandExitBarrierRef.current = true
							settledCommandExecutionIdsRef.current.add(executionId)
							activeCommandExecutionIdsRef.current.clear()
							setActiveCommandCount(0)
							setClineAsk(undefined)
							setEnableButtons(false)
							setPrimaryButtonText(undefined)
							setSecondaryButtonText(undefined)
						}
						// kilocode_change end
					}
					break
				}
				case "condenseTaskContextStarted":
					// Handle both manual and automatic condensation start
					// We don't check the task ID because:
					// 1. There can only be one active task at a time
					// 2. Task switching resets isCondensing to false (see useEffect with task?.ts dependency)
					// 3. For new tasks, currentTaskItem may not be populated yet due to async state updates
					if (message.text) {
						setIsCondensing(true)
						// Note: sendingDisabled is only set for manual condensation via handleCondenseContext
						// Automatic condensation doesn't disable sending since the task is already running
					}
					break
				case "condenseTaskContextResponse":
					// Same reasoning as above - we trust this is for the current task
					if (message.text) {
						if (isCondensing && sendingDisabled) {
							setSendingDisabled(false)
						}
						setIsCondensing(false)
					}
					break
				case "checkpointInitWarning":
					setCheckpointWarning(message.checkpointWarning)
					break
				case "interactionRequired":
					playSound("notification")
					break
				case "taskWithAggregatedCosts":
					if (message.text && message.aggregatedCosts) {
						setAggregatedCostsMap(
							(prev: Map<string, { totalCost: number; ownCost: number; childrenCost: number }>) => {
								const newMap = new Map(prev)
								newMap.set(message.text!, message.aggregatedCosts!)
								return newMap
							},
						)
					}
					break
				// kilocode_change start: Review mode
				case "askReviewScope":
					if (message.reviewScopeInfo) {
						setReviewScopeInfo(message.reviewScopeInfo)
						setShowReviewScopeSelector(true)
					}
					break
				// kilocode_change end: Review mode
			}
			// textAreaRef.current is not explicitly required here since React
			// guarantees that ref will be stable across re-renders, and we're
			// not using its value but its reference.
		},
		[
			isCondensing,
			isHidden,
			sendingDisabled,
			enableButtons,
			handleChatReset,
			handleSendMessage,
			handleSetChatBoxMessage,
			handlePrimaryButtonClick,
			handleSecondaryButtonClick,
			setCheckpointWarning,
			t,
			playSound,
		],
	)

	useEvent("message", handleMessage)

	const visibleMessages = useMemo(() => {
		// Pre-compute checkpoint hashes that have associated user messages for O(1) lookup
		const userMessageCheckpointHashes = new Set<string>()
		modifiedMessages.forEach((msg) => {
			if (
				msg.say === "user_feedback" &&
				msg.checkpoint &&
				(msg.checkpoint as any).type === "user_message" &&
				(msg.checkpoint as any).hash
			) {
				userMessageCheckpointHashes.add((msg.checkpoint as any).hash)
			}
		})

		// Remove the 500-message limit to prevent array index shifting
		// Virtuoso is designed to efficiently handle large lists through virtualization
		const newVisibleMessages = modifiedMessages.filter((message) => {
			// Filter out checkpoint_saved messages that should be suppressed
			if (message.say === "checkpoint_saved") {
				// Check if this checkpoint has the suppressMessage flag set
				if (
					message.checkpoint &&
					typeof message.checkpoint === "object" &&
					"suppressMessage" in message.checkpoint &&
					message.checkpoint.suppressMessage
				) {
					return false
				}
				// Also filter out checkpoint messages associated with user messages (legacy behavior)
				if (message.text && userMessageCheckpointHashes.has(message.text)) {
					return false
				}
			}

			if (everVisibleMessagesTsRef.current.has(message.ts)) {
				const alwaysHiddenOnceProcessedAsk: ClineAsk[] = [
					"api_req_failed",
					"resume_task",
					"resume_completed_task",
				]
				const alwaysHiddenOnceProcessedSay = [
					"api_req_finished",
					"api_req_retried",
					"api_req_deleted",
					"mcp_server_request_started",
				]
				if (message.ask && alwaysHiddenOnceProcessedAsk.includes(message.ask)) return false
				if (message.say && alwaysHiddenOnceProcessedSay.includes(message.say)) return false
				if (message.say === "text" && (message.text ?? "") === "" && (message.images?.length ?? 0) === 0) {
					return false
				}
				return true
			}

			switch (message.ask) {
				case "completion_result":
					if (message.text === "") return false
					break
				case "api_req_failed":
				case "resume_task":
				case "resume_completed_task":
					return false
			}
			switch (message.say) {
				case "api_req_finished":
				case "api_req_retried":
				case "api_req_deleted":
					return false
				case "api_req_retry_delayed":
				case "api_req_rate_limit_wait":
					const last1 = modifiedMessages.at(-1)
					const last2 = modifiedMessages.at(-2)
					if (last1?.ask === "resume_task" && last2 === message) {
						return true
					} else if (message !== last1) {
						return false
					}
					break
				case "text":
					if ((message.text ?? "") === "" && (message.images?.length ?? 0) === 0) return false
					break
				case "mcp_server_request_started":
					return false
			}
			return true
		})

		const viewportStart = Math.max(0, newVisibleMessages.length - 100)
		newVisibleMessages
			.slice(viewportStart)
			.forEach((msg: ClineMessage) => everVisibleMessagesTsRef.current.set(msg.ts, true))

		return newVisibleMessages
	}, [modifiedMessages])

	useEffect(() => {
		const cleanupInterval = setInterval(() => {
			const cache = everVisibleMessagesTsRef.current
			const currentMessageIds = new Set(modifiedMessages.map((m: ClineMessage) => m.ts))
			const viewportMessages = visibleMessages.slice(Math.max(0, visibleMessages.length - 100))
			const viewportMessageIds = new Set(viewportMessages.map((m: ClineMessage) => m.ts))

			cache.forEach((_value: boolean, key: number) => {
				if (!currentMessageIds.has(key) && !viewportMessageIds.has(key)) {
					cache.delete(key)
				}
			})
		}, 60000)

		return () => clearInterval(cleanupInterval)
	}, [modifiedMessages, visibleMessages])

	useDebounceEffect(
		() => {
			if (!isHidden && !sendingDisabled && !enableButtons) {
				textAreaRef.current?.focus()
			}
		},
		50,
		[isHidden, sendingDisabled, enableButtons],
	)

	useEffect(() => {
		// This ensures the first message is not read, future user messages are
		// labeled as `user_feedback`.
		if (lastMessage && messages.length > 1) {
			if (
				typeof lastMessage.text === "string" && // has text (must be string for startsWith)
				(lastMessage.say === "text" || lastMessage.say === "completion_result") && // is a text message
				!lastMessage.partial && // not a partial message
				typeof lastMessage.text === "string" && // kilocode_change: is a string
				!lastMessage.text.startsWith("{") // not a json object
			) {
				let text = lastMessage?.text || ""
				const mermaidRegex = /```mermaid[\s\S]*?```/g
				// remove mermaid diagrams from text
				text = text.replace(mermaidRegex, "")
				// remove markdown from text
				text = removeMd(text)

				// ensure message is not a duplicate of last read message
				if (text !== lastTtsRef.current) {
					try {
						playTts(text)
						lastTtsRef.current = text
					} catch (error) {
						console.error("Failed to execute text-to-speech:", error)
					}
				}
			}
		}

		// Update previous value.
		setWasStreaming(isStreaming)
	}, [isStreaming, lastMessage, wasStreaming, messages.length])

	// Compute current browser session messages for the top banner (not grouped into chat stream)
	// Find the FIRST browser session from the beginning to show ALL sessions
	const browserSessionStartIndex = useMemo(() => {
		for (let i = 0; i < messages.length; i++) {
			if (messages[i].ask === "browser_action_launch") {
				return i
			}
		}
		return -1
	}, [messages])

	const _browserSessionMessages = useMemo<ClineMessage[]>(() => {
		if (browserSessionStartIndex === -1) return []
		return messages.slice(browserSessionStartIndex)
	}, [browserSessionStartIndex, messages])

	// Show globe toggle only when in a task that has a browser session (active or inactive)
	const showBrowserDockToggle = useMemo(
		() => Boolean(task && (browserSessionStartIndex !== -1 || isBrowserSessionActive)),
		[task, browserSessionStartIndex, isBrowserSessionActive],
	)

	const isBrowserSessionMessage = useCallback((message: ClineMessage): boolean => {
		// Only the launch ask should be hidden from chat (it's shown in the drawer header)
		if (message.type === "ask" && message.ask === "browser_action_launch") {
			return true
		}
		// browser_action_result messages are paired with browser_action and should not appear independently
		if (message.type === "say" && message.say === "browser_action_result") {
			return true
		}
		return false
	}, [])

	const groupedMessages = useMemo(() => {
		// Only filter out the launch ask and result messages - browser actions appear in chat
		const result: ClineMessage[] = visibleMessages.filter((msg) => !isBrowserSessionMessage(msg))

		if (isCondensing) {
			result.push({
				type: "say",
				say: "condense_context",
				ts: Date.now(),
				partial: true,
			} as any)
		}
		return result
	}, [isCondensing, visibleMessages, isBrowserSessionMessage])

	// scrolling

	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(() => virtuosoRef.current?.scrollTo({ top: Number.MAX_SAFE_INTEGER, behavior: "smooth" }), 10, {
				immediate: true,
			}),
		[],
	)

	useEffect(() => {
		return () => {
			if (scrollToBottomSmooth && typeof (scrollToBottomSmooth as any).cancel === "function") {
				;(scrollToBottomSmooth as any).cancel()
			}
		}
	}, [scrollToBottomSmooth])

	const scrollToBottomAuto = useCallback(() => {
		virtuosoRef.current?.scrollTo({
			top: Number.MAX_SAFE_INTEGER,
			behavior: "auto", // Instant causes crash.
		})
	}, [])

	const scrollToPinnedMessage = useCallback(
		(behavior: "auto" | "smooth" = "auto") => {
			const ts = pinnedJumpTsRef.current
			if (ts == null) {
				return
			}
			const index = groupedMessages.findIndex((message) => message.ts === ts)
			if (index < 0) {
				return
			}
			virtuosoRef.current?.scrollToIndex({ index, align: "end", behavior })
		},
		[groupedMessages],
	)

	// kilocode_change start: coalesce streaming height changes into one bottom correction per frame
	const keepFollowingOutput = useCallback(() => {
		if (followOutputFrameRef.current !== undefined) {
			return
		}

		followOutputFrameRef.current = window.requestAnimationFrame(() => {
			followOutputFrameRef.current = undefined
			if (pinnedJumpTsRef.current != null) {
				scrollToPinnedMessage("auto")
				return
			}
			if (stickyFollowRef.current) {
				scrollToBottomAuto()
			}
		})
	}, [scrollToBottomAuto, scrollToPinnedMessage])

	useEffect(
		() => () => {
			if (followOutputFrameRef.current !== undefined) {
				window.cancelAnimationFrame(followOutputFrameRef.current)
			}
		},
		[],
	)
	// kilocode_change end

	// kilocode_change start
	// Animated "blink" to highlight a specific message. Used by the TaskTimeline
	const highlightClearTimerRef = useRef<NodeJS.Timeout | undefined>()
	const [highlightedMessageIndex, setHighlightedMessageIndex] = useState<number | null>(null)
	// kilocode_change start: parallel subagents & workspaces left rail + right panel
	const {
		cwd,
		parallelSessions,
		parallelWorkspaces,
		parallelFolders,
		parallelConversations,
		parallelActiveConversationId,
	} = useExtensionState()
	const parallelSessionList = useMemo(
		() => Object.values(parallelSessions ?? {}).sort((a, b) => b.startedAt - a.startedAt),
		[parallelSessions],
	)
	const parallelWorkspaceList = useMemo(() => parallelWorkspaces ?? [], [parallelWorkspaces])
	const parallelFolderList = useMemo(() => parallelFolders ?? [], [parallelFolders])
	const parallelConversationList = useMemo(() => parallelConversations ?? [], [parallelConversations])
	const handleParallelSelect = useCallback((id: string) => {
		const resolved = resolveParallelSelectTarget(id, parallelConversationList, parallelSessionList)
		if (resolved.kind === "conversation") {
			vscode.postMessage({ type: "parallel.selectConversation", text: resolved.targetId })
		}
	}, [parallelConversationList, parallelSessionList])
	// kilocode_change end

	const handleMessageClick = useCallback(
		(index: number) => {
			stickyFollowRef.current = false
			pinnedJumpTsRef.current = groupedMessages[index]?.ts ?? null
			setShowScrollToBottom(true)
			setIsAtBottom(false)
			setHighlightedMessageIndex(index)
			scrollToPinnedMessage("auto")
			window.requestAnimationFrame(() => scrollToPinnedMessage("auto"))

			// Clear existing timer if present
			if (highlightClearTimerRef.current) {
				clearTimeout(highlightClearTimerRef.current)
			}
			highlightClearTimerRef.current = setTimeout(() => {
				setHighlightedMessageIndex(null)
				highlightClearTimerRef.current = undefined
			}, 1000)
		},
		[groupedMessages, scrollToPinnedMessage],
	)

	useEffect(() => {
		if (pinnedJumpTsRef.current != null) {
			scrollToPinnedMessage("auto")
		}
	}, [groupedMessages, scrollToPinnedMessage])

	// Cleanup highlight timer on unmount
	useEffect(() => {
		return () => {
			if (highlightClearTimerRef.current) {
				clearTimeout(highlightClearTimerRef.current)
			}
		}
	}, [])
	// kilocode_change end

	const handleSetExpandedRow = useCallback(
		(ts: number, expand?: boolean) => {
			setExpandedRows((prev: Record<number, boolean>) => ({
				...prev,
				[ts]: expand === undefined ? !prev[ts] : expand,
			}))
		},
		[setExpandedRows], // setExpandedRows is stable
	)

	// Scroll when user toggles certain rows.
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			handleSetExpandedRow(ts)
			// The logic to set disableAutoScrollRef.current = true on expansion
			// is now handled by the useEffect hook that observes expandedRows.
		},
		[handleSetExpandedRow],
	)

	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (pinnedJumpTsRef.current != null) {
				keepFollowingOutput()
				return
			}
			if (stickyFollowRef.current || isAtBottom) {
				if (isTaller) {
					scrollToBottomSmooth()
				} else {
					keepFollowingOutput()
				}
			}
		},
		[scrollToBottomSmooth, keepFollowingOutput, isAtBottom],
	)

	// kilocode_change start: only explicit upward input releases following; content
	// growth can temporarily move Virtuoso away from the bottom without user intent.
	useEffect(() => {
		stickyFollowRef.current = true
		pinnedJumpTsRef.current = null
	}, [task?.ts])

	const releaseOutputFollowing = useCallback((target: EventTarget | null) => {
		if (scrollContainerRef.current?.contains(target as Node)) {
			stickyFollowRef.current = false
			pinnedJumpTsRef.current = null
		}
	}, [])
	const handleWheel = useCallback(
		(event: Event) => {
			const wheelEvent = event as WheelEvent
			if (wheelEvent.deltaY < 0) {
				releaseOutputFollowing(wheelEvent.target)
			}
		},
		[releaseOutputFollowing],
	)
	const handleTouchStart = useCallback((event: Event) => {
		lastTouchYRef.current = (event as TouchEvent).touches[0]?.clientY
	}, [])
	const handleTouchMove = useCallback(
		(event: Event) => {
			const touchY = (event as TouchEvent).touches[0]?.clientY
			if (touchY !== undefined && lastTouchYRef.current !== undefined && touchY > lastTouchYRef.current) {
				releaseOutputFollowing(event.target)
			}
			lastTouchYRef.current = touchY
		},
		[releaseOutputFollowing],
	)
	const handlePointerDown = useCallback(
		(event: Event) => {
			const pointerEvent = event as PointerEvent
			const scroller = chatScrollerRef.current
			if (scroller && pointerEvent.target === scroller && pointerEvent.clientX >= scroller.clientWidth) {
				releaseOutputFollowing(pointerEvent.target)
			}
		},
		[releaseOutputFollowing],
	)
	const handleScrollKey = useCallback(
		(event: Event) => {
			const keyboardEvent = event as KeyboardEvent
			if (["ArrowUp", "PageUp", "Home"].includes(keyboardEvent.key)) {
				releaseOutputFollowing(keyboardEvent.target)
			}
		},
		[releaseOutputFollowing],
	)
	useEvent("wheel", handleWheel, window, { passive: true })
	useEvent("touchstart", handleTouchStart, window, { passive: true })
	useEvent("touchmove", handleTouchMove, window, { passive: true })
	useEvent("pointerdown", handlePointerDown, window, { passive: true })
	useEvent("keydown", handleScrollKey, window)
	// kilocode_change end

	//kilocode_change
	// Effect to clear checkpoint warning when messages appear or task changes
	useEffect(() => {
		if (isHidden || !task) {
			setCheckpointWarning(undefined)
		}
	}, [modifiedMessages.length, isStreaming, isHidden, task])

	const placeholderText = task ? t("chat:typeMessage") : t("chat:typeTask")

	const switchToMode = useCallback(
		(modeSlug: string): void => {
			// Update local state and notify extension to sync mode change.
			setMode(modeSlug)

			// Send the mode switch message.
			vscode.postMessage({ type: "mode", text: modeSlug })
		},
		[setMode],
	)

	const handleSuggestionClickInRow = useCallback(
		(suggestion: SuggestionItem, event?: React.MouseEvent) => {
			// Mark that user has responded if this is a manual click (not auto-approval)
			if (event) {
				userRespondedRef.current = true
			}

			// Mark the current follow-up question as answered when a suggestion is clicked
			if (clineAsk === "followup" && !event?.shiftKey) {
				markFollowUpAsAnswered()
			}

			// Check if we need to switch modes
			if (suggestion.mode) {
				// Only switch modes if it's a manual click (event exists) or auto-approval is allowed
				const isManualClick = !!event
				if (isManualClick || alwaysAllowModeSwitch) {
					// Switch mode without waiting
					switchToMode(suggestion.mode)
				}
			}

			if (event?.shiftKey) {
				// Always append to existing text, don't overwrite
				setInputValue((currentValue: string) => {
					return currentValue !== "" ? `${currentValue} \n${suggestion.answer}` : suggestion.answer
				})
			} else {
				// Don't clear the input value when sending a follow-up choice
				// The message should be sent but the text area should preserve what the user typed
				const preservedInput = inputValueRef.current
				handleSendMessage(suggestion.answer, [])
				// Restore the input value after sending
				setInputValue(preservedInput)
			}
		},
		[handleSendMessage, setInputValue, switchToMode, alwaysAllowModeSwitch, clineAsk, markFollowUpAsAnswered],
	)

	const handleBatchFileResponse = useCallback((response: { [key: string]: boolean }) => {
		// Handle batch file response, e.g., for file uploads
		vscode.postMessage({ type: "askResponse", askResponse: "objectResponse", text: JSON.stringify(response) })
	}, [])

	const itemContent = useCallback(
		(index: number, messageOrGroup: ClineMessage) => {
			const hasCheckpoint = modifiedMessages.some((message) => message.say === "checkpoint_saved")

			// Check if this is a browser action message
			if (messageOrGroup.type === "say" && messageOrGroup.say === "browser_action") {
				// Find the corresponding result message by looking for the next browser_action_result after this action's timestamp
				const nextMessage = modifiedMessages.find(
					(m) => m.ts > messageOrGroup.ts && m.say === "browser_action_result",
				)

				// Calculate action index and total count
				const browserActions = modifiedMessages.filter((m) => m.say === "browser_action")
				const actionIndex = browserActions.findIndex((m) => m.ts === messageOrGroup.ts) + 1
				const totalActions = browserActions.length

				return (
					<BrowserActionRow
						key={messageOrGroup.ts}
						message={messageOrGroup}
						nextMessage={nextMessage}
						actionIndex={actionIndex}
						totalActions={totalActions}
					/>
				)
			}

			// Check if this is a browser session status message
			if (messageOrGroup.type === "say" && messageOrGroup.say === "browser_session_status") {
				return <BrowserSessionStatusRow key={messageOrGroup.ts} message={messageOrGroup} />
			}

			// regular message
			return (
				<ChatRow
					key={messageOrGroup.ts}
					message={messageOrGroup}
					isExpanded={expandedRows[messageOrGroup.ts] || false}
					onToggleExpand={toggleRowExpansion} // This was already stabilized
					lastModifiedMessage={modifiedMessages.at(-1)} // Original direct access
					isLast={index === groupedMessages.length - 1} // Original direct access
					onHeightChange={handleRowHeightChange}
					isStreaming={isStreaming}
					onSuggestionClick={handleSuggestionClickInRow} // This was already stabilized
					onBatchFileResponse={handleBatchFileResponse}
					highlighted={highlightedMessageIndex === index} // kilocode_change: add highlight prop
					enableCheckpoints={enableCheckpoints} // kilocode_change
					isFollowUpAnswered={messageOrGroup.isAnswered === true || messageOrGroup.ts === currentFollowUpTs}
					isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
					editable={
						messageOrGroup.type === "ask" &&
						messageOrGroup.ask === "tool" &&
						(() => {
							let tool: any = {}
							try {
								tool = JSON.parse(messageOrGroup.text || "{}")
							} catch (_) {
								if (messageOrGroup.text?.includes("updateTodoList")) {
									tool = { tool: "updateTodoList" }
								}
							}
							return tool.tool === "updateTodoList" && enableButtons && !!primaryButtonText
						})()
					}
					hasCheckpoint={hasCheckpoint}
				/>
			)
		},
		[
			expandedRows,
			toggleRowExpansion,
			modifiedMessages,
			groupedMessages.length,
			handleRowHeightChange,
			isStreaming,
			handleSuggestionClickInRow,
			handleBatchFileResponse,
			highlightedMessageIndex, // kilocode_change: add highlightedMessageIndex
			enableCheckpoints, // kilocode_change
			currentFollowUpTs,
			isFollowUpAutoApprovalPaused,
			enableButtons,
			primaryButtonText,
		],
	)

	// Function to handle mode switching
	const switchToNextMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const nextModeIndex = (currentModeIndex + 1) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[nextModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Function to handle switching to previous mode
	const switchToPreviousMode = useCallback(() => {
		const allModes = getAllModes(customModes)
		const currentModeIndex = allModes.findIndex((m) => m.slug === mode)
		const previousModeIndex = (currentModeIndex - 1 + allModes.length) % allModes.length
		// Update local state and notify extension to sync mode change
		switchToMode(allModes[previousModeIndex].slug)
	}, [mode, customModes, switchToMode])

	// Add keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			// Check for Command/Ctrl + Period (with or without Shift)
			// Using event.key to respect keyboard layouts (e.g., Dvorak)
			if ((event.metaKey || event.ctrlKey) && event.key === ".") {
				event.preventDefault() // Prevent default browser behavior

				if (event.shiftKey) {
					// Shift + Period = Previous mode
					switchToPreviousMode()
				} else {
					// Just Period = Next mode
					switchToNextMode()
				}
			}
		},
		[switchToNextMode, switchToPreviousMode],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		window.addEventListener("wheel", handleWheel, { passive: true }) // kilocode_change
		return () => {
			window.removeEventListener("keydown", handleKeyDown)
			window.removeEventListener("wheel", handleWheel) // kilocode_change
		}
	}, [handleKeyDown, handleWheel]) // kilocode_change

	useImperativeHandle(ref, () => ({
		acceptInput: () => {
			if (enableButtons && primaryButtonText) {
				handlePrimaryButtonClick(inputValue, selectedImages)
			} else if (!sendingDisabled && !isProfileDisabled && (inputValue.trim() || selectedImages.length > 0)) {
				handleSendMessage(inputValue, selectedImages)
			}
		},
		// kilocode_change start
		focusInput: () => {
			if (textAreaRef.current) {
				textAreaRef.current.focus()
			}
		},
		// kilocode_change end
	}))

	const handleCondenseContext = (taskId: string) => {
		if (isCondensing || sendingDisabled) {
			return
		}
		setIsCondensing(true)
		setSendingDisabled(true)
		vscode.postMessage({ type: "condenseTaskContextRequest", text: taskId })
	}

	const areButtonsVisible = showScrollToBottom || primaryButtonText || secondaryButtonText || isStreaming

	const showTelemetryBanner = telemetrySetting === "unset" // kilocode_change

	return (
		<div
			data-testid="chat-view"
			className={
				isHidden
					? "hidden"
					: "fixed top-0 left-0 right-0 max-w-5xl mx-auto bottom-0 flex flex-row overflow-hidden" // kilocode_change; add max-w-5xl + parallel rails
			}>
			{/* kilocode_change start: parallel subagents & workspaces */}
			<ParallelRail
				sessions={parallelSessionList}
				workspaces={parallelWorkspaceList}
				folders={parallelFolderList}
				conversations={parallelConversationList}
				activeConversationId={parallelActiveConversationId}
				currentFolderPath={cwd}
				onSelect={handleParallelSelect}
			/>
			<div className="flex flex-col flex-1 min-w-0">
				<WorkspaceBar />
				{/* kilocode_change end */}
				{(showAnnouncement || showAnnouncementModal) && (
					<Announcement
						hideAnnouncement={() => {
							if (showAnnouncementModal) {
								setShowAnnouncementModal(false)
							}
							if (showAnnouncement) {
								hideAnnouncement()
							}
						}}
					/>
				)}
				{task ? (
					<>
						{/* kilocode_change start */}
						{/* <TaskHeader
						task={task}
						tokensIn={apiMetrics.totalTokensIn}
						tokensOut={apiMetrics.totalTokensOut}
						cacheWrites={apiMetrics.totalCacheWrites}
						cacheReads={apiMetrics.totalCacheReads}
						totalCost={apiMetrics.totalCost}
						aggregatedCost={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? aggregatedCostsMap.get(currentTaskItem.id)!.totalCost
								: undefined
						}
						hasSubtasks={
							!!(
								currentTaskItem?.id &&
								aggregatedCostsMap.has(currentTaskItem.id) &&
								aggregatedCostsMap.get(currentTaskItem.id)!.childrenCost > 0
							)
						}
						costBreakdown={
							currentTaskItem?.id && aggregatedCostsMap.has(currentTaskItem.id)
								? getCostBreakdownIfNeeded(aggregatedCostsMap.get(currentTaskItem.id)!, {
										own: t("common:costs.own"),
										subtasks: t("common:costs.subtasks"),
									})
								: undefined
						}
						contextTokens={apiMetrics.contextTokens}
						buttonsDisabled={sendingDisabled}
						handleCondenseContext={handleCondenseContext}
						todos={latestTodos}
					/> */}
						<KiloTaskHeader
							task={task}
							tokensIn={apiMetrics.totalTokensIn}
							tokensOut={apiMetrics.totalTokensOut}
							cacheWrites={apiMetrics.totalCacheWrites}
							cacheReads={apiMetrics.totalCacheReads}
							totalCost={apiMetrics.totalCost}
							contextTokens={apiMetrics.contextTokens}
							buttonsDisabled={sendingDisabled}
							handleCondenseContext={handleCondenseContext}
							onClose={handleTaskCloseButtonClick}
							groupedMessages={groupedMessages}
							onMessageClick={handleMessageClick}
							isTaskActive={sendingDisabled}
							todos={latestTodos}
						/>
						{/* kilocode_change start */}

						{hasSystemPromptOverride && (
							<div className="px-3">
								<SystemPromptWarning />
							</div>
						)}

						{checkpointWarning && (
							<div className="px-3">
								<CheckpointWarning warning={checkpointWarning} />
							</div>
						)}
					</>
				) : (
					<div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-4 relative">
						{/* Moved Task Bar Header Here */}
						{taskHistoryFullLength !== 0 && (
							<div className="flex text-vscode-descriptionForeground w-full mx-auto px-5 pt-3">
								<div className="flex items-center gap-1 cursor-pointer" onClick={toggleExpanded}>
									{taskHistoryFullLength < 10 && (
										<span className={`font-medium text-xs `}>{t("history:recentTasks")}</span>
									)}
									<span
										className={`codicon  ${isExpanded ? "codicon-eye" : "codicon-eye-closed"} scale-90`}
									/>
								</div>
							</div>
						)}
						{/* kilocode_change: commercial organization selector removed from Deeptask. */}
						{/* kilocode_change start: changed the classes to support notifications */}
						<div className="w-full h-full flex flex-col gap-4 px-3.5 transition-all duration-300">
							{/* kilocode_change end */}
							{/* Version indicator in top-right corner - only on welcome screen */}
							{/* kilocode_change: do not show */}
							{/* <VersionIndicator
							onClick={() => setShowAnnouncementModal(true)}
							className="absolute top-2 right-3 z-10"
						/>

						<RooHero /> */}

							{/* kilocode_change start: KilocodeNotifications + Layout fixes */}
							{showTelemetryBanner && <TelemetryBanner />}
							{!showTelemetryBanner && (
								<div className={taskHistoryFullLength === 0 ? "mt-10" : undefined}>
									<KilocodeNotifications />
								</div>
							)}
							<div className="flex flex-grow flex-col justify-center gap-2">
								<KiloLogo />
								{/* kilocode_change end */}
								<p className="text-vscode-editor-foreground leading-normal font-vscode-font-family text-center text-balance max-w-[380px] mx-auto my-0">
									<Trans
										i18nKey="chat:about"
										components={{
											DocsLink: (
												<a
													href={buildDocLink("", "welcome")}
													target="_blank"
													rel="noopener noreferrer">
													the docs
												</a>
											),
										}}
									/>
								</p>
								{/* kilocode_change start: prominent repository Star CTA */}
								<div className="flex justify-center my-1">
									<GitHubStarButton className="min-w-[210px] justify-center font-semibold" />
								</div>
								{/* kilocode_change end */}
								<IdeaSuggestionsBox /> {/* kilocode_change */}
								{/*<div className="mb-2.5">
								{cloudIsAuthenticated || taskHistory.length < 4 ? <RooTips /> : <RooCloudCTA />}
							</div> kilocode_change: do not show */}
								{/* Show the task history preview if expanded and tasks exist */}
								{taskHistoryFullLength > 0 && isExpanded && (
									<HistoryPreview taskHistoryVersion={taskHistoryVersion} />
								)}
								{/* kilocode_change start: KilocodeNotifications + Layout fixes */}
							</div>
							{/* kilocode_change end */}
						</div>
					</div>
				)}

				{/*
			// Flex layout explanation:
			// 1. Content div above uses flex: "1 1 0" to:
			//    - Grow to fill available space (flex-grow: 1)
			//    - Shrink when AutoApproveMenu needs space (flex-shrink: 1)
			//    - Start from zero size (flex-basis: 0) to ensure proper distribution
			//    minHeight: 0 allows it to shrink below its content height
			//
			// 2. AutoApproveMenu uses flex: "0 1 auto" to:
			//    - Not grow beyond its content (flex-grow: 0)
			//    - Shrink when viewport is small (flex-shrink: 1)
			//    - Use its content size as basis (flex-basis: auto)
			//    This ensures it takes its natural height when there's space
			//    but becomes scrollable when the viewport is too small
			*/}
				{/* kilocode_change: added settings toggle for this */}
				{!task && showAutoApproveMenu && (
					<div className="mb-1 flex-initial min-h-0">
						<AutoApproveMenu />
					</div>
				)}

				{task && (
					<>
						<div className="grow flex flex-row min-h-0">
							<UserMessageRail messages={groupedMessages} onJump={handleMessageClick} />
							<div className="grow flex flex-col min-h-0" ref={scrollContainerRef}>
								<div className="flex-auto min-h-0">
									<Virtuoso
										ref={virtuosoRef}
										scrollerRef={(element) => {
											chatScrollerRef.current = element instanceof HTMLElement ? element : null
										}}
										key={task.ts}
										className="scrollable grow overflow-y-scroll mb-1"
										increaseViewportBy={{ top: 400, bottom: 400 }} // kilocode_change: use more modest numbers to see if they reduce gray screen incidence
										data={groupedMessages}
										itemContent={itemContent}
										followOutput={(isAtBottom: boolean) =>
											pinnedJumpTsRef.current != null
												? false
												: isAtBottom || stickyFollowRef.current
										}
										// kilocode_change: cover same-message streaming and asynchronous Markdown reflow
										totalListHeightChanged={keepFollowingOutput}
										atBottomStateChange={(isAtBottom: boolean) => {
											setIsAtBottom(isAtBottom)
											if (isAtBottom && pinnedJumpTsRef.current == null) {
												stickyFollowRef.current = true
											}
											// Only show the scroll-to-bottom button if not at bottom
											setShowScrollToBottom(!isAtBottom)
										}}
										atBottomThreshold={10}
										initialTopMostItemIndex={groupedMessages.length - 1}
									/>
								</div>
							</div>
						</div>
						<div className={`flex-initial min-h-0 ${!areButtonsVisible ? "mb-1" : ""}`}>
							{/* kilocode_change: added settings toggle for this */}
							{showAutoApproveMenu && <AutoApproveMenu />}
						</div>
						{areButtonsVisible && (
							<div
								className={`flex h-9 items-center mb-1 px-[15px] ${
									showScrollToBottom
										? "opacity-100"
										: enableButtons || (isStreaming && !didClickCancel) // kilocode_change
											? "opacity-100"
											: "opacity-50"
								}`}>
								{/* kilocode_change start
							    Keep Cancel available while streaming even if the user scrolled
							    up. Replacing the whole action row with only scroll-to-bottom
							    made post-force-continue reasoning turns unstoppable. */}
								{showScrollToBottom && (
									<StandardTooltip content={t("chat:scrollToBottom")}>
										<Button
											className={isStreaming ? "flex-1 mr-[6px]" : "flex-[2]"}
											onClick={() => {
												// Engage sticky follow until user scrolls up
												stickyFollowRef.current = true
												pinnedJumpTsRef.current = null
												// Pin immediately to avoid lag during fast streaming
												scrollToBottomAuto()
												// Hide button immediately to prevent flash
												setShowScrollToBottom(false)
											}}>
											<span className="codicon codicon-chevron-down"></span>
										</Button>
									</StandardTooltip>
								)}
								{!showScrollToBottom && (
									<>
										{/* Keep Continue/Run visible even if a stale api_req_started
									    still marks isStreaming true. Hiding the primary button
									    leaves only Cancel during long commands. */}
										{primaryButtonText && (!isStreaming || clineAsk === "command_output") && (
											<StandardTooltip
												content={
													primaryButtonText === t("chat:retry.title")
														? t("chat:retry.tooltip")
														: primaryButtonText === t("chat:save.title")
															? t("chat:save.tooltip")
															: primaryButtonText === t("chat:approve.title")
																? t("chat:approve.tooltip")
																: primaryButtonText === t("chat:runCommand.title")
																	? t("chat:runCommand.tooltip")
																	: primaryButtonText === t("chat:startNewTask.title")
																		? t("chat:startNewTask.tooltip")
																		: primaryButtonText ===
																			  t("chat:resumeTask.title")
																			? t("chat:resumeTask.tooltip")
																			: primaryButtonText ===
																				  t("chat:proceedAnyways.title")
																				? t("chat:proceedAnyways.tooltip")
																				: primaryButtonText ===
																					  t(
																							"chat:proceedWhileRunning.title",
																					  )
																					? t(
																							"chat:proceedWhileRunning.tooltip",
																						)
																					: undefined
												}>
												<Button
													disabled={!enableButtons}
													className={
														secondaryButtonText || isStreaming
															? "flex-1 mr-[6px]"
															: "flex-[2] mr-0"
													}
													onClick={() =>
														handlePrimaryButtonClick(inputValue, selectedImages)
													}>
													{primaryButtonText}
												</Button>
											</StandardTooltip>
										)}
									</>
								)}
								{(isStreaming || (!showScrollToBottom && secondaryButtonText)) && (
									<StandardTooltip
										content={
											isStreaming
												? t("chat:cancel.tooltip")
												: secondaryButtonText === t("chat:startNewTask.title")
													? t("chat:startNewTask.tooltip")
													: secondaryButtonText === t("chat:reject.title")
														? t("chat:reject.tooltip")
														: secondaryButtonText === t("chat:terminate.title")
															? t("chat:terminate.tooltip")
															: secondaryButtonText === t("chat:killCommand.title")
																? t("chat:killCommand.tooltip")
																: undefined
										}>
										<Button
											disabled={!enableButtons && !(isStreaming && !didClickCancel)}
											className={
												isStreaming
													? showScrollToBottom
														? "flex-1 ml-0"
														: "flex-[2] ml-0"
													: "flex-1 ml-[6px]"
											}
											onClick={() => handleSecondaryButtonClick(inputValue, selectedImages)}>
											{isStreaming ? t("chat:cancel.title") : secondaryButtonText}
										</Button>
									</StandardTooltip>
								)}
								{/* kilocode_change end */}
							</div>
						)}
					</>
				)}

				{/* kilocode_change: waiting/queued message cards are intentionally absent. */}
				<ChatTextArea
					ref={textAreaRef}
					inputValue={inputValue}
					setInputValue={setInputValue}
					sendingDisabled={disableChatSubmit}
					selectApiConfigDisabled={sendingDisabled && clineAsk !== "api_req_failed"}
					placeholderText={placeholderText}
					selectedImages={selectedImages}
					setSelectedImages={setSelectedImages}
					onSend={() => handleSendMessage(inputValue, selectedImages)}
					onSelectImages={selectImages}
					shouldDisableImages={shouldDisableImages}
					onHeightChange={() => {
						if (pinnedJumpTsRef.current != null || stickyFollowRef.current || isAtBottom) {
							keepFollowingOutput()
						}
					}}
					mode={mode}
					setMode={setMode}
					modeShortcutText={modeShortcutText}
					sendMessageOnEnter={sendMessageOnEnter} // kilocode_change
					showBrowserDockToggle={showBrowserDockToggle}
				/>
				{/* kilocode_change: added settings toggle the profile and model selection */}
				<BottomControls showApiConfig />
				{/* kilocode_change: end */}

				{/* kilocode_change: disable {isProfileDisabled && (
				<div className="px-3">
					<ProfileViolationWarning />
				</div>
			)} */}
			</div>
			{/* kilocode_change: subagent conversations reuse the main chat, not a side process panel */}
			<div id="roo-portal" />
			{/* kilocode_change: disable  */}
			{/* <CloudUpsellDialog open={isUpsellOpen} onOpenChange={closeUpsell} onConnect={handleConnect} /> */}

			{/* kilocode_change: Review mode scope selector */}
			<ReviewScopeSelector
				open={showReviewScopeSelector}
				onOpenChange={setShowReviewScopeSelector}
				scopeInfo={reviewScopeInfo}
			/>
		</div>
	)
}

const ChatView = forwardRef(ChatViewComponent)

export default ChatView
