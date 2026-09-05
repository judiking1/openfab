import { deriveAdvancedSwitchGeometry } from "../core/AdvancedSwitch";
import {
	collectPortEquipmentIntegrityIssues,
	type EquipmentGroupRecord,
	type PortEquipmentIntegrityIssue,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	collectPortEquipmentLayoutIssuesFromIntegrityValidState,
	equipmentGroupBodyBounds,
	type PortEquipmentLayoutIssue,
} from "../core/PortEquipmentLayoutValidator";
import type { PortRecord } from "../core/PortRecord";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import {
	collectStaticFabOrganizationIssues,
	type StaticFabOrganizationIssue,
	type StaticFabOrganizationIssueSourceState,
} from "../core/StaticFabOrganizationIssues";
import type { Cell, TileMap } from "../core/TileMap";
import { checksumRailMapDiagnostic } from "../worker/RailMirrorChecksum";
import { isTransferableTypedArray } from "../worker/TransferableTypedArray";
import {
	type CompiledPhysicalLayout,
	compiledPhysicalLayoutHasDifferentSource,
} from "./PhysicalRailCompiler";
import {
	createPortAttachmentSourceIndex,
	PORT_ATTACHMENT_FAILURE,
	type PortAttachmentFailureCode,
	type PortAttachmentSourceIndex,
	resolvePortAttachmentWithSourceIndex,
} from "./PortAttachmentResolver";
import type { RailProjectReadiness } from "./RailProjectReadiness";
import { compileStaticFabHierarchyIndex } from "./StaticFabHierarchy";

export const STATIC_FAB_PROJECT_CHECKS_KIND = "static-fab-project-checks" as const;
export const STATIC_FAB_PROJECT_CHECKS_VERSION = 3;
export const STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_KIND =
	"static-fab-project-checks-snapshot" as const;
export const STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_VERSION = 3;

export const STATIC_FAB_PROJECT_CHECK_CODES = [
	"ADVANCED_SWITCH_TOPOLOGY",
	"PORT_EQUIPMENT_INTEGRITY",
	"PORT_EQUIPMENT_LAYOUT",
	"PORT_ATTACHMENT",
	"EQUIPMENT_PARTIAL_ATTACHMENT",
	"ORGANIZATION_INTEGRITY",
	"HIERARCHY_AMBIGUOUS",
	"HIERARCHY_DERIVATION",
] as const;

export const STATIC_FAB_PROJECT_CHECK_DOMAINS = [
	"switch",
	"port",
	"equipment",
	"organization",
	"hierarchy",
] as const;

export const STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS = [
	"project",
	"rail",
	"switch",
	"port",
	"equipment",
	"organization",
] as const;

export const STATIC_FAB_PROJECT_CHECK_MEASUREMENT_UNITS = [
	"none",
	"millimeters",
	"meters",
] as const;
export const STATIC_FAB_PROJECT_CHECK_MEASUREMENT_RELATIONS = [
	"none",
	"minimum",
	"maximum",
	"exact",
	"overlap",
] as const;

export type StaticFabProjectCheckCode = (typeof STATIC_FAB_PROJECT_CHECK_CODES)[number];
export type StaticFabProjectCheckDomain = (typeof STATIC_FAB_PROJECT_CHECK_DOMAINS)[number];
export type StaticFabProjectCheckRole = "primary" | "consequence";
export type StaticFabProjectCheckLocationKind =
	(typeof STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS)[number];
export type StaticFabProjectCheckMeasurementUnit =
	(typeof STATIC_FAB_PROJECT_CHECK_MEASUREMENT_UNITS)[number];
export type StaticFabProjectCheckMeasurementRelation =
	(typeof STATIC_FAB_PROJECT_CHECK_MEASUREMENT_RELATIONS)[number];

export interface StaticFabProjectChecksSourceIdentity {
	readonly revision: number;
	readonly checksum: string;
	readonly sequence: number;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
}

export interface StaticFabProjectCheckBounds {
	readonly minX: number;
	readonly minZ: number;
	readonly maxX: number;
	readonly maxZ: number;
}

export interface StaticFabProjectCheckLocation {
	readonly bounds: StaticFabProjectCheckBounds;
	readonly kind: StaticFabProjectCheckLocationKind;
	readonly entityId: number;
	readonly recordIndex: number;
	readonly occurrenceIndex: number;
	readonly detail: string;
	readonly relatedKind: StaticFabProjectCheckLocationKind | null;
	readonly relatedEntityId: number;
	readonly relatedRecordIndex: number;
	readonly token: string | null;
	readonly measuredValue: number | null;
	readonly requiredValue: number | null;
	readonly measurementUnit: StaticFabProjectCheckMeasurementUnit;
	readonly measurementRelation: StaticFabProjectCheckMeasurementRelation;
}

export interface StaticFabProjectCheckIssue {
	readonly id: string;
	readonly code: StaticFabProjectCheckCode;
	readonly domain: StaticFabProjectCheckDomain;
	readonly role: StaticFabProjectCheckRole;
	readonly sourceCode: string;
	readonly detail: string;
	readonly affectedCount: number;
	readonly occurrenceOffset: number;
	readonly locationOffset: number;
	readonly locationCount: number;
}

export interface StaticFabProjectChecksSummary {
	readonly railReady: boolean;
	readonly railIssueCount: number;
	readonly advancedSwitchCount: number;
	readonly switchIssueCount: number;
	readonly portCount: number;
	readonly portIssueCount: number;
	readonly equipmentGroupCount: number;
	readonly equipmentIssueCount: number;
	readonly organizationCount: number;
	readonly organizationIssueCount: number;
	readonly hierarchyIssueCount: number;
	readonly portChecksComplete: boolean;
	readonly equipmentChecksComplete: boolean;
	readonly organizationChecksComplete: boolean;
	readonly blockingIssueCount: number;
	readonly followUpIssueCount: number;
}

export interface StaticFabProjectChecks {
	readonly kind: typeof STATIC_FAB_PROJECT_CHECKS_KIND;
	readonly version: typeof STATIC_FAB_PROJECT_CHECKS_VERSION;
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly sourceSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly railReadinessFingerprint: string;
	readonly fingerprint: string;
	readonly ready: boolean;
	readonly summary: StaticFabProjectChecksSummary;
	readonly issues: readonly StaticFabProjectCheckIssue[];
	readonly locationCount: number;
	readOccurrenceDetail(issue: StaticFabProjectCheckIssue, index: number): string | null;
	readLocation(
		issue: StaticFabProjectCheckIssue,
		index: number,
	): StaticFabProjectCheckLocation | null;
}

export interface StaticFabProjectCheckIssueSnapshot {
	readonly code: StaticFabProjectCheckCode;
	readonly domain: StaticFabProjectCheckDomain;
	readonly role: StaticFabProjectCheckRole;
	readonly sourceCode: string;
	readonly detail: string;
	readonly affectedCount: number;
}

export interface StaticFabProjectChecksSnapshot {
	readonly kind: typeof STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_KIND;
	readonly version: typeof STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_VERSION;
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly sourceSequence: number;
	readonly sourceNextAdvancedSwitchId: number;
	readonly sourceNextPortId: number;
	readonly sourceNextEquipmentGroupId: number;
	readonly sourceNextOrganizationId: number;
	readonly railReadinessFingerprint: string;
	readonly fingerprint: string;
	readonly summary: Uint32Array;
	readonly issues: readonly StaticFabProjectCheckIssueSnapshot[];
	readonly issueOccurrenceOffsets: Uint32Array;
	readonly occurrenceDetails: readonly string[];
	readonly issueLocationOffsets: Uint32Array;
	readonly locationBounds: Float64Array;
	readonly locationKinds: Uint8Array;
	readonly locationEntityIds: Int32Array;
	readonly locationRecordIndexes: Int32Array;
	readonly locationOccurrenceIndexes: Uint32Array;
	readonly locationDetailIndexes: Uint32Array;
	readonly locationDetails: readonly string[];
	readonly locationRelatedKinds: Uint8Array;
	readonly locationRelatedEntityIds: Int32Array;
	readonly locationRelatedRecordIndexes: Int32Array;
	readonly locationTokenIndexes: Uint32Array;
	readonly locationTokens: readonly string[];
	readonly locationMeasuredValues: Float64Array;
	readonly locationRequiredValues: Float64Array;
	readonly locationMeasurementUnits: Uint8Array;
	readonly locationMeasurementRelations: Uint8Array;
}

interface MutableIssue {
	readonly code: StaticFabProjectCheckCode;
	readonly domain: StaticFabProjectCheckDomain;
	readonly role: StaticFabProjectCheckRole;
	readonly sourceCode: string;
	detail: string;
	affectedCount: number;
	readonly occurrenceDetails: string[];
	readonly locations: StaticFabProjectCheckLocation[];
}

interface StaticFabProjectCheckLocationContext {
	readonly recordIndex?: number;
	readonly relatedKind?: StaticFabProjectCheckLocationKind | null;
	readonly relatedEntityId?: number;
	readonly relatedRecordIndex?: number;
	readonly token?: string | null;
	readonly measuredValue?: number | null;
	readonly requiredValue?: number | null;
	readonly measurementUnit?: StaticFabProjectCheckMeasurementUnit;
	readonly measurementRelation?: StaticFabProjectCheckMeasurementRelation;
}

