// kilocode_change - new file
import { Star } from "lucide-react"

import { Button } from "@/components/ui"
import { vscode } from "@/utils/vscode"

export const DEEPTASK_GITHUB_URL = "https://github.com/kurzcraft/DeepTask"

interface GitHubStarButtonProps {
	className?: string
	compact?: boolean
}

export const GitHubStarButton = ({ className, compact = false }: GitHubStarButtonProps) => {
	const openRepository = () => {
		vscode.postMessage({ type: "openExternal", url: DEEPTASK_GITHUB_URL })
	}

	return (
		<Button
			variant="primary"
			type="button"
			className={className}
			onClick={openRepository}
			aria-label="Star Deeptask on GitHub"
			title="Open Deeptask on GitHub and click Star"
			data-testid="github-star-button">
			<Star className="h-4 w-4 fill-current" aria-hidden="true" />
			<span>{compact ? "Star" : "Star Deeptask on GitHub"}</span>
		</Button>
	)
}
