import { useEffect, useState } from "react"
import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider } from "@/components/ui"

interface RateLimitSecondsControlProps {
	value: number
	disableTimeout?: boolean
	onChange: (value: number) => void
	onDisableTimeoutChange: (value: boolean) => void
}

const MIN_RATE_LIMIT_SECONDS = 0
const SLIDER_MAX_RATE_LIMIT_SECONDS = 60

export const parseRateLimitSecondsInput = (raw: string): number | undefined => {
	const trimmed = raw.trim()
	if (trimmed === "") {
		return undefined
	}

	const parsed = Number(trimmed)
	if (!Number.isFinite(parsed)) {
		return undefined
	}

	return Math.max(MIN_RATE_LIMIT_SECONDS, Math.round(parsed))
}

export const RateLimitSecondsControl = ({
	value,
	disableTimeout,
	onChange,
	onDisableTimeoutChange,
}: RateLimitSecondsControlProps) => {
	const { t } = useAppTranslation()
	const isTimeoutDisabled = disableTimeout !== false
	const [draftSeconds, setDraftSeconds] = useState(String(value))

	useEffect(() => {
		setDraftSeconds(String(value))
	}, [value])

	const sliderMax = Math.max(SLIDER_MAX_RATE_LIMIT_SECONDS, value)
	const parsedDraft = parseRateLimitSecondsInput(draftSeconds)
	const canSave = parsedDraft !== undefined && parsedDraft !== value

	const handleSave = () => {
		if (isTimeoutDisabled || parsedDraft === undefined) {
			return
		}

		onChange(parsedDraft)
		setDraftSeconds(String(parsedDraft))
	}

	return (
		<div className="flex flex-col gap-2">
			<label className="block font-medium mb-1">{t("settings:providers.rateLimitSeconds.label")}</label>
			<VSCodeCheckbox
				checked={isTimeoutDisabled}
				data-testid="disable-api-request-timeout"
				onChange={(e: any) => onDisableTimeoutChange(Boolean(e.target.checked))}>
				<span className="font-medium">{t("settings:providers.rateLimitSeconds.disableTimeout.label")}</span>
			</VSCodeCheckbox>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.rateLimitSeconds.disableTimeout.description")}
			</div>
			<div className={`flex flex-col gap-2 ${isTimeoutDisabled ? "opacity-50" : ""}`}>
				<div className="flex items-center gap-2">
					<Slider
						value={[value]}
						min={MIN_RATE_LIMIT_SECONDS}
						max={sliderMax}
						step={1}
						disabled={isTimeoutDisabled}
						onValueChange={(newValue) => {
							if (isTimeoutDisabled) {
								return
							}

							const nextValue = newValue[0]
							setDraftSeconds(String(nextValue))
							onChange(nextValue)
						}}
					/>
					<VSCodeTextField
						className="w-20"
						value={draftSeconds}
						disabled={isTimeoutDisabled}
						data-testid="rate-limit-seconds-input"
						onInput={(e: any) => setDraftSeconds(e.target.value ?? "")}
						onKeyDown={(e: any) => {
							if (e.key === "Enter") {
								handleSave()
							}
						}}
					/>
					<span className="text-sm text-vscode-descriptionForeground">
						{t("settings:providers.rateLimitSeconds.unit")}
					</span>
					<VSCodeButton disabled={isTimeoutDisabled || !canSave} onClick={handleSave}>
						{t("settings:providers.rateLimitSeconds.save")}
					</VSCodeButton>
				</div>
				<div className="text-sm text-vscode-descriptionForeground">
					{isTimeoutDisabled
						? t("settings:providers.rateLimitSeconds.disabledDescription")
						: t("settings:providers.rateLimitSeconds.description", { value })}
				</div>
			</div>
		</div>
	)
}
