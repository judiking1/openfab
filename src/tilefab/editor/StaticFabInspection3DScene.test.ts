import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import {
	type CompiledPortEquipmentPresentation,
	compilePortEquipmentPresentation,
	PortEquipmentSpatialIndex,
} from "../compile/PortEquipmentPresentation";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
	RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
	type SimulationRuntimePresentation,
} from "../render/SimulationRuntimePresentation";
import type { DeterministicResidentRuntimePublication } from "../simulation/DeterministicResidentRuntimePublisher";
import type { DeterministicScenarioRuntimePublication } from "../simulation/DeterministicScenarioRuntimePublisher";
import {
	captureStaticFabInspectionDfgRelease,
	disposeStaticFabInspectionOrbitControls,
	resolveStaticFabInspectionEquipmentBodyPick,
	StaticFabInspection3DScene,
	staticFabInspectionPortBodySectionBounds,
	staticFabInspectionSampledInstanceRow,
	writeAdvancedSwitchActuatorMatrix,
	writeAdvancedSwitchHousingMatrix,
	writeAdvancedSwitchPickMatrix,
	writeEquipmentBodyInstanceMatrix,
	writeFlowInstanceMatrix,
	writePortDirectionInstanceMatrix,
	writePortShellInternalSlotInstanceMatrix,
	writePortShellOpeningInstanceMatrix,
	writeSimulationRuntimeVehicleMatrix,
	writeSimulationRuntimeVehiclePresentationMatrices,
	writeSupportInstanceMatrix,
} from "./StaticFabInspection3DScene";

describe("StaticFabInspection3DScene shared DFG texture lifetime", () => {
	it("releases one renderer's allocation without dispatching shared texture disposal", () => {
		const shared = new THREE.Texture();
		const material = new THREE.MeshStandardMaterial();
		const first = textureRendererFixture(material, shared);
		const second = textureRendererFixture(material, shared);
		let unrelatedDisposals = 0;
		shared.addEventListener("dispose", () => unrelatedDisposals++);
		const releaseFirst = captureStaticFabInspectionDfgRelease(first.renderer, material);
		const releaseSecond = captureStaticFabInspectionDfgRelease(second.renderer, material);
		expect(releaseFirst).not.toBeNull();
		expect(releaseSecond).not.toBeNull();
		// Identifying the owner must free its temporary probe immediately.
		expect([...first.allocations]).toEqual([shared]);
		expect([...second.allocations]).toEqual([shared]);
		const secondAllocation = second.renderer.properties.get(shared);
		releaseFirst?.();
		releaseFirst?.();
		expect(first.allocations.size).toBe(0);
		expect(first.renderer.properties.has(shared)).toBe(false);
		expect(shared.hasEventListener("dispose", first.onDispose)).toBe(false);
		expect(shared.hasEventListener("dispose", second.onDispose)).toBe(true);
		expect(second.renderer.properties.get(shared)).toBe(secondAllocation);
		expect([...second.allocations]).toEqual([shared]);
		expect(unrelatedDisposals).toBe(0);
		releaseSecond?.();
		releaseSecond?.();
		expect(second.allocations.size).toBe(0);
		expect(unrelatedDisposals).toBe(0);
	});

	it("does nothing for a material or texture not uploaded by this renderer", () => {
		const texture = new THREE.Texture();
		const material = new THREE.MeshStandardMaterial();
		const owner = textureRendererFixture(material, texture);
		expect(
			captureStaticFabInspectionDfgRelease(owner.renderer, new THREE.MeshBasicMaterial()),
		).toBeNull();
		owner.renderer.properties.remove(texture);
		expect(captureStaticFabInspectionDfgRelease(owner.renderer, material)).toBeNull();
		expect(owner.allocations.size).toBe(1);
	});

	it("does not repeat native deallocation after external texture disposal", () => {
		const texture = new THREE.Texture();
		const material = new THREE.MeshStandardMaterial();
		const owner = textureRendererFixture(material, texture);
		const release = captureStaticFabInspectionDfgRelease(owner.renderer, material);
		texture.dispose();
		expect(() => release?.()).not.toThrow();
		expect(owner.allocations.size).toBe(0);
	});

	it("rolls back the actual LUT after probe registration succeeds and initialization throws", () => {
		const texture = new THREE.Texture();
		const material = new THREE.MeshStandardMaterial();
		const owner = textureRendererFixture(material, texture);
		const other = textureRendererFixture(material, texture);
		const initialize = owner.renderer.initTexture;
		const failure = new Error("probe initialization failed after registration");
		owner.renderer.initTexture = (probe) => {
			initialize(probe);
			throw failure;
		};
		try {
			captureStaticFabInspectionDfgRelease(owner.renderer, material);
			throw new Error("Expected initialization failure");
		} catch (error) {
			expect(error).toBeInstanceOf(AggregateError);
			expect((error as AggregateError).errors).toContain(failure);
		}
		expect(owner.allocations.size).toBe(0);
		expect(texture.hasEventListener("dispose", owner.onDispose)).toBe(false);
		expect(texture.hasEventListener("dispose", other.onDispose)).toBe(true);
		expect([...other.allocations]).toEqual([texture]);
	});

	it("rolls back the actual LUT when probe disposal throws", () => {
		const texture = new THREE.Texture();
		const material = new THREE.MeshStandardMaterial();
		const owner = textureRendererFixture(material, texture);
		const initialize = owner.renderer.initTexture;
		owner.renderer.initTexture = (probe) => {
			initialize(probe);
			probe.addEventListener("dispose", () => {
				throw new Error("probe disposal failed");
			});
		};
		expect(() => captureStaticFabInspectionDfgRelease(owner.renderer, material)).toThrow(
			AggregateError,
		);
		expect(owner.allocations.size).toBe(0);
		expect(texture.hasEventListener("dispose", owner.onDispose)).toBe(false);
	});

	it("removes only the owning LUT callback even when native deallocation throws", () => {
		const texture = new THREE.Texture();
		const material = new THREE.MeshStandardMaterial();
		const owner = textureRendererFixture(material, texture, (target) => {
			if (target === texture) throw new Error("native release failed");
		});
		const other = textureRendererFixture(material, texture);
		const release = captureStaticFabInspectionDfgRelease(owner.renderer, material);
		expect(() => release?.()).toThrow(AggregateError);
		expect(texture.hasEventListener("dispose", owner.onDispose)).toBe(false);
		expect(texture.hasEventListener("dispose", other.onDispose)).toBe(true);
		expect([...other.allocations]).toEqual([texture]);
		expect(() => release?.()).not.toThrow();
	});
});

