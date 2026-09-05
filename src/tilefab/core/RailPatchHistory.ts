import type { AdvancedSwitchRecord } from "./AdvancedSwitch";
import type { EquipmentGroupRecord } from "./EquipmentGroup";
import { operationalConfigurationPatchTransitionFingerprint } from "./OperationalConfigurationMutation";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import type { PortRecord } from "./PortRecord";
import type { RailHistoryOriginKind, RailPatchEvent } from "./RailDocument";
import {
	checksumStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipRecordV1,
	staticFabAssemblyRelationshipTransitionFootprint,
} from "./StaticFabAssemblyRelationship";
import type { StaticFabOrganizationRecord } from "./StaticFabOrganization";
import { staticFabOrganizationFingerprint } from "./StaticFabOrganizationFingerprint";

export interface RailMirrorHistoryLedgerEntry {
	readonly originKind: RailHistoryOriginKind;
	readonly forwardFingerprint: string;
	readonly reverseFingerprint: string;
	readonly relationshipEdgeReferences: number;
	readonly relationshipOwnerIds: number;
	readonly relationshipCanonicalBytes: number;
}

export interface RailMirrorHistoryLedger {
	readonly undo: readonly RailMirrorHistoryLedgerEntry[];
	readonly redo: readonly RailMirrorHistoryLedgerEntry[];
}

type RailPatchTransitionBase = Pick<
	RailPatchEvent,
	| "changes"
	| "switchChanges"
	| "portChanges"
	| "equipmentGroupChanges"
	| "organizationChanges"
	| "organizationNextIdBefore"
	| "organizationNextIdAfter"
	| "organizationImpactAuthorizations"
	| "operationalConfigurationPatch"
>;

export type RailPatchTransition = RailPatchTransitionBase &
	Partial<
		Pick<
			RailPatchEvent,
			"relationshipChanges" | "relationshipNextIdBefore" | "relationshipNextIdAfter"
		>
	>;

export const EMPTY_RAIL_MIRROR_HISTORY_LEDGER: RailMirrorHistoryLedger = Object.freeze({
	undo: Object.freeze([]),
	redo: Object.freeze([]),
});

export const RAIL_MIRROR_HISTORY_ENTRY_LIMIT = 100_000;
export const RAIL_MIRROR_HISTORY_RELATIONSHIP_EDGE_REFERENCE_LIMIT = 4_000_000;
export const RAIL_MIRROR_HISTORY_RELATIONSHIP_OWNER_ID_LIMIT = 4_000_000;
export const RAIL_MIRROR_HISTORY_RELATIONSHIP_CANONICAL_BYTE_LIMIT = 128 * 1024 * 1024;

export function appendBoundedRailHistoryEntry<T>(
	history: T[],
	entry: T,
	entryLimit = RAIL_MIRROR_HISTORY_ENTRY_LIMIT,
): void {
	if (!Number.isSafeInteger(entryLimit) || entryLimit < 1) {
		throw new Error("Rail history entry limit must be a positive safe integer.");
	}
	history.push(entry);
	const overflow = history.length - entryLimit;
	if (overflow > 0) history.splice(0, overflow);
}

const RAIL_HISTORY_ORIGIN_KINDS = Object.freeze({
	build: true,
	edit: true,
	erase: true,
	"place-static-fab-blueprint": true,
	"connect-static-fab-assemblies": true,
	"arrange-static-fab": true,
	"disconnect-static-fab-bay": true,
	"delete-static-fab-bay": true,
	"edit-static-fab-bay-flow": true,
	"place-static-fab-organization-bundle": true,
	"erase-static-fab-selection": true,
	"place-ohb": true,
	"place-eq": true,
	"place-stk": true,
	"place-port-equipment-batch": true,
	"edit-port-equipment": true,
	"erase-port-equipment": true,
	"create-static-fab-organization": true,
	"assign-static-fab-organization": true,
	"rename-static-fab-organization": true,
	"update-static-fab-organization": true,
	"remove-static-fab-organization": true,
	"edit-operational-configuration": true,
	clear: true,
}) satisfies Readonly<Record<RailHistoryOriginKind, true>>;

