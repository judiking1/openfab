import type { RailDocument } from "../core/RailDocument";
import type { RailWorkerBridgeHandle } from "../worker/RailWorkerBridge";
import { railWorkerStateMatchesSnapshotReadyExpectation } from "../worker/RailWorkerSnapshotReadiness";
import type { RailEditorStartupModel } from "./RailEditorStartup";

/** O(1) runtime receipt only; no source buffers, membership or persistence data are cloned. */
export interface StaticFabCheckRepairSource {
	readonly document: RailDocument;
	readonly model: Pick<
		RailEditorStartupModel,
		| "document"
		| "map"
		| "portEquipment"
		| "organizations"
		| "relationships"
		| "operationalConfiguration"
		| "authoredChecksum"
	> & { readonly generation: number };
	readonly map: RailDocument["map"];
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly operationalConfiguration: RailDocument["operationalConfiguration"];
	readonly mirror: RailWorkerBridgeHandle;
	readonly mirrorEpoch: number;
	readonly projectId: string;
	readonly projectGeneration: number;
	readonly modelGeneration: number;
	/** Actual map.getRevision(), not a UI render counter. */
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly sequence: number;
	/** Already prepared authored CRC; do not recompute a global checksum in this reader. */
	readonly authoredChecksum: string;
	readonly sourceKey: string;
	readonly readinessFingerprint: string;
}

export interface StaticFabCheckRepairContinuation {
	readonly source: StaticFabCheckRepairSource;
	readonly issueId: string;
	readonly issueCode: string;
	readonly locationIndex: number;
}

/** Reader must capture current Checks receipt and live project/model/bridge references in O(1). */
export interface StaticFabCheckRepairCurrent {
	readonly source: StaticFabCheckRepairSource;
	readonly issueId: string;
	readonly issueCode: string;
	readonly locationIndex: number;
	readonly projectIdle: boolean;
	readonly modelSyncPending: boolean;
	readonly checksCurrent: boolean;
}

/** Readable after this launch closes Checks; excludes transient issue/key/fingerprint UI. */
export type StaticFabCheckRepairDomainSource = Omit<
	StaticFabCheckRepairSource,
	"sourceKey" | "readinessFingerprint"
>;
export interface StaticFabCheckRepairDomainCurrent {
	readonly source: StaticFabCheckRepairDomainSource;
	/** Project file operation idle; excludes the accepted launch's own navigation busy state. */
	readonly projectIdle: boolean;
	readonly modelSyncPending: boolean;
}

export function captureStaticFabCheckRepairContinuation(
	source: StaticFabCheckRepairSource,
	issueId: string,
	issueCode: string,
	locationIndex: number,
): StaticFabCheckRepairContinuation {
	if (!issueId || !issueCode || !Number.isSafeInteger(locationIndex) || locationIndex < 0) {
		throw new Error("Checks repair requires an explicit current issue/location.");
	}
	return Object.freeze({ source: Object.freeze({ ...source }), issueId, issueCode, locationIndex });
}

export function staticFabCheckRepairContinuationMatchesSource(
	continuation: StaticFabCheckRepairContinuation,
	current: StaticFabCheckRepairSource,
): boolean {
	return (
		staticFabCheckRepairContinuationMatchesDomain(continuation, current) &&
		continuation.source.sourceKey === current.sourceKey &&
		continuation.source.readinessFingerprint === current.readinessFingerprint
	);
}

export function staticFabCheckRepairContinuationMatchesDomain(
	continuation: StaticFabCheckRepairContinuation,
	current: StaticFabCheckRepairDomainSource,
): boolean {
	const source = continuation.source;
	return (
		source.document === current.document &&
		source.model === current.model &&
		source.map === current.map &&
		source.portEquipment === current.portEquipment &&
		source.organizations === current.organizations &&
		source.relationships === current.relationships &&
		source.operationalConfiguration === current.operationalConfiguration &&
		source.mirror === current.mirror &&
		source.mirrorEpoch === current.mirrorEpoch &&
		source.projectId === current.projectId &&
		source.projectGeneration === current.projectGeneration &&
		source.modelGeneration === current.modelGeneration &&
		source.revision === current.revision &&
		source.mutationGeneration === current.mutationGeneration &&
		source.sequence === current.sequence &&
		source.authoredChecksum === current.authoredChecksum
	);
}

