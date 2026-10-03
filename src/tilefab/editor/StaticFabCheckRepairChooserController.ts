import type { SourceBoundCooperativeTask } from "../core/SourceBoundCooperativeTask";
import {
	assertStaticFabAssemblyConnectorLaunchResultCurrent,
	captureStaticFabAssemblyConnectorLaunchInput,
	type StaticFabAssemblyConnectorLaunchInput,
	type StaticFabAssemblyConnectorLaunchResult,
} from "../core/StaticFabAssemblyConnectorLaunch";
import {
	createStaticFabCheckRepairTargetIndexPreparation,
	STATIC_FAB_CHECK_REPAIR_TARGET_SEARCH_LENGTH_LIMIT,
	type StaticFabCheckRepairTargetIndex,
	type StaticFabCheckRepairTargetPage,
	type StaticFabCheckRepairTargetQuery,
	type StaticFabCheckRepairTargetRole,
	type StaticFabCheckRepairTargetSelection,
} from "../core/StaticFabCheckRepairTargetIndex";
import {
	resolveStaticFabCheckConnectorRepairTarget,
	resolveStaticFabCheckLoopRepairTarget,
	type StaticFabCheckConnectorRepairTarget,
	type StaticFabCheckLoopRepairTarget,
} from "../core/StaticFabCheckRepairTargets";
import {
	createStaticFabOrganizationMetadataLookupPreparation,
	type StaticFabOrganizationMetadataLookup,
} from "../core/StaticFabOrganizationMetadataLookup";
import {
	captureStaticFabCheckRepairContinuation,
	type StaticFabCheckRepairContinuation,
	type StaticFabCheckRepairCurrent,
	type StaticFabCheckRepairDomainCurrent,
	staticFabCheckRepairCurrentIsExact,
	staticFabCheckRepairCurrentReceiptIsExact,
	staticFabCheckRepairDomainIsExact,
	staticFabCheckRepairDomainReceiptIsExact,
} from "./StaticFabCheckRepairContinuation";
import {
	type StaticFabCheckRepairReturnOrigin,
	staticFabCheckRepairReturnOrigin,
} from "./StaticFabCheckRepairReturnOrigin";

export const STATIC_FAB_CHECK_REPAIR_CHOOSER_SLICE_OPERATIONS = 128;
export const STATIC_FAB_CHECK_REPAIR_CHOOSER_SLICE_MILLISECONDS = 4;

export type StaticFabCheckRepairChooserKind = "loop" | "connector";
export type StaticFabCheckRepairChooserAdvice =
	| StaticFabCheckLoopRepairTarget
	| StaticFabCheckConnectorRepairTarget;
export type StaticFabCheckRepairChooserSelectedSlot =
	| StaticFabCheckRepairTargetSelection
	| Readonly<{ status: "pending"; organizationId: number }>;

export interface StaticFabCheckRepairChooserView {
	readonly continuation: StaticFabCheckRepairContinuation;
	readonly kind: StaticFabCheckRepairChooserKind;
	readonly phase: "preparing" | "querying" | "ready" | "launching";
	readonly launchStage: "preparing" | "admitting" | null;
	readonly query: StaticFabCheckRepairTargetQuery;
	readonly selectedSlots: readonly StaticFabCheckRepairChooserSelectedSlot[];
	readonly page: StaticFabCheckRepairTargetPage | null;
	readonly advice: StaticFabCheckRepairChooserAdvice | null;
	readonly reason: string | null;
}

interface LaunchNavigationBinding {
	readonly continuation: StaticFabCheckRepairContinuation;
	/** Advisory lookup for synchronous launcher metadata reads only; never a Worker proof. */
	readonly metadataLookup: StaticFabOrganizationMetadataLookup;
	readonly returnOrigin: StaticFabCheckRepairReturnOrigin;
	/** Valid only during this synchronous launcher call, before its boolean result is consumed. */
	readonly isCurrent: () => boolean;
	/** Register exact newly installed UI cleanup during this synchronous launch only. */
	readonly registerRollback: (cleanup: () => void) => void;
}

