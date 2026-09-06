import {
	AlertTriangle,
	Check,
	Factory,
	Grid3X3,
	LayoutTemplate,
	Maximize2,
	Minus,
	Plus,
	RefreshCw,
	Route,
	Stamp,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	type ProductionFabAssemblyPlan,
	productionFabMaximumBayPitchMeters,
} from "../compile/ProductionFabAssemblyPlan";
import type { SyntheticFabAssemblyPlan } from "../compile/SyntheticFabAssemblyPlan";
import { SYNTHETIC_FAB_PATTERN_CATALOG } from "../compile/SyntheticFabPattern";
import {
	defaultSyntheticFabStarterProjectName,
	defaultSyntheticFabStarterRequest,
	SYNTHETIC_FAB_PRESET_CATALOG,
	SYNTHETIC_FAB_PROJECT_CATALOG,
	type SyntheticFabStarterId,
	type SyntheticFabStarterParameterDescriptor,
	type SyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
	syntheticFabStarterAssemblyFingerprint,
	syntheticFabStarterCatalogItem,
	syntheticFabStarterProductionAssemblyPlan,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import {
	type PreparedSyntheticFabStarter,
	prepareSyntheticFabStarter,
} from "../compile/SyntheticFabStarterPreview";
import {
	type SyntheticFabStarterSchematic,
	syntheticFabStarterSchematic,
} from "../render/SyntheticFabStarterSchematic";
import { SyntheticFabStarterBridge } from "./SyntheticFabStarterBridge";
import {
	certificationEvidenceBindsPreparedIdentity,
	isDefaultSyntheticFabCertifiedRequest,
	type SyntheticFabStarterCertificationEvidence,
} from "./SyntheticFabStarterCertifiedArtifact";
import { loadCertifiedSyntheticFabStarter } from "./SyntheticFabStarterCertifiedCatalog";
import { largeFabDialogMetadata } from "./SyntheticFabStarterDialogMetadata";
import {
	SYNTHETIC_FAB_STARTER_PREVIEW_CACHE_BYTES_LIMIT,
	SyntheticFabStarterPreviewCache,
} from "./SyntheticFabStarterPreviewCache";
import { acquireVerifiedSyntheticFabStarter } from "./SyntheticFabStarterVerificationCache";
import "./SyntheticFabStarterDialog.css";

interface SyntheticFabStarterDialogProps {
	readonly busy: boolean;
	readonly mode: "project" | "pattern" | "preset";
	readonly returnFocus?: HTMLElement | null;
	readonly operationError?: string | null;
	readonly placementBlockedReason?: string | null;
	readonly suspended: boolean;
	readonly onCancelBusy?: () => void;
	readonly onClearOperationError?: () => void;
	readonly onClose: () => void;
	readonly onConfirm: (
		request: SyntheticFabStarterRequest,
		projectName: string | null,
		prepared: PreparedSyntheticFabStarter,
		independentlyVerified?: PreparedSyntheticFabStarter,
		certificationEvidence?: SyntheticFabStarterCertificationEvidence,
	) => void;
	readonly onPlace?: (
		request: SyntheticFabStarterRequest,
		prepared: PreparedSyntheticFabStarter,
		certificationEvidence?: SyntheticFabStarterCertificationEvidence,
	) => void;
}

interface StarterPreviewFailure {
	readonly kind: "invalid-request" | "worker-error";
	readonly message: string;
}

export function SyntheticFabStarterDialog({
	busy,
	mode,
	returnFocus = null,
	operationError = null,
	placementBlockedReason = null,
	suspended,
	onCancelBusy,
	onClearOperationError,
	onClose,
	onConfirm,
	onPlace,
}: SyntheticFabStarterDialogProps): React.ReactElement {
	const initialId =
		mode === "project" ? "blank" : mode === "preset" ? "paired-circulation-fab-52" : "bay-assembly";
	const createsProject = mode !== "pattern";
	const [request, setRequest] = useState<SyntheticFabStarterRequest>(() =>
		defaultSyntheticFabStarterRequest(initialId),
	);
	const [projectNameOverride, setProjectNameOverride] = useState<string | null>(null);
	const defaultProjectName = defaultSyntheticFabStarterProjectName(request);
	const projectName = projectNameOverride ?? defaultProjectName;
	const dialogRef = useRef<HTMLElement>(null);
	const operationErrorRef = useRef<HTMLDivElement>(null);
	const cancelBusyButtonRef = useRef<HTMLButtonElement>(null);
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const explicitReturnFocusRef = useRef(returnFocus);
	const busyRef = useRef(busy);
	const onCancelBusyRef = useRef(onCancelBusy);
	const onCloseRef = useRef(onClose);
	const catalog =
		mode === "pattern"
			? SYNTHETIC_FAB_PATTERN_CATALOG
			: mode === "preset"
				? SYNTHETIC_FAB_PRESET_CATALOG
				: SYNTHETIC_FAB_PROJECT_CATALOG;
	const item = syntheticFabStarterCatalogItem(request.id);
	const previewLabel =
		request.id === "production-fab-60"
			? `생산 FAB · ${request.parameters.bayCount} Bay`
			: item.label;
	const largeFabMetadata = useMemo(() => largeFabDialogMetadata(request), [request]);
	const largeFabAssembly = largeFabMetadata?.assembly ?? null;
	const productionFabAssembly = useMemo(
		() => syntheticFabStarterProductionAssemblyPlan(request),
		[request],
	);
	const currentSchematic = useMemo(
		() => largeFabMetadata?.schematic ?? syntheticFabStarterSchematic(request),
		[largeFabMetadata, request],
	);
	const [preview, setPreview] = useState<PreparedSyntheticFabStarter | null | undefined>(() =>
		readCachedStarterPreview(request),
	);
	const [previewRequested, setPreviewRequested] = useState(
		() => mode !== "preset" || readCachedStarterPreview(request) !== undefined,
	);
	const pendingPreviewActionRef = useRef<"create" | "place" | null>(null);
	const [previewFailure, setPreviewFailure] = useState<StarterPreviewFailure | null>(null);
	const [independentVerificationResult, setIndependentVerificationResult] = useState<Readonly<{
		key: string;
		prepared: PreparedSyntheticFabStarter | null;
	}> | null>(null);
	const requestFingerprint = syntheticFabStarterRequestFingerprint(request);
	const expectedPlanFingerprint = syntheticFabStarterAssemblyFingerprint(request);
	const previewIdle = mode === "preset" && !previewRequested && preview === undefined;
	const previewPending = preview === undefined && !previewIdle;
	const certifiedPreviewPending = previewPending && isDefaultSyntheticFabCertifiedRequest(request);
	const previewMatchesPlan =
		preview !== null &&
		preview !== undefined &&
		preview.requestFingerprint === requestFingerprint &&
		preview.planFingerprint === expectedPlanFingerprint;
	const independentVerificationKey =
		previewMatchesPlan && preview
			? `${preview.requestFingerprint}|${preview.planFingerprint ?? "no-plan"}`
			: null;
	const independentVerification =
		independentVerificationResult?.key === independentVerificationKey
			? independentVerificationResult.prepared
			: undefined;
	const certificationEvidence = preview ? certifiedStarterEvidence(preview, request) : undefined;
	const previewSource = previewIdle
		? "catalog"
		: preview === undefined
			? "loading"
			: certificationEvidence
				? "certified"
				: "custom";

	useEffect(() => {
		busyRef.current = busy;
		onCancelBusyRef.current = onCancelBusy;
		onCloseRef.current = onClose;
	}, [busy, onCancelBusy, onClose]);

	useEffect(() => {
		if (!operationError || suspended) return;
		const frame = requestAnimationFrame(() => operationErrorRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [operationError, suspended]);

	useEffect(() => {
		if (!busy || suspended) return;
		const frame = requestAnimationFrame(() => cancelBusyButtonRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, [busy, suspended]);

	useEffect(() => {
		if (!previewRequested) return;
		let cancelled = false;
		const cached = readCachedStarterPreview(request);
		if (cached !== undefined) {
			queueMicrotask(() => {
				if (!cancelled) setPreview(cached);
			});
			return () => {
				cancelled = true;
			};
		}
		const load = beginStarterPreviewLoad(request);
		void load.promise
			.then((prepared) => {
				if (!cancelled) setPreview(prepared);
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setPreview(null);
				setPreviewFailure(starterPreviewFailure(error));
			});
		return () => {
			cancelled = true;
			load.cancel();
		};
	}, [previewRequested, request]);

	useEffect(() => {
		if (!previewMatchesPlan || !preview || !independentVerificationKey || certificationEvidence) {
			return;
		}
		let cancelled = false;
		const verification = acquireVerifiedSyntheticFabStarter(preview, request);
		void verification.promise.then(
			(independent) => {
				if (!cancelled) {
					setIndependentVerificationResult(
						Object.freeze({ key: independentVerificationKey, prepared: independent }),
					);
				}
			},
			() => {
				if (!cancelled) {
					setIndependentVerificationResult(
						Object.freeze({ key: independentVerificationKey, prepared: null }),
					);
				}
			},
		);
		return () => {
			cancelled = true;
			verification.cancel();
		};
	}, [certificationEvidence, independentVerificationKey, preview, previewMatchesPlan, request]);

	useEffect(() => {
		returnFocusRef.current =
			explicitReturnFocusRef.current ??
			(document.activeElement instanceof HTMLElement ? document.activeElement : null);
		return () => {
			const returnFocus = returnFocusRef.current;
			requestAnimationFrame(() => {
				if (returnFocus?.isConnected) returnFocus.focus();
			});
		};
	}, []);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog) return;
		if (suspended) {
			dialog.inert = true;
			return () => {
				dialog.inert = false;
			};
		}

		dialog.inert = false;
		const initialFocus =
			dialog.querySelector<HTMLElement>('[aria-pressed="true"]') ??
			focusableDialogElements(dialog)[0] ??
			dialog;
		initialFocus.focus();
		const backdrop = dialog.parentElement;
		const background = [...document.body.children].filter(
			(element): element is HTMLElement => element instanceof HTMLElement && element !== backdrop,
		);
		const backgroundState = background.map((element) => ({
			element,
			inert: element.inert,
			ariaHidden: element.getAttribute("aria-hidden"),
		}));
		for (const { element } of backgroundState) {
			element.inert = true;
			element.setAttribute("aria-hidden", "true");
		}

		const handleKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				if (
					event.target instanceof HTMLInputElement &&
					event.target.dataset.starterParameterInput === "true"
				) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				if (busyRef.current) onCancelBusyRef.current?.();
				else onCloseRef.current();
				return;
			}
			if (event.key !== "Tab") return;
			const focusable = focusableDialogElements(dialog);
			if (focusable.length === 0) {
				event.preventDefault();
				dialog.focus();
				return;
			}
			const first = focusable[0] as HTMLElement;
			const last = focusable[focusable.length - 1] as HTMLElement;
			const active = document.activeElement;
			const activeInside = active !== dialog && dialog.contains(active);
			if (event.shiftKey && (active === first || !activeInside)) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && (active === last || !activeInside)) {
				event.preventDefault();
				first.focus();
			}
		};
		window.addEventListener("keydown", handleKeyDown, true);
		return () => {
			window.removeEventListener("keydown", handleKeyDown, true);
			for (const { element, inert, ariaHidden } of backgroundState) {
				element.inert = inert;
				if (ariaHidden === null) element.removeAttribute("aria-hidden");
				else element.setAttribute("aria-hidden", ariaHidden);
			}
		};
	}, [suspended]);

	const selectStarter = (id: SyntheticFabStarterId): void => {
		const nextRequest = defaultSyntheticFabStarterRequest(id);
		setPreviewFailure(null);
		onClearOperationError?.();
		setIndependentVerificationResult(null);
		pendingPreviewActionRef.current = null;
		setPreview(readCachedStarterPreview(nextRequest));
		setPreviewRequested(mode !== "preset" || readCachedStarterPreview(nextRequest) !== undefined);
		setRequest(nextRequest);
	};
	const updateParameter = (
		descriptor: SyntheticFabStarterParameterDescriptor,
		value: number,
	): void => {
		setPreviewFailure(null);
		onClearOperationError?.();
		setIndependentVerificationResult(null);
		pendingPreviewActionRef.current = null;
		setPreview(undefined);
		setPreviewRequested(mode !== "preset");
		setRequest((current) => setSyntheticFabStarterParameter(current, descriptor.key, value));
	};
	const retryPreview = (): void => {
		setPreviewFailure(null);
		onClearOperationError?.();
		setPreview(undefined);
		setPreviewRequested(true);
		setRequest((current) => ({
			...current,
			parameters: { ...current.parameters },
		}));
	};
	const create = (): void => {
		if (!preview || !previewMatchesPlan) {
			if (mode === "preset" && previewIdle) {
				pendingPreviewActionRef.current = "create";
				setPreviewRequested(true);
			}
			return;
		}
		onConfirm(
			request,
			createsProject ? projectName.trim() || defaultProjectName : null,
			preview,
			independentVerification ?? undefined,
			certificationEvidence,
		);
	};
	const place = (): void => {
		if (!preview || !previewMatchesPlan || !preview.placementBundle || mode !== "preset") {
			if (mode === "preset" && previewIdle) {
				pendingPreviewActionRef.current = "place";
				setPreviewRequested(true);
			}
			return;
		}
		onPlace?.(request, preview, certificationEvidence);
	};
	const canPlacePreset =
		mode === "preset" &&
		onPlace !== undefined &&
		placementBlockedReason === null &&
		(previewIdle || (previewMatchesPlan && preview?.placementBundle !== null));
	const canCancel = !busy || onCancelBusy !== undefined;
	const cancelDialog = (): void => {
		if (busy) onCancelBusy?.();
		else onClose();
	};

	useEffect(() => {
		const action = pendingPreviewActionRef.current;
		if (!action || busy || !preview || !previewMatchesPlan) return;
		pendingPreviewActionRef.current = null;
		if (action === "place") {
			if (mode === "preset" && preview.placementBundle) {
				onPlace?.(request, preview, certificationEvidence);
			}
			return;
		}
		onConfirm(
			request,
			createsProject ? projectName.trim() || defaultProjectName : null,
			preview,
			independentVerification ?? undefined,
			certificationEvidence,
		);
	}, [
		busy,
		certificationEvidence,
		createsProject,
		independentVerification,
		defaultProjectName,
		mode,
		onConfirm,
		onPlace,
		preview,
		previewMatchesPlan,
		projectName,
		request,
	]);

	return createPortal(
		<div className="tilefab-starter-backdrop" role="presentation" data-suspended={suspended}>
			<section
				ref={dialogRef}
				className="tilefab-starter-dialog"
				role="dialog"
				tabIndex={-1}
				aria-modal={suspended ? undefined : true}
				aria-hidden={suspended ? true : undefined}
				aria-labelledby="tilefab-starter-title"
				aria-busy={busy || previewPending}
				data-testid="synthetic-fab-starter-dialog"
				data-busy={busy}
				data-independent-verification={
					certificationEvidence
						? "certified"
						: independentVerification === undefined
							? "pending"
							: independentVerification === null
								? "retry-on-create"
								: "ready"
				}
				data-mode={mode}
				data-preview-source={previewSource}
			>
				<header>
					<div>
						<span className="tilefab-starter-heading-icon">
							{createsProject ? <Factory size={19} /> : <LayoutTemplate size={19} />}
						</span>
						<span>
							<small>
								{mode === "project"
									? "NEW PROJECT · FACTORY STARTERS"
									: mode === "preset"
										? "FAB PRESETS · CREATE OR REPEAT-PLACE"
										: "CURRENT MAP · FAB ASSEMBLIES"}
							</small>
							<strong id="tilefab-starter-title">
								{mode === "project"
									? "FAB 구성 시작점"
									: mode === "preset"
										? "생산 FAB 레일 프리셋"
										: "생산 Bay 조립 패턴"}
							</strong>
						</span>
					</div>
					<button
						type="button"
						disabled={!canCancel}
						aria-label={
							busy
								? "진행 중인 FAB 생성을 취소"
								: mode === "project"
									? "스타터 선택 닫기"
									: mode === "preset"
										? "FAB 프리셋 선택 닫기"
										: "FAB 패턴 선택 닫기"
						}
						data-testid="close-synthetic-fab-starter"
						onClick={cancelDialog}
					>
						<X size={18} />
					</button>
				</header>
				{operationError ? (
					<div
						ref={operationErrorRef}
						className="tilefab-starter-operation-error"
						role="alert"
						tabIndex={-1}
						aria-atomic="true"
						data-testid="synthetic-fab-operation-error"
					>
						<AlertTriangle size={18} aria-hidden="true" />
						<span>
							<strong>FAB 생성에 실패했습니다</strong>
							<small>{operationError}</small>
						</span>
						{onClearOperationError ? (
							<button type="button" aria-label="FAB 생성 오류 닫기" onClick={onClearOperationError}>
								<X size={16} aria-hidden="true" />
							</button>
						) : null}
					</div>
				) : null}

				<div className="tilefab-starter-workspace">
					<nav
						className="tilefab-starter-list"
						aria-label={
							mode === "project"
								? "합성 FAB 스타터"
								: mode === "preset"
									? "대규모 FAB 레일 스타터"
									: "생산 Bay 조립 패턴"
						}
					>
						{catalog.map((candidate) => (
							<button
								type="button"
								aria-pressed={candidate.id === request.id}
								key={candidate.id}
								disabled={busy}
								data-active={candidate.id === request.id}
								data-testid={`synthetic-fab-starter-${candidate.id}`}
								onClick={() => selectStarter(candidate.id)}
							>
								<StarterMiniature id={candidate.id} />
								<span>
									<small>{candidate.stage}</small>
									<strong>{candidate.label}</strong>
									<em>{candidate.title}</em>
								</span>
								{candidate.id === request.id ? <Check size={16} /> : null}
							</button>
						))}
					</nav>

					<section
						className="tilefab-starter-preview"
						data-testid="synthetic-fab-starter-preview"
						data-starter-id={request.id}
						data-rail-cells={preview?.summary.railCells ?? ""}
						data-zone-count={preview?.summary.zoneCount ?? ""}
						data-bay-count={preview?.summary.bayCount ?? ""}
						data-bay-pitch={
							isLargeFabPresetRequest(request) ? request.parameters.bayPitchMeters : ""
						}
						data-process-rows={currentSchematic?.processRowCount ?? ""}
						data-process-banks={currentSchematic?.processBankCount ?? ""}
						data-process-blocks={currentSchematic?.processBlockCount ?? ""}
						data-interbay-spines={currentSchematic?.interbaySpineCount ?? ""}
						data-wall-circuits={currentSchematic?.wallCircuitCount ?? ""}
						data-outer-circulations={currentSchematic?.outerCirculationCount ?? ""}
						data-wall-circuit-links={currentSchematic?.wallCircuitLinkCount ?? ""}
						data-outer-gateways={currentSchematic?.outerGatewayCount ?? ""}
						data-plan-fingerprint={expectedPlanFingerprint ?? ""}
						data-prepared-plan-fingerprint={preview?.planFingerprint ?? ""}
						data-directed-edges={preview?.summary.directedEdges ?? ""}
						data-physical-paths={preview?.summary.physicalPaths ?? ""}
						data-strong-components={preview?.summary.strongComponents ?? ""}
						data-open-terminals={preview?.summary.openTerminals ?? ""}
						data-authored-checksum={preview?.authoredChecksum ?? ""}
						data-operation-sequence={preview?.snapshot.sequence ?? ""}
						data-analysis-fingerprint={preview?.analysisFingerprint ?? ""}
						data-physical-fingerprint={preview?.physicalFingerprint ?? ""}
						data-request-fingerprint={preview?.requestFingerprint ?? ""}
						data-preview-source={previewSource}
						data-preview-state={
							previewFailure?.kind ??
							(previewIdle
								? "catalog-ready"
								: preview === undefined
									? "verifying"
									: preview === null
										? "invalid"
										: "ready")
						}
					>
						<div className="tilefab-starter-preview-stage">
							<StarterRailPreview
								preview={preview}
								request={request}
								label={previewLabel}
								schematic={currentSchematic}
								failure={previewFailure}
								idle={previewIdle}
								busy={busy}
								onRetry={retryPreview}
							/>
						</div>
						<div className="tilefab-starter-preview-title">
							<span>
								<small>{item.stage}</small>
								<strong>{previewLabel}</strong>
							</span>
							<em data-testid="synthetic-fab-preview-source">
								{previewIdle
									? "OPENFAB VERIFIED · READY ON DEMAND"
									: preview === undefined
										? certifiedPreviewPending
											? "LOADING OPENFAB ARTIFACT"
											: "LIVE PHYSICAL VERIFICATION"
										: certificationEvidence
											? "OPENFAB VERIFIED · STATIC AUTHORING"
											: "CUSTOM · LIVE VERIFIED"}
							</em>
						</div>
						<StarterMetrics
							requestId={request.id}
							summary={preview?.summary ?? null}
							scaleUnit={
								request.id === "paired-circulation-fab-52" ||
								request.id === "full-fab-52" ||
								request.id === "production-fab-60" ||
								request.id === "parallel-hall-fab-12"
									? "BANKS"
									: request.id === "large-fab-60"
										? "WINGS"
										: "ZONES"
							}
							pending={previewPending}
							idle={previewIdle}
							failed={previewFailure !== null}
						/>
						{certificationEvidence ? <StarterVerificationScopes /> : null}
						<ul className="tilefab-starter-steps" aria-label="생성 구성">
							{previewFailure ? (
								<li>
									<AlertTriangle size={13} /> EXACT BUILD PLAN UNAVAILABLE
								</li>
							) : request.id === "paired-circulation-fab-52" ? (
								pairedCirculationFabPresetBuildStages(request.parameters.bayCount).map(
									(stage, index) => (
										<li key={stage}>
											<Route size={13} />
											{(index + 1).toString().padStart(2, "0")} {stage}
										</li>
									),
								)
							) : request.id === "full-fab-52" ? (
								fullFabPresetBuildStages(request.parameters.bayCount).map((stage, index) => (
									<li key={stage}>
										<Route size={13} />
										{(index + 1).toString().padStart(2, "0")} {stage}
									</li>
								))
							) : request.id === "parallel-hall-fab-12" ? (
								parallelHallFabPresetBuildStages(request.parameters.bayCount).map(
									(stage, index) => (
										<li key={stage}>
											<Route size={13} />
											{(index + 1).toString().padStart(2, "0")} {stage}
										</li>
									),
								)
							) : request.id === "central-spine-fab-24" ? (
								centralSpineFabPresetBuildStages(request.parameters.bayCount).map(
									(stage, index) => (
										<li key={stage}>
											<Route size={13} />
											{(index + 1).toString().padStart(2, "0")} {stage}
										</li>
									),
								)
							) : request.id === "production-fab-60" ? (
								productionFabPresetBuildStages(
									requiredProductionFabAssembly(productionFabAssembly),
								).map((stage, index) => (
									<li key={stage}>
										<Route size={13} />
										{(index + 1).toString().padStart(2, "0")} {stage}
									</li>
								))
							) : request.id === "large-fab-60" ? (
								largeFabPresetBuildStages(requiredLargeFabAssembly(largeFabAssembly)).map(
									(stage, index) => (
										<li key={stage}>
											<Route size={13} />
											{(index + 1).toString().padStart(2, "0")} {stage}
										</li>
									),
								)
							) : preview === undefined ? (
								<li>
									<Route size={13} />{" "}
									{certifiedPreviewPending
										? "OPENFAB ARTIFACT LOADING"
										: previewIdle
											? "OPENFAB VERIFIED RAIL READY ON COMMAND"
											: "PHYSICAL BUILD PLAN VERIFYING"}
								</li>
							) : preview?.steps.length ? (
								preview.steps.map((step) => (
									<li key={`${step.ordinal}-${step.templateId}`}>
										<Route size={13} />
										{step.ordinal.toString().padStart(2, "0")} {step.label}
									</li>
								))
							) : (
								<li>
									<Grid3X3 size={13} /> 1 m EMPTY GRID
								</li>
							)}
						</ul>
					</section>

					<fieldset className="tilefab-starter-config" aria-label="스타터 치수" disabled={busy}>
						<legend>CONFIGURATION</legend>
						{item.parameters.length === 0 ? (
							<div className="tilefab-starter-empty-config">
								<Grid3X3 size={18} />
								<span>
									<strong>1 m GRID</strong>
									<small>0 CELLS · 0 EDGES</small>
								</span>
							</div>
						) : (
							item.parameters.map((descriptor) => {
								const value = request.parameters[descriptor.key];
								const effectiveMaximum =
									request.id === "production-fab-60" && descriptor.key === "bayPitchMeters"
										? productionFabMaximumBayPitchMeters(
												request.parameters.bayCount,
												request.parameters.processBlockCount,
											)
										: descriptor.maximum;
								const effectiveDescriptor =
									effectiveMaximum === descriptor.maximum
										? descriptor
										: Object.freeze({ ...descriptor, maximum: effectiveMaximum });
								return (
									<div className="tilefab-starter-parameter" key={descriptor.key}>
										<label htmlFor={`tilefab-starter-${descriptor.key}`}>
											<span>{descriptor.label}</span>
											<small>
												{descriptor.minimum}-{effectiveMaximum} {descriptor.unit}
											</small>
										</label>
										<div>
											<button
												type="button"
												aria-label={`${descriptor.label} 줄이기`}
												disabled={value <= descriptor.minimum}
												onClick={() => updateParameter(descriptor, value - descriptor.step)}
											>
												<Minus size={14} />
											</button>
											<StarterParameterNumberInput
												descriptor={effectiveDescriptor}
												value={value}
												disabled={busy}
												onCommit={(nextValue) => updateParameter(descriptor, nextValue)}
											/>
											<span>{descriptor.unit}</span>
											<button
												type="button"
												aria-label={`${descriptor.label} 늘리기`}
												disabled={value >= effectiveMaximum}
												onClick={() => updateParameter(descriptor, value + descriptor.step)}
											>
												<Plus size={14} />
											</button>
										</div>
									</div>
								);
							})
						)}
					</fieldset>
				</div>

				<footer>
					{createsProject ? (
						<div className="tilefab-starter-project-field">
							<label htmlFor="tilefab-starter-project-name">
								<span>{mode === "preset" ? "NEW PROJECT NAME" : "PROJECT NAME"}</span>
								<input
									id="tilefab-starter-project-name"
									value={projectName}
									maxLength={80}
									disabled={busy}
									data-testid="synthetic-fab-project-name"
									onChange={(event) => {
										onClearOperationError?.();
										setProjectNameOverride(event.currentTarget.value);
									}}
								/>
							</label>
							{mode === "preset" && placementBlockedReason ? (
								<small
									id="tilefab-starter-placement-status"
									className="tilefab-starter-placement-blocked"
									data-testid="synthetic-fab-placement-blocked"
									role="status"
								>
									<AlertTriangle size={12} aria-hidden="true" /> {placementBlockedReason}
								</small>
							) : null}
						</div>
					) : (
						<div className="tilefab-starter-placement-mode">
							<Stamp size={17} />
							<span>
								<small>PLACEMENT MODE</small>
								<strong>REPEATABLE · MULTI-PLACE</strong>
							</span>
						</div>
					)}
					<div className="tilefab-starter-actions">
						<span
							id="tilefab-starter-create-status"
							className="tilefab-sr-only"
							role="status"
							aria-live="polite"
							aria-atomic="true"
						>
							{busy
								? "정적 레일 프로젝트를 활성화하고 검증하는 중입니다. 생성 취소를 사용할 수 있습니다."
								: previewIdle
									? "프리셋 사양과 도식이 준비되었습니다. 새 프로젝트 또는 현재 FAB에 1회 배치를 선택하면 OpenFab 검증 레일을 불러옵니다."
									: previewPending
										? certifiedPreviewPending
											? "빌드 시 검증된 OpenFab 합성 레일 아티팩트를 불러오는 중입니다."
											: "FAB 물리 경로를 Worker에서 검증하는 중입니다."
										: previewMatchesPlan
											? certificationEvidence
												? "OpenFab이 검증한 정적 레일 기반을 사용할 수 있습니다. Port Service는 아직 검사되지 않았습니다."
												: independentVerification === undefined
													? "FAB 물리 경로 검증이 완료되었습니다. 독립 Worker가 최종 교차검증 중입니다."
													: independentVerification === null
														? "FAB 물리 경로 검증이 완료되었습니다. 생성 시 독립 교차검증을 다시 시도합니다."
														: "FAB 물리 경로와 독립 교차검증이 완료되어 즉시 생성할 수 있습니다."
											: "FAB 설정을 확인해야 생성할 수 있습니다."}
						</span>
						<button
							ref={cancelBusyButtonRef}
							type="button"
							disabled={!canCancel}
							onClick={cancelDialog}
						>
							{busy ? "생성 취소" : "취소"}
						</button>
						<button
							type="button"
							className={mode === "preset" ? undefined : "tilefab-starter-create"}
							disabled={busy || (!previewIdle && !previewMatchesPlan)}
							aria-describedby="tilefab-starter-create-status"
							data-testid={
								mode === "pattern"
									? "place-synthetic-fab-pattern"
									: mode === "preset"
										? "create-project-from-synthetic-fab-preset"
										: "create-synthetic-fab-project"
							}
							onClick={create}
						>
							{createsProject ? <Factory size={16} /> : <Stamp size={16} />}
							{busy
								? createsProject
									? "CREATING"
									: "PREPARING"
								: previewPending
									? certifiedPreviewPending
										? "LOADING"
										: "VERIFYING"
									: mode === "pattern"
										? "START PLACEMENT"
										: mode === "preset"
											? "NEW PROJECT"
											: "CREATE PROJECT"}
						</button>
						{mode === "preset" ? (
							<button
								type="button"
								className="tilefab-starter-create"
								disabled={busy || !canPlacePreset}
								title={placementBlockedReason ?? undefined}
								aria-describedby={
									placementBlockedReason
										? "tilefab-starter-placement-status"
										: "tilefab-starter-create-status"
								}
								data-testid="place-synthetic-fab-preset"
								onClick={place}
							>
								<Stamp size={16} />
								{busy ? "PREPARING" : previewPending ? "LOADING" : "PLACE ONCE"}
							</button>
						) : null}
					</div>
				</footer>
			</section>
		</div>,
		document.body,
	);
}

