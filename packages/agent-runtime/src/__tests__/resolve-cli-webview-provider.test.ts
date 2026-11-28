import { describe, expect, it } from "vitest"
import { registeredWebviewViewIds, resolveCliWebviewProvider } from "../host/resolve-cli-webview-provider.js"

const cliProvider = (label: string) => ({
	label,
	handleCLIMessage: async () => {},
})

describe("resolveCliWebviewProvider", () => {
	it("resolves deeptask.SidebarProvider without hardcoding kilo-code", () => {
		const deeptask = cliProvider("deeptask")
		const providers = new Map([
			["deeptask.SidebarProvider", deeptask],
			["other.view", cliProvider("other")],
		])

		expect(resolveCliWebviewProvider(providers)).toBe(deeptask)
	})

	it("still resolves upstream kilo-code.SidebarProvider", () => {
		const kilo = cliProvider("kilo")
		const providers = new Map([["kilo-code.SidebarProvider", kilo]])

		expect(resolveCliWebviewProvider(providers)).toBe(kilo)
	})

	it("prefers SidebarProvider over TabPanelProvider", () => {
		const sidebar = cliProvider("sidebar")
		const tab = cliProvider("tab")
		const providers = new Map([
			["deeptask.TabPanelProvider", tab],
			["deeptask.SidebarProvider", sidebar],
		])

		expect(resolveCliWebviewProvider(providers)).toBe(sidebar)
	})

	it("falls back to any provider with handleCLIMessage", () => {
		const fallback = cliProvider("fallback")
		const providers = new Map([["custom.CliHost", fallback]])

		expect(resolveCliWebviewProvider(providers)).toBe(fallback)
	})

	it("returns undefined when no CLI handler is registered", () => {
		const providers = new Map([["deeptask.SidebarProvider", { label: "no-handler" }]])

		expect(resolveCliWebviewProvider(providers)).toBeUndefined()
		expect(registeredWebviewViewIds(providers)).toEqual(["deeptask.SidebarProvider"])
	})
})
