// kilocode_change - new file
import * as fs from "fs/promises"
import * as path from "path"
import * as lockfile from "proper-lockfile"

/**
 * Incremental JSON-array persistence for append-heavy transcripts.
 *
 * Host used to JSON.stringify the entire api_conversation_history on every
 * save (36MB+). That doubled peak RSS and tore the event loop. This writer:
 * - Reuses already-written prefix bytes from disk (1MB chunks, never a full
 *   in-memory copy of the prefix).
 * - JSON.stringify's only the dirty tail, one element at a time.
 * - Detects in-place mutations via a cheap fingerprint (length + edge stamps),
 *   so a historical `api_req_started` cost update is rewritten without
 *   reserializing the frozen prefix.
 * - Same-process saves prefer WeakRef identity, then fingerprint the tail.
 * - If WeakRefs die or the array is rebuilt (condense/rewind/slice),
 *   fingerprints still copy the on-disk prefix. Identity miss is not a
 *   full rewrite.
 * - Same-file writes are serialized. The sidecar is committed before the
 *   lock is released so an overlapping save cannot stringify 36MB or leave
 *   a stale `.inc-idx.json`.
 * - After resume/restart the in-memory WeakRefs are gone; a sidecar of
 *   fingerprints + byte offsets lets the next save still copy the prefix
 *   instead of stringifying 36MB of already-on-disk JSON.
 * - If the sidecar is missing (upgrade, persist failure), resume still
 *   seeds offsets by scanning the already-read file bytes. Never
 *   JSON.stringify the parsed prefix just to learn where it ended.
 *
 * Frozen prefix identity is held in WeakRef so an aborted task's history can
 * still be GC'd. Byte offsets and fingerprints are small and persisted.
 */

const PREFIX_COPY_CHUNK = 1024 * 1024

type FrozenSlot = WeakRef<object> | { primitive: unknown }

export interface ArrayWriteCache {
	frozen: FrozenSlot[]
	fingerprints: string[]
	endOffsets: number[]
	fileSize: number
}

const SIDECAR_VERSION = 1

function sidecarPath(filePath: string): string {
	return `${filePath}.inc-idx.json`
}

export interface IncrementalWriteStats {
	reusedCount: number
	stringifiedCount: number
	copiedBytes: number
	skipped: boolean
}

const caches = new Map<string, ArrayWriteCache>()
const writeChains = new Map<string, Promise<void>>()
let lastWriteStats: IncrementalWriteStats = {
	reusedCount: 0,
	stringifiedCount: 0,
	copiedBytes: 0,
	skipped: false,
}

export function clearIncrementalJsonArrayCache(filePath?: string): void {
	if (filePath) {
		caches.delete(path.resolve(filePath))
		return
	}
	caches.clear()
}

export function getLastIncrementalWriteStats(): IncrementalWriteStats {
	return { ...lastWriteStats }
}

export function peekIncrementalJsonArrayCache(filePath: string): ArrayWriteCache | undefined {
	return caches.get(path.resolve(filePath))
}

/**
 * Bind live object identity after the file is re-parsed (task resume).
 *
 * Prefer the sidecar (fingerprints + byte offsets). If it is missing or
 * stale, scan the already-read JSON bytes for element end offsets so the
 * first post-resume save can copy the prefix instead of stringifying it.
 */
export async function seedIncrementalJsonArrayCache(
	filePath: string,
	items: unknown[],
	rawText?: string,
): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)
	if (caches.has(absoluteFilePath)) {
		return
	}
	const sidecar = await loadSidecarCache(absoluteFilePath)
	if (sidecar && sidecarFingerprintsMatch(sidecar, items)) {
		sidecar.frozen = items.map(freezeSlot)
		caches.set(absoluteFilePath, sidecar)
		return
	}
	const seeded = await seedCacheFromFileBytes(absoluteFilePath, items, rawText)
	if (!seeded) {
		return
	}
	caches.set(absoluteFilePath, seeded)
	try {
		await persistSidecar(absoluteFilePath, seeded)
	} catch (error) {
		console.error(`Failed to persist JSON array sidecar after seeding ${absoluteFilePath}:`, error)
	}
}

