import { type CooperativeTask, createCooperativeTask } from "./CooperativeTask";

export const SOURCE_BOUND_COOPERATIVE_TASK_STEP_LIMIT = 128;

export interface SourceBoundCooperativeTask<T> extends CooperativeTask<T> {
	cancel(): void;
}

export type SourceBoundCooperativeTaskErrorCode =
	| "CANCELLED"
	| "INVALID_OPERATION_BUDGET"
	| "REENTRANT_TASK"
	| "NOT_COMPLETE";

export class SourceBoundCooperativeTaskError extends Error {
	readonly code: SourceBoundCooperativeTaskErrorCode;

	constructor(code: SourceBoundCooperativeTaskErrorCode) {
		super(`Source-bound cooperative task: ${code}`);
		this.name = "SourceBoundCooperativeTaskError";
		this.code = code;
	}
}

/** Scheduling/cancellation only. This generic wrapper issues no domain or authoring authority. */
export function createSourceBoundCooperativeTask<T>(
	steps: Generator<void, T>,
	assertCurrent: () => void,
	onFailure?: (error: unknown) => void,
): SourceBoundCooperativeTask<T> {
	let task: CooperativeTask<T> | null = createCooperativeTask(steps);
	let failure: unknown;
	let failed = false;
	let executing = false;
	let advancing = false;
	let closed = false;
	const closeSteps = (): void => {
		if (closed || advancing) return;
		closed = true;
		try {
			steps.return(undefined as never);
		} catch {
			// A cleanup error must not replace the first cancellation/source failure.
		}
	};
	const discard = (error: unknown): void => {
		if (!failed) {
			failure = error;
			failed = true;
			task = null;
			try {
				onFailure?.(error);
			} catch {
				// Cleanup must not replace the original terminal failure.
			} finally {
				closeSteps();
			}
		}
	};
	const check = (): void => {
		if (failed) throw failure;
		assertCurrent();
		// A source check can synchronously cancel this task and still return normally.
		if (failed) throw failure;
	};
	const enter = (): void => {
		if (executing) throw new SourceBoundCooperativeTaskError("REENTRANT_TASK");
		executing = true;
	};
	return Object.freeze({
		get done() {
			return failed || task === null || task.done;
		},
		step(operationBudget = SOURCE_BOUND_COOPERATIVE_TASK_STEP_LIMIT) {
			if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
				throw new SourceBoundCooperativeTaskError("INVALID_OPERATION_BUDGET");
			}
			enter();
			try {
				check();
				const active = task;
				if (active === null) throw failure;
				let operations = 0;
				const limit = Math.min(operationBudget, SOURCE_BOUND_COOPERATIVE_TASK_STEP_LIMIT);
				while (!active.done && operations < limit) {
					advancing = true;
					try {
						operations += active.step(1);
					} finally {
						advancing = false;
						if (failed) closeSteps();
					}
					// Lookup reads may invoke cancellation inside generator.next(). Never reenter
					// generator.return(), or keep advancing the remaining budget, in that case.
					if (failed) throw failure;
				}
				check();
				return operations;
			} catch (error) {
				discard(error);
				throw failure;
			} finally {
				executing = false;
			}
		},
		finish() {
			enter();
			let premature = false;
			try {
				check();
				if (task === null) throw failure;
				if (!task.done) {
					premature = true;
					throw new SourceBoundCooperativeTaskError("NOT_COMPLETE");
				}
				const result = task.finish();
				check();
				return result;
			} catch (error) {
				if (premature) throw error;
				discard(error);
				throw failure;
			} finally {
				executing = false;
			}
		},
		cancel() {
			discard(new SourceBoundCooperativeTaskError("CANCELLED"));
		},
	});
}
