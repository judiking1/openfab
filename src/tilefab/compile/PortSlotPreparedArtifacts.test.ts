import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import { PATH_INTERVAL_MAPPING_KIND } from "./CompoundPhysicalPath";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { PORT_SLOT_STATUS, PortSlotSpatialIndex } from "./PortSlotCompiler";
import {
	adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively,
	checksumPortSlotPreparedArtifactCatalog,
	checksumPortSlotPreparedArtifacts,
	compilePortSlotPreparedArtifactCatalog,
	compilePortSlotPreparedArtifacts,
	createPreparedPortSlotAvailabilityIndex,
	type PortSlotPreparedArtifactCatalog,
	portSlotPreparedArtifactCatalogMatch,
	portSlotPreparedArtifactsHaveExactSourceLayout,
	portSlotPreparedArtifactsMatch,
	validatePortSlotPreparedArtifactCatalog,
	validatePortSlotPreparedArtifacts,
} from "./PortSlotPreparedArtifacts";

describe("PortSlotPreparedArtifacts", () => {
	it("binds transferable OHB slot geometry and its spatial index to one physical revision", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const artifacts = compilePortSlotPreparedArtifacts(layout);
		const fingerprint = checksumPortSlotPreparedArtifacts(artifacts, "physical-fixture");

		expect(portSlotPreparedArtifactsMatch(layout, artifacts)).toBe(true);
		expect(artifacts.slotCount).toBe(artifacts.slots.count);
		expect(artifacts.spatialIndex.slotCount).toBe(artifacts.slotCount);
		expect(fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		const index = new PortSlotSpatialIndex(artifacts.slots, artifacts.spatialIndex);
		const row = index.nearest(
			artifacts.slots.worldPositions[0] as number,
			artifacts.slots.worldPositions[1] as number,
			0.01,
		);
		expect(row).toBe(0);

		const transfers = collectTransferableBuffers(artifacts);
		const delivered = structuredClone(artifacts, { transfer: transfers });
		expect(new Set(transfers).size).toBe(transfers.length);
		expect(artifacts.slots.statuses.byteLength).toBe(0);
		validatePortSlotPreparedArtifacts(layout, delivered);
		expect(checksumPortSlotPreparedArtifacts(delivered, "physical-fixture")).toBe(fingerprint);
	});

	it("detects a coherently shaped typed-buffer mutation through the artifact fingerprint", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const artifacts = compilePortSlotPreparedArtifacts(layout);
		const before = checksumPortSlotPreparedArtifacts(artifacts, "physical-fixture");
		artifacts.slots.worldPositions[0] += 0.125;
		expect(checksumPortSlotPreparedArtifacts(artifacts, "physical-fixture")).not.toBe(before);
	});

	it("binds live availability to every prepared row input it consumes", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const artifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		const slots = artifacts.slots;
		const row = slots.statuses.indexOf(PORT_SLOT_STATUS.LEGAL);
		expect(row).toBeGreaterThanOrEqual(0);
		const availability = createPreparedPortSlotAvailabilityIndex(
			layout,
			artifacts,
			document.portEquipment,
		);
		expect(availability.matchesPreparedArtifacts(artifacts)).toBe(true);
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);

		const sourcePathIndex = slots.sourcePathIndices[row] as number;
		const mutations: ReadonlyArray<readonly [string, () => () => void]> = [
			["source path", () => replaceTypedValue(slots.sourcePathIndices, row, sourcePathIndex + 1)],
			[
				"base status",
				() => replaceTypedValue(slots.statuses, row, PORT_SLOT_STATUS.UNSAFE_APPROACH),
			],
			["conflicting port", () => replaceTypedValue(slots.conflictingPortIds, row, 91)],
			["route x", () => replaceTypedValue(slots.routeXs, row, slots.routeXs[row] + 1)],
			["route z", () => replaceTypedValue(slots.routeZs, row, slots.routeZs[row] + 1)],
			[
				"route from",
				() =>
					replaceTypedValue(
						slots.routeFromDirections,
						row,
						((slots.routeFromDirections[row] as number) + 1) & 3,
					),
			],
			[
				"route to",
				() =>
					replaceTypedValue(
						slots.routeToDirections,
						row,
						((slots.routeToDirections[row] as number) + 1) & 3,
					),
			],
			[
				"station",
				() => replaceTypedValue(slots.stationMillimeters, row, slots.stationMillimeters[row] + 1),
			],
			["side", () => replaceTypedValue(slots.sides, row, ((slots.sides[row] as number) + 1) % 3)],
			[
				"lateral offset",
				() =>
					replaceTypedValue(
						slots.lateralOffsetMillimeters,
						row,
						(slots.lateralOffsetMillimeters[row] as number) + 1,
					),
			],
			[
				"direction",
				() => replaceTypedValue(slots.directions, row, ((slots.directions[row] as number) + 1) % 2),
			],
			[
				"final path",
				() =>
					replaceTypedValue(
						slots.finalPathIndices,
						row,
						(slots.finalPathIndices[row] as number) + 1,
					),
			],
			[
				"rail x",
				() =>
					replaceTypedValue(
						slots.railPositions,
						row * 2,
						(slots.railPositions[row * 2] as number) + 1,
					),
			],
			[
				"world x",
				() =>
					replaceTypedValue(
						slots.worldPositions,
						row * 2,
						(slots.worldPositions[row * 2] as number) + 1,
					),
			],
			[
				"world z",
				() =>
					replaceTypedValue(
						slots.worldPositions,
						row * 2 + 1,
						(slots.worldPositions[row * 2 + 1] as number) + 1,
					),
			],
			[
				"tangent x",
				() =>
					replaceTypedValue(slots.tangents, row * 2, (slots.tangents[row * 2] as number) + 0.25),
			],
			[
				"yaw",
				() => replaceTypedValue(slots.yawRadians, row, (slots.yawRadians[row] as number) + 0.25),
			],
		];
		for (const [label, mutate] of mutations) {
			const restore = mutate();
			expect(availability.statusFor(slots, row).status, label).toBe(
				PORT_SLOT_STATUS.ATTACHMENT_INVALID,
			);
			expect(availability.statusForEquipmentGroup(slots, row, 1).status, `${label} group`).toBe(
				PORT_SLOT_STATUS.ATTACHMENT_INVALID,
			);
			restore();
			expect(availability.statusFor(slots, row).status, `${label} restore`).toBe(
				PORT_SLOT_STATUS.LEGAL,
			);
		}

		const sourceCellOffset = sourcePathIndex * 2;
		const restorePhysicalSource = replaceTypedValue(
			layout.pathIntervalRemap.sourcePathCells,
			sourceCellOffset,
			(layout.pathIntervalRemap.sourcePathCells[sourceCellOffset] as number) + 1,
		);
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.ATTACHMENT_INVALID);
		restorePhysicalSource();
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);

		const mappingRow = layout.pathIntervalRemap.sourcePathOffsets[sourcePathIndex] as number;
		const restoreMapping = replaceTypedValue(
			layout.pathIntervalRemap.mappingKinds,
			mappingRow,
			PATH_INTERVAL_MAPPING_KIND.UNMAPPABLE,
		);
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.ATTACHMENT_INVALID);
		restoreMapping();
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);

		const finalPathIndex = slots.finalPathIndices[row] as number;
		const finalPoint = layout.paths.offsets[finalPathIndex] as number;
		const restoreFinalGeometry = replaceTypedValue(
			layout.paths.positions,
			finalPoint * 2,
			(layout.paths.positions[finalPoint * 2] as number) + 0.25,
		);
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.ATTACHMENT_INVALID);
		restoreFinalGeometry();
		expect(availability.statusFor(slots, row).status).toBe(PORT_SLOT_STATUS.LEGAL);

		const foreignArtifacts = compilePortSlotPreparedArtifacts(layout, "OHB");
		expect(availability.statusFor(foreignArtifacts.slots, row).status).toBe(
			PORT_SLOT_STATUS.ATTACHMENT_INVALID,
		);
		expect(() =>
			createPreparedPortSlotAvailabilityIndex(
				compilePhysicalRail(straightDocument().map),
				artifacts,
				document.portEquipment,
			),
		).toThrow("physical-layout identity");
	});

	it("validates every prepared STK span row before deriving a body conflict", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const artifacts = compilePortSlotPreparedArtifacts(layout, "STK");
		const slots = artifacts.slots;
		const rows = Array.from(slots.statuses)
			.map((status, row) => ({ status, row }))
			.filter(({ status }) => status === PORT_SLOT_STATUS.LEGAL)
			.slice(0, 2)
			.map(({ row }) => row);
		expect(rows).toHaveLength(2);
		const availability = createPreparedPortSlotAvailabilityIndex(
			layout,
			artifacts,
			document.portEquipment,
		);
		expect(availability.conflictingEquipmentGroupForStkRows(slots, rows)).toBe(0);

		const secondRow = rows[1] as number;
		const restore = replaceTypedValue(
			slots.stationMillimeters,
			secondRow,
			(slots.stationMillimeters[secondRow] as number) + 1,
		);
		expect(() => availability.conflictingEquipmentGroupForStkRows(slots, rows)).toThrow(
			`row ${secondRow} availability inputs changed`,
		);
		restore();
		expect(availability.conflictingEquipmentGroupForStkRows(slots, rows)).toBe(0);
	});

	it("prepares and fingerprints OHB, EQ, and STK catalogs as one transferable bundle", () => {
		const document = straightDocument();
		const layout = compilePhysicalRail(document.map);
		const catalog = compilePortSlotPreparedArtifactCatalog(layout);
		const fingerprint = checksumPortSlotPreparedArtifactCatalog(catalog, "physical-fixture");

		expect(portSlotPreparedArtifactCatalogMatch(layout, catalog)).toBe(true);
		expect(catalog.OHB.slotCount).toBe(catalog.EQ.slotCount * 2);
		expect(catalog.EQ.slotCount).toBe(catalog.STK.slotCount);
		expect(catalog.OHB.slots.portType).toBe("OHB");
		expect(catalog.EQ.slots.portType).toBe("EQ");
		expect(catalog.STK.slots.portType).toBe("STK");
		expect(fingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);

		const transfers = collectTransferableBuffers(catalog);
		const delivered = structuredClone(catalog, { transfer: transfers });
		validatePortSlotPreparedArtifactCatalog(layout, delivered);
		expect(checksumPortSlotPreparedArtifactCatalog(delivered, "physical-fixture")).toBe(
			fingerprint,
		);
	});

	it("privately adopts a Worker catalog before cooperative callbacks can mutate validated rows", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = compilePortSlotPreparedArtifactCatalog(layout);
		const unsafeRow = source.OHB.slots.statuses.indexOf(PORT_SLOT_STATUS.UNSAFE_APPROACH);
		expect(unsafeRow).toBeGreaterThanOrEqual(0);
		const sourceStatuses = source.OHB.slots.statuses;
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);
		let checkpointCount = 0;
		const adopted = await adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
			layout,
			source,
			physicalFingerprint,
			expectedFingerprint,
			async () => {
				checkpointCount++;
				expect(sourceStatuses.byteLength).toBe(0);
				sourceStatuses[unsafeRow] = PORT_SLOT_STATUS.LEGAL;
			},
			() => undefined,
		);

		expect(checkpointCount).toBeGreaterThan(0);
		expect(adopted.OHB.slots.statuses[unsafeRow]).toBe(PORT_SLOT_STATUS.UNSAFE_APPROACH);
		expect(Object.isExtensible(adopted.OHB.slots.statuses)).toBe(false);
		expect(portSlotPreparedArtifactsHaveExactSourceLayout(adopted.OHB, layout)).toBe(true);
	});

	it("prepares one private spatial index during cooperative catalog activation", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = compilePortSlotPreparedArtifactCatalog(layout);
		const physicalFingerprint = "physical-fixture";
		const adopted = await adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
			layout,
			source,
			physicalFingerprint,
			checksumPortSlotPreparedArtifactCatalog(source, physicalFingerprint),
			async () => undefined,
			() => undefined,
		);
		const slots = adopted.OHB.slots;
		const snapshot = adopted.OHB.spatialIndex;
		const index = PortSlotSpatialIndex.fromPreparedSnapshot(slots, snapshot);
		const firstX = slots.worldPositions[0] as number;
		const firstZ = slots.worldPositions[1] as number;

		expect(PortSlotSpatialIndex.fromPreparedSnapshot(slots, snapshot)).toBe(index);
		slots.worldPositions[0] = firstX + 10_000;
		snapshot.chunkCoordinates.fill(2_000_000_000);
		snapshot.chunkOffsets.fill(0);
		expect(
			index.query({
				minX: firstX - 0.1,
				minZ: firstZ - 0.1,
				maxX: firstX + 0.1,
				maxZ: firstZ + 0.1,
			}),
		).toContain(0);
	});

	it("rejects non-canonical typed constructors before transferring source ownership", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const originalStatuses = source.OHB.slots.statuses;
		const invalid = replaceOhbSlots(source, {
			...source.OHB.slots,
			statuses: new Int8Array(originalStatuses),
		});
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			invalid,
			physicalFingerprint,
		);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				invalid,
				physicalFingerprint,
				expectedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("typed array is invalid");
		expect(originalStatuses.byteLength).toBeGreaterThan(0);
	});

	it.each([
		["enumerable string", "visible-slot-metadata", true],
		["hidden string", "hidden-slot-metadata", false],
		["symbol", Symbol("slot-metadata"), false],
	] as const)("rejects a %s own property on a slot typed view after terminal transfer", async (_label, key, enumerable) => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const sourceView = source.OHB.slots.statuses;
		Object.defineProperty(sourceView, key, {
			value: "discarded by structured clone",
			enumerable,
			configurable: true,
		});
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				expectedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("typed arrays cannot contain custom own properties");
		expect(sourceView.byteLength).toBe(0);
		expect(Reflect.ownKeys(sourceView)).toContain(key);
	});

	it.each([
		["enumerable string", "visible-buffer-metadata", true],
		["hidden string", "hidden-buffer-metadata", false],
		["symbol", Symbol("buffer-metadata"), false],
	] as const)("rejects a %s own property on a slot backing ArrayBuffer before transfer", async (_label, key, enumerable) => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const sourceBuffer = source.OHB.slots.statuses.buffer;
		Object.defineProperty(sourceBuffer, key, {
			value: "discarded by structured clone",
			enumerable,
			configurable: true,
		});
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				expectedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("buffer ownership is invalid");
		expect(sourceBuffer.byteLength).toBeGreaterThan(0);
	});

	it("rejects a slot backing ArrayBuffer with a custom prototype before transfer", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const sourceBuffer = source.OHB.slots.statuses.buffer;
		Object.setPrototypeOf(sourceBuffer, Object.create(ArrayBuffer.prototype));
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				expectedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("buffer ownership is invalid");
		expect(source.OHB.slots.statuses.byteLength).toBeGreaterThan(0);
	});

	it("checks cancellation immediately after a checkpoint that only flips its signal", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const sourceStatuses = source.OHB.slots.statuses;
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);
		let cancelled = false;
		let checkpoints = 0;

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				expectedFingerprint,
				async () => {
					checkpoints++;
					cancelled = true;
				},
				() => {
					if (cancelled) throw new Error("PORT_SLOT_CANCELLED");
				},
			),
		).rejects.toThrow("PORT_SLOT_CANCELLED");
		expect(checkpoints).toBe(1);
		expect(sourceStatuses.byteLength).toBe(0);
	});

	it("checks cancellation immediately after terminal catalog transfer", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const sourceStatuses = source.OHB.slots.statuses;
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);
		let cancellationChecks = 0;

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				expectedFingerprint,
				async () => {
					throw new Error("CHECKPOINT_MUST_NOT_RUN");
				},
				() => {
					cancellationChecks++;
					if (cancellationChecks === 3) throw new Error("PORT_SLOT_CANCELLED_AFTER_TRANSFER");
				},
			),
		).rejects.toThrow("PORT_SLOT_CANCELLED_AFTER_TRANSFER");
		expect(cancellationChecks).toBe(3);
		expect(sourceStatuses.byteLength).toBe(0);
	});

	it("never invokes shadowed ArrayBuffer ownership accessors", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);
		const buffer = source.OHB.slots.statuses.buffer;
		const intrinsicByteLength = Object.getOwnPropertyDescriptor(
			ArrayBuffer.prototype,
			"byteLength",
		)?.get;
		if (!intrinsicByteLength) throw new Error("ArrayBuffer byteLength getter is unavailable.");
		let getterCalls = 0;
		Object.defineProperty(buffer, "byteLength", {
			configurable: true,
			get() {
				getterCalls++;
				return Reflect.apply(intrinsicByteLength, buffer, []);
			},
		});

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				expectedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("buffer ownership is invalid");
		expect(getterCalls).toBe(0);
		expect(Reflect.apply(intrinsicByteLength, buffer, [])).toBeGreaterThan(0);
	});

	it("rejects extra catalog graphs without cloning or detaching known buffers", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const statuses = source.OHB.slots.statuses;
		Object.defineProperty(source.OHB, "unexpectedGraph", {
			enumerable: true,
			value: new Array(1_024).fill("not part of the wire contract"),
		});
		const physicalFingerprint = "physical-fixture";
		const expectedFingerprint = checksumPortSlotPreparedArtifactCatalog(
			source,
			physicalFingerprint,
		);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				expectedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("schema is invalid");
		expect(statuses.byteLength).toBeGreaterThan(0);
	});

	it("rejects a fingerprinted spatial index whose rows are assigned to the wrong chunk", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		expect(source.OHB.spatialIndex.chunkCoordinates.length).toBeGreaterThan(0);
		source.OHB.spatialIndex.chunkCoordinates[0] += 1;
		const physicalFingerprint = "physical-fixture";
		const forgedFingerprint = checksumPortSlotPreparedArtifactCatalog(source, physicalFingerprint);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				forgedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow(/spatial (?:chunk coordinates|row)/);
	});

	it("rejects a non-canonical spatial chunk size even with a matching fingerprint", async () => {
		const layout = compilePhysicalRail(straightDocument().map);
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		Object.assign(source.OHB.spatialIndex, { chunkSizeMeters: 1 });
		const physicalFingerprint = "physical-fixture";
		const forgedFingerprint = checksumPortSlotPreparedArtifactCatalog(source, physicalFingerprint);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				forgedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("does not match the physical layout");
	});

	it("recomputes exact rail-clearance conflicts instead of trusting fingerprinted status bytes", async () => {
		const layout = parallelStraightLayout();
		const source = structuredClone(
			compilePortSlotPreparedArtifactCatalog(layout),
		) as PortSlotPreparedArtifactCatalog;
		const row = source.OHB.slots.statuses.indexOf(PORT_SLOT_STATUS.RAIL_CLEARANCE_CONFLICT);
		expect(row).toBeGreaterThanOrEqual(0);
		source.OHB.slots.statuses[row] = PORT_SLOT_STATUS.LEGAL;
		source.OHB.slots.conflictingRailPathIndices[row] = -1;
		Object.assign(source.OHB.slots, { legalCount: source.OHB.slots.legalCount + 1 });
		const physicalFingerprint = "physical-fixture";
		const forgedFingerprint = checksumPortSlotPreparedArtifactCatalog(source, physicalFingerprint);

		await expect(
			adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
				layout,
				source,
				physicalFingerprint,
				forgedFingerprint,
				async () => undefined,
				() => undefined,
			),
		).rejects.toThrow("clearance status diverged");
	});
});

