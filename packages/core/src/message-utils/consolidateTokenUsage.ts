import type { TokenUsage, ToolUsage, ToolName, ClineMessage } from "@roo-code/types"

// kilocode_change start
// import { type ClineSayTool } from "./ExtensionMessage"
// import { safeJsonParse } from "./safeJsonParse"
// kilocode_change end

// kilocode_change start
import { type ClineSayTool } from "@roo-code/types"
// Use relative import to avoid circular dependency - importing from "@roo-code/core"
// causes the main index.ts to load, which includes custom-tools/esbuild-runner.ts
// that depends on Node-only packages like execa, breaking browser builds.
import { safeJsonParse } from "./safeJsonParse.js"
// kilocode_change end

export type ParsedApiReqStartedTextType = {
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost?: number // Only present if consolidateApiRequests has been called
	apiProtocol?: "anthropic" | "openai"
}

type CachedApiReqMetrics = {
	sourceText: string
	tokensIn: number
	tokensOut: number
	cacheWrites: number | undefined
	cacheReads: number | undefined
	cost: number
	hasTokenData: boolean
}

type CachedFastApplyMetrics = {
	sourceText: string
	tokensIn: number
	tokensOut: number
	cost: number
}

// Streaming ticks reuse the same api_req_started objects. Parsing their JSON
// every time materializes the optional `request` body (often megabytes) on
// each chat update. Cache numeric fields against object identity + text.
const apiReqMetricsCache = new WeakMap<ClineMessage, CachedApiReqMetrics>()
const fastApplyMetricsCache = new WeakMap<ClineMessage, CachedFastApplyMetrics>()

function readCachedApiReqMetrics(message: ClineMessage): CachedApiReqMetrics | undefined {
	if (!message.text) {
		return undefined
	}

	const cached = apiReqMetricsCache.get(message)
	if (cached && cached.sourceText === message.text) {
		return cached
	}

	try {
		const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
		const next: CachedApiReqMetrics = {
			sourceText: message.text,
			tokensIn: typeof parsedText.tokensIn === "number" ? parsedText.tokensIn : 0,
			tokensOut: typeof parsedText.tokensOut === "number" ? parsedText.tokensOut : 0,
			cacheWrites: typeof parsedText.cacheWrites === "number" ? parsedText.cacheWrites : undefined,
			cacheReads: typeof parsedText.cacheReads === "number" ? parsedText.cacheReads : undefined,
			cost: typeof parsedText.cost === "number" ? parsedText.cost : 0,
			hasTokenData: typeof parsedText.tokensIn === "number" || typeof parsedText.tokensOut === "number",
		}
		apiReqMetricsCache.set(message, next)
		return next
	} catch (error) {
		console.error("Error parsing JSON:", error)
		const failed: CachedApiReqMetrics = {
			sourceText: message.text,
			tokensIn: 0,
			tokensOut: 0,
			cacheWrites: undefined,
			cacheReads: undefined,
			cost: 0,
			hasTokenData: false,
		}
		apiReqMetricsCache.set(message, failed)
		return failed
	}
}

function readCachedFastApplyMetrics(message: ClineMessage): CachedFastApplyMetrics | undefined {
	if (!message.text) {
		return undefined
	}

	const cached = fastApplyMetricsCache.get(message)
	if (cached && cached.sourceText === message.text) {
		return cached
	}

	const fastApplyResult = safeJsonParse<ClineSayTool>(message.text)?.fastApplyResult
	const next: CachedFastApplyMetrics = {
		sourceText: message.text,
		tokensIn: fastApplyResult?.tokensIn ?? 0,
		tokensOut: fastApplyResult?.tokensOut ?? 0,
		cost: fastApplyResult?.cost ?? 0,
	}
	fastApplyMetricsCache.set(message, next)
	return next
}

function emptyTokenUsage(): TokenUsage {
	return {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
		contextTokens: 0,
	}
}