function sidecarFingerprintsMatch(cache: ArrayWriteCache, items: unknown[]): boolean {
	if (cache.fingerprints.length !== items.length) {
		return false
	}
	for (let i = 0; i < items.length; i++) {
		if (cache.fingerprints[i] !== fingerprintJsonArrayItem(items[i])) {
			return false
		}
	}
	return true
}

function freezeSlot(item: unknown): FrozenSlot {
	if (typeof item === "object" && item !== null) {
		return new WeakRef(item)
	}
	return { primitive: item }
}

function slotMatches(slot: FrozenSlot | undefined, item: unknown): boolean {
	if (!slot) {
		return false
	}
	if (slot instanceof WeakRef) {
		return slot.deref() === item
	}
	return Object.is(slot.primitive, item)
}

interface SidecarPayload {
	version: number
	fileSize: number
	fingerprints: string[]
	endOffsets: number[]
}

function isSidecarPayload(value: unknown): value is SidecarPayload {
	if (!value || typeof value !== "object") {
		return false
	}
	const o = value as SidecarPayload
	return (
		o.version === SIDECAR_VERSION &&
		typeof o.fileSize === "number" &&
		Array.isArray(o.fingerprints) &&
		Array.isArray(o.endOffsets) &&
		o.fingerprints.length === o.endOffsets.length &&
		o.fingerprints.every((fp) => typeof fp === "string") &&
		o.endOffsets.every((off) => typeof off === "number")
	)
}

async function loadSidecarCache(filePath: string): Promise<ArrayWriteCache | undefined> {
	try {
		const raw = await fs.readFile(sidecarPath(filePath), "utf8")
		const parsed: unknown = JSON.parse(raw)
		if (!isSidecarPayload(parsed)) {
			return undefined
		}
		const size = await fileSizeOf(filePath)
		if (size !== parsed.fileSize) {
			return undefined
		}
		return {
			frozen: [],
			fingerprints: parsed.fingerprints,
			endOffsets: parsed.endOffsets,
			fileSize: parsed.fileSize,
		}
	} catch {
		return undefined
	}
}

async function persistSidecar(filePath: string, cache: ArrayWriteCache): Promise<void> {
	const payload: SidecarPayload = {
		version: SIDECAR_VERSION,
		fileSize: cache.fileSize,
		fingerprints: cache.fingerprints,
		endOffsets: cache.endOffsets,
	}
	await fs.writeFile(sidecarPath(filePath), JSON.stringify(payload), "utf8")
}

function isJsonWs(ch: string): boolean {
	return ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
}

function utf8BytesChar(text: string, i: number): { bytes: number; next: number } {
	const c = text.charCodeAt(i)
	if (c < 0x80) {
		return { bytes: 1, next: i + 1 }
	}
	if (c < 0x800) {
		return { bytes: 2, next: i + 1 }
	}
	if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
		const d = text.charCodeAt(i + 1)
		if (d >= 0xdc00 && d <= 0xdfff) {
			return { bytes: 4, next: i + 2 }
		}
	}
	return { bytes: 3, next: i + 1 }
}

/**
 * Byte offsets of each top-level JSON-array element, matching writeUtf8
 * (`Buffer.from(text, "utf8")`). Does not stringify parsed objects.
 */
