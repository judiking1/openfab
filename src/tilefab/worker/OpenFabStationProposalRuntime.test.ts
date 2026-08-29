import { describe, expect, it } from "vitest";
import {
	OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
	OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
	validateOpenFabStationProposalArtifact,
	validateOpenFabStationProposalReadFailure,
} from "../compile/OpenFabStationProposalArtifact";
import {
	OPENFAB_STATION_PROPOSAL_WORKER_MAX_ERROR_MESSAGE_LENGTH,
	OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
	type OpenFabStationProposalWorkerRequest,
	openFabStationProposalWorkerErrorMessage,
} from "./OpenFabStationProposalProtocol";
import {
	collectOpenFabStationProposalResponseTransfers,
	runOpenFabStationProposalWorkerRequest,
} from "./OpenFabStationProposalRuntime";

describe("OpenFabStationProposalRuntime", () => {
	it("reads a transferred synthetic schema and returns an exact transferable snapshot", () => {
		const source = headerOnlySource();
		const sourceByteLength = source.byteLength;
		const request = requestFor(source, 7, 19);
		const deliveredRequest = structuredClone(request, { transfer: [source] });

		expect(source.byteLength).toBe(0);
		const response = runOpenFabStationProposalWorkerRequest(deliveredRequest);
		expect(response).toMatchObject({
			type: "OPENFAB_STATION_PROPOSAL_READ",
			protocolVersion: OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
			schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
			schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
			requestId: 7,
			generation: 19,
			byteLength: sourceByteLength,
		});
		if (response.type !== "OPENFAB_STATION_PROPOSAL_READ") return;
		validateOpenFabStationProposalArtifact(response.artifact);
		expect(response.artifact.sourceByteLength).toBe(sourceByteLength);
		expect(response.artifact.rowCount).toBe(0);

		const transfers = collectOpenFabStationProposalResponseTransfers(response);
		expect(transfers.length).toBeGreaterThan(0);
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(transfers).not.toContain(deliveredRequest.source);
		const deliveredResponse = structuredClone(response, { transfer: transfers });
		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		if (deliveredResponse.type !== "OPENFAB_STATION_PROPOSAL_READ") return;
		validateOpenFabStationProposalArtifact(deliveredResponse.artifact);
	});

	it("returns a safe transferable rejection for an empty source", () => {
		const response = runOpenFabStationProposalWorkerRequest(requestFor(new ArrayBuffer(0), 3, 4));

		expect(response).toMatchObject({
			type: "OPENFAB_STATION_PROPOSAL_REJECTED",
			requestId: 3,
			generation: 4,
			byteLength: 0,
			failure: {
				code: "SOURCE_EMPTY",
				sourceByteLength: 0,
			},
		});
		if (response.type !== "OPENFAB_STATION_PROPOSAL_REJECTED") return;
		validateOpenFabStationProposalReadFailure(response.failure);
		const transfers = collectOpenFabStationProposalResponseTransfers(response);
		expect(transfers).toHaveLength(1);
		const delivered = structuredClone(response, { transfer: transfers });
		expect(transfers[0]?.byteLength).toBe(0);
		if (delivered.type !== "OPENFAB_STATION_PROPOSAL_REJECTED") return;
		validateOpenFabStationProposalReadFailure(delivered.failure);
	});

	it("redacts malformed request data behind an exact fixed error", () => {
		const source = new TextEncoder().encode("TOP_SECRET_SOURCE").buffer;
		const request = {
			...requestFor(source, 23, 29),
			untrusted: "TOP_SECRET_FIELD",
		};

		const response = runOpenFabStationProposalWorkerRequest(request);
		expect(response).toEqual({
			type: "OPENFAB_STATION_PROPOSAL_ERROR",
			protocolVersion: OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
			schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
			schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
			requestId: 23,
			generation: 29,
			byteLength: source.byteLength,
			code: "MALFORMED_REQUEST",
			message: openFabStationProposalWorkerErrorMessage("MALFORMED_REQUEST"),
		});
		expect(
			response.type === "OPENFAB_STATION_PROPOSAL_ERROR" && response.message.length,
		).toBeLessThanOrEqual(OPENFAB_STATION_PROPOSAL_WORKER_MAX_ERROR_MESSAGE_LENGTH);
		expect(JSON.stringify(response)).not.toContain("TOP_SECRET");
		expect(collectOpenFabStationProposalResponseTransfers(response)).toEqual([]);
	});

	it("rejects malformed protocol, correlation, byte, and source axes", () => {
		const mutations: ReadonlyArray<(value: Record<string, unknown>) => Record<string, unknown>> = [
			(value) => ({ ...value, protocolVersion: 2 }),
			(value) => ({ ...value, schemaId: "foreign/schema" }),
			(value) => ({ ...value, schemaVersion: 2 }),
			(value) => ({ ...value, requestId: 0 }),
			(value) => ({ ...value, requestId: 1.5 }),
			(value) => ({ ...value, generation: 0 }),
			(value) => ({ ...value, byteLength: (value.byteLength as number) + 1 }),
			(value) => ({ ...value, source: new Uint8Array(value.source as ArrayBuffer) }),
			(value) => ({ ...value, extra: "SYNTHETIC_UNTRUSTED_FIELD" }),
		];

		for (const mutate of mutations) {
			const request = requestFor(headerOnlySource(), 101, 103);
			const response = runOpenFabStationProposalWorkerRequest(
				mutate(request as unknown as Record<string, unknown>),
			);
			expect(response.type).toBe("OPENFAB_STATION_PROPOSAL_ERROR");
			if (response.type !== "OPENFAB_STATION_PROPOSAL_ERROR") continue;
			expect(response.code).toBe("MALFORMED_REQUEST");
			expect(response.message).toBe(openFabStationProposalWorkerErrorMessage("MALFORMED_REQUEST"));
			expect(collectOpenFabStationProposalResponseTransfers(response)).toEqual([]);
		}
	});

	it("preserves malformed CSV as bounded rejection evidence without source text", () => {
		const source = new TextEncoder().encode('"TOP_SECRET_UNCLOSED').buffer;
		const response = runOpenFabStationProposalWorkerRequest(requestFor(source, 31, 37));

		expect(response.type).toBe("OPENFAB_STATION_PROPOSAL_REJECTED");
		if (response.type !== "OPENFAB_STATION_PROPOSAL_REJECTED") return;
		expect(response.failure.code).toBe("MALFORMED_CSV");
		expect(response.failure.sourceByteLength).toBe(source.byteLength);
		expect(JSON.stringify(response)).not.toContain("TOP_SECRET_UNCLOSED");
		validateOpenFabStationProposalReadFailure(response.failure);
	});

	it("keeps representative Worker parse and validation within a bounded budget", () => {
		const rowCount = 512;
		const source = scaleSource(rowCount);
		const request = requestFor(source, 41, 43);
		const delivered = structuredClone(request, { transfer: [source] });
		const startedAt = performance.now();

		const response = runOpenFabStationProposalWorkerRequest(delivered);
		const elapsedMilliseconds = performance.now() - startedAt;

		expect(response.type).toBe("OPENFAB_STATION_PROPOSAL_READ");
		if (response.type !== "OPENFAB_STATION_PROPOSAL_READ") return;
		expect(response.artifact.rowCount).toBe(rowCount);
		expect(response.artifact.sourceRecordCount).toBe(rowCount);
		expect(elapsedMilliseconds).toBeLessThan(2_000);
		const transfers = collectOpenFabStationProposalResponseTransfers(response);
		expect(new Set(transfers).size).toBe(transfers.length);
	});
});

