import {
	AlertTriangle,
	ArrowLeftRight,
	Check,
	ChevronLeft,
	ChevronRight,
	MapPin,
	Network,
	RefreshCcw,
	X,
} from "lucide-react";
import { type Ref, useEffect, useId, useRef } from "react";
import type { RailModuleSide } from "../core/RailModulePlanner";
import type {
	StaticFabAssemblyConnectorHierarchyRole,
	StaticFabAssemblyConnectorPurpose,
} from "../core/StaticFabAssemblyConnector";
import { EditorInputCue } from "./EditorInputCue";
import {
	cycleConnectorSide,
	parseConnectorCandidateIndex,
	type StaticFabAssemblyConnectorRecoveryTarget,
	staticFabAssemblyConnectorRecoveryPrompt,
} from "./StaticFabAssemblyConnectorPanelHelpers";

export type StaticFabAssemblyConnectorPanelPhase =
	| "idle"
	| "pick-source-gateway"
	| "pick-target-gateway"
	| "verifying"
	| "ready"
	| "rejected"
	| "applying";

export interface StaticFabAssemblyConnectorPanelCandidate {
	readonly id: string;
	readonly label: string;
	readonly detail?: string;
	readonly disabled?: boolean;
}

export interface StaticFabAssemblyConnectorPanelResult {
	readonly hierarchyRole: StaticFabAssemblyConnectorHierarchyRole;
	readonly purpose: StaticFabAssemblyConnectorPurpose;
	readonly outboundLengthMeters: number;
	readonly returnLengthMeters: number;
	readonly railChangeCount: number;
	readonly organizationChangeCount: number;
	readonly parentAction: "create" | "extend";
	readonly parentName?: string | null;
}

export interface StaticFabAssemblyConnectorPanelTimings {
	readonly workerRoundTripMilliseconds: number | null;
	readonly responseValidationMilliseconds: number | null;
	readonly adoptionMilliseconds: number | null;
}

export interface StaticFabAssemblyConnectorPanelProps {
	readonly phase: StaticFabAssemblyConnectorPanelPhase;
	readonly hierarchyRole: StaticFabAssemblyConnectorHierarchyRole;
	readonly purpose: StaticFabAssemblyConnectorPurpose;
	readonly sourceBayName: string | null;
	readonly sourceGatewayLabel: string | null;
	readonly targetBayName: string | null;
	readonly targetGatewayLabel: string | null;
	readonly sourceCandidates: readonly StaticFabAssemblyConnectorPanelCandidate[];
	readonly sourceCandidateIndex: number | null;
	readonly targetCandidates: readonly StaticFabAssemblyConnectorPanelCandidate[];
	readonly targetCandidateIndex: number | null;
	readonly side: RailModuleSide | null;
	readonly result: StaticFabAssemblyConnectorPanelResult | null;
	readonly reason: string | null;
	readonly conflictCount: number;
	readonly issueCode: string | null;
	readonly timings: StaticFabAssemblyConnectorPanelTimings | null;
	readonly recoveryTarget: StaticFabAssemblyConnectorRecoveryTarget | null;
	readonly recoveryAutomaticRecommendationAttempts: number;
	readonly guidedApplyActionId?: string | null;
	readonly guidedApplyDescriptionId?: string;
	readonly onSelectSource: (index: number) => void;
	readonly onSelectTarget: (index: number) => void;
	readonly onCycleSource: (step: -1 | 1) => void;
	readonly onCycleTarget: (step: -1 | 1) => void;
	readonly onSide: (side: RailModuleSide | null) => void;
	readonly onApply: () => void;
	readonly onCancel: () => void;
}

const CONTROL_SIZE = Object.freeze({ minHeight: 44 });
const ICON_CONTROL_SIZE = Object.freeze({ minWidth: 44, minHeight: 44 });

