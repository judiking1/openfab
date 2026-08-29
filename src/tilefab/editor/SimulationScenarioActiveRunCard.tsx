import { Gauge, Pause, Play, ShieldX, Square } from "lucide-react";
import {
	type ChangeEvent,
	type ReactElement,
	useCallback,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type SimulationRuntimeKpiPresentation,
	simulationRuntimeKpiPresentation,
} from "../render/SimulationRuntimeKpiPresentation";
import type { DeterministicResidentActiveRunOwner } from "../simulation/DeterministicResidentActiveRunOwner";
import {
	DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS,
	type DeterministicScenarioSpeedMultiplier,
} from "../simulation/DeterministicScenarioMotionScheduler";
import type { DeterministicScenarioRuntimeEventWindow } from "../simulation/DeterministicScenarioRuntimeEventWindow";
import type {
	LiveSimulationActiveRunClock,
	LiveSimulationActiveRunClockState,
} from "./LiveSimulationActiveRunClock";
import type {
	LiveSimulationActiveRunOwner,
	LiveSimulationActiveRunOwnerState,
} from "./LiveSimulationActiveRunOwner";
import type { BoundLiveSimulationReadinessPublication } from "./LiveSimulationReadiness";
import type {
	LiveSimulationScenarioEditorController,
	LiveSimulationScenarioEditorControllerState,
} from "./LiveSimulationScenarioEditorController";

export interface SimulationScenarioActiveRunCardProps {
	readonly owner: LiveSimulationActiveRunOwner;
	readonly clock: LiveSimulationActiveRunClock;
	readonly controller: LiveSimulationScenarioEditorController;
	readonly readinessBinding: BoundLiveSimulationReadinessPublication | null;
	readonly setStatus: (message: string) => void;
	readonly incompatibleResidentRun?: DeterministicResidentActiveRunOwner;
}

