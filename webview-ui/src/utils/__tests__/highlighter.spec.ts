// kilocode_change - new file
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock("shiki", () => ({ createHighlighter: mocks.create, bundledLanguages: { shell: {}, log: {}, javascript: {} } }))

describe("highlighter resource loading", () => {
	beforeEach(() => {
		vi.resetModules()
		mocks.create.mockReset()
	})
	function instance() {
		const themes = new Set(["github-dark", "github-light"])
		const result = {
			loadLanguage: vi.fn(async () => undefined),
			loadTheme: vi.fn(async (theme: string) => {
				themes.add(theme)
			}),
			getLoadedThemes: () => [...themes],
		}
		mocks.create.mockResolvedValue(result)
		return result
	}
	it("initializes once with only the themes actually used by the UI", async () => {
		const highlighter = instance()
		const { getHighlighter } = await import("../highlighter")
		const results = await Promise.all([getHighlighter(), getHighlighter("shell")])
		expect(results).toEqual([highlighter, highlighter])
		expect(mocks.create).toHaveBeenCalledTimes(1)
		expect(mocks.create).toHaveBeenCalledWith({ themes: ["github-dark", "github-light"], langs: ["shell", "log"] })
	})
	it("keeps arbitrary bundled themes and deduplicates concurrent requests", async () => {
		const highlighter = instance()
		const { getHighlighter, isLanguageLoaded } = await import("../highlighter")
		await Promise.all(Array.from({ length: 30 }, () => getHighlighter("javascript", "nord")))
		expect(highlighter.loadLanguage).toHaveBeenCalledTimes(1)
		expect(highlighter.loadTheme).toHaveBeenCalledTimes(1)
		expect(highlighter.loadTheme).toHaveBeenCalledWith("nord")
		expect(isLanguageLoaded("js")).toBe(true)
		await getHighlighter("javascript", "nord")
		expect(highlighter.loadTheme).toHaveBeenCalledTimes(1)
	})
	it("retries failed initialization without poisoning future callers", async () => {
		const highlighter = instance()
		mocks.create.mockRejectedValueOnce(new Error("init failed"))
		const { getHighlighter } = await import("../highlighter")
		await expect(getHighlighter()).rejects.toThrow("init failed")
		await expect(getHighlighter()).resolves.toBe(highlighter)
		expect(mocks.create).toHaveBeenCalledTimes(2)
	})
	it("retries failed theme and language loads", async () => {
		const highlighter = instance()
		const { getHighlighter } = await import("../highlighter")
		highlighter.loadLanguage.mockRejectedValueOnce(new Error("language failed"))
		await expect(getHighlighter("javascript")).rejects.toThrow("language failed")
		highlighter.loadTheme.mockRejectedValueOnce(new Error("theme failed"))
		await expect(getHighlighter("javascript", "nord")).rejects.toThrow("theme failed")
		await expect(getHighlighter("javascript", "nord")).resolves.toBe(highlighter)
		expect(highlighter.loadLanguage).toHaveBeenCalledTimes(2)
		expect(highlighter.loadTheme).toHaveBeenCalledTimes(2)
	})
})
