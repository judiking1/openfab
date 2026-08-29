import {
	type CompiledPhysicalPathMigration,
	compilePhysicalPathMigration,
} from "../compile/PhysicalPathMigration";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import {
	deriveStaticFabOrganizationOutlineIndexSnapshotFromValidatedSource,
	type StaticFabOrganizationOutlineIndexSnapshot,
	type StaticFabOrganizationOutlineIndexSourceIdentity,
} from "../compile/StaticFabOrganizationOutlineIndex";
import {
	ADVANCED_SWITCH_MAX_ID,
	type AdvancedSwitchMutation,
	type AdvancedSwitchRecord,
	advancedSwitchEquals,
	advancedSwitchRecordError,
	validateAdvancedSwitchPatch,
	validateAdvancedSwitchTopology,
} from "../core/AdvancedSwitch";
import {
	applyPortEquipmentMutations,
	emptyPortEquipmentState,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	captureLegacyCustomEquipmentBaseline,
	type LegacyCustomEquipmentBaseline,
	legacyCustomEquipmentMutationError,
	legacyCustomEquipmentResyncError,
} from "../core/LegacyCustomEquipment";
import {
	checksumOperationalConfigurationState,
	copyOperationalConfigurationState,
	emptyOperationalConfigurationState,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import {
	applyOperationalConfigurationPatch,
	OPERATIONAL_CONFIGURATION_PATCH_KIND,
} from "../core/OperationalConfigurationMutation";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import type { RailHistoryOriginKind, RailPatchEvent } from "../core/RailDocument";
import {
	appendBoundedRailHistoryEntry,
	copyRailMirrorHistoryLedger,
	createRailMirrorHistoryLedgerEntry,
	EMPTY_RAIL_MIRROR_HISTORY_LEDGER,
	isRailHistoryOriginKind,
	type RailMirrorHistoryLedger,
	type RailMirrorHistoryLedgerEntry,
	railPatchTransitionFingerprint,
} from "../core/RailPatchHistory";
import { ALL_DIRECTIONS, moveCell } from "../core/railShape";
import { STATIC_FAB_ARRANGEMENT_PLAN_KIND } from "../core/StaticFabArrangementPlan";
import { STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND } from "../core/StaticFabAssemblyConnector";
import { STATIC_FAB_BAY_FLOW_EDIT_KIND } from "../core/StaticFabBayFlowEdit";
import {
	applyStaticFabOrganizationMutations,
	assertStaticFabOrganizationState,
	deriveStaticFabOrganizationSemanticRoles,
	emptyStaticFabOrganizationState,
	resolveStaticFabOrganizationDescendantIds,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "../core/StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactsForPatch,
	unhandledStaticFabOrganizationImpacts,
} from "../core/StaticFabOrganizationImpactIndex";
import {
	STATIC_FAB_SEMANTIC_BAY_DELETE_KIND,
	STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND,
} from "../core/StaticFabSemanticBayMutation";
import { cellKey, decodeRailCell, TileMap } from "../core/TileMap";
import {
	readAdvancedSwitchRecord,
	validateAdvancedSwitchRecordFieldLengths,
} from "./AdvancedSwitchSoA";
import { hydratePortEquipmentSnapshot } from "./PortEquipmentSoA";
import {
	assertInt32Coordinate,
	captureRailMirrorSnapshot,
	RailChecksumAccumulator,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import {
	createRailPhysicalDeltaPublication,
	createRailPhysicalResetPublication,
	createRailPhysicalStaticPublication,
	type RailPhysicalPublication,
} from "./RailPhysicalLayout";
import { hydrateStaticFabOrganizationSnapshot } from "./StaticFabOrganizationSoA";

export interface RailMirrorState {
	sequence: number;
	revision: number;
	checksum: string;
	cells: number;
	edges: number;
	switches: number;
	ports: number;
	equipmentGroups: number;
	organizations: number;
	operationalConfigurationRevision: number;
	operationalConfigurationFingerprint: string;
}

export type RailPhysicalCompiler = (map: TileMap, revision: number) => CompiledPhysicalLayout;
export type RailMigrationCompiler = (
	previous: CompiledPhysicalLayout,
	next: CompiledPhysicalLayout,
) => CompiledPhysicalPathMigration;

export class RailPhysicalPublicationError extends Error {
	readonly cause: unknown;

	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : "Unknown physical rail publication failure.");
		this.name = "RailPhysicalPublicationError";
		this.cause = cause;
	}
}

/** Worker-side owner that publishes authored and physical state as one revision. */
export class RailPatchMirror {
	private mirroredMap = new TileMap();
	private mirroredPortEquipment: PortEquipmentState = emptyPortEquipmentState();
	private mirroredOrganizations: StaticFabOrganizationState = emptyStaticFabOrganizationState();
	private mirroredOperationalConfiguration = emptyOperationalConfigurationState();
	private readonly organizationImpactIndex = new StaticFabOrganizationImpactIndex();
	private checksum = new RailChecksumAccumulator();
	private currentSequence = 0;
	private currentRevision = 0;
	private legacyCustomEquipment: LegacyCustomEquipmentBaseline =
		captureLegacyCustomEquipmentBaseline(emptyPortEquipmentState());
	private hasSynchronized = false;
	private undoHistory: RailMirrorHistoryLedgerEntry[] = [];
	private redoHistory: RailMirrorHistoryLedgerEntry[] = [];

	get organizationState(): StaticFabOrganizationState {
		return this.mirroredOrganizations;
	}
	private physicalPublication: RailPhysicalPublication;
	private readonly compilePhysical: RailPhysicalCompiler;
	private readonly compileMigration: RailMigrationCompiler;