export function SimulationScenarioActiveRunCard({
	owner,
	clock,
	controller,
	readinessBinding,
	setStatus,
	incompatibleResidentRun,
}: SimulationScenarioActiveRunCardProps): ReactElement {
	const subscribeOwner = useCallback((listener: () => void) => owner.subscribe(listener), [owner]);
	const getOwnerSnapshot = useCallback(() => owner.getState(), [owner]);
	const ownerState = useSyncExternalStore(subscribeOwner, getOwnerSnapshot, getOwnerSnapshot);
	const subscribeClock = useCallback((listener: () => void) => clock.subscribe(listener), [clock]);
	const getClockSnapshot = useCallback(() => clock.getState(), [clock]);
	const clockState = useSyncExternalStore(subscribeClock, getClockSnapshot, getClockSnapshot);
	const subscribeController = useCallback(
		(listener: () => void) => controller.subscribe(listener),
		[controller],
	);
	const getControllerSnapshot = useCallback(() => controller.getState(), [controller]);
	const controllerState = useSyncExternalStore(
		subscribeController,
		getControllerSnapshot,
		getControllerSnapshot,
	);
	const subscribeIncompatibleRun = useCallback(
		(listener: () => void) => incompatibleResidentRun?.subscribe(listener) ?? (() => undefined),
		[incompatibleResidentRun],
	);
	const getIncompatibleRunSnapshot = useCallback(
		() => incompatibleResidentRun?.getState() ?? NO_RESIDENT_RUN_STATE,
		[incompatibleResidentRun],
	);
	const incompatibleRunState = useSyncExternalStore(
		subscribeIncompatibleRun,
		getIncompatibleRunSnapshot,
		getIncompatibleRunSnapshot,
	);
	const [selectedSpeed, setSelectedSpeed] = useState<DeterministicScenarioSpeedMultiplier>(1);
	const [actionError, setActionError] = useState<string | null>(null);
	const active = ownerState.phase === "ACTIVE";
	const eventWindow = active ? owner.getLatestEventWindow() : null;
	const incompatibleRunBusy =
		incompatibleRunState.phase === "STARTING" || incompatibleRunState.phase === "ACTIVE";
	const canStart =
		!active &&
		!incompatibleRunBusy &&
		readinessBinding !== null &&
		controllerState.authorization !== null;
	const visibleError =
		actionError ??
		(ownerState.phase === "FAILED" ? ownerState.message : null) ??
		(clockState.phase === "FAILED" ? clockState.message : null);

	const start = useCallback((): void => {
		if (!canStart || !readinessBinding) return;
		setActionError(null);
		try {
			owner.start(readinessBinding.published, selectedSpeed);
			setStatus(
				`제한 scenario runtime을 ${selectedSpeed}x 상태로 구성했습니다. 자동 clock은 아직 시작하지 않습니다`,
			);
		} catch (error) {
			setActionError(normalizeErrorMessage(error));
			setStatus("Simulation scenario runtime을 시작하지 못했습니다");
		}
	}, [canStart, owner, readinessBinding, selectedSpeed, setStatus]);

	const stop = useCallback((): void => {
		clock.stop();
		if (!owner.stop()) return;
		setActionError(null);
		setStatus("활성 simulation runtime을 중지하고 전부 폐기했습니다");
	}, [clock, owner, setStatus]);

	const toggleClock = useCallback((): void => {
		if (!active || ownerState.completed) return;
		setActionError(null);
		try {
			if (clockState.phase === "RUNNING") {
				clock.pause();
				setStatus("Simulation clock을 일시정지했습니다");
			} else if (clockState.phase === "PAUSED") {
				clock.resume();
				setStatus("Simulation clock을 명시적으로 재개했습니다");
			} else {
				clock.start();
				setStatus("가시 상태 bounded simulation clock을 시작했습니다");
			}
		} catch (error) {
			setActionError(normalizeErrorMessage(error));
			setStatus("Simulation clock 제어에 실패했습니다");
		}
	}, [active, clock, clockState.phase, ownerState, setStatus]);

	const changeSpeed = useCallback(
		(event: ChangeEvent<HTMLSelectElement>): void => {
			const speed = parseSpeedMultiplier(event.currentTarget.value);
			setSelectedSpeed(speed);
			if (owner.getState().phase === "ACTIVE") owner.setSpeedMultiplier(speed);
		},
		[owner],
	);

	const visibleSpeed = active ? ownerState.speedMultiplier : selectedSpeed;
	return (
		<section
			className="tilefab-simulation-active-run"
			data-testid="simulation-scenario-active-run"
			data-source-kind={active ? ownerState.sourceKind : "NONE"}
			data-phase={activeRunPhase(
				ownerState,
				clockState,
				controllerState,
				readinessBinding,
				incompatibleRunBusy,
				visibleError,
			)}
			aria-label="Simulation scenario active run"
		>
			<header className="tilefab-simulation-active-run-header">
				<span className="tilefab-simulation-active-run-title">
					{active ? <Gauge size={15} /> : <Play size={15} />}
					<strong className="tilefab-simulation-active-run-heading">ACTIVE RUN</strong>
				</span>
				<small className="tilefab-simulation-active-run-label">
					{activeRunLabel(
						ownerState,
						clockState,
						controllerState,
						readinessBinding,
						incompatibleRunBusy,
						visibleError,
					)}
				</small>
			</header>
			<p className="tilefab-simulation-active-run-summary">
				one-shot 권한을 소비해 인증된 scheduler, EQ/OHB/STK resource state, bounded publication만
				구성합니다. Clock은 visible frame에서만 제한적으로 진행되며 hidden 복귀는 명시적으로
				재개해야 합니다.
			</p>
			{active ? (
				<>
					<ActiveRunFacts state={ownerState} clockState={clockState} />
					{eventWindow ? <ActiveRunEventWindow window={eventWindow} /> : null}
				</>
			) : null}
			{ownerState.phase === "STOPPED" ? (
				<div className="tilefab-simulation-active-run-stop">
					<Square size={12} /> STOPPED · {ownerState.reason}
				</div>
			) : null}
			{visibleError ? (
				<div className="tilefab-simulation-active-run-error" role="alert">
					<ShieldX size={13} />
					<span>{visibleError}</span>
				</div>
			) : null}
			<footer className="tilefab-simulation-active-run-footer">
				<label className="tilefab-simulation-active-run-speed">
					<span>SPEED</span>
					<select
						className="tilefab-simulation-active-run-speed-select"
						aria-label="Simulation speed"
						value={visibleSpeed}
						onChange={changeSpeed}
					>
						{DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS.map((speed) => (
							<option key={speed} value={speed}>
								{speed}x
							</option>
						))}
					</select>
				</label>
				<small className="tilefab-simulation-active-run-footnote">
					25 ms/frame · 100 ms backlog · hidden pause · no background catch-up.
				</small>
				<div className="tilefab-simulation-active-run-controls">
					{active ? (
						<button
							type="button"
							className="tilefab-simulation-active-run-command tilefab-simulation-active-run-clock-button"
							disabled={ownerState.completed}
							onClick={toggleClock}
						>
							{clockState.phase === "RUNNING" ? <Pause size={12} /> : <Play size={12} />}
							{clockCommandLabel(clockState, ownerState.completed)}
						</button>
					) : null}
					<button
						type="button"
						className={`tilefab-simulation-active-run-command ${
							active
								? "tilefab-simulation-active-run-stop-button"
								: "tilefab-simulation-active-run-start"
						}`}
						disabled={!active && !canStart}
						onClick={active ? stop : start}
					>
						{active ? <Square size={12} /> : <Play size={12} />}
						{active ? "STOP & DISCARD" : "START SAFE RUNTIME"}
					</button>
				</div>
			</footer>
		</section>
	);
}

