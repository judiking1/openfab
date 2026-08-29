import { useEffect, useRef } from "react";
import type { CompiledPortEquipmentPresentation } from "../compile/PortEquipmentPresentation";
import type { SimulationRuntimePresentation } from "../render/SimulationRuntimePresentation";
import type { PortEquipmentSelectionIdentity } from "./PortEquipmentInspectorSelection";
import {
	type StaticFabInspection3DPickStats,
	StaticFabInspection3DScene,
	type StaticFabInspection3DSceneArtifact,
	type StaticFabInspection3DVisibility,
} from "./StaticFabInspection3DScene";

export type StaticFabInspection3DCommandKind =
	| "fit-all"
	| "frame-selection"
	| "frame-port-section"
	| "top"
	| "isometric";

export interface StaticFabInspection3DCommand {
	readonly sequence: number;
	readonly kind: StaticFabInspection3DCommandKind;
}

export interface StaticFabInspection3DViewportProps {
	readonly artifact: StaticFabInspection3DSceneArtifact;
	readonly equipment: CompiledPortEquipmentPresentation;
	readonly equipmentShellPreparationMilliseconds: number;
	readonly selectedPathIndices: ArrayLike<number> | null;
	readonly selectedPortEquipment: PortEquipmentSelectionIdentity | null;
	readonly initialFocus: Readonly<{ x: number; z: number }>;
	readonly command: StaticFabInspection3DCommand | null;
	readonly visibility: StaticFabInspection3DVisibility;
	readonly simulationRuntime: SimulationRuntimePresentation | null;
	readonly onRailPick: (pathIndex: number, generation: number) => void;
	readonly onPortEquipmentPick: (
		selection: PortEquipmentSelectionIdentity,
		generation: number,
	) => void;
	readonly onClearSelection: () => void;
	readonly onExit: () => void;
	readonly onFocusChange: (focus: Readonly<{ x: number; z: number }>) => void;
	readonly onFailure: (message: string) => void;
}

interface PointerOrigin {
	readonly id: number;
	readonly button: number;
	readonly x: number;
	readonly y: number;
}

