import {
	bindValidatedCompiledPhysicalLayoutSource,
	type CompiledPhysicalLayout,
} from "../compile/PhysicalRailCompiler";
import {
	adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively,
	type PortSlotPreparedArtifactCatalog,
	portSlotPreparedArtifactCatalogMatch,
} from "../compile/PortSlotPreparedArtifacts";
import { RailDraftEvaluator } from "../compile/RailDraftEvaluator";
import {
	checksumRailDraftPreparedArtifactsCooperatively,
	type RailDraftPreparedArtifacts,
	railDraftPreparedArtifactsMatch,
	validateRailDraftPreparedAdjacencySemanticsCooperatively,
} from "../compile/RailDraftPreparedArtifacts";
import {
	checksumRailProjectReadinessCooperatively,
	type RailProjectReadiness,
} from "../compile/RailProjectReadiness";
import { type AdvancedSwitchRecord, advancedSwitchEquals } from "../core/AdvancedSwitch";
import { equipmentGroupEquals, type PortEquipmentState } from "../core/EquipmentGroup";
import { checksumRailNetworkAnalysis, type RailNetworkAnalysis } from "../core/network";
import {
	checksumOperationalConfigurationState,
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
	operationalConfigurationStateError,
} from "../core/OperationalConfiguration";
import { validatePortEquipmentActivation } from "../core/PortEquipmentActivation";
import { portRecordEquals } from "../core/PortRecord";
import { RailDocument } from "../core/RailDocument";
import {
	bindValidatedRailModuleOwnershipIndexSource,
	checksumRailModuleOwnershipSnapshotCooperatively,
	createRailModuleOwnershipIndexHydratorCooperatively,
	type RailModuleOwnershipIndex,
} from "../core/RailModuleOwnership";
import {
	type StaticFabAssemblyRelationshipStateV1,
	staticFabAssemblyRelationshipRecordEquals,
} from "../core/StaticFabAssemblyRelationship";
import {
	validateStaticFabAssemblyRelationshipActivation,
	validateStaticFabAssemblyRelationshipSourceActivation,
} from "../core/StaticFabAssemblyRelationshipActivation";
import {
	type StaticFabOrganizationState,
	staticFabOrganizationRecordEquals,
} from "../core/StaticFabOrganization";
import { validateStaticFabOrganizationActivation } from "../core/StaticFabOrganizationActivation";
import type { TileMap } from "../core/TileMap";
import {
	type CompiledPhysicalRailRenderArtifacts,
	checksumPhysicalRailRenderArtifactsCooperatively,
	physicalRailRenderArtifactsMatch,
} from "../render/PhysicalRailRenderArtifacts";
import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import {
	checksumRailPhysicalLayoutCooperatively,
	validateRailPhysicalLayoutContractCooperatively,
} from "../worker/RailPhysicalLayout";
import {
	RAIL_STARTUP_SCHEMA_VERSION,
	type RailStartupPayload,
} from "../worker/RailStartupProtocol";
import {
	releaseValidatedRailStartupSnapshotForFullValidation,
	type ValidatedRailStartupSnapshotAuthority,
	validateAndHydrateRailStartupSnapshotCooperatively,
} from "../worker/RailStartupSnapshotActivation";
import {
	adoptRailStartupTransportCooperatively,
	checksumRailStartupPlainMetadataCooperatively,
	type RailStartupTransportAdoptionAuthority,
} from "../worker/RailStartupTransportContract";
import {
	createRailWorkerBridgeFromValidatedStartup,
	RailWorkerBridge,
	type RailWorkerBridgeHandle,
	type RailWorkerBridgeState,
} from "../worker/RailWorkerBridge";
import {
	createStaticFabOrganizationSnapshotHydrator,
	type StaticFabOrganizationSnapshot,
} from "../worker/StaticFabOrganizationSoA";
import { RailStartupCancelledError } from "./RailStartupBridge";

export interface RailEditorStartupModel {
	readonly document: RailDocument;
	readonly operationalConfiguration: OperationalConfigurationState;
	/** Immutable authored generation paired with every derived buffer in this model. */
	readonly map: TileMap;
	/** Immutable authored equipment generation paired with the same physical layout. */
	readonly portEquipment: PortEquipmentState;
	/** Immutable authored organization generation paired with the same ownership index. */
	readonly organizations: StaticFabOrganizationState;
	/** Immutable authored relationship generation paired with the same mirror checksum. */
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly authoredChecksum: string;
	readonly ownership: RailModuleOwnershipIndex;
	readonly analysis: RailNetworkAnalysis;
	readonly physical: CompiledPhysicalLayout;
	readonly readiness: RailProjectReadiness;
	readonly renderArtifacts: CompiledPhysicalRailRenderArtifacts | null;
	readonly draftArtifacts: RailDraftPreparedArtifacts | null;
	readonly portSlotArtifacts: PortSlotPreparedArtifactCatalog;
}

