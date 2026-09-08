import { ArrowLeft, ArrowRight, Check, Factory, LoaderCircle, Route, X } from "lucide-react";
import {
	type KeyboardEvent,
	type ReactElement,
	type RefObject,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import {
	defaultOpenFabFabProfile,
	normalizeOpenFabFabProfile,
	OPENFAB_FAB_BANK_REPETITION_AXES,
	OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK,
	OPENFAB_FAB_BAY_PACKING_POLICIES,
	OPENFAB_FAB_LAYOUT_BLOCK_COUNTS,
	OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS,
	OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS,
	OPENFAB_FAB_PROCESS_LOOPS_PER_BANK,
	type OpenFabFabBankRepetitionAxis,
	type OpenFabFabBanksPerLayoutBlock,
	type OpenFabFabBayPackingPolicy,
	type OpenFabFabLayoutBlockCount,
	type OpenFabFabProcessLoopCenterPitchMeters,
	type OpenFabFabProcessLoopLongAxisMeters,
	type OpenFabFabProcessLoopsPerBank,
	type OpenFabFabProfile,
} from "../compile/OpenFabFabProfile";
import {
	bindNewFabProfilePreparedEvidence,
	createNewFabProfileWizardReview,
	NEW_FAB_PROFILE_WIZARD_STEPS,
	type NewFabProfilePreparedBinding,
	type NewFabProfileWizardReview,
	newFabProfilePreparedBindingMatches,
	validateNewFabProfileWizardName,
} from "./NewFabProfileWizardModel";
import "./NewFabProfileWizard.css";

export interface NewFabProfileWizardProps<TPreparedEvidence extends object> {
	readonly initialName?: string;
	readonly initialProfile?: OpenFabFabProfile;
	readonly returnFocus?: HTMLElement | null;
	readonly suspended?: boolean;
	readonly onCancel: () => void;
	readonly onPrepare: (
		profile: OpenFabFabProfile,
		name: string,
		signal: AbortSignal,
	) => Promise<TPreparedEvidence>;
	readonly onCreate: (
		prepared: NewFabProfilePreparedBinding<TPreparedEvidence>,
	) => void | Promise<void>;
	readonly onDiscardPrepared?: (prepared: NewFabProfilePreparedBinding<TPreparedEvidence>) => void;
	readonly summarizePrepared?: (
		prepared: NewFabProfilePreparedBinding<TPreparedEvidence>,
	) => NewFabProfilePreparedSummary;
}

export interface NewFabProfilePreparedSummary {
	readonly bounds: Readonly<{ minX: number; minY: number; maxX: number; maxY: number }>;
	readonly railCells: number;
	readonly directedEdges: number;
	readonly physicalPaths: number;
	readonly physicalComponents: 1;
	readonly strongComponents: 1;
	readonly openTerminals: 0;
	readonly organizationRecords: number;
	readonly gatewayReachabilityVerified: true;
	readonly authoringReady: true;
	readonly simulationReady: false;
}

type EditableProfileKey =
	| "layoutBlockCount"
	| "bankRepetitionAxis"
	| "banksPerLayoutBlock"
	| "processLoopsPerBank"
	| "bayPackingPolicy"
	| "processLoopLongAxisMeters"
	| "processLoopCenterPitchMeters";

type PreparationState<TPreparedEvidence extends object> =
	| Readonly<{ kind: "idle" }>
	| Readonly<{ kind: "preparing" }>
	| Readonly<{
			kind: "prepared";
			binding: NewFabProfilePreparedBinding<TPreparedEvidence>;
			preparationMilliseconds: number;
	  }>
	| Readonly<{ kind: "failed"; message: string }>;

type CreationState =
	| Readonly<{ kind: "idle" }>
	| Readonly<{ kind: "creating" }>
	| Readonly<{ kind: "complete" }>
	| Readonly<{ kind: "failed"; message: string }>;

interface StatusMessage {
	readonly title: string;
	readonly detail: string;
	readonly tone: "neutral" | "working" | "ready" | "error";
}

const DEFAULT_PROJECT_NAME = "New OpenFab Fab";

export function NewFabProfileWizard<TPreparedEvidence extends object>({
	initialName = DEFAULT_PROJECT_NAME,
	initialProfile = defaultOpenFabFabProfile(),
	returnFocus = null,
	suspended = false,
	onCancel,
	onPrepare,
	onCreate,
	onDiscardPrepared,
	summarizePrepared,
}: NewFabProfileWizardProps<TPreparedEvidence>): ReactElement {
	const [projectName, setProjectName] = useState(initialName);
	const [profile, setProfile] = useState<OpenFabFabProfile>(() =>
		normalizeOpenFabFabProfile(initialProfile),
	);
	const [stepIndex, setStepIndex] = useState(0);
	const [nameError, setNameError] = useState<string | null>(null);
	const [preparation, setPreparation] = useState<PreparationState<TPreparedEvidence>>({
		kind: "idle",
	});
	const [creation, setCreation] = useState<CreationState>({ kind: "idle" });
	const dialogRef = useRef<HTMLElement | null>(null);
	const backdropRef = useRef<HTMLDivElement | null>(null);
	const stepHeadingRef = useRef<HTMLHeadingElement | null>(null);
	const stepPanelRef = useRef<HTMLDivElement | null>(null);
	const nameRef = useRef<HTMLInputElement | null>(null);
	const mountedRef = useRef(true);
	const preparationControllerRef = useRef<AbortController | null>(null);
	const preparationTokenRef = useRef(0);
	const preparedBindingRef = useRef<NewFabProfilePreparedBinding<TPreparedEvidence> | null>(null);
	const suspendedRef = useRef(suspended);
	const closeWizardRef = useRef<() => void>(() => undefined);
	suspendedRef.current = suspended;
	const onDiscardPreparedRef = useRef(onDiscardPrepared);
	onDiscardPreparedRef.current = onDiscardPrepared;
	const returnFocusRef = useRef<HTMLElement | null>(
		returnFocus ??
			(typeof document !== "undefined" && document.activeElement instanceof HTMLElement
				? document.activeElement
				: null),
	);
	const titleId = useId();
	const descriptionId = useId();
	const feedbackId = useId();
	const review = useMemo(() => createNewFabProfileWizardReview(profile), [profile]);
	const step = NEW_FAB_PROFILE_WIZARD_STEPS[stepIndex] ?? NEW_FAB_PROFILE_WIZARD_STEPS[0];
	const preparing = preparation.kind === "preparing";
	const creating = creation.kind === "creating";
	const busy = preparing || creating;
	const preparedBinding = preparation.kind === "prepared" ? preparation.binding : null;
	const preparedForCurrentInput =
		preparedBinding !== null &&
		newFabProfilePreparedBindingMatches(preparedBinding, profile, projectName);
	const preparedSummary =
		preparedBinding && preparedForCurrentInput && summarizePrepared
			? summarizePrepared(preparedBinding)
			: null;
	const preparationMilliseconds =
		preparation.kind === "prepared" ? preparation.preparationMilliseconds : null;
	const status = reviewStatus(preparation, creation, preparedForCurrentInput);

	useEffect(() => {
		const backdrop = backdropRef.current;
		if (!backdrop) return;
		if (suspended) {
			backdrop.inert = true;
			return () => {
				backdrop.inert = false;
			};
		}
		backdrop.inert = false;
		const background = [...document.body.children].filter(
			(element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop,
		);
		const previous = background.map((element) => ({
			element,
			inert: element.inert,
			ariaHidden: element.getAttribute("aria-hidden"),
		}));
		for (const { element } of previous) {
			element.inert = true;
			element.setAttribute("aria-hidden", "true");
		}
		return () => {
			for (const { element, inert, ariaHidden } of previous) {
				element.inert = inert;
				if (ariaHidden === null) element.removeAttribute("aria-hidden");
				else element.setAttribute("aria-hidden", ariaHidden);
			}
		};
	}, [suspended]);

	useEffect(() => {
		if (suspended) return;
		const expectedStepIndex = String(stepIndex);
		const frame = requestAnimationFrame(() => {
			const heading = stepHeadingRef.current;
			if (heading?.dataset.stepIndex !== expectedStepIndex) return;
			if (stepPanelRef.current) stepPanelRef.current.scrollTop = 0;
			heading.focus();
			heading.scrollIntoView({ block: "nearest", inline: "nearest" });
		});
		return () => cancelAnimationFrame(frame);
	}, [stepIndex, suspended]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			preparationTokenRef.current += 1;
			preparationControllerRef.current?.abort();
			preparationControllerRef.current = null;
			const binding = preparedBindingRef.current;
			preparedBindingRef.current = null;
			if (binding) onDiscardPreparedRef.current?.(binding);
		};
	}, []);

	useEffect(() => {
		const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
			if (event.key !== "Escape" || suspendedRef.current) return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			closeWizardRef.current();
		};
		window.addEventListener("keydown", closeOnEscape, { capture: true });
		return () => window.removeEventListener("keydown", closeOnEscape, { capture: true });
	}, []);

	const invalidatePreparedResult = (): void => {
		preparationTokenRef.current += 1;
		preparationControllerRef.current?.abort();
		preparationControllerRef.current = null;
		const binding = preparedBindingRef.current;
		preparedBindingRef.current = null;
		if (binding) onDiscardPreparedRef.current?.(binding);
		setPreparation({ kind: "idle" });
		setCreation({ kind: "idle" });
	};

	const closeWizard = (): void => {
		if (creating) return;
		invalidatePreparedResult();
		onCancel();
		requestAnimationFrame(() => {
			const target = returnFocusRef.current;
			if (target?.isConnected) target.focus({ preventScroll: true });
		});
	};
	closeWizardRef.current = closeWizard;

	const updateProfile = <Key extends EditableProfileKey>(
		key: Key,
		value: OpenFabFabProfile[Key],
	): void => {
		invalidatePreparedResult();
		setProfile((current) => normalizeOpenFabFabProfile({ ...current, [key]: value }));
	};

	const updateProjectName = (value: string): void => {
		invalidatePreparedResult();
		setProjectName(value);
		setNameError(null);
	};

	const focusNameError = (reason: string): void => {
		setNameError(reason);
		requestAnimationFrame(() => {
			nameRef.current?.focus();
			nameRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
		});
	};

	const validateBeforeNavigation = (): boolean => {
		const validation = validateNewFabProfileWizardName(projectName);
		if (!validation.valid) {
			focusNameError(validation.reason ?? "프로젝트 이름을 확인하세요.");
			return false;
		}
		setNameError(null);
		return true;
	};

	const nextStep = (): void => {
		if (busy || stepIndex >= NEW_FAB_PROFILE_WIZARD_STEPS.length - 1) return;
		if (!validateBeforeNavigation()) return;
		setStepIndex((current) => Math.min(NEW_FAB_PROFILE_WIZARD_STEPS.length - 1, current + 1));
	};

	const previousStep = (): void => {
		if (busy || stepIndex <= 0) return;
		invalidatePreparedResult();
		setStepIndex((current) => Math.max(0, current - 1));
	};

	const prepare = async (): Promise<void> => {
		if (step.id !== "review" || busy) return;
		if (!validateBeforeNavigation()) return;
		invalidatePreparedResult();
		const controller = new AbortController();
		const startedAt = performance.now();
		const token = preparationTokenRef.current + 1;
		preparationTokenRef.current = token;
		preparationControllerRef.current = controller;
		setPreparation({ kind: "preparing" });
		try {
			const evidence = await onPrepare(profile, projectName, controller.signal);
			const binding = bindNewFabProfilePreparedEvidence(profile, projectName, evidence);
			if (controller.signal.aborted || preparationTokenRef.current !== token) {
				onDiscardPreparedRef.current?.(binding);
				return;
			}
			preparedBindingRef.current = binding;
			setPreparation({
				kind: "prepared",
				binding,
				preparationMilliseconds: Math.max(0, performance.now() - startedAt),
			});
		} catch (cause: unknown) {
			if (controller.signal.aborted || preparationTokenRef.current !== token) return;
			setPreparation({
				kind: "failed",
				message: errorMessage(cause, "FAB 레일과 연결을 검증하지 못했습니다."),
			});
		} finally {
			if (preparationTokenRef.current === token) preparationControllerRef.current = null;
		}
	};

	const create = async (): Promise<void> => {
		if (!preparedBinding || !preparedForCurrentInput || busy || creation.kind === "complete")
			return;
		const binding = preparedBinding;
		// Prepared sources are one-shot capabilities. Invalidate the local reference before handing
		// it to the parent so any failed activation requires an explicit fresh PREPARE.
		preparedBindingRef.current = null;
		setPreparation({ kind: "idle" });
		setCreation({ kind: "creating" });
		try {
			await onCreate(binding);
			if (mountedRef.current) setCreation({ kind: "complete" });
		} catch (cause: unknown) {
			if (mountedRef.current) {
				setCreation({
					kind: "failed",
					message: errorMessage(cause, "새 FAB를 만들지 못했습니다."),
				});
			}
		}
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			event.nativeEvent.stopImmediatePropagation();
			if (!creating) closeWizard();
			return;
		}
		if (event.key === "Tab") trapTabNavigation(event, dialogRef.current);
	};

	const content = (
		<div
			ref={backdropRef}
			className="tilefab-new-fab-backdrop"
			role="presentation"
			data-suspended={suspended}
			onPointerDown={(event) => {
				if (!suspended && event.target === event.currentTarget && !creating) closeWizard();
			}}
		>
			<section
				ref={dialogRef}
				className="tilefab-new-fab-dialog"
				role="dialog"
				aria-modal={suspended ? undefined : true}
				aria-hidden={suspended ? true : undefined}
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				aria-busy={busy}
				tabIndex={-1}
				data-step={step.id}
				data-preparation={preparation.kind}
				data-creation={creation.kind}
				data-suspended={suspended}
				data-layout-blocks={review.derived.counts.layoutBlocks}
				data-banks={review.derived.counts.banks}
				data-bays={review.derived.counts.bays}
				data-process-loops={review.derived.counts.processLoops}
				data-testid="new-fab-profile-wizard"
				onKeyDown={handleKeyDown}
			>
				<header className="tilefab-new-fab-header">
					<span className="tilefab-new-fab-heading-icon" aria-hidden="true">
						<Factory size={20} />
					</span>
					<div>
						<small>프로젝트 시작</small>
						<strong id={titleId}>새 FAB 만들기</strong>
						<span id={descriptionId} className="tilefab-new-fab-header-description">
							배치와 생산 규모를 정하고, 연결된 FAB 레일을 만듭니다.
						</span>
					</div>
					<button
						type="button"
						data-testid="new-fab-profile-close"
						aria-label={preparing ? "FAB 검증을 취소하고 닫기" : "새 FAB 만들기 닫기"}
						disabled={creating}
						onClick={closeWizard}
					>
						<X size={18} />
					</button>
				</header>

				<nav className="tilefab-new-fab-steps" aria-label="새 FAB 만들기 단계">
					<ol>
						{NEW_FAB_PROFILE_WIZARD_STEPS.map((wizardStep, index) => (
							<li
								key={wizardStep.id}
								data-active={index === stepIndex}
								data-complete={index < stepIndex}
								aria-current={index === stepIndex ? "step" : undefined}
							>
								<span className="tilefab-new-fab-step-marker">
									{index < stepIndex ? <Check size={13} /> : index + 1}
								</span>
								<strong>{wizardStep.label}</strong>
							</li>
						))}
					</ol>
				</nav>

				<div className="tilefab-new-fab-workspace">
					<ProfileSchematic review={review} />
					<div ref={stepPanelRef} className="tilefab-new-fab-step-panel">
						<header className="tilefab-new-fab-step-heading">
							<small>
								{stepIndex + 1}단계 / {NEW_FAB_PROFILE_WIZARD_STEPS.length}
							</small>
							<h2 ref={stepHeadingRef} tabIndex={-1} data-step-index={stepIndex}>
								{step.label}
							</h2>
							<p>{stepDescription(step.id)}</p>
						</header>
						{step.id === "layout" ? (
							<LayoutStep
								projectName={projectName}
								nameError={nameError}
								nameRef={nameRef}
								profile={profile}
								disabled={busy}
								onProjectName={updateProjectName}
								onProfile={updateProfile}
							/>
						) : null}
						{step.id === "production" ? (
							<ProductionStep
								profile={profile}
								review={review}
								disabled={busy}
								onProfile={updateProfile}
							/>
						) : null}
						{step.id === "circulation" ? <CirculationStep review={review} /> : null}
						{step.id === "review" ? (
							<ReviewStep
								review={review}
								projectName={projectName}
								status={status}
								feedbackId={feedbackId}
								preparedSummary={preparedSummary}
								preparationMilliseconds={preparationMilliseconds}
							/>
						) : null}
					</div>
				</div>

				<footer className="tilefab-new-fab-footer">
					{stepIndex === 0 ? (
						<button
							type="button"
							data-testid="new-fab-profile-cancel"
							disabled={creating}
							onClick={closeWizard}
						>
							취소
						</button>
					) : (
						<button
							type="button"
							data-testid="new-fab-profile-back"
							disabled={busy}
							onClick={previousStep}
						>
							<ArrowLeft size={15} /> 이전
						</button>
					)}
					<span className="tilefab-new-fab-footer-spacer" />
					{step.id !== "review" ? (
						<button
							type="button"
							className="primary"
							data-testid="new-fab-profile-next"
							disabled={busy}
							onClick={nextStep}
						>
							다음 <ArrowRight size={15} />
						</button>
					) : (
						<>
							<button
								type="button"
								className="prepare"
								data-testid="new-fab-profile-prepare"
								disabled={busy || creation.kind === "complete"}
								aria-describedby={feedbackId}
								onClick={() => void prepare()}
							>
								{preparing ? <LoaderCircle className="spin" size={16} /> : <Route size={16} />}
								{preparing ? "검증 중" : preparedForCurrentInput ? "다시 검증" : "검증하기"}
							</button>
							{preparedForCurrentInput ? (
								<button
									type="button"
									className="primary"
									data-testid="new-fab-profile-create"
									disabled={busy || creation.kind === "complete"}
									aria-describedby={feedbackId}
									onClick={() => void create()}
								>
									{creating ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}
									{creating ? "생성 중" : "새 FAB 생성"}
								</button>
							) : null}
						</>
					)}
				</footer>
			</section>
		</div>
	);

	return typeof document === "undefined" ? content : createPortal(content, document.body);
}

