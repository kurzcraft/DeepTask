import os from "os"
import osName from "os-name"

import { getShell } from "../../../utils/shell"

export function getSystemInfoSection(cwd: string): string {
	// Try to get detailed OS name, fall back to basic info if it fails
	let osInfo: string
	try {
		osInfo = osName()
	} catch (error) {
		// Fallback when os-name fails (e.g., PowerShell not available on Windows)
		const platform = os.platform()
		const release = os.release()
		osInfo = `${platform} ${release}`
	}

	let details = `====

SYSTEM INFORMATION

Operating System: ${osInfo}
Default Shell: ${getShell()}
Home Directory: ${os.homedir().toPosix()}
Current Workspace Directory: ${cwd.toPosix()}

Workspace directory is the default for all tool operations. A terminal cd changes only that terminal's cwd, not the workspace. Use execute_command cwd or cd inside an EXTRA/bash script when a command must run elsewhere.`

	return details
}
