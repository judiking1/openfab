import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
	type CompiledPortEquipmentInteractionPresentation,
	PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS,
	portEquipmentInteractionPresentationFor,
} from "../compile/PortEquipmentInteractionPresentation";
import {
	type CompiledPortEquipmentPresentation,
	equipmentGroupPresentationRow,
	type PortEquipmentSpatialIndex,
	portEquipmentPresentationRow,
	portEquipmentSpatialIndexFor,
} from "../compile/PortEquipmentPresentation";
import {
	type CompiledPortEquipmentShellPresentation,
	PORT_EQUIPMENT_SHELL_VISUAL_PROFILE,
	portEquipmentShellPresentationFor,
} from "../compile/PortEquipmentShellPresentation";
import { EQUIPMENT_GROUP_KINDS } from "../core/EquipmentGroup";
import {
	type SimulationRuntimePresentation,
	simulationRuntimePresentationMatchesPublication,
} from "../render/SimulationRuntimePresentation";
import {
	bounds3DFromArray,
	fitStaticFabInspectionCamera,
	type StaticFabInspectionBounds3D,
	type StaticFabInspectionCameraPreset,
	staticFabInspectionRailPickThreshold,
} from "./StaticFabInspectionCamera";
import {
	staticFabInspectionCombinedBounds,
	staticFabInspectionEquipmentBodyCenterY,
	staticFabInspectionEquipmentBodyHeight,
	staticFabInspectionEquipmentOpeningCenterY,
	staticFabInspectionEquipmentPickHeight,
} from "./StaticFabInspectionSceneBounds";

export interface StaticFabInspectionSurfaceBuffer {
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly indices: Uint32Array;
}

export interface StaticFabInspection3DSceneArtifact {
	readonly generation: number;
	readonly revision: number;
	readonly artifactByteLength: number;
	readonly railTopElevationMeters: number;
	readonly bounds: Float32Array;
	readonly worldChunkSizeMeters: number;
	readonly railChunks: readonly StaticFabInspection3DSceneRailChunk[];
	/** XYZ endpoint pairs, six floats per row. */
	readonly pickSegments: Float32Array;
	readonly pickPathIndices: Uint32Array;
	readonly supportInstances: StaticFabInspectionInstanceBuffer;
	readonly flowInstances: StaticFabInspectionInstanceBuffer;
	readonly advancedSwitchInstances: StaticFabInspectionAdvancedSwitchInstanceBuffer;
}

export interface StaticFabInspection3DSceneRailChunk {
	readonly worldChunkX: number;
	readonly worldChunkZ: number;
	readonly pickSegmentOffset: number;
	readonly pickSegmentCount: number;
	readonly bounds: Readonly<{
		minX: number;
		minY: number;
		minZ: number;
		maxX: number;
		maxY: number;
		maxZ: number;
	}>;
	readonly bed: StaticFabInspectionSurfaceBuffer;
	readonly beams: StaticFabInspectionSurfaceBuffer;
}

export interface StaticFabInspectionInstanceBuffer {
	/** XYZ centers, three floats per row. */
	readonly positions: Float32Array;
	/** XYZ horizontal tangents, three floats per row. */
	readonly tangents: Float32Array;
	readonly count: number;
}

export interface StaticFabInspectionAdvancedSwitchInstanceBuffer
	extends StaticFabInspectionInstanceBuffer {
	readonly pathRows: Uint32Array;
	readonly switchIds: Uint32Array;
	readonly profileClasses: Uint8Array;
}

export interface StaticFabInspection3DVisibility {
	readonly rail: boolean;
	readonly switches: boolean;
	readonly equipment: boolean;
}

export interface StaticFabInspection3DSceneCallbacks {
	readonly onRailPick: (pathIndex: number, generation: number) => void;
	readonly onPortEquipmentPick: (
		portId: number,
		equipmentGroupId: number,
		generation: number,
	) => void;
	readonly onClearSelection: () => void;
	readonly onFocusChange: (focus: Readonly<{ x: number; z: number }>) => void;
	readonly onStatsChange?: () => void;
	readonly onPickStatsChange?: (stats: StaticFabInspection3DPickStats) => void;
}

export interface StaticFabInspection3DPickStats {
	readonly attemptCount: number;
	readonly totalMilliseconds: number;
	readonly maximumMilliseconds: number;
	readonly lastMilliseconds: number;
	readonly lastSource: StaticFabInspection3DPickSource;
}

export interface StaticFabInspection3DSceneSelection {
	readonly pathIndices: ArrayLike<number> | null;
	readonly portId: number | null;
	readonly equipmentGroupId: number | null;
}

export interface StaticFabInspection3DSceneStats {
	readonly generation: number;
	readonly artifactByteLength: number;
	readonly visualMeshCount: number;
	readonly instancedMeshCount: number;
	readonly pickProxyCount: number;
	readonly drawObjectCount: number;
	readonly railTriangleCount: number;
	readonly railPickSegmentCount: number;
	readonly equipmentBodyInstanceCount: number;
	readonly equipmentShellSpanInstanceCount: number;
	readonly portInstanceCount: number;
	readonly portSlotInstanceCount: number;
	readonly advancedSwitchInstanceCount: number;
	readonly contentBuildCount: number;
	readonly selectionApplyCount: number;
	readonly cameraDistance: number;
	readonly cameraTargetX: number;
	readonly cameraTargetZ: number;
	readonly frameScope: StaticFabInspection3DFrameScope;
	readonly framedPortBodySectionRow: number | null;
	readonly railChunkCount: number;
	readonly visibleRailChunkCount: number;
	readonly residentRailChunkCount: number;
	readonly railChunkSetUpdateCount: number;
	readonly railChunkMaterializationCount: number;
	readonly railChunkEvictionCount: number;
	readonly renderFrameCount: number;
	readonly renderMainThreadTotalMilliseconds: number;
	readonly renderMainThreadMaximumMilliseconds: number;
	readonly railChunkUpdateTotalMilliseconds: number;
	readonly railChunkUpdateMaximumMilliseconds: number;
	readonly pickAttemptCount: number;
	readonly pickMainThreadTotalMilliseconds: number;
	readonly pickMainThreadMaximumMilliseconds: number;
	readonly pickMainThreadLastMilliseconds: number;
	readonly lastPickSource: StaticFabInspection3DPickSource;
	readonly railVisible: boolean;
	readonly switchesVisible: boolean;
	readonly equipmentVisible: boolean;
	readonly runtimePublicationSequence: number;
	readonly runtimePoseFingerprint: string;
	readonly runtimeVehicleInstanceCount: number;
	readonly runtimeUpdateCount: number;
}

export type StaticFabInspection3DFrameScope = "all" | "selection" | "port-section";
export type StaticFabInspection3DPickSource =
	| "none"
	| "rail"
	| "switch"
	| "port"
	| "equipment-body";

const NO_RAYCAST: THREE.Object3D["raycast"] = () => undefined;
const FULL_DETAIL_RAIL_TRIANGLE_BUDGET = 750_000;
const OVERVIEW_HARDWARE_INSTANCE_LIMIT = 4_096;
const MAX_VISIBLE_RAIL_CHUNKS = 24;
const MAX_RESIDENT_RAIL_CHUNKS = 48;
const STATIC_FAB_INSPECTION_PICK_PROXY_LAYER = 1;
const EQUIPMENT_BODY_RAY_HIT_EPSILON_METERS = 1e-5;
const MAX_RUNTIME_VEHICLE_INSTANCE_COUNT = 8_192;
const EMPTY_SELECTION: StaticFabInspection3DSceneSelection = Object.freeze({
	pathIndices: null,
	portId: null,
	equipmentGroupId: null,
});
export const DEFAULT_STATIC_FAB_INSPECTION_3D_VISIBILITY: StaticFabInspection3DVisibility =
	Object.freeze({ rail: true, switches: true, equipment: true });

interface StaticFabInspectionResidentRailChunk {
	readonly row: number;
	readonly group: THREE.Group;
	lastUsed: number;
}

export interface StaticFabInspectionEquipmentBodyPick {
	readonly portId: number;
	readonly equipmentGroupId: number;
}

/** Shared pure resolver used by Three.js body proxies and WebGL-free parity tests. */
export function resolveStaticFabInspectionEquipmentBodyPick(
	spatialIndex: PortEquipmentSpatialIndex,
	worldX: number,
	worldZ: number,
): StaticFabInspectionEquipmentBodyPick | null {
	const hit = spatialIndex.groupAt(worldX, worldZ, EQUIPMENT_BODY_RAY_HIT_EPSILON_METERS);
	return hit ? Object.freeze({ portId: hit.portId, equipmentGroupId: hit.equipmentGroupId }) : null;
}

