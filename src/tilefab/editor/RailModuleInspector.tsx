import {
	ChevronDown,
	ChevronUp,
	Copy,
	CornerDownRight,
	Crosshair,
	GitBranch,
	Move,
	Scissors,
	Stamp,
	Trash2,
	X,
} from "lucide-react";
import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import type { CompiledJunction, CompiledRailPiece } from "../compile/PhysicalRailCompiler";
import type { RailConstructionCopyPreset } from "../compile/RailConstructionPresetResolver";
import {
	ADVANCED_SWITCH_PROFILE_CLASSES,
	ADVANCED_SWITCH_SHARED_TRUNK_PROFILE,
	type AdvancedSwitchGeometry,
	type AdvancedSwitchProfileClass,
	type AdvancedSwitchRecord,
} from "../core/AdvancedSwitch";
import type { AuthoredRailType } from "../core/RailCellClassification";
import type { RailModuleOwnership } from "../core/RailModuleOwnership";
import type { Cell, RailCell } from "../core/TileMap";

export interface RailModuleInspectorProps {
	readonly selected: Cell;
	readonly selectedRail: RailCell;
	readonly selectedSwitch: AdvancedSwitchRecord | undefined;
	readonly selectedSwitchGeometry: AdvancedSwitchGeometry | null;
	readonly selectedCopyPreset: RailConstructionCopyPreset | null;
	readonly selectedOwnership: RailModuleOwnership | null;
	readonly compactInspectorSheetActive: boolean;
	readonly compactInspectorExpanded: boolean;
	readonly bindCompactInspectorDisclosure: (node: HTMLButtonElement | null) => void;
	readonly compactInspectorDisclosureFocusedRef: RefObject<boolean>;
	readonly setCompactInspectorExpanded: Dispatch<SetStateAction<boolean>>;
	readonly compactInspectorCloseRef: RefObject<HTMLButtonElement | null>;
	readonly clearTransientConstruction: (message?: string) => void;
	readonly clearRailSelection: () => void;
	readonly scheduleRender: () => void;
	readonly canvasRef: RefObject<HTMLCanvasElement | null>;
	readonly selectedSwitchOutputConnected: readonly [boolean, boolean];
	readonly continueFromSwitchOutput: (outputIndex: 0 | 1) => void;
	readonly continueFromSelected: () => void;
	readonly directionNames: (mask: number) => string;
	readonly advancedSwitchSide: (switchRecord: AdvancedSwitchRecord) => "LEFT" | "RIGHT";
	readonly advancedSwitchPortSummary: (switchRecord: AdvancedSwitchRecord) => string;
	readonly selectedPhysical: CompiledRailPiece | null | undefined;
	readonly selectedType: AuthoredRailType | null;
	readonly selectedFitLabel: CompiledRailPiece["fitKind"] | "BASELINE";
	readonly selectedJunction: CompiledJunction | null;
	readonly copyConstructionPreset: (preset: RailConstructionCopyPreset) => void;
	readonly startModuleStamp: (module: RailModuleOwnership) => void;
	readonly cutSelectionToRailClipboard: () => void;
	readonly advancedSwitchProfileTitle: (profileClass: AdvancedSwitchProfileClass) => string;
	readonly reshapeSelectedSwitch: (
		profileClass: AdvancedSwitchProfileClass,
		side?: "left" | "right",
	) => void;
	readonly switchReshapeReason: string | null;
	readonly startReshape: (kind: "corner" | "endpoint" | "straight") => void;
	readonly removeSelectedBranch: () => void;
	readonly deleteSelected: () => void;
}