export type StaticFabCheckRepairChooserLaunch = LaunchNavigationBinding &
	Readonly<
		| { kind: "loop"; organizationId: number }
		| {
				kind: "connector";
				organizationIds: readonly [number, number];
				hierarchyRole: "BAY_TO_BANK" | "BANK_TO_FAB";
				purpose: "HIERARCHY_LINK" | "FAB_LOOP";
				prepared: StaticFabAssemblyConnectorLaunchResult;
				preparationInput: StaticFabAssemblyConnectorLaunchInput;
		  }
	>;

export interface StaticFabCheckRepairChooserPorts {
	readonly readCurrent: () => StaticFabCheckRepairCurrent | null;
	/** Remains readable after this accepted launcher closes Checks/nav/tool UI. */
	readonly readDomainCurrent: () => StaticFabCheckRepairDomainCurrent | null;
	readonly now: () => number;
	/** Must yield a real scheduling turn, not Promise.resolve(). One factory call per open. */
	readonly createCheckpoint: () => () => Promise<void>;
	readonly publish: (view: StaticFabCheckRepairChooserView | null) => void;
	/** Production connector entry refuses when absent; never substitute a synchronous scan. */
	readonly prepareConnector?: (
		input: StaticFabAssemblyConnectorLaunchInput,
	) => SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult>;
	/** True only after the existing typed launcher has accepted/bound its actual UI session. */
	readonly launch: (request: StaticFabCheckRepairChooserLaunch) => boolean;
}

export type StaticFabCheckRepairChooserErrorCode =
	| "CANCELLED"
	| "STALE_SOURCE"
	| "REENTRANT_SOURCE"
	| "INVALID_QUERY"
	| "INVALID_CLOCK"
	| "NO_PROGRESS";

export class StaticFabCheckRepairChooserError extends Error {
	readonly code: StaticFabCheckRepairChooserErrorCode;
	constructor(code: StaticFabCheckRepairChooserErrorCode) {
		const messages: Record<StaticFabCheckRepairChooserErrorCode, string> = {
			CANCELLED: "수정 대상 선택을 취소했습니다 · 현재 레일과 장비는 유지됩니다",
			STALE_SOURCE: "FAB 데이터나 검사 결과가 바뀌었습니다 · 현재 프로젝트를 다시 검사하세요",
			REENTRANT_SOURCE: "수정 대상 확인이 겹쳤습니다 · 검사가 완료되면 다시 선택하세요",
			INVALID_QUERY: "검색어·역할·선택한 조직 ID를 확인하세요",
			INVALID_CLOCK: "수정 대상 준비를 완료하지 못했습니다 · 선택을 닫고 다시 시도하세요",
			NO_PROGRESS: "수정 대상 준비가 진행되지 않았습니다 · 선택을 닫고 다시 시도하세요",
		};
		super(messages[code]);
		this.name = "StaticFabCheckRepairChooserError";
		this.code = code;
	}
}

interface QueryOperation {
	readonly kind: "query";
	readonly input: StaticFabCheckRepairTargetQuery;
	readonly task: SourceBoundCooperativeTask<StaticFabCheckRepairTargetPage>;
}

interface LaunchOperation {
	readonly kind: "launch";
	readonly input: StaticFabCheckRepairTargetQuery;
	readonly selectedIds: readonly number[];
	preparation: SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult> | null;
	admitted: boolean;
}

type ChooserActivity = QueryOperation | LaunchOperation;

interface OpenOperation {
	readonly entry: object;
	readonly continuation: StaticFabCheckRepairContinuation;
	readonly kind: StaticFabCheckRepairChooserKind;
	readonly token: { consumed: boolean };
	checkpoint: (() => Promise<void>) | null;
	preparation: SourceBoundCooperativeTask<unknown> | null;
	metadata: StaticFabOrganizationMetadataLookup | null;
	index: StaticFabCheckRepairTargetIndex | null;
	query: QueryOperation | null;
	launch: LaunchOperation | null;
	input: StaticFabCheckRepairTargetQuery;
	view: StaticFabCheckRepairChooserView;
	checkingSource: boolean;
	lastTime: number | null;
}

/** Checks navigation coordination only. No map edits, Worker patching, React or platform APIs. */
export class StaticFabCheckRepairChooserController {
	private operation: OpenOperation | null = null;
	/** Latest open intent, including the synchronous gap while old resources are released. */
	private openingIntent: object | null = null;
	private disposed = false;
	private readonly ports: StaticFabCheckRepairChooserPorts;

