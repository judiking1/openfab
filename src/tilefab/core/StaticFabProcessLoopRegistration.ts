import { createCooperativeTask } from "./CooperativeTask";
import type { PortEquipmentState } from "./EquipmentGroup";
import type { OperationalConfigurationState } from "./OperationalConfiguration";
import type { RailModuleOwnershipIndex } from "./RailModuleOwnership";
import {
	type RailPatchTransition,
	railPatchTransitionFingerprintCooperatively,
} from "./RailPatchHistory";
import type { StaticFabAssemblyRelationshipStateV1 } from "./StaticFabAssemblyRelationship";
import {
	applyStaticFabProcessLoopRegistrationMutationSteps,
	createCanonicalStaticFabOrganizationStateBuilder,
	DEFAULT_STATIC_FAB_ORGANIZATION_COLOR,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import {
	type StaticFabProcessLoopRailCandidate,
	type StaticFabProcessLoopRailCandidateSource,
	staticFabProcessLoopRailCandidateMatchesSource,
} from "./StaticFabProcessLoopRailCandidate";
import { readStaticFabProcessLoopTopologyResult } from "./StaticFabProcessLoopTopologyEvidence";
import type { TileMap } from "./TileMap";

/** Platform-neutral live document identity; a matching collection of counters is insufficient. */
export interface StaticFabProcessLoopRegistrationDocument {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly operationalConfiguration: OperationalConfigurationState;
	getPatchSequence(): number;
}

export interface StaticFabProcessLoopRegistrationRequest {
	readonly document: StaticFabProcessLoopRegistrationDocument;
	readonly source: StaticFabProcessLoopRailCandidateSource;
	readonly candidate: StaticFabProcessLoopRailCandidate;
	readonly name: string;
	readonly sourceChecksum: string;
	readonly mirrorEpoch: number;
}

/** Only the trusted validation adapter answers this exact pending request, never raw result.valid. */
export interface StaticFabProcessLoopRegistrationValidation {
	readonly request: StaticFabProcessLoopRegistrationRequest;
	readonly candidateFingerprint: string;
	readonly result: unknown;
}

export interface StaticFabProcessLoopRegistrationPorts {
	readonly checkpoint: () => Promise<void>;
	/** Includes live document, selection/name session, ready mirror checksum and epoch. */
	readonly isCurrent: () => boolean;
	/** Trusted platform adapter: verify this exact request's packed candidate and bounded facts.
	 * The verified transport fingerprint correlates that result; it is not authoring authority.
	 */
	readonly validateTopology: (
		request: StaticFabProcessLoopRegistrationRequest,
	) => Promise<StaticFabProcessLoopRegistrationValidation>;
	readonly cancelTopology: (request: StaticFabProcessLoopRegistrationRequest) => void;
	readonly checksumTransition: (
		sourceChecksum: string,
		transition: RailPatchTransition,
		checkpoint: () => Promise<void>,
	) => Promise<string>;
}

/** No plan/membership is exposed to UI. The registry, rather than these fields, owns authority. */
export interface StaticFabProcessLoopRegistrationApply {
	readonly kind: "register-static-fab-process-loop";
	readonly organizationId: number;
	readonly name: string;
}

export interface StaticFabProcessLoopRegistrationPreparation {
	readonly request: StaticFabProcessLoopRegistrationRequest;
	readonly promise: Promise<StaticFabProcessLoopRegistrationApply>;
	cancel(): void;
}

export interface OwnedStaticFabProcessLoopRegistrationPlan extends RailPatchTransition {
	readonly kind: "create-static-fab-organization";
	readonly nextOrganizations: StaticFabOrganizationState;
	readonly ownership: RailModuleOwnershipIndex;
	readonly prospectiveChecksum: string;
	readonly sourceChecksum: string;
	readonly assertCurrent: () => void;
	readonly assertSourceCurrent: () => void;
}

interface ApplyBinding {
	readonly request: StaticFabProcessLoopRegistrationRequest;
	readonly plan: OwnedStaticFabProcessLoopRegistrationPlan;
	readonly fingerprint: string;
	readonly ports: StaticFabProcessLoopRegistrationPorts;
}

const pendingApplies = new WeakMap<object, ApplyBinding>();
const consumingApplies = new WeakMap<object, ApplyBinding>();
const applyRevocations = new WeakMap<object, () => void>();

/** Capture before any await; cancellation terminally invalidates preparation and issued Apply. */
export function prepareStaticFabProcessLoopRegistrationCooperatively(
	input: StaticFabProcessLoopRegistrationRequest,
	ports: StaticFabProcessLoopRegistrationPorts,
): StaticFabProcessLoopRegistrationPreparation {
	if (
		!ports ||
		[
			ports.checkpoint,
			ports.isCurrent,
			ports.validateTopology,
			ports.cancelTopology,
			ports.checksumTransition,
		].some((port) => typeof port !== "function")
	)
		throw new TypeError(
			"Loop registration requires explicit validation, checksum and scheduling ports.",
		);
	ports = Object.freeze({ ...ports });
	if (
		typeof input.name !== "string" ||
		input.name.length < 1 ||
		input.name.length > 120 ||
		input.name !== input.name.trim() ||
		hasControlCharacter(input.name)
	)
		throw new Error("Loop 이름은 제어문자 없는 1–120자의 trim된 문자열이어야 합니다");
	if (
		!/^00000003(?::[0-9a-f]{8}){11}$/.test(input.sourceChecksum) ||
		!Number.isSafeInteger(input.mirrorEpoch) ||
		input.mirrorEpoch < 0
	)
		throw new Error("Loop registration requires a current authored checksum and mirror epoch.");
	const document = input.document;
	const source = Object.freeze({ ...input.source });
	const request = Object.freeze({
		document,
		source,
		candidate: input.candidate,
		name: input.name,
		sourceChecksum: input.sourceChecksum,
		mirrorEpoch: input.mirrorEpoch,
	});
	const map = document.map,
		equipment = document.portEquipment,
		organizations = document.organizations,
		relationships = document.relationships,
		operations = document.operationalConfiguration;
	const revision = map.getRevision(),
		generation = map.getMutationGeneration(),
		sequence = document.getPatchSequence();
	const cursors = [
		map.getAdvancedSwitchIdCursor(),
		equipment.nextPortId,
		equipment.nextEquipmentGroupId,
		organizations.nextOrganizationId,
		relationships.nextRelationshipId,
	];
	let active = true;
	let issued: StaticFabProcessLoopRegistrationApply | null = null;
	const assertSourceCurrent = (): void => {
		if (
			!active ||
			document.map !== map ||
			source.map !== map ||
			document.portEquipment !== equipment ||
			document.organizations !== organizations ||
			source.organizations !== organizations ||
			document.relationships !== relationships ||
			document.operationalConfiguration !== operations ||
			map.getRevision() !== revision ||
			map.getMutationGeneration() !== generation ||
			document.getPatchSequence() !== sequence ||
			source.patchSequence !== sequence ||
			map.getAdvancedSwitchIdCursor() !== cursors[0] ||
			equipment.nextPortId !== cursors[1] ||
			equipment.nextEquipmentGroupId !== cursors[2] ||
			organizations.nextOrganizationId !== cursors[3] ||
			relationships.nextRelationshipId !== cursors[4]
		) {
			active = false;
			throw new Error("Loop registration source or request is no longer current.");
		}
	};
	const assertCurrent = (): void => {
		// Foreign guards finish before callback-free revocation and source checks.
		const externallyCurrent = ports.isCurrent();
		const candidateCurrent = staticFabProcessLoopRailCandidateMatchesSource(
			request.candidate,
			source,
		);
		if (!externallyCurrent || !candidateCurrent) active = false;
		assertSourceCurrent();
	};
	assertCurrent();
	const checkpoint = async (): Promise<void> => {
		assertCurrent();
		await ports.checkpoint();
		assertCurrent();
	};
	const promise = (async (): Promise<StaticFabProcessLoopRegistrationApply> => {
		try {
			const record = await finishSteps(createRecordSteps(request), checkpoint);
			const mutation = Object.freeze({ id: record.id, before: null, after: record });
			const nextOrganizations = await finishSteps(
				applyStaticFabProcessLoopRegistrationMutationSteps(
					organizations,
					mutation,
					record.id + 1,
					"register",
				),
				checkpoint,
			);
			assertCurrent();
			const validation = await ports.validateTopology(request);
			assertCurrent();
			if (
				validation.request !== request ||
				!/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(validation.candidateFingerprint)
			)
				throw new Error(
					"Loop topology validation does not belong to this pending registration request.",
				);
			const result = readStaticFabProcessLoopTopologyResult(
				validation.result,
				request.candidate.topologyMembership.railEdges.length,
				request.candidate.topologyMembership.advancedSwitchIds.length,
			);
			if (!result.valid)
				throw new Error("선택한 Loop의 방향 순환·물리 형상·간격 검사를 완료하지 못했습니다");
			const transition = Object.freeze({
				changes: Object.freeze([]),
				switchChanges: Object.freeze([]),
				portChanges: Object.freeze([]),
				equipmentGroupChanges: Object.freeze([]),
				relationshipChanges: Object.freeze([]),
				organizationChanges: Object.freeze([mutation]),
				organizationNextIdBefore: organizations.nextOrganizationId,
				organizationNextIdAfter: record.id + 1,
				relationshipNextIdBefore: relationships.nextRelationshipId,
				relationshipNextIdAfter: relationships.nextRelationshipId,
				organizationImpactAuthorizations: Object.freeze([]),
				operationalConfigurationPatch: null,
			}) satisfies RailPatchTransition;
			const prospectiveChecksum = await ports.checksumTransition(
				request.sourceChecksum,
				transition,
				checkpoint,
			);
			assertCurrent();
			assertRegistrationChecksumHeader(request.sourceChecksum, prospectiveChecksum);
			const fingerprint = await railPatchTransitionFingerprintCooperatively(transition, checkpoint);
			assertCurrent();
			const plan = Object.freeze({
				...transition,
				kind: "create-static-fab-organization" as const,
				nextOrganizations,
				ownership: source.ownership,
				prospectiveChecksum,
				sourceChecksum: request.sourceChecksum,
				assertCurrent,
				assertSourceCurrent,
			});
			issued = Object.freeze({
				kind: "register-static-fab-process-loop" as const,
				organizationId: record.id,
				name: request.name,
			});
			pendingApplies.set(issued, Object.freeze({ request, plan, fingerprint, ports }));
			applyRevocations.set(issued, () => {
				active = false;
			});
			return issued;
		} catch (error) {
			active = false;
			ports.cancelTopology(request);
			throw error;
		}
	})();
	return Object.freeze({
		request,
		promise,
		cancel(): void {
			active = false;
			if (issued) revokeStaticFabProcessLoopRegistrationApply(issued);
			ports.cancelTopology(request);
		},
	});
}

export function revokeStaticFabProcessLoopRegistrationApply(
	apply: StaticFabProcessLoopRegistrationApply,
): void {
	applyRevocations.get(apply)?.();
	pendingApplies.delete(apply);
	consumingApplies.delete(apply);
}

/** Reserve terminally before the first await; failed or concurrent consumption never restores authority. */
export async function consumeStaticFabProcessLoopRegistrationApplyCooperatively(
	apply: StaticFabProcessLoopRegistrationApply,
	document: StaticFabProcessLoopRegistrationDocument,
	checkpoint: () => Promise<void>,
): Promise<OwnedStaticFabProcessLoopRegistrationPlan | null> {
	const binding = pendingApplies.get(apply);
	pendingApplies.delete(apply);
	if (!binding || binding.request.document !== document) return null;
	consumingApplies.set(apply, binding);
	const check = async (): Promise<void> => {
		if (consumingApplies.get(apply) !== binding)
			throw new Error("Loop registration Apply was revoked.");
		binding.plan.assertCurrent();
		await checkpoint();
		if (consumingApplies.get(apply) !== binding)
			throw new Error("Loop registration Apply was revoked.");
		binding.plan.assertCurrent();
	};
	try {
		await check();
		const fingerprint = await railPatchTransitionFingerprintCooperatively(binding.plan, check);
		if (fingerprint !== binding.fingerprint)
			throw new Error("Loop registration plan fingerprint changed.");
		const checksum = await binding.ports.checksumTransition(
			binding.request.sourceChecksum,
			binding.plan,
			check,
		);
		if (checksum !== binding.plan.prospectiveChecksum)
			throw new Error("Loop registration prospective checksum changed.");
		await check();
		return binding.plan;
	} finally {
		consumingApplies.delete(apply);
	}
}

function* createRecordSteps(request: StaticFabProcessLoopRegistrationRequest) {
	const id = request.source.organizations.nextOrganizationId;
	if (id >= 0x7fffffff) throw new Error("Loop organization ID cursor is exhausted.");
	const builder = createCanonicalStaticFabOrganizationStateBuilder(id + 1);
	for (const edge of request.candidate.membership.railEdges) {
		builder.addRailEdge(edge);
		yield;
	}
	for (const switchId of request.candidate.membership.advancedSwitchIds) {
		builder.addAdvancedSwitchId(switchId);
		yield;
	}
	builder.finishRecord({
		id,
		kind: "AISLE",
		name: request.name,
		declaredSemanticRole: "PROCESS_LOOP",
		description: "",
		color: DEFAULT_STATIC_FAB_ORGANIZATION_COLOR,
	});
	const record = builder.finish().records[0];
	if (!record) throw new Error("Loop registration record is missing.");
	return record;
}

async function finishSteps<T>(
	steps: Generator<void, T>,
	checkpoint: () => Promise<void>,
): Promise<T> {
	const task = createCooperativeTask(steps);
	while (!task.done) {
		task.step(128);
		await checkpoint();
	}
	return task.finish();
}

function assertRegistrationChecksumHeader(source: string, prospective: string): void {
	if (!/^00000003(?::[0-9a-f]{8}){11}$/.test(prospective))
		throw new Error("Loop registration prospective checksum is invalid.");
	const expected = source.split(":"),
		actual = prospective.split(":");
	expected[6] = (Number.parseInt(expected[6], 16) + 1).toString(16).padStart(8, "0");
	expected[7] = (Number.parseInt(expected[7], 16) + 1).toString(16).padStart(8, "0");
	if (expected.slice(0, 10).some((field, i) => field !== actual[i]))
		throw new Error("Loop registration checksum must change only organization count and cursor.");
}

function hasControlCharacter(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		if (code < 32 || code === 127) return true;
	}
	return false;
}
