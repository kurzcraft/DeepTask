import * as path from "path"
import * as os from "os"
import fs from "fs/promises"
import fsSync from "fs" // kilocode_change

/**
 * Gets the global .roo directory path based on the current platform
 *
 * @returns The absolute path to the global .roo directory
 *
 * @example Platform-specific paths:
 * ```
 * // macOS/Linux: ~/.roo/
 * // Example: /Users/john/.roo
 *
 * // Windows: %USERPROFILE%\.roo\
 * // Example: C:\Users\john\.roo
 * ```
 *
 * @example Usage:
 * ```typescript
 * const globalDir = getGlobalRooDirectory()
 * // Returns: "/Users/john/.roo" (on macOS/Linux)
 * // Returns: "C:\\Users\\john\\.roo" (on Windows)
 * ```
 */
// kilocode_change start
/**
 * Best-effort one-way copy of a legacy config directory into the unified
 * `.deeptask` directory. Never overwrites existing files (force: false), so
 * concurrent runs are safe. `excludeWorktrees` skips `worktrees/` subtrees,
 * which hold live git worktrees that must stay where git recorded them.
 *
 * @returns true when the copy succeeded (or partially succeeded), false on failure
 */
function migrateLegacyDirSync(source: string, target: string, excludeWorktrees = false): boolean {
	try {
		fsSync.cpSync(source, target, {
			recursive: true,
			force: false, // never overwrite files already present in the target
			errorOnExist: false,
			preserveTimestamps: true,
			...(excludeWorktrees
				? {
						filter: (src: string) => {
							const segments = src.split(/[\\/]/)
							return !segments.includes("worktrees")
						},
					}
				: {}),
		})
		return true
	} catch {
		// Migration is best-effort; a failure must never break path resolution.
		return false
	}
}
// kilocode_change end

export function getGlobalRooDirectory(): string {
	const homeDir = os.homedir()
	const deeptaskDir = path.join(homeDir, ".deeptask") // kilocode_change: unified deeptask config dir
	const kiloDir = path.join(homeDir, ".kilocode") // kilocode_change (legacy)
	const rooDir = path.join(homeDir, ".roo") // kilocode_change (legacy)

	// kilocode_change start: The unified `.deeptask` dir is the canonical write target.
	// On first use after upgrade, migrate legacy config (one-way copy, no overwrite)
	// so existing rules/skills/commands keep working under the new directory.
	if (fsSync.existsSync(deeptaskDir)) {
		return deeptaskDir
	}
	const legacyGlobal = fsSync.existsSync(kiloDir) ? kiloDir : fsSync.existsSync(rooDir) ? rooDir : null
	if (legacyGlobal) {
		migrateLegacyDirSync(legacyGlobal, deeptaskDir)
	}
	return deeptaskDir
	// kilocode_change end
}

/**
 * Gets the project-local .roo directory path for a given cwd
 *
 * @param cwd - Current working directory (project path)
 * @returns The absolute path to the project-local .roo directory
 *
 * @example
 * ```typescript
 * const projectDir = getProjectRooDirectoryForCwd('/Users/john/my-project')
 * // Returns: "/Users/john/my-project/.roo"
 *
 * const windowsProjectDir = getProjectRooDirectoryForCwd('C:\\Users\\john\\my-project')
 * // Returns: "C:\\Users\\john\\my-project\\.roo"
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/my-project/
 * ├── .roo/                    # Project-local configuration directory
 * │   ├── rules/
 * │   │   └── rules.md
 * │   ├── custom-instructions.md
 * │   └── config/
 * │       └── settings.json
 * ├── src/
 * │   └── index.ts
 * └── package.json
 * ```
 */
export function getProjectRooDirectoryForCwd(cwd: string): string {
	// kilocode_change start
	const deeptaskDir = path.join(cwd, ".deeptask")
	const kiloDir = path.join(cwd, ".kilocode")
	const rooDir = path.join(cwd, ".roo")
	// The unified `.deeptask` dir is the canonical write target. On first use,
	// migrate legacy project config (one-way copy, no overwrite, skip worktrees/).
	if (fsSync.existsSync(deeptaskDir)) {
		return deeptaskDir
	}
	const legacyProject = fsSync.existsSync(kiloDir) ? kiloDir : fsSync.existsSync(rooDir) ? rooDir : null
	if (legacyProject) {
		migrateLegacyDirSync(legacyProject, deeptaskDir, true)
	}
	return deeptaskDir
	// kilocode_change end
}

/**
 * Checks if a directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(dirPath)
		return stat.isDirectory()
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return false
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Checks if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
	try {
		const stat = await fs.stat(filePath)
		return stat.isFile()
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR") {
			return false
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Reads a file safely, returning null if it doesn't exist
 */
export async function readFileIfExists(filePath: string): Promise<string | null> {
	try {
		return await fs.readFile(filePath, "utf-8")
	} catch (error: any) {
		// Only catch expected "not found" errors
		if (error.code === "ENOENT" || error.code === "ENOTDIR" || error.code === "EISDIR") {
			return null
		}
		// Re-throw unexpected errors (permission, I/O, etc.)
		throw error
	}
}