const SUMMARY_WIDTH = 16;
const MAXIMUM_DETAIL_LENGTH = 500;
const MAXIMUM_SOURCE_CODE_LENGTH = 96;
const MAXIMUM_LOCATION_TOKEN_LENGTH = 256;
const NO_RELATED_LOCATION_KIND = 0xff;
const projectChecksArtifacts = new WeakSet<object>();

export function isStaticFabProjectChecks(value: unknown): value is StaticFabProjectChecks {
	return typeof value === "object" && value !== null && projectChecksArtifacts.has(value);
}

/**
 * Derive compact, read-only project diagnostics from one exact canonical source generation.
 * The caller owns physical/readiness preparation so the Navigator Worker can share those O(n)
 * artifacts with its overview instead of compiling a second editable representation.
 */
export function deriveStaticFabProjectChecksSnapshot(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationIssueSourceState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	physical: CompiledPhysicalLayout,
	readiness: RailProjectReadiness,
	source: StaticFabProjectChecksSourceIdentity,
	attachmentSourceIndex: PortAttachmentSourceIndex = createPortAttachmentSourceIndex(physical),
): StaticFabProjectChecksSnapshot {
	assertSourceIdentity(
		map,
		portEquipment,
		organizations,
		relationships,
		physical,
		readiness,
		source,
	);
	const issueByKey = new Map<string, MutableIssue>();
	const projectBounds = mapProjectBounds(map);
	const portsById = new Map(portEquipment.ports.map((port) => [port.id, port] as const));
	const equipmentGroupsById = new Map(
		portEquipment.equipmentGroups.map((group) => [group.id, group] as const),
	);

	let switchIssueCount = 0;
	for (const diagnostic of physical.diagnostics) {
		const switchId = diagnostic.switchId;
		if (switchId === undefined) continue;
		switchIssueCount++;
		const cells = diagnostic.cells?.length ? diagnostic.cells : [diagnostic.cell];
		addIssueOccurrence(
			issueByKey,
			"ADVANCED_SWITCH_TOPOLOGY",
			"switch",
			"primary",
			diagnostic.code,
			diagnostic.message,
			cells.map((cell) => cellLocation(cell, "switch", switchId)),
		);
	}

	const integrityIssues = collectPortEquipmentIntegrityIssues(portEquipment);
	for (const issue of integrityIssues) {
		addIssueOccurrence(
			issueByKey,
			"PORT_EQUIPMENT_INTEGRITY",
			portEquipmentIntegrityIssueDomain(issue),
			"primary",
			issue.code,
			issue.message,
			portEquipmentIntegrityIssueLocations(map, portEquipment, issue, projectBounds, portsById),
		);
	}
	const stateError = integrityIssues[0]?.message ?? null;
	const layoutIssues = stateError
		? []
		: collectPortEquipmentLayoutIssuesFromIntegrityValidState(map, portEquipment);
	for (const issue of layoutIssues) {
		addIssueOccurrence(
			issueByKey,
			"PORT_EQUIPMENT_LAYOUT",
			portEquipmentLayoutIssueDomain(issue),
			"primary",
			issue.code,
			issue.message,
			portEquipmentLayoutIssueLocations(map, issue, projectBounds, portsById, equipmentGroupsById),
		);
	}
	const portIntegrityIssueCount = integrityIssues.filter(
		(issue) => portEquipmentIntegrityIssueDomain(issue) === "port",
	).length;
	const portLayoutIssueCount = layoutIssues.filter(
		(issue) => portEquipmentLayoutIssueDomain(issue) === "port",
	).length;
	const equipmentIntegrityIssueCount = integrityIssues.length - portIntegrityIssueCount;
	const equipmentLayoutIssueCount = layoutIssues.length - portLayoutIssueCount;
	let portIssueCount = portIntegrityIssueCount + portLayoutIssueCount;
	const unresolvedByGroup = new Map<number, StaticFabProjectCheckLocation[]>();
	if (!stateError) {
		for (const port of portEquipment.ports) {
			const resolution = resolvePortAttachmentWithSourceIndex(
				physical,
				port,
				attachmentSourceIndex,
			);
			if (resolution.ok) continue;
			portIssueCount++;
			const location = portFallbackLocation(map, port, {}, projectBounds);
			addIssue(
				issueByKey,
				"PORT_ATTACHMENT",
				"port",
				portAttachmentIssueRole(readiness, resolution.code),
				resolution.code,
				resolution.message,
				location,
			);
			const groupLocations = unresolvedByGroup.get(port.equipmentGroupId);
			if (groupLocations) {
				if (location) groupLocations.push(location);
			} else {
				unresolvedByGroup.set(port.equipmentGroupId, location ? [location] : []);
			}
		}
	}

	for (const [groupId, locations] of unresolvedByGroup) {
		addIssue(
			issueByKey,
			"EQUIPMENT_PARTIAL_ATTACHMENT",
			"equipment",
			"consequence",
			"UNREACHABLE_MEMBER_PORT",
			"One or more member ports cannot resolve onto compiled physical rail.",
			locations.length > 0
				? boundsLocation(unionLocationBounds(locations), "equipment", groupId)
				: projectBounds
					? boundsLocation(projectBounds, "equipment", groupId)
					: null,
		);
	}

	const organizationIssues = collectStaticFabOrganizationIssues(map, portEquipment, organizations);
	for (const issue of organizationIssues) {
		addIssueOccurrence(
			issueByKey,
			"ORGANIZATION_INTEGRITY",
			"organization",
			"primary",
			issue.code,
			issue.message,
			staticFabOrganizationIssueLocations(issue),
		);
	}

	let hierarchyIssueCount = 0;
	if (map.size > 0) {
		try {
			const hierarchy = compileStaticFabHierarchyIndex(map, buildRailModuleOwnershipIndex(map));
			for (const [branchIndex, branch] of hierarchy.branches.entries()) {
				if (branch.processRowPairing.state !== "ambiguous") continue;
				hierarchyIssueCount++;
				const bounds = branch.factory.selection.bounds;
				addIssue(
					issueByKey,
					"HIERARCHY_AMBIGUOUS",
					"hierarchy",
					"primary",
					"PROCESS_ROW_PAIRING",
					branch.processRowPairing.reason,
					boundsLocation(
						{
							minX: bounds.minX,
							minZ: bounds.minY,
							maxX: bounds.maxX + 1,
							maxZ: bounds.maxY + 1,
						},
						"project",
						branchIndex,
					),
				);
			}
		} catch (error) {
			hierarchyIssueCount++;
			addIssue(
				issueByKey,
				"HIERARCHY_DERIVATION",
				"hierarchy",
				"primary",
				"DERIVATION_FAILED",
				error instanceof Error ? error.message : "Static FAB hierarchy derivation failed.",
				projectBounds ? boundsLocation(projectBounds, "project", 0) : null,
			);
		}
	}

	const mutableIssues = [...issueByKey.values()].sort(compareMutableIssues);
	const locationCount = mutableIssues.reduce((total, issue) => total + issue.locations.length, 0);
	assertUint32(locationCount, "Static FAB project check location count");
	const occurrenceCount = mutableIssues.reduce(
		(total, issue) => total + issue.occurrenceDetails.length,
		0,
	);
	assertUint32(occurrenceCount, "Static FAB project check occurrence count");
	const issueOccurrenceOffsets = new Uint32Array(mutableIssues.length + 1);
	const occurrenceDetails: string[] = [];
	const issueLocationOffsets = new Uint32Array(mutableIssues.length + 1);
	const locationBounds = new Float64Array(locationCount * 4);
	const locationKinds = new Uint8Array(locationCount);
	const locationEntityIds = new Int32Array(locationCount);
	const locationRecordIndexes = new Int32Array(locationCount);
	locationRecordIndexes.fill(-1);
	const locationOccurrenceIndexes = new Uint32Array(locationCount);
	const locationDetailIndexes = new Uint32Array(locationCount);
	const locationDetails: string[] = [];
	const locationDetailIndexByValue = new Map<string, number>();
	const locationRelatedKinds = new Uint8Array(locationCount);
	locationRelatedKinds.fill(NO_RELATED_LOCATION_KIND);
	const locationRelatedEntityIds = new Int32Array(locationCount);
	const locationRelatedRecordIndexes = new Int32Array(locationCount);
	locationRelatedRecordIndexes.fill(-1);
	const locationTokenIndexes = new Uint32Array(locationCount);
	const locationTokens = [""];
	const locationTokenIndexByValue = new Map<string, number>([["", 0]]);
	const locationMeasuredValues = new Float64Array(locationCount);
	locationMeasuredValues.fill(Number.NaN);
	const locationRequiredValues = new Float64Array(locationCount);
	locationRequiredValues.fill(Number.NaN);
	const locationMeasurementUnits = new Uint8Array(locationCount);
	const locationMeasurementRelations = new Uint8Array(locationCount);
	const issues: StaticFabProjectCheckIssueSnapshot[] = [];
	let occurrenceOffset = 0;
	let locationOffset = 0;
	for (const [issueIndex, issue] of mutableIssues.entries()) {
		issueOccurrenceOffsets[issueIndex] = occurrenceOffset;
		for (const detail of issue.occurrenceDetails) {
			occurrenceDetails.push(boundedText(detail, MAXIMUM_DETAIL_LENGTH));
			occurrenceOffset++;
		}
		issueLocationOffsets[issueIndex] = locationOffset;
		issues.push(
			Object.freeze({
				code: issue.code,
				domain: issue.domain,
				role: issue.role,
				sourceCode: boundedText(issue.sourceCode, MAXIMUM_SOURCE_CODE_LENGTH),
				detail: boundedText(issue.detail, MAXIMUM_DETAIL_LENGTH),
				affectedCount: issue.affectedCount,
			}),
		);
		for (const location of issue.locations) {
			writeBounds(locationBounds, locationOffset, location.bounds);
			locationKinds[locationOffset] = STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS.indexOf(
				location.kind,
			);
			locationEntityIds[locationOffset] = location.entityId;
			locationRecordIndexes[locationOffset] = location.recordIndex;
			locationOccurrenceIndexes[locationOffset] = location.occurrenceIndex;
			const detail = boundedText(location.detail, MAXIMUM_DETAIL_LENGTH);
			let detailIndex = locationDetailIndexByValue.get(detail);
			if (detailIndex === undefined) {
				detailIndex = locationDetails.length;
				locationDetailIndexByValue.set(detail, detailIndex);
				locationDetails.push(detail);
			}
			locationDetailIndexes[locationOffset] = detailIndex;
			locationRelatedKinds[locationOffset] =
				location.relatedKind === null
					? NO_RELATED_LOCATION_KIND
					: STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS.indexOf(location.relatedKind);
			locationRelatedEntityIds[locationOffset] = location.relatedEntityId;
			locationRelatedRecordIndexes[locationOffset] = location.relatedRecordIndex;
			const token = boundedText(location.token ?? "", MAXIMUM_LOCATION_TOKEN_LENGTH);
			let tokenIndex = locationTokenIndexByValue.get(token);
			if (tokenIndex === undefined) {
				tokenIndex = locationTokens.length;
				locationTokenIndexByValue.set(token, tokenIndex);
				locationTokens.push(token);
			}
			locationTokenIndexes[locationOffset] = tokenIndex;
			locationMeasuredValues[locationOffset] = location.measuredValue ?? Number.NaN;
			locationRequiredValues[locationOffset] = location.requiredValue ?? Number.NaN;
			locationMeasurementUnits[locationOffset] = STATIC_FAB_PROJECT_CHECK_MEASUREMENT_UNITS.indexOf(
				location.measurementUnit,
			);
			locationMeasurementRelations[locationOffset] =
				STATIC_FAB_PROJECT_CHECK_MEASUREMENT_RELATIONS.indexOf(location.measurementRelation);
			locationOffset++;
		}
	}
	issueOccurrenceOffsets[mutableIssues.length] = occurrenceOffset;
	issueLocationOffsets[mutableIssues.length] = locationOffset;
	assertUint32(occurrenceDetails.length, "Static FAB project check occurrence detail count");
	assertUint32(locationDetails.length, "Static FAB project check location detail count");

	const blockingIssueCount = mutableIssues.filter((issue) => issue.role === "primary").length;
	const followUpIssueCount = mutableIssues.length - blockingIssueCount;
	const summary: StaticFabProjectChecksSummary = Object.freeze({
		railReady: readiness.ready,
		railIssueCount: readiness.issues.length,
		advancedSwitchCount: map.advancedSwitchCount,
		switchIssueCount,
		portCount: portEquipment.ports.length,
		portIssueCount,
		equipmentGroupCount: portEquipment.equipmentGroups.length,
		equipmentIssueCount:
			unresolvedByGroup.size + equipmentIntegrityIssueCount + equipmentLayoutIssueCount,
		organizationCount: organizations.records.length,
		organizationIssueCount: organizationIssues.length,
		hierarchyIssueCount,
		portChecksComplete: stateError === null,
		equipmentChecksComplete: stateError === null,
		organizationChecksComplete: stateError === null,
		blockingIssueCount,
		followUpIssueCount,
	});
	const summaryColumns = new Uint32Array(SUMMARY_WIDTH);
	writeSummary(summaryColumns, summary);
	const fingerprint = projectChecksFingerprint(
		source,
		readiness.fingerprint,
		summaryColumns,
		issues,
		issueOccurrenceOffsets,
		occurrenceDetails,
		issueLocationOffsets,
		locationBounds,
		locationKinds,
		locationEntityIds,
		locationRecordIndexes,
		locationOccurrenceIndexes,
		locationDetailIndexes,
		locationDetails,
		locationRelatedKinds,
		locationRelatedEntityIds,
		locationRelatedRecordIndexes,
		locationTokenIndexes,
		locationTokens,
		locationMeasuredValues,
		locationRequiredValues,
		locationMeasurementUnits,
		locationMeasurementRelations,
	);

	return Object.freeze({
		kind: STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_KIND,
		version: STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_VERSION,
		sourceRevision: source.revision,
		sourceChecksum: source.checksum,
		sourceSequence: source.sequence,
		sourceNextAdvancedSwitchId: source.nextAdvancedSwitchId,
		sourceNextPortId: source.nextPortId,
		sourceNextEquipmentGroupId: source.nextEquipmentGroupId,
		sourceNextOrganizationId: source.nextOrganizationId,
		railReadinessFingerprint: readiness.fingerprint,
		fingerprint,
		summary: summaryColumns,
		issues: Object.freeze(issues),
		issueOccurrenceOffsets,
		occurrenceDetails: Object.freeze(occurrenceDetails),
		issueLocationOffsets,
		locationBounds,
		locationKinds,
		locationEntityIds,
		locationRecordIndexes,
		locationOccurrenceIndexes,
		locationDetailIndexes,
		locationDetails: Object.freeze(locationDetails),
		locationRelatedKinds,
		locationRelatedEntityIds,
		locationRelatedRecordIndexes,
		locationTokenIndexes,
		locationTokens: Object.freeze(locationTokens),
		locationMeasuredValues,
		locationRequiredValues,
		locationMeasurementUnits,
		locationMeasurementRelations,
	});
}