describe("StaticFabInspection3DScene exception cleanup", () => {
	it("continues content, runtime and renderer disposal after DFG release throws", () => {
		const fixture = sceneExceptionFixture();
		expect(() => fixture.scene.dispose()).toThrow(AggregateError);
		expect(fixture.order).toEqual(["dfg", "content", "runtime", "renderer"]);
		expect(fixture.controls.root.count("keydown", true)).toBe(0);
		expect(() => fixture.scene.dispose()).not.toThrow();
		expect(fixture.order).toHaveLength(4);
	});

	it("reports frame and cleanup errors once through the failure callback after cleanup", () => {
		const fixture = sceneExceptionFixture();
		const renderFrame = Reflect.get(
			StaticFabInspection3DScene.prototype,
			"renderFrame",
		) as () => void;
		expect(() => renderFrame.call(fixture.scene)).not.toThrow();
		expect(fixture.order).toEqual(["dfg", "content", "runtime", "renderer", "failure"]);
		expect(fixture.failures).toHaveLength(1);
		expect((fixture.failures[0] as AggregateError).errors[0]).toBe(fixture.renderFailure);
		renderFrame.call(fixture.scene);
		expect(fixture.failures).toHaveLength(1);
	});
});

function sceneExceptionFixture() {
	const controls = controlsLifetimeFixture();
	const order: string[] = [];
	const failures: unknown[] = [];
	const renderFailure = new Error("frame failure");
	const scene = Object.assign(Object.create(StaticFabInspection3DScene.prototype), {
		disposed: false,
		animationFrame: 0,
		controls: controls.controls,
		controlsRoot: controls.root,
		releaseDfgTexture: () => {
			order.push("dfg");
			throw new Error("DFG failure");
		},
		clearContent: () => order.push("content"),
		clearRuntimeVehicleMesh: () => order.push("runtime"),
		updateCameraClipping: () => undefined,
		updateRailChunkResidency: () => undefined,
		renderer: {
			render: () => {
				throw renderFailure;
			},
			dispose: () => order.push("renderer"),
		},
		callback: {
			onFailure: (error: unknown) => {
				order.push("failure");
				failures.push(error);
			},
		},
	}) as StaticFabInspection3DScene;
	return { scene, order, failures, renderFailure, controls };
}

