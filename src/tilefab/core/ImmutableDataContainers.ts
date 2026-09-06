type Frame =
	| { readonly kind: "value"; readonly value: unknown }
	| { readonly kind: "array"; readonly value: unknown[]; readonly length: number; index: number }
	| {
			readonly kind: "record";
			readonly value: object;
			readonly keys: readonly PropertyKey[];
			index: number;
	  };

/** Restore ordinary transfer containers; typed-array bytes require their own validation. */
export function freezeTransferDataContainersSteps(value: unknown): Generator<void> {
	return immutableDataContainerSteps(value, true);
}

/** Prove an ordinary immutable data graph without invoking accessors or accepting typed views. */
export function assertFrozenDataContainersSteps(value: unknown): Generator<void> {
	return immutableDataContainerSteps(value, false);
}

function* immutableDataContainerSteps(root: unknown, freeze: boolean): Generator<void> {
	const visited = new WeakSet<object>();
	const pending: Frame[] = [{ kind: "value", value: root }];
	while (pending.length > 0) {
		const frame = pending.pop() as Frame;
		if (frame.kind !== "value") {
			const length = frame.kind === "array" ? frame.length : frame.keys.length;
			if (frame.index >= length) continue;
			const key = frame.kind === "array" ? String(frame.index) : frame.keys[frame.index];
			frame.index++;
			const descriptor = Object.getOwnPropertyDescriptor(frame.value, key as PropertyKey);
			if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
				throw new Error("Immutable containers require enumerable data properties.");
			}
			pending.push(frame, { kind: "value", value: descriptor.value });
			yield;
			continue;
		}
		const { value } = frame;
		if (typeof value !== "object" || value === null) {
			if (
				!freeze &&
				(typeof value === "function" || typeof value === "symbol" || typeof value === "bigint")
			) {
				throw new Error("Immutable containers require ordinary portable data.");
			}
			yield;
			continue;
		}
		if (visited.has(value) || (freeze && ArrayBuffer.isView(value))) {
			yield;
			continue;
		}
		if (!freeze && (!Object.isFrozen(value) || ArrayBuffer.isView(value))) {
			throw new Error("Data containers must be fully frozen before validation.");
		}
		const prototype = Object.getPrototypeOf(value);
		if (Array.isArray(value)) {
			if (prototype !== Array.prototype) {
				throw new Error("Immutable arrays require the ordinary array prototype.");
			}
			// Secure parent references before any suspension or descendant traversal.
			if (freeze) Object.freeze(value);
			if (Reflect.ownKeys(value).length !== value.length + 1) {
				throw new Error("Immutable arrays require dense data without custom fields.");
			}
			pending.push({ kind: "array", value, length: value.length, index: 0 });
		} else {
			if (prototype !== Object.prototype && prototype !== null) {
				throw new Error("Immutable containers require plain data records.");
			}
			if (freeze) Object.freeze(value);
			const keys = Reflect.ownKeys(value);
			if (keys.some((key) => typeof key !== "string")) {
				throw new Error("Immutable data records cannot contain symbol fields.");
			}
			pending.push({ kind: "record", value, keys, index: 0 });
		}
		visited.add(value);
		yield;
	}
}