function ActiveRunFacts({
	state,
	clockState,
}: {
	readonly state: Extract<LiveSimulationActiveRunOwnerState, { phase: "ACTIVE" }>;
	readonly clockState: LiveSimulationActiveRunClockState;
}): ReactElement {
	const kpis = simulationRuntimeKpiPresentation(state.latestPublication);
	return (
		<dl
			className="tilefab-simulation-active-run-facts"
			data-testid="simulation-runtime-kpis"
			data-publication-sequence={kpis?.publicationSequence ?? 0}
			data-request-completed={kpis?.requests.completed ?? 0}
			data-request-in-transit={kpis?.requests.inTransit ?? 0}
			data-service-ready={kpis?.destinationService.ready ?? 0}
			data-service-active={kpis?.destinationService.inService ?? 0}
			data-eq-destination-requests={kpis?.eq.destinationRequests ?? 0}
			data-eq-ready={kpis?.eq.ready ?? 0}
			data-eq-active={kpis?.eq.active ?? 0}
			data-storage-resources={kpis?.storage.resourceCount ?? 0}
			data-storage-occupied={kpis?.storage.occupiedUnits ?? 0}
			data-storage-reserved={kpis?.storage.reservedUnits ?? 0}
			data-core-events={kpis?.events.core ?? 0}
			data-resource-events={kpis?.events.resource ?? 0}
			data-terminal={kpis?.terminal ?? false}
		>
			<div className="tilefab-simulation-active-run-fact tilefab-simulation-active-run-fact-wide">
				<dt className="tilefab-simulation-active-run-fact-label">SOURCE / PROFILE</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{state.sourceKind} · {state.readinessProfileId}
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">SIMULATION TIME</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{formatSimulationTime(state.sampledSimulationTimeMicroseconds)}
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">REQUESTS / LOADS</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{state.requestCount.toLocaleString()} / {state.loadCount.toLocaleString()}
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">CLOCK</dt>
				<dd className="tilefab-simulation-active-run-fact-value">{clockFactLabel(clockState)}</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">PUBLICATION / POSES</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					#{state.latestPublication.sequence} /{" "}
					{state.latestPublication.publishedPoseCount.toLocaleString()}
				</dd>
			</div>
			{kpis ? <ActiveRunKpiFacts kpis={kpis} /> : <UnavailableKpiFact />}
		</dl>
	);
}

