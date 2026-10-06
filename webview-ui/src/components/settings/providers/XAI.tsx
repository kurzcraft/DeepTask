import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ModelInfo,
	type ProviderSettings,
	type RouterModels,
	xaiDefaultModelId,
	xaiModels,
	xaiInferModelInfo,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { DynamicVendorModelSettings } from "./DynamicVendorModelSettings"

type XAIProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
	routerModels?: RouterModels
}

export const XAI = ({ apiConfiguration, setApiConfigurationField, routerModels }: XAIProps) => {
	const { t } = useAppTranslation()

	const handleInputChange = useCallback(
		<K extends keyof ProviderSettings, E>(
			field: K,
			transform: (event: E) => ProviderSettings[K] = inputEventTransform,
		) =>
			(event: E | Event) => {
				setApiConfigurationField(field, transform(event as E))
			},
		[setApiConfigurationField],
	)

	// kilocode_change: capability inference for detected ids missing from the
	// static table — newer grok generations get vision/tool metadata
	// automatically.
	const inferModelInfo = useCallback(
		(modelId: string): Partial<ModelInfo> | undefined => xaiInferModelInfo(modelId),
		[],
	)

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.xaiApiKey || ""}
				type="password"
				onInput={handleInputChange("xaiApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.xaiApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.xaiApiKey && (
				<VSCodeButtonLink href="https://api.x.ai/docs" appearance="secondary">
					{t("settings:providers.getXaiApiKey")}
				</VSCodeButtonLink>
			)}
			<DynamicVendorModelSettings
				provider="xai"
				defaultModelId={xaiDefaultModelId}
				staticModels={xaiModels}
				remoteModels={routerModels?.xai}
				apiKey={apiConfiguration.xaiApiKey}
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
				inferModelInfo={inferModelInfo}
			/>
		</>
	)
}
