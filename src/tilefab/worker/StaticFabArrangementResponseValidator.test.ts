import { describe, expect, it } from "vitest";
import {
	resolveStaticFabSelectionArrangementRoots,
	staticFabArrangementCommandFromRoots,
} from "../compile/StaticFabArrangementRoots";
import type { AdvancedSwitchRecord } from "../core/AdvancedSwitch";
import { emptyPortEquipmentState } from "../core/EquipmentGroup";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { PortRecord } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { createRailAreaSelectionFromOwnerships } from "../core/RailAreaSelection";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import { DIR_E, DIR_N } from "../core/railShape";
import { staticFabArrangementPlanFingerprint } from "../core/StaticFabArrangementCertification";
import { staticFabArrangementCommandFingerprint } from "../core/StaticFabArrangementCommand";
import type { StaticFabArrangementPlan } from "../core/StaticFabArrangementPlan";
import {
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationRecord,
} from "../core/StaticFabOrganization";
import { createStaticFabSelection } from "../core/StaticFabSelection";
import { encodeRailCell, TileMap } from "../core/TileMap";
import { captureRailMirrorSnapshot, checksumRailMap } from "./RailMirrorChecksum";
import {
	type PreparedStaticFabArrangement,
	STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
} from "./StaticFabArrangementProtocol";
import {
	STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS,
	STATIC_FAB_ARRANGEMENT_MAX_RESPONSE_TEXT,
	staticFabArrangementPreparedShapeError,
} from "./StaticFabArrangementResponseValidator";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
} from "./StaticFabArrangementRuntime";

