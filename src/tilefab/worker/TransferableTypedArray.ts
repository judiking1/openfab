export type TransferableTypedArray =
	| Int8Array
	| Uint8Array
	| Uint16Array
	| Int32Array
	| Uint32Array
	| Float64Array;

export interface TransferableTypedArrayConstructor<T extends TransferableTypedArray> {
	new (length: number): T;
	readonly name: string;
}

export function hasTransferableArrayBuffer(value: ArrayBufferView): boolean {
	return value.buffer instanceof ArrayBuffer;
}

/** Worker protocol columns must be exact typed arrays backed by non-shared ArrayBuffers. */
export function isTransferableTypedArray<T extends TransferableTypedArray>(
	value: unknown,
	expected: TransferableTypedArrayConstructor<T>,
): value is T {
	return value instanceof expected && hasTransferableArrayBuffer(value);
}

export function assertTransferableTypedArray<T extends TransferableTypedArray>(
	value: unknown,
	expected: TransferableTypedArrayConstructor<T>,
	label: string,
): asserts value is T {
	if (!isTransferableTypedArray(value, expected)) {
		throw new Error(`${label} must be a ${expected.name} backed by a transferable ArrayBuffer.`);
	}
}
