import { ArrowLeftRight, Check, Crosshair, Factory, Minus, Plus, RotateCw, X } from "lucide-react";
import { useId, useMemo } from "react";
import {
	defaultProductionBayModuleCatalogRequest,
	PRODUCTION_BAY_MODULE_CATALOG,
	type ProductionBayModuleCatalogId,
	type ProductionBayModuleCatalogRequest,
	productionBayModuleCatalogItem,
	productionBayModuleCatalogRequestError,
	productionBayModuleRequest,
} from "../compile/ProductionBayModuleCatalog";
import { planProductionBayModule } from "../core/ProductionBayModulePlanner";
import "./ProductionBayModuleDialog.css";

interface ProductionBayModulePanelProps {
	readonly request: ProductionBayModuleCatalogRequest;
	readonly rotationDegrees: 0 | 90 | 180 | 270;
	readonly placementPending: boolean;
	readonly onRequestChange: (request: ProductionBayModuleCatalogRequest) => void;
	readonly onClose: () => void;
	readonly onFocusCanvas: () => void;
}

type NumericRequestKey =
	| "outerLengthMeters"
	| "outerDepthMeters"
	| "shellMarginMeters"
	| "processLoopGapMeters"
	| "gatewayLengthMeters";

const NUMERIC_PARAMETERS: readonly Readonly<{
	key: NumericRequestKey;
	label: string;
	shortLabel: string;
	minimum: number;
	maximum: number;
	step: number;
}>[] = Object.freeze([
	Object.freeze({
		key: "outerLengthMeters",
		label: "Outer shell length",
		shortLabel: "LENGTH",
		minimum: 8,
		maximum: 2_000,
		step: 1,
	}),
	Object.freeze({
		key: "outerDepthMeters",
		label: "Outer shell depth",
		shortLabel: "DEPTH",
		minimum: 7,
		maximum: 2_000,
		step: 1,
	}),
	Object.freeze({
		key: "shellMarginMeters",
		label: "Shell clearance",
		shortLabel: "SHELL GAP",
		minimum: 3,
		maximum: 100,
		step: 1,
	}),
	Object.freeze({
		key: "processLoopGapMeters",
		label: "Process Loop spacing",
		shortLabel: "LOOP GAP",
		minimum: 3,
		maximum: 100,
		step: 1,
	}),
	Object.freeze({
		key: "gatewayLengthMeters",
		label: "Gateway length",
		shortLabel: "GATEWAY",
		minimum: 1,
		maximum: 100,
		step: 1,
	}),
]);

/**
 * Current-map Bay configuration stays beside the Canvas. Its controls only publish a catalog
 * request; the app owns the canonical organization-bundle placement session and live ghost.
 */
