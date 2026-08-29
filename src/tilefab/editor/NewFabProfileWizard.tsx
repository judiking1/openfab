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
			focusNameError(validation.reason ?? "Project name is invalid.");
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
				message: errorMessage(cause, "Exact preparation failed."),
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
					message: errorMessage(cause, "Project creation failed."),
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
						<small>ASSEMBLE · COMPLETE PROJECT</small>
						<strong id={titleId}>NEW FAB</strong>
						<span id={descriptionId} className="tilefab-new-fab-header-description">
							Create one deterministic static-authoring profile.
						</span>
					</div>
					<button
						type="button"
						data-testid="new-fab-profile-close"
						aria-label={preparing ? "Cancel New Fab preparation and close" : "Close New Fab wizard"}
						disabled={creating}
						onClick={closeWizard}
					>
						<X size={18} />
					</button>
				</header>

				<nav className="tilefab-new-fab-steps" aria-label="New Fab steps">
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
								STEP {stepIndex + 1} / {NEW_FAB_PROFILE_WIZARD_STEPS.length}
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
							CANCEL
						</button>
					) : (
						<button
							type="button"
							data-testid="new-fab-profile-back"
							disabled={busy}
							onClick={previousStep}
						>
							<ArrowLeft size={15} /> BACK
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
							NEXT <ArrowRight size={15} />
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
								{preparing ? "PREPARING" : preparedForCurrentInput ? "PREPARE AGAIN" : "PREPARE"}
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
									{creating ? "CREATING" : "CREATE"}
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
				<span className="tilefab-new-fab-name-label">PROJECT NAME</span>
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
				label="LAYOUT BLOCKS"
				description="Physical generator groups used only while arranging Banks. They are not organization records."
				value={profile.layoutBlockCount}
				options={OPENFAB_FAB_LAYOUT_BLOCK_COUNTS.map((value) => ({
					value,
					label: String(value),
					detail: value === 1 ? "SINGLE GROUP" : `${value} LINEAR GROUPS`,
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("layoutBlockCount", value)}
			/>
			<ChoiceGroup<OpenFabFabBankRepetitionAxis>
				name="new-fab-bank-direction"
				label="PROCESS LOOP REPETITION AXIS"
				description="Sets the direction in which Process Loop centers repeat inside each Bank."
				value={profile.bankRepetitionAxis}
				options={OPENFAB_FAB_BANK_REPETITION_AXES.map((value) => ({
					value,
					label: value === "EAST_WEST" ? "EAST–WEST AXIS" : "NORTH–SOUTH AXIS",
					detail: value === "EAST_WEST" ? "HORIZONTAL" : "VERTICAL",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("bankRepetitionAxis", value)}
			/>
			<ReadOnlyPolicy
				label="SITE ENVELOPE"
				value="AUTO-FIT"
				detail="Exact outer bounds are derived during preparation."
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
			<section
				className="tilefab-new-fab-live-counts"
				aria-label="Current derived production counts"
			>
				<span className="tilefab-new-fab-live-count">
					<strong>{review.derived.counts.banks}</strong> BANKS
				</span>
				<span className="tilefab-new-fab-live-count">
					<strong>{review.derived.counts.bays}</strong> BAYS
				</span>
				<span className="tilefab-new-fab-live-count">
					<strong>{review.derived.counts.processLoops}</strong> PROCESS LOOPS
				</span>
			</section>
			<ChoiceGroup<OpenFabFabBanksPerLayoutBlock>
				name="new-fab-banks-per-layout-block"
				label="BANKS PER LAYOUT BLOCK"
				description="Each Bank shares one paired distributor."
				value={profile.banksPerLayoutBlock}
				options={OPENFAB_FAB_BANKS_PER_LAYOUT_BLOCK.map((value) => ({
					value,
					label: String(value),
					detail: value === 1 ? "ONE BANK" : `${value} BANKS`,
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("banksPerLayoutBlock", value)}
			/>
			<ChoiceGroup<OpenFabFabProcessLoopsPerBank>
				name="new-fab-process-loops-per-bank"
				label="PROCESS LOOPS PER BANK"
				description="The target is preserved exactly by Bay packing."
				value={profile.processLoopsPerBank}
				options={OPENFAB_FAB_PROCESS_LOOPS_PER_BANK.map((value) => ({
					value,
					label: String(value),
					detail: "LOOPS",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("processLoopsPerBank", value)}
			/>
			<ChoiceGroup<OpenFabFabBayPackingPolicy>
				name="new-fab-bay-packing"
				label="BAY PACKING"
				description="Every Process Loop belongs to exactly one Single-loop or Twin-loop Bay."
				value={profile.bayPackingPolicy}
				options={OPENFAB_FAB_BAY_PACKING_POLICIES.map((value) => ({
					value,
					label: value === "SINGLE" ? "SINGLE" : value === "TWIN" ? "TWIN" : "BALANCED MIX",
					detail:
						value === "SINGLE"
							? "1 LOOP / BAY"
							: value === "TWIN"
								? "2 LOOPS / BAY"
								: "DETERMINISTIC",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("bayPackingPolicy", value)}
			/>
			<ChoiceGroup<OpenFabFabProcessLoopLongAxisMeters>
				name="new-fab-process-loop-long-axis"
				label="PROCESS LOOP LONG AXIS"
				description="The equipment-row travel family for each repeated Process Loop."
				value={profile.processLoopLongAxisMeters}
				options={OPENFAB_FAB_PROCESS_LOOP_LONG_AXES_METERS.map((value) => ({
					value,
					label: `${value} m`,
					detail: value === 36 ? "COMPACT" : value === 48 ? "STANDARD" : "LONG",
				}))}
				disabled={disabled}
				onChange={(value) => onProfile("processLoopLongAxisMeters", value)}
			/>
			<ChoiceGroup<OpenFabFabProcessLoopCenterPitchMeters>
				name="new-fab-process-loop-center-spacing"
				label="PROCESS LOOP CENTER SPACING"
				description="Center-to-center distance between adjacent repeated loops."
				value={profile.processLoopCenterPitchMeters}
				options={OPENFAB_FAB_PROCESS_LOOP_CENTER_PITCHES_METERS.map((value) => ({
					value,
					label: `${value} m`,
					detail: value === 12 ? "COMPACT" : value === 14 ? "STANDARD" : "WIDE",
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
			? "NOT REQUIRED FOR ONE LAYOUT BLOCK"
			: "PAIRED DIRECTED AUTO";
	return (
		<div className="tilefab-new-fab-fields" data-testid="new-fab-circulation-step">
			<div className="tilefab-new-fab-fixed-intro">
				<Route size={19} aria-hidden="true" />
				<span className="tilefab-new-fab-fixed-intro-copy">
					<strong>IMPLEMENTED V1 POLICIES</strong>
					<small>These compiler-owned choices are read-only in this release.</small>
				</span>
			</div>
			<ReadOnlyPolicy
				label="BANK DISTRIBUTOR"
				value="PAIRED COLLECTOR"
				detail="Opposite directed lanes collect every Bay in a Bank."
			/>
			<ReadOnlyPolicy
				label="FAB CIRCULATION"
				value="PAIRED OPPOSITE FLOW"
				detail="Typed branch and merge connections retain one-way flow."
			/>
			<ReadOnlyPolicy
				label="INTER-BLOCK CONNECTOR"
				value={connector}
				detail="Only generator-owned Layout Blocks inside the same Fab are connected."
			/>
			<ReadOnlyPolicy
				label="PERIMETER REDUNDANCY"
				value="OFF"
				detail="No optional alternate perimeter route is added by V1."
			/>
			<ReadOnlyPolicy
				label="RAIL PROFILE"
				value="R500 · 4 m LANE PAIR"
				detail="Curve and gateway support geometry stays compiler-owned."
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
				<small>PROJECT</small>
				<strong>{projectName}</strong>
				<span className="tilefab-new-fab-review-name-meta">
					AUTO-FIT · {axisLabel(review.profile.bankRepetitionAxis)}
				</span>
			</section>
			<dl className="tilefab-new-fab-review-counts" aria-label="Derived hierarchy counts">
				<Metric label="FAB" value={counts.fabs} />
				<Metric label="BANKS" value={counts.banks} />
				<Metric
					label="BAYS"
					value={counts.bays}
					detail={`${counts.singleBays} S · ${counts.twinBays} T`}
				/>
				<Metric label="PROCESS LOOPS" value={counts.processLoops} />
			</dl>
			<section className="tilefab-new-fab-review-section">
				<header>
					<small>DERIVED GATEWAYS</small>
					<strong>Typed connections</strong>
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
					<small>AUTO-FIT INPUT</small>
					<strong>Compiler-derived envelope</strong>
				</header>
				<dl className="tilefab-new-fab-review-lines">
					<Line
						label="PROCESS LOOP LONG AXIS"
						value={`${dimensions.processLoopLongAxisMeters} m`}
					/>
					<Line label="LANE-PAIR WIDTH" value={`${dimensions.processLoopLanePairWidthMeters} m`} />
					<Line label="CENTER SPACING" value={`${dimensions.processLoopCenterPitchMeters} m`} />
					<Line label="BANK PROCESS SPAN" value={`${dimensions.bankProcessSpanMeters} m`} />
				</dl>
				<p>
					{preparedSummary
						? "Exact Fab bounds and scoped static-authoring evidence are shown below."
						: "Exact Fab bounds, rail-cell scale, and preparation cost appear only after PREPARE."}{" "}
					Layout Blocks remain generator-only and are not organization records.
				</p>
			</section>
			{preparedSummary ? (
				<ExactPreparedEvidence
					summary={preparedSummary}
					preparationMilliseconds={preparationMilliseconds ?? 0}
				/>
			) : null}
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
				<ul aria-label="Static authoring safety status">
					<li>PORT SERVICE · NOT CHECKED</li>
					<li>SIMULATION · NOT SIMULATED</li>
					<li>simulationReady · FALSE</li>
				</ul>
			</section>
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
				<small>OPENFAB VERIFIED · STATIC AUTHORING</small>
				<strong>Exact prepared evidence</strong>
			</header>
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
			<ul aria-label="Exact OpenFab verification scopes">
				<li>GEOMETRY · VERIFIED</li>
				<li>DIRECTED TOPOLOGY · VERIFIED</li>
				<li>
					GATEWAY REACHABILITY · {summary.gatewayReachabilityVerified ? "VERIFIED" : "NOT VERIFIED"}
				</li>
				<li>ORGANIZATION · VERIFIED</li>
				<li>PORT SERVICE · NOT CHECKED</li>
				<li>OPERATIONAL · NOT SIMULATED</li>
			</ul>
		</section>
	);
}

function ProfileSchematic({
	review,
}: Readonly<{ review: NewFabProfileWizardReview }>): ReactElement {
	return (
		<figure
			className="tilefab-new-fab-schematic"
			aria-label={`${review.derived.counts.layoutBlocks} generator-only Layout Blocks, ${review.derived.counts.banks} Banks, ${review.derived.counts.bays} Bays, and ${review.derived.counts.processLoops} Process Loops semantic profile schematic`}
		>
			<figcaption>
				<span>
					<small>SEMANTIC PROFILE</small>
					<strong>AUTO-FIT</strong>
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
								<strong>LAYOUT {layoutBlock.ordinal + 1}</strong>
								<small>GENERATOR ONLY</small>
							</header>
							<div>
								{layoutBlock.banks.map((bank) => (
									<section
										key={bank.ordinal}
										className="tilefab-new-fab-schematic-bank"
										aria-label={`Bank ${bank.ordinal + 1}, ${bank.bayCount} Bays, ${bank.processLoopCount} Process Loops`}
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
										<small>{bank.processLoopCount} LOOPS</small>
									</section>
								))}
							</div>
						</section>
					))}
				</div>
			</div>
			<p>Bounded semantic preview · exact rail geometry is prepared later.</p>
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
			<em>READ-ONLY</em>
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
			title: "CREATING PROJECT",
			detail: "Applying the exact prepared result.",
			tone: "working",
		};
	}
	if (creation.kind === "complete") {
		return {
			title: "CREATE REQUEST ACCEPTED",
			detail: "The parent project flow now owns activation and focus return.",
			tone: "ready",
		};
	}
	if (creation.kind === "failed") {
		return { title: "CREATE FAILED", detail: creation.message, tone: "error" };
	}
	if (preparation.kind === "preparing") {
		return {
			title: "PREPARING EXACT RESULT",
			detail: "Current project data remains unchanged.",
			tone: "working",
		};
	}
	if (preparation.kind === "failed") {
		return { title: "PREPARATION FAILED", detail: preparation.message, tone: "error" };
	}
	if (preparedForCurrentInput) {
		return {
			title: "PREPARED RESULT RECEIVED",
			detail: "CREATE will use this exact profile-and-name-bound evidence.",
			tone: "ready",
		};
	}
	return { title: "PROFILE VALID", detail: "NOT YET VERIFIED", tone: "neutral" };
}

function stepDescription(step: (typeof NEW_FAB_PROFILE_WIZARD_STEPS)[number]["id"]): string {
	if (step === "layout") return "Name the project and choose generator-only physical grouping.";
	if (step === "production")
		return "Choose Banks, Process Loop targets, and deterministic Bay packing.";
	if (step === "circulation") return "Review the implemented directed circulation policies.";
	return "Confirm derived hierarchy and request exact preparation before creation.";
}

function axisLabel(axis: OpenFabFabBankRepetitionAxis): string {
	return axis === "EAST_WEST" ? "EAST / WEST" : "NORTH / SOUTH";
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
	'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