/** Exact renderer-only bounds for the canonical body section that owns one selected port. */
export function staticFabInspectionPortBodySectionBounds(
	presentation: CompiledPortEquipmentPresentation,
	portId: number,
): Readonly<{ bounds: StaticFabInspectionBounds3D; sectionRow: number }> | null {
	const portRow = portEquipmentPresentationRow(presentation, portId);
	if (portRow === null) return null;
	const sectionRow = presentation.portBodySectionRows[portRow] as number | undefined;
	if (sectionRow === undefined || sectionRow >= presentation.bodySectionCount) return null;
	const groupRow = presentation.bodySectionGroupRows[sectionRow] as number | undefined;
	const kindRow = groupRow === undefined ? undefined : presentation.groupKinds[groupRow];
	if (
		groupRow === undefined ||
		groupRow >= presentation.equipmentGroupCount ||
		kindRow === undefined
	) {
		return null;
	}
	const offset = sectionRow * 4;
	const minX = presentation.bodySectionBounds[offset] as number | undefined;
	const minZ = presentation.bodySectionBounds[offset + 1] as number | undefined;
	const maxX = presentation.bodySectionBounds[offset + 2] as number | undefined;
	const maxZ = presentation.bodySectionBounds[offset + 3] as number | undefined;
	if (
		![minX, minZ, maxX, maxZ].every(Number.isFinite) ||
		(minX as number) >= (maxX as number) ||
		(minZ as number) >= (maxZ as number)
	) {
		return null;
	}
	return Object.freeze({
		sectionRow,
		bounds: Object.freeze({
			minX: minX as number,
			minY: 0,
			minZ: minZ as number,
			maxX: maxX as number,
			maxY: staticFabInspectionEquipmentBodyHeight(kindRow),
			maxZ: maxZ as number,
		}),
	});
}

/** Disposable imperative Three.js boundary. It never owns authored or semantic editor state. */
export class StaticFabInspection3DScene {
	readonly renderer: THREE.WebGLRenderer;
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;

	private readonly scene = new THREE.Scene();
	private readonly content = new THREE.Group();
	private readonly runtimeContent = new THREE.Group();
	private readonly callback: StaticFabInspection3DSceneCallbacks;
	private readonly raycaster = new THREE.Raycaster();
	private readonly pointer = new THREE.Vector2();
	private artifact: StaticFabInspection3DSceneArtifact | null = null;
	private equipment: CompiledPortEquipmentPresentation | null = null;
	private equipmentSpatialIndex: PortEquipmentSpatialIndex | null = null;
	private equipmentInteraction: CompiledPortEquipmentInteractionPresentation | null = null;
	private equipmentShell: CompiledPortEquipmentShellPresentation | null = null;
	private contentBounds: StaticFabInspectionBounds3D | null = null;
	private railDetailGroup: THREE.Group | null = null;
	private railOverview: THREE.Object3D | null = null;
	private railHardwareGroup: THREE.Group | null = null;
	private advancedSwitchGroup: THREE.Group | null = null;
	private equipmentGroup: THREE.Group | null = null;
	private readonly residentRailChunks = new Map<number, StaticFabInspectionResidentRailChunk>();
	private readonly railChunkRowsByKey = new Map<string, number>();
	private railOverviewMaterial: LineMaterial | null = null;
	private portPickProxy: THREE.InstancedMesh | null = null;
	private advancedSwitchPickProxy: THREE.InstancedMesh | null = null;
	private readonly equipmentPickProxies: THREE.InstancedMesh[] = [];
	private selectionHighlight: THREE.Object3D | null = null;
	private animationFrame = 0;
	private contentBuildCount = 0;
	private selectionApplyCount = 0;
	private selection: StaticFabInspection3DSceneSelection = EMPTY_SELECTION;
	private frameScope: StaticFabInspection3DFrameScope = "all";
	private framedPortBodySectionRow: number | null = null;
	private railVisualMeshCount = 0;
	private railRenderedTriangleCount = 0;
	private railFullDetail = true;
	private railChunkUseStamp = 0;
	private visibleRailChunkCount = 0;
	private railChunkSetUpdateCount = 0;
	private railChunkMaterializationCount = 0;
	private railChunkEvictionCount = 0;
	private renderFrameCount = 0;
	private renderMainThreadTotalMilliseconds = 0;
	private renderMainThreadMaximumMilliseconds = 0;
	private railChunkUpdateTotalMilliseconds = 0;
	private railChunkUpdateMaximumMilliseconds = 0;
	private pickAttemptCount = 0;
	private pickMainThreadTotalMilliseconds = 0;
	private pickMainThreadMaximumMilliseconds = 0;
	private pickMainThreadLastMilliseconds = 0;
	private lastPickSource: StaticFabInspection3DPickSource = "none";
	private visibility: StaticFabInspection3DVisibility = DEFAULT_STATIC_FAB_INSPECTION_3D_VISIBILITY;
	private simulationRuntime: SimulationRuntimePresentation | null = null;
	private runtimeVehicleMesh: THREE.InstancedMesh | null = null;
	private runtimeVehicleCapacity = 0;
	private runtimePublicationSequence = 0;
	private runtimePoseFingerprint = "";
	private runtimeVehicleInstanceCount = 0;
	private runtimeUpdateCount = 0;
	private disposed = false;

