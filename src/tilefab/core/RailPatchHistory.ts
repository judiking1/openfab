import type { AdvancedSwitchRecord } from "./AdvancedSwitch";
import { completeCooperativeSteps, createCooperativeTask } from "./CooperativeTask";
import type { EquipmentGroupRecord } from "./EquipmentGroup";
import { operationalConfigurationPatchTransitionFingerprint } from "./OperationalConfigurationMutation";
import { OrderedTypedChecksum } from "./OrderedTypedChecksum";
import type { PortRecord } from "./PortRecord";
import type { RailHistoryOriginKind, RailPatchEvent } from "./RailDocument";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import {
	checksumStaticFabAssemblyRelationshipRecord,
	checksumStaticFabAssemblyRelationshipRecordSteps,
	type StaticFabAssemblyRelationshipRecordV1,
	staticFabAssemblyRelationshipAdditionFootprintSteps,
	staticFabAssemblyRelationshipTransitionFootprint,
} from "./StaticFabAssemblyRelationship";
import {
	isCanonicalStaticFabOrganizationRecord,
	type StaticFabOrganizationRecord,
} from "./StaticFabOrganization";
import {
	composeStaticFabOrganizationFingerprint,
	createStaticFabOrganizationMembershipFingerprintAccumulator,
	staticFabOrganizationFingerprint,
} from "./StaticFabOrganizationFingerprint";

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
	return completeCooperativeSteps(transitionFingerprintSteps(transition, reverse, false));
}

function* transitionFingerprintSteps(
	transition: RailPatchTransition,
	reverse: boolean,
	boundedRecords: boolean,
): Generator<void, string> {
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
		yield;
	}
	checksum.addNumbers([transition.switchChanges.length]);
	for (const mutation of transition.switchChanges) {
		checksum.addNumbers([mutation.id]);
		addAdvancedSwitchRecord(checksum, reverse ? mutation.after : mutation.before);
		addAdvancedSwitchRecord(checksum, reverse ? mutation.before : mutation.after);
		yield;
	}
	checksum.addNumbers([transition.portChanges.length]);
	for (const mutation of transition.portChanges) {
		checksum.addNumbers([mutation.id]);
		addPortRecord(checksum, reverse ? mutation.after : mutation.before);
		addPortRecord(checksum, reverse ? mutation.before : mutation.after);
		yield;
	}
	checksum.addNumbers([transition.equipmentGroupChanges.length]);
	for (const mutation of transition.equipmentGroupChanges) {
		checksum.addNumbers([mutation.id]);
		if (boundedRecords) {
			yield* addEquipmentGroupRecordSteps(checksum, reverse ? mutation.after : mutation.before);
			yield* addEquipmentGroupRecordSteps(checksum, reverse ? mutation.before : mutation.after);
		} else {
			addEquipmentGroupRecord(checksum, reverse ? mutation.after : mutation.before);
			addEquipmentGroupRecord(checksum, reverse ? mutation.before : mutation.after);
		}
		yield;
	}
	checksum.addNumbers([transition.organizationChanges.length]);
	for (const mutation of transition.organizationChanges) {
		checksum.addNumbers([mutation.id]);
		if (boundedRecords) {
			yield* addOrganizationRecordSteps(checksum, reverse ? mutation.after : mutation.before);
			yield* addOrganizationRecordSteps(checksum, reverse ? mutation.before : mutation.after);
		} else {
			addOrganizationRecord(checksum, reverse ? mutation.after : mutation.before);
			addOrganizationRecord(checksum, reverse ? mutation.before : mutation.after);
		}
		yield;
	}
	checksum.addNumbers([relationshipChanges.length]);
	for (const mutation of relationshipChanges) {
		checksum.addNumbers([mutation.id]);
		if (boundedRecords) {
			yield* addAssemblyRelationshipRecordSteps(
				checksum,
				reverse ? mutation.after : mutation.before,
			);
			yield* addAssemblyRelationshipRecordSteps(
				checksum,
				reverse ? mutation.before : mutation.after,
			);
		} else {
			addAssemblyRelationshipRecord(checksum, reverse ? mutation.after : mutation.before);
			addAssemblyRelationshipRecord(checksum, reverse ? mutation.before : mutation.after);
		}
		yield;
	}
	if (boundedRecords)
		yield* checksum.addNumbersSteps(transition.organizationImpactAuthorizations ?? []);
	else checksum.addNumbers(transition.organizationImpactAuthorizations ?? []);
	checksum.addString(
		operationalConfigurationPatchTransitionFingerprint(
			transition.operationalConfigurationPatch,
			reverse,
		),
	);
	return checksum.digest();
}