const STARTER_PREVIEW_CACHE_LIMIT = 32;
const STARTER_PREVIEW_DEBOUNCE_MILLISECONDS = 225;
const LARGE_FAB_PREVIEW_DEBOUNCE_MILLISECONDS = 650;
const starterPreviewCache = new SyntheticFabStarterPreviewCache(
	STARTER_PREVIEW_CACHE_LIMIT,
	SYNTHETIC_FAB_STARTER_PREVIEW_CACHE_BYTES_LIMIT,
);
const certifiedEvidenceByPreview = new WeakMap<
	PreparedSyntheticFabStarter,
	SyntheticFabStarterCertificationEvidence
>();

interface StarterPreviewLoad {
	readonly promise: Promise<PreparedSyntheticFabStarter | null>;
	readonly cancel: () => void;
}

function beginStarterPreviewLoad(request: SyntheticFabStarterRequest): StarterPreviewLoad {
	const cacheKey = starterPreviewCacheKey(request);
	return starterPreviewCache.acquire(cacheKey, () => beginUncachedStarterPreviewLoad(request));
}

function beginUncachedStarterPreviewLoad(request: SyntheticFabStarterRequest): StarterPreviewLoad {
	let cancelled = false;
	let liveLoad: StarterPreviewLoad | null = null;
	const promise = loadCertifiedSyntheticFabStarter(request).then(async (certified) => {
		if (cancelled) return null;
		if (certified) {
			certifiedEvidenceByPreview.set(certified.prepared, certified.evidence);
			return certified.prepared;
		}
		liveLoad = beginLiveStarterPreviewLoad(request);
		return liveLoad.promise;
	});
	return Object.freeze({
		promise,
		cancel: () => {
			if (cancelled) return;
			cancelled = true;
			liveLoad?.cancel();
		},
	});
}

