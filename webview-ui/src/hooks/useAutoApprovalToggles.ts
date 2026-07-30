import { useMemo } from "react"
import { useExtensionState } from "@src/context/ExtensionStateContext"

/**
 * Custom hook that creates and returns the auto-approval toggles object
 * This encapsulates the logic for creating the toggles object from extension state
 */
export function useAutoApprovalToggles() {
	const {
		alwaysAllowReadOnly,
		alwaysAllowWrite,
		alwaysAllowDelete, // kilocode_change
		alwaysAllowExecute,
		alwaysAllowBrowser,
		alwaysAllowMcp,
		alwaysAllowModeSwitch,
		alwaysAllowProviderProfileSwitch, // kilocode_change
		alwaysAllowSubtasks,
		alwaysAllowFollowupQuestions,
	} = useExtensionState()

	const toggles = useMemo(
		() => ({
			alwaysAllowReadOnly,
			alwaysAllowWrite,
			alwaysAllowDelete, // kilocode_change
			alwaysAllowExecute,
			alwaysAllowBrowser,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowProviderProfileSwitch, // kilocode_change
			alwaysAllowSubtasks,
			alwaysAllowFollowupQuestions,
		}),
		[
			alwaysAllowReadOnly,
			alwaysAllowWrite,
			alwaysAllowDelete, // kilocode_change
			alwaysAllowExecute,
			alwaysAllowBrowser,
			alwaysAllowMcp,
			alwaysAllowModeSwitch,
			alwaysAllowProviderProfileSwitch, // kilocode_change
			alwaysAllowSubtasks,
			alwaysAllowFollowupQuestions,
		],
	)

	return toggles
}