	constructor(ports: StaticFabCheckRepairChooserPorts) {
		this.ports = ports;
	}
	get view(): StaticFabCheckRepairChooserView | null {
		return this.operation?.view ?? null;
	}

	async open(
		continuation: StaticFabCheckRepairContinuation,
		kind: StaticFabCheckRepairChooserKind,
	): Promise<void> {
		if (this.disposed) throw new StaticFabCheckRepairChooserError("CANCELLED");
		if (kind !== "loop" && kind !== "connector")
			throw new StaticFabCheckRepairChooserError("INVALID_QUERY");
		const captured = captureStaticFabCheckRepairContinuation(
			continuation.source,
			continuation.issueId,
			continuation.issueCode,
			continuation.locationIndex,
		);
		const input = ownQuery(kind, {});
		const entry = Object.freeze({});
		this.openingIntent = entry;
		const previous = this.operation;
		this.operation = null;
		let cleanupFailed = false;
		let cleanupError: unknown;
		try {
			if (previous) this.release(previous);
		} catch (error) {
			cleanupFailed = true;
			cleanupError = error;
		}
		// A foreign cancel callback may have opened B, closed, or disposed this controller.
		// The superseded outer open never allocates/publishes A or cleans up B.
		if (this.disposed || this.openingIntent !== entry || this.operation !== null)
			throw new StaticFabCheckRepairChooserError("CANCELLED");
		if (cleanupFailed) {
			this.openingIntent = null;
			try {
				this.publishClosed();
			} catch {
				/* Preserve the first cleanup error. */
			}
			throw cleanupError;
		}
		const view = Object.freeze({
			continuation: captured,
			kind,
			phase: "preparing" as const,
			launchStage: null,
			query: input,
			selectedSlots: Object.freeze([]),
			page: null,
			advice: null,
			reason: null,
		});
		const operation: OpenOperation = {
			entry,
			continuation: captured,
			kind,
			token: { consumed: false },
			checkpoint: null,
			preparation: null,
			metadata: null,
			index: null,
			query: null,
			launch: null,
			input,
			view,
			checkingSource: false,
			lastTime: null,
		};
		this.operation = operation;
		try {
			this.assertCurrent(operation);
			operation.checkpoint = this.ports.createCheckpoint();
			this.assertCurrent(operation);
			this.publish(operation, operation.view);
			const metadataTask = createStaticFabOrganizationMetadataLookupPreparation(
				captured.source.organizations,
				() => {
					this.assertCurrent(operation);
					return true;
				},
			);
			operation.preparation = metadataTask;
			operation.metadata = await this.drive(operation, metadataTask);
			this.assertCurrent(operation);
			// A completed preparation must not be cancelled as routine successful cleanup.
			if (operation.preparation === metadataTask) operation.preparation = null;
			const indexTask = createStaticFabCheckRepairTargetIndexPreparation(
				captured.source.organizations,
				operation.metadata,
			);
			operation.preparation = indexTask;
			await this.drive(operation, indexTask, undefined, (index) => {
				// Adopt the one-shot handoff before a final source callback may close this open.
				if (!this.owned(operation) || operation.preparation !== indexTask) {
					index.dispose();
					throw new StaticFabCheckRepairChooserError("CANCELLED");
				}
				operation.index = index;
			});
			this.assertCurrent(operation);
			if (operation.preparation === indexTask) operation.preparation = null;
		} catch (error) {
			if (this.retireIfOwned(operation, true)) {
				try {
					this.publishClosed();
				} catch {
					/* Keep the original operation error. */
				}
			}
			throw error;
		}
		// Superseding this initial query must not cancel the completed metadata/options phases.
		await this.query(operation);
	}