function headerOnlySource(): ArrayBuffer {
	return new TextEncoder().encode(`${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n`).buffer;
}

function requestFor(
	source: ArrayBuffer,
	requestId: number,
	generation: number,
): OpenFabStationProposalWorkerRequest {
	return {
		type: "READ_OPENFAB_STATION_PROPOSAL",
		protocolVersion: OPENFAB_STATION_PROPOSAL_WORKER_PROTOCOL_VERSION,
		schemaId: OPENFAB_STATION_PROPOSAL_SCHEMA_ID,
		schemaVersion: OPENFAB_STATION_PROPOSAL_SCHEMA_VERSION,
		requestId,
		generation,
		byteLength: source.byteLength,
		source,
	};
}

function scaleSource(rowCount: number): ArrayBuffer {
	const headers = [
		"identity_scope",
		"port_key",
		"attachment_scope",
		"attachment_alias",
		"station_mm",
		"side",
		"lateral_offset_mm",
		"direction",
		"direction_evidence",
		"port_type",
	] as const;
	const rows = Array.from(
		{ length: rowCount },
		(_, index) => `s,P${index},r,a,${index},CENTER,0,UNKNOWN,UNKNOWN,OHB`,
	);
	return new TextEncoder().encode(`${headers.join(",")}\n${rows.join("\n")}\n`).buffer;
}