export interface RailStartupActivationMetrics {
	readonly elapsedMilliseconds: number;
	readonly maxSliceMilliseconds: number;
	readonly maxSlicePhase: string;
	readonly yieldCount: number;
}

export interface RailStartupActivation {
	readonly model: RailEditorStartupModel;
	readonly metrics: RailStartupActivationMetrics;
}

export interface RailEditorStartupCandidate {
	readonly activation: RailStartupActivation;
	readonly draftEvaluator: RailDraftEvaluator;
	readonly mirrorBridge: RailWorkerBridgeHandle;
	readonly workerState: RailWorkerBridgeState;
}

export interface RailEditorStartupCandidateDependencies {
	readonly createDraftEvaluator: () => RailDraftEvaluator;
	readonly createMirrorBridge: (
		document: RailDocument,
		onState: (state: RailWorkerBridgeState) => void,
		snapshot: RailMirrorSnapshot,
	) => RailWorkerBridgeHandle;
}

export interface RailStartupScheduler {
	now(): number;
	yield(): Promise<void>;
}

export function createBrowserRailStartupScheduler(): RailStartupScheduler {
	return {
		now: () => performance.now(),
		yield: async () => {
			const browserScheduler = Reflect.get(globalThis, "scheduler") as
				| { yield?: () => Promise<void> }
				| undefined;
			if (browserScheduler?.yield) await browserScheduler.yield();
			else await new Promise<void>((resolve) => setTimeout(resolve, 0));
		},
	};
}

const DEFAULT_CANDIDATE_DEPENDENCIES: RailEditorStartupCandidateDependencies = {
	createDraftEvaluator: () => new RailDraftEvaluator(),
	createMirrorBridge: (document, onState, snapshot) =>
		new RailWorkerBridge(document, onState, undefined, snapshot),
};

const RAIL_EDITOR_STARTUP_OPERATION_BUDGET = 128;

interface RailStartupMirrorSnapshotAuthority {
	readonly activation: RailStartupActivation;
	readonly document: RailDocument;
	readonly map: TileMap;
	readonly portEquipment: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly sequence: number;
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly checksum: string;
	readonly nextAdvancedSwitchId: number;
	readonly nextPortId: number;
	readonly nextEquipmentGroupId: number;
	readonly nextOrganizationId: number;
	readonly nextRelationshipId: number;
	readonly snapshotValidationAuthority: ValidatedRailStartupSnapshotAuthority;
}

/** Candidate-only one-shot authority; a public activation never retains or exposes its snapshot. */
const startupMirrorSnapshotAuthorities = new WeakMap<
	RailStartupActivation,
	RailStartupMirrorSnapshotAuthority
>();

export async function hydrateStaticFabOrganizationsForStartup(
	snapshot: StaticFabOrganizationSnapshot,
	checkpoint: () => Promise<void>,
	operationBudget = RAIL_EDITOR_STARTUP_OPERATION_BUDGET,
): Promise<StaticFabOrganizationState> {
	const hydrator = createStaticFabOrganizationSnapshotHydrator(snapshot);
	while (!hydrator.done) {
		const operations = hydrator.step(operationBudget);
		if (operations === 0) throw new Error("Organization startup hydration made no progress.");
		await checkpoint();
	}
	return hydrator.finish();
}

/** Keep a loaded candidate private until its independent mirror ACKs the same physical identity. */
export async function prepareRailEditorStartupCandidate(
	payload: RailStartupPayload,
	scheduler: RailStartupScheduler,
	signal: AbortSignal | undefined,
	onMirrorState: (state: RailWorkerBridgeState) => void,
	dependencies: RailEditorStartupCandidateDependencies = DEFAULT_CANDIDATE_DEPENDENCIES,
): Promise<RailEditorStartupCandidate> {
	const expected = Object.freeze({
		checksum: payload.authoredChecksum,
		physicalFingerprint: payload.physical.fingerprint,
		sequence: payload.snapshot.sequence,
		revision: payload.snapshot.revision,
	});
	const activation = await activateRailEditorStartupInternal(payload, scheduler, signal, 4, true);
	if (signal?.aborted) throw new RailStartupCancelledError();
	const draftEvaluator = dependencies.createDraftEvaluator();
	draftEvaluator.prepare(activation.model.physical, activation.model.draftArtifacts ?? undefined);
	let mirrorBridge: RailWorkerBridgeHandle | null = null;
	try {
		const authority = consumeStartupMirrorSnapshotAuthority(activation);
		const assertNotCancelled = (): void => {
			if (signal?.aborted) throw new RailStartupCancelledError();
		};
		assertNotCancelled();
		const useValidatedDefaultHandoff = dependencies === DEFAULT_CANDIDATE_DEPENDENCIES;
		if (useValidatedDefaultHandoff) {
			mirrorBridge = createRailWorkerBridgeFromValidatedStartup(
				authority.document,
				onMirrorState,
				authority.snapshotValidationAuthority,
				assertNotCancelled,
			);
		} else {
			const mirrorSnapshot = releaseValidatedRailStartupSnapshotForFullValidation(
				authority.snapshotValidationAuthority,
				authority.map,
				authority.portEquipment,
				authority.organizations,
				authority.relationships,
			);
			if (!mirrorSnapshot) {
				throw new Error("Rail startup mirror snapshot authority is missing, foreign, or stale.");
			}
			assertNotCancelled();
			mirrorBridge = dependencies.createMirrorBridge(
				authority.document,
				onMirrorState,
				mirrorSnapshot,
			);
		}
		const workerState = await mirrorBridge.waitUntilReady(expected, signal);
		if (signal?.aborted) throw new RailStartupCancelledError();
		return Object.freeze({ activation, draftEvaluator, mirrorBridge, workerState });
	} catch (error) {
		mirrorBridge?.dispose();
		if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
			throw new RailStartupCancelledError();
		}
		throw error;
	}
}