function textureRendererFixture(
	material: THREE.Material,
	texture: THREE.Texture,
	beforeDispose?: (target: THREE.Texture) => void,
) {
	const records = new Map<unknown, Record<string, unknown>>();
	const allocations = new Set<THREE.Texture>();
	const onDispose = (event: THREE.Event<"dispose", THREE.Texture>): void => {
		beforeDispose?.(event.target);
		event.target.removeEventListener("dispose", onDispose);
		// A renderer's native callback needs its allocation metadata until deallocation completes.
		expect(records.get(event.target)?.__webglInit).toBe(true);
		expect(allocations.delete(event.target)).toBe(true);
		records.delete(event.target);
	};
	const renderer: Pick<THREE.WebGLRenderer, "properties" | "initTexture"> = {
		properties: {
			has: (object) => records.has(object),
			get: (object) => records.get(object) ?? {},
			remove: (object) => {
				records.delete(object);
			},
			update: (object, key, value) => {
				const record = records.get(object);
				if (record) record[String(key)] = value;
			},
			dispose: () => records.clear(),
		},
		initTexture: (item) => {
			if (item !== texture) expect(item.version).toBeGreaterThan(0);
			allocations.add(item);
			records.set(item, { __webglInit: true });
			item.addEventListener("dispose", onDispose);
		},
	};
	renderer.initTexture(texture);
	records.set(material, { uniforms: { dfgLUT: { value: texture } } });
	return { renderer, allocations, onDispose };
}

describe("StaticFabInspection3DScene controls lifetime", () => {
	it("removes connected root and canvas listeners through normal disposal", () => {
		const fixture = controlsLifetimeFixture();
		expect(fixture.root.count("keydown", true)).toBe(1);
		expect(fixture.canvas.count("pointerdown")).toBe(1);
		disposeStaticFabInspectionOrbitControls(fixture.controls, fixture.root);
		expect(fixture.root.count("keydown", true)).toBe(0);
		expect(fixture.canvas.count("pointerdown")).toBe(0);
		expect(fixture.canvas.style.touchAction).toBe("");
	});

	it.each([
		false,
		true,
	])("releases the original root after detachment (Control held: %s)", (held) => {
		const fixture = controlsLifetimeFixture();
		const unrelated = (): void => undefined;
		fixture.root.addEventListener("keydown", unrelated, { capture: true });
		if (held) fixture.root.dispatchEvent(Object.assign(new Event("keydown"), { key: "Control" }));
		expect(fixture.root.count("keyup", true)).toBe(held ? 1 : 0);
		fixture.detach();
		disposeStaticFabInspectionOrbitControls(fixture.controls, fixture.root);
		disposeStaticFabInspectionOrbitControls(fixture.controls, fixture.root);
		expect(fixture.root.count("keydown", true)).toBe(1);
		expect(fixture.root.count("keyup", true)).toBe(0);
		expect(fixture.detachedRoot.count("keydown", true)).toBe(0);
		expect(fixture.canvas.count("pointerdown")).toBe(0);
		// An old controls callback must not reactivate a keyup listener after disposal.
		fixture.root.dispatchEvent(Object.assign(new Event("keydown"), { key: "Control" }));
		expect(fixture.root.count("keyup", true)).toBe(0);
		fixture.root.removeEventListener("keydown", unrelated, { capture: true });
		expect(fixture.root.count("keydown", true)).toBe(0);
	});

	it("cleans the connection root rather than assuming ownerDocument across 17 lifetimes", () => {
		const root = new ControlsEventTarget();
		for (let round = 0; round < 17; round++) {
			const fixture = controlsLifetimeFixture(root);
			expect(fixture.canvas.ownerDocument).not.toBe(root);
			expect(root.count("keydown", true)).toBe(1);
			root.dispatchEvent(Object.assign(new Event("keydown"), { key: "Control" }));
			root.dispatchEvent(Object.assign(new Event("keyup"), { key: "Control" }));
			expect(root.count("keyup", true)).toBe(0);
			fixture.detach();
			disposeStaticFabInspectionOrbitControls(fixture.controls, root);
			expect(root.count("keydown", true)).toBe(0);
		}
	});
});