	constructor(
		compilePhysical: RailPhysicalCompiler = compilePhysicalRail,
		compileMigration: RailMigrationCompiler = compilePhysicalPathMigration,
	) {
		this.compilePhysical = compilePhysical;
		this.compileMigration = compileMigration;
		this.physicalPublication = createRailPhysicalResetPublication(
			this.compileAtRevision(this.mirroredMap, 0),
			0,
		);
	}

	get state(): RailMirrorState {
		return {
			sequence: this.currentSequence,
			revision: this.currentRevision,
			checksum: this.checksum.digest(),
			cells: this.checksum.cellCount,
			edges: this.checksum.edgeCount,
			switches: this.checksum.switchCount,
			ports: this.checksum.portCount,
			equipmentGroups: this.checksum.equipmentGroupCount,
			organizations: this.checksum.organizationCount,
			operationalConfigurationRevision: this.mirroredOperationalConfiguration.revision,
			operationalConfigurationFingerprint: checksumOperationalConfigurationState(
				this.mirroredOperationalConfiguration,
			),
		};
	}

	getPhysicalPublication(): RailPhysicalPublication {
		return this.physicalPublication;
	}

	/** Export one fresh transferable snapshot from the exact synchronized Worker-owned state. */
	captureSnapshot(): RailMirrorSnapshot {
		if (!this.hasSynchronized) {
			throw new Error("Rail mirror must synchronize before exporting an authored snapshot.");
		}
		const snapshot = captureRailMirrorSnapshot(
			this.mirroredMap,
			this.currentSequence,
			this.mirroredPortEquipment,
			this.mirroredOrganizations,
		).snapshot;
		if (
			snapshot.revision !== this.currentRevision ||
			snapshot.checksum !== this.checksum.digest()
		) {
			throw new Error("Rail mirror exported a divergent authored snapshot.");
		}
		return snapshot;
	}

	/**
	 * Derive a small read-only organization outline from the exact Worker-owned authored and physical
	 * state. This never exports the mirrored map or recompiles the physical rail layout.
	 */
	captureOrganizationOutline(): StaticFabOrganizationOutlineIndexSnapshot {
		if (!this.hasSynchronized) {
			throw new Error(
				"Rail mirror must synchronize before exporting a static FAB organization outline.",
			);
		}
		const publication = this.physicalPublication;
		const physical = publication.current;
		const state = this.state;
		if (
			physical.identity.sequence !== state.sequence ||
			physical.identity.revision !== state.revision
		) {
			throw new Error(
				"Rail mirror physical identity diverged before organization outline capture.",
			);
		}
		const source = this.getOrganizationOutlineSourceIdentity();
		const outline = deriveStaticFabOrganizationOutlineIndexSnapshotFromValidatedSource(
			this.mirroredMap,
			this.mirroredPortEquipment,
			this.mirroredOrganizations,
			source,
			physical.buffers,
		);
		if (
			this.physicalPublication !== publication ||
			this.physicalPublication.current !== physical ||
			this.state.sequence !== state.sequence ||
			this.state.revision !== state.revision ||
			this.state.checksum !== state.checksum
		) {
			throw new Error("Rail mirror changed during organization outline capture.");
		}
		return outline;
	}

	getOrganizationOutlineSourceIdentity(): StaticFabOrganizationOutlineIndexSourceIdentity {
		if (!this.hasSynchronized) {
			throw new Error(
				"Rail mirror must synchronize before reading its organization outline identity.",
			);
		}
		const state = this.state;
		const physical = this.physicalPublication.current.identity;
		return Object.freeze({
			sequence: state.sequence,
			revision: state.revision,
			checksum: state.checksum,
			nextAdvancedSwitchId: this.mirroredMap.getAdvancedSwitchIdCursor(),
			nextPortId: this.mirroredPortEquipment.nextPortId,
			nextEquipmentGroupId: this.mirroredPortEquipment.nextEquipmentGroupId,
			nextOrganizationId: this.mirroredOrganizations.nextOrganizationId,
			physicalSequence: physical.sequence,
			physicalRevision: physical.revision,
			physicalFingerprint: physical.fingerprint,
		});
	}