	async updateQuery(request: StaticFabCheckRepairTargetQuery): Promise<void> {
		const operation = this.requireOpen();
		const previousInput = operation.input;
		const input = ownQuery(operation.kind, {
			searchText: request.searchText ?? previousInput.searchText,
			role: request.role ?? previousInput.role,
			selectedOrganizationIds:
				request.selectedOrganizationIds ?? previousInput.selectedOrganizationIds,
		});
		this.assertInputCurrent(operation, previousInput);
		this.cancelLaunch(operation);
		this.assertInputCurrent(operation, previousInput);
		const previous = operation.query;
		operation.query = null;
		previous?.task.cancel();
		this.assertInputCurrent(operation, previousInput);
		operation.input = input;
		const selectedSlots = this.selectedSlots(operation, input);
		this.assertInputCurrent(operation, input);
		if (!operation.index) {
			this.publish(
				operation,
				Object.freeze({
					...operation.view,
					query: input,
					selectedSlots,
					launchStage: null,
					page: null,
					advice: null,
				}),
			);
			return;
		}
		await this.query(operation, input);
	}

	/** Source/project replacement hooks must close proactively; action checks also refuse staleness. */
	close(): void {
		const wasOpening = this.openingIntent !== null;
		this.openingIntent = null;
		const operation = this.operation;
		this.operation = null;
		if (!operation && !wasOpening) return;
		let failed = false;
		let failure: unknown;
		try {
			if (operation) this.release(operation);
		} catch (error) {
			failed = true;
			failure = error;
		}
		try {
			this.publishClosed();
		} catch (error) {
			if (!failed) {
				failed = true;
				failure = error;
			}
		}
		if (failed) throw failure;
		// A publish callback may synchronously open a replacement. Never clear it afterwards.
	}

	dispose(): void {
		this.disposed = true;
		this.close();
	}

