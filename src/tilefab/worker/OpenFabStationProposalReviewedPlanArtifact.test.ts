import { describe, expect, it } from "vitest";
import type {
	EquipmentGroupMutation,
	EquipmentGroupRecord,
	StkAuthoringTemplate,
} from "../core/EquipmentGroup";
import { equipmentGroupPortBarcode } from "../core/EquipmentGroupPortOrder";
import {
	createPortEquipmentMutationPlanWithImmutableGraphCertificate,
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import {
	PORT_RECORD_MAX_ID,
	type PortDirection,
	type PortMutation,
	type PortRecord,
	type PortRouteIdentity,
	type PortSide,
} from "../core/PortRecord";
import { DIR_E, DIR_N, DIR_W, type Direction } from "../core/railShape";
import {
	adoptOpenFabStationProposalReviewedPlanArtifact,
	adoptOpenFabStationProposalReviewedPlanArtifactCooperatively,
	collectOpenFabStationProposalReviewedPlanArtifactTransfers,
	encodeOpenFabStationProposalReviewedPlanArtifactCooperatively,
	OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT,
	OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_BYTES,
	type OpenFabStationProposalReviewedPlanArtifact,
	type OpenFabStationProposalReviewedPlanEncodeInput,
	openFabStationProposalReviewedPlanArtifactShapeError,
	releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer,
	validateOpenFabStationProposalReviewedPlanArtifact,
} from "./OpenFabStationProposalReviewedPlanArtifact";

const REVIEW_FINGERPRINT = "openfab-station-proposal-review:v1:12345678:90abcdef";
const NOOP_OPTIONS = Object.freeze({ checkpoint: async () => {}, revision: () => 0 });
const NODE_PROCESS = (
	globalThis as typeof globalThis & {
		readonly process?: {
			readonly env: Readonly<Record<string, string | undefined>>;
			memoryUsage(): { readonly rss: number };
		};
	}
).process;
const RUN_SCALE = NODE_PROCESS?.env.OPENFAB_REVIEWED_PLAN_SCALE === "1";

type PortSeed = Readonly<{
	route: PortRouteIdentity;
	stationMillimeters?: number;
	side?: PortSide;
	lateralOffsetMillimeters?: number;
	direction?: PortDirection;
}>;

type GroupSeed =
	| Readonly<{ kind: "OHB"; ports: readonly PortSeed[] }>
	| Readonly<{ kind: "EQ"; pitchMillimeters: number; ports: readonly PortSeed[] }>
	| Readonly<{
			kind: "STK";
			template: StkAuthoringTemplate;
			ports: readonly PortSeed[];
	  }>;

describe("OpenFab station proposal reviewed plan artifact", () => {
	it("encodes every route/group code, pitch, template, signed bound, and exact byte", async () => {
		const input = buildInput(allCodeSeeds());
		const first = await encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
			input,
			NOOP_OPTIONS,
		);
		const second = await encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
			input,
			NOOP_OPTIONS,
		);

		expect(first).toMatchObject({
			kind: "openfab-station-proposal-reviewed-plan-artifact",
			version: 1,
			planKindCode: 4,
			baseRevision: 17,
			basePatchSequence: 29,
			sourceNextPortId: 100,
			sourceNextEquipmentGroupId: 500,
			portCount: input.plan.portMutations.length,
			groupCount: input.plan.equipmentGroupMutations.length,
			byteLength:
				30 * input.plan.portMutations.length + 5 * input.plan.equipmentGroupMutations.length + 4,
			reviewFingerprint: REVIEW_FINGERPRINT,
		});
		expect(first.fingerprint).toBe(second.fingerprint);
		expect(openFabStationProposalReviewedPlanArtifactShapeError(first)).toBeNull();
		expect(new Set(first.groupSpecCodes)).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

		// The first four ports exercise all profiles and roles; the fifth is cardinal.
		expect([...first.routeKinds.slice(0, 5)]).toEqual([2, 2, 2, 2, 1]);
		expect([...first.routeProfileClasses.slice(0, 4)]).toEqual([1, 2, 3, 4]);
		expect([...first.routeRoles.slice(0, 4)]).toEqual([1, 2, 3, 1]);
		expect([...first.routePortIndices.slice(0, 5)]).toEqual([0, -1, 1, 1, 0]);
		expect([...first.routeXs.slice(0, 4)]).toEqual([0, 0, 0, 0]);
		expect(first.routeXs[4]).toBe(-0x8000_0000);
		expect(first.routeZs[4]).toBe(0x7fff_ffff);
		expect(first.routeSwitchIds[4]).toBe(0);
		expect(first.routeSegmentOrdinals[4]).toBe(0);

		for (const [seeds, planKindCode] of [
			[[ohbSeed(cardinal(0, 0))], 1],
			[[eqSeed(1_000, 0)], 2],
			[[stkSeed("FLEX", 0, 1)], 3],
		] as const) {
			const homogeneous = await encode(buildInput(seeds));
			expect(homogeneous.planKindCode).toBe(planKindCode);
			expect(openFabStationProposalReviewedPlanArtifactShapeError(homogeneous)).toBeNull();
		}
	});

	it("collects exactly 16 independent full-span buffers and transfers them once", async () => {
		const artifact = await encodeSimple();
		const transfers = collectOpenFabStationProposalReviewedPlanArtifactTransfers(artifact);
		expect(transfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT);
		expect(new Set(transfers).size).toBe(OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT);
		expect(transfers.reduce((sum, buffer) => sum + buffer.byteLength, 0)).toBe(artifact.byteLength);

		const delivered = structuredClone(artifact, { transfer: transfers });
		expect(transfers.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(() => validateOpenFabStationProposalReviewedPlanArtifact(delivered)).not.toThrow();
		expect(delivered.groupSpecCodes[0]).toBe(2);
		expect([...delivered.groupPortOffsets]).toEqual([0, 2]);
	});

	it("descriptor-captures an untrusted graph without invoking gets and rejects it before yielding", async () => {
		const ordinary = buildInput(simpleSeeds());
		let getCalls = 0;
		const route = new Proxy(
			ordinary.plan.portMutations[0]?.after?.route as PortRouteIdentity,
			trapGets(() => getCalls++),
		);
		const portAfter = new Proxy(
			{ ...(ordinary.plan.portMutations[0]?.after as PortRecord), route },
			trapGets(() => getCalls++),
		);
		const portMutation = new Proxy(
			{ ...(ordinary.plan.portMutations[0] as PortMutation), after: portAfter },
			trapGets(() => getCalls++),
		);
		const portMutations = new Proxy(
			[portMutation, ...ordinary.plan.portMutations.slice(1)],
			trapGets(() => getCalls++),
		);
		const plan = new Proxy(
			{ ...ordinary.plan, portMutations },
			trapGets(() => getCalls++),
		);
		const input = new Proxy(
			{ ...ordinary, plan },
			trapGets(() => getCalls++),
		);

		await expectCode(
			encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
				input as OpenFabStationProposalReviewedPlanEncodeInput,
				NOOP_OPTIONS,
			),
			"PLAN_INPUT_NOT_IMMUTABLE",
		);
		expect(getCalls).toBe(0);
	});

	it("rejects nested and array-index accessors without invoking them", async () => {
		const input = mutableInput(buildInput(simpleSeeds()));
		let calls = 0;
		Object.defineProperty(input.plan.portMutations[0] as object, "after", {
			enumerable: true,
			configurable: true,
			get() {
				calls++;
				return null;
			},
		});
		await expectCode(encode(input), "PLAN_INPUT_NOT_IMMUTABLE");
		expect(calls).toBe(0);

		const arrayAccessor = mutableInput(buildInput(simpleSeeds()));
		Object.defineProperty(arrayAccessor.plan.portMutations, "0", {
			enumerable: true,
			configurable: true,
			get() {
				calls++;
				return null;
			},
		});
		await expectCode(encode(arrayAccessor), "PLAN_INPUT_NOT_IMMUTABLE");
		expect(calls).toBe(0);
	});

	it("proves every deterministic omission before encoding", async () => {
		const cases: readonly [string, (input: MutableInput) => void, string][] = [
			[
				"foreign before",
				(input) => setPortMutation(input, 0, { before: input.plan.portMutations[0]?.after }),
				"PLAN_NOT_ADDITION_ONLY",
			],
			[
				"port mutation id gap",
				(input) => setPortMutation(input, 0, { id: 9_999 }),
				"PLAN_ID_SEQUENCE_MISMATCH",
			],
			[
				"after port id gap",
				(input) => setPort(input, 0, { id: 9_999 }),
				"PLAN_ID_SEQUENCE_MISMATCH",
			],
			[
				"group id gap",
				(input) => setGroupMutation(input, 0, { id: 9_999 }),
				"PLAN_ID_SEQUENCE_MISMATCH",
			],
			[
				"group after id gap",
				(input) => setGroup(input, 0, { id: 9_999 }),
				"PLAN_ID_SEQUENCE_MISMATCH",
			],
			["membership order", (input) => swapEqMembership(input), "PLAN_GROUP_MEMBERSHIP_MISMATCH"],
			[
				"reciprocal group",
				(input) => setPort(input, 0, { equipmentGroupId: 9_999 }),
				"PLAN_PORT_DERIVATION_MISMATCH",
			],
			[
				"reciprocal type",
				(input) => setPort(input, 0, { portType: "STK" }),
				"PLAN_PORT_DERIVATION_MISMATCH",
			],
			[
				"derived barcode",
				(input) => setPort(input, 0, { barcode: "foreign" }),
				"PLAN_PORT_DERIVATION_MISMATCH",
			],
			[
				"null barcode",
				(input) => setPort(input, 0, { barcode: null }),
				"PLAN_PORT_DERIVATION_MISMATCH",
			],
			["EQ recipe", (input) => setGroup(input, 0, { recipe: "R1" }), "PLAN_GROUP_SPEC_MISMATCH"],
			[
				"EQ pitch",
				(input) => setGroup(input, 0, { pitchMillimeters: 1_500 }),
				"PLAN_GROUP_SPEC_MISMATCH",
			],
			[
				"invalid route",
				(input) => setPort(input, 0, { route: cardinal(0, 0, DIR_E, DIR_E) }),
				"PLAN_PORT_DERIVATION_MISMATCH",
			],
			[
				"center offset",
				(input) => setPort(input, 0, { lateralOffsetMillimeters: 1 }),
				"PLAN_PORT_DERIVATION_MISMATCH",
			],
			[
				"wrong plan kind",
				(input) => {
					input.plan.kind = "place-stk";
				},
				"PLAN_KIND_MISMATCH",
			],
			[
				"homogeneous disguised as batch",
				(input) => {
					input.plan.kind = PORT_EQUIPMENT_BATCH_PLAN_KIND;
				},
				"PLAN_KIND_MISMATCH",
			],
			[
				"invalid plan state",
				(input) => {
					input.plan.valid = false;
				},
				"PLAN_STATE_MISMATCH",
			],
			[
				"foreign reason",
				(input) => {
					input.plan.reason = "looks valid";
				},
				"PLAN_STATE_MISMATCH",
			],
			[
				"source revision",
				(input) => {
					input.sourceRevision++;
				},
				"SOURCE_IDENTITY_MISMATCH",
			],
			[
				"source sequence",
				(input) => {
					input.sourcePatchSequence++;
				},
				"SOURCE_IDENTITY_MISMATCH",
			],
		];
		for (const [label, mutate, code] of cases) {
			const input = mutableInput(buildInput([eqSeed(1_000, 0)]));
			mutate(input);
			const encodedInput =
				label === "invalid plan state" ||
				label === "foreign reason" ||
				label === "source revision" ||
				label === "source sequence"
					? input
					: certifyMutableInput(input);
			await expectCode(encode(encodedInput), code, label);
		}

		const custom = mutableInput(buildInput([stkSeed("FLEX", 0, 1)]));
		setGroup(custom, 0, { template: "CUSTOM" });
		await expectCode(encode(certifyMutableInput(custom)), "PLAN_GROUP_SPEC_MISMATCH");

		const stkGap = mutableInput(buildInput([stkSeed("FOUR_PORT", 0, 4)]));
		setPort(stkGap, 2, { route: cardinal(9, 0) });
		await expectCode(encode(certifyMutableInput(stkGap)), "PLAN_GROUP_MEMBERSHIP_MISMATCH");

		const mixedAsSingle = mutableInput(buildInput([ohbSeed(cardinal(0, 0)), eqSeed(1_000, 1)]));
		mixedAsSingle.plan.kind = "place-eq";
		await expectCode(encode(certifyMutableInput(mixedAsSingle)), "PLAN_KIND_MISMATCH");

		const swappedMutations = mutableInput(buildInput([eqSeed(1_000, 0)]));
		[swappedMutations.plan.portMutations[0], swappedMutations.plan.portMutations[1]] = [
			swappedMutations.plan.portMutations[1] as MutableRecord,
			swappedMutations.plan.portMutations[0] as MutableRecord,
		];
		await expectCode(encode(certifyMutableInput(swappedMutations)), "PLAN_ID_SEQUENCE_MISMATCH");

		const duplicateMember = mutableInput(buildInput([eqSeed(1_000, 0)]));
		const duplicateIds = (
			(duplicateMember.plan.equipmentGroupMutations[0] as MutableRecord).after as MutableRecord
		).portIds as number[];
		duplicateIds[1] = duplicateIds[0] as number;
		await expectCode(
			encode(certifyMutableInput(duplicateMember)),
			"PLAN_GROUP_MEMBERSHIP_MISMATCH",
		);

		const foreignPort = mutableInput(buildInput([eqSeed(1_000, 0)]));
		const extra = structuredClone(foreignPort.plan.portMutations[1] as MutableRecord);
		extra.id = (extra.id as number) + 1;
		(extra.after as MutableRecord).id = extra.id;
		foreignPort.plan.portMutations.push(extra);
		await expectCode(encode(certifyMutableInput(foreignPort)), "PLAN_GROUP_MEMBERSHIP_MISMATCH");

		const noChanges = buildInput([]);
		await expectCode(encode(noChanges), "NO_CHANGES");
	});

	it("rejects unsealed hostile membership graphs and over-capacity arrays before scanning", async () => {
		const input = mutableInput(buildInput([ohbSeed(cardinal(0, 0))]));
		const group = input.plan.equipmentGroupMutations[0]?.after as MutableRecord;
		const ports = new Array(100_000).fill((group.portIds as number[])[0]);
		let memberGetterCalls = 0;
		Object.defineProperty(ports, "0", {
			enumerable: true,
			configurable: true,
			get() {
				memberGetterCalls++;
				return 100;
			},
		});
		group.portIds = ports;
		await expectCode(encode(input), "PLAN_INPUT_NOT_IMMUTABLE");
		expect(memberGetterCalls).toBe(0);

		const tooManyPorts = mutableInput(buildInput(simpleSeeds()));
		tooManyPorts.plan.portMutations = new Array(100_001);
		await expectCode(encode(tooManyPorts), "CAPACITY_EXCEEDED");

		const tooManyGroups = mutableInput(buildInput(simpleSeeds()));
		tooManyGroups.plan.equipmentGroupMutations = new Array(100_001);
		await expectCode(encode(tooManyGroups), "CAPACITY_EXCEEDED");
	});

	it("accepts the final int32 IDs and rejects cursor overflow", async () => {
		const accepted = buildInput(simpleSeeds(), {
			sourceNextPortId: PORT_RECORD_MAX_ID - 1,
			sourceNextEquipmentGroupId: PORT_RECORD_MAX_ID,
		});
		const artifact = await encode(accepted);
		expect(artifact.sourceNextPortId).toBe(PORT_RECORD_MAX_ID - 1);
		expect(artifact.sourceNextEquipmentGroupId).toBe(PORT_RECORD_MAX_ID);
		expect(openFabStationProposalReviewedPlanArtifactShapeError(artifact)).toBeNull();

		const portOverflow = buildInput(simpleSeeds(), {
			sourceNextPortId: PORT_RECORD_MAX_ID,
		});
		await expectCode(encode(portOverflow), "PLAN_ID_SEQUENCE_MISMATCH");
		const groupOverflow = buildInput([ohbSeed(cardinal(0, 0)), ohbSeed(cardinal(1, 0))], {
			sourceNextEquipmentGroupId: PORT_RECORD_MAX_ID,
		});
		await expectCode(encode(groupOverflow), "PLAN_ID_SEQUENCE_MISMATCH");
	});

	it("detects scalar, column, CSR, and fingerprint tampering", async () => {
		const scalar = mutableArtifact(await encodeSimple());
		scalar.baseRevision++;
		expect(openFabStationProposalReviewedPlanArtifactShapeError(scalar)).toBe(
			"ARTIFACT_FINGERPRINT_MISMATCH",
		);

		const column = mutableArtifact(await encodeSimple());
		column.routeXs[0] = (column.routeXs[0] as number) + 1;
		expect(openFabStationProposalReviewedPlanArtifactShapeError(column)).toBe(
			"ARTIFACT_FINGERPRINT_MISMATCH",
		);

		const sentinel = mutableArtifact(await encodeSimple());
		sentinel.routeSwitchIds[0] = 1;
		expect(openFabStationProposalReviewedPlanArtifactShapeError(sentinel)).toBe(
			"ARTIFACT_VALUE_MISMATCH",
		);

		const csr = mutableArtifact(await encodeSimple());
		csr.groupPortOffsets[1] = 0;
		expect(openFabStationProposalReviewedPlanArtifactShapeError(csr)).toBe("ARTIFACT_CSR_MISMATCH");

		const fingerprint = mutableArtifact(await encodeSimple());
		fingerprint.fingerprint = `${fingerprint.fingerprint.slice(0, -1)}${
			fingerprint.fingerprint.endsWith("0") ? "1" : "0"
		}`;
		expect(openFabStationProposalReviewedPlanArtifactShapeError(fingerprint)).toBe(
			"ARTIFACT_FINGERPRINT_MISMATCH",
		);

		const advancedUnused = mutableArtifact(
			await encode(buildInput([ohbSeed(advanced(1, "B", "THROAT", null, 7))])),
		);
		advancedUnused.routeXs[0] = 1;
		expect(openFabStationProposalReviewedPlanArtifactShapeError(advancedUnused)).toBe(
			"ARTIFACT_VALUE_MISMATCH",
		);

		const throatSentinel = mutableArtifact(
			await encode(buildInput([ohbSeed(advanced(1, "B", "THROAT", null, 7))])),
		);
		throatSentinel.routePortIndices[0] = 0;
		expect(openFabStationProposalReviewedPlanArtifactShapeError(throatSentinel)).toBe(
			"ARTIFACT_VALUE_MISMATCH",
		);
	});

	it("rejects subclasses, shadows, partial/aliased/detached/shared/resizable buffers", async () => {
		class HostileUint8Array extends Uint8Array {}
		const subclass = mutableArtifact(await encodeSimple());
		subclass.routeKinds = new HostileUint8Array(subclass.routeKinds);
		expect(openFabStationProposalReviewedPlanArtifactShapeError(subclass)).toBe(
			"ARTIFACT_TYPED_ARRAY_MISMATCH",
		);

		const shadow = mutableArtifact(await encodeSimple());
		Object.defineProperty(shadow.routeKinds, Symbol.iterator, {
			value: Uint8Array.prototype[Symbol.iterator],
		});
		expect(openFabStationProposalReviewedPlanArtifactShapeError(shadow)).toBe(
			"ARTIFACT_BUFFER_OWNERSHIP_MISMATCH",
		);

		const partial = mutableArtifact(await encodeSimple());
		partial.routeKinds = new Uint8Array(
			new ArrayBuffer(partial.routeKinds.byteLength + 2),
			1,
			partial.routeKinds.length,
		);
		expect(openFabStationProposalReviewedPlanArtifactShapeError(partial)).toBe(
			"ARTIFACT_BUFFER_OWNERSHIP_MISMATCH",
		);

		const alias = mutableArtifact(await encodeSimple());
		alias.routeKinds = new Uint8Array(alias.sides.buffer);
		expect(openFabStationProposalReviewedPlanArtifactShapeError(alias)).toBe(
			"ARTIFACT_BUFFER_OWNERSHIP_MISMATCH",
		);

		const detached = mutableArtifact(await encodeSimple());
		structuredClone(detached.routeKinds.buffer, { transfer: [detached.routeKinds.buffer] });
		expect(openFabStationProposalReviewedPlanArtifactShapeError(detached)).not.toBeNull();

		if (typeof SharedArrayBuffer !== "undefined") {
			const shared = mutableArtifact(await encodeSimple());
			shared.routeKinds = new Uint8Array(
				new SharedArrayBuffer(shared.routeKinds.byteLength),
			) as unknown as Uint8Array<ArrayBuffer>;
			expect(openFabStationProposalReviewedPlanArtifactShapeError(shared)).toBe(
				"ARTIFACT_BUFFER_OWNERSHIP_MISMATCH",
			);
		}

		const ResizableArrayBuffer = ArrayBuffer as typeof ArrayBuffer & {
			new (byteLength: number, options: { maxByteLength: number }): ArrayBuffer;
		};
		let resizableBuffer: ArrayBuffer | null = null;
		try {
			resizableBuffer = new ResizableArrayBuffer(2, {
				maxByteLength: 3,
			});
		} catch {
			// The runtime does not expose resizable ArrayBuffer construction.
		}
		const resizableGetter = Object.getOwnPropertyDescriptor(
			ArrayBuffer.prototype,
			"resizable",
		)?.get;
		if (resizableBuffer !== null && resizableGetter?.call(resizableBuffer) === true) {
			const resizable = mutableArtifact(await encodeSimple());
			resizable.routeKinds = new Uint8Array(resizableBuffer);
			Object.defineProperty(resizableBuffer, "resizable", { value: false });
			expect(openFabStationProposalReviewedPlanArtifactShapeError(resizable)).toBe(
				"ARTIFACT_BUFFER_OWNERSHIP_MISMATCH",
			);
		}
	});

	it("captures one artifact identity against alternating Proxy reads", async () => {
		const source = mutableArtifact(await encodeSimple());
		const rogue = new Uint8Array(source.routeKinds.length);
		let getCalls = 0;
		const descriptors = new Map<PropertyKey, number>();
		const proxy = new Proxy(source, {
			get(target, key, receiver) {
				getCalls++;
				if (key === "routeKinds") return rogue;
				return Reflect.get(target, key, receiver);
			},
			getOwnPropertyDescriptor(target, key) {
				descriptors.set(key, (descriptors.get(key) ?? 0) + 1);
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});

		const transfers = collectOpenFabStationProposalReviewedPlanArtifactTransfers(proxy);
		expect(getCalls).toBe(0);
		expect(transfers[0]).toBe(source.routeKinds.buffer);
		expect(transfers[0]).not.toBe(rogue.buffer);
		expect([...descriptors.values()].every((count) => count === 1)).toBe(true);
	});

	it("adopts private ownership and enforces one-shot opaque release", async () => {
		const syncSource = await encodeSimple();
		const syncHandle = adoptOpenFabStationProposalReviewedPlanArtifact(syncSource);
		expect(syncSource.routeKinds.byteLength).toBe(0);
		expect(() =>
			releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer({ ...syncHandle }),
		).toThrow("ARTIFACT_CONTRACT_MISMATCH");
		const syncReleased =
			releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer(syncHandle);
		expect(syncReleased.transfers).toHaveLength(
			OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT,
		);
		expect(() =>
			releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer(syncHandle),
		).toThrow("ARTIFACT_CONTRACT_MISMATCH");

		const releaseSource = await encodeSimple();
		const releaseHandle = await adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(
			releaseSource,
			NOOP_OPTIONS,
		);
		expect(releaseSource.routeKinds.byteLength).toBe(0);
		const released =
			releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer(releaseHandle);
		expect(released.transfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT);
		expect(() =>
			releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer(releaseHandle),
		).toThrow("ARTIFACT_CONTRACT_MISMATCH");
	});

	it("cancels on real abort and revision change with fixed redacted failures", async () => {
		const controller = new AbortController();
		let ticks = 0;
		const aborting = encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
			buildInput(allCodeSeeds()),
			{
				checkpoint: async () => {
					controller.abort();
				},
				revision: () => 0,
				signal: controller.signal,
				now: () => ++ticks,
				sliceMilliseconds: 1,
			},
		);
		await expect(aborting).rejects.toMatchObject({
			name: "AbortError",
			message: "OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_ABORTED",
		});

		let revision = 0;
		ticks = 0;
		const changing = encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
			buildInput(allCodeSeeds()),
			{
				checkpoint: async () => {
					revision++;
				},
				revision: () => revision,
				now: () => ++ticks,
				sliceMilliseconds: 1,
			},
		);
		await expect(changing).rejects.toMatchObject({ name: "AbortError" });
	});

	it("requires recursive immutability before any caller checkpoint can change an unprocessed row", async () => {
		const mutable = mutableInput(buildInput(allCodeSeeds()));
		let mutableCheckpointCalls = 0;
		let mutableTicks = 0;
		await expectCode(
			encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
				mutable as unknown as OpenFabStationProposalReviewedPlanEncodeInput,
				{
					checkpoint: async () => {
						mutableCheckpointCalls++;
						setPort(mutable, mutable.plan.portMutations.length - 1, {
							stationMillimeters: 9_999,
						});
					},
					revision: () => 0,
					now: () => ++mutableTicks,
					sliceMilliseconds: 1,
				},
			),
			"PLAN_INPUT_NOT_IMMUTABLE",
		);
		expect(mutableCheckpointCalls).toBe(0);

		const immutable = buildInput(allCodeSeeds());
		const lastPort = immutable.plan.portMutations.at(-1)?.after as PortRecord;
		let immutableCheckpointCalls = 0;
		let immutableTicks = 0;
		const artifact = await encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
			immutable,
			{
				checkpoint: async () => {
					immutableCheckpointCalls++;
					expect(Reflect.set(lastPort, "stationMillimeters", 9_999)).toBe(false);
				},
				revision: () => 0,
				now: () => ++immutableTicks,
				sliceMilliseconds: 1,
			},
		);
		expect(immutableCheckpointCalls).toBeGreaterThan(0);
		expect(openFabStationProposalReviewedPlanArtifactShapeError(artifact)).toBeNull();
		expect(artifact.reviewFingerprint).toBe(immutable.reviewFingerprint);
	});

	it("redacts forged AbortError and hostile error/getter surfaces", async () => {
		let errorGetterCalls = 0;
		const hostile = Object.create(null) as Record<string, unknown>;
		Object.defineProperties(hostile, {
			name: {
				get: () => {
					errorGetterCalls++;
					return "AbortError";
				},
			},
			message: {
				get: () => {
					errorGetterCalls++;
					return "secret";
				},
			},
		});
		let ticks = 0;
		await expectCode(
			encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(buildInput(allCodeSeeds()), {
				checkpoint: async () => Promise.reject(hostile),
				revision: () => 0,
				now: () => ++ticks,
				sliceMilliseconds: 1,
			}),
			"ENCODE_FAILED",
		);
		expect(errorGetterCalls).toBe(0);

		let optionGetterCalls = 0;
		const options = Object.create(null);
		Object.defineProperty(options, "checkpoint", {
			enumerable: true,
			get() {
				optionGetterCalls++;
				return async () => {};
			},
		});
		Object.defineProperty(options, "revision", { enumerable: true, value: () => 0 });
		await expectCode(
			encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
				buildInput(simpleSeeds()),
				options,
			),
			"INVALID_COOPERATIVE_OPTIONS",
		);
		expect(optionGetterCalls).toBe(0);

		await expectCode(
			encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(buildInput(simpleSeeds()), {
				checkpoint: async () => {},
				revision: () => 0,
				sliceMilliseconds: 4.01,
			}),
			"INVALID_COOPERATIVE_OPTIONS",
		);

		let signalGetterCalls = 0;
		const hostileSignal = Object.create(null) as AbortSignal;
		Object.defineProperty(hostileSignal, "aborted", {
			get() {
				signalGetterCalls++;
				return true;
			},
		});
		await expectCode(
			encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(buildInput(simpleSeeds()), {
				checkpoint: async () => {},
				revision: () => 0,
				signal: hostileSignal,
			}),
			"ENCODE_FAILED",
		);
		expect(signalGetterCalls).toBe(0);

		await expectCode(
			encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(buildInput(simpleSeeds()), {
				checkpoint: async () => {},
				revision: () => 0,
				now: () => {
					throw hostile;
				},
			}),
			"ENCODE_FAILED",
		);
		expect(errorGetterCalls).toBe(0);
	});

	it("transfers privately before cooperative adoption validation and remains terminal on cancel", async () => {
		const preTransfer = await encodeSimple();
		const alreadyAborted = new AbortController();
		alreadyAborted.abort();
		await expect(
			adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(preTransfer, {
				checkpoint: async () => {},
				revision: () => 0,
				signal: alreadyAborted.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(preTransfer.routeKinds.byteLength).toBeGreaterThan(0);

		const descriptorAbortSource = await encodeSimple();
		const descriptorAbortController = new AbortController();
		let descriptorCalls = 0;
		const descriptorAbortProxy = new Proxy(descriptorAbortSource, {
			getOwnPropertyDescriptor(target, key) {
				descriptorCalls++;
				descriptorAbortController.abort();
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});
		await expect(
			adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(descriptorAbortProxy, {
				checkpoint: async () => {},
				revision: () => 0,
				signal: descriptorAbortController.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(descriptorCalls).toBeGreaterThan(0);
		const retainedTransfers =
			collectOpenFabStationProposalReviewedPlanArtifactTransfers(descriptorAbortSource);
		expect(retainedTransfers).toHaveLength(OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_BUFFER_COUNT);
		expect(retainedTransfers.every((buffer) => buffer.byteLength > 0)).toBe(true);

		const source = mutableArtifact(await encodeSimple());
		source.routeXs[0] = (source.routeXs[0] as number) + 1;
		let checkpoints = 0;
		await expectCode(
			adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(source, {
				checkpoint: async () => {
					checkpoints++;
				},
				revision: () => 0,
			}),
			"ARTIFACT_FINGERPRINT_MISMATCH",
		);
		expect(checkpoints).toBeGreaterThan(0);
		expect(source.routeKinds.byteLength).toBe(0);

		const cancelled = await encodeSimple();
		const controller = new AbortController();
		await expect(
			adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(cancelled, {
				checkpoint: async () => controller.abort(),
				revision: () => 0,
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(cancelled.routeKinds.byteLength).toBe(0);

		const revisionSource = await encodeSimple();
		let revision = 0;
		await expect(
			adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(revisionSource, {
				checkpoint: async () => {
					revision++;
				},
				revision: () => revision,
			}),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(revisionSource.routeKinds.byteLength).toBe(0);
	});

	it.skipIf(!RUN_SCALE)(
		"encodes and cooperatively adopts 100k/100k in exactly 3,500,004 bytes",
		async () => {
			if (!NODE_PROCESS) throw new Error("NODE_PROCESS_REQUIRED_FOR_SCALE_MEASUREMENT");
			const rssBefore = NODE_PROCESS.memoryUsage().rss;
			const inputPreparationStartedAt = performance.now();
			const input = buildInput(scaleSeeds(100_000), {
				sourceNextPortId: 1,
				sourceNextEquipmentGroupId: 1,
			});
			const inputPreparationElapsedMilliseconds = performance.now() - inputPreparationStartedAt;
			expect(inputPreparationElapsedMilliseconds).toBeLessThan(5_000);
			let encodeCheckpoints = 0;
			let encodeActiveSliceStartedAt = performance.now();
			let encodeMaxActiveGapMilliseconds = 0;
			const encodeStartedAt = encodeActiveSliceStartedAt;
			const artifact = await encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(input, {
				checkpoint: async () => {
					const checkpointAt = performance.now();
					encodeMaxActiveGapMilliseconds = Math.max(
						encodeMaxActiveGapMilliseconds,
						checkpointAt - encodeActiveSliceStartedAt,
					);
					encodeCheckpoints++;
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
					encodeActiveSliceStartedAt = performance.now();
				},
				revision: () => 0,
				sliceMilliseconds: 4,
			});
			const encodeFinishedAt = performance.now();
			encodeMaxActiveGapMilliseconds = Math.max(
				encodeMaxActiveGapMilliseconds,
				encodeFinishedAt - encodeActiveSliceStartedAt,
			);
			expect(artifact).toMatchObject({
				portCount: 100_000,
				groupCount: 100_000,
				byteLength: 3_500_004,
			});
			expect(artifact.byteLength).toBeLessThan(OPENFAB_STATION_PROPOSAL_REVIEWED_PLAN_MAX_BYTES);
			expect(collectOpenFabStationProposalReviewedPlanArtifactTransfers(artifact)).toHaveLength(16);
			expect(encodeCheckpoints).toBeGreaterThan(0);

			let adoptCheckpoints = 0;
			let adoptActiveSliceStartedAt = performance.now();
			let adoptMaxActiveGapMilliseconds = 0;
			const adoptStartedAt = adoptActiveSliceStartedAt;
			const handle = await adoptOpenFabStationProposalReviewedPlanArtifactCooperatively(artifact, {
				checkpoint: async () => {
					const checkpointAt = performance.now();
					adoptMaxActiveGapMilliseconds = Math.max(
						adoptMaxActiveGapMilliseconds,
						checkpointAt - adoptActiveSliceStartedAt,
					);
					adoptCheckpoints++;
					await new Promise<void>((resolve) => setTimeout(resolve, 0));
					adoptActiveSliceStartedAt = performance.now();
				},
				revision: () => 0,
				sliceMilliseconds: 4,
			});
			const adoptFinishedAt = performance.now();
			adoptMaxActiveGapMilliseconds = Math.max(
				adoptMaxActiveGapMilliseconds,
				adoptFinishedAt - adoptActiveSliceStartedAt,
			);
			expect(adoptCheckpoints).toBeGreaterThan(0);
			expect(encodeMaxActiveGapMilliseconds).toBeLessThan(50);
			expect(adoptMaxActiveGapMilliseconds).toBeLessThan(50);
			const released = releaseAdoptedOpenFabStationProposalReviewedPlanArtifactTransfer(handle);
			expect(released.transfers).toHaveLength(16);
			const rssDelta = NODE_PROCESS.memoryUsage().rss - rssBefore;
			expect(rssDelta).toBeLessThan(768 * 1024 * 1024);
			console.info(
				JSON.stringify({
					inputPreparationElapsedMilliseconds,
					encodeElapsedMilliseconds: encodeFinishedAt - encodeStartedAt,
					encodeCheckpoints,
					encodeMaxActiveGapMilliseconds,
					adoptElapsedMilliseconds: adoptFinishedAt - adoptStartedAt,
					adoptCheckpoints,
					adoptMaxActiveGapMilliseconds,
					rssBefore,
					rssDelta,
					byteLength: released.artifact.byteLength,
				}),
			);
		},
		60_000,
	);
});

function trapGets(note: () => void): ProxyHandler<object> {
	return {
		get(target, key, receiver) {
			note();
			return Reflect.get(target, key, receiver);
		},
	};
}

function cardinal(
	x: number,
	z: number,
	from: 0 | Direction = DIR_W,
	to: 0 | Direction = DIR_E,
): PortRouteIdentity {
	return Object.freeze({ kind: "CARDINAL_CELL", x, z, from, to });
}

function advanced(
	switchId: number,
	profileClass: "A" | "B" | "C" | "D",
	role: "INPUT" | "THROAT" | "OUTPUT",
	portIndex: 0 | 1 | null,
	segmentOrdinal: number,
): PortRouteIdentity {
	return Object.freeze({
		kind: "ADVANCED_SWITCH_SEGMENT",
		switchId,
		profileClass,
		role,
		portIndex,
		segmentOrdinal,
	});
}

function portSeed(route: PortRouteIdentity, overrides: Omit<PortSeed, "route"> = {}): PortSeed {
	return Object.freeze({ route, ...overrides });
}

function ohbSeed(route: PortRouteIdentity, overrides: Omit<PortSeed, "route"> = {}): GroupSeed {
	return Object.freeze({ kind: "OHB", ports: Object.freeze([portSeed(route, overrides)]) });
}

function eqSeed(pitchMillimeters: number, x: number): GroupSeed {
	return Object.freeze({
		kind: "EQ",
		pitchMillimeters,
		ports: Object.freeze([portSeed(cardinal(x, 0)), portSeed(cardinal(x + 1, 0))]),
	});
}

function stkSeed(template: StkAuthoringTemplate, x: number, count: number): GroupSeed {
	return Object.freeze({
		kind: "STK",
		template,
		ports: Object.freeze(
			Array.from({ length: count }, (_, index) => portSeed(cardinal(x + index, 10))),
		),
	});
}

function backToBackSeed(x: number): GroupSeed {
	return Object.freeze({
		kind: "STK",
		template: "BACK_TO_BACK",
		ports: Object.freeze([
			portSeed(cardinal(x, 20)),
			portSeed(cardinal(x + 1, 20)),
			portSeed(cardinal(x + 1, 22, DIR_E, DIR_W)),
			portSeed(cardinal(x, 22, DIR_E, DIR_W)),
		]),
	});
}

function simpleSeeds(): readonly GroupSeed[] {
	return Object.freeze([eqSeed(1_000, 0)]);
}

function allCodeSeeds(): readonly GroupSeed[] {
	return Object.freeze([
		ohbSeed(advanced(1, "A", "INPUT", 0, 0), {
			side: "LEFT",
			lateralOffsetMillimeters: 100_000,
			stationMillimeters: 100_000,
		}),
		ohbSeed(advanced(2, "B", "THROAT", null, 0xffff), {
			side: "RIGHT",
			lateralOffsetMillimeters: 1,
			direction: "AGAINST_TRAVEL",
		}),
		ohbSeed(advanced(PORT_RECORD_MAX_ID, "C", "OUTPUT", 1, 2)),
		ohbSeed(advanced(4, "D", "INPUT", 1, 3)),
		ohbSeed(cardinal(-0x8000_0000, 0x7fff_ffff, 0, DIR_N)),
		eqSeed(1_000, -100),
		eqSeed(2_000, -90),
		eqSeed(3_000, -80),
		eqSeed(4_000, -70),
		eqSeed(5_000, -60),
		stkSeed("FLEX", 0, 1),
		stkSeed("FOUR_PORT", 10, 4),
		stkSeed("SIX_PORT", 20, 6),
		backToBackSeed(30),
	]);
}

function scaleSeeds(count: number): readonly GroupSeed[] {
	return Array.from({ length: count }, (_, index) => ohbSeed(cardinal(index, 0)));
}

function buildInput(
	seeds: readonly GroupSeed[],
	options: Readonly<{
		sourceNextPortId?: number;
		sourceNextEquipmentGroupId?: number;
	}> = {},
): OpenFabStationProposalReviewedPlanEncodeInput {
	const sourceNextPortId = options.sourceNextPortId ?? 100;
	const sourceNextEquipmentGroupId = options.sourceNextEquipmentGroupId ?? 500;
	const portMutations: PortMutation[] = [];
	const groupMutations: EquipmentGroupMutation[] = [];
	for (let groupIndex = 0; groupIndex < seeds.length; groupIndex++) {
		const seed = seeds[groupIndex] as GroupSeed;
		const groupId = sourceNextEquipmentGroupId + groupIndex;
		const portIds: number[] = [];
		for (let memberIndex = 0; memberIndex < seed.ports.length; memberIndex++) {
			const portSeedValue = seed.ports[memberIndex] as PortSeed;
			const portId = sourceNextPortId + portMutations.length;
			portIds.push(portId);
			const port: PortRecord = Object.freeze({
				id: portId,
				equipmentGroupId: groupId,
				route: portSeedValue.route,
				stationMillimeters: portSeedValue.stationMillimeters ?? 0,
				side: portSeedValue.side ?? "CENTER",
				lateralOffsetMillimeters: portSeedValue.lateralOffsetMillimeters ?? 0,
				direction: portSeedValue.direction ?? "WITH_TRAVEL",
				portType: seed.kind,
				barcode: equipmentGroupPortBarcode(seed.kind, groupId, portId, memberIndex),
			});
			portMutations.push(Object.freeze({ id: portId, before: null, after: port }));
		}
		const frozenPortIds = Object.freeze(portIds);
		const group: EquipmentGroupRecord =
			seed.kind === "OHB"
				? Object.freeze({ id: groupId, kind: "OHB", template: "SINGLE", portIds: frozenPortIds })
				: seed.kind === "EQ"
					? Object.freeze({
							id: groupId,
							kind: "EQ",
							pitchMillimeters: seed.pitchMillimeters,
							recipe: null,
							portIds: frozenPortIds,
						})
					: Object.freeze({
							id: groupId,
							kind: "STK",
							template: seed.template,
							portIds: frozenPortIds,
						});
		groupMutations.push(Object.freeze({ id: groupId, before: null, after: group }));
	}
	const kindSet = new Set(seeds.map((seed) => seed.kind));
	const kind =
		kindSet.size > 1
			? PORT_EQUIPMENT_BATCH_PLAN_KIND
			: kindSet.has("OHB")
				? "place-ohb"
				: kindSet.has("STK")
					? "place-stk"
					: "place-eq";
	return Object.freeze({
		plan: createPortEquipmentMutationPlanWithImmutableGraphCertificate(
			kind,
			17,
			29,
			portMutations,
			groupMutations,
		),
		sourceRevision: 17,
		sourcePatchSequence: 29,
		sourceNextPortId,
		sourceNextEquipmentGroupId,
		reviewFingerprint: REVIEW_FINGERPRINT,
	});
}

type MutableRecord = Record<string, unknown>;
type MutablePlan = {
	kind: PortEquipmentMutationPlan["kind"];
	valid: boolean;
	reason: string;
	baseRevision: number;
	basePatchSequence: number;
	portMutations: MutableRecord[];
	equipmentGroupMutations: MutableRecord[];
};
type MutableInput = {
	plan: MutablePlan;
	sourceRevision: number;
	sourcePatchSequence: number;
	sourceNextPortId: number;
	sourceNextEquipmentGroupId: number;
	reviewFingerprint: string;
};

function mutableInput(input: OpenFabStationProposalReviewedPlanEncodeInput): MutableInput {
	return structuredClone(input) as unknown as MutableInput;
}

function mutableArtifact(artifact: OpenFabStationProposalReviewedPlanArtifact): MutableArtifact {
	return structuredClone(artifact) as MutableArtifact;
}

type MutableArtifact = {
	-readonly [Key in keyof OpenFabStationProposalReviewedPlanArtifact]: OpenFabStationProposalReviewedPlanArtifact[Key];
} & Record<string, unknown>;

function setPortMutation(input: MutableInput, index: number, patch: MutableRecord): void {
	Object.assign(input.plan.portMutations[index] as MutableRecord, patch);
}

function setGroupMutation(input: MutableInput, index: number, patch: MutableRecord): void {
	Object.assign(input.plan.equipmentGroupMutations[index] as MutableRecord, patch);
}

function setPort(input: MutableInput, index: number, patch: MutableRecord): void {
	Object.assign((input.plan.portMutations[index] as MutableRecord).after as MutableRecord, patch);
}

function setGroup(input: MutableInput, index: number, patch: MutableRecord): void {
	Object.assign(
		(input.plan.equipmentGroupMutations[index] as MutableRecord).after as MutableRecord,
		patch,
	);
}

function swapEqMembership(input: MutableInput): void {
	const group = (input.plan.equipmentGroupMutations[0] as MutableRecord).after as MutableRecord;
	const ids = group.portIds as number[];
	[ids[0], ids[1]] = [ids[1] as number, ids[0] as number];
}

function encode(
	input: OpenFabStationProposalReviewedPlanEncodeInput | MutableInput,
): Promise<OpenFabStationProposalReviewedPlanArtifact> {
	return encodeOpenFabStationProposalReviewedPlanArtifactCooperatively(
		input as OpenFabStationProposalReviewedPlanEncodeInput,
		NOOP_OPTIONS,
	);
}

function encodeSimple(): Promise<OpenFabStationProposalReviewedPlanArtifact> {
	return encode(buildInput(simpleSeeds()));
}

function certifyMutableInput(input: MutableInput): OpenFabStationProposalReviewedPlanEncodeInput {
	freezeOwnDataGraphForTest(input.plan.portMutations, new WeakSet<object>());
	freezeOwnDataGraphForTest(input.plan.equipmentGroupMutations, new WeakSet<object>());
	const plan = createPortEquipmentMutationPlanWithImmutableGraphCertificate(
		input.plan.kind,
		input.plan.baseRevision,
		input.plan.basePatchSequence,
		input.plan.portMutations as unknown as readonly PortMutation[],
		input.plan.equipmentGroupMutations as unknown as readonly EquipmentGroupMutation[],
	);
	return Object.freeze({
		plan,
		sourceRevision: input.sourceRevision,
		sourcePatchSequence: input.sourcePatchSequence,
		sourceNextPortId: input.sourceNextPortId,
		sourceNextEquipmentGroupId: input.sourceNextEquipmentGroupId,
		reviewFingerprint: input.reviewFingerprint,
	});
}

function freezeOwnDataGraphForTest(value: unknown, visited: WeakSet<object>): void {
	if (value === null || typeof value !== "object" || visited.has(value)) return;
	visited.add(value);
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor)) {
			throw new Error("TEST_GRAPH_MUST_CONTAIN_ONLY_DATA_PROPERTIES");
		}
		freezeOwnDataGraphForTest(descriptor.value, visited);
	}
	Object.freeze(value);
}

async function expectCode(promise: Promise<unknown>, code: string, label?: string): Promise<void> {
	try {
		await promise;
		expect.fail(`${label ?? code}: expected rejection`);
	} catch (error) {
		expect(error, label).toMatchObject({ code, message: code });
	}
}
