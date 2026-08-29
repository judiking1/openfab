import type { Cell } from "../core/TileMap";
import {
	assertSyntheticFabTopologySpec,
	type SyntheticFabCardinalSide,
	type SyntheticFabProcessBankSpec,
	type SyntheticFabProcessBlockSpec,
	type SyntheticFabProcessRowSpec,
	type SyntheticFabProcessWingSpec,
	type SyntheticFabTopologySpec,
	type SyntheticFabWallCircuitSpec,
} from "./SyntheticFabTopologySpec";

export interface SyntheticFabLayoutLoop {
	readonly id: string;
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly flow: "forward" | "reverse";
}

export interface SyntheticFabLayoutBay {
	readonly id: string;
	readonly label: string;
	readonly wingId: string;
	readonly index: number;
}

export interface SyntheticFabLayoutWing {
	readonly id: string;
	readonly role: "process-wing";
	readonly profile: SyntheticFabProcessWingSpec;
	readonly origin: Cell;
	readonly lengthMeters: number;
	readonly depthMeters: number;
	readonly bayPitchMeters: number;
	readonly bayStartOffsetMeters: number;
	readonly bays: readonly SyntheticFabLayoutBay[];
}

export interface SyntheticFabLayoutWallCircuit extends SyntheticFabLayoutLoop {
	readonly role: "wall-circuit";
	readonly profile: SyntheticFabWallCircuitSpec;
}

export interface SyntheticFabLayoutBank {
	readonly id: string;
	readonly label: string;
	readonly block: number;
	readonly column: number;
	readonly profile: SyntheticFabProcessBankSpec;
	readonly upperWing: SyntheticFabLayoutWing;
	readonly lowerWing: SyntheticFabLayoutWing;
}

export interface SyntheticFabLayoutBlock {
	readonly id: string;
	readonly label: string;
	readonly block: number;
	readonly profile: SyntheticFabProcessBlockSpec;
	readonly upperRow: SyntheticFabLayoutRow;
	readonly lowerRow: SyntheticFabLayoutRow;
	readonly leftBank: SyntheticFabLayoutBank;
	readonly rightBank: SyntheticFabLayoutBank;
}

export interface SyntheticFabLayoutGateway {
	readonly id: string;
	readonly kind: "spine-wall" | "wall-outer";
	readonly sourceId: string;
	readonly targetId: string;
	readonly sourceSide: SyntheticFabCardinalSide;
	readonly targetSide: SyntheticFabCardinalSide;
	readonly center: number;
}

export interface SyntheticFabLayoutRowCorridor {
	readonly centerY: number;
	readonly windowMinY: number;
	readonly windowMaxY: number;
	readonly westOuterX: number;
	readonly westWallX: number;
	readonly westWingOuterX: number;
	readonly westWingInnerX: number;
	readonly spineWestX: number;
	readonly spineEastX: number;
	readonly eastWingInnerX: number;
	readonly eastWingOuterX: number;
	readonly eastWallX: number;
	readonly eastOuterX: number;
}

export interface SyntheticFabLayoutRow {
	readonly id: string;
	readonly label: string;
	readonly row: number;
	readonly leftWing: SyntheticFabLayoutWing;
	readonly rightWing: SyntheticFabLayoutWing;
	readonly leftLinkCenterY: number;
	readonly rightLinkCenterY: number;
	readonly corridor: SyntheticFabLayoutRowCorridor;
}

export interface SyntheticFabLayoutPlan {
	readonly version: 4;
	readonly topologyVersion: SyntheticFabTopologySpec["version"];
	readonly outer: SyntheticFabLayoutLoop;
	readonly wallCircuit: SyntheticFabLayoutWallCircuit;
	readonly spine: SyntheticFabLayoutLoop;
	readonly wings: readonly SyntheticFabLayoutWing[];
	readonly rows: readonly SyntheticFabLayoutRow[];
	readonly banks: readonly SyntheticFabLayoutBank[];
	readonly blocks: readonly SyntheticFabLayoutBlock[];
	readonly spineWallGateways: readonly SyntheticFabLayoutGateway[];
	readonly wallOuterGateways: readonly SyntheticFabLayoutGateway[];
}