function ActiveRunEventWindow({
	window,
}: {
	readonly window: DeterministicScenarioRuntimeEventWindow;
}): ReactElement {
	return (
		<section
			className="tilefab-simulation-active-run-events"
			data-testid="simulation-runtime-events"
			data-core-event-count={window.coreEventCount}
			data-core-window-start={window.coreStartIndex}
			data-resource-event-count={window.resourceEventCount}
			data-resource-window-start={window.resourceStartIndex}
			aria-label="Recent simulation events"
		>
			<header>
				<strong>RECENT CANONICAL EVENTS</strong>
				<small>PUBLICATION-ALIGNED · READ ONLY</small>
			</header>
			<div className="tilefab-simulation-active-run-event-streams">
				<RuntimeEventStream label="CORE" total={window.coreEventCount} rows={window.coreRows} />
				<RuntimeEventStream
					label="RESOURCE"
					total={window.resourceEventCount}
					rows={window.resourceRows}
				/>
			</div>
		</section>
	);
}

function RuntimeEventStream({
	label,
	total,
	rows,
}: {
	readonly label: "CORE" | "RESOURCE";
	readonly total: number;
	readonly rows:
		| DeterministicScenarioRuntimeEventWindow["coreRows"]
		| DeterministicScenarioRuntimeEventWindow["resourceRows"];
}): ReactElement {
	return (
		<section aria-label={`${label.toLowerCase()} event stream`}>
			<header>
				<strong>{label}</strong>
				<small>{total.toLocaleString()} TOTAL</small>
			</header>
			{rows.length > 0 ? (
				<ol>
					{rows.map((event) => (
						<li key={`${label}:${event.sequence}`}>
							<span>
								<strong>
									#{event.sequence.toLocaleString()} · {event.type.replaceAll("_", " ")}
								</strong>
								<small>
									{event.recordId} · {event.loadId} · PORT {event.sourcePortId.toLocaleString()} →{" "}
									{event.destinationPortId.toLocaleString()}
								</small>
							</span>
							<time>{formatSimulationTime(event.timeMicroseconds)}</time>
						</li>
					))}
				</ol>
			) : (
				<p>NO {label} EVENTS</p>
			)}
		</section>
	);
}

function ActiveRunKpiFacts({
	kpis,
}: {
	readonly kpis: SimulationRuntimeKpiPresentation;
}): ReactElement {
	return (
		<>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">REQUEST OUTCOME</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{kpis.requests.completed.toLocaleString()} / {kpis.requests.total.toLocaleString()}{" "}
					COMPLETE
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">ACTIVE FLOW</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{kpis.requests.inTransit.toLocaleString()} TRANSIT ·{" "}
					{kpis.requests.queued.toLocaleString()} QUEUED ·{" "}
					{kpis.requests.waitingRelease.toLocaleString()} SCHEDULED
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">SERVICE OUTCOME</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{kpis.destinationService.ready.toLocaleString()} READY ·{" "}
					{kpis.destinationService.inService.toLocaleString()} ACTIVE
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">EQ OUTCOME</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{kpis.eq.ready.toLocaleString()} / {kpis.eq.destinationRequests.toLocaleString()} READY ·{" "}
					{kpis.eq.active.toLocaleString()} ACTIVE
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">STORAGE</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{kpis.storage.occupiedUnits.toLocaleString()} OCCUPIED ·{" "}
					{kpis.storage.reservedUnits.toLocaleString()} RESERVED ·{" "}
					{kpis.storage.resourceCount.toLocaleString()} RESOURCE
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">EVENTS</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{kpis.events.core.toLocaleString()} CORE · {kpis.events.resource.toLocaleString()}{" "}
					RESOURCE
				</dd>
			</div>
		</>
	);
}