/** Hydrate Worker-owned authored and derived data without one unbounded main-thread task. */
export async function activateRailEditorStartup(
	payload: RailStartupPayload,
	scheduler: RailStartupScheduler,
	signal?: AbortSignal,
	sliceBudgetMilliseconds = 4,
	publicationDocument?: RailDocument,
): Promise<RailStartupActivation> {
	return activateRailEditorStartupInternal(
		payload,
		scheduler,
		signal,
		sliceBudgetMilliseconds,
		false,
		publicationDocument,
	);
}

async function activateRailEditorStartupInternal(
	payload: RailStartupPayload,
	scheduler: RailStartupScheduler,
	signal: AbortSignal | undefined,
	sliceBudgetMilliseconds: number,
	retainMirrorSnapshotAuthority: boolean,
	publicationDocument?: RailDocument,
): Promise<RailStartupActivation> {
	if (!(sliceBudgetMilliseconds > 0) || !Number.isFinite(sliceBudgetMilliseconds)) {
		throw new Error("Startup activation slice budget must be a positive finite duration.");
	}
	const startedAt = scheduler.now();
	let sliceStartedAt = startedAt;
	let maxSliceMilliseconds = 0;
	let currentPhase = "metadata";
	let maxSlicePhase = currentPhase;
	let yieldCount = 0;
	const checkCancelled = (): void => {
		if (signal?.aborted) throw new RailStartupCancelledError();
	};
	const yieldIfNeeded = async (force = false): Promise<void> => {
		checkCancelled();
		const elapsed = Math.max(0, scheduler.now() - sliceStartedAt);
		if (elapsed > maxSliceMilliseconds) {
			maxSliceMilliseconds = elapsed;
			maxSlicePhase = currentPhase;
		}
		if (!force && elapsed < sliceBudgetMilliseconds) return;
		await scheduler.yield();
		yieldCount++;
		checkCancelled();
		sliceStartedAt = scheduler.now();
	};

	validateStartupMetadata(payload);
	const sourceOperationalConfiguration =
		payload.source.kind === "project"
			? copyOperationalConfigurationState(payload.source.operations)
			: null;
	checkCancelled();
	const expected = captureStartupDerivedExpectations(payload);
	currentPhase = "transport-adoption";
	const adoption = await adoptStartupBuffers(payload, yieldIfNeeded, checkCancelled);
	await yieldIfNeeded();
	currentPhase = "derived-validation";
	const adoptedBuffers = adoption.value;
	const derivedBuffers = await validateStartupDerivedBuffers(
		expected,
		adoptedBuffers,
		yieldIfNeeded,
		checkCancelled,
		(phase) => {
			currentPhase = `derived:${phase}`;
		},
	);
	const { snapshot } = adoptedBuffers;
	await yieldIfNeeded();
	currentPhase = "snapshot-activation";
	const snapshotActivation = await validateAndHydrateRailStartupSnapshotCooperatively(
		snapshot,
		adoptedBuffers,
		adoption.authority,
		yieldIfNeeded,
		checkCancelled,
		RAIL_EDITOR_STARTUP_OPERATION_BUDGET,
	);
	const { map, portEquipment, organizations, relationships } = snapshotActivation;
	let releasedSnapshot: RailMirrorSnapshot | null = null;
	if (!retainMirrorSnapshotAuthority) {
		releasedSnapshot = releaseValidatedRailStartupSnapshotForFullValidation(
			snapshotActivation.authority,
			map,
			portEquipment,
			organizations,
			relationships,
		);
		if (releasedSnapshot === null) {
			throw new Error("Rail startup snapshot release authority is missing, foreign, or stale.");
		}
	}
	if (publicationDocument !== undefined) {
		if (releasedSnapshot === null) {
			throw new Error("Rail startup publication requires an isolated validated snapshot.");
		}
		currentPhase = "publication-target-validation";
		await validateRailStartupPublicationDocumentCooperatively(
			publicationDocument,
			releasedSnapshot,
			map,
			portEquipment,
			organizations,
			relationships,
			yieldIfNeeded,
			checkCancelled,
		);
	}
	const publishedMap = publicationDocument?.map ?? map;
	const publishedPortEquipment = publicationDocument?.portEquipment ?? portEquipment;
	const publishedOrganizations = publicationDocument?.organizations ?? organizations;
	const publishedRelationships = publicationDocument?.relationships ?? relationships;
	const publicationMutationGeneration = publishedMap.getMutationGeneration();
	await yieldIfNeeded(true);
	currentPhase = "ownership-activation";
	bindValidatedCompiledPhysicalLayoutSource(derivedBuffers.physical, publishedMap);

	// Snapshot proofs bind hydrated instances; an existing document needs its own proof
	// even after the complete authored-byte comparison above.
	const sourceActivation =
		relationships.records.length === 0
			? null
			: publicationDocument === undefined
				? snapshotActivation.sourceActivation
				: await validateStaticFabAssemblyRelationshipSourceActivation(
						publishedMap,
						publishedPortEquipment,
						publishedOrganizations,
						publishedRelationships,
						yieldIfNeeded,
						RAIL_EDITOR_STARTUP_OPERATION_BUDGET,
					);
	if (relationships.records.length > 0 && !sourceActivation) {
		throw new Error("Rail startup lacks independently compiled relationship source activation.");
	}
	let ownership: RailModuleOwnershipIndex;
	if (sourceActivation) ownership = sourceActivation.ownership;
	else {
		const ownershipHydrator = await createRailModuleOwnershipIndexHydratorCooperatively(
			derivedBuffers.ownership,
			yieldIfNeeded,
			RAIL_EDITOR_STARTUP_OPERATION_BUDGET,
		);
		while (!ownershipHydrator.done) {
			ownershipHydrator.step(RAIL_EDITOR_STARTUP_OPERATION_BUDGET);
			await yieldIfNeeded();
		}
		ownership = ownershipHydrator.finish();
		bindValidatedRailModuleOwnershipIndexSource(ownership, derivedBuffers.ownership, publishedMap);
	}
	await yieldIfNeeded();
	currentPhase = "port-equipment-activation";
	const portEquipmentActivation = await validatePortEquipmentActivation(
		publishedMap,
		publishedPortEquipment,
		yieldIfNeeded,
		RAIL_EDITOR_STARTUP_OPERATION_BUDGET,
	);
	await yieldIfNeeded();
	currentPhase = "organization-activation";
	const organizationActivation =
		sourceActivation?.organizationActivation ??
		(await validateStaticFabOrganizationActivation(
			publishedMap,
			publishedPortEquipment,
			publishedOrganizations,
			ownership,
			yieldIfNeeded,
			RAIL_EDITOR_STARTUP_OPERATION_BUDGET,
		));
	await yieldIfNeeded();
	currentPhase = "relationship-activation";
	const relationshipActivation =
		sourceActivation?.relationshipActivation ??
		(await validateStaticFabAssemblyRelationshipActivation(
			publishedMap,
			publishedPortEquipment,
			publishedOrganizations,
			publishedRelationships,
			ownership,
			organizationActivation,
			yieldIfNeeded,
			RAIL_EDITOR_STARTUP_OPERATION_BUDGET,
		));
	await yieldIfNeeded();
	currentPhase = "document-publication";
	if (
		publicationDocument &&
		(publicationDocument.map !== publishedMap ||
			publicationDocument.portEquipment !== publishedPortEquipment ||
			publicationDocument.organizations !== publishedOrganizations ||
			publicationDocument.relationships !== publishedRelationships ||
			publicationDocument.getPatchSequence() !== snapshotActivation.sequence ||
			publishedMap.getRevision() !== snapshotActivation.revision ||
			publishedMap.getMutationGeneration() !== publicationMutationGeneration)
	) {
		throw new Error("Rail startup publication document changed during activation.");
	}
	const operationalConfiguration =
		sourceOperationalConfiguration ??
		publicationDocument?.operationalConfiguration ??
		emptyOperationalConfigurationState();
	if (
		publicationDocument &&
		checksumOperationalConfigurationState(publicationDocument.operationalConfiguration) !==
			checksumOperationalConfigurationState(operationalConfiguration)
	) {
		throw new Error(
			"Rail startup publication document operational configuration does not match its source.",
		);
	}
	const document =
		publicationDocument ??
		RailDocument.fromCooperativelyValidatedMap(
			map,
			snapshotActivation.sequence,
			portEquipment,
			organizations,
			portEquipmentActivation,
			organizationActivation,
			operationalConfiguration,
			relationships,
			relationshipActivation,
		);
	checkCancelled();
	const finalSlice = Math.max(0, scheduler.now() - sliceStartedAt);
	if (finalSlice > maxSliceMilliseconds) {
		maxSliceMilliseconds = finalSlice;
		maxSlicePhase = currentPhase;
	}
	const activation: RailStartupActivation = Object.freeze({
		model: Object.freeze({
			document,
			operationalConfiguration: document.operationalConfiguration,
			map: publishedMap,
			portEquipment: publishedPortEquipment,
			organizations: publishedOrganizations,
			relationships: publishedRelationships,
			authoredChecksum: derivedBuffers.authoredChecksum,
			ownership,
			analysis: derivedBuffers.analysis,
			physical: derivedBuffers.physical,
			readiness: derivedBuffers.readiness,
			renderArtifacts: derivedBuffers.renderArtifacts,
			draftArtifacts: derivedBuffers.draftArtifacts,
			portSlotArtifacts: derivedBuffers.portSlotArtifacts,
		}),
		metrics: Object.freeze({
			elapsedMilliseconds: Math.max(0, scheduler.now() - startedAt),
			maxSliceMilliseconds,
			maxSlicePhase,
			yieldCount,
		}),
	});
	if (retainMirrorSnapshotAuthority) {
		startupMirrorSnapshotAuthorities.set(
			activation,
			Object.freeze({
				activation,
				document,
				map,
				portEquipment,
				organizations,
				relationships,
				sequence: snapshotActivation.sequence,
				revision: snapshotActivation.revision,
				mutationGeneration: snapshotActivation.mutationGeneration,
				checksum: snapshotActivation.checksum,
				nextAdvancedSwitchId: snapshotActivation.nextAdvancedSwitchId,
				nextPortId: snapshotActivation.nextPortId,
				nextEquipmentGroupId: snapshotActivation.nextEquipmentGroupId,
				nextOrganizationId: snapshotActivation.nextOrganizationId,
				nextRelationshipId: snapshotActivation.nextRelationshipId,
				snapshotValidationAuthority: snapshotActivation.authority,
			}),
		);
	}
	return activation;
}