export function isRailHistoryOriginKind(value: unknown): value is RailHistoryOriginKind {
	return typeof value === "string" && Object.hasOwn(RAIL_HISTORY_ORIGIN_KINDS, value);
}

export function railPatchTransitionFingerprint(
	transition: RailPatchTransition,
	reverse = false,
): string {
	const relationshipChanges = transition.relationshipChanges ?? [];
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["OPENFAB_RAIL_PATCH_TRANSITION_V5"]);
	checksum.addNumbers([transition.changes.length]);
	for (const mutation of transition.changes) {
		checksum.addNumbers([
			mutation.x,
			mutation.y,
			reverse ? mutation.after : mutation.before,
			reverse ? mutation.before : mutation.after,
		]);
	}
	checksum.addNumbers([transition.switchChanges.length]);
	for (const mutation of transition.switchChanges) {
		checksum.addNumbers([mutation.id]);
		addAdvancedSwitchRecord(checksum, reverse ? mutation.after : mutation.before);
		addAdvancedSwitchRecord(checksum, reverse ? mutation.before : mutation.after);
	}
	checksum.addNumbers([transition.portChanges.length]);
	for (const mutation of transition.portChanges) {
		checksum.addNumbers([mutation.id]);
		addPortRecord(checksum, reverse ? mutation.after : mutation.before);
		addPortRecord(checksum, reverse ? mutation.before : mutation.after);
	}
	checksum.addNumbers([transition.equipmentGroupChanges.length]);
	for (const mutation of transition.equipmentGroupChanges) {
		checksum.addNumbers([mutation.id]);
		addEquipmentGroupRecord(checksum, reverse ? mutation.after : mutation.before);
		addEquipmentGroupRecord(checksum, reverse ? mutation.before : mutation.after);
	}
	checksum.addNumbers([transition.organizationChanges.length]);
	for (const mutation of transition.organizationChanges) {
		checksum.addNumbers([mutation.id]);
		addOrganizationRecord(checksum, reverse ? mutation.after : mutation.before);
		addOrganizationRecord(checksum, reverse ? mutation.before : mutation.after);
	}
	checksum.addNumbers([relationshipChanges.length]);
	for (const mutation of relationshipChanges) {
		checksum.addNumbers([mutation.id]);
		addAssemblyRelationshipRecord(checksum, reverse ? mutation.after : mutation.before);
		addAssemblyRelationshipRecord(checksum, reverse ? mutation.before : mutation.after);
	}
	checksum.addNumbers(transition.organizationImpactAuthorizations ?? []);
	checksum.addString(
		operationalConfigurationPatchTransitionFingerprint(
			transition.operationalConfigurationPatch,
			reverse,
		),
	);
	return checksum.digest();
}

/** Same V5 fingerprint contract with caller-controlled event-loop checkpoints. */
export async function railPatchTransitionFingerprintCooperatively(
	transition: RailPatchTransition,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
	reverse = false,
): Promise<string> {
	const relationshipChanges = transition.relationshipChanges ?? [];
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Rail patch fingerprint operation budget must be positive.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["OPENFAB_RAIL_PATCH_TRANSITION_V5"]);
	checksum.addNumbers([transition.changes.length]);
	for (const mutation of transition.changes) {
		checksum.addNumbers([
			mutation.x,
			mutation.y,
			reverse ? mutation.after : mutation.before,
			reverse ? mutation.before : mutation.after,
		]);
		await consumeOperation();
	}
	checksum.addNumbers([transition.switchChanges.length]);
	for (const mutation of transition.switchChanges) {
		checksum.addNumbers([mutation.id]);
		addAdvancedSwitchRecord(checksum, reverse ? mutation.after : mutation.before);
		addAdvancedSwitchRecord(checksum, reverse ? mutation.before : mutation.after);
		await consumeOperation();
	}
	checksum.addNumbers([transition.portChanges.length]);
	for (const mutation of transition.portChanges) {
		checksum.addNumbers([mutation.id]);
		addPortRecord(checksum, reverse ? mutation.after : mutation.before);
		addPortRecord(checksum, reverse ? mutation.before : mutation.after);
		await consumeOperation();
	}
	checksum.addNumbers([transition.equipmentGroupChanges.length]);
	for (const mutation of transition.equipmentGroupChanges) {
		checksum.addNumbers([mutation.id]);
		addEquipmentGroupRecord(checksum, reverse ? mutation.after : mutation.before);
		addEquipmentGroupRecord(checksum, reverse ? mutation.before : mutation.after);
		await consumeOperation();
	}
	checksum.addNumbers([transition.organizationChanges.length]);
	for (const mutation of transition.organizationChanges) {
		checksum.addNumbers([mutation.id]);
		addOrganizationRecord(checksum, reverse ? mutation.after : mutation.before);
		addOrganizationRecord(checksum, reverse ? mutation.before : mutation.after);
		await consumeOperation();
	}
	checksum.addNumbers([relationshipChanges.length]);
	for (const mutation of relationshipChanges) {
		checksum.addNumbers([mutation.id]);
		addAssemblyRelationshipRecord(checksum, reverse ? mutation.after : mutation.before);
		addAssemblyRelationshipRecord(checksum, reverse ? mutation.before : mutation.after);
		await consumeOperation();
	}
	checksum.addNumbers(transition.organizationImpactAuthorizations ?? []);
	checksum.addString(
		operationalConfigurationPatchTransitionFingerprint(
			transition.operationalConfigurationPatch,
			reverse,
		),
	);
	await checkpoint();
	return checksum.digest();
}

