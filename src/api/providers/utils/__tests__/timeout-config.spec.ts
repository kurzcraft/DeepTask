// npx vitest run api/providers/utils/__tests__/timeout-config.spec.ts

import { getApiRequestTimeout, OPENAI_UNLIMITED_TIMEOUT_MS } from "../timeout-config"
import * as vscode from "vscode"

// Mock vscode
vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn().mockReturnValue({
			get: vitest.fn(),
		}),
	},
}))

describe("getApiRequestTimeout", () => {
	let mockGetConfig: any

	beforeEach(() => {
		vitest.clearAllMocks()
		mockGetConfig = vitest.fn()
		;(vscode.workspace.getConfiguration as any).mockReturnValue({
			get: mockGetConfig,
		})
	})

	it("defaults to unlimited timeout when the provider checkbox is unset", () => {
		mockGetConfig.mockReturnValue(600)

		const timeout = getApiRequestTimeout()

		expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled()
		expect(timeout).toBe(OPENAI_UNLIMITED_TIMEOUT_MS)
	})

	it("defaults to unlimited timeout when the provider checkbox is checked", () => {
		mockGetConfig.mockReturnValue(600)

		expect(getApiRequestTimeout({ disableApiRequestTimeout: true })).toBe(OPENAI_UNLIMITED_TIMEOUT_MS)
		expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled()
	})

	it("should return default timeout of 600000ms when no configuration is set", () => {
		mockGetConfig.mockReturnValue(600)

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith("deeptask")
		expect(mockGetConfig).toHaveBeenCalledWith("apiRequestTimeout", 600)
		expect(timeout).toBe(600000) // 600 seconds in milliseconds
	})

	it("should return custom timeout in milliseconds", () => {
		mockGetConfig.mockReturnValue(1200) // 20 minutes

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(timeout).toBe(1200000) // 1200 seconds in milliseconds
	})

	it("should return the 32-bit setTimeout ceiling for zero timeout", () => {
		mockGetConfig.mockReturnValue(0)

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		// Zero must not become undefined (SDK falls back to 600s) or 0 (SDK aborts immediately).
		expect(timeout).toBe(OPENAI_UNLIMITED_TIMEOUT_MS)
	})

	it("should return the 32-bit setTimeout ceiling for negative values", () => {
		mockGetConfig.mockReturnValue(-100)

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(timeout).toBe(OPENAI_UNLIMITED_TIMEOUT_MS)
	})

	it("should handle null by using default", () => {
		mockGetConfig.mockReturnValue(null)

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(timeout).toBe(600000) // Should fall back to default 600 seconds
	})

	it("should handle undefined by using default", () => {
		mockGetConfig.mockReturnValue(undefined)

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(timeout).toBe(600000) // Should fall back to default 600 seconds
	})

	it("should handle NaN by using default", () => {
		mockGetConfig.mockReturnValue(NaN)

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(timeout).toBe(600000) // Should fall back to default 600 seconds
	})

	it("should handle string values by using default", () => {
		mockGetConfig.mockReturnValue("not-a-number") // String instead of number

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(timeout).toBe(600000) // Should fall back to default since it's not a number
	})

	it("should handle boolean values by using default", () => {
		mockGetConfig.mockReturnValue(true) // Boolean instead of number

		const timeout = getApiRequestTimeout({ disableApiRequestTimeout: false })

		expect(timeout).toBe(600000) // Should fall back to default since it's not a number
	})
})