export function hydrateStaticFabProjectChecksSnapshot(
	snapshot: unknown,
	expectedSource?: StaticFabProjectChecksSourceIdentity,
	expectedRailReadinessFingerprint?: string,
): StaticFabProjectChecks {
	validateSnapshot(snapshot, expectedSource, expectedRailReadinessFingerprint);
	const validated = cloneStaticFabProjectChecksSnapshot(snapshot as StaticFabProjectChecksSnapshot);
	const summary = readSummary(validated.summary);
	const issues = Object.freeze(
		validated.issues.map((issue, index) =>
			Object.freeze({
				id: staticFabProjectCheckIssueId(issue),
				...issue,
				occurrenceOffset: validated.issueOccurrenceOffsets[index] as number,
				locationOffset: validated.issueLocationOffsets[index] as number,
				locationCount:
					(validated.issueLocationOffsets[index + 1] as number) -
					(validated.issueLocationOffsets[index] as number),
			}),
		),
	);
	const issueSet = new Set<StaticFabProjectCheckIssue>(issues);
	const artifact: StaticFabProjectChecks = Object.freeze({
		kind: STATIC_FAB_PROJECT_CHECKS_KIND,
		version: STATIC_FAB_PROJECT_CHECKS_VERSION,
		sourceRevision: validated.sourceRevision,
		sourceChecksum: validated.sourceChecksum,
		sourceSequence: validated.sourceSequence,
		sourceNextAdvancedSwitchId: validated.sourceNextAdvancedSwitchId,
		sourceNextPortId: validated.sourceNextPortId,
		sourceNextEquipmentGroupId: validated.sourceNextEquipmentGroupId,
		sourceNextOrganizationId: validated.sourceNextOrganizationId,
		railReadinessFingerprint: validated.railReadinessFingerprint,
		fingerprint: validated.fingerprint,
		ready: summary.railReady && summary.blockingIssueCount === 0,
		summary,
		issues,
		locationCount: validated.locationKinds.length,
		readOccurrenceDetail: (issue: StaticFabProjectCheckIssue, index: number) =>
			issueSet.has(issue) ? readOccurrenceDetail(validated, issue, index) : null,
		readLocation: (issue: StaticFabProjectCheckIssue, index: number) =>
			issueSet.has(issue) ? readLocation(validated, issue, index) : null,
	});
	projectChecksArtifacts.add(artifact);
	return artifact;
}

function cloneStaticFabProjectChecksSnapshot(
	snapshot: StaticFabProjectChecksSnapshot,
): StaticFabProjectChecksSnapshot {
	return Object.freeze({
		kind: snapshot.kind,
		version: snapshot.version,
		sourceRevision: snapshot.sourceRevision,
		sourceChecksum: snapshot.sourceChecksum,
		sourceSequence: snapshot.sourceSequence,
		sourceNextAdvancedSwitchId: snapshot.sourceNextAdvancedSwitchId,
		sourceNextPortId: snapshot.sourceNextPortId,
		sourceNextEquipmentGroupId: snapshot.sourceNextEquipmentGroupId,
		sourceNextOrganizationId: snapshot.sourceNextOrganizationId,
		railReadinessFingerprint: snapshot.railReadinessFingerprint,
		fingerprint: snapshot.fingerprint,
		summary: snapshot.summary.slice(),
		issues: Object.freeze(snapshot.issues.map((issue) => Object.freeze({ ...issue }))),
		issueOccurrenceOffsets: snapshot.issueOccurrenceOffsets.slice(),
		occurrenceDetails: Object.freeze([...snapshot.occurrenceDetails]),
		issueLocationOffsets: snapshot.issueLocationOffsets.slice(),
		locationBounds: snapshot.locationBounds.slice(),
		locationKinds: snapshot.locationKinds.slice(),
		locationEntityIds: snapshot.locationEntityIds.slice(),
		locationRecordIndexes: snapshot.locationRecordIndexes.slice(),
		locationOccurrenceIndexes: snapshot.locationOccurrenceIndexes.slice(),
		locationDetailIndexes: snapshot.locationDetailIndexes.slice(),
		locationDetails: Object.freeze([...snapshot.locationDetails]),
		locationRelatedKinds: snapshot.locationRelatedKinds.slice(),
		locationRelatedEntityIds: snapshot.locationRelatedEntityIds.slice(),
		locationRelatedRecordIndexes: snapshot.locationRelatedRecordIndexes.slice(),
		locationTokenIndexes: snapshot.locationTokenIndexes.slice(),
		locationTokens: Object.freeze([...snapshot.locationTokens]),
		locationMeasuredValues: snapshot.locationMeasuredValues.slice(),
		locationRequiredValues: snapshot.locationRequiredValues.slice(),
		locationMeasurementUnits: snapshot.locationMeasurementUnits.slice(),
		locationMeasurementRelations: snapshot.locationMeasurementRelations.slice(),
	});
}