async function validateRailStartupPublicationDocumentCooperatively(
	document: RailDocument,
	snapshot: RailMirrorSnapshot,
	hydratedMap: TileMap,
	hydratedPortEquipment: PortEquipmentState,
	hydratedOrganizations: StaticFabOrganizationState,
	hydratedRelationships: StaticFabAssemblyRelationshipStateV1,
	checkpoint: () => Promise<void>,
	checkCancelled: () => void,
): Promise<void> {
	const map = document.map;
	const portEquipment = document.portEquipment;
	const organizations = document.organizations;
	const relationships = document.relationships;
	const sequence = document.getPatchSequence();
	const mutationGeneration = map.getMutationGeneration();
	if (
		sequence !== snapshot.sequence ||
		map.getRevision() !== snapshot.revision ||
		map.getAdvancedSwitchIdCursor() !== snapshot.nextAdvancedSwitchId ||
		map.size !== snapshot.encoded.length ||
		map.edgeCount !== hydratedMap.edgeCount ||
		map.advancedSwitchCount !== snapshot.switchIds.length ||
		portEquipment.nextPortId !== hydratedPortEquipment.nextPortId ||
		portEquipment.nextEquipmentGroupId !== hydratedPortEquipment.nextEquipmentGroupId ||
		portEquipment.ports.length !== hydratedPortEquipment.ports.length ||
		portEquipment.equipmentGroups.length !== hydratedPortEquipment.equipmentGroups.length ||
		organizations.nextOrganizationId !== hydratedOrganizations.nextOrganizationId ||
		organizations.records.length !== hydratedOrganizations.records.length ||
		relationships.nextRelationshipId !== hydratedRelationships.nextRelationshipId ||
		relationships.records.length !== hydratedRelationships.records.length
	) {
		throw new Error("Rail startup publication document does not match the validated snapshot.");
	}
	for (let index = 0; index < snapshot.encoded.length; index++) {
		if (
			map.getEncoded(snapshot.xs[index] as number, snapshot.ys[index] as number) !==
			(snapshot.encoded[index] as number)
		) {
			throw new Error("Rail startup publication map differs from the validated snapshot.");
		}
		if ((index & 127) === 127) await checkpoint();
	}
	for (let index = 0; index < snapshot.switchIds.length; index++) {
		const id = snapshot.switchIds[index] as number;
		const expected = hydratedMap.getAdvancedSwitch(id) as AdvancedSwitchRecord | undefined;
		if (!advancedSwitchEquals(map.getAdvancedSwitch(id) ?? null, expected ?? null)) {
			throw new Error("Rail startup publication switches differ from the validated snapshot.");
		}
		await checkpoint();
	}
	for (let index = 0; index < portEquipment.ports.length; index++) {
		if (!portRecordEquals(portEquipment.ports[index], hydratedPortEquipment.ports[index])) {
			throw new Error("Rail startup publication ports differ from the validated snapshot.");
		}
		if ((index & 127) === 127) await checkpoint();
	}
	for (let index = 0; index < portEquipment.equipmentGroups.length; index++) {
		if (
			!equipmentGroupEquals(
				portEquipment.equipmentGroups[index],
				hydratedPortEquipment.equipmentGroups[index],
			)
		) {
			throw new Error("Rail startup publication equipment differs from the validated snapshot.");
		}
		if ((index & 127) === 127) await checkpoint();
	}
	for (let index = 0; index < organizations.records.length; index++) {
		if (
			!staticFabOrganizationRecordEquals(
				organizations.records[index],
				hydratedOrganizations.records[index],
			)
		) {
			throw new Error("Rail startup publication organizations differ from the validated snapshot.");
		}
		if ((index & 127) === 127) await checkpoint();
	}
	for (let index = 0; index < relationships.records.length; index++) {
		if (
			!staticFabAssemblyRelationshipRecordEquals(
				relationships.records[index],
				hydratedRelationships.records[index],
			)
		) {
			throw new Error("Rail startup publication relationships differ from the validated snapshot.");
		}
		if ((index & 127) === 127) await checkpoint();
	}
	checkCancelled();
	if (
		document.map !== map ||
		document.portEquipment !== portEquipment ||
		document.organizations !== organizations ||
		document.relationships !== relationships ||
		document.getPatchSequence() !== sequence ||
		map.getRevision() !== snapshot.revision ||
		map.getMutationGeneration() !== mutationGeneration
	) {
		throw new Error("Rail startup publication document changed during validation.");
	}
}

