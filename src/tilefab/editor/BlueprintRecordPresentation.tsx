import {
	ArrowLeft,
	ChevronRight,
	Download,
	Grid3X3,
	PackagePlus,
	Pencil,
	Star,
	Trash2,
	X,
} from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useMemo } from "react";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	type RailTemplateCatalogItem,
	type RailTemplateParameters,
	type RailTemplatePose,
} from "../core/RailTemplateCatalog";
import {
	OPENFAB_BLUEPRINT_KIND_STATIC_FAB,
	type OpenFabProjectBlueprint,
	type OpenFabStaticFabBlueprintPort,
} from "../project/OpenFabBlueprintLibrary";
import {
	type RailTemplatePhysicalPreview,
	tryCompileRailTemplatePhysicalPreview,
} from "../render/RailTemplatePhysicalPreview";
import {
	type BlueprintRecordCommandId,
	type BlueprintRecordContextState,
	blueprintRecordCommands,
} from "./BlueprintRecordContext";

const BLUEPRINT_MINIATURE_MAX_EDGES = 2_048;
const BLUEPRINT_MINIATURE_MAX_PORTS = 256;

interface BlueprintRecordContextTrayProps {
	readonly state: BlueprintRecordContextState;
	readonly recordName: string;
	readonly favorite: boolean;
	readonly quickSlot: number | null;
	readonly quickSlots: readonly number[];
	readonly quickSlotOwners: ReadonlyMap<number, string>;
	readonly busy: boolean;
	readonly deleteConfirmation: boolean;
	readonly contextRef: React.RefObject<HTMLDivElement | null>;
	readonly onCommand: (commandId: BlueprintRecordCommandId) => void;
	readonly onQuickSlot: (quickSlot: number | null) => void;
	readonly onBack: () => void;
	readonly onClose: () => void;
	readonly onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
}

