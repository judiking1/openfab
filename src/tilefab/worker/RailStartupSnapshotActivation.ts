import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import { TileMap } from "../core/TileMap";
import {
	readAdvancedSwitchRecord,
	validateAdvancedSwitchRecordFieldLengths,
} from "./AdvancedSwitchSoA";
import { hydratePortEquipmentSnapshotCooperatively } from "./PortEquipmentSoA";
import {
	assertInt32Coordinate,
	RailChecksumAccumulator,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import {
	consumeRailStartupTransportAdoptionAuthority,
	type RailStartupTransport,
	type RailStartupTransportAdoptionAuthority,
} from "./RailStartupTransportContract";
import { railMirrorSnapshotTransfers } from "./railMirrorProtocol";
import { createStaticFabOrganizationSnapshotHydrator } from "./StaticFabOrganizationSoA";
import { isTransferableTypedArray } from "./TransferableTypedArray";

/** Opaque one-shot proof produced only by full cooperative snapshot validation and hydration. */
export interface ValidatedRailStartupSnapshotAuthority {
	readonly token: object;
}

export interface ValidatedRailStartupSnapshotActivation {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly authority: ValidatedRailStartupSnapshotAuthority;
	readonly sequence: number;
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

interface ValidatedRailStartupSnapshotBinding {
	readonly snapshot: RailMirrorSnapshot;
	readonly xs: Int32Array;
	readonly ys: Int32Array;
	readonly encoded: Uint8Array;
	readonly switchIds: Int32Array;
	readonly switchRecords: RailMirrorSnapshot["switchRecords"];
	readonly portEquipmentSnapshot: RailMirrorSnapshot["portEquipment"];
	readonly organizationSnapshot: RailMirrorSnapshot["organizations"];
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly sequence: number;
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly cellCount: number;
	readonly edgeCount: number;
	readonly switchCount: number;
	readonly portCount: number;
	readonly equipmentGroupCount: number;
	readonly organizationCount: number;
}

const validatedRailStartupSnapshotBindings = new WeakMap<
	object,
	ValidatedRailStartupSnapshotBinding
>();

/**
 * Hydrate the exact authored generations while checking every snapshot record cooperatively.
 *
 * This is the sole authority issuer: callers cannot bless an arbitrary document/snapshot pair.
 */
export async function validateAndHydrateRailStartupSnapshotCooperatively(
	sourceSnapshot: RailMirrorSnapshot,
	transport: RailStartupTransport,
	transportAuthority: RailStartupTransportAdoptionAuthority,
	checkpoint: () => Promise<void>,
	checkCancelled: () => void,
	operationBudget = 128,
): Promise<ValidatedRailStartupSnapshotActivation> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Rail startup snapshot operation budget must be a positive safe integer.");
	}
	if (
		!consumeRailStartupTransportAdoptionAuthority(transportAuthority, transport, sourceSnapshot)
	) {
		throw new Error("Rail startup snapshot lacks exact transport-adoption provenance.");
	}
	checkCancelled();
	let transfers: Transferable[];
	try {
		transfers = railMirrorSnapshotTransfers(sourceSnapshot);
	} catch {
		throw new Error("Rail startup snapshot ownership could not be isolated for activation.");
	}
	let snapshot: RailMirrorSnapshot;
	try {
		snapshot = structuredClone(sourceSnapshot, { transfer: transfers });
	} catch {
		throw new Error("Rail startup snapshot ownership could not be isolated for activation.");
	}
	checkCancelled();
	if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
		throw new Error("Rail startup snapshot sequence must be a non-negative safe integer.");
	}
	if (
		!isTransferableTypedArray(snapshot.xs, Int32Array) ||
		!isTransferableTypedArray(snapshot.ys, Int32Array) ||
		!isTransferableTypedArray(snapshot.encoded, Uint8Array) ||
		!isTransferableTypedArray(snapshot.switchIds, Int32Array)
	) {
		throw new Error("Rail startup snapshot identity columns have invalid typed arrays.");
	}
	if (snapshot.xs.length !== snapshot.ys.length || snapshot.xs.length !== snapshot.encoded.length) {
		throw new Error("Rail startup snapshot SoA lengths do not match.");
	}
	const mapHydrator = TileMap.createHydrator();
	const checksum = new RailChecksumAccumulator();
	for (let index = 0; index < snapshot.encoded.length; index++) {
		const x = snapshot.xs[index] as number;
		const y = snapshot.ys[index] as number;
		const encoded = snapshot.encoded[index] as number;
		assertInt32Coordinate(x, "startup x");
		assertInt32Coordinate(y, "startup y");
		mapHydrator.addEncodedCell(x, y, encoded);
		checksum.addCell(x, y, encoded);
		if ((index + 1) % operationBudget === 0) await checkpoint();
	}
	validateAdvancedSwitchRecordFieldLengths(
		snapshot.switchRecords,
		snapshot.switchIds.length,
		"Rail startup snapshot",
	);
	for (let index = 0; index < snapshot.switchIds.length; index++) {
		const id = snapshot.switchIds[index] as number;
		const record = readAdvancedSwitchRecord(
			snapshot.switchRecords,
			index,
			id,
			`Rail startup switch ${id}`,
		);
		mapHydrator.addAdvancedSwitch(record);
		checksum.addSwitch(record);
		await checkpoint();
	}
	const portEquipment = await hydratePortEquipmentSnapshotCooperatively(
		snapshot.portEquipment,
		checkpoint,
		operationBudget,
	);
	for (const port of portEquipment.ports) {
		checksum.addPort(port);
		await checkpoint();
	}
	for (const group of portEquipment.equipmentGroups) {
		checksum.addEquipmentGroup(group);
		await checkpoint();
	}
	const organizationHydrator = createStaticFabOrganizationSnapshotHydrator(snapshot.organizations);
	while (!organizationHydrator.done) {
		const operations = organizationHydrator.step(operationBudget);
		if (operations === 0) throw new Error("Organization startup hydration made no progress.");
		await checkpoint();
	}
	const organizations = organizationHydrator.finish();
	for (const record of organizations.records) {
		await checksum.addOrganizationCooperatively(record, checkpoint, operationBudget);
		await checkpoint();
	}
	checksum.setOrganizationNextId(organizations.nextOrganizationId);
	const actualChecksum = checksum.digest();
	if (actualChecksum !== snapshot.checksum) {
		throw new Error(
			`Rail startup checksum mismatch: expected ${snapshot.checksum}, received ${actualChecksum}.`,
		);
	}
	const map = mapHydrator.finish(snapshot.revision, snapshot.nextAdvancedSwitchId);
	const token = Object.freeze({});
	validatedRailStartupSnapshotBindings.set(
		token,
		Object.freeze({
			snapshot,
			xs: snapshot.xs,
			ys: snapshot.ys,
			encoded: snapshot.encoded,
			switchIds: snapshot.switchIds,
			switchRecords: snapshot.switchRecords,
			portEquipmentSnapshot: snapshot.portEquipment,
			organizationSnapshot: snapshot.organizations,
			map,
			portEquipment,
			organizations,
			sequence: snapshot.sequence,
			revision: snapshot.revision,
			mutationGeneration: map.getMutationGeneration(),
			checksum: snapshot.checksum,
			nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
			nextPortId: snapshot.portEquipment.nextPortId,
			nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
			nextOrganizationId: snapshot.organizations.nextOrganizationId,
			cellCount: checksum.cellCount,
			edgeCount: checksum.edgeCount,
			switchCount: checksum.switchCount,
			portCount: checksum.portCount,
			equipmentGroupCount: checksum.equipmentGroupCount,
			organizationCount: checksum.organizationCount,
		}),
	);
	return Object.freeze({
		map,
		portEquipment,
		organizations,
		authority: Object.freeze({ token }),
		sequence: snapshot.sequence,
		revision: snapshot.revision,
		mutationGeneration: map.getMutationGeneration(),
		checksum: snapshot.checksum,
		nextAdvancedSwitchId: snapshot.nextAdvancedSwitchId,
		nextPortId: snapshot.portEquipment.nextPortId,
		nextEquipmentGroupId: snapshot.portEquipment.nextEquipmentGroupId,
		nextOrganizationId: snapshot.organizations.nextOrganizationId,
	});
}