function scanJsonArrayEndOffsets(text: string): number[] | undefined {
	let i = 0
	let bytes = 0

	const skipWs = (): void => {
		while (i < text.length && isJsonWs(text[i])) {
			bytes += 1
			i++
		}
	}

	const advanceAscii = (n: number): boolean => {
		for (let k = 0; k < n; k++) {
			if (i >= text.length) {
				return false
			}
			bytes += 1
			i++
		}
		return true
	}

	const advanceChar = (): boolean => {
		if (i >= text.length) {
			return false
		}
		const step = utf8BytesChar(text, i)
		bytes += step.bytes
		i = step.next
		return true
	}

	function advanceString(): boolean {
		if (text[i] !== '"') {
			return false
		}
		if (!advanceAscii(1)) {
			return false
		}
		while (i < text.length) {
			const ch = text[i]
			if (ch === "\\") {
				if (!advanceChar() || !advanceChar()) {
					return false
				}
				continue
			}
			if (ch === '"') {
				return advanceAscii(1)
			}
			if (!advanceChar()) {
				return false
			}
		}
		return false
	}

	function advanceNumber(): boolean {
		const start = i
		if (text[i] === "-") {
			i++
		}
		if (i < text.length && text[i] === "0") {
			i++
		} else {
			if (i >= text.length || text[i] < "1" || text[i] > "9") {
				return false
			}
			while (i < text.length && text[i] >= "0" && text[i] <= "9") {
				i++
			}
		}
		if (text[i] === ".") {
			i++
			if (i >= text.length || text[i] < "0" || text[i] > "9") {
				return false
			}
			while (i < text.length && text[i] >= "0" && text[i] <= "9") {
				i++
			}
		}
		if (text[i] === "e" || text[i] === "E") {
			i++
			if (text[i] === "+" || text[i] === "-") {
				i++
			}
			if (i >= text.length || text[i] < "0" || text[i] > "9") {
				return false
			}
			while (i < text.length && text[i] >= "0" && text[i] <= "9") {
				i++
			}
		}
		bytes += i - start
		return i > start
	}

	function advanceValue(): boolean {
		if (i >= text.length) {
			return false
		}
		const ch = text[i]
		if (ch === '"') {
			return advanceString()
		}
		if (ch === "{") {
			return advanceObject()
		}
		if (ch === "[") {
			return advanceArray()
		}
		if (ch === "t" && text.startsWith("true", i)) {
			return advanceAscii(4)
		}
		if (ch === "f" && text.startsWith("false", i)) {
			return advanceAscii(5)
		}
		if (ch === "n" && text.startsWith("null", i)) {
			return advanceAscii(4)
		}
		if (ch === "-" || (ch >= "0" && ch <= "9")) {
			return advanceNumber()
		}
		return false
	}

	function advanceObject(): boolean {
		if (!advanceAscii(1)) {
			return false
		}
		skipWs()
		if (text[i] === "}") {
			return advanceAscii(1)
		}
		while (i < text.length) {
			skipWs()
			if (!advanceString()) {
				return false
			}
			skipWs()
			if (text[i] !== ":") {
				return false
			}
			if (!advanceAscii(1)) {
				return false
			}
			skipWs()
			if (!advanceValue()) {
				return false
			}
			skipWs()
			if (text[i] === ",") {
				if (!advanceAscii(1)) {
					return false
				}
				continue
			}
			if (text[i] === "}") {
				return advanceAscii(1)
			}
			return false
		}
		return false
	}

	function advanceArray(): boolean {
		if (!advanceAscii(1)) {
			return false
		}
		skipWs()
		if (text[i] === "]") {
			return advanceAscii(1)
		}
		while (i < text.length) {
			skipWs()
			if (!advanceValue()) {
				return false
			}
			skipWs()
			if (text[i] === ",") {
				if (!advanceAscii(1)) {
					return false
				}
				continue
			}
			if (text[i] === "]") {
				return advanceAscii(1)
			}
			return false
		}
		return false
	}

	skipWs()
	if (text[i] !== "[") {
		return undefined
	}
	if (!advanceAscii(1)) {
		return undefined
	}
	const endOffsets: number[] = []
	skipWs()
	if (text[i] === "]") {
		return endOffsets
	}
	while (i < text.length) {
		skipWs()
		if (!advanceValue()) {
			return undefined
		}
		endOffsets.push(bytes)
		skipWs()
		if (text[i] === ",") {
			if (!advanceAscii(1)) {
				return undefined
			}
			continue
		}
		if (text[i] === "]") {
			return endOffsets
		}
		return undefined
	}
	return undefined
}