	sync(
		snapshot: RailMirrorSnapshot,
		historyLedger: RailMirrorHistoryLedger = EMPTY_RAIL_MIRROR_HISTORY_LEDGER,
		operationalConfiguration: OperationalConfigurationState = emptyOperationalConfigurationState(),
	): RailMirrorState {
		assertNonNegativeInteger(snapshot.sequence, "snapshot sequence");
		assertNonNegativeInteger(snapshot.revision, "snapshot revision");
		if (
			snapshot.xs.length !== snapshot.ys.length ||
			snapshot.xs.length !== snapshot.encoded.length
		) {
			throw new Error("Rail snapshot SoA lengths do not match.");
		}
		validateAdvancedSwitchRecordFieldLengths(
			snapshot.switchRecords,
			snapshot.switchIds.length,
			"Rail snapshot",
		);
		const copiedHistoryLedger = copyRailMirrorHistoryLedger(historyLedger);
		const nextOperationalConfiguration =
			copyOperationalConfigurationState(operationalConfiguration);

		const hydrator = TileMap.createHydrator();
		const nextChecksum = new RailChecksumAccumulator();
		for (let index = 0; index < snapshot.encoded.length; index++) {
			const x = snapshot.xs[index] as number;
			const y = snapshot.ys[index] as number;
			const encoded = snapshot.encoded[index] as number;
			if (encoded === 0) throw new Error(`Rail snapshot cell ${index} is empty.`);
			hydrator.addEncodedCell(x, y, encoded);
			nextChecksum.addCell(x, y, encoded);
		}
		for (let index = 0; index < snapshot.switchIds.length; index++) {
			const id = snapshot.switchIds[index] as number;
			assertAdvancedSwitchId(id, `Rail snapshot switch ${index} id`);
			const record = readAdvancedSwitchRecord(
				snapshot.switchRecords,
				index,
				id,
				`Rail snapshot switch ${id}`,
			);
			hydrator.addAdvancedSwitch(record);
			nextChecksum.addSwitch(record);
		}
		const nextPortEquipment = hydratePortEquipmentSnapshot(snapshot.portEquipment);
		if (this.hasSynchronized) {
			const legacyCustomError = legacyCustomEquipmentResyncError(
				nextPortEquipment,
				this.legacyCustomEquipment,
			);
			if (legacyCustomError) throw new Error(legacyCustomError);
		}
		for (const port of nextPortEquipment.ports) nextChecksum.addPort(port);
		for (const group of nextPortEquipment.equipmentGroups) nextChecksum.addEquipmentGroup(group);
		const nextOrganizations = hydrateStaticFabOrganizationSnapshot(snapshot.organizations);
		for (const record of nextOrganizations.records) nextChecksum.addOrganization(record);
		nextChecksum.setOrganizationNextId(nextOrganizations.nextOrganizationId);
		const nextMap = hydrator.finish(snapshot.revision, snapshot.nextAdvancedSwitchId);
		assertAdvancedSwitchTopology(nextMap);
		assertPortEquipmentLayout(nextMap, nextPortEquipment);
		assertStaticFabOrganizationState(nextMap, nextPortEquipment, nextOrganizations);
		if (nextChecksum.digest() !== snapshot.checksum) {
			throw new Error(
				`Rail snapshot checksum mismatch: expected ${snapshot.checksum}, received ${nextChecksum.digest()}.`,
			);
		}
		const nextPhysicalLayout = this.compileAtRevision(nextMap, snapshot.revision);
		assertPortAttachments(nextPhysicalLayout, nextPortEquipment);
		const nextPhysicalPublication = createRailPhysicalResetPublication(
			nextPhysicalLayout,
			snapshot.sequence,
		);

		this.mirroredMap = nextMap;
		this.mirroredPortEquipment = nextPortEquipment;
		this.mirroredOrganizations = nextOrganizations;
		this.mirroredOperationalConfiguration = nextOperationalConfiguration;
		this.organizationImpactIndex.synchronize(nextOrganizations);
		this.checksum = nextChecksum;
		this.currentSequence = snapshot.sequence;
		this.currentRevision = snapshot.revision;
		if (!this.hasSynchronized) {
			this.legacyCustomEquipment = captureLegacyCustomEquipmentBaseline(nextPortEquipment);
		}
		this.hasSynchronized = true;
		this.undoHistory = [...copiedHistoryLedger.undo];
		this.redoHistory = [...copiedHistoryLedger.redo];
		this.physicalPublication = nextPhysicalPublication;
		return this.state;
	}