class ControlsEventTarget extends EventTarget {
	private readonly tracked = new Map<string, Set<EventListenerOrEventListenerObject>>();
	override addEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: AddEventListenerOptions | boolean,
	): void {
		const key = this.key(type, options);
		if (callback) {
			const listeners = this.tracked.get(key) ?? new Set<EventListenerOrEventListenerObject>();
			listeners.add(callback);
			this.tracked.set(key, listeners);
		}
		super.addEventListener(type, callback, options);
	}
	override removeEventListener(
		type: string,
		callback: EventListenerOrEventListenerObject | null,
		options?: EventListenerOptions | boolean,
	): void {
		if (callback) this.tracked.get(this.key(type, options))?.delete(callback);
		super.removeEventListener(type, callback, options);
	}
	count(type: string, capture = false): number {
		return this.tracked.get(this.key(type, capture))?.size ?? 0;
	}
	private key(type: string, options?: EventListenerOptions | boolean): string {
		return `${type}:${typeof options === "boolean" ? options : options?.capture === true}`;
	}
}

function controlsLifetimeFixture(root = new ControlsEventTarget()) {
	const detachedRoot = new ControlsEventTarget();
	let currentRoot = root;
	const canvas = Object.assign(new ControlsEventTarget(), {
		style: { touchAction: "" },
		ownerDocument: new ControlsEventTarget(),
		getRootNode: () => currentRoot,
	});
	const controls = new OrbitControls(
		new THREE.PerspectiveCamera(),
		canvas as unknown as HTMLCanvasElement,
	);
	return {
		controls,
		canvas,
		root,
		detachedRoot,
		detach: () => {
			currentRoot = detachedRoot;
		},
	};
}

