import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS,
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES,
	type StaticFabOrganizationBundle,
	type StaticFabOrganizationBundleQuarterTurns,
} from "../core/StaticFabOrganizationBundle";
import {
	adoptStaticFabOrganizationBundlePlacementWorkerPlan,
	issueStaticFabOrganizationBundlePlacementPermit,
	revokeStaticFabOrganizationBundlePlacementPermit,
	type StaticFabOrganizationBundlePlacementPermit,
	type StaticFabOrganizationBundlePlacementPlan,
	staticFabOrganizationBundleFingerprint,
} from "../core/StaticFabOrganizationBundlePlacement";
import type { Cell, TileMap } from "../core/TileMap";
import {
	checksumRailPatchResult,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import type {
	PreparedStaticFabOrganizationBundlePlacement,
	StaticFabOrganizationBundlePlacementWorkerRequest,
	StaticFabOrganizationBundlePlacementWorkerResponse,
} from "../worker/StaticFabOrganizationBundlePlacementProtocol";
import { STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT } from "../worker/StaticFabOrganizationBundlePlacementProtocol";
import {
	STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS,
	staticFabOrganizationBundlePlacementPreparedShapeError,
} from "../worker/StaticFabOrganizationBundlePlacementResponseValidator";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export interface StaticFabOrganizationBundlePlacementWorkerPort {
	onmessage:
		| ((event: MessageEvent<StaticFabOrganizationBundlePlacementWorkerResponse>) => void)
		| null;
	onerror: ((event: ErrorEvent) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	postMessage(
		message: StaticFabOrganizationBundlePlacementWorkerRequest,
		transfer?: Transferable[],
	): void;
	terminate(): void;
}

export interface StaticFabOrganizationBundlePlacementInput {
	readonly bundle: StaticFabOrganizationBundle;
	readonly anchor: Cell;
	readonly quarterTurns: StaticFabOrganizationBundleQuarterTurns;
	readonly snapshot: RailMirrorSnapshot;
	/** Resolve again after Worker planning because RailDocument replaces state objects on commit. */
	readonly getCurrentState: () => StaticFabOrganizationBundlePlacementLiveState;
}

export interface StaticFabOrganizationBundlePlacementLiveState {
	readonly map: TileMap;
	readonly patchSequence: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
}

export interface ValidatedStaticFabOrganizationBundlePlacement {
	readonly plan: StaticFabOrganizationBundlePlacementPlan | null;
	readonly validation: PreparedStaticFabOrganizationBundlePlacement;
	/** True only when the exact Worker plan consumed its opaque main-thread permit. */
	readonly certified: boolean;
	readonly workerRoundTripMilliseconds: number;
	readonly responseValidationMilliseconds: number;
	readonly adoptionMilliseconds: number;
}

/** Latest-request-wins adapter for Worker planning plus one-shot main-document adoption. */
export class StaticFabOrganizationBundlePlacementBridge {
	private readonly createWorker: () => StaticFabOrganizationBundlePlacementWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: StaticFabOrganizationBundlePlacementWorkerPort | null = null;
	private permit: StaticFabOrganizationBundlePlacementPermit | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => StaticFabOrganizationBundlePlacementWorkerPort = () =>
			new Worker(
				new URL("../worker/staticFabOrganizationBundlePlacementWorker.ts", import.meta.url),
				{ type: "module" },
			) as StaticFabOrganizationBundlePlacementWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(
		input: StaticFabOrganizationBundlePlacementInput,
	): Promise<ValidatedStaticFabOrganizationBundlePlacement> {
		this.cancel();
		const sourceState = input.getCurrentState();
		if (
			sourceState.map.getRevision() !== input.snapshot.revision ||
			sourceState.patchSequence !== input.snapshot.sequence ||
			sourceState.map.getAdvancedSwitchIdCursor() !== input.snapshot.nextAdvancedSwitchId ||
			sourceState.portEquipment.nextPortId !== input.snapshot.portEquipment.nextPortId ||
			sourceState.portEquipment.nextEquipmentGroupId !==
				input.snapshot.portEquipment.nextEquipmentGroupId ||
			sourceState.organizations.nextOrganizationId !==
				input.snapshot.organizations.nextOrganizationId
		) {
			return Promise.reject(
				new Error("Organization-bundle placement snapshot is stale before Worker planning."),
			);
		}
		if (
			!consumeRailMirrorSnapshotCaptureAuthority(
				input.snapshot,
				sourceState.map,
				sourceState.patchSequence,
				sourceState.portEquipment,
				sourceState.organizations,
			)
		) {
			return Promise.reject(
				new Error(
					"Organization-bundle placement snapshot was not captured from the current authored generations.",
				),
			);
		}
		const expectedBundleFingerprint = staticFabOrganizationBundleFingerprint(input.bundle);
		const permit = issueStaticFabOrganizationBundlePlacementPermit(
			sourceState.map,
			sourceState.portEquipment,
			sourceState.patchSequence,
			sourceState.organizations,
			input.bundle,
			input.anchor,
			input.quarterTurns,
			input.snapshot.checksum,
		);
		this.permit = permit;
		const requestId = this.nextRequestId++;
		const requestStartedAt = performance.now();
		const request: StaticFabOrganizationBundlePlacementWorkerRequest = {
			type: "PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT",
			requestId,
			ticketId: permit.ticketId,
			snapshot: input.snapshot,
			bundle: input.bundle,
			expectedBundleFingerprint,
			anchor: Object.freeze({ x: input.anchor.x, y: input.anchor.y }),
			quarterTurns: input.quarterTurns,
		};

		return new Promise((resolve, reject) => {
			let worker: StaticFabOrganizationBundlePlacementWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				this.revokePermit(permit);
				reject(workerError(error, "Organization-bundle placement Worker creation failed."));
				return;
			}
			this.worker = worker;
			this.reject = reject;

			worker.onmessage = (event) => {
				const response = event.data as unknown;
				if (!isRecord(response) || response.requestId !== requestId) return;
				this.releaseWorker();
				this.reject = null;

				if (response.type === "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_ERROR") {
					this.revokePermit(permit);
					reject(
						new Error(
							typeof response.message === "string"
								? response.message
								: "Organization-bundle placement Worker returned a malformed error.",
						),
					);
					return;
				}
				if (response.type !== "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED") {
					this.revokePermit(permit);
					reject(new Error("Organization-bundle placement Worker returned a malformed response."));
					return;
				}

				const workerRoundTripMilliseconds = performance.now() - requestStartedAt;
				const responseValidationStartedAt = performance.now();
				const preparedValidation = validateWorkerPrepared(
					response.prepared,
					permit.ticketId,
					input.snapshot,
					sourceState.organizations.nextOrganizationId,
					expectedBundleFingerprint,
					input.anchor,
					input.quarterTurns,
				);
				if (preparedValidation instanceof Error) {
					this.revokePermit(permit);
					reject(preparedValidation);
					return;
				}
				const responseValidationMilliseconds = performance.now() - responseValidationStartedAt;
				const accepted = response.prepared as PreparedStaticFabOrganizationBundlePlacement;
				const liveState = input.getCurrentState();
				const liveStateUnchanged =
					liveState.map === sourceState.map &&
					liveState.portEquipment === sourceState.portEquipment &&
					liveState.organizations === sourceState.organizations &&
					liveState.map.getRevision() === input.snapshot.revision &&
					liveState.patchSequence === input.snapshot.sequence;
				let adoptedPlan: StaticFabOrganizationBundlePlacementPlan | null = null;
				const adoptionStartedAt = performance.now();
				if (
					accepted.valid &&
					accepted.plan &&
					accepted.ticket &&
					preparedValidation.prospectiveChecksum !== null &&
					liveStateUnchanged
				) {
					adoptedPlan = adoptStaticFabOrganizationBundlePlacementWorkerPlan(
						permit,
						accepted.plan,
						accepted.ticket,
						preparedValidation.prospectiveChecksum,
						liveState.map,
						liveState.portEquipment,
						liveState.organizations,
					);
					this.permit = null;
				} else {
					this.revokePermit(permit);
				}
				const adoptionMilliseconds = performance.now() - adoptionStartedAt;
				resolve(
					Object.freeze({
						plan: adoptedPlan ?? accepted.plan,
						validation: accepted,
						certified: adoptedPlan !== null,
						workerRoundTripMilliseconds,
						responseValidationMilliseconds,
						adoptionMilliseconds,
					}),
				);
			};

			worker.onerror = (event) => {
				this.releaseWorker();
				this.reject = null;
				this.revokePermit(permit);
				reject(new Error(event.message));
			};
			worker.onmessageerror = () => {
				this.releaseWorker();
				this.reject = null;
				this.revokePermit(permit);
				reject(new Error("Organization-bundle placement Worker returned an unreadable response."));
			};
			this.timeout = setTimeout(() => {
				const rejectTimeout = this.reject;
				this.reject = null;
				this.releaseWorker();
				this.revokePermit(permit);
				rejectTimeout?.(
					new Error(
						`Organization-bundle placement Worker timed out after ${this.timeoutMilliseconds} ms.`,
					),
				);
			}, this.timeoutMilliseconds);

			try {
				worker.postMessage(request, collectTransferableBuffers(input.snapshot));
			} catch (error) {
				this.releaseWorker();
				this.reject = null;
				this.revokePermit(permit);
				reject(workerError(error, "Organization-bundle placement post failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		if (this.permit) this.revokePermit(this.permit);
		reject?.(new DOMException("Organization-bundle placement planning cancelled.", "AbortError"));
	}

	dispose(): void {
		this.cancel();
	}

	private revokePermit(permit: StaticFabOrganizationBundlePlacementPermit): void {
		revokeStaticFabOrganizationBundlePlacementPermit(permit);
		if (this.permit === permit) this.permit = null;
	}

	private releaseWorker(): void {
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		const worker = this.worker;
		if (!worker) return;
		this.worker = null;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}
}

function validateWorkerPrepared(
	value: unknown,
	expectedTicketId: number,
	snapshot: RailMirrorSnapshot,
	expectedSourceNextOrganizationId: number,
	expectedBundleFingerprint: string,
	expectedAnchor: Cell,
	expectedQuarterTurns: StaticFabOrganizationBundleQuarterTurns,
): Error | { readonly prospectiveChecksum: string | null } {
	const shapeError = staticFabOrganizationBundlePlacementPreparedShapeError(value);
	if (shapeError) {
		return new Error(
			`Organization-bundle placement Worker returned malformed planning data: ${shapeError}.`,
		);
	}
	if (
		!isRecord(value) ||
		typeof value.valid !== "boolean" ||
		!(value.failureCode === null || isFailureCode(value.failureCode)) ||
		typeof value.reason !== "string" ||
		!Array.isArray(value.conflictCells) ||
		value.conflictCells.length > STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT ||
		!value.conflictCells.every(isCell) ||
		!isNonNegativeSafeInteger(value.conflictCount) ||
		!isNonNegativeSafeInteger(value.candidateCommittedEnvelopePairs) ||
		!isNonNegativeSafeInteger(value.testedCommittedEnvelopePairs) ||
		!isNonNegativeFiniteNumber(value.planningMilliseconds) ||
		!isNonNegativeFiniteNumber(value.validationMilliseconds)
	) {
		return new Error("Organization-bundle placement Worker returned malformed planning data.");
	}
	if (value.plan !== null && !isPlacementPlanShape(value.plan, value.valid ? "full" : "compact")) {
		return new Error("Organization-bundle placement Worker returned malformed planning data.");
	}
	if (!value.valid) {
		if (value.plan?.valid) {
			return new Error("Organization-bundle placement Worker returned a valid plan as rejected.");
		}
		return value.ticket === null
			? Object.freeze({ prospectiveChecksum: null })
			: new Error("Organization-bundle placement Worker returned a ticket for a rejected plan.");
	}
	if (
		value.failureCode !== null ||
		!isPlacementPlanShape(value.plan, "full") ||
		!value.plan.valid ||
		!isRecord(value.ticket)
	) {
		return new Error("Organization-bundle placement Worker omitted its exact plan or ticket.");
	}
	const ticket = value.ticket;
	if (
		ticket.ticketId !== expectedTicketId ||
		ticket.validationLevel !== "exact" ||
		ticket.sourceRevision !== snapshot.revision ||
		ticket.sourcePatchSequence !== snapshot.sequence ||
		ticket.sourceChecksum !== snapshot.checksum ||
		ticket.sourceNextAdvancedSwitchId !== snapshot.nextAdvancedSwitchId ||
		ticket.sourceNextPortId !== snapshot.portEquipment.nextPortId ||
		ticket.sourceNextEquipmentGroupId !== snapshot.portEquipment.nextEquipmentGroupId ||
		ticket.sourceNextOrganizationId !== expectedSourceNextOrganizationId ||
		ticket.bundleFingerprint !== expectedBundleFingerprint ||
		!isCell(ticket.anchor) ||
		ticket.anchor.x !== expectedAnchor.x ||
		ticket.anchor.y !== expectedAnchor.y ||
		ticket.quarterTurns !== expectedQuarterTurns ||
		typeof ticket.planFingerprint !== "string" ||
		typeof ticket.prospectiveChecksum !== "string" ||
		!isNonNegativeSafeInteger(ticket.prospectiveNextAdvancedSwitchId) ||
		!isNonNegativeSafeInteger(ticket.prospectiveNextPortId) ||
		!isNonNegativeSafeInteger(ticket.prospectiveNextEquipmentGroupId) ||
		!isNonNegativeSafeInteger(ticket.prospectiveNextOrganizationId)
	) {
		return new Error("Organization-bundle placement Worker returned a corrupted one-shot ticket.");
	}
	let expectedProspectiveChecksum: string;
	try {
		expectedProspectiveChecksum = checksumRailPatchResult(snapshot.checksum, {
			changes: value.plan.mutations,
			switchChanges: value.plan.switchMutations,
			portChanges: value.plan.portMutations,
			equipmentGroupChanges: value.plan.equipmentGroupMutations,
			organizationChanges: value.plan.organizationMutations,
			organizationNextIdBefore: value.plan.nextOrganizationIdBefore,
			organizationNextIdAfter: value.plan.nextOrganizationIdAfter,
		});
	} catch {
		return new Error("Organization-bundle placement Worker returned a malformed exact plan.");
	}
	if (ticket.prospectiveChecksum !== expectedProspectiveChecksum) {
		return new Error(
			"Organization-bundle placement Worker returned a divergent prospective checksum.",
		);
	}
	return Object.freeze({ prospectiveChecksum: expectedProspectiveChecksum });
}

function isPlacementPlanShape(
	value: unknown,
	mode: "compact" | "full",
): value is StaticFabOrganizationBundlePlacementPlan {
	if (
		!isRecord(value) ||
		value.kind !== "build" ||
		typeof value.valid !== "boolean" ||
		typeof value.reason !== "string" ||
		!isNonNegativeSafeInteger(value.baseRevision) ||
		!isNonNegativeSafeInteger(value.basePatchSequence) ||
		!isPositiveSafeInteger(value.nextOrganizationIdBefore) ||
		!isPositiveSafeInteger(value.nextOrganizationIdAfter) ||
		!isNonNegativeSafeInteger(value.newEdges) ||
		!isNonNegativeFiniteNumber(value.lengthMeters) ||
		!isNonNegativeSafeInteger(value.turns) ||
		(value.bend !== "horizontal-first" && value.bend !== "vertical-first") ||
		!Array.isArray(value.cells) ||
		!Array.isArray(value.mutations) ||
		!Array.isArray(value.switchMutations) ||
		!Array.isArray(value.portMutations) ||
		!Array.isArray(value.equipmentGroupMutations) ||
		!Array.isArray(value.organizationMutations) ||
		!Array.isArray(value.conflicts) ||
		!isOrganizationBundleMetadata(value.organizationBundle)
	) {
		return false;
	}
	const maximumCells =
		mode === "compact"
			? STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT
			: STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS;
	if (
		value.cells.length > maximumCells ||
		value.conflicts.length > STATIC_FAB_ORGANIZATION_BUNDLE_CONFLICT_LIMIT ||
		!value.cells.every(isCell) ||
		!value.conflicts.every(isCell)
	) {
		return false;
	}
	if (mode === "compact") {
		return (
			value.mutations.length === 0 &&
			value.switchMutations.length === 0 &&
			value.portMutations.length === 0 &&
			value.equipmentGroupMutations.length === 0 &&
			value.organizationMutations.length === 0
		);
	}
	return (
		value.mutations.length <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PLAN_CELLS &&
		value.switchMutations.length <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES &&
		value.portMutations.length <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS &&
		value.equipmentGroupMutations.length <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS &&
		value.organizationMutations.length <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS
	);
}

function isOrganizationBundleMetadata(value: unknown): boolean {
	return (
		isRecord(value) &&
		value.collisionPolicy === "EMPTY_FOOTPRINT_V1" &&
		isCell(value.anchor) &&
		isQuarterTurns(value.quarterTurns) &&
		isNonNegativeSafeInteger(value.sourceModuleCount) &&
		isNonNegativeSafeInteger(value.railEdgeCount) &&
		value.railEdgeCount <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RAIL_EDGES &&
		isNonNegativeSafeInteger(value.advancedSwitchCount) &&
		value.advancedSwitchCount <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ADVANCED_SWITCHES &&
		isNonNegativeSafeInteger(value.portCount) &&
		value.portCount <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_PORTS &&
		isNonNegativeSafeInteger(value.equipmentGroupCount) &&
		value.equipmentGroupCount <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_EQUIPMENT_GROUPS &&
		isNonNegativeSafeInteger(value.organizationCount) &&
		value.organizationCount <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS &&
		isNonNegativeSafeInteger(value.widthMeters) &&
		isNonNegativeSafeInteger(value.heightMeters) &&
		Array.isArray(value.organizationNames) &&
		value.organizationNames.length <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_ORGANIZATIONS &&
		value.organizationNames.every(
			(name) => typeof name === "string" && name.length > 0 && name.length <= 120,
		)
	);
}

function isFailureCode(value: unknown): boolean {
	return (
		value === "snapshot" ||
		value === "stale" ||
		value === "fingerprint" ||
		value === "bundle" ||
		value === "plan" ||
		value === "clearance" ||
		value === "compile"
	);
}

function isCell(value: unknown): value is Cell {
	return isRecord(value) && isInt32(value.x) && isInt32(value.y);
}

function isQuarterTurns(value: unknown): value is StaticFabOrganizationBundleQuarterTurns {
	return value === 0 || value === 1 || value === 2 || value === 3;
}

function isInt32(value: unknown): value is number {
	return (
		Number.isInteger(value) && (value as number) >= -0x8000_0000 && (value as number) <= 0x7fff_ffff
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function workerError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
