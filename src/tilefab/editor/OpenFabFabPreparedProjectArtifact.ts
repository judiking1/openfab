import { openFabFabAssemblyLayoutContractFingerprint } from "../compile/OpenFabFabAssemblyPlan";
import {
	normalizeOpenFabFabPreparedProjectAttestation,
	normalizeOpenFabFabPreparedProjectIdentity,
	OPENFAB_FAB_PREPARED_PROJECT_KIND,
	OPENFAB_FAB_PREPARED_PROJECT_VERSION,
	type OpenFabFabPreparedProjectAttestation,
	type OpenFabFabPreparedProjectIdentity,
	openFabFabPreparedProjectIdentitiesEqual,
	openFabFabPreparedProjectRequestFingerprint,
} from "../compile/OpenFabFabPreparedProject";
import {
	deriveOpenFabFabProfile,
	normalizeOpenFabFabProfile,
	type OpenFabFabProfile,
	openFabFabProfileDerivationContractFingerprint,
	openFabFabProfileFingerprint,
	openFabFabProfilePlanFingerprint,
} from "../compile/OpenFabFabProfile";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import type { OpenFabProjectManifest } from "../project/OpenFabProject";
import { validateOpenFabProjectManifest } from "../project/OpenFabProjectCodec";
import { RailChecksumAccumulator, type RailMirrorSnapshot } from "../worker/RailMirrorChecksum";

const PREPARED_PROJECT_KEYS = Object.freeze([
	"kind",
	"version",
	"requestFingerprint",
	"profile",
	"identity",
	"snapshot",
] as const);
const SNAPSHOT_KEYS = Object.freeze([
	"sequence",
	"revision",
	"nextAdvancedSwitchId",
	"xs",
	"ys",
	"encoded",
	"switchIds",
	"switchRecords",
	"portEquipment",
	"organizations",
	"checksum",
] as const);
const SWITCH_RECORD_KEYS = Object.freeze([
	"profileClasses",
	"origins",
	"forwardDirections",
	"lateralDirections",
	"movementMasks",
] as const);
const PORT_EQUIPMENT_KEYS = Object.freeze([
	"schemaVersion",
	"nextPortId",
	"nextEquipmentGroupId",
	"portIds",
	"ports",
	"equipmentGroupIds",
	"equipmentGroups",
] as const);
const PORT_RECORD_KEYS = Object.freeze([
	"equipmentGroupIds",
	"routeKinds",
	"routeXs",
	"routeZs",
	"routeFromDirections",
	"routeToDirections",
	"routeSwitchIds",
	"routeProfileClasses",
	"routeRoles",
	"routePortIndices",
	"routeSegmentOrdinals",
	"stationMillimeters",
	"sides",
	"lateralOffsetMillimeters",
	"directions",
	"portTypes",
	"barcodes",
] as const);
const EQUIPMENT_RECORD_KEYS = Object.freeze([
	"kinds",
	"portOffsets",
	"portIds",
	"templates",
	"pitchMillimeters",
	"recipes",
] as const);
const ORGANIZATION_KEYS = Object.freeze([
	"schemaVersion",
	"nextOrganizationId",
	"organizationIds",
	"records",
] as const);
const ORGANIZATION_RECORD_KEYS = Object.freeze([
	"kinds",
	"names",
	"parentOrganizationOffsets",
	"parentOrganizationIds",
	"descriptions",
	"colors",
	"railEdgeOffsets",
	"railEdgeCoordinates",
	"advancedSwitchOffsets",
	"advancedSwitchIds",
	"equipmentGroupOffsets",
	"equipmentGroupIds",
] as const);

const preparedProjectBrand: unique symbol = Symbol("OpenFabFabPreparedProject");
const verificationEvidenceBrand: unique symbol = Symbol("OpenFabFabPreparedProjectEvidence");

export interface OpenFabFabPreparedProject {
	readonly kind: "openfab-fab-prepared-project-artifact";
	readonly profile: OpenFabFabProfile;
	readonly identity: OpenFabFabPreparedProjectIdentity;
	readonly [preparedProjectBrand]: true;
}