export function deriveSyntheticFabLayoutPlan(
	spec: SyntheticFabTopologySpec,
	bayPitchMeters: number,
): SyntheticFabLayoutPlan {
	assertSyntheticFabTopologySpec(spec);
	if (!Number.isSafeInteger(bayPitchMeters) || bayPitchMeters < 12 || bayPitchMeters > 30) {
		throw new RangeError("Synthetic FAB Bay pitch must be a 12-30 m integer.");
	}

	const wingProfiles = [...spec.wings].sort(
		(left, right) => left.row - right.row || left.column - right.column,
	);
	const corridorLengthMeters =
		Math.max(...wingProfiles.map((profile) => profile.bayCount)) * bayPitchMeters + 4;
	const rowY = new Map<number, number>();
	for (const block of spec.processBlocks) {
		rowY.set(block.upperRow, block.block * spec.processBlockPitchMeters);
		rowY.set(
			block.lowerRow,
			block.block * spec.processBlockPitchMeters + spec.withinBlockRowPitchMeters,
		);
	}
	const wings = wingProfiles.map((profile) => {
		const bayContentLengthMeters = profile.bayCount * bayPitchMeters + 4;
		const lengthMeters = corridorLengthMeters;
		const origin = Object.freeze({
			x:
				profile.column === 0
					? -spec.spineGapMeters - lengthMeters
					: spec.spineWidthMeters + spec.spineGapMeters,
			y: requiredRowY(rowY, profile.row),
		});
		const bayStartOffsetMeters = Math.floor((lengthMeters - bayContentLengthMeters) / 2);
		const bays = profile.bays.map(
			(baySpec) =>
				Object.freeze({
					id: baySpec.id,
					label: baySpec.label,
					wingId: profile.id,
					index: baySpec.index,
				}) satisfies SyntheticFabLayoutBay,
		);
		return Object.freeze({
			id: profile.id,
			role: "process-wing",
			profile,
			origin,
			lengthMeters,
			depthMeters: profile.laneSpacingMeters,
			bayPitchMeters,
			bayStartOffsetMeters,
			bays: Object.freeze(bays),
		}) satisfies SyntheticFabLayoutWing;
	});

	const wingMinimumY = Math.min(...wings.map((wing) => wing.origin.y - wing.depthMeters));
	const wingMaximumY = Math.max(...wings.map((wing) => wing.origin.y + wing.depthMeters));
	const spine = Object.freeze({
		id: spec.spineId,
		origin: Object.freeze({
			x: 0,
			y: wingMinimumY - spec.spineEndMarginMeters,
		}),
		lengthMeters: spec.spineWidthMeters,
		depthMeters: wingMaximumY - wingMinimumY + spec.spineEndMarginMeters * 2,
		flow: "reverse",
	}) satisfies SyntheticFabLayoutLoop;
	const westWingOuterX = Math.min(...wings.map((wing) => wing.origin.x));
	const eastWingOuterX = Math.max(...wings.map((wing) => wing.origin.x + wing.lengthMeters));
	const wallCircuit = Object.freeze({
		id: spec.wallCircuit.id,
		role: "wall-circuit",
		profile: spec.wallCircuit,
		origin: Object.freeze({
			x: westWingOuterX - spec.wallCircuitWingGapMeters,
			y: spine.origin.y - spec.wallCircuitSpineEndGapMeters,
		}),
		lengthMeters: eastWingOuterX - westWingOuterX + spec.wallCircuitWingGapMeters * 2,
		depthMeters: spine.depthMeters + spec.wallCircuitSpineEndGapMeters * 2,
		flow: "reverse",
	}) satisfies SyntheticFabLayoutWallCircuit;
	const outer = Object.freeze({
		id: "FAB-OUTER-CIRCULATION",
		origin: Object.freeze({
			x: wallCircuit.origin.x - spec.outerMarginMeters,
			y: wallCircuit.origin.y - spec.outerMarginMeters,
		}),
		lengthMeters: wallCircuit.lengthMeters + spec.outerMarginMeters * 2,
		depthMeters: wallCircuit.depthMeters + spec.outerMarginMeters * 2,
		flow: "forward",
	}) satisfies SyntheticFabLayoutLoop;
	const wingById = new Map(wings.map((wing) => [wing.id, wing]));
	const rows = [...spec.processRows]
		.sort((left, right) => left.row - right.row)
		.map((rowSpec) =>
			deriveRow(rowSpec, wingById, outer, wallCircuit, spine, spec.rowLinkWindowMeters),
		);
	const rowByIndex = new Map(rows.map((row) => [row.row, row]));
	const banks = [...spec.processBanks]
		.sort((left, right) => left.block - right.block || left.column - right.column)
		.map(
			(profile) =>
				Object.freeze({
					id: profile.id,
					label: profile.label,
					block: profile.block,
					column: profile.column,
					profile,
					upperWing: requiredWing(wingById, profile.upperWingId),
					lowerWing: requiredWing(wingById, profile.lowerWingId),
				}) satisfies SyntheticFabLayoutBank,
		);
	const bankById = new Map(banks.map((bank) => [bank.id, bank]));
	const blocks = [...spec.processBlocks]
		.sort((left, right) => left.block - right.block)
		.map(
			(profile) =>
				Object.freeze({
					id: profile.id,
					label: profile.label,
					block: profile.block,
					profile,
					upperRow: requiredRow(rowByIndex, profile.upperRow),
					lowerRow: requiredRow(rowByIndex, profile.lowerRow),
					leftBank: requiredBank(bankById, profile.leftBankId),
					rightBank: requiredBank(bankById, profile.rightBankId),
				}) satisfies SyntheticFabLayoutBlock,
		);
	const blockByIndex = new Map(blocks.map((block) => [block.block, block]));
	const spineCenterX = spine.origin.x + Math.floor(spine.lengthMeters / 2);
	const spineWallGateways = spec.spineWallLinks.map(
		(link) =>
			Object.freeze({
				id: link.id,
				kind: "spine-wall",
				sourceId: link.sourceSpineId,
				targetId: link.targetWallCircuitId,
				sourceSide: link.sourceSide,
				targetSide: link.targetSide,
				center: spineCenterX,
			}) satisfies SyntheticFabLayoutGateway,
	);
	const wallCenterX = wallCircuit.origin.x + Math.floor(wallCircuit.lengthMeters / 2);
	const wallOuterGateways = spec.wallOuterLinks.map((link) => {
		let center: number;
		if (link.placement.kind === "CENTER_OFFSET") {
			center = wallCenterX + link.placement.offsetMeters;
		} else {
			const upperBlock = requiredBlock(blockByIndex, link.placement.gapAfterBlock);
			const lowerBlock = requiredBlock(blockByIndex, link.placement.gapAfterBlock + 1);
			const upperWing =
				link.sourceSide === "west" ? upperBlock.leftBank.lowerWing : upperBlock.rightBank.lowerWing;
			const lowerWing =
				link.sourceSide === "west" ? lowerBlock.leftBank.upperWing : lowerBlock.rightBank.upperWing;
			center = Math.floor(
				(upperWing.origin.y + upperWing.depthMeters + lowerWing.origin.y - lowerWing.depthMeters) /
					2,
			);
		}
		return Object.freeze({
			id: link.id,
			kind: "wall-outer",
			sourceId: link.sourceWallCircuitId,
			targetId: outer.id,
			sourceSide: link.sourceSide,
			targetSide: link.outerSide,
			center,
		}) satisfies SyntheticFabLayoutGateway;
	});
	for (const gateway of spineWallGateways) {
		assertGatewayWindowFitsLoop(gateway, spine, spec.rowLinkWindowMeters);
		assertGatewayWindowFitsLoop(gateway, wallCircuit, spec.rowLinkWindowMeters);
	}
	for (const gateway of wallOuterGateways) {
		assertGatewayWindowFitsLoop(gateway, wallCircuit, spec.rowLinkWindowMeters);
		assertGatewayWindowFitsLoop(gateway, outer, spec.rowLinkWindowMeters);
	}

	return Object.freeze({
		version: 4,
		topologyVersion: spec.version,
		outer,
		wallCircuit,
		spine,
		wings: Object.freeze(wings),
		rows: Object.freeze(rows),
		banks: Object.freeze(banks),
		blocks: Object.freeze(blocks),
		spineWallGateways: Object.freeze(spineWallGateways),
		wallOuterGateways: Object.freeze(wallOuterGateways),
	});
}

