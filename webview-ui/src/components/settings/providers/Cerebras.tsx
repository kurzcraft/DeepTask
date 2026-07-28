import { useCallback } from "react"
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react"

import {
	type ProviderSettings,
	type RouterModels,
	cerebrasDefaultModelId,
	cerebrasModels,
} from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { VSCodeButtonLink } from "@src/components/common/VSCodeButtonLink"

import { inputEventTransform } from "../transforms"
import { DynamicVendorModelSettings } from "./DynamicVendorModelSettings"

type CerebrasProps = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: (field: keyof ProviderSettings, value: ProviderSettings[keyof ProviderSettings]) => void
	routerModels?: RouterModels
	simplifySettings?: boolean
}

export const Cerebras = ({ apiConfiguration, setApiConfigurationField, routerModels }: CerebrasProps) => {
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
				value={apiConfiguration?.cerebrasApiKey || ""}
				type="password"
				onInput={handleInputChange("cerebrasApiKey")}
				placeholder={t("settings:placeholders.apiKey")}
				className="w-full">
				<label className="block font-medium mb-1">{t("settings:providers.cerebrasApiKey")}</label>
			</VSCodeTextField>
			<div className="text-sm text-vscode-descriptionForeground -mt-2">
				{t("settings:providers.apiKeyStorageNotice")}
			</div>
			{!apiConfiguration?.cerebrasApiKey && (
				<VSCodeButtonLink href="https://cloud.cerebras.ai?utm_source=roocode" appearance="secondary">
					{t("settings:providers.getCerebrasApiKey")}
				</VSCodeButtonLink>
			)}
			<DynamicVendorModelSettings
				provider="cerebras"
				defaultModelId={cerebrasDefaultModelId}
				staticModels={cerebrasModels}
				remoteModels={routerModels?.cerebras}
				apiKey={apiConfiguration.cerebrasApiKey}
				apiConfiguration={apiConfiguration}
				setApiConfigurationField={setApiConfigurationField}
			/>
		</>
	)
}