/** Opaque main-realm capability; its binding lives only in a module-private WeakMap. */
export interface OpenFabFabPreparedProjectVerificationEvidence {
	readonly [verificationEvidenceBrand]: true;
}

/** `snapshot` and `manifest` are the direct inputs to OpenFabProjectLoader.prepareSnapshot. */
export interface ConsumedOpenFabFabPreparedProject {
	readonly snapshot: RailMirrorSnapshot;
	readonly manifest: OpenFabProjectManifest;
	readonly identity: OpenFabFabPreparedProjectIdentity;
	readonly creationFingerprint: string;
}

interface PreparedState {
	readonly snapshot: RailMirrorSnapshot;
	readonly identity: OpenFabFabPreparedProjectIdentity;
	readonly profile: OpenFabFabProfile;
	consumed: boolean;
}

interface EvidenceState {
	readonly prepared: OpenFabFabPreparedProject;
	readonly identityFingerprint: string;
}

const preparedStates = new WeakMap<object, PreparedState>();
const evidenceStates = new WeakMap<object, EvidenceState>();

export function rebindTransferableOpenFabFabPreparedProject(
	value: unknown,
	attestationValue: unknown,
	expectedProfileValue: unknown,
): OpenFabFabPreparedProject {
	if (!isRecord(value) || !hasExactKeys(value, PREPARED_PROJECT_KEYS)) {
		throw new Error("Prepared OpenFab Fab project fields are malformed.");
	}
	if (
		value.kind !== OPENFAB_FAB_PREPARED_PROJECT_KIND ||
		value.version !== OPENFAB_FAB_PREPARED_PROJECT_VERSION
	) {
		throw new Error("Prepared OpenFab Fab project contract is invalid.");
	}
	const expectedProfile = normalizeOpenFabFabProfile(expectedProfileValue);
	const profile = normalizeOpenFabFabProfile(value.profile);
	if (JSON.stringify(profile) !== JSON.stringify(expectedProfile)) {
		throw new Error("Prepared OpenFab Fab project profile does not match its request.");
	}
	const requestFingerprint = openFabFabPreparedProjectRequestFingerprint(profile);
	if (value.requestFingerprint !== requestFingerprint) {
		throw new Error("Prepared OpenFab Fab project request identity is invalid.");
	}
	const identity = validateOpenFabFabPreparedProjectIdentityForProfile(
		value.identity,
		profile,
		requestFingerprint,
	);
	const attestation = normalizeOpenFabFabPreparedProjectAttestation(attestationValue);
	if (
		attestation.requestFingerprint !== requestFingerprint ||
		attestation.materializationFingerprint !== identity.fingerprint
	) {
		throw new Error("Prepared OpenFab Fab project attestation identity is invalid.");
	}
	const snapshot = validateSnapshotEnvelope(value.snapshot, identity, attestation);
	deepFreezeSnapshotContainers(snapshot);
	const prepared = Object.freeze({
		kind: "openfab-fab-prepared-project-artifact" as const,
		profile,
		identity,
		[preparedProjectBrand]: true as const,
	});
	preparedStates.set(prepared, { snapshot, identity, profile, consumed: false });
	return prepared;
}

export function bindOpenFabFabPreparedProjectVerification(
	prepared: OpenFabFabPreparedProject,
	independentIdentityValue: unknown,
): OpenFabFabPreparedProjectVerificationEvidence {
	const state = preparedStates.get(prepared);
	if (!state || state.consumed) {
		throw new Error("Prepared OpenFab Fab project source is not live.");
	}
	const independentIdentity = normalizeOpenFabFabPreparedProjectIdentity(independentIdentityValue);
	if (!openFabFabPreparedProjectIdentitiesEqual(state.identity, independentIdentity)) {
		throw new Error("Independent OpenFab Fab project materializations do not match.");
	}
	const evidence = Object.freeze({
		[verificationEvidenceBrand]: true as const,
	});
	evidenceStates.set(evidence, {
		prepared,
		identityFingerprint: state.identity.fingerprint,
	});
	return evidence;
}