function beginLiveStarterPreviewLoad(request: SyntheticFabStarterRequest): StarterPreviewLoad {
	let cancelled = false;
	let bridge: SyntheticFabStarterBridge | null = null;
	let startTimeout: number | null = null;
	let resolveBeforeStart: ((prepared: PreparedSyntheticFabStarter | null) => void) | null = null;
	const preparation = new Promise<PreparedSyntheticFabStarter | null>((resolve, reject) => {
		resolveBeforeStart = resolve;
		startTimeout = globalThis.setTimeout(
			() => {
				startTimeout = null;
				resolveBeforeStart = null;
				if (cancelled) {
					resolve(null);
					return;
				}
				if (typeof Worker === "undefined") {
					if (isLargeFabPresetRequest(request)) {
						reject(
							new StarterPreviewLoadError(
								"worker-error",
								"대규모 FAB 미리보기에 필요한 Worker를 사용할 수 없습니다.",
							),
						);
						return;
					}
					try {
						resolve(prepareSyntheticFabStarter(request));
					} catch (error) {
						reject(
							new StarterPreviewLoadError(
								"invalid-request",
								previewErrorMessage(error, "FAB 설정을 검증할 수 없습니다."),
							),
						);
					}
					return;
				}
				bridge = new SyntheticFabStarterBridge();
				void bridge.prepare(request).then(resolve, (error: unknown) => {
					reject(
						new StarterPreviewLoadError(
							"worker-error",
							previewErrorMessage(error, "FAB 미리보기 Worker가 응답하지 않았습니다."),
						),
					);
				});
			},
			isLargeFabPresetRequest(request)
				? LARGE_FAB_PREVIEW_DEBOUNCE_MILLISECONDS
				: STARTER_PREVIEW_DEBOUNCE_MILLISECONDS,
		);
	});
	const promise = preparation
		.then((prepared) => (cancelled ? null : prepared))
		.catch((error: unknown) => {
			if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
				return null;
			}
			throw error;
		});
	return Object.freeze({
		promise,
		cancel: () => {
			if (cancelled) return;
			cancelled = true;
			bridge?.dispose();
			if (startTimeout !== null) {
				globalThis.clearTimeout(startTimeout);
				startTimeout = null;
			}
			resolveBeforeStart?.(null);
			resolveBeforeStart = null;
		},
	});
}