/**
 * Discovers all .roo directories in subdirectories of the workspace
 *
 * @param cwd - Current working directory (workspace root)
 * @returns Array of absolute paths to .roo directories found in subdirectories,
 *          sorted alphabetically. Does not include the root .roo directory.
 *
 * @example
 * ```typescript
 * const subfolderRoos = await discoverSubfolderRooDirectories('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/monorepo/package-a/.roo',
 * //   '/Users/john/monorepo/package-b/.roo',
 * //   '/Users/john/monorepo/packages/shared/.roo'
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/monorepo/
 * ├── .roo/                    # Root .roo (NOT included - use getProjectRooDirectoryForCwd)
 * ├── package-a/
 * │   └── .roo/                # Included
 * │       └── rules/
 * ├── package-b/
 * │   └── .roo/                # Included
 * │       └── rules-code/
 * └── packages/
 *     └── shared/
 *         └── .roo/            # Included (nested)
 *             └── rules/
 * ```
 */
export async function discoverSubfolderRooDirectories(cwd: string): Promise<string[]> {
	try {
		// Dynamic import to avoid vscode dependency at module load time
		// This is necessary because file-search.ts imports vscode, which is not
		// available in the webview context
		const { executeRipgrep } = await import("../search/file-search")

		// Use ripgrep to find any file inside any .deeptask, .kilocode or legacy .roo directory.
		// This efficiently discovers all config folders regardless of their content.
		const args = [
			"--files",
			"--hidden",
			"--follow",
			"-g",
			"**/.deeptask/**", // kilocode_change: unified deeptask config dir
			"-g",
			"**/.kilocode/**", // kilocode_change (legacy)
			"-g",
			"**/.roo/**", // kilocode_change (legacy)
			"-g",
			"!node_modules/**",
			"-g",
			"!.git/**",
			cwd,
		]

		const results = await executeRipgrep({ args, workspacePath: cwd })

		// Extract unique config directory paths.
		// Prefer .deeptask > .kilocode > .roo when several exist for the same parent folder.
		const configDirsByParent = new Map<string, string>() // parentDir -> configDir
		const rootDeeptaskDir = path.join(cwd, ".deeptask") // kilocode_change
		const rootKiloDir = path.join(cwd, ".kilocode") // kilocode_change
		const rootRooDir = path.join(cwd, ".roo")

		// kilocode_change start: ranking for same-parent config dir preference
		const dirRank: Record<string, number> = { deeptask: 3, kilocode: 2, roo: 1 }
		for (const result of results) {
			// Match paths like:
			// - "subfolder/.deeptask/anything" (preferred)
			// - "subfolder/.kilocode/anything" (legacy)
			// - "subfolder/.roo/anything" (legacy)
			// Handle both forward slashes (Unix) and backslashes (Windows)
			const match = result.path.match(/^(.+?)[/\\]\.(deeptask|kilocode|roo)[/\\]/)
			if (!match?.[1] || !match?.[2]) continue

			const parentRel = match[1]
			const dirName = match[2] as "deeptask" | "kilocode" | "roo"
			const configDir = path.join(cwd, parentRel, `.${dirName}`)

			// Exclude the root config dirs (already handled by getProjectRooDirectoryForCwd)
			if (configDir === rootDeeptaskDir || configDir === rootKiloDir || configDir === rootRooDir) {
				continue
			}

			const existing = configDirsByParent.get(parentRel)
			if (!existing) {
				configDirsByParent.set(parentRel, configDir)
				continue
			}

			// Prefer higher-ranked config dir for the same parent folder
			const existingMatch = existing.match(/\.(deeptask|kilocode|roo)$/)
			const existingRank = existingMatch ? (dirRank[existingMatch[1]] ?? 0) : 0
			if ((dirRank[dirName] ?? 0) > existingRank) {
				configDirsByParent.set(parentRel, configDir)
			}
		}
		// kilocode_change end

		// Return sorted alphabetically
		return Array.from(configDirsByParent.values()).sort()
	} catch (error) {
		// If discovery fails (e.g., ripgrep not available), return empty array
		return []
	}
}

/**
 * Gets the ordered list of .roo directories to check (global first, then project-local)
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths to check in order [global, project-local]
 *
 * @example
 * ```typescript
 * // For a project at /Users/john/my-project
 * const directories = getRooDirectoriesForCwd('/Users/john/my-project')
 * // Returns:
 * // [
 * //   '/Users/john/.roo',           // Global directory
 * //   '/Users/john/my-project/.roo' // Project-local directory
 * // ]
 * ```
 *
 * @example Directory structure:
 * ```
 * /Users/john/
 * ├── .roo/                    # Global configuration
 * │   ├── rules/
 * │   │   └── rules.md
 * │   └── custom-instructions.md
 * └── my-project/
 *     ├── .roo/                # Project-specific configuration
 *     │   ├── rules/
 *     │   │   └── rules.md     # Overrides global rules
 *     │   └── project-notes.md
 *     └── src/
 *         └── index.ts
 * ```
 */