function consumeStartupMirrorSnapshotAuthority(
	activation: RailStartupActivation,
): RailStartupMirrorSnapshotAuthority {
	const authority = startupMirrorSnapshotAuthorities.get(activation);
	startupMirrorSnapshotAuthorities.delete(activation);
	const { model } = activation;
	if (
		!authority ||
		authority.activation !== activation ||
		authority.document !== model.document ||
		authority.map !== model.map ||
		model.document.map !== authority.map ||
		model.document.portEquipment !== authority.portEquipment ||
		model.document.organizations !== authority.organizations ||
		model.document.relationships !== authority.relationships ||
		model.document.getPatchSequence() !== authority.sequence ||
		authority.map.getRevision() !== authority.revision ||
		authority.map.getMutationGeneration() !== authority.mutationGeneration ||
		authority.map.getAdvancedSwitchIdCursor() !== authority.nextAdvancedSwitchId ||
		model.authoredChecksum !== authority.checksum ||
		authority.portEquipment.nextPortId !== authority.nextPortId ||
		authority.portEquipment.nextEquipmentGroupId !== authority.nextEquipmentGroupId ||
		authority.organizations.nextOrganizationId !== authority.nextOrganizationId ||
		authority.relationships.nextRelationshipId !== authority.nextRelationshipId
	) {
		throw new Error("Rail startup mirror snapshot authority is missing, foreign, or stale.");
	}
	return authority;
}

