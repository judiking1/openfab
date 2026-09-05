/**
 * Stable in-place ordering for caller-owned arrays without a whole-input native sort/copy.
 * Each native run has at most 32 elements; all larger merges/copies advance one item per step.
 * Callers must keep their array private until this generator has completed.
 */
export function stableSortSteps<T>(
	values: T[],
	compare: (left: T, right: T) => number,
): Generator<void, void> {
	return sortSteps(values, compare, true);
}

/** Preserve native stable sorting for callers consuming the shared algorithm synchronously. */
export function synchronousSortSteps<T>(
	values: T[],
	compare: (left: T, right: T) => number,
): Generator<void, void> {
	return sortSteps(values, compare, false);
}

function* sortSteps<T>(
	values: T[],
	compare: (left: T, right: T) => number,
	cooperative: boolean,
): Generator<void, void> {
	if (!cooperative) {
		values.sort(compare);
		return;
	}
	const length = values.length;
	const runSize = 32;
	for (let start = 0; start < length; start += runSize) {
		const run = values.slice(start, Math.min(start + runSize, length));
		run.sort(compare);
		yield;
		for (let offset = 0; offset < run.length; offset++) {
			values[start + offset] = run[offset] as T;
			yield;
		}
	}
	if (length <= runSize) return;
	let source = values;
	let destination: T[] = [];
	for (let width = runSize; width < length; width *= 2) {
		for (let start = 0; start < length; start += width * 2) {
			const middle = Math.min(start + width, length);
			const end = Math.min(start + width * 2, length);
			let left = start;
			let right = middle;
			for (let target = start; target < end; target++) {
				// Native Array.sort treats NaN as equality; ties retain their original order.
				if (
					left < middle &&
					(right >= end || !(compare(source[left] as T, source[right] as T) > 0))
				) {
					destination[target] = source[left++] as T;
				} else destination[target] = source[right++] as T;
				yield;
			}
		}
		const previous = source;
		source = destination;
		destination = previous;
	}
	if (source !== values) {
		for (let index = 0; index < length; index++) {
			values[index] = source[index] as T;
			yield;
		}
	}
}