export function consumeOpenFabFabPreparedProject(
	prepared: OpenFabFabPreparedProject,
	evidence: OpenFabFabPreparedProjectVerificationEvidence,
	manifestValue: unknown,
): ConsumedOpenFabFabPreparedProject {
	const state = preparedStates.get(prepared);
	const evidenceState = evidenceStates.get(evidence);
	if (
		!state ||
		state.consumed ||
		!evidenceState ||
		evidenceState.prepared !== prepared ||
		evidenceState.identityFingerprint !== state.identity.fingerprint
	) {
		throw new Error("Prepared OpenFab Fab project evidence is absent, stale, or already consumed.");
	}
	// Validate the actual user manifest before burning the one-shot source.
	const manifest = validateOpenFabProjectManifest(manifestValue);
	state.consumed = true;
	preparedStates.delete(prepared);
	evidenceStates.delete(evidence);
	return Object.freeze({
		snapshot: state.snapshot,
		manifest,
		identity: state.identity,
		creationFingerprint: creationFingerprint(state.identity, manifest),
	});
}

/**
 * Revokes a live, unconsumed prepared-project capability and releases its hidden
 * transferable snapshot for collection. Successful consumers must use
 * `consumeOpenFabFabPreparedProject` instead.
 */
export function discardOpenFabFabPreparedProject(
	prepared: OpenFabFabPreparedProject,
	evidence?: OpenFabFabPreparedProjectVerificationEvidence,
): boolean {
	const state = preparedStates.get(prepared);
	if (!state || state.consumed) return false;
	state.consumed = true;
	preparedStates.delete(prepared);
	if (evidence) {
		const evidenceState = evidenceStates.get(evidence);
		if (evidenceState?.prepared === prepared) evidenceStates.delete(evidence);
	}
	return true;
}

export function openFabFabPreparedProjectIsLive(
	value: unknown,
): value is OpenFabFabPreparedProject {
	return (
		isRecord(value) && preparedStates.has(value) && preparedStates.get(value)?.consumed === false
	);
}

export function openFabFabPreparedProjectTransferStats(snapshotValue: unknown): Readonly<{
	bufferCount: number;
	byteLength: number;
}> {
	const views = collectExpectedViews(snapshotValue);
	const seen = new Set<ArrayBuffer>();
	let byteLength = 0;
	for (const { view, arrayType, label } of views) {
		if (!(view instanceof arrayType)) throw new Error(`${label} has the wrong typed-array type.`);
		if (!(view.buffer instanceof ArrayBuffer)) {
			throw new Error(`${label} must not use a SharedArrayBuffer.`);
		}
		if (view.byteOffset !== 0 || view.byteLength !== view.buffer.byteLength) {
			throw new Error(`${label} must own a full ArrayBuffer view.`);
		}
		if (seen.has(view.buffer)) throw new Error(`${label} aliases another prepared-project buffer.`);
		seen.add(view.buffer);
		byteLength += view.buffer.byteLength;
	}
	return Object.freeze({ bufferCount: seen.size, byteLength });
}

export function validateOpenFabFabPreparedProjectIdentityForProfile(
	value: unknown,
	profile: OpenFabFabProfile,
	requestFingerprint: string,
): OpenFabFabPreparedProjectIdentity {
	const identity = normalizeOpenFabFabPreparedProjectIdentity(value);
	const derived = deriveOpenFabFabProfile(profile);
	if (
		identity.requestFingerprint !== requestFingerprint ||
		identity.profileFingerprint !== openFabFabProfileFingerprint(profile) ||
		identity.profileDerivationContractFingerprint !==
			openFabFabProfileDerivationContractFingerprint() ||
		identity.profilePlanFingerprint !== openFabFabProfilePlanFingerprint(profile) ||
		identity.assemblyLayoutContractFingerprint !== openFabFabAssemblyLayoutContractFingerprint() ||
		identity.counts.layoutBlocks !== derived.counts.layoutBlocks ||
		identity.counts.banks !== derived.counts.banks ||
		identity.counts.bays !== derived.counts.bays ||
		identity.counts.processLoops !== derived.counts.processLoops ||
		identity.counts.organizationRecords !== derived.counts.organizationRecords
	) {
		throw new Error("Prepared OpenFab Fab project identity does not match its exact profile.");
	}
	return identity;
}