function validateStartupMetadata(payload: RailStartupPayload): void {
	const { snapshot, ownership, physical, readiness } = payload;
	if (payload.schemaVersion !== RAIL_STARTUP_SCHEMA_VERSION) {
		throw new Error(`Unsupported rail startup schema ${payload.schemaVersion}.`);
	}
	if (!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(payload.plainMetadataFingerprint)) {
		throw new Error("Rail startup plain metadata fingerprint is invalid.");
	}
	if (
		payload.authoredChecksum !== snapshot.checksum ||
		payload.analysis.authoredChecksum !== snapshot.checksum ||
		ownership.authoredChecksum !== snapshot.checksum ||
		physical.authoredChecksum !== snapshot.checksum ||
		readiness.authoredChecksum !== snapshot.checksum ||
		readiness.value.authoredChecksum !== snapshot.checksum ||
		payload.renderArtifacts.authoredChecksum !== snapshot.checksum ||
		payload.draftArtifacts.authoredChecksum !== snapshot.checksum ||
		payload.portSlotArtifacts.authoredChecksum !== snapshot.checksum
	) {
		throw new Error("Rail startup derived bundle is not bound to its authored checksum.");
	}
	if (
		readiness.physicalFingerprint !== physical.fingerprint ||
		payload.renderArtifacts.physicalFingerprint !== physical.fingerprint ||
		payload.draftArtifacts.physicalFingerprint !== physical.fingerprint ||
		payload.portSlotArtifacts.physicalFingerprint !== physical.fingerprint
	) {
		throw new Error(
			"Rail startup interaction artifacts are not bound to its physical fingerprint.",
		);
	}
	if (snapshot.xs.length !== snapshot.ys.length || snapshot.xs.length !== snapshot.encoded.length) {
		throw new Error("Rail startup authored SoA lengths do not match.");
	}
	if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
		throw new Error("Rail startup sequence must be a non-negative safe integer.");
	}
	if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
		throw new Error("Rail startup revision must be a non-negative safe integer.");
	}
	if (!Number.isSafeInteger(snapshot.nextAdvancedSwitchId) || snapshot.nextAdvancedSwitchId < 1) {
		throw new Error("Rail startup advanced switch id cursor is invalid.");
	}
	if (
		ownership.value.revision !== snapshot.revision ||
		physical.value.revision !== snapshot.revision ||
		!physicalRailRenderArtifactsMatch(physical.value.paths, payload.renderArtifacts.value) ||
		!railDraftPreparedArtifactsMatch(physical.value, payload.draftArtifacts.value) ||
		!portSlotPreparedArtifactCatalogMatch(physical.value, payload.portSlotArtifacts.value)
	) {
		throw new Error("Rail startup authored and derived revisions do not match.");
	}
	if (
		payload.source.kind === "scale-probe" &&
		snapshot.encoded.length !== payload.source.cellCount
	) {
		throw new Error("Rail startup scale source cell count does not match its authored snapshot.");
	}
	if (
		(payload.source.kind === "snapshot" || payload.source.kind === "project") &&
		(payload.source.sequence !== snapshot.sequence ||
			payload.source.revision !== snapshot.revision ||
			payload.source.checksum !== snapshot.checksum)
	) {
		throw new Error("Rail startup source identity does not match its authored snapshot.");
	}
	if (payload.source.kind === "project") {
		const operationsError = operationalConfigurationStateError(payload.source.operations);
		if (operationsError) {
			throw new Error(`Rail startup operational configuration is invalid: ${operationsError}`);
		}
	}
}