describe("StaticFabInspection3DScene instance matrices", () => {
	it("writes profile-aware rigid switch housing plus centered actuator and pick transforms", () => {
		const housing = new Float32Array(16);
		const actuator = new Float32Array(16);
		const pick = new Float32Array(16);

		writeAdvancedSwitchHousingMatrix(housing, 0, 4, 3.28, 7, 1, 0, 1);
		writeAdvancedSwitchActuatorMatrix(actuator, 0, 4, 3.41, 7);
		writeAdvancedSwitchPickMatrix(pick, 0, 4, 3.28, 7, 1, 0);

		expect(housing[0]).toBeCloseTo(0.74, 6);
		expect(housing[5]).toBeCloseTo(0.16, 6);
		expect(housing[10]).toBeCloseTo(0.37, 6);
		expect(actuator[12]).toBeCloseTo(4, 6);
		expect(actuator[14]).toBeCloseTo(7, 6);
		expect(pick[0]).toBeCloseTo(0.92, 6);
		expect(pick[5]).toBeCloseTo(0.5, 6);
		expect(pick[10]).toBeCloseTo(0.72, 6);
	});

	it("samples overview hardware across the complete source range", () => {
		const rows = Array.from({ length: 4 }, (_, row) =>
			staticFabInspectionSampledInstanceRow(row, 4, 10),
		);

		expect(rows).toEqual([0, 3, 6, 9]);
		expect(staticFabInspectionSampledInstanceRow(0, 1, 10)).toBe(0);
		expect(staticFabInspectionSampledInstanceRow(0, 0, 0)).toBe(0);
	});

	it.each([
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
		[Math.SQRT1_2, Math.SQRT1_2],
	] as const)("matches the former support transform for tangent %s,%s", (tangentX, tangentZ) => {
		const expected = new THREE.Object3D();
		expected.position.set(7, 3, -4);
		expected.rotation.set(0, -Math.atan2(tangentZ, tangentX) + Math.PI / 2, 0);
		expected.updateMatrix();
		const actual = new Float32Array(16);

		writeSupportInstanceMatrix(actual, 0, 7, 3, -4, tangentX, tangentZ);

		expectMatrixClose(actual, expected.matrix.elements);
	});

	it("writes the exact oriented body matrix used by visual and pick instances", () => {
		const expected = new THREE.Object3D();
		expected.position.set(2, 1, 3);
		expected.rotation.set(0, -Math.PI / 4, 0);
		expected.scale.set(4, 2, 0.8);
		expected.updateMatrix();
		const actual = new Float32Array(16);

		writeEquipmentBodyInstanceMatrix(actual, 0, 2, 1, 3, Math.SQRT1_2, Math.SQRT1_2, 4, 2, 0.8);

		expectMatrixClose(actual, expected.matrix.elements);
	});

	it("orients the asymmetric port marker from the exact authored facing normal", () => {
		const withTravel = new Float32Array(16);
		const againstTravel = new Float32Array(16);

		writePortDirectionInstanceMatrix(withTravel, 0, 2, 3, 4, 1, 0);
		writePortDirectionInstanceMatrix(againstTravel, 0, 2, 3, 4, -1, 0);

		expect(withTravel[0]).toBeCloseTo(1, 6);
		expect(withTravel[2]).toBeCloseTo(0, 6);
		expect(withTravel[12]).toBeGreaterThan(2);
		expect(againstTravel[0]).toBeCloseTo(-1, 6);
		expect(againstTravel[2]).toBeCloseTo(0, 6);
		expect(againstTravel[12]).toBeLessThan(2);
		expect(withTravel[14]).toBeCloseTo(againstTravel[14] as number, 6);
		expect(() => writePortDirectionInstanceMatrix(new Float32Array(16), 0, 0, 0, 0, 0, 0)).toThrow(
			RangeError,
		);
	});

	it("writes one port-derived shell recess and bounded internal slot in the same local frame", () => {
		const opening = new Float32Array(16);
		const slot = new Float32Array(16);

		writePortShellOpeningInstanceMatrix(opening, 0, 2, 1.45, 4, 0, 1, 0.2, 0.34, 0.36);
		writePortShellInternalSlotInstanceMatrix(slot, 0, 2, 1.35, 4, 0, 1, 0.2, 0.36);

		expect(opening[2]).toBeCloseTo(0.364, 6);
		expect(opening[5]).toBeCloseTo(0.68, 6);
		expect(opening[8]).toBeCloseTo(-0.72, 6);
		expect(opening[12]).toBeCloseTo(2, 6);
		expect(opening[13]).toBeCloseTo(1.45, 6);
		expect(opening[14]).toBeCloseTo(4, 6);
		expect(slot[2]).toBeCloseTo(0.38, 6);
		expect(slot[5]).toBeCloseTo(0.07, 6);
		expect(slot[8]).toBeCloseTo(-0.486, 6);
		expect(slot[13]).toBeCloseTo(1.35, 6);
	});

	it("writes a rail-tangent-aligned derived runtime vehicle matrix", () => {
		const expected = new THREE.Object3D();
		expected.position.set(8, 3.42, -6);
		expected.rotation.set(0, -Math.PI / 4, 0);
		expected.scale.set(0.68, 0.26, 0.34);
		expected.updateMatrix();
		const actual = new Float32Array(16);

		writeSimulationRuntimeVehicleMatrix(actual, 0, 8, 3.42, -6, Math.SQRT1_2, Math.SQRT1_2);

		expectMatrixClose(actual, expected.matrix.elements);
	});

	it("writes identical derived 3D poses for current and resident presentation profiles", () => {
		const currentMatrices = new Float32Array(4 * 16);
		const residentMatrices = new Float32Array(4 * 16);
		const current = runtimePresentation("current-3d-pose", false);
		const resident = runtimePresentation("resident-3d-pose", true);

		expect(
			writeSimulationRuntimeVehiclePresentationMatrices(currentMatrices, current, 3.22),
		).toEqual({
			count: 2,
			capacity: 4,
			poseFingerprint: "current-3d-pose",
		});
		expect(
			writeSimulationRuntimeVehiclePresentationMatrices(residentMatrices, resident, 3.22),
		).toEqual({
			count: 2,
			capacity: 4,
			poseFingerprint: "resident-3d-pose",
		});
		expect(residentMatrices).toEqual(currentMatrices);
	});

	it("rejects a malformed 3D pose prefix before changing any instance matrix", () => {
		const matrices = new Float32Array(4 * 16).fill(7);
		const presentation = runtimePresentation("malformed-3d-pose", true);
		presentation.publication.poseTangentX[1] = 0;
		presentation.publication.poseTangentZ[1] = 0;

		expect(
			writeSimulationRuntimeVehiclePresentationMatrices(matrices, presentation, 3.22),
		).toBeNull();
		expect([...matrices]).toEqual(new Array(4 * 16).fill(7));
	});

	it("raycasts the rotated body and rejects its empty broad-phase corner", () => {
		const mesh = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial(),
			1,
		);
		writeEquipmentBodyInstanceMatrix(
			mesh.instanceMatrix.array as Float32Array,
			0,
			0,
			0.5,
			0,
			Math.SQRT1_2,
			Math.SQRT1_2,
			2,
			1,
			0.4,
		);
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		mesh.updateMatrixWorld(true);
		const downward = new THREE.Vector3(0, -1, 0);

		expect(
			new THREE.Raycaster(new THREE.Vector3(0.5, 5, 0.5), downward)
				.intersectObject(mesh, false)
				.some((hit) => hit.instanceId === 0),
		).toBe(true);
		expect(
			new THREE.Raycaster(new THREE.Vector3(0.75, 5, -0.75), downward).intersectObject(mesh, false),
		).toHaveLength(0);
		mesh.geometry.dispose();
		(mesh.material as THREE.Material).dispose();
	});

	it("separates an instanced semantic proxy from the visual camera through Three layers", () => {
		const proxy = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial(),
			1,
		);
		proxy.setMatrixAt(0, new THREE.Matrix4().identity());
		proxy.instanceMatrix.needsUpdate = true;
		proxy.computeBoundingSphere();
		proxy.layers.set(1);
		proxy.updateMatrixWorld(true);
		const visualRaycaster = new THREE.Raycaster(
			new THREE.Vector3(0, 0, 2),
			new THREE.Vector3(0, 0, -1),
		);
		const semanticRaycaster = new THREE.Raycaster(
			new THREE.Vector3(0, 0, 2),
			new THREE.Vector3(0, 0, -1),
		);
		semanticRaycaster.layers.set(1);

		expect(visualRaycaster.intersectObject(proxy, false)).toHaveLength(0);
		expect(semanticRaycaster.intersectObject(proxy, false).length).toBeGreaterThan(0);
		proxy.geometry.dispose();
		(proxy.material as THREE.Material).dispose();
	});

	it("resolves an actual rotated side-ray hit through the shared body index", () => {
		const angle = 0.001;
		const tangentX = Math.cos(angle);
		const tangentZ = Math.sin(angle);
		const normalX = -tangentZ;
		const normalZ = tangentX;
		const halfLength = 1;
		const halfWidth = 0.2;
		const mesh = new THREE.InstancedMesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshBasicMaterial(),
			1,
		);
		writeEquipmentBodyInstanceMatrix(
			mesh.instanceMatrix.array as Float32Array,
			0,
			0,
			0.5,
			0,
			tangentX,
			tangentZ,
			halfLength * 2,
			1,
			halfWidth * 2,
		);
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		mesh.updateMatrixWorld(true);
		const hit = new THREE.Raycaster(
			new THREE.Vector3(normalX * 2, 0.5, normalZ * 2),
			new THREE.Vector3(-normalX, 0, -normalZ),
		).intersectObject(mesh, false)[0];
		expect(hit).toBeDefined();

		const extentX = Math.abs(tangentX) * halfLength + Math.abs(normalX) * halfWidth;
		const extentZ = Math.abs(tangentZ) * halfLength + Math.abs(normalZ) * halfWidth;
		const presentation = {
			count: 1,
			equipmentGroupCount: 1,
			portIds: Int32Array.of(1),
			equipmentGroupIds: Int32Array.of(1),
			worldPositions: Float32Array.of(0, 0),
			groupIds: Int32Array.of(1),
			groupKinds: Uint8Array.of(1),
			bodySectionCount: 1,
			bodySectionGroupRows: Uint32Array.of(0),
			bodySectionCenters: Float32Array.of(0, 0),
			bodySectionTangents: Float32Array.of(tangentX, tangentZ),
			bodySectionHalfExtents: Float32Array.of(halfLength, halfWidth),
			bodySectionBounds: Float32Array.of(-extentX, -extentZ, extentX, extentZ),
			portBodySectionRows: Uint32Array.of(0),
			bodySectionPortOffsets: Uint32Array.of(0, 1),
			bodySectionPortRows: Uint32Array.of(0),
		} as unknown as CompiledPortEquipmentPresentation;
		const selection = resolveStaticFabInspectionEquipmentBodyPick(
			new PortEquipmentSpatialIndex(presentation),
			hit?.point.x as number,
			hit?.point.z as number,
		);

		expect(selection).toEqual({ portId: 1, equipmentGroupId: 1 });
		mesh.geometry.dispose();
		(mesh.material as THREE.Material).dispose();
	});

	it.each([
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
		[Math.SQRT1_2, Math.SQRT1_2],
	] as const)("matches the former flow transform for tangent %s,%s", (tangentX, tangentZ) => {
		const expected = new THREE.Object3D();
		expected.position.set(7, 3, -4);
		expected.rotation.set(Math.PI / 2, 0, -Math.atan2(tangentZ, tangentX) - Math.PI / 2);
		expected.updateMatrix();
		const actual = new Float32Array(16);

		writeFlowInstanceMatrix(actual, 0, 7, 3, -4, tangentX, tangentZ);

		expectMatrixClose(actual, expected.matrix.elements);
	});

	it("resolves a multi-section body hit through the same explicit section mapping as 2D", () => {
		const hydrator = TileMap.createHydrator();
		for (let coordinate = 0; coordinate <= 7; coordinate++) {
			hydrator.addEncodedCell(coordinate, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
			hydrator.addEncodedCell(20, coordinate, encodeRailCell({ incoming: DIR_N, outgoing: DIR_S }));
		}
		const locations: readonly {
			readonly id: number;
			readonly x: number;
			readonly z: number;
			readonly from: Direction;
			readonly to: Direction;
		}[] = [
			{ id: 1, x: 1, z: 0, from: DIR_W, to: DIR_E },
			{ id: 2, x: 5, z: 0, from: DIR_W, to: DIR_E },
			{ id: 3, x: 20, z: 1, from: DIR_N, to: DIR_S },
			{ id: 4, x: 20, z: 5, from: DIR_N, to: DIR_S },
		];
		const state: PortEquipmentState = {
			nextPortId: 5,
			nextEquipmentGroupId: 2,
			ports: locations.map(({ id, x, z, from, to }) => ({
				id,
				equipmentGroupId: 1,
				route: { kind: "CARDINAL_CELL" as const, x, z, from, to },
				stationMillimeters: 500,
				side: "CENTER" as const,
				lateralOffsetMillimeters: 0,
				direction: "WITH_TRAVEL" as const,
				portType: "STK" as const,
				barcode: null,
			})),
			equipmentGroups: [{ id: 1, kind: "STK", template: "FLEX", portIds: [1, 2, 3, 4] }],
		};
		const presentation = compilePortEquipmentPresentation(
			compilePhysicalRail(hydrator.finish(16)),
			state,
		);
		const index = new PortEquipmentSpatialIndex(presentation);
		const point = { x: 20.5, z: 4.5 };

		expect(resolveStaticFabInspectionEquipmentBodyPick(index, point.x, point.z)).toEqual({
			portId: 4,
			equipmentGroupId: 1,
		});
		expect(index.groupAt(point.x, point.z)).toMatchObject({
			portId: 4,
			equipmentGroupId: 1,
		});
		expect(resolveStaticFabInspectionEquipmentBodyPick(index, Number.NaN, point.z)).toBeNull();
		const horizontal = staticFabInspectionPortBodySectionBounds(presentation, 1);
		const vertical = staticFabInspectionPortBodySectionBounds(presentation, 4);
		expect(horizontal?.sectionRow).not.toBe(vertical?.sectionRow);
		expect(horizontal?.bounds.maxX).toBeLessThan(10);
		expect(vertical?.bounds.minX).toBeGreaterThan(19);
		expect(staticFabInspectionPortBodySectionBounds(presentation, 99)).toBeNull();
	});

	it("uses the 2D area tie-break when same-height body sections overlap", () => {
		const presentation = {
			count: 2,
			equipmentGroupCount: 2,
			portIds: Int32Array.of(10, 20),
			equipmentGroupIds: Int32Array.of(10, 20),
			worldPositions: Float32Array.of(0, 0, 0, 0),
			groupIds: Int32Array.of(10, 20),
			groupKinds: Uint8Array.of(1, 1),
			bodySectionCount: 2,
			bodySectionGroupRows: Uint32Array.of(0, 1),
			bodySectionCenters: Float32Array.of(0, 0, 0, 0),
			bodySectionTangents: Float32Array.of(1, 0, 1, 0),
			bodySectionHalfExtents: Float32Array.of(1, 1, 0.5, 0.5),
			bodySectionBounds: Float32Array.of(-1, -1, 1, 1, -0.5, -0.5, 0.5, 0.5),
			portBodySectionRows: Uint32Array.of(0, 1),
			bodySectionPortOffsets: Uint32Array.of(0, 1, 2),
			bodySectionPortRows: Uint32Array.of(0, 1),
		} as unknown as CompiledPortEquipmentPresentation;
		const index = new PortEquipmentSpatialIndex(presentation);

		expect(resolveStaticFabInspectionEquipmentBodyPick(index, 0, 0)).toEqual({
			portId: 20,
			equipmentGroupId: 20,
		});
	});
});

