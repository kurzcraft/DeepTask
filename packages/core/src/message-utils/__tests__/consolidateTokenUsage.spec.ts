// npx vitest run packages/core/src/message-utils/__tests__/consolidateTokenUsage.spec.ts

import type { ClineMessage } from "@roo-code/types"

import {
	consolidateTokenUsage,
	consolidateTokenUsageIncremental,
	hasTokenUsageChanged,
	hasToolUsageChanged,
} from "../consolidateTokenUsage.js"

describe("consolidateTokenUsage", () => {
	// Helper function to create a basic api_req_started message
	const createApiReqMessage = (
		ts: number,
		data: {
			tokensIn?: number
			tokensOut?: number
			cacheWrites?: number
			cacheReads?: number
			cost?: number
		},
	): ClineMessage => ({
		ts,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify(data),
	})

	describe("basic token accumulation", () => {
		it("should accumulate tokens from a single message", () => {
			const messages: ClineMessage[] = [createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01 })]

			const result = consolidateTokenUsage(messages)

			expect(result.totalTokensIn).toBe(100)
			expect(result.totalTokensOut).toBe(50)
			expect(result.totalCost).toBe(0.01)
		})

		it("should accumulate tokens from multiple messages", () => {
			const messages: ClineMessage[] = [
				createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01 }),
				createApiReqMessage(1001, { tokensIn: 200, tokensOut: 100, cost: 0.02 }),
			]

			const result = consolidateTokenUsage(messages)

			expect(result.totalTokensIn).toBe(300)
			expect(result.totalTokensOut).toBe(150)
			expect(result.totalCost).toBeCloseTo(0.03)
		})

		it("should handle cache writes and reads", () => {
			const messages: ClineMessage[] = [
				createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cacheWrites: 500, cacheReads: 200 }),
			]

			const result = consolidateTokenUsage(messages)

			expect(result.totalCacheWrites).toBe(500)
			expect(result.totalCacheReads).toBe(200)
		})

		it("should handle empty messages array", () => {
			const result = consolidateTokenUsage([])

			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCost).toBe(0)
			expect(result.contextTokens).toBe(0)
		})

		it("should scan from startIndex without copying the transcript", () => {
			const messages: ClineMessage[] = [
				createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01 }),
				createApiReqMessage(1001, { tokensIn: 200, tokensOut: 100, cost: 0.02 }),
				createApiReqMessage(1002, { tokensIn: 40, tokensOut: 10, cost: 0.03 }),
			]

			const result = consolidateTokenUsage(messages, 1)

			expect(result.totalTokensIn).toBe(240)
			expect(result.totalTokensOut).toBe(110)
			expect(result.totalCost).toBeCloseTo(0.05)
			expect(result.contextTokens).toBe(50)
			expect(messages).toHaveLength(3)
		})
	})

	describe("context tokens calculation", () => {
		it("should calculate context tokens from the last API request", () => {
			const messages: ClineMessage[] = [
				createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50 }),
				createApiReqMessage(1001, { tokensIn: 200, tokensOut: 100 }),
			]

			const result = consolidateTokenUsage(messages)

			// Context tokens = tokensIn + tokensOut from last message
			expect(result.contextTokens).toBe(300) // 200 + 100
		})

		it("should handle condense_context messages for context tokens", () => {
			const messages: ClineMessage[] = [
				createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50 }),
				{
					ts: 1001,
					type: "say",
					say: "condense_context",
					contextCondense: { newContextTokens: 5000, cost: 0.05 },
				} as ClineMessage,
			]

			const result = consolidateTokenUsage(messages)

			expect(result.contextTokens).toBe(5000)
			expect(result.totalCost).toBeCloseTo(0.05)
		})
	})

	describe("invalid data handling", () => {
		it("should handle messages with invalid JSON", () => {
			const messages: ClineMessage[] = [{ ts: 1000, type: "say", say: "api_req_started", text: "invalid json" }]

			// Should not throw
			const result = consolidateTokenUsage(messages)
			expect(result.totalTokensIn).toBe(0)
		})

		it("should skip non-api_req_started messages", () => {
			const messages: ClineMessage[] = [
				{ ts: 1000, type: "say", say: "text", text: "hello" },
				createApiReqMessage(1001, { tokensIn: 100, tokensOut: 50 }),
			]

			const result = consolidateTokenUsage(messages)

			expect(result.totalTokensIn).toBe(100)
			expect(result.totalTokensOut).toBe(50)
		})

		it("should handle missing token values", () => {
			const messages: ClineMessage[] = [createApiReqMessage(1000, { cost: 0.01 })]

			const result = consolidateTokenUsage(messages)

			expect(result.totalTokensIn).toBe(0)
			expect(result.totalTokensOut).toBe(0)
			expect(result.totalCost).toBe(0.01)
		})

		it("should reuse parsed metrics for the same object until text changes", () => {
			const parseSpy = vi.spyOn(JSON, "parse")
			const message = createApiReqMessage(1000, {
				tokensIn: 11,
				tokensOut: 7,
				cost: 0.02,
			})
			message.text = JSON.stringify({
				request: "x".repeat(1000),
				tokensIn: 11,
				tokensOut: 7,
				cost: 0.02,
			})
			parseSpy.mockClear()

			const first = consolidateTokenUsage([message])
			const parsesAfterFirst = parseSpy.mock.calls.length
			const second = consolidateTokenUsage([message])
			expect(parseSpy.mock.calls.length).toBe(parsesAfterFirst)
			expect(second).toEqual(first)

			message.text = JSON.stringify({
				request: "updated",
				tokensIn: 40,
				tokensOut: 10,
				cost: 0.05,
			})
			const third = consolidateTokenUsage([message])
			expect(parseSpy.mock.calls.length).toBeGreaterThan(parsesAfterFirst)
			expect(third.totalTokensIn).toBe(40)
			expect(third.totalTokensOut).toBe(10)
			expect(third.totalCost).toBeCloseTo(0.05)
			expect(third.contextTokens).toBe(50)

			parseSpy.mockRestore()
		})
	})
})