function assertGatewayWindowFitsLoop(
	gateway: SyntheticFabLayoutGateway,
	loop: SyntheticFabLayoutLoop,
	windowMeters: number,
): void {
	const horizontal = gateway.sourceSide === "north" || gateway.sourceSide === "south";
	const minimum = (horizontal ? loop.origin.x : loop.origin.y) + 2;
	const maximum =
		(horizontal ? loop.origin.x + loop.lengthMeters : loop.origin.y + loop.depthMeters) - 2;
	const halfBefore = Math.floor(windowMeters / 2);
	const halfAfter = windowMeters - halfBefore;
	if (gateway.center - halfBefore < minimum || gateway.center + halfAfter > maximum) {
		throw new Error(
			`Synthetic FAB gateway ${gateway.id} window does not fit the ${loop.id} straight segment.`,
		);
	}
}

function deriveRow(
	rowSpec: SyntheticFabProcessRowSpec,
	wingById: ReadonlyMap<string, SyntheticFabLayoutWing>,
	outer: SyntheticFabLayoutLoop,
	wallCircuit: SyntheticFabLayoutWallCircuit,
	spine: SyntheticFabLayoutLoop,
	rowLinkWindowMeters: number,
): SyntheticFabLayoutRow {
	const leftWing = requiredWing(wingById, rowSpec.leftWingId);
	const rightWing = requiredWing(wingById, rowSpec.rightWingId);
	const leftLinkCenterY = leftWing.origin.y + Math.floor(leftWing.depthMeters / 2);
	const rightLinkCenterY = rightWing.origin.y + Math.floor(rightWing.depthMeters / 2);
	const centerY = Math.floor((leftLinkCenterY + rightLinkCenterY) / 2);
	const halfBefore = Math.floor(rowLinkWindowMeters / 2);
	const halfAfter = rowLinkWindowMeters - halfBefore;
	return Object.freeze({
		id: rowSpec.id,
		label: rowSpec.label,
		row: rowSpec.row,
		leftWing,
		rightWing,
		leftLinkCenterY,
		rightLinkCenterY,
		corridor: Object.freeze({
			centerY,
			windowMinY: centerY - halfBefore,
			windowMaxY: centerY + halfAfter,
			westOuterX: outer.origin.x,
			westWallX: wallCircuit.origin.x,
			westWingOuterX: leftWing.origin.x,
			westWingInnerX: leftWing.origin.x + leftWing.lengthMeters,
			spineWestX: spine.origin.x,
			spineEastX: spine.origin.x + spine.lengthMeters,
			eastWingInnerX: rightWing.origin.x,
			eastWingOuterX: rightWing.origin.x + rightWing.lengthMeters,
			eastWallX: wallCircuit.origin.x + wallCircuit.lengthMeters,
			eastOuterX: outer.origin.x + outer.lengthMeters,
		}),
	});
}

