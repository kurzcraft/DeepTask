// kilocode_change - new file
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ModelRecord, ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"
import { Button } from "@src/components/ui"

import { ModelPicker } from "../ModelPicker"

const VENDOR_CONTEXT_FALLBACK = 256_000

type DynamicVendorModelSettingsProps = {
	provider: "deepseek" | "groq" | "mistral" | "cerebras"
	defaultModelId: string
	staticModels: ModelRecord
	remoteModels?: ModelRecord
	apiKey?: string
	baseUrl?: string
	apiConfiguration: ProviderSettings
	setApiConfigurationField: <K extends keyof ProviderSettings>(
		field: K,
		value: ProviderSettings[K],
		isUserAction?: boolean,
	) => void
}

export const DynamicVendorModelSettings = ({
	provider,
	defaultModelId,
	staticModels,
	remoteModels,
	apiKey,
	baseUrl,
	apiConfiguration,
	setApiConfigurationField,
}: DynamicVendorModelSettingsProps) => {
	const { t } = useAppTranslation()
	const [debouncedApiKey, setDebouncedApiKey] = useState("")

	useEffect(() => {
		const timer = window.setTimeout(() => setDebouncedApiKey(apiKey?.trim() ?? ""), 500)
		return () => window.clearTimeout(timer)
	}, [apiKey])

	const requestOptions = useMemo(
		() => ({
			deepSeekApiKey: provider === "deepseek" ? debouncedApiKey : undefined,
			deepSeekBaseUrl: provider === "deepseek" ? baseUrl : undefined,
			groqApiKey: provider === "groq" ? debouncedApiKey : undefined,
			mistralApiKey: provider === "mistral" ? debouncedApiKey : undefined,
			cerebrasApiKey: provider === "cerebras" ? debouncedApiKey : undefined,
		}),
		[baseUrl, debouncedApiKey, provider],
	)
	const { data: accountModels, refetch, isFetching, isError } = useRouterModels(requestOptions, {
		provider,
		enabled: debouncedApiKey.length > 0,
	})
	const detectedModels = accountModels?.[provider] ?? remoteModels
	const detectedModelCount = detectedModels ? Object.keys(detectedModels).length : 0
	const detectionFailed = isError || Boolean(debouncedApiKey && accountModels && detectedModelCount === 0)
	const models = useMemo(() => ({ ...staticModels, ...(detectedModels ?? {}) }), [detectedModels, staticModels])
	const selectedModelId = apiConfiguration.apiModelId || defaultModelId
	const detectedInfo = detectedModels?.[selectedModelId]
	const staticInfo = staticModels[selectedModelId]
	const hasBoundOverride = apiConfiguration.apiModelInfoModelId === selectedModelId
	const hasManualOverride = hasBoundOverride && apiConfiguration.apiModelInfoSource === "manual"
	const displayedContextWindow = hasBoundOverride
		? apiConfiguration.apiModelInfo?.contextWindow
		: detectedInfo?.contextWindow ?? staticInfo?.contextWindow ?? (debouncedApiKey ? VENDOR_CONTEXT_FALLBACK : undefined)

	useEffect(() => {
		if (!debouncedApiKey || hasManualOverride) {
			return
		}

		const contextWindow = detectedInfo?.contextWindow ?? staticInfo?.contextWindow ?? VENDOR_CONTEXT_FALLBACK
		const nextInfo = { ...(detectedInfo ?? staticInfo ?? {}), contextWindow }
		if (
			apiConfiguration.apiModelInfoModelId === selectedModelId &&
			apiConfiguration.apiModelInfoSource === "detected" &&
			JSON.stringify(apiConfiguration.apiModelInfo) === JSON.stringify(nextInfo)
		) {
			return
		}

		setApiConfigurationField("apiModelInfoModelId", selectedModelId, false)
		setApiConfigurationField("apiModelInfo", nextInfo, false)
		setApiConfigurationField("apiModelInfoSource", "detected", false)
	}, [
		apiConfiguration.apiModelInfo,
		apiConfiguration.apiModelInfoModelId,
		apiConfiguration.apiModelInfoSource,
		debouncedApiKey,
		detectedInfo,
		hasManualOverride,
		selectedModelId,
		setApiConfigurationField,
		staticInfo,
	])

	const updateContextWindow = useCallback(
		(event: Event | FormEvent<HTMLElement>) => {
			const value = Number.parseInt((event.target as HTMLInputElement).value, 10)
			setApiConfigurationField("apiModelInfoModelId", selectedModelId)
			setApiConfigurationField("apiModelInfo", {
				...(hasBoundOverride ? apiConfiguration.apiModelInfo : detectedInfo ?? staticInfo ?? {}),
				contextWindow: Number.isFinite(value) && value > 0 ? value : VENDOR_CONTEXT_FALLBACK,
			})
			setApiConfigurationField("apiModelInfoSource", "manual")
		},
		[
			apiConfiguration.apiModelInfo,
			detectedInfo,
			hasBoundOverride,
			selectedModelId,
			setApiConfigurationField,
			staticInfo,
		],
	)

	return (
		<>
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0 text-sm text-vscode-descriptionForeground" data-testid="vendor-model-status">
					{isFetching
						? t("settings:providers.refreshModels.loading")
						: detectionFailed
							? t("settings:providers.sapAiCore.noModelsFound")
							: detectedModelCount > 0
								? t("settings:providers.sapAiCore.modelsCount", { count: detectedModelCount })
								: ""}
				</div>
				<Button
					variant="secondary"
					onClick={() => refetch()}
					disabled={!debouncedApiKey || isFetching}
					title={t("settings:providers.refreshModels.label")}>
					<RefreshCw className={`size-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
					{t("settings:providers.refreshModels.label")}
				</Button>
			</div>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={defaultModelId}
				models={models}
				modelIdKey="apiModelId"
				serviceName={provider}
				serviceUrl={baseUrl || ""}
				hidePricing
			/>
			<VSCodeTextField
				value={displayedContextWindow?.toString() ?? ""}
				type="text"
				inputMode="numeric"
				onInput={updateContextWindow}
				placeholder={VENDOR_CONTEXT_FALLBACK.toString()}
				className="w-full">
				<label className="block font-medium mb-1">
					{t("settings:providers.customModel.contextWindow.label")}
				</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.customModel.contextWindow.description")}
			</div>
		</>
	)
}