function certifiedStarterEvidence(
	preview: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
): SyntheticFabStarterCertificationEvidence | undefined {
	const evidence = certifiedEvidenceByPreview.get(preview);
	return evidence && certificationEvidenceBindsPreparedIdentity(evidence, preview, request)
		? evidence
		: undefined;
}

class StarterPreviewLoadError extends Error {
	readonly kind: StarterPreviewFailure["kind"];

	constructor(kind: StarterPreviewFailure["kind"], message: string) {
		super(message);
		this.name = "StarterPreviewLoadError";
		this.kind = kind;
	}
}

function starterPreviewFailure(error: unknown): StarterPreviewFailure {
	if (error instanceof StarterPreviewLoadError) {
		return Object.freeze({ kind: error.kind, message: error.message });
	}
	return Object.freeze({
		kind: "worker-error",
		message: previewErrorMessage(error, "FAB 미리보기를 준비하지 못했습니다."),
	});
}

function previewErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function readCachedStarterPreview(
	request: SyntheticFabStarterRequest,
): PreparedSyntheticFabStarter | null | undefined {
	const cacheKey = starterPreviewCacheKey(request);
	const cached = starterPreviewCache.get(cacheKey);
	if (
		!cached ||
		(cached.requestFingerprint === syntheticFabStarterRequestFingerprint(request) &&
			cached.planFingerprint === syntheticFabStarterAssemblyFingerprint(request))
	) {
		return cached;
	}
	starterPreviewCache.delete(cacheKey);
	return undefined;
}