export default function StaticFabInspection3DViewport({
	artifact,
	equipment,
	equipmentShellPreparationMilliseconds,
	selectedPathIndices,
	selectedPortEquipment,
	initialFocus,
	command,
	visibility,
	simulationRuntime,
	onRailPick,
	onPortEquipmentPick,
	onClearSelection,
	onExit,
	onFocusChange,
	onFailure,
}: StaticFabInspection3DViewportProps): React.ReactElement {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const sceneRef = useRef<StaticFabInspection3DScene | null>(null);
	const pointerOriginRef = useRef<PointerOrigin | null>(null);
	const viewportRenderCountRef = useRef(0);
	const callbacksRef = useRef({
		onRailPick,
		onPortEquipmentPick,
		onClearSelection,
		onFocusChange,
		onFailure,
	});

	useEffect(() => {
		callbacksRef.current = {
			onRailPick,
			onPortEquipmentPick,
			onClearSelection,
			onFocusChange,
			onFailure,
		};
	}, [onClearSelection, onFailure, onFocusChange, onPortEquipmentPick, onRailPick]);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		viewportRenderCountRef.current++;
		canvas.dataset.viewportRenders = String(viewportRenderCountRef.current);
	});

	useEffect(() => {
		const root = rootRef.current;
		const workspace = root?.closest<HTMLElement>(".tilefab-workspace");
		if (!root || !workspace) return;
		let inspectorObserver: ResizeObserver | null = null;
		const updateInset = (): void => {
			inspectorObserver?.disconnect();
			inspectorObserver = null;
			if (!window.matchMedia("(max-width: 650px)").matches) {
				root.style.removeProperty("--tilefab-3d-inspector-inset");
				return;
			}
			const inspector = workspace.querySelector<HTMLElement>(".tilefab-inspector");
			if (!inspector) {
				root.style.setProperty("--tilefab-3d-inspector-inset", "0px");
				return;
			}
			const workspaceBounds = workspace.getBoundingClientRect();
			const inspectorBounds = inspector.getBoundingClientRect();
			const inset = Math.max(0, workspaceBounds.bottom - inspectorBounds.top + 8);
			root.style.setProperty("--tilefab-3d-inspector-inset", `${Math.ceil(inset)}px`);
			inspectorObserver = new ResizeObserver(updateInset);
			inspectorObserver.observe(inspector);
		};
		const workspaceObserver = new ResizeObserver(updateInset);
		const mutationObserver = new MutationObserver(updateInset);
		workspaceObserver.observe(workspace);
		mutationObserver.observe(workspace, { childList: true, subtree: true });
		window.addEventListener("resize", updateInset);
		updateInset();
		return () => {
			inspectorObserver?.disconnect();
			workspaceObserver.disconnect();
			mutationObserver.disconnect();
			window.removeEventListener("resize", updateInset);
		};
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let scene: StaticFabInspection3DScene;
		try {
			scene = new StaticFabInspection3DScene(canvas, {
				onRailPick: (pathIndex, generation) =>
					callbacksRef.current.onRailPick(pathIndex, generation),
				onPortEquipmentPick: (portId, equipmentGroupId, generation) =>
					callbacksRef.current.onPortEquipmentPick(
						Object.freeze({ portId, equipmentGroupId }),
						generation,
					),
				onClearSelection: () => callbacksRef.current.onClearSelection(),
				onFocusChange: (focus) => callbacksRef.current.onFocusChange(focus),
				onStatsChange: () => publishSceneStats(canvas, scene),
				onPickStatsChange: (stats) => publishScenePickStats(canvas, stats),
			});
		} catch (error) {
			callbacksRef.current.onFailure(normalizeFailure(error, "WebGL 3D 뷰를 시작하지 못했습니다"));
			return;
		}
		sceneRef.current = scene;
		const resizeObserver = new ResizeObserver(() => {
			scene.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);
			publishSceneStats(canvas, scene);
		});
		resizeObserver.observe(canvas);
		scene.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1);

		const handleContextLoss = (event: Event): void => {
			event.preventDefault();
			callbacksRef.current.onFailure("WebGL 컨텍스트가 손실되어 2D 편집 뷰로 돌아갑니다");
		};
		canvas.addEventListener("webglcontextlost", handleContextLoss);
		return () => {
			resizeObserver.disconnect();
			canvas.removeEventListener("webglcontextlost", handleContextLoss);
			scene.dispose();
			if (sceneRef.current === scene) sceneRef.current = null;
		};
	}, []);
	useEffect(() => {
		const canvas = canvasRef.current;
		if (canvas) {
			canvas.dataset.sceneEquipmentShellPreparationMs =
				equipmentShellPreparationMilliseconds.toFixed(3);
		}
	}, [equipmentShellPreparationMilliseconds]);

	useEffect(() => {
		const scene = sceneRef.current;
		const canvas = canvasRef.current;
		if (!scene || !canvas) return;
		try {
			scene.setContent(artifact, equipment);
			scene.fitAll("isometric", initialFocus);
			publishSceneStats(canvas, scene);
		} catch (error) {
			callbacksRef.current.onFailure(normalizeFailure(error, "3D 렌더 데이터를 열지 못했습니다"));
		}
	}, [artifact, equipment, initialFocus]);

	useEffect(() => {
		const scene = sceneRef.current;
		const canvas = canvasRef.current;
		if (!scene || !canvas) return;
		try {
			scene.setSimulationRuntime(simulationRuntime);
			publishSceneStats(canvas, scene);
		} catch (error) {
			callbacksRef.current.onFailure(
				normalizeFailure(error, "3D 실행 차량 데이터를 표시하지 못했습니다"),
			);
		}
	}, [simulationRuntime]);

	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene) return;
		scene.applySelection({
			pathIndices: selectedPathIndices,
			portId: selectedPortEquipment?.portId ?? null,
			equipmentGroupId: selectedPortEquipment?.equipmentGroupId ?? null,
		});
		const canvas = canvasRef.current;
		if (canvas) publishSceneStats(canvas, scene);
	}, [selectedPathIndices, selectedPortEquipment]);

	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene || !command) return;
		if (command.kind === "fit-all") scene.fitAll();
		else if (command.kind === "frame-selection") scene.frameSelection();
		else if (command.kind === "frame-port-section") scene.framePortSection();
		else scene.fitAll(command.kind);
		const canvas = canvasRef.current;
		if (canvas) publishSceneStats(canvas, scene);
	}, [command]);

	useEffect(() => {
		const scene = sceneRef.current;
		const canvas = canvasRef.current;
		if (!scene || !canvas) return;
		scene.setVisibility(visibility);
		publishSceneStats(canvas, scene);
	}, [visibility]);

	const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
		pointerOriginRef.current = Object.freeze({
			id: event.pointerId,
			button: event.button,
			x: event.clientX,
			y: event.clientY,
		});
		event.currentTarget.focus({ preventScroll: true });
	};
	const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>): void => {
		const origin = pointerOriginRef.current;
		pointerOriginRef.current = null;
		if (!origin || origin.id !== event.pointerId) return;
		if (origin.button !== 0 || event.button !== 0) return;
		if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 5) return;
		sceneRef.current?.pick(
			event.clientX,
			event.clientY,
			event.currentTarget.getBoundingClientRect(),
		);
	};
	const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
		const scene = sceneRef.current;
		if (!scene || event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.code === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onExit();
			return;
		}
		if (event.code === "Home") {
			event.preventDefault();
			scene.fitAll();
			return;
		}
		if (event.code === "KeyF") {
			event.preventDefault();
			if (event.shiftKey) scene.framePortSection();
			else scene.frameSelection();
			return;
		}
		const distance = Math.max(0.5, scene.camera.position.distanceTo(scene.controls.target) * 0.025);
		let deltaX = 0;
		let deltaZ = 0;
		if (event.code === "KeyW" || event.code === "ArrowUp") deltaZ = -distance;
		if (event.code === "KeyS" || event.code === "ArrowDown") deltaZ = distance;
		if (event.code === "KeyA" || event.code === "ArrowLeft") deltaX = -distance;
		if (event.code === "KeyD" || event.code === "ArrowRight") deltaX = distance;
		if (deltaX === 0 && deltaZ === 0) return;
		event.preventDefault();
		scene.panByKeyboard(deltaX, deltaZ);
	};

	return (
		<div
			ref={rootRef}
			className="tilefab-inspection-3d"
			data-testid="static-fab-inspection-3d"
			data-generation={artifact.generation}
		>
			<canvas
				ref={canvasRef}
				className="tilefab-inspection-3d-canvas"
				data-testid="static-fab-inspection-3d-canvas"
				aria-label="정적 FAB 3D 검사 뷰"
				aria-keyshortcuts="W A S D ArrowUp ArrowDown ArrowLeft ArrowRight F Shift+F Home Escape"
				tabIndex={0}
				onPointerDown={handlePointerDown}
				onPointerUp={handlePointerUp}
				onPointerCancel={() => {
					pointerOriginRef.current = null;
				}}
				onDoubleClick={() => sceneRef.current?.framePortSection()}
				onContextMenu={(event) => event.preventDefault()}
				onKeyDown={handleKeyDown}
			/>
			<div className="tilefab-inspection-3d-status" role="status">
				<span>READ-ONLY 3D</span>
				<small>
					PHYSICAL RAIL · PORTS · EQUIPMENT
					{simulationRuntime ? " · LIVE OHT" : ""}
				</small>
			</div>
		</div>
	);
}