async function validateStartupDerivedBuffers(
	expected: StartupDerivedExpectations,
	derived: AdoptedStartupBuffers,
	checkpoint: () => Promise<void>,
	checkCancelled: () => void,
	setPhase: (phase: string) => void,
): Promise<ValidatedStartupDerivedBuffers> {
	setPhase("physical-contract");
	await validateRailPhysicalLayoutContractCooperatively(derived.physical, checkpoint, (phase) =>
		setPhase(`physical-contract:${phase}`),
	);
	await checkpoint();
	setPhase("plain-metadata");
	const plainMetadataFingerprint = await checksumRailStartupPlainMetadataCooperatively(
		derived.physical,
		derived.readiness,
		checkpoint,
	);
	if (plainMetadataFingerprint !== expected.plainMetadataFingerprint) {
		throw new Error("Rail startup plain metadata fingerprint mismatch.");
	}
	await checkpoint();
	setPhase("port-slot-proof");
	const portSlotArtifacts = await adoptAndValidatePortSlotPreparedArtifactCatalogCooperatively(
		derived.physical,
		expected.portSlotArtifactSource,
		expected.physicalFingerprint,
		expected.portSlotArtifactFingerprint,
		checkpoint,
		checkCancelled,
		derived.draftArtifacts.envelopeSpatialIndex,
	);
	await checkpoint();
	setPhase("analysis-fingerprint");
	const analysisFingerprint = checksumRailNetworkAnalysis(
		derived.analysis,
		expected.authoredChecksum,
	);
	if (analysisFingerprint !== expected.analysisFingerprint) {
		throw new Error("Rail startup analysis fingerprint mismatch.");
	}
	await checkpoint();
	setPhase("ownership-fingerprint");
	const ownershipFingerprint = await checksumRailModuleOwnershipSnapshotCooperatively(
		derived.ownership,
		expected.authoredChecksum,
		checkpoint,
	);
	if (ownershipFingerprint !== expected.ownershipFingerprint) {
		throw new Error("Rail startup ownership buffer fingerprint mismatch.");
	}
	await checkpoint();
	setPhase("physical-fingerprint");
	const physicalFingerprint = await checksumRailPhysicalLayoutCooperatively(
		derived.physical,
		checkpoint,
	);
	if (physicalFingerprint !== expected.physicalFingerprint) {
		throw new Error(
			`Rail startup physical buffer fingerprint mismatch: expected ${expected.physicalFingerprint}, received ${physicalFingerprint}.`,
		);
	}
	await checkpoint();
	setPhase("readiness-fingerprint");
	const readinessFingerprint = await checksumRailProjectReadinessCooperatively(
		derived.readiness,
		checkpoint,
	);
	if (
		readinessFingerprint !== expected.readinessFingerprint ||
		derived.readiness.fingerprint !== expected.readinessFingerprint
	) {
		throw new Error("Rail startup readiness fingerprint mismatch.");
	}
	await checkpoint();
	setPhase("render-fingerprint");
	const renderArtifactFingerprint = await checksumPhysicalRailRenderArtifactsCooperatively(
		derived.renderArtifacts,
		physicalFingerprint,
		checkpoint,
	);
	if (renderArtifactFingerprint !== expected.renderArtifactFingerprint) {
		throw new Error("Rail startup render artifact buffer fingerprint mismatch.");
	}
	await checkpoint();
	setPhase("draft-fingerprint");
	const draftArtifactFingerprint = await checksumRailDraftPreparedArtifactsCooperatively(
		derived.draftArtifacts,
		physicalFingerprint,
		checkpoint,
	);
	if (draftArtifactFingerprint !== expected.draftArtifactFingerprint) {
		throw new Error("Rail startup draft artifact buffer fingerprint mismatch.");
	}
	await checkpoint();
	setPhase("adjacency-semantics");
	await validateRailDraftPreparedAdjacencySemanticsCooperatively(
		derived.physical,
		derived.draftArtifacts,
		derived.renderArtifacts.adjacency,
		checkpoint,
	);
	return Object.freeze({
		...derived,
		authoredChecksum: expected.authoredChecksum,
		physicalFingerprint: expected.physicalFingerprint,
		portSlotArtifacts,
	});
}