	async launch(): Promise<boolean> {
		const operation = this.operation;
		if (
			!operation ||
			operation.view.phase !== "ready" ||
			operation.query ||
			operation.launch ||
			operation.token.consumed ||
			!operation.metadata
		)
			return false;
		let advice: StaticFabCheckRepairChooserAdvice;
		const input = operation.input;
		try {
			this.assertInputCurrent(operation, input);
			advice = this.resolve(operation);
			this.assertInputCurrent(operation, input);
		} catch {
			if (!this.owned(operation) || operation.input !== input) return false;
			if (this.retireIfOwned(operation, true)) {
				try {
					this.publishClosed();
				} catch {
					/* The failed lifetime remains closed. */
				}
			}
			return false;
		}
		if (advice.status !== "ready") {
			this.publish(operation, Object.freeze({ ...operation.view, advice, reason: advice.reason }));
			return false;
		}
		const launch: LaunchOperation = {
			kind: "launch",
			input,
			selectedIds: Object.freeze([...(input.selectedOrganizationIds ?? [])]),
			preparation: null,
			admitted: false,
		};
		operation.launch = launch;
		const rollback: { cleanup: (() => void) | null } = { cleanup: null };
		let bindingRollback = false;
		let acceptedNavigation = false;
		try {
			this.publish(
				operation,
				Object.freeze({
					...operation.view,
					phase: "launching",
					launchStage: "preparing",
					advice,
					reason: null,
				}),
				launch,
			);
			// Even an O(1) Loop navigation gets a real cancellation turn before admission.
			await this.checkpoint(operation, launch);
			const metadata = operation.metadata;
			if (!metadata) throw new StaticFabCheckRepairChooserError("CANCELLED");
			const navigation: LaunchNavigationBinding = {
				continuation: operation.continuation,
				metadataLookup: metadata,
				returnOrigin: staticFabCheckRepairReturnOrigin(operation.continuation),
				isCurrent: () => this.navigationIsCurrent(operation, launch),
				registerRollback: (cleanup) => {
					if (!bindingRollback || rollback.cleanup || typeof cleanup !== "function")
						throw new StaticFabCheckRepairChooserError("CANCELLED");
					rollback.cleanup = cleanup;
				},
			};
			let request: StaticFabCheckRepairChooserLaunch;
			if (operation.kind === "loop" && "organizationId" in advice) {
				request = Object.freeze({
					...navigation,
					kind: "loop",
					organizationId: advice.organizationId,
				});
			} else if (operation.kind === "connector" && "organizationIds" in advice) {
				if (!this.ports.prepareConnector) {
					throw new Error(
						"연결 gateway 준비 기능이 연결되지 않았습니다 · 선택을 유지하고 다시 시도하세요",
					);
				}
				const first = launch.selectedIds[0];
				const second = launch.selectedIds[1];
				if (first === undefined || second === undefined)
					throw new StaticFabCheckRepairChooserError("INVALID_QUERY");
				const source = operation.continuation.source;
				const input = captureStaticFabAssemblyConnectorLaunchInput({
					map: source.map,
					organizations: source.organizations,
					metadataLookup: metadata,
					organizationIds: Object.freeze([first, second]) as readonly [number, number],
					capturedMapRevision: source.revision,
					isSourceCurrent: () => {
						this.assertCurrent(operation, launch);
						return true;
					},
				});
				this.assertCurrent(operation, launch);
				launch.preparation = this.ports.prepareConnector(input);
				this.assertCurrent(operation, launch);
				const prepared = await this.drive(operation, launch.preparation, launch);
				this.assertCurrent(operation, launch);
				if (prepared.request !== input) throw new Error("연결 준비 결과가 현재 요청과 다릅니다");
				assertStaticFabAssemblyConnectorLaunchResultCurrent(prepared, prepared.request);
				this.assertCurrent(operation, launch);
				if (
					!prepared.eligibility.valid ||
					prepared.hierarchyRole === null ||
					prepared.purpose === null
				) {
					this.restoreReady(operation, launch, prepared.eligibility.reason);
					return false;
				}
				request = Object.freeze({
					...navigation,
					kind: "connector",
					organizationIds: prepared.organizationIds,
					hierarchyRole: prepared.hierarchyRole,
					purpose: prepared.purpose,
					prepared,
					preparationInput: input,
				});
			} else throw new StaticFabCheckRepairChooserError("INVALID_QUERY");
			this.publish(
				operation,
				Object.freeze({ ...operation.view, launchStage: "admitting" }),
				launch,
			);
			this.assertCurrent(operation, launch);
			let accepted = false;
			bindingRollback = true;
			try {
				accepted = this.ports.launch(request) === true;
			} finally {
				bindingRollback = false;
			}
			if (!accepted) {
				// A refusal cannot use the weaker domain guard or lose the old Checks selection.
				this.assertCurrent(operation, launch);
				this.restoreReady(
					operation,
					launch,
					"현재 연결/편집 작업을 시작하지 못했습니다 · 선택을 유지하고 다시 확인하세요",
				);
				return false;
			}
			// Boolean acceptance is UI navigation only. Domain truth must still be exactly current.
			launch.admitted = true;
			this.assertDomainCurrent(operation, launch);
			operation.token.consumed = true;
			this.retireIfOwned(operation);
			this.publishClosed();
			acceptedNavigation = true;
			return true;
		} catch (error) {
			if (!this.activityOwned(operation, launch)) return false;
			if (launch.admitted) {
				// Never reinterpret a failed accepted-domain check as a fresh refusal/retry state.
				if (this.retireIfOwned(operation, true)) {
					try {
						this.publishClosed();
					} catch {
						/* Preserve the failed accepted lifetime. */
					}
				}
				return false;
			}
			try {
				this.assertCurrent(operation, launch);
				this.restoreReady(
					operation,
					launch,
					error instanceof Error ? error.message : "연결/편집 준비를 완료하지 못했습니다",
				);
			} catch {
				return false;
			}
			return false;
		} finally {
			// A failed or replaced admission owns only its exact installed backend, never B.
			const cleanup = rollback.cleanup;
			rollback.cleanup = null;
			if (!acceptedNavigation && cleanup) {
				try {
					cleanup();
				} catch {
					/* Preserve failed navigation and still release preparation. */
				}
			}
			// Borrowed lookup/index belongs to the open. Only this captured launch task is cancelled.
			launch.preparation?.cancel();
			launch.preparation = null;
			if (this.owned(operation) && operation.launch === launch) operation.launch = null;
		}
	}

	private restoreReady(operation: OpenOperation, launch: LaunchOperation, reason: string): void {
		this.assertCurrent(operation, launch);
		this.publish(
			operation,
			Object.freeze({
				...operation.view,
				phase: "ready",
				launchStage: null,
				selectedSlots: this.selectedSlots(operation),
				reason,
			}),
			launch,
		);
	}