function UnavailableKpiFact(): ReactElement {
	return (
		<div className="tilefab-simulation-active-run-fact tilefab-simulation-active-run-fact-wide">
			<dt className="tilefab-simulation-active-run-fact-label">LIVE OUTCOME</dt>
			<dd className="tilefab-simulation-active-run-fact-value">
				INVALID KPI PUBLICATION · FAIL CLOSED
			</dd>
		</div>
	);
}

function activeRunPhase(
	state: LiveSimulationActiveRunOwnerState,
	clockState: LiveSimulationActiveRunClockState,
	controllerState: LiveSimulationScenarioEditorControllerState,
	readinessBinding: BoundLiveSimulationReadinessPublication | null,
	incompatibleRunBusy: boolean,
	error: string | null,
): string {
	if (error || state.phase === "FAILED") return "error";
	if (state.phase === "ACTIVE") {
		if (state.completed) return "completed";
		if (clockState.phase === "RUNNING") return "running";
		if (clockState.phase === "PAUSED") return "paused";
		return "active";
	}
	if (state.phase === "STOPPED") return "stopped";
	if (incompatibleRunBusy) return "locked";
	if (!readinessBinding) return "locked";
	return controllerState.authorization ? "authorized" : "waiting";
}

function activeRunLabel(
	state: LiveSimulationActiveRunOwnerState,
	clockState: LiveSimulationActiveRunClockState,
	controllerState: LiveSimulationScenarioEditorControllerState,
	readinessBinding: BoundLiveSimulationReadinessPublication | null,
	incompatibleRunBusy: boolean,
	error: string | null,
): string {
	if (state.phase === "FAILED") return "START FAILED";
	if (error) {
		return state.phase === "ACTIVE" && clockState.phase === "FAILED"
			? "CLOCK FAILED"
			: "CONTROL FAILED";
	}
	if (state.phase === "ACTIVE") {
		if (state.completed) return "COMPLETE · STOP TO DISCARD";
		if (clockState.phase === "RUNNING") return `RUNNING · ${state.speedMultiplier}x`;
		if (clockState.phase === "PAUSED") return `PAUSED · ${clockState.reason}`;
		return "ACTIVE · CLOCK READY";
	}
	if (state.phase === "STOPPED") return `STOPPED · ${state.reason}`;
	if (incompatibleRunBusy) return "RESIDENT PROFILE RUN ACTIVE";
	if (!readinessBinding) return "CERTIFICATE REQUIRED";
	return controllerState.authorization
		? "AUTHORIZED · START READY"
		: "ONE-SHOT AUTHORIZATION REQUIRED";
}

const NO_RESIDENT_RUN_STATE = Object.freeze({ phase: "IDLE" as const, generation: 0 as const });

function clockCommandLabel(state: LiveSimulationActiveRunClockState, completed: boolean): string {
	if (completed) return "RUN COMPLETE";
	if (state.phase === "RUNNING") return "PAUSE CLOCK";
	if (state.phase === "PAUSED") return "RESUME CLOCK";
	return "RUN CLOCK";
}

function clockFactLabel(state: LiveSimulationActiveRunClockState): string {
	if (state.phase === "PAUSED") return `${state.phase} · ${state.reason}`;
	if (state.phase === "STOPPED") return `${state.phase} · ${state.reason}`;
	return state.phase;
}

function parseSpeedMultiplier(value: string): DeterministicScenarioSpeedMultiplier {
	const parsed = Number(value);
	if (!(DETERMINISTIC_SCENARIO_SPEED_MULTIPLIERS as readonly number[]).includes(parsed)) {
		throw new RangeError("Simulation speed selection is invalid.");
	}
	return parsed as DeterministicScenarioSpeedMultiplier;
}

function formatSimulationTime(microseconds: number): string {
	return `${(microseconds / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 })} s`;
}

function normalizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || error.message.length === 0) {
		return "Simulation scenario active-run construction failed.";
	}
	return error.message.slice(0, 240);
}
