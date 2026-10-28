// kilocode_change - new file
interface Batch {
	promise: Promise<void>
	resolve: () => void
	reject: (error: unknown) => void
}

function createBatch(): Batch {
	let resolve!: () => void
	let reject!: (error: unknown) => void
	const promise = new Promise<void>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/**
 * Coalesce replaceable snapshot work, not events or deltas.
 * All queued callers share one trailing batch; no snapshots or waiter arrays
 * are retained. A request awaits a run which starts after that request.
 * execute must never await request() on this same instance (self-deadlock).
 */
export class CoalesceLatestWork {
	private pending?: Batch
	private pumping = false
	private scheduled = false
	private disposed = false

	constructor(private readonly execute: () => Promise<void>) {}

	request(): Promise<void> {
		if (this.disposed) return Promise.resolve()
		this.pending ??= createBatch()
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
					await this.execute()
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