describe("consolidateTokenUsageIncremental", () => {
	const createApiReqMessage = (
		ts: number,
		data: {
			tokensIn?: number
			tokensOut?: number
			cacheWrites?: number
			cacheReads?: number
			cost?: number
		},
	): ClineMessage => ({
		ts,
		type: "say",
		say: "api_req_started",
		text: JSON.stringify(data),
	})

	it("matches a full scan and freezes the historical prefix after the first tick", () => {
		const first = createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01, cacheWrites: 10 })
		const second = createApiReqMessage(1001, { tokensIn: 40, tokensOut: 10, cost: 0.02 })
		const initial = [first, second]
		const cache = consolidateTokenUsageIncremental(initial)

		expect(cache.usage).toEqual(consolidateTokenUsage(initial))
		expect(cache.prefixLength).toBe(1)
		expect(cache.prefixUsage.totalTokensIn).toBe(100)
		expect(cache.prefixUsage.totalCost).toBeCloseTo(0.01)
	})

	it("reuses frozen prefix totals when only the tail object is replaced", () => {
		const first = createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01 })
		const streaming = createApiReqMessage(1001, { tokensIn: 0, tokensOut: 0 })
		const previous = consolidateTokenUsageIncremental([first, streaming])
		const updated = createApiReqMessage(1001, { tokensIn: 40, tokensOut: 10, cost: 0.05 })
		const next = consolidateTokenUsageIncremental([first, updated], previous)

		expect(next.prefixLength).toBe(1)
		expect(next.prefixUsage).toBe(previous.prefixUsage)
		expect(next.usage.totalTokensIn).toBe(140)
		expect(next.usage.totalTokensOut).toBe(60)
		expect(next.usage.totalCost).toBeCloseTo(0.06)
		expect(next.usage.contextTokens).toBe(50)
	})

	it("adds only the appended row onto frozen prefix totals", () => {
		const first = createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01 })
		const second = createApiReqMessage(1001, { tokensIn: 40, tokensOut: 10, cost: 0.02 })
		const previous = consolidateTokenUsageIncremental([first, second])
		const third = createApiReqMessage(1002, { tokensIn: 7, tokensOut: 3, cost: 0.03 })
		const next = consolidateTokenUsageIncremental([first, second, third], previous)

		expect(next.prefixLength).toBe(2)
		expect(next.usage).toEqual(consolidateTokenUsage([first, second, third]))
		expect(next.usage.totalTokensIn).toBe(147)
		expect(next.usage.contextTokens).toBe(10)
	})

	it("rescans after truncation instead of keeping stale totals", () => {
		const first = createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01 })
		const second = createApiReqMessage(1001, { tokensIn: 40, tokensOut: 10, cost: 0.02 })
		const previous = consolidateTokenUsageIncremental([first, second])
		const next = consolidateTokenUsageIncremental([first], previous)

		expect(next.prefixLength).toBe(0)
		expect(next.usage).toEqual(consolidateTokenUsage([first]))
		expect(next.usage.totalTokensIn).toBe(100)
		expect(next.usage.contextTokens).toBe(150)
	})

	it("lets a later condense_context override frozen prefix context tokens", () => {
		const first = createApiReqMessage(1000, { tokensIn: 100, tokensOut: 50, cost: 0.01 })
		const previous = consolidateTokenUsageIncremental([first])
		const condense = {
			ts: 1001,
			type: "say",
			say: "condense_context",
			contextCondense: { newContextTokens: 5000, cost: 0.05 },
		} as ClineMessage
		const next = consolidateTokenUsageIncremental([first, condense], previous)

		expect(next.usage.contextTokens).toBe(5000)
		expect(next.usage.totalCost).toBeCloseTo(0.06)
	})
})