export function staticFabProjectCheckIssueId(
	issue: Pick<StaticFabProjectCheckIssueSnapshot, "code" | "sourceCode">,
): string {
	return `static-fab:${issue.code}:${issue.sourceCode || "-"}`;
}

function readOccurrenceDetail(
	snapshot: StaticFabProjectChecksSnapshot,
	issue: StaticFabProjectCheckIssue,
	index: number,
): string | null {
	if (!Number.isSafeInteger(index) || index < 0 || index >= issue.affectedCount) return null;
	return snapshot.occurrenceDetails[issue.occurrenceOffset + index] ?? null;
}

function readLocation(
	snapshot: StaticFabProjectChecksSnapshot,
	issue: StaticFabProjectCheckIssue,
	index: number,
): StaticFabProjectCheckLocation | null {
	if (!Number.isSafeInteger(index) || index < 0 || index >= issue.locationCount) return null;
	const row = issue.locationOffset + index;
	const kind = STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS[snapshot.locationKinds[row] as number];
	if (!kind) return null;
	const relatedKindIndex = snapshot.locationRelatedKinds[row] as number;
	const relatedKind =
		relatedKindIndex === NO_RELATED_LOCATION_KIND
			? null
			: (STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS[relatedKindIndex] ?? null);
	const measuredValue = snapshot.locationMeasuredValues[row] as number;
	const requiredValue = snapshot.locationRequiredValues[row] as number;
	const measurementUnit =
		STATIC_FAB_PROJECT_CHECK_MEASUREMENT_UNITS[snapshot.locationMeasurementUnits[row] as number];
	const measurementRelation =
		STATIC_FAB_PROJECT_CHECK_MEASUREMENT_RELATIONS[
			snapshot.locationMeasurementRelations[row] as number
		];
	const detail = snapshot.locationDetails[snapshot.locationDetailIndexes[row] as number];
	const token = snapshot.locationTokens[snapshot.locationTokenIndexes[row] as number];
	if (!measurementUnit || !measurementRelation || detail === undefined || token === undefined) {
		return null;
	}
	return Object.freeze({
		bounds: readBounds(snapshot.locationBounds, row),
		kind,
		entityId: snapshot.locationEntityIds[row] as number,
		recordIndex: snapshot.locationRecordIndexes[row] as number,
		occurrenceIndex: snapshot.locationOccurrenceIndexes[row] as number,
		detail,
		relatedKind,
		relatedEntityId: snapshot.locationRelatedEntityIds[row] as number,
		relatedRecordIndex: snapshot.locationRelatedRecordIndexes[row] as number,
		token: token.length > 0 ? token : null,
		measuredValue: Number.isNaN(measuredValue) ? null : measuredValue,
		requiredValue: Number.isNaN(requiredValue) ? null : requiredValue,
		measurementUnit,
		measurementRelation,
	});
}

function addIssue(
	issues: Map<string, MutableIssue>,
	code: StaticFabProjectCheckCode,
	domain: StaticFabProjectCheckDomain,
	role: StaticFabProjectCheckRole,
	sourceCode: string,
	detail: string,
	location: StaticFabProjectCheckLocation | null,
): void {
	addIssueOccurrence(issues, code, domain, role, sourceCode, detail, location ? [location] : []);
}

function addIssueOccurrence(
	issues: Map<string, MutableIssue>,
	code: StaticFabProjectCheckCode,
	domain: StaticFabProjectCheckDomain,
	role: StaticFabProjectCheckRole,
	sourceCode: string,
	detail: string,
	locations: readonly StaticFabProjectCheckLocation[],
): void {
	const key = `${code}:${sourceCode}`;
	const existing = issues.get(key);
	if (existing) {
		const occurrenceIndex = existing.affectedCount;
		existing.occurrenceDetails.push(detail);
		existing.affectedCount++;
		existing.locations.push(
			...locations.map((location) => locationWithOccurrence(location, occurrenceIndex, detail)),
		);
		return;
	}
	issues.set(key, {
		code,
		domain,
		role,
		sourceCode,
		detail,
		affectedCount: 1,
		occurrenceDetails: [detail],
		locations: locations.map((location) => locationWithOccurrence(location, 0, detail)),
	});
}

function locationWithOccurrence(
	location: StaticFabProjectCheckLocation,
	occurrenceIndex: number,
	detail: string,
): StaticFabProjectCheckLocation {
	return Object.freeze({ ...location, occurrenceIndex, detail });
}

function portEquipmentIntegrityIssueDomain(
	issue: PortEquipmentIntegrityIssue,
): "port" | "equipment" {
	return issue.code === "NEXT_PORT_ID_CURSOR_INVALID" ||
		issue.code === "NEXT_PORT_ID_CURSOR_STALE" ||
		issue.code === "PORT_RECORD_INVALID" ||
		issue.code === "PORT_ID_DUPLICATE" ||
		issue.code === "PORT_BARCODE_DUPLICATE" ||
		issue.code === "PORT_EQUIPMENT_GROUP_MISSING" ||
		issue.code === "PORT_NOT_OWNED_BY_GROUP"
		? "port"
		: "equipment";
}

function portEquipmentIntegrityIssueLocations(
	map: TileMap,
	state: PortEquipmentState,
	issue: PortEquipmentIntegrityIssue,
	projectBounds: StaticFabProjectCheckBounds | null,
	portsById: ReadonlyMap<number, PortRecord>,
): readonly StaticFabProjectCheckLocation[] {
	const locations: StaticFabProjectCheckLocation[] = [];
	for (const [position, recordIndex] of issue.portRecordIndexes.entries()) {
		const port = state.ports[recordIndex];
		if (!port) continue;
		const context = {
			...integrityPortLocationContext(issue, position, port.id),
			recordIndex,
		};
		const location = portFallbackLocation(map, port, context, projectBounds);
		if (location) locations.push(location);
	}
	for (const [position, recordIndex] of issue.equipmentGroupRecordIndexes.entries()) {
		const group = state.equipmentGroups[recordIndex];
		if (!group) continue;
		const context = {
			...integrityEquipmentLocationContext(issue, position, group.id),
			recordIndex,
		};
		locations.push(equipmentGroupFallbackLocation(map, group, portsById, projectBounds, context));
	}
	if (locations.length > 0) return Object.freeze(locations);
	if (!projectBounds) return Object.freeze([]);
	const firstPortId = issue.portIds[0];
	if (firstPortId !== undefined) {
		return Object.freeze([
			boundsLocation(
				projectBounds,
				"port",
				firstPortId,
				integrityPortLocationContext(issue, 0, firstPortId),
			),
		]);
	}
	const firstEquipmentGroupId = issue.equipmentGroupIds[0];
	if (firstEquipmentGroupId !== undefined) {
		return Object.freeze([
			boundsLocation(
				projectBounds,
				"equipment",
				firstEquipmentGroupId,
				integrityEquipmentLocationContext(issue, 0, firstEquipmentGroupId),
			),
		]);
	}
	return Object.freeze([boundsLocation(projectBounds, "project", 0)]);
}

function integrityPortLocationContext(
	issue: PortEquipmentIntegrityIssue,
	position: number,
	portId: number,
): StaticFabProjectCheckLocationContext {
	if (issue.portIds.length > 1) {
		const relatedPortId =
			issue.portIds.find((candidate) => candidate !== portId) ??
			issue.portIds[position === 0 ? 1 : 0];
		if (relatedPortId !== undefined) {
			return { relatedKind: "port", relatedEntityId: relatedPortId };
		}
	}
	const relatedEquipmentGroupId = issue.equipmentGroupIds.at(-1);
	return relatedEquipmentGroupId === undefined
		? {}
		: { relatedKind: "equipment", relatedEntityId: relatedEquipmentGroupId };
}

function integrityEquipmentLocationContext(
	issue: PortEquipmentIntegrityIssue,
	position: number,
	equipmentGroupId: number,
): StaticFabProjectCheckLocationContext {
	if (issue.equipmentGroupIds.length > 1) {
		const relatedEquipmentGroupId =
			issue.equipmentGroupIds.find((candidate) => candidate !== equipmentGroupId) ??
			issue.equipmentGroupIds[position === 0 ? 1 : 0];
		if (relatedEquipmentGroupId !== undefined) {
			return { relatedKind: "equipment", relatedEntityId: relatedEquipmentGroupId };
		}
	}
	const relatedPortId = issue.portIds[0];
	return relatedPortId === undefined ? {} : { relatedKind: "port", relatedEntityId: relatedPortId };
}

