import { afterEach, describe, expect, it, vi } from "vitest";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { DIR_E, DIR_S, DIR_W, type Direction } from "../core/railShape";
import {
	STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS,
	type StaticFabAssemblyConnectorPlan,
	type StaticFabAssemblyGatewayCandidate,
} from "../core/StaticFabAssemblyConnector";
import { type Cell, TileMap } from "../core/TileMap";
import {
	STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT,
	type StaticFabAssemblyConnectorOverlay,
	TileRenderer,
	type TileRenderInput,
} from "./TileRenderer";

afterEach(() => vi.unstubAllGlobals());

describe("Static FAB Assembly Connector Canvas overlay", () => {
	it("reuses maximum-route world paths and gateway indexes across 120 camera frames", () => {
		installPath2D();
		const renderer = new TileRenderer();
		const map = new TileMap();
		const source = gateway("source", 0, 0, DIR_E, "x");
		const target = gateway("target", 0, 4, DIR_W, "x");
		const hovered = gateway("hovered", 8, 0, DIR_S, "y");
		const candidates = Array.from(
			{ length: STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT },
			(_, index) => gateway(`candidate-${index}`, 0, 0, DIR_E, "x"),
		);
		const plan = maximumRouteConnectorPlan(source, target);
		const overlay = connectorOverlay({
			phase: "ready",
			gateways: [...candidates, source, target, hovered],
			sourceGatewayId: source.id,
			targetGatewayId: target.id,
			hoveredGatewayId: hovered.id,
			plan,
		});
		const staticContext = recordingContext();
		const overlayContext = recordingContext();
		const input = renderInput(map, overlay);

		renderer.render(staticContext.context, overlayContext.context, input);
		for (let frame = 0; frame < 120; frame++) {
			renderer.render(staticContext.context, overlayContext.context, {
				...input,
				camera: {
					...input.camera,
					offsetX: input.camera.offsetX + (frame % 7),
					offsetY: input.camera.offsetY + (frame % 5),
					rotation: (frame % 4) as 0 | 1 | 2 | 3,
				},
			});
		}

		expect(renderer.getStats()).toMatchObject({
			physicalPathBindings: 1,
			staticFabAssemblyConnectorGatewayBindings: 1,
			staticFabAssemblyConnectorPlanBindings: 1,
			staticFabAssemblyConnectorRoutePathBuilds: 2,
			staticFabAssemblyConnectorRoutePathStrokes: 242,
			staticFabAssemblyConnectorRouteCellFallbackStrokes: 0,
			staticFabAssemblyConnectorVisibleGateways:
				STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT + 3,
		});
		expect(overlayContext.transforms).toEqual(
			expect.arrayContaining([
				[10, 0, 0, 10, 200, 160],
				[0, 10, -10, 0, 201, 161],
				[-10, 0, 0, -10, 202, 162],
				[0, -10, 10, 0, 203, 163],
			]),
		);
	});

	it("viewport-filters gateway bands before applying the 128 candidate cap", () => {
		installPath2D();
		const renderer = new TileRenderer();
		const staticContext = recordingContext();
		const firstOverlay = recordingContext();
		const map = new TileMap();
		const input = renderInput(map, null);

		renderer.render(staticContext.context, firstOverlay.context, input);
		expect(renderer.getStats()).toMatchObject({ staticRedraws: 1, overlayRedraws: 1 });

		const viewportFilteredOverlay = recordingContext();
		const offscreenGateways = Array.from(
			{ length: STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT },
			(_, index) => gateway(`offscreen-${index}`, 10_000 + index * 20, 10_000, DIR_E, "x"),
		);
		const visibleGateways = [
			gateway("visible-1", -8, 0, DIR_E, "x"),
			gateway("visible-2", 0, 0, DIR_E, "x"),
			gateway("visible-3", 8, 0, DIR_E, "x"),
		];
		renderer.render(staticContext.context, viewportFilteredOverlay.context, {
			...input,
			staticFabAssemblyConnectorOverlay: connectorOverlay({
				gateways: [...offscreenGateways, ...visibleGateways],
			}),
		});

		expect(viewportFilteredOverlay.arcRadii).toEqual([12, 12, 12]);
		expect(renderer.getStats()).toMatchObject({ staticRedraws: 1, overlayRedraws: 2 });

		const cappedOverlay = recordingContext();
		const cappedGateways = Array.from(
			{ length: STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT + 2 },
			(_, index) => gateway(`gateway-${index}`, 0, 0, DIR_E, "x"),
		);
		renderer.render(staticContext.context, cappedOverlay.context, {
			...input,
			staticFabAssemblyConnectorOverlay: connectorOverlay({ gateways: cappedGateways }),
		});

		expect(cappedOverlay.arcRadii).toHaveLength(
			STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT,
		);
		expect(cappedOverlay.arcRadii.every((radius) => radius === 12)).toBe(true);
		expect(renderer.getStats()).toMatchObject({ staticRedraws: 1, overlayRedraws: 3 });
	});

	it("keeps source, target, and hover gateways beyond the candidate cap without duplicate draws", () => {
		installPath2D();
		const map = new TileMap();
		const source = gateway("source", 0, 0, DIR_E, "x");
		const candidates = Array.from(
			{ length: STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT },
			(_, index) => gateway(`candidate-${index}`, 0, 0, DIR_E, "x"),
		);
		const target = gateway("target", 0, 4, DIR_W, "x");
		const hovered = gateway("hovered", 8, 0, DIR_S, "y");
		const overlayContext = recordingContext();

		new TileRenderer().render(recordingContext().context, overlayContext.context, {
			...renderInput(map, null),
			staticFabAssemblyConnectorOverlay: connectorOverlay({
				gateways: [...candidates, source, source, target, hovered],
				sourceGatewayId: source.id,
				targetGatewayId: target.id,
				hoveredGatewayId: hovered.id,
			}),
		});

		expect(overlayContext.arcRadii).toHaveLength(
			STATIC_FAB_ASSEMBLY_CONNECTOR_OVERLAY_GATEWAY_LIMIT + 3,
		);
		expect(overlayContext.labels).toEqual(
			expect.arrayContaining(["SOURCE · E", "TARGET · W", "12 m GATEWAY · S"]),
		);
		expect(overlayContext.labels.filter((label) => label === "SOURCE · E")).toHaveLength(1);
	});

	it("draws full gateway bands with source, target, hover, and travel direction cues", () => {
		installPath2D();
		const map = new TileMap();
		const source = gateway("source", 0, -4, DIR_E, "x");
		const target = gateway("target", 0, 4, DIR_W, "x");
		const hovered = gateway("hovered", 8, 0, DIR_S, "y");
		const overlayContext = recordingContext();

		new TileRenderer().render(recordingContext().context, overlayContext.context, {
			...renderInput(map, null),
			staticFabAssemblyConnectorOverlay: connectorOverlay({
				gateways: [source, target, hovered],
				sourceGatewayId: source.id,
				targetGatewayId: target.id,
				hoveredGatewayId: hovered.id,
			}),
		});

		expect(overlayContext.labels).toEqual(
			expect.arrayContaining(["SOURCE · E", "TARGET · W", "12 m GATEWAY · S"]),
		);
		expect(overlayContext.arcRadii).toEqual([14, 14, 14]);
		expect(overlayContext.strokes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ style: "#6fe5f0", width: 10 }),
				expect.objectContaining({ style: "#f1c66a", width: 10 }),
				expect.objectContaining({ style: "#8de3ea", width: 10 }),
			]),
		);
	});

	it("keeps valid and rejected outbound/return routes and conflict cells visible", () => {
		installPath2D();
		const map = new TileMap();
		const source = gateway("source", -4, 0, DIR_E, "x");
		const target = gateway("target", 4, 4, DIR_W, "x");
		const validPlan = connectorPlan(true, source, target);
		const validContext = recordingContext();

		new TileRenderer().render(recordingContext().context, validContext.context, {
			...renderInput(map, null),
			staticFabAssemblyConnectorOverlay: connectorOverlay({
				phase: "ready",
				gateways: [source, target],
				sourceGatewayId: source.id,
				targetGatewayId: target.id,
				plan: validPlan,
			}),
		});

		expect(validContext.labels).toEqual(
			expect.arrayContaining(["OUTBOUND", "RETURN", "CONNECTOR READY"]),
		);
		expect(validContext.strokes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ style: "#6fe5f0" }),
				expect.objectContaining({ style: "#f1c66a" }),
			]),
		);

		const rejectedPlan = connectorPlan(false, source, target);
		const rejectedContext = recordingContext();
		new TileRenderer().render(recordingContext().context, rejectedContext.context, {
			...renderInput(map, null),
			staticFabAssemblyConnectorOverlay: connectorOverlay({
				phase: "rejected",
				gateways: [source, target],
				sourceGatewayId: source.id,
				targetGatewayId: target.id,
				plan: rejectedPlan,
			}),
		});

		expect(rejectedContext.labels).toEqual(
			expect.arrayContaining(["OUTBOUND", "RETURN", "REJECTED · ROUTE_INVALID"]),
		);
		expect(rejectedContext.strokes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ style: "#ff6f80" }),
				expect.objectContaining({ style: "#ffad66" }),
			]),
		);
		expect(rejectedContext.fillRectStyles).toContain("rgba(255, 69, 82, 0.22)");
	});
});

