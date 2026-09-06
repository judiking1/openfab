const DEFAULT_CHECKPOINT_BYTES = 64 * 1024;

/** Stable ordered fingerprint for scalar metadata and transferable typed buffers. */
export class OrderedTypedChecksum {
	private hashA = 0x811c9dc5;
	private hashB = 0x9e3779b9;
	private readonly scalarBuffer = new ArrayBuffer(8);
	private readonly scalarView = new DataView(this.scalarBuffer);
	private readonly scalarBytes = new Uint8Array(this.scalarBuffer);
	private readonly textEncoder = new TextEncoder();
	private readonly cachedStringBytes = new Map<string, Uint8Array>();

	addNumber(value: number): void {
		this.addLength(1);
		this.addNumberValue(value);
	}

	addNumbers(values: readonly number[]): void {
		this.addLength(values.length);
		for (const value of values) {
			this.addNumberValue(value);
		}
	}

	/** Preserve one sequence-length prefix while allowing a wide numeric field to yield. */
	*addNumbersSteps(values: readonly number[]): Generator<void> {
		this.addLength(values.length);
		for (const value of values) {
			this.addNumberValue(value);
			yield;
		}
	}

	addViews(views: readonly ArrayBufferView[]): void {
		this.addLength(views.length);
		for (const view of views) {
			this.addLength(view.byteLength);
			this.addBytes(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
		}
	}

	async addViewsCooperatively(
		views: readonly ArrayBufferView[],
		checkpoint: () => Promise<void>,
		checkpointBytes = DEFAULT_CHECKPOINT_BYTES,
	): Promise<void> {
		if (!Number.isSafeInteger(checkpointBytes) || checkpointBytes <= 0) {
			throw new Error("Typed checksum checkpoint size must be a positive safe integer.");
		}
		this.addLength(views.length);
		for (const view of views) {
			this.addLength(view.byteLength);
			const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
			for (let offset = 0; offset < bytes.length; offset += checkpointBytes) {
				this.addBytes(bytes.subarray(offset, Math.min(offset + checkpointBytes, bytes.length)));
				await checkpoint();
			}
		}
	}

	addStrings(values: readonly string[]): void {
		this.addLength(values.length);
		for (const value of values) {
			const bytes = this.textEncoder.encode(value);
			this.addLength(bytes.length);
			this.addBytes(bytes);
		}
	}

	/** Single-string form for hot fixed-schema loops that must not allocate wrapper arrays. */
	addString(value: string): void {
		this.addLength(1);
		const bytes = this.textEncoder.encode(value);
		this.addLength(bytes.length);
		this.addBytes(bytes);
	}

	/** Same byte contract as addStrings, with per-checksum reuse for a small repeated vocabulary. */
	addCachedStrings(values: readonly string[]): void {
		this.addLength(values.length);
		for (const value of values) {
			let bytes = this.cachedStringBytes.get(value);
			if (bytes === undefined) {
				bytes = this.textEncoder.encode(value);
				this.cachedStringBytes.set(value, bytes);
			}
			this.addLength(bytes.length);
			this.addBytes(bytes);
		}
	}

	/** Single cached-string form for hot fixed-schema loops with a bounded vocabulary. */
	addCachedString(value: string): void {
		this.addLength(1);
		let bytes = this.cachedStringBytes.get(value);
		if (bytes === undefined) {
			bytes = this.textEncoder.encode(value);
			this.cachedStringBytes.set(value, bytes);
		}
		this.addLength(bytes.length);
		this.addBytes(bytes);
	}

	async addStringsCooperatively(
		values: readonly string[],
		checkpoint: () => Promise<void>,
		checkpointItems = 256,
	): Promise<void> {
		if (!Number.isSafeInteger(checkpointItems) || checkpointItems <= 0) {
			throw new Error("String checksum checkpoint size must be a positive safe integer.");
		}
		this.addLength(values.length);
		for (let index = 0; index < values.length; index++) {
			const bytes = this.textEncoder.encode(values[index] as string);
			this.addLength(bytes.length);
			this.addBytes(bytes);
			if ((index + 1) % checkpointItems === 0) await checkpoint();
		}
	}

	digest(): string {
		return `${hex32(this.hashA)}:${hex32(this.hashB)}`;
	}

	private addLength(value: number): void {
		this.scalarView.setUint32(0, value, true);
		this.addBytes(this.scalarBytes.subarray(0, 4));
	}

	private addNumberValue(value: number): void {
		this.scalarView.setFloat64(0, value, true);
		this.addBytes(this.scalarBytes);
	}

	private addBytes(bytes: Uint8Array): void {
		for (let index = 0; index < bytes.length; index++) {
			const byte = bytes[index] as number;
			this.hashA = Math.imul(this.hashA ^ byte, 0x01000193) >>> 0;
			this.hashB = Math.imul(this.hashB ^ byte, 0x85ebca6b) >>> 0;
			this.hashB ^= this.hashB >>> 13;
		}
	}
}

function hex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