	constructor(canvas: HTMLCanvasElement, callback: StaticFabInspection3DSceneCallbacks) {
		this.callback = callback;
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: false,
			powerPreference: "high-performance",
		});
		this.renderer.setClearColor(0x080d0e, 1);
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.05;
		this.camera = new THREE.PerspectiveCamera(38, 1, 0.02, 10_000);
		this.camera.layers.set(0);
		this.camera.up.set(0, 1, 0);
		this.controls = new OrbitControls(this.camera, canvas);
		// The static inspection surface renders only on state changes. Damping would keep scheduling
		// full-FAB frames after every pointer gesture and starve editor/browser work on large maps.
		this.controls.enableDamping = false;
		this.controls.screenSpacePanning = true;
		this.controls.minPolarAngle = THREE.MathUtils.degToRad(10);
		this.controls.maxPolarAngle = THREE.MathUtils.degToRad(80);
		this.controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
		this.controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
		this.controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
		this.controls.touches.ONE = THREE.TOUCH.ROTATE;
		this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
		this.controls.addEventListener("change", this.requestRender);
		this.controls.addEventListener("end", this.publishFocus);

		this.runtimeContent.name = "openfab-3d-live-simulation-runtime";
		this.scene.add(this.content, this.runtimeContent);
		this.scene.add(new THREE.HemisphereLight(0xc7f3f1, 0x172123, 1.6));
		const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
		keyLight.position.set(-30, 55, 24);
		this.scene.add(keyLight);
		const fillLight = new THREE.DirectionalLight(0x78cdd4, 0.8);
		fillLight.position.set(35, 18, -28);
		this.scene.add(fillLight);
		this.raycaster.params.Line = { threshold: 0.32 };
		this.raycaster.layers.set(STATIC_FAB_INSPECTION_PICK_PROXY_LAYER);
	}

	setContent(
		artifact: StaticFabInspection3DSceneArtifact,
		equipment: CompiledPortEquipmentPresentation,
	): void {
		if (this.disposed) return;
		this.contentBuildCount++;
		this.clearContent();
		this.artifact = artifact;
		this.equipment = equipment;
		this.equipmentSpatialIndex = portEquipmentSpatialIndexFor(equipment);
		this.equipmentInteraction = portEquipmentInteractionPresentationFor(equipment);
		this.equipmentShell = portEquipmentShellPresentationFor(equipment);
		this.contentBounds = staticFabInspectionCombinedBounds(
			bounds3DFromArray(artifact.bounds),
			artifact.railTopElevationMeters,
			equipment,
		);
		this.buildFloor(this.contentBounds);
		this.buildRailSurfaces(artifact);
		this.buildHardware(artifact);
		this.buildEquipment(this.equipmentShell);
		this.buildPickProxies(artifact, equipment, this.equipmentInteraction);
		this.applyObjectVisibility();
		this.applySelection(this.selection);
		this.applySimulationRuntime();
		this.requestRender();
	}

	setSimulationRuntime(presentation: SimulationRuntimePresentation | null): void {
		if (this.disposed || this.simulationRuntime === presentation) return;
		this.simulationRuntime = presentation;
		this.runtimeUpdateCount++;
		this.applySimulationRuntime();
		this.requestRender();
	}

	setVisibility(visibility: StaticFabInspection3DVisibility): void {
		if (this.disposed) return;
		this.visibility = Object.freeze({ ...visibility });
		this.applyObjectVisibility();
		this.applySelection(this.selection);
		this.requestRender();
	}

	resize(width: number, height: number, devicePixelRatio: number): void {
		if (this.disposed || width <= 0 || height <= 0) return;
		this.renderer.setPixelRatio(Math.min(2, Math.max(1, devicePixelRatio)));
		this.renderer.setSize(width, height, false);
		this.railOverviewMaterial?.resolution.set(width, height);
		this.camera.aspect = width / height;
		this.camera.updateProjectionMatrix();
		this.requestRender();
	}

	fitAll(
		preset: StaticFabInspectionCameraPreset = "isometric",
		focus?: { x: number; z: number },
	): void {
		const contentBounds = this.contentBounds;
		if (!contentBounds) return;
		this.frameScope = "all";
		this.framedPortBodySectionRow = null;
		this.fitBounds(contentBounds, preset, focus);
	}

	private fitBounds(
		bounds: StaticFabInspectionBounds3D,
		preset: StaticFabInspectionCameraPreset,
		focus?: Readonly<{ x: number; z: number }>,
	): void {
		const pose = fitStaticFabInspectionCamera(
			bounds,
			this.camera.aspect,
			this.camera.fov,
			preset,
			focus,
		);
		this.camera.position.set(pose.positionX, pose.positionY, pose.positionZ);
		this.camera.near = pose.near;
		this.camera.far = pose.far;
		this.camera.updateProjectionMatrix();
		this.controls.target.set(pose.targetX, pose.targetY, pose.targetZ);
		this.controls.minDistance = pose.minimumDistance;
		const wholeSceneMaximum = this.contentBounds
			? fitStaticFabInspectionCamera(
					this.contentBounds,
					this.camera.aspect,
					this.camera.fov,
					preset,
				).maximumDistance
			: pose.maximumDistance;
		this.controls.maxDistance = Math.max(pose.maximumDistance, wholeSceneMaximum);
		this.controls.update();
		this.publishFocus();
		this.requestRender();
	}

	frameSelection(): void {
		const bounds = this.selectionBounds();
		if (!bounds) {
			this.fitAll();
			return;
		}
		this.frameScope = "selection";
		this.framedPortBodySectionRow = null;
		this.fitBounds(
			{
				minX: bounds.min.x,
				minY: bounds.min.y,
				minZ: bounds.min.z,
				maxX: bounds.max.x,
				maxY: bounds.max.y,
				maxZ: bounds.max.z,
			},
			"isometric",
		);
	}

	/** Frame only the canonical section owning the selected port, never a distant sibling section. */
	framePortSection(): boolean {
		const presentation = this.equipment;
		const portId = this.selection.portId;
		const local =
			presentation && portId !== null
				? staticFabInspectionPortBodySectionBounds(presentation, portId)
				: null;
		if (!local) return false;
		this.frameScope = "port-section";
		this.framedPortBodySectionRow = local.sectionRow;
		this.fitBounds(local.bounds, "isometric");
		return true;
	}

	applySelection(selection: StaticFabInspection3DSceneSelection): void {
		this.selectionApplyCount++;
		this.selection = selection;
		if (this.selectionHighlight) {
			this.content.remove(this.selectionHighlight);
			disposeObject(this.selectionHighlight);
			this.selectionHighlight = null;
		}
		const highlight = new THREE.Group();
		if (this.visibility.rail) {
			this.buildRailSelectionHighlight(highlight, selection.pathIndices);
		}
		if (this.visibility.equipment) {
			this.buildEquipmentSelectionHighlight(
				highlight,
				selection.portId,
				selection.equipmentGroupId,
			);
		}
		if (highlight.children.length > 0) {
			this.selectionHighlight = highlight;
			this.content.add(highlight);
		}
		this.requestRender();
	}

	pick(clientX: number, clientY: number, canvasBounds: DOMRect): boolean {
		if (!this.artifact || canvasBounds.width <= 0 || canvasBounds.height <= 0) return false;
		const startedAt = performance.now();
		this.lastPickSource = "none";
		try {
			this.pointer.set(
				((clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1,
				-((clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1,
			);
			this.raycaster.params.Line = {
				threshold: staticFabInspectionRailPickThreshold(
					this.camera.position.distanceTo(this.controls.target),
					this.camera.fov,
					canvasBounds.height,
				),
			};
			this.raycaster.setFromCamera(this.pointer, this.camera);
			const switchHit =
				this.visibility.switches && this.advancedSwitchPickProxy
					? this.raycaster.intersectObject(this.advancedSwitchPickProxy, false)[0]
					: undefined;
			if (
				switchHit?.instanceId !== undefined &&
				this.artifact.advancedSwitchInstances.pathRows[switchHit.instanceId] !== undefined
			) {
				this.lastPickSource = "switch";
				this.callback.onRailPick(
					this.artifact.advancedSwitchInstances.pathRows[switchHit.instanceId] as number,
					this.artifact.generation,
				);
				return true;
			}
			// The visible marker owns its opening. The unsplit body proxy deliberately spans that
			// opening for stable body selection, so comparing all hits by distance would let an
			// invisible surface steal a click from the marker the user actually saw.
			const portHit =
				this.visibility.equipment && this.portPickProxy
					? this.raycaster.intersectObject(this.portPickProxy, false)[0]
					: undefined;
			if (portHit?.instanceId !== undefined) {
				const portId = this.equipment?.portIds[portHit.instanceId] as number | undefined;
				const equipmentGroupId = this.equipment?.equipmentGroupIds[portHit.instanceId] as
					| number
					| undefined;
				if (portId !== undefined && equipmentGroupId !== undefined) {
					this.lastPickSource = "port";
					this.callback.onPortEquipmentPick(portId, equipmentGroupId, this.artifact.generation);
					return true;
				}
			}
			const bodyHit = this.visibility.equipment
				? this.raycaster.intersectObjects(this.equipmentPickProxies, false)[0]
				: undefined;
			if (bodyHit && this.equipmentPickProxies.includes(bodyHit.object as THREE.InstancedMesh)) {
				const selection = this.equipmentSpatialIndex
					? resolveStaticFabInspectionEquipmentBodyPick(
							this.equipmentSpatialIndex,
							bodyHit.point.x,
							bodyHit.point.z,
						)
					: null;
				if (selection) {
					this.lastPickSource = "equipment-body";
					this.callback.onPortEquipmentPick(
						selection.portId,
						selection.equipmentGroupId,
						this.artifact.generation,
					);
					return true;
				}
			}
			const pathIndex = this.visibility.rail ? this.pickRailPathAtRay() : null;
			if (pathIndex !== null) {
				this.lastPickSource = "rail";
				this.callback.onRailPick(pathIndex, this.artifact.generation);
				return true;
			}
			this.callback.onClearSelection();
			return false;
		} finally {
			const duration = Math.max(0, performance.now() - startedAt);
			this.pickAttemptCount++;
			this.pickMainThreadLastMilliseconds = duration;
			this.pickMainThreadTotalMilliseconds += duration;
			this.pickMainThreadMaximumMilliseconds = Math.max(
				this.pickMainThreadMaximumMilliseconds,
				duration,
			);
			this.callback.onPickStatsChange?.(
				Object.freeze({
					attemptCount: this.pickAttemptCount,
					totalMilliseconds: this.pickMainThreadTotalMilliseconds,
					maximumMilliseconds: this.pickMainThreadMaximumMilliseconds,
					lastMilliseconds: this.pickMainThreadLastMilliseconds,
					lastSource: this.lastPickSource,
				}),
			);
		}
	}

	private pickRailPathAtRay(): number | null {
		const artifact = this.artifact;
		if (!artifact || artifact.pickPathIndices.length === 0) return null;
		const hitPoint = this.raycaster.ray.intersectPlane(
			new THREE.Plane(new THREE.Vector3(0, 1, 0), -artifact.railTopElevationMeters),
			new THREE.Vector3(),
		);
		if (!hitPoint) return null;
		const threshold = this.raycaster.params.Line?.threshold ?? 0.32;
		const chunkSize = artifact.worldChunkSizeMeters;
		const minChunkX = Math.floor((hitPoint.x - threshold) / chunkSize) - 1;
		const maxChunkX = Math.floor((hitPoint.x + threshold) / chunkSize) + 1;
		const minChunkZ = Math.floor((hitPoint.z - threshold) / chunkSize) - 1;
		const maxChunkZ = Math.floor((hitPoint.z + threshold) / chunkSize) + 1;
		let bestPath: number | null = null;
		let bestDistanceSquared = threshold * threshold;
		for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
			for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
				const chunkRow = this.railChunkRowsByKey.get(railChunkKey(chunkX, chunkZ));
				if (chunkRow === undefined) continue;
				const chunk = artifact.railChunks[chunkRow] as StaticFabInspection3DSceneRailChunk;
				const end = chunk.pickSegmentOffset + chunk.pickSegmentCount;
				for (let segmentRow = chunk.pickSegmentOffset; segmentRow < end; segmentRow++) {
					const offset = segmentRow * 6;
					const distanceSquared = pointToSegmentDistanceSquaredXZ(
						hitPoint.x,
						hitPoint.z,
						artifact.pickSegments[offset] as number,
						artifact.pickSegments[offset + 2] as number,
						artifact.pickSegments[offset + 3] as number,
						artifact.pickSegments[offset + 5] as number,
					);
					if (distanceSquared > bestDistanceSquared) continue;
					const candidatePath = artifact.pickPathIndices[segmentRow] as number;
					if (
						distanceSquared < bestDistanceSquared ||
						bestPath === null ||
						candidatePath < bestPath
					) {
						bestDistanceSquared = distanceSquared;
						bestPath = candidatePath;
					}
				}
			}
		}
		return bestPath;
	}

	panByKeyboard(deltaX: number, deltaZ: number): void {
		if (!Number.isFinite(deltaX) || !Number.isFinite(deltaZ)) return;
		const movement = new THREE.Vector3(deltaX, 0, deltaZ);
		this.camera.position.add(movement);
		this.controls.target.add(movement);
		this.controls.update();
		this.publishFocus();
		this.requestRender();
	}

	getStats(): StaticFabInspection3DSceneStats {
		const artifact = this.artifact;
		const equipment = this.equipment;
		const equipmentShell = this.equipmentShell;
		return Object.freeze({
			generation: artifact?.generation ?? -1,
			artifactByteLength: artifact?.artifactByteLength ?? 0,
			visualMeshCount: artifact ? this.railVisualMeshCount : 0,
			instancedMeshCount:
				(artifact ? 4 + EQUIPMENT_GROUP_KINDS.length + 3 : 0) + (this.runtimeVehicleMesh ? 1 : 0),
			pickProxyCount:
				(artifact && artifact.pickPathIndices.length > 0 ? 1 : 0) +
				(this.advancedSwitchPickProxy ? 1 : 0) +
				(this.portPickProxy ? 1 : 0) +
				this.equipmentPickProxies.length,
			drawObjectCount: this.content.children.length + this.runtimeContent.children.length,
			railTriangleCount: artifact ? this.railRenderedTriangleCount : 0,
			railPickSegmentCount: artifact?.pickPathIndices.length ?? 0,
			equipmentBodyInstanceCount: equipment?.bodySectionCount ?? 0,
			equipmentShellSpanInstanceCount: equipmentShell?.shellSpanCount ?? 0,
			portInstanceCount: equipment?.count ?? 0,
			portSlotInstanceCount: equipmentShell?.portSlotCount ?? 0,
			advancedSwitchInstanceCount: artifact?.advancedSwitchInstances.count ?? 0,
			contentBuildCount: this.contentBuildCount,
			selectionApplyCount: this.selectionApplyCount,
			cameraDistance: this.camera.position.distanceTo(this.controls.target),
			cameraTargetX: this.controls.target.x,
			cameraTargetZ: this.controls.target.z,
			frameScope: this.frameScope,
			framedPortBodySectionRow: this.framedPortBodySectionRow,
			railChunkCount: artifact?.railChunks.length ?? 0,
			visibleRailChunkCount: this.visibleRailChunkCount,
			residentRailChunkCount: this.residentRailChunks.size,
			railChunkSetUpdateCount: this.railChunkSetUpdateCount,
			railChunkMaterializationCount: this.railChunkMaterializationCount,
			railChunkEvictionCount: this.railChunkEvictionCount,
			renderFrameCount: this.renderFrameCount,
			renderMainThreadTotalMilliseconds: this.renderMainThreadTotalMilliseconds,
			renderMainThreadMaximumMilliseconds: this.renderMainThreadMaximumMilliseconds,
			railChunkUpdateTotalMilliseconds: this.railChunkUpdateTotalMilliseconds,
			railChunkUpdateMaximumMilliseconds: this.railChunkUpdateMaximumMilliseconds,
			pickAttemptCount: this.pickAttemptCount,
			pickMainThreadTotalMilliseconds: this.pickMainThreadTotalMilliseconds,
			pickMainThreadMaximumMilliseconds: this.pickMainThreadMaximumMilliseconds,
			pickMainThreadLastMilliseconds: this.pickMainThreadLastMilliseconds,
			lastPickSource: this.lastPickSource,
			railVisible: this.visibility.rail,
			switchesVisible: this.visibility.switches,
			equipmentVisible: this.visibility.equipment,
			runtimePublicationSequence: this.runtimePublicationSequence,
			runtimePoseFingerprint: this.runtimePoseFingerprint,
			runtimeVehicleInstanceCount: this.runtimeVehicleInstanceCount,
			runtimeUpdateCount: this.runtimeUpdateCount,
		});
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		if (this.animationFrame !== 0) cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		this.controls.removeEventListener("change", this.requestRender);
		this.controls.removeEventListener("end", this.publishFocus);
		this.controls.dispose();
		this.clearContent();
		this.clearRuntimeVehicleMesh();
		this.simulationRuntime = null;
		this.renderer.dispose();
	}

	private readonly requestRender = (): void => {
		if (this.disposed || this.animationFrame !== 0) return;
		this.animationFrame = requestAnimationFrame(() => {
			this.animationFrame = 0;
			if (this.disposed) return;
			const renderStartedAt = performance.now();
			const chunkUpdateStartedAt = renderStartedAt;
			this.updateRailChunkResidency();
			const chunkUpdateMilliseconds = Math.max(0, performance.now() - chunkUpdateStartedAt);
			this.renderer.render(this.scene, this.camera);
			const renderMilliseconds = Math.max(0, performance.now() - renderStartedAt);
			this.renderFrameCount++;
			this.renderMainThreadTotalMilliseconds += renderMilliseconds;
			this.renderMainThreadMaximumMilliseconds = Math.max(
				this.renderMainThreadMaximumMilliseconds,
				renderMilliseconds,
			);
			this.railChunkUpdateTotalMilliseconds += chunkUpdateMilliseconds;
			this.railChunkUpdateMaximumMilliseconds = Math.max(
				this.railChunkUpdateMaximumMilliseconds,
				chunkUpdateMilliseconds,
			);
			this.callback.onStatsChange?.();
		});
	};

	private readonly publishFocus = (): void => {
		this.callback.onFocusChange(
			Object.freeze({ x: this.controls.target.x, z: this.controls.target.z }),
		);
	};

	private clearContent(): void {
		for (const child of [...this.content.children]) {
			this.content.remove(child);
			disposeObject(child);
		}
		this.railDetailGroup = null;
		this.railOverview = null;
		this.railHardwareGroup = null;
		this.advancedSwitchGroup = null;
		this.equipmentGroup = null;
		this.residentRailChunks.clear();
		this.railChunkRowsByKey.clear();
		this.railOverviewMaterial = null;
		this.railVisualMeshCount = 0;
		this.railRenderedTriangleCount = 0;
		this.railFullDetail = true;
		this.railChunkUseStamp = 0;
		this.visibleRailChunkCount = 0;
		this.railChunkSetUpdateCount = 0;
		this.railChunkMaterializationCount = 0;
		this.railChunkEvictionCount = 0;
		this.portPickProxy = null;
		this.advancedSwitchPickProxy = null;
		this.contentBounds = null;
		this.equipmentPickProxies.length = 0;
		this.equipmentSpatialIndex = null;
		this.equipmentInteraction = null;
		this.equipmentShell = null;
		this.selectionHighlight = null;
	}

	private applySimulationRuntime(): void {
		const presentation = this.simulationRuntime;
		const publication = presentation?.publication;
		const artifact = this.artifact;
		this.runtimePublicationSequence = publication?.sequence ?? 0;
		this.runtimePoseFingerprint = "";
		this.runtimeVehicleInstanceCount = 0;
		if (this.runtimeVehicleMesh) this.runtimeVehicleMesh.count = 0;
		if (!publication || !artifact) return;
		const capacity = publication.maximumPoseCount;
		if (
			!Number.isSafeInteger(capacity) ||
			capacity <= 0 ||
			capacity > MAX_RUNTIME_VEHICLE_INSTANCE_COUNT
		) {
			return;
		}
		this.ensureRuntimeVehicleMesh(capacity);
		const mesh = this.runtimeVehicleMesh;
		if (!mesh) return;
		const matrices = mesh.instanceMatrix.array as Float32Array;
		const preparation = writeSimulationRuntimeVehiclePresentationMatrices(
			matrices,
			presentation,
			artifact.railTopElevationMeters + 0.22,
		);
		if (!preparation) return;
		mesh.count = preparation.count;
		mesh.instanceMatrix.needsUpdate = true;
		this.runtimePoseFingerprint = preparation.poseFingerprint;
		this.runtimeVehicleInstanceCount = preparation.count;
	}

	private ensureRuntimeVehicleMesh(capacity: number): void {
		if (this.runtimeVehicleMesh && this.runtimeVehicleCapacity === capacity) return;
		this.clearRuntimeVehicleMesh();
		const mesh = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0xf2cd69,
				emissive: 0x5a3b12,
				emissiveIntensity: 0.72,
				roughness: 0.34,
				metalness: 0.58,
			}),
			capacity,
		);
		mesh.name = "openfab-3d-live-oht-instances";
		mesh.count = 0;
		mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		mesh.frustumCulled = false;
		mesh.raycast = NO_RAYCAST;
		this.runtimeContent.add(mesh);
		this.runtimeVehicleMesh = mesh;
		this.runtimeVehicleCapacity = capacity;
	}

	private clearRuntimeVehicleMesh(): void {
		const mesh = this.runtimeVehicleMesh;
		if (mesh) {
			this.runtimeContent.remove(mesh);
			disposeObject(mesh);
		}
		this.runtimeVehicleMesh = null;
		this.runtimeVehicleCapacity = 0;
		this.runtimeVehicleInstanceCount = 0;
	}

	private applyObjectVisibility(): void {
		if (this.railDetailGroup) this.railDetailGroup.visible = this.visibility.rail;
		if (this.railOverview) this.railOverview.visible = this.visibility.rail;
		if (this.railHardwareGroup) this.railHardwareGroup.visible = this.visibility.rail;
		if (this.advancedSwitchGroup) this.advancedSwitchGroup.visible = this.visibility.switches;
		// Pick proxies live on a semantic-only layer excluded from the camera. Keep them visible for
		// InstancedMesh.raycast(), but never submit their transparent triangles to WebGL.
		if (this.equipmentGroup) this.equipmentGroup.visible = this.visibility.equipment;
	}

	private buildFloor(bounds: StaticFabInspectionBounds3D): void {
		const spanX = Math.max(10, bounds.maxX - bounds.minX + 12);
		const spanZ = Math.max(10, bounds.maxZ - bounds.minZ + 12);
		const centerX = (bounds.minX + bounds.maxX) / 2;
		const centerZ = (bounds.minZ + bounds.maxZ) / 2;
		const floor = new THREE.Mesh(
			new THREE.PlaneGeometry(spanX, spanZ),
			new THREE.MeshStandardMaterial({ color: 0x101719, roughness: 0.92, metalness: 0.08 }),
		);
		floor.rotation.x = -Math.PI / 2;
		floor.position.set(centerX, -0.03, centerZ);
		floor.raycast = NO_RAYCAST;
		this.content.add(floor);
		const gridSize = Math.max(spanX, spanZ);
		const grid = new THREE.GridHelper(
			gridSize,
			Math.min(400, Math.max(10, Math.round(gridSize))),
			0x355053,
			0x1b2a2c,
		);
		grid.position.set(centerX, 0, centerZ);
		grid.raycast = NO_RAYCAST;
		this.content.add(grid);
	}

	private buildRailSurfaces(artifact: StaticFabInspection3DSceneArtifact): void {
		const railTriangleCount = artifact.railChunks.reduce(
			(total, chunk) => total + chunk.bed.indices.length / 3 + chunk.beams.indices.length / 3,
			0,
		);
		this.railFullDetail = railTriangleCount <= FULL_DETAIL_RAIL_TRIANGLE_BUDGET;
		this.railDetailGroup = new THREE.Group();
		this.railDetailGroup.name = "openfab-3d-resident-rail-chunks";
		for (let row = 0; row < artifact.railChunks.length; row++) {
			const chunk = artifact.railChunks[row] as StaticFabInspection3DSceneRailChunk;
			this.railChunkRowsByKey.set(railChunkKey(chunk.worldChunkX, chunk.worldChunkZ), row);
		}
		const overviewGeometry = new LineSegmentsGeometry();
		overviewGeometry.setPositions(artifact.pickSegments);
		const overviewMaterial = new LineMaterial({
			color: 0x78e7e5,
			linewidth: 2.5,
			transparent: true,
			opacity: 0.88,
			depthWrite: false,
			worldUnits: false,
		});
		const rendererSize = this.renderer.getSize(new THREE.Vector2());
		overviewMaterial.resolution.copy(rendererSize);
		this.railOverviewMaterial = overviewMaterial;
		const overview = new LineSegments2(overviewGeometry, overviewMaterial);
		this.railOverview = overview;
		overview.position.y = 0.035;
		overview.renderOrder = 2;
		overview.raycast = NO_RAYCAST;
		this.content.add(this.railDetailGroup, overview);
		this.railVisualMeshCount = 1;
		this.railRenderedTriangleCount = artifact.railChunks.reduce(
			(total, chunk) =>
				total +
				chunk.bed.indices.length / 3 +
				(this.railFullDetail ? chunk.beams.indices.length / 3 : 0),
			0,
		);
	}

	private updateRailChunkResidency(): void {
		const artifact = this.artifact;
		const detailGroup = this.railDetailGroup;
		if (!artifact || !detailGroup || artifact.railChunks.length === 0) return;
		this.railChunkSetUpdateCount++;
		this.railChunkUseStamp++;
		this.camera.updateMatrixWorld();
		const projectionView = new THREE.Matrix4().multiplyMatrices(
			this.camera.projectionMatrix,
			this.camera.matrixWorldInverse,
		);
		const frustum = new THREE.Frustum().setFromProjectionMatrix(projectionView);
		const testBox = new THREE.Box3();
		const candidates: { row: number; distanceSquared: number }[] = [];
		for (let row = 0; row < artifact.railChunks.length; row++) {
			const chunk = artifact.railChunks[row] as StaticFabInspection3DSceneRailChunk;
			testBox.min.set(chunk.bounds.minX, chunk.bounds.minY, chunk.bounds.minZ);
			testBox.max.set(chunk.bounds.maxX, chunk.bounds.maxY, chunk.bounds.maxZ);
			if (!frustum.intersectsBox(testBox)) continue;
			const centerX = (chunk.bounds.minX + chunk.bounds.maxX) * 0.5;
			const centerZ = (chunk.bounds.minZ + chunk.bounds.maxZ) * 0.5;
			candidates.push({
				row,
				distanceSquared:
					(centerX - this.controls.target.x) ** 2 + (centerZ - this.controls.target.z) ** 2,
			});
		}
		candidates.sort(
			(left, right) => left.distanceSquared - right.distanceSquared || left.row - right.row,
		);
		const visibleRows = new Set(
			candidates.slice(0, MAX_VISIBLE_RAIL_CHUNKS).map((candidate) => candidate.row),
		);
		for (const resident of this.residentRailChunks.values()) {
			resident.group.visible = visibleRows.has(resident.row);
			if (resident.group.visible) resident.lastUsed = this.railChunkUseStamp;
		}
		for (const row of visibleRows) {
			let resident = this.residentRailChunks.get(row);
			if (!resident) {
				resident = this.materializeRailChunk(row);
				this.residentRailChunks.set(row, resident);
				detailGroup.add(resident.group);
				this.railChunkMaterializationCount++;
			}
			resident.group.visible = true;
			resident.lastUsed = this.railChunkUseStamp;
		}
		if (this.residentRailChunks.size > MAX_RESIDENT_RAIL_CHUNKS) {
			const evictable = [...this.residentRailChunks.values()]
				.filter((resident) => !resident.group.visible)
				.sort((left, right) => left.lastUsed - right.lastUsed || left.row - right.row);
			for (const resident of evictable) {
				if (this.residentRailChunks.size <= MAX_RESIDENT_RAIL_CHUNKS) break;
				detailGroup.remove(resident.group);
				disposeObject(resident.group);
				this.residentRailChunks.delete(resident.row);
				this.railChunkEvictionCount++;
			}
		}
		this.visibleRailChunkCount = visibleRows.size;
		this.railVisualMeshCount = 1 + this.residentRailChunks.size * (this.railFullDetail ? 2 : 1);
	}

	private materializeRailChunk(row: number): StaticFabInspectionResidentRailChunk {
		const artifact = this.artifact;
		if (!artifact) throw new Error("3D inspection rail chunk has no active artifact.");
		const chunk = artifact.railChunks[row];
		if (!chunk) throw new RangeError(`3D inspection rail chunk ${row} does not exist.`);
		const group = new THREE.Group();
		group.name = `openfab-3d-rail-chunk:${chunk.worldChunkX},${chunk.worldChunkZ}`;
		group.add(
			meshFromSurface(
				chunk.bed,
				new THREE.MeshStandardMaterial({
					color: this.railFullDetail ? 0x31555a : 0x4b898d,
					emissive: this.railFullDetail ? 0x0b2022 : 0x123b3d,
					emissiveIntensity: this.railFullDetail ? 0.6 : 0.78,
					roughness: 0.52,
					metalness: 0.7,
				}),
				chunk.bounds,
			),
		);
		if (this.railFullDetail) {
			group.add(
				meshFromSurface(
					chunk.beams,
					new THREE.MeshStandardMaterial({
						color: 0xa2f0ef,
						emissive: 0x174b4d,
						emissiveIntensity: 0.75,
						roughness: 0.34,
						metalness: 0.78,
					}),
					chunk.bounds,
				),
			);
		}
		return { row, group, lastUsed: this.railChunkUseStamp };
	}

	private buildHardware(artifact: StaticFabInspection3DSceneArtifact): void {
		this.railHardwareGroup = new THREE.Group();
		this.railHardwareGroup.name = "openfab-3d-rail-hardware";
		const sourceSupportCount = artifact.supportInstances.count;
		const supportCount = Math.min(sourceSupportCount, OVERVIEW_HARDWARE_INSTANCE_LIMIT);
		const supports = new THREE.InstancedMesh(
			new THREE.BoxGeometry(0.52, 0.055, 0.045),
			new THREE.MeshStandardMaterial({ color: 0xe0b65f, roughness: 0.48, metalness: 0.62 }),
			supportCount,
		);
		const supportMatrices = supports.instanceMatrix.array as Float32Array;
		for (let row = 0; row < supportCount; row++) {
			const sourceRow = staticFabInspectionSampledInstanceRow(
				row,
				supportCount,
				sourceSupportCount,
			);
			const positionOffset = sourceRow * 3;
			const tangentOffset = sourceRow * 3;
			const tangentX = artifact.supportInstances.tangents[tangentOffset] as number;
			const tangentZ = artifact.supportInstances.tangents[tangentOffset + 2] as number;
			writeSupportInstanceMatrix(
				supportMatrices,
				row,
				artifact.supportInstances.positions[positionOffset] as number,
				artifact.supportInstances.positions[positionOffset + 1] as number,
				artifact.supportInstances.positions[positionOffset + 2] as number,
				tangentX,
				tangentZ,
			);
		}
		supports.instanceMatrix.needsUpdate = true;
		applyArtifactBoundsToInstancedMesh(supports, artifact.bounds);
		supports.raycast = NO_RAYCAST;
		this.railHardwareGroup.add(supports);

		const sourceFlowCount = artifact.flowInstances.count;
		const flowCount = Math.min(sourceFlowCount, OVERVIEW_HARDWARE_INSTANCE_LIMIT);
		const flows = new THREE.InstancedMesh(
			new THREE.ConeGeometry(0.095, 0.28, 3),
			new THREE.MeshStandardMaterial({
				color: 0xf0c56c,
				emissive: 0x5e4318,
				emissiveIntensity: 0.7,
			}),
			flowCount,
		);
		const flowMatrices = flows.instanceMatrix.array as Float32Array;
		for (let row = 0; row < flowCount; row++) {
			const sourceRow = staticFabInspectionSampledInstanceRow(row, flowCount, sourceFlowCount);
			const positionOffset = sourceRow * 3;
			const tangentOffset = sourceRow * 3;
			const tangentX = artifact.flowInstances.tangents[tangentOffset] as number;
			const tangentZ = artifact.flowInstances.tangents[tangentOffset + 2] as number;
			writeFlowInstanceMatrix(
				flowMatrices,
				row,
				artifact.flowInstances.positions[positionOffset] as number,
				artifact.flowInstances.positions[positionOffset + 1] as number,
				artifact.flowInstances.positions[positionOffset + 2] as number,
				tangentX,
				tangentZ,
			);
		}
		flows.instanceMatrix.needsUpdate = true;
		applyArtifactBoundsToInstancedMesh(flows, artifact.bounds);
		flows.raycast = NO_RAYCAST;
		this.railHardwareGroup.add(flows);
		this.content.add(this.railHardwareGroup);

		this.advancedSwitchGroup = new THREE.Group();
		this.advancedSwitchGroup.name = "openfab-3d-advanced-switch-hardware";
		const switchCount = artifact.advancedSwitchInstances.count;
		const housings = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0xffffff,
				vertexColors: true,
				roughness: 0.34,
				metalness: 0.72,
			}),
			switchCount,
		);
		const actuators = new THREE.InstancedMesh(
			new THREE.CylinderGeometry(0.11, 0.13, 0.2, 12),
			new THREE.MeshStandardMaterial({
				color: 0xf5c96a,
				emissive: 0x5a3b12,
				emissiveIntensity: 0.5,
				roughness: 0.38,
				metalness: 0.62,
			}),
			switchCount,
		);
		const housingMatrices = housings.instanceMatrix.array as Float32Array;
		const actuatorMatrices = actuators.instanceMatrix.array as Float32Array;
		const profileColors = [0x72d5c4, 0x7fc5ed, 0xd7b86a, 0xcf8fe8] as const;
		for (let row = 0; row < switchCount; row++) {
			const offset = row * 3;
			const x = artifact.advancedSwitchInstances.positions[offset] as number;
			const y = artifact.advancedSwitchInstances.positions[offset + 1] as number;
			const z = artifact.advancedSwitchInstances.positions[offset + 2] as number;
			const tangentX = artifact.advancedSwitchInstances.tangents[offset] as number;
			const tangentZ = artifact.advancedSwitchInstances.tangents[offset + 2] as number;
			const profileClass = artifact.advancedSwitchInstances.profileClasses[row] as number;
			writeAdvancedSwitchHousingMatrix(
				housingMatrices,
				row,
				x,
				y,
				z,
				tangentX,
				tangentZ,
				profileClass,
			);
			writeAdvancedSwitchActuatorMatrix(actuatorMatrices, row, x, y + 0.13, z);
			housings.setColorAt(row, new THREE.Color(profileColors[profileClass] ?? profileColors[0]));
		}
		housings.instanceMatrix.needsUpdate = true;
		if (housings.instanceColor) housings.instanceColor.needsUpdate = true;
		actuators.instanceMatrix.needsUpdate = true;
		applyArtifactBoundsToInstancedMesh(housings, artifact.bounds);
		applyArtifactBoundsToInstancedMesh(actuators, artifact.bounds);
		housings.raycast = NO_RAYCAST;
		actuators.raycast = NO_RAYCAST;
		this.advancedSwitchGroup.add(housings, actuators);
		this.content.add(this.advancedSwitchGroup);
	}

	private buildEquipment(shell: CompiledPortEquipmentShellPresentation): void {
		this.equipmentGroup = new THREE.Group();
		this.equipmentGroup.name = "openfab-3d-port-equipment";
		for (let kindRow = 0; kindRow < EQUIPMENT_GROUP_KINDS.length; kindRow++) {
			let count = 0;
			for (const spanKind of shell.shellSpanKinds) {
				if (spanKind === kindRow) count++;
			}
			const mesh = new THREE.InstancedMesh(
				new THREE.BoxGeometry(1, 1, 1),
				new THREE.MeshStandardMaterial({
					color: [0x486970, 0x36775f, 0x77736d][kindRow],
					roughness: 0.68,
					metalness: 0.22,
				}),
				count,
			);
			const matrices = mesh.instanceMatrix.array as Float32Array;
			let instanceRow = 0;
			for (let spanRow = 0; spanRow < shell.shellSpanCount; spanRow++) {
				if ((shell.shellSpanKinds[spanRow] as number) !== kindRow) continue;
				const offset = spanRow * 2;
				const height = staticFabInspectionEquipmentBodyHeight(kindRow);
				const centerY = staticFabInspectionEquipmentBodyCenterY(
					kindRow,
					this.artifact?.railTopElevationMeters ?? 3.2,
				);
				const tangentX = shell.shellSpanTangents[offset] as number;
				const tangentZ = shell.shellSpanTangents[offset + 1] as number;
				writeEquipmentBodyInstanceMatrix(
					matrices,
					instanceRow++,
					shell.shellSpanCenters[offset] as number,
					centerY,
					shell.shellSpanCenters[offset + 1] as number,
					tangentX,
					tangentZ,
					(shell.shellSpanHalfExtents[offset] as number) * 2,
					height,
					(shell.shellSpanHalfExtents[offset + 1] as number) * 2,
				);
			}
			mesh.instanceMatrix.needsUpdate = true;
			mesh.raycast = NO_RAYCAST;
			this.equipmentGroup.add(mesh);
		}

		const ports = new THREE.InstancedMesh(
			staticFabInspectionPortDirectionGeometry(),
			new THREE.MeshStandardMaterial({
				color: 0x90e8dc,
				emissive: 0x174b46,
				emissiveIntensity: 0.65,
			}),
			shell.portSlotCount,
		);
		const portMatrices = ports.instanceMatrix.array as Float32Array;
		for (let row = 0; row < shell.portSlotCount; row++) {
			writePortDirectionInstanceMatrix(
				portMatrices,
				row,
				shell.portOpeningCenters[row * 2] as number,
				(this.artifact?.railTopElevationMeters ?? 3.2) - 0.34,
				shell.portOpeningCenters[row * 2 + 1] as number,
				shell.portOpeningNormals[row * 2] as number,
				shell.portOpeningNormals[row * 2 + 1] as number,
			);
		}
		ports.instanceMatrix.needsUpdate = true;
		ports.raycast = NO_RAYCAST;
		this.equipmentGroup.add(ports);

		const openingRecesses = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0x0b1516,
				emissive: 0x102e2c,
				emissiveIntensity: 0.35,
				roughness: 0.82,
				metalness: 0.08,
			}),
			shell.portSlotCount,
		);
		const openingMatrices = openingRecesses.instanceMatrix.array as Float32Array;
		const internalSlots = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({
				color: 0x8ce8dc,
				emissive: 0x1b7770,
				emissiveIntensity: 0.78,
				roughness: 0.38,
				metalness: 0.42,
			}),
			shell.portSlotCount,
		);
		const internalSlotMatrices = internalSlots.instanceMatrix.array as Float32Array;
		for (let row = 0; row < shell.portSlotCount; row++) {
			const kindRow = shell.portSlotKinds[row] as number;
			const openingCenterY = staticFabInspectionEquipmentOpeningCenterY(
				kindRow,
				this.artifact?.railTopElevationMeters ?? 3.2,
			);
			writePortShellOpeningInstanceMatrix(
				openingMatrices,
				row,
				shell.portSlotCenters[row * 2] as number,
				openingCenterY,
				shell.portSlotCenters[row * 2 + 1] as number,
				shell.portOpeningNormals[row * 2] as number,
				shell.portOpeningNormals[row * 2 + 1] as number,
				shell.portSlotHalfLengths[row] as number,
				shell.portOpeningHalfHeights[row] as number,
				shell.portSlotHalfWidths[row] as number,
			);
			writePortShellInternalSlotInstanceMatrix(
				internalSlotMatrices,
				row,
				shell.portSlotCenters[row * 2] as number,
				openingCenterY - (shell.portOpeningHalfHeights[row] as number) * 0.28,
				shell.portSlotCenters[row * 2 + 1] as number,
				shell.portOpeningNormals[row * 2] as number,
				shell.portOpeningNormals[row * 2 + 1] as number,
				shell.portSlotHalfLengths[row] as number,
				shell.portSlotHalfWidths[row] as number,
			);
		}
		openingRecesses.instanceMatrix.needsUpdate = true;
		openingRecesses.raycast = NO_RAYCAST;
		internalSlots.instanceMatrix.needsUpdate = true;
		internalSlots.raycast = NO_RAYCAST;
		this.equipmentGroup.add(openingRecesses, internalSlots);
		this.content.add(this.equipmentGroup);
	}

	private buildPickProxies(
		artifact: StaticFabInspection3DSceneArtifact,
		presentation: CompiledPortEquipmentPresentation,
		interaction: CompiledPortEquipmentInteractionPresentation,
	): void {
		const transparentPickMaterial = new THREE.MeshBasicMaterial({
			transparent: true,
			opacity: 0,
			depthWrite: false,
		});
		const transform = new THREE.Object3D();
		this.advancedSwitchPickProxy = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			transparentPickMaterial.clone(),
			artifact.advancedSwitchInstances.count,
		);
		const switchProxyMatrices = this.advancedSwitchPickProxy.instanceMatrix.array as Float32Array;
		for (let row = 0; row < artifact.advancedSwitchInstances.count; row++) {
			const offset = row * 3;
			writeAdvancedSwitchPickMatrix(
				switchProxyMatrices,
				row,
				artifact.advancedSwitchInstances.positions[offset] as number,
				artifact.advancedSwitchInstances.positions[offset + 1] as number,
				artifact.advancedSwitchInstances.positions[offset + 2] as number,
				artifact.advancedSwitchInstances.tangents[offset] as number,
				artifact.advancedSwitchInstances.tangents[offset + 2] as number,
			);
		}
		this.advancedSwitchPickProxy.instanceMatrix.needsUpdate = true;
		applyArtifactBoundsToInstancedMesh(this.advancedSwitchPickProxy, artifact.bounds);
		this.advancedSwitchPickProxy.layers.set(STATIC_FAB_INSPECTION_PICK_PROXY_LAYER);
		this.content.add(this.advancedSwitchPickProxy);
		this.portPickProxy = new THREE.InstancedMesh(
			new THREE.SphereGeometry(1, 8, 6),
			transparentPickMaterial.clone(),
			presentation.count,
		);
		for (let row = 0; row < presentation.count; row++) {
			const boundsOffset = row * 4;
			const minX = interaction.portPickBounds[boundsOffset] as number;
			const minZ = interaction.portPickBounds[boundsOffset + 1] as number;
			const maxX = interaction.portPickBounds[boundsOffset + 2] as number;
			const maxZ = interaction.portPickBounds[boundsOffset + 3] as number;
			transform.position.set(
				(minX + maxX) * 0.5,
				artifact.railTopElevationMeters - 0.34,
				(minZ + maxZ) * 0.5,
			);
			transform.rotation.set(0, 0, 0);
			transform.scale.set(
				(maxX - minX) * 0.5,
				PORT_EQUIPMENT_PORT_PICK_RADIUS_METERS,
				(maxZ - minZ) * 0.5,
			);
			transform.updateMatrix();
			this.portPickProxy.setMatrixAt(row, transform.matrix);
		}
		this.portPickProxy.instanceMatrix.needsUpdate = true;
		this.portPickProxy.layers.set(STATIC_FAB_INSPECTION_PICK_PROXY_LAYER);
		this.content.add(this.portPickProxy);

		for (let kindRow = 0; kindRow < EQUIPMENT_GROUP_KINDS.length; kindRow++) {
			let sectionCount = 0;
			for (const groupRow of presentation.bodySectionGroupRows) {
				if ((presentation.groupKinds[groupRow] as number) === kindRow) sectionCount++;
			}
			const sections = new Uint32Array(sectionCount);
			let sectionWrite = 0;
			for (let sectionRow = 0; sectionRow < presentation.bodySectionCount; sectionRow++) {
				const groupRow = presentation.bodySectionGroupRows[sectionRow] as number;
				if ((presentation.groupKinds[groupRow] as number) === kindRow) {
					sections[sectionWrite++] = sectionRow;
				}
			}
			const proxy = new THREE.InstancedMesh(
				new THREE.BoxGeometry(1, 1, 1),
				transparentPickMaterial.clone(),
				sections.length,
			);
			const proxyMatrices = proxy.instanceMatrix.array as Float32Array;
			for (let instanceRow = 0; instanceRow < sections.length; instanceRow++) {
				const sectionRow = sections[instanceRow] as number;
				const offset = sectionRow * 2;
				const height = staticFabInspectionEquipmentPickHeight(kindRow);
				const tangentX = presentation.bodySectionTangents[offset] as number;
				const tangentZ = presentation.bodySectionTangents[offset + 1] as number;
				writeEquipmentBodyInstanceMatrix(
					proxyMatrices,
					instanceRow,
					presentation.bodySectionCenters[offset] as number,
					kindRow === 0 ? artifact.railTopElevationMeters - 0.52 : height / 2,
					presentation.bodySectionCenters[offset + 1] as number,
					tangentX,
					tangentZ,
					(presentation.bodySectionHalfExtents[offset] as number) * 2,
					height,
					(presentation.bodySectionHalfExtents[offset + 1] as number) * 2,
				);
			}
			proxy.instanceMatrix.needsUpdate = true;
			proxy.layers.set(STATIC_FAB_INSPECTION_PICK_PROXY_LAYER);
			this.equipmentPickProxies.push(proxy);
			this.content.add(proxy);
		}
	}

	private buildRailSelectionHighlight(
		group: THREE.Group,
		selectedPathIndices: ArrayLike<number> | null,
	): void {
		const artifact = this.artifact;
		if (!artifact || !selectedPathIndices || selectedPathIndices.length === 0) return;
		const selected = new Set<number>();
		for (let index = 0; index < selectedPathIndices.length; index++) {
			selected.add(selectedPathIndices[index] as number);
		}
		const positions: number[] = [];
		for (let row = 0; row < artifact.pickPathIndices.length; row++) {
			if (!selected.has(artifact.pickPathIndices[row] as number)) continue;
			const offset = row * 6;
			for (let column = 0; column < 6; column++) {
				positions.push(artifact.pickSegments[offset + column] as number);
			}
		}
		if (positions.length === 0) return;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
		group.add(
			new THREE.LineSegments(
				geometry,
				new THREE.LineBasicMaterial({ color: 0xffd36b, depthTest: false, linewidth: 2 }),
			),
		);
	}

	private buildEquipmentSelectionHighlight(
		group: THREE.Group,
		portId: number | null,
		equipmentGroupId: number | null,
	): void {
		const presentation = this.equipment;
		const interaction = this.equipmentInteraction;
		if (!presentation || !interaction || (portId === null && equipmentGroupId === null)) return;
		if (equipmentGroupId !== null) {
			const groupRow = equipmentGroupPresentationRow(presentation, equipmentGroupId);
			if (groupRow !== null) {
				const bounds = new THREE.Box3();
				for (
					let sectionRow = presentation.groupBodySectionOffsets[groupRow] as number;
					sectionRow < (presentation.groupBodySectionOffsets[groupRow + 1] as number);
					sectionRow++
				) {
					const offset = sectionRow * 4;
					bounds.expandByPoint(
						new THREE.Vector3(
							presentation.bodySectionBounds[offset] as number,
							0,
							presentation.bodySectionBounds[offset + 1] as number,
						),
					);
					bounds.expandByPoint(
						new THREE.Vector3(
							presentation.bodySectionBounds[offset + 2] as number,
							3.7,
							presentation.bodySectionBounds[offset + 3] as number,
						),
					);
				}
				if (!bounds.isEmpty()) group.add(new THREE.Box3Helper(bounds, 0xffd36b));
			}
		}
		if (portId !== null) {
			const row = portEquipmentPresentationRow(presentation, portId);
			if (row !== null) {
				const marker = new THREE.Mesh(
					new THREE.TorusGeometry(0.22, 0.035, 8, 20),
					new THREE.MeshBasicMaterial({ color: 0xffe090, depthTest: false }),
				);
				marker.rotation.x = Math.PI / 2;
				marker.position.set(
					interaction.portOpeningCenters[row * 2] as number,
					(this.artifact?.railTopElevationMeters ?? 3.2) - 0.2,
					interaction.portOpeningCenters[row * 2 + 1] as number,
				);
				group.add(marker);
			}
		}
	}

	private selectionBounds(): THREE.Box3 | null {
		const highlight = this.selectionHighlight;
		if (!highlight) return null;
		const bounds = new THREE.Box3().setFromObject(highlight);
		return bounds.isEmpty() ? null : bounds;
	}
}