function renderInput(
	map: TileMap,
	overlay: StaticFabAssemblyConnectorOverlay | null,
): TileRenderInput {
	return {
		map,
		physicalPaths: compilePhysicalRail(map).paths,
		ghost: null,
		staticFabAssemblyConnectorOverlay: overlay,
		camera: { offsetX: 200, offsetY: 160, zoom: 10, rotation: 0 },
		width: 400,
		height: 320,
		dpr: 1,
		hoverTile: null,
		hoverWorld: null,
		anchorTile: null,
		selectedTile: null,
	};
}

function connectorOverlay(
	values: Partial<StaticFabAssemblyConnectorOverlay> = {},
): StaticFabAssemblyConnectorOverlay {
	return {
		phase: "pick-source",
		gateways: [],
		sourceGatewayId: null,
		targetGatewayId: null,
		hoveredGatewayId: null,
		plan: null,
		...values,
	};
}

function gateway(
	id: string,
	x: number,
	y: number,
	forward: Direction,
	axis: "x" | "y",
): StaticFabAssemblyGatewayCandidate {
	const horizontal = axis === "x";
	const positive = forward === DIR_E || forward === DIR_S;
	const minimum = horizontal ? x - 6 : y - 6;
	const maximum = minimum + 12;
	const point = (coordinate: number): Cell =>
		horizontal ? { x: coordinate, y } : { x, y: coordinate };
	return {
		id,
		organizationId: id === "target" ? 2 : 1,
		anchor: { x, y },
		start: point(positive ? minimum : maximum),
		end: point(positive ? maximum : minimum),
		forward,
		axis,
		runLengthMeters: 12,
	};
}