async function seedCacheFromFileBytes(
	filePath: string,
	items: unknown[],
	rawText?: string,
): Promise<ArrayWriteCache | undefined> {
	if (items.length === 0) {
		return undefined
	}
	let text = rawText
	if (text === undefined) {
		try {
			text = await fs.readFile(filePath, "utf8")
		} catch {
			return undefined
		}
	}
	const endOffsets = scanJsonArrayEndOffsets(text)
	if (!endOffsets || endOffsets.length !== items.length) {
		return undefined
	}
	const fileSize = Buffer.byteLength(text, "utf8")
	const sizeOnDisk = await fileSizeOf(filePath)
	if (sizeOnDisk !== fileSize) {
		return undefined
	}
	return {
		frozen: items.map(freezeSlot),
		fingerprints: items.map(fingerprintJsonArrayItem),
		endOffsets,
		fileSize,
	}
}

const FINGERPRINT_WINDOW = 64

function jsonMetricStamp(text: string): string {
	if (text.length < 2 || text.charCodeAt(0) !== 123) {
		return ""
	}
	// Metrics live at the end of api_req_started JSON. Never scan a multi-MB
	// `request` body — lastIndexOf on 36MB ran on every save of the tail window.
	const haystack = text.length > 1024 ? text.slice(-1024) : text
	const keys = ["tokensIn", "tokensOut", "cost", "cacheWrites", "cacheReads"]
	let out = ""
	for (const key of keys) {
		const needle = `"${key}":`
		const idx = haystack.lastIndexOf(needle)
		if (idx < 0) {
			continue
		}
		out += `${haystack.slice(idx, idx + needle.length + 20)};`
	}
	return out
}

function stamp(value: unknown): string {
	if (typeof value !== "string") {
		return typeof value
	}
	if (value.length <= 96) {
		return `${value.length}:${value}`
	}
	return `${value.length}:${value.slice(0, 24)}:${value.slice(-24)}:${jsonMetricStamp(value)}`
}

function contentStamp(content: unknown): string {
	if (typeof content === "string") {
		return `s${stamp(content)}`
	}
	if (!Array.isArray(content)) {
		return `t${typeof content}`
	}
	if (content.length === 0) {
		return "a0"
	}
	const first = content[0]
	const last = content[content.length - 1]
	const blockStamp = (block: unknown): string => {
		if (!block || typeof block !== "object") {
			return stamp(block)
		}
		const o = block as Record<string, unknown>
		return `${String(o.type ?? "")}:${stamp(o.text)}:${stamp(o.name)}`
	}
	return `a${content.length}:${blockStamp(first)}:${blockStamp(last)}`
}

export function fingerprintJsonArrayItem(item: unknown): string {
	if (item === null) {
		return "null"
	}
	if (item === undefined) {
		return "undefined"
	}
	const t = typeof item
	if (t !== "object") {
		return `${t}:${String(item)}`
	}
	const o = item as Record<string, unknown>
	const images = o.images
	let imageStamp = ""
	if (Array.isArray(images)) {
		imageStamp = images.map((img) => (typeof img === "string" ? img.length : 0)).join(",")
	}
	return [
		o.ts ?? "",
		o.role ?? "",
		o.type ?? "",
		o.say ?? "",
		o.ask ?? "",
		String(o.partial ?? ""),
		String(o.isAnswered ?? ""),
		String(o.isSummary ?? ""),
		o.condenseId ?? "",
		o.condenseParent ?? "",
		o.truncationId ?? "",
		o.truncationParent ?? "",
		stamp(o.text),
		stamp(o.reasoning),
		imageStamp,
		contentStamp(o.content),
	].join("|")
}

