import React from "react"
import { Trans } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { DEEPTASK_GITHUB_URL } from "@/components/common/GitHubStarButton"

export const IssueFooter: React.FC = () => {
	return (
		<div className="text-xs text-vscode-descriptionForeground p-3">
			<Trans i18nKey="marketplace:footer.issueText">
				{/* kilocode_change start */}
				<VSCodeLink
					href={`${DEEPTASK_GITHUB_URL}/issues/new`}
					style={{ display: "inline", fontSize: "inherit" }}>
					Open a GitHub issue
				</VSCodeLink>
				{/* kilocode_change end */}
			</Trans>
		</div>
	)
}
