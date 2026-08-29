import { Ban, Check, KeyRound, LoaderCircle, ShieldCheck, ShieldX } from "lucide-react";
import { type ReactElement, useCallback, useState, useSyncExternalStore } from "react";
import type { BoundLiveSimulationReadinessPublication } from "./LiveSimulationReadiness";
import type {
	SimulationResidentScenarioEditorController,
	SimulationResidentScenarioEditorControllerState,
} from "./SimulationResidentScenarioEditorController";

export interface SimulationResidentScenarioRunAuthorizationCardProps {
	readonly controller: SimulationResidentScenarioEditorController;
	readonly readinessBinding: BoundLiveSimulationReadinessPublication | null;
	readonly setStatus: (message: string) => void;
}

export function SimulationResidentScenarioRunAuthorizationCard({
	controller,
	readinessBinding,
	setStatus,
}: SimulationResidentScenarioRunAuthorizationCardProps): ReactElement {
	const subscribe = useCallback(
		(listener: () => void) => controller.subscribe(listener),
		[controller],
	);
	const getSnapshot = useCallback(() => controller.getState(), [controller]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const [authorizing, setAuthorizing] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const prepared = state.session.phase === "PREPARED";
	const authorization = state.authorization;
	const runBusy = state.activeRun.phase === "ACTIVE" || state.activeRun.phase === "STARTING";
	const canAuthorize =
		readinessBinding !== null && prepared && authorization === null && !runBusy && !authorizing;

	const authorize = useCallback((): void => {
		if (!readinessBinding || !prepared || authorization || authorizing) return;
		setAuthorizing(true);
		setActionError(null);
		setStatus("현재 resident certificate와 exact source를 최종 재검사합니다");
		void controller
			.authorizeCurrentPrepared(readinessBinding.published)
			.then(() => setStatus("Resident home-return one-shot 실행 권한을 발급했습니다"))
			.catch((error: unknown) => {
				setActionError(normalizeErrorMessage(error));
				setStatus("Resident scenario 실행 권한을 발급하지 못했습니다");
			})
			.finally(() => setAuthorizing(false));
	}, [authorization, authorizing, controller, prepared, readinessBinding, setStatus]);

	const revoke = useCallback((): void => {
		controller.revokeAuthorization();
		setActionError(null);
		setStatus("Resident scenario one-shot 실행 권한을 폐기했습니다");
	}, [controller, setStatus]);

	return (
		<section
			className="tilefab-simulation-run-authorization"
			data-testid="simulation-resident-scenario-run-authorization"
			data-phase={authorizationPhase(state, readinessBinding, authorizing, actionError)}
			aria-label="Resident home-return scenario Run authorization"
		>
			<header>
				<span>
					{authorization || runBusy ? <ShieldCheck size={15} /> : <KeyRound size={15} />}
					<strong>RESIDENT AUTHORITY</strong>
				</span>
				<small>{authorizationLabel(state, readinessBinding, authorizing, actionError)}</small>
			</header>
			<p>
				prepared home-return chain을 별도 resident certificate에 다시 묶는 realm-local one-shot
				권한입니다. 발급만으로 차량 runtime이나 clock은 시작되지 않습니다.
			</p>
			{state.source ? (
				<dl>
					<div>
						<dt>SOURCE</dt>
						<dd>{state.source.sourceKind}</dd>
					</div>
					<div>
						<dt>REQUESTS / VEHICLES</dt>
						<dd>
							{authorization
								? `${authorization.requestCount.toLocaleString()} / ${authorization.vehicleCount.toLocaleString()}`
								: state.session.phase === "PREPARED"
									? `${state.session.requestCount.toLocaleString()} / ${state.session.vehicleCount.toLocaleString()}`
									: "LOCKED"}
						</dd>
					</div>
					<div>
						<dt>ACCEPTED / REJECTED</dt>
						<dd>
							{state.source.acceptedRecordCount.toLocaleString()} /{" "}
							{state.source.rejectedRecordCount.toLocaleString()}
						</dd>
					</div>
				</dl>
			) : null}
			{authorization?.readinessProfileId ? (
				<ul aria-label="Resident authorization limitations">
					<li>
						<Ban size={11} /> COMPLETE HOME RETURN · EXACT ASSIGNED VEHICLE ONLY
					</li>
					<li>
						<Ban size={11} /> NO MID-CYCLE REASSIGNMENT OR REPLAN
					</li>
				</ul>
			) : null}
			{actionError ? (
				<div className="tilefab-simulation-run-authorization-error" role="alert">
					<ShieldX size={13} /> <span>{actionError}</span>
				</div>
			) : null}
			<footer>
				<small>
					Nonpersistent and one-shot. Start consumes this exact capability after one final
					asynchronous source audit.
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
					{authorizing ? (
						<LoaderCircle size={13} className="tilefab-spin" />
					) : authorization || runBusy ? (
						<Check size={13} />
					) : (
						<KeyRound size={13} />
					)}
					{authorizing
						? "AUDITING SOURCE"
						: authorization
							? "RESIDENT AUTHORIZED"
							: runBusy
								? "AUTHORITY CONSUMED"
								: "AUTHORIZE RESIDENT RUN"}
				</button>
			</footer>
		</section>
	);
}

function authorizationPhase(
	state: SimulationResidentScenarioEditorControllerState,
	readinessBinding: BoundLiveSimulationReadinessPublication | null,
	authorizing: boolean,
	error: string | null,
): string {
	if (error) return "error";
	if (state.activeRun.phase === "ACTIVE" || state.activeRun.phase === "STARTING") return "active";
	if (authorizing) return "authorizing";
	if (state.authorization) return "authorized";
	if (state.session.phase === "PREPARED" && readinessBinding) return "prepared";
	if (state.session.phase === "INVALIDATED") return "invalidated";
	return "locked";
}

function authorizationLabel(
	state: SimulationResidentScenarioEditorControllerState,
	readinessBinding: BoundLiveSimulationReadinessPublication | null,
	authorizing: boolean,
	error: string | null,
): string {
	if (error) return "RESIDENT AUTHORIZATION FAILED";
	if (state.activeRun.phase === "STARTING") return "CONSUMING ONE-SHOT AUTHORITY";
	if (state.activeRun.phase === "ACTIVE") return "CONSUMED · RESIDENT RUN ACTIVE";
	if (authorizing) return "FINAL SOURCE AUDIT";
	if (state.authorization) return "AUTHORIZED · START READY";
	if (!readinessBinding) return "CURRENT CERTIFICATE REQUIRED";
	if (state.session.phase === "PREPARED") return "EXPLICIT APPROVAL REQUIRED";
	if (state.session.phase === "INVALIDATED") return "RESIDENT AUTHORITY REVOKED";
	return "RESIDENT PREPARATION REQUIRED";
}

function normalizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || error.message.length === 0) {
		return "Resident scenario Run authorization failed.";
	}
	return error.message.slice(0, 240);
}