/**
 * Longest prefix that can be copied from disk. Identity plus fingerprint must
 * both match. A pure append reuses the entire previous file. An in-place
 * mutation (streaming tail or historical api_req_started) dirties from the
 * first mismatch. Truncation reuses the surviving prefix and rewrites `]`.
 */
function lastIndexWhere(
	items: unknown[],
	end: number,
	predicate: (item: Record<string, unknown>) => boolean,
): number {
	for (let i = end - 1; i >= 0; i--) {
		const item = items[i]
		if (item && typeof item === "object" && predicate(item as Record<string, unknown>)) {
			return i
		}
	}
	return -1
}

function fingerprintPrefixCount(cache: ArrayWriteCache, items: unknown[], start: number, end: number): number {
	const limit = Math.min(end, cache.fingerprints.length, items.length)
	for (let i = start; i < limit; i++) {
		if (cache.fingerprints[i] !== fingerprintJsonArrayItem(items[i])) {
			return i
		}
	}
	return limit
}

export function computeReusablePrefixCount(cache: ArrayWriteCache | undefined, items: unknown[]): number {
	if (!cache || (cache.frozen.length === 0 && cache.fingerprints.length === 0)) {
		return 0
	}
	const limit = Math.min(Math.max(cache.frozen.length, cache.fingerprints.length), items.length)
	let identity = 0
	while (identity < limit && slotMatches(cache.frozen[identity], items[identity])) {
		identity++
	}
	if (identity > 0) {
		const windowStart = Math.max(0, identity - FINGERPRINT_WINDOW)
		const extraIndexes = [
			lastIndexWhere(items, identity, (item) => item.say === "api_req_started"),
			lastIndexWhere(items, identity, (item) => item.type === "ask"),
		]
		for (const extra of extraIndexes) {
			if (extra >= 0 && extra < windowStart) {
				if (cache.fingerprints[extra] !== fingerprintJsonArrayItem(items[extra])) {
					return extra
				}
			}
		}
		for (let i = windowStart; i < identity; i++) {
			if (cache.fingerprints[i] !== fingerprintJsonArrayItem(items[i])) {
				return i
			}
		}
		return fingerprintPrefixCount(cache, items, identity, limit)
	}
	// WeakRefs died (GC) or the array was rebuilt (condense/rewind/resume).
	// Fingerprints still let us copy the on-disk prefix instead of
	// JSON.stringify'ing tens of megabytes that are already on disk.
	// Content that actually changed still dirties at the first mismatch.
	return fingerprintPrefixCount(cache, items, 0, limit)
}

async function fileSizeOf(filePath: string): Promise<number | undefined> {
	try {
		const stat = await fs.stat(filePath)
		return stat.size
	} catch (error: any) {
		if (error?.code === "ENOENT") {
			return undefined
		}
		throw error
	}
}

async function copyPrefixBytes(sourcePath: string, dest: fs.FileHandle, prefixBytes: number): Promise<void> {
	if (prefixBytes <= 0) {
		return
	}
	const src = await fs.open(sourcePath, "r")
	try {
		const buf = Buffer.alloc(Math.min(PREFIX_COPY_CHUNK, prefixBytes))
		let remaining = prefixBytes
		let position = 0
		while (remaining > 0) {
			const { bytesRead } = await src.read(buf, 0, Math.min(buf.length, remaining), position)
			if (bytesRead === 0) {
				throw new Error(
					`Unexpected EOF copying JSON array prefix from ${sourcePath} at ${position}/${prefixBytes}`,
				)
			}
			await dest.write(buf.subarray(0, bytesRead))
			position += bytesRead
			remaining -= bytesRead
		}
	} finally {
		await src.close()
	}
}

async function writeUtf8(dest: fs.FileHandle, text: string): Promise<number> {
	const buf = Buffer.from(text, "utf8")
	await dest.write(buf)
	return buf.length
}

interface DirtySnapshot {
	json: string[]
	fingerprints: string[]
	frozen: FrozenSlot[]
}

