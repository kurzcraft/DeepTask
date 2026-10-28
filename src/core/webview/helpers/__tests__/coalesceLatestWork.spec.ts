// kilocode_change - new file
import { CoalesceLatestWork } from "../coalesceLatestWork"

function gate() {
	let resolve!: () => void
	const promise = new Promise<void>((res) => {
		resolve = res
	})
	return { promise, resolve }
}

describe("bounded snapshot coalescer", () => {
	it("shares one promise for 10000 queued requests and builds only current state", async () => {
		const firstGate = gate()
		const started = gate()
		let value = 0
		const seen: number[] = []
		const work = new CoalesceLatestWork(async () => {
			seen.push(value)
			if (seen.length === 1) {
				started.resolve()
				await firstGate.promise
			}
		})
		const first = work.request()
		await started.promise
		const tail = work.request()
		for (let i = 0; i < 10000; i++) {
			value = i
			expect(work.request()).toBe(tail)
		}
		firstGate.resolve()
		await Promise.all([first, tail])
		expect(seen).toEqual([0, 9999])
	})
	it("awaits actual completion and captures a new tail during each run", async () => {
		const gates = [gate(), gate(), gate()]
		const starts = [gate(), gate(), gate()]
		let runs = 0
		const work = new CoalesceLatestWork(async () => {
			const n = runs++
			starts[n].resolve()
			await gates[n].promise
		})
		const first = work.request()
		await starts[0].promise
		const second = work.request()
		gates[0].resolve()
		await starts[1].promise
		const third = work.request()
		expect(third).not.toBe(second)
		gates[1].resolve()
		await starts[2].promise
		let settled = false
		void third.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)
		gates[2].resolve()
		await Promise.all([first, second, third])
		expect(runs).toBe(3)
	})
	it("does not poison trailing work after a failed batch", async () => {
		const block = gate()
		const started = gate()
		let calls = 0
		const work = new CoalesceLatestWork(async () => {
			if (++calls === 1) {
				started.resolve()
				await block.promise
				throw new Error("send failed")
			}
		})
		const first = work.request()
		const rejected = expect(first).rejects.toThrow("send failed")
		await started.promise
		const tail = work.request()
		block.resolve()
		await rejected
		await tail
		await work.request()
		expect(calls).toBe(3)
	})
	it("resolves pending callers on disposal but awaits in-flight completion", async () => {
		const block = gate()
		const started = gate()
		const execute = vi.fn(async () => {
			started.resolve()
			await block.promise
		})
		const work = new CoalesceLatestWork(execute)
		const first = work.request()
		await started.promise
		const tail = work.request()
		work.dispose()
		await tail
		await work.request()
		block.resolve()
		await first
		expect(execute).toHaveBeenCalledTimes(1)
	})
	it("cancels a scheduled batch before it executes", async () => {
		const execute = vi.fn()
		const work = new CoalesceLatestWork(execute)
		const pending = work.request()
		work.dispose()
		await pending
		expect(execute).not.toHaveBeenCalled()
	})
	it("allows non-awaited requests from inside the executor", async () => {
		let runs = 0
		let tail: Promise<void> | undefined
		const work = new CoalesceLatestWork(async () => {
			if (++runs === 1) tail = work.request()
		})
		await work.request()
		await tail
		expect(runs).toBe(2)
	})
})