function meshFromSurface(
	surface: StaticFabInspectionSurfaceBuffer,
	material: THREE.Material,
	bounds: StaticFabInspectionBounds3D,
): THREE.Mesh {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(surface.positions, 3));
	geometry.setAttribute("normal", new THREE.BufferAttribute(surface.normals, 3));
	geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
	// The Worker already certified bounds while producing these immutable buffers. Reuse that
	// conservative envelope instead of scanning every rail vertex again on the interaction thread.
	geometry.boundingBox = new THREE.Box3(
		new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ),
		new THREE.Vector3(bounds.maxX, bounds.maxY, bounds.maxZ),
	);
	geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
	const mesh = new THREE.Mesh(geometry, material);
	mesh.raycast = NO_RAYCAST;
	return mesh;
}

function applyArtifactBoundsToInstancedMesh(
	mesh: THREE.InstancedMesh,
	packedBounds: Float32Array,
): void {
	const bounds = bounds3DFromArray(packedBounds);
	mesh.boundingBox = new THREE.Box3(
		new THREE.Vector3(bounds.minX, bounds.minY, bounds.minZ),
		new THREE.Vector3(bounds.maxX, bounds.maxY, bounds.maxZ),
	);
	mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(new THREE.Sphere());
}

export function staticFabInspectionSampledInstanceRow(
	displayRow: number,
	displayCount: number,
	sourceCount: number,
): number {
	if (displayCount <= 1 || sourceCount <= 1) return 0;
	return Math.round((displayRow * (sourceCount - 1)) / (displayCount - 1));
}

export function writeAdvancedSwitchHousingMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	tangentX: number,
	tangentZ: number,
	profileClass: number,
): void {
	writeEquipmentBodyInstanceMatrix(
		matrices,
		row,
		x,
		y,
		z,
		tangentX,
		tangentZ,
		0.74,
		0.16,
		0.32 + (profileClass % 2) * 0.05,
	);
}

export function writeAdvancedSwitchActuatorMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
): void {
	const offset = row * 16;
	matrices[offset] = 1;
	matrices[offset + 1] = 0;
	matrices[offset + 2] = 0;
	matrices[offset + 3] = 0;
	matrices[offset + 4] = 0;
	matrices[offset + 5] = 1;
	matrices[offset + 6] = 0;
	matrices[offset + 7] = 0;
	matrices[offset + 8] = 0;
	matrices[offset + 9] = 0;
	matrices[offset + 10] = 1;
	matrices[offset + 11] = 0;
	matrices[offset + 12] = x;
	matrices[offset + 13] = y;
	matrices[offset + 14] = z;
	matrices[offset + 15] = 1;
}

export function writeAdvancedSwitchPickMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	tangentX: number,
	tangentZ: number,
): void {
	writeEquipmentBodyInstanceMatrix(
		matrices,
		row,
		x,
		y + 0.05,
		z,
		tangentX,
		tangentZ,
		0.92,
		0.5,
		0.72,
	);
}