function portEquipmentLayoutIssueDomain(issue: PortEquipmentLayoutIssue): "port" | "equipment" {
	return issue.code === "PORT_ROUTE_MISSING" ||
		issue.code === "PORT_STATION_OCCUPIED" ||
		issue.code === "PORT_SPACING"
		? "port"
		: "equipment";
}

function portEquipmentLayoutIssueLocations(
	map: TileMap,
	issue: PortEquipmentLayoutIssue,
	projectBounds: StaticFabProjectCheckBounds | null,
	portsById: ReadonlyMap<number, PortRecord>,
	equipmentGroupsById: ReadonlyMap<number, EquipmentGroupRecord>,
): readonly StaticFabProjectCheckLocation[] {
	const locations: StaticFabProjectCheckLocation[] = [];
	const measurement = layoutIssueMeasurementContext(issue);
	const coveredCells = new Set<string>();
	for (const [position, portId] of issue.portIds.entries()) {
		const port = portsById.get(portId);
		if (!port) continue;
		if (port.route.kind === "CARDINAL_CELL") {
			coveredCells.add(`${port.route.x}:${port.route.z}`);
		}
		const location = portFallbackLocation(
			map,
			port,
			{
				...measurement,
				...layoutPortLocationRelation(issue, position, port, portsById),
			},
			projectBounds,
		);
		if (location) locations.push(location);
	}
	for (const [position, equipmentGroupId] of issue.equipmentGroupIds.entries()) {
		const group = equipmentGroupsById.get(equipmentGroupId);
		if (!group) continue;
		locations.push(
			equipmentGroupFallbackLocation(map, group, portsById, projectBounds, {
				...measurement,
				...layoutEquipmentLocationRelation(issue, position, group.id),
			}),
		);
	}
	for (const cell of issue.cells) {
		if (coveredCells.has(`${cell.x}:${cell.z}`)) continue;
		locations.push(
			boundsLocation(
				{ minX: cell.x, minZ: cell.z, maxX: cell.x + 1, maxZ: cell.z + 1 },
				"rail",
				0,
				{
					...measurement,
					...layoutRailLocationRelation(issue),
				},
			),
		);
	}
	if (locations.length > 0) return Object.freeze(locations);
	if (!projectBounds) return Object.freeze([]);
	const firstPortId = issue.portIds[0];
	if (firstPortId !== undefined) {
		return Object.freeze([
			boundsLocation(projectBounds, "port", firstPortId, {
				...measurement,
				...layoutPortLocationRelation(issue, 0, portsById.get(firstPortId) ?? null, portsById),
			}),
		]);
	}
	const firstEquipmentGroupId = issue.equipmentGroupIds[0];
	if (firstEquipmentGroupId !== undefined) {
		return Object.freeze([
			boundsLocation(projectBounds, "equipment", firstEquipmentGroupId, {
				...measurement,
				...layoutEquipmentLocationRelation(issue, 0, firstEquipmentGroupId),
			}),
		]);
	}
	return Object.freeze([boundsLocation(projectBounds, "project", 0, measurement)]);
}

function layoutIssueMeasurementContext(
	issue: PortEquipmentLayoutIssue,
): StaticFabProjectCheckLocationContext {
	const measurement = issue.measurement;
	if (!measurement) return {};
	return {
		measuredValue: measurement.measured,
		requiredValue: measurement.required,
		measurementUnit: measurement.unit === "MILLIMETERS" ? "millimeters" : "meters",
		measurementRelation:
			measurement.relation === "MINIMUM"
				? "minimum"
				: measurement.relation === "MAXIMUM"
					? "maximum"
					: measurement.relation === "EXACT"
						? "exact"
						: "overlap",
	};
}

function layoutPortLocationRelation(
	issue: PortEquipmentLayoutIssue,
	position: number,
	port: PortRecord | null,
	portsById: ReadonlyMap<number, PortRecord>,
): StaticFabProjectCheckLocationContext {
	if (port && issue.equipmentGroupIds.length > 1) {
		const relatedEquipmentGroupId = issue.equipmentGroupIds.find(
			(candidate) => candidate !== port.equipmentGroupId,
		);
		if (relatedEquipmentGroupId !== undefined) {
			return { relatedKind: "equipment", relatedEntityId: relatedEquipmentGroupId };
		}
	}
	const portId = port?.id ?? issue.portIds[position];
	if (issue.portIds.length > 1) {
		const relatedPortId = issue.portIds.find((candidate) => {
			if (candidate === portId) return false;
			return !port || portsById.get(candidate)?.equipmentGroupId !== port.equipmentGroupId;
		});
		if (relatedPortId !== undefined) {
			return { relatedKind: "port", relatedEntityId: relatedPortId };
		}
	}
	const relatedEquipmentGroupId = issue.equipmentGroupIds[0];
	return relatedEquipmentGroupId === undefined
		? {}
		: { relatedKind: "equipment", relatedEntityId: relatedEquipmentGroupId };
}

function layoutEquipmentLocationRelation(
	issue: PortEquipmentLayoutIssue,
	position: number,
	equipmentGroupId: number,
): StaticFabProjectCheckLocationContext {
	if (issue.equipmentGroupIds.length > 1) {
		const relatedEquipmentGroupId =
			issue.equipmentGroupIds.find((candidate) => candidate !== equipmentGroupId) ??
			issue.equipmentGroupIds[position === 0 ? 1 : 0];
		if (relatedEquipmentGroupId !== undefined) {
			return { relatedKind: "equipment", relatedEntityId: relatedEquipmentGroupId };
		}
	}
	const relatedPortId = issue.portIds[0];
	return relatedPortId === undefined ? {} : { relatedKind: "port", relatedEntityId: relatedPortId };
}

function layoutRailLocationRelation(
	issue: PortEquipmentLayoutIssue,
): StaticFabProjectCheckLocationContext {
	const portId = issue.portIds[0];
	if (portId !== undefined) return { relatedKind: "port", relatedEntityId: portId };
	const equipmentGroupId = issue.equipmentGroupIds[0];
	return equipmentGroupId === undefined
		? {}
		: { relatedKind: "equipment", relatedEntityId: equipmentGroupId };
}

function staticFabOrganizationIssueLocations(
	issue: StaticFabOrganizationIssue,
): readonly StaticFabProjectCheckLocation[] {
	return Object.freeze(
		issue.locations.map((location) =>
			boundsLocation(
				location.bounds,
				location.organizationRecordIndex >= 0 ? "organization" : "project",
				location.organizationId,
				{
					recordIndex: location.organizationRecordIndex,
					relatedKind: location.relatedKind,
					relatedEntityId: location.relatedEntityId,
					relatedRecordIndex: location.relatedOrganizationRecordIndex,
					token: location.token,
				},
			),
		),
	);
}

function equipmentGroupFallbackLocation(
	map: TileMap,
	group: EquipmentGroupRecord,
	portsById: ReadonlyMap<number, PortRecord>,
	projectBounds: StaticFabProjectCheckBounds | null,
	context: StaticFabProjectCheckLocationContext = {},
): StaticFabProjectCheckLocation {
	const bodyBounds = equipmentGroupBodyBounds(group, portsById);
	if (bodyBounds && validLocationBounds(bodyBounds)) {
		return boundsLocation(bodyBounds, "equipment", group.id, context);
	}
	const memberLocations = group.portIds.flatMap((portId) => {
		const port = portsById.get(portId);
		const location = port ? portFallbackLocation(map, port, {}, projectBounds) : null;
		return location ? [location] : [];
	});
	return boundsLocation(
		memberLocations.length > 0
			? unionLocationBounds(memberLocations)
			: (projectBounds ?? { minX: 0, minZ: 0, maxX: 0, maxZ: 0 }),
		"equipment",
		group.id,
		context,
	);
}

function portFallbackLocation(
	map: TileMap,
	port: PortRecord,
	context: StaticFabProjectCheckLocationContext = {},
	projectBounds: StaticFabProjectCheckBounds | null = null,
): StaticFabProjectCheckLocation | null {
	if (port.route.kind === "CARDINAL_CELL") {
		if (!Number.isSafeInteger(port.route.x) || !Number.isSafeInteger(port.route.z)) {
			return projectBounds ? boundsLocation(projectBounds, "port", port.id, context) : null;
		}
		return boundsLocation(
			{
				minX: port.route.x,
				minZ: port.route.z,
				maxX: port.route.x + 1,
				maxZ: port.route.z + 1,
			},
			"port",
			port.id,
			context,
		);
	}
	const record = map.getAdvancedSwitch(port.route.switchId);
	if (!record) {
		const bounds = projectBounds ?? mapProjectBounds(map);
		return bounds ? boundsLocation(bounds, "port", port.id, context) : null;
	}
	const cells = deriveAdvancedSwitchGeometry(record).claimedCells;
	let minX = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const cell of cells) {
		minX = Math.min(minX, cell.x);
		minZ = Math.min(minZ, cell.y);
		maxX = Math.max(maxX, cell.x + 1);
		maxZ = Math.max(maxZ, cell.y + 1);
	}
	return boundsLocation({ minX, minZ, maxX, maxZ }, "port", port.id, context);
}

