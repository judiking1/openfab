import {
	type CentralSpineFabAssemblyPlan,
	type CentralSpineFabPose,
	createCentralSpineFabAssemblyPlan,
} from "../compile/CentralSpineFabAssemblyPlan";
import {
	createFullFabAssemblyPlan,
	type FullFabAssemblyPlan,
} from "../compile/FullFabAssemblyPlan";
import {
	createPairedCirculationFabAssemblyPlan,
	type PairedCirculationFabAssemblyPlan,
	type PairedCirculationFabPose,
} from "../compile/PairedCirculationFabAssemblyPlan";
import {
	createParallelHallFabAssemblyPlan,
	type ParallelHallFabAssemblyPlan,
	type ParallelHallFabPose,
} from "../compile/ParallelHallFabAssemblyPlan";
import {
	createProductionFabAssemblyPlan,
	type ProductionFabAssemblyPlan,
	type ProductionFabBayPlacement,
} from "../compile/ProductionFabAssemblyPlan";
import {
	createSyntheticFabAssemblyPlan,
	type SyntheticFabAssemblyBayPlacement,
	type SyntheticFabAssemblyPlan,
} from "../compile/SyntheticFabAssemblyPlan";
import type { SyntheticFabLayoutLoop } from "../compile/SyntheticFabLayoutPlan";
import {
	normalizeSyntheticFabStarterRequest,
	type SyntheticFabStarterRequest,
} from "../compile/SyntheticFabStarter";
import type { SyntheticFabCardinalSide } from "../compile/SyntheticFabTopologySpec";
import { DIR_E, DIR_S, DIR_W } from "../core/railShape";