export function writeSupportInstanceMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	tangentX: number,
	tangentZ: number,
): void {
	const offset = row * 16;
	matrices[offset] = tangentZ;
	matrices[offset + 1] = 0;
	matrices[offset + 2] = -tangentX;
	matrices[offset + 3] = 0;
	matrices[offset + 4] = 0;
	matrices[offset + 5] = 1;
	matrices[offset + 6] = 0;
	matrices[offset + 7] = 0;
	matrices[offset + 8] = tangentX;
	matrices[offset + 9] = 0;
	matrices[offset + 10] = tangentZ;
	matrices[offset + 11] = 0;
	matrices[offset + 12] = x;
	matrices[offset + 13] = y;
	matrices[offset + 14] = z;
	matrices[offset + 15] = 1;
}

export function writeEquipmentBodyInstanceMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	tangentX: number,
	tangentZ: number,
	length: number,
	height: number,
	width: number,
): void {
	const offset = row * 16;
	matrices[offset] = tangentX * length;
	matrices[offset + 1] = 0;
	matrices[offset + 2] = tangentZ * length;
	matrices[offset + 3] = 0;
	matrices[offset + 4] = 0;
	matrices[offset + 5] = height;
	matrices[offset + 6] = 0;
	matrices[offset + 7] = 0;
	matrices[offset + 8] = -tangentZ * width;
	matrices[offset + 9] = 0;
	matrices[offset + 10] = tangentX * width;
	matrices[offset + 11] = 0;
	matrices[offset + 12] = x;
	matrices[offset + 13] = y;
	matrices[offset + 14] = z;
	matrices[offset + 15] = 1;
}