function snapshotDirty(items: unknown[], start: number, end: number = items.length): DirtySnapshot {
	const json: string[] = []
	const fingerprints: string[] = []
	const frozen: FrozenSlot[] = []
	for (let i = start; i < end; i++) {
		json.push(JSON.stringify(items[i]) ?? "null")
		fingerprints.push(fingerprintJsonArrayItem(items[i]))
		frozen.push(freezeSlot(items[i]))
	}
	return { json, fingerprints, frozen }
}

/**
 * Reuse a pre-lock dirty snapshot instead of JSON.stringify'ing the same
 * rows again. First writes and stale size checks used to snapshot the whole
 * array twice (lock-outside + lock-inside), doubling peak RSS.
 *
 * - same start: return the existing snapshot
 * - higher start: drop already-stringified prefix rows
 * - lower start: stringify only the newly dirty prefix, keep the frozen tail
 */
function reuseOrExtendDirty(
	items: unknown[],
	dirty: DirtySnapshot,
	previousStart: number,
	nextStart: number,
): DirtySnapshot {
	if (nextStart === previousStart) {
		return dirty
	}
	if (nextStart > previousStart) {
		const drop = nextStart - previousStart
		return {
			json: dirty.json.slice(drop),
			fingerprints: dirty.fingerprints.slice(drop),
			frozen: dirty.frozen.slice(drop),
		}
	}
	const extra = snapshotDirty(items, nextStart, previousStart)
	return {
		json: extra.json.concat(dirty.json),
		fingerprints: extra.fingerprints.concat(dirty.fingerprints),
		frozen: extra.frozen.concat(dirty.frozen),
	}
}

function buildCache(
	items: unknown[],
	endOffsets: number[],
	fileSize: number,
	previous: ArrayWriteCache | undefined,
	reusableCount: number,
	dirty: DirtySnapshot,
): ArrayWriteCache {
	const frozen: FrozenSlot[] = new Array(items.length)
	const fingerprints: string[] = new Array(items.length)
	for (let i = 0; i < items.length; i++) {
		if (previous && i < reusableCount) {
			fingerprints[i] = previous.fingerprints[i]
			// Sidecar-restored caches have offsets+fingerprints but no WeakRefs.
			// Bind the live object now so the next save can skip I/O by identity.
			frozen[i] = previous.frozen[i] ?? freezeSlot(items[i])
		} else {
			frozen[i] = dirty.frozen[i - reusableCount]
			fingerprints[i] = dirty.fingerprints[i - reusableCount]
		}
	}
	return { frozen, fingerprints, endOffsets, fileSize }
}

async function writeArrayFile(
	tempPath: string,
	sourcePath: string,
	items: unknown[],
	cache: ArrayWriteCache | undefined,
	reusableCount: number,
	dirty: DirtySnapshot,
): Promise<ArrayWriteCache> {
	const dest = await fs.open(tempPath, "w")
	try {
		let offset = 0
		const endOffsets: number[] = new Array(items.length)
		let stringifiedCount = 0
		let copiedBytes = 0

		const canCopyPrefix = Boolean(cache && reusableCount > 0)
		if (canCopyPrefix && cache) {
			const prefixBytes = cache.endOffsets[reusableCount - 1]
			await copyPrefixBytes(sourcePath, dest, prefixBytes)
			offset = prefixBytes
			copiedBytes = prefixBytes
			for (let i = 0; i < reusableCount; i++) {
				endOffsets[i] = cache.endOffsets[i]
			}
		} else {
			offset += await writeUtf8(dest, "[")
		}

		for (let i = reusableCount; i < items.length; i++) {
			if (i > 0) {
				offset += await writeUtf8(dest, ",")
			}
			offset += await writeUtf8(dest, dirty.json[i - reusableCount] ?? "null")
			endOffsets[i] = offset
			stringifiedCount++
		}

		offset += await writeUtf8(dest, "]")
		lastWriteStats = {
			reusedCount: reusableCount,
			stringifiedCount,
			copiedBytes,
			skipped: false,
		}
		return buildCache(items, endOffsets, offset, cache, reusableCount, dirty)
	} finally {
		await dest.close()
	}
}