function connectorPlan(
	valid: boolean,
	source: StaticFabAssemblyGatewayCandidate,
	target: StaticFabAssemblyGatewayCandidate,
): StaticFabAssemblyConnectorPlan {
	const outboundCells = Object.freeze([
		{ x: -4, y: 0 },
		{ x: -3, y: 0 },
		{ x: -2, y: 0 },
		{ x: -1, y: 0 },
		{ x: 0, y: 0 },
	]);
	const returnCells = Object.freeze([
		{ x: 4, y: 4 },
		{ x: 3, y: 4 },
		{ x: 2, y: 4 },
		{ x: 1, y: 4 },
		{ x: 0, y: 4 },
	]);
	return {
		kind: "build",
		baseRevision: 0,
		basePatchSequence: 0,
		cells: Object.freeze([...outboundCells, ...returnCells]),
		mutations: Object.freeze([]),
		switchMutations: Object.freeze([]),
		valid,
		reason: valid ? "Connector ready" : "Connector route conflicts",
		issueCode: valid ? null : "topology",
		conflicts: valid ? Object.freeze([]) : Object.freeze([{ x: 0, y: 0 }]),
		newEdges: 8,
		lengthMeters: 8,
		turns: 0,
		bend: "horizontal-first",
		networkLink: {
			version: 1,
			placementCode: valid ? "valid" : "physical",
			sourceAnchor: source.anchor,
			targetAnchor: target.anchor,
			sourceForward: source.forward,
			targetForward: target.forward,
			side: "right",
			junctionSpacingMeters: 4,
			sourceComponentCellCount: 24,
			targetComponentCellCount: 24,
			sourceDeparture: outboundCells[0] as Cell,
			sourceArrival: returnCells.at(-1) as Cell,
			targetArrival: outboundCells.at(-1) as Cell,
			targetDeparture: returnCells[0] as Cell,
			outboundCells,
			returnCells,
		},
		organizationImpactAuthorizations: Object.freeze([]),
		organizationMutations: Object.freeze([]),
		nextOrganizationIdBefore: 3,
		nextOrganizationIdAfter: 3,
		assemblyConnector: {
			version: 3,
			hierarchyRole: null,
			purpose: null,
			sourceOrganizationId: source.organizationId,
			sourceGatewayId: source.id,
			sourceAnchor: source.anchor,
			targetOrganizationId: target.organizationId,
			targetGatewayId: target.id,
			targetAnchor: target.anchor,
			requestedSide: "right",
			bankOrganizationId: null,
			fabOrganizationId: null,
			createdBank: false,
			createdFab: false,
			outboundLengthMeters: 4,
			returnLengthMeters: 4,
			issueCode: valid ? null : "ROUTE_INVALID",
		},
	};
}