const PORT_DIRECTION_MARKER_OFFSET_METERS = 0.075;

/**
 * The opening marker is deliberately asymmetric: its local +X tip follows the exact authored
 * equipment-facing normal. It stays a renderer-only derivative of the canonical port row.
 */
export function writePortDirectionInstanceMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	normalX: number,
	normalZ: number,
): void {
	const magnitude = Math.hypot(normalX, normalZ);
	if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) {
		throw new RangeError("Port direction instance requires a finite non-zero facing vector.");
	}
	const facingX = normalX / magnitude;
	const facingZ = normalZ / magnitude;
	writeEquipmentBodyInstanceMatrix(
		matrices,
		row,
		x + facingX * PORT_DIRECTION_MARKER_OFFSET_METERS,
		y,
		z + facingZ * PORT_DIRECTION_MARKER_OFFSET_METERS,
		facingX,
		facingZ,
		1,
		1,
		1,
	);
}

export function writePortShellOpeningInstanceMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	normalX: number,
	normalZ: number,
	halfLength: number,
	halfHeight: number,
	halfWidth: number,
): void {
	writeEquipmentBodyInstanceMatrix(
		matrices,
		row,
		x,
		y,
		z,
		normalX,
		normalZ,
		halfLength * 1.82,
		halfHeight * 2,
		halfWidth * 2,
	);
}

export function writePortShellInternalSlotInstanceMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	normalX: number,
	normalZ: number,
	halfLength: number,
	halfWidth: number,
): void {
	writeEquipmentBodyInstanceMatrix(
		matrices,
		row,
		x,
		y,
		z,
		normalX,
		normalZ,
		halfLength * 1.9,
		PORT_EQUIPMENT_SHELL_VISUAL_PROFILE.internalSlotHalfHeightMeters * 2,
		halfWidth * 1.35,
	);
}

function staticFabInspectionPortDirectionGeometry(): THREE.ConeGeometry {
	const geometry = new THREE.ConeGeometry(0.105, 0.3, 8);
	// ConeGeometry points along local +Y. Rotate once so instance +X is the visible facing tip.
	geometry.rotateZ(-Math.PI / 2);
	return geometry;
}

/** Writes the derived 3D vehicle body using the same X/Z tangent convention as rail geometry. */
export function writeSimulationRuntimeVehicleMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	tangentX: number,
	tangentZ: number,
): void {
	writeEquipmentBodyInstanceMatrix(matrices, row, x, y, z, tangentX, tangentZ, 0.68, 0.26, 0.34);
}

export interface StaticFabInspectionRuntimeVehiclePreparation {
	readonly count: number;
	readonly capacity: number;
	readonly poseFingerprint: string;
}

/**
 * Validates and writes the profile-neutral runtime instance prefix consumed by derived 3D.
 * Validation completes before any destination matrix is changed, so malformed publications fail
 * closed without exposing a partially updated pose set.
 */
export function writeSimulationRuntimeVehiclePresentationMatrices(
	matrices: Float32Array,
	presentation: SimulationRuntimePresentation,
	y: number,
): StaticFabInspectionRuntimeVehiclePreparation | null {
	const publication = presentation.publication;
	const count = publication.publishedPoseCount;
	const capacity = publication.maximumPoseCount;
	if (
		!simulationRuntimePresentationMatchesPublication(presentation) ||
		typeof presentation.poseFingerprint !== "string" ||
		presentation.poseFingerprint.length === 0 ||
		!Number.isFinite(y) ||
		!Number.isSafeInteger(count) ||
		count < 0 ||
		!Number.isSafeInteger(capacity) ||
		capacity <= 0 ||
		capacity < count ||
		capacity > MAX_RUNTIME_VEHICLE_INSTANCE_COUNT ||
		matrices.length < capacity * 16 ||
		publication.poseWorldXMeters.length < count ||
		publication.poseWorldZMeters.length < count ||
		publication.poseTangentX.length < count ||
		publication.poseTangentZ.length < count
	) {
		return null;
	}
	for (let row = 0; row < count; row++) {
		const x = publication.poseWorldXMeters[row] as number;
		const z = publication.poseWorldZMeters[row] as number;
		const tangentX = publication.poseTangentX[row] as number;
		const tangentZ = publication.poseTangentZ[row] as number;
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(z) ||
			!Number.isFinite(tangentX) ||
			!Number.isFinite(tangentZ) ||
			Math.hypot(tangentX, tangentZ) <= Number.EPSILON
		) {
			return null;
		}
	}
	for (let row = 0; row < count; row++) {
		writeSimulationRuntimeVehicleMatrix(
			matrices,
			row,
			publication.poseWorldXMeters[row] as number,
			y,
			publication.poseWorldZMeters[row] as number,
			publication.poseTangentX[row] as number,
			publication.poseTangentZ[row] as number,
		);
	}
	return Object.freeze({ count, capacity, poseFingerprint: presentation.poseFingerprint });
}

export function writeFlowInstanceMatrix(
	matrices: Float32Array,
	row: number,
	x: number,
	y: number,
	z: number,
	tangentX: number,
	tangentZ: number,
): void {
	const offset = row * 16;
	matrices[offset] = -tangentZ;
	matrices[offset + 1] = 0;
	matrices[offset + 2] = -tangentX;
	matrices[offset + 3] = 0;
	matrices[offset + 4] = tangentX;
	matrices[offset + 5] = 0;
	matrices[offset + 6] = -tangentZ;
	matrices[offset + 7] = 0;
	matrices[offset + 8] = 0;
	matrices[offset + 9] = -1;
	matrices[offset + 10] = 0;
	matrices[offset + 11] = 0;
	matrices[offset + 12] = x;
	matrices[offset + 13] = y;
	matrices[offset + 14] = z;
	matrices[offset + 15] = 1;
}

function railChunkKey(worldChunkX: number, worldChunkZ: number): string {
	return `${worldChunkX},${worldChunkZ}`;
}

function pointToSegmentDistanceSquaredXZ(
	pointX: number,
	pointZ: number,
	startX: number,
	startZ: number,
	endX: number,
	endZ: number,
): number {
	const spanX = endX - startX;
	const spanZ = endZ - startZ;
	const lengthSquared = spanX * spanX + spanZ * spanZ;
	const ratio =
		lengthSquared <= Number.EPSILON
			? 0
			: THREE.MathUtils.clamp(
					((pointX - startX) * spanX + (pointZ - startZ) * spanZ) / lengthSquared,
					0,
					1,
				);
	const nearestX = startX + spanX * ratio;
	const nearestZ = startZ + spanZ * ratio;
	return (pointX - nearestX) ** 2 + (pointZ - nearestZ) ** 2;
}

function disposeObject(object: THREE.Object3D): void {
	object.traverse((child) => {
		const renderable = child as THREE.Mesh | THREE.LineSegments;
		renderable.geometry?.dispose();
		const material = renderable.material;
		if (Array.isArray(material)) {
			for (const item of material) item.dispose();
		} else material?.dispose();
	});
}