function addOptionalCount(left: number | undefined, right: number | undefined): number | undefined {
	if (typeof left !== "number" && typeof right !== "number") {
		return undefined
	}

	return (left ?? 0) + (right ?? 0)
}

function mergeTokenUsage(base: TokenUsage, extra: TokenUsage, extraHasContext: boolean): TokenUsage {
	return {
		totalTokensIn: base.totalTokensIn + extra.totalTokensIn,
		totalTokensOut: base.totalTokensOut + extra.totalTokensOut,
		totalCacheWrites: addOptionalCount(base.totalCacheWrites, extra.totalCacheWrites),
		totalCacheReads: addOptionalCount(base.totalCacheReads, extra.totalCacheReads),
		totalCost: base.totalCost + extra.totalCost,
		contextTokens: extraHasContext ? extra.contextTokens : base.contextTokens,
	}
}

function prefixMatches(
	previous: readonly ClineMessage[],
	next: readonly ClineMessage[],
	prefixLength: number,
): boolean {
	if (prefixLength > previous.length || prefixLength > next.length) {
		return false
	}

	for (let i = 0; i < prefixLength; i++) {
		if (previous[i] !== next[i]) {
			return false
		}
	}

	return true
}

function scanTokenUsage(
	messages: readonly ClineMessage[],
	startIndex = 0,
	endIndex = messages.length,
): { usage: TokenUsage; foundContext: boolean } {
	const result = emptyTokenUsage()
	const from = startIndex > 0 ? startIndex : 0
	const to = endIndex < messages.length ? endIndex : messages.length

	for (let i = from; i < to; i++) {
		const message = messages[i]
		if (!message) {
			continue
		}
		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			const parsed = readCachedApiReqMetrics(message)
			if (!parsed) {
				continue
			}

			result.totalTokensIn += parsed.tokensIn
			result.totalTokensOut += parsed.tokensOut

			if (typeof parsed.cacheWrites === "number") {
				result.totalCacheWrites = (result.totalCacheWrites ?? 0) + parsed.cacheWrites
			}

			if (typeof parsed.cacheReads === "number") {
				result.totalCacheReads = (result.totalCacheReads ?? 0) + parsed.cacheReads
			}

			result.totalCost += parsed.cost
		} else if (message.type === "say" && message.say === "condense_context") {
			result.totalCost += message.contextCondense?.cost ?? 0
		} else if (message.type === "ask" && message.ask === "tool" && message.text) {
			const parsed = readCachedFastApplyMetrics(message)
			if (!parsed) {
				continue
			}
			result.totalTokensIn += parsed.tokensIn
			result.totalTokensOut += parsed.tokensOut
			result.totalCost += parsed.cost
		}
	}

	// Calculate context tokens, from the last API request started or condense
	// context message.
	// kilocode_change start - skip placeholder messages without token data
	// When a new API request starts, a placeholder api_req_started message is created
	// with only apiProtocol (no token data). We need to skip these placeholders and
	// find the last message with actual token data to avoid showing 0% context.
	result.contextTokens = 0
	let foundValidTokenData = false

	for (let i = to - 1; i >= from; i--) {
		const message = messages[i]
		if (!message) continue

		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			const parsed = readCachedApiReqMetrics(message)
			if (parsed?.hasTokenData) {
				// Since tokensIn now stores TOTAL input tokens (including cache tokens),
				// we no longer need to add cacheWrites and cacheReads separately.
				// This applies to both Anthropic and OpenAI protocols.
				result.contextTokens = parsed.tokensIn + parsed.tokensOut
				foundValidTokenData = true
			}
		} else if (message.type === "say" && message.say === "condense_context") {
			result.contextTokens = message.contextCondense?.newContextTokens ?? 0
			foundValidTokenData = true
		}
		if (foundValidTokenData) {
			break
		}
	}

	return { usage: result, foundContext: foundValidTokenData }
}

