import { Gauge, LoaderCircle, Pause, Play, ShieldX, Square } from "lucide-react";
import {
	type ChangeEvent,
	type ReactElement,
	useCallback,
	useState,
	useSyncExternalStore,
} from "react";
import {
	type SimulationResidentRuntimeCoreEventPresentation,
	type SimulationResidentRuntimeOutcomePresentation,
	type SimulationResidentRuntimeResourceEventPresentation,
	simulationResidentRuntimeOutcomePresentation,
} from "../render/SimulationResidentRuntimeOutcomePresentation";
import {
	DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS,
	type DeterministicResidentSpeedMultiplier,
} from "../simulation/DeterministicResidentRuntimeState";
import type {
	LiveSimulationActiveRunClock,
	LiveSimulationActiveRunClockState,
} from "./LiveSimulationActiveRunClock";
import type { LiveSimulationActiveRunOwner } from "./LiveSimulationActiveRunOwner";
import type {
	SimulationResidentScenarioEditorController,
	SimulationResidentScenarioEditorControllerState,
} from "./SimulationResidentScenarioEditorController";

export interface SimulationResidentScenarioActiveRunCardProps {
	readonly controller: SimulationResidentScenarioEditorController;
	readonly clock: LiveSimulationActiveRunClock;
	readonly setStatus: (message: string) => void;
	readonly incompatibleCurrentRun?: LiveSimulationActiveRunOwner;
}