function starterPreviewCacheKey(request: SyntheticFabStarterRequest): string {
	return `${syntheticFabStarterRequestFingerprint(request)}|${syntheticFabStarterAssemblyFingerprint(request) ?? "no-plan"}`;
}

function isLargeFabPresetRequest(request: SyntheticFabStarterRequest): boolean {
	return (
		request.id === "large-fab-60" ||
		request.id === "paired-circulation-fab-52" ||
		request.id === "full-fab-52" ||
		request.id === "parallel-hall-fab-12" ||
		request.id === "central-spine-fab-24" ||
		request.id === "production-fab-60"
	);
}

function pairedCirculationFabPresetBuildStages(bayCount: number): readonly string[] {
	return Object.freeze([
		"TWO OPPOSITE-DIRECTION OUTER CIRCULATION LOOPS",
		"TWO BALANCED OUTER-LANE REVERSAL GATEWAYS",
		"TWO PAIRED INTERBAY PRODUCTION HALLS",
		`4 BAY BANKS · ${bayCount} LARGE BAY SHELLS`,
		"MIXED SINGLE-LOOP / TWIN-LOOP BAY INTERIORS",
		`${bayCount} BAY ↔ INTERBAY + 4 HALL ↔ OUTER GATEWAYS`,
	]);
}

function requiredLargeFabAssembly(
	assembly: SyntheticFabAssemblyPlan | null,
): SyntheticFabAssemblyPlan {
	if (!assembly) throw new Error("Large FAB assembly plan is unavailable.");
	return assembly;
}

function largeFabPresetBuildStages(assembly: SyntheticFabAssemblyPlan): readonly string[] {
	const { topology } = assembly;
	return Object.freeze([
		"FAB-WIDE OUTER CIRCULATION",
		"ONE SHARED INNER WALL CIRCUIT",
		"CENTRAL DUAL-LANE INTERBAY SPINE",
		`${topology.processBlocks.length} PROCESS BLOCKS · ${topology.processBanks.length} BANKS · ${topology.rows} ROWS`,
		`${topology.wings.length} PROCESS ROW TRUNKS · ${topology.wings.reduce((total, wing) => total + wing.bayCount, 0)} TANGENT BAYS`,
		"CONTINUOUS WALL ↔ SPINE OUTBOUND / RETURN LANES",
		`${topology.spineWallLinks.length} SPINE/WALL · ${topology.wallOuterLinks.length} CARDINAL OUTER GATEWAYS`,
	]);
}

function requiredProductionFabAssembly(
	assembly: ProductionFabAssemblyPlan | null,
): ProductionFabAssemblyPlan {
	if (!assembly) throw new Error("Production FAB assembly plan is unavailable.");
	return assembly;
}

function productionFabPresetBuildStages(assembly: ProductionFabAssemblyPlan): readonly string[] {
	return Object.freeze([
		"FAB-WIDE OUTER CIRCULATION",
		"ONE SHARED INTERBAY SPINE",
		`${assembly.banks.length} BAY BANK COLLECTORS`,
		`${assembly.profile.bayCount} PRODUCTION BAY ASSEMBLIES`,
		`${assembly.profile.bayCount * 2} INTERNAL PROCESS LOOPS`,
		"ONE CLOSED DIRECTED PHYSICAL NETWORK",
	]);
}

function centralSpineFabPresetBuildStages(bayCount: number): readonly string[] {
	return Object.freeze([
		"FAB-WIDE OUTER CIRCULATION",
		"ONE CENTRAL INTERBAY SPINE",
		"TWO OPPOSED BAY BANKS",
		`${bayCount} DEEP BAY CIRCULATION ENVELOPES`,
		`${bayCount * 2} FULL-DEPTH PARALLEL PROCESS LOOPS`,
		"ONE CLOSED DIRECTED PHYSICAL NETWORK",
	]);
}

function parallelHallFabPresetBuildStages(bayCount: number): readonly string[] {
	return Object.freeze([
		"FAB-WIDE OUTER CIRCULATION",
		"ONE CENTRAL INTERBAY SPINE",
		"TWO SEPARATE PRODUCTION BANK COLLECTORS",
		"FOUR EXPLICIT OUTER / INTERBAY GATEWAYS",
		`${bayCount} LONG PRODUCTION BAYS · ${bayCount * 2} FULL-DEPTH PROCESS LOOPS`,
		"ONE CLOSED DIRECTED PHYSICAL NETWORK",
	]);
}

function fullFabPresetBuildStages(bayCount: number): readonly string[] {
	return Object.freeze([
		"FAB-WIDE OUTER CIRCULATION",
		"TWO PROCESS HALL INTERBAY LOOPS",
		"FOUR OPPOSED BAY BANK COLLECTORS",
		"EIGHT EXPLICIT OUTER / INTERBAY GATEWAYS",
		`${bayCount} PRODUCTION BAYS · ${bayCount * 2} FULL-DEPTH PROCESS LOOPS`,
		"ONE CLOSED DIRECTED PHYSICAL NETWORK",
	]);
}

function StarterMiniature({ id }: Readonly<{ id: SyntheticFabStarterId }>): React.ReactElement {
	const request = useMemo(() => defaultSyntheticFabStarterRequest(id), [id]);
	return (
		<div className="tilefab-starter-list-miniature" aria-hidden="true">
			<StarterSchematicPreview
				request={request}
				label={syntheticFabStarterCatalogItem(id).label}
				pending={false}
			/>
		</div>
	);
}