export function RailModuleInspector({
	selected,
	selectedRail,
	selectedSwitch,
	selectedSwitchGeometry,
	selectedCopyPreset,
	selectedOwnership,
	compactInspectorSheetActive,
	compactInspectorExpanded,
	bindCompactInspectorDisclosure,
	compactInspectorDisclosureFocusedRef,
	setCompactInspectorExpanded,
	compactInspectorCloseRef,
	clearTransientConstruction,
	clearRailSelection,
	scheduleRender,
	canvasRef,
	selectedSwitchOutputConnected,
	continueFromSwitchOutput,
	continueFromSelected,
	directionNames,
	advancedSwitchSide,
	advancedSwitchPortSummary,
	selectedPhysical,
	selectedType,
	selectedFitLabel,
	selectedJunction,
	copyConstructionPreset,
	startModuleStamp,
	cutSelectionToRailClipboard,
	advancedSwitchProfileTitle,
	reshapeSelectedSwitch,
	switchReshapeReason,
	startReshape,
	removeSelectedBranch,
	deleteSelected,
}: RailModuleInspectorProps): ReactElement {
	return (
		<aside
			className="tilefab-inspector"
			aria-label={selectedSwitch ? `스위치 SW-${selectedSwitch.id} 속성` : "레일 모듈 속성"}
			data-testid={selectedSwitch ? "advanced-switch-inspector" : "rail-inspector"}
			data-switch-id={selectedSwitch?.id ?? ""}
			data-switch-profile={selectedSwitch?.profileClass ?? ""}
			data-switch-side={selectedSwitch ? advancedSwitchSide(selectedSwitch) : ""}
			data-copy-catalog-id={selectedCopyPreset?.catalogId ?? ""}
			data-copy-grammar={selectedCopyPreset?.grammar ?? ""}
			data-copy-span={selectedCopyPreset?.span ?? ""}
			data-module-owner-id={selectedOwnership?.key ?? ""}
			data-module-owner-source={selectedOwnership?.kind ?? ""}
			data-module-owner-cells={selectedOwnership?.footprintCells.length ?? 0}
			data-compact-layout={compactInspectorSheetActive ? "bottom-sheet" : "side-panel"}
			data-compact-obstruction="selection"
			data-compact-expanded={compactInspectorSheetActive ? compactInspectorExpanded : true}
			data-compact-snap={
				compactInspectorSheetActive && !compactInspectorExpanded ? "peek" : "expanded"
			}
		>
			<header>
				<span>
					<small>{selectedSwitch ? "ADVANCED SWITCH" : "RAIL MODULE"}</small>
					<strong>
						{selectedSwitch
							? `SW-${selectedSwitch.id} · CLASS ${selectedSwitch.profileClass}`
							: `X ${selected.x} · Z ${selected.y}`}
					</strong>
				</span>
				<div className="tilefab-inspector-header-actions">
					{compactInspectorSheetActive ? (
						<button
							ref={bindCompactInspectorDisclosure}
							type="button"
							className="tilefab-inspector-disclosure"
							data-testid="compact-inspector-disclosure"
							aria-label="선택 세부정보"
							aria-expanded={compactInspectorExpanded}
							aria-controls="rail-module-inspector-content"
							title={compactInspectorExpanded ? "선택 세부정보 접기" : "선택 세부정보 펼치기"}
							onFocus={() => {
								compactInspectorDisclosureFocusedRef.current = true;
							}}
							onBlur={() => {
								compactInspectorDisclosureFocusedRef.current = false;
							}}
							onClick={() => setCompactInspectorExpanded((expanded) => !expanded)}
						>
							{compactInspectorExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
							<small>{compactInspectorExpanded ? "접기" : "열기"}</small>
						</button>
					) : null}
					<button
						ref={compactInspectorCloseRef}
						type="button"
						className="tilefab-inspector-close"
						aria-label="선택 닫기"
						title="선택 닫기"
						onClick={() => {
							clearTransientConstruction("선택을 해제했습니다");
							clearRailSelection();
							scheduleRender();
							canvasRef.current?.focus({ preventScroll: true });
						}}
					>
						<X size={15} />
					</button>
				</div>
			</header>
			<div
				id="rail-module-inspector-content"
				className="tilefab-contextual-inspector-content"
				hidden={compactInspectorSheetActive && !compactInspectorExpanded}
			>
				{selectedSwitch ? (
					<fieldset
						className="tilefab-switch-output-actions tilefab-inspector-priority-actions"
						aria-label="스위치 출력 연장"
					>
						<button
							type="button"
							className="tilefab-inspector-primary"
							data-testid="continue-switch-output-0"
							disabled={selectedSwitchOutputConnected[0]}
							aria-label={
								selectedSwitchOutputConnected[0]
									? "OUT 1은 이미 연결되어 있습니다"
									: "OUT 1에서 레일 연장"
							}
							onClick={() => continueFromSwitchOutput(0)}
						>
							<Crosshair size={14} />{" "}
							{selectedSwitchOutputConnected[0] ? "OUT 1 연결됨" : "OUT 1 연장"}
						</button>
						<button
							type="button"
							className="tilefab-inspector-primary"
							data-testid="continue-switch-output-1"
							disabled={selectedSwitchOutputConnected[1]}
							aria-label={
								selectedSwitchOutputConnected[1]
									? "OUT 2는 이미 연결되어 있습니다"
									: "OUT 2에서 레일 연장"
							}
							onClick={() => continueFromSwitchOutput(1)}
						>
							<Crosshair size={14} />{" "}
							{selectedSwitchOutputConnected[1] ? "OUT 2 연결됨" : "OUT 2 연장"}
						</button>
					</fieldset>
				) : (
					<button
						type="button"
						className="tilefab-inspector-primary tilefab-inspector-priority-action"
						data-testid="continue-selected-rail"
						onClick={continueFromSelected}
					>
						<Crosshair size={15} /> 이 모듈에서 계속 건설
					</button>
				)}
				<dl>
					{selectedSwitch && selectedSwitchGeometry ? (
						<>
							<div>
								<dt>IDENTITY</dt>
								<dd>SW-{selectedSwitch.id}</dd>
							</div>
							<div>
								<dt>TOPOLOGY / GRID</dt>
								<dd>CLASS {selectedSwitch.profileClass} · K2,2 · 1 m</dd>
							</div>
							<div>
								<dt>ORIENTATION</dt>
								<dd>
									{directionNames(selectedSwitch.forward)} · {advancedSwitchSide(selectedSwitch)}
								</dd>
							</div>
							<div>
								<dt>PORTS</dt>
								<dd title={advancedSwitchPortSummary(selectedSwitch)}>2 IN · 2 OUT</dd>
							</div>
							<div className="tilefab-switch-movement-row">
								<dt>MOVEMENTS</dt>
								<dd data-movements="4/4">
									<span
										className="tilefab-switch-matrix"
										role="img"
										aria-label="4개 이동 모두 허용"
									>
										<i />
										<i />
										<i />
										<i />
									</span>
									4 / 4
								</dd>
							</div>
							<div>
								<dt>SHARED THROAT</dt>
								<dd title={ADVANCED_SWITCH_SHARED_TRUNK_PROFILE.id}>400 · 200 · 400 mm</dd>
							</div>
							<div>
								<dt>FOOTPRINT</dt>
								<dd>
									{selectedSwitchGeometry.claimedCells.length} CLAIM ·{" "}
									{selectedSwitchGeometry.reservedCells.length} RES
								</dd>
							</div>
							{selectedPhysical?.geometryKind ? (
								<div>
									<dt>SELECTED LEG</dt>
									<dd
										data-fit={
											selectedPhysical.geometryKind === "OPENFAB_PARAMETRIC"
												? selectedPhysical.fitKind
												: "BASELINE"
										}
										title={`${selectedPhysical.type} · ${selectedPhysical.geometryKind} · ${selectedPhysical.fitKind ?? "NOT_APPLICABLE"}`}
									>
										{selectedPhysical.geometryKind === "OPENFAB_PARAMETRIC" ? (
											<>CATALOG · {selectedPhysical.fitKind}</>
										) : (
											<>
												BASELINE ·{" "}
												{selectedPhysical.fitKind === "NOT_APPLICABLE"
													? "N/A"
													: selectedPhysical.fitKind}
											</>
										)}
									</dd>
								</div>
							) : null}
						</>
					) : (
						<>
							<div>
								<dt>IN</dt>
								<dd>{directionNames(selectedRail.incoming)}</dd>
							</div>
							<div>
								<dt>OUT</dt>
								<dd>{directionNames(selectedRail.outgoing)}</dd>
							</div>
							<div>
								<dt>AUTHOR</dt>
								<dd>{selectedType}</dd>
							</div>
							<div>
								<dt>MODULE OWNER</dt>
								<dd title={selectedOwnership?.key}>
									{selectedOwnership?.kind ?? "rail"} ·{" "}
									{selectedOwnership?.footprintCells.length ?? 1} CELLS
								</dd>
							</div>
							<div>
								<dt>PHYSICAL PIECE</dt>
								<dd>
									{selectedPhysical?.type ??
										(selectedType === "TERMINAL" ? "TERMINAL" : "JUNCTION")}
								</dd>
							</div>
							{selectedPhysical?.geometryKind === "OPENFAB_PARAMETRIC" ? (
								<>
									<div>
										<dt>FIT</dt>
										<dd data-fit={selectedFitLabel}>{selectedFitLabel}</dd>
									</div>
									<div>
										<dt>R · ANGLE</dt>
										<dd>
											R{selectedPhysical.radiusMillimeters} · {selectedPhysical.rotationDegrees}°
										</dd>
									</div>
									<div>
										<dt>LEAD I / O</dt>
										<dd>
											{selectedPhysical.leadInMillimeters} / {selectedPhysical.leadOutMillimeters}{" "}
											mm
										</dd>
									</div>
									<div>
										<dt>CATALOG / COMP</dt>
										<dd
											title={`${selectedPhysical.nominalProfileId} · MIDDLE ${selectedPhysical.middleMillimeters ?? 0} mm · ΔLEAD ${selectedPhysical.leadInResidualMillimeters ?? 0}/${selectedPhysical.leadOutResidualMillimeters ?? 0} mm · ΔMID ${selectedPhysical.middleResidualMillimeters ?? 0} mm · ΔLEN ${selectedPhysical.lengthResidualMillimeters ?? 0} mm · ΔF ${selectedPhysical.forwardFitDeltaMillimeters ?? 0} mm · ΔL ${selectedPhysical.lateralFitDeltaMillimeters ?? 0} mm`}
										>
											{(
												selectedPhysical.nominalLengthMeters ?? selectedPhysical.lengthMeters
											).toFixed(3)}{" "}
											/ {selectedPhysical.lengthMeters.toFixed(3)} m
										</dd>
									</div>
								</>
							) : selectedPhysical?.geometryKind === "BASELINE_STITCHED" ? (
								<>
									<div>
										<dt>FIT</dt>
										<dd data-fit="BASELINE">BASELINE</dd>
									</div>
									<div>
										<dt>COMPILED</dt>
										<dd>{selectedPhysical.lengthMeters.toFixed(3)} m</dd>
									</div>
								</>
							) : selectedPhysical ? (
								<div>
									<dt>LENGTH</dt>
									<dd>{selectedPhysical.lengthMeters.toFixed(2)} m</dd>
								</div>
							) : null}
							{selectedJunction ? (
								<>
									<div>
										<dt>TRUNK</dt>
										<dd>
											{directionNames(selectedJunction.through.incoming)}
											{" → "}
											{directionNames(selectedJunction.through.outgoing)}
										</dd>
									</div>
									<div>
										<dt>DIVERGE</dt>
										<dd>{directionNames(selectedJunction.divergingSide)}</dd>
									</div>
									<div>
										<dt>LEAD IN / OUT</dt>
										<dd>
											{selectedJunction.leadInMillimeters} / {selectedJunction.leadOutMillimeters}{" "}
											mm
										</dd>
									</div>
									<div>
										<dt>PROFILE</dt>
										<dd>{selectedJunction.profileId}</dd>
									</div>
								</>
							) : null}
						</>
					)}
				</dl>
				{selectedCopyPreset ? (
					<button
						type="button"
						className="tilefab-inspector-primary"
						data-testid="copy-construction-preset"
						onClick={() => copyConstructionPreset(selectedCopyPreset)}
						title={`${selectedCopyPreset.grammar} · ${selectedCopyPreset.sourceId}`}
					>
						<Copy size={15} /> 건설 설정 복사
					</button>
				) : null}
				{selectedOwnership ? (
					<>
						<button
							type="button"
							className="tilefab-inspector-primary"
							data-testid="duplicate-module-stamp"
							onClick={() => startModuleStamp(selectedOwnership)}
							title="선택한 모듈의 정확한 문법과 치수를 복제 배치"
						>
							<Stamp size={15} /> 모듈 복제 배치
						</button>
						<button
							type="button"
							className="tilefab-inspector-primary"
							data-testid="cut-rail-module"
							aria-keyshortcuts="Control+X Meta+X"
							onClick={cutSelectionToRailClipboard}
							title="선택한 모듈을 원자적으로 잘라내고 최근 클립보드에 보관"
						>
							<Scissors size={15} /> 모듈 잘라내기
						</button>
					</>
				) : null}
				{selectedSwitch ? (
					<section
						className="tilefab-switch-reshape"
						aria-label="스위치 형상 변경"
						data-testid="advanced-switch-reshape-controls"
					>
						<span>TOPOLOGY</span>
						<fieldset className="tilefab-segmented" aria-label="선택한 스위치 토폴로지 클래스 변경">
							{ADVANCED_SWITCH_PROFILE_CLASSES.map((profileClass) => (
								<button
									type="button"
									key={profileClass}
									data-testid={`reshape-switch-profile-${profileClass}`}
									data-active={selectedSwitch.profileClass === profileClass}
									aria-pressed={selectedSwitch.profileClass === profileClass}
									aria-label={`클래스 ${profileClass}: ${advancedSwitchProfileTitle(profileClass)}`}
									disabled={selectedSwitch.profileClass === profileClass}
									onClick={() => reshapeSelectedSwitch(profileClass)}
									title={advancedSwitchProfileTitle(profileClass)}
								>
									{profileClass}
								</button>
							))}
						</fieldset>
						<span>CHIRALITY</span>
						<fieldset className="tilefab-segmented" aria-label="선택한 스위치 좌우 변경">
							{(["left", "right"] as const).map((side) => {
								const active = advancedSwitchSide(selectedSwitch) === side.toUpperCase();
								return (
									<button
										type="button"
										key={side}
										data-testid={`reshape-switch-side-${side}`}
										data-active={active}
										aria-pressed={active}
										disabled={active}
										onClick={() => reshapeSelectedSwitch(selectedSwitch.profileClass, side)}
									>
										{side.toUpperCase()}
									</button>
								);
							})}
						</fieldset>
						{switchReshapeReason ? (
							<p role="status" data-testid="advanced-switch-reshape-reason">
								{switchReshapeReason}
							</p>
						) : null}
					</section>
				) : null}
				{selectedSwitch ? null : (
					<>
						{selectedType === "LEFT_CURVE" || selectedType === "RIGHT_CURVE" ? (
							<button
								type="button"
								className="tilefab-inspector-primary"
								onClick={() => startReshape("corner")}
							>
								<CornerDownRight size={15} /> 코너 구간 재배치
							</button>
						) : null}
						{selectedType === "TERMINAL" ? (
							<button
								type="button"
								className="tilefab-inspector-primary"
								onClick={() => startReshape("endpoint")}
							>
								<Move size={15} /> 끝점 재배치
							</button>
						) : null}
						{selectedType === "LINEAR" ? (
							<button
								type="button"
								className="tilefab-inspector-primary"
								onClick={() => startReshape("straight")}
							>
								<Move size={15} /> 직선 구간 평행 이동
							</button>
						) : null}
						{selectedType === "BRANCH" || selectedType === "MERGE" ? (
							<button
								type="button"
								className="tilefab-inspector-danger"
								onClick={removeSelectedBranch}
							>
								<GitBranch size={15} /> 우회 분기 전체 철거
							</button>
						) : null}
					</>
				)}
				<button type="button" className="tilefab-inspector-danger" onClick={deleteSelected}>
					<Trash2 size={15} /> {selectedSwitch ? "스위치 전체 철거" : "정확한 모듈 철거"}
				</button>
			</div>
		</aside>
	);
}