function validateSnapshotEnvelope(
	value: unknown,
	identity: OpenFabFabPreparedProjectIdentity,
	attestation: OpenFabFabPreparedProjectAttestation,
): RailMirrorSnapshot {
	assertSnapshotKeys(value);
	const snapshot = value as unknown as RailMirrorSnapshot;
	if (
		snapshot.sequence !== identity.sequence ||
		snapshot.revision !== identity.revision ||
		snapshot.nextAdvancedSwitchId !== identity.nextAdvancedSwitchId ||
		snapshot.portEquipment.nextPortId !== identity.nextPortId ||
		snapshot.portEquipment.nextEquipmentGroupId !== identity.nextEquipmentGroupId ||
		snapshot.organizations.nextOrganizationId !== identity.nextOrganizationId ||
		snapshot.checksum !== identity.authoredChecksum ||
		attestation.snapshotChecksum !== snapshot.checksum
	) {
		throw new Error("Prepared OpenFab Fab project snapshot scalars do not match its identity.");
	}
	let digest: RailChecksumAccumulator;
	try {
		digest = RailChecksumAccumulator.fromDigest(snapshot.checksum);
	} catch {
		throw new Error("Prepared OpenFab Fab project checksum digest is malformed.");
	}
	if (
		digest.cellCount !== identity.counts.railCells ||
		digest.edgeCount !== identity.counts.directedEdges ||
		digest.switchCount !== 0 ||
		digest.portCount !== 0 ||
		digest.equipmentGroupCount !== 0 ||
		digest.organizationCount !== identity.counts.organizationRecords ||
		digest.organizationNextId !== identity.nextOrganizationId
	) {
		throw new Error("Prepared OpenFab Fab project checksum counters do not match its identity.");
	}
	validateV1ColumnLengths(snapshot, identity);
	const stats = openFabFabPreparedProjectTransferStats(snapshot);
	if (
		stats.bufferCount !== attestation.transferableBufferCount ||
		stats.byteLength !== attestation.transferableByteLength
	) {
		throw new Error("Prepared OpenFab Fab project transfer ownership attestation is invalid.");
	}
	return snapshot;
}

function validateV1ColumnLengths(
	snapshot: RailMirrorSnapshot,
	identity: OpenFabFabPreparedProjectIdentity,
): void {
	const cellCount = identity.counts.railCells;
	if (
		snapshot.xs.length !== cellCount ||
		snapshot.ys.length !== cellCount ||
		snapshot.encoded.length !== cellCount ||
		snapshot.switchIds.length !== 0 ||
		Object.values(snapshot.switchRecords).some((column) => column.length !== 0)
	) {
		throw new Error("Prepared OpenFab Fab project rail columns have invalid v1 lengths.");
	}
	const ports = snapshot.portEquipment;
	if (
		ports.schemaVersion !== 1 ||
		ports.portIds.length !== 0 ||
		ports.equipmentGroupIds.length !== 0 ||
		ports.ports.barcodes.length !== 0 ||
		ports.equipmentGroups.recipes.length !== 0 ||
		ports.equipmentGroups.portOffsets.length !== 1 ||
		ports.equipmentGroups.portOffsets[0] !== 0 ||
		Object.entries(ports.ports).some(
			([key, column]) => key !== "barcodes" && (column as ArrayBufferView).byteLength !== 0,
		) ||
		Object.entries(ports.equipmentGroups).some(
			([key, column]) =>
				key !== "recipes" && key !== "portOffsets" && (column as ArrayBufferView).byteLength !== 0,
		)
	) {
		throw new Error("Prepared OpenFab Fab project port/equipment columns violate the v1 contract.");
	}
	const organizations = snapshot.organizations;
	const records = organizations.records;
	const organizationCount = identity.counts.organizationRecords;
	if (
		organizations.schemaVersion !== 2 ||
		organizations.nextOrganizationId !== organizationCount + 1 ||
		organizations.organizationIds.length !== organizationCount ||
		records.kinds.length !== organizationCount ||
		records.names.length !== organizationCount ||
		records.descriptions.length !== organizationCount ||
		records.colors.length !== organizationCount ||
		records.parentOrganizationOffsets.length !== organizationCount + 1 ||
		records.railEdgeOffsets.length !== organizationCount + 1 ||
		records.advancedSwitchOffsets.length !== organizationCount + 1 ||
		records.equipmentGroupOffsets.length !== organizationCount + 1 ||
		records.parentOrganizationOffsets[0] !== 0 ||
		records.parentOrganizationOffsets[organizationCount] !== records.parentOrganizationIds.length ||
		records.parentOrganizationIds.length !== organizationCount - 1 ||
		records.railEdgeOffsets[0] !== 0 ||
		records.railEdgeOffsets[organizationCount] * 4 !== records.railEdgeCoordinates.length ||
		records.railEdgeCoordinates.length !== identity.counts.directedEdges * 4 ||
		records.advancedSwitchOffsets[0] !== 0 ||
		records.advancedSwitchOffsets[organizationCount] !== 0 ||
		records.advancedSwitchIds.length !== 0 ||
		records.equipmentGroupOffsets[0] !== 0 ||
		records.equipmentGroupOffsets[organizationCount] !== 0 ||
		records.equipmentGroupIds.length !== 0
	) {
		throw new Error("Prepared OpenFab Fab project organization columns have invalid v1 lengths.");
	}
}