/**
 * Release the private snapshot once for a full-validation fallback.
 *
 * The default Bridge uses the same primitive internally and never exposes the returned snapshot.
 */
export function releaseValidatedRailStartupSnapshotForFullValidation(
	authority: ValidatedRailStartupSnapshotAuthority,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
): RailMirrorSnapshot | null {
	const token = authority.token;
	const binding = validatedRailStartupSnapshotBindings.get(token);
	validatedRailStartupSnapshotBindings.delete(token);
	if (
		binding !== undefined &&
		binding.xs === binding.snapshot.xs &&
		binding.ys === binding.snapshot.ys &&
		binding.encoded === binding.snapshot.encoded &&
		binding.switchIds === binding.snapshot.switchIds &&
		binding.switchRecords === binding.snapshot.switchRecords &&
		binding.portEquipmentSnapshot === binding.snapshot.portEquipment &&
		binding.organizationSnapshot === binding.snapshot.organizations &&
		binding.map === map &&
		binding.portEquipment === portEquipment &&
		binding.organizations === organizations &&
		binding.sequence === binding.snapshot.sequence &&
		binding.revision === binding.snapshot.revision &&
		binding.revision === map.getRevision() &&
		binding.mutationGeneration === map.getMutationGeneration() &&
		binding.checksum === binding.snapshot.checksum &&
		binding.nextAdvancedSwitchId === binding.snapshot.nextAdvancedSwitchId &&
		binding.nextAdvancedSwitchId === map.getAdvancedSwitchIdCursor() &&
		binding.nextPortId === binding.snapshot.portEquipment.nextPortId &&
		binding.nextPortId === portEquipment.nextPortId &&
		binding.nextEquipmentGroupId === binding.snapshot.portEquipment.nextEquipmentGroupId &&
		binding.nextEquipmentGroupId === portEquipment.nextEquipmentGroupId &&
		binding.nextOrganizationId === binding.snapshot.organizations.nextOrganizationId &&
		binding.nextOrganizationId === organizations.nextOrganizationId &&
		binding.cellCount === map.size &&
		binding.edgeCount === map.edgeCount &&
		binding.switchCount === map.advancedSwitchCount &&
		binding.portCount === portEquipment.ports.length &&
		binding.equipmentGroupCount === portEquipment.equipmentGroups.length &&
		binding.organizationCount === organizations.records.length
	) {
		return binding.snapshot;
	}
	return null;
}
