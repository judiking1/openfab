import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type {
	StaticFabOrganizationBundle,
	StaticFabOrganizationBundleQuarterTurns,
} from "../core/StaticFabOrganizationBundle";
import {
	adoptStaticFabOrganizationBundlePlacementWorkerPlanCooperatively,
	issueStaticFabOrganizationBundlePlacementPermit,
	revokeStaticFabOrganizationBundlePlacementPermit,
	type StaticFabOrganizationBundlePlacementPermit,
	type StaticFabOrganizationBundlePlacementPlan,
	staticFabOrganizationBundleFingerprint,
} from "../core/StaticFabOrganizationBundlePlacement";
import type { Cell, TileMap } from "../core/TileMap";
import {
	checksumRailPatchResultCooperatively,
	consumeRailMirrorSnapshotCaptureAuthority,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import {
	type PreparedStaticFabOrganizationBundlePlacement,
	STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
	type StaticFabOrganizationBundlePlacementWorkerRequest,
	type StaticFabOrganizationBundlePlacementWorkerResponse,
} from "../worker/StaticFabOrganizationBundlePlacementProtocol";
import { STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT } from "../worker/StaticFabOrganizationBundlePlacementResponseValidator";
import { decodeStaticFabOrganizationBundlePlacementTransport } from "../worker/StaticFabOrganizationBundlePlacementTransport";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";

export { captureOrganizationBundlePlacementSnapshot } from "./OrganizationBundlePlacementSnapshot";

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
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
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

export interface StaticFabOrganizationBundlePlacementAdmissionScheduler {
	now(): number;
	yield(): Promise<void>;
}

interface PlacementRequestLifetime {
	readonly permit: StaticFabOrganizationBundlePlacementPermit;
	readonly reject: (error: Error) => void;
	worker: StaticFabOrganizationBundlePlacementWorkerPort | null;
	timeout: ReturnType<typeof setTimeout> | null;
	responseStarted: boolean;
}

/** One request owns transport, cancellation and timeout until exact adoption has finished. */
export class StaticFabOrganizationBundlePlacementBridge {
	private active: PlacementRequestLifetime | null = null;
	private nextRequestId = 1;
	private readonly createWorker: () => StaticFabOrganizationBundlePlacementWorkerPort;
	private readonly timeoutMilliseconds: number;
	private readonly admissionScheduler: StaticFabOrganizationBundlePlacementAdmissionScheduler;

	constructor(
		createWorker: () => StaticFabOrganizationBundlePlacementWorkerPort = () =>
			new Worker(
				new URL("../worker/staticFabOrganizationBundlePlacementWorker.ts", import.meta.url),
				{ type: "module" },
			) as StaticFabOrganizationBundlePlacementWorkerPort,
		timeoutMilliseconds = 30_000,
		admissionScheduler: StaticFabOrganizationBundlePlacementAdmissionScheduler = {
			now: () => performance.now(),
			yield: yieldPlacementAdmission,
		},
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
		this.admissionScheduler = admissionScheduler;
	}

	prepare(
		input: StaticFabOrganizationBundlePlacementInput,
	): Promise<ValidatedStaticFabOrganizationBundlePlacement> {
		this.cancel();
		const source = input.getCurrentState();
		const sourceMapGeneration = source.map.getMutationGeneration();
		const snapshot = input.snapshot;
		if (
			source.map.getRevision() !== snapshot.revision ||
			source.patchSequence !== snapshot.sequence ||
			source.map.getAdvancedSwitchIdCursor() !== snapshot.nextAdvancedSwitchId ||
			source.portEquipment.nextPortId !== snapshot.portEquipment.nextPortId ||
			source.portEquipment.nextEquipmentGroupId !== snapshot.portEquipment.nextEquipmentGroupId ||
			source.organizations.nextOrganizationId !== snapshot.organizations.nextOrganizationId ||
			source.relationships.nextRelationshipId !== snapshot.relationships.nextRelationshipId
		) {
			return Promise.reject(
				new Error("Organization-bundle placement snapshot is stale before Worker planning."),
			);
		}
		if (
			!consumeRailMirrorSnapshotCaptureAuthority(
				snapshot,
				source.map,
				source.patchSequence,
				source.portEquipment,
				source.organizations,
				source.relationships,
			)
		) {
			return Promise.reject(
				new Error(
					"Organization-bundle placement snapshot was not captured from the current authored generations.",
				),
			);
		}
		const anchor = Object.freeze({ x: input.anchor.x, y: input.anchor.y });
		const quarterTurns = input.quarterTurns;
		const expectedBundleFingerprint = staticFabOrganizationBundleFingerprint(input.bundle);
		const permit = issueStaticFabOrganizationBundlePlacementPermit(
			source.map,
			source.portEquipment,
			source.patchSequence,
			source.organizations,
			source.relationships,
			input.bundle,
			anchor,
			quarterTurns,
			snapshot.checksum,
		);
		const requestId = this.nextRequestId++;
		const startedAt = performance.now();
		const request: StaticFabOrganizationBundlePlacementWorkerRequest = {
			version: STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION,
			type: "PREPARE_STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT",
			requestId,
			ticketId: permit.ticketId,
			snapshot,
			bundle: input.bundle,
			expectedBundleFingerprint,
			anchor,
			quarterTurns,
		};
		return new Promise((resolve, reject) => {
			let worker: StaticFabOrganizationBundlePlacementWorkerPort;
			try {
				worker = this.createWorker();
			} catch (error) {
				revokeStaticFabOrganizationBundlePlacementPermit(permit);
				reject(workerError(error, "Organization-bundle placement Worker creation failed."));
				return;
			}
			const lifetime: PlacementRequestLifetime = {
				worker,
				permit,
				reject,
				timeout: null,
				responseStarted: false,
			};
			this.active = lifetime;
			const assertCurrent = (): void => {
				if (this.active !== lifetime) throw cancelled();
				const live = input.getCurrentState();
				if (
					live.map !== source.map ||
					live.portEquipment !== source.portEquipment ||
					live.organizations !== source.organizations ||
					live.relationships !== source.relationships ||
					live.map.getRevision() !== snapshot.revision ||
					live.map.getMutationGeneration() !== sourceMapGeneration ||
					live.patchSequence !== snapshot.sequence ||
					live.map.getAdvancedSwitchIdCursor() !== snapshot.nextAdvancedSwitchId ||
					live.portEquipment.nextPortId !== snapshot.portEquipment.nextPortId ||
					live.portEquipment.nextEquipmentGroupId !== snapshot.portEquipment.nextEquipmentGroupId ||
					live.organizations.nextOrganizationId !== snapshot.organizations.nextOrganizationId ||
					live.relationships.nextRelationshipId !== snapshot.relationships.nextRelationshipId
				) {
					throw new Error("Organization-bundle placement source changed during admission.");
				}
			};
			let sliceStart = this.admissionScheduler.now();
			const checkpoint = async (): Promise<void> => {
				assertCurrent();
				if (this.admissionScheduler.now() - sliceStart >= 4) {
					await this.admissionScheduler.yield();
					assertCurrent();
					sliceStart = this.admissionScheduler.now();
				}
			};
			const receive = async (response: Record<string, unknown>): Promise<void> => {
				if (response.version !== STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PROTOCOL_VERSION)
					throw new Error("Unsupported organization-bundle placement response version.");
				if (response.type === "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_ERROR") {
					throw new Error(
						typeof response.message === "string" &&
							response.message.length <= STATIC_FAB_ORGANIZATION_BUNDLE_MAX_RESPONSE_TEXT
							? response.message
							: "Organization-bundle placement Worker returned a malformed error.",
					);
				}
				if (response.type !== "STATIC_FAB_ORGANIZATION_BUNDLE_PLACEMENT_PREPARED")
					throw new Error("Organization-bundle placement Worker returned a malformed response.");
				const workerRoundTripMilliseconds = performance.now() - startedAt;
				const validationStartedAt = performance.now();
				let accepted: PreparedStaticFabOrganizationBundlePlacement;
				try {
					accepted = await decodeStaticFabOrganizationBundlePlacementTransport(
						response.payload,
						checkpoint,
					);
				} catch (error) {
					assertCurrent();
					throw new Error(
						`Organization-bundle placement Worker returned malformed planning data: ${workerError(error, "Invalid response").message}`,
					);
				}
				const prospectiveChecksum = await validateWorkerBinding(
					accepted,
					permit.ticketId,
					snapshot,
					expectedBundleFingerprint,
					anchor,
					quarterTurns,
					checkpoint,
				);
				assertCurrent();
				const responseValidationMilliseconds = performance.now() - validationStartedAt;
				const adoptionStartedAt = performance.now();
				let adoptedPlan: StaticFabOrganizationBundlePlacementPlan | null = null;
				if (accepted.valid && accepted.plan && accepted.ticket && prospectiveChecksum !== null) {
					adoptedPlan = await adoptStaticFabOrganizationBundlePlacementWorkerPlanCooperatively(
						permit,
						accepted.plan,
						accepted.ticket,
						prospectiveChecksum,
						source.map,
						source.portEquipment,
						source.organizations,
						source.relationships,
						checkpoint,
					);
				}
				assertCurrent();
				const adoptionMilliseconds = performance.now() - adoptionStartedAt;
				this.finish(lifetime);
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
			worker.onmessage = (event) => {
				if (this.active !== lifetime || lifetime.responseStarted) return;
				const response: unknown = event.data;
				if (!isRecord(response) || response.requestId !== requestId) return;
				lifetime.responseStarted = true;
				this.releaseTransport(lifetime);
				void receive(response).catch((error) =>
					this.fail(
						lifetime,
						workerError(error, "Organization-bundle placement admission failed."),
					),
				);
			};
			worker.onerror = (event) => this.fail(lifetime, new Error(event.message));
			worker.onmessageerror = () =>
				this.fail(
					lifetime,
					new Error("Organization-bundle placement Worker returned an unreadable response."),
				);
			lifetime.timeout = setTimeout(
				() =>
					this.fail(
						lifetime,
						new Error(
							`Organization-bundle placement Worker or admission timed out after ${this.timeoutMilliseconds} ms.`,
						),
					),
				this.timeoutMilliseconds,
			);
			try {
				worker.postMessage(request, collectTransferableBuffers(snapshot));
			} catch (error) {
				this.fail(lifetime, workerError(error, "Organization-bundle placement post failed."));
			}
		});
	}

	cancel(): void {
		if (this.active) this.fail(this.active, cancelled());
	}
	dispose(): void {
		this.cancel();
	}

	private fail(lifetime: PlacementRequestLifetime, error: Error): void {
		if (this.active !== lifetime) return;
		this.finish(lifetime);
		lifetime.reject(error);
	}
	private finish(lifetime: PlacementRequestLifetime): void {
		if (this.active !== lifetime) return;
		this.active = null;
		if (lifetime.timeout !== null) {
			clearTimeout(lifetime.timeout);
			lifetime.timeout = null;
		}
		this.releaseTransport(lifetime);
		revokeStaticFabOrganizationBundlePlacementPermit(lifetime.permit);
	}
	private releaseTransport(lifetime: PlacementRequestLifetime): void {
		const worker = lifetime.worker;
		if (!worker) return;
		lifetime.worker = null;
		worker.onmessage = null;
		worker.onerror = null;
		worker.onmessageerror = null;
		worker.terminate();
	}
}

/** Called only after owned transport decoding has completed the shared structural contract. */
async function validateWorkerBinding(
	value: PreparedStaticFabOrganizationBundlePlacement,
	expectedTicketId: number,
	snapshot: RailMirrorSnapshot,
	expectedBundleFingerprint: string,
	expectedAnchor: Cell,
	expectedQuarterTurns: StaticFabOrganizationBundleQuarterTurns,
	checkpoint: () => Promise<void>,
): Promise<string | null> {
	if (!value.valid) return null;
	const ticket = value.ticket;
	const plan = value.plan;
	if (
		!ticket ||
		!plan ||
		ticket.ticketId !== expectedTicketId ||
		ticket.validationLevel !== "exact" ||
		ticket.sourceRevision !== snapshot.revision ||
		ticket.sourcePatchSequence !== snapshot.sequence ||
		ticket.sourceChecksum !== snapshot.checksum ||
		ticket.sourceNextAdvancedSwitchId !== snapshot.nextAdvancedSwitchId ||
		ticket.sourceNextPortId !== snapshot.portEquipment.nextPortId ||
		ticket.sourceNextEquipmentGroupId !== snapshot.portEquipment.nextEquipmentGroupId ||
		ticket.sourceNextOrganizationId !== snapshot.organizations.nextOrganizationId ||
		ticket.sourceNextRelationshipId !== snapshot.relationships.nextRelationshipId ||
		ticket.bundleFingerprint !== expectedBundleFingerprint ||
		ticket.anchor.x !== expectedAnchor.x ||
		ticket.anchor.y !== expectedAnchor.y ||
		ticket.quarterTurns !== expectedQuarterTurns
	) {
		throw new Error("Organization-bundle placement Worker returned a corrupted one-shot ticket.");
	}
	const expected = await checksumRailPatchResultCooperatively(
		snapshot.checksum,
		{
			changes: plan.mutations,
			switchChanges: plan.switchMutations,
			portChanges: plan.portMutations,
			equipmentGroupChanges: plan.equipmentGroupMutations,
			organizationChanges: plan.organizationMutations,
			organizationNextIdBefore: plan.nextOrganizationIdBefore,
			organizationNextIdAfter: plan.nextOrganizationIdAfter,
			relationshipChanges: plan.relationshipMutations,
			relationshipNextIdBefore: plan.nextRelationshipIdBefore,
			relationshipNextIdAfter: plan.nextRelationshipIdAfter,
		},
		checkpoint,
		64,
	);
	if (ticket.prospectiveChecksum !== expected)
		throw new Error(
			"Organization-bundle placement Worker returned a divergent prospective checksum.",
		);
	return expected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function workerError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
function cancelled(): DOMException {
	return new DOMException("Organization-bundle placement planning cancelled.", "AbortError");
}
async function yieldPlacementAdmission(): Promise<void> {
	const scheduler = (globalThis as typeof globalThis & { scheduler?: { yield(): Promise<void> } })
		.scheduler;
	if (scheduler?.yield) await scheduler.yield();
	else await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