	applyPatch(patch: RailPatchEvent): RailMirrorState {
		if (
			patch.changes.length === 0 &&
			patch.switchChanges.length === 0 &&
			patch.portChanges.length === 0 &&
			patch.equipmentGroupChanges.length === 0 &&
			patch.organizationChanges.length === 0 &&
			!patch.operationalConfigurationPatch
		) {
			throw new Error("Static-world patch must contain at least one authored change.");
		}
		const expectedSequence = this.currentSequence + 1;
		const historyOriginKind = this.validateHistoryTransition(patch);
		const authoredHistoryEntry =
			patch.kind === "undo" || patch.kind === "redo"
				? null
				: createRailMirrorHistoryLedgerEntry(historyOriginKind, patch);
		const organizationImpactAuthorizations = patch.organizationImpactAuthorizations ?? [];
		validateOrganizationImpactAuthorizations(organizationImpactAuthorizations, historyOriginKind);
		validateOperationalConfigurationPatchScope(patch, historyOriginKind);
		validateStaticFabSemanticBayMutationPatch(patch);
		validateStaticFabBayFlowEditPatch(patch, this.mirroredOrganizations, historyOriginKind);
		if (patch.sequence !== expectedSequence) {
			throw new Error(
				`Rail patch sequence gap: expected ${expectedSequence}, received ${patch.sequence}.`,
			);
		}
		if (patch.baseRevision !== this.currentRevision) {
			throw new Error(
				`Rail patch base revision mismatch: expected ${this.currentRevision}, received ${patch.baseRevision}.`,
			);
		}
		const railMutationCount = patch.changes.length + patch.switchChanges.length;
		if (patch.revision !== patch.baseRevision + railMutationCount) {
			throw new Error(
				`Rail patch revision mismatch: ${railMutationCount} rail changes cannot advance ${patch.baseRevision} to ${patch.revision}.`,
			);
		}

		const touched = new Set<string>();
		for (const change of patch.changes) {
			assertInt32Coordinate(change.x, "x");
			assertInt32Coordinate(change.y, "y");
			assertByte(change.before, "before");
			assertByte(change.after, "after");
			if (change.before === change.after) {
				throw new Error(`Rail patch contains a no-op at ${cellKey(change.x, change.y)}.`);
			}
			const key = cellKey(change.x, change.y);
			if (touched.has(key)) throw new Error(`Rail patch changes ${key} more than once.`);
			touched.add(key);
			const mirrored = this.mirroredMap.getEncoded(change.x, change.y);
			if (mirrored !== change.before) {
				throw new Error(
					`Rail patch before-value mismatch at ${key}: expected ${mirrored}, received ${change.before}.`,
				);
			}
		}

		const touchedSwitches = new Set<number>();
		for (const change of patch.switchChanges) {
			validateSwitchMutation(change);
			if (touchedSwitches.has(change.id)) {
				throw new Error(`Rail patch changes advanced switch ${change.id} more than once.`);
			}
			touchedSwitches.add(change.id);
			const mirrored = this.mirroredMap.getAdvancedSwitch(change.id);
			if (!advancedSwitchEquals(mirrored, change.before)) {
				throw new Error(`Rail patch advanced switch ${change.id} before-value mismatch.`);
			}
		}
		const topologyIssues = validateAdvancedSwitchPatch(
			this.mirroredMap,
			patch.changes,
			patch.switchChanges,
		);
		if (topologyIssues.length > 0) {
			const issue = topologyIssues[0];
			throw new Error(
				`Rail patch advanced switch validation failed (${issue?.code ?? "UNKNOWN"}): ${issue?.message ?? "unknown topology error"}.`,
			);
		}
		if (patch.organizationNextIdBefore !== this.mirroredOrganizations.nextOrganizationId) {
			throw new Error(
				`Organization ID cursor mismatch: expected ${this.mirroredOrganizations.nextOrganizationId}, received ${patch.organizationNextIdBefore}.`,
			);
		}
		const nextOrganizations = applyStaticFabOrganizationMutations(
			this.mirroredOrganizations,
			patch.organizationChanges,
			patch.organizationNextIdAfter,
			true,
		);
		const nextOperationalConfiguration = patch.operationalConfigurationPatch
			? applyOperationalConfigurationPatch(
					this.mirroredOperationalConfiguration,
					patch.operationalConfigurationPatch,
				)
			: this.mirroredOperationalConfiguration;
		const deletedOrganizationIds = new Set(
			patch.organizationChanges
				.filter((change) => change.before !== null && change.after === null)
				.map((change) => change.id),
		);
		for (const organizationId of organizationImpactAuthorizations) {
			if (deletedOrganizationIds.has(organizationId)) {
				throw new Error(
					`Deleted organization ${organizationId} cannot carry relocation authority.`,
				);
			}
		}
		const organizationMetadataOnly = patch.organizationChanges.every(
			(change) =>
				change.before !== null &&
				(change.after === null ||
					(change.before.id === change.after.id &&
						change.before.kind === change.after.kind &&
						change.before.membership === change.after.membership)),
		);

		const previousChecksum = this.checksum.clone();
		const mapCheckpoint = this.mirroredMap.createMutationCheckpoint();
		let mapApplied = false;
		let nextPhysicalPublication: RailPhysicalPublication;
		let nextPortEquipment: PortEquipmentState;
		try {
			const legacyCustomError = legacyCustomEquipmentMutationError(
				patch.portChanges,
				patch.equipmentGroupChanges,
				this.legacyCustomEquipment,
			);
			if (legacyCustomError) throw new Error(legacyCustomError);
			nextPortEquipment = applyPortEquipmentMutations(
				this.mirroredPortEquipment,
				patch.portChanges,
				patch.equipmentGroupChanges,
			);
			if (railMutationCount > 0) {
				this.mirroredMap.applyAtomicMutations(patch.changes, patch.switchChanges);
				mapApplied = true;
			}
			assertPortEquipmentLayout(this.mirroredMap, nextPortEquipment);
			const affectedOrganizations = staticFabOrganizationImpactsForPatch(
				this.organizationImpactIndex,
				patch.changes,
				patch.switchChanges,
				patch.portChanges,
				patch.equipmentGroupChanges,
				this.mirroredPortEquipment,
				nextPortEquipment,
			);
			const affectedOrganizationIds = new Set(
				affectedOrganizations.map((owner) => owner.organizationId),
			);
			for (const organizationId of organizationImpactAuthorizations) {
				if (!affectedOrganizationIds.has(organizationId)) {
					throw new Error(
						`Organization relocation authorization ${organizationId} does not match this patch.`,
					);
				}
			}
			const unhandledOrganizations = unhandledStaticFabOrganizationImpacts(
				this.organizationImpactIndex,
				affectedOrganizations,
				patch.organizationChanges,
				patch.changes,
				patch.switchChanges,
				patch.portChanges,
				patch.equipmentGroupChanges,
				this.mirroredPortEquipment,
				nextPortEquipment,
				new Set(organizationImpactAuthorizations),
			);
			if (unhandledOrganizations.length > 0) {
				throw new Error(
					`정적 FAB 조직 ${unhandledOrganizations.map((owner) => `${owner.kind}-${owner.organizationId}`).join(", ")}의 보호된 원본을 변경할 수 없습니다`,
				);
			}
			if (
				!organizationMetadataOnly ||
				(patch.organizationChanges.length > 0 &&
					(railMutationCount > 0 ||
						patch.portChanges.length > 0 ||
						patch.equipmentGroupChanges.length > 0))
			) {
				assertStaticFabOrganizationState(this.mirroredMap, nextPortEquipment, nextOrganizations);
			}
			for (const change of patch.switchChanges) {
				if (!change.before) continue;
				this.checksum.removeSwitch(change.before);
			}
			for (const change of patch.changes) {
				this.checksum.applyMutation(change);
			}
			for (const change of patch.switchChanges) {
				if (!change.after) continue;
				this.checksum.addSwitch(change.after);
			}
			for (const change of patch.portChanges) this.checksum.applyPortMutation(change);
			for (const change of patch.equipmentGroupChanges) {
				this.checksum.applyEquipmentGroupMutation(change);
			}
			this.checksum.applyOrganizationNextId(
				patch.organizationNextIdBefore,
				patch.organizationNextIdAfter,
			);
			for (const change of patch.organizationChanges) {
				this.checksum.applyOrganizationMutation(change);
			}
			this.assertCounters(nextPortEquipment, nextOrganizations);
			assertAdvancedSwitchTopology(this.mirroredMap);
			const previousPhysical = this.physicalPublication.current;
			if (railMutationCount === 0) {
				assertPortAttachments(previousPhysical.buffers, nextPortEquipment);
				nextPhysicalPublication = createRailPhysicalStaticPublication(
					previousPhysical,
					patch.sequence,
				);
			} else {
				const nextPhysicalLayout = this.compileAtRevision(this.mirroredMap, patch.revision);
				assertPortAttachments(nextPhysicalLayout, nextPortEquipment);
				const nextPhysicalMigration = this.compileMigration(
					previousPhysical.buffers,
					nextPhysicalLayout,
				);
				if (
					nextPhysicalMigration.fromRevision !== this.currentRevision ||
					nextPhysicalMigration.toRevision !== patch.revision
				) {
					throw new Error(
						`Physical migration revision mismatch: expected ${this.currentRevision}->${patch.revision}, received ${nextPhysicalMigration.fromRevision}->${nextPhysicalMigration.toRevision}.`,
					);
				}
				nextPhysicalPublication = createRailPhysicalDeltaPublication(
					previousPhysical,
					nextPhysicalLayout,
					patch.sequence,
					nextPhysicalMigration,
				);
			}
		} catch (error) {
			if (mapApplied) {
				this.mirroredMap.rollbackAtomicMutations(patch.changes, patch.switchChanges, mapCheckpoint);
			}
			this.checksum = previousChecksum;
			this.assertCounters();
			throw new RailPhysicalPublicationError(error);
		}
		this.currentSequence = patch.sequence;
		this.currentRevision = patch.revision;
		this.mirroredPortEquipment = nextPortEquipment;
		this.mirroredOrganizations = nextOrganizations;
		this.mirroredOperationalConfiguration = nextOperationalConfiguration;
		this.organizationImpactIndex.synchronize(nextOrganizations);
		this.physicalPublication = nextPhysicalPublication;
		this.recordHistoryTransition(patch.kind, historyOriginKind, authoredHistoryEntry);
		return this.state;
	}

