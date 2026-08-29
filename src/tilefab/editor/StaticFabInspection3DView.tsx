import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CompiledPortEquipmentPresentation } from "../compile/PortEquipmentPresentation";
import { portEquipmentShellPresentationFor } from "../compile/PortEquipmentShellPresentation";
import type { CompiledRailPresentation } from "../render/PhysicalRailPresentation";
import type { SimulationRuntimePresentationStore } from "../render/SimulationRuntimePresentation";
import type { StaticFabInspection3DChunkedArtifact } from "../render/StaticFabInspection3DArtifact";
import type { PortEquipmentSelectionIdentity } from "./PortEquipmentInspectorSelection";
import { StaticFabInspection3DBridge } from "./StaticFabInspection3DBridge";
import type {
	StaticFabInspection3DSceneArtifact,
	StaticFabInspection3DVisibility,
} from "./StaticFabInspection3DScene";
import StaticFabInspection3DViewport, {
	type StaticFabInspection3DCommand,
} from "./StaticFabInspection3DViewport";

export interface StaticFabInspection3DViewProps {
	readonly generation: number;
	readonly presentation: CompiledRailPresentation;
	readonly equipment: CompiledPortEquipmentPresentation;
	readonly selectedPathIndices: ArrayLike<number> | null;
	readonly selectedPortEquipment: PortEquipmentSelectionIdentity | null;
	readonly initialFocus: Readonly<{ x: number; z: number }>;
	readonly command: StaticFabInspection3DCommand | null;
	readonly visibility: StaticFabInspection3DVisibility;
	readonly runtimeView: SimulationRuntimePresentationStore;
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

const RAIL_ARTIFACT_CACHE = new WeakMap<
	CompiledRailPresentation,
	StaticFabInspection3DChunkedArtifact
>();

interface StaticFabInspection3DLoadState {
	readonly presentation: CompiledRailPresentation;
	readonly generation: number;
	readonly artifact: StaticFabInspection3DChunkedArtifact | null;
	readonly error: string | null;
}

interface StaticFabInspection3DEquipmentShellLoadState {
	readonly presentation: CompiledPortEquipmentPresentation;
	readonly preparationMilliseconds: number;
	readonly error: string | null;
}

export default function StaticFabInspection3DView(
	props: StaticFabInspection3DViewProps,
): React.ReactElement {
	const [bridge] = useState(() => new StaticFabInspection3DBridge());
	const [loadState, setLoadState] = useState<StaticFabInspection3DLoadState | null>(null);
	const [equipmentShellLoadState, setEquipmentShellLoadState] =
		useState<StaticFabInspection3DEquipmentShellLoadState | null>(null);
	const onFailureRef = useRef(props.onFailure);
	const subscribeRuntime = useCallback(
		(listener: () => void) => props.runtimeView.subscribe(listener),
		[props.runtimeView],
	);
	const readRuntime = useCallback(() => props.runtimeView.getSnapshot(), [props.runtimeView]);
	const simulationRuntime = useSyncExternalStore(subscribeRuntime, readRuntime, readRuntime);
	const cachedSourceArtifact = RAIL_ARTIFACT_CACHE.get(props.presentation);
	const cachedArtifact = useMemo(
		() => rebindGeneration(cachedSourceArtifact, props.generation),
		[cachedSourceArtifact, props.generation],
	);
	const activeLoadState =
		loadState?.presentation === props.presentation && loadState.generation === props.generation
			? loadState
			: null;
	const artifact = cachedArtifact ?? activeLoadState?.artifact ?? null;
	const error = cachedArtifact ? null : (activeLoadState?.error ?? null);
	const activeEquipmentShellLoadState =
		equipmentShellLoadState?.presentation === props.equipment ? equipmentShellLoadState : null;

	useEffect(() => {
		onFailureRef.current = props.onFailure;
	}, [props.onFailure]);
	useEffect(() => () => bridge.dispose(), [bridge]);
	useEffect(() => {
		const cached = rebindGeneration(RAIL_ARTIFACT_CACHE.get(props.presentation), props.generation);
		if (cached) return;
		const controller = new AbortController();
		void bridge
			.compile(props.presentation, props.generation, controller.signal)
			.then((prepared) => {
				if (controller.signal.aborted) return;
				RAIL_ARTIFACT_CACHE.set(props.presentation, prepared);
				setLoadState(
					Object.freeze({
						presentation: props.presentation,
						generation: props.generation,
						artifact: prepared,
						error: null,
					}),
				);
			})
			.catch((cause: unknown) => {
				if (controller.signal.aborted || isAbortError(cause)) return;
				const message = cause instanceof Error ? cause.message : "3D 레일 압출에 실패했습니다";
				setLoadState(
					Object.freeze({
						presentation: props.presentation,
						generation: props.generation,
						artifact: null,
						error: message,
					}),
				);
				onFailureRef.current(message);
			});
		return () => controller.abort();
	}, [bridge, props.generation, props.presentation]);
	useEffect(() => {
		let cancelled = false;
		const timeout = window.setTimeout(() => {
			const startedAt = performance.now();
			try {
				portEquipmentShellPresentationFor(props.equipment);
				if (cancelled) return;
				setEquipmentShellLoadState(
					Object.freeze({
						presentation: props.equipment,
						preparationMilliseconds: Math.max(0, performance.now() - startedAt),
						error: null,
					}),
				);
			} catch (cause) {
				if (cancelled) return;
				const message =
					cause instanceof Error ? cause.message : "3D 장비 shell 파생에 실패했습니다";
				setEquipmentShellLoadState(
					Object.freeze({
						presentation: props.equipment,
						preparationMilliseconds: Math.max(0, performance.now() - startedAt),
						error: message,
					}),
				);
				onFailureRef.current(message);
			}
		}, 0);
		return () => {
			cancelled = true;
			window.clearTimeout(timeout);
		};
	}, [props.equipment]);

	const sceneArtifact = useMemo(() => (artifact ? adaptArtifact(artifact) : null), [artifact]);
	if (!sceneArtifact || !activeEquipmentShellLoadState || activeEquipmentShellLoadState.error) {
		const activeError = error ?? activeEquipmentShellLoadState?.error ?? null;
		return (
			<div className="tilefab-inspection-3d tilefab-inspection-3d--loading" role="status">
				<span className="tilefab-startup-indicator" aria-hidden="true" />
				<strong>{activeError ? "3D 검사 뷰를 열지 못했습니다" : "3D 검사 데이터 준비 중"}</strong>
				<small>
					{activeError ?? "검증된 물리 경로와 장비 shell을 렌더 전용 버퍼로 변환합니다"}
				</small>
			</div>
		);
	}
	return (
		<StaticFabInspection3DViewport
			{...props}
			artifact={sceneArtifact}
			equipmentShellPreparationMilliseconds={activeEquipmentShellLoadState.preparationMilliseconds}
			simulationRuntime={simulationRuntime}
		/>
	);
}

function rebindGeneration(
	artifact: StaticFabInspection3DChunkedArtifact | undefined,
	generation: number,
): StaticFabInspection3DChunkedArtifact | null {
	if (!artifact) return null;
	if (artifact.sourceGeneration === generation) return artifact;
	return Object.freeze({ ...artifact, sourceGeneration: generation });
}

function adaptArtifact(
	artifact: StaticFabInspection3DChunkedArtifact,
): StaticFabInspection3DSceneArtifact {
	return Object.freeze({
		generation: artifact.sourceGeneration,
		revision: artifact.sourceRevision,
		artifactByteLength: artifact.byteLength,
		railTopElevationMeters:
			artifact.profile.railBaseElevationMeters +
			artifact.profile.bedHeightMeters +
			artifact.profile.beamHeightMeters,
		bounds: Float32Array.of(
			artifact.bounds.minX,
			artifact.bounds.minY,
			artifact.bounds.minZ,
			artifact.bounds.maxX,
			artifact.bounds.maxY,
			artifact.bounds.maxZ,
		),
		worldChunkSizeMeters: artifact.worldChunkSizeMeters,
		railChunks: Object.freeze(
			artifact.railChunks.map((chunk) =>
				Object.freeze({
					worldChunkX: chunk.worldChunkX,
					worldChunkZ: chunk.worldChunkZ,
					pickSegmentOffset: chunk.pickSegmentOffset,
					pickSegmentCount: chunk.segmentCount,
					bounds: chunk.bounds,
					bed: chunk.bed,
					beams: chunk.beams,
				}),
			),
		),
		pickSegments: artifact.pickLines.positions,
		pickPathIndices: artifact.pickLines.pathRows,
		supportInstances: artifact.supports,
		flowInstances: artifact.flows,
		advancedSwitchInstances: artifact.advancedSwitches,
	});
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}
