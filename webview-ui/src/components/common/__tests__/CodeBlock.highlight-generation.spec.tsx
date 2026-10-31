// kilocode_change - regression coverage for both code block implementations.
import { StrictMode } from "react"
import { act, cleanup, fireEvent, render } from "@/utils/test-utils"

import CommonCodeBlock from "../CodeBlock"
import KiloCodeBlock from "../../kilocode/common/CodeBlock"

const mocks = vi.hoisted(() => ({
	getHighlighter: vi.fn(),
	codeToHast: vi.fn(),
	copyWithFeedback: vi.fn(),
}))

vi.mock("@src/utils/highlighter", () => ({
	normalizeLanguage: (language?: string) => language || "txt",
	isLanguageLoaded: () => true,
	getHighlighter: mocks.getHighlighter,
	shouldSkipShikiHighlight: (source?: string, language?: string) => {
		const text = source ?? ""
		if (text.length === 0 || text.length > 4_000) {
			return true
		}
		return ["log", "text", "plaintext", "plain", "txt"].includes((language ?? "").toLowerCase())
	},
}))
vi.mock("shiki", () => ({ bundledLanguages: { typescript: {}, javascript: {}, txt: {} } }))
vi.mock("@src/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@src/utils/clipboard", () => ({
	useCopyToClipboard: () => ({ showCopyFeedback: false, copyWithFeedback: mocks.copyWithFeedback }),
}))

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: Error) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function hast(source: string) {
	return {
		type: "element",
		tagName: "pre",
		properties: {},
		children: [{ type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: source }] }],
	}
}

const highlighter = { codeToHast: mocks.codeToHast }

describe.each([
	["common", CommonCodeBlock],
	["kilocode", KiloCodeBlock],
] as const)("%s code block request lifetime", (_name, CodeBlock) => {
	beforeEach(() => {
		mocks.getHighlighter.mockReset().mockResolvedValue(highlighter)
		mocks.codeToHast.mockReset().mockImplementation(hast)
		mocks.copyWithFeedback.mockReset().mockResolvedValue(true)
		vi.stubGlobal(
			"IntersectionObserver",
			class {
				observe() {}
				unobserve() {}
				disconnect() {}
			},
		)
	})

	afterEach(() => {
		cleanup()
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("tokenizes only the latest streamed source after shared initialization", async () => {
		const loading = deferred<typeof highlighter>()
		mocks.getHighlighter.mockReturnValue(loading.promise)
		const view = render(<CodeBlock source="frame-0" language="typescript" />)
		for (let frame = 1; frame <= 30; frame++) {
			view.rerender(<CodeBlock source={`frame-${frame}`} language="typescript" />)
		}
		await act(async () => loading.resolve(highlighter))
		expect(mocks.codeToHast).toHaveBeenCalledTimes(1)
		expect(mocks.codeToHast.mock.calls[0][0]).toBe("frame-30")
		expect(view.container.querySelector("code")?.textContent).toBe("frame-30")
	})

	it("does not let an old language load overwrite a newer result", async () => {
		const older = deferred<typeof highlighter>()
		mocks.getHighlighter.mockReturnValueOnce(older.promise)
		const view = render(<CodeBlock source="old source" language="typescript" />)
		await act(async () => view.rerender(<CodeBlock source="new source" language="javascript" />))
		await act(async () => older.resolve(highlighter))
		expect(view.container.querySelector("code")?.textContent).toBe("new source")
		expect(mocks.codeToHast).toHaveBeenCalledTimes(1)
	})

	it("does not replace new output with an obsolete request error fallback", async () => {
		const older = deferred<typeof highlighter>()
		mocks.getHighlighter.mockReturnValueOnce(older.promise)
		const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
		const view = render(<CodeBlock source="old source" language="typescript" />)
		await act(async () => view.rerender(<CodeBlock source="new source" language="typescript" />))
		await act(async () => older.reject(new Error("old load failed")))
		expect(view.container.querySelector("code")?.textContent).toBe("new source")
		expect(log).toHaveBeenCalled()
	})

	it("discards a superseded HAST result before committing JSX", async () => {
		const older = deferred<ReturnType<typeof hast>>()
		mocks.codeToHast.mockReturnValueOnce(older.promise)
		const view = render(<CodeBlock source="old source" language="typescript" />)
		await act(async () => undefined)
		await act(async () => view.rerender(<CodeBlock source="new source" language="typescript" />))
		await act(async () => older.resolve(hast("old source")))
		expect(view.container.querySelector("code")?.textContent).toBe("new source")
	})

	it("does not tokenize after unmount", async () => {
		const loading = deferred<typeof highlighter>()
		mocks.getHighlighter.mockReturnValue(loading.promise)
		const view = render(<CodeBlock source="full source" language="typescript" />)
		view.unmount()
		await act(async () => loading.resolve(highlighter))
		expect(mocks.codeToHast).not.toHaveBeenCalled()
	})

	it("does not reactivate a disposed StrictMode effect", async () => {
		const loading = deferred<typeof highlighter>()
		mocks.getHighlighter.mockReturnValue(loading.promise)
		const view = render(
			<StrictMode>
				<CodeBlock source="latest" language="typescript" />
			</StrictMode>,
		)
		await act(async () => loading.resolve(highlighter))
		expect(mocks.codeToHast).toHaveBeenCalledTimes(1)
		expect(view.container.querySelector("code")?.textContent).toBe("latest")
	})

	it("keeps large Unicode text complete and copies the exact raw source", async () => {
		const source = `中文🙂<tag>${"payload".repeat(12000)}END`
		const rawSource = `original:${source}`
		// jsdom has no layout; provide an actually visible scroller fixture.
		vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 800,
			bottom: 600,
			width: 800,
			height: 600,
			toJSON: () => ({}),
		})
		const view = render(
			<div data-virtuoso-scroller="true">
				<CodeBlock source={source} rawSource={rawSource} language="typescript" />
			</div>,
		)
		await act(async () => undefined)
		expect(view.container.querySelector("code")?.textContent).toBe(source)
		fireEvent.mouseEnter(view.container.firstElementChild!.firstElementChild!)
		const copyButton = Array.from(view.container.querySelectorAll("button")).find((button) =>
			button.querySelector("svg.lucide-copy"),
		)
		expect(copyButton).toBeDefined()
		fireEvent.mouseOver(copyButton!)
		fireEvent.click(copyButton!)
		expect(mocks.copyWithFeedback.mock.calls[0][0]).toBe(rawSource)
	})

	it("preserves full plain text when the current request fails", async () => {
		mocks.getHighlighter.mockRejectedValueOnce(new Error("current load failed"))
		vi.spyOn(console, "error").mockImplementation(() => undefined)
		const source = "中文🙂 <script> text stays literal"
		const view = render(<CodeBlock source={source} language="typescript" />)
		await act(async () => undefined)
		expect(view.container.querySelector("code")?.textContent).toBe(source)
		expect(view.container.querySelector("script")).toBeNull()
	})

	it("does not tokenize logs or oversized blocks", async () => {
		const logView = render(<CodeBlock source="command output line" language="log" />)
		await act(async () => undefined)
		expect(mocks.codeToHast).not.toHaveBeenCalled()
		expect(logView.container.querySelector("code")?.textContent).toBe("command output line")

		const oversized = `payload${"x".repeat(4001)}END`
		const largeView = render(<CodeBlock source={oversized} language="typescript" />)
		await act(async () => undefined)
		expect(mocks.codeToHast).not.toHaveBeenCalled()
		expect(largeView.container.querySelector("code")?.textContent).toBe(oversized)
	})
})
