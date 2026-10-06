// kilocode_change - new file
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import type { ModelInfo, ModelRecord, ProviderSettings } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useRouterModels } from "@src/components/ui/hooks/useRouterModels"

import { ModelPicker } from "../ModelPicker"

const VENDOR_CONTEXT_FALLBACK = 256_000

// kilocode_change (defect U, 9.2.8): pick the semantically newest model id from
// a detected list so the default selection auto-tracks vendor releases
// (grok-4.7 > grok-4.6 > grok-4, glm-5.3 > glm-4.9, ...).
// Compares the numeric segments embedded in the id segment by segment;
// ids without any digits (legacy aliases like deepseek-chat) sort last.
const versionSegments = (id: string): number[] =>
	(id.match(/\d+/g) ?? []).map((segment) => Number.parseInt(segment, 10))

const compareVersionedIds = (a: string, b: string): number => {
	const segmentsA = versionSegments(a)
	const segmentsB = versionSegments(b)

	if (segmentsA.length === 0 && segmentsB.length === 0) return a.localeCompare(b)
	if (segmentsA.length === 0) return -1
	if (segmentsB.length === 0) return 1

	const length = Math.max(segmentsA.length, segmentsB.length)
	for (let i = 0; i < length; i++) {
		const valueA = segmentsA[i] ?? 0
		const valueB = segmentsB[i] ?? 0
		if (valueA !== valueB) return valueA - valueB
	}
	return 0
}

export const pickLatestModelId = (models?: ModelRecord): string | undefined => {
	const ids = Object.keys(models ?? {})
	if (ids.length === 0) return undefined
	return ids.reduce((best, id) => (compareVersionedIds(id, best) > 0 ? id : best))
}

// kilocode_change (defect U, 9.2.8): module-level memo of auto-applied ids per
// provider, so settings-tab remounts within the same webview lifetime do not
// mistake an auto-applied value for a manual user choice.
const autoAppliedByProvider = new Map<string, string>()

type DynamicVendorModelSettingsProps = {
	provider: "deepseek" | "groq" | "mistral" | "cerebras" | "zai" | "xai"
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
	/** kilocode_change: infer capability fields (e.g. supportsImages) for
	 * detected ids missing from the static table, so new versions / aliases
	 * (deepseek-flash, deepseek-v4.2, ...) get correct metadata automatically
	 * without waiting for a static-table update. */
	inferModelInfo?: (modelId: string) => Partial<ModelInfo> | undefined
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
	inferModelInfo,
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
			zaiApiKey: provider === "zai" ? debouncedApiKey : undefined,
			zaiBaseUrl: provider === "zai" ? baseUrl : undefined,
			xaiApiKey: provider === "xai" ? debouncedApiKey : undefined,
		}),
		[baseUrl, debouncedApiKey, provider],
	)
	// kilocode_change (defect T, 9.2.8): anonymous discovery — detection fires
	// as soon as the settings panel mounts (public /models endpoints answer
	// without auth). Typing a key later upgrades to authenticated discovery
	// via the debounced queryKey change.
	const { data: accountModels, refetch, isFetching, isError } = useRouterModels(requestOptions, {
		provider,
	})
	const detectedModels = accountModels?.[provider] ?? remoteModels
	const detectedModelCount = detectedModels ? Object.keys(detectedModels).length : 0
	const detectionFailed = isError || Boolean(debouncedApiKey && accountModels && detectedModelCount === 0)
	// kilocode_change: field-level merge instead of whole-entry replacement —
	// detected entries from /models endpoints carry no description, so keep the
	// static table's description (and vision flag) when a detected id collides
	// with a known static id (e.g. deepseek-chat / deepseek-flash aliases).
	const models = useMemo(() => {
		const merged: ModelRecord = { ...staticModels }
		for (const [id, detected] of Object.entries(detectedModels ?? {})) {
			// kilocode_change: unknown detected ids (new versions / aliases not
			// yet in the static table) get inferred capability fields so they
			// behave correctly (e.g. vision) without a static-table release.
			const inferred = staticModels[id] ? undefined : inferModelInfo?.(id)
			merged[id] = { ...(inferred ?? {}), ...(staticModels[id] ?? {}), ...detected }
		}
		return merged
	}, [detectedModels, inferModelInfo, staticModels])
	// kilocode_change (defect U, 9.2.8): default selection auto-tracks the
	// newest detected model. apiModelId stays unset until the user picks one,
	// so the "default" keeps following vendor releases (grok-4.7 today,
	// grok-4.8 tomorrow) without any user action.
	const latestDetectedId = useMemo(() => pickLatestModelId(detectedModels), [detectedModels])
	const selectedModelId = apiConfiguration.apiModelId || latestDetectedId || defaultModelId
	const detectedInfo = detectedModels?.[selectedModelId]
	const staticInfo = staticModels[selectedModelId]
	const hasBoundOverride = apiConfiguration.apiModelInfoModelId === selectedModelId
	const hasManualOverride = hasBoundOverride && apiConfiguration.apiModelInfoSource === "manual"
	const displayedContextWindow = hasBoundOverride
		? apiConfiguration.apiModelInfo?.contextWindow
		: detectedInfo?.contextWindow ?? staticInfo?.contextWindow ?? (debouncedApiKey ? VENDOR_CONTEXT_FALLBACK : undefined)

	// kilocode_change (defect U, 9.2.8): persist the auto-tracked latest id so
	// the backend actually uses it. Rules:
	//  - never DOWNGRADE (stored version newer than detected latest stays);
	//  - the module-level map remembers what we auto-applied per provider, so
	//    a value that differs from it (user picked manually) is respected and
	//    survives settings-tab remounts within the same webview lifetime.
	useEffect(() => {
		if (!latestDetectedId) {
			return
		}
		const stored = apiConfiguration.apiModelId
		if (stored && stored !== defaultModelId && stored !== autoAppliedByProvider.get(provider)) {
			return // user pinned a different model — stop auto-tracking
		}
		if (stored === latestDetectedId) {
			return // already current
		}
		if (stored && stored !== defaultModelId && compareVersionedIds(stored, latestDetectedId) > 0) {
			return // stored is newer than anything detected — keep it
		}
		autoAppliedByProvider.set(provider, latestDetectedId)
		setApiConfigurationField("apiModelId", latestDetectedId, false)
	}, [apiConfiguration.apiModelId, defaultModelId, latestDetectedId, provider, setApiConfigurationField])

	useEffect(() => {
		// kilocode_change (defect T, 9.2.8): anonymous discovery also binds
		// detected model info — manual overrides still win. The 256k safety
		// fallback keeps binding for ids unknown to both tables.
		if (hasManualOverride) {
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
			{/* kilocode_change: manual refresh button removed — model detection is
			    fully automatic: it triggers 500ms after the API key is typed
			    (debounced) and again whenever baseUrl / provider config changes. */}
			<div className="flex items-center gap-2" data-testid="vendor-model-status">
				{isFetching && <span className="codicon codicon-loading codicon-modifier-spin" />}
				<div className="min-w-0 text-sm text-vscode-descriptionForeground">
					{isFetching
						? t("settings:providers.refreshModels.loading")
						: detectionFailed
							? t("settings:providers.sapAiCore.noModelsFound")
							: detectedModelCount > 0
								? t("settings:providers.sapAiCore.modelsCount", { count: detectedModelCount })
								: ""}
				</div>
			</div>
			<ModelPicker
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				defaultModelId={latestDetectedId || defaultModelId}
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
