import { completeCooperativeSteps, createCooperativeTask } from "../core/CooperativeTask";
import { freezeTransferDataContainersSteps } from "../core/ImmutableDataContainers";

/**
 * Restore immutable ordinary data containers after a Worker structured clone.
 * Typed-array bytes remain mutable and still require independent checksum checks.
 */
export function freezeSyntheticFabStarterContainers(value: unknown): void {
	completeCooperativeSteps(freezeTransferDataContainersSteps(value));
}

export async function freezeSyntheticFabStarterContainersCooperatively(
	value: unknown,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<void> {
	const task = createCooperativeTask(freezeTransferDataContainersSteps(value));
	while (!task.done) {
		task.step(operationBudget);
		await checkpoint();
	}
	task.finish();
}