	private validateHistoryTransition(patch: RailPatchEvent): RailHistoryOriginKind {
		if (patch.kind !== "undo" && patch.kind !== "redo") {
			if (patch.historyOriginKind !== undefined) {
				throw new Error("Only undo/redo patches may carry a history origin kind.");
			}
			const rawKind: unknown = patch.kind;
			if (!isRailHistoryOriginKind(rawKind)) {
				throw new Error("Rail authored patch kind is not a canonical history origin kind.");
			}
			return rawKind;
		}
		const rawHistoryOriginKind: string | undefined = patch.historyOriginKind;
		if (!isRailHistoryOriginKind(rawHistoryOriginKind)) {
			throw new Error(`Rail ${patch.kind} patch must carry a canonical history origin kind.`);
		}
		if (patch.organizationNextIdBefore !== patch.organizationNextIdAfter) {
			throw new Error(
				`Rail ${patch.kind} patch cannot change the monotonic organization ID cursor.`,
			);
		}
		const historyOriginKind = rawHistoryOriginKind;
		const history = patch.kind === "undo" ? this.undoHistory : this.redoHistory;
		const expected = history.at(-1);
		if (!expected) {
			throw new Error(`Rail ${patch.kind} patch has no mirrored history entry to consume.`);
		}
		if (expected.originKind !== historyOriginKind) {
			throw new Error(
				`Rail ${patch.kind} history origin mismatch: expected '${expected.originKind}', received '${historyOriginKind}'.`,
			);
		}
		const receivedFingerprint = railPatchTransitionFingerprint(patch);
		const expectedFingerprint =
			patch.kind === "undo" ? expected.reverseFingerprint : expected.forwardFingerprint;
		if (receivedFingerprint !== expectedFingerprint) {
			throw new Error(
				`Rail ${patch.kind} patch does not exactly match its mirrored history transition.`,
			);
		}
		return expected.originKind;
	}

	private recordHistoryTransition(
		kind: RailPatchEvent["kind"],
		historyOriginKind: RailHistoryOriginKind,
		authoredHistoryEntry: RailMirrorHistoryLedgerEntry | null,
	): void {
		if (kind === "undo") {
			const entry = this.undoHistory.pop();
			if (!entry) throw new Error("Rail undo history disappeared after validation.");
			this.redoHistory.push(entry);
			return;
		}
		if (kind === "redo") {
			const entry = this.redoHistory.pop();
			if (!entry) throw new Error("Rail redo history disappeared after validation.");
			this.undoHistory.push(entry);
			return;
		}
		if (!authoredHistoryEntry || authoredHistoryEntry.originKind !== historyOriginKind) {
			throw new Error("Rail authored history entry disappeared after validation.");
		}
		appendBoundedRailHistoryEntry(this.undoHistory, authoredHistoryEntry);
		this.redoHistory = [];
	}

	private compileAtRevision(map: TileMap, revision: number): CompiledPhysicalLayout {
		const layout = this.compilePhysical(map, revision);
		if (layout.revision !== revision || layout.paths.revision !== revision) {
			throw new Error(
				`Physical compiler revision mismatch: expected ${revision}, received ${layout.revision}/${layout.paths.revision}.`,
			);
		}
		return layout;
	}

