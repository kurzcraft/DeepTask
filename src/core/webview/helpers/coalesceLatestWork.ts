// kilocode_change - new file
export type CoalesceLatestWorkOptions = {
	/** Sticky across coalesced callers: a force request cannot be dropped by a later non-force request. */
	force?: boolean
}

interface Batch {
	promise: Promise<void>
	resolve: () => void
	reject: (error: unknown) => void
	force: boolean
}

function createBatch(): Batch {
	let resolve!: () => void
	let reject!: (error: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject, force: false }
}

/**
 * Coalesce replaceable snapshot work, not events or deltas.
 * All queued callers share one trailing batch; no snapshots or waiter arrays
 * are retained. A request awaits a run which starts after that request.
 * execute must never await request() on this same instance (self-deadlock).
 * `force` ORs onto the shared trailing batch so webviewDidLaunch / overwrite
 * still send a full transcript after concurrent settings posts.
 */
export class CoalesceLatestWork {
	private pending?: Batch
	private pumping = false
	private scheduled = false
	private disposed = false

	constructor(private readonly execute: (force: boolean) => Promise<void>) {}

	request(options?: CoalesceLatestWorkOptions): Promise<void> {
		if (this.disposed) return Promise.resolve()
		this.pending ??= createBatch()
		if (options?.force) {
			this.pending.force = true
		}
		const promise = this.pending.promise
		if (!this.pumping && !this.scheduled) {
			this.scheduled = true
			queueMicrotask(() => {
				this.scheduled = false
				void this.pump()
			})
		}
		return promise
	}

	dispose(): void {
		this.disposed = true
		this.pending?.resolve()
		this.pending = undefined
	}

	private async pump(): Promise<void> {
		if (this.pumping || this.disposed) return
		this.pumping = true
		try {
			while (this.pending && !this.disposed) {
				const batch = this.pending
				this.pending = undefined
				try {
					await this.execute(batch.force)
					batch.resolve()
				} catch (error) {
					batch.reject(error)
				}
			}
		} finally {
			this.pumping = false
		}
	}
}