function requiredRowY(rows: ReadonlyMap<number, number>, row: number): number {
	const y = rows.get(row);
	if (y === undefined) throw new Error(`Synthetic FAB layout is missing row ${row}.`);
	return y;
}

function requiredRow(
	rows: ReadonlyMap<number, SyntheticFabLayoutRow>,
	row: number,
): SyntheticFabLayoutRow {
	const processRow = rows.get(row);
	if (!processRow) throw new Error(`Synthetic FAB layout is missing process row ${row}.`);
	return processRow;
}

function requiredBank(
	banks: ReadonlyMap<string, SyntheticFabLayoutBank>,
	bankId: string,
): SyntheticFabLayoutBank {
	const bank = banks.get(bankId);
	if (!bank) throw new Error(`Synthetic FAB layout is missing process bank ${bankId}.`);
	return bank;
}

function requiredBlock(
	blocks: ReadonlyMap<number, SyntheticFabLayoutBlock>,
	block: number,
): SyntheticFabLayoutBlock {
	const processBlock = blocks.get(block);
	if (!processBlock) throw new Error(`Synthetic FAB layout is missing process block ${block}.`);
	return processBlock;
}

function requiredWing(
	wings: ReadonlyMap<string, SyntheticFabLayoutWing>,
	wingId: string,
): SyntheticFabLayoutWing {
	const wing = wings.get(wingId);
	if (!wing) throw new Error(`Synthetic FAB layout is missing Wing ${wingId}.`);
	return wing;
}