interface StartupDerivedExpectations {
	readonly authoredChecksum: string;
	readonly plainMetadataFingerprint: string;
	readonly analysisFingerprint: string;
	readonly ownershipFingerprint: string;
	readonly physicalFingerprint: string;
	readonly readinessFingerprint: string;
	readonly renderArtifactFingerprint: string;
	readonly draftArtifactFingerprint: string;
	readonly portSlotArtifactFingerprint: string;
	readonly portSlotArtifactSource: RailStartupPayload["portSlotArtifacts"]["value"];
}

function captureStartupDerivedExpectations(
	payload: RailStartupPayload,
): StartupDerivedExpectations {
	return Object.freeze({
		authoredChecksum: payload.authoredChecksum,
		plainMetadataFingerprint: payload.plainMetadataFingerprint,
		analysisFingerprint: payload.analysis.fingerprint,
		ownershipFingerprint: payload.ownership.fingerprint,
		physicalFingerprint: payload.physical.fingerprint,
		readinessFingerprint: payload.readiness.fingerprint,
		renderArtifactFingerprint: payload.renderArtifacts.artifactFingerprint,
		draftArtifactFingerprint: payload.draftArtifacts.artifactFingerprint,
		portSlotArtifactFingerprint: payload.portSlotArtifacts.artifactFingerprint,
		portSlotArtifactSource: payload.portSlotArtifacts.value,
	});
}

interface AdoptedStartupBuffers {
	readonly snapshot: RailMirrorSnapshot;
	readonly analysis: RailStartupPayload["analysis"]["value"];
	readonly ownership: RailStartupPayload["ownership"]["value"];
	readonly physical: RailStartupPayload["physical"]["value"];
	readonly readiness: RailStartupPayload["readiness"]["value"];
	readonly renderArtifacts: RailStartupPayload["renderArtifacts"]["value"];
	readonly draftArtifacts: RailStartupPayload["draftArtifacts"]["value"];
}

interface AdoptedStartupBufferOwnership {
	readonly value: AdoptedStartupBuffers;
	readonly authority: RailStartupTransportAdoptionAuthority;
}

interface ValidatedStartupDerivedBuffers extends AdoptedStartupBuffers {
	readonly authoredChecksum: string;
	readonly physicalFingerprint: string;
	readonly portSlotArtifacts: PortSlotPreparedArtifactCatalog;
}

/** Preserve cross-artifact buffer aliases while removing every caller-owned derived identity. */
async function adoptStartupBuffers(
	payload: RailStartupPayload,
	checkpoint: () => Promise<void>,
	checkCancelled: () => void,
): Promise<AdoptedStartupBufferOwnership> {
	const sourceSnapshot = payload.snapshot;
	const canonical: AdoptedStartupBuffers = {
		snapshot: {
			sequence: sourceSnapshot.sequence,
			revision: sourceSnapshot.revision,
			nextAdvancedSwitchId: sourceSnapshot.nextAdvancedSwitchId,
			xs: sourceSnapshot.xs,
			ys: sourceSnapshot.ys,
			encoded: sourceSnapshot.encoded,
			switchIds: sourceSnapshot.switchIds,
			switchRecords: sourceSnapshot.switchRecords,
			portEquipment: sourceSnapshot.portEquipment,
			organizations: sourceSnapshot.organizations,
			relationships: sourceSnapshot.relationships,
			checksum: sourceSnapshot.checksum,
		},
		analysis: payload.analysis.value,
		ownership: payload.ownership.value,
		physical: payload.physical.value,
		readiness: payload.readiness.value,
		renderArtifacts: payload.renderArtifacts.value,
		draftArtifacts: payload.draftArtifacts.value,
	};
	const adopted = await adoptRailStartupTransportCooperatively(
		canonical,
		checkpoint,
		checkCancelled,
	);
	return adopted;
}
