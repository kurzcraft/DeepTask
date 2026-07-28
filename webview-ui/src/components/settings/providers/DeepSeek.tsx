import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type RouterModels,
	deepSeekDefaultModelId,
	deepSeekModels,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { DynamicVendorModelSettings } from "./DynamicVendorModelSettings"

type DeepSeekProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	simplifySettings?: boolean
	routerModels?: RouterModels
}

export const DeepSeek = ({ apiConfiguration, setApiConfigurationField, routerModels }: DeepSeekProps) => {
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

	return (
		<>
			<VSCodeTextField
				value={apiConfiguration?.deepSeekApiKey || ""}
				type="password"
				onInput={handleInputChange("deepSeekApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.deepSeekApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			<VSCodeTextField
				value={apiConfiguration?.deepSeekBaseUrl || "https://api.deepseek.com"}
				type="url"
				onInput={handleInputChange("deepSeekBaseUrl")}
				placeholder="https://api.deepseek.com"
				className="w-full">
				<label className="block font-medium mb-1">Base URL</label>
			</VSCodeTextField>
			{!apiConfiguration?.deepSeekApiKey && (
				<VSCodeButtonLink href="https://platform.deepseek.com/" appearance="secondary">
					{t("settings:providers.getDeepSeekApiKey")}
				</VSCodeButtonLink>
			)}
			<DynamicVendorModelSettings
				provider="deepseek"
				defaultModelId={deepSeekDefaultModelId}
				staticModels={deepSeekModels}
				remoteModels={routerModels?.deepseek}
				apiKey={apiConfiguration.deepSeekApiKey}
				baseUrl={apiConfiguration.deepSeekBaseUrl}
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
			/>
		</>
	)
}