describe("StaticFabArrangementResponseValidator", () => {
	it("accepts one exact existing-ID relocation response", () => {
		expect(staticFabArrangementPreparedShapeError(validPreparedArrangement())).toBeNull();
	});

	it("accepts canonical RailChecksumAccumulator digests from snapshots and prospective maps", () => {
		const value = mutablePreparedArrangement();
		const ticket = requireTicket(value);
		const source = new TileMap();
		ticket.sourceChecksum = captureRailMirrorSnapshot(source, 0).snapshot.checksum;
		const prospective = source.clone();
		prospective.applyAtomicMutations(
			[
				{
					x: 0,
					y: 0,
					before: 0,
					after: encodeRailCell({ incoming: 0, outgoing: DIR_E }),
				},
				{
					x: 1,
					y: 0,
					before: 0,
					after: encodeRailCell({ incoming: 8, outgoing: 0 }),
				},
			],
			[],
		);
		ticket.prospectiveChecksum = checksumRailMap(prospective);

		expect(ticket.sourceChecksum.split(":"), ticket.sourceChecksum).toHaveLength(12);
		expect(ticket.prospectiveChecksum.split(":"), ticket.prospectiveChecksum).toHaveLength(12);
		expect(staticFabArrangementPreparedShapeError(value)).toBeNull();
	});

	it("accepts an exact success produced by the current arrangement runtime", () => {
		const map = new TileMap();
		addLine(map, { x: 0, y: 0 }, { x: 8, y: 0 });
		addLine(map, { x: 20, y: 10 }, { x: 28, y: 10 });
		const portEquipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const patchSequence = 17;
		const ownership = buildRailModuleOwnershipIndex(map);
		const rail = createRailAreaSelectionFromOwnerships(
			ownership,
			ownership.modules,
			"fully-contained",
		);
		const selection = createStaticFabSelection(rail, portEquipment, patchSequence, []);
		const roots = resolveStaticFabSelectionArrangementRoots(
			map,
			ownership,
			portEquipment,
			patchSequence,
			selection,
		);
		if (!roots.valid) throw new Error(roots.reason);
		const intent = staticFabArrangementCommandFromRoots("Z", "ALIGN_MIN", roots.roots);
		const snapshot = captureRailMirrorSnapshot(
			map,
			patchSequence,
			portEquipment,
			organizations,
		).snapshot;
		const session = initializeStaticFabArrangementRuntimeSession(snapshot).session;
		const result = prepareStaticFabArrangementInSession(session, {
			type: "PREPARE_STATIC_FAB_ARRANGEMENT",
			version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
			sessionId: 1,
			requestId: 77,
			ticketId: 77,
			intent,
			expectedIntentFingerprint: staticFabArrangementCommandFingerprint(intent),
		}).prepared;

		expect(result.valid, result.reason).toBe(true);
		expect(staticFabArrangementPreparedShapeError(result)).toBeNull();
	});

	it.each([
		null,
		[],
		"response",
		{ valid: true },
	])("rejects malformed prepared payload %j", (value) => {
		expect(staticFabArrangementPreparedShapeError(value)).not.toBeNull();
	});

	it("bounds response text, conflict samples, and plan cells before traversal", () => {
		const oversizedText = mutablePreparedArrangement();
		oversizedText.reason = "x".repeat(STATIC_FAB_ARRANGEMENT_MAX_RESPONSE_TEXT + 1);
		expectError(oversizedText, "text budget");

		const oversizedConflicts = mutablePreparedArrangement();
		oversizedConflicts.valid = false;
		oversizedConflicts.failureCode = "clearance";
		oversizedConflicts.ticket = null;
		oversizedConflicts.plan = null;
		oversizedConflicts.conflictCells = Array.from({ length: 513 }, (_, index) => ({
			x: index,
			y: 0,
		}));
		oversizedConflicts.conflictCount = 513;
		expectError(oversizedConflicts, "budget");

		const oversizedCells = mutablePreparedArrangement();
		const plan = requirePlan(oversizedCells);
		plan.cells = new Array(STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS + 1);
		expectError(oversizedCells, "budget");
	});

	it("rejects sparse, duplicate, and non-canonical coordinate arrays", () => {
		const sparse = mutablePreparedArrangement();
		sparse.conflictCells = new Array(1);
		sparse.conflictCount = 1;
		expectError(sparse, "invalid coordinate");

		const duplicate = mutablePreparedArrangement();
		const plan = requirePlan(duplicate);
		plan.cells = [
			plan.cells[0] as DeepMutable<(typeof plan.cells)[number]>,
			plan.cells[0] as DeepMutable<(typeof plan.cells)[number]>,
		];
		expectError(duplicate, "canonical");

		const unsorted = mutablePreparedArrangement();
		const unsortedPlan = requirePlan(unsorted);
		unsortedPlan.cells = [...unsortedPlan.cells].reverse();
		expectError(unsorted, "canonical");
	});

	it("accepts only mutation-free, metadata-free compact rejection plans", () => {
		const compact = compactRejectedArrangement();
		expect(staticFabArrangementPreparedShapeError(compact)).toBeNull();

		const withMutation = compactRejectedArrangement();
		const plan = requireRejectedPlan(withMutation);
		plan.mutations = [
			{ x: 10, y: 0, before: 0, after: encodeRailCell({ incoming: 0, outgoing: DIR_E }) },
		];
		expectError(withMutation, "authored mutations");

		const withMetadata = compactRejectedArrangement();
		const metadataPlan = requireRejectedPlan(withMetadata);
		metadataPlan.arrangement = mutablePreparedArrangement().plan?.arrangement ?? null;
		expectError(withMetadata, "metadata");

		const withTicket = compactRejectedArrangement();
		withTicket.ticket = mutablePreparedArrangement().ticket;
		expectError(withTicket, "ticket");
	});

	it("rejects additions, removals, and ID replacement in existing records", () => {
		const removedSwitch = mutablePreparedArrangement();
		const removedSwitchPlan = requirePlan(removedSwitch);
		const switchMutation = removedSwitchPlan.switchMutations[0];
		if (!switchMutation) throw new Error("Expected switch mutation.");
		switchMutation.after = null;
		expectError(removedSwitch, "preserve an existing record");

		const replacedPort = mutablePreparedArrangement();
		const replacedPortPlan = requirePlan(replacedPort);
		const portMutation = replacedPortPlan.portMutations[0];
		if (!portMutation?.after) throw new Error("Expected port mutation.");
		portMutation.after.id = 2;
		expectError(replacedPort, "existing ID");

		const addedOrganization = mutablePreparedArrangement();
		const addedOrganizationPlan = requirePlan(addedOrganization);
		const organizationMutation = addedOrganizationPlan.organizationMutations[0];
		if (!organizationMutation) throw new Error("Expected organization mutation.");
		organizationMutation.before = null;
		expectError(addedOrganization, "preserve an existing record");

		const equipmentMutation = mutablePreparedArrangement();
		const equipmentPlan = requirePlan(equipmentMutation);
		equipmentPlan.equipmentGroupMutations = [{ id: 1, before: null, after: null }];
		expectError(equipmentMutation, "mutation budget");
	});

	it("rejects semantic changes hidden inside same-ID switch, port, and organization records", () => {
		const switchProfile = mutablePreparedArrangement();
		const switchPlan = requirePlan(switchProfile);
		const switchAfter = switchPlan.switchMutations[0]?.after;
		if (!switchAfter) throw new Error("Expected switch mutation.");
		switchAfter.profileClass = "B";
		expectError(switchProfile, "more than its origin");

		const portBarcode = mutablePreparedArrangement();
		const portPlan = requirePlan(portBarcode);
		const portAfter = portPlan.portMutations[0]?.after;
		if (!portAfter) throw new Error("Expected port mutation.");
		portAfter.barcode = "PORT-CHANGED";
		expectError(portBarcode, "more than its cardinal route position");

		const organizationName = mutablePreparedArrangement();
		const organizationPlan = requirePlan(organizationName);
		const organizationAfter = organizationPlan.organizationMutations[0]?.after;
		if (!organizationAfter) throw new Error("Expected organization mutation.");
		organizationAfter.name = "Changed Bay";
		expectError(organizationName, "immutable metadata");
	});

	it("requires moved records to use one declared root translation", () => {
		const value = mutablePreparedArrangement();
		const plan = requirePlan(value);
		const portAfter = plan.portMutations[0]?.after;
		if (!portAfter || portAfter.route.kind !== "CARDINAL_CELL") {
			throw new Error("Expected cardinal port mutation.");
		}
		portAfter.route.z = -1;
		expectError(value, "cardinal route position");
	});

	it("enforces unchanged ID cursors and exact plan/ticket source bindings", () => {
		const advancedCursor = mutablePreparedArrangement();
		const advancedTicket = requireTicket(advancedCursor);
		advancedTicket.prospectiveNextAdvancedSwitchId += 1;
		expectError(advancedCursor, "advanced an existing-ID cursor");

		const portCursor = mutablePreparedArrangement();
		const portTicket = requireTicket(portCursor);
		portTicket.prospectiveNextPortId += 1;
		expectError(portCursor, "advanced an existing-ID cursor");

		const organizationCursor = mutablePreparedArrangement();
		const organizationPlan = requirePlan(organizationCursor);
		organizationPlan.nextOrganizationIdAfter += 1;
		expectError(organizationCursor, "scalar fields");

		const staleRevision = mutablePreparedArrangement();
		const staleTicket = requireTicket(staleRevision);
		staleTicket.sourceRevision += 1;
		expectError(staleRevision, "does not bind");
	});

	it("recomputes the full plan fingerprint and validates checksum fields", () => {
		const staleFingerprint = mutablePreparedArrangement();
		const plan = requirePlan(staleFingerprint);
		const firstMutation = plan.mutations[0];
		if (!firstMutation) throw new Error("Expected rail mutation.");
		firstMutation.after = encodeRailCell({ incoming: 0, outgoing: DIR_N });
		expectError(staleFingerprint, "fingerprint");

		const malformedFingerprint = mutablePreparedArrangement();
		const ticket = requireTicket(malformedFingerprint);
		ticket.intentFingerprint = "not-a-checksum";
		expectError(malformedFingerprint, "ticket fields");

		const wrongChecksumFamily = mutablePreparedArrangement();
		const wrongChecksumTicket = requireTicket(wrongChecksumFamily);
		wrongChecksumTicket.sourceChecksum = checksum("ordered-fingerprint-not-rail-checksum");
		expectError(wrongChecksumFamily, "ticket fields");
	});

	it("cross-checks arrangement metadata, translation bounds, and impact authorizations", () => {
		const badBounds = mutablePreparedArrangement();
		const badBoundsPlan = requirePlan(badBounds);
		const translation = badBoundsPlan.arrangement?.translations[1];
		if (!translation) throw new Error("Expected second translation.");
		translation.after.maxZExclusive += 1;
		expectError(badBounds, "bounds do not match");

		const badCount = mutablePreparedArrangement();
		const badCountPlan = requirePlan(badCount);
		if (!badCountPlan.arrangement) throw new Error("Expected arrangement metadata.");
		badCountPlan.arrangement.rootCount = 3;
		expectError(badCount, "counts");

		const missingAuthorization = mutablePreparedArrangement();
		const missingAuthorizationPlan = requirePlan(missingAuthorization);
		missingAuthorizationPlan.organizationImpactAuthorizations = [];
		expectError(missingAuthorization, "metadata");
	});
});

