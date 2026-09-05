import {
	collectStaticFabOrganizationOutlineIndexSnapshotTransferables,
	type StaticFabOrganizationOutlineIndexSnapshot,
} from "../compile/StaticFabOrganizationOutlineIndex";
import { ADVANCED_SWITCH_MAX_ID, type AdvancedSwitchMutation } from "../core/AdvancedSwitch";
import type { OperationalConfigurationState } from "../core/OperationalConfiguration";
import type { OperationalConfigurationPatch } from "../core/OperationalConfigurationMutation";
import type { RailMutation } from "../core/paint";
import type { RailHistoryOriginKind, RailPatchEvent, RailPatchKind } from "../core/RailDocument";
import type { RailMirrorHistoryLedger } from "../core/RailPatchHistory";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import {
	type AdvancedSwitchRecordFieldsSoA,
	advancedSwitchRecordFieldTransfers,
	assertEmptyAdvancedSwitchRecord,
	createAdvancedSwitchRecordFields,
	readAdvancedSwitchRecord,
	validateAdvancedSwitchRecordFieldLengths,
	writeAdvancedSwitchRecord,
} from "./AdvancedSwitchSoA";
import {
	decodePortEquipmentPatch,
	encodePortEquipmentPatch,
	encodePortEquipmentPatchCooperatively,
	type PortEquipmentPatchSoA,
	portEquipmentSnapshotTransfers,
} from "./PortEquipmentSoA";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";
import { assertInt32Coordinate } from "./RailMirrorChecksum";
import type { RailMirrorState } from "./RailPatchMirror";
import type { RailPhysicalLayoutState } from "./RailPhysicalLayout";
import {
	decodeStaticFabAssemblyRelationshipPatch,
	encodeStaticFabAssemblyRelationshipPatch,
	type StaticFabAssemblyRelationshipPatchSoA,
	staticFabAssemblyRelationshipSnapshotTransfers,
} from "./StaticFabAssemblyRelationshipSoA";
import {
	decodeStaticFabOrganizationPatch,
	encodeStaticFabOrganizationPatch,
	type StaticFabOrganizationPatchSoA,
	staticFabOrganizationSnapshotTransfers,
} from "./StaticFabOrganizationSoA";

export interface RailPatchSoA {
	sequence: number;
	kind: RailPatchKind;
	baseRevision: number;
	revision: number;
	xs: Int32Array;
	ys: Int32Array;
	before: Uint8Array;
	after: Uint8Array;
	switchIds: Int32Array;
	switchBeforePresent: Uint8Array;
	switchBefore: AdvancedSwitchRecordFieldsSoA;
	switchAfterPresent: Uint8Array;
	switchAfter: AdvancedSwitchRecordFieldsSoA;
	portEquipment: PortEquipmentPatchSoA;
	organizations: StaticFabOrganizationPatchSoA;
	relationships: StaticFabAssemblyRelationshipPatchSoA;
	organizationImpactAuthorizations: Int32Array;
	operationalConfigurationPatch: OperationalConfigurationPatch | null;
	historyOriginKind?: RailHistoryOriginKind | null;
}

export interface EncodedRailPatch {
	patch: RailPatchSoA;
	transfer: Transferable[];
}

export interface RailPatchEncodingOptions {
	readonly compactOrganizations?: boolean;
}

export type MainToRailMirrorMessage =
	| {
			type: "SYNC_RAIL";
			epoch: number;
			snapshot: RailMirrorSnapshot;
			operationalConfiguration: OperationalConfigurationState;
			historyLedger?: RailMirrorHistoryLedger;
	  }
	| { type: "APPLY_RAIL_PATCH"; epoch: number; patch: RailPatchSoA }
	| {
			type: "CAPTURE_RAIL_SNAPSHOT";
			epoch: number;
			requestId: number;
			expectedSequence: number;
			expectedRevision: number;
			expectedChecksum: string;
			expectedNextAdvancedSwitchId: number;
			expectedNextPortId: number;
			expectedNextEquipmentGroupId: number;
			expectedNextOrganizationId: number;
			expectedNextRelationshipId: number;
	  }
	| {
			type: "CAPTURE_STATIC_FAB_ORGANIZATION_OUTLINE";
			epoch: number;
			requestId: number;
			expectedSequence: number;
			expectedRevision: number;
			expectedChecksum: string;
			expectedNextAdvancedSwitchId: number;
			expectedNextPortId: number;
			expectedNextEquipmentGroupId: number;
			expectedNextOrganizationId: number;
			expectedPhysicalSequence: number;
			expectedPhysicalRevision: number;
			expectedPhysicalFingerprint: string;
	  };