function StarterRailPreview({
	preview,
	request,
	label,
	schematic,
	failure,
	idle,
	busy,
	onRetry,
}: Readonly<{
	preview: PreparedSyntheticFabStarter | null | undefined;
	request: SyntheticFabStarterRequest;
	label: string;
	schematic: SyntheticFabStarterSchematic | null;
	failure: StarterPreviewFailure | null;
	idle: boolean;
	busy: boolean;
	onRetry: () => void;
}>): React.ReactElement {
	if (preview === undefined) {
		return (
			<StarterSchematicPreview
				request={request}
				label={label}
				pending={!idle}
				schematic={schematic}
			/>
		);
	}
	if (failure) {
		return (
			<div className="tilefab-starter-preview-error" role="alert" data-kind={failure.kind}>
				<AlertTriangle size={19} />
				<span>
					<strong>
						{failure.kind === "worker-error" ? "PREVIEW WORKER ERROR" : "INVALID CONFIGURATION"}
					</strong>
					<small>{failure.message}</small>
				</span>
				{failure.kind === "worker-error" ? (
					<button
						type="button"
						disabled={busy}
						onClick={onRetry}
						aria-label="FAB 미리보기 다시 시도"
					>
						<RefreshCw size={14} /> RETRY
					</button>
				) : null}
			</div>
		);
	}
	if (!preview) {
		return (
			<div className="tilefab-starter-preview-error" role="status">
				<X size={18} /> INVALID CONFIGURATION
			</div>
		);
	}
	if (
		request.id === "paired-circulation-fab-52" ||
		request.id === "full-fab-52" ||
		request.id === "parallel-hall-fab-12" ||
		request.id === "production-fab-60" ||
		request.id === "central-spine-fab-24"
	) {
		return (
			<StarterSchematicPreview
				request={request}
				label={label}
				pending={false}
				schematic={schematic}
			/>
		);
	}
	if (isLargeFabPresetRequest(request)) {
		return preview.exactGeometry ? (
			<ExactStarterRailPreview
				key={preview.exactGeometry.fingerprint}
				geometry={preview.exactGeometry}
				label={label}
			/>
		) : (
			<div className="tilefab-starter-preview-error" role="alert">
				<AlertTriangle size={18} /> EXACT PHYSICAL PREVIEW UNAVAILABLE
			</div>
		);
	}
	const { geometry } = preview;
	if (!geometry) {
		return (
			<div className="tilefab-starter-empty-preview" role="img" aria-label={`${label} 빈 격자`}>
				<Grid3X3 size={38} />
			</div>
		);
	}
	const padding = Math.max(
		2,
		Math.max(
			geometry.bounds.maxX - geometry.bounds.minX,
			geometry.bounds.maxY - geometry.bounds.minY,
		) * 0.04,
	);
	const width = Math.max(1, geometry.bounds.maxX - geometry.bounds.minX + padding * 2);
	const height = Math.max(1, geometry.bounds.maxY - geometry.bounds.minY + padding * 2);
	return (
		<svg
			className="tilefab-starter-rail-preview"
			viewBox={`${geometry.bounds.minX - padding} ${geometry.bounds.minY - padding} ${width} ${height}`}
			preserveAspectRatio="xMidYMid meet"
			aria-label={`${label} 물리 레일 미리보기`}
			role="img"
		>
			<title>{label} 물리 레일 미리보기</title>
			<StarterPathLayers pathData={geometry.pathData} />
			{geometry.markers.map((marker) => (
				<path
					key={`${marker.x}:${marker.y}:${marker.angleDegrees}`}
					className="tilefab-starter-flow"
					d="M -1 -0.62 L 1.05 0 L -1 0.62 Z"
					transform={`translate(${marker.x} ${marker.y}) rotate(${marker.angleDegrees}) scale(${geometry.markerScale})`}
				/>
			))}
		</svg>
	);
}

function ExactStarterRailPreview({
	geometry,
	label,
}: Readonly<{
	geometry: NonNullable<PreparedSyntheticFabStarter["exactGeometry"]>;
	label: string;
}>): React.ReactElement {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
	const dragRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		panX: number;
		panY: number;
	} | null>(null);
	const [zoom, setZoom] = useState(1);
	const descriptionId = useId();
	const redraw = (): void => {
		const canvas = canvasRef.current;
		if (canvas) drawExactStarterRailPreview(canvas, geometry, viewRef.current);
	};
	const applyZoom = (nextZoom: number, focusX?: number, focusY?: number): void => {
		const canvas = canvasRef.current;
		const previous = viewRef.current;
		const clamped = Math.max(1, Math.min(4, nextZoom));
		if (Math.abs(clamped - previous.zoom) < 0.001) return;
		const centerX = (canvas?.clientWidth ?? 0) / 2;
		const centerY = (canvas?.clientHeight ?? 0) / 2;
		const anchorX = focusX ?? centerX;
		const anchorY = focusY ?? centerY;
		const ratio = clamped / previous.zoom;
		viewRef.current = {
			zoom: clamped,
			panX: anchorX - centerX - (anchorX - centerX - previous.panX) * ratio,
			panY: anchorY - centerY - (anchorY - centerY - previous.panY) * ratio,
		};
		setZoom(clamped);
		redraw();
	};
	const resetView = (): void => {
		viewRef.current = { zoom: 1, panX: 0, panY: 0 };
		setZoom(1);
		redraw();
	};
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		viewRef.current = { zoom: 1, panX: 0, panY: 0 };
		const draw = (): void => drawExactStarterRailPreview(canvas, geometry, viewRef.current);
		let animationFrame = 0;
		const scheduleDraw = (): void => {
			if (animationFrame !== 0) return;
			if (typeof globalThis.requestAnimationFrame !== "function") {
				draw();
				return;
			}
			animationFrame = globalThis.requestAnimationFrame(() => {
				animationFrame = 0;
				draw();
			});
		};
		scheduleDraw();
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleDraw);
		observer?.observe(canvas);
		globalThis.addEventListener("resize", scheduleDraw);
		return () => {
			observer?.disconnect();
			globalThis.removeEventListener("resize", scheduleDraw);
			if (animationFrame !== 0) globalThis.cancelAnimationFrame(animationFrame);
		};
	}, [geometry]);
	return (
		<div className="tilefab-starter-exact-shell">
			<span id={descriptionId} className="tilefab-sr-only">
				외곽 순환, 인터베이 척추, Bay Bank, 생산 Bay와 내부 Process Loop를 포함하며 생성될
				프로젝트의 컴파일된 물리 경로와 동일합니다. 휠이나 더하기와 빼기 키로 확대하고, 드래그하거나
				방향키로 이동하며, 숫자 0으로 전체 보기에 맞춥니다.
			</span>
			<canvas
				ref={canvasRef}
				className="tilefab-starter-exact-preview"
				role="img"
				tabIndex={0}
				data-preview-zoom={zoom.toFixed(2)}
				aria-label={`${label} 실제 생성 물리 경로 미리보기`}
				aria-describedby={descriptionId}
				onPointerDown={(event) => {
					if (event.button !== 0 && event.button !== 1) return;
					event.currentTarget.focus();
					event.currentTarget.setPointerCapture(event.pointerId);
					dragRef.current = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						panX: viewRef.current.panX,
						panY: viewRef.current.panY,
					};
					event.currentTarget.dataset.dragging = "true";
				}}
				onPointerMove={(event) => {
					const drag = dragRef.current;
					if (!drag || drag.pointerId !== event.pointerId) return;
					viewRef.current = {
						...viewRef.current,
						panX: drag.panX + event.clientX - drag.startX,
						panY: drag.panY + event.clientY - drag.startY,
					};
					redraw();
				}}
				onPointerUp={(event) => {
					if (dragRef.current?.pointerId !== event.pointerId) return;
					dragRef.current = null;
					delete event.currentTarget.dataset.dragging;
					if (event.currentTarget.hasPointerCapture(event.pointerId)) {
						event.currentTarget.releasePointerCapture(event.pointerId);
					}
				}}
				onPointerCancel={(event) => {
					dragRef.current = null;
					delete event.currentTarget.dataset.dragging;
				}}
				onWheel={(event) => {
					event.preventDefault();
					const rect = event.currentTarget.getBoundingClientRect();
					applyZoom(
						viewRef.current.zoom * (event.deltaY < 0 ? 1.25 : 0.8),
						event.clientX - rect.left,
						event.clientY - rect.top,
					);
				}}
				onKeyDown={(event) => {
					if (event.key === "+" || event.key === "=") applyZoom(viewRef.current.zoom * 1.25);
					else if (event.key === "-") applyZoom(viewRef.current.zoom * 0.8);
					else if (event.key === "0") resetView();
					else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
						const step = event.shiftKey ? 64 : 24;
						viewRef.current = {
							...viewRef.current,
							panX:
								viewRef.current.panX +
								(event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0),
							panY:
								viewRef.current.panY +
								(event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0),
						};
						redraw();
					} else return;
					event.preventDefault();
				}}
			>
				{label} 실제 생성 물리 경로 미리보기
			</canvas>
			<div className="tilefab-starter-exact-controls" role="toolbar" aria-label="미리보기 배율">
				<button
					type="button"
					disabled={zoom <= 1.001}
					aria-label="미리보기 축소"
					title="축소"
					onClick={() => applyZoom(viewRef.current.zoom * 0.8)}
				>
					<ZoomOut size={16} />
				</button>
				<button
					type="button"
					disabled={zoom >= 3.999}
					aria-label="미리보기 확대"
					title="확대"
					onClick={() => applyZoom(viewRef.current.zoom * 1.25)}
				>
					<ZoomIn size={16} />
				</button>
				<button type="button" aria-label="전체 경로 보기" title="전체 보기" onClick={resetView}>
					<Maximize2 size={16} />
				</button>
			</div>
			<span className="tilefab-starter-schematic-status" data-verified="true" role="status">
				<Check size={13} /> EXACT GEOMETRY · SAMPLED FLOW
			</span>
		</div>
	);
}