function cellLocation(
	cell: Cell,
	kind: StaticFabProjectCheckLocationKind,
	entityId: number,
): StaticFabProjectCheckLocation {
	return boundsLocation(
		{ minX: cell.x, minZ: cell.y, maxX: cell.x + 1, maxZ: cell.y + 1 },
		kind,
		entityId,
	);
}

function boundsLocation(
	bounds: StaticFabProjectCheckBounds,
	kind: StaticFabProjectCheckLocationKind,
	entityId: number,
	context: StaticFabProjectCheckLocationContext = {},
): StaticFabProjectCheckLocation {
	return Object.freeze({
		bounds: Object.freeze({ ...bounds }),
		kind,
		entityId,
		recordIndex: context.recordIndex ?? -1,
		occurrenceIndex: 0,
		detail: "",
		relatedKind: context.relatedKind ?? null,
		relatedEntityId: context.relatedEntityId ?? 0,
		relatedRecordIndex: context.relatedRecordIndex ?? -1,
		token: context.token ?? null,
		measuredValue: context.measuredValue ?? null,
		requiredValue: context.requiredValue ?? null,
		measurementUnit: context.measurementUnit ?? "none",
		measurementRelation: context.measurementRelation ?? "none",
	});
}

function validLocationBounds(bounds: StaticFabProjectCheckBounds): boolean {
	return (
		Number.isFinite(bounds.minX) &&
		Number.isFinite(bounds.minZ) &&
		Number.isFinite(bounds.maxX) &&
		Number.isFinite(bounds.maxZ) &&
		bounds.maxX >= bounds.minX &&
		bounds.maxZ >= bounds.minZ
	);
}

function unionLocationBounds(
	locations: readonly StaticFabProjectCheckLocation[],
): StaticFabProjectCheckBounds {
	let minX = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (const location of locations) {
		minX = Math.min(minX, location.bounds.minX);
		minZ = Math.min(minZ, location.bounds.minZ);
		maxX = Math.max(maxX, location.bounds.maxX);
		maxZ = Math.max(maxZ, location.bounds.maxZ);
	}
	return { minX, minZ, maxX, maxZ };
}

function mapProjectBounds(map: TileMap): StaticFabProjectCheckBounds | null {
	const bounds = map.bounds();
	return bounds
		? {
				minX: bounds.minX,
				minZ: bounds.minY,
				maxX: bounds.maxX + 1,
				maxZ: bounds.maxY + 1,
			}
		: null;
}

function compareMutableIssues(left: MutableIssue, right: MutableIssue): number {
	const domain =
		STATIC_FAB_PROJECT_CHECK_DOMAINS.indexOf(left.domain) -
		STATIC_FAB_PROJECT_CHECK_DOMAINS.indexOf(right.domain);
	if (domain !== 0) return domain;
	const code =
		STATIC_FAB_PROJECT_CHECK_CODES.indexOf(left.code) -
		STATIC_FAB_PROJECT_CHECK_CODES.indexOf(right.code);
	if (code !== 0) return code;
	return left.sourceCode.localeCompare(right.sourceCode, "en-US");
}

function portAttachmentIssueRole(
	readiness: RailProjectReadiness,
	code: PortAttachmentFailureCode,
): StaticFabProjectCheckRole {
	if (readiness.ready) return "primary";
	return code === PORT_ATTACHMENT_FAILURE.UNMAPPABLE_INTERVAL ||
		code === PORT_ATTACHMENT_FAILURE.TARGET_PATH_INVALID ||
		code === PORT_ATTACHMENT_FAILURE.TARGET_AMBIGUOUS ||
		code === PORT_ATTACHMENT_FAILURE.SAMPLE_FAILED
		? "consequence"
		: "primary";
}

function assertSourceIdentity(
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationIssueSourceState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	physical: CompiledPhysicalLayout,
	readiness: RailProjectReadiness,
	source: StaticFabProjectChecksSourceIdentity,
): void {
	if (
		!Number.isSafeInteger(source.revision) ||
		source.revision < 0 ||
		!Number.isSafeInteger(source.sequence) ||
		source.sequence < 0 ||
		typeof source.checksum !== "string" ||
		source.checksum.length === 0 ||
		source.checksum !== source.checksum.trim() ||
		!validSourceCursor(source.nextAdvancedSwitchId) ||
		!validDiagnosticPortEquipmentCursor(source.nextPortId) ||
		!validDiagnosticPortEquipmentCursor(source.nextEquipmentGroupId) ||
		!validDiagnosticOrganizationCursor(source.nextOrganizationId)
	) {
		throw new Error("Static FAB project checks source identity is invalid.");
	}
	if (
		map.getRevision() !== source.revision ||
		physical.revision !== source.revision ||
		compiledPhysicalLayoutHasDifferentSource(physical, map)
	) {
		throw new Error("Static FAB project checks source revision is stale.");
	}
	if (readiness.authoredChecksum !== source.checksum) {
		throw new Error("Static FAB project checks source checksum is stale.");
	}
	let actualChecksum: string;
	try {
		actualChecksum = checksumRailMapDiagnostic(map, portEquipment, organizations, relationships);
	} catch (error) {
		throw new Error("Static FAB project checks source content cannot be checksummed.", {
			cause: error,
		});
	}
	if (actualChecksum !== source.checksum) {
		throw new Error("Static FAB project checks source content checksum is stale.");
	}
	if (
		(map.getNextAdvancedSwitchId() ?? 0x8000_0000) !== source.nextAdvancedSwitchId ||
		portEquipment.nextPortId !== source.nextPortId ||
		portEquipment.nextEquipmentGroupId !== source.nextEquipmentGroupId ||
		organizations.nextOrganizationId !== source.nextOrganizationId
	) {
		throw new Error("Static FAB project checks source cursor identity is stale.");
	}
}