function runtimePresentation(
	poseFingerprint: string,
	resident: boolean,
): SimulationRuntimePresentation {
	const common = {
		sequence: 1,
		maximumPoseCount: 4,
		publishedPoseCount: 2,
		poseWorldXMeters: Float64Array.of(8, -2),
		poseWorldZMeters: Float64Array.of(-6, 5),
		poseTangentX: Float64Array.of(Math.SQRT1_2, 0),
		poseTangentZ: Float64Array.of(Math.SQRT1_2, -1),
	};
	if (resident) {
		const publication = {
			...common,
			sourceAuthorizationFingerprint: "resident-3d-authorization",
			sourceCertificateFingerprint: "resident-3d-certificate",
		} as DeterministicResidentRuntimePublication;
		return {
			policy: RESIDENT_SIMULATION_RUNTIME_VIEW_POLICY,
			activeRunGeneration: 1,
			projectId: "PROJECT-RESIDENT-3D",
			sourceKind: "TRANSFER_PLAN",
			readinessProfileId: "OPENFAB_RESIDENT_HOME_RETURN_READINESS_V1",
			authorizationFingerprint: "resident-3d-authorization",
			certificateFingerprint: "resident-3d-certificate",
			poseFingerprint,
			publication,
		};
	}
	const publication = {
		...common,
		runIdentityFingerprint: "current-3d-run",
		resourceExecutionPrepared: true,
	} as DeterministicScenarioRuntimePublication;
	return {
		policy: LIVE_SIMULATION_RUNTIME_VIEW_POLICY,
		activeRunGeneration: 1,
		projectId: "PROJECT-CURRENT-3D",
		sourceKind: "TRANSFER_PLAN",
		readinessProfileId: "CURRENT-READINESS-V1",
		runIdentityFingerprint: "current-3d-run",
		poseFingerprint,
		publication,
	};
}

function expectMatrixClose(actual: Float32Array, expected: readonly number[]): void {
	expect(actual).toHaveLength(expected.length);
	for (let index = 0; index < actual.length; index++) {
		expect(actual[index]).toBeCloseTo(expected[index] as number, 6);
	}
}
