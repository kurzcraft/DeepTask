// npx vitest src/components/settings/__tests__/RateLimitSecondsControl.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import { parseRateLimitSecondsInput, RateLimitSecondsControl } from "../RateLimitSecondsControl"

vi.mock("@/components/ui", () => ({
	...vi.importActual("@/components/ui"),
	Slider: ({ value, onValueChange, disabled }: any) => (
		<input
			type="range"
			role="slider"
			value={value[0]}
			disabled={disabled}
			onChange={(e) => onValueChange([parseFloat(e.target.value)])}
		/>
	),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children, onChange, checked, ...props }: any) => (
		<label>
			<input
				type="checkbox"
				role="checkbox"
				checked={checked || false}
				aria-checked={checked || false}
				onChange={(e: any) => onChange?.({ target: { checked: e.target.checked } })}
				{...props}
			/>
			{children}
		</label>
	),
	VSCodeTextField: ({ value, onInput, disabled, ...props }: any) => (
		<input
			type="text"
			value={value}
			disabled={disabled}
			onChange={(e) => onInput?.({ target: { value: e.target.value } })}
			{...props}
		/>
	),
	VSCodeButton: ({ children, onClick, disabled }: any) => (
		<button type="button" disabled={disabled} onClick={onClick}>
			{children}
		</button>
	),
}))

describe("parseRateLimitSecondsInput", () => {
	it("parses whole seconds and rejects empty or invalid input", () => {
		expect(parseRateLimitSecondsInput("12")).toBe(12)
		expect(parseRateLimitSecondsInput("12.6")).toBe(13)
		expect(parseRateLimitSecondsInput("-3")).toBe(0)
		expect(parseRateLimitSecondsInput("")).toBeUndefined()
		expect(parseRateLimitSecondsInput("abc")).toBeUndefined()
	})
})

describe("RateLimitSecondsControl", () => {
	it("defaults the no-timeout checkbox to checked and disables interval controls", () => {
		const onChange = vi.fn()
		const onDisableTimeoutChange = vi.fn()
		render(
			<RateLimitSecondsControl
				value={5}
				onChange={onChange}
				onDisableTimeoutChange={onDisableTimeoutChange}
			/>,
		)

		expect(screen.getByTestId("disable-api-request-timeout")).toBeChecked()
		expect(screen.getByRole("slider")).toBeDisabled()
		expect(screen.getByTestId("rate-limit-seconds-input")).toBeDisabled()
		expect(screen.getByRole("button", { name: "settings:providers.rateLimitSeconds.save" })).toBeDisabled()
	})

	it("keeps the slider and seconds input in sync, then saves the typed value", () => {
		const onChange = vi.fn()
		const onDisableTimeoutChange = vi.fn()
		render(
			<RateLimitSecondsControl
				value={5}
				disableTimeout={false}
				onChange={onChange}
				onDisableTimeoutChange={onDisableTimeoutChange}
			/>,
		)

		const slider = screen.getByRole("slider")
		const input = screen.getByTestId("rate-limit-seconds-input")
		const save = screen.getByRole("button", { name: "settings:providers.rateLimitSeconds.save" })

		expect(slider).toHaveValue("5")
		expect(input).toHaveValue("5")
		expect(save).toBeDisabled()

		fireEvent.change(slider, { target: { value: "8" } })
		expect(onChange).toHaveBeenCalledWith(8)
		expect(input).toHaveValue("8")

		fireEvent.change(input, { target: { value: "90" } })
		expect(onChange).not.toHaveBeenCalledWith(90)
		expect(save).toBeEnabled()

		fireEvent.click(save)
		expect(onChange).toHaveBeenCalledWith(90)
	})

	it("does not apply interval edits while unlimited waiting is checked", () => {
		const onChange = vi.fn()
		const onDisableTimeoutChange = vi.fn()
		render(
			<RateLimitSecondsControl
				value={5}
				disableTimeout={true}
				onChange={onChange}
				onDisableTimeoutChange={onDisableTimeoutChange}
			/>,
		)

		fireEvent.change(screen.getByRole("slider"), { target: { value: "9" } })
		fireEvent.change(screen.getByTestId("rate-limit-seconds-input"), { target: { value: "12" } })
		fireEvent.click(screen.getByRole("button", { name: "settings:providers.rateLimitSeconds.save" }))

		expect(onChange).not.toHaveBeenCalled()
		fireEvent.click(screen.getByTestId("disable-api-request-timeout"))
		expect(onDisableTimeoutChange).toHaveBeenCalledWith(false)
	})
})