export type RailMirrorToMainMessage =
	| ({ type: "RAIL_SYNCED"; epoch: number } & RailMirrorState & RailPhysicalLayoutState)
	| ({ type: "RAIL_PATCH_APPLIED"; epoch: number } & RailMirrorState & RailPhysicalLayoutState)
	| {
			type: "RAIL_SNAPSHOT_CAPTURED";
			epoch: number;
			requestId: number;
			snapshot: RailMirrorSnapshot;
	  }
	| {
			type: "RAIL_SNAPSHOT_CAPTURE_FAILED";
			epoch: number;
			requestId: number;
			message: string;
	  }
	| {
			type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED";
			epoch: number;
			requestId: number;
			outline: StaticFabOrganizationOutlineIndexSnapshot;
	  }
	| {
			type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURE_FAILED";
			epoch: number;
			requestId: number;
			message: string;
	  }
	| {
			type: "RAIL_DESYNC";
			epoch: number;
			expectedSequence: number;
			expectedRevision: number;
			receivedSequence: number;
			receivedBaseRevision: number;
			message: string;
	  }
	| {
			type: "RAIL_MIRROR_ERROR";
			epoch: number;
			sequence: number;
			revision: number;
			message: string;
	  };

export function railMirrorSnapshotTransfers(snapshot: RailMirrorSnapshot): Transferable[] {
	return [
		snapshot.xs.buffer as ArrayBuffer,
		snapshot.ys.buffer as ArrayBuffer,
		snapshot.encoded.buffer as ArrayBuffer,
		snapshot.switchIds.buffer as ArrayBuffer,
		...advancedSwitchRecordFieldTransfers(snapshot.switchRecords),
		...portEquipmentSnapshotTransfers(snapshot.portEquipment),
		...staticFabOrganizationSnapshotTransfers(snapshot.organizations),
		...staticFabAssemblyRelationshipSnapshotTransfers(snapshot.relationships),
	];
}

export function staticFabOrganizationOutlineTransfers(
	snapshot: StaticFabOrganizationOutlineIndexSnapshot,
): Transferable[] {
	return collectStaticFabOrganizationOutlineIndexSnapshotTransferables(snapshot);
}

export function encodeRailPatchEvent(
	event: RailPatchEvent,
	options: RailPatchEncodingOptions = {},
): EncodedRailPatch {
	const xs = new Int32Array(event.changes.length);
	const ys = new Int32Array(event.changes.length);
	const before = new Uint8Array(event.changes.length);
	const after = new Uint8Array(event.changes.length);
	for (let index = 0; index < event.changes.length; index++) {
		const change = event.changes[index] as RailMutation;
		assertInt32Coordinate(change.x, "x");
		assertInt32Coordinate(change.y, "y");
		assertByte(change.before, "before");
		assertByte(change.after, "after");
		xs[index] = change.x;
		ys[index] = change.y;
		before[index] = change.before;
		after[index] = change.after;
	}
	const switchIds = new Int32Array(event.switchChanges.length);
	const switchBeforePresent = new Uint8Array(event.switchChanges.length);
	const switchBefore = createAdvancedSwitchRecordFields(event.switchChanges.length);
	const switchAfterPresent = new Uint8Array(event.switchChanges.length);
	const switchAfter = createAdvancedSwitchRecordFields(event.switchChanges.length);
	for (let index = 0; index < event.switchChanges.length; index++) {
		const change = event.switchChanges[index] as AdvancedSwitchMutation;
		assertAdvancedSwitchId(change.id, `Rail patch switch ${index} id`);
		if (
			(change.before && change.before.id !== change.id) ||
			(change.after && change.after.id !== change.id)
		) {
			throw new Error(`Rail patch switch ${change.id} record id does not match its mutation id.`);
		}
		switchIds[index] = change.id;
		if (change.before) {
			switchBeforePresent[index] = 1;
			writeAdvancedSwitchRecord(switchBefore, index, change.before);
		}
		if (change.after) {
			switchAfterPresent[index] = 1;
			writeAdvancedSwitchRecord(switchAfter, index, change.after);
		}
	}
	const portEquipment = encodePortEquipmentPatch(event.portChanges, event.equipmentGroupChanges);
	const organizations = encodeStaticFabOrganizationPatch(
		event.organizationChanges,
		event.organizationNextIdBefore,
		event.organizationNextIdAfter,
		{ compactExisting: options.compactOrganizations },
	);
	const relationships = encodeStaticFabAssemblyRelationshipPatch(
		event.relationshipChanges,
		event.relationshipNextIdBefore,
		event.relationshipNextIdAfter,
	);
	const organizationImpactAuthorizations = encodeOrganizationImpactAuthorizations(
		event.organizationImpactAuthorizations ?? [],
	);
	return {
		patch: {
			sequence: event.sequence,
			kind: event.kind,
			baseRevision: event.baseRevision,
			revision: event.revision,
			xs,
			ys,
			before,
			after,
			switchIds,
			switchBeforePresent,
			switchBefore,
			switchAfterPresent,
			switchAfter,
			portEquipment: portEquipment.fields,
			organizations: organizations.fields,
			relationships: relationships.fields,
			organizationImpactAuthorizations,
			operationalConfigurationPatch: event.operationalConfigurationPatch ?? null,
			historyOriginKind: event.historyOriginKind ?? null,
		},
		transfer: [
			xs.buffer as ArrayBuffer,
			ys.buffer as ArrayBuffer,
			before.buffer,
			after.buffer,
			switchIds.buffer,
			switchBeforePresent.buffer,
			...advancedSwitchRecordFieldTransfers(switchBefore),
			switchAfterPresent.buffer,
			...advancedSwitchRecordFieldTransfers(switchAfter),
			...portEquipment.transfer,
			...organizations.transfer,
			...relationships.transfer,
			organizationImpactAuthorizations.buffer,
		],
	};
}