function publishSceneStats(canvas: HTMLCanvasElement, scene: StaticFabInspection3DScene): void {
	const stats = scene.getStats();
	canvas.dataset.sceneGeneration = String(stats.generation);
	canvas.dataset.sceneArtifactBytes = String(stats.artifactByteLength);
	canvas.dataset.sceneVisualMeshes = String(stats.visualMeshCount);
	canvas.dataset.sceneInstancedMeshes = String(stats.instancedMeshCount);
	canvas.dataset.scenePickProxies = String(stats.pickProxyCount);
	canvas.dataset.sceneObjects = String(stats.drawObjectCount);
	canvas.dataset.sceneTriangles = String(stats.railTriangleCount);
	canvas.dataset.scenePickSegments = String(stats.railPickSegmentCount);
	canvas.dataset.sceneEquipmentInstances = String(stats.equipmentBodyInstanceCount);
	canvas.dataset.sceneEquipmentShellSpans = String(stats.equipmentShellSpanInstanceCount);
	canvas.dataset.scenePortInstances = String(stats.portInstanceCount);
	canvas.dataset.scenePortSlotInstances = String(stats.portSlotInstanceCount);
	canvas.dataset.sceneAdvancedSwitchInstances = String(stats.advancedSwitchInstanceCount);
	canvas.dataset.sceneContentBuilds = String(stats.contentBuildCount);
	canvas.dataset.sceneSelectionApplies = String(stats.selectionApplyCount);
	canvas.dataset.sceneCameraDistance = stats.cameraDistance.toFixed(3);
	canvas.dataset.sceneCameraTargetX = stats.cameraTargetX.toFixed(3);
	canvas.dataset.sceneCameraTargetZ = stats.cameraTargetZ.toFixed(3);
	canvas.dataset.sceneFrameScope = stats.frameScope;
	canvas.dataset.sceneFramedPortBodySectionRow = String(stats.framedPortBodySectionRow ?? "");
	canvas.dataset.sceneRailChunks = String(stats.railChunkCount);
	canvas.dataset.sceneVisibleRailChunks = String(stats.visibleRailChunkCount);
	canvas.dataset.sceneResidentRailChunks = String(stats.residentRailChunkCount);
	canvas.dataset.sceneChunkSetUpdates = String(stats.railChunkSetUpdateCount);
	canvas.dataset.sceneChunkMaterializations = String(stats.railChunkMaterializationCount);
	canvas.dataset.sceneChunkEvictions = String(stats.railChunkEvictionCount);
	canvas.dataset.sceneRenderFrames = String(stats.renderFrameCount);
	canvas.dataset.sceneRenderMainThreadTotalMs = stats.renderMainThreadTotalMilliseconds.toFixed(3);
	canvas.dataset.sceneRenderMainThreadMaximumMs =
		stats.renderMainThreadMaximumMilliseconds.toFixed(3);
	canvas.dataset.sceneChunkUpdateTotalMs = stats.railChunkUpdateTotalMilliseconds.toFixed(3);
	canvas.dataset.sceneChunkUpdateMaximumMs = stats.railChunkUpdateMaximumMilliseconds.toFixed(3);
	canvas.dataset.sceneRailVisible = String(stats.railVisible);
	canvas.dataset.sceneSwitchesVisible = String(stats.switchesVisible);
	canvas.dataset.sceneEquipmentVisible = String(stats.equipmentVisible);
	canvas.dataset.sceneRuntimeSequence = String(stats.runtimePublicationSequence);
	canvas.dataset.sceneRuntimePoseFingerprint = stats.runtimePoseFingerprint;
	canvas.dataset.sceneRuntimeVehicles = String(stats.runtimeVehicleInstanceCount);
	canvas.dataset.sceneRuntimeUpdates = String(stats.runtimeUpdateCount);
}

function publishScenePickStats(
	canvas: HTMLCanvasElement,
	stats: StaticFabInspection3DPickStats,
): void {
	canvas.dataset.scenePickAttempts = String(stats.attemptCount);
	canvas.dataset.scenePickMainThreadTotalMs = stats.totalMilliseconds.toFixed(3);
	canvas.dataset.scenePickMainThreadMaximumMs = stats.maximumMilliseconds.toFixed(3);
	canvas.dataset.scenePickMainThreadLastMs = stats.lastMilliseconds.toFixed(3);
	canvas.dataset.sceneLastPickSource = stats.lastSource;
}

function normalizeFailure(error: unknown, fallback: string): string {
	return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}
