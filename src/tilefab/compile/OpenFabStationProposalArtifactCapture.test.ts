import { describe, expect, it } from "vitest";
import {
	captureOpenFabStationProposalArtifactCooperatively,
	consumeOpenFabStationProposalArtifactCaptureAuthority,
	consumeOpenFabStationProposalArtifactCaptureTransfer,
	type HydratedOpenFabStationProposalArtifact,
	hydrateOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
	openFabStationProposalArtifactTransfers,
	readOpenFabStationProposalRow,
	revokeOpenFabStationProposalArtifactCaptureAuthority,
	validateOpenFabStationProposalArtifact,
} from "./OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "./OpenFabStationProposalCsvReader";

describe("OpenFab station proposal artifact cooperative capture", () => {
	it("captures an exact independently transferable SoA round trip while preserving the source facade", async () => {
		const source = hydratedFixture(12);
		let checkpointCount = 0;

		const capture = await captureOpenFabStationProposalArtifactCooperatively(source.facade, {
			checkpoint: async () => {
				checkpointCount++;
			},
			bytesPerChunk: 7,
			sliceMilliseconds: 1,
			now: incrementingClock(),
		});

		validateOpenFabStationProposalArtifact(capture.artifact);
		expect(capture.artifact.semanticFingerprint).toBe(source.semanticFingerprint);
		expect(capture.artifact.snapshotFingerprint).toBe(source.snapshotFingerprint);
		expect(capture.artifact.rowCount).toBe(source.rows.length);
		expect(
			Array.from({ length: capture.artifact.rowCount }, (_, row) =>
				readOpenFabStationProposalRow(capture.artifact, row),
			),
		).toEqual(source.rows);
		const transfers = openFabStationProposalArtifactTransfers(capture.artifact);
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(checkpointCount).toBeGreaterThan(1);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(capture, source.facade)).toBe(
			true,
		);
		expect(source.facade.readRow(0)).toEqual(source.rows[0]);
	});

	it("isolates source reads from captured-buffer mutation and detachment", async () => {
		const source = hydratedFixture(8);
		const mutated = await capture(source.facade);
		const originalStation = source.facade.readRow(0).stationMillimeters;
		mutated.artifact.stationMillimeters[0] = originalStation + 123;
		expect(source.facade.readRow(0).stationMillimeters).toBe(originalStation);
		revokeOpenFabStationProposalArtifactCaptureAuthority(mutated);

		const transferred = await capture(source.facade);
		const transferList = openFabStationProposalArtifactTransfers(transferred.artifact);
		const delivered = structuredClone(transferred.artifact, { transfer: transferList });
		expect(transferList.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(source.facade.readRow(0)).toEqual(source.rows[0]);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(transferred, source.facade)).toBe(
			true,
		);

		const deliveredFacade = hydrateOpenFabStationProposalArtifact(delivered);
		expect(deliveredFacade.readRow(0)).toEqual(source.rows[0]);
		expect(source.facade.readRow(source.rows.length - 1)).toEqual(source.rows.at(-1));
	});

	it("rejects fake sources and terminally consumes authority on a wrong-facade attempt", async () => {
		const source = hydratedFixture(4);
		const other = hydratedFixture(4);
		const fake = Object.freeze({ ...source.facade }) as HydratedOpenFabStationProposalArtifact;
		let fakeCheckpointCount = 0;

		await expect(
			captureOpenFabStationProposalArtifactCooperatively(fake, {
				checkpoint: async () => {
					fakeCheckpointCount++;
				},
			}),
		).rejects.toThrow("STATION_PROPOSAL_CAPTURE_SOURCE_INVALID");
		expect(fakeCheckpointCount).toBe(0);

		const wrongFacadeCapture = await capture(source.facade);
		expect(
			consumeOpenFabStationProposalArtifactCaptureAuthority(wrongFacadeCapture, other.facade),
		).toBe(false);
		expect(
			consumeOpenFabStationProposalArtifactCaptureAuthority(wrongFacadeCapture, source.facade),
		).toBe(false);

		const fakeFacadeCapture = await capture(source.facade);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(fakeFacadeCapture, fake)).toBe(
			false,
		);
		expect(
			consumeOpenFabStationProposalArtifactCaptureAuthority(fakeFacadeCapture, source.facade),
		).toBe(false);

		const throwingFake = new Proxy(fake, {
			get() {
				throw new Error("Facade getters must not participate in authority checks.");
			},
		});
		const getterCapture = await capture(source.facade);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(getterCapture, throwingFake)).toBe(
			false,
		);
		expect(
			consumeOpenFabStationProposalArtifactCaptureAuthority(getterCapture, source.facade),
		).toBe(false);
	});

	it("makes successful consumption and explicit revocation one-shot", async () => {
		const source = hydratedFixture(3);
		const consumed = await capture(source.facade);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(consumed, source.facade)).toBe(
			true,
		);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(consumed, source.facade)).toBe(
			false,
		);

		const revoked = await capture(source.facade);
		revokeOpenFabStationProposalArtifactCaptureAuthority(revoked);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(revoked, source.facade)).toBe(
			false,
		);
	});

	it("terminally releases a genuine capture into its exact O(column-count) transfer list", async () => {
		const source = hydratedFixture(5);
		const releasedCapture = await capture(source.facade);
		const released = consumeOpenFabStationProposalArtifactCaptureTransfer(
			releasedCapture,
			source.facade,
		);
		expect(released.artifact).toBe(releasedCapture.artifact);
		expect(new Set(released.transfers).size).toBe(released.transfers.length);
		expect(released.transfers.every((buffer) => buffer.byteLength > 0)).toBe(true);
		expect(() =>
			consumeOpenFabStationProposalArtifactCaptureTransfer(releasedCapture, source.facade),
		).toThrow("STATION_PROPOSAL_CAPTURE_AUTHORITY_INVALID");

		const delivered = structuredClone(released.artifact, { transfer: [...released.transfers] });
		expect(released.transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(hydrateOpenFabStationProposalArtifact(delivered).readRow(0)).toEqual(source.rows[0]);

		const wrongFacadeCapture = await capture(source.facade);
		const other = hydratedFixture(1);
		expect(() =>
			consumeOpenFabStationProposalArtifactCaptureTransfer(wrongFacadeCapture, other.facade),
		).toThrow("STATION_PROPOSAL_CAPTURE_AUTHORITY_INVALID");
		expect(() =>
			consumeOpenFabStationProposalArtifactCaptureTransfer(wrongFacadeCapture, source.facade),
		).toThrow("STATION_PROPOSAL_CAPTURE_AUTHORITY_INVALID");
	});

	it("aborts during chunk copying without invalidating the facade or minting partial authority", async () => {
		const source = hydratedFixture(64);
		const controller = new AbortController();
		let checkpointCount = 0;

		await expect(
			captureOpenFabStationProposalArtifactCooperatively(source.facade, {
				checkpoint: async () => {
					checkpointCount++;
					controller.abort();
				},
				signal: controller.signal,
				bytesPerChunk: 1,
				sliceMilliseconds: 1,
				now: incrementingClock(),
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(checkpointCount).toBe(1);
		expect(source.facade.readRow(0)).toEqual(source.rows[0]);
		expect(source.facade.readRow(source.rows.length - 1)).toEqual(source.rows.at(-1));

		const retry = await capture(source.facade);
		expect(consumeOpenFabStationProposalArtifactCaptureAuthority(retry, source.facade)).toBe(true);
	});
});

async function capture(facade: HydratedOpenFabStationProposalArtifact) {
	return captureOpenFabStationProposalArtifactCooperatively(facade, {
		checkpoint: async () => undefined,
	});
}

function incrementingClock(): () => number {
	let tick = 0;
	return () => tick++;
}

function hydratedFixture(rowCount: number): {
	readonly facade: HydratedOpenFabStationProposalArtifact;
	readonly rows: readonly ReturnType<HydratedOpenFabStationProposalArtifact["readRow"]>[];
	readonly semanticFingerprint: string;
	readonly snapshotFingerprint: string;
} {
	const rows = Array.from({ length: rowCount }, (_, row) => stationCsvRow(row));
	const source = new TextEncoder().encode(
		`${OPENFAB_STATION_PROPOSAL_V1_HEADERS.join(",")}\n${rows.join("\n")}\n`,
	);
	const result = parseOpenFabStationProposalCsv(source);
	if (!result.ok) throw new Error(`Synthetic proposal fixture failed: ${result.failure.code}`);
	const expectedRows = Array.from({ length: result.artifact.rowCount }, (_, row) =>
		readOpenFabStationProposalRow(result.artifact, row),
	);
	const semanticFingerprint = result.artifact.semanticFingerprint;
	const snapshotFingerprint = result.artifact.snapshotFingerprint;
	return Object.freeze({
		facade: hydrateOpenFabStationProposalArtifact(result.artifact),
		rows: Object.freeze(expectedRows),
		semanticFingerprint,
		snapshotFingerprint,
	});
}

function stationCsvRow(row: number): string {
	const suffix = row.toString().padStart(5, "0");
	const kind = (["OHB", "EQ", "STK"] as const)[row % 3] as "OHB" | "EQ" | "STK";
	return [
		"synthetic-scope",
		`PORT-${suffix}`,
		`ALT-${suffix}-A|ALT-${suffix}-B`,
		"rail-scope",
		`RAIL-${suffix}`,
		String(1_000 + row),
		"LEFT",
		"700",
		"WITH_TRAVEL",
		"DECLARED",
		kind,
		`GROUP-${suffix}`,
		kind,
		"BAY-SYNTHETIC",
		String(row * 1_000),
		String(row * 2_000),
	].join(",");
}