export function StaticFabAssemblyConnectorPanel({
	phase,
	hierarchyRole,
	purpose,
	sourceBayName,
	sourceGatewayLabel,
	targetBayName,
	targetGatewayLabel,
	sourceCandidates,
	sourceCandidateIndex,
	targetCandidates,
	targetCandidateIndex,
	side,
	result,
	reason,
	conflictCount,
	issueCode,
	timings,
	recoveryTarget,
	recoveryAutomaticRecommendationAttempts,
	guidedApplyActionId = null,
	guidedApplyDescriptionId,
	onSelectSource,
	onSelectTarget,
	onCycleSource,
	onCycleTarget,
	onSide,
	onApply,
	onCancel,
}: StaticFabAssemblyConnectorPanelProps): React.ReactElement | null {
	const titleId = useId();
	const statusId = useId();
	const sourceSelectId = useId();
	const targetSelectId = useId();
	const recoveryDescriptionId = useId();
	const sourceSelectRef = useRef<HTMLSelectElement>(null);
	const recoveryTargetRef = useRef<HTMLButtonElement>(null);
	const focusedForOpenRef = useRef(false);

	const applying = phase === "applying";
	const sourceLocked = applying || sourceCandidates.length === 0;
	const recoveryPrompt =
		phase === "rejected"
			? staticFabAssemblyConnectorRecoveryPrompt(
					recoveryTarget,
					recoveryAutomaticRecommendationAttempts,
				)
			: null;
	const recoveryTargetToReveal = recoveryPrompt?.target ?? null;
	useEffect(() => {
		if (phase === "idle") {
			focusedForOpenRef.current = false;
			return;
		}
		if (focusedForOpenRef.current || sourceLocked) return;
		const frame = window.requestAnimationFrame(() => {
			const sourceSelect = sourceSelectRef.current;
			if (!sourceSelect?.isConnected || sourceSelect.disabled) return;
			focusedForOpenRef.current = true;
			sourceSelect.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [phase, sourceLocked]);
	useEffect(() => {
		if (!recoveryTargetToReveal) return;
		const frame = window.requestAnimationFrame(() => {
			recoveryTargetRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [recoveryTargetToReveal]);

	if (phase === "idle") return null;

	const busy = phase === "verifying" || phase === "applying";
	const targetLocked = applying || sourceCandidateIndex === null || targetCandidates.length === 0;
	const sideLocked = applying || sourceCandidateIndex === null;
	const selectedSourceValue = candidateSelectValue(sourceCandidates, sourceCandidateIndex);
	const selectedTargetValue = candidateSelectValue(targetCandidates, targetCandidateIndex);
	const status = panelStatus(phase, conflictCount, issueCode);
	const feedback = reason ?? defaultFeedback(phase, hierarchyRole, purpose);
	const childLabel = hierarchyRole === "BAY_TO_BANK" ? "BAY" : "BANK";
	return (
		<section
			className="tilefab-assembly-connector"
			data-testid="static-fab-assembly-connector-panel"
			data-phase={phase}
			data-hierarchy-role={hierarchyRole}
			data-purpose={purpose}
			data-recovery-target={recoveryPrompt?.target ?? ""}
			aria-labelledby={titleId}
			aria-describedby={statusId}
			aria-keyshortcuts="Q E Escape"
			aria-busy={busy}
			onKeyDownCapture={(event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					onCancel();
					return;
				}
				if (
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.repeat &&
					!sideLocked &&
					(event.code === "KeyQ" || event.code === "KeyE")
				) {
					event.preventDefault();
					event.stopPropagation();
					onSide(cycleConnectorSide(side, event.code === "KeyQ" ? -1 : 1));
					return;
				}
				if (
					event.key === "Enter" &&
					!event.metaKey &&
					!event.ctrlKey &&
					!event.altKey &&
					!event.repeat &&
					phase === "ready" &&
					result !== null
				) {
					const target = event.target;
					if (
						target instanceof Element &&
						target.closest("button, select, input, textarea, summary, [role='button']")
					) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					onApply();
				}
			}}
		>
			<header className="tilefab-assembly-connector-header">
				<span className="tilefab-assembly-connector-heading-icon" aria-hidden="true">
					<Network size={18} />
				</span>
				<span className="tilefab-assembly-connector-heading">
					<small>FAB 조립 · ASSEMBLY</small>
					<strong id={titleId}>
						{purpose === "FAB_LOOP"
							? "FAB 외곽 루프 추가 · ADD FAB LOOP"
							: hierarchyRole === "BAY_TO_BANK"
								? "TWIN BAY 연결 · CONNECT BAYS"
								: "BAY BANK 연결 · CONNECT BANKS"}
					</strong>
				</span>
				<span className="tilefab-assembly-connector-phase" data-phase={phase}>
					<PhaseIcon phase={phase} />
					{status}
				</span>
			</header>

			<div className="tilefab-assembly-connector-gateways">
				<GatewaySelector
					kind="source"
					label="출발 연결점 · SOURCE"
					selectId={sourceSelectId}
					bayName={sourceBayName}
					fallbackLabel={`${childLabel} 출발 연결점 선택`}
					gatewayLabel={sourceGatewayLabel}
					candidates={sourceCandidates}
					candidateIndex={sourceCandidateIndex}
					selectedValue={selectedSourceValue}
					disabled={sourceLocked}
					selectRef={sourceSelectRef}
					guidedNext={recoveryPrompt?.target === "source-next"}
					recoveryDescriptionId={recoveryDescriptionId}
					guidedRef={recoveryTargetRef}
					onSelect={onSelectSource}
					onCycle={onCycleSource}
				/>

				<span className="tilefab-assembly-connector-direction" aria-hidden="true">
					<ArrowLeftRight size={18} />
				</span>

				<GatewaySelector
					kind="target"
					label="도착 연결점 · TARGET"
					selectId={targetSelectId}
					bayName={targetBayName}
					fallbackLabel={`${childLabel} 도착 연결점 선택`}
					gatewayLabel={targetGatewayLabel}
					candidates={targetCandidates}
					candidateIndex={targetCandidateIndex}
					selectedValue={selectedTargetValue}
					disabled={targetLocked}
					guidedNext={recoveryPrompt?.target === "target-next"}
					recoveryDescriptionId={recoveryDescriptionId}
					guidedRef={recoveryTargetRef}
					onSelect={onSelectTarget}
					onCycle={onCycleTarget}
				/>
			</div>

			<fieldset
				className="tilefab-assembly-connector-side"
				disabled={sideLocked}
				aria-label="연결 경로 방향"
			>
				<legend>경로 방향 · SIDE</legend>
				<SideButton active={side === null} label="자동 · AUTO" side={null} onSide={onSide} />
				<SideButton
					active={side === "left"}
					label="왼쪽 · LEFT"
					side="left"
					guided={recoveryPrompt?.target === "side-left"}
					recoveryDescriptionId={recoveryDescriptionId}
					guidedRef={recoveryTargetRef}
					onSide={onSide}
				/>
				<SideButton
					active={side === "right"}
					label="오른쪽 · RIGHT"
					side="right"
					guided={recoveryPrompt?.target === "side-right"}
					recoveryDescriptionId={recoveryDescriptionId}
					guidedRef={recoveryTargetRef}
					onSide={onSide}
				/>
			</fieldset>

			<div className="tilefab-assembly-connector-status">
				{result ? <ConnectorResult result={result} /> : null}
				<div
					id={statusId}
					className="tilefab-assembly-connector-feedback"
					role={phase === "rejected" ? "alert" : "status"}
					aria-live={phase === "rejected" ? "assertive" : "polite"}
					aria-atomic="true"
					data-rejected={phase === "rejected"}
				>
					<PhaseIcon phase={phase} />
					<span>
						<strong>{status}</strong>
						<small className="tilefab-assembly-connector-reason">{feedback}</small>
						{recoveryPrompt ? (
							<small
								id={recoveryDescriptionId}
								className="tilefab-assembly-connector-recovery-prompt"
							>
								<strong>{recoveryPrompt.eyebrow}</strong>
								<span>{recoveryPrompt.instruction}</span>
								<em>새 경로가 READY가 될 때까지 적용은 잠깁니다.</em>
							</small>
						) : null}
					</span>
					{conflictCount > 0 && issueCode !== "ALREADY_CONNECTED" ? (
						<em>
							{conflictCount.toLocaleString()} CONFLICT
							{conflictCount === 1 ? "" : "S"}
						</em>
					) : null}
				</div>
				{timings && hasTiming(timings) ? <ConnectorTimings timings={timings} /> : null}
			</div>

			<footer className="tilefab-assembly-connector-actions">
				<ConnectorInputCues />
				<button
					type="button"
					className="tilefab-assembly-connector-cancel"
					style={CONTROL_SIZE}
					aria-keyshortcuts="Escape"
					disabled={phase === "applying"}
					data-guided-target={recoveryPrompt?.target === "cancel" || undefined}
					aria-describedby={recoveryPrompt?.target === "cancel" ? recoveryDescriptionId : undefined}
					ref={recoveryPrompt?.target === "cancel" ? recoveryTargetRef : undefined}
					onClick={onCancel}
				>
					<X size={16} aria-hidden="true" />
					취소 · CANCEL
					<kbd>ESC</kbd>
				</button>
				<button
					type="button"
					className="tilefab-assembly-connector-apply"
					style={CONTROL_SIZE}
					data-guided-action-id={guidedApplyActionId ?? undefined}
					data-guided-target={guidedApplyActionId ? "true" : undefined}
					aria-describedby={guidedApplyActionId ? guidedApplyDescriptionId : undefined}
					aria-keyshortcuts="Enter"
					disabled={phase !== "ready" || result === null}
					onClick={onApply}
				>
					<Check size={16} aria-hidden="true" />
					적용 · APPLY
					<kbd>ENTER</kbd>
				</button>
			</footer>
		</section>
	);
}

interface GatewaySelectorProps {
	readonly kind: "source" | "target";
	readonly label: string;
	readonly selectId: string;
	readonly bayName: string | null;
	readonly fallbackLabel: string;
	readonly gatewayLabel: string | null;
	readonly candidates: readonly StaticFabAssemblyConnectorPanelCandidate[];
	readonly candidateIndex: number | null;
	readonly selectedValue: string;
	readonly disabled: boolean;
	readonly guidedNext: boolean;
	readonly recoveryDescriptionId: string;
	readonly guidedRef: Ref<HTMLButtonElement>;
	readonly selectRef?: Ref<HTMLSelectElement>;
	readonly onSelect: (index: number) => void;
	readonly onCycle: (step: -1 | 1) => void;
}

function GatewaySelector({
	kind,
	label,
	selectId,
	bayName,
	fallbackLabel,
	gatewayLabel,
	candidates,
	candidateIndex,
	selectedValue,
	disabled,
	guidedNext,
	recoveryDescriptionId,
	guidedRef,
	selectRef,
	onSelect,
	onCycle,
}: GatewaySelectorProps): React.ReactElement {
	const selected = candidateAt(candidates, candidateIndex);
	return (
		<div className="tilefab-assembly-connector-gateway" data-gateway={kind}>
			<label htmlFor={selectId} className="tilefab-assembly-connector-gateway-label">
				<MapPin size={15} aria-hidden="true" />
				<span>
					<small>{label}</small>
					<strong>{bayName ?? fallbackLabel}</strong>
				</span>
			</label>
			<div className="tilefab-assembly-connector-gateway-control">
				<button
					type="button"
					className="tilefab-assembly-connector-cycle"
					style={ICON_CONTROL_SIZE}
					aria-label={`${kind === "source" ? "이전 출발" : "이전 도착"} 연결점`}
					disabled={disabled || candidates.length < 2}
					onClick={() => onCycle(-1)}
				>
					<ChevronLeft size={18} aria-hidden="true" />
				</button>
				<select
					ref={selectRef}
					id={selectId}
					className="tilefab-assembly-connector-select"
					style={CONTROL_SIZE}
					value={selectedValue}
					disabled={disabled}
					onChange={(event) => {
						const index = parseConnectorCandidateIndex(
							event.currentTarget.value,
							candidates.length,
						);
						if (index !== null) onSelect(index);
					}}
				>
					<option value="">
						{candidates.length === 0 ? "연결점 없음 · NO GATEWAYS" : "연결점 선택"}
					</option>
					{candidates.map((candidate, index) => (
						<option key={candidate.id} value={index} disabled={candidate.disabled}>
							{candidate.label}
							{candidate.detail ? ` · ${candidate.detail}` : ""}
						</option>
					))}
				</select>
				<button
					type="button"
					className="tilefab-assembly-connector-cycle"
					style={ICON_CONTROL_SIZE}
					aria-label={`${kind === "source" ? "다음 출발" : "다음 도착"} 연결점`}
					disabled={
						disabled ||
						candidates.length === 0 ||
						(candidateIndex !== null && candidates.length < 2)
					}
					data-guided-target={guidedNext || undefined}
					aria-describedby={guidedNext ? recoveryDescriptionId : undefined}
					ref={guidedNext ? guidedRef : undefined}
					onClick={() => onCycle(1)}
				>
					<ChevronRight size={18} aria-hidden="true" />
				</button>
			</div>
			<small className="tilefab-assembly-connector-gateway-detail">
				{gatewayLabel ?? selected?.detail ?? "지도에서 강조된 연결점 띠를 선택하세요."}
			</small>
		</div>
	);
}

function ConnectorInputCues(): React.ReactElement {
	return (
		<fieldset className="tilefab-assembly-connector-cues">
			<legend className="tilefab-sr-only">Assembly connector controls</legend>
			<span>
				<EditorInputCue input="LMB" />
				<strong>GATEWAY</strong>
			</span>
			<span>
				<EditorInputCue input="RMB DRAG" />
				<strong>PAN</strong>
			</span>
			<span>
				<EditorInputCue input="Q" />
				<i>/</i>
				<EditorInputCue input="E" />
				<strong>SIDE</strong>
			</span>
			<span>
				<EditorInputCue input="ESC" />
				<strong>CANCEL</strong>
			</span>
			<span data-apply="true">
				<EditorInputCue input="ENTER" />
				<strong>APPLY</strong>
			</span>
		</fieldset>
	);
}

interface SideButtonProps {
	readonly active: boolean;
	readonly label: string;
	readonly side: RailModuleSide | null;
	readonly guided?: boolean;
	readonly recoveryDescriptionId?: string;
	readonly guidedRef?: Ref<HTMLButtonElement>;
	readonly onSide: (side: RailModuleSide | null) => void;
}

function SideButton({
	active,
	label,
	side,
	guided = false,
	recoveryDescriptionId,
	guidedRef,
	onSide,
}: SideButtonProps): React.ReactElement {
	return (
		<button
			type="button"
			className="tilefab-assembly-connector-side-option"
			style={CONTROL_SIZE}
			data-active={active}
			data-guided-target={guided || undefined}
			aria-describedby={guided ? recoveryDescriptionId : undefined}
			ref={guided ? guidedRef : undefined}
			aria-pressed={active}
			onClick={() => onSide(side)}
		>
			{label}
		</button>
	);
}

function ConnectorResult({
	result,
}: {
	readonly result: StaticFabAssemblyConnectorPanelResult;
}): React.ReactElement {
	const parentKind = result.hierarchyRole === "BAY_TO_BANK" ? "BANK" : "FAB";
	const parentLabel = `${parentKind} ${result.parentAction === "create" ? "생성" : "확장"} · ${
		result.parentAction === "create" ? "CREATE" : "EXTEND"
	} ${parentKind}`;
	return (
		<dl className="tilefab-assembly-connector-result" aria-label="Worker 인증 연결 결과">
			<div>
				<dt>가는 길 · OUTBOUND</dt>
				<dd>{formatMeters(result.outboundLengthMeters)}</dd>
			</div>
			<div>
				<dt>오는 길 · RETURN</dt>
				<dd>{formatMeters(result.returnLengthMeters)}</dd>
			</div>
			<div>
				<dt>변경량 · PATCH</dt>
				<dd>
					{result.railChangeCount.toLocaleString()} RAIL ·{" "}
					{result.organizationChangeCount.toLocaleString()} ORG
				</dd>
			</div>
			<div data-parent-action={result.parentAction}>
				<dt>
					{result.purpose === "FAB_LOOP"
						? "외곽 순환 · FAB LOOP"
						: result.hierarchyRole === "BAY_TO_BANK"
							? "BAY BANK 생성"
							: "FAB 연결 · INTERBAY"}
				</dt>
				<dd>
					{parentLabel}
					{result.parentName ? ` · ${result.parentName}` : ""}
				</dd>
			</div>
		</dl>
	);
}

function ConnectorTimings({
	timings,
}: {
	readonly timings: StaticFabAssemblyConnectorPanelTimings;
}): React.ReactElement {
	return (
		<details className="tilefab-assembly-connector-timings">
			<summary>VERIFICATION TIMINGS</summary>
			<dl>
				<Timing label="WORKER" value={timings.workerRoundTripMilliseconds} />
				<Timing label="VALIDATE" value={timings.responseValidationMilliseconds} />
				<Timing label="ADOPT" value={timings.adoptionMilliseconds} />
			</dl>
		</details>
	);
}

function Timing({ label, value }: { readonly label: string; readonly value: number | null }) {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{value === null ? "—" : `${Math.max(0, value).toFixed(1)} ms`}</dd>
		</div>
	);
}

function PhaseIcon({
	phase,
}: {
	readonly phase: StaticFabAssemblyConnectorPanelPhase;
}): React.ReactElement {
	if (phase === "verifying" || phase === "applying") {
		return <RefreshCcw size={15} aria-hidden="true" />;
	}
	if (phase === "ready") return <Check size={15} aria-hidden="true" />;
	if (phase === "rejected") return <AlertTriangle size={15} aria-hidden="true" />;
	return <MapPin size={15} aria-hidden="true" />;
}

function panelStatus(
	phase: StaticFabAssemblyConnectorPanelPhase,
	conflictCount: number,
	issueCode: string | null,
): string {
	switch (phase) {
		case "idle":
			return "연결 준비";
		case "pick-source-gateway":
			return "출발 선택";
		case "pick-target-gateway":
			return "도착 선택";
		case "verifying":
			return "검증 중";
		case "ready":
			return "적용 준비 · READY";
		case "rejected":
			if (issueCode === "ALREADY_CONNECTED") return "이미 연결됨";
			return conflictCount > 0 ? `충돌 ${conflictCount.toLocaleString()}건` : "적용 불가";
		case "applying":
			return "적용 중";
	}
}

function defaultFeedback(
	phase: StaticFabAssemblyConnectorPanelPhase,
	hierarchyRole: StaticFabAssemblyConnectorHierarchyRole,
	purpose: StaticFabAssemblyConnectorPurpose,
): string {
	const child = hierarchyRole === "BAY_TO_BANK" ? "Twin Bay" : "Bay Bank";
	const parent =
		purpose === "FAB_LOOP"
			? "Fab outer circulation"
			: hierarchyRole === "BAY_TO_BANK"
				? "Bay Bank"
				: "Fab Interbay";
	switch (phase) {
		case "idle":
			return `${child} 두 개를 선택해 시작하세요.`;
		case "pick-source-gateway":
			return purpose === "FAB_LOOP"
				? "선택한 Bay Bank 바깥쪽의 출발 연결점을 고르세요."
				: "강조된 출발 연결점을 고르세요.";
		case "pick-target-gateway":
			return purpose === "FAB_LOOP"
				? "다른 Bay Bank의 마주 보는 바깥쪽 도착 연결점을 고르세요."
				: "강조된 도착 연결점을 고르세요.";
		case "verifying":
			return `경로·여유 공간·${parent} 계층을 Worker가 확인하고 있습니다.`;
		case "ready":
			return "가는 길·오는 길과 변경량을 확인한 뒤 적용하세요.";
		case "rejected":
			return "다른 연결점 조합이나 경로 방향을 시도하세요. 지도는 아직 바뀌지 않았습니다.";
		case "applying":
			return "인증된 연결을 한 번의 실행 취소 단위로 적용하고 있습니다.";
	}
}

function candidateSelectValue(
	candidates: readonly StaticFabAssemblyConnectorPanelCandidate[],
	index: number | null,
): string {
	return candidateAt(candidates, index) ? String(index) : "";
}

function candidateAt(
	candidates: readonly StaticFabAssemblyConnectorPanelCandidate[],
	index: number | null,
): StaticFabAssemblyConnectorPanelCandidate | null {
	if (index === null || !Number.isSafeInteger(index) || index < 0 || index >= candidates.length) {
		return null;
	}
	return candidates[index] ?? null;
}

function hasTiming(timings: StaticFabAssemblyConnectorPanelTimings): boolean {
	return (
		timings.workerRoundTripMilliseconds !== null ||
		timings.responseValidationMilliseconds !== null ||
		timings.adoptionMilliseconds !== null
	);
}

function formatMeters(value: number): string {
	return `${Math.max(0, value).toLocaleString()} m`;
}
