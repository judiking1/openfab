import { Ban, Check, KeyRound, ShieldCheck, ShieldX } from "lucide-react";
import { type ReactElement, useCallback, useState, useSyncExternalStore } from "react";
import type {
	LiveSimulationActiveRunOwner,
	LiveSimulationActiveRunOwnerState,
} from "./LiveSimulationActiveRunOwner";
import type { BoundLiveSimulationReadinessPublication } from "./LiveSimulationReadiness";
import type {
	LiveSimulationScenarioEditorController,
	LiveSimulationScenarioEditorControllerState,
} from "./LiveSimulationScenarioEditorController";

export interface SimulationScenarioRunAuthorizationCardProps {
	readonly controller: LiveSimulationScenarioEditorController;
	readonly activeRunOwner?: LiveSimulationActiveRunOwner;
	readonly readinessBinding: BoundLiveSimulationReadinessPublication | null;
	readonly setStatus: (message: string) => void;
}

export function SimulationScenarioRunAuthorizationCard({
	controller,
	activeRunOwner,
	readinessBinding,
	setStatus,
}: SimulationScenarioRunAuthorizationCardProps): ReactElement {
	const subscribe = useCallback(
		(listener: () => void) => controller.subscribe(listener),
		[controller],
	);
	const getSnapshot = useCallback(() => controller.getState(), [controller]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const subscribeActiveRun = useCallback(
		(listener: () => void) => activeRunOwner?.subscribe(listener) ?? (() => undefined),
		[activeRunOwner],
	);
	const getActiveRunSnapshot = useCallback(
		() => activeRunOwner?.getState() ?? NO_ACTIVE_RUN_STATE,
		[activeRunOwner],
	);
	const activeRunState = useSyncExternalStore(
		subscribeActiveRun,
		getActiveRunSnapshot,
		getActiveRunSnapshot,
	);
	const [actionError, setActionError] = useState<string | null>(null);
	const prepared = state.session.phase === "PREPARED";
	const authorization = state.authorization;
	const runActive = activeRunState.phase === "ACTIVE";
	const canAuthorize =
		readinessBinding !== null && prepared && authorization === null && !runActive;

	const authorize = useCallback((): void => {
		if (!readinessBinding || !prepared || authorization) return;
		setActionError(null);
		try {
			controller.authorizeCurrentPrepared(readinessBinding.published);
			setStatus("현재 인증 소스와 준비 artifact에 대한 제한 실행 권한을 발급했습니다");
		} catch (error) {
			setActionError(normalizeErrorMessage(error));
			setStatus("Simulation scenario 실행 권한을 발급하지 못했습니다");
		}
	}, [authorization, controller, prepared, readinessBinding, setStatus]);

	const revoke = useCallback((): void => {
		controller.revokeRunAuthorization();
		setActionError(null);
		setStatus("Simulation scenario 실행 권한을 폐기했습니다");
	}, [controller, setStatus]);

	const limitations =
		readinessBinding?.published.certificate.limitations ?? authorization?.limitations ?? [];
	return (
		<section
			className="tilefab-simulation-run-authorization"
			data-testid="simulation-scenario-run-authorization"
			data-phase={authorizationPhase(state, activeRunState, readinessBinding, actionError)}
			aria-label="Simulation scenario Run authorization"
		>
			<header>
				<span>
					{authorizationIcon(state, activeRunState, actionError)}
					<strong>RUN AUTHORIZATION</strong>
				</span>
				<small>{authorizationLabel(state, activeRunState, readinessBinding, actionError)}</small>
			</header>
			<p>
				현재 PREPARED bundle을 인증서와 run asset에 다시 묶는 로컬 one-shot 권한입니다. 권한
				발급만으로 scheduler를 만들거나 시간을 진행하지 않습니다.
			</p>
			{readinessBinding ? (
				<dl>
					<div>
						<dt>READINESS PROFILE</dt>
						<dd>{readinessBinding.published.certificate.readinessProfileId}</dd>
					</div>
					<div>
						<dt>SOURCE</dt>
						<dd>{state.source?.sourceKind ?? "NOT PREPARED"}</dd>
					</div>
					<div>
						<dt>REQUESTS / LOADS</dt>
						<dd>
							{authorization
								? `${authorization.requestCount.toLocaleString()} / ${authorization.loadCount.toLocaleString()}`
								: prepared
									? `${state.session.prepared.routes.requestCount.toLocaleString()} / ${state.session.prepared.admissionProgram.loadCount.toLocaleString()}`
									: "LOCKED"}
						</dd>
					</div>
				</dl>
			) : null}
			{limitations.length > 0 ? (
				<ul aria-label="Authorized readiness limitations">
					{limitations.map((limitation) => (
						<li key={limitation}>
							<Ban size={11} /> {limitationLabel(limitation)}
						</li>
					))}
				</ul>
			) : null}
			{actionError ? (
				<div className="tilefab-simulation-run-authorization-error" role="alert">
					<ShieldX size={13} /> <span>{actionError}</span>
				</div>
			) : null}
			<footer>
				<small>
					Nonpersistent and one-shot. Start remains locked until a separate run owner consumes this
					exact capability.
				</small>
				{authorization ? (
					<button type="button" className="tilefab-simulation-run-revoke" onClick={revoke}>
						<ShieldX size={13} /> REVOKE
					</button>
				) : null}
				<button
					type="button"
					className="tilefab-simulation-run-authorize"
					disabled={!canAuthorize}
					onClick={authorize}
				>
					{authorization || runActive ? <Check size={13} /> : <KeyRound size={13} />}
					{authorization
						? "AUTHORIZED"
						: runActive
							? "AUTHORITY CONSUMED"
							: "AUTHORIZE LIMITED RUN"}
				</button>
			</footer>
		</section>
	);
}

function authorizationPhase(
	state: LiveSimulationScenarioEditorControllerState,
	activeRunState: LiveSimulationActiveRunOwnerState,
	readinessBinding: BoundLiveSimulationReadinessPublication | null,
	error: string | null,
): string {
	if (error) return "error";
	if (activeRunState.phase === "ACTIVE") return "active";
	if (state.authorization) return "authorized";
	if (state.session.phase === "PREPARED" && readinessBinding) return "prepared";
	if (state.session.phase === "INVALIDATED") return "invalidated";
	return "locked";
}

function authorizationLabel(
	state: LiveSimulationScenarioEditorControllerState,
	activeRunState: LiveSimulationActiveRunOwnerState,
	readinessBinding: BoundLiveSimulationReadinessPublication | null,
	error: string | null,
): string {
	if (error) return "AUTHORIZATION FAILED";
	if (activeRunState.phase === "ACTIVE") return "CONSUMED · RUN ACTIVE";
	if (state.authorization) return "AUTHORIZED · START LOCKED";
	if (!readinessBinding) return "CERTIFICATE REQUIRED";
	if (state.session.phase === "PREPARED") return "EXPLICIT APPROVAL REQUIRED";
	if (state.session.phase === "INVALIDATED") return "AUTHORIZATION REVOKED";
	return "PREPARED BUNDLE REQUIRED";
}

const NO_ACTIVE_RUN_STATE: LiveSimulationActiveRunOwnerState = Object.freeze({
	phase: "IDLE",
	generation: 0,
});

function authorizationIcon(
	state: LiveSimulationScenarioEditorControllerState,
	activeRunState: LiveSimulationActiveRunOwnerState,
	error: string | null,
): ReactElement {
	if (error || state.session.phase === "INVALIDATED") return <ShieldX size={15} />;
	if (state.authorization || activeRunState.phase === "ACTIVE") return <ShieldCheck size={15} />;
	return <KeyRound size={15} />;
}

function limitationLabel(value: string): string {
	switch (value) {
		case "UNLAUNCHED_TRANSFER_TOKENS_ONLY":
			return "UNLAUNCHED TOKENS ONLY";
		case "NO_RESIDENT_FLEET":
			return "NO RESIDENT FLEET";
		case "NO_IDLE_TRACK_PARKING":
			return "NO IDLE TRACK PARKING";
		case "NO_MID_ROUTE_REPLAN":
			return "NO MID-ROUTE REPLAN";
		default:
			return value;
	}
}

function normalizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || error.message.length === 0) {
		return "Simulation scenario Run authorization failed.";
	}
	return error.message.slice(0, 240);
}
