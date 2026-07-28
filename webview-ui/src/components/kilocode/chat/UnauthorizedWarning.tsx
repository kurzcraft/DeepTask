// kilocode_change start: Deeptask handles provider authorization through local model settings.
import { ClineMessage } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"
import { safeJsonParse } from "@roo/safeJsonParse"
import { useTranslation } from "react-i18next"

type UnauthorizedWarningProps = {
	message: ClineMessage
}

type UnauthorizedWarningData = {
	modelId?: string
}

export const UnauthorizedWarning = ({ message }: UnauthorizedWarningProps) => {
	const { t } = useTranslation()
	const data = safeJsonParse<UnauthorizedWarningData>(message.text)
	const modelId = data?.modelId || t("common:unknown", { defaultValue: "Unknown model" })

	return (
		<div className="flex flex-col gap-3">
			<div className="font-semibold text-vscode-errorForeground">
				{t("chat:apiRequest.errorMessage.401", { defaultValue: "Provider authorization failed" })}
			</div>
			<p className="m-0 break-words text-sm text-vscode-descriptionForeground">{modelId}</p>
			<div className="flex gap-2">
				<Button
					variant="secondary"
					onClick={() => {
						vscode.postMessage({
							type: "askResponse",
							askResponse: "retry_clicked",
							text: message.text,
						})
					}}>
					{t("common:retry", { defaultValue: "Retry" })}
				</Button>
				<Button
					variant="primary"
					onClick={() => {
						vscode.postMessage({
							type: "switchTab",
							tab: "settings",
							values: { section: "providers" },
						})
					}}>
					{t("chat:apiRequest.errorMessage.goToSettings", { defaultValue: "Settings" })}
				</Button>
			</div>
		</div>
	)
}
// kilocode_change end