function validateSnapshot(
	value: unknown,
	expectedSource?: StaticFabProjectChecksSourceIdentity,
	expectedRailReadinessFingerprint?: string,
): asserts value is StaticFabProjectChecksSnapshot {
	if (!isRecord(value)) throw new Error("Static FAB project checks snapshot must be an object.");
	if (
		value.kind !== STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_KIND ||
		value.version !== STATIC_FAB_PROJECT_CHECKS_SNAPSHOT_VERSION
	) {
		throw new Error("Static FAB project checks snapshot kind or version is invalid.");
	}
	if (
		!Number.isSafeInteger(value.sourceRevision) ||
		(value.sourceRevision as number) < 0 ||
		!Number.isSafeInteger(value.sourceSequence) ||
		(value.sourceSequence as number) < 0 ||
		!validSourceCursor(value.sourceNextAdvancedSwitchId) ||
		!validDiagnosticPortEquipmentCursor(value.sourceNextPortId) ||
		!validDiagnosticPortEquipmentCursor(value.sourceNextEquipmentGroupId) ||
		!validDiagnosticOrganizationCursor(value.sourceNextOrganizationId) ||
		typeof value.sourceChecksum !== "string" ||
		value.sourceChecksum.length === 0 ||
		typeof value.railReadinessFingerprint !== "string" ||
		value.railReadinessFingerprint.length === 0 ||
		typeof value.fingerprint !== "string" ||
		value.fingerprint.length === 0
	) {
		throw new Error("Static FAB project checks snapshot identity is invalid.");
	}
	if (
		expectedSource &&
		(value.sourceRevision !== expectedSource.revision ||
			value.sourceSequence !== expectedSource.sequence ||
			value.sourceChecksum !== expectedSource.checksum ||
			value.sourceNextAdvancedSwitchId !== expectedSource.nextAdvancedSwitchId ||
			value.sourceNextPortId !== expectedSource.nextPortId ||
			value.sourceNextEquipmentGroupId !== expectedSource.nextEquipmentGroupId ||
			value.sourceNextOrganizationId !== expectedSource.nextOrganizationId)
	) {
		throw new Error("Static FAB project checks snapshot source is stale.");
	}
	if (
		expectedRailReadinessFingerprint !== undefined &&
		value.railReadinessFingerprint !== expectedRailReadinessFingerprint
	) {
		throw new Error("Static FAB project checks rail readiness fingerprint is stale.");
	}
	if (
		!isTransferableTypedArray(value.summary, Uint32Array) ||
		value.summary.length !== SUMMARY_WIDTH
	) {
		throw new Error("Static FAB project checks summary is malformed.");
	}
	if (!Array.isArray(value.issues)) {
		throw new Error("Static FAB project checks issue records are malformed.");
	}
	const issueIds = new Set<string>();
	for (const issue of value.issues) {
		validateIssueSnapshot(issue);
		const id = staticFabProjectCheckIssueId(issue as StaticFabProjectCheckIssueSnapshot);
		if (issueIds.has(id))
			throw new Error("Static FAB project checks issue identity is duplicated.");
		issueIds.add(id);
	}
	const primaryIssueCount = value.issues.filter((issue) => issue.role === "primary").length;
	const consequenceIssueCount = value.issues.length - primaryIssueCount;
	const affectedByDomain = new Map<StaticFabProjectCheckDomain, number>();
	for (const issue of value.issues as readonly StaticFabProjectCheckIssueSnapshot[]) {
		affectedByDomain.set(
			issue.domain,
			(affectedByDomain.get(issue.domain) ?? 0) + issue.affectedCount,
		);
	}
	if (
		value.summary[0] > 1 ||
		value.summary[13] > 1 ||
		value.summary[14] > 1 ||
		value.summary[15] > 1 ||
		value.summary[3] !== (affectedByDomain.get("switch") ?? 0) ||
		value.summary[5] !== (affectedByDomain.get("port") ?? 0) ||
		value.summary[7] !== (affectedByDomain.get("equipment") ?? 0) ||
		value.summary[9] !== (affectedByDomain.get("organization") ?? 0) ||
		value.summary[10] !== (affectedByDomain.get("hierarchy") ?? 0) ||
		value.summary[11] !== primaryIssueCount ||
		value.summary[12] !== consequenceIssueCount
	) {
		throw new Error("Static FAB project checks summary does not match its issues.");
	}
	if (
		!isTransferableTypedArray(value.issueOccurrenceOffsets, Uint32Array) ||
		value.issueOccurrenceOffsets.length !== value.issues.length + 1 ||
		!Array.isArray(value.occurrenceDetails)
	) {
		throw new Error("Static FAB project checks occurrence columns are malformed.");
	}
	for (const detail of value.occurrenceDetails) {
		if (typeof detail !== "string" || detail.length > MAXIMUM_DETAIL_LENGTH) {
			throw new Error("Static FAB project checks occurrence details are malformed.");
		}
	}
	if ((value.issueOccurrenceOffsets[0] as number) !== 0) {
		throw new Error("Static FAB project checks occurrence offsets must start at zero.");
	}
	let previousOccurrenceOffset = 0;
	for (const offset of value.issueOccurrenceOffsets) {
		if (offset < previousOccurrenceOffset || offset > value.occurrenceDetails.length) {
			throw new Error("Static FAB project checks occurrence offsets are invalid.");
		}
		previousOccurrenceOffset = offset;
	}
	if (previousOccurrenceOffset !== value.occurrenceDetails.length) {
		throw new Error("Static FAB project check occurrences are not fully indexed.");
	}
	for (let issueIndex = 0; issueIndex < value.issues.length; issueIndex += 1) {
		const issue = value.issues[issueIndex] as StaticFabProjectCheckIssueSnapshot;
		const start = value.issueOccurrenceOffsets[issueIndex] as number;
		const end = value.issueOccurrenceOffsets[issueIndex + 1] as number;
		if (end - start !== issue.affectedCount) {
			throw new Error(`Static FAB project check issue ${issueIndex} occurrence count is invalid.`);
		}
	}
	if (
		!isTransferableTypedArray(value.issueLocationOffsets, Uint32Array) ||
		value.issueLocationOffsets.length !== value.issues.length + 1 ||
		!isTransferableTypedArray(value.locationBounds, Float64Array) ||
		!isTransferableTypedArray(value.locationKinds, Uint8Array) ||
		!isTransferableTypedArray(value.locationEntityIds, Int32Array) ||
		!isTransferableTypedArray(value.locationRecordIndexes, Int32Array) ||
		!isTransferableTypedArray(value.locationOccurrenceIndexes, Uint32Array) ||
		!isTransferableTypedArray(value.locationDetailIndexes, Uint32Array) ||
		!Array.isArray(value.locationDetails) ||
		!isTransferableTypedArray(value.locationRelatedKinds, Uint8Array) ||
		!isTransferableTypedArray(value.locationRelatedEntityIds, Int32Array) ||
		!isTransferableTypedArray(value.locationRelatedRecordIndexes, Int32Array) ||
		!isTransferableTypedArray(value.locationTokenIndexes, Uint32Array) ||
		!Array.isArray(value.locationTokens) ||
		!isTransferableTypedArray(value.locationMeasuredValues, Float64Array) ||
		!isTransferableTypedArray(value.locationRequiredValues, Float64Array) ||
		!isTransferableTypedArray(value.locationMeasurementUnits, Uint8Array) ||
		!isTransferableTypedArray(value.locationMeasurementRelations, Uint8Array) ||
		value.locationBounds.length !== value.locationKinds.length * 4 ||
		value.locationEntityIds.length !== value.locationKinds.length ||
		value.locationRecordIndexes.length !== value.locationKinds.length ||
		value.locationOccurrenceIndexes.length !== value.locationKinds.length ||
		value.locationDetailIndexes.length !== value.locationKinds.length ||
		value.locationRelatedKinds.length !== value.locationKinds.length ||
		value.locationRelatedEntityIds.length !== value.locationKinds.length ||
		value.locationRelatedRecordIndexes.length !== value.locationKinds.length ||
		value.locationTokenIndexes.length !== value.locationKinds.length ||
		value.locationMeasuredValues.length !== value.locationKinds.length ||
		value.locationRequiredValues.length !== value.locationKinds.length ||
		value.locationMeasurementUnits.length !== value.locationKinds.length ||
		value.locationMeasurementRelations.length !== value.locationKinds.length
	) {
		throw new Error("Static FAB project checks location columns are malformed.");
	}
	for (const detail of value.locationDetails) {
		if (typeof detail !== "string" || detail.length > MAXIMUM_DETAIL_LENGTH) {
			throw new Error("Static FAB project checks location details are malformed.");
		}
	}
	if (value.locationTokens[0] !== "") {
		throw new Error("Static FAB project checks location tokens must start with an empty sentinel.");
	}
	for (const token of value.locationTokens) {
		if (typeof token !== "string" || token.length > MAXIMUM_LOCATION_TOKEN_LENGTH) {
			throw new Error("Static FAB project checks location tokens are malformed.");
		}
	}
	if ((value.issueLocationOffsets[0] as number) !== 0) {
		throw new Error("Static FAB project checks issue offsets must start at zero.");
	}
	let previousOffset = 0;
	for (const offset of value.issueLocationOffsets) {
		if (offset < previousOffset || offset > value.locationKinds.length) {
			throw new Error("Static FAB project checks issue offsets are invalid.");
		}
		previousOffset = offset;
	}
	if (previousOffset !== value.locationKinds.length) {
		throw new Error("Static FAB project checks locations are not fully indexed.");
	}
	for (let issueIndex = 0; issueIndex < value.issues.length; issueIndex += 1) {
		const issue = value.issues[issueIndex] as StaticFabProjectCheckIssueSnapshot;
		const start = value.issueLocationOffsets[issueIndex] as number;
		const end = value.issueLocationOffsets[issueIndex + 1] as number;
		for (let row = start; row < end; row += 1) {
			if ((value.locationOccurrenceIndexes[row] as number) >= issue.affectedCount) {
				throw new Error(`Static FAB project checks location ${row} occurrence index is invalid.`);
			}
		}
	}
	for (let row = 0; row < value.locationKinds.length; row++) {
		const locationKind =
			STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS[value.locationKinds[row] as number];
		if (!locationKind) {
			throw new Error(`Static FAB project checks location ${row} kind is invalid.`);
		}
		const recordIndex = value.locationRecordIndexes[row] as number;
		if (
			recordIndex < -1 ||
			(recordIndex >= 0 &&
				locationKind !== "port" &&
				locationKind !== "equipment" &&
				locationKind !== "organization")
		) {
			throw new Error(`Static FAB project checks location ${row} record index is invalid.`);
		}
		if ((value.locationDetailIndexes[row] as number) >= value.locationDetails.length) {
			throw new Error(`Static FAB project checks location ${row} detail index is invalid.`);
		}
		if ((value.locationTokenIndexes[row] as number) >= value.locationTokens.length) {
			throw new Error(`Static FAB project checks location ${row} token index is invalid.`);
		}
		const relatedKind = value.locationRelatedKinds[row] as number;
		const relatedEntityId = value.locationRelatedEntityIds[row] as number;
		const relatedRecordIndex = value.locationRelatedRecordIndexes[row] as number;
		if (
			relatedKind !== NO_RELATED_LOCATION_KIND &&
			!STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS[relatedKind]
		) {
			throw new Error(`Static FAB project checks location ${row} related kind is invalid.`);
		}
		if (
			relatedRecordIndex < -1 ||
			(relatedRecordIndex >= 0 &&
				STATIC_FAB_PROJECT_CHECK_LOCATION_KINDS[relatedKind] !== "organization")
		) {
			throw new Error(`Static FAB project checks location ${row} related record is invalid.`);
		}
		if (
			relatedKind === NO_RELATED_LOCATION_KIND &&
			(relatedEntityId !== 0 || relatedRecordIndex !== -1)
		) {
			throw new Error(`Static FAB project checks location ${row} related entity is invalid.`);
		}
		const measurementUnitIndex = value.locationMeasurementUnits[row] as number;
		if (!STATIC_FAB_PROJECT_CHECK_MEASUREMENT_UNITS[measurementUnitIndex]) {
			throw new Error(`Static FAB project checks location ${row} measurement unit is invalid.`);
		}
		const measuredValue = value.locationMeasuredValues[row] as number;
		const requiredValue = value.locationRequiredValues[row] as number;
		if (
			(!Number.isFinite(measuredValue) && !Number.isNaN(measuredValue)) ||
			(!Number.isFinite(requiredValue) && !Number.isNaN(requiredValue))
		) {
			throw new Error(`Static FAB project checks location ${row} measurement is invalid.`);
		}
		const hasMeasurement = Number.isFinite(measuredValue) || Number.isFinite(requiredValue);
		const measurementRelationIndex = value.locationMeasurementRelations[row] as number;
		if (!STATIC_FAB_PROJECT_CHECK_MEASUREMENT_RELATIONS[measurementRelationIndex]) {
			throw new Error(`Static FAB project checks location ${row} measurement relation is invalid.`);
		}
		if (
			(measurementUnitIndex === 0) === hasMeasurement ||
			(measurementRelationIndex === 0) === hasMeasurement
		) {
			throw new Error(
				`Static FAB project checks location ${row} measurement unit is inconsistent.`,
			);
		}
		readBounds(value.locationBounds, row);
	}
	const expectedFingerprint = projectChecksFingerprint(
		{
			revision: value.sourceRevision as number,
			checksum: value.sourceChecksum as string,
			sequence: value.sourceSequence as number,
			nextAdvancedSwitchId: value.sourceNextAdvancedSwitchId as number,
			nextPortId: value.sourceNextPortId as number,
			nextEquipmentGroupId: value.sourceNextEquipmentGroupId as number,
			nextOrganizationId: value.sourceNextOrganizationId as number,
		},
		value.railReadinessFingerprint as string,
		value.summary,
		value.issues as readonly StaticFabProjectCheckIssueSnapshot[],
		value.issueOccurrenceOffsets,
		value.occurrenceDetails as readonly string[],
		value.issueLocationOffsets,
		value.locationBounds,
		value.locationKinds,
		value.locationEntityIds,
		value.locationRecordIndexes,
		value.locationOccurrenceIndexes,
		value.locationDetailIndexes,
		value.locationDetails as readonly string[],
		value.locationRelatedKinds,
		value.locationRelatedEntityIds,
		value.locationRelatedRecordIndexes,
		value.locationTokenIndexes,
		value.locationTokens as readonly string[],
		value.locationMeasuredValues,
		value.locationRequiredValues,
		value.locationMeasurementUnits,
		value.locationMeasurementRelations,
	);
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error("Static FAB project checks fingerprint is invalid.");
	}
}

