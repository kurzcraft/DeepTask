// kilocode_change - new file
/**
 * Resolve the CLI webview provider from whatever viewId the extension
 * actually registered. DeepTask registers `deeptask.SidebarProvider`;
 * upstream Kilo still uses `kilo-code.SidebarProvider`; PKG_NAME can
 * override either. Hardcoding a single viewId drops IPC after ready.
 */
const hasHandleCLIMessage = (provider: unknown): boolean =>
	typeof (provider as { handleCLIMessage?: unknown }).handleCLIMessage === "function"

export function resolveCliWebviewProvider<T>(providers: ReadonlyMap<string, T>): T | undefined {
	for (const [viewId, provider] of providers) {
		if (viewId.endsWith(".SidebarProvider") && hasHandleCLIMessage(provider)) {
			return provider
		}
	}

	for (const provider of providers.values()) {
		if (hasHandleCLIMessage(provider)) {
			return provider
		}
	}

	return undefined
}

export function registeredWebviewViewIds(providers: ReadonlyMap<string, unknown>): string[] {
	return [...providers.keys()]
}