/** Preserve the legacy V5 contract, including mutable records, with per-mutation checkpoints. */
export async function railPatchTransitionFingerprintCooperatively(
	transition: RailPatchTransition,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
	reverse = false,
): Promise<string> {
	return finishHistorySteps(
		transitionFingerprintSteps(transition, reverse, false),
		checkpoint,
		operationBudget,
	);
}

async function finishHistorySteps<T>(
	steps: Generator<void, T>,
	checkpoint: () => Promise<void>,
	operationBudget: number,
): Promise<T> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Rail patch fingerprint operation budget must be positive.");
	}
	const task = createCooperativeTask(steps);
	while (!task.done) {
		task.step(operationBudget);
		await checkpoint();
	}
	return task.finish();
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

/** Fully bounded deep-record ledger preparation for immutable addition-only commands. */
export async function createRailMirrorHistoryAdditionLedgerEntryCooperatively(
	originKind: RailHistoryOriginKind,
	transition: RailPatchTransition,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<RailMirrorHistoryLedgerEntry> {
	await finishHistorySteps(assertAdditionTransitionSteps(transition), checkpoint, operationBudget);
	const footprint = await finishHistorySteps(
		staticFabAssemblyRelationshipAdditionFootprintSteps(
			transition.relationshipChanges ?? Object.freeze([]),
		),
		checkpoint,
		operationBudget,
	);
	const forwardFingerprint = await finishHistorySteps(
		transitionFingerprintSteps(transition, false, true),
		checkpoint,
		operationBudget,
	);
	const reverseFingerprint = await finishHistorySteps(
		transitionFingerprintSteps(transition, true, true),
		checkpoint,
		operationBudget,
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

function* assertAdditionTransitionSteps(transition: RailPatchTransition): Generator<void> {
	if (
		!Object.isFrozen(transition) ||
		(transition.operationalConfigurationPatch ?? null) !== null ||
		(transition.organizationImpactAuthorizations?.length ?? 0) !== 0
	) {
		throw new Error("Prepared addition history requires immutable static-only changes.");
	}
	if (!Object.isFrozen(transition.changes)) throw new Error("Rail additions must be immutable.");
	for (const change of transition.changes) {
		yield;
		if (!Object.isFrozen(change) || change.before !== 0 || change.after === 0)
			throw new Error("Prepared rail history requires nonempty additions.");
	}
	for (const changes of [
		transition.switchChanges,
		transition.portChanges,
		transition.equipmentGroupChanges,
		transition.organizationChanges,
	]) {
		if (!Object.isFrozen(changes)) throw new Error("Record additions must be immutable.");
		for (const change of changes) {
			yield;
			if (!Object.isFrozen(change) || change.before !== null || change.after === null)
				throw new Error("Prepared record history requires nonempty additions.");
		}
	}
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

/** Prepare a new bounded history without modifying the live stack between checkpoints. */
export function* prepareRailHistoryAppendSteps<T>(
	history: readonly T[],
	entry: T,
	ledgerFor: (entry: T) => RailMirrorHistoryLedgerEntry,
	entryLimit = RAIL_MIRROR_HISTORY_ENTRY_LIMIT,
): Generator<void, T[]> {
	if (!Number.isSafeInteger(entryLimit) || entryLimit < 1) {
		throw new Error("Rail history entry limit must be a positive safe integer.");
	}
	const historyLength = history.length;
	const length = historyLength + 1;
	const first = yield* railHistoryRetainedSuffixSteps(
		length,
		(index) => ledgerFor(index === historyLength ? entry : (history[index] as T)),
		Math.max(0, length - entryLimit),
	);
	const retained: T[] = [];
	for (let index = first; index < length; index++) {
		retained.push(index === historyLength ? entry : (history[index] as T));
		yield;
	}
	return retained;
}

export function trimRailMirrorHistoryRelationshipBudget<T extends RailMirrorHistoryLedgerEntry>(
	undo: T[],
	redo: T[],
): void {
	const undoLength = undo.length;
	const first = completeCooperativeSteps(
		railHistoryRetainedSuffixSteps(
			undoLength + redo.length,
			(index) => (index < undoLength ? undo[index] : redo[index - undoLength]) as T,
		),
	);
	if (first > 0) undo.splice(0, Math.min(first, undoLength));
	if (first > undoLength) redo.splice(0, first - undoLength);
}

/** Valid admitted footprints are nonnegative: oldest-first eviction retains this exact suffix. */
function* railHistoryRetainedSuffixSteps(
	length: number,
	ledgerAt: (index: number) => RailMirrorHistoryLedgerEntry,
	minimumStart = 0,
): Generator<void, number> {
	let first = length;
	let edges = 0;
	let owners = 0;
	let bytes = 0;
	for (let index = length - 1; index >= minimumStart; index--) {
		const entry = ledgerAt(index);
		edges += entry.relationshipEdgeReferences;
		owners += entry.relationshipOwnerIds;
		bytes += entry.relationshipCanonicalBytes;
		if (
			edges > RAIL_MIRROR_HISTORY_RELATIONSHIP_EDGE_REFERENCE_LIMIT ||
			owners > RAIL_MIRROR_HISTORY_RELATIONSHIP_OWNER_ID_LIMIT ||
			bytes > RAIL_MIRROR_HISTORY_RELATIONSHIP_CANONICAL_BYTE_LIMIT
		) {
			return first;
		}
		first = index;
		yield;
	}
	return first;
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
	return (
		completeCooperativeSteps(
			railHistoryRetainedSuffixSteps(
				undo.length + redo.length,
				(index) =>
					(index < undo.length
						? undo[index]
						: redo[index - undo.length]) as RailMirrorHistoryLedgerEntry,
			),
		) === 0
	);
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

function* addEquipmentGroupRecordSteps(
	checksum: OrderedTypedChecksum,
	record: EquipmentGroupRecord | null,
): Generator<void> {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	yield* checksum.addNumberSequenceSteps(record.portIds.length + 3, (index) => {
		if (index === 0) return 1;
		if (index === 1) return record.id;
		if (index === 2) return record.portIds.length;
		return record.portIds[index - 3] as number;
	});
	checksum.addStrings([record.kind]);
	if (record.kind === "EQ") {
		checksum.addNumbers([record.pitchMillimeters]);
		checksum.addStrings([record.recipe ?? ""]);
	} else checksum.addStrings([record.template]);
}

function* addOrganizationRecordSteps(
	checksum: OrderedTypedChecksum,
	record: StaticFabOrganizationRecord | null,
): Generator<void> {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	if (!isCanonicalStaticFabOrganizationRecord(record))
		throw new Error("Prepared history requires canonical organizations.");
	const membership = record.membership;
	const accumulator = createStaticFabOrganizationMembershipFingerprintAccumulator();
	for (let i = 0; i < membership.railEdges.length; i++) {
		yield;
		accumulator.addRailEdge(i, membership.railEdges[i] as DirectedRailEdge);
	}
	for (let i = 0; i < membership.advancedSwitchIds.length; i++) {
		yield;
		accumulator.addAdvancedSwitchId(i, membership.advancedSwitchIds[i] as number);
	}
	for (let i = 0; i < membership.equipmentGroupIds.length; i++) {
		yield;
		accumulator.addEquipmentGroupId(i, membership.equipmentGroupIds[i] as number);
	}
	const fingerprint = composeStaticFabOrganizationFingerprint(record, accumulator.finish());
	checksum.addNumbers([1, fingerprint.xor, fingerprint.sum]);
}

function* addAssemblyRelationshipRecordSteps(
	checksum: OrderedTypedChecksum,
	record: StaticFabAssemblyRelationshipRecordV1 | null,
): Generator<void> {
	if (!record) {
		checksum.addNumbers([0]);
		return;
	}
	checksum.addNumbers([1]);
	checksum.addString(yield* checksumStaticFabAssemblyRelationshipRecordSteps(record));
}