	private assertCounters(
		portEquipment: PortEquipmentState = this.mirroredPortEquipment,
		organizations: StaticFabOrganizationState = this.mirroredOrganizations,
	): void {
		if (
			this.mirroredMap.size !== this.checksum.cellCount ||
			this.mirroredMap.edgeCount !== this.checksum.edgeCount ||
			this.mirroredMap.advancedSwitchCount !== this.checksum.switchCount ||
			portEquipment.ports.length !== this.checksum.portCount ||
			portEquipment.equipmentGroups.length !== this.checksum.equipmentGroupCount ||
			organizations.records.length !== this.checksum.organizationCount
		) {
			throw new Error("Rail mirror counters diverged after applying a validated patch.");
		}
	}
}

function validateOperationalConfigurationPatchScope(
	patch: RailPatchEvent,
	historyOriginKind: RailHistoryOriginKind,
): void {
	const operationalPatch = patch.operationalConfigurationPatch ?? null;
	if (historyOriginKind === OPERATIONAL_CONFIGURATION_PATCH_KIND) {
		if (!operationalPatch) {
			throw new Error("Operational configuration history patch is missing its typed delta.");
		}
		if (
			patch.changes.length > 0 ||
			patch.switchChanges.length > 0 ||
			patch.portChanges.length > 0 ||
			patch.equipmentGroupChanges.length > 0 ||
			patch.organizationChanges.length > 0 ||
			patch.organizationNextIdBefore !== patch.organizationNextIdAfter
		) {
			throw new Error("Operational configuration patch cannot change static authored geometry.");
		}
		if (
			(patch.kind === "undo" || patch.kind === "redo") &&
			(operationalPatch.nextEqCapabilityIdBefore !== operationalPatch.nextEqCapabilityIdAfter ||
				operationalPatch.nextStorageClassIdBefore !== operationalPatch.nextStorageClassIdAfter ||
				operationalPatch.nextStoragePolicyIdBefore !== operationalPatch.nextStoragePolicyIdAfter ||
				operationalPatch.nextResidentHomeSlotIdBefore !==
					operationalPatch.nextResidentHomeSlotIdAfter)
		) {
			throw new Error(
				"Operational configuration undo/redo cannot change monotonic definition cursors.",
			);
		}
		return;
	}
	if (
		operationalPatch &&
		(patch.kind === "undo" || patch.kind === "redo") &&
		(operationalPatch.nextEqCapabilityIdBefore !== operationalPatch.nextEqCapabilityIdAfter ||
			operationalPatch.nextStorageClassIdBefore !== operationalPatch.nextStorageClassIdAfter ||
			operationalPatch.nextStoragePolicyIdBefore !== operationalPatch.nextStoragePolicyIdAfter ||
			operationalPatch.nextResidentHomeSlotIdBefore !==
				operationalPatch.nextResidentHomeSlotIdAfter)
	) {
		throw new Error(
			"Operational configuration undo/redo cannot change monotonic definition cursors.",
		);
	}
	if (operationalPatch && historyOriginKind !== "clear") {
		throw new Error(
			`Rail patch kind '${historyOriginKind}' cannot carry an operational configuration delta.`,
		);
	}
}

function validateOrganizationImpactAuthorizations(
	ids: readonly number[],
	kind: RailHistoryOriginKind,
): void {
	if (
		ids.length > 0 &&
		kind !== STATIC_FAB_ARRANGEMENT_PLAN_KIND &&
		kind !== STATIC_FAB_ASSEMBLY_CONNECTOR_PATCH_KIND &&
		kind !== STATIC_FAB_BAY_FLOW_EDIT_KIND &&
		kind !== STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND &&
		kind !== STATIC_FAB_SEMANTIC_BAY_DELETE_KIND
	) {
		throw new Error(`Rail patch kind '${kind}' cannot carry organization relocation authority.`);
	}
	let previous = 0;
	for (const id of ids) {
		if (!Number.isInteger(id) || id <= previous || id > 0x7fff_ffff) {
			throw new Error("Rail patch organization relocation authority is not canonical.");
		}
		previous = id;
	}
}