export function createRailMirrorHistoryLedgerEntry(
	originKind: RailHistoryOriginKind,
	transition: RailPatchTransition,
): RailMirrorHistoryLedgerEntry {
	const footprint = staticFabAssemblyRelationshipTransitionFootprint(
		transition.relationshipChanges ?? [],
	);
	return Object.freeze({
		originKind,
		forwardFingerprint: railPatchTransitionFingerprint(transition),
		reverseFingerprint: railPatchTransitionFingerprint(transition, true),
		relationshipEdgeReferences: footprint.edgeReferenceCount,
		relationshipOwnerIds: footprint.ownerIdCount,
		relationshipCanonicalBytes: footprint.canonicalByteCount,
	});
}

/** Build both reciprocal ledger fingerprints without one unbounded transition walk. */
export async function createRailMirrorHistoryLedgerEntryCooperatively(
	originKind: RailHistoryOriginKind,
	transition: RailPatchTransition,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<RailMirrorHistoryLedgerEntry> {
	const footprint = staticFabAssemblyRelationshipTransitionFootprint(
		transition.relationshipChanges ?? [],
	);
	const forwardFingerprint = await railPatchTransitionFingerprintCooperatively(
		transition,
		checkpoint,
		operationBudget,
	);
	const reverseFingerprint = await railPatchTransitionFingerprintCooperatively(
		transition,
		checkpoint,
		operationBudget,
		true,
	);
	return Object.freeze({
		originKind,
		forwardFingerprint,
		reverseFingerprint,
		relationshipEdgeReferences: footprint.edgeReferenceCount,
		relationshipOwnerIds: footprint.ownerIdCount,
		relationshipCanonicalBytes: footprint.canonicalByteCount,
	});
}

export function copyRailMirrorHistoryLedger(
	ledger: RailMirrorHistoryLedger,
): RailMirrorHistoryLedger {
	if (
		!ledger ||
		!Array.isArray(ledger.undo) ||
		!Array.isArray(ledger.redo) ||
		ledger.undo.length + ledger.redo.length > RAIL_MIRROR_HISTORY_ENTRY_LIMIT
	) {
		throw new Error("Rail mirror history ledger is malformed or exceeds its entry budget.");
	}
	const copied = Object.freeze({
		undo: Object.freeze(Array.from(ledger.undo, copyLedgerEntry)),
		redo: Object.freeze(Array.from(ledger.redo, copyLedgerEntry)),
	});
	assertRailMirrorHistoryRelationshipBudget(copied);
	return copied;
}

function copyLedgerEntry(entry: RailMirrorHistoryLedgerEntry): RailMirrorHistoryLedgerEntry {
	const rawOriginKind: unknown = entry?.originKind;
	if (
		!entry ||
		!isRailHistoryOriginKind(rawOriginKind) ||
		!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(entry.forwardFingerprint) ||
		!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(entry.reverseFingerprint) ||
		!isNonNegativeSafeInteger(entry.relationshipEdgeReferences) ||
		!isNonNegativeSafeInteger(entry.relationshipOwnerIds) ||
		!isNonNegativeSafeInteger(entry.relationshipCanonicalBytes)
	) {
		throw new Error("Rail mirror history ledger entry is malformed.");
	}
	return Object.freeze({ ...entry, originKind: rawOriginKind });
}

export function trimRailMirrorHistoryRelationshipBudget<T extends RailMirrorHistoryLedgerEntry>(
	undo: T[],
	redo: T[],
): void {
	while (!railMirrorHistoryRelationshipBudgetFits(undo, redo)) {
		if (undo.length > 0) undo.shift();
		else if (redo.length > 0) redo.shift();
		else break;
	}
}

function assertRailMirrorHistoryRelationshipBudget(ledger: RailMirrorHistoryLedger): void {
	if (!railMirrorHistoryRelationshipBudgetFits(ledger.undo, ledger.redo)) {
		throw new Error("Rail mirror history relationship payload exceeds its aggregate budget.");
	}
}

function railMirrorHistoryRelationshipBudgetFits(
	undo: readonly RailMirrorHistoryLedgerEntry[],
	redo: readonly RailMirrorHistoryLedgerEntry[],
): boolean {
	let edges = 0;
	let owners = 0;
	let bytes = 0;
	for (const entry of [...undo, ...redo]) {
		edges += entry.relationshipEdgeReferences;
		owners += entry.relationshipOwnerIds;
		bytes += entry.relationshipCanonicalBytes;
		if (
			edges > RAIL_MIRROR_HISTORY_RELATIONSHIP_EDGE_REFERENCE_LIMIT ||
			owners > RAIL_MIRROR_HISTORY_RELATIONSHIP_OWNER_ID_LIMIT ||
			bytes > RAIL_MIRROR_HISTORY_RELATIONSHIP_CANONICAL_BYTE_LIMIT
		) {
			return false;
		}
	}
	return true;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function addAdvancedSwitchRecord(
	checksum: OrderedTypedChecksum,
	record: AdvancedSwitchRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		record.origin.x,
		record.origin.y,
		record.forward,
		record.lateral,
		record.movementMask,
	]);
	checksum.addStrings([record.profileClass]);
}