function drawExactStarterRailPreview(
	canvas: HTMLCanvasElement,
	geometry: NonNullable<PreparedSyntheticFabStarter["exactGeometry"]>,
	view: Readonly<{ zoom: number; panX: number; panY: number }> = {
		zoom: 1,
		panX: 0,
		panY: 0,
	},
): void {
	const width = Math.max(1, Math.floor(canvas.clientWidth));
	const height = Math.max(1, Math.floor(canvas.clientHeight));
	const pixelRatio = Math.max(1, Math.min(2, globalThis.devicePixelRatio || 1));
	const backingWidth = Math.max(1, Math.round(width * pixelRatio));
	const backingHeight = Math.max(1, Math.round(height * pixelRatio));
	if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
		canvas.width = backingWidth;
		canvas.height = backingHeight;
	}
	const context = canvas.getContext("2d");
	if (!context) return;
	context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
	context.clearRect(0, 0, width, height);
	const padding = 18;
	const worldWidth = Math.max(1, geometry.bounds.maxX - geometry.bounds.minX);
	const worldHeight = Math.max(1, geometry.bounds.maxY - geometry.bounds.minY);
	const fitScale = Math.max(
		0.0001,
		Math.min((width - padding * 2) / worldWidth, (height - padding * 2) / worldHeight),
	);
	const scale = fitScale * view.zoom;
	const left = (width - worldWidth * scale) / 2 - geometry.bounds.minX * scale + view.panX;
	const top = (height - worldHeight * scale) / 2 - geometry.bounds.minY * scale + view.panY;
	context.setTransform(
		pixelRatio * scale,
		0,
		0,
		pixelRatio * scale,
		pixelRatio * left,
		pixelRatio * top,
	);
	// Physical paths are split at every authored metre. Keep rounded continuity,
	// but scale the rail width below so those caps stay compact at FAB overview scale.
	context.lineCap = "round";
	context.lineJoin = "round";
	const overviewRailWidth = Math.max(1.5, Math.min(4.5, scale * 5.5));
	for (const [strokeStyle, screenWidth] of [
		["#19383b", overviewRailWidth * 1.9],
		["#8ddae0", overviewRailWidth],
		["#d9fbfc", Math.max(0.55, overviewRailWidth * 0.28)],
	] as const) {
		context.beginPath();
		for (let runIndex = 0; runIndex < geometry.runCount; runIndex++) {
			const pathStart = geometry.runOffsets[runIndex] as number;
			const pathEnd = geometry.runOffsets[runIndex + 1] as number;
			for (let runPathIndex = pathStart; runPathIndex < pathEnd; runPathIndex++) {
				const pathIndex = geometry.runPathIndices[runPathIndex] as number;
				const pointStart = geometry.offsets[pathIndex] as number;
				const pointEnd = geometry.offsets[pathIndex + 1] as number;
				if (pointEnd <= pointStart) continue;
				if (runPathIndex === pathStart) {
					context.moveTo(
						geometry.positions[pointStart * 2] as number,
						geometry.positions[pointStart * 2 + 1] as number,
					);
				}
				for (let pointIndex = pointStart + 1; pointIndex < pointEnd; pointIndex++) {
					context.lineTo(
						geometry.positions[pointIndex * 2] as number,
						geometry.positions[pointIndex * 2 + 1] as number,
					);
				}
			}
			if ((geometry.runClosed[runIndex] as number) !== 0) context.closePath();
		}
		context.strokeStyle = strokeStyle;
		context.lineWidth = screenWidth / scale;
		context.stroke();
	}
	context.fillStyle = "#f0b95a";
	context.strokeStyle = "#071011";
	context.lineWidth = 0.8 / scale;
	for (let index = 0; index < geometry.markers.length; index += 3) {
		context.save();
		context.translate(geometry.markers[index] as number, geometry.markers[index + 1] as number);
		context.rotate(geometry.markers[index + 2] as number);
		context.scale(geometry.markerScale, geometry.markerScale);
		context.beginPath();
		context.moveTo(-1, -0.62);
		context.lineTo(1.05, 0);
		context.lineTo(-1, 0.62);
		context.closePath();
		context.fill();
		context.stroke();
		context.restore();
	}
}

function StarterSchematicPreview({
	request,
	label,
	pending,
	schematic: suppliedSchematic,
}: Readonly<{
	request: SyntheticFabStarterRequest;
	label: string;
	pending: boolean;
	schematic?: SyntheticFabStarterSchematic | null;
}>): React.ReactElement {
	const schematic = useMemo(
		() =>
			suppliedSchematic === undefined
				? (largeFabDialogMetadata(request)?.schematic ?? syntheticFabStarterSchematic(request))
				: suppliedSchematic,
		[request, suppliedSchematic],
	);
	if (!schematic) {
		return (
			<div className="tilefab-starter-schematic-shell" data-pending={pending}>
				<div className="tilefab-starter-empty-preview" role="img" aria-label={`${label} 빈 격자`}>
					<Grid3X3 size={38} />
				</div>
				{pending ? (
					<StarterSchematicStatus certified={isDefaultSyntheticFabCertifiedRequest(request)} />
				) : null}
			</div>
		);
	}
	const extent = Math.max(
		schematic.bounds.maxX - schematic.bounds.minX,
		schematic.bounds.maxY - schematic.bounds.minY,
	);
	const padding = Math.max(2, extent * 0.045);
	const width = schematic.bounds.maxX - schematic.bounds.minX + padding * 2;
	const height = schematic.bounds.maxY - schematic.bounds.minY + padding * 2;
	const semanticMarkerScale = Math.max(1.4, extent * 0.008);
	const accessibleLabel =
		request.id === "paired-circulation-fab-52"
			? `${label} FAB 구성 도식. 서로 반대 방향의 이중 외곽 순환선, 두 개의 paired interbay hall, 네 개의 Bay Bank, ${request.parameters.bayCount}개 대형 Bay shell과 Single/Twin Process Loop를 표시합니다.`
			: request.id === "full-fab-52"
				? `${label} FAB 구성 도식. 하나의 외곽 순환 레일 안에 두 공정 홀, 네 개의 Bay Bank, ${request.parameters.bayCount}개 Bay와 ${request.parameters.bayCount * 2}개 내부 Process Loop를 표시합니다.`
				: request.id === "parallel-hall-fab-12"
					? `${label} FAB 구성 도식. 직사각형 외곽 순환 레일, 중앙 interbay spine, 분리된 양쪽 Bank collector, 긴 생산 Bay와 각각 두 개의 full-depth Process Loop를 표시합니다.`
					: request.id === "production-fab-60"
						? `${label} FAB 구성 도식. 직사각형 외곽 순환 레일, 공유 interbay spine, 반복 Bay Bank, 각 Bay의 외곽 순환과 두 개 내부 Process Loop를 표시합니다.`
						: request.id === "central-spine-fab-24"
							? `${label} FAB 구성 도식. 직사각형 외곽 순환 레일, 중앙 interbay spine, 양쪽 Bay Bank, 각 Bay의 외곽 순환과 두 개의 평행 Process Loop를 표시합니다.`
							: request.id === "large-fab-60"
								? `${label} FAB 구성 도식. 직사각형 외곽 순환 레일, 공유 내부 벽 순환 레일, 중앙 인터베이 척추 레일, 왕복 공정 행과 접선 Bay 루프, 북동남서 ${schematic.gatewayMarkers.length}개 gateway를 표시합니다.`
								: `${label} 구성 도식`;
	return (
		<div className="tilefab-starter-schematic-shell" data-pending={pending}>
			<svg
				className="tilefab-starter-rail-preview tilefab-starter-schematic-preview"
				viewBox={`${schematic.bounds.minX - padding} ${schematic.bounds.minY - padding} ${width} ${height}`}
				preserveAspectRatio="xMidYMid meet"
				aria-label={accessibleLabel}
				role="img"
			>
				<title>{accessibleLabel}</title>
				<StarterPathLayers
					pathData={schematic.railPathData}
					className="tilefab-starter-schematic-rail"
				/>
				{schematic.connectorPathData ? (
					<StarterPathLayers
						pathData={schematic.connectorPathData}
						className="tilefab-starter-schematic-connectors"
					/>
				) : null}
				{isLargeFabPresetRequest(request) ? (
					<g className="tilefab-starter-semantic-layers">
						{(["outer", "wall", "spine", "process"] as const).map((role) => (
							<path key={role} data-role={role} d={schematic.semanticPathData[role]} />
						))}
						{schematic.flowMarkers.map((marker) => (
							<path
								key={marker.id}
								className="tilefab-starter-semantic-flow"
								data-role={marker.role}
								d="M -1 -0.62 L 1.05 0 L -1 0.62 Z"
								transform={`translate(${marker.x} ${marker.y}) rotate(${marker.angleDegrees}) scale(${semanticMarkerScale})`}
							/>
						))}
						{schematic.gatewayMarkers.map((marker) => (
							<g
								key={marker.id}
								className="tilefab-starter-gateway-marker"
								transform={`translate(${marker.x} ${marker.y})`}
							>
								<circle r={semanticMarkerScale * 0.9} />
								<text fontSize={semanticMarkerScale * 0.9} y={semanticMarkerScale * 0.34}>
									{marker.side[0]?.toUpperCase()}
								</text>
							</g>
						))}
					</g>
				) : null}
			</svg>
			{isLargeFabPresetRequest(request) ? (
				<StarterSchematicLegend production={request.id !== "large-fab-60"} />
			) : null}
			{pending ? (
				<StarterSchematicStatus certified={isDefaultSyntheticFabCertifiedRequest(request)} />
			) : isLargeFabPresetRequest(request) ? (
				<span
					className="tilefab-starter-schematic-status"
					data-verified="true"
					role="status"
					aria-live="polite"
					aria-atomic="true"
				>
					<Check size={13} /> OPENFAB VERIFIED · RAIL TOPOLOGY · NOT TO SCALE
				</span>
			) : null}
		</div>
	);
}