function assertSnapshotKeys(value: unknown): asserts value is Record<string, unknown> {
	if (!isRecord(value) || !hasExactKeys(value, SNAPSHOT_KEYS)) {
		throw new Error("Prepared OpenFab Fab project snapshot fields are malformed.");
	}
	for (const [nested, keys, label] of [
		[value.switchRecords, SWITCH_RECORD_KEYS, "switch record"],
		[value.portEquipment, PORT_EQUIPMENT_KEYS, "port/equipment"],
		[value.organizations, ORGANIZATION_KEYS, "organization"],
	] as const) {
		if (!isRecord(nested) || !hasExactKeys(nested, keys)) {
			throw new Error(`Prepared OpenFab Fab project ${label} fields are malformed.`);
		}
	}
	const portEquipment = value.portEquipment as Record<string, unknown>;
	const organizations = value.organizations as Record<string, unknown>;
	if (
		!isRecord(portEquipment.ports) ||
		!hasExactKeys(portEquipment.ports, PORT_RECORD_KEYS) ||
		!isRecord(portEquipment.equipmentGroups) ||
		!hasExactKeys(portEquipment.equipmentGroups, EQUIPMENT_RECORD_KEYS) ||
		!isRecord(organizations.records) ||
		!hasExactKeys(organizations.records, ORGANIZATION_RECORD_KEYS)
	) {
		throw new Error("Prepared OpenFab Fab project nested SoA fields are malformed.");
	}
	const portFields = portEquipment.ports as Record<string, unknown>;
	const equipmentFields = portEquipment.equipmentGroups as Record<string, unknown>;
	const organizationFields = organizations.records as Record<string, unknown>;
	if (
		!Array.isArray(portFields.barcodes) ||
		!Array.isArray(equipmentFields.recipes) ||
		!Array.isArray(organizationFields.names) ||
		!Array.isArray(organizationFields.descriptions)
	) {
		throw new Error("Prepared OpenFab Fab project scalar columns are malformed.");
	}
}

interface ExpectedView {
	readonly view: unknown;
	readonly arrayType:
		| typeof Int8Array
		| typeof Uint8Array
		| typeof Uint16Array
		| typeof Int32Array
		| typeof Uint32Array;
	readonly label: string;
}