export function BlueprintRecordContextTray({
	state,
	recordName,
	favorite,
	quickSlot,
	quickSlots: USER_BLUEPRINT_QUICK_SLOTS,
	quickSlotOwners,
	busy,
	deleteConfirmation,
	contextRef,
	onCommand,
	onQuickSlot,
	onBack,
	onClose,
	onKeyDown,
}: BlueprintRecordContextTrayProps): React.ReactElement {
	const contextId = `tilefab-blueprint-context-${state.scope}-${state.recordId}`;
	const commands = blueprintRecordCommands({
		scope: state.scope,
		favorite,
		quickSlot,
		deleteConfirmation,
	});
	return (
		<div
			ref={contextRef}
			className="tilefab-blueprint-record-context"
			data-testid="blueprint-record-context"
			data-scope={state.scope}
			data-view={state.view}
		>
			<header>
				<span>
					<small>{state.scope === "project" ? "PROJECT" : "MY LIBRARY"}</small>
					<strong>{recordName}</strong>
				</span>
				<button
					type="button"
					aria-label={`${recordName} 메뉴 닫기`}
					onClick={onClose}
					onKeyDown={onKeyDown}
				>
					<X size={15} />
				</button>
			</header>
			{state.view === "commands" ? (
				<div
					id={contextId}
					role="menu"
					aria-label={`${recordName} 청사진 명령`}
					onKeyDown={onKeyDown}
				>
					{commands.map((command, index) => (
						<button
							type="button"
							role="menuitem"
							key={command.id}
							data-command={command.id}
							data-tone={command.tone}
							disabled={busy}
							tabIndex={index === 0 ? 0 : -1}
							aria-label={blueprintRecordCommandAriaLabel(
								command.id,
								recordName,
								favorite,
								deleteConfirmation,
							)}
							onClick={() => onCommand(command.id)}
						>
							{blueprintRecordCommandIcon(command.id, favorite)}
							<span>{command.label}</span>
							{command.id === "choose-quick-slot" ? <ChevronRight size={14} /> : null}
						</button>
					))}
				</div>
			) : (
				<div
					id={contextId}
					className="tilefab-blueprint-record-slot-menu"
					role="menu"
					aria-label={`${recordName} Quick Slot 지정`}
					onKeyDown={onKeyDown}
				>
					<button type="button" role="menuitem" tabIndex={0} onClick={onBack}>
						<ArrowLeft size={15} />
						<span>BACK</span>
					</button>
					<button
						type="button"
						role="menuitemradio"
						tabIndex={-1}
						aria-checked={quickSlot === null}
						data-active={quickSlot === null}
						disabled={busy}
						onClick={() => onQuickSlot(null)}
					>
						<X size={14} />
						<span>NONE</span>
					</button>
					{USER_BLUEPRINT_QUICK_SLOTS.map((slot) => {
						const owner = quickSlotOwners.get(slot) ?? null;
						const occupiedByOther = owner !== null && owner !== state.recordId;
						return (
							<button
								type="button"
								role="menuitemradio"
								tabIndex={-1}
								key={slot}
								aria-checked={quickSlot === slot}
								aria-label={
									occupiedByOther
										? `Quick Slot ${slot} 사용 중`
										: `${recordName} Quick Slot ${slot} 지정`
								}
								data-active={quickSlot === slot}
								data-occupied={occupiedByOther}
								disabled={busy || occupiedByOther}
								onClick={() => onQuickSlot(slot)}
							>
								<kbd>{slot}</kbd>
								<span>{occupiedByOther ? "USED" : quickSlot === slot ? "ACTIVE" : "ASSIGN"}</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

function blueprintRecordCommandIcon(
	commandId: BlueprintRecordCommandId,
	favorite: boolean,
): React.ReactElement {
	if (commandId === "save-to-user-library" || commandId === "save-to-project") {
		return <PackagePlus size={16} />;
	}
	if (commandId === "toggle-favorite") {
		return <Star size={16} fill={favorite ? "currentColor" : "none"} />;
	}
	if (commandId === "edit-metadata" || commandId === "rename-project") return <Pencil size={16} />;
	if (commandId === "choose-quick-slot") return <Grid3X3 size={16} />;
	if (commandId === "export-user-blueprint") return <Download size={16} />;
	return <Trash2 size={16} />;
}

function blueprintRecordCommandAriaLabel(
	commandId: BlueprintRecordCommandId,
	recordName: string,
	favorite: boolean,
	deleteConfirmation: boolean,
): string {
	if (commandId === "rename-project") return `${recordName} 이름 변경`;
	if (commandId === "save-to-user-library") return `${recordName} 내 라이브러리에 저장`;
	if (commandId === "toggle-favorite") {
		return `${recordName} 즐겨찾기 ${favorite ? "해제" : "추가"}`;
	}
	if (commandId === "delete-project") return `${recordName} 삭제`;
	if (commandId === "edit-metadata") return `${recordName} 이름과 폴더 편집`;
	if (commandId === "choose-quick-slot") return `${recordName} quick slot 편집`;
	if (commandId === "export-user-blueprint") return `${recordName} .openfabbp 내보내기`;
	if (commandId === "save-to-project") return `${recordName} 현재 프로젝트에 추가`;
	return deleteConfirmation ? `${recordName} 삭제 확인` : `${recordName} 내 라이브러리에서 삭제`;
}

export function RailBlueprintMiniature({
	record,
}: Readonly<{ record: OpenFabProjectBlueprint }>): React.ReactElement {
	const padding = Math.max(1, Math.min(record.widthMeters, record.heightMeters) * 0.08);
	const miniature = useMemo(() => {
		const displayStep = Math.max(1, Math.ceil(record.edges.length / BLUEPRINT_MINIATURE_MAX_EDGES));
		const displayEdges = record.edges.filter((_, index) => index % displayStep === 0);
		const markerStep = Math.max(1, Math.ceil(displayEdges.length / 18));
		return Object.freeze({
			path: displayEdges.map((edge) => `M ${edge[0]} ${edge[1]} L ${edge[2]} ${edge[3]}`).join(" "),
			flowMarkers: Object.freeze(displayEdges.filter((_, index) => index % markerStep === 0)),
			ports:
				record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
					? Object.freeze(
							record.ports.filter(
								(_, index) =>
									index %
										Math.max(1, Math.ceil(record.ports.length / BLUEPRINT_MINIATURE_MAX_PORTS)) ===
									0,
							),
						)
					: Object.freeze([]),
		});
	}, [record]);
	const portMarkerRadius = Math.max(
		0.12,
		Math.min(0.34, Math.min(record.widthMeters, record.heightMeters) * 0.018),
	);
	return (
		<svg
			className="tilefab-blueprint-miniature"
			viewBox={`${-padding} ${-padding} ${record.widthMeters + padding * 2} ${record.heightMeters + padding * 2}`}
			preserveAspectRatio="xMidYMid meet"
			aria-hidden="true"
		>
			<path className="tilefab-blueprint-miniature-bed" d={miniature.path} />
			<path className="tilefab-blueprint-miniature-rail" d={miniature.path} />
			{miniature.flowMarkers.map((edge) => (
				<circle
					key={`${record.id}-flow-${edge.join("-")}`}
					className="tilefab-blueprint-miniature-flow"
					cx={edge[2]}
					cy={edge[3]}
					r={0.09}
				/>
			))}
			{record.kind === OPENFAB_BLUEPRINT_KIND_STATIC_FAB
				? miniature.ports.map((port) => {
						const position = openFabBlueprintPortPosition(port);
						return (
							<circle
								key={`${record.id}-port-${port.equipmentGroupIndex}-${port.route.cell.join("-")}-${port.route.from}-${port.route.to}-${port.stationMillimeters}-${port.side}-${port.direction}`}
								className="tilefab-blueprint-miniature-port"
								data-port-type={port.portType}
								cx={position.x}
								cy={position.z}
								r={portMarkerRadius}
							/>
						);
					})
				: null}
		</svg>
	);
}

function openFabBlueprintPortPosition(
	port: OpenFabStaticFabBlueprintPort,
): Readonly<{ x: number; z: number }> {
	const tangent =
		port.route.to === "N"
			? { x: 0, z: -1 }
			: port.route.to === "E"
				? { x: 1, z: 0 }
				: port.route.to === "S"
					? { x: 0, z: 1 }
					: { x: -1, z: 0 };
	const normal = { x: -tangent.z, z: tangent.x };
	const stationOffset = port.stationMillimeters / 1_000 - 0.5;
	const sideSign = port.side === "LEFT" ? 1 : port.side === "RIGHT" ? -1 : 0;
	const lateralOffset = (port.lateralOffsetMillimeters / 1_000) * sideSign;
	return Object.freeze({
		x: port.route.cell[0] + 0.5 + tangent.x * stationOffset + normal.x * lateralOffset,
		z: port.route.cell[1] + 0.5 + tangent.z * stationOffset + normal.z * lateralOffset,
	});
}

export function RailTemplateMiniature({
	item,
	parameters = defaultRailTemplateParameters(item.id),
	pose = initialRailTemplatePose(),
}: {
	readonly item: RailTemplateCatalogItem;
	readonly parameters?: RailTemplateParameters;
	readonly pose?: RailTemplatePose;
}): React.ReactElement {
	const preview = tryCompileRailTemplatePhysicalPreview(item.id, parameters, pose);
	const geometry = useMemo(
		() => (preview ? railTemplatePreviewSvgGeometry(preview) : null),
		[preview],
	);
	if (!preview || !geometry) {
		return (
			<svg
				className="tilefab-pattern-miniature"
				viewBox="0 0 100 40"
				preserveAspectRatio="xMidYMid meet"
				role="img"
				aria-label={`${item.label} 물리 미리보기를 생성할 수 없음`}
				data-preview-source="unavailable"
			>
				<title>{item.label} 물리 미리보기를 생성할 수 없습니다</title>
				<path className="tilefab-pattern-preview-unavailable" d="M 12 20 L 88 20 M 50 8 L 50 32" />
			</svg>
		);
	}
	const bounds = preview.bounds;
	const width = Math.max(1, bounds.maxX - bounds.minX);
	const height = Math.max(1, bounds.maxY - bounds.minY);
	return (
		<svg
			className="tilefab-pattern-miniature"
			viewBox={`${bounds.minX} ${bounds.minY} ${width} ${height}`}
			preserveAspectRatio="xMidYMid meet"
			aria-hidden="true"
			data-preview-source="physical-paths"
			data-path-count={preview.presentation.source.pathCount}
		>
			<g className="tilefab-pattern-physical-rails">
				{geometry.paths.map((path) => (
					<g key={`${item.id}-physical-${path.index}`}>
						<path className="tilefab-pattern-rail-shadow" d={path.d} />
						<path className="tilefab-pattern-rail-bed" d={path.d} />
						<path className="tilefab-pattern-rail-slot" d={path.d} />
					</g>
				))}
			</g>
			{geometry.connectors.map((connector) => (
				<g
					className="tilefab-pattern-connector"
					key={`${item.id}-connector-${connector.x1}:${connector.y1}:${connector.x2}:${connector.y2}`}
				>
					<line x1={connector.x1} y1={connector.y1} x2={connector.x2} y2={connector.y2} />
					<circle cx={connector.x1} cy={connector.y1} r={geometry.handleRadius} />
					<circle cx={connector.x2} cy={connector.y2} r={geometry.handleRadius} />
				</g>
			))}
			{geometry.flowMarkers.map((marker) => (
				<path
					key={`${item.id}-physical-flow-${marker.x}:${marker.y}:${marker.angleDegrees}`}
					className="tilefab-pattern-flow"
					d="M -0.9 -0.55 L 0.95 0 L -0.9 0.55 Z"
					transform={`translate(${marker.x} ${marker.y}) rotate(${marker.angleDegrees}) scale(${geometry.markerScale})`}
				/>
			))}
		</svg>
	);
}

interface RailTemplatePreviewSvgGeometry {
	readonly paths: readonly { readonly index: number; readonly d: string }[];
	readonly flowMarkers: readonly {
		readonly x: number;
		readonly y: number;
		readonly angleDegrees: number;
	}[];
	readonly connectors: readonly {
		readonly x1: number;
		readonly y1: number;
		readonly x2: number;
		readonly y2: number;
	}[];
	readonly markerScale: number;
	readonly handleRadius: number;
}

function railTemplatePreviewSvgGeometry(
	preview: RailTemplatePhysicalPreview,
): RailTemplatePreviewSvgGeometry {
	const presentation = preview.presentation;
	const source = presentation.source;
	const runs = presentation.runs;
	const paths = Array.from({ length: runs.count }, (_, index) => {
		let d = "";
		const runStart = runs.offsets[index] as number;
		const runEnd = runs.offsets[index + 1] as number;
		for (let memberIndex = runStart; memberIndex < runEnd; memberIndex++) {
			const pathIndex = runs.pathIndices[memberIndex] as number;
			const pointStart = source.offsets[pathIndex] as number;
			const pointEnd = source.offsets[pathIndex + 1] as number;
			for (let pointIndex = pointStart; pointIndex < pointEnd; pointIndex++) {
				const offset = pointIndex * 2;
				d += `${d.length === 0 ? "M" : " L"} ${source.positions[offset]} ${source.positions[offset + 1]}`;
			}
		}
		return Object.freeze({ index, d });
	});
	const flowMarkers = Object.freeze(
		preview.flowMarkers.map((marker) =>
			Object.freeze({
				x: marker.x,
				y: marker.y,
				angleDegrees: (Math.atan2(marker.tangentY, marker.tangentX) * 180) / Math.PI,
			}),
		),
	);
	const extent = Math.max(
		preview.bounds.maxX - preview.bounds.minX,
		preview.bounds.maxY - preview.bounds.minY,
	);
	return Object.freeze({
		paths: Object.freeze(paths),
		flowMarkers,
		connectors: Object.freeze(
			preview.connectors.map((connector) =>
				Object.freeze({
					x1: connector.start.x + 0.5,
					y1: connector.start.y + 0.5,
					x2: connector.end.x + 0.5,
					y2: connector.end.y + 0.5,
				}),
			),
		),
		markerScale: Math.max(0.5, Math.min(1.45, extent * 0.03)),
		handleRadius: Math.max(0.22, Math.min(0.75, extent * 0.016)),
	});
}