function validateStaticFabBayFlowEditPatch(
	patch: RailPatchEvent,
	organizations: StaticFabOrganizationState,
	historyOriginKind: RailHistoryOriginKind,
): void {
	if (historyOriginKind !== STATIC_FAB_BAY_FLOW_EDIT_KIND) return;
	if (patch.changes.length === 0 || patch.organizationChanges.length === 0) {
		throw new Error("Bay flow edit patch must change both authored rail and organizations.");
	}
	if (
		patch.switchChanges.length > 0 ||
		patch.portChanges.length > 0 ||
		patch.equipmentGroupChanges.length > 0
	) {
		throw new Error("Bay flow edit patch cannot change switches, ports, or equipment groups.");
	}
	if (patch.organizationNextIdBefore !== patch.organizationNextIdAfter) {
		throw new Error("Bay flow edit patch cannot change the organization ID cursor.");
	}

	const changedOrganizationIds = new Set<number>();
	for (const change of patch.organizationChanges) {
		if (!change.before || !change.after) {
			throw new Error("Bay flow edit patch may update existing organization records only.");
		}
		if (
			change.before.id !== change.id ||
			change.after.id !== change.id ||
			changedOrganizationIds.has(change.id)
		) {
			throw new Error("Bay flow edit organization identity is not canonical.");
		}
		changedOrganizationIds.add(change.id);
		const beforeProperties = staticFabOrganizationProperties(change.before);
		const afterProperties = staticFabOrganizationProperties(change.after);
		if (
			change.before.kind !== change.after.kind ||
			change.before.name !== change.after.name ||
			!sameNumberArray(
				staticFabOrganizationParentIds(change.before),
				staticFabOrganizationParentIds(change.after),
			) ||
			beforeProperties.description !== afterProperties.description ||
			beforeProperties.color !== afterProperties.color ||
			!sameNumberArray(
				change.before.membership.advancedSwitchIds,
				change.after.membership.advancedSwitchIds,
			) ||
			!sameNumberArray(
				change.before.membership.equipmentGroupIds,
				change.after.membership.equipmentGroupIds,
			)
		) {
			throw new Error(
				"Bay flow edit patch must preserve organization identity, hierarchy, metadata, and sidecar membership.",
			);
		}
		if (
			sameDirectedEdgeArray(change.before.membership.railEdges, change.after.membership.railEdges)
		) {
			throw new Error("Bay flow edit organization changes must change rail membership.");
		}
	}

	const roles = deriveStaticFabOrganizationSemanticRoles(organizations);
	const baySubtrees: ReadonlySet<number>[] = [];
	for (const record of organizations.records) {
		if (roles.get(record.id) !== "BAY") continue;
		const descendants = resolveStaticFabOrganizationDescendantIds(organizations, record.id);
		if (!descendants) continue;
		const subtree = new Set([record.id, ...descendants]);
		if ([...changedOrganizationIds].every((id) => subtree.has(id))) baySubtrees.push(subtree);
	}
	if (baySubtrees.length !== 1) {
		throw new Error(
			"Bay flow edit organization changes must belong to one unambiguous semantic Bay subtree.",
		);
	}
	const selectedSubtree = baySubtrees[0] as ReadonlySet<number>;
	for (const organizationId of patch.organizationImpactAuthorizations ?? []) {
		if (!selectedSubtree.has(organizationId) || !changedOrganizationIds.has(organizationId)) {
			throw new Error(
				`Bay flow edit organization relocation authorization ${organizationId} is outside its changed Bay subtree.`,
			);
		}
	}
	const sourceRecordsById = new Map(organizations.records.map((record) => [record.id, record]));
	const targetRecordsById = new Map(sourceRecordsById);
	for (const change of patch.organizationChanges) {
		if (!sourceRecordsById.has(change.id) || !selectedSubtree.has(change.id) || !change.after) {
			throw new Error("Bay flow edit patch cannot change an organization outside its Bay subtree.");
		}
		targetRecordsById.set(change.id, change.after);
	}

	const sourceSubtreeEdges = organizationRailEdgeUnion(sourceRecordsById, selectedSubtree);
	const targetSubtreeEdges = organizationRailEdgeUnion(targetRecordsById, selectedSubtree);
	const externalEdges = new Set<string>();
	for (const record of organizations.records) {
		if (selectedSubtree.has(record.id)) continue;
		for (const edge of record.membership.railEdges) {
			externalEdges.add(staticFabOrganizationEdgeKey(edge));
		}
	}
	const railDelta = directedRailDeltaForCellChanges(patch.changes);
	if (railDelta.removed.size === 0 || railDelta.added.size === 0) {
		throw new Error("Bay flow edit patch must replace both removed and added directed rail edges.");
	}
	for (const key of railDelta.removed) {
		if (!sourceSubtreeEdges.has(key) || externalEdges.has(key)) {
			throw new Error(`Bay flow edit patch changes external directed edge ${key}.`);
		}
	}
	for (const key of railDelta.added) {
		if (!targetSubtreeEdges.has(key) || externalEdges.has(key)) {
			throw new Error(`Bay flow edit patch changes external directed edge ${key}.`);
		}
	}

	const membershipRemoved = stringSetDifference(sourceSubtreeEdges, targetSubtreeEdges);
	const membershipAdded = stringSetDifference(targetSubtreeEdges, sourceSubtreeEdges);
	if (
		!sameStringSet(railDelta.removed, membershipRemoved) ||
		!sameStringSet(railDelta.added, membershipAdded)
	) {
		throw new Error(
			"Bay flow edit directed-edge delta must exactly match its Bay subtree membership-union delta.",
		);
	}
}

function directedRailDeltaForCellChanges(
	changes: RailPatchEvent["changes"],
): Readonly<{ removed: ReadonlySet<string>; added: ReadonlySet<string> }> {
	const outgoingRemoved = new Set<string>();
	const outgoingAdded = new Set<string>();
	const incomingRemoved = new Set<string>();
	const incomingAdded = new Set<string>();
	for (const change of changes) {
		const before = decodeRailCell(change.before);
		const after = decodeRailCell(change.after);
		for (const direction of ALL_DIRECTIONS) {
			const neighbor = moveCell(change, direction);
			const outgoingKey = staticFabOrganizationEdgeKey({ from: change, to: neighbor });
			collectChangedBit(
				(before.outgoing & direction) !== 0,
				(after.outgoing & direction) !== 0,
				outgoingKey,
				outgoingRemoved,
				outgoingAdded,
			);
			const incomingKey = staticFabOrganizationEdgeKey({ from: neighbor, to: change });
			collectChangedBit(
				(before.incoming & direction) !== 0,
				(after.incoming & direction) !== 0,
				incomingKey,
				incomingRemoved,
				incomingAdded,
			);
		}
	}
	if (
		!sameStringSet(outgoingRemoved, incomingRemoved) ||
		!sameStringSet(outgoingAdded, incomingAdded)
	) {
		throw new Error("Bay flow edit patch directed-edge changes must be exactly reciprocal.");
	}
	return Object.freeze({ removed: outgoingRemoved, added: outgoingAdded });
}

function collectChangedBit(
	before: boolean,
	after: boolean,
	key: string,
	removed: Set<string>,
	added: Set<string>,
): void {
	if (before === after) return;
	if (before) removed.add(key);
	else added.add(key);
}

