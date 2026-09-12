/** Finite owned copies for static-FAB Worker results; this grants no record or command authority. */
type NumericColumn = Int8Array | Uint8Array | Uint16Array | Int32Array | Uint32Array;
type ColumnConstructor =
	| Int8ArrayConstructor
	| Uint8ArrayConstructor
	| Uint16ArrayConstructor
	| Int32ArrayConstructor
	| Uint32ArrayConstructor;
type ColumnRule =
	| { readonly type: ColumnConstructor; readonly maximum: number; readonly exact?: number }
	| {
			readonly type: "text";
			readonly count: number;
			readonly length: number;
			readonly nullable?: boolean;
	  };

export class TransferColumnCapture {
	private readonly buffers = new Set<ArrayBuffer>();
	private readonly copies: Generator<void, void>[] = [];

	numeric<T extends NumericColumn>(
		source: unknown,
		type: { new (length: number): T },
		maximum: number,
		label: string,
		exact?: number,
	): { readonly length: number; readonly read: () => T } {
		if (
			!(source instanceof type) ||
			!(source.buffer instanceof ArrayBuffer) ||
			source.byteOffset !== 0 ||
			source.byteLength !== source.buffer.byteLength ||
			source.length > maximum ||
			(exact !== undefined && source.length !== exact)
		) {
			throw new Error(`${label} exceeds its transferable column type or length bounds.`);
		}
		if (this.buffers.has(source.buffer)) throw new Error(`${label} aliases a transferable buffer.`);
		this.buffers.add(source.buffer);
		const length = source.length;
		const byteLength = source.buffer.byteLength;
		let owned: T | undefined;
		this.copies.push(
			(function* () {
				yield;
				owned = new type(length);
				for (let offset = 0; offset < length; offset += 1024) {
					yield;
					if (source.length !== length || source.buffer.byteLength !== byteLength) {
						throw new Error(`${label} buffer changed during capture.`);
					}
					owned.set(source.subarray(offset, Math.min(offset + 1024, length)), offset);
				}
			})(),
		);
		return {
			length,
			read: () => {
				if (!owned) throw new Error(`${label} capture is incomplete.`);
				return owned;
			},
		};
	}

	fields<T extends object>(
		input: unknown,
		rules: { readonly [K in keyof T]: ColumnRule },
		label: string,
	): () => T {
		const fields = transferDataObject(input, label, Object.keys(rules));
		const readers: [string, () => unknown][] = [];
		// Iterate the finite schema, never keys supplied by a response.
		for (const key of Object.keys(rules) as (keyof T & string)[]) {
			const rule = rules[key];
			readers.push([
				key,
				rule.type === "text"
					? this.text(fields[key], rule, `${label}.${key}`)
					: this.numeric<NumericColumn>(
							fields[key],
							rule.type,
							rule.maximum,
							`${label}.${key}`,
							rule.exact,
						).read,
			]);
		}
		return () =>
			Object.freeze(Object.fromEntries(readers.map(([key, read]) => [key, read()]))) as T;
	}

	private text(
		source: unknown,
		rule: Extract<ColumnRule, { type: "text" }>,
		label: string,
	): () => readonly (string | null)[] {
		if (!Array.isArray(source) || source.length !== rule.count)
			throw new Error(`${label} has invalid text row count.`);
		let owned: readonly (string | null)[] | undefined;
		this.copies.push(
			(function* () {
				const result: (string | null)[] = [];
				for (let index = 0; index < rule.count; index++) {
					yield;
					const entry = Object.getOwnPropertyDescriptor(source, String(index));
					if (!entry || !Object.hasOwn(entry, "value"))
						throw new Error(`${label} text rows must be dense data properties.`);
					const value: unknown = entry.value;
					if (
						(value !== null || !rule.nullable) &&
						(typeof value !== "string" || value.length > rule.length)
					) {
						throw new Error(`${label} exceeds its text bounds.`);
					}
					result.push(value as string | null);
				}
				owned = Object.freeze(result);
			})(),
		);
		return () => {
			if (!owned) throw new Error(`${label} capture is incomplete.`);
			return owned;
		};
	}

	*steps(): Generator<void, void> {
		for (const copy of this.copies) yield* copy;
	}
}

export function transferColumnRow(type: ColumnConstructor, count: number): ColumnRule {
	return { type, maximum: count, exact: count };
}

export function transferDataObject(
	value: unknown,
	label: string,
	keys: readonly string[],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error(`${label} must be an object.`);
	const prototype = Object.getPrototypeOf(value);
	if (
		(prototype !== Object.prototype && prototype !== null) ||
		keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"))
	) {
		throw new Error(`${label} must contain plain data fields.`);
	}
	return value as Record<string, unknown>;
}