function replaceTypedValue<
	View extends Int32Array | Uint32Array | Uint16Array | Uint8Array | Float32Array,
>(view: View, index: number, next: number): () => void {
	const previous = view[index] as number;
	view[index] = next;
	return () => {
		view[index] = previous;
	};
}

function replaceOhbSlots(
	catalog: PortSlotPreparedArtifactCatalog,
	slots: unknown,
): PortSlotPreparedArtifactCatalog {
	return {
		...catalog,
		OHB: {
			...catalog.OHB,
			slots,
		},
	} as PortSlotPreparedArtifactCatalog;
}

function straightDocument(): RailDocument {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 8, y: 0 }))).toBe(
		true,
	);
	return document;
}

function parallelStraightLayout(): ReturnType<typeof compilePhysicalRail> {
	const hydrator = TileMap.createHydrator();
	for (let x = 0; x <= 8; x++) {
		for (let y = 0; y <= 1; y++) {
			hydrator.addEncodedCell(
				x,
				y,
				encodeRailCell({
					incoming: x === 0 ? 0 : DIR_W,
					outgoing: x === 8 ? 0 : DIR_E,
				}),
			);
		}
	}
	const layout = compilePhysicalRail(hydrator.finish(1));
	expect(layout.valid).toBe(true);
	return layout;
}