function StarterSchematicLegend({
	production,
}: Readonly<{ production: boolean }>): React.ReactElement {
	return (
		<ul className="tilefab-starter-schematic-legend" aria-label="FAB 도식 범례">
			<li data-role="outer">OUTER</li>
			{production ? null : <li data-role="wall">WALL</li>}
			<li data-role="spine">SPINE</li>
			<li data-role="process">{production ? "BANK · BAY · PROCESS LOOP" : "WING"}</li>
			{production ? null : <li data-role="gateway">N/E/S/W GATE</li>}
		</ul>
	);
}

function StarterPathLayers({
	pathData,
	className,
}: Readonly<{
	pathData: string;
	className?: string;
}>): React.ReactElement {
	const reactId = useId();
	const pathId = `tilefab-starter-path-${reactId.replaceAll(":", "")}`;
	return (
		<g className={className}>
			<defs>
				<path id={pathId} d={pathData} />
			</defs>
			<use className="tilefab-starter-rail-shadow" href={`#${pathId}`} />
			<use className="tilefab-starter-rail-bed" href={`#${pathId}`} />
			<use className="tilefab-starter-rail-slot" href={`#${pathId}`} />
		</g>
	);
}

function StarterSchematicStatus({
	certified,
}: Readonly<{ certified: boolean }>): React.ReactElement {
	return (
		<span
			className="tilefab-starter-schematic-status"
			role="status"
			aria-live="polite"
			aria-atomic="true"
		>
			<Route size={13} /> {certified ? "LOADING OPENFAB ARTIFACT" : "VERIFYING PHYSICAL RAIL"}
		</span>
	);
}

function StarterVerificationScopes(): React.ReactElement {
	return (
		<ul
			className="tilefab-starter-verification-scopes"
			data-testid="synthetic-fab-verification-scopes"
			aria-label="OpenFab verified static authoring scopes"
		>
			<li data-state="verified">
				<Check size={12} /> RAIL GEOMETRY · VERIFIED
			</li>
			<li data-state="verified">
				<Check size={12} /> DIRECTED TOPOLOGY · VERIFIED
			</li>
			<li data-state="verified">
				<Check size={12} /> ORGANIZATION · VERIFIED
			</li>
			<li data-state="not-checked">PORT SERVICE · NOT CHECKED</li>
		</ul>
	);
}

function StarterMetrics({
	requestId,
	summary,
	scaleUnit,
	pending,
	idle,
	failed,
}: Readonly<{
	requestId: SyntheticFabStarterId;
	summary: PreparedSyntheticFabStarter["summary"] | null;
	scaleUnit: "ZONES" | "BANKS" | "WINGS";
	pending: boolean;
	idle: boolean;
	failed: boolean;
}>): React.ReactElement {
	const width = summary?.bounds?.widthMeters ?? 0;
	const height = summary?.bounds?.heightMeters ?? 0;
	return (
		<dl className="tilefab-starter-metrics">
			<div className="tilefab-starter-scale-metric">
				<dt>SCALE</dt>
				<dd>
					{failed ? (
						"UNAVAILABLE"
					) : idle ? (
						"ON DEMAND"
					) : pending ? (
						"VERIFYING"
					) : summary?.zoneCount ? (
						requestId === "bay-assembly" ? (
							<>
								<span>1 BAY</span>
								<span>2 PROCESS LOOPS</span>
							</>
						) : requestId === "bay-bank" ? (
							<>
								<span>1 BAY BANK</span>
								<span>{summary.bayCount} BAYS</span>
							</>
						) : (
							<>
								<span>
									{summary.zoneCount} {scaleUnit}
								</span>
								<span>{summary.bayCount} BAYS</span>
							</>
						)
					) : (
						"EMPTY"
					)}
				</dd>
			</div>
			<div>
				<dt>FOOTPRINT</dt>
				<dd>
					{failed
						? "UNAVAILABLE"
						: idle
							? "PREPARE TO MEASURE"
							: pending
								? "VERIFYING"
								: `${width} × ${height} m`}
				</dd>
			</div>
			<div>
				<dt>RAIL</dt>
				<dd>
					{failed
						? "UNAVAILABLE"
						: idle
							? "READY ON COMMAND"
							: pending
								? "VERIFYING"
								: `${summary ? Math.round(summary.totalLengthMeters) : 0} m`}
				</dd>
			</div>
			<div>
				<dt>NETWORK</dt>
				<dd>
					{failed
						? "UNAVAILABLE"
						: idle
							? "OPENFAB VERIFIED INPUT"
							: pending
								? "VERIFYING"
								: summary?.strongComponents === 1
									? "1 CONNECTED"
									: summary?.strongComponents
										? `${summary.strongComponents} SEPARATE`
										: "EMPTY"}
				</dd>
			</div>
		</dl>
	);
}

function StarterParameterNumberInput({
	descriptor,
	value,
	disabled,
	onCommit,
}: Readonly<{
	descriptor: SyntheticFabStarterParameterDescriptor;
	value: number;
	disabled: boolean;
	onCommit: (value: number) => void;
}>): React.ReactElement {
	const [draftState, setDraftState] = useState(() => ({
		committedValue: value,
		text: String(value),
	}));
	const draft = draftState.committedValue === value ? draftState.text : String(value);
	const onCommitRef = useRef(onCommit);
	const lastDispatchedValueRef = useRef<number | null>(null);
	useEffect(() => {
		onCommitRef.current = onCommit;
	}, [onCommit]);
	useEffect(() => {
		if (lastDispatchedValueRef.current !== value) lastDispatchedValueRef.current = null;
	}, [value]);
	useEffect(() => {
		const parsed = Number(draft);
		if (
			!draft.trim() ||
			!Number.isFinite(parsed) ||
			parsed < descriptor.minimum ||
			parsed > descriptor.maximum ||
			parsed === value
		) {
			return;
		}
		const timeout = globalThis.setTimeout(() => {
			if (lastDispatchedValueRef.current === parsed) return;
			lastDispatchedValueRef.current = parsed;
			onCommitRef.current(parsed);
		}, 250);
		return () => globalThis.clearTimeout(timeout);
	}, [descriptor.maximum, descriptor.minimum, draft, value]);
	const commit = (): void => {
		const parsed = Number(draft);
		if (!draft.trim() || !Number.isFinite(parsed)) {
			setDraftState({ committedValue: value, text: String(value) });
			return;
		}
		setDraftState({ committedValue: parsed, text: String(parsed) });
		if (parsed === value || lastDispatchedValueRef.current === parsed) return;
		lastDispatchedValueRef.current = parsed;
		onCommit(parsed);
	};
	return (
		<input
			id={`tilefab-starter-${descriptor.key}`}
			type="number"
			min={descriptor.minimum}
			max={descriptor.maximum}
			step={descriptor.step}
			value={draft}
			disabled={disabled}
			data-starter-parameter-input="true"
			data-testid={`synthetic-fab-parameter-${descriptor.key}`}
			onChange={(event) =>
				setDraftState({ committedValue: value, text: event.currentTarget.value })
			}
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === "Enter") event.currentTarget.blur();
				else if (event.key === "Escape") {
					event.preventDefault();
					event.stopPropagation();
					setDraftState({ committedValue: value, text: String(value) });
				}
			}}
		/>
	);
}

function focusableDialogElements(container: HTMLElement): HTMLElement[] {
	const candidates = container.querySelectorAll<HTMLElement>(
		[
			"button:not([disabled])",
			"input:not([disabled])",
			"select:not([disabled])",
			"textarea:not([disabled])",
			"a[href]",
			'[tabindex]:not([tabindex="-1"])',
		].join(","),
	);
	return [...candidates].filter((element) => {
		if (element.hidden || element.inert || element.getAttribute("aria-hidden") === "true")
			return false;
		const bounds = element.getBoundingClientRect();
		return bounds.width > 0 && bounds.height > 0;
	});
}
