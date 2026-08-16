import * as vscode from "vscode"
import { Package } from "../../../shared/package"

/**
 * OpenAI SDK treats `undefined` as DEFAULT_TIMEOUT (600_000 ms) and `0` as
 * "abort immediately" via setTimeout(..., 0). The largest delay setTimeout
 * can honor is the signed 32-bit integer maximum (~24.8 days).
 */
export const OPENAI_UNLIMITED_TIMEOUT_MS = 2_147_483_647

type ApiRequestTimeoutOptions = {
	disableApiRequestTimeout?: boolean
}

/**
 * Gets the API request timeout in milliseconds.
 *
 * Provider checkbox `disableApiRequestTimeout` defaults to checked (unset !== false)
 * and must win over the VSCode `apiRequestTimeout` setting. A configured `0` also
 * means unlimited, but must not be forwarded as `undefined` or `0`.
 */
export function getApiRequestTimeout(options?: ApiRequestTimeoutOptions): number {
	// kilocode_change start
	if (options?.disableApiRequestTimeout !== false) {
		return OPENAI_UNLIMITED_TIMEOUT_MS
	}
	// kilocode_change end

	// Get timeout with validation to ensure it's a valid non-negative number
	const configTimeout = vscode.workspace.getConfiguration(Package.name).get<number>("apiRequestTimeout", 600)

	// Validate that it's actually a number and not NaN
	if (typeof configTimeout !== "number" || isNaN(configTimeout)) {
		return 600 * 1000 // Default to 600 seconds
	}

	// 0 or negative means "no timeout". Do not return undefined (SDK falls back
	// to 600s) or 0 (SDK aborts immediately).
	if (configTimeout <= 0) {
		return OPENAI_UNLIMITED_TIMEOUT_MS // kilocode_change
	}

	return configTimeout * 1000 // Convert to milliseconds
}