async function atomicReplaceFile(
	filePath: string,
	produce: (tempPath: string) => Promise<void>,
	afterCommit?: () => Promise<void>,
): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)
	let releaseLock = async () => {}
	const dirPath = path.dirname(absoluteFilePath)

	try {
		await fs.mkdir(dirPath, { recursive: true })
		await fs.access(dirPath)
	} catch (dirError: any) {
		console.error(`Failed to create or access directory for ${absoluteFilePath}:`, dirError)
		throw dirError
	}

	try {
		releaseLock = await lockfile.lock(absoluteFilePath, {
			stale: 31000,
			update: 10000,
			realpath: false,
			retries: {
				retries: 5,
				factor: 2,
				minTimeout: 100,
				maxTimeout: 1000,
			},
			onCompromised: (err) => {
				console.error(`Lock at ${absoluteFilePath} was compromised:`, err)
				throw err
			},
		})
	} catch (lockError) {
		console.error(`Failed to acquire lock for ${absoluteFilePath}:`, lockError)
		throw lockError
	}

	let actualTempNewFilePath: string | null = null
	let actualTempBackupFilePath: string | null = null

	try {
		actualTempNewFilePath = path.join(
			path.dirname(absoluteFilePath),
			`.${path.basename(absoluteFilePath)}.new_${Date.now()}_${Math.random().toString(36).substring(2)}.tmp`,
		)

		await produce(actualTempNewFilePath)

		try {
			await fs.access(absoluteFilePath)
			actualTempBackupFilePath = path.join(
				path.dirname(absoluteFilePath),
				`.${path.basename(absoluteFilePath)}.bak_${Date.now()}_${Math.random().toString(36).substring(2)}.tmp`,
			)
			await fs.rename(absoluteFilePath, actualTempBackupFilePath)
		} catch (accessError: any) {
			if (accessError.code !== "ENOENT") {
				throw accessError
			}
		}

		await fs.rename(actualTempNewFilePath, absoluteFilePath)
		actualTempNewFilePath = null

		if (afterCommit) {
			await afterCommit()
		}

		if (actualTempBackupFilePath) {
			try {
				await fs.unlink(actualTempBackupFilePath)
				actualTempBackupFilePath = null
			} catch (unlinkBackupError) {
				console.error(
					`Successfully wrote ${absoluteFilePath}, but failed to clean up backup ${actualTempBackupFilePath}:`,
					unlinkBackupError,
				)
			}
		}
	} catch (originalError) {
		console.error(`Operation failed for ${absoluteFilePath}: [Original Error Caught]`, originalError)

		const newFileToCleanupWithinCatch = actualTempNewFilePath
		const backupFileToRollbackOrCleanupWithinCatch = actualTempBackupFilePath

		if (backupFileToRollbackOrCleanupWithinCatch) {
			try {
				await fs.rename(backupFileToRollbackOrCleanupWithinCatch, absoluteFilePath)
				actualTempBackupFilePath = null
			} catch (rollbackError) {
				console.error(
					`[Catch] Failed to restore backup ${backupFileToRollbackOrCleanupWithinCatch} to ${absoluteFilePath}:`,
					rollbackError,
				)
			}
		}

		if (newFileToCleanupWithinCatch) {
			try {
				await fs.unlink(newFileToCleanupWithinCatch)
			} catch (cleanupError) {
				console.error(
					`[Catch] Failed to clean up temporary new file ${newFileToCleanupWithinCatch}:`,
					cleanupError,
				)
			}
		}

		if (actualTempBackupFilePath) {
			try {
				await fs.unlink(actualTempBackupFilePath)
			} catch (cleanupError) {
				console.error(
					`[Catch] Failed to clean up temporary backup file ${actualTempBackupFilePath}:`,
					cleanupError,
				)
			}
		}
		throw originalError
	} finally {
		try {
			await releaseLock()
		} catch (unlockError) {
			console.error(`Failed to release lock for ${absoluteFilePath}:`, unlockError)
		}
	}
}