function validPreparedArrangement(): PreparedStaticFabArrangement {
	const railChecksums = actualRailChecksums();
	const sourceRailStart = encodeRailCell({ incoming: 0, outgoing: DIR_E });
	const sourceRailEnd = encodeRailCell({ incoming: 8, outgoing: 0 });
	const beforeSwitch: AdvancedSwitchRecord = {
		id: 1,
		profileClass: "A",
		origin: { x: 20, y: 10 },
		forward: DIR_E,
		lateral: DIR_N,
		movementMask: 0b1111,
	};
	const afterSwitch: AdvancedSwitchRecord = {
		...beforeSwitch,
		origin: { x: 20, y: 0 },
	};
	const beforePort: PortRecord = {
		id: 1,
		equipmentGroupId: 1,
		route: { kind: "CARDINAL_CELL", x: 10, z: 10, from: 0, to: DIR_E },
		stationMillimeters: 0,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "OHB",
		barcode: "PORT-1",
	};
	const afterPort: PortRecord = {
		...beforePort,
		route: { kind: "CARDINAL_CELL", x: 10, z: 0, from: 0, to: DIR_E },
	};
	const beforeOrganization: StaticFabOrganizationRecord = {
		id: 1,
		kind: "BAY",
		name: "Bay One",
		parentOrganizationIds: [],
		properties: { description: "", color: "CYAN" },
		membership: {
			railEdges: [{ from: { x: 10, y: 10 }, to: { x: 11, y: 10 } }],
			advancedSwitchIds: [1],
			equipmentGroupIds: [1],
		},
	};
	const afterOrganization: StaticFabOrganizationRecord = {
		...beforeOrganization,
		membership: {
			...beforeOrganization.membership,
			railEdges: [{ from: { x: 10, y: 0 }, to: { x: 11, y: 0 } }],
		},
	};
	const plan: StaticFabArrangementPlan = {
		kind: "arrange-static-fab",
		baseRevision: 3,
		basePatchSequence: 7,
		valid: true,
		reason: "2 roots arranged",
		issueCode: null,
		cells: [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 10, y: 0 },
			{ x: 11, y: 0 },
			{ x: 20, y: 0 },
			{ x: 10, y: 10 },
			{ x: 11, y: 10 },
			{ x: 20, y: 10 },
		],
		conflicts: [],
		mutations: [
			{ x: 10, y: 0, before: 0, after: sourceRailStart },
			{ x: 11, y: 0, before: 0, after: sourceRailEnd },
			{ x: 10, y: 10, before: sourceRailStart, after: 0 },
			{ x: 11, y: 10, before: sourceRailEnd, after: 0 },
		],
		switchMutations: [{ id: 1, before: beforeSwitch, after: afterSwitch }],
		portMutations: [{ id: 1, before: beforePort, after: afterPort }],
		equipmentGroupMutations: [],
		organizationMutations: [{ id: 1, before: beforeOrganization, after: afterOrganization }],
		organizationImpactAuthorizations: [1],
		nextOrganizationIdBefore: 2,
		nextOrganizationIdAfter: 2,
		arrangement: {
			version: 1,
			axis: "Z",
			mode: "ALIGN_MIN",
			translations: [
				{
					key: "root-a",
					deltaX: 0,
					deltaZ: 0,
					before: { minX: 0, minZ: 0, maxXExclusive: 2, maxZExclusive: 1 },
					after: { minX: 0, minZ: 0, maxXExclusive: 2, maxZExclusive: 1 },
				},
				{
					key: "root-b",
					deltaX: 0,
					deltaZ: -10,
					before: { minX: 10, minZ: 10, maxXExclusive: 22, maxZExclusive: 11 },
					after: { minX: 10, minZ: 0, maxXExclusive: 22, maxZExclusive: 1 },
				},
			],
			maximumSnapErrorMeters: 0,
			rootCount: 2,
			moduleCount: 2,
			railEdgeCount: 2,
			advancedSwitchCount: 1,
			portCount: 1,
			equipmentGroupCount: 1,
			affectedOrganizationIds: [1],
		},
	};
	return {
		plan,
		ticket: {
			ticketId: 41,
			validationLevel: "exact",
			sourceRevision: plan.baseRevision,
			sourcePatchSequence: plan.basePatchSequence,
			sourceChecksum: railChecksums.source,
			sourceNextAdvancedSwitchId: 2,
			sourceNextPortId: 2,
			sourceNextEquipmentGroupId: 2,
			sourceNextOrganizationId: 2,
			intentFingerprint: checksum("intent"),
			planFingerprint: staticFabArrangementPlanFingerprint(plan),
			prospectiveChecksum: railChecksums.prospective,
			prospectiveNextAdvancedSwitchId: 2,
			prospectiveNextPortId: 2,
			prospectiveNextEquipmentGroupId: 2,
			prospectiveNextOrganizationId: 2,
		},
		valid: true,
		failureCode: null,
		reason: plan.reason,
		conflictCells: [],
		conflictCount: 0,
		planningMilliseconds: 1,
		validationMilliseconds: 2,
	};
}