function maximumRouteConnectorPlan(
	source: StaticFabAssemblyGatewayCandidate,
	target: StaticFabAssemblyGatewayCandidate,
): StaticFabAssemblyConnectorPlan {
	const base = connectorPlan(true, source, target);
	const outboundCells = Object.freeze(
		Array.from({ length: STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS + 1 }, (_, x) => ({
			x,
			y: 0,
		})),
	);
	const returnCells = Object.freeze(
		Array.from({ length: STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS + 1 }, (_, index) => ({
			x: STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS - index,
			y: 4,
		})),
	);
	return {
		...base,
		cells: Object.freeze([...outboundCells, ...returnCells]),
		newEdges: STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS * 2,
		lengthMeters: STATIC_FAB_ASSEMBLY_CONNECTOR_MAXIMUM_GAP_METERS * 2,
		networkLink: {
			...base.networkLink,
			sourceDeparture: outboundCells[0] as Cell,
			targetArrival: outboundCells.at(-1) as Cell,
			targetDeparture: returnCells[0] as Cell,
			sourceArrival: returnCells.at(-1) as Cell,
			outboundCells,
			returnCells,
		},
	};
}

function recordingContext(): {
	readonly context: CanvasRenderingContext2D;
	readonly labels: string[];
	readonly arcRadii: number[];
	readonly fillRectStyles: string[];
	readonly strokes: Array<{ style: string; width: number }>;
	readonly transforms: number[][];
} {
	const labels: string[] = [];
	const arcRadii: number[] = [];
	const fillRectStyles: string[] = [];
	const strokes: Array<{ style: string; width: number }> = [];
	const transforms: number[][] = [];
	const target: Record<PropertyKey, unknown> = {
		canvas: { width: 400, height: 320 },
		measureText: (value: string) => ({ width: value.length * 6 }),
		fillText: (value: string) => labels.push(value),
		arc: (_x: number, _y: number, radius: number) => arcRadii.push(radius),
		fillRect: () => fillRectStyles.push(String(target.fillStyle ?? "")),
		transform: (...values: number[]) => transforms.push(values),
		stroke: () =>
			strokes.push({
				style: String(target.strokeStyle ?? ""),
				width: Number(target.lineWidth ?? 1),
			}),
	};
	const noOp = (): void => undefined;
	return {
		context: new Proxy(target, {
			get(source, property) {
				return property in source ? source[property] : noOp;
			},
			set(source, property, value) {
				source[property] = value;
				return true;
			},
		}) as unknown as CanvasRenderingContext2D,
		labels,
		arcRadii,
		fillRectStyles,
		strokes,
		transforms,
	};
}

function installPath2D(): void {
	class TestPath2D {
		moveTo(): void {}
		lineTo(): void {}
		arc(): void {}
	}
	vi.stubGlobal("Path2D", TestPath2D);
}