export function SimulationResidentScenarioActiveRunCard({
	controller,
	clock,
	setStatus,
	incompatibleCurrentRun,
}: SimulationResidentScenarioActiveRunCardProps): ReactElement {
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
	const subscribeClock = useCallback((listener: () => void) => clock.subscribe(listener), [clock]);
	const getClockSnapshot = useCallback(() => clock.getState(), [clock]);
	const clockState = useSyncExternalStore(subscribeClock, getClockSnapshot, getClockSnapshot);
	const subscribeIncompatibleRun = useCallback(
		(listener: () => void) => incompatibleCurrentRun?.subscribe(listener) ?? (() => undefined),
		[incompatibleCurrentRun],
	);
	const getIncompatibleRunSnapshot = useCallback(
		() => incompatibleCurrentRun?.getState() ?? NO_CURRENT_RUN_STATE,
		[incompatibleCurrentRun],
	);
	const incompatibleRunState = useSyncExternalStore(
		subscribeIncompatibleRun,
		getIncompatibleRunSnapshot,
		getIncompatibleRunSnapshot,
	);
	const [selectedSpeed, setSelectedSpeed] = useState<DeterministicResidentSpeedMultiplier>(1);
	const [starting, setStarting] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const runState = controllerState.activeRun;
	const active = runState.phase === "ACTIVE";
	const incompatibleRunBusy = incompatibleRunState.phase === "ACTIVE";
	const canStart =
		!active &&
		runState.phase !== "STARTING" &&
		controllerState.authorization !== null &&
		!incompatibleRunBusy &&
		!starting;
	const visibleError =
		actionError ??
		(runState.phase === "FAILED" ? runState.message : null) ??
		(clockState.phase === "FAILED" ? clockState.message : null);

	const start = useCallback((): void => {
		if (!canStart) return;
		setStarting(true);
		setActionError(null);
		setStatus(`Resident home-return runtime을 ${selectedSpeed}x로 구성합니다`);
		void controller
			.start(selectedSpeed)
			.then((state) => {
				if (state.phase === "ACTIVE") {
					setStatus(
						`Resident runtime을 ${state.speedMultiplier}x 상태로 구성했습니다. Clock은 아직 시작하지 않았습니다`,
					);
				}
			})
			.catch((error: unknown) => {
				setActionError(normalizeErrorMessage(error));
				setStatus("Resident home-return runtime을 시작하지 못했습니다");
			})
			.finally(() => setStarting(false));
	}, [canStart, controller, selectedSpeed, setStatus]);

	const stop = useCallback((): void => {
		clock.stop();
		if (!controller.stop()) return;
		setActionError(null);
		setStatus("Resident runtime을 중지하고 차량·lease·publication state를 전부 폐기했습니다");
	}, [clock, controller, setStatus]);

	const toggleClock = useCallback((): void => {
		if (!active || runState.completed) return;
		setActionError(null);
		try {
			if (clockState.phase === "RUNNING") {
				clock.pause();
				setStatus("Resident simulation clock을 일시정지했습니다");
			} else if (clockState.phase === "PAUSED") {
				clock.resume();
				setStatus("Resident simulation clock을 명시적으로 재개했습니다");
			} else {
				clock.start();
				setStatus("가시 상태 bounded resident simulation clock을 시작했습니다");
			}
		} catch (error) {
			setActionError(normalizeErrorMessage(error));
			setStatus("Resident simulation clock 제어에 실패했습니다");
		}
	}, [active, clock, clockState.phase, runState, setStatus]);

	const changeSpeed = useCallback(
		(event: ChangeEvent<HTMLSelectElement>): void => {
			const speed = parseSpeedMultiplier(event.currentTarget.value);
			setSelectedSpeed(speed);
			if (controller.getState().activeRun.phase === "ACTIVE") {
				controller.setSpeedMultiplier(speed);
			}
		},
		[controller],
	);

	const visibleSpeed = active ? runState.speedMultiplier : selectedSpeed;
	return (
		<section
			className="tilefab-simulation-active-run"
			data-testid="simulation-resident-scenario-active-run"
			data-source-kind={active ? runState.sourceKind : "NONE"}
			data-clock-phase={clockState.phase}
			data-stop-reason={runState.phase === "STOPPED" ? runState.reason : ""}
			data-phase={activeRunPhase(
				controllerState,
				clockState,
				starting,
				incompatibleRunBusy,
				visibleError,
			)}
			aria-label="Resident home-return scenario active run"
		>
			<header className="tilefab-simulation-active-run-header">
				<span className="tilefab-simulation-active-run-title">
					{active ? <Gauge size={15} /> : <Play size={15} />}
					<strong className="tilefab-simulation-active-run-heading">RESIDENT RUN</strong>
				</span>
				<small className="tilefab-simulation-active-run-label">
					{activeRunLabel(controllerState, clockState, starting, incompatibleRunBusy, visibleError)}
				</small>
			</header>
			<p className="tilefab-simulation-active-run-summary">
				각 차량은 reviewed home에서 출발해 pickup·dropoff를 거친 뒤 같은 home으로 복귀합니다.
				complete-cycle track/switch lease는 복귀 완료 전까지 유지되며 renderer는 bounded
				publication만 소비합니다.
			</p>
			{active ? <ResidentActiveRunPresentation state={runState} clockState={clockState} /> : null}
			{runState.phase === "STOPPED" ? (
				<div className="tilefab-simulation-active-run-stop">
					<Square size={12} /> STOPPED · {runState.reason}
				</div>
			) : null}
			{visibleError ? (
				<div className="tilefab-simulation-active-run-error" role="alert">
					<ShieldX size={13} /> <span>{visibleError}</span>
				</div>
			) : null}
			<footer className="tilefab-simulation-active-run-footer">
				<label className="tilefab-simulation-active-run-speed">
					<span>SPEED</span>
					<select
						className="tilefab-simulation-active-run-speed-select"
						aria-label="Resident simulation speed"
						value={visibleSpeed}
						onChange={changeSpeed}
					>
						{DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS.map((speed) => (
							<option key={speed} value={speed}>
								{speed}x
							</option>
						))}
					</select>
				</label>
				<small className="tilefab-simulation-active-run-footnote">
					25 ms/frame · 100 ms backlog · hidden pause · explicit Resume · 1x-64x.
				</small>
				<div className="tilefab-simulation-active-run-controls">
					{active ? (
						<button
							type="button"
							className="tilefab-simulation-active-run-command tilefab-simulation-active-run-clock-button"
							disabled={runState.completed}
							onClick={toggleClock}
						>
							{clockState.phase === "RUNNING" ? <Pause size={12} /> : <Play size={12} />}
							{clockCommandLabel(clockState, runState.completed)}
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
						{starting || runState.phase === "STARTING" ? (
							<LoaderCircle size={12} className="tilefab-spin" />
						) : active ? (
							<Square size={12} />
						) : (
							<Play size={12} />
						)}
						{active
							? "STOP & DISCARD"
							: starting || runState.phase === "STARTING"
								? "STARTING RESIDENT"
								: "START RESIDENT RUNTIME"}
					</button>
				</div>
			</footer>
		</section>
	);
}

function ResidentActiveRunPresentation({
	state,
	clockState,
}: {
	readonly state: Extract<
		SimulationResidentScenarioEditorControllerState["activeRun"],
		{ phase: "ACTIVE" }
	>;
	readonly clockState: LiveSimulationActiveRunClockState;
}): ReactElement {
	const projected = simulationResidentRuntimeOutcomePresentation(state.latestPublication);
	const outcome = projected?.terminal === state.completed ? projected : null;
	return (
		<>
			<ResidentActiveRunFacts state={state} clockState={clockState} outcome={outcome} />
			{outcome ? <ResidentActiveRunEventTails outcome={outcome} /> : null}
		</>
	);
}

function ResidentActiveRunFacts({
	state,
	clockState,
	outcome,
}: {
	readonly state: Extract<
		SimulationResidentScenarioEditorControllerState["activeRun"],
		{ phase: "ACTIVE" }
	>;
	readonly clockState: LiveSimulationActiveRunClockState;
	readonly outcome: SimulationResidentRuntimeOutcomePresentation | null;
}): ReactElement {
	return (
		<dl
			className="tilefab-simulation-active-run-facts"
			data-testid="simulation-resident-runtime-kpis"
			data-publication-sequence={outcome?.publicationSequence ?? 0}
			data-request-completed={outcome?.requests.completed ?? 0}
			data-request-waiting-cycle={outcome?.requests.waitingCycleLease ?? 0}
			data-service-ready={outcome?.service.ready ?? 0}
			data-service-active={outcome?.service.active ?? 0}
			data-vehicle-idle={outcome?.vehicles.idleAtHome ?? 0}
			data-vehicle-waiting-cycle={outcome?.vehicles.waitingCycle ?? 0}
			data-vehicle-moving={outcome?.vehicles.moving ?? 0}
			data-non-home-track-owned={outcome?.resources.nonHomeTrackOwned ?? 0}
			data-switch-conflict-owned={outcome?.resources.switchConflictOwned ?? 0}
			data-storage-occupied={outcome?.resources.storageOccupied ?? 0}
			data-storage-reserved={outcome?.resources.storageReserved ?? 0}
			data-core-events={outcome?.coreEvents.total ?? 0}
			data-resource-events={outcome?.resourceEvents.total ?? 0}
			data-terminal={outcome?.terminal ?? false}
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
				<dt className="tilefab-simulation-active-run-fact-label">REQUESTS / VEHICLES</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{state.requestCount.toLocaleString()} / {state.vehicleCount.toLocaleString()}
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">CLOCK / SPEED</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{clockFactLabel(clockState)} · {state.speedMultiplier}x
				</dd>
			</div>
			{outcome ? <ResidentOutcomeFacts outcome={outcome} /> : <UnavailableResidentOutcomeFact />}
		</dl>
	);
}

function ResidentOutcomeFacts({
	outcome,
}: {
	readonly outcome: SimulationResidentRuntimeOutcomePresentation;
}): ReactElement {
	const activeMovement =
		outcome.requests.toPickup + outcome.requests.toDropoff + outcome.requests.returningHome;
	const queued = outcome.requests.waitingPredecessor + outcome.requests.waitingCycleLease;
	return (
		<>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">REQUEST OUTCOME</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{outcome.requests.completed.toLocaleString()} / {outcome.requests.total.toLocaleString()}{" "}
					COMPLETE
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">HOME-RETURN FLOW</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{activeMovement.toLocaleString()} MOVING · {queued.toLocaleString()} QUEUED ·{" "}
					{outcome.requests.waitingRelease.toLocaleString()} SCHEDULED
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">SERVICE OUTCOME</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{outcome.service.ready.toLocaleString()} READY · {outcome.service.active.toLocaleString()}{" "}
					ACTIVE · {outcome.service.queued.toLocaleString()} QUEUED
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">VEHICLES</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{outcome.vehicles.idleAtHome.toLocaleString()} HOME ·{" "}
					{outcome.vehicles.moving.toLocaleString()} MOVING ·{" "}
					{outcome.vehicles.waitingCycle.toLocaleString()} WAITING
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">CYCLE LEASES</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{outcome.resources.nonHomeTrackOwned.toLocaleString()} TRACK ·{" "}
					{outcome.resources.switchConflictOwned.toLocaleString()} SWITCH
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">OHB / STK STORAGE</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					{outcome.resources.storageOccupied.toLocaleString()} OCCUPIED ·{" "}
					{outcome.resources.storageReserved.toLocaleString()} RESERVED
				</dd>
			</div>
			<div className="tilefab-simulation-active-run-fact">
				<dt className="tilefab-simulation-active-run-fact-label">PUBLICATION / POSES</dt>
				<dd className="tilefab-simulation-active-run-fact-value">
					#{outcome.publicationSequence} / {outcome.poses.published.toLocaleString()}
					{outcome.poses.truncated ? " · TRUNCATED" : ""}
				</dd>
			</div>
		</>
	);
}

function UnavailableResidentOutcomeFact(): ReactElement {
	return (
		<div className="tilefab-simulation-active-run-fact tilefab-simulation-active-run-fact-wide">
			<dt className="tilefab-simulation-active-run-fact-label">RESIDENT OUTCOME</dt>
			<dd className="tilefab-simulation-active-run-fact-value">
				INVALID KPI / EVENT PUBLICATION · FAIL CLOSED
			</dd>
		</div>
	);
}

function ResidentActiveRunEventTails({
	outcome,
}: {
	readonly outcome: SimulationResidentRuntimeOutcomePresentation;
}): ReactElement {
	return (
		<section
			className="tilefab-simulation-active-run-events"
			data-testid="simulation-resident-runtime-events"
			data-core-event-count={outcome.coreEvents.total}
			data-core-events-truncated={outcome.coreEvents.truncated}
			data-resource-event-count={outcome.resourceEvents.total}
			data-resource-events-truncated={outcome.resourceEvents.truncated}
			aria-label="Recent resident simulation events"
		>
			<header>
				<strong>RECENT RESIDENT EVENTS</strong>
				<small>PUBLICATION TAIL · READ ONLY · MAX 8 / STREAM</small>
			</header>
			<div className="tilefab-simulation-active-run-event-streams">
				<ResidentEventStream label="CORE" stream={outcome.coreEvents} />
				<ResidentEventStream label="RESOURCE" stream={outcome.resourceEvents} />
			</div>
		</section>
	);
}

function ResidentEventStream({
	label,
	stream,
}: {
	readonly label: "CORE" | "RESOURCE";
	readonly stream:
		| SimulationResidentRuntimeOutcomePresentation["coreEvents"]
		| SimulationResidentRuntimeOutcomePresentation["resourceEvents"];
}): ReactElement {
	return (
		<section aria-label={`${label.toLowerCase()} resident event stream`}>
			<header>
				<strong>{label}</strong>
				<small>
					{stream.rows.length.toLocaleString()} / {stream.total.toLocaleString()} SHOWN
					{stream.truncated ? " · TRUNCATED" : ""}
				</small>
			</header>
			{stream.rows.length > 0 ? (
				<ol>
					{stream.rows.map((event) => (
						<li key={`${label}:${event.sequence}`}>
							<span>
								<strong>
									#{event.sequence.toLocaleString()} · {event.type.replaceAll("_", " ")}
								</strong>
								<small>{residentEventIdentity(event)}</small>
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

function residentEventIdentity(
	event:
		| SimulationResidentRuntimeCoreEventPresentation
		| SimulationResidentRuntimeResourceEventPresentation,
): string {
	const request = `REQUEST ${event.requestRow + 1}`;
	return "resourceRow" in event ? `${request} · RESOURCE ${event.resourceRow + 1}` : request;
}

function activeRunPhase(
	state: SimulationResidentScenarioEditorControllerState,
	clockState: LiveSimulationActiveRunClockState,
	starting: boolean,
	incompatibleRunBusy: boolean,
	error: string | null,
): string {
	if (error) return "error";
	if (state.activeRun.phase === "STARTING" || starting) return "starting";
	if (state.activeRun.phase === "STOPPED") return "stopped";
	if (incompatibleRunBusy) return "locked";
	if (state.activeRun.phase !== "ACTIVE") return state.authorization ? "authorized" : "waiting";
	if (state.activeRun.completed) return "completed";
	if (clockState.phase === "RUNNING") return "running";
	if (clockState.phase === "PAUSED") return "paused";
	return "active";
}

function activeRunLabel(
	state: SimulationResidentScenarioEditorControllerState,
	clockState: LiveSimulationActiveRunClockState,
	starting: boolean,
	incompatibleRunBusy: boolean,
	error: string | null,
): string {
	if (error) return clockState.phase === "FAILED" ? "RESIDENT CLOCK FAILED" : "RESIDENT RUN FAILED";
	if (state.activeRun.phase === "STARTING" || starting) return "CONSUMING AUTHORITY";
	if (state.activeRun.phase === "STOPPED") return `STOPPED · ${state.activeRun.reason}`;
	if (incompatibleRunBusy) return "CURRENT FROM-TO RUN ACTIVE";
	if (state.activeRun.phase !== "ACTIVE") {
		return state.authorization ? "AUTHORIZED · START READY" : "ONE-SHOT AUTHORIZATION REQUIRED";
	}
	if (state.activeRun.completed) return "COMPLETE · ALL VEHICLES HOME";
	if (clockState.phase === "RUNNING") return `RUNNING · ${state.activeRun.speedMultiplier}x`;
	if (clockState.phase === "PAUSED") return `PAUSED · ${clockState.reason}`;
	return `READY · ${state.activeRun.speedMultiplier}x · CLOCK STOPPED`;
}

const NO_CURRENT_RUN_STATE = Object.freeze({ phase: "IDLE" as const, generation: 0 as const });

function clockCommandLabel(state: LiveSimulationActiveRunClockState, completed: boolean): string {
	if (completed) return "COMPLETE";
	if (state.phase === "RUNNING") return "PAUSE CLOCK";
	if (state.phase === "PAUSED") return "RESUME CLOCK";
	return "RUN CLOCK";
}

function clockFactLabel(state: LiveSimulationActiveRunClockState): string {
	if (state.phase === "RUNNING") return "RUNNING";
	if (state.phase === "PAUSED") return `PAUSED:${state.reason}`;
	if (state.phase === "STOPPED") return `STOPPED:${state.reason}`;
	if (state.phase === "FAILED") return "FAILED";
	return "IDLE";
}

function parseSpeedMultiplier(value: string): DeterministicResidentSpeedMultiplier {
	const speed = Number(value);
	if (!DETERMINISTIC_RESIDENT_SPEED_MULTIPLIERS.includes(speed as never)) {
		throw new RangeError("Resident simulation speed multiplier is invalid.");
	}
	return speed as DeterministicResidentSpeedMultiplier;
}

function formatSimulationTime(microseconds: number): string {
	return `${(microseconds / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 3 })} s`;
}

function normalizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || error.message.length === 0) {
		return "Resident scenario active run failed.";
	}
	return error.message.slice(0, 240);
}