function actualRailChecksums(): { readonly source: string; readonly prospective: string } {
	const source = new TileMap();
	const prospective = source.clone();
	prospective.applyAtomicMutations(
		[
			{
				x: 0,
				y: 0,
				before: 0,
				after: encodeRailCell({ incoming: 0, outgoing: DIR_E }),
			},
			{
				x: 1,
				y: 0,
				before: 0,
				after: encodeRailCell({ incoming: 8, outgoing: 0 }),
			},
		],
		[],
	);
	return {
		source: captureRailMirrorSnapshot(source, 0).snapshot.checksum,
		prospective: checksumRailMap(prospective),
	};
}

function addLine(
	map: TileMap,
	start: { readonly x: number; readonly y: number },
	end: { readonly x: number; readonly y: number },
): void {
	const plan = planRailConstruction(new TileMap(), start, end);
	if (!plan.valid) throw new Error(plan.reason);
	map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? []);
}

function compactRejectedArrangement(): DeepMutable<PreparedStaticFabArrangement> {
	const value = mutablePreparedArrangement();
	const plan = requirePlan(value);
	value.valid = false;
	value.failureCode = "clearance";
	value.reason = "clearance conflict";
	value.ticket = null;
	value.conflictCells = [{ x: 10, y: 0 }];
	value.conflictCount = 1;
	plan.valid = false;
	plan.reason = "2 roots arranged";
	plan.issueCode = null;
	plan.cells = [{ x: 10, y: 0 }];
	plan.conflicts = [];
	plan.mutations = [];
	plan.switchMutations = [];
	plan.portMutations = [];
	plan.equipmentGroupMutations = [];
	plan.organizationMutations = [];
	plan.organizationImpactAuthorizations = [];
	plan.arrangement = null;
	return value;
}