	private async query(operation: OpenOperation, input = operation.input): Promise<void> {
		this.assertInputCurrent(operation, input);
		const index = operation.index;
		if (!index) throw new StaticFabCheckRepairChooserError("CANCELLED");
		const task = index.query(input);
		try {
			this.assertInputCurrent(operation, input);
		} catch (error) {
			task.cancel();
			throw error;
		}
		const query: QueryOperation = { kind: "query", input, task };
		const previous = operation.query;
		operation.query = null;
		previous?.task.cancel();
		try {
			this.assertInputCurrent(operation, input);
		} catch (error) {
			task.cancel();
			throw error;
		}
		operation.query = query;
		try {
			this.publish(
				operation,
				Object.freeze({
					...operation.view,
					phase: "querying",
					launchStage: null,
					query: operation.input,
					selectedSlots: this.selectedSlots(operation),
					page: null,
					advice: null,
					reason: null,
				}),
				query,
			);
			const page = await this.drive(operation, query.task, query);
			this.assertCurrent(operation, query);
			const advice = this.resolve(operation);
			this.assertCurrent(operation, query);
			this.publish(
				operation,
				Object.freeze({
					...operation.view,
					phase: "ready",
					page,
					selectedSlots: this.selectedSlots(operation),
					advice,
					reason: null,
				}),
				query,
			);
		} catch (error) {
			if (!this.owned(operation) || operation.query !== query) return;
			if (this.retireIfOwned(operation, true)) {
				try {
					this.publishClosed();
				} catch {
					/* Keep the original query error. */
				}
			}
			throw error;
		} finally {
			if (this.owned(operation) && operation.query === query) {
				try {
					this.assertCurrent(operation, query);
					if (this.owned(operation) && operation.query === query) operation.query = null;
					this.assertCurrent(operation);
				} catch {
					this.retireIfOwned(operation, true);
				}
			}
		}
	}

	private resolve(operation: OpenOperation): StaticFabCheckRepairChooserAdvice {
		this.assertCurrent(operation);
		const metadata = operation.metadata;
		if (!metadata) throw new StaticFabCheckRepairChooserError("CANCELLED");
		const ids = operation.input.selectedOrganizationIds ?? [];
		const advice =
			operation.kind === "loop"
				? resolveStaticFabCheckLoopRepairTarget(
						operation.continuation.source.organizations,
						metadata,
						ids[0] ?? null,
					)
				: resolveStaticFabCheckConnectorRepairTarget(
						operation.continuation.source.organizations,
						metadata,
						ids,
					);
		this.assertCurrent(operation);
		return advice;
	}

	private selectedSlots(
		operation: OpenOperation,
		input = operation.input,
	): readonly StaticFabCheckRepairChooserSelectedSlot[] {
		this.assertInputCurrent(operation, input);
		const slots: StaticFabCheckRepairChooserSelectedSlot[] = [];
		for (const id of input.selectedOrganizationIds ?? []) {
			this.assertInputCurrent(operation, input);
			slots.push(
				operation.index
					? operation.index.resolveSelected(id)
					: Object.freeze({ status: "pending", organizationId: id }),
			);
			this.assertInputCurrent(operation, input);
		}
		return Object.freeze(slots);
	}

	private async drive<T>(
		operation: OpenOperation,
		task: SourceBoundCooperativeTask<T>,
		activity?: ChooserActivity,
		adopt?: (result: T) => void,
	): Promise<T> {
		await this.checkpoint(operation, activity);
		while (!task.done) {
			this.assertCurrent(operation, activity);
			const start = this.time(operation, activity);
			let operations = 0;
			while (!task.done && operations < STATIC_FAB_CHECK_REPAIR_CHOOSER_SLICE_OPERATIONS) {
				this.assertCurrent(operation, activity);
				const progressed = task.step(1);
				this.assertCurrent(operation, activity);
				if (!Number.isInteger(progressed) || progressed !== 1)
					throw new StaticFabCheckRepairChooserError("NO_PROGRESS");
				operations += progressed;
				const elapsed = this.time(operation, activity) - start;
				if (elapsed < 0) throw new StaticFabCheckRepairChooserError("INVALID_CLOCK");
				if (elapsed >= STATIC_FAB_CHECK_REPAIR_CHOOSER_SLICE_MILLISECONDS) break;
			}
			// Always yield after a positive slice, including with a stationary now() and tiny tasks.
			await this.checkpoint(operation, activity);
		}
		this.assertCurrent(operation, activity);
		const result = task.finish();
		adopt?.(result);
		this.assertCurrent(operation, activity);
		return result;
	}

