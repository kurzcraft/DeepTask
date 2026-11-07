// kilocode_change - new file
/**
 * EXTRA/task Markdown hard limits: at most 30 physical lines and 4 nesting levels.
 *
 * This is a growth gate, not a freeze gate. An already-over-limit file may still
 * be rewritten when the write does not grow line count or nesting (status-only
 * updates and item-by-item shrinks). New files and any write that grows an
 * overflow must be rejected so the model splits into EXTRA/task/<title>/ first.
 */
import path from "path"

export const MAX_TASK_PROGRESS_PHYSICAL_LINES = 30
export const MAX_TASK_PROGRESS_NESTING_LEVELS = 4

const LINE_BREAK = /\r\n|\n|\r/
const CHECKLIST_ITEM = /^([ \t]*)- \[[ xX-]\]/

export function countPhysicalLines(content: string | undefined | null): number {
	if (content == null || content.length === 0) {
		return 0
	}

	const parts = content.split(LINE_BREAK)

	if (parts.length > 1 && parts[parts.length - 1] === "") {
		parts.pop()
	}

	return parts.length
}

export function countTaskProgressNestingLevels(content: string | undefined | null): number {
	if (content == null || content.length === 0) {
		return 0
	}

	let maxLevel = 0
	for (const line of content.split(LINE_BREAK)) {
		const match = CHECKLIST_ITEM.exec(line)
		if (!match) {
			continue
		}

		const indent = match[1].replace(/\t/g, "    ").length
		const level = Math.floor(indent / 4) + 1
		if (level > maxLevel) {
			maxLevel = level
		}
	}

	return maxLevel
}

export function isActiveTaskProgressMarkdownPath(cwd: string, relPath: string | undefined | null): boolean {
	if (!cwd || !relPath) {
		return false
	}

	const absolutePath = path.resolve(cwd, relPath)
	if (path.extname(absolutePath).toLowerCase() !== ".md") {
		return false
	}

	const taskDir = path.resolve(cwd, "EXTRA", "task")
	const relativeToTask = path.relative(taskDir, absolutePath)
	if (!relativeToTask || relativeToTask.startsWith("..") || path.isAbsolute(relativeToTask)) {
		return false
	}

	const posix = relativeToTask.split(path.sep).join("/")
	if (posix === "finished" || posix.startsWith("finished/")) {
		return false
	}

	return true
}

export function isTaskProgressWriteGrowingOverflow(args: {
	proposedContent: string
	existingContent: string | null
}): boolean {
	const proposedLines = countPhysicalLines(args.proposedContent)
	const proposedNesting = countTaskProgressNestingLevels(args.proposedContent)
	const overLines = proposedLines > MAX_TASK_PROGRESS_PHYSICAL_LINES
	const overNesting = proposedNesting > MAX_TASK_PROGRESS_NESTING_LEVELS

	if (!overLines && !overNesting) {
		return false
	}

	if (args.existingContent == null) {
		return true
	}

	const existingLines = countPhysicalLines(args.existingContent)
	const existingNesting = countTaskProgressNestingLevels(args.existingContent)
	return proposedLines > existingLines || proposedNesting > existingNesting
}

export function getTaskProgressWriteLimitError(args: {
	relPath: string
	proposedContent: string
	existingContent: string | null
}): string | undefined {
	if (!isTaskProgressWriteGrowingOverflow(args)) {
		return undefined
	}

	const proposedLines = countPhysicalLines(args.proposedContent)
	const proposedNesting = countTaskProgressNestingLevels(args.proposedContent)
	const existingLines = args.existingContent == null ? 0 : countPhysicalLines(args.existingContent)
	const existingNesting = args.existingContent == null ? 0 : countTaskProgressNestingLevels(args.existingContent)
	const isNew = args.existingContent == null

	return (
		`EXTRA/task write rejected: ${args.relPath} would ${isNew ? "create" : "grow"} ` +
		`${proposedLines} physical lines / ${proposedNesting} nesting levels ` +
		`(limit ${MAX_TASK_PROGRESS_PHYSICAL_LINES} lines / ${MAX_TASK_PROGRESS_NESTING_LEVELS} levels` +
		`${isNew ? "" : `; current ${existingLines} lines / ${existingNesting} levels`}). ` +
		`Do not keep appending to this file. Split into EXTRA/task/<short-title>/ light files first, ` +
		`keep the root pointer at current cell / falsification line / child paths, and continue work there. ` +
		`Shrinks and status-only updates on an already-over-limit file are allowed until it is under the cap.`
	)
}