function addPortRecord(checksum: OrderedTypedChecksum, record: PortRecord | null): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([
		1,
		record.id,
		record.equipmentGroupId,
		record.stationMillimeters,
		record.lateralOffsetMillimeters,
	]);
	checksum.addStrings([
		record.side,
		record.direction,
		record.portType,
		record.barcode ?? "",
		record.route.kind,
	]);
	if (record.route.kind === "CARDINAL_CELL") {
		checksum.addNumbers([record.route.x, record.route.z, record.route.from, record.route.to]);
	} else {
		checksum.addNumbers([
			record.route.switchId,
			record.route.portIndex ?? -1,
			record.route.segmentOrdinal,
		]);
		checksum.addStrings([record.route.profileClass, record.route.role]);
	}
}

function addEquipmentGroupRecord(
	checksum: OrderedTypedChecksum,
	record: EquipmentGroupRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([1, record.id, record.portIds.length, ...record.portIds]);
	checksum.addStrings([record.kind]);
	if (record.kind === "EQ") {
		checksum.addNumbers([record.pitchMillimeters]);
		checksum.addStrings([record.recipe ?? ""]);
	} else {
		checksum.addStrings([record.template]);
	}
}

function addOrganizationRecord(
	checksum: OrderedTypedChecksum,
	record: StaticFabOrganizationRecord | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	const fingerprint = staticFabOrganizationFingerprint(record);
	checksum.addNumbers([1, fingerprint.xor, fingerprint.sum]);
}

function addAssemblyRelationshipRecord(
	checksum: OrderedTypedChecksum,
	record: StaticFabAssemblyRelationshipRecordV1 | null,
): void {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([1]);
	checksum.addString(checksumStaticFabAssemblyRelationshipRecord(record));
}