function validateIssueSnapshot(value: unknown): void {
	if (
		!isRecord(value) ||
		!STATIC_FAB_PROJECT_CHECK_CODES.includes(value.code as StaticFabProjectCheckCode) ||
		!STATIC_FAB_PROJECT_CHECK_DOMAINS.includes(value.domain as StaticFabProjectCheckDomain) ||
		(value.role !== "primary" && value.role !== "consequence") ||
		typeof value.sourceCode !== "string" ||
		value.sourceCode.length > MAXIMUM_SOURCE_CODE_LENGTH ||
		typeof value.detail !== "string" ||
		value.detail.length > MAXIMUM_DETAIL_LENGTH ||
		!Number.isSafeInteger(value.affectedCount) ||
		(value.affectedCount as number) < 1
	) {
		throw new Error("Static FAB project checks issue metadata is malformed.");
	}
}

function writeSummary(target: Uint32Array, summary: StaticFabProjectChecksSummary): void {
	target[0] = summary.railReady ? 1 : 0;
	target[1] = summary.railIssueCount;
	target[2] = summary.advancedSwitchCount;
	target[3] = summary.switchIssueCount;
	target[4] = summary.portCount;
	target[5] = summary.portIssueCount;
	target[6] = summary.equipmentGroupCount;
	target[7] = summary.equipmentIssueCount;
	target[8] = summary.organizationCount;
	target[9] = summary.organizationIssueCount;
	target[10] = summary.hierarchyIssueCount;
	target[11] = summary.blockingIssueCount;
	target[12] = summary.followUpIssueCount;
	target[13] = summary.portChecksComplete ? 1 : 0;
	target[14] = summary.equipmentChecksComplete ? 1 : 0;
	target[15] = summary.organizationChecksComplete ? 1 : 0;
}

function readSummary(source: Uint32Array): StaticFabProjectChecksSummary {
	return Object.freeze({
		railReady: source[0] === 1,
		railIssueCount: source[1] as number,
		advancedSwitchCount: source[2] as number,
		switchIssueCount: source[3] as number,
		portCount: source[4] as number,
		portIssueCount: source[5] as number,
		equipmentGroupCount: source[6] as number,
		equipmentIssueCount: source[7] as number,
		organizationCount: source[8] as number,
		organizationIssueCount: source[9] as number,
		hierarchyIssueCount: source[10] as number,
		blockingIssueCount: source[11] as number,
		followUpIssueCount: source[12] as number,
		portChecksComplete: source[13] === 1,
		equipmentChecksComplete: source[14] === 1,
		organizationChecksComplete: source[15] === 1,
	});
}

function writeBounds(target: Float64Array, row: number, bounds: StaticFabProjectCheckBounds): void {
	const offset = row * 4;
	target[offset] = bounds.minX;
	target[offset + 1] = bounds.minZ;
	target[offset + 2] = bounds.maxX;
	target[offset + 3] = bounds.maxZ;
}

function readBounds(source: Float64Array, row: number): StaticFabProjectCheckBounds {
	const offset = row * 4;
	const bounds = {
		minX: source[offset] as number,
		minZ: source[offset + 1] as number,
		maxX: source[offset + 2] as number,
		maxZ: source[offset + 3] as number,
	};
	if (
		!Number.isFinite(bounds.minX) ||
		!Number.isFinite(bounds.minZ) ||
		!Number.isFinite(bounds.maxX) ||
		!Number.isFinite(bounds.maxZ) ||
		bounds.maxX < bounds.minX ||
		bounds.maxZ < bounds.minZ
	) {
		throw new Error(`Static FAB project checks location ${row} bounds are invalid.`);
	}
	return Object.freeze(bounds);
}

function projectChecksFingerprint(
	source: StaticFabProjectChecksSourceIdentity,
	railReadinessFingerprint: string,
	summary: Uint32Array,
	issues: readonly StaticFabProjectCheckIssueSnapshot[],
	occurrenceOffsets: Uint32Array,
	occurrenceDetails: readonly string[],
	locationOffsets: Uint32Array,
	bounds: Float64Array,
	kinds: Uint8Array,
	entityIds: Int32Array,
	recordIndexes: Int32Array,
	occurrenceIndexes: Uint32Array,
	detailIndexes: Uint32Array,
	details: readonly string[],
	relatedKinds: Uint8Array,
	relatedEntityIds: Int32Array,
	relatedRecordIndexes: Int32Array,
	tokenIndexes: Uint32Array,
	tokens: readonly string[],
	measuredValues: Float64Array,
	requiredValues: Float64Array,
	measurementUnits: Uint8Array,
	measurementRelations: Uint8Array,
): string {
	let hash = 0x811c9dc5;
	const mix = (value: string): void => {
		for (let index = 0; index < value.length; index++) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
	};
	const mixText = (tag: string, value: string): void => {
		mix(`|${tag}${value.length}:`);
		mix(value);
	};
	mix(
		`v3|${source.revision}|${source.sequence}|${source.nextAdvancedSwitchId}|${source.nextPortId}|${source.nextEquipmentGroupId}|${source.nextOrganizationId}`,
	);
	mixText("source", source.checksum);
	mixText("rail", railReadinessFingerprint);
	for (const value of summary) mix(`|s${value}`);
	for (const issue of issues) {
		mix(`|i${issue.code}|${issue.domain}|${issue.role}|${issue.affectedCount}`);
		mixText("source-code", issue.sourceCode);
		mixText("issue-detail", issue.detail);
	}
	for (const value of occurrenceOffsets) mix(`|oo${value}`);
	for (const value of occurrenceDetails) mixText("occurrence-detail", value);
	for (const value of locationOffsets) mix(`|lo${value}`);
	const floatBuffer = new ArrayBuffer(8);
	const floatView = new DataView(floatBuffer);
	const mixFloat64 = (tag: string, value: number): void => {
		if (Number.isNaN(value)) {
			mix(`|${tag}nan`);
			return;
		}
		floatView.setFloat64(0, value, false);
		mix(`|${tag}${floatView.getUint32(0, false)}:${floatView.getUint32(4, false)}`);
	};
	for (const value of bounds) mixFloat64("b", value);
	for (const value of kinds) mix(`|k${value}`);
	for (const value of entityIds) mix(`|e${value}`);
	for (const value of recordIndexes) mix(`|ri${value}`);
	for (const value of occurrenceIndexes) mix(`|oi${value}`);
	for (const value of detailIndexes) mix(`|di${value}`);
	for (const value of details) mixText("location-detail", value);
	for (const value of relatedKinds) mix(`|rk${value}`);
	for (const value of relatedEntityIds) mix(`|re${value}`);
	for (const value of relatedRecordIndexes) mix(`|rri${value}`);
	for (const value of tokenIndexes) mix(`|ti${value}`);
	for (const value of tokens) mixText("location-token", value);
	for (const value of measuredValues) mixFloat64("mv", value);
	for (const value of requiredValues) mixFloat64("rv", value);
	for (const value of measurementUnits) mix(`|mu${value}`);
	for (const value of measurementRelations) mix(`|mr${value}`);
	return `sfc3-${hash.toString(16).padStart(8, "0")}`;
}

function boundedText(value: string, maximumLength: number): string {
	const normalized = value.trim();
	return normalized.length <= maximumLength
		? normalized
		: `${normalized.slice(0, maximumLength - 1)}…`;
}

function assertUint32(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
		throw new RangeError(`${label} must fit uint32.`);
	}
}

function validSourceCursor(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 0x8000_0000;
}

function validDiagnosticPortEquipmentCursor(value: unknown): value is number {
	return Number.isSafeInteger(value);
}

function validDiagnosticOrganizationCursor(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

export const STATIC_FAB_PROJECT_CHECK_PORT_FAILURE_CODES = Object.freeze(
	Object.values(PORT_ATTACHMENT_FAILURE) as readonly PortAttachmentFailureCode[],
);