/**
 * Cooperatively encode the port/equipment-only event emitted by reviewed station Apply.
 *
 * The event remains unpublished and its buffers remain owned by main until the exact event identity
 * is delivered. Broader rail/switch/organization patches retain the ordinary synchronous encoder.
 */
export async function encodeReviewedPortEquipmentRailPatchEventCooperatively(
	event: RailPatchEvent,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
	options: RailPatchEncodingOptions = {},
): Promise<EncodedRailPatch> {
	if (
		event.changes.length !== 0 ||
		event.switchChanges.length !== 0 ||
		event.organizationChanges.length !== 0 ||
		event.relationshipChanges.length !== 0 ||
		(event.organizationImpactAuthorizations?.length ?? 0) !== 0 ||
		(event.operationalConfigurationPatch ?? null) !== null ||
		event.historyOriginKind !== undefined
	) {
		throw new Error(
			"Cooperative reviewed Apply encoding requires a port/equipment-only forward event.",
		);
	}
	const portEquipment = await encodePortEquipmentPatchCooperatively(
		event.portChanges,
		event.equipmentGroupChanges,
		checkpoint,
		operationBudget,
	);
	const xs = new Int32Array(0);
	const ys = new Int32Array(0);
	const before = new Uint8Array(0);
	const after = new Uint8Array(0);
	const switchIds = new Int32Array(0);
	const switchBeforePresent = new Uint8Array(0);
	const switchBefore = createAdvancedSwitchRecordFields(0);
	const switchAfterPresent = new Uint8Array(0);
	const switchAfter = createAdvancedSwitchRecordFields(0);
	const organizations = encodeStaticFabOrganizationPatch(
		[],
		event.organizationNextIdBefore,
		event.organizationNextIdAfter,
		{ compactExisting: options.compactOrganizations },
	);
	const relationships = encodeStaticFabAssemblyRelationshipPatch(
		[],
		event.relationshipNextIdBefore,
		event.relationshipNextIdAfter,
	);
	const organizationImpactAuthorizations = new Int32Array(0);
	return {
		patch: {
			sequence: event.sequence,
			kind: event.kind,
			baseRevision: event.baseRevision,
			revision: event.revision,
			xs,
			ys,
			before,
			after,
			switchIds,
			switchBeforePresent,
			switchBefore,
			switchAfterPresent,
			switchAfter,
			portEquipment: portEquipment.fields,
			organizations: organizations.fields,
			relationships: relationships.fields,
			organizationImpactAuthorizations,
			operationalConfigurationPatch: null,
			historyOriginKind: null,
		},
		transfer: [
			xs.buffer,
			ys.buffer,
			before.buffer,
			after.buffer,
			switchIds.buffer,
			switchBeforePresent.buffer,
			...advancedSwitchRecordFieldTransfers(switchBefore),
			switchAfterPresent.buffer,
			...advancedSwitchRecordFieldTransfers(switchAfter),
			...portEquipment.transfer,
			...organizations.transfer,
			...relationships.transfer,
			organizationImpactAuthorizations.buffer,
		],
	};
}