function enqueueJsonArrayWrite(filePath: string, work: () => Promise<void>): Promise<void> {
	const previous = writeChains.get(filePath) ?? Promise.resolve()
	const run = previous.then(work, work)
	const settled = run.then(
		() => undefined,
		() => undefined,
	)
	writeChains.set(filePath, settled)
	void settled.then(() => {
		if (writeChains.get(filePath) === settled) {
			writeChains.delete(filePath)
		}
	})
	return run
}

export async function writeJsonArrayIncremental(filePath: string, items: unknown[]): Promise<void> {
	const absoluteFilePath = path.resolve(filePath)
	// Serialize same-file saves before snapshotting. Overlapping callers used to
	// stringify the whole 36MB prefix when the in-lock size check saw a stale cache.
	return enqueueJsonArrayWrite(absoluteFilePath, () => writeJsonArrayIncrementalUnlocked(absoluteFilePath, items))
}

async function writeJsonArrayIncrementalUnlocked(absoluteFilePath: string, items: unknown[]): Promise<void> {
	let cache = caches.get(absoluteFilePath)
	if (!cache) {
		cache = await loadSidecarCache(absoluteFilePath)
		if (cache) {
			caches.set(absoluteFilePath, cache)
		}
	}
	const plannedReusable = computeReusablePrefixCount(cache, items)
	if (cache && plannedReusable === items.length && plannedReusable === cache.fingerprints.length) {
		try {
			const size = await fileSizeOf(absoluteFilePath)
			if (size === cache.fileSize) {
				if (cache.frozen.length !== items.length) {
					cache.frozen = items.map(freezeSlot)
				}
				lastWriteStats = {
					reusedCount: plannedReusable,
					stringifiedCount: 0,
					copiedBytes: 0,
					skipped: true,
				}
				try {
					await fs.access(sidecarPath(absoluteFilePath))
				} catch {
					try {
						await persistSidecar(absoluteFilePath, cache)
					} catch (error) {
						console.error(`Failed to persist JSON array sidecar for ${absoluteFilePath}:`, error)
					}
				}
				return
			}
		} catch {
			// Fall through to a real write if the size check fails.
		}
	}
	// Snapshot the dirty tail BEFORE any await so concurrent in-place mutation
	// (streaming last row / api_req_started cost) cannot tear JSON mid-write.
	// Same-file writers are already queued, so this is the only stringify of
	// those rows. The in-lock path must reuse this snapshot; a second
	// snapshotDirty(items, 0) on first write / stale size used to double RSS.
	const dirty = snapshotDirty(items, plannedReusable)
	let nextCache: ArrayWriteCache | undefined

	await atomicReplaceFile(
		absoluteFilePath,
		async (tempPath) => {
			const latest = caches.get(absoluteFilePath) ?? cache
			const size = await fileSizeOf(absoluteFilePath)
			const cacheValid = Boolean(latest && size === latest.fileSize)
			const reusableCount = cacheValid ? computeReusablePrefixCount(latest, items) : 0
			const dirtyForWrite = reuseOrExtendDirty(items, dirty, plannedReusable, reusableCount)
			nextCache = await writeArrayFile(
				tempPath,
				absoluteFilePath,
				items,
				cacheValid ? latest : undefined,
				reusableCount,
				dirtyForWrite,
			)
		},
		async () => {
			if (!nextCache) {
				return
			}
			caches.set(absoluteFilePath, nextCache)
			try {
				await persistSidecar(absoluteFilePath, nextCache)
			} catch (error) {
				console.error(`Failed to persist JSON array sidecar for ${absoluteFilePath}:`, error)
			}
		},
	)

	if (!nextCache) {
		caches.delete(absoluteFilePath)
	}
}
