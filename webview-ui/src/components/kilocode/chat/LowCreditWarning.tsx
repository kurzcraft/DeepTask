// kilocode_change start: Deeptask renders legacy payment errors without commercial actions.
import { ClineMessage } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { Button } from "@src/components/ui"
import { safeJsonParse } from "@roo/safeJsonParse"
import { useTranslation } from "react-i18next"

type LowCreditWarningProps = {
	message: ClineMessage
}

type LowCreditWarningData = {
	title?: string
	message?: string
}

export const LowCreditWarning = ({ message }: LowCreditWarningProps) => {
	const { t } = useTranslation()
	const data = safeJsonParse<LowCreditWarningData>(message.text)

	return (
		<div className="flex flex-col gap-3">
			<div className="font-semibold text-vscode-errorForeground">{data?.title || t("chat:error")}</div>
			<p className="m-0 whitespace-pre-wrap break-words text-vscode-descriptionForeground">
				{data?.message || "The configured provider rejected this request."}
			</p>
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