export interface SyntheticFabStarterSchematicBounds {
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/**
 * A bounded, presentation-only catalog sketch. It deliberately contains no authored cells,
 * route IDs, physical paths, or project snapshot data.
 */
export interface SyntheticFabStarterSchematic {
	readonly version: 5;
	readonly bounds: SyntheticFabStarterSchematicBounds;
	readonly railPathData: string;
	readonly connectorPathData: string;
	readonly zoneCount: number;
	readonly bayCount: number;
	readonly processRowCount: number;
	readonly processBankCount: number;
	readonly processBlockCount: number;
	readonly interbaySpineCount: number;
	readonly wallCircuitCount: number;
	readonly outerCirculationCount: number;
	readonly wallCircuitLinkCount: number;
	readonly outerGatewayCount: number;
	readonly planFingerprint: string | null;
	readonly semanticPathData: Readonly<{
		readonly outer: string;
		readonly wall: string;
		readonly spine: string;
		readonly process: string;
	}>;
	readonly gatewayMarkers: readonly Readonly<{
		readonly id: string;
		readonly side: SyntheticFabCardinalSide;
		readonly x: number;
		readonly y: number;
	}>[];
	readonly flowMarkers: readonly Readonly<{
		readonly id: string;
		readonly role: "outer" | "wall" | "spine";
		readonly x: number;
		readonly y: number;
		readonly angleDegrees: number;
	}>[];
}

const EMPTY_CONNECTORS = "";

export function syntheticFabStarterSchematic(
	request: SyntheticFabStarterRequest,
): SyntheticFabStarterSchematic | null {
	const normalized = normalizeSyntheticFabStarterRequest(request);
	const aisle = normalized.parameters.aisleLengthMeters;
	const lane = normalized.parameters.laneSpacingMeters;
	const bayCount = normalized.parameters.bayCount;
	const pitch = normalized.parameters.bayPitchMeters;
	const outerDepth = normalized.parameters.outerbayDepthMeters;

	switch (normalized.id) {
		case "blank":
			return null;
		case "bay-assembly": {
			const endMargin = 6;
			const loopGap = 8;
			const available = aisle - endMargin * 2 - loopGap;
			const firstSpan = Math.floor(available / 2);
			const secondX = endMargin + firstSpan + loopGap;
			const innerDepth = lane - 6;
			return schematic(
				[
					roundedRect(0, 0, aisle, lane),
					roundedRect(endMargin, 0, firstSpan, innerDepth),
					roundedRect(secondX, 0, available - firstSpan, innerDepth),
				].join(" "),
				EMPTY_CONNECTORS,
				aisle,
				lane,
				1,
				1,
			);
		}
		case "bay-bank": {
			const endMargin = 8;
			const collectorLength = endMargin * 2 + (bayCount - 1) * pitch + aisle;
			const paths = [roundedRect(0, 0, collectorLength, 16)];
			for (let index = 0; index < bayCount; index++) {
				const x = endMargin + index * pitch;
				const endGap = 6;
				const loopGap = 8;
				const available = aisle - endGap * 2 - loopGap;
				const firstSpan = Math.floor(available / 2);
				paths.push(roundedRect(x, -lane, aisle, lane));
				paths.push(roundedRect(x + endGap, -(lane - 6), firstSpan, lane - 6));
				paths.push(
					roundedRect(
						x + endGap + firstSpan + loopGap,
						-(lane - 6),
						available - firstSpan,
						lane - 6,
					),
				);
			}
			return schematic(paths.join(" "), EMPTY_CONNECTORS, collectorLength, lane + 16, 1, bayCount);
		}
		case "full-fab-52":
			return syntheticFabStarterSchematicFromFullFabPlan(
				createFullFabAssemblyPlan({
					bayCount,
					bayDepthMeters: aisle,
					bayFrontageMeters: lane,
					bayPitchMeters: pitch,
				}),
			);
		case "paired-circulation-fab-52":
			return syntheticFabStarterSchematicFromPairedCirculationPlan(
				createPairedCirculationFabAssemblyPlan({
					bayCount,
					bayDepthMeters: aisle,
					bayFrontageMeters: lane,
					bayPitchMeters: pitch,
				}),
			);
		case "central-spine-fab-24":
			return syntheticFabStarterSchematicFromCentralSpinePlan(
				createCentralSpineFabAssemblyPlan({
					bayCount,
					bayDepthMeters: aisle,
					bayFrontageMeters: lane,
					bayPitchMeters: pitch,
				}),
			);
		case "parallel-hall-fab-12":
			return syntheticFabStarterSchematicFromParallelHallPlan(
				createParallelHallFabAssemblyPlan({
					bayCount,
					bayDepthMeters: aisle,
					bayFrontageMeters: lane,
					bayPitchMeters: pitch,
				}),
			);
		case "production-fab-60":
			return syntheticFabStarterSchematicFromProductionPlan(
				createProductionFabAssemblyPlan({
					bayCount,
					bankCount: normalized.parameters.processBlockCount,
					bayPitchMeters: pitch,
				}),
			);
		case "single-loop":
			return schematic(roundedRect(0, 0, aisle, lane), EMPTY_CONNECTORS, aisle, lane, 1, 1);
		case "dual-loop":
			return schematic(
				`${roundedRect(0, 0, aisle, lane)} ${roundedRect(0, lane, aisle, lane)}`,
				EMPTY_CONNECTORS,
				aisle,
				lane * 2,
				1,
				2,
			);
		case "nested-bay": {
			const outerHeight = lane * 2;
			const inset = Math.max(2, Math.min(5, Math.floor(lane / 3)));
			return schematic(
				`${roundedRect(0, 0, aisle, outerHeight)} ${roundedRect(
					inset,
					inset,
					Math.max(8, aisle - inset * 2),
					Math.max(4, outerHeight - inset * 2),
				)}`,
				EMPTY_CONNECTORS,
				aisle,
				outerHeight,
				1,
				2,
			);
		}
		case "shift-bay": {
			const offset = Math.max(3, Math.round(lane / 2));
			return schematic(
				polyline(
					[
						[0, lane],
						[0, 0],
						[aisle, 0],
						[aisle, lane],
						[Math.round(aisle * 0.58), lane],
						[Math.round(aisle * 0.48), lane + offset],
						[0, lane + offset],
						[0, lane],
					],
					true,
				),
				EMPTY_CONNECTORS,
				aisle,
				lane + offset,
				1,
				1,
			);
		}
		case "duplicate-bays": {
			const gap = Math.max(6, pitch - aisle);
			const secondX = aisle + gap;
			return schematic(
				`${roundedRect(0, 0, aisle, lane)} ${roundedRect(secondX, 0, aisle, lane)}`,
				EMPTY_CONNECTORS,
				secondX + aisle,
				lane,
				2,
				2,
			);
		}
		case "interbay-row":
			return rowSchematic(bayCount, pitch, lane, false);
		case "fab-block":
			return fabBlockSchematic(bayCount, pitch, lane, outerDepth);
		case "complete-fab":
			return completeFabSchematic(bayCount, pitch, lane, outerDepth);
		case "large-fab-60":
			return syntheticFabStarterSchematicFromAssemblyPlan(
				createSyntheticFabAssemblyPlan(
					{
						processBlockCount: normalized.parameters.processBlockCount,
						totalBayCount: normalized.parameters.bayCount,
					},
					pitch,
				),
			);
	}
}

export function syntheticFabStarterSchematicFromPairedCirculationPlan(
	assembly: PairedCirculationFabAssemblyPlan,
): SyntheticFabStarterSchematic {
	const outerPaths = [assembly.outer.laneA, assembly.outer.laneB].map((loop) =>
		roundedRect(loop.origin.x, loop.origin.y, loop.lengthMeters, loop.depthMeters, 8),
	);
	const spinePaths = assembly.halls.map((hall) =>
		roundedRect(
			hall.interbay.origin.x,
			hall.interbay.origin.y,
			hall.interbay.lengthMeters,
			hall.interbay.depthMeters,
			4,
		),
	);
	const processPaths: string[] = [];
	for (const bank of assembly.banks) {
		for (const bay of bank.bays) {
			processPaths.push(
				orientedRectPath(bay.shellAnchor, bay.shellPose, bay.depthMeters, bay.frontageMeters, 4),
			);
			for (const loop of bay.processLoops) {
				processPaths.push(
					orientedRectPath(loop.anchor, loop.pose, loop.spanMeters, loop.depthMeters, 3),
				);
			}
		}
	}
	const bayGateways = assembly.banks.flatMap((bank) => bank.bays.map((bay) => bay.gateway));
	const allGateways = [...assembly.gateways, ...bayGateways];
	const turnbackPaths = assembly.outer.turnbacks.map((turnback) =>
		pairedConnector(
			[turnback.departure.cell.x, turnback.departure.cell.y],
			[turnback.arrival.cell.x, turnback.arrival.cell.y],
		),
	);
	const gatewayPaths = allGateways.map((gateway) =>
		pairedConnector(
			[gateway.sourceAnchor.x, gateway.sourceAnchor.y],
			[gateway.targetAnchor.x, gateway.targetAnchor.y],
		),
	);
	const processLoopCount = assembly.banks.reduce(
		(total, bank) =>
			total + bank.bays.reduce((bankTotal, bay) => bankTotal + bay.processLoops.length, 0),
		0,
	);
	return schematic(
		[...outerPaths, ...spinePaths, ...processPaths].join(" "),
		[...turnbackPaths, ...gatewayPaths].join(" "),
		assembly.outer.laneA.lengthMeters,
		assembly.outer.laneA.depthMeters,
		assembly.banks.length,
		assembly.profile.bayCount,
		assembly.outer.laneA.origin.x,
		assembly.outer.laneA.origin.y,
		{
			processRowCount: processLoopCount,
			processBankCount: assembly.banks.length,
			processBlockCount: assembly.halls.length,
			interbaySpineCount: assembly.halls.length,
			outerCirculationCount: 2,
			wallCircuitLinkCount: assembly.gateways.length,
			outerGatewayCount: assembly.gateways.length,
			planFingerprint: assembly.planFingerprint,
			semanticPathData: Object.freeze({
				outer: outerPaths.join(" "),
				wall: "",
				spine: spinePaths.join(" "),
				process: processPaths.join(" "),
			}),
			gatewayMarkers: Object.freeze(
				assembly.gateways.map((gateway) =>
					Object.freeze({
						id: gateway.id,
						side:
							gateway.sourceAnchor.x < assembly.outer.laneA.lengthMeters / 2
								? ("west" as const)
								: ("east" as const),
						x: (gateway.sourceAnchor.x + gateway.targetAnchor.x) / 2,
						y: (gateway.sourceAnchor.y + gateway.targetAnchor.y) / 2,
					}),
				),
			),
			flowMarkers: Object.freeze([
				Object.freeze({
					id: assembly.outer.laneA.id,
					role: "outer" as const,
					x: assembly.outer.laneA.origin.x + assembly.outer.laneA.lengthMeters / 2,
					y: assembly.outer.laneA.origin.y,
					angleDegrees: 0,
				}),
				Object.freeze({
					id: assembly.outer.laneB.id,
					role: "outer" as const,
					x: assembly.outer.laneB.origin.x + assembly.outer.laneB.lengthMeters / 2,
					y: assembly.outer.laneB.origin.y,
					angleDegrees: 180,
				}),
				...assembly.halls.map((hall) =>
					Object.freeze({
						id: hall.interbay.id,
						role: "spine" as const,
						x: hall.interbay.origin.x + hall.interbay.lengthMeters / 2,
						y: hall.interbay.origin.y,
						angleDegrees: 0,
					}),
				),
			]),
		},
	);
}

export function syntheticFabStarterSchematicFromFullFabPlan(
	assembly: FullFabAssemblyPlan,
): SyntheticFabStarterSchematic {
	const outerPath = roundedRect(
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		8,
	);
	const spinePaths = assembly.halls.map((hall) =>
		roundedRect(
			hall.interbaySpine.origin.x,
			hall.interbaySpine.origin.y,
			hall.interbaySpine.lengthMeters,
			hall.interbaySpine.depthMeters,
			4,
		),
	);
	const processPaths: string[] = [];
	for (const bank of assembly.banks) {
		processPaths.push(
			roundedRect(
				bank.collector.origin.x,
				bank.collector.origin.y,
				bank.collector.lengthMeters,
				bank.collector.depthMeters,
				4,
			),
		);
		for (const bay of bank.bays) {
			processPaths.push(
				orientedRectPath(bay.anchor, bay.pose, bay.frontageMeters, bay.depthMeters, 4),
			);
			for (const loop of bay.processLoops) {
				processPaths.push(
					orientedRectPath(loop.anchor, loop.pose, loop.frontageMeters, loop.depthMeters, 3),
				);
			}
		}
	}
	const connectorPaths = assembly.gateways.map((gateway) =>
		pairedConnector(
			[gateway.sourceAnchor.x, gateway.sourceAnchor.y],
			[gateway.targetAnchor.x, gateway.targetAnchor.y],
		),
	);
	const outerGateways = assembly.gateways.filter((gateway) => gateway.ownerId === "FULL-FAB");
	return schematic(
		[outerPath, ...spinePaths, ...processPaths].join(" "),
		connectorPaths.join(" "),
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		assembly.banks.length,
		assembly.profile.bayCount,
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		{
			processRowCount: assembly.profile.bayCount * 2,
			processBankCount: assembly.banks.length,
			processBlockCount: assembly.halls.length,
			interbaySpineCount: assembly.halls.length,
			outerCirculationCount: 1,
			wallCircuitLinkCount: assembly.gateways.length,
			outerGatewayCount: outerGateways.length,
			planFingerprint: assembly.planFingerprint,
			semanticPathData: Object.freeze({
				outer: outerPath,
				wall: "",
				spine: spinePaths.join(" "),
				process: processPaths.join(" "),
			}),
			gatewayMarkers: Object.freeze(
				outerGateways.map((gateway, index) =>
					Object.freeze({
						id: gateway.id,
						side: index % 2 === 0 ? ("west" as const) : ("east" as const),
						x: (gateway.sourceAnchor.x + gateway.targetAnchor.x) / 2,
						y: (gateway.sourceAnchor.y + gateway.targetAnchor.y) / 2,
					}),
				),
			),
			flowMarkers: Object.freeze([
				Object.freeze({
					id: assembly.outer.id,
					role: "outer" as const,
					x: assembly.outer.origin.x + assembly.outer.lengthMeters / 2,
					y: assembly.outer.origin.y,
					angleDegrees: 0,
				}),
				...assembly.halls.map((hall) =>
					Object.freeze({
						id: hall.interbaySpine.id,
						role: "spine" as const,
						x: hall.interbaySpine.origin.x + hall.interbaySpine.lengthMeters / 2,
						y: hall.interbaySpine.origin.y,
						angleDegrees: 0,
					}),
				),
			]),
		},
	);
}

export function syntheticFabStarterSchematicFromParallelHallPlan(
	assembly: ParallelHallFabAssemblyPlan,
): SyntheticFabStarterSchematic {
	const outerPath = roundedRect(
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		8,
	);
	const spinePath = roundedRect(
		assembly.interbaySpine.origin.x,
		assembly.interbaySpine.origin.y,
		assembly.interbaySpine.lengthMeters,
		assembly.interbaySpine.depthMeters,
		4,
	);
	const processPaths: string[] = [];
	for (const bank of assembly.banks) {
		processPaths.push(
			roundedRect(
				bank.collector.origin.x,
				bank.collector.origin.y,
				bank.collector.lengthMeters,
				bank.collector.depthMeters,
				4,
			),
		);
		for (const bay of bank.bays) {
			processPaths.push(
				orientedRectPath(bay.anchor, bay.pose, bay.frontageMeters, bay.depthMeters, 4),
			);
			for (const loop of bay.processLoops) {
				processPaths.push(
					orientedRectPath(loop.anchor, loop.pose, loop.frontageMeters, loop.depthMeters, 3),
				);
			}
		}
	}
	const connectorPaths = assembly.gateways.map((gateway) =>
		pairedConnector(
			[gateway.sourceAnchor.x, gateway.sourceAnchor.y],
			[gateway.targetAnchor.x, gateway.targetAnchor.y],
		),
	);
	return schematic(
		[outerPath, spinePath, ...processPaths].join(" "),
		connectorPaths.join(" "),
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		assembly.banks.length,
		assembly.profile.bayCount,
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		{
			processRowCount: assembly.profile.bayCount * 2,
			processBankCount: assembly.banks.length,
			processBlockCount: 1,
			interbaySpineCount: 1,
			outerCirculationCount: 1,
			wallCircuitLinkCount: assembly.gateways.length,
			outerGatewayCount: 2,
			planFingerprint: assembly.planFingerprint,
			semanticPathData: Object.freeze({
				outer: outerPath,
				wall: "",
				spine: spinePath,
				process: processPaths.join(" "),
			}),
			gatewayMarkers: Object.freeze(
				assembly.gateways.slice(0, 2).map((gateway, index) =>
					Object.freeze({
						id: gateway.id,
						side: index === 0 ? ("west" as const) : ("east" as const),
						x: (gateway.sourceAnchor.x + gateway.targetAnchor.x) / 2,
						y: (gateway.sourceAnchor.y + gateway.targetAnchor.y) / 2,
					}),
				),
			),
			flowMarkers: Object.freeze([
				Object.freeze({
					id: assembly.outer.id,
					role: "outer" as const,
					x: assembly.outer.origin.x + assembly.outer.lengthMeters / 2,
					y: assembly.outer.origin.y,
					angleDegrees: 0,
				}),
				Object.freeze({
					id: assembly.interbaySpine.id,
					role: "spine" as const,
					x: assembly.interbaySpine.origin.x + assembly.interbaySpine.lengthMeters / 2,
					y: assembly.interbaySpine.origin.y,
					angleDegrees: 0,
				}),
			]),
		},
	);
}

export function syntheticFabStarterSchematicFromCentralSpinePlan(
	assembly: CentralSpineFabAssemblyPlan,
): SyntheticFabStarterSchematic {
	const outerPath = roundedRect(
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		8,
	);
	const spinePath = roundedRect(
		assembly.interbaySpine.origin.x,
		assembly.interbaySpine.origin.y,
		assembly.interbaySpine.lengthMeters,
		assembly.interbaySpine.depthMeters,
		4,
	);
	const processPaths: string[] = [];
	for (const bank of assembly.banks) {
		for (const bay of bank.bays) {
			processPaths.push(
				orientedRectPath(bay.anchor, bay.pose, bay.frontageMeters, bay.depthMeters, 4),
			);
			for (const loop of bay.processLoops) {
				processPaths.push(
					orientedRectPath(loop.anchor, loop.pose, loop.frontageMeters, loop.depthMeters, 3),
				);
			}
		}
	}
	return schematic(
		[outerPath, spinePath, ...processPaths].join(" "),
		EMPTY_CONNECTORS,
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		assembly.banks.length,
		assembly.profile.bayCount,
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		{
			processRowCount: assembly.profile.bayCount * 2,
			processBankCount: assembly.banks.length,
			processBlockCount: 1,
			interbaySpineCount: 1,
			outerCirculationCount: 1,
			planFingerprint: assembly.planFingerprint,
			semanticPathData: Object.freeze({
				outer: outerPath,
				wall: "",
				spine: spinePath,
				process: processPaths.join(" "),
			}),
			flowMarkers: Object.freeze([
				Object.freeze({
					id: assembly.outer.id,
					role: "outer" as const,
					x: assembly.outer.origin.x + assembly.outer.lengthMeters / 2,
					y: assembly.outer.origin.y,
					angleDegrees: 0,
				}),
				Object.freeze({
					id: assembly.interbaySpine.id,
					role: "spine" as const,
					x: assembly.interbaySpine.origin.x + assembly.interbaySpine.lengthMeters / 2,
					y: assembly.interbaySpine.origin.y,
					angleDegrees: 0,
				}),
			]),
		},
	);
}

function orientedRectPath(
	anchor: Readonly<{ x: number; y: number }>,
	pose: CentralSpineFabPose | ParallelHallFabPose | PairedCirculationFabPose,
	lengthMeters: number,
	depthMeters: number,
	radius: number,
): string {
	const forward =
		pose.forward === DIR_E
			? { x: 1, y: 0 }
			: pose.forward === DIR_W
				? { x: -1, y: 0 }
				: pose.forward === DIR_S
					? { x: 0, y: 1 }
					: { x: 0, y: -1 };
	const right = { x: -forward.y, y: forward.x };
	const lateral = pose.side === "right" ? right : { x: -right.x, y: -right.y };
	const end = {
		x: anchor.x + forward.x * lengthMeters + lateral.x * depthMeters,
		y: anchor.y + forward.y * lengthMeters + lateral.y * depthMeters,
	};
	return roundedRect(
		Math.min(anchor.x, end.x),
		Math.min(anchor.y, end.y),
		Math.abs(end.x - anchor.x),
		Math.abs(end.y - anchor.y),
		radius,
	);
}

export function syntheticFabStarterSchematicFromProductionPlan(
	assembly: ProductionFabAssemblyPlan,
): SyntheticFabStarterSchematic {
	const outerPath = roundedRect(
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		8,
	);
	const spinePath = roundedRect(
		assembly.interbaySpine.origin.x,
		assembly.interbaySpine.origin.y,
		assembly.interbaySpine.lengthMeters,
		assembly.interbaySpine.depthMeters,
		4,
	);
	const processPaths: string[] = [];
	for (const bank of assembly.banks) {
		processPaths.push(
			roundedRect(
				bank.collector.origin.x,
				bank.collector.origin.y,
				bank.collector.depthMeters,
				bank.collector.lengthMeters,
				4,
			),
		);
		for (const bay of bank.bays) processPaths.push(...productionBayPaths(bay));
	}
	return schematic(
		[outerPath, spinePath, ...processPaths].join(" "),
		EMPTY_CONNECTORS,
		assembly.outer.lengthMeters,
		assembly.outer.depthMeters,
		assembly.banks.length,
		assembly.profile.bayCount,
		assembly.outer.origin.x,
		assembly.outer.origin.y,
		{
			processRowCount: assembly.profile.bayCount * 2,
			processBankCount: assembly.banks.length,
			processBlockCount: 1,
			interbaySpineCount: 1,
			outerCirculationCount: 1,
			planFingerprint: assembly.planFingerprint,
			semanticPathData: Object.freeze({
				outer: outerPath,
				wall: "",
				spine: spinePath,
				process: processPaths.join(" "),
			}),
			flowMarkers: Object.freeze([
				Object.freeze({
					id: assembly.outer.id,
					role: "outer" as const,
					x: assembly.outer.origin.x + assembly.outer.lengthMeters / 2,
					y: assembly.outer.origin.y,
					angleDegrees: 0,
				}),
				Object.freeze({
					id: assembly.interbaySpine.id,
					role: "spine" as const,
					x: assembly.interbaySpine.origin.x + assembly.interbaySpine.lengthMeters,
					y: assembly.interbaySpine.origin.y + assembly.interbaySpine.depthMeters / 2,
					angleDegrees: 90,
				}),
			]),
		},
	);
}

function productionBayPaths(bay: ProductionFabBayPlacement): readonly string[] {
	const forward =
		bay.pose.forward === DIR_E
			? { x: 1, y: 0 }
			: bay.pose.forward === DIR_W
				? { x: -1, y: 0 }
				: bay.pose.forward === DIR_S
					? { x: 0, y: 1 }
					: { x: 0, y: -1 };
	const right = { x: -forward.y, y: forward.x };
	const lateral = bay.pose.side === "right" ? right : { x: -right.x, y: -right.y };
	const end = {
		x: bay.anchor.x + forward.x * bay.lengthMeters + lateral.x * bay.depthMeters,
		y: bay.anchor.y + forward.y * bay.lengthMeters + lateral.y * bay.depthMeters,
	};
	const minX = Math.min(bay.anchor.x, end.x);
	const minY = Math.min(bay.anchor.y, end.y);
	const width = Math.abs(end.x - bay.anchor.x);
	const height = Math.abs(end.y - bay.anchor.y);
	const endMargin = 6;
	const loopGap = 8;
	const available = bay.lengthMeters - endMargin * 2 - loopGap;
	const firstSpan = Math.floor(available / 2);
	const secondSpan = available - firstSpan;
	return Object.freeze([
		roundedRect(minX, minY, width, height, 4),
		productionBayInnerLoopPath(bay, endMargin, firstSpan),
		productionBayInnerLoopPath(bay, endMargin + firstSpan + loopGap, secondSpan),
	]);
}

function productionBayInnerLoopPath(
	bay: ProductionFabBayPlacement,
	forwardOffset: number,
	spanMeters: number,
): string {
	const forward = bay.pose.forward === DIR_E ? { x: 1, y: 0 } : { x: -1, y: 0 };
	const right = { x: -forward.y, y: forward.x };
	const lateral = bay.pose.side === "right" ? right : { x: -right.x, y: -right.y };
	const anchor = {
		x: bay.anchor.x + forward.x * forwardOffset,
		y: bay.anchor.y + forward.y * forwardOffset,
	};
	const end = {
		x: anchor.x + forward.x * spanMeters + lateral.x * (bay.depthMeters - 6),
		y: anchor.y + forward.y * spanMeters + lateral.y * (bay.depthMeters - 6),
	};
	return roundedRect(
		Math.min(anchor.x, end.x),
		Math.min(anchor.y, end.y),
		Math.abs(end.x - anchor.x),
		Math.abs(end.y - anchor.y),
		3,
	);
}

function rowSchematic(
	bayCount: number,
	pitch: number,
	lane: number,
	withOuterLoop: boolean,
): SyntheticFabStarterSchematic {
	const bayWidth = Math.max(10, Math.round(pitch * 0.72));
	const gap = Math.max(4, pitch - bayWidth);
	const bayHeight = Math.max(8, lane);
	const rowWidth = bayCount * bayWidth + Math.max(0, bayCount - 1) * gap;
	const railPaths: string[] = [];
	for (let index = 0; index < bayCount; index += 1) {
		railPaths.push(roundedRect(index * (bayWidth + gap), 0, bayWidth, bayHeight));
	}
	const spineY = bayHeight + 5;
	const connectors = [
		polyline([
			[0, spineY],
			[rowWidth, spineY],
		]),
	];
	for (let index = 0; index < bayCount; index += 1) {
		const centerX = index * (bayWidth + gap) + bayWidth / 2;
		connectors.push(
			polyline([
				[centerX, bayHeight],
				[centerX, spineY],
			]),
		);
	}
	if (withOuterLoop) {
		railPaths.push(roundedRect(-5, -5, rowWidth + 10, bayHeight + 18));
	}
	return schematic(
		railPaths.join(" "),
		connectors.join(" "),
		rowWidth + (withOuterLoop ? 10 : 0),
		bayHeight + (withOuterLoop ? 18 : 5),
		1,
		bayCount,
		withOuterLoop ? -5 : 0,
		withOuterLoop ? -5 : 0,
	);
}

function fabBlockSchematic(
	bayCount: number,
	pitch: number,
	lane: number,
	outerDepth: number,
): SyntheticFabStarterSchematic {
	const row = rowSchematic(bayCount, pitch, lane, false);
	const innerWidth = row.bounds.maxX - row.bounds.minX;
	const outerInset = Math.max(5, Math.round(outerDepth / 5));
	const outerHeight = lane + Math.max(14, Math.round(outerDepth / 2));
	return schematic(
		`${roundedRect(0, 0, innerWidth + outerInset * 2, outerHeight)} ${translatedPath(
			row.railPathData,
			outerInset,
			5,
		)}`,
		translatedPath(row.connectorPathData, outerInset, 5),
		innerWidth + outerInset * 2,
		outerHeight,
		1,
		bayCount,
	);
}

function completeFabSchematic(
	bayCount: number,
	pitch: number,
	lane: number,
	outerDepth: number,
): SyntheticFabStarterSchematic {
	const block = fabBlockSchematic(bayCount, pitch, lane, outerDepth);
	const blockWidth = block.bounds.maxX - block.bounds.minX;
	const blockHeight = block.bounds.maxY - block.bounds.minY;
	const gap = Math.max(12, Math.round(pitch * 0.75));
	const rails: string[] = [];
	const connectors: string[] = [];
	for (let index = 0; index < 3; index += 1) {
		const offsetX = index * (blockWidth + gap);
		rails.push(translatedPath(block.railPathData, offsetX, 0));
		connectors.push(translatedPath(block.connectorPathData, offsetX, 0));
		if (index > 0) {
			const previousEnd = offsetX - gap;
			connectors.push(
				polyline([
					[previousEnd, blockHeight * 0.42],
					[offsetX, blockHeight * 0.42],
				]),
				polyline([
					[offsetX, blockHeight * 0.65],
					[previousEnd, blockHeight * 0.65],
				]),
			);
		}
	}
	return schematic(
		rails.join(" "),
		connectors.join(" "),
		blockWidth * 3 + gap * 2,
		blockHeight,
		3,
		bayCount * 3,
	);
}

export function syntheticFabStarterSchematicFromAssemblyPlan(
	assembly: SyntheticFabAssemblyPlan,
): SyntheticFabStarterSchematic {
	const { layout, topology } = assembly;
	const rails: string[] = [];
	const connectors: string[] = [];
	const semanticPaths = {
		outer: [] as string[],
		wall: [] as string[],
		spine: [] as string[],
		process: [] as string[],
	};
	const gatewayMarkers: Array<{
		id: string;
		side: SyntheticFabCardinalSide;
		x: number;
		y: number;
	}> = [];
	const flowMarkers: Array<{
		id: string;
		role: "outer" | "wall" | "spine";
		x: number;
		y: number;
		angleDegrees: number;
	}> = [];
	const loops = new Map<string, SyntheticFabLayoutLoop>();
	for (const operation of assembly.operations) {
		if (operation.kind === "circuit") {
			loops.set(operation.id, operation.loop);
			const radius =
				operation.role === "outer-circulation" ? 5 : operation.role === "wall-circuit" ? 4 : 3;
			const pathData = loopPath(operation.loop, radius);
			rails.push(pathData);
			const role =
				operation.role === "outer-circulation"
					? "outer"
					: operation.role === "wall-circuit"
						? "wall"
						: "spine";
			semanticPaths[role].push(pathData);
			flowMarkers.push({
				id: operation.id,
				role,
				x: operation.loop.origin.x + operation.loop.lengthMeters / 2,
				y: operation.loop.origin.y,
				angleDegrees: operation.loop.flow === "forward" ? 0 : 180,
			});
			continue;
		}
		if (operation.kind === "process-trunk") {
			const sourceLoop = requiredSchematicLoop(loops, operation.sourceId);
			const targetLoop = requiredSchematicLoop(loops, operation.targetId);
			const sourcePoint = loopSidePointAt(sourceLoop, operation.sourceSide, operation.center);
			const targetPoint = loopSidePointAt(targetLoop, operation.targetSide, operation.center);
			const trunkPath = pairedConnector(sourcePoint, targetPoint);
			connectors.push(trunkPath);
			semanticPaths.process.push(trunkPath);
			for (const placement of operation.bayPlacements) {
				const bayPath = bayPlacementPath(placement);
				rails.push(bayPath);
				semanticPaths.process.push(bayPath);
			}
			continue;
		}
		const sourceLoop = requiredSchematicLoop(loops, operation.sourceId);
		const targetLoop = requiredSchematicLoop(loops, operation.targetId);
		const sourcePoint = loopSidePointAt(sourceLoop, operation.sourceSide, operation.center);
		const targetPoint = loopSidePointAt(targetLoop, operation.targetSide, operation.center);
		connectors.push(pairedConnector(sourcePoint, targetPoint));
		if (operation.role === "wall-outer") {
			gatewayMarkers.push({
				id: operation.id,
				side: operation.targetSide,
				x: (sourcePoint[0] + targetPoint[0]) / 2,
				y: (sourcePoint[1] + targetPoint[1]) / 2,
			});
		}
	}
	return schematic(
		rails.join(" "),
		connectors.join(" "),
		layout.outer.lengthMeters,
		layout.outer.depthMeters,
		topology.wings.length,
		topology.wings.reduce((total, wing) => total + wing.bayCount, 0),
		layout.outer.origin.x,
		layout.outer.origin.y,
		{
			processRowCount: layout.rows.length,
			processBankCount: layout.banks.length,
			processBlockCount: layout.blocks.length,
			interbaySpineCount: 1,
			wallCircuitCount: 1,
			outerCirculationCount: 1,
			wallCircuitLinkCount:
				topology.wings.length + topology.spineWallLinks.length + topology.wallOuterLinks.length,
			outerGatewayCount: topology.wallOuterLinks.length,
			planFingerprint: assembly.planFingerprint,
			semanticPathData: Object.freeze({
				outer: semanticPaths.outer.join(" "),
				wall: semanticPaths.wall.join(" "),
				spine: semanticPaths.spine.join(" "),
				process: semanticPaths.process.join(" "),
			}),
			gatewayMarkers: Object.freeze(gatewayMarkers.map((marker) => Object.freeze(marker))),
			flowMarkers: Object.freeze(flowMarkers.map((marker) => Object.freeze(marker))),
		},
	);
}

function bayPlacementPath(placement: SyntheticFabAssemblyBayPlacement): string {
	const { anchor, pose, parameters } = placement;
	const forward =
		pose.forward === DIR_E
			? { x: 1, y: 0 }
			: pose.forward === DIR_W
				? { x: -1, y: 0 }
				: pose.forward === DIR_S
					? { x: 0, y: 1 }
					: { x: 0, y: -1 };
	const left = { x: forward.y, y: -forward.x };
	const lateral = pose.side === "left" ? left : { x: -left.x, y: -left.y };
	const points = [
		anchor,
		{
			x: anchor.x + lateral.x * parameters.offsetMeters,
			y: anchor.y + lateral.y * parameters.offsetMeters,
		},
		{
			x: anchor.x + lateral.x * parameters.offsetMeters + forward.x * parameters.trunkSpanMeters,
			y: anchor.y + lateral.y * parameters.offsetMeters + forward.y * parameters.trunkSpanMeters,
		},
		{
			x: anchor.x + forward.x * parameters.trunkSpanMeters,
			y: anchor.y + forward.y * parameters.trunkSpanMeters,
		},
	];
	const minX = Math.min(...points.map((point) => point.x));
	const minY = Math.min(...points.map((point) => point.y));
	const maxX = Math.max(...points.map((point) => point.x));
	const maxY = Math.max(...points.map((point) => point.y));
	return roundedRect(minX, minY, maxX - minX, maxY - minY, 1);
}

function loopPath(loop: SyntheticFabLayoutLoop, radius: number): string {
	return roundedRect(loop.origin.x, loop.origin.y, loop.lengthMeters, loop.depthMeters, radius);
}

function requiredSchematicLoop(
	loops: ReadonlyMap<string, SyntheticFabLayoutLoop>,
	loopId: string,
): SyntheticFabLayoutLoop {
	const loop = loops.get(loopId);
	if (!loop) throw new Error(`Synthetic FAB schematic is missing loop ${loopId}.`);
	return loop;
}

function loopSidePointAt(
	loop: SyntheticFabLayoutLoop,
	side: SyntheticFabCardinalSide,
	center: number,
): readonly [number, number] {
	switch (side) {
		case "north":
			return Object.freeze([center, loop.origin.y]);
		case "east":
			return Object.freeze([loop.origin.x + loop.lengthMeters, center]);
		case "south":
			return Object.freeze([center, loop.origin.y + loop.depthMeters]);
		case "west":
			return Object.freeze([loop.origin.x, center]);
	}
}

function pairedConnector(
	source: readonly [number, number],
	target: readonly [number, number],
): string {
	const offset = 0.8;
	if (Math.abs(source[0] - target[0]) <= 0.001) {
		return `${polyline([
			[source[0] - offset, source[1]],
			[target[0] - offset, target[1]],
		])} ${polyline([
			[target[0] + offset, target[1]],
			[source[0] + offset, source[1]],
		])}`;
	}
	return `${polyline([
		[source[0], source[1] - offset],
		[target[0], target[1] - offset],
	])} ${polyline([
		[target[0], target[1] + offset],
		[source[0], source[1] + offset],
	])}`;
}

function schematic(
	railPathData: string,
	connectorPathData: string,
	width: number,
	height: number,
	zoneCount: number,
	bayCount: number,
	minX = 0,
	minY = 0,
	semantics: Readonly<{
		processRowCount?: number;
		processBankCount?: number;
		processBlockCount?: number;
		interbaySpineCount?: number;
		wallCircuitCount?: number;
		outerCirculationCount?: number;
		wallCircuitLinkCount?: number;
		outerGatewayCount?: number;
		planFingerprint?: string;
		semanticPathData?: SyntheticFabStarterSchematic["semanticPathData"];
		gatewayMarkers?: SyntheticFabStarterSchematic["gatewayMarkers"];
		flowMarkers?: SyntheticFabStarterSchematic["flowMarkers"];
	}> = {},
): SyntheticFabStarterSchematic {
	return Object.freeze({
		version: 5,
		bounds: Object.freeze({
			minX,
			minY,
			maxX: minX + Math.max(1, width),
			maxY: minY + Math.max(1, height),
		}),
		railPathData,
		connectorPathData,
		zoneCount,
		bayCount,
		processRowCount: semantics.processRowCount ?? 0,
		processBankCount: semantics.processBankCount ?? 0,
		processBlockCount: semantics.processBlockCount ?? 0,
		interbaySpineCount: semantics.interbaySpineCount ?? 0,
		wallCircuitCount: semantics.wallCircuitCount ?? 0,
		outerCirculationCount: semantics.outerCirculationCount ?? 0,
		wallCircuitLinkCount: semantics.wallCircuitLinkCount ?? 0,
		outerGatewayCount: semantics.outerGatewayCount ?? 0,
		planFingerprint: semantics.planFingerprint ?? null,
		semanticPathData:
			semantics.semanticPathData ??
			Object.freeze({ outer: "", wall: "", spine: "", process: railPathData }),
		gatewayMarkers: semantics.gatewayMarkers ?? Object.freeze([]),
		flowMarkers: semantics.flowMarkers ?? Object.freeze([]),
	});
}

function roundedRect(
	x: number,
	y: number,
	width: number,
	height: number,
	radius = Math.min(3, width / 4, height / 4),
): string {
	const r = Math.max(0.5, Math.min(radius, width / 2, height / 2));
	return [
		`M ${format(x + r)} ${format(y)}`,
		`H ${format(x + width - r)}`,
		`Q ${format(x + width)} ${format(y)} ${format(x + width)} ${format(y + r)}`,
		`V ${format(y + height - r)}`,
		`Q ${format(x + width)} ${format(y + height)} ${format(x + width - r)} ${format(y + height)}`,
		`H ${format(x + r)}`,
		`Q ${format(x)} ${format(y + height)} ${format(x)} ${format(y + height - r)}`,
		`V ${format(y + r)}`,
		`Q ${format(x)} ${format(y)} ${format(x + r)} ${format(y)}`,
		"Z",
	].join(" ");
}

function polyline(points: readonly (readonly [number, number])[], close = false): string {
	if (points.length === 0) return "";
	const [first, ...rest] = points;
	const commands = [`M ${format(first?.[0] ?? 0)} ${format(first?.[1] ?? 0)}`];
	for (const [x, y] of rest) commands.push(`L ${format(x)} ${format(y)}`);
	if (close) commands.push("Z");
	return commands.join(" ");
}

function translatedPath(pathData: string, deltaX: number, deltaY: number): string {
	if (!pathData) return "";
	const tokens = pathData.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g);
	if (!tokens) return "";
	let command = "";
	let argumentIndex = 0;
	return tokens
		.map((token) => {
			if (/^[A-Za-z]$/.test(token)) {
				command = token;
				argumentIndex = 0;
				return token;
			}
			const value = Number(token);
			const translated =
				command === "H"
					? value + deltaX
					: command === "V"
						? value + deltaY
						: command === "M" || command === "L" || command === "Q"
							? value + (argumentIndex % 2 === 0 ? deltaX : deltaY)
							: value;
			argumentIndex += 1;
			return format(translated);
		})
		.join(" ");
}

function format(value: number): string {
	return Number(value.toFixed(3)).toString();
}