/**
 * Consolidates token usage metrics from an array of ClineMessages.
 *
 * This function processes 'condense_context' messages and 'api_req_started' messages that have been
 * consolidated with their corresponding 'api_req_finished' messages by the consolidateApiRequests function.
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @param startIndex - Inclusive start index; later messages are scanned in place without copying.
 * @returns A TokenUsage object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost, and contextTokens.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = consolidateTokenUsage(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
export function consolidateTokenUsage(messages: ClineMessage[], startIndex = 0): TokenUsage {
	return scanTokenUsage(messages, startIndex).usage
}

export type TokenUsageIncrementalCache = {
	messages: readonly ClineMessage[]
	prefixLength: number
	prefixUsage: TokenUsage
	usage: TokenUsage
}

/**
 * Streaming chat updates keep historical message object identity and only
 * replace or append the tail. Freeze totals for every message except the last
 * so each tick scans one row instead of the whole transcript.
 */
export function consolidateTokenUsageIncremental(
	messages: readonly ClineMessage[],
	cache?: TokenUsageIncrementalCache,
): TokenUsageIncrementalCache {
	if (messages.length === 0) {
		const usage = emptyTokenUsage()
		return { messages, prefixLength: 0, prefixUsage: usage, usage }
	}

	if (cache && cache.messages === messages) {
		return cache
	}

	const nextPrefixLength = messages.length - 1
	const canReusePrefix =
		!!cache && cache.prefixLength <= nextPrefixLength && prefixMatches(cache.messages, messages, cache.prefixLength)

	let prefixLength = canReusePrefix ? cache.prefixLength : 0
	let prefixUsage = canReusePrefix ? cache.prefixUsage : emptyTokenUsage()

	if (prefixLength < nextPrefixLength) {
		const extra = scanTokenUsage(messages, prefixLength, nextPrefixLength)
		prefixUsage = mergeTokenUsage(prefixUsage, extra.usage, extra.foundContext)
		prefixLength = nextPrefixLength
	}

	const tail = scanTokenUsage(messages, prefixLength, messages.length)
	return {
		messages,
		prefixLength,
		prefixUsage,
		usage: mergeTokenUsage(prefixUsage, tail.usage, tail.foundContext),
	}
}

/**
 * Check if token usage has changed by comparing relevant properties.
 * @param current - Current token usage data
 * @param snapshot - Previous snapshot to compare against
 * @returns true if any relevant property has changed or snapshot is undefined
 */
export function hasTokenUsageChanged(current: TokenUsage, snapshot?: TokenUsage): boolean {
	if (!snapshot) {
		return true
	}

	const keysToCompare: (keyof TokenUsage)[] = [
		"totalTokensIn",
		"totalTokensOut",
		"totalCacheWrites",
		"totalCacheReads",
		"totalCost",
		"contextTokens",
	]

	return keysToCompare.some((key) => current[key] !== snapshot[key])
}

/**
 * Check if tool usage has changed by comparing attempts and failures.
 * @param current - Current tool usage data
 * @param snapshot - Previous snapshot to compare against (undefined treated as empty)
 * @returns true if any tool's attempts/failures have changed between current and snapshot
 */
export function hasToolUsageChanged(current: ToolUsage, snapshot?: ToolUsage): boolean {
	// Treat undefined snapshot as empty object for consistent comparison
	const effectiveSnapshot = snapshot ?? {}

	const currentKeys = Object.keys(current) as ToolName[]
	const snapshotKeys = Object.keys(effectiveSnapshot) as ToolName[]

	// Check if number of tools changed
	if (currentKeys.length !== snapshotKeys.length) {
		return true
	}

	// Check if any tool's stats changed
	return currentKeys.some((key) => {
		const currentTool = current[key]
		const snapshotTool = effectiveSnapshot[key]

		if (!snapshotTool || !currentTool) {
			return true
		}

		return currentTool.attempts !== snapshotTool.attempts || currentTool.failures !== snapshotTool.failures
	})
}
