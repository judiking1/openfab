import {
	AlertTriangle,
	FileClock,
	FileInput,
	History,
	LoaderCircle,
	ShieldCheck,
	X,
} from "lucide-react";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import {
	checksumOperationalConfiguration,
	type OperationalConfigurationState,
} from "../core/OperationalConfiguration";
import {
	BrowserSimulationResidentScenarioEditorFileGateway,
	type SimulationResidentScenarioEditorFileGateway,
} from "./BrowserSimulationResidentScenarioEditorFileGateway";
import type { BoundLiveSimulationReadinessPublication } from "./LiveSimulationReadiness";
import type {
	SimulationResidentScenarioEditorController,
	SimulationResidentScenarioEditorControllerState,
} from "./SimulationResidentScenarioEditorController";
import type { SimulationResidentScenarioEditorRunAssetDraft } from "./SimulationResidentScenarioEditorRunAssetFile";
import {
	adaptSimulationResidentScenarioEditorRunAsset,
	type SimulationResidentScenarioEditorRunAsset,
} from "./SimulationResidentScenarioEditorSourceAdapter";

const RESIDENT_REVIEW_ROW_LIMIT = 8;
const RESIDENT_REVIEW_ISSUE_LIMIT = 8;

export interface ResidentScenarioReviewRow {
	readonly sourceOrdinal: number;
	readonly recordId: string;
	readonly timeMicroseconds: number;
	readonly loadId: string;
	readonly vehicleId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface ResidentScenarioReviewIssue {
	readonly sourceOrdinal: number;
	readonly code: string;
	readonly message: string;
}

export interface ReviewedResidentScenarioDraft {
	readonly projectId: string;
	readonly certificateFingerprint: string;
	readonly operationalConfigurationFingerprint: string;
	readonly draft: SimulationResidentScenarioEditorRunAssetDraft;
	readonly summary: Readonly<{
		sourceKind: "TRANSFER_PLAN" | "REPLAY_HISTORY";
		manifestId: string;
		runAssetFingerprint: string;
		inputRecordCount: number;
		acceptedRecordCount: number;
		rejectedRecordCount: number;
		issuesTruncated: boolean;
		vehicleCount: number;
		rows: readonly ResidentScenarioReviewRow[];
		issues: readonly ResidentScenarioReviewIssue[];
	}>;
}

export interface SimulationResidentScenarioSourceReviewCardProps {
	readonly controller: SimulationResidentScenarioEditorController;
	readonly projectId: string;
	readonly readinessBinding: BoundLiveSimulationReadinessPublication | null;
	readonly operationalConfiguration: OperationalConfigurationState;
	readonly setStatus: (message: string) => void;
	readonly fileGateway?: SimulationResidentScenarioEditorFileGateway;
	readonly forceFileInputFallback?: boolean;
}

export function SimulationResidentScenarioSourceReviewCard({
	controller,
	projectId,
	readinessBinding,
	operationalConfiguration,
	setStatus,
	fileGateway,
	forceFileInputFallback = false,
}: SimulationResidentScenarioSourceReviewCardProps): ReactElement {
	const [gateway] = useState(
		() =>
			fileGateway ??
			new BrowserSimulationResidentScenarioEditorFileGateway({ forceFileInputFallback }),
	);
	const subscribe = useCallback(
		(listener: () => void) => controller.subscribe(listener),
		[controller],
	);
	const getSnapshot = useCallback(() => controller.getState(), [controller]);
	const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	const [review, setReview] = useState<ReviewedResidentScenarioDraft | null>(null);
	const [selectingKind, setSelectingKind] = useState<"TRANSFER_PLAN" | "REPLAY_HISTORY" | null>(
		null,
	);
	const [actionError, setActionError] = useState<string | null>(null);
	const selectionRef = useRef<AbortController | null>(null);
	const operationalFingerprint = checksumOperationalConfiguration(operationalConfiguration);

	useEffect(
		() => () => {
			selectionRef.current?.abort();
			selectionRef.current = null;
		},
		[],
	);

	const chooseSource = useCallback(
		(sourceKind: "TRANSFER_PLAN" | "REPLAY_HISTORY"): void => {
			if (!readinessBinding || selectingKind) return;
			selectionRef.current?.abort();
			const abortController = new AbortController();
			selectionRef.current = abortController;
			setSelectingKind(sourceKind);
			setActionError(null);
			void gateway
				.chooseOpen(sourceKind, abortController.signal)
				.then((draft) => {
					if (abortController.signal.aborted || selectionRef.current !== abortController) return;
					if (!draft) return;
					const runAsset = adaptSimulationResidentScenarioEditorRunAsset(
						readinessBinding.published,
						operationalConfiguration,
						draft.source,
						draft.serviceTimingInput,
						draft.resourceRunInput,
					);
					if (controller.getState().source !== null) controller.clearSource();
					setReview(
						Object.freeze({
							projectId,
							certificateFingerprint: readinessBinding.published.certificate.fingerprint,
							operationalConfigurationFingerprint: operationalFingerprint,
							draft,
							summary: residentReviewSummary(runAsset),
						}),
					);
					setStatus(
						`${sourceKind === "TRANSFER_PLAN" ? "Resident Transfer Plan" : "Resident Replay History"}를 현재 포트와 home-slot 차량에 맞춰 검토했습니다`,
					);
				})
				.catch((error: unknown) => {
					if (isAbortError(error)) return;
					setActionError(normalizeErrorMessage(error));
					setStatus("Resident scenario 파일을 검토하지 못했습니다");
				})
				.finally(() => {
					if (selectionRef.current !== abortController) return;
					selectionRef.current = null;
					setSelectingKind(null);
				});
		},
		[
			controller,
			gateway,
			operationalConfiguration,
			operationalFingerprint,
			projectId,
			readinessBinding,
			selectingKind,
			setStatus,
		],
	);

	const prepare = useCallback((): void => {
		if (!review || !readinessBinding) return;
		if (
			review.projectId !== projectId ||
			review.certificateFingerprint !== readinessBinding.published.certificate.fingerprint ||
			review.operationalConfigurationFingerprint !== operationalFingerprint
		) {
			setActionError("The reviewed resident scenario no longer matches the exact project source.");
			return;
		}
		setActionError(null);
		setStatus("검토된 resident scenario를 disposable Worker에서 준비합니다");
		void controller
			.prepare(
				readinessBinding.published,
				operationalConfiguration,
				review.draft.source,
				review.draft.serviceTimingInput,
				review.draft.resourceRunInput,
			)
			.then(() => setStatus("Resident home-return scenario 준비가 완료되었습니다"))
			.catch((error: unknown) => {
				if (isAbortError(error)) return;
				setActionError(normalizeErrorMessage(error));
				setStatus("Resident scenario 준비에 실패했습니다");
			});
	}, [
		controller,
		operationalConfiguration,
		operationalFingerprint,
		projectId,
		readinessBinding,
		review,
		setStatus,
	]);

	const clear = useCallback((): void => {
		selectionRef.current?.abort();
		selectionRef.current = null;
		setSelectingKind(null);
		setReview(null);
		setActionError(null);
		if (controller.getState().source !== null) controller.clearSource();
		setStatus("Resident scenario의 로컬 검토 소스를 비웠습니다");
	}, [controller, setStatus]);

	const preparing = state.session.phase === "PREPARING";
	const canChoose = readinessBinding !== null && !preparing && selectingKind === null;
	const visibleError =
		actionError ?? (state.session.phase === "FAILED" ? state.session.message : null);
	const sourceKind = review?.summary.sourceKind ?? state.source?.sourceKind ?? null;
	return (
		<section
			className="tilefab-simulation-source-review"
			data-testid="simulation-resident-scenario-source-review"
			data-phase={sourceReviewPhase(state, review, visibleError)}
			data-source-kind={sourceKind ?? "NONE"}
			aria-label="Resident home-return scenario source review"
		>
			<header>
				<span>
					{review || state.source ? <ShieldCheck size={15} /> : <FileClock size={15} />}
					<strong>RESIDENT SOURCE</strong>
				</span>
				<small>{sourceReviewLabel(state, review, visibleError)}</small>
			</header>
			<p>
				각 public 행은 exact source/destination port와 reviewed home-slot vehicle을 명시해야 합니다.
				Plan과 Replay는 별도 fingerprint domain이며 파일 프로필도 기존 From-To와 교차되지 않습니다.
			</p>
			<div className="tilefab-simulation-source-actions">
				<button
					type="button"
					disabled={!canChoose}
					data-selected={sourceKind === "TRANSFER_PLAN"}
					onClick={() => chooseSource("TRANSFER_PLAN")}
				>
					{selectingKind === "TRANSFER_PLAN" ? (
						<LoaderCircle size={13} className="tilefab-spin" />
					) : (
						<FileClock size={13} />
					)}
					LOAD RESIDENT PLAN
				</button>
				<button
					type="button"
					disabled={!canChoose}
					data-selected={sourceKind === "REPLAY_HISTORY"}
					onClick={() => chooseSource("REPLAY_HISTORY")}
				>
					{selectingKind === "REPLAY_HISTORY" ? (
						<LoaderCircle size={13} className="tilefab-spin" />
					) : (
						<History size={13} />
					)}
					LOAD RESIDENT REPLAY
				</button>
			</div>
			{review ? <ResidentScenarioReviewFacts review={review} /> : null}
			{visibleError ? (
				<div className="tilefab-simulation-source-error" role="alert">
					<AlertTriangle size={13} /> <span>{visibleError}</span>
				</div>
			) : null}
			<footer>
				<small>
					{readinessBinding
						? "Local-only resident review. Run needs separate resident certification and one-shot authorization."
						: "Certify the exact current project source before loading a resident scenario."}
				</small>
				{review || state.source ? (
					<button type="button" className="tilefab-simulation-source-clear" onClick={clear}>
						<X size={13} /> CLEAR
					</button>
				) : null}
				<button
					type="button"
					className="tilefab-simulation-source-prepare"
					disabled={!review || !readinessBinding}
					onClick={preparing ? () => controller.cancel() : prepare}
				>
					{preparing ? <X size={13} /> : <FileInput size={13} />}
					{preparing ? "CANCEL" : "PREPARE RESIDENT"}
				</button>
			</footer>
		</section>
	);
}

export function ResidentScenarioReviewFacts({
	review,
}: {
	readonly review: ReviewedResidentScenarioDraft;
}): ReactElement {
	const { summary } = review;
	return (
		<>
			<dl>
				<div>
					<dt>PUBLIC MANIFEST</dt>
					<dd>{summary.manifestId}</dd>
				</div>
				<div>
					<dt>ACCEPTED / REJECTED</dt>
					<dd>
						{summary.acceptedRecordCount.toLocaleString()} /{" "}
						{summary.rejectedRecordCount.toLocaleString()}
					</dd>
				</div>
				<div>
					<dt>HOME-SLOT VEHICLES</dt>
					<dd>{summary.vehicleCount.toLocaleString()}</dd>
				</div>
				<div>
					<dt>BOUNDED PREVIEW</dt>
					<dd>
						{summary.rows.length.toLocaleString()} / {summary.acceptedRecordCount.toLocaleString()}
					</dd>
				</div>
			</dl>
			<section
				className="tilefab-simulation-source-records"
				aria-label="Bounded accepted resident scenario records"
				data-record-count={summary.acceptedRecordCount}
				data-preview-count={summary.rows.length}
			>
				<header>
					<span>
						<strong>CANONICAL RESIDENT ROWS</strong>
						<small>FIRST {RESIDENT_REVIEW_ROW_LIMIT} MAX · READ ONLY</small>
					</span>
				</header>
				{summary.rows.length > 0 ? (
					<ol>
						{summary.rows.map((row) => (
							<li key={`${row.sourceOrdinal}:${row.recordId}`}>
								<span>
									<strong>{row.recordId}</strong>
									<small>
										{row.vehicleId} · {row.loadId}
									</small>
								</span>
								<small>
									PORT {row.sourcePortId} → {row.destinationPortId} · {row.timeMicroseconds} µs
								</small>
							</li>
						))}
					</ol>
				) : (
					<p>No accepted resident rows are available.</p>
				)}
			</section>
			{summary.issues.length > 0 ? (
				<ul aria-label="Bounded resident scenario rejection issues">
					{summary.issues.map((issue) => (
						<li key={`${issue.sourceOrdinal}:${issue.code}`}>
							#{issue.sourceOrdinal} · {issue.code} · {issue.message}
						</li>
					))}
				</ul>
			) : null}
		</>
	);
}

function residentReviewSummary(
	asset: SimulationResidentScenarioEditorRunAsset,
): ReviewedResidentScenarioDraft["summary"] {
	const { manifest } = asset;
	return Object.freeze({
		sourceKind: manifest.sourceKind,
		manifestId: manifest.manifestId,
		runAssetFingerprint: asset.fingerprint,
		inputRecordCount: manifest.inputRecordCount,
		acceptedRecordCount: manifest.acceptedRecordCount,
		rejectedRecordCount: manifest.rejectedRecordCount,
		issuesTruncated:
			manifest.issuesTruncated || manifest.rejectionIssues.length > RESIDENT_REVIEW_ISSUE_LIMIT,
		vehicleCount: asset.parking.slotCount,
		rows: Object.freeze(
			manifest.records.slice(0, RESIDENT_REVIEW_ROW_LIMIT).map((record) =>
				Object.freeze({
					sourceOrdinal: record.sourceOrdinal,
					recordId:
						manifest.sourceKind === "TRANSFER_PLAN"
							? (record as { readonly transferId: string }).transferId
							: (record as { readonly historyEventId: string }).historyEventId,
					timeMicroseconds:
						manifest.sourceKind === "TRANSFER_PLAN"
							? (record as { readonly releaseTimeMicroseconds: number }).releaseTimeMicroseconds
							: (record as { readonly observedTimeMicroseconds: number }).observedTimeMicroseconds,
					loadId: record.loadId,
					vehicleId: record.vehicleId,
					sourcePortId: record.sourcePortId,
					destinationPortId: record.destinationPortId,
				}),
			),
		),
		issues: Object.freeze(
			manifest.rejectionIssues.slice(0, RESIDENT_REVIEW_ISSUE_LIMIT).map((issue) =>
				Object.freeze({
					sourceOrdinal: issue.sourceOrdinal,
					code: issue.code,
					message: issue.message,
				}),
			),
		),
	});
}

function sourceReviewPhase(
	state: SimulationResidentScenarioEditorControllerState,
	review: ReviewedResidentScenarioDraft | null,
	error: string | null,
): string {
	if (error || state.session.phase === "FAILED") return "error";
	if (!review && state.source === null) return "empty";
	if (review && state.source === null) return "reviewed";
	if (state.session.phase === "PREPARING") return "preparing";
	if (state.session.phase === "PREPARED") return "prepared";
	if (state.session.phase === "INVALIDATED") return "invalidated";
	return review ? "reviewed" : "empty";
}

function sourceReviewLabel(
	state: SimulationResidentScenarioEditorControllerState,
	review: ReviewedResidentScenarioDraft | null,
	error: string | null,
): string {
	if (error || state.session.phase === "FAILED") return "RESIDENT SOURCE REJECTED";
	if (!review && state.source === null) return "PLAN OR REPLAY REQUIRED";
	if (review && state.source === null) return "REVIEWED · PREPARE REQUIRED";
	if (state.session.phase === "PREPARING") return "WORKER PREPARING";
	if (state.session.phase === "PREPARED") return "RESIDENT CERTIFIED";
	if (state.session.phase === "INVALIDATED") return `INVALIDATED · ${state.session.reason}`;
	return review ? "REVIEWED · PREPARE REQUIRED" : "PLAN OR REPLAY REQUIRED";
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

function normalizeErrorMessage(error: unknown): string {
	if (!(error instanceof Error) || error.message.length === 0) {
		return "Resident scenario source review failed.";
	}
	return error.message.slice(0, 240);
}