/** Advisory navigation freshness. Ready mirror parity never grants Worker mutation authority. */
export function staticFabCheckRepairCurrentIsExact(
	continuation: StaticFabCheckRepairContinuation,
	current: StaticFabCheckRepairCurrent | null,
): boolean {
	return (
		staticFabCheckRepairCurrentReceiptIsExact(continuation, current) &&
		staticFabCheckRepairDomainIsExact(continuation, current) &&
		staticFabCheckRepairCurrentReceiptIsExact(continuation, current)
	);
}

/** Final adapter reread after a full ready check; no mirror callback or independent readiness. */
export function staticFabCheckRepairCurrentReceiptIsExact(
	continuation: StaticFabCheckRepairContinuation,
	current: StaticFabCheckRepairCurrent | null,
): boolean {
	if (
		!current?.projectIdle ||
		current.modelSyncPending ||
		!current.checksCurrent ||
		current.issueId !== continuation.issueId ||
		current.issueCode !== continuation.issueCode ||
		current.locationIndex !== continuation.locationIndex ||
		!staticFabCheckRepairContinuationMatchesSource(continuation, current.source)
	)
		return false;
	return staticFabCheckRepairDomainReceiptIsExact(continuation, current);
}

/** Only the controller's successful boolean admission may use this weaker UI lifetime. */
export function staticFabCheckRepairDomainIsExact(
	continuation: StaticFabCheckRepairContinuation,
	current: StaticFabCheckRepairDomainCurrent | null,
): boolean {
	if (!staticFabCheckRepairDomainReceiptIsExact(continuation, current) || !current) return false;
	const source = current.source;
	const mirror = source.mirror.getState();
	const ready =
		mirror.epoch === source.mirrorEpoch &&
		railWorkerStateMatchesSnapshotReadyExpectation(mirror, {
			revision: source.revision,
			sequence: source.sequence,
			checksum: source.authoredChecksum,
		}) &&
		mirror.cells === source.map.size &&
		mirror.edges === source.map.edgeCount &&
		mirror.switches === source.map.advancedSwitchCount &&
		mirror.ports === source.portEquipment.ports.length &&
		mirror.equipmentGroups === source.portEquipment.equipmentGroups.length &&
		mirror.organizations === source.organizations.records.length &&
		mirror.assemblyRelationships === source.relationships.records.length &&
		mirror.assemblyRelationshipNextId === source.relationships.nextRelationshipId &&
		mirror.operationalConfigurationRevision === source.operationalConfiguration.revision;
	// getState is a foreign port even when production implementation is pure. Recheck the
	// actual getters/scalars after it, including a mutation that restored identical counts.
	return ready && staticFabCheckRepairDomainReceiptIsExact(continuation, current);
}

/** Direct live parity after a full ready check. Not an independent readiness/admission proof. */
export function staticFabCheckRepairDomainReceiptIsExact(
	continuation: StaticFabCheckRepairContinuation,
	current: StaticFabCheckRepairDomainCurrent | null,
): boolean {
	if (
		!current?.projectIdle ||
		current.modelSyncPending ||
		!staticFabCheckRepairContinuationMatchesDomain(continuation, current.source)
	)
		return false;
	const source = current.source;
	const document = source.document;
	const model = source.model;
	if (
		document.map !== source.map ||
		document.portEquipment !== source.portEquipment ||
		document.organizations !== source.organizations ||
		document.relationships !== source.relationships ||
		document.operationalConfiguration !== source.operationalConfiguration ||
		model.document !== document ||
		model.map !== source.map ||
		model.portEquipment !== source.portEquipment ||
		model.organizations !== source.organizations ||
		model.relationships !== source.relationships ||
		model.operationalConfiguration !== source.operationalConfiguration ||
		model.generation !== source.modelGeneration ||
		model.authoredChecksum !== source.authoredChecksum ||
		document.getPatchSequence() !== source.sequence ||
		source.map.getRevision() !== source.revision ||
		source.map.getMutationGeneration() !== source.mutationGeneration
	)
		return false;
	return true;
}