export function ProductionBayModulePanel({
	request,
	rotationDegrees,
	placementPending,
	onRequestChange,
	onClose,
	onFocusCanvas,
}: ProductionBayModulePanelProps): React.ReactElement {
	const titleId = useId();
	const item = productionBayModuleCatalogItem(request.id);
	const error = productionBayModuleCatalogRequestError(request);
	const plan = useMemo(() => {
		if (error) return null;
		return planProductionBayModule(productionBayModuleRequest(request));
	}, [error, request]);

	const selectItem = (id: ProductionBayModuleCatalogId): void => {
		onRequestChange(defaultProductionBayModuleCatalogRequest(id));
	};

	const updateNumber = (key: NumericRequestKey, value: number): void => {
		onRequestChange(Object.freeze({ ...request, [key]: value }));
	};

	return (
		<section
			className="tilefab-production-bay-panel"
			aria-labelledby={titleId}
			data-testid="production-bay-module-panel"
			data-valid={error === null}
			data-live-preview={error === null ? "active" : "paused"}
			data-placement-pending={placementPending}
		>
			<header className="tilefab-production-bay-header">
				<span className="tilefab-production-bay-heading-icon" aria-hidden="true">
					<Factory size={17} />
				</span>
				<span className="tilefab-production-bay-heading">
					<small>LIVE PLACEMENT</small>
					<strong id={titleId}>Production Bay</strong>
				</span>
				<span className="tilefab-production-bay-rotation">
					<RotateCw size={13} aria-hidden="true" />
					<span className="tilefab-sr-only">Rotation </span>
					{rotationDegrees}°
				</span>
				<button
					type="button"
					className="tilefab-production-bay-close"
					onClick={onClose}
					aria-label="Close Production Bay panel"
				>
					<X size={17} />
				</button>
			</header>

			<nav className="tilefab-production-bay-family" aria-label="Production Bay family">
				{PRODUCTION_BAY_MODULE_CATALOG.map((catalogItem) => (
					<button
						type="button"
						key={catalogItem.id}
						data-active={catalogItem.id === request.id}
						aria-pressed={catalogItem.id === request.id}
						onClick={() => selectItem(catalogItem.id)}
					>
						<ProductionBayMiniature loops={catalogItem.processLoopCount} compact />
						<span>
							<strong>{catalogItem.shortLabel}</strong>
							<small>
								{catalogItem.processLoopCount} PROCESS LOOP
								{catalogItem.processLoopCount > 1 ? "S" : ""}
							</small>
						</span>
					</button>
				))}
			</nav>

			<div className="tilefab-production-bay-preview">
				<ProductionBayMiniature loops={item.processLoopCount} />
				<dl className="tilefab-production-bay-metrics">
					<div>
						<dt>FOOTPRINT</dt>
						<dd>
							{request.outerLengthMeters} × {request.outerDepthMeters} m
						</dd>
					</div>
					<div>
						<dt>TRACK</dt>
						<dd>{plan ? `${plan.lengthMeters.toLocaleString()} m` : "—"}</dd>
					</div>
					<div>
						<dt>EDGES</dt>
						<dd>{plan?.newEdges.toLocaleString() ?? "—"}</dd>
					</div>
					<div>
						<dt>GATEWAYS</dt>
						<dd>2 PAIRED</dd>
					</div>
				</dl>
			</div>

			<div className="tilefab-production-bay-controls">
				<fieldset aria-label="Production Bay dimensions">
					<legend>DIMENSIONS</legend>
					{NUMERIC_PARAMETERS.map((parameter) => {
						if (parameter.key === "processLoopGapMeters" && item.processLoopCount === 1)
							return null;
						const value = request[parameter.key];
						return (
							<label key={parameter.key}>
								<span>{parameter.shortLabel}</span>
								<span>
									<button
										type="button"
										aria-label={`Decrease ${parameter.label}`}
										disabled={!Number.isFinite(value) || value <= parameter.minimum}
										onClick={() =>
											updateNumber(
												parameter.key,
												Math.max(parameter.minimum, value - parameter.step),
											)
										}
									>
										<Minus size={13} />
									</button>
									<input
										type="number"
										aria-label={parameter.label}
										min={parameter.minimum}
										max={parameter.maximum}
										step={parameter.step}
										value={value}
										onChange={(event) =>
											updateNumber(parameter.key, Number(event.currentTarget.value))
										}
									/>
									<em>m</em>
									<button
										type="button"
										aria-label={`Increase ${parameter.label}`}
										disabled={!Number.isFinite(value) || value >= parameter.maximum}
										onClick={() =>
											updateNumber(
												parameter.key,
												Math.min(parameter.maximum, value + parameter.step),
											)
										}
									>
										<Plus size={13} />
									</button>
								</span>
							</label>
						);
					})}
				</fieldset>

				<div className="tilefab-production-bay-flow-controls">
					<fieldset className="tilefab-production-bay-flow" aria-label="Rail flow">
						<legend>FLOW</legend>
						<button
							type="button"
							data-active={request.flow === "forward"}
							aria-pressed={request.flow === "forward"}
							onClick={() => onRequestChange(Object.freeze({ ...request, flow: "forward" }))}
						>
							<ArrowLeftRight size={13} /> ORIGINAL
						</button>
						<button
							type="button"
							data-active={request.flow === "reverse"}
							aria-pressed={request.flow === "reverse"}
							onClick={() => onRequestChange(Object.freeze({ ...request, flow: "reverse" }))}
						>
							<ArrowLeftRight size={13} /> REVERSED
						</button>
					</fieldset>
					{item.processLoopCount === 2 ? (
						<fieldset
							className="tilefab-production-bay-flow"
							aria-label="Twin Process Loop circulation"
						>
							<legend>LOOP PAIR</legend>
							<button
								type="button"
								data-active={request.internalFlowPattern === "alternating"}
								aria-pressed={request.internalFlowPattern === "alternating"}
								onClick={() =>
									onRequestChange(
										Object.freeze({
											...request,
											internalFlowPattern: "alternating",
										}),
									)
								}
							>
								ALTERNATING
							</button>
							<button
								type="button"
								data-active={request.internalFlowPattern === "co-rotating"}
								aria-pressed={request.internalFlowPattern === "co-rotating"}
								onClick={() =>
									onRequestChange(
										Object.freeze({
											...request,
											internalFlowPattern: "co-rotating",
										}),
									)
								}
							>
								CO-ROTATING
							</button>
						</fieldset>
					) : null}
				</div>
			</div>

			<footer>
				<span className="tilefab-production-bay-validation" role={error ? "alert" : "status"}>
					{error ? <X size={15} /> : <Check size={15} />}
					<strong>
						{error
							? "FIX DIMENSIONS"
							: placementPending
								? "CHECKING PLACEMENT"
								: "LIVE GHOST READY"}
					</strong>
					<small>{error ?? "LMB place · R rotate · Esc cancel"}</small>
				</span>
				<button type="button" className="tilefab-production-bay-cancel" onClick={onClose}>
					CANCEL
				</button>
				<button
					type="button"
					className="tilefab-production-bay-canvas"
					disabled={error !== null}
					onClick={onFocusCanvas}
				>
					<Crosshair size={15} /> CANVAS
				</button>
			</footer>
		</section>
	);
}

function ProductionBayMiniature({
	loops,
	compact = false,
}: Readonly<{ loops: 1 | 2; compact?: boolean }>): React.ReactElement {
	const markerId = useId().replaceAll(":", "");
	return (
		<svg
			className="tilefab-production-bay-miniature"
			data-compact={compact}
			viewBox="0 0 120 72"
			role={compact ? undefined : "img"}
			aria-label={compact ? undefined : `${loops}-Process-Loop Production Bay schematic`}
			aria-hidden={compact || undefined}
		>
			<defs>
				<marker
					id={markerId}
					viewBox="0 0 6 6"
					refX="5"
					refY="3"
					markerWidth="5"
					markerHeight="5"
					orient="auto"
				>
					<path d="M0 0L6 3L0 6Z" />
				</marker>
			</defs>
			<rect className="shell" x="6" y="6" width="108" height="60" rx="10" />
			{loops === 1 ? (
				<rect className="process" x="25" y="20" width="70" height="32" rx="7" />
			) : (
				<>
					<rect className="process" x="24" y="15" width="72" height="18" rx="5" />
					<rect className="process" x="24" y="39" width="72" height="18" rx="5" />
				</>
			)}
			<path className="gateway" d={loops === 1 ? "M6 25H25M95 47H114" : "M6 21H24M96 51H114"} />
			<path className="flow" d="M18 6H51" markerEnd={`url(#${markerId})`} />
			<path className="flow" d="M102 66H69" markerEnd={`url(#${markerId})`} />
		</svg>
	);
}