describe("hasTokenUsageChanged", () => {
	it("should return true when snapshot is undefined", () => {
		const current = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}

		expect(hasTokenUsageChanged(current, undefined)).toBe(true)
	})

	it("should return false when values are the same", () => {
		const current = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}
		const snapshot = { ...current }

		expect(hasTokenUsageChanged(current, snapshot)).toBe(false)
	})

	it("should return true when totalTokensIn changes", () => {
		const current = {
			totalTokensIn: 200,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}
		const snapshot = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}

		expect(hasTokenUsageChanged(current, snapshot)).toBe(true)
	})

	it("should return true when totalCost changes", () => {
		const current = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.02,
			contextTokens: 150,
		}
		const snapshot = {
			totalTokensIn: 100,
			totalTokensOut: 50,
			totalCost: 0.01,
			contextTokens: 150,
		}

		expect(hasTokenUsageChanged(current, snapshot)).toBe(true)
	})
})

describe("hasToolUsageChanged", () => {
	it("should return true when snapshot is undefined", () => {
		const current = {
			read_file: { attempts: 1, failures: 0 },
		}

		expect(hasToolUsageChanged(current, undefined)).toBe(true)
	})

	it("should return false when values are the same", () => {
		const current = {
			read_file: { attempts: 1, failures: 0 },
		}
		const snapshot = {
			read_file: { attempts: 1, failures: 0 },
		}

		expect(hasToolUsageChanged(current, snapshot)).toBe(false)
	})

	it("should return true when a tool is added", () => {
		const current = {
			read_file: { attempts: 1, failures: 0 },
			write_to_file: { attempts: 1, failures: 0 },
		}
		const snapshot = {
			read_file: { attempts: 1, failures: 0 },
		}

		expect(hasToolUsageChanged(current, snapshot)).toBe(true)
	})

	it("should return true when attempts change", () => {
		const current = {
			read_file: { attempts: 2, failures: 0 },
		}
		const snapshot = {
			read_file: { attempts: 1, failures: 0 },
		}

		expect(hasToolUsageChanged(current, snapshot)).toBe(true)
	})

	it("should return true when failures change", () => {
		const current = {
			read_file: { attempts: 1, failures: 1 },
		}
		const snapshot = {
			read_file: { attempts: 1, failures: 0 },
		}

		expect(hasToolUsageChanged(current, snapshot)).toBe(true)
	})
})