export function decodeRailPatchSoA(
	patch: RailPatchSoA,
	currentOrganizations?: StaticFabOrganizationState,
): RailPatchEvent {
	const length = patch.xs.length;
	if (
		patch.ys.length !== length ||
		patch.before.length !== length ||
		patch.after.length !== length
	) {
		throw new Error("Rail patch SoA lengths do not match.");
	}
	const changes = new Array<RailMutation>(length);
	for (let index = 0; index < length; index++) {
		changes[index] = {
			x: patch.xs[index] as number,
			y: patch.ys[index] as number,
			before: patch.before[index] as number,
			after: patch.after[index] as number,
		};
	}
	const switchCount = patch.switchIds.length;
	if (
		patch.switchBeforePresent.length !== switchCount ||
		patch.switchAfterPresent.length !== switchCount
	) {
		throw new Error("Rail patch advanced switch presence lengths do not match.");
	}
	validateAdvancedSwitchRecordFieldLengths(patch.switchBefore, switchCount, "Rail patch before");
	validateAdvancedSwitchRecordFieldLengths(patch.switchAfter, switchCount, "Rail patch after");
	const switchChanges = new Array<AdvancedSwitchMutation>(switchCount);
	for (let index = 0; index < switchCount; index++) {
		const id = patch.switchIds[index] as number;
		assertAdvancedSwitchId(id, `Rail patch switch ${index} id`);
		const beforePresent = assertPresence(
			patch.switchBeforePresent[index] as number,
			`Rail patch switch ${id} before`,
		);
		const afterPresent = assertPresence(
			patch.switchAfterPresent[index] as number,
			`Rail patch switch ${id} after`,
		);
		if (!beforePresent && !afterPresent) {
			throw new Error(`Rail patch switch ${id} has neither a before nor an after record.`);
		}
		if (!beforePresent)
			assertEmptyAdvancedSwitchRecord(patch.switchBefore, index, "Rail patch before");
		if (!afterPresent)
			assertEmptyAdvancedSwitchRecord(patch.switchAfter, index, "Rail patch after");
		switchChanges[index] = {
			id,
			before: beforePresent
				? readAdvancedSwitchRecord(patch.switchBefore, index, id, `Rail patch switch ${id} before`)
				: null,
			after: afterPresent
				? readAdvancedSwitchRecord(patch.switchAfter, index, id, `Rail patch switch ${id} after`)
				: null,
		};
	}
	const portEquipment = decodePortEquipmentPatch(patch.portEquipment);
	const organizationChanges = decodeStaticFabOrganizationPatch(
		patch.organizations,
		currentOrganizations,
	);
	const relationshipChanges = decodeStaticFabAssemblyRelationshipPatch(patch.relationships);
	const organizationImpactAuthorizations = decodeOrganizationImpactAuthorizations(
		patch.organizationImpactAuthorizations,
	);
	const historyOriginKind = patch.historyOriginKind ?? undefined;
	return {
		sequence: patch.sequence,
		kind: patch.kind,
		baseRevision: patch.baseRevision,
		revision: patch.revision,
		changes,
		switchChanges,
		portChanges: portEquipment.portChanges,
		equipmentGroupChanges: portEquipment.equipmentGroupChanges,
		organizationChanges,
		organizationNextIdBefore: patch.organizations.nextOrganizationIdBefore,
		organizationNextIdAfter: patch.organizations.nextOrganizationIdAfter,
		relationshipChanges,
		relationshipNextIdBefore: patch.relationships.nextRelationshipIdBefore,
		relationshipNextIdAfter: patch.relationships.nextRelationshipIdAfter,
		organizationImpactAuthorizations,
		operationalConfigurationPatch: patch.operationalConfigurationPatch,
		...(historyOriginKind ? { historyOriginKind } : {}),
	};
}

function encodeOrganizationImpactAuthorizations(ids: readonly number[]): Int32Array {
	const encoded = new Int32Array(ids.length);
	let previous = 0;
	for (let index = 0; index < ids.length; index++) {
		const id = ids[index] as number;
		assertAdvancedSwitchId(id, `Rail patch organization authorization ${index}`);
		if (id <= previous) {
			throw new Error("Rail patch organization authorizations must be unique and ascending.");
		}
		encoded[index] = id;
		previous = id;
	}
	return encoded;
}

function decodeOrganizationImpactAuthorizations(value: Int32Array): readonly number[] {
	if (!(value instanceof Int32Array)) {
		throw new Error("Rail patch organization authorizations must be an Int32Array.");
	}
	const decoded = new Array<number>(value.length);
	let previous = 0;
	for (let index = 0; index < value.length; index++) {
		const id = value[index] as number;
		assertAdvancedSwitchId(id, `Rail patch organization authorization ${index}`);
		if (id <= previous) {
			throw new Error("Rail patch organization authorizations must be unique and ascending.");
		}
		decoded[index] = id;
		previous = id;
	}
	return Object.freeze(decoded);
}

function assertByte(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0 || value > 0xff) {
		throw new Error(`Rail patch ${label} value ${value} is not a byte.`);
	}
}

function assertAdvancedSwitchId(value: number, label: string): void {
	if (!Number.isInteger(value) || value <= 0 || value > ADVANCED_SWITCH_MAX_ID) {
		throw new Error(`${label} ${value} is not a positive signed int32.`);
	}
}

function assertPresence(value: number, label: string): boolean {
	if (value !== 0 && value !== 1) throw new Error(`${label} presence ${value} is not 0 or 1.`);
	return value === 1;
}