function checksum(label: string): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([label]);
	return checksum.digest();
}

function mutablePreparedArrangement(): DeepMutable<PreparedStaticFabArrangement> {
	return structuredClone(validPreparedArrangement()) as DeepMutable<PreparedStaticFabArrangement>;
}

function requirePlan(
	value: DeepMutable<PreparedStaticFabArrangement>,
): DeepMutable<StaticFabArrangementPlan> {
	if (!value.plan) throw new Error("Expected a full arrangement plan.");
	return value.plan;
}

function requireRejectedPlan(
	value: DeepMutable<PreparedStaticFabArrangement>,
): DeepMutable<StaticFabArrangementPlan> {
	if (!value.plan) throw new Error("Expected a compact arrangement plan.");
	return value.plan;
}

function requireTicket(
	value: DeepMutable<PreparedStaticFabArrangement>,
): NonNullable<DeepMutable<PreparedStaticFabArrangement>["ticket"]> {
	if (!value.ticket) throw new Error("Expected an arrangement ticket.");
	return value.ticket;
}

function expectError(value: unknown, expected: string): void {
	const error = staticFabArrangementPreparedShapeError(value);
	expect(error).not.toBeNull();
	expect(error).toContain(expected);
}

type DeepMutable<T> = T extends (...args: never[]) => unknown
	? T
	: T extends readonly (infer Item)[]
		? DeepMutable<Item>[]
		: T extends object
			? { -readonly [Key in keyof T]: DeepMutable<T[Key]> }
			: T;
