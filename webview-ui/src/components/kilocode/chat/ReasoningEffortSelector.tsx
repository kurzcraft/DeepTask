import { useMemo } from "react"
import { SelectDropdown, type DropdownOption } from "@/components/ui"
import { reasoningEfforts, type ModelInfo, type ProviderSettings } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

type ReasoningEffortOption = "disable" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh"

interface ReasoningEffortSelectorProps {
	currentApiConfigName?: string
	apiConfiguration: ProviderSettings
	modelInfo?: ModelInfo
}

const effortLabel = (value: ReasoningEffortOption, t: (key: string) => string) =>
	value === "disable" ? t("settings:providers.reasoningEffort.off") : t(`settings:providers.reasoningEffort.${value}`)

export const ReasoningEffortSelector = ({
	currentApiConfigName,
	apiConfiguration,
	modelInfo,
}: ReasoningEffortSelectorProps) => {
	const { t } = useAppTranslation()
	const supports = modelInfo?.supportsReasoningEffort
	const required = !!modelInfo?.requiredReasoningEffort

	const values = useMemo(() => {
		const levels: ReasoningEffortOption[] = Array.isArray(supports)
			? (supports as ReasoningEffortOption[]).filter((value) => value !== "disable")
			: ([...reasoningEfforts] as ReasoningEffortOption[])
		// A required-effort model must always reason, so no "off" entry.
		return required ? levels : (["disable", ...levels] as ReasoningEffortOption[])
	}, [supports, required])

	const options = useMemo<DropdownOption[]>(
		() => values.map((value) => ({ value, label: effortLabel(value, t) })),
		[values, t],
	)

	const value = useMemo(() => {
		const stored = apiConfiguration.reasoningEffort as ReasoningEffortOption | undefined
		if (stored && values.includes(stored)) {
			return stored
		}
		if (required) {
			const modelDefault = modelInfo?.reasoningEffort as ReasoningEffortOption | undefined
			return modelDefault && values.includes(modelDefault) ? modelDefault : (values[0] ?? "medium")
		}
		return "disable"
	}, [apiConfiguration.reasoningEffort, values, required, modelInfo])

	const onChange = (selected: string) => {
		if (!currentApiConfigName) {
			return
		}
		const next = selected as ReasoningEffortOption
		if (apiConfiguration.reasoningEffort === next && apiConfiguration.enableReasoningEffort === (next !== "disable")) {
			return
		}
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				enableReasoningEffort: next !== "disable",
				reasoningEffort: next,
			},
		})
	}

	if (apiConfiguration.profileType === "autocomplete" || apiConfiguration.apiProvider === "virtual-quota-fallback") {
		return null
	}

	return (
		<SelectDropdown
			value={value}
			title={t("settings:providers.reasoningEffort.label")}
			options={options}
			onChange={onChange}
			disableSearch
			triggerClassName={cn(
				"w-full text-ellipsis overflow-hidden p-0",
				"bg-transparent border-transparent hover:bg-transparent hover:border-transparent",
			)}
			triggerIcon={false}
			itemClassName="group"
		/>
	)
}