function collectExpectedViews(snapshotValue: unknown): readonly ExpectedView[] {
	assertSnapshotKeys(snapshotValue);
	const snapshot = snapshotValue as unknown as RailMirrorSnapshot;
	const switches = snapshot.switchRecords;
	const ports = snapshot.portEquipment.ports;
	const groups = snapshot.portEquipment.equipmentGroups;
	const organizations = snapshot.organizations.records;
	return [
		view(snapshot.xs, Int32Array, "rail xs"),
		view(snapshot.ys, Int32Array, "rail ys"),
		view(snapshot.encoded, Uint8Array, "rail encoding"),
		view(snapshot.switchIds, Int32Array, "switch ids"),
		view(switches.profileClasses, Uint8Array, "switch profile classes"),
		view(switches.origins, Int32Array, "switch origins"),
		view(switches.forwardDirections, Uint8Array, "switch forward directions"),
		view(switches.lateralDirections, Uint8Array, "switch lateral directions"),
		view(switches.movementMasks, Uint8Array, "switch movement masks"),
		view(snapshot.portEquipment.portIds, Int32Array, "port ids"),
		...portViews(ports),
		view(snapshot.portEquipment.equipmentGroupIds, Int32Array, "equipment ids"),
		view(groups.kinds, Uint8Array, "equipment kinds"),
		view(groups.portOffsets, Uint32Array, "equipment port offsets"),
		view(groups.portIds, Int32Array, "equipment port ids"),
		view(groups.templates, Uint8Array, "equipment templates"),
		view(groups.pitchMillimeters, Uint32Array, "equipment pitches"),
		view(snapshot.organizations.organizationIds, Int32Array, "organization ids"),
		view(organizations.kinds, Uint8Array, "organization kinds"),
		view(organizations.parentOrganizationOffsets, Uint32Array, "organization parent offsets"),
		view(organizations.parentOrganizationIds, Int32Array, "organization parent ids"),
		view(organizations.colors, Uint8Array, "organization colors"),
		view(organizations.railEdgeOffsets, Uint32Array, "organization rail offsets"),
		view(organizations.railEdgeCoordinates, Int32Array, "organization rail coordinates"),
		view(organizations.advancedSwitchOffsets, Uint32Array, "organization switch offsets"),
		view(organizations.advancedSwitchIds, Int32Array, "organization switch ids"),
		view(organizations.equipmentGroupOffsets, Uint32Array, "organization equipment offsets"),
		view(organizations.equipmentGroupIds, Int32Array, "organization equipment ids"),
	];
}

function portViews(ports: RailMirrorSnapshot["portEquipment"]["ports"]): ExpectedView[] {
	return [
		view(ports.equipmentGroupIds, Int32Array, "port equipment ids"),
		view(ports.routeKinds, Uint8Array, "port route kinds"),
		view(ports.routeXs, Int32Array, "port route xs"),
		view(ports.routeZs, Int32Array, "port route zs"),
		view(ports.routeFromDirections, Uint8Array, "port route from directions"),
		view(ports.routeToDirections, Uint8Array, "port route to directions"),
		view(ports.routeSwitchIds, Int32Array, "port route switch ids"),
		view(ports.routeProfileClasses, Uint8Array, "port route profile classes"),
		view(ports.routeRoles, Uint8Array, "port route roles"),
		view(ports.routePortIndices, Int8Array, "port route indices"),
		view(ports.routeSegmentOrdinals, Uint16Array, "port route ordinals"),
		view(ports.stationMillimeters, Int32Array, "port stations"),
		view(ports.sides, Uint8Array, "port sides"),
		view(ports.lateralOffsetMillimeters, Uint32Array, "port lateral offsets"),
		view(ports.directions, Uint8Array, "port directions"),
		view(ports.portTypes, Uint8Array, "port types"),
	];
}

function view(value: unknown, arrayType: ExpectedView["arrayType"], label: string): ExpectedView {
	return { view: value, arrayType, label };
}

function deepFreezeSnapshotContainers(snapshot: RailMirrorSnapshot): void {
	Object.freeze(snapshot.switchRecords);
	Object.freeze(snapshot.portEquipment.ports);
	Object.freeze(snapshot.portEquipment.equipmentGroups);
	Object.freeze(snapshot.portEquipment);
	// Do not enumerate/freeze row arrays or typed buffers on main; the transferred source is private.
	Object.freeze(snapshot.organizations.records);
	Object.freeze(snapshot.organizations);
	Object.freeze(snapshot);
}

function creationFingerprint(
	identity: OpenFabFabPreparedProjectIdentity,
	manifest: OpenFabProjectManifest,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		"openfab-fab-new-project-creation",
		identity.fingerprint,
		manifest.id,
		manifest.name,
		manifest.createdAt,
		manifest.updatedAt,
	]);
	return `openfab-fab-new-project:v1:${checksum.digest()}`;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
	const actual = Object.keys(value);
	return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