interface LayoutStepProps {
	readonly projectName: string;
	readonly nameError: string | null;
	readonly nameRef: RefObject<HTMLInputElement | null>;
	readonly profile: OpenFabFabProfile;
	readonly disabled: boolean;
	readonly onProjectName: (value: string) => void;
	readonly onProfile: <Key extends EditableProfileKey>(
		key: Key,
		value: OpenFabFabProfile[Key],
	) => void;
}

function LayoutStep({
	projectName,
	nameError,
	nameRef,
	profile,
	disabled,
	onProjectName,
	onProfile,
}: LayoutStepProps): ReactElement {
	const nameFeedbackId = useId();
	return (
		<div className="tilefab-new-fab-fields" data-testid="new-fab-layout-step">
			<label className="tilefab-new-fab-name">
				<span className="tilefab-new-fab-name-label">프로젝트 이름</span>
				<input
					ref={nameRef}
					value={projectName}
					maxLength={120}
					disabled={disabled}
					aria-invalid={nameError !== null}
					aria-describedby={nameError ? nameFeedbackId : undefined}
					onChange={(event) => onProjectName(event.currentTarget.value)}
				/>
				{nameError ? (
					<small id={nameFeedbackId} className="tilefab-new-fab-field-error">
						{nameError}
					</small>
				) : null}
			</label>
			<ChoiceGroup<OpenFabFabLayoutBlockCount>
				name="new-fab-layout-blocks"
				label="배치 구역"
				description="Bank 묶음을 몇 개 구역에 나누어 배치할지 정합니다. 구역은 배치 기준이며 별도 편집 조직으로 저장하지 않습니다."
				value={profile.layoutBlockCount}
				options={OPENFAB_FAB_LAYOUT_BLOCK_COUNTS.map((value) => ({
					value,
					label: String(value),
					detail: value === 1 ? "한 구역" : `${value}개 구역`,
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("layoutBlockCount", value)}
			/>
			<ChoiceGroup<OpenFabFabBankRepetitionAxis>
				name="new-fab-bank-direction"
				label="순환 레일을 나열할 방향"
				description="Bank 안의 Process Loop를 가로 또는 세로로 나란히 배치합니다."
				value={profile.bankRepetitionAxis}
				options={OPENFAB_FAB_BANK_REPETITION_AXES.map((value) => ({
					value,
					label: value === "EAST_WEST" ? "가로 · 동서" : "세로 · 남북",
					detail: value === "EAST_WEST" ? "가로 배치" : "세로 배치",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("bankRepetitionAxis", value)}
			/>
			<ReadOnlyPolicy
				label="FAB 크기"
				value="자동 크기"
				detail="레일 구성을 검증할 때 필요한 전체 크기를 계산합니다."
			/>
		</div>
	);
}

interface ProductionStepProps {
	readonly profile: OpenFabFabProfile;
	readonly review: NewFabProfileWizardReview;
	readonly disabled: boolean;
	readonly onProfile: <Key extends EditableProfileKey>(
		key: Key,
		value: OpenFabFabProfile[Key],
	) => void;
}

function ProductionStep({
	profile,
	review,
	disabled,
	onProfile,
}: ProductionStepProps): ReactElement {
	return (
		<div className="tilefab-new-fab-fields" data-testid="new-fab-production-step">
			<section className="tilefab-new-fab-live-counts" aria-label="예상 생산 구성 개수">
				<span className="tilefab-new-fab-live-count">
					<strong>{review.derived.counts.banks}</strong> Bank
				</span>
				<span className="tilefab-new-fab-live-count">
					<strong>{review.derived.counts.bays}</strong> Bay
				</span>
				<span className="tilefab-new-fab-live-count">
					<strong>{review.derived.counts.processLoops}</strong> Process Loop
				</span>
			</section>
			<ChoiceGroup<OpenFabFabBanksPerLayoutBlock>
				name="new-fab-banks-per-layout-block"
				label="구역당 Bank 수"
				description="한 Bank에 속한 Bay는 공통 진입·진출 레일로 연결됩니다."
				value={profile.banksPerLayoutBlock}
				options={OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK.map((value) => ({
					value,
					label: String(value),
					detail: value === 1 ? "Bank 1개" : `Bank ${value}개`,
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("banksPerLayoutBlock", value)}
			/>
			<ChoiceGroup<OpenFabFabProcessLoopsPerBank>
				name="new-fab-process-loops-per-bank"
				label="Bank당 순환 레일 수"
				description="정한 Process Loop 수를 유지하면서 아래 Bay 구성에 맞춰 묶습니다."
				value={profile.processLoopsPerBank}
				options={OPENFAB_FAB_PROCESS_LOOPS_PER_BANK.map((value) => ({
					value,
					label: String(value),
					detail: "순환 레일",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("processLoopsPerBank", value)}
			/>
			<ChoiceGroup<OpenFabFabBayPackingPolicy>
				name="new-fab-bay-packing"
				label="Bay 구성"
				description="Bay 하나에 Process Loop를 1개 또는 2개 넣습니다. 혼합을 선택하면 두 구성을 함께 배치합니다."
				value={profile.bayPackingPolicy}
				options={OPENFAB_FAB_BAY_PACKING_POLICIES.map((value) => ({
					value,
					label: value === "SINGLE" ? "Single" : value === "TWIN" ? "Twin" : "혼합",
					detail:
						value === "SINGLE"
							? "Bay당 Loop 1개"
							: value === "TWIN"
								? "Bay당 Loop 2개"
								: "1개·2개 구성 혼합",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("bayPackingPolicy", value)}
			/>
			<ChoiceGroup<OpenFabFabProcessLoopLongAxisMeters>
				name="new-fab-process-loop-long-axis"
				label="순환 레일 길이"
				description="장비 열을 따라 배치하는 Process Loop의 긴 방향 길이입니다."
				value={profile.processLoopLongAxisMeters}
				options={OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS.map((value) => ({
					value,
					label: `${value} m`,
					detail: value === 36 ? "짧게" : value === 48 ? "기본" : "길게",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("processLoopLongAxisMeters", value)}
			/>
			<ChoiceGroup<OpenFabFabProcessLoopCenterPitchMeters>
				name="new-fab-process-loop-center-spacing"
				label="순환 레일 중심 간격"
				description="이웃한 Process Loop의 중심과 중심 사이 거리입니다."
				value={profile.processLoopCenterPitchMeters}
				options={OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS.map((value) => ({
					value,
					label: `${value} m`,
					detail: value === 12 ? "좁게" : value === 14 ? "기본" : "넓게",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("processLoopCenterPitchMeters", value)}
			/>
		</div>
	);
}

function CirculationStep({
	review,
}: Readonly<{ review: NewFabProfileWizardReview }>): ReactElement {
	const connector =
		review.derived.policies.interBlockConnector === "NOT_REQUIRED"
			? "한 구역에서는 불필요"
			: "진입·진출 레일 자동 연결";
	return (
		<div className="tilefab-new-fab-fields" data-testid="new-fab-circulation-step">
			<div className="tilefab-new-fab-fixed-intro">
				<Route size={19} aria-hidden="true" />
				<span className="tilefab-new-fab-fixed-intro-copy">
					<strong>자동으로 연결되는 방식</strong>
					<small>현재 버전에서는 아래 연결 방식을 사용합니다.</small>
				</span>
			</div>
			<ReadOnlyPolicy
				label="Bank 연결 레일"
				value="진입·진출 레일 한 쌍"
				detail="서로 반대 방향으로 달리는 별도 레일이 각 Bay를 연결합니다."
			/>
			<ReadOnlyPolicy
				label="FAB 순환"
				value="반대 방향의 순환 레일"
				detail="분기·합류 지점에서도 각 레일의 단방향 흐름을 유지합니다."
			/>
			<ReadOnlyPolicy
				label="구역 사이 연결"
				value={connector}
				detail="이 FAB의 배치 구역들을 서로 연결합니다."
			/>
			<ReadOnlyPolicy
				label="추가 외곽 우회로"
				value="추가 안 함"
				detail="기본 생성에서는 별도의 외곽 우회 경로를 추가하지 않습니다."
			/>
			<ReadOnlyPolicy
				label="레일 규격"
				value="곡선 R500 · 레일 쌍 간격 4 m"
				detail="곡선과 진입·진출부를 지원하는 레일 규격으로 생성합니다."
			/>
		</div>
	);
}

function ReviewStep({
	review,
	projectName,
	status,
	feedbackId,
	preparedSummary,
	preparationMilliseconds,
}: Readonly<{
	review: NewFabProfileWizardReview;
	projectName: string;
	status: StatusMessage;
	feedbackId: string;
	preparedSummary: NewFabProfilePreparedSummary | null;
	preparationMilliseconds: number | null;
}>): ReactElement {
	const counts = review.derived.counts;
	const dimensions = review.derived.dimensions;
	return (
		<div className="tilefab-new-fab-review" data-testid="new-fab-review-step">
			<section className="tilefab-new-fab-review-name">
				<small>새 프로젝트</small>
				<strong>{projectName}</strong>
				<span className="tilefab-new-fab-review-name-meta">
					자동 크기 · {axisLabel(review.profile.bankRepetitionAxis)}
				</span>
			</section>
			<section
				id={feedbackId}
				className="tilefab-new-fab-review-status"
				data-tone={status.tone}
				aria-live="polite"
				aria-atomic="true"
			>
				<span className="tilefab-new-fab-review-status-icon" aria-hidden="true">
					{status.tone === "working" ? (
						<LoaderCircle className="spin" size={18} />
					) : status.tone === "ready" ? (
						<Check size={18} />
					) : status.tone === "error" ? (
						<X size={18} />
					) : (
						<Route size={18} />
					)}
				</span>
				<div>
					<strong>{status.title}</strong>
					<small>{status.detail}</small>
				</div>
			</section>
			<dl className="tilefab-new-fab-review-counts" aria-label="생성할 FAB 구성">
				<Metric label="FAB" value={counts.fabs} />
				<Metric label="Bank" value={counts.banks} />
				<Metric
					label="Bay"
					value={counts.bays}
					detail={`Single ${counts.singleBays} · Twin ${counts.twinBays}`}
				/>
				<Metric label="Process Loop" value={counts.processLoops} />
			</dl>
			{preparedSummary ? (
				<ExactPreparedEvidence
					summary={preparedSummary}
					preparationMilliseconds={preparationMilliseconds ?? 0}
				/>
			) : (
				<p className="tilefab-new-fab-next-step">
					검증하기를 누르면 실제 FAB 크기와 레일 연결 결과를 확인할 수 있습니다.
				</p>
			)}
			<p className="tilefab-new-fab-next-step">
				생성 후 OHB·EQ·STK를 배치하고 포트 연결을 검사하세요. 시뮬레이션은 아직 제공하지 않습니다.
			</p>
			<details className="tilefab-new-fab-details" data-testid="new-fab-profile-review-details">
				<summary>배치 규격·연결 수 보기</summary>
				<section className="tilefab-new-fab-review-section">
					<header>
						<strong>생성할 레일 연결</strong>
					</header>
					<dl className="tilefab-new-fab-review-lines">
						<Line label="BAY INTERNAL PAIRS" value={counts.internalProcessGatewayPairs} />
						<Line label="BAY → BANK PAIRS" value={counts.requiredBayToBankGatewayPairs} />
						<Line
							label="BANK → CIRCULATION PAIRS"
							value={counts.requiredBankToDistributorGatewayPairs}
						/>
						<Line label="INTER-BLOCK CONNECTORS" value={counts.requiredInterBlockConnectors} />
						<Line label="INTERNAL ADAPTERS" value={counts.internalProcessGatewayAdapters} />
					</dl>
				</section>
				<section className="tilefab-new-fab-review-section">
					<header>
						<strong>자동 크기 계산에 사용하는 규격</strong>
					</header>
					<dl className="tilefab-new-fab-review-lines">
						<Line label="순환 레일 길이" value={`${dimensions.processLoopLongAxisMeters} m`} />
						<Line label="레일 쌍 간격" value={`${dimensions.processLoopLanePairWidthMeters} m`} />
						<Line
							label="순환 레일 중심 간격"
							value={`${dimensions.processLoopCenterPitchMeters} m`}
						/>
						<Line
							label="Bank 내 순환 레일 배치 폭"
							value={`${dimensions.bankProcessSpanMeters} m`}
						/>
					</dl>
					<p>배치 구역은 Bank를 나누어 배치하는 기준이며, 별도 편집 조직으로 저장하지 않습니다.</p>
				</section>
			</details>
		</div>
	);
}

function ExactPreparedEvidence({
	summary,
	preparationMilliseconds,
}: Readonly<{
	summary: NewFabProfilePreparedSummary;
	preparationMilliseconds: number;
}>): ReactElement {
	const widthMeters = summary.bounds.maxX - summary.bounds.minX;
	const depthMeters = summary.bounds.maxY - summary.bounds.minY;
	return (
		<section
			className="tilefab-new-fab-review-section tilefab-new-fab-exact-evidence"
			data-testid="new-fab-profile-exact-evidence"
		>
			<header>
				<small>레일·연결·구조 검증 완료</small>
				<strong>
					FAB 크기 {widthMeters} × {depthMeters} m
				</strong>
			</header>
			<p>
				레일 형상, 단방향 연결과 구조 계층을 확인했습니다. 모든 진입·진출부 사이를 이동할 수
				있습니다.
			</p>
			<details className="tilefab-new-fab-details" data-testid="new-fab-profile-exact-details">
				<summary>검증 범위·측정값 보기</summary>
				<dl className="tilefab-new-fab-review-lines">
					<Line label="FAB FOOTPRINT" value={`${widthMeters} × ${depthMeters} m`} />
					<Line label="RAIL CELLS" value={summary.railCells} />
					<Line label="DIRECTED EDGES" value={summary.directedEdges} />
					<Line label="PHYSICAL PATHS" value={summary.physicalPaths} />
					<Line label="PHYSICAL COMPONENTS" value={summary.physicalComponents} />
					<Line label="DIRECTED SCC" value={summary.strongComponents} />
					<Line label="OPEN TERMINALS" value={summary.openTerminals} />
					<Line label="ORGANIZATION RECORDS" value={summary.organizationRecords} />
					<Line label="PREPARATION COST" value={`${preparationMilliseconds.toFixed(1)} ms`} />
				</dl>
				<ul aria-label="상세 검증 범위">
					<li>GEOMETRY · VERIFIED</li>
					<li>DIRECTED TOPOLOGY · VERIFIED</li>
					<li>
						GATEWAY REACHABILITY ·{" "}
						{summary.gatewayReachabilityVerified ? "VERIFIED" : "NOT VERIFIED"}
					</li>
					<li>ORGANIZATION · VERIFIED</li>
					<li>PORT SERVICE · NOT CHECKED</li>
					<li>OPERATIONAL · NOT SIMULATED</li>
				</ul>
			</details>
		</section>
	);
}

function ProfileSchematic({
	review,
}: Readonly<{ review: NewFabProfileWizardReview }>): ReactElement {
	return (
		<figure
			className="tilefab-new-fab-schematic"
			aria-label={`${review.derived.counts.layoutBlocks}개 배치 구역, Bank ${review.derived.counts.banks}개, Bay ${review.derived.counts.bays}개, Process Loop ${review.derived.counts.processLoops}개의 예상 구성 도식`}
		>
			<figcaption>
				<span>
					<small>예상 배치</small>
					<strong>자동 크기</strong>
				</span>
				<em className="tilefab-new-fab-schematic-axis">
					{axisLabel(review.profile.bankRepetitionAxis)}
				</em>
			</figcaption>
			<div className="tilefab-new-fab-schematic-fab">
				<span className="tilefab-new-fab-schematic-root">FAB</span>
				<div className="tilefab-new-fab-schematic-blocks">
					{review.derived.layoutBlocks.map((layoutBlock) => (
						<section key={layoutBlock.ordinal}>
							<header className="tilefab-new-fab-schematic-block-header">
								<strong>구역 {layoutBlock.ordinal + 1}</strong>
								<small>배치 기준</small>
							</header>
							<div>
								{layoutBlock.banks.map((bank) => (
									<section
										key={bank.ordinal}
										className="tilefab-new-fab-schematic-bank"
										aria-label={`Bank ${bank.ordinal + 1}, Bay ${bank.bayCount}개, Process Loop ${bank.processLoopCount}개`}
									>
										<span className="tilefab-new-fab-schematic-bank-label">
											B{bank.ordinal + 1}
										</span>
										<div aria-hidden="true">
											{bank.bays.slice(0, 6).map((bay) => (
												<i key={bay.ordinal} data-variant={bay.variant}>
													{bay.variant === "SINGLE" ? "S" : "T"}
												</i>
											))}
											{bank.bays.length > 6 ? <b>+{bank.bays.length - 6}</b> : null}
										</div>
										<small>{bank.processLoopCount} Loop</small>
									</section>
								))}
							</div>
						</section>
					))}
				</div>
			</div>
			<p>구성을 보여주는 도식입니다. 정확한 레일과 크기는 검증 후 확인할 수 있습니다.</p>
		</figure>
	);
}

interface ChoiceOption<Value extends string | number> {
	readonly value: Value;
	readonly label: string;
	readonly detail: string;
}

function ChoiceGroup<Value extends string | number>({
	name,
	label,
	description,
	value,
	options,
	disabled,
	onChange,
}: Readonly<{
	name: string;
	label: string;
	description: string;
	value: Value;
	options: readonly ChoiceOption<Value>[];
	disabled: boolean;
	onChange: (value: Value) => void;
}>): ReactElement {
	return (
		<fieldset className="tilefab-new-fab-choice-group" disabled={disabled}>
			<legend>{label}</legend>
			<p>{description}</p>
			<div>
				{options.map((option) => (
					<label key={String(option.value)} data-active={option.value === value}>
						<input
							type="radio"
							name={name}
							value={option.value}
							checked={option.value === value}
							onChange={() => onChange(option.value)}
						/>
						<span>
							<strong>{option.label}</strong>
							<small>{option.detail}</small>
						</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}

function ReadOnlyPolicy({
	label,
	value,
	detail,
}: Readonly<{ label: string; value: string; detail: string }>): ReactElement {
	return (
		<section className="tilefab-new-fab-readonly" aria-label={`${label}: ${value}`}>
			<span className="tilefab-new-fab-readonly-value">
				<small>{label}</small>
				<strong>{value}</strong>
			</span>
			<p>{detail}</p>
			<em>자동 설정</em>
		</section>
	);
}

function Metric({
	label,
	value,
	detail,
}: Readonly<{ label: string; value: number; detail?: string }>): ReactElement {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{value.toLocaleString()}</dd>
			{detail ? <small>{detail}</small> : null}
		</div>
	);
}

function Line({ label, value }: Readonly<{ label: string; value: string | number }>): ReactElement {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{typeof value === "number" ? value.toLocaleString() : value}</dd>
		</div>
	);
}

function reviewStatus<TPreparedEvidence extends object>(
	preparation: PreparationState<TPreparedEvidence>,
	creation: CreationState,
	preparedForCurrentInput: boolean,
): StatusMessage {
	if (creation.kind === "creating") {
		return {
			title: "새 프로젝트를 만들고 있습니다",
			detail: "검증한 FAB 구성을 프로젝트에 반영하고 있습니다.",
			tone: "working",
		};
	}
	if (creation.kind === "complete") {
		return {
			title: "FAB 생성 완료",
			detail: "편집 화면을 준비하고 있습니다.",
			tone: "ready",
		};
	}
	if (creation.kind === "failed") {
		return { title: "FAB 생성 실패", detail: creation.message, tone: "error" };
	}
	if (preparation.kind === "preparing") {
		return {
			title: "레일과 연결을 검증하고 있습니다",
			detail: "검증이 끝나면 결과를 확인하고 생성을 선택할 수 있습니다.",
			tone: "working",
		};
	}
	if (preparation.kind === "failed") {
		return { title: "FAB 검증 실패", detail: preparation.message, tone: "error" };
	}
	if (preparedForCurrentInput) {
		return {
			title: "검증 완료 · 생성할 수 있습니다",
			detail: "검증 결과를 확인하고 새 FAB 생성을 누르세요.",
			tone: "ready",
		};
	}
	return {
		title: "구성 입력 완료",
		detail: "검증하기를 눌러 레일과 연결을 확인하세요.",
		tone: "neutral",
	};
}

function stepDescription(step: (typeof NEW_FAB_PROFILE_WIZARD_STEPS)[number]["id"]): string {
	if (step === "layout") return "프로젝트 이름과 Bank를 배치할 구역·방향을 정하세요.";
	if (step === "production")
		return "Bank 수와 순환 레일 수, Bay 구성을 정하세요. 예상 개수가 구성 도식에 반영됩니다.";
	if (step === "circulation")
		return "Bay와 Bank를 연결할 레일 방식을 확인하세요. 현재는 아래 방식으로 자동 연결합니다.";
	return "구성과 크기를 확인한 뒤 검증하세요. 검증이 끝나면 새 프로젝트를 만들 수 있습니다.";
}

function axisLabel(axis: OpenFabFabBankRepetitionAxis): string {
	return axis === "EAST_WEST" ? "가로 · 동서" : "세로 · 남북";
}

function errorMessage(cause: unknown, fallback: string): string {
	return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}

function trapTabNavigation(event: KeyboardEvent<HTMLElement>, root: HTMLElement | null): void {
	if (!root) return;
	const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(element) =>
			!element.hidden &&
			!element.inert &&
			element.getAttribute("aria-hidden") !== "true" &&
			element.getClientRects().length > 0,
	);
	if (focusable.length === 0) {
		event.preventDefault();
		root.focus({ preventScroll: true });
		return;
	}
	const first = focusable[0];
	const last = focusable.at(-1);
	if (!first || !last) return;
	const active = document.activeElement;
	const activeInside = active !== root && active instanceof Node && root.contains(active);
	if (event.shiftKey && (active === first || !activeInside)) {
		event.preventDefault();
		last.focus({ preventScroll: true });
	} else if (!event.shiftKey && (active === last || !activeInside)) {
		event.preventDefault();
		first.focus({ preventScroll: true });
	}
}

const FOCUSABLE_SELECTOR =
	'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';
