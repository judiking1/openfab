import {
	type AdvancedSwitchMutation,
	copyAdvancedSwitch,
	validateAdvancedSwitchPatch,
} from "./AdvancedSwitch";
import {
	applyPortEquipmentAdditionsCooperatively,
	applyPortEquipmentMutations,
	copyEquipmentGroupRecord,
	copyPortEquipmentState,
	type EquipmentGroupMutation,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "./EquipmentGroup";
import type { RailReplacementPlan } from "./edit";
import {
	captureLegacyCustomEquipmentBaseline,
	type LegacyCustomEquipmentBaseline,
	legacyCustomEquipmentMutationError,
	legacyCustomEquipmentMutationErrorCooperatively,
} from "./LegacyCustomEquipment";
import {
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "./OperationalConfiguration";
import {
	applyOperationalConfigurationPatch,
	OPERATIONAL_CONFIGURATION_PATCH_KIND,
	type OperationalConfigurationMutationPlan,
	type OperationalConfigurationPatch,
	planOperationalConfigurationReplacement,
	replayOperationalConfigurationPatch,
	reverseOperationalConfigurationPatch,
} from "./OperationalConfigurationMutation";
import {
	legacyCustomEquipmentBaselineForPortEquipmentActivation,
	type ValidatedPortEquipmentActivation,
} from "./PortEquipmentActivation";
import {
	consumePortEquipmentBatchPlanIssuedFor,
	consumePortEquipmentBatchPlanIssuedForCooperatively,
} from "./PortEquipmentBatchPlanCertification";
import {
	assertPortEquipmentLayout,
	assertPortEquipmentLayoutCooperatively,
} from "./PortEquipmentLayoutValidator";
import {
	PORT_EQUIPMENT_BATCH_PLAN_KIND,
	type PortEquipmentMutationPlan,
	type PortEquipmentPlanKind,
	portEquipmentPlanKindError,
	portEquipmentPlanKindErrorCooperatively,
} from "./PortEquipmentPlan";
import {
	copyPortRecord,
	type PortMutation,
	type PortRecord,
	type PortRouteIdentity,
} from "./PortRecord";
import type { RailConstructionPlan, RailErasePlan, RailMutation } from "./paint";
import {
	appendBoundedRailHistoryEntry,
	createRailMirrorHistoryLedgerEntry,
	createRailMirrorHistoryLedgerEntryCooperatively,
	type RailMirrorHistoryLedger,
	type RailMirrorHistoryLedgerEntry,
	trimRailMirrorHistoryRelationshipBudget,
} from "./RailPatchHistory";
import {
	consumeReviewedPortEquipmentApply,
	consumeReviewedPortEquipmentApplyCooperatively,
	type ReviewedPortEquipmentApply,
} from "./ReviewedPortEquipmentApplyCertification";
import {
	consumeCertifiedStaticFabArrangementPlanIssuedFor,
	isIssuedStaticFabArrangementPlan,
	isStaticFabArrangementPlanIssuedFor,
} from "./StaticFabArrangementCertification";
import {
	STATIC_FAB_ARRANGEMENT_PLAN_KIND,
	type StaticFabArrangementPlan,
} from "./StaticFabArrangementPlan";
import {
	STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
	type StaticFabAssemblyConnectorPlan,
} from "./StaticFabAssemblyConnector";
import {
	consumeCertifiedStaticFabAssemblyConnectorPlanIssuedFor,
	isIssuedStaticFabAssemblyConnectorPlan,
	isStaticFabAssemblyConnectorPlanIssuedFor,
} from "./StaticFabAssemblyConnectorCertification";
import {
	applyStaticFabAssemblyRelationshipMutations,
	assertStaticFabAssemblyRelationshipStateSource,
	copyStaticFabAssemblyRelationshipRecord,
	copyStaticFabAssemblyRelationshipState,
	emptyStaticFabAssemblyRelationshipState,
	isCanonicalStaticFabAssemblyRelationshipState,
	reverseStaticFabAssemblyRelationshipMutations,
	type StaticFabAssemblyRelationshipMutationV1,
	type StaticFabAssemblyRelationshipStateV1,
} from "./StaticFabAssemblyRelationship";
import {
	assertStaticFabAssemblyRelationshipActivation,
	type ValidatedStaticFabAssemblyRelationshipActivation,
} from "./StaticFabAssemblyRelationshipActivation";
import {
	assertStaticFabBayFlowEditAppliedProjection,
	STATIC_FAB_BAY_FLOW_EDIT_KIND,
	type StaticFabBayFlowEditPlan,
	type StaticFabBayFlowEditProjectionSide,
	type StaticFabBayFlowEditReview,
} from "./StaticFabBayFlowEdit";
import {
	consumeCertifiedStaticFabBayFlowEditPlanIssuedFor,
	isIssuedStaticFabBayFlowEditPlan,
	isStaticFabBayFlowEditPlanIssuedFor,
} from "./StaticFabBayFlowEditCertification";
import type { StaticFabMutationPlan } from "./StaticFabBlueprint";
import {
	applyStaticFabOrganizationMutations,
	assertStaticFabOrganizationState,
	copyStaticFabOrganizationState,
	emptyStaticFabOrganizationState,
	reverseStaticFabOrganizationMutations,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationState,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationRecordEquals,
} from "./StaticFabOrganization";
import {
	consumeStaticFabOrganizationImpactIndex,
	type ValidatedStaticFabOrganizationActivation,
} from "./StaticFabOrganizationActivation";
import {
	consumeCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor,
	isIssuedStaticFabOrganizationBundlePlacementPlan,
	isStaticFabOrganizationBundlePlacementPlanIssuedFor,
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND,
	type StaticFabOrganizationBundlePlacementPlan,
} from "./StaticFabOrganizationBundlePlacement";
import {
	StaticFabOrganizationImpactIndex,
	type StaticFabOrganizationImpactOwner,
	staticFabOrganizationImpactsForPatch,
	unhandledStaticFabOrganizationImpacts,
} from "./StaticFabOrganizationImpactIndex";
import {
	isIssuedStaticFabOrganizationPlan,
	isStaticFabOrganizationPlanIssuedFor,
	type StaticFabOrganizationMutationPlan,
	type StaticFabOrganizationPlanKind,
} from "./StaticFabOrganizationPlan";
import type { StaticFabSelectionErasePlan } from "./StaticFabSelection";
import {
	STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
	STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
	type StaticFabSemanticBayMutationPlan,
} from "./StaticFabSemanticBayMutation";
import {
	consumeCertifiedStaticFabSemanticBayMutationPlanIssuedFor,
	isIssuedStaticFabSemanticBayMutationPlan,
	isStaticFabSemanticBayMutationPlanIssuedFor,
} from "./StaticFabSemanticBayMutationCertification";
import { decodeRailCell, TileMap } from "./TileMap";

export type RailPatchKind =
	| "build"
	| "edit"
	| "erase"
	| "place-static-fab-blueprint"
	| typeof STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND
	| typeof STATIC_FAB_ARRANGEMENT_PLAN_KIND
	| typeof STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND
	| typeof STATIC_FAB_SEMANTIC_BAY_DELETE_KIND
	| typeof STATIC_FAB_BAY_FLOW_EDIT_KIND
	| typeof STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND
	| "erase-static-fab-selection"
	| PortEquipmentPlanKind
	| StaticFabOrganizationPlanKind
	| typeof OPERATIONAL_CONFIGURATION_PATCH_KIND
	| "undo"
	| "redo"
	| "clear";

export type RailHistoryOriginKind = Exclude<RailPatchKind, "undo" | "redo">;

export interface RailPatchEvent {
	sequence: number;
	kind: RailPatchKind;
	baseRevision: number;
	revision: number;
	changes: readonly RailMutation[];
	switchChanges: readonly AdvancedSwitchMutation[];
	portChanges: readonly PortMutation[];
	equipmentGroupChanges: readonly EquipmentGroupMutation[];
	organizationChanges: readonly StaticFabOrganizationMutation[];
	organizationNextIdBefore: number;
	organizationNextIdAfter: number;
	relationshipChanges: readonly StaticFabAssemblyRelationshipMutationV1[];
	relationshipNextIdBefore: number;
	relationshipNextIdAfter: number;
	/** Compact operational state delta; absent on physical/static authoring-only patches. */
	operationalConfigurationPatch?: OperationalConfigurationPatch | null;
	/** Exact protected organization IDs authorized by a certified existing-ID relocation. */
	organizationImpactAuthorizations?: readonly number[];
	/** Original authored command kind; required only while transporting undo/redo history. */
	historyOriginKind?: RailHistoryOriginKind;
}

export interface RailDocumentPortEquipmentCommitTimings {
	readonly authorityConsumptionMilliseconds: number;
	readonly commandValidationMilliseconds: number;
	readonly historyCreationMilliseconds: number;
	readonly stateApplicationMilliseconds: number;
	readonly patchPreparationMilliseconds: number;
	readonly historyPublicationMilliseconds: number;
	readonly patchPublicationMilliseconds: number;
	readonly totalMilliseconds: number;
}

export interface MeasuredRailDocumentReviewedPortEquipmentCommit {
	readonly committed: boolean;
	readonly timings: RailDocumentPortEquipmentCommitTimings | null;
}

export interface RailDocumentCooperativeCommitOptions {
	readonly checkpoint: () => Promise<void>;
	readonly now: () => number;
	readonly sliceMilliseconds?: number;
	readonly checkCancelled?: () => void;
	readonly preparePatch?: (event: RailPatchEvent, checkpoint: () => Promise<void>) => Promise<void>;
}

interface PortEquipmentCommitResult {
	readonly committed: boolean;
	readonly timings: RailDocumentPortEquipmentCommitTimings | null;
}

type Listener = (event: RailPatchEvent) => void;

const STATIC_FAB_BAY_FLOW_EDIT_HISTORY_EVIDENCE = Symbol("static-fab-bay-flow-edit-history");
const STATIC_FAB_ASSEMBLY_CONNECTOR_HISTORY_EVIDENCE = Symbol(
	"static-fab-assembly-connector-history",
);

interface StaticFabAssemblyConnectorHistoryEvidence {
	readonly [STATIC_FAB_ASSEMBLY_CONNECTOR_HISTORY_EVIDENCE]: true;
}

interface StaticFabBayFlowEditHistoryEvidence {
	readonly [STATIC_FAB_BAY_FLOW_EDIT_HISTORY_EVIDENCE]: true;
	readonly review: StaticFabBayFlowEditReview;
}

interface StaticFabBayFlowEditTransitionValidation {
	readonly evidence: StaticFabBayFlowEditHistoryEvidence;
	readonly before: StaticFabBayFlowEditProjectionSide;
	readonly after: StaticFabBayFlowEditProjectionSide;
}

interface HistoryEntry {
	kind: RailHistoryOriginKind;
	changes: readonly RailMutation[];
	switchChanges: readonly AdvancedSwitchMutation[];
	portChanges: readonly PortMutation[];
	equipmentGroupChanges: readonly EquipmentGroupMutation[];
	organizationChanges: readonly StaticFabOrganizationMutation[];
	organizationNextIdBefore: number;
	organizationNextIdAfter: number;
	relationshipChanges: readonly StaticFabAssemblyRelationshipMutationV1[];
	relationshipNextIdBefore: number;
	relationshipNextIdAfter: number;
	organizationImpactAuthorizations: readonly number[];
	operationalConfigurationPatch: OperationalConfigurationPatch | null;
	staticFabAssemblyConnectorEvidence: StaticFabAssemblyConnectorHistoryEvidence | null;
	staticFabBayFlowEditEvidence: StaticFabBayFlowEditHistoryEvidence | null;
	mirrorHistoryEntry: RailMirrorHistoryLedgerEntry;
}

/** Command boundary shared by the editor and the future layout worker bridge. */
export class RailDocument {
	private currentMap = new TileMap();
	private currentPortEquipment = emptyPortEquipmentState();
	private currentOrganizations = emptyStaticFabOrganizationState();
	private currentRelationships = emptyStaticFabAssemblyRelationshipState();
	private currentOperationalConfiguration = emptyOperationalConfigurationState();
	private organizationImpactIndex = new StaticFabOrganizationImpactIndex();
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];
	private listeners = new Set<Listener>();
	private patchSequence = 0;
	private lastCommandError: string | null = null;
	private legacyCustomEquipment: LegacyCustomEquipmentBaseline =
		captureLegacyCustomEquipmentBaseline(emptyPortEquipmentState());

	get map(): TileMap {
		return this.currentMap;
	}

	get portEquipment(): PortEquipmentState {
		return this.currentPortEquipment;
	}

	get organizations(): StaticFabOrganizationState {
		return this.currentOrganizations;
	}

	get operationalConfiguration(): OperationalConfigurationState {
		return this.currentOperationalConfiguration;
	}

	get relationships(): StaticFabAssemblyRelationshipStateV1 {
		return this.currentRelationships;
	}

	staticFabOrganizationOwnersForMembership(
		membership: StaticFabOrganizationMembership,
		kind: StaticFabOrganizationKind | null = null,
	): readonly StaticFabOrganizationImpactOwner[] {
		return this.organizationImpactIndex.organizationOwnersForMembership(membership, kind);
	}

	/** Activate a fully validated baseline without manufacturing editor history entries. */
	static fromLoadedMap(
		map: TileMap,
		patchSequence: number,
		portEquipment: PortEquipmentState = emptyPortEquipmentState(),
		organizations: StaticFabOrganizationState = emptyStaticFabOrganizationState(),
		operationalConfiguration: OperationalConfigurationState = emptyOperationalConfigurationState(),
		relationships: StaticFabAssemblyRelationshipStateV1 = emptyStaticFabAssemblyRelationshipState(),
	): RailDocument {
		if (!Number.isSafeInteger(patchSequence) || patchSequence < 0) {
			throw new Error("Loaded rail patch sequence must be a non-negative safe integer.");
		}
		const document = new RailDocument();
		document.currentMap = map;
		document.currentPortEquipment = copyPortEquipmentState(portEquipment);
		assertPortEquipmentLayout(map, document.currentPortEquipment);
		document.currentOrganizations = copyStaticFabOrganizationState(organizations);
		document.currentRelationships = copyStaticFabAssemblyRelationshipState(relationships);
		document.currentOperationalConfiguration =
			copyOperationalConfigurationState(operationalConfiguration);
		assertStaticFabOrganizationState(
			map,
			document.currentPortEquipment,
			document.currentOrganizations,
		);
		assertStaticFabAssemblyRelationshipStateSource(
			map,
			document.currentOrganizations,
			document.currentRelationships,
		);
		document.organizationImpactIndex.synchronize(document.currentOrganizations);
		document.legacyCustomEquipment = captureLegacyCustomEquipmentBaseline(
			document.currentPortEquipment,
		);
		document.patchSequence = patchSequence;
		return document;
	}

	/**
	 * Activate startup state whose equipment, organization, and relationship semantics were checked.
	 *
	 * Opaque activations bind the exact authored generations. Non-empty relationships require their
	 * completed proof; canonical empty state has no cross-source claims. Validate before consuming
	 * the organization impact index so a rejected attempt cannot spend another domain's evidence.
	 */
	static fromCooperativelyValidatedMap(
		map: TileMap,
		patchSequence: number,
		portEquipment: PortEquipmentState,
		organizations: StaticFabOrganizationState,
		portEquipmentActivation: ValidatedPortEquipmentActivation,
		organizationActivation: ValidatedStaticFabOrganizationActivation,
		operationalConfiguration: OperationalConfigurationState = emptyOperationalConfigurationState(),
		relationships: StaticFabAssemblyRelationshipStateV1 = emptyStaticFabAssemblyRelationshipState(),
		relationshipActivation?: ValidatedStaticFabAssemblyRelationshipActivation,
	): RailDocument {
		if (!isCanonicalStaticFabAssemblyRelationshipState(relationships)) {
			throw new Error("문서 활성화에는 canonical 조립 관계 generation이 필요합니다");
		}
		if (relationships.records.length > 0 || relationshipActivation !== undefined) {
			assertStaticFabAssemblyRelationshipActivation(
				relationshipActivation,
				map,
				portEquipment,
				organizations,
				relationships,
			);
		}
		if (!Number.isSafeInteger(patchSequence) || patchSequence < 0) {
			throw new Error("Loaded rail patch sequence must be a non-negative safe integer.");
		}
		const legacyCustomEquipment = legacyCustomEquipmentBaselineForPortEquipmentActivation(
			portEquipmentActivation,
			map,
			portEquipment,
		);
		const currentOperationalConfiguration =
			copyOperationalConfigurationState(operationalConfiguration);
		const organizationImpactIndex = consumeStaticFabOrganizationImpactIndex(
			organizationActivation,
			map,
			portEquipment,
			organizations,
		);
		const document = new RailDocument();
		document.currentMap = map;
		document.currentPortEquipment = portEquipment;
		document.currentOrganizations = organizations;
		document.currentRelationships = relationships;
		document.currentOperationalConfiguration = currentOperationalConfiguration;
		document.organizationImpactIndex = organizationImpactIndex;
		document.legacyCustomEquipment = legacyCustomEquipment;
		document.patchSequence = patchSequence;
		return document;
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	getPatchSequence(): number {
		return this.patchSequence;
	}

	captureRailMirrorHistoryLedger(): RailMirrorHistoryLedger {
		return Object.freeze({
			undo: Object.freeze(this.undoStack.map((entry) => entry.mirrorHistoryEntry)),
			redo: Object.freeze(this.redoStack.map((entry) => entry.mirrorHistoryEntry)),
		});
	}

	private pushUndoEntry(entry: HistoryEntry): void {
		appendBoundedRailHistoryEntry(this.undoStack, entry);
		this.redoStack = [];
		const projected = this.undoStack.map((candidate) => candidate.mirrorHistoryEntry);
		trimRailMirrorHistoryRelationshipBudget(projected, []);
		const overflow = this.undoStack.length - projected.length;
		if (overflow > 0) this.undoStack.splice(0, overflow);
	}

	getLastCommandError(): string | null {
		return this.lastCommandError;
	}

	planOperationalConfigurationReplacement(
		replacement: OperationalConfigurationState,
	): OperationalConfigurationMutationPlan | null {
		return planOperationalConfigurationReplacement(
			this.operationalConfiguration,
			replacement,
			this.map.getRevision(),
			this.patchSequence,
		);
	}

	commitOperationalConfiguration(plan: OperationalConfigurationMutationPlan): boolean {
		this.lastCommandError = null;
		if (
			plan.kind !== OPERATIONAL_CONFIGURATION_PATCH_KIND ||
			plan.baseRailRevision !== this.map.getRevision() ||
			plan.basePatchSequence !== this.patchSequence ||
			plan.patch.baseConfigurationRevision !== this.operationalConfiguration.revision
		) {
			return false;
		}
		let canonicalPatch: OperationalConfigurationPatch;
		try {
			const next = applyOperationalConfigurationPatch(this.operationalConfiguration, plan.patch);
			const canonicalPlan = planOperationalConfigurationReplacement(
				this.operationalConfiguration,
				next,
				plan.baseRailRevision,
				plan.basePatchSequence,
			);
			if (!canonicalPlan) return false;
			canonicalPatch = canonicalPlan.patch;
		} catch (error) {
			return this.rejectCommand(error, "운용 설정 변경을 검증할 수 없습니다");
		}
		const entry = createHistoryEntry(
			OPERATIONAL_CONFIGURATION_PATCH_KIND,
			[],
			[],
			[],
			[],
			[],
			this.organizations.nextOrganizationId,
			this.organizations.nextOrganizationId,
			[],
			null,
			null,
			canonicalPatch,
		);
		try {
			this.applyChanges(
				[],
				[],
				[],
				[],
				[],
				this.organizations.nextOrganizationId,
				this.organizations.nextOrganizationId,
				false,
				[],
				null,
				null,
				entry.operationalConfigurationPatch,
			);
		} catch (error) {
			return this.rejectCommand(error, "운용 설정 변경을 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			OPERATIONAL_CONFIGURATION_PATCH_KIND,
			plan.baseRailRevision,
			[],
			[],
			[],
			[],
			[],
			this.organizations.nextOrganizationId,
			this.organizations.nextOrganizationId,
			[],
			undefined,
			entry.operationalConfigurationPatch,
		);
		return true;
	}

	commit(plan: RailConstructionPlan | RailReplacementPlan | RailErasePlan): boolean {
		this.lastCommandError = null;
		if (
			"assemblyConnector" in plan ||
			isStaticFabSemanticBayMutationKind(plan.kind) ||
			(plan as { readonly kind: string }).kind === STATIC_FAB_BAY_FLOW_EDIT_KIND
		) {
			return this.rejectCommand(
				"Assembly Connector와 semantic Bay 변경은 레일·조직을 함께 적용하는 전용 커밋이 필요합니다",
				"일반 레일 커밋을 거부했습니다",
			);
		}
		const sourceSwitchChanges = "switchMutations" in plan ? (plan.switchMutations ?? []) : [];
		if (!plan.valid || (plan.mutations.length === 0 && sourceSwitchChanges.length === 0))
			return false;
		if (plan.baseRevision !== this.map.getRevision()) return false;
		const entry = createHistoryEntry(
			plan.kind,
			plan.mutations,
			sourceSwitchChanges,
			[],
			[],
			[],
			this.organizations.nextOrganizationId,
			this.organizations.nextOrganizationId,
		);
		if (validateAdvancedSwitchPatch(this.map, entry.changes, entry.switchChanges).length > 0)
			return false;
		if (
			!railPatchPreservesPortRoutes(
				this.map,
				entry.changes,
				entry.switchChanges,
				this.portEquipment,
			)
		) {
			return false;
		}
		try {
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
			);
		} catch (error) {
			return this.rejectCommand(error, "레일 변경을 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			plan.kind,
			plan.baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
		);
		return true;
	}

	commitPortEquipment(plan: PortEquipmentMutationPlan): boolean {
		return this.commitPortEquipmentWithStageTimes(plan, null, 0, 0).committed;
	}

	private commitPortEquipmentWithStageTimes(
		plan: PortEquipmentMutationPlan,
		now: (() => number) | null,
		totalStartedAt: number,
		authorityConsumptionMilliseconds: number,
	): PortEquipmentCommitResult {
		let previousTime = totalStartedAt + authorityConsumptionMilliseconds;
		const readTime = (): number => {
			previousTime = readOptionalCommitTime(now, previousTime);
			return previousTime;
		};
		this.lastCommandError = null;
		const commandValidationStartedAt = previousTime;
		if (
			!plan.valid ||
			(plan.portMutations.length === 0 && plan.equipmentGroupMutations.length === 0) ||
			plan.baseRevision !== this.map.getRevision() ||
			plan.basePatchSequence !== this.patchSequence
		) {
			return Object.freeze({ committed: false, timings: null });
		}
		if (portEquipmentPlanKindError(plan)) {
			return Object.freeze({ committed: false, timings: null });
		}
		if (
			plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND &&
			!consumePortEquipmentBatchPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
				this.patchSequence,
			)
		) {
			return Object.freeze({ committed: false, timings: null });
		}
		if (
			plan.equipmentGroupMutations.some(
				(change) => change.after?.kind === "STK" && change.after.template === "CUSTOM",
			)
		) {
			return Object.freeze({ committed: false, timings: null });
		}
		if (
			legacyCustomEquipmentMutationError(
				plan.portMutations,
				plan.equipmentGroupMutations,
				this.legacyCustomEquipment,
			) !== null
		) {
			return Object.freeze({ committed: false, timings: null });
		}
		const commandValidationFinishedAt = readTime();
		const historyCreationStartedAt = commandValidationFinishedAt;
		const entry = createHistoryEntry(
			plan.kind,
			[],
			[],
			plan.portMutations,
			plan.equipmentGroupMutations,
			[],
			this.organizations.nextOrganizationId,
			this.organizations.nextOrganizationId,
		);
		const historyCreationFinishedAt = readTime();
		const stateApplicationStartedAt = historyCreationFinishedAt;
		try {
			this.applyChanges(
				[],
				[],
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
			);
		} catch (error) {
			this.rejectCommand(error, "장비 변경을 적용할 수 없습니다");
			return Object.freeze({ committed: false, timings: null });
		}
		const stateApplicationFinishedAt = readTime();
		const historyPublicationStartedAt = stateApplicationFinishedAt;
		this.pushUndoEntry(entry);
		const historyPublicationFinishedAt = readTime();
		const patchPublicationStartedAt = historyPublicationFinishedAt;
		this.emit(
			plan.kind,
			plan.baseRevision,
			[],
			[],
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
		);
		const patchPublicationFinishedAt = readTime();
		return Object.freeze({
			committed: true,
			timings: now
				? Object.freeze({
						authorityConsumptionMilliseconds,
						commandValidationMilliseconds: commandValidationFinishedAt - commandValidationStartedAt,
						historyCreationMilliseconds: historyCreationFinishedAt - historyCreationStartedAt,
						stateApplicationMilliseconds: stateApplicationFinishedAt - stateApplicationStartedAt,
						patchPreparationMilliseconds: 0,
						historyPublicationMilliseconds:
							historyPublicationFinishedAt - historyPublicationStartedAt,
						patchPublicationMilliseconds: patchPublicationFinishedAt - patchPublicationStartedAt,
						totalMilliseconds: patchPublicationFinishedAt - totalStartedAt,
					})
				: null,
		});
	}

	/** Commit one exact-document reviewed station proposal without exposing its materialized plan. */
	commitReviewedPortEquipment(handle: ReviewedPortEquipmentApply): boolean {
		const plan = consumeReviewedPortEquipmentApply(
			handle,
			this.map,
			this.portEquipment,
			this.organizations,
			this.patchSequence,
		);
		return plan !== null && this.commitPortEquipment(plan);
	}

	/** Measure the exact opaque-handle commit without exposing its materialized plan. */
	commitReviewedPortEquipmentMeasured(
		handle: ReviewedPortEquipmentApply,
		now: () => number,
	): MeasuredRailDocumentReviewedPortEquipmentCommit {
		const totalStartedAt = readOptionalCommitTime(now, 0);
		const plan = consumeReviewedPortEquipmentApply(
			handle,
			this.map,
			this.portEquipment,
			this.organizations,
			this.patchSequence,
		);
		const authorityFinishedAt = readOptionalCommitTime(now, totalStartedAt);
		if (plan === null) return Object.freeze({ committed: false, timings: null });
		return this.commitPortEquipmentWithStageTimes(
			plan,
			now,
			totalStartedAt,
			authorityFinishedAt - totalStartedAt,
		);
	}

	/** Prepare a large reviewed additions batch cooperatively, then publish it without an await. */
	async commitReviewedPortEquipmentCooperatively(
		handle: ReviewedPortEquipmentApply,
		options: RailDocumentCooperativeCommitOptions,
	): Promise<MeasuredRailDocumentReviewedPortEquipmentCommit> {
		this.lastCommandError = null;
		const source = captureRailDocumentPortEquipmentSource(this);
		const cooperative = createRailDocumentCommitCooperativeController(this, source, options);
		const totalStartedAt = cooperative.readTime(0);
		try {
			cooperative.assertCurrent();
			const plan = await consumeReviewedPortEquipmentApplyCooperatively(
				handle,
				source.map,
				source.portEquipment,
				source.organizations,
				source.patchSequence,
				cooperative.checkTime,
			);
			const authorityFinishedAt = cooperative.readTime(totalStartedAt);
			if (!plan) return cooperativeCommitRejected();

			const commandValidationStartedAt = authorityFinishedAt;
			if (
				!plan.valid ||
				(plan.portMutations.length === 0 && plan.equipmentGroupMutations.length === 0) ||
				plan.baseRevision !== source.revision ||
				plan.basePatchSequence !== source.patchSequence
			) {
				return cooperativeCommitRejected();
			}
			const kindError = await portEquipmentPlanKindErrorCooperatively(plan, cooperative.checkTime);
			if (kindError) {
				this.rejectCommand(kindError, "장비 command kind를 검증할 수 없습니다");
				return cooperativeCommitRejected();
			}
			if (
				plan.kind === PORT_EQUIPMENT_BATCH_PLAN_KIND &&
				!(await consumePortEquipmentBatchPlanIssuedForCooperatively(
					plan,
					source.map,
					source.portEquipment,
					source.organizations,
					source.patchSequence,
					cooperative.checkTime,
				))
			) {
				return cooperativeCommitRejected();
			}
			const customError = await legacyCustomEquipmentMutationErrorCooperatively(
				plan.portMutations,
				plan.equipmentGroupMutations,
				this.legacyCustomEquipment,
				cooperative.checkTime,
			);
			if (customError !== null) {
				this.rejectCommand(customError, "legacy CUSTOM 장비 변경을 검증할 수 없습니다");
				return cooperativeCommitRejected();
			}
			cooperative.assertCurrent();
			const commandValidationFinishedAt = cooperative.readTime(commandValidationStartedAt);

			const historyCreationStartedAt = commandValidationFinishedAt;
			const entry = await createPortEquipmentHistoryEntryCooperatively(
				plan.kind,
				plan.portMutations,
				plan.equipmentGroupMutations,
				source.organizations.nextOrganizationId,
				source.relationships.nextRelationshipId,
				cooperative.checkTime,
			);
			cooperative.assertCurrent();
			const historyCreationFinishedAt = cooperative.readTime(historyCreationStartedAt);

			const stateApplicationStartedAt = historyCreationFinishedAt;
			const nextPortEquipment = await applyPortEquipmentAdditionsCooperatively(
				source.portEquipment,
				entry.portChanges,
				entry.equipmentGroupChanges,
				cooperative.checkTime,
			);
			await assertPortEquipmentLayoutCooperatively(
				source.map,
				nextPortEquipment,
				cooperative.checkTime,
			);
			if (source.organizations.records.length > 0) {
				const affectedOrganizations = staticFabOrganizationImpactsForPatch(
					this.organizationImpactIndex,
					[],
					[],
					entry.portChanges,
					entry.equipmentGroupChanges,
					source.portEquipment,
					nextPortEquipment,
				);
				const unhandledOrganizations = unhandledStaticFabOrganizationImpacts(
					this.organizationImpactIndex,
					affectedOrganizations,
					[],
					[],
					[],
					entry.portChanges,
					entry.equipmentGroupChanges,
					source.portEquipment,
					nextPortEquipment,
				);
				if (unhandledOrganizations.length > 0) {
					const labels = unhandledOrganizations.map((owner) => {
						const record = source.organizations.records.find(
							(candidate) => candidate.id === owner.organizationId,
						);
						return record?.name ?? `ORG-${owner.organizationId}`;
					});
					this.rejectCommand(
						`보호된 정적 FAB 조직을 먼저 갱신해야 합니다 · ${labels.join(", ")}`,
						"장비 변경을 적용할 수 없습니다",
					);
					return cooperativeCommitRejected();
				}
			}
			cooperative.assertCurrent();
			const stateApplicationFinishedAt = cooperative.readTime(stateApplicationStartedAt);
			const patchPreparationStartedAt = stateApplicationFinishedAt;
			const event = createRailPatchEvent(
				this.patchSequence + 1,
				plan.kind,
				plan.baseRevision,
				source.revision,
				[],
				[],
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				[],
				undefined,
				null,
				entry.relationshipChanges,
				entry.relationshipNextIdBefore,
				entry.relationshipNextIdAfter,
			);
			await options.preparePatch?.(event, cooperative.checkTime);
			cooperative.assertCurrent();
			const patchPreparationFinishedAt = cooperative.readTime(patchPreparationStartedAt);

			const historyPublicationStartedAt = patchPreparationFinishedAt;
			this.currentPortEquipment = nextPortEquipment;
			this.pushUndoEntry(entry);
			const historyPublicationFinishedAt = cooperative.readTime(historyPublicationStartedAt);
			const patchPublicationStartedAt = historyPublicationFinishedAt;
			this.publishPatchEvent(event);
			const patchPublicationFinishedAt = cooperative.readTime(patchPublicationStartedAt);
			return Object.freeze({
				committed: true,
				timings: Object.freeze({
					authorityConsumptionMilliseconds: authorityFinishedAt - totalStartedAt,
					commandValidationMilliseconds: commandValidationFinishedAt - commandValidationStartedAt,
					historyCreationMilliseconds: historyCreationFinishedAt - historyCreationStartedAt,
					stateApplicationMilliseconds: stateApplicationFinishedAt - stateApplicationStartedAt,
					patchPreparationMilliseconds: patchPreparationFinishedAt - patchPreparationStartedAt,
					historyPublicationMilliseconds:
						historyPublicationFinishedAt - historyPublicationStartedAt,
					patchPublicationMilliseconds: patchPublicationFinishedAt - patchPublicationStartedAt,
					totalMilliseconds: patchPublicationFinishedAt - totalStartedAt,
				}),
			});
		} catch (error) {
			if (error instanceof RailDocumentCommitSourceChangedError) {
				return cooperativeCommitRejected();
			}
			throw error;
		}
	}

	/** Commit rail plus port/group truth as one undo entry and one typed Worker patch. */
	commitStaticFab(plan: StaticFabMutationPlan | StaticFabSelectionErasePlan): boolean {
		this.lastCommandError = null;
		if (
			!plan.valid ||
			(plan.mutations.length === 0 &&
				plan.portMutations.length === 0 &&
				plan.equipmentGroupMutations.length === 0) ||
			plan.baseRevision !== this.map.getRevision() ||
			plan.basePatchSequence !== this.patchSequence
		) {
			return false;
		}
		if (
			plan.equipmentGroupMutations.some(
				(change) => change.after?.kind === "STK" && change.after.template === "CUSTOM",
			)
		) {
			return false;
		}
		if (
			legacyCustomEquipmentMutationError(
				plan.portMutations,
				plan.equipmentGroupMutations,
				this.legacyCustomEquipment,
			) !== null
		) {
			return false;
		}
		const kind =
			"staticFabErase" in plan
				? ("erase-static-fab-selection" as const)
				: ("place-static-fab-blueprint" as const);
		const switchChanges = "switchMutations" in plan ? (plan.switchMutations ?? []) : [];
		const entry = createHistoryEntry(
			kind,
			plan.mutations,
			switchChanges,
			plan.portMutations,
			plan.equipmentGroupMutations,
			[],
			this.organizations.nextOrganizationId,
			this.organizations.nextOrganizationId,
		);
		if (validateAdvancedSwitchPatch(this.map, entry.changes, entry.switchChanges).length > 0) {
			return false;
		}
		try {
			const prospectivePortEquipment = applyPortEquipmentMutations(
				this.portEquipment,
				entry.portChanges,
				entry.equipmentGroupChanges,
			);
			if (
				!railPatchPreservesPortRoutes(
					this.map,
					entry.changes,
					entry.switchChanges,
					prospectivePortEquipment,
				)
			) {
				return false;
			}
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
			);
		} catch (error) {
			return this.rejectCommand(error, "정적 FAB 변경을 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			kind,
			plan.baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
		);
		return true;
	}

	/** Commit rail, switches, equipment, and semantic organizations as one indivisible command. */
	commitStaticFabOrganizationBundle(plan: StaticFabOrganizationBundlePlacementPlan): boolean {
		this.lastCommandError = null;
		if (!plan.valid) {
			return this.rejectCommand(plan.reason, "조직 청사진 배치 계획이 유효하지 않습니다");
		}
		if (!isIssuedStaticFabOrganizationBundlePlacementPlan(plan)) {
			return this.rejectCommand(
				"검증되지 않은 조직 청사진 배치 계획입니다",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (plan.mutations.length === 0 || plan.organizationMutations.length === 0) {
			return this.rejectCommand(
				"조직 청사진의 레일 또는 조직 변경이 비어 있습니다",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (plan.baseRevision !== this.map.getRevision()) {
			return this.rejectCommand(
				"조직 청사진이 참조한 레일 세대가 변경되었습니다 · 다시 배치하세요",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (plan.basePatchSequence !== this.patchSequence) {
			return this.rejectCommand(
				"조직 청사진이 참조한 편집 순서가 변경되었습니다 · 다시 배치하세요",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (plan.nextOrganizationIdBefore !== this.organizations.nextOrganizationId) {
			return this.rejectCommand(
				"조직 ID 세대가 변경되었습니다 · 다시 배치하세요",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (
			!isStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"다른 문서 또는 이전 상태에서 발급된 조직 청사진 계획입니다",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (
			!consumeCertifiedStaticFabOrganizationBundlePlacementPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"조직 청사진 배치는 현재 문서의 정확한 물리 간섭 검증을 통과해야 합니다",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (
			plan.equipmentGroupMutations.some(
				(change) => change.after?.kind === "STK" && change.after.template === "CUSTOM",
			)
		) {
			return this.rejectCommand(
				"조직 청사진은 legacy CUSTOM STK를 배치할 수 없습니다",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		if (
			legacyCustomEquipmentMutationError(
				plan.portMutations,
				plan.equipmentGroupMutations,
				this.legacyCustomEquipment,
			) !== null
		) {
			return this.rejectCommand(
				"조직 청사진이 legacy CUSTOM STK 기준 상태를 변경합니다",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		const entry = createHistoryEntry(
			STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND,
			plan.mutations,
			plan.switchMutations,
			plan.portMutations,
			plan.equipmentGroupMutations,
			plan.organizationMutations,
			plan.nextOrganizationIdBefore,
			plan.nextOrganizationIdAfter,
		);
		if (validateAdvancedSwitchPatch(this.map, entry.changes, entry.switchChanges).length > 0) {
			return this.rejectCommand(
				"조직 청사진의 고급 스위치 topology가 변경되었습니다",
				"조직 청사진 배치를 거부했습니다",
			);
		}
		try {
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
			);
		} catch (error) {
			return this.rejectCommand(error, "조직 청사진을 원자적으로 배치할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_KIND,
			plan.baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
		);
		return true;
	}

	/** Commit one exact typed hierarchy connector as one history entry and one Worker patch. */
	commitStaticFabAssemblyConnector(plan: StaticFabAssemblyConnectorPlan): boolean {
		this.lastCommandError = null;
		if (!plan.valid || plan.assemblyConnector.issueCode !== null) {
			return this.rejectCommand(plan.reason, "Assembly Connector 계획이 유효하지 않습니다");
		}
		if (!isIssuedStaticFabAssemblyConnectorPlan(plan)) {
			return this.rejectCommand(
				"검증되지 않은 Assembly Connector 계획입니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		if (plan.mutations.length === 0 || plan.organizationMutations.length === 0) {
			return this.rejectCommand(
				"Assembly Connector의 레일 또는 조직 변경이 비어 있습니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		if ((plan.switchMutations?.length ?? 0) !== 0) {
			return this.rejectCommand(
				"Assembly Connector는 고급 스위치 레코드를 변경할 수 없습니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		if (
			plan.baseRevision !== this.map.getRevision() ||
			plan.basePatchSequence !== this.patchSequence
		) {
			return this.rejectCommand(
				"Assembly Connector가 참조한 정적 FAB 세대가 변경되었습니다 · 다시 연결하세요",
				"Assembly Connector를 거부했습니다",
			);
		}
		if (plan.nextOrganizationIdBefore !== this.organizations.nextOrganizationId) {
			return this.rejectCommand(
				"Assembly Connector의 조직 ID 세대가 변경되었습니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		if (!canonicalPositiveInt32Ids(plan.organizationImpactAuthorizations)) {
			return this.rejectCommand(
				"Assembly Connector의 조직 보호 인증 범위가 canonical하지 않습니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		const actualImpactAuthorizations = staticFabOrganizationImpactsForPatch(
			this.organizationImpactIndex,
			plan.mutations,
			plan.switchMutations ?? [],
			[],
			[],
			this.portEquipment,
			this.portEquipment,
		).map((owner) => owner.organizationId);
		if (!sameNumberList(plan.organizationImpactAuthorizations, actualImpactAuthorizations)) {
			return this.rejectCommand(
				"Assembly Connector의 조직 보호 인증 범위가 실제 gateway 변경과 다릅니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		if (
			!isStaticFabAssemblyConnectorPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"다른 문서 또는 이전 상태에서 발급된 Assembly Connector 계획입니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		const switchMutations = plan.switchMutations ?? [];
		if (
			!railPatchPreservesPortRoutes(this.map, plan.mutations, switchMutations, this.portEquipment)
		) {
			return this.rejectCommand(
				"Assembly Connector가 기존 포트의 raw route를 끊습니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		if (
			!consumeCertifiedStaticFabAssemblyConnectorPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"Assembly Connector는 현재 문서의 정확한 Worker 검증을 통과해야 합니다",
				"Assembly Connector를 거부했습니다",
			);
		}
		const entry = createHistoryEntry(
			STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
			plan.mutations,
			switchMutations,
			[],
			[],
			plan.organizationMutations,
			plan.nextOrganizationIdBefore,
			plan.nextOrganizationIdAfter,
			plan.organizationImpactAuthorizations,
			null,
			createStaticFabAssemblyConnectorHistoryEvidence(),
		);
		try {
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
				entry.organizationImpactAuthorizations,
				null,
				staticFabAssemblyConnectorTransitionValidation(entry),
			);
		} catch (error) {
			return this.rejectCommand(error, "Assembly Connector를 원자적으로 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND,
			plan.baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
			entry.organizationImpactAuthorizations,
		);
		return true;
	}

	/** Commit one Worker-certified Bay disconnect or delete as one indivisible static-world command. */
	commitStaticFabSemanticBayMutation(plan: StaticFabSemanticBayMutationPlan): boolean {
		this.lastCommandError = null;
		if (!plan.valid || plan.issueCode !== null || plan.review.issueCode !== null) {
			return this.rejectCommand(plan.reason, "Semantic Bay 변경 계획이 유효하지 않습니다");
		}
		if (!isIssuedStaticFabSemanticBayMutationPlan(plan)) {
			return this.rejectCommand(
				"검증되지 않은 semantic Bay 변경 계획입니다",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		const contractError = staticFabSemanticBayMutationCommitError(plan);
		if (contractError) {
			return this.rejectCommand(contractError, "Semantic Bay 변경을 거부했습니다");
		}
		if (
			plan.baseRevision !== this.map.getRevision() ||
			plan.basePatchSequence !== this.patchSequence
		) {
			return this.rejectCommand(
				"Semantic Bay 변경이 참조한 정적 FAB 세대가 변경되었습니다 · 다시 검토하세요",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		if (
			plan.nextOrganizationIdBefore !== this.organizations.nextOrganizationId ||
			plan.nextOrganizationIdAfter !== this.organizations.nextOrganizationId
		) {
			return this.rejectCommand(
				"Semantic Bay 변경은 조직 ID 세대를 변경할 수 없습니다",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		if (
			!isStaticFabSemanticBayMutationPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"다른 문서 또는 이전 상태에서 발급된 semantic Bay 변경 계획입니다",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		if (
			legacyCustomEquipmentMutationError(
				plan.portMutations,
				plan.equipmentGroupMutations,
				this.legacyCustomEquipment,
			) !== null
		) {
			return this.rejectCommand(
				"Semantic Bay 변경이 legacy CUSTOM STK 기준 상태를 변경합니다",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		const entry = createHistoryEntry(
			plan.kind,
			plan.mutations,
			plan.switchMutations,
			plan.portMutations,
			plan.equipmentGroupMutations,
			plan.organizationMutations,
			plan.nextOrganizationIdBefore,
			plan.nextOrganizationIdAfter,
			plan.organizationImpactAuthorizations,
		);
		if (validateAdvancedSwitchPatch(this.map, entry.changes, entry.switchChanges).length > 0) {
			return this.rejectCommand(
				"Semantic Bay 변경의 고급 스위치 topology가 현재 문서와 일치하지 않습니다",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		let prospectivePortEquipment: PortEquipmentState;
		try {
			prospectivePortEquipment = applyPortEquipmentMutations(
				this.portEquipment,
				entry.portChanges,
				entry.equipmentGroupChanges,
			);
		} catch (error) {
			return this.rejectCommand(error, "Semantic Bay 장비 삭제 계획이 유효하지 않습니다");
		}
		if (
			!railPatchPreservesPortRoutes(
				this.map,
				entry.changes,
				entry.switchChanges,
				prospectivePortEquipment,
			)
		) {
			return this.rejectCommand(
				"Semantic Bay 변경 후 남은 포트의 raw route가 사라집니다",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		if (
			!consumeCertifiedStaticFabSemanticBayMutationPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"Semantic Bay 변경은 현재 문서의 정확한 Worker 검증을 통과해야 합니다",
				"Semantic Bay 변경을 거부했습니다",
			);
		}
		try {
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
				entry.organizationImpactAuthorizations,
			);
		} catch (error) {
			return this.rejectCommand(error, "Semantic Bay 변경을 원자적으로 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			plan.kind,
			plan.baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
			entry.organizationImpactAuthorizations,
		);
		return true;
	}

	/** Commit one Worker-certified Twin Bay internal-flow replacement as one atomic command. */
	commitStaticFabBayFlowEdit(plan: StaticFabBayFlowEditPlan): boolean {
		this.lastCommandError = null;
		if (!plan.valid || plan.issueCode !== null || plan.review.issueCode !== null) {
			return this.rejectCommand(plan.reason, "Bay 내부 흐름 변경 계획이 유효하지 않습니다");
		}
		if (!isIssuedStaticFabBayFlowEditPlan(plan)) {
			return this.rejectCommand(
				"검증되지 않은 Bay 내부 흐름 변경 계획입니다",
				"Bay 내부 흐름 변경을 거부했습니다",
			);
		}
		const contractError = staticFabBayFlowEditCommitError(plan);
		if (contractError) {
			return this.rejectCommand(contractError, "Bay 내부 흐름 변경을 거부했습니다");
		}
		if (
			plan.baseRevision !== this.map.getRevision() ||
			plan.basePatchSequence !== this.patchSequence
		) {
			return this.rejectCommand(
				"Bay 내부 흐름 변경이 참조한 정적 FAB 세대가 변경되었습니다 · 다시 검토하세요",
				"Bay 내부 흐름 변경을 거부했습니다",
			);
		}
		if (
			plan.nextOrganizationIdBefore !== this.organizations.nextOrganizationId ||
			plan.nextOrganizationIdAfter !== this.organizations.nextOrganizationId
		) {
			return this.rejectCommand(
				"Bay 내부 흐름 변경은 조직 ID 세대를 변경할 수 없습니다",
				"Bay 내부 흐름 변경을 거부했습니다",
			);
		}
		if (
			!isStaticFabBayFlowEditPlanIssuedFor(plan, this.map, this.portEquipment, this.organizations)
		) {
			return this.rejectCommand(
				"다른 문서 또는 이전 상태에서 발급된 Bay 내부 흐름 변경 계획입니다",
				"Bay 내부 흐름 변경을 거부했습니다",
			);
		}
		const bayFlowEditEvidence = createStaticFabBayFlowEditHistoryEvidence(plan.review);
		const entry = createHistoryEntry(
			STATIC_FAB_BAY_FLOW_EDIT_KIND,
			plan.mutations,
			plan.switchMutations,
			plan.portMutations,
			plan.equipmentGroupMutations,
			plan.organizationMutations,
			plan.nextOrganizationIdBefore,
			plan.nextOrganizationIdAfter,
			plan.organizationImpactAuthorizations,
			bayFlowEditEvidence,
		);
		if (validateAdvancedSwitchPatch(this.map, entry.changes, entry.switchChanges).length > 0) {
			return this.rejectCommand(
				"Bay 내부 흐름 변경의 고급 스위치 topology가 현재 문서와 일치하지 않습니다",
				"Bay 내부 흐름 변경을 거부했습니다",
			);
		}
		if (
			!railPatchPreservesPortRoutes(
				this.map,
				entry.changes,
				entry.switchChanges,
				this.portEquipment,
			)
		) {
			return this.rejectCommand(
				"Bay 내부 흐름 변경 후 하나 이상의 포트 raw route가 사라집니다",
				"Bay 내부 흐름 변경을 거부했습니다",
			);
		}
		if (
			!consumeCertifiedStaticFabBayFlowEditPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"Bay 내부 흐름 변경은 현재 문서의 정확한 Worker 검증을 통과해야 합니다",
				"Bay 내부 흐름 변경을 거부했습니다",
			);
		}
		try {
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
				entry.organizationImpactAuthorizations,
				staticFabBayFlowEditTransitionValidation(entry, "source", "target"),
			);
		} catch (error) {
			return this.rejectCommand(error, "Bay 내부 흐름 변경을 원자적으로 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			STATIC_FAB_BAY_FLOW_EDIT_KIND,
			plan.baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
			entry.organizationImpactAuthorizations,
		);
		return true;
	}

	/** Commit one exact existing-ID FAB arrangement as one history entry and Worker patch. */
	commitStaticFabArrangement(plan: StaticFabArrangementPlan): boolean {
		this.lastCommandError = null;
		if (!plan.valid || !plan.arrangement) {
			return this.rejectCommand(plan.reason, "정적 FAB 정렬 계획이 유효하지 않습니다");
		}
		if (!isIssuedStaticFabArrangementPlan(plan)) {
			return this.rejectCommand("검증되지 않은 정적 FAB 정렬 계획입니다", "정렬을 거부했습니다");
		}
		if (
			plan.mutations.length === 0 &&
			plan.switchMutations.length === 0 &&
			plan.portMutations.length === 0 &&
			plan.organizationMutations.length === 0
		) {
			return this.rejectCommand("정렬 변경 내용이 없습니다", "정렬을 거부했습니다");
		}
		if (plan.equipmentGroupMutations.length !== 0) {
			return this.rejectCommand(
				"기존 ID 정렬은 장비 그룹 레코드를 변경할 수 없습니다",
				"정렬을 거부했습니다",
			);
		}
		if (
			!canonicalPositiveInt32Ids(plan.organizationImpactAuthorizations) ||
			!sameNumberList(
				plan.organizationImpactAuthorizations,
				plan.arrangement.affectedOrganizationIds,
			)
		) {
			return this.rejectCommand(
				"정렬의 조직 보호 인증 범위가 계획 metadata와 일치하지 않습니다",
				"정렬을 거부했습니다",
			);
		}
		if (
			plan.baseRevision !== this.map.getRevision() ||
			plan.basePatchSequence !== this.patchSequence
		) {
			return this.rejectCommand(
				"정렬이 참조한 정적 FAB 세대가 변경되었습니다 · 다시 정렬하세요",
				"정렬을 거부했습니다",
			);
		}
		if (
			plan.nextOrganizationIdBefore !== this.organizations.nextOrganizationId ||
			plan.nextOrganizationIdAfter !== this.organizations.nextOrganizationId
		) {
			return this.rejectCommand("정렬은 조직 ID 세대를 변경할 수 없습니다", "정렬을 거부했습니다");
		}
		if (
			!isStaticFabArrangementPlanIssuedFor(plan, this.map, this.portEquipment, this.organizations)
		) {
			return this.rejectCommand(
				"다른 문서 또는 이전 상태에서 발급된 정적 FAB 정렬 계획입니다",
				"정렬을 거부했습니다",
			);
		}
		if (
			legacyCustomEquipmentMutationError(
				plan.portMutations,
				plan.equipmentGroupMutations,
				this.legacyCustomEquipment,
			) !== null
		) {
			return this.rejectCommand(
				"정렬이 legacy CUSTOM STK 기준 상태를 변경합니다",
				"정렬을 거부했습니다",
			);
		}
		const entry = createHistoryEntry(
			STATIC_FAB_ARRANGEMENT_PLAN_KIND,
			plan.mutations,
			plan.switchMutations,
			plan.portMutations,
			plan.equipmentGroupMutations,
			plan.organizationMutations,
			plan.nextOrganizationIdBefore,
			plan.nextOrganizationIdAfter,
			plan.organizationImpactAuthorizations,
		);
		if (validateAdvancedSwitchPatch(this.map, entry.changes, entry.switchChanges).length > 0) {
			return this.rejectCommand(
				"정렬의 고급 스위치 topology가 현재 문서와 일치하지 않습니다",
				"정렬을 거부했습니다",
			);
		}
		const prospectivePortEquipment = applyPortEquipmentMutations(
			this.portEquipment,
			entry.portChanges,
			entry.equipmentGroupChanges,
		);
		if (
			!railPatchPreservesPortRoutes(
				this.map,
				entry.changes,
				entry.switchChanges,
				prospectivePortEquipment,
			)
		) {
			return this.rejectCommand(
				"정렬 후 하나 이상의 포트 raw route가 사라집니다",
				"정렬을 거부했습니다",
			);
		}
		if (
			!consumeCertifiedStaticFabArrangementPlanIssuedFor(
				plan,
				this.map,
				this.portEquipment,
				this.organizations,
			)
		) {
			return this.rejectCommand(
				"정렬은 현재 문서의 정확한 Worker 검증을 통과해야 합니다",
				"정렬을 거부했습니다",
			);
		}
		try {
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
				entry.organizationImpactAuthorizations,
			);
		} catch (error) {
			return this.rejectCommand(error, "정적 FAB 정렬을 원자적으로 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			STATIC_FAB_ARRANGEMENT_PLAN_KIND,
			plan.baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
			entry.organizationImpactAuthorizations,
		);
		return true;
	}

	/** Commit semantic organization metadata without rebuilding authored rail geometry. */
	commitOrganization(plan: StaticFabOrganizationMutationPlan): boolean {
		this.lastCommandError = null;
		if (!plan.valid) return this.rejectCommand(plan.reason, "AREA 변경 계획이 유효하지 않습니다");
		if (!isIssuedStaticFabOrganizationPlan(plan)) {
			return this.rejectCommand("검증되지 않은 AREA 변경 계획입니다", "AREA 변경을 거부했습니다");
		}
		if (plan.organizationMutations.length === 0) {
			return this.rejectCommand("AREA 변경 내용이 없습니다", "AREA 변경을 거부했습니다");
		}
		if (plan.baseRevision !== this.map.getRevision()) {
			return this.rejectCommand(
				"AREA가 참조한 레일 세대가 변경되었습니다 · 영역을 다시 선택하세요",
				"AREA 변경을 거부했습니다",
			);
		}
		if (plan.basePatchSequence !== this.patchSequence) {
			return this.rejectCommand(
				"AREA가 참조한 편집 순서가 변경되었습니다 · 최신 상태에서 다시 시도하세요",
				"AREA 변경을 거부했습니다",
			);
		}
		if (plan.nextOrganizationIdBefore !== this.organizations.nextOrganizationId) {
			return this.rejectCommand(
				"AREA 라이브러리 세대가 변경되었습니다 · 목록을 새로 확인하세요",
				"AREA 변경을 거부했습니다",
			);
		}
		if (
			!isStaticFabOrganizationPlanIssuedFor(plan, this.map, this.portEquipment, this.organizations)
		) {
			return this.rejectCommand(
				"다른 문서 또는 이전 상태에서 발급된 AREA 변경 계획입니다",
				"AREA 변경을 거부했습니다",
			);
		}
		const entry = createHistoryEntry(
			plan.kind,
			[],
			[],
			[],
			[],
			plan.organizationMutations,
			plan.nextOrganizationIdBefore,
			plan.nextOrganizationIdAfter,
		);
		try {
			this.applyChanges(
				[],
				[],
				[],
				[],
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
			);
		} catch (error) {
			return this.rejectCommand(error, "AREA 변경을 적용할 수 없습니다");
		}
		this.pushUndoEntry(entry);
		this.emit(
			plan.kind,
			plan.baseRevision,
			[],
			[],
			[],
			[],
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
		);
		return true;
	}

	undo(): boolean {
		this.lastCommandError = null;
		const entry = this.undoStack.at(-1);
		if (!entry) return false;
		const baseRevision = this.map.getRevision();
		const organizationNextIdBefore = this.organizations.nextOrganizationId;
		const relationshipNextIdBefore = this.relationships.nextRelationshipId;
		let operationalConfigurationPatch: OperationalConfigurationPatch | null = null;
		try {
			operationalConfigurationPatch = entry.operationalConfigurationPatch
				? reverseOperationalConfigurationPatch(
						entry.operationalConfigurationPatch,
						this.operationalConfiguration,
					)
				: null;
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				true,
				entry.organizationImpactAuthorizations,
				staticFabBayFlowEditTransitionValidation(entry, "target", "source"),
				staticFabAssemblyConnectorTransitionValidation(entry),
				operationalConfigurationPatch,
				entry.relationshipChanges,
				entry.relationshipNextIdBefore,
				entry.relationshipNextIdAfter,
			);
		} catch (error) {
			return this.rejectCommand(error, "마지막 편집을 되돌릴 수 없습니다");
		}
		this.undoStack.pop();
		this.redoStack.push(entry);
		const organizationNextIdAfter = this.organizations.nextOrganizationId;
		const relationshipNextIdAfter = this.relationships.nextRelationshipId;
		this.emit(
			"undo",
			baseRevision,
			reverseChanges(entry.changes),
			reverseSwitchChanges(entry.switchChanges),
			reversePortChanges(entry.portChanges),
			reverseEquipmentGroupChanges(entry.equipmentGroupChanges),
			reverseStaticFabOrganizationMutations(entry.organizationChanges),
			organizationNextIdBefore,
			organizationNextIdAfter,
			entry.organizationImpactAuthorizations,
			entry.kind,
			operationalConfigurationPatch,
			reverseStaticFabAssemblyRelationshipMutations(entry.relationshipChanges),
			relationshipNextIdBefore,
			relationshipNextIdAfter,
		);
		return true;
	}

	redo(): boolean {
		this.lastCommandError = null;
		const entry = this.redoStack.at(-1);
		if (!entry) return false;
		const baseRevision = this.map.getRevision();
		const organizationNextIdBefore = this.organizations.nextOrganizationId;
		const relationshipNextIdBefore = this.relationships.nextRelationshipId;
		let operationalConfigurationPatch: OperationalConfigurationPatch | null = null;
		try {
			operationalConfigurationPatch = entry.operationalConfigurationPatch
				? replayOperationalConfigurationPatch(
						entry.operationalConfigurationPatch,
						this.operationalConfiguration,
					)
				: null;
			this.applyChanges(
				entry.changes,
				entry.switchChanges,
				entry.portChanges,
				entry.equipmentGroupChanges,
				entry.organizationChanges,
				entry.organizationNextIdBefore,
				entry.organizationNextIdAfter,
				false,
				entry.organizationImpactAuthorizations,
				staticFabBayFlowEditTransitionValidation(entry, "source", "target"),
				staticFabAssemblyConnectorTransitionValidation(entry),
				operationalConfigurationPatch,
				entry.relationshipChanges,
				entry.relationshipNextIdBefore,
				entry.relationshipNextIdAfter,
			);
		} catch (error) {
			return this.rejectCommand(error, "편집을 다시 실행할 수 없습니다");
		}
		this.redoStack.pop();
		this.undoStack.push(entry);
		const organizationNextIdAfter = this.organizations.nextOrganizationId;
		const relationshipNextIdAfter = this.relationships.nextRelationshipId;
		this.emit(
			"redo",
			baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			organizationNextIdBefore,
			organizationNextIdAfter,
			entry.organizationImpactAuthorizations,
			entry.kind,
			operationalConfigurationPatch,
			entry.relationshipChanges,
			relationshipNextIdBefore,
			relationshipNextIdAfter,
		);
		return true;
	}

	clear(): boolean {
		this.lastCommandError = null;
		if (
			this.map.size === 0 &&
			this.map.advancedSwitchCount === 0 &&
			this.portEquipment.ports.length === 0 &&
			this.portEquipment.equipmentGroups.length === 0 &&
			this.organizations.records.length === 0 &&
			this.relationships.records.length === 0 &&
			operationalConfigurationIsEffectivelyEmpty(this.operationalConfiguration)
		) {
			return false;
		}
		const baseRevision = this.map.getRevision();
		const changes: RailMutation[] = [];
		this.map.forEachRail((x, y, _rail, encoded) => {
			changes.push({ x, y, before: encoded, after: 0 });
		});
		const switchChanges: AdvancedSwitchMutation[] = [];
		this.map.forEachAdvancedSwitch((switchRecord) => {
			switchChanges.push({ id: switchRecord.id, before: switchRecord, after: null });
		});
		const portChanges = this.portEquipment.ports.map((port) => ({
			id: port.id,
			before: port,
			after: null,
		}));
		const equipmentGroupChanges = this.portEquipment.equipmentGroups.map((group) => ({
			id: group.id,
			before: group,
			after: null,
		}));
		const organizationChanges = this.organizations.records.map((record) => ({
			id: record.id,
			before: record,
			after: null,
		}));
		const relationshipChanges = this.relationships.records.map((record) => ({
			id: record.id,
			before: record,
			after: null,
		}));
		const relationshipNextId = this.relationships.nextRelationshipId;
		const emptyOperational = emptyOperationalConfigurationState();
		const operationalPlan = planOperationalConfigurationReplacement(
			this.operationalConfiguration,
			{
				...emptyOperational,
				nextEqCapabilityId: this.operationalConfiguration.nextEqCapabilityId,
				nextStorageClassId: this.operationalConfiguration.nextStorageClassId,
				nextStoragePolicyId: this.operationalConfiguration.nextStoragePolicyId,
				nextResidentHomeSlotId: this.operationalConfiguration.nextResidentHomeSlotId,
			},
			baseRevision,
			this.patchSequence,
		);
		const entry = createHistoryEntry(
			"clear",
			changes,
			switchChanges,
			portChanges,
			equipmentGroupChanges,
			organizationChanges,
			this.organizations.nextOrganizationId,
			this.organizations.nextOrganizationId,
			[],
			null,
			null,
			operationalPlan?.patch ?? null,
			relationshipChanges,
			relationshipNextId,
			relationshipNextId,
		);
		this.applyChanges(
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
			false,
			[],
			null,
			null,
			entry.operationalConfigurationPatch,
			entry.relationshipChanges,
			entry.relationshipNextIdBefore,
			entry.relationshipNextIdAfter,
		);
		this.pushUndoEntry(entry);
		this.emit(
			"clear",
			baseRevision,
			entry.changes,
			entry.switchChanges,
			entry.portChanges,
			entry.equipmentGroupChanges,
			entry.organizationChanges,
			entry.organizationNextIdBefore,
			entry.organizationNextIdAfter,
			[],
			undefined,
			entry.operationalConfigurationPatch,
			entry.relationshipChanges,
			relationshipNextId,
			this.relationships.nextRelationshipId,
		);
		return true;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private applyChanges(
		changes: readonly RailMutation[],
		switchChanges: readonly AdvancedSwitchMutation[],
		portChanges: readonly PortMutation[],
		equipmentGroupChanges: readonly EquipmentGroupMutation[],
		organizationChanges: readonly StaticFabOrganizationMutation[],
		organizationNextIdBefore: number,
		organizationNextIdAfter: number,
		reverse: boolean,
		organizationImpactAuthorizations: readonly number[] = [],
		staticFabBayFlowEditValidation: StaticFabBayFlowEditTransitionValidation | null = null,
		staticFabAssemblyConnectorEvidence: StaticFabAssemblyConnectorHistoryEvidence | null = null,
		operationalConfigurationPatch: OperationalConfigurationPatch | null = null,
		relationshipChanges: readonly StaticFabAssemblyRelationshipMutationV1[] = [],
		relationshipNextIdBefore = this.currentRelationships.nextRelationshipId,
		relationshipNextIdAfter = relationshipNextIdBefore,
	): void {
		if (!canonicalPositiveInt32Ids(organizationImpactAuthorizations)) {
			throw new Error("정적 FAB 조직 보호 인증 ID가 canonical하지 않습니다");
		}
		if (staticFabBayFlowEditValidation) {
			assertStaticFabBayFlowEditHistoryEvidence(staticFabBayFlowEditValidation.evidence);
			assertStaticFabBayFlowEditAppliedProjection(
				this.currentMap,
				this.currentOrganizations,
				staticFabBayFlowEditValidation.evidence.review,
				staticFabBayFlowEditValidation.before,
			);
		}
		if (staticFabAssemblyConnectorEvidence) {
			assertStaticFabAssemblyConnectorHistoryEvidence(staticFabAssemblyConnectorEvidence);
			if (staticFabBayFlowEditValidation) {
				throw new Error("Assembly Connector history는 Bay 내부 흐름 검증과 겹칠 수 없습니다");
			}
		}
		const effectiveChanges = reverse ? reverseChanges(changes) : changes;
		const effectiveSwitchChanges = reverse ? reverseSwitchChanges(switchChanges) : switchChanges;
		const effectivePortChanges = reverse ? reversePortChanges(portChanges) : portChanges;
		const effectiveEquipmentGroupChanges = reverse
			? reverseEquipmentGroupChanges(equipmentGroupChanges)
			: equipmentGroupChanges;
		const effectiveOrganizationChanges = reverse
			? reverseStaticFabOrganizationMutations(organizationChanges)
			: organizationChanges;
		const effectiveRelationshipChanges = reverse
			? reverseStaticFabAssemblyRelationshipMutations(relationshipChanges)
			: relationshipChanges;
		if (
			staticFabBayFlowEditValidation &&
			(effectiveChanges.length === 0 ||
				effectiveOrganizationChanges.length === 0 ||
				effectiveSwitchChanges.length !== 0 ||
				effectivePortChanges.length !== 0 ||
				effectiveEquipmentGroupChanges.length !== 0 ||
				!sameNumberList(
					effectiveOrganizationChanges.map((change) => change.id),
					staticFabBayFlowEditValidation.evidence.review.changedOrganizationIds,
				))
		) {
			throw new Error("Bay 내부 흐름 history 변경 범위가 인증 증거와 다릅니다");
		}
		if (
			staticFabAssemblyConnectorEvidence &&
			(effectiveChanges.length === 0 ||
				effectiveOrganizationChanges.length === 0 ||
				effectiveSwitchChanges.length !== 0 ||
				effectivePortChanges.length !== 0 ||
				effectiveEquipmentGroupChanges.length !== 0 ||
				organizationImpactAuthorizations.length === 0)
		) {
			throw new Error("Assembly Connector history 변경 범위가 인증 증거와 다릅니다");
		}
		const deletedOrganizationIds = new Set(
			effectiveOrganizationChanges
				.filter((change) => change.before !== null && change.after === null)
				.map((change) => change.id),
		);
		for (const organizationId of organizationImpactAuthorizations) {
			if (deletedOrganizationIds.has(organizationId)) {
				throw new Error(
					`삭제되는 정적 FAB 조직 ${organizationId}는 보호 우회 인증이 될 수 없습니다`,
				);
			}
		}
		const effectiveOrganizationNextId = Math.max(
			this.currentOrganizations.nextOrganizationId,
			reverse ? organizationNextIdBefore : organizationNextIdAfter,
		);
		const effectiveRelationshipNextId = Math.max(
			this.currentRelationships.nextRelationshipId,
			reverse ? relationshipNextIdBefore : relationshipNextIdAfter,
		);
		const nextMap = this.currentMap;
		const nextOrganizations =
			effectiveOrganizationChanges.length > 0 ||
			effectiveOrganizationNextId !== this.currentOrganizations.nextOrganizationId
				? applyStaticFabOrganizationMutations(
						this.currentOrganizations,
						effectiveOrganizationChanges,
						effectiveOrganizationNextId,
						true,
					)
				: this.currentOrganizations;
		const resolvedNextMap =
			effectiveChanges.length > 0 || effectiveSwitchChanges.length > 0
				? this.currentMap.clone()
				: nextMap;
		if (resolvedNextMap !== this.currentMap) {
			resolvedNextMap.applyAtomicMutations(effectiveChanges, effectiveSwitchChanges);
		}
		const nextPortEquipment = applyPortEquipmentMutations(
			this.currentPortEquipment,
			effectivePortChanges,
			effectiveEquipmentGroupChanges,
		);
		const nextOperationalConfiguration = operationalConfigurationPatch
			? applyOperationalConfigurationPatch(
					this.currentOperationalConfiguration,
					operationalConfigurationPatch,
				)
			: this.currentOperationalConfiguration;
		const nextRelationships =
			effectiveRelationshipChanges.length > 0 ||
			effectiveRelationshipNextId !== this.currentRelationships.nextRelationshipId
				? applyStaticFabAssemblyRelationshipMutations(
						this.currentRelationships,
						effectiveRelationshipChanges,
						effectiveRelationshipNextId,
					)
				: this.currentRelationships;
		assertPortEquipmentLayout(resolvedNextMap, nextPortEquipment);
		const affectedOrganizations = staticFabOrganizationImpactsForPatch(
			this.organizationImpactIndex,
			effectiveChanges,
			effectiveSwitchChanges,
			effectivePortChanges,
			effectiveEquipmentGroupChanges,
			this.currentPortEquipment,
			nextPortEquipment,
		);
		const affectedOrganizationIds = new Set(
			affectedOrganizations.map((owner) => owner.organizationId),
		);
		for (const organizationId of organizationImpactAuthorizations) {
			if (!affectedOrganizationIds.has(organizationId)) {
				throw new Error(`정적 FAB 조직 ${organizationId}의 보호 인증 범위가 실제 변경과 다릅니다`);
			}
		}
		const authorizedRelocations = new Set(organizationImpactAuthorizations);
		const unhandledOrganizations = unhandledStaticFabOrganizationImpacts(
			this.organizationImpactIndex,
			affectedOrganizations,
			effectiveOrganizationChanges,
			effectiveChanges,
			effectiveSwitchChanges,
			effectivePortChanges,
			effectiveEquipmentGroupChanges,
			this.currentPortEquipment,
			nextPortEquipment,
			authorizedRelocations,
		);
		if (unhandledOrganizations.length > 0) {
			const affectedLabels = unhandledOrganizations.map((owner) => {
				const record = this.currentOrganizations.records.find(
					(candidate) => candidate.id === owner.organizationId,
				);
				return record ? `${record.kind} '${record.name}'` : `${owner.kind}-${owner.organizationId}`;
			});
			throw new Error(
				`정적 FAB 조직 메타데이터를 제거하거나 재할당하기 전에는 보호된 원본을 변경할 수 없습니다 · ${affectedLabels.join(", ")}`,
			);
		}
		if (staticFabBayFlowEditValidation) {
			assertStaticFabBayFlowEditAppliedProjection(
				resolvedNextMap,
				nextOrganizations,
				staticFabBayFlowEditValidation.evidence.review,
				staticFabBayFlowEditValidation.after,
			);
		} else if (
			effectiveOrganizationChanges.length > 0 &&
			(effectiveChanges.length > 0 ||
				effectiveSwitchChanges.length > 0 ||
				effectivePortChanges.length > 0 ||
				effectiveEquipmentGroupChanges.length > 0) &&
			!staticFabAssemblyConnectorEvidence
		) {
			assertStaticFabOrganizationState(resolvedNextMap, nextPortEquipment, nextOrganizations);
		}
		if (this.currentRelationships.records.length > 0 || nextRelationships.records.length > 0) {
			assertStaticFabAssemblyRelationshipStateSource(
				resolvedNextMap,
				nextOrganizations,
				nextRelationships,
			);
		}
		this.currentMap = resolvedNextMap;
		this.currentPortEquipment = nextPortEquipment;
		this.currentOrganizations = nextOrganizations;
		this.currentRelationships = nextRelationships;
		this.currentOperationalConfiguration = nextOperationalConfiguration;
		this.organizationImpactIndex.synchronize(nextOrganizations);
	}

	private emit(
		kind: RailPatchKind,
		baseRevision: number,
		changes: readonly RailMutation[],
		switchChanges: readonly AdvancedSwitchMutation[],
		portChanges: readonly PortMutation[],
		equipmentGroupChanges: readonly EquipmentGroupMutation[],
		organizationChanges: readonly StaticFabOrganizationMutation[],
		organizationNextIdBefore: number,
		organizationNextIdAfter: number,
		organizationImpactAuthorizations: readonly number[] = [],
		historyOriginKind?: RailHistoryOriginKind,
		operationalConfigurationPatch: OperationalConfigurationPatch | null = null,
		relationshipChanges: readonly StaticFabAssemblyRelationshipMutationV1[] = [],
		relationshipNextIdBefore = this.currentRelationships.nextRelationshipId,
		relationshipNextIdAfter = relationshipNextIdBefore,
	): void {
		this.publishPatchEvent(
			createRailPatchEvent(
				this.patchSequence + 1,
				kind,
				baseRevision,
				this.map.getRevision(),
				changes,
				switchChanges,
				portChanges,
				equipmentGroupChanges,
				organizationChanges,
				organizationNextIdBefore,
				organizationNextIdAfter,
				organizationImpactAuthorizations,
				historyOriginKind,
				operationalConfigurationPatch,
				relationshipChanges,
				relationshipNextIdBefore,
				relationshipNextIdAfter,
			),
		);
	}

	private publishPatchEvent(event: RailPatchEvent): void {
		if (event.sequence !== this.patchSequence + 1) {
			throw new Error("Prepared Rail patch event sequence is no longer current.");
		}
		this.patchSequence = event.sequence;
		for (const listener of this.listeners) listener(event);
	}

	private rejectCommand(error: unknown, fallback: string): false {
		this.lastCommandError =
			error instanceof Error && error.message
				? error.message
				: typeof error === "string" && error
					? error
					: fallback;
		return false;
	}
}

function createRailPatchEvent(
	sequence: number,
	kind: RailPatchKind,
	baseRevision: number,
	revision: number,
	changes: readonly RailMutation[],
	switchChanges: readonly AdvancedSwitchMutation[],
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	organizationChanges: readonly StaticFabOrganizationMutation[],
	organizationNextIdBefore: number,
	organizationNextIdAfter: number,
	organizationImpactAuthorizations: readonly number[] = [],
	historyOriginKind?: RailHistoryOriginKind,
	operationalConfigurationPatch: OperationalConfigurationPatch | null = null,
	relationshipChanges: readonly StaticFabAssemblyRelationshipMutationV1[] = [],
	relationshipNextIdBefore = 1,
	relationshipNextIdAfter = relationshipNextIdBefore,
): RailPatchEvent {
	return Object.freeze({
		sequence,
		kind,
		baseRevision,
		revision,
		changes: Object.freeze([...changes]),
		switchChanges: Object.freeze([...switchChanges]),
		portChanges: Object.freeze([...portChanges]),
		equipmentGroupChanges: Object.freeze([...equipmentGroupChanges]),
		organizationChanges: Object.freeze([...organizationChanges]),
		organizationNextIdBefore,
		organizationNextIdAfter,
		relationshipChanges: Object.freeze(
			relationshipChanges.map((change) =>
				Object.freeze({
					id: change.id,
					before: change.before ? copyStaticFabAssemblyRelationshipRecord(change.before) : null,
					after: change.after ? copyStaticFabAssemblyRelationshipRecord(change.after) : null,
				}),
			),
		),
		relationshipNextIdBefore,
		relationshipNextIdAfter,
		organizationImpactAuthorizations: Object.freeze([...organizationImpactAuthorizations]),
		operationalConfigurationPatch,
		...(historyOriginKind ? { historyOriginKind } : {}),
	} satisfies RailPatchEvent);
}

/** Synchronous command guard for the stable raw-route identity owned by every authored port. */
export function railPatchPreservesPortRoutes(
	map: TileMap,
	changes: readonly RailMutation[],
	switchChanges: readonly AdvancedSwitchMutation[],
	portEquipment: PortEquipmentState,
): boolean {
	return railPatchInvalidatedPorts(map, changes, switchChanges, portEquipment).length === 0;
}

export function railPatchInvalidatedPorts(
	map: TileMap,
	changes: readonly RailMutation[],
	switchChanges: readonly AdvancedSwitchMutation[],
	portEquipment: PortEquipmentState,
): readonly PortRecord[] {
	if (portEquipment.ports.length === 0) return Object.freeze([]);
	const afterCells = new Map(changes.map((change) => [`${change.x},${change.y}`, change.after]));
	const afterSwitches = new Map(switchChanges.map((change) => [change.id, change.after]));
	const invalidated: PortRecord[] = [];
	for (const port of portEquipment.ports) {
		if (!prospectiveRouteExists(map, afterCells, afterSwitches, port.route)) invalidated.push(port);
	}
	return Object.freeze(invalidated);
}

function prospectiveRouteExists(
	map: TileMap,
	afterCells: ReadonlyMap<string, number>,
	afterSwitches: ReadonlyMap<number, AdvancedSwitchMutation["after"]>,
	route: PortRouteIdentity,
): boolean {
	if (route.kind === "ADVANCED_SWITCH_SEGMENT") {
		const record = afterSwitches.has(route.switchId)
			? afterSwitches.get(route.switchId)
			: map.getAdvancedSwitch(route.switchId);
		return record !== null && record !== undefined && record.profileClass === route.profileClass;
	}
	const encoded = afterCells.get(`${route.x},${route.z}`) ?? map.getEncoded(route.x, route.z);
	const rail = decodeRailCell(encoded);
	if (!rail) return false;
	if (route.from === 0) return rail.incoming === 0 && rail.outgoing === route.to;
	if (route.to === 0) return rail.outgoing === 0 && rail.incoming === route.from;
	return (rail.incoming & route.from) !== 0 && (rail.outgoing & route.to) !== 0;
}

function readOptionalCommitTime(now: (() => number) | null, previous: number): number {
	if (!now) return previous;
	try {
		const value = now();
		return Number.isFinite(value) && value >= previous ? value : previous;
	} catch {
		return previous;
	}
}

interface RailDocumentPortEquipmentSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly operationalConfiguration: OperationalConfigurationState;
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly patchSequence: number;
}

interface RailDocumentCommitCooperativeController {
	readonly assertCurrent: () => void;
	readonly checkTime: () => Promise<void>;
	readonly readTime: (previous: number) => number;
}

class RailDocumentCommitSourceChangedError extends Error {
	constructor() {
		super("Rail document changed during cooperative reviewed Apply preparation.");
		this.name = "RailDocumentCommitSourceChangedError";
	}
}

function captureRailDocumentPortEquipmentSource(
	document: RailDocument,
): RailDocumentPortEquipmentSource {
	return Object.freeze({
		map: document.map,
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		relationships: document.relationships,
		operationalConfiguration: document.operationalConfiguration,
		revision: document.map.getRevision(),
		mutationGeneration: document.map.getMutationGeneration(),
		patchSequence: document.getPatchSequence(),
	});
}

function createRailDocumentCommitCooperativeController(
	document: RailDocument,
	source: RailDocumentPortEquipmentSource,
	options: RailDocumentCooperativeCommitOptions,
): RailDocumentCommitCooperativeController {
	if (
		!options ||
		typeof options.checkpoint !== "function" ||
		typeof options.now !== "function" ||
		(options.checkCancelled !== undefined && typeof options.checkCancelled !== "function") ||
		(options.preparePatch !== undefined && typeof options.preparePatch !== "function")
	) {
		throw new TypeError("Cooperative document commit options are invalid.");
	}
	const sliceMilliseconds = options.sliceMilliseconds ?? 4;
	if (!Number.isFinite(sliceMilliseconds) || sliceMilliseconds <= 0 || sliceMilliseconds > 4) {
		throw new RangeError("Cooperative document commit slice must be in (0, 4] milliseconds.");
	}
	let previousTime = readOptionalCommitTime(options.now, 0);
	let sliceStartedAt = previousTime;
	const readTime = (previous: number): number => {
		previousTime = readOptionalCommitTime(options.now, Math.max(previous, previousTime));
		return previousTime;
	};
	const assertCurrent = (): void => {
		options.checkCancelled?.();
		if (
			document.map !== source.map ||
			document.portEquipment !== source.portEquipment ||
			document.organizations !== source.organizations ||
			document.relationships !== source.relationships ||
			document.operationalConfiguration !== source.operationalConfiguration ||
			document.getPatchSequence() !== source.patchSequence ||
			source.map.getRevision() !== source.revision ||
			source.map.getMutationGeneration() !== source.mutationGeneration
		) {
			throw new RailDocumentCommitSourceChangedError();
		}
	};
	const checkTime = async (): Promise<void> => {
		assertCurrent();
		const current = readTime(sliceStartedAt);
		if (current - sliceStartedAt < sliceMilliseconds) return;
		await options.checkpoint();
		assertCurrent();
		sliceStartedAt = readTime(current);
	};
	return Object.freeze({ assertCurrent, checkTime, readTime });
}

function cooperativeCommitRejected(): MeasuredRailDocumentReviewedPortEquipmentCommit {
	return Object.freeze({ committed: false, timings: null });
}

async function createPortEquipmentHistoryEntryCooperatively(
	kind: PortEquipmentPlanKind,
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	organizationNextId: number,
	relationshipNextId: number,
	checkpoint: () => Promise<void>,
	operationBudget = 128,
): Promise<HistoryEntry> {
	if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0) {
		throw new RangeError("Cooperative history operation budget must be positive.");
	}
	let operations = 0;
	const consumeOperation = async (): Promise<void> => {
		operations++;
		if (operations < operationBudget) return;
		operations = 0;
		await checkpoint();
	};
	const ownedPortChanges = new Array<PortMutation>(portChanges.length);
	for (let index = 0; index < portChanges.length; index += 1) {
		const change = portChanges[index] as PortMutation;
		ownedPortChanges[index] = Object.freeze({
			id: change.id,
			before: change.before ? copyPortRecord(change.before) : null,
			after: change.after ? copyPortRecord(change.after) : null,
		});
		await consumeOperation();
	}
	const ownedEquipmentGroupChanges = new Array<EquipmentGroupMutation>(
		equipmentGroupChanges.length,
	);
	for (let index = 0; index < equipmentGroupChanges.length; index += 1) {
		const change = equipmentGroupChanges[index] as EquipmentGroupMutation;
		ownedEquipmentGroupChanges[index] = Object.freeze({
			id: change.id,
			before: change.before ? copyEquipmentGroupRecord(change.before) : null,
			after: change.after ? copyEquipmentGroupRecord(change.after) : null,
		});
		await consumeOperation();
	}
	const transition = Object.freeze({
		kind,
		changes: Object.freeze([]) as readonly RailMutation[],
		switchChanges: Object.freeze([]) as readonly AdvancedSwitchMutation[],
		portChanges: Object.freeze(ownedPortChanges),
		equipmentGroupChanges: Object.freeze(ownedEquipmentGroupChanges),
		organizationChanges: Object.freeze([]) as readonly StaticFabOrganizationMutation[],
		organizationNextIdBefore: organizationNextId,
		organizationNextIdAfter: organizationNextId,
		relationshipChanges: Object.freeze([]) as readonly StaticFabAssemblyRelationshipMutationV1[],
		relationshipNextIdBefore: relationshipNextId,
		relationshipNextIdAfter: relationshipNextId,
		organizationImpactAuthorizations: Object.freeze([]) as readonly number[],
		operationalConfigurationPatch: null,
		staticFabAssemblyConnectorEvidence: null,
		staticFabBayFlowEditEvidence: null,
	});
	const mirrorHistoryEntry = await createRailMirrorHistoryLedgerEntryCooperatively(
		kind,
		transition,
		checkpoint,
		operationBudget,
	);
	return Object.freeze({ ...transition, mirrorHistoryEntry });
}

function reverseChanges(changes: readonly RailMutation[]): RailMutation[] {
	return changes.map((change) =>
		Object.freeze({ ...change, before: change.after, after: change.before }),
	);
}

function reverseSwitchChanges(
	changes: readonly AdvancedSwitchMutation[],
): AdvancedSwitchMutation[] {
	return changes.map((change) =>
		Object.freeze({
			id: change.id,
			before: change.after ? copyAdvancedSwitch(change.after) : null,
			after: change.before ? copyAdvancedSwitch(change.before) : null,
		}),
	);
}

function reversePortChanges(changes: readonly PortMutation[]): PortMutation[] {
	return changes.map((change) =>
		Object.freeze({
			id: change.id,
			before: change.after ? copyPortRecord(change.after) : null,
			after: change.before ? copyPortRecord(change.before) : null,
		}),
	);
}

function reverseEquipmentGroupChanges(
	changes: readonly EquipmentGroupMutation[],
): EquipmentGroupMutation[] {
	return changes.map((change) =>
		Object.freeze({
			id: change.id,
			before: change.after ? copyEquipmentGroupRecord(change.after) : null,
			after: change.before ? copyEquipmentGroupRecord(change.before) : null,
		}),
	);
}

function operationalConfigurationIsEffectivelyEmpty(state: OperationalConfigurationState): boolean {
	return (
		state.stationCapabilities.length === 0 &&
		state.eqCapabilities.length === 0 &&
		state.eqGroupQualifications.length === 0 &&
		state.eqPortQualificationOverrides.length === 0 &&
		state.storageClasses.length === 0 &&
		state.storagePolicies.length === 0 &&
		state.storageGroups.length === 0 &&
		state.residentHomeSlots.length === 0 &&
		state.vehicleProfile === null &&
		state.review === null
	);
}

function createHistoryEntry(
	kind: HistoryEntry["kind"],
	changes: readonly RailMutation[],
	switchChanges: readonly AdvancedSwitchMutation[],
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	organizationChanges: readonly StaticFabOrganizationMutation[],
	organizationNextIdBefore: number,
	organizationNextIdAfter: number,
	organizationImpactAuthorizations: readonly number[] = [],
	staticFabBayFlowEditEvidence: StaticFabBayFlowEditHistoryEvidence | null = null,
	staticFabAssemblyConnectorEvidence: StaticFabAssemblyConnectorHistoryEvidence | null = null,
	operationalConfigurationPatch: OperationalConfigurationPatch | null = null,
	relationshipChanges: readonly StaticFabAssemblyRelationshipMutationV1[] = [],
	relationshipNextIdBefore = 1,
	relationshipNextIdAfter = relationshipNextIdBefore,
): HistoryEntry {
	const transition = Object.freeze({
		kind,
		changes: Object.freeze(
			changes.map((change) =>
				Object.freeze({
					x: change.x,
					y: change.y,
					before: change.before,
					after: change.after,
				}),
			),
		),
		switchChanges: Object.freeze(
			switchChanges.map((change) =>
				Object.freeze({
					id: change.id,
					before: change.before ? copyAdvancedSwitch(change.before) : null,
					after: change.after ? copyAdvancedSwitch(change.after) : null,
				}),
			),
		),
		portChanges: Object.freeze(
			portChanges.map((change) =>
				Object.freeze({
					id: change.id,
					before: change.before ? copyPortRecord(change.before) : null,
					after: change.after ? copyPortRecord(change.after) : null,
				}),
			),
		),
		equipmentGroupChanges: Object.freeze(
			equipmentGroupChanges.map((change) =>
				Object.freeze({
					id: change.id,
					before: change.before ? copyEquipmentGroupRecord(change.before) : null,
					after: change.after ? copyEquipmentGroupRecord(change.after) : null,
				}),
			),
		),
		organizationChanges: Object.freeze(
			organizationChanges.map((change) =>
				Object.freeze({ id: change.id, before: change.before, after: change.after }),
			),
		),
		organizationNextIdBefore,
		organizationNextIdAfter,
		relationshipChanges: Object.freeze(
			relationshipChanges.map((change) =>
				Object.freeze({
					id: change.id,
					before: change.before ? copyStaticFabAssemblyRelationshipRecord(change.before) : null,
					after: change.after ? copyStaticFabAssemblyRelationshipRecord(change.after) : null,
				}),
			),
		),
		relationshipNextIdBefore,
		relationshipNextIdAfter,
		organizationImpactAuthorizations: Object.freeze([...organizationImpactAuthorizations]),
		operationalConfigurationPatch,
		staticFabAssemblyConnectorEvidence,
		staticFabBayFlowEditEvidence,
	});
	return Object.freeze({
		...transition,
		mirrorHistoryEntry: createRailMirrorHistoryLedgerEntry(kind, transition),
	});
}

function createStaticFabAssemblyConnectorHistoryEvidence(): StaticFabAssemblyConnectorHistoryEvidence {
	return Object.freeze({ [STATIC_FAB_ASSEMBLY_CONNECTOR_HISTORY_EVIDENCE]: true as const });
}

function assertStaticFabAssemblyConnectorHistoryEvidence(
	evidence: StaticFabAssemblyConnectorHistoryEvidence,
): void {
	if (evidence[STATIC_FAB_ASSEMBLY_CONNECTOR_HISTORY_EVIDENCE] !== true) {
		throw new Error("Assembly Connector history 검증 증거가 유효하지 않습니다");
	}
}

function staticFabAssemblyConnectorTransitionValidation(
	entry: HistoryEntry,
): StaticFabAssemblyConnectorHistoryEvidence | null {
	if (!entry.staticFabAssemblyConnectorEvidence) return null;
	if (entry.kind !== STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND) {
		throw new Error("Assembly Connector 검증 증거가 다른 history kind에 연결되었습니다");
	}
	return entry.staticFabAssemblyConnectorEvidence;
}

function createStaticFabBayFlowEditHistoryEvidence(
	review: StaticFabBayFlowEditReview,
): StaticFabBayFlowEditHistoryEvidence {
	const copiedReview = Object.freeze({
		...review,
		processLoopOrganizationIds: Object.freeze([
			review.processLoopOrganizationIds[0],
			review.processLoopOrganizationIds[1],
		]) as readonly [number, number],
		changedOrganizationIds: Object.freeze([...review.changedOrganizationIds]),
		connectorBankToBayDirectedEdgeKeys: Object.freeze([
			...review.connectorBankToBayDirectedEdgeKeys,
		]),
		connectorBayToBankDirectedEdgeKeys: Object.freeze([
			...review.connectorBayToBankDirectedEdgeKeys,
		]),
	}) satisfies StaticFabBayFlowEditReview;
	return Object.freeze({
		[STATIC_FAB_BAY_FLOW_EDIT_HISTORY_EVIDENCE]: true as const,
		review: copiedReview,
	});
}

function assertStaticFabBayFlowEditHistoryEvidence(
	evidence: StaticFabBayFlowEditHistoryEvidence,
): void {
	if (evidence[STATIC_FAB_BAY_FLOW_EDIT_HISTORY_EVIDENCE] !== true) {
		throw new Error("Bay 내부 흐름 history 검증 증거가 유효하지 않습니다");
	}
}

function staticFabBayFlowEditTransitionValidation(
	entry: HistoryEntry,
	before: StaticFabBayFlowEditProjectionSide,
	after: StaticFabBayFlowEditProjectionSide,
): StaticFabBayFlowEditTransitionValidation | null {
	if (!entry.staticFabBayFlowEditEvidence) return null;
	if (entry.kind !== STATIC_FAB_BAY_FLOW_EDIT_KIND) {
		throw new Error("Bay 내부 흐름 검증 증거가 다른 history kind에 연결되었습니다");
	}
	return Object.freeze({ evidence: entry.staticFabBayFlowEditEvidence, before, after });
}

function canonicalPositiveInt32Ids(ids: readonly number[]): boolean {
	let previous = 0;
	for (const id of ids) {
		if (!Number.isInteger(id) || id <= previous || id > 0x7fff_ffff) return false;
		previous = id;
	}
	return true;
}

function sameNumberList(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isStaticFabSemanticBayMutationKind(
	kind: string,
): kind is
	| typeof STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND
	| typeof STATIC_FAB_SEMANTIC_BAY_DELETE_KIND {
	return (
		kind === STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND || kind === STATIC_FAB_SEMANTIC_BAY_DELETE_KIND
	);
}

function staticFabBayFlowEditCommitError(plan: StaticFabBayFlowEditPlan): string | null {
	const review = plan.review;
	if (
		plan.kind !== STATIC_FAB_BAY_FLOW_EDIT_KIND ||
		review.version !== 1 ||
		!Number.isInteger(review.bayOrganizationId) ||
		review.bayOrganizationId <= 0 ||
		!review.bayName
	) {
		return "Bay 내부 흐름 review identity가 유효하지 않습니다";
	}
	if (
		review.sourceInternalFlowPattern === null ||
		review.sourceInternalFlowPattern === review.targetInternalFlowPattern ||
		(review.sourceInternalFlowPattern !== "alternating" &&
			review.sourceInternalFlowPattern !== "co-rotating") ||
		(review.targetInternalFlowPattern !== "alternating" &&
			review.targetInternalFlowPattern !== "co-rotating")
	) {
		return "Bay 내부 흐름 source와 explicit target pattern이 유효하지 않습니다";
	}
	if (
		review.shellCertification !== "PENDING_WORKER_CERTIFICATION" ||
		review.externalGatewayCertification !== "PENDING_WORKER_CERTIFICATION" ||
		review.topologyCertification !== "PENDING_WORKER_CERTIFICATION"
	) {
		return "Bay 내부 흐름 review의 Worker 인증 상태가 유효하지 않습니다";
	}
	if (
		plan.mutations.length === 0 ||
		plan.organizationMutations.length === 0 ||
		plan.switchMutations.length !== 0 ||
		plan.portMutations.length !== 0 ||
		plan.equipmentGroupMutations.length !== 0 ||
		plan.nextOrganizationIdBefore !== plan.nextOrganizationIdAfter
	) {
		return "Bay 내부 흐름 변경은 레일과 기존 조직 membership만 바꿔야 합니다";
	}
	if (
		!Number.isSafeInteger(review.sourceDirectedEdgeCount) ||
		!Number.isSafeInteger(review.targetDirectedEdgeCount) ||
		!Number.isSafeInteger(review.removedDirectedEdgeCount) ||
		!Number.isSafeInteger(review.addedDirectedEdgeCount) ||
		review.sourceDirectedEdgeCount <= 0 ||
		review.targetDirectedEdgeCount <= 0 ||
		review.removedDirectedEdgeCount <= 0 ||
		review.addedDirectedEdgeCount <= 0 ||
		review.targetDirectedEdgeCount !==
			review.sourceDirectedEdgeCount -
				review.removedDirectedEdgeCount +
				review.addedDirectedEdgeCount ||
		review.changedCellCount !== plan.mutations.length ||
		review.sourceSpecificationAliasCount <= 0 ||
		!review.sourceAuthoredProjectionFingerprint ||
		!review.targetAuthoredProjectionFingerprint ||
		review.sourceAuthoredProjectionFingerprint === review.targetAuthoredProjectionFingerprint
	) {
		return "Bay 내부 흐름 review의 projection 증거와 변경 수가 실제 계획과 다릅니다";
	}
	const mutationCoordinates = plan.mutations.map((change) => `${change.x},${change.y}`);
	if (
		plan.mutations.some((change) => change.before === change.after) ||
		new Set(mutationCoordinates).size !== mutationCoordinates.length ||
		plan.mutations.some(
			(change, index) =>
				index > 0 &&
				((plan.mutations[index - 1]?.y ?? change.y) > change.y ||
					((plan.mutations[index - 1]?.y ?? change.y) === change.y &&
						(plan.mutations[index - 1]?.x ?? change.x) >= change.x)),
		)
	) {
		return "Bay 내부 흐름 레일 변경이 canonical하지 않거나 실질 변경이 아닙니다";
	}
	const processLoopIds = review.processLoopOrganizationIds;
	if (
		processLoopIds.some((id) => !Number.isInteger(id) || id <= 0) ||
		processLoopIds[0] === processLoopIds[1] ||
		processLoopIds.includes(review.bayOrganizationId)
	) {
		return "Bay 내부 흐름 review의 Process Loop identity가 유효하지 않습니다";
	}
	if (
		review.incidentConnectorCount === 0
			? review.bankOrganizationId !== null ||
				review.connectorBankToBayDirectedEdgeKeys.length !== 0 ||
				review.connectorBayToBankDirectedEdgeKeys.length !== 0
			: review.bankOrganizationId === null ||
				review.bankOrganizationId <= 0 ||
				review.bankOrganizationId === review.bayOrganizationId ||
				review.connectorBankToBayDirectedEdgeKeys.length === 0 ||
				review.connectorBayToBankDirectedEdgeKeys.length === 0
	) {
		return "Bay 내부 흐름 review의 고정 외부 gateway 증거가 유효하지 않습니다";
	}
	if (
		!uniqueNonEmptyTextList(review.connectorBankToBayDirectedEdgeKeys) ||
		!uniqueNonEmptyTextList(review.connectorBayToBankDirectedEdgeKeys) ||
		!canonicalPositiveInt32Ids(review.changedOrganizationIds) ||
		!canonicalPositiveInt32Ids(plan.organizationImpactAuthorizations)
	) {
		return "Bay 내부 흐름 review 또는 조직 보호 범위가 canonical하지 않습니다";
	}
	const allowedOrganizationIds = new Set([
		review.bayOrganizationId,
		...review.processLoopOrganizationIds,
	]);
	const changedOrganizationIds = plan.organizationMutations.map((change) => change.id);
	if (
		!canonicalPositiveInt32Ids(changedOrganizationIds) ||
		!sameNumberList(changedOrganizationIds, review.changedOrganizationIds) ||
		changedOrganizationIds.some((id) => !allowedOrganizationIds.has(id)) ||
		plan.organizationImpactAuthorizations.some((id) => !allowedOrganizationIds.has(id))
	) {
		return "Bay 내부 흐름 변경의 조직 범위가 선택된 Bay subtree와 다릅니다";
	}
	for (const change of plan.organizationMutations) {
		const before = change.before;
		const after = change.after;
		if (!before || !after || before.id !== change.id || after.id !== change.id) {
			return "Bay 내부 흐름 변경은 기존 조직 record만 갱신해야 합니다";
		}
		const beforeProperties = staticFabOrganizationProperties(before);
		const afterProperties = staticFabOrganizationProperties(after);
		if (
			before.kind !== after.kind ||
			before.name !== after.name ||
			!sameNumberList(
				staticFabOrganizationParentIds(before),
				staticFabOrganizationParentIds(after),
			) ||
			beforeProperties.description !== afterProperties.description ||
			beforeProperties.color !== afterProperties.color ||
			!sameNumberList(before.membership.advancedSwitchIds, after.membership.advancedSwitchIds) ||
			!sameNumberList(before.membership.equipmentGroupIds, after.membership.equipmentGroupIds) ||
			staticFabOrganizationRecordEquals(before, after)
		) {
			return "Bay 내부 흐름 변경은 조직 identity·계층·속성·장비 소유권을 바꿀 수 없습니다";
		}
	}
	return null;
}

function uniqueNonEmptyTextList(values: readonly string[]): boolean {
	return values.every((value) => value.length > 0) && new Set(values).size === values.length;
}

function staticFabSemanticBayMutationCommitError(
	plan: StaticFabSemanticBayMutationPlan,
): string | null {
	const expectedKind =
		plan.review.action === "DISCONNECT"
			? STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND
			: STATIC_FAB_SEMANTIC_BAY_DELETE_KIND;
	if (plan.kind !== expectedKind) {
		return "Semantic Bay action과 patch kind가 일치하지 않습니다";
	}
	if (
		plan.review.bayOrganizationId <= 0 ||
		plan.review.circulationCertification !== "PENDING_WORKER_CERTIFICATION"
	) {
		return "Semantic Bay review identity가 유효하지 않습니다";
	}
	if (plan.mutations.length === 0 || plan.organizationMutations.length === 0) {
		return "Semantic Bay 변경의 레일 또는 조직 변경이 비어 있습니다";
	}
	if (
		plan.mutations.some(
			(change) => change.before === change.after || (change.after & change.before) !== change.after,
		)
	) {
		return "Semantic Bay 변경은 authored rail 비트를 추가하거나 바꿀 수 없습니다";
	}
	if (
		plan.switchMutations.some((change) => change.before === null || change.after !== null) ||
		plan.portMutations.some((change) => change.before === null || change.after !== null) ||
		plan.equipmentGroupMutations.some(
			(change) => change.before === null || change.after !== null,
		) ||
		plan.organizationMutations.some((change) => change.before === null)
	) {
		return "Semantic Bay 변경은 authored record를 새로 만들 수 없습니다";
	}
	if (!canonicalPositiveInt32Ids(plan.organizationImpactAuthorizations)) {
		return "Semantic Bay 조직 보호 인증 범위가 canonical하지 않습니다";
	}

	const deletedOrganizationIds = plan.organizationMutations
		.filter((change) => change.before !== null && change.after === null)
		.map((change) => change.id)
		.sort((left, right) => left - right);
	if (
		!canonicalPositiveInt32Ids(deletedOrganizationIds) ||
		!canonicalPositiveInt32Ids(plan.review.removedOrganizationIds) ||
		!sameNumberList(deletedOrganizationIds, plan.review.removedOrganizationIds)
	) {
		return "Semantic Bay review의 제거 조직 범위가 실제 변경과 다릅니다";
	}
	const deletedOrganizationIdSet = new Set(deletedOrganizationIds);
	if (plan.organizationImpactAuthorizations.some((id) => deletedOrganizationIdSet.has(id))) {
		return "삭제되는 semantic Bay 조직은 보호 우회 인증이 될 수 없습니다";
	}

	if (plan.review.action === "DISCONNECT") {
		if (
			plan.review.incidentConnectorCount !== 1 ||
			plan.review.bankOrganizationId === null ||
			deletedOrganizationIds.length !== 0 ||
			plan.switchMutations.length !== 0 ||
			plan.portMutations.length !== 0 ||
			plan.equipmentGroupMutations.length !== 0
		) {
			return "Bay Disconnect는 한 connector와 Bank 관계만 분리하고 Bay content를 보존해야 합니다";
		}
		return null;
	}

	if (
		!deletedOrganizationIdSet.has(plan.review.bayOrganizationId) ||
		deletedOrganizationIds.length === 0 ||
		(plan.review.incidentConnectorCount === 0) !== (plan.review.bankOrganizationId === null)
	) {
		return "Bay Delete review와 제거되는 Bay 계층이 일치하지 않습니다";
	}
	const deletedPortIds = plan.portMutations.map((change) => change.id).sort((a, b) => a - b);
	const deletedEquipmentGroupIds = plan.equipmentGroupMutations
		.map((change) => change.id)
		.sort((a, b) => a - b);
	if (
		!sameNumberList(deletedPortIds, plan.review.portIds) ||
		!sameNumberList(deletedEquipmentGroupIds, plan.review.equipmentGroupIds) ||
		plan.switchMutations.length !== plan.review.advancedSwitchCount
	) {
		return "Bay Delete review의 장비·스위치 제거 범위가 실제 변경과 다릅니다";
	}
	return null;
}