function organizationRailEdgeUnion(
	recordsById: ReadonlyMap<number, StaticFabOrganizationState["records"][number]>,
	organizationIds: ReadonlySet<number>,
): ReadonlySet<string> {
	const result = new Set<string>();
	for (const id of organizationIds) {
		const record = recordsById.get(id);
		if (!record) {
			throw new Error(`Bay flow edit subtree organization ${id} is missing.`);
		}
		for (const edge of record.membership.railEdges) {
			result.add(staticFabOrganizationEdgeKey(edge));
		}
	}
	return result;
}

function sameDirectedEdgeArray(
	left: StaticFabOrganizationState["records"][number]["membership"]["railEdges"],
	right: StaticFabOrganizationState["records"][number]["membership"]["railEdges"],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(edge, index) =>
				staticFabOrganizationEdgeKey(edge) ===
				staticFabOrganizationEdgeKey(right[index] as (typeof right)[number]),
		)
	);
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function stringSetDifference(
	left: ReadonlySet<string>,
	right: ReadonlySet<string>,
): ReadonlySet<string> {
	return new Set([...left].filter((key) => !right.has(key)));
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
	return left.size === right.size && [...left].every((key) => right.has(key));
}

function validateStaticFabSemanticBayMutationPatch(patch: RailPatchEvent): void {
	if (
		patch.kind !== STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND &&
		patch.kind !== STATIC_FAB_SEMANTIC_BAY_DELETE_KIND
	) {
		return;
	}
	if (patch.changes.length === 0 || patch.organizationChanges.length === 0) {
		throw new Error("Semantic Bay patch must change both authored rail and organizations.");
	}
	if (patch.organizationNextIdBefore !== patch.organizationNextIdAfter) {
		throw new Error("Semantic Bay patch cannot change the organization ID cursor.");
	}
	if (
		patch.changes.some(
			(change) => change.before === change.after || (change.after & change.before) !== change.after,
		)
	) {
		throw new Error("Semantic Bay patch may only remove authored rail bits.");
	}
	if (
		patch.switchChanges.some((change) => change.before === null || change.after !== null) ||
		patch.portChanges.some((change) => change.before === null || change.after !== null) ||
		patch.equipmentGroupChanges.some((change) => change.before === null || change.after !== null) ||
		patch.organizationChanges.some((change) => change.before === null)
	) {
		throw new Error("Semantic Bay patch cannot create authored records.");
	}
	const deletedOrganizationIds = new Set(
		patch.organizationChanges
			.filter((change) => change.before !== null && change.after === null)
			.map((change) => change.id),
	);
	for (const organizationId of patch.organizationImpactAuthorizations ?? []) {
		if (deletedOrganizationIds.has(organizationId)) {
			throw new Error(`Deleted organization ${organizationId} cannot carry relocation authority.`);
		}
	}
	if (patch.kind === STATIC_FAB_SEMANTIC_BAY_DISCONNECT_KIND) {
		if (
			deletedOrganizationIds.size !== 0 ||
			patch.switchChanges.length !== 0 ||
			patch.portChanges.length !== 0 ||
			patch.equipmentGroupChanges.length !== 0
		) {
			throw new Error(
				"Bay disconnect must preserve Bay organizations, switches, ports, and equipment groups.",
			);
		}
		return;
	}
	if (deletedOrganizationIds.size === 0) {
		throw new Error("Bay delete must remove its semantic Bay organization subtree.");
	}
}

function assertPortAttachments(
	layout: CompiledPhysicalLayout,
	portEquipment: PortEquipmentState,
): void {
	for (const port of portEquipment.ports) {
		const resolution = resolvePortAttachment(layout, port);
		if (!resolution.ok) {
			throw new Error(
				`Port ${port.id} attachment is invalid (${resolution.code}): ${resolution.message}`,
			);
		}
	}
}

function validateSwitchMutation(change: AdvancedSwitchMutation): void {
	assertAdvancedSwitchId(change.id, "Rail patch advanced switch id");
	if (!change.before && !change.after) {
		throw new Error(`Rail patch advanced switch ${change.id} has no before or after record.`);
	}
	for (const [label, record] of [
		["before", change.before],
		["after", change.after],
	] as const) {
		if (!record) continue;
		if (record.id !== change.id) {
			throw new Error(
				`Rail patch advanced switch ${change.id} ${label} record id is ${record.id}.`,
			);
		}
		assertInt32Coordinate(record.origin.x, "advanced switch origin x");
		assertInt32Coordinate(record.origin.y, "advanced switch origin y");
		const error = advancedSwitchRecordError(record);
		if (error) throw new Error(`Rail patch advanced switch ${change.id} ${label}: ${error}.`);
	}
	if (advancedSwitchEquals(change.before, change.after)) {
		throw new Error(`Rail patch advanced switch ${change.id} is a no-op.`);
	}
}

function assertAdvancedSwitchTopology(map: TileMap): void {
	const records: AdvancedSwitchRecord[] = [];
	map.forEachAdvancedSwitch((record) => records.push(record));
	for (const record of records) {
		const issue = validateAdvancedSwitchTopology((x, y) => map.getEncoded(x, y), record)[0];
		if (issue) {
			throw new Error(
				`Advanced switch ${record.id} topology is invalid (${issue.code}): ${issue.message}.`,
			);
		}
	}
}

function assertAdvancedSwitchId(value: number, label: string): void {
	if (!Number.isInteger(value) || value <= 0 || value > ADVANCED_SWITCH_MAX_ID) {
		throw new Error(`${label} ${value} is not a positive signed int32.`);
	}
}

function assertNonNegativeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be non-negative.`);
}

function assertByte(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0 || value > 0xff) {
		throw new Error(`Rail patch ${label} value ${value} is not a byte.`);
	}
}