export function getRooDirectoriesForCwd(cwd: string): string[] {
	const directories: string[] = []

	// Add global directory first
	directories.push(getGlobalRooDirectory())

	// Add project-local directory second
	directories.push(getProjectRooDirectoryForCwd(cwd))

	return directories
}

/**
 * Gets the ordered list of all .roo directories including subdirectories
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of directory paths in order: [global, project-local, ...subfolders (alphabetically)]
 *
 * @example
 * ```typescript
 * // For a monorepo at /Users/john/monorepo with .roo in subfolders
 * const directories = await getAllRooDirectoriesForCwd('/Users/john/monorepo')
 * // Returns:
 * // [
 * //   '/Users/john/.roo',                    // Global directory
 * //   '/Users/john/monorepo/.roo',           // Project-local directory
 * //   '/Users/john/monorepo/package-a/.roo', // Subfolder (alphabetical)
 * //   '/Users/john/monorepo/package-b/.roo'  // Subfolder (alphabetical)
 * // ]
 * ```
 */
export async function getAllRooDirectoriesForCwd(cwd: string): Promise<string[]> {
	const directories: string[] = []

	// Add global directory first
	directories.push(getGlobalRooDirectory())

	// Add project-local directory second
	directories.push(getProjectRooDirectoryForCwd(cwd))

	// Discover and add subfolder .roo directories
	const subfolderDirs = await discoverSubfolderRooDirectories(cwd)
	directories.push(...subfolderDirs)

	return directories
}

/**
 * Gets parent directories containing .roo folders, in order from root to subfolders
 *
 * @param cwd - Current working directory (project path)
 * @returns Array of parent directory paths (not .roo paths) containing AGENTS.md or .roo
 *
 * @example
 * ```typescript
 * const dirs = await getAgentsDirectoriesForCwd('/Users/john/monorepo')
 * // Returns: ['/Users/john/monorepo', '/Users/john/monorepo/package-a', ...]
 * ```
 */
export async function getAgentsDirectoriesForCwd(cwd: string): Promise<string[]> {
	const directories: string[] = []

	// Always include the root directory
	directories.push(cwd)

	// Get all subfolder .roo directories
	const subfolderRooDirs = await discoverSubfolderRooDirectories(cwd)

	// Extract parent directories (remove .roo from path)
	for (const rooDir of subfolderRooDirs) {
		const parentDir = path.dirname(rooDir)
		directories.push(parentDir)
	}

	return directories
}

/**
 * Loads configuration from multiple .roo directories with project overriding global
 *
 * @param relativePath - The relative path within each .roo directory (e.g., 'rules/rules.md')
 * @param cwd - Current working directory (project path)
 * @returns Object with global and project content, plus merged content
 *
 * @example
 * ```typescript
 * // Load rules configuration for a project
 * const config = await loadConfiguration('rules/rules.md', '/Users/john/my-project')
 *
 * // Returns:
 * // {
 * //   global: "Global rules content...",     // From ~/.roo/rules/rules.md
 * //   project: "Project rules content...",   // From /Users/john/my-project/.roo/rules/rules.md
 * //   merged: "Global rules content...\n\n# Project-specific rules (override global):\n\nProject rules content..."
 * // }
 * ```
 *
 * @example File paths resolved:
 * ```
 * relativePath: 'rules/rules.md'
 * cwd: '/Users/john/my-project'
 *
 * Reads from:
 * - Global: /Users/john/.roo/rules/rules.md
 * - Project: /Users/john/my-project/.roo/rules/rules.md
 *
 * Other common relativePath examples:
 * - 'custom-instructions.md'
 * - 'config/settings.json'
 * - 'templates/component.tsx'
 * ```
 *
 * @example Merging behavior:
 * ```
 * // If only global exists:
 * { global: "content", project: null, merged: "content" }
 *
 * // If only project exists:
 * { global: null, project: "content", merged: "content" }
 *
 * // If both exist:
 * {
 *   global: "global content",
 *   project: "project content",
 *   merged: "global content\n\n# Project-specific rules (override global):\n\nproject content"
 * }
 * ```
 */
export async function loadConfiguration(
	relativePath: string,
	cwd: string,
): Promise<{
	global: string | null
	project: string | null
	merged: string
}> {
	const globalDir = getGlobalRooDirectory()
	const projectDir = getProjectRooDirectoryForCwd(cwd)

	const globalFilePath = path.join(globalDir, relativePath)
	const projectFilePath = path.join(projectDir, relativePath)

	// Read global configuration
	const globalContent = await readFileIfExists(globalFilePath)

	// Read project-local configuration
	const projectContent = await readFileIfExists(projectFilePath)

	// Merge configurations - project overrides global
	let merged = ""

	if (globalContent) {
		merged += globalContent
	}

	if (projectContent) {
		if (merged) {
			merged += "\n\n# Project-specific rules (override global):\n\n"
		}
		merged += projectContent
	}

	return {
		global: globalContent,
		project: projectContent,
		merged: merged || "",
	}
}

// Export with backward compatibility alias
export const loadRooConfiguration: typeof loadConfiguration = loadConfiguration
