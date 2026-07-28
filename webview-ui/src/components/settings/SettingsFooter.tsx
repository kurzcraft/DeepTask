import { HTMLAttributes } from "react"

import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { DEEPTASK_GITHUB_URL } from "@/components/common/GitHubStarButton"

type SettingsFooterProps = HTMLAttributes<HTMLDivElement> & {
	version: string
}

export const SettingsFooter = ({ version, className, ...props }: SettingsFooterProps) => (
	<div className={cn("text-vscode-descriptionForeground p-5", className)} {...props}>
		{/* kilocode_change start */}
		<p className="m-0 p-0 break-words">
			For questions and bug reports, open an issue in the{" "}
			<VSCodeLink href={`${DEEPTASK_GITHUB_URL}/issues`} className="inline">
				Deeptask issue tracker
			</VSCodeLink>
			. For ideas and general feedback, use{" "}
			<VSCodeLink href={`${DEEPTASK_GITHUB_URL}/discussions`} className="inline">
				GitHub Discussions
			</VSCodeLink>
			.
		</p>
		<p className="italic">Deeptask v{version}</p>
		{/* kilocode_change end */}
		<div className="flex justify-between items-center gap-3">
			<p>Reset all global state and secret storage in the extension.</p>
			<VSCodeButton
				onClick={() => vscode.postMessage({ type: "resetState" })}
				appearance="secondary"
				className="shrink-0">
				<span className="codicon codicon-warning text-vscode-errorForeground mr-1" />
				Reset
			</VSCodeButton>
		</div>
	</div>
)
