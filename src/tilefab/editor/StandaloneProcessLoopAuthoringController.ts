import type { AdvancedSwitchMutation } from "../core/AdvancedSwitch";
import { createCooperativeTask } from "../core/CooperativeTask";
import type { RailMutation } from "../core/paint";
import type {
	MeasuredRailDocumentReviewedPortEquipmentCommit,
	RailDocument,
	RailDocumentProcessLoopRepairCommitOptions,
} from "../core/RailDocument";
import type { RailModuleOwnership, RailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import {
	createStaticFabProcessLoopRailCandidatePreparation,
	type StaticFabProcessLoopRailCandidateSource,
} from "../core/StaticFabProcessLoopRailCandidate";
import {
	prepareStaticFabProcessLoopRegistrationCooperatively,
	type StaticFabProcessLoopRegistrationPreparation,
} from "../core/StaticFabProcessLoopRegistration";
import {
	prepareStaticFabProcessLoopRepairCooperatively,
	type StaticFabProcessLoopRepairPreparation,
} from "../core/StaticFabProcessLoopRepair";
import { planStaticFabProcessLoopSelectionEraseSteps } from "../core/StaticFabProcessLoopSelectionErase";
import type { StaticFabSelection } from "../core/StaticFabSelection";
import { checksumRailPatchResultCooperatively } from "../worker/RailMirrorChecksum";
import type { RailWorkerBridgeHandle } from "../worker/RailWorkerBridge";
import { railWorkerStateMatchesSnapshotReadyExpectation } from "../worker/RailWorkerSnapshotReadiness";
import { StaticFabProcessLoopTopologyBridge } from "./StaticFabProcessLoopTopologyBridge";

export interface StandaloneProcessLoopAuthoringSource {
	readonly document: RailDocument;
	readonly modelGeneration: number;
	readonly ownership: RailModuleOwnershipIndex;
	readonly selection: StaticFabSelection | null;
	readonly mirror: RailWorkerBridgeHandle | null;
	/** Excludes this controller's own busy state. */
	readonly projectIdle: boolean;
}

export interface StandaloneProcessLoopAuthoringPorts {
	readonly readSource: () => StandaloneProcessLoopAuthoringSource;
	readonly createCheckpoint: () => () => Promise<void>;
	readonly now: () => number;
	readonly topology?: StaticFabProcessLoopTopologyBridge;
}

export interface StandaloneProcessLoopAuthoringResult {
	readonly document: RailDocument;
	readonly organizationId: number | null;
	readonly commit: MeasuredRailDocumentReviewedPortEquipmentCommit;
}

interface PendingOperation {
	readonly source: StandaloneProcessLoopAuthoringSource;
	readonly abort: AbortController;
	readonly isIntentCurrent: () => boolean;
	readonly sequence: number;
	readonly revision: number;
	readonly mapGeneration: number;
	readonly checksum: string;
	readonly epoch: number;
	readonly checkpoint: () => Promise<void>;
	readonly map: RailDocument["map"];
	readonly ports: RailDocument["portEquipment"];
	readonly organizations: RailDocument["organizations"];
	readonly relationships: RailDocument["relationships"];
	readonly operations: RailDocument["operationalConfiguration"];
	cancelPreparation: (() => void) | null;
}

/** Editor adapter only: exact operation lifetime, scheduling and trusted Worker transport. */
export class StandaloneProcessLoopAuthoringController {
	private pending: PendingOperation | null = null;
	private disposed = false;
	private readonly topology: StaticFabProcessLoopTopologyBridge;

	private readonly environment: StandaloneProcessLoopAuthoringPorts;

	constructor(environment: StandaloneProcessLoopAuthoringPorts) {
		this.environment = environment;
		this.topology = environment.topology ?? new StaticFabProcessLoopTopologyBridge();
	}

	get busy(): boolean {
		return this.pending !== null;
	}

	cancel(): void {
		const operation = this.pending;
		if (!operation) return;
		this.pending = null;
		operation.abort.abort();
		operation.cancelPreparation?.();
	}

	dispose(): void {
		this.disposed = true;
		this.cancel();
		this.topology.dispose();
	}

	async register(
		name: string,
		isIntentCurrent: () => boolean,
	): Promise<StandaloneProcessLoopAuthoringResult> {
		const operation = this.begin(isIntentCurrent);
		try {
			const selection = operation.source.selection;
			if (!selection) throw new Error("등록할 Loop의 레일 전체를 먼저 선택하세요");
			const source = this.candidateSource(operation);
			const candidateTask = createStaticFabProcessLoopRailCandidatePreparation(source, () =>
				this.isCurrent(operation, true),
			);
			operation.cancelPreparation = () => candidateTask.cancel();
			while (!candidateTask.done) {
				this.assertCurrent(operation, true);
				candidateTask.step(128);
				await operation.checkpoint();
			}
			const result = candidateTask.finish();
			if (!result.valid) throw new Error(candidateErrorMessage(result.error));
			this.assertCurrent(operation, true);
			const preparation: StaticFabProcessLoopRegistrationPreparation =
				prepareStaticFabProcessLoopRegistrationCooperatively(
					{
						document: operation.source.document,
						source,
						candidate: result.candidate,
						name,
						sourceChecksum: operation.checksum,
						mirrorEpoch: operation.epoch,
					},
					{
						checkpoint: operation.checkpoint,
						isCurrent: () => this.isCurrent(operation, true),
						checksumTransition: checksumRailPatchResultCooperatively,
						cancelTopology: (request) => this.topology.cancelRegistrationRequest(request),
						validateTopology: (request) =>
							this.topology.validateRegistrationRequest(request, {
								document: operation.source.document,
								source,
								candidate: result.candidate,
								getCurrentSource: () => this.candidateSource(operation, true),
								isCurrent: () => this.isCurrent(operation, true),
								getMirrorState: () => this.requireMirror(operation).getState(),
								checkpoint: operation.checkpoint,
								signal: operation.abort.signal,
							}),
					},
				);
			operation.cancelPreparation = () => preparation.cancel();
			const apply = await preparation.promise;
			const commit =
				await operation.source.document.commitStaticFabProcessLoopRegistrationCooperatively(
					apply,
					this.commitOptions(operation, "registration", true),
				);
			// Publication intentionally changes the source. Do not apply the old-source guard here.
			return { document: operation.source.document, organizationId: apply.organizationId, commit };
		} finally {
			this.finish(operation);
		}
	}

	async repair(
		organizationId: number,
		changes: readonly RailMutation[],
		switchChanges: readonly AdvancedSwitchMutation[],
		isIntentCurrent: () => boolean,
	): Promise<StandaloneProcessLoopAuthoringResult> {
		const operation = this.begin(isIntentCurrent);
		try {
			return await this.repairOperation(operation, organizationId, changes, switchChanges);
		} finally {
			this.finish(operation);
		}
	}

	async repairSelection(
		organizationId: number,
		selectedModules: readonly RailModuleOwnership[],
		isIntentCurrent: () => boolean,
	): Promise<StandaloneProcessLoopAuthoringResult> {
		const operation = this.begin(isIntentCurrent);
		try {
			const steps = planStaticFabProcessLoopSelectionEraseSteps(
				operation.map,
				operation.source.ownership,
				selectedModules,
			);
			const task = createCooperativeTask(steps);
			operation.cancelPreparation = () =>
				steps.return({
					kind: "erase",
					baseRevision: operation.revision,
					cells: [],
					mutations: [],
					switchMutations: [],
					valid: false,
					reason: "Loop 철거 준비를 취소했습니다",
				});
			while (!task.done) {
				this.assertCurrent(operation);
				task.step(128);
				await operation.checkpoint();
			}
			const plan = task.finish();
			if (!plan.valid) throw new Error(plan.reason);
			return await this.repairOperation(
				operation,
				organizationId,
				plan.mutations,
				plan.switchMutations,
			);
		} finally {
			this.finish(operation);
		}
	}

	private async repairOperation(
		operation: PendingOperation,
		organizationId: number,
		changes: readonly RailMutation[],
		switchChanges: readonly AdvancedSwitchMutation[],
	): Promise<StandaloneProcessLoopAuthoringResult> {
		if (!Array.isArray(changes) || !Array.isArray(switchChanges) || switchChanges.length !== 0)
			throw new Error("작업 루프 편집에는 일반 레일 변경만 사용할 수 있습니다");
		// Ordinary rail planners return mutable drafts. Capture their scalar intent in bounded
		// batches before passing it to the immutable Core command; never freeze the user's draft.
		const captured: RailMutation[] = [];
		const count = changes.length;
		for (let index = 0; index < count; index++) {
			if (index % 128 === 0) {
				this.assertCurrent(operation);
				await operation.checkpoint();
				this.assertCurrent(operation);
				if (changes.length !== count) throw new Error("레일 편집 초안이 변경되었습니다");
			}
			const entry = Object.getOwnPropertyDescriptor(changes, index);
			const value = entry && "value" in entry ? entry.value : null;
			const fields = ["x", "y", "before", "after"] as const;
			if (
				!value ||
				!fields.every((key) =>
					Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"),
				)
			)
				throw new Error("레일 편집 초안에는 셀 변경 데이터만 사용할 수 있습니다");
			captured.push(
				Object.freeze({ x: value.x, y: value.y, before: value.before, after: value.after }),
			);
		}
		this.assertCurrent(operation);
		const preparation: StaticFabProcessLoopRepairPreparation =
			prepareStaticFabProcessLoopRepairCooperatively(
				{
					document: operation.source.document,
					ownership: operation.source.ownership,
					organizationId,
					changes: Object.freeze(captured),
					switchChanges: Object.freeze([]),
					sourceChecksum: operation.checksum,
					mirrorEpoch: operation.epoch,
				},
				{
					checkpoint: operation.checkpoint,
					isCurrent: () => this.isCurrent(operation),
					checksumTransition: checksumRailPatchResultCooperatively,
				},
			);
		operation.cancelPreparation = () => preparation.cancel();
		const apply = await preparation.promise;
		const commit = await operation.source.document.commitStaticFabProcessLoopRepairCooperatively(
			apply,
			this.commitOptions(operation, "repair"),
		);
		return { document: operation.source.document, organizationId, commit };
	}

	async replay(
		direction: "undo" | "redo",
		isIntentCurrent: () => boolean,
	): Promise<StandaloneProcessLoopAuthoringResult> {
		const operation = this.begin(isIntentCurrent);
		try {
			const document = operation.source.document;
			const repair = document.canReplayStaticFabProcessLoopRepair(direction);
			if (!repair && !document.canReplayStaticFabProcessLoopRegistration(direction))
				throw new Error("현재 Undo/Redo 대상이 Loop 편집이 아닙니다");
			// Publish the pending UI and allow cancellation before even a small replay prepares truth.
			await operation.checkpoint();
			const commit = repair
				? await document.replayStaticFabProcessLoopRepairCooperatively(
						direction,
						operation.source.ownership,
						this.commitOptions(operation, "repair"),
					)
				: await document.replayStaticFabProcessLoopRegistrationCooperatively(
						direction,
						operation.source.ownership,
						this.commitOptions(operation, "registration"),
					);
			return { document, organizationId: null, commit };
		} finally {
			this.finish(operation);
		}
	}

	private begin(isIntentCurrent: () => boolean): PendingOperation {
		if (this.disposed || this.pending) throw new Error("Loop 작업을 먼저 완료하거나 취소하세요");
		const source = Object.freeze({ ...this.environment.readSource() });
		if (!source.projectIdle || !source.mirror)
			throw new Error("프로젝트와 레일 동기화가 끝난 뒤 다시 시도하세요");
		const document = source.document;
		const state = source.mirror.getState();
		const checkpoint = this.environment.createCheckpoint();
		const operation: PendingOperation = {
			source,
			abort: new AbortController(),
			isIntentCurrent,
			sequence: document.getPatchSequence(),
			revision: document.map.getRevision(),
			mapGeneration: document.map.getMutationGeneration(),
			checksum: state.targetChecksum,
			epoch: state.epoch,
			checkpoint: async () => {
				this.assertCurrent(operation);
				await checkpoint();
				this.assertCurrent(operation);
			},
			map: document.map,
			ports: document.portEquipment,
			organizations: document.organizations,
			relationships: document.relationships,
			operations: document.operationalConfiguration,
			cancelPreparation: null,
		};
		this.pending = operation;
		try {
			this.assertCurrent(operation);
		} catch (error) {
			this.finish(operation);
			throw error;
		}
		return operation;
	}

	private isCurrent(operation: PendingOperation, selection = false): boolean {
		try {
			this.assertCurrent(operation, selection);
			return true;
		} catch {
			return false;
		}
	}

	private assertCurrent(operation: PendingOperation, selection = false): void {
		const document = operation.source.document;
		const intentCurrent = operation.isIntentCurrent();
		const state = this.requireMirror(operation).getState();
		const current = this.environment.readSource();
		if (
			this.disposed ||
			this.pending !== operation ||
			operation.abort.signal.aborted ||
			!intentCurrent ||
			!current.projectIdle ||
			current.document !== document ||
			current.modelGeneration !== operation.source.modelGeneration ||
			current.ownership !== operation.source.ownership ||
			current.mirror !== operation.source.mirror ||
			(selection && current.selection !== operation.source.selection) ||
			document.map !== operation.map ||
			document.portEquipment !== operation.ports ||
			document.organizations !== operation.organizations ||
			document.relationships !== operation.relationships ||
			document.operationalConfiguration !== operation.operations ||
			document.getPatchSequence() !== operation.sequence ||
			document.map.getRevision() !== operation.revision ||
			document.map.getMutationGeneration() !== operation.mapGeneration ||
			state.epoch !== operation.epoch ||
			!railWorkerStateMatchesSnapshotReadyExpectation(state, {
				revision: operation.revision,
				sequence: operation.sequence,
				checksum: operation.checksum,
			}) ||
			state.cells !== operation.map.size ||
			state.edges !== operation.map.edgeCount ||
			state.switches !== operation.map.advancedSwitchCount ||
			state.ports !== operation.ports.ports.length ||
			state.equipmentGroups !== operation.ports.equipmentGroups.length ||
			state.organizations !== operation.organizations.records.length ||
			state.assemblyRelationships !== operation.relationships.records.length ||
			state.assemblyRelationshipNextId !== operation.relationships.nextRelationshipId ||
			this.pending !== operation ||
			operation.abort.signal.aborted
		)
			throw new Error("Loop 작업 준비 중 프로젝트나 선택이 변경되었습니다 · 다시 시도하세요");
	}

	private requireMirror(operation: PendingOperation): RailWorkerBridgeHandle {
		const mirror = operation.source.mirror;
		if (!mirror) throw new Error("레일 동기화 연결이 없습니다");
		return mirror;
	}

	private candidateSource(
		operation: PendingOperation,
		current = false,
	): StaticFabProcessLoopRailCandidateSource {
		const source = current ? this.environment.readSource() : operation.source;
		if (!source.selection) throw new Error("Loop 등록 선택이 사라졌습니다");
		return {
			map: source.document.map,
			ownership: source.ownership,
			organizations: source.document.organizations,
			patchSequence: source.document.getPatchSequence(),
			selection: source.selection,
		};
	}

	private commitOptions(
		operation: PendingOperation,
		kind: "registration" | "repair",
		selection = false,
	): RailDocumentProcessLoopRepairCommitOptions {
		const mirror = this.requireMirror(operation);
		const prepare =
			kind === "repair"
				? mirror.prepareProcessLoopRepairPatchCooperatively
				: mirror.prepareProcessLoopRegistrationPatchCooperatively;
		if (!prepare) throw new Error("이 연결은 Loop 편집 전송을 지원하지 않습니다");
		return {
			checkpoint: operation.checkpoint,
			now: this.environment.now,
			sourceChecksum: operation.checksum,
			mirrorEpoch: operation.epoch,
			checkCancelled: () => this.assertCurrent(operation, selection),
			checksumTransition: checksumRailPatchResultCooperatively,
			preparePatch: async (event, checkpoint, expectedChecksum) => {
				this.assertCurrent(operation, selection);
				const lease = await prepare.call(mirror, event, expectedChecksum, checkpoint);
				this.assertCurrent(operation, selection);
				return {
					isCurrent: () => {
						const current = lease.isCurrent();
						// This callback runs last at publication. No further foreign callback may
						// revoke cancellation or replace the pending operation after this check.
						return (
							current &&
							!this.disposed &&
							this.pending === operation &&
							!operation.abort.signal.aborted
						);
					},
				};
			},
		};
	}

	private finish(operation: PendingOperation): void {
		if (this.pending === operation) this.pending = null;
		operation.cancelPreparation?.();
	}
}

function candidateErrorMessage(
	error: import("../core/StaticFabProcessLoopRailCandidate").StaticFabProcessLoopRailCandidateError,
): string {
	switch (error.code) {
		case "EMPTY_SELECTION":
			return "등록할 Loop의 레일 전체를 먼저 선택하세요";
		case "EQUIPMENT_SELECTED":
			return "레일만 선택해 Loop를 등록한 뒤 장비를 소속시키세요";
		case "WHOLE_MODULE_REQUIRED":
			return "일부 레일만 선택되었습니다 · 레일 모듈 전체를 선택하세요";
		case "STORED_MEMBERSHIP_OVERLAP":
			return `이미 ${error.organizationKind} #${error.organizationId} 소속입니다 · 기존 구조에서 편집하세요`;
		case "INVALID_MODULE":
			return "선택한 레일 모듈을 확인한 뒤 다시 선택하세요";
		case "STALE_SOURCE":
		case "CANCELLED":
			return "Loop 선택이 변경되었습니다 · 다시 선택하세요";
	}
}
