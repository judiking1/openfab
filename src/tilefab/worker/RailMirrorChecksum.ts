import {
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	advancedSwitchRecordError,
} from "../core/AdvancedSwitch";
import { createCooperativeTask } from "../core/CooperativeTask";
import {
	type EquipmentGroupMutation,
	type EquipmentGroupRecord,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import { type PortMutation, type PortRecord, portRecordError } from "../core/PortRecord";
import type { RailMutation } from "../core/paint";
import { bitCount } from "../core/railShape";
import {
	checksumStaticFabAssemblyRelationshipRecord,
	checksumStaticFabAssemblyRelationshipRecordSteps,
	emptyStaticFabAssemblyRelationshipState,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
} from "../core/StaticFabAssemblyRelationship";
import {
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import type {
	StaticFabOrganizationDiagnosticRecord,
	StaticFabOrganizationIssueSourceState,
} from "../core/StaticFabOrganizationIssues";
import type { TileMap } from "../core/TileMap";
import {
	type AdvancedSwitchRecordFieldsSoA,
	createAdvancedSwitchRecordFields,
	encodeAdvancedSwitchProfileClass,
	readAdvancedSwitchRecord,
	validateAdvancedSwitchRecordFieldLengths,
	writeAdvancedSwitchRecord,
} from "./AdvancedSwitchSoA";
import {
	createPortEquipmentSnapshot,
	hydratePortEquipmentSnapshotRecords,
	type PortEquipmentSnapshot,
	validatePortEquipmentSnapshotShape,
} from "./PortEquipmentSoA";
import {
	createStaticFabAssemblyRelationshipSnapshot,
	hydrateStaticFabAssemblyRelationshipSnapshot,
	type StaticFabAssemblyRelationshipSnapshot,
} from "./StaticFabAssemblyRelationshipSoA";
import {
	cachedStaticFabOrganizationMembershipFingerprint,
	cacheStaticFabOrganizationMembershipFingerprint,
	composeStaticFabOrganizationFingerprint,
	type StaticFabOrganizationFingerprint as OrganizationHashPair,
	staticFabOrganizationFingerprint,
} from "./StaticFabOrganizationFingerprint";
import {
	createStaticFabOrganizationSnapshot,
	hydrateStaticFabOrganizationDiagnosticSnapshot,
	hydrateStaticFabOrganizationSnapshot,
	type StaticFabOrganizationSnapshot,
	validateStaticFabOrganizationSnapshotStructure,
} from "./StaticFabOrganizationSoA";
import { isTransferableTypedArray } from "./TransferableTypedArray";

export interface RailMirrorSnapshot {
	sequence: number;
	revision: number;
	nextAdvancedSwitchId: number;
	xs: Int32Array;
	ys: Int32Array;
	encoded: Uint8Array;
	switchIds: Int32Array;
	switchRecords: AdvancedSwitchRecordFieldsSoA;
	portEquipment: PortEquipmentSnapshot;
	organizations: StaticFabOrganizationSnapshot;
	relationships: StaticFabAssemblyRelationshipSnapshot;
	checksum: string;
}

export interface RailMirrorSnapshotCapture {
	snapshot: RailMirrorSnapshot;
	checksum: RailChecksumAccumulator;
}

/**
 * One-shot main-realm capability for adopting a snapshot transferred from the authoritative rail
 * mirror Worker. The capability is bound to the exact live authored generations before the Worker
 * request is posted; copied capability objects and stale generations cannot mint capture authority.
 */
export interface RailMirrorSnapshotCaptureHandoff {
	readonly token: object;
}

export interface RailChecksumPatchInput {
	readonly changes: readonly RailMutation[];
	readonly switchChanges: readonly AdvancedSwitchMutation[];
	readonly portChanges: readonly PortMutation[];
	readonly equipmentGroupChanges: readonly EquipmentGroupMutation[];
	readonly organizationChanges: readonly StaticFabOrganizationMutation[];
	readonly organizationNextIdBefore: number;
	readonly organizationNextIdAfter: number;
	readonly relationshipChanges?: readonly StaticFabAssemblyRelationshipMutationV1[];
	readonly relationshipNextIdBefore?: number;
	readonly relationshipNextIdAfter?: number;
}

interface RailMirrorSnapshotCaptureAuthority {
	readonly map: TileMap;
	readonly sequence: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly relationshipSnapshot?: StaticFabAssemblyRelationshipSnapshot;
	readonly checksum: string;
}

const capturedSnapshotAuthorities = new WeakMap<object, RailMirrorSnapshotCaptureAuthority>();
const pendingSnapshotCaptureHandoffs = new WeakMap<object, RailMirrorSnapshotCaptureAuthority>();
const EMPTY_CAPTURE_RELATIONSHIPS = emptyStaticFabAssemblyRelationshipState();

const HASH_SEED_A = 0x811c9dc5;
const HASH_SEED_B = 0x9e3779b9;

/** Order-independent incremental fingerprint for the sparse directed-cell graph. */
export class RailChecksumAccumulator {
	private xorHash = 0;
	private sumHash = 0;
	private currentCells = 0;
	private currentEdges = 0;
	private currentSwitches = 0;
	private currentPorts = 0;
	private currentEquipmentGroups = 0;
	private currentOrganizations = 0;
	private currentOrganizationNextId = 1;
	private currentAssemblyRelationships = 0;
	private currentAssemblyRelationshipNextId = 1;

	static fromDigest(digest: string): RailChecksumAccumulator {
		const fields = digest.split(":");
		if (
			fields.length !== 12 ||
			fields[0] !== "00000002" ||
			fields.some((field) => !/^[0-9a-f]{8}$/.test(field))
		) {
			throw new Error(`Invalid rail checksum digest ${digest}.`);
		}
		const values = fields.map((field) => Number.parseInt(field, 16) >>> 0);
		const accumulator = new RailChecksumAccumulator();
		accumulator.currentCells = values[1] as number;
		accumulator.currentEdges = values[2] as number;
		accumulator.currentSwitches = values[3] as number;
		accumulator.currentPorts = values[4] as number;
		accumulator.currentEquipmentGroups = values[5] as number;
		accumulator.currentOrganizations = values[6] as number;
		accumulator.setOrganizationNextId(values[7] as number);
		accumulator.currentAssemblyRelationships = values[8] as number;
		accumulator.setAssemblyRelationshipNextId(values[9] as number);
		accumulator.xorHash = values[10] as number;
		accumulator.sumHash = values[11] as number;
		return accumulator;
	}

	get cellCount(): number {
		return this.currentCells;
	}

	get edgeCount(): number {
		return this.currentEdges;
	}

	get switchCount(): number {
		return this.currentSwitches;
	}

	get portCount(): number {
		return this.currentPorts;
	}

	get equipmentGroupCount(): number {
		return this.currentEquipmentGroups;
	}

	get organizationCount(): number {
		return this.currentOrganizations;
	}

	get organizationNextId(): number {
		return this.currentOrganizationNextId;
	}

	get assemblyRelationshipCount(): number {
		return this.currentAssemblyRelationships;
	}

	get assemblyRelationshipNextId(): number {
		return this.currentAssemblyRelationshipNextId;
	}

	setOrganizationNextId(nextOrganizationId: number): void {
		assertOrganizationNextId(nextOrganizationId, "organization ID cursor");
		this.currentOrganizationNextId = nextOrganizationId;
	}

	/** Preserve a raw signed-int32 cursor while checksum-verifying a diagnostic-only snapshot. */
	setDiagnosticOrganizationNextId(nextOrganizationId: number): void {
		assertDiagnosticOrganizationNextId(nextOrganizationId, "diagnostic organization ID cursor");
		this.currentOrganizationNextId = nextOrganizationId;
	}

	applyOrganizationNextId(nextOrganizationIdBefore: number, nextOrganizationIdAfter: number): void {
		assertOrganizationNextId(nextOrganizationIdBefore, "organization ID cursor before");
		assertOrganizationNextId(nextOrganizationIdAfter, "organization ID cursor after");
		if (this.currentOrganizationNextId !== nextOrganizationIdBefore) {
			throw new Error(
				`Organization ID cursor checksum mismatch: expected ${this.currentOrganizationNextId}, received ${nextOrganizationIdBefore}.`,
			);
		}
		this.currentOrganizationNextId = nextOrganizationIdAfter;
	}

	setAssemblyRelationshipNextId(nextRelationshipId: number): void {
		assertOrganizationNextId(nextRelationshipId, "assembly relationship ID cursor");
		this.currentAssemblyRelationshipNextId = nextRelationshipId;
	}

	applyAssemblyRelationshipNextId(
		nextRelationshipIdBefore: number,
		nextRelationshipIdAfter: number,
	): void {
		assertOrganizationNextId(nextRelationshipIdBefore, "assembly relationship ID cursor before");
		assertOrganizationNextId(nextRelationshipIdAfter, "assembly relationship ID cursor after");
		if (this.currentAssemblyRelationshipNextId !== nextRelationshipIdBefore) {
			throw new Error(
				`Assembly relationship ID cursor checksum mismatch: expected ${this.currentAssemblyRelationshipNextId}, received ${nextRelationshipIdBefore}.`,
			);
		}
		this.currentAssemblyRelationshipNextId = nextRelationshipIdAfter;
	}

	addCell(x: number, y: number, encoded: number): void {
		const value = encoded & 0xff;
		if (value === 0) return;
		this.xorHash = (this.xorHash ^ hashCell(x, y, value, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash + hashCell(x, y, value, HASH_SEED_B)) >>> 0;
		this.currentCells++;
		this.currentEdges += bitCount((value >> 4) & 15);
	}

	removeCell(x: number, y: number, encoded: number): void {
		const value = encoded & 0xff;
		if (value === 0) return;
		this.xorHash = (this.xorHash ^ hashCell(x, y, value, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash - hashCell(x, y, value, HASH_SEED_B)) >>> 0;
		this.currentCells--;
		this.currentEdges -= bitCount((value >> 4) & 15);
	}

	applyMutation(mutation: RailMutation): void {
		this.removeCell(mutation.x, mutation.y, mutation.before);
		this.addCell(mutation.x, mutation.y, mutation.after);
	}

	addSwitch(record: AdvancedSwitchRecord): void {
		const error = advancedSwitchRecordError(record);
		if (error) throw new Error(`Advanced switch ${record.id}: ${error}.`);
		this.xorHash = (this.xorHash ^ hashSwitch(record, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash + hashSwitch(record, HASH_SEED_B)) >>> 0;
		this.currentSwitches++;
	}

	removeSwitch(record: AdvancedSwitchRecord): void {
		this.xorHash = (this.xorHash ^ hashSwitch(record, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash - hashSwitch(record, HASH_SEED_B)) >>> 0;
		this.currentSwitches--;
	}

	applySwitchMutation(mutation: AdvancedSwitchMutation): void {
		if (mutation.before) this.removeSwitch(mutation.before);
		if (mutation.after) this.addSwitch(mutation.after);
	}

	addPort(record: PortRecord): void {
		const error = portRecordError(record);
		if (error) throw new Error(`Port ${record.id}: ${error}.`);
		this.xorHash = (this.xorHash ^ hashPort(record, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash + hashPort(record, HASH_SEED_B)) >>> 0;
		this.currentPorts++;
	}

	removePort(record: PortRecord): void {
		this.xorHash = (this.xorHash ^ hashPort(record, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash - hashPort(record, HASH_SEED_B)) >>> 0;
		this.currentPorts--;
	}

	applyPortMutation(mutation: PortMutation): void {
		if (mutation.before) this.removePort(mutation.before);
		if (mutation.after) this.addPort(mutation.after);
	}

	addEquipmentGroup(record: EquipmentGroupRecord): void {
		this.xorHash = (this.xorHash ^ hashEquipmentGroup(record, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash + hashEquipmentGroup(record, HASH_SEED_B)) >>> 0;
		this.currentEquipmentGroups++;
	}

	removeEquipmentGroup(record: EquipmentGroupRecord): void {
		this.xorHash = (this.xorHash ^ hashEquipmentGroup(record, HASH_SEED_A)) >>> 0;
		this.sumHash = (this.sumHash - hashEquipmentGroup(record, HASH_SEED_B)) >>> 0;
		this.currentEquipmentGroups--;
	}

	applyEquipmentGroupMutation(mutation: EquipmentGroupMutation): void {
		if (mutation.before) this.removeEquipmentGroup(mutation.before);
		if (mutation.after) this.addEquipmentGroup(mutation.after);
	}

	addOrganization(record: StaticFabOrganizationRecord): void {
		const hashes = this.organizationHashes(record);
		this.xorHash = (this.xorHash ^ hashes.xor) >>> 0;
		this.sumHash = (this.sumHash + hashes.sum) >>> 0;
		this.currentOrganizations++;
		if (record.id >= this.currentOrganizationNextId) {
			this.setOrganizationNextId(record.id + 1);
		}
	}

	/** Hash one raw organization row without normalizing its cursor or authored record order. */
	addDiagnosticOrganization(
		record: StaticFabOrganizationDiagnosticRecord | StaticFabOrganizationRecord,
	): void {
		const hashes = staticFabOrganizationFingerprint(record as StaticFabOrganizationRecord);
		this.xorHash = (this.xorHash ^ hashes.xor) >>> 0;
		this.sumHash = (this.sumHash + hashes.sum) >>> 0;
		this.currentOrganizations++;
	}

	async addOrganizationCooperatively(
		record: StaticFabOrganizationRecord,
		checkpoint: () => Promise<void>,
		operationBudget = 256,
	): Promise<void> {
		if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
			throw new Error("Organization checksum operation budget must be a positive safe integer.");
		}
		const hashes = await this.organizationHashesCooperatively(record, checkpoint, operationBudget);
		this.xorHash = (this.xorHash ^ hashes.xor) >>> 0;
		this.sumHash = (this.sumHash + hashes.sum) >>> 0;
		this.currentOrganizations++;
		if (record.id >= this.currentOrganizationNextId) {
			this.setOrganizationNextId(record.id + 1);
		}
	}

	removeOrganization(record: StaticFabOrganizationRecord): void {
		const hashes = this.organizationHashes(record);
		this.xorHash = (this.xorHash ^ hashes.xor) >>> 0;
		this.sumHash = (this.sumHash - hashes.sum) >>> 0;
		this.currentOrganizations--;
	}

	applyOrganizationMutation(mutation: StaticFabOrganizationMutation): void {
		if (mutation.before) this.removeOrganization(mutation.before);
		if (mutation.after) this.addOrganization(mutation.after);
	}

	addAssemblyRelationship(record: StaticFabAssemblyRelationshipRecordV1): void {
		const fingerprint = assemblyRelationshipRecordFingerprint(record);
		this.xorHash = (this.xorHash ^ fingerprint.xor) >>> 0;
		this.sumHash = (this.sumHash + fingerprint.sum) >>> 0;
		this.currentAssemblyRelationships++;
		if (record.id >= this.currentAssemblyRelationshipNextId) {
			this.setAssemblyRelationshipNextId(record.id + 1);
		}
	}

	async addAssemblyRelationshipCooperatively(
		record: StaticFabAssemblyRelationshipRecordV1,
		checkpoint: () => Promise<void>,
		operationBudget = 256,
	): Promise<void> {
		const task = createCooperativeTask(checksumStaticFabAssemblyRelationshipRecordSteps(record));
		while (!task.done) {
			task.step(operationBudget);
			await checkpoint();
		}
		const fingerprint = assemblyRelationshipDigestFingerprint(task.finish());
		this.xorHash = (this.xorHash ^ fingerprint.xor) >>> 0;
		this.sumHash = (this.sumHash + fingerprint.sum) >>> 0;
		this.currentAssemblyRelationships++;
		if (record.id >= this.currentAssemblyRelationshipNextId)
			this.setAssemblyRelationshipNextId(record.id + 1);
	}

	removeAssemblyRelationship(record: StaticFabAssemblyRelationshipRecordV1): void {
		const fingerprint = assemblyRelationshipRecordFingerprint(record);
		this.xorHash = (this.xorHash ^ fingerprint.xor) >>> 0;
		this.sumHash = (this.sumHash - fingerprint.sum) >>> 0;
		this.currentAssemblyRelationships--;
	}

	applyAssemblyRelationshipMutation(mutation: StaticFabAssemblyRelationshipMutationV1): void {
		if (mutation.before) this.removeAssemblyRelationship(mutation.before);
		if (mutation.after) this.addAssemblyRelationship(mutation.after);
	}

	clone(): RailChecksumAccumulator {
		const clone = new RailChecksumAccumulator();
		clone.xorHash = this.xorHash;
		clone.sumHash = this.sumHash;
		clone.currentCells = this.currentCells;
		clone.currentEdges = this.currentEdges;
		clone.currentSwitches = this.currentSwitches;
		clone.currentPorts = this.currentPorts;
		clone.currentEquipmentGroups = this.currentEquipmentGroups;
		clone.currentOrganizations = this.currentOrganizations;
		clone.currentOrganizationNextId = this.currentOrganizationNextId;
		clone.currentAssemblyRelationships = this.currentAssemblyRelationships;
		clone.currentAssemblyRelationshipNextId = this.currentAssemblyRelationshipNextId;
		return clone;
	}

	private organizationHashes(record: StaticFabOrganizationRecord): OrganizationHashPair {
		return staticFabOrganizationFingerprint(record);
	}

	private async organizationHashesCooperatively(
		record: StaticFabOrganizationRecord,
		checkpoint: () => Promise<void>,
		operationBudget: number,
	): Promise<OrganizationHashPair> {
		let membershipHashes = cachedStaticFabOrganizationMembershipFingerprint(record.membership);
		if (!membershipHashes) {
			membershipHashes = await hashOrganizationMembershipCooperatively(
				record.membership,
				checkpoint,
				operationBudget,
			);
			cacheStaticFabOrganizationMembershipFingerprint(record.membership, membershipHashes);
		}
		return composeStaticFabOrganizationFingerprint(record, membershipHashes);
	}

	digest(): string {
		return [
			2,
			this.currentCells,
			this.currentEdges,
			this.currentSwitches,
			this.currentPorts,
			this.currentEquipmentGroups,
			this.currentOrganizations,
			this.currentOrganizationNextId,
			this.currentAssemblyRelationships,
			this.currentAssemblyRelationshipNextId,
			this.xorHash,
			this.sumHash,
		]
			.map(hex32)
			.join(":");
	}
}

export function captureRailMirrorSnapshot(
	map: TileMap,
	sequence: number,
	portEquipment: PortEquipmentState = emptyPortEquipmentState(),
	organizations: StaticFabOrganizationState = emptyStaticFabOrganizationState(),
	relationships: StaticFabAssemblyRelationshipStateV1 = EMPTY_CAPTURE_RELATIONSHIPS,
): RailMirrorSnapshotCapture {
	const xs = new Int32Array(map.size);
	const ys = new Int32Array(map.size);
	const encoded = new Uint8Array(map.size);
	const switchIds = new Int32Array(map.advancedSwitchCount);
	const switchRecords = createAdvancedSwitchRecordFields(map.advancedSwitchCount);
	const checksum = new RailChecksumAccumulator();
	let index = 0;
	map.forEachRail((x, y, _rail, value) => {
		assertInt32Coordinate(x, "x");
		assertInt32Coordinate(y, "y");
		xs[index] = x;
		ys[index] = y;
		encoded[index] = value;
		checksum.addCell(x, y, value);
		index++;
	});
	let switchIndex = 0;
	map.forEachAdvancedSwitch((record) => {
		assertInt32Coordinate(record.origin.x, "advanced switch origin x");
		assertInt32Coordinate(record.origin.y, "advanced switch origin y");
		switchIds[switchIndex] = record.id;
		writeAdvancedSwitchRecord(switchRecords, switchIndex, record);
		checksum.addSwitch(record);
		switchIndex++;
	});
	const portEquipmentSnapshot = createPortEquipmentSnapshot(portEquipment);
	for (const port of portEquipment.ports) checksum.addPort(port);
	for (const group of portEquipment.equipmentGroups) checksum.addEquipmentGroup(group);
	const organizationSnapshot = createStaticFabOrganizationSnapshot(organizations);
	for (const record of organizations.records) checksum.addOrganization(record);
	checksum.setOrganizationNextId(organizations.nextOrganizationId);
	const relationshipSnapshot = createStaticFabAssemblyRelationshipSnapshot(relationships);
	for (const record of relationships.records) checksum.addAssemblyRelationship(record);
	checksum.setAssemblyRelationshipNextId(relationships.nextRelationshipId);
	const snapshot: RailMirrorSnapshot = {
		sequence,
		revision: map.getRevision(),
		nextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
		xs,
		ys,
		encoded,
		switchIds,
		switchRecords,
		portEquipment: portEquipmentSnapshot,
		organizations: organizationSnapshot,
		relationships: relationshipSnapshot,
		checksum: checksum.digest(),
	};
	capturedSnapshotAuthorities.set(
		snapshot,
		Object.freeze({
			map,
			sequence,
			portEquipment,
			organizations,
			relationships,
			relationshipSnapshot: snapshot.relationships,
			checksum: snapshot.checksum,
		}),
	);
	return { snapshot, checksum };
}

/**
 * Issue one source-bound capability before asking the already-synchronized rail mirror Worker for
 * a fresh transferable snapshot. This does not traverse or allocate the authored map.
 */
export function issueRailMirrorSnapshotCaptureHandoff(
	map: TileMap,
	sequence: number,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	checksum: string,
): RailMirrorSnapshotCaptureHandoff {
	if (!Number.isSafeInteger(sequence) || sequence < 0) {
		throw new Error("Rail snapshot handoff sequence must be a non-negative safe integer.");
	}
	const accumulator = RailChecksumAccumulator.fromDigest(checksum);
	if (
		accumulator.cellCount !== map.size ||
		accumulator.switchCount !== map.advancedSwitchCount ||
		accumulator.portCount !== portEquipment.ports.length ||
		accumulator.equipmentGroupCount !== portEquipment.equipmentGroups.length ||
		accumulator.organizationCount !== organizations.records.length ||
		accumulator.organizationNextId !== organizations.nextOrganizationId ||
		accumulator.assemblyRelationshipCount !== relationships.records.length ||
		accumulator.assemblyRelationshipNextId !== relationships.nextRelationshipId
	) {
		throw new Error("Rail snapshot handoff checksum counters do not match the live source.");
	}
	const token = Object.freeze({});
	pendingSnapshotCaptureHandoffs.set(
		token,
		Object.freeze({ map, sequence, portEquipment, organizations, relationships, checksum }),
	);
	return Object.freeze({ token });
}

/**
 * Adopt a transferred mirror snapshot into the existing exact-capture authority contract. The
 * connector Worker still independently hydrates and checks every byte before certification.
 */
export function adoptRailMirrorSnapshotCaptureHandoff(
	handoff: RailMirrorSnapshotCaptureHandoff,
	snapshot: RailMirrorSnapshot,
): boolean {
	const token = handoff.token;
	const authority = pendingSnapshotCaptureHandoffs.get(token);
	pendingSnapshotCaptureHandoffs.delete(token);
	if (!authority || !snapshotMatchesCaptureHandoff(snapshot, authority)) return false;
	capturedSnapshotAuthorities.set(
		snapshot,
		Object.freeze({ ...authority, relationshipSnapshot: snapshot.relationships }),
	);
	return true;
}

export function revokeRailMirrorSnapshotCaptureHandoff(
	handoff: RailMirrorSnapshotCaptureHandoff,
): void {
	pendingSnapshotCaptureHandoffs.delete(handoff.token);
}

/**
 * Consume proof that this exact snapshot object was captured from the exact live authored
 * generations. A copied or decoy snapshot can match counters but cannot borrow this authority.
 */
export function consumeRailMirrorSnapshotCaptureAuthority(
	snapshot: RailMirrorSnapshot,
	map: TileMap,
	sequence: number,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): boolean {
	const authority = capturedSnapshotAuthorities.get(snapshot);
	capturedSnapshotAuthorities.delete(snapshot);
	return (
		authority?.map === map &&
		authority.sequence === sequence &&
		authority.portEquipment === portEquipment &&
		authority.organizations === organizations &&
		authority.relationships === relationships &&
		authority.relationshipSnapshot === snapshot.relationships &&
		authority.checksum === snapshot.checksum &&
		snapshot.sequence === sequence &&
		snapshot.revision === map.getRevision() &&
		snapshot.nextAdvancedSwitchId === map.getAdvancedSwitchIdCursor() &&
		snapshot.portEquipment.nextPortId === portEquipment.nextPortId &&
		snapshot.portEquipment.nextEquipmentGroupId === portEquipment.nextEquipmentGroupId &&
		snapshot.organizations.nextOrganizationId === organizations.nextOrganizationId &&
		snapshot.relationships.nextRelationshipId === relationships.nextRelationshipId
	);
}

/** Revoke an authoritative snapshot that will not be handed to another disposable Worker. */
export function revokeRailMirrorSnapshotCaptureAuthority(snapshot: RailMirrorSnapshot): void {
	capturedSnapshotAuthorities.delete(snapshot);
}

function snapshotMatchesCaptureHandoff(
	snapshot: RailMirrorSnapshot,
	authority: RailMirrorSnapshotCaptureAuthority,
): boolean {
	try {
		const checksum = RailChecksumAccumulator.fromDigest(authority.checksum);
		if (
			authority.map.getRevision() !== snapshot.revision ||
			authority.map.getAdvancedSwitchIdCursor() !== snapshot.nextAdvancedSwitchId ||
			authority.portEquipment.nextPortId !== snapshot.portEquipment.nextPortId ||
			authority.portEquipment.nextEquipmentGroupId !==
				snapshot.portEquipment.nextEquipmentGroupId ||
			authority.organizations.nextOrganizationId !== snapshot.organizations.nextOrganizationId ||
			authority.relationships.nextRelationshipId !== snapshot.relationships.nextRelationshipId ||
			snapshot.sequence !== authority.sequence ||
			snapshot.checksum !== authority.checksum ||
			!isTransferableTypedArray(snapshot.xs, Int32Array) ||
			!isTransferableTypedArray(snapshot.ys, Int32Array) ||
			!isTransferableTypedArray(snapshot.encoded, Uint8Array) ||
			!isTransferableTypedArray(snapshot.switchIds, Int32Array) ||
			snapshot.xs.length !== checksum.cellCount ||
			snapshot.ys.length !== checksum.cellCount ||
			snapshot.encoded.length !== checksum.cellCount ||
			snapshot.switchIds.length !== checksum.switchCount
		) {
			return false;
		}
		validateAdvancedSwitchRecordFieldLengths(
			snapshot.switchRecords,
			checksum.switchCount,
			"Rail snapshot handoff",
		);
		validatePortEquipmentSnapshotShape(snapshot.portEquipment);
		validateStaticFabOrganizationSnapshotStructure(snapshot.organizations);
		const relationships = hydrateStaticFabAssemblyRelationshipSnapshot(snapshot.relationships);
		return (
			snapshot.portEquipment.portIds.length === checksum.portCount &&
			snapshot.portEquipment.equipmentGroupIds.length === checksum.equipmentGroupCount &&
			snapshot.organizations.organizationIds.length === checksum.organizationCount &&
			relationships.records.length === checksum.assemblyRelationshipCount
		);
	} catch {
		return false;
	}
}

/** Predict the canonical post-patch checksum without cloning or traversing the authored map. */
export function checksumRailPatchResult(
	sourceChecksum: string,
	patch: RailChecksumPatchInput,
): string {
	const checksum = RailChecksumAccumulator.fromDigest(sourceChecksum);
	checksum.applyOrganizationNextId(patch.organizationNextIdBefore, patch.organizationNextIdAfter);
	const relationshipNextIdBefore =
		patch.relationshipNextIdBefore ?? checksum.assemblyRelationshipNextId;
	const relationshipNextIdAfter = patch.relationshipNextIdAfter ?? relationshipNextIdBefore;
	checksum.applyAssemblyRelationshipNextId(relationshipNextIdBefore, relationshipNextIdAfter);
	for (const change of patch.changes) checksum.applyMutation(change);
	for (const change of patch.switchChanges) checksum.applySwitchMutation(change);
	for (const change of patch.portChanges) checksum.applyPortMutation(change);
	for (const change of patch.equipmentGroupChanges) {
		checksum.applyEquipmentGroupMutation(change);
	}
	for (const change of patch.organizationChanges) checksum.applyOrganizationMutation(change);
	for (const change of patch.relationshipChanges ?? []) {
		checksum.applyAssemblyRelationshipMutation(change);
	}
	return checksum.digest();
}

export async function checksumRailPatchResultCooperatively(
	sourceChecksum: string,
	patch: RailChecksumPatchInput,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<string> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Rail patch checksum operation budget must be positive.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const checksum = RailChecksumAccumulator.fromDigest(sourceChecksum);
	checksum.applyOrganizationNextId(patch.organizationNextIdBefore, patch.organizationNextIdAfter);
	const relationshipNextIdBefore =
		patch.relationshipNextIdBefore ?? checksum.assemblyRelationshipNextId;
	const relationshipNextIdAfter = patch.relationshipNextIdAfter ?? relationshipNextIdBefore;
	checksum.applyAssemblyRelationshipNextId(relationshipNextIdBefore, relationshipNextIdAfter);
	for (const change of patch.changes) {
		checksum.applyMutation(change);
		await consumeOperation();
	}
	for (const change of patch.switchChanges) {
		checksum.applySwitchMutation(change);
		await consumeOperation();
	}
	for (const change of patch.portChanges) {
		checksum.applyPortMutation(change);
		await consumeOperation();
	}
	for (const change of patch.equipmentGroupChanges) {
		checksum.applyEquipmentGroupMutation(change);
		await consumeOperation();
	}
	for (const change of patch.organizationChanges) {
		checksum.applyOrganizationMutation(change);
		await consumeOperation();
	}
	for (const change of patch.relationshipChanges ?? []) {
		checksum.applyAssemblyRelationshipMutation(change);
		await consumeOperation();
	}
	await checkpoint();
	return checksum.digest();
}

export function checksumRailMap(
	map: TileMap,
	portEquipment: PortEquipmentState = emptyPortEquipmentState(),
	organizations: StaticFabOrganizationState = emptyStaticFabOrganizationState(),
	relationships: StaticFabAssemblyRelationshipStateV1 = emptyStaticFabAssemblyRelationshipState(),
): string {
	const checksum = new RailChecksumAccumulator();
	map.forEachRail((x, y, _rail, encoded) => checksum.addCell(x, y, encoded));
	map.forEachAdvancedSwitch((record) => checksum.addSwitch(record));
	for (const port of portEquipment.ports) checksum.addPort(port);
	for (const group of portEquipment.equipmentGroups) checksum.addEquipmentGroup(group);
	for (const record of organizations.records) checksum.addOrganization(record);
	checksum.setOrganizationNextId(organizations.nextOrganizationId);
	for (const record of relationships.records) checksum.addAssemblyRelationship(record);
	checksum.setAssemblyRelationshipNextId(relationships.nextRelationshipId);
	return checksum.digest();
}

export async function checksumRailMapCooperatively(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
	relationships: StaticFabAssemblyRelationshipStateV1 = emptyStaticFabAssemblyRelationshipState(),
): Promise<string> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Rail map checksum operation budget must be positive.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const checksum = new RailChecksumAccumulator();
	await map.forEachRailCooperatively(
		(x, y, _rail, encoded) => checksum.addCell(x, y, encoded),
		checkpoint,
		operationBudget,
	);
	map.forEachAdvancedSwitch((record) => checksum.addSwitch(record));
	await checkpoint();
	for (const port of portEquipment.ports) {
		checksum.addPort(port);
		await consumeOperation();
	}
	for (const group of portEquipment.equipmentGroups) {
		checksum.addEquipmentGroup(group);
		await consumeOperation();
	}
	for (const record of organizations.records) {
		checksum.addOrganization(record);
		await consumeOperation();
	}
	checksum.setOrganizationNextId(organizations.nextOrganizationId);
	for (const record of relationships.records) {
		checksum.addAssemblyRelationship(record);
		await consumeOperation();
	}
	checksum.setAssemblyRelationshipNextId(relationships.nextRelationshipId);
	await checkpoint();
	return checksum.digest();
}

/**
 * Recompute the canonical mirror identity while preserving diagnostic-only organization faults.
 * For every valid organization state this is byte-for-byte identical to `checksumRailMap`.
 */
export function checksumRailMapDiagnostic(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationIssueSourceState,
	relationships: StaticFabAssemblyRelationshipStateV1 = emptyStaticFabAssemblyRelationshipState(),
): string {
	const checksum = new RailChecksumAccumulator();
	map.forEachRail((x, y, _rail, encoded) => checksum.addCell(x, y, encoded));
	map.forEachAdvancedSwitch((record) => checksum.addSwitch(record));
	for (const port of portEquipment.ports) checksum.addPort(port);
	for (const group of portEquipment.equipmentGroups) checksum.addEquipmentGroup(group);
	for (const record of organizations.records) checksum.addDiagnosticOrganization(record);
	checksum.setDiagnosticOrganizationNextId(organizations.nextOrganizationId);
	for (const record of relationships.records) checksum.addAssemblyRelationship(record);
	checksum.setAssemblyRelationshipNextId(relationships.nextRelationshipId);
	return checksum.digest();
}

/** Recompute a transferred snapshot identity before its buffers are handed to another Worker. */
export function checksumRailMirrorSnapshot(snapshot: RailMirrorSnapshot): string {
	if (
		!isTransferableTypedArray(snapshot.xs, Int32Array) ||
		!isTransferableTypedArray(snapshot.ys, Int32Array) ||
		!isTransferableTypedArray(snapshot.encoded, Uint8Array) ||
		!isTransferableTypedArray(snapshot.switchIds, Int32Array)
	) {
		throw new Error("Rail snapshot identity columns have invalid transferable typed arrays.");
	}
	if (snapshot.xs.length !== snapshot.ys.length || snapshot.xs.length !== snapshot.encoded.length) {
		throw new Error("Rail snapshot SoA lengths do not match.");
	}
	validateAdvancedSwitchRecordFieldLengths(
		snapshot.switchRecords,
		snapshot.switchIds.length,
		"Rail snapshot",
	);
	const checksum = new RailChecksumAccumulator();
	for (let index = 0; index < snapshot.encoded.length; index++) {
		const x = snapshot.xs[index] as number;
		const y = snapshot.ys[index] as number;
		const encoded = snapshot.encoded[index] as number;
		assertInt32Coordinate(x, "snapshot x");
		assertInt32Coordinate(y, "snapshot y");
		if (encoded === 0) throw new Error(`Rail snapshot cell ${index} is empty.`);
		checksum.addCell(x, y, encoded);
	}
	for (let index = 0; index < snapshot.switchIds.length; index++) {
		const id = snapshot.switchIds[index] as number;
		checksum.addSwitch(
			readAdvancedSwitchRecord(snapshot.switchRecords, index, id, `Rail snapshot switch ${id}`),
		);
	}
	const portEquipment = hydratePortEquipmentSnapshotRecords(snapshot.portEquipment);
	for (const port of portEquipment.ports) checksum.addPort(port);
	for (const group of portEquipment.equipmentGroups) checksum.addEquipmentGroup(group);
	const organizations = hydrateStaticFabOrganizationSnapshot(snapshot.organizations);
	for (const record of organizations.records) checksum.addOrganization(record);
	checksum.setOrganizationNextId(organizations.nextOrganizationId);
	const relationships = hydrateStaticFabAssemblyRelationshipSnapshot(snapshot.relationships);
	for (const record of relationships.records) checksum.addAssemblyRelationship(record);
	checksum.setAssemblyRelationshipNextId(relationships.nextRelationshipId);
	return checksum.digest();
}

/** Verify a transferred snapshot without erasing organization faults needed by CHECKS. */
export function checksumRailMirrorSnapshotDiagnostic(snapshot: RailMirrorSnapshot): string {
	if (
		!isTransferableTypedArray(snapshot.xs, Int32Array) ||
		!isTransferableTypedArray(snapshot.ys, Int32Array) ||
		!isTransferableTypedArray(snapshot.encoded, Uint8Array) ||
		!isTransferableTypedArray(snapshot.switchIds, Int32Array)
	) {
		throw new Error(
			"Rail diagnostic snapshot identity columns have invalid transferable typed arrays.",
		);
	}
	if (snapshot.xs.length !== snapshot.ys.length || snapshot.xs.length !== snapshot.encoded.length) {
		throw new Error("Rail diagnostic snapshot SoA lengths do not match.");
	}
	validateAdvancedSwitchRecordFieldLengths(
		snapshot.switchRecords,
		snapshot.switchIds.length,
		"Rail diagnostic snapshot",
	);
	const checksum = new RailChecksumAccumulator();
	for (let index = 0; index < snapshot.encoded.length; index++) {
		const x = snapshot.xs[index] as number;
		const y = snapshot.ys[index] as number;
		const encoded = snapshot.encoded[index] as number;
		assertInt32Coordinate(x, "diagnostic snapshot x");
		assertInt32Coordinate(y, "diagnostic snapshot y");
		if (encoded === 0) throw new Error(`Rail diagnostic snapshot cell ${index} is empty.`);
		checksum.addCell(x, y, encoded);
	}
	for (let index = 0; index < snapshot.switchIds.length; index++) {
		const id = snapshot.switchIds[index] as number;
		checksum.addSwitch(
			readAdvancedSwitchRecord(
				snapshot.switchRecords,
				index,
				id,
				`Rail diagnostic snapshot switch ${id}`,
			),
		);
	}
	const portEquipment = hydratePortEquipmentSnapshotRecords(snapshot.portEquipment);
	for (const port of portEquipment.ports) checksum.addPort(port);
	for (const group of portEquipment.equipmentGroups) checksum.addEquipmentGroup(group);
	const organizations = hydrateStaticFabOrganizationDiagnosticSnapshot(snapshot.organizations);
	for (const record of organizations.records) checksum.addDiagnosticOrganization(record);
	checksum.setDiagnosticOrganizationNextId(organizations.nextOrganizationId);
	const relationships = hydrateStaticFabAssemblyRelationshipSnapshot(snapshot.relationships);
	for (const record of relationships.records) checksum.addAssemblyRelationship(record);
	checksum.setAssemblyRelationshipNextId(relationships.nextRelationshipId);
	return checksum.digest();
}

export function assertInt32Coordinate(value: number, axis: string): void {
	if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
		throw new Error(
			`Rail ${axis} coordinate ${value} is outside the signed 32-bit worker contract.`,
		);
	}
}

function assertOrganizationNextId(value: number, label: string): void {
	if (!Number.isInteger(value) || value <= 0 || value > 0x7fffffff) {
		throw new Error(`${label} ${value} is outside the positive signed 32-bit worker contract.`);
	}
}

function assertDiagnosticOrganizationNextId(value: number, label: string): void {
	if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
		throw new Error(`${label} ${value} is outside the signed 32-bit worker contract.`);
	}
}

function hashCell(x: number, y: number, encoded: number, seed: number): number {
	let hash = seed >>> 0;
	hash = Math.imul(hash ^ (x | 0), 0x85ebca6b) >>> 0;
	hash = Math.imul(hash ^ (y | 0), 0xc2b2ae35) >>> 0;
	hash = Math.imul(hash ^ encoded, 0x27d4eb2f) >>> 0;
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb352d) >>> 0;
	hash ^= hash >>> 15;
	return hash >>> 0;
}

function hashSwitch(record: AdvancedSwitchRecord, seed: number): number {
	let hash = Math.imul(seed ^ 0x53574954, 0x85ebca6b) >>> 0;
	hash = mixHash(hash, record.id);
	hash = mixHash(hash, encodeAdvancedSwitchProfileClass(record.profileClass));
	hash = mixHash(hash, record.origin.x);
	hash = mixHash(hash, record.origin.y);
	hash = mixHash(hash, record.forward);
	hash = mixHash(hash, record.lateral);
	hash = mixHash(hash, record.movementMask);
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb352d) >>> 0;
	hash ^= hash >>> 15;
	return hash >>> 0;
}

function hashPort(record: PortRecord, seed: number): number {
	let hash = Math.imul(seed ^ 0x504f5254, 0x85ebca6b) >>> 0;
	hash = mixHash(hash, record.id);
	hash = mixHash(hash, record.equipmentGroupId);
	if (record.route.kind === "CARDINAL_CELL") {
		hash = mixHash(hash, 0);
		hash = mixHash(hash, record.route.x);
		hash = mixHash(hash, record.route.z);
		hash = mixHash(hash, record.route.from);
		hash = mixHash(hash, record.route.to);
	} else {
		hash = mixHash(hash, 1);
		hash = mixHash(hash, record.route.switchId);
		hash = mixString(hash, record.route.profileClass);
		hash = mixString(hash, record.route.role);
		hash = mixHash(hash, record.route.portIndex ?? -1);
		hash = mixHash(hash, record.route.segmentOrdinal);
	}
	hash = mixHash(hash, record.stationMillimeters);
	hash = mixString(hash, record.side);
	hash = mixHash(hash, record.lateralOffsetMillimeters);
	hash = mixString(hash, record.direction);
	hash = mixString(hash, record.portType);
	hash = mixString(hash, record.barcode ?? "");
	return finalizeHash(hash);
}

function hashEquipmentGroup(record: EquipmentGroupRecord, seed: number): number {
	let hash = Math.imul(seed ^ 0x45514752, 0x85ebca6b) >>> 0;
	hash = mixHash(hash, record.id);
	hash = mixString(hash, record.kind);
	for (let index = 0; index < record.portIds.length; index++) {
		hash = mixHash(hash, index);
		hash = mixHash(hash, record.portIds[index] as number);
	}
	if (record.kind === "OHB") hash = mixString(hash, record.template);
	else if (record.kind === "EQ") {
		hash = mixHash(hash, record.pitchMillimeters);
		hash = mixString(hash, record.recipe ?? "");
	} else hash = mixString(hash, record.template);
	return finalizeHash(hash);
}

function assemblyRelationshipRecordFingerprint(record: StaticFabAssemblyRelationshipRecordV1): {
	readonly xor: number;
	readonly sum: number;
} {
	return assemblyRelationshipDigestFingerprint(checksumStaticFabAssemblyRelationshipRecord(record));
}

function assemblyRelationshipDigestFingerprint(digest: string): {
	readonly xor: number;
	readonly sum: number;
} {
	return Object.freeze({
		xor: finalizeHash(mixString(HASH_SEED_A ^ 0x4153524c, digest)),
		sum: finalizeHash(mixString(HASH_SEED_B ^ 0x4153524c, digest)),
	});
}

async function hashOrganizationMembershipCooperatively(
	membership: StaticFabOrganizationMembership,
	checkpoint: () => Promise<void>,
	operationBudget: number,
): Promise<OrganizationHashPair> {
	let xor = Math.imul(HASH_SEED_A ^ 0x4f52474d, 0x85ebca6b) >>> 0;
	let sum = Math.imul(HASH_SEED_B ^ 0x4f52474d, 0x85ebca6b) >>> 0;
	let operations = 0;
	const mix = (value: number): void => {
		xor = mixHash(xor, value);
		sum = mixHash(sum, value);
	};
	const operationConsumesBudget = (): boolean => ++operations >= operationBudget;

	for (let index = 0; index < membership.railEdges.length; index++) {
		const edge = membership.railEdges[
			index
		] as StaticFabOrganizationRecord["membership"]["railEdges"][number];
		mix(index);
		mix(edge.from.x);
		mix(edge.from.y);
		mix(edge.to.x);
		mix(edge.to.y);
		if (operationConsumesBudget()) {
			await checkpoint();
			operations = 0;
		}
	}
	for (let index = 0; index < membership.advancedSwitchIds.length; index++) {
		mix(0x10000000 | index);
		mix(membership.advancedSwitchIds[index] as number);
		if (operationConsumesBudget()) {
			await checkpoint();
			operations = 0;
		}
	}
	for (let index = 0; index < membership.equipmentGroupIds.length; index++) {
		mix(0x20000000 | index);
		mix(membership.equipmentGroupIds[index] as number);
		if (operationConsumesBudget()) {
			await checkpoint();
			operations = 0;
		}
	}
	return Object.freeze({ xor: finalizeHash(xor), sum: finalizeHash(sum) });
}

function mixString(hash: number, value: string): number {
	hash = mixHash(hash, value.length);
	for (let index = 0; index < value.length; index++) hash = mixHash(hash, value.charCodeAt(index));
	return hash;
}

function finalizeHash(hash: number): number {
	hash ^= hash >>> 16;
	hash = Math.imul(hash, 0x7feb352d) >>> 0;
	hash ^= hash >>> 15;
	return hash >>> 0;
}

function mixHash(hash: number, value: number): number {
	return Math.imul(hash ^ (value | 0), 0x27d4eb2f) >>> 0;
}

function hex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