	private async checkpoint(operation: OpenOperation, activity?: ChooserActivity): Promise<void> {
		this.assertCurrent(operation, activity);
		if (!operation.checkpoint) throw new StaticFabCheckRepairChooserError("CANCELLED");
		await operation.checkpoint();
		this.assertCurrent(operation, activity);
	}

	private time(operation: OpenOperation, activity?: ChooserActivity): number {
		this.assertCurrent(operation, activity);
		const now = this.ports.now();
		if (!Number.isFinite(now) || (operation.lastTime !== null && now < operation.lastTime))
			throw new StaticFabCheckRepairChooserError("INVALID_CLOCK");
		operation.lastTime = now;
		this.assertCurrent(operation, activity);
		return now;
	}

	private publish(
		operation: OpenOperation,
		view: StaticFabCheckRepairChooserView,
		activity?: ChooserActivity,
	): void {
		const input = activity?.input ?? operation.input;
		this.assertCurrent(operation, activity);
		if (operation.input !== input || view.query !== input) {
			if (activity) throw new StaticFabCheckRepairChooserError("CANCELLED");
			return; // A callback's newer query keeps its own view while open preparation continues.
		}
		operation.view = view;
		this.ports.publish(view);
		this.assertCurrent(operation, activity);
	}

	private requireOpen(): OpenOperation {
		const operation = this.operation;
		if (!operation || this.disposed) throw new StaticFabCheckRepairChooserError("CANCELLED");
		return operation;
	}

	private owned(operation: OpenOperation): boolean {
		return !this.disposed && this.operation === operation && this.openingIntent === operation.entry;
	}
	private activityOwned(operation: OpenOperation, activity?: ChooserActivity): boolean {
		return (
			this.owned(operation) &&
			!operation.token.consumed &&
			(!activity ||
				(operation.input === activity.input &&
					(activity.kind === "query"
						? operation.query === activity
						: operation.launch === activity)))
		);
	}

	private assertInputCurrent(
		operation: OpenOperation,
		input: StaticFabCheckRepairTargetQuery,
	): void {
		if (operation.input !== input) throw new StaticFabCheckRepairChooserError("CANCELLED");
		this.assertCurrent(operation);
		if (operation.input !== input) throw new StaticFabCheckRepairChooserError("CANCELLED");
	}

	private assertCurrent(operation: OpenOperation, activity?: ChooserActivity): void {
		if (!this.activityOwned(operation, activity))
			throw new StaticFabCheckRepairChooserError("CANCELLED");
		if (operation.checkingSource) throw new StaticFabCheckRepairChooserError("REENTRANT_SOURCE");
		let exact = false;
		try {
			operation.checkingSource = true;
			exact = staticFabCheckRepairCurrentIsExact(operation.continuation, this.ports.readCurrent());
			if (exact && this.activityOwned(operation, activity)) {
				// One bounded reread after getState; no new mirror callback or retry loop.
				exact = staticFabCheckRepairCurrentReceiptIsExact(
					operation.continuation,
					this.ports.readCurrent(),
				);
			}
		} catch (error) {
			operation.checkingSource = false;
			if (this.retireIfOwned(operation, true)) {
				try {
					this.publishClosed();
				} catch {
					/* Preserve the failed lifetime read. */
				}
			}
			throw error;
		} finally {
			operation.checkingSource = false;
		}
		if (!this.activityOwned(operation, activity))
			throw new StaticFabCheckRepairChooserError("CANCELLED");
		if (!exact) {
			// An observed stale generation is terminal even if a later reader restores old refs.
			const error = new StaticFabCheckRepairChooserError("STALE_SOURCE");
			this.retireIfOwned(operation, true);
			try {
				this.publishClosed();
			} catch {
				/* Preserve the original lifetime refusal. */
			}
			throw error;
		}
	}

