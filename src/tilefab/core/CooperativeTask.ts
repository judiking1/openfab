/** Caller-owned scheduling for deterministic, platform-independent validation and construction. */
export interface CooperativeTask<T> {
	readonly done: boolean;
	step(operationBudget?: number): number;
	finish(): T;
}

export function createCooperativeTask<T>(steps: Generator<void, T>): CooperativeTask<T> {
	let complete = false;
	let result: T;
	let failed = false;
	let failure: unknown;
	return {
		get done() {
			return complete;
		},
		step(operationBudget = 128) {
			if (failed) throw failure;
			if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
				throw new Error("Cooperative operation budget must be a positive safe integer.");
			}
			let operations = 0;
			try {
				while (!complete && operations < operationBudget) {
					const next = steps.next();
					operations++;
					if (next.done) {
						result = next.value;
						complete = true;
					}
				}
			} catch (error) {
				failed = true;
				failure = error;
				throw error;
			}
			return operations;
		},
		finish() {
			if (failed) throw failure;
			if (!complete) throw new Error("Cooperative task is not complete.");
			return result;
		},
	};
}

export function completeCooperativeSteps<T>(steps: Generator<void, T>): T {
	let next = steps.next();
	while (!next.done) next = steps.next();
	return next.value;
}
