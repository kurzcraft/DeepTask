import { Fzf } from "fzf"
import { HistoryItem, TaskHistoryRequestPayload, TaskHistoryResponsePayload } from "@roo-code/types"
import { highlightFzfMatch } from "../../../webview-ui/src/utils/highlight" // weird hack, but apparently it works

const PAGE_SIZE = 10

// kilocode_change start: DEFECT W — family grouping for hierarchical history.
// Subagent conversations (parentTaskId set) used to vanish from the History
// view once their isolated worktree workspace was cleaned up, because the
// workspace filter matched neither their (deleted) workspace path nor any
// conversation session. Family adoption keeps them visible: a child passes a
// filter when its parent does. Family pagination keeps children on the same
// page as their parent so the tree renders intact.
type FamilySortKey = (item: HistoryItem) => number

function familySortKeyExtractor(sort: TaskHistoryRequestPayload["sort"]): FamilySortKey {
	switch (sort) {
		case "oldest":
			return (i) => i.ts || 0
		case "mostExpensive":
			return (i) => i.totalCost || 0
		case "mostTokens":
			return (i) => (i.tokensIn || 0) + (i.tokensOut || 0) + (i.cacheWrites || 0) + (i.cacheReads || 0)
		case "mostRelevant":
		case "newest":
		default:
			return (i) => i.ts || 0
	}
}

function groupIntoFamilies(tasks: HistoryItem[], sort: TaskHistoryRequestPayload["sort"]): HistoryItem[][] {
	const byId = new Map(tasks.map((i) => [i.id, i]))
	const familyRootId = (item: HistoryItem): string => {
		let cur = item
		for (let depth = 0; depth < 8; depth++) {
			const parent = cur.parentTaskId ? byId.get(cur.parentTaskId) : undefined
			if (!parent || parent === cur) {
				if (!cur.parentTaskId && cur.rootTaskId && cur.rootTaskId !== cur.id && byId.has(cur.rootTaskId)) {
					return cur.rootTaskId
				}
				return cur.id
			}
			cur = parent
		}
		return cur.id
	}

	const groups = new Map<string, HistoryItem[]>()
	for (const task of tasks) {
		const fam = familyRootId(task)
		const bucket = groups.get(fam)
		if (bucket) bucket.push(task)
		else groups.set(fam, [task])
	}

	const keyOf = familySortKeyExtractor(sort)
	const ascending = sort === "oldest"
	const families = [...groups.values()].map((members) => {
		// Family head first (the root item when present), remaining by ts asc.
		const headId = familyRootId(members[0])
		const head = members.find((m) => m.id === headId)
		const rest = members.filter((m) => m !== head).sort((a, b) => (a.ts || 0) - (b.ts || 0))
		const ordered = head ? [head, ...rest] : rest
		const familyKey = ascending
			? Math.min(...ordered.map(keyOf))
			: Math.max(...ordered.map(keyOf))
		return { ordered, familyKey }
	})

	families.sort((a, b) => (ascending ? a.familyKey - b.familyKey : b.familyKey - a.familyKey))
	return families.map((f) => f.ordered)
}
// kilocode_change end

export function getTaskHistory(
	taskHistory: HistoryItem[],
	cwd: string,
	request: TaskHistoryRequestPayload,
): TaskHistoryResponsePayload {
	let tasks = taskHistory.filter((item) => item.ts && item.task)

	if (request.sessionIds?.length || request.workspacePaths?.length) {
		const sessionIds = new Set(request.sessionIds ?? [])
		const workspacePaths = new Set(request.workspacePaths ?? [])
		// kilocode_change start: DEFECT W family adoption — a subagent passes the
		// workspace/session filter when its parent task does, so cleaned-up
		// worktree subagents stay visible under their parent in History.
		const byId = new Map(taskHistory.map((item) => [item.id, item]))
		const directMatch = (item: HistoryItem) =>
			sessionIds.has(item.id) || Boolean(item.workspace && workspacePaths.has(item.workspace))
		tasks = tasks.filter((item) => {
			if (directMatch(item)) return true
			const parent = item.parentTaskId ? byId.get(item.parentTaskId) : undefined
			if (parent && directMatch(parent)) return true
			const root = !parent && item.rootTaskId ? byId.get(item.rootTaskId) : undefined
			return root ? directMatch(root) : false
		})
		// kilocode_change end
	}

	if (request.workspace === "current") {
		// kilocode_change start: DEFECT W family adoption for the plain cwd filter
		const byId = new Map(taskHistory.map((item) => [item.id, item]))
		tasks = tasks.filter((item) => {
			if (item.workspace === cwd) return true
			const parent = item.parentTaskId ? byId.get(item.parentTaskId) : undefined
			if (parent && parent.workspace === cwd) return true
			const root = !parent && item.rootTaskId ? byId.get(item.rootTaskId) : undefined
			return root ? root.workspace === cwd : false
		})
		// kilocode_change end
	}

	if (request.favoritesOnly) {
		tasks = tasks.filter((item) => item.isFavorited)
	}

	if (request.search) {
		const searchResults = new Fzf(tasks, {
			selector: (item) => item.task,
		}).find(request.search)
		tasks = searchResults.map((result) => {
			const positions = Array.from(result.positions)
			const taskEndIndex = result.item.task.length

			return {
				...result.item,
				highlight: highlightFzfMatch(
					result.item.task,
					positions.filter((p) => p < taskEndIndex),
				),
				workspace: result.item.workspace,
			}
		})
	}

	tasks.sort((a, b) => {
		switch (request.sort) {
			case "oldest":
				return (a.ts || 0) - (b.ts || 0)
			case "mostExpensive":
				return (b.totalCost || 0) - (a.totalCost || 0)
			case "mostTokens": {
				const aTokens = (a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0)
				const bTokens = (b.tokensIn || 0) + (b.tokensOut || 0) + (b.cacheWrites || 0) + (b.cacheReads || 0)
				return bTokens - aTokens
			}
			case "mostRelevant":
				// Keep fuse order if searching, otherwise sort by newest
				return request.search ? 0 : (b.ts || 0) - (a.ts || 0)
			case "newest":
			default:
				return (b.ts || 0) - (a.ts || 0)
		}
	})

	// kilocode_change start: DEFECT W — paginate by family so a parent and its
	// subagents always land on the same page (tree renders intact).
	const totalItems = tasks.length
	const families = groupIntoFamilies(tasks, request.sort)
	const pages: HistoryItem[][] = []
	let current: HistoryItem[] = []
	for (const family of families) {
		if (current.length > 0 && current.length + family.length > PAGE_SIZE) {
			pages.push(current)
			current = []
		}
		current.push(...family)
	}
	if (current.length > 0) pages.push(current)
	const pageCount = Math.max(1, pages.length)
	const pageIndex = Math.max(0, Math.min(request.pageIndex, pageCount - 1))
	const historyItems = pages[pageIndex] ?? []
	// kilocode_change end

	return { requestId: request.requestId, historyItems, pageIndex, pageCount, totalItems }
}