	private assertDomainCurrent(operation: OpenOperation, launch: LaunchOperation): void {
		if (!launch.admitted || !this.activityOwned(operation, launch))
			throw new StaticFabCheckRepairChooserError("CANCELLED");
		if (operation.checkingSource) throw new StaticFabCheckRepairChooserError("REENTRANT_SOURCE");
		let exact = false;
		try {
			operation.checkingSource = true;
			exact = staticFabCheckRepairDomainIsExact(
				operation.continuation,
				this.ports.readDomainCurrent(),
			);
			if (exact && this.activityOwned(operation, launch)) {
				exact = staticFabCheckRepairDomainReceiptIsExact(
					operation.continuation,
					this.ports.readDomainCurrent(),
				);
			}
		} finally {
			operation.checkingSource = false;
		}
		if (!launch.admitted || !this.activityOwned(operation, launch))
			throw new StaticFabCheckRepairChooserError("CANCELLED");
		if (!exact) throw new StaticFabCheckRepairChooserError("STALE_SOURCE");
	}

	private navigationIsCurrent(operation: OpenOperation, launch: LaunchOperation): boolean {
		try {
			this.assertCurrent(operation, launch);
			return !launch.admitted && operation.view.launchStage === "admitting";
		} catch {
			return false;
		}
	}

	private cancelLaunch(operation: OpenOperation): void {
		const launch = operation.launch;
		operation.launch = null;
		launch?.preparation?.cancel();
	}

	private retireIfOwned(operation: OpenOperation, preservePrimaryFailure = false): boolean {
		const owned = this.operation === operation;
		if (owned) {
			this.operation = null;
			if (this.openingIntent === operation.entry) this.openingIntent = null;
		}
		try {
			this.release(operation);
		} catch (error) {
			if (!preservePrimaryFailure) throw error;
		}
		return owned;
	}

	private publishClosed(): void {
		if (this.operation !== null || this.openingIntent !== null) return;
		this.ports.publish(null);
		if (this.operation !== null || this.openingIntent !== null) return;
		// The post-callback identity check forbids any later cleanup of a replacement open.
	}

	private release(operation: OpenOperation): void {
		// Capture and detach every old resource before calling any foreign task cleanup.
		const launch = operation.launch;
		const launchTask = launch?.preparation;
		const queryTask = operation.query?.task;
		const preparation = operation.preparation;
		const index = operation.index;
		const metadata = operation.metadata;
		operation.launch = null;
		if (launch) launch.preparation = null;
		operation.query = null;
		operation.preparation = null;
		operation.index = null;
		operation.metadata = null;
		let failed = false;
		let failure: unknown;
		const cleanup = (action: () => void): void => {
			try {
				action();
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
		};
		if (launchTask) cleanup(() => launchTask.cancel());
		if (queryTask) cleanup(() => queryTask.cancel());
		if (preparation) cleanup(() => preparation.cancel());
		if (index) cleanup(() => index.dispose());
		else if (metadata) cleanup(() => metadata.revoke());
		if (failed) throw failure;
	}
}

function ownQuery(
	kind: StaticFabCheckRepairChooserKind,
	request: StaticFabCheckRepairTargetQuery,
): StaticFabCheckRepairTargetQuery {
	const searchText = request.searchText ?? "";
	const role: StaticFabCheckRepairTargetRole | "ALL" =
		request.role ?? (kind === "loop" ? "PROCESS_LOOP" : "ALL");
	const ids = request.selectedOrganizationIds ?? [];
	if (
		typeof searchText !== "string" ||
		searchText.length > STATIC_FAB_CHECK_REPAIR_TARGET_SEARCH_LENGTH_LIMIT ||
		!Array.isArray(ids) ||
		ids.length > (kind === "loop" ? 1 : 2) ||
		(kind === "loop" && role !== "PROCESS_LOOP") ||
		(kind === "connector" && role !== "ALL" && role !== "BAY" && role !== "BAY_BANK")
	) {
		throw new StaticFabCheckRepairChooserError("INVALID_QUERY");
	}
	const selectedIds: number[] = [];
	for (let index = 0; index < ids.length; index++) {
		const id = ids[index];
		if (!Number.isInteger(id) || id === undefined || id <= 0 || id >= 0x80000000)
			throw new StaticFabCheckRepairChooserError("INVALID_QUERY");
		selectedIds.push(id);
	}
	return Object.freeze({ searchText, role, selectedOrganizationIds: Object.freeze(selectedIds) });
}
