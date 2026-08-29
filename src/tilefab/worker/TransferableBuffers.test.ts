import { describe, expect, it } from "vitest";
import { collectTransferableBuffers } from "./TransferableBuffers";

describe("collectTransferableBuffers", () => {
	it("walks nested payloads and returns shared buffers once", () => {
		const buffer = new ArrayBuffer(32);
		const bytes = new Uint8Array(buffer);
		const words = new Uint32Array(buffer);
		const second = new Float32Array(4);
		const cyclic: Record<string, unknown> = { bytes, nested: [{ words }, second] };
		cyclic.self = cyclic;

		expect(new Set(collectTransferableBuffers(cyclic))).toEqual(new Set([buffer, second.buffer]));
	});
});
