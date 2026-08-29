import { RAIL_NETWORK_LINK_MAXIMUM_GAP_METERS } from "../core/RailNetworkLinkPlanner";

export const SYNTHETIC_FAB_CARDINAL_SIDES = ["north", "east", "south", "west"] as const;

export type SyntheticFabCardinalSide = (typeof SYNTHETIC_FAB_CARDINAL_SIDES)[number];

export interface SyntheticFabProcessBaySpec {
	readonly id: string;
	readonly label: string;
	readonly index: number;
}

export interface SyntheticFabProcessWingSpec {
	readonly id: string;
	readonly label: string;
	readonly row: number;
	readonly column: number;
	readonly bayCount: number;
	readonly laneSpacingMeters: number;
	readonly bays: readonly SyntheticFabProcessBaySpec[];
}

export interface SyntheticFabProcessRowSpec {
	readonly id: string;
	readonly label: string;
	readonly row: number;
	readonly leftWingId: string;
	readonly rightWingId: string;
}

export interface SyntheticFabProcessBankSpec {
	readonly id: string;
	readonly label: string;
	readonly block: number;
	readonly column: number;
	readonly upperWingId: string;
	readonly lowerWingId: string;
}

export interface SyntheticFabProcessBlockSpec {
	readonly id: string;
	readonly label: string;
	readonly block: number;
	readonly upperRow: number;
	readonly lowerRow: number;
	readonly leftBankId: string;
	readonly rightBankId: string;
}

export interface SyntheticFabWallCircuitSpec {
	readonly id: string;
	readonly label: string;
}

export interface SyntheticFabSpineWallLinkSpec {
	readonly id: string;
	readonly label: string;
	readonly sourceSpineId: string;
	readonly sourceSide: "north" | "south";
	readonly targetWallCircuitId: string;
	readonly targetSide: "north" | "south";
}

export type SyntheticFabWallOuterPlacement =
	| Readonly<{ kind: "CENTER_OFFSET"; offsetMeters: number }>
	| Readonly<{ kind: "BLOCK_GAP"; gapAfterBlock: number }>;

export interface SyntheticFabWallOuterLinkSpec {
	readonly id: string;
	readonly label: string;
	readonly sourceWallCircuitId: string;
	readonly sourceSide: SyntheticFabCardinalSide;
	readonly outerSide: SyntheticFabCardinalSide;
	readonly placement: SyntheticFabWallOuterPlacement;
}

export interface SyntheticFabTopologySpec {
	readonly version: 7;
	readonly id: "large-fab-60";
	readonly columns: number;
	readonly rows: number;
	readonly blocks: number;
	readonly spineId: "FAB-INTERBAY-SPINE";
	readonly spineWidthMeters: number;
	readonly spineGapMeters: number;
	readonly spineEndMarginMeters: number;
	readonly rowLinkWindowMeters: number;
	readonly withinBlockRowPitchMeters: number;
	readonly processBlockPitchMeters: number;
	readonly wallCircuitWingGapMeters: number;
	readonly wallCircuitSpineEndGapMeters: number;
	readonly outerMarginMeters: number;
	readonly wallCircuit: SyntheticFabWallCircuitSpec;
	readonly wings: readonly SyntheticFabProcessWingSpec[];
	readonly processRows: readonly SyntheticFabProcessRowSpec[];
	readonly processBanks: readonly SyntheticFabProcessBankSpec[];
	readonly processBlocks: readonly SyntheticFabProcessBlockSpec[];
	readonly spineWallLinks: readonly SyntheticFabSpineWallLinkSpec[];
	readonly wallOuterLinks: readonly SyntheticFabWallOuterLinkSpec[];
}

export const SYNTHETIC_FAB_MINIMUM_PROCESS_BLOCKS = 3;
export const SYNTHETIC_FAB_MAXIMUM_PROCESS_BLOCKS = 6;
export const SYNTHETIC_FAB_MINIMUM_BAYS = 50;
export const SYNTHETIC_FAB_MAXIMUM_BAYS = 100;
export const SYNTHETIC_FAB_MINIMUM_BAY_PITCH_METERS = 20;
const SYNTHETIC_FAB_GATEWAY_CORNER_CLEARANCE_METERS = 2;

export interface SyntheticFabTopologyProfile {
	readonly processBlockCount: number;
	readonly totalBayCount: number;
}

interface SyntheticFabProcessRowProfile {
	readonly id: string;
	readonly label: string;
	readonly westWingId: string;
	readonly westWingLabel: string;
	readonly eastWingId: string;
	readonly eastWingLabel: string;
}

const PROCESS_ROW_PROFILES: readonly SyntheticFabProcessRowProfile[] = Object.freeze([
	rowProfile("ROW-PHOTO", "PHOTO", "PHOTO-FRONT", "PHOTO FRONT", "PHOTO-BACK", "PHOTO BACK"),
	rowProfile("ROW-ETCH", "ETCH", "ETCH-NORTH", "ETCH NORTH", "ETCH-SOUTH", "ETCH SOUTH"),
	rowProfile(
		"ROW-DIFF-IMPLANT",
		"DIFFUSION / IMPLANT",
		"DIFFUSION",
		"DIFFUSION",
		"IMPLANT",
		"IMPLANT",
	),
	rowProfile("ROW-METAL", "METAL", "METAL-FRONT", "METAL FRONT", "METAL-BACK", "METAL BACK"),
	rowProfile("ROW-CMP-WET", "CMP / WET CLEAN", "CMP", "CMP", "WET-CLEAN", "WET CLEAN"),
	rowProfile("ROW-TEST-METROLOGY", "TEST / METROLOGY", "TEST", "TEST", "METROLOGY", "METROLOGY"),
	rowProfile("ROW-CVD-PVD", "CVD / PVD", "CVD", "CVD", "PVD", "PVD"),
	rowProfile("ROW-CLEAN-THERMAL", "CLEAN / THERMAL", "CLEAN", "CLEAN", "THERMAL", "THERMAL"),
	rowProfile("ROW-LITHO-TRACK", "LITHO / TRACK", "LITHO", "LITHO", "TRACK", "TRACK"),
	rowProfile(
		"ROW-INSPECTION-SORT",
		"INSPECTION / SORT",
		"INSPECTION",
		"INSPECTION",
		"SORT",
		"SORT",
	),
	rowProfile("ROW-BUFFER-UTILITY", "BUFFER / UTILITY", "BUFFER", "BUFFER", "UTILITY", "UTILITY"),
	rowProfile("ROW-PACKAGE-REWORK", "PACKAGE / REWORK", "PACKAGE", "PACKAGE", "REWORK", "REWORK"),
]);

/**
 * Public-safe OpenFab topology. Every label and dimension is synthetic.
 *
 * A rectangular outer circulation encloses one central interbay spine. Each Process Row owns two
 * direct wall-to-spine trunks. Repeated tangent Bay bypasses sit on those trunks, and adjacent row
 * pairs form west/east Banks and one Process Block. Four cardinal gateways connect the shared wall
 * circuit to the outer circulation without replacing the authored 1 m grammar.
 */
export function createSyntheticFabTopologySpec(
	profile: SyntheticFabTopologyProfile,
): SyntheticFabTopologySpec {
	const { processBlockCount, totalBayCount } = profile;
	if (
		!Number.isSafeInteger(processBlockCount) ||
		processBlockCount < SYNTHETIC_FAB_MINIMUM_PROCESS_BLOCKS ||
		processBlockCount > SYNTHETIC_FAB_MAXIMUM_PROCESS_BLOCKS
	) {
		throw new RangeError(
			`대규모 합성 FAB의 Process Block 수는 ${SYNTHETIC_FAB_MINIMUM_PROCESS_BLOCKS}-${SYNTHETIC_FAB_MAXIMUM_PROCESS_BLOCKS} 정수여야 합니다`,
		);
	}
	if (
		!Number.isSafeInteger(totalBayCount) ||
		totalBayCount < SYNTHETIC_FAB_MINIMUM_BAYS ||
		totalBayCount > SYNTHETIC_FAB_MAXIMUM_BAYS
	) {
		throw new RangeError(
			`대규모 합성 FAB의 총 Bay 수는 ${SYNTHETIC_FAB_MINIMUM_BAYS}-${SYNTHETIC_FAB_MAXIMUM_BAYS} 정수여야 합니다`,
		);
	}

	const rows = processBlockCount * 2;
	const rowProfiles = PROCESS_ROW_PROFILES.slice(0, rows);
	const wingCount = rows * 2;
	const baseBayCount = Math.floor(totalBayCount / wingCount);
	const remainingBays = totalBayCount % wingCount;
	const wings = rowProfiles.flatMap((row, rowIndex) => {
		const westBayCount = baseBayCount + (rowIndex * 2 < remainingBays ? 1 : 0);
		const eastBayCount = baseBayCount + (rowIndex * 2 + 1 < remainingBays ? 1 : 0);
		return [
			wing(
				row.westWingId,
				row.westWingLabel,
				rowIndex,
				0,
				westBayCount,
				16,
				createWingBays(row.westWingId, row.westWingLabel, westBayCount),
			),
			wing(
				row.eastWingId,
				row.eastWingLabel,
				rowIndex,
				1,
				eastBayCount,
				16,
				createWingBays(row.eastWingId, row.eastWingLabel, eastBayCount),
			),
		];
	});
	const processRows = rowProfiles.map((row, rowIndex) =>
		processRow(row.id, row.label, rowIndex, row.westWingId, row.eastWingId),
	);
	const processBanks = Array.from({ length: processBlockCount }, (_, block) => {
		const upper = rowProfiles[block * 2] as SyntheticFabProcessRowProfile;
		const lower = rowProfiles[block * 2 + 1] as SyntheticFabProcessRowProfile;
		const ordinal = formatOrdinal(block);
		return [
			processBank(
				`BANK-${ordinal}-WEST`,
				`PROCESS BLOCK ${ordinal} · WEST BANK`,
				block,
				0,
				upper.westWingId,
				lower.westWingId,
			),
			processBank(
				`BANK-${ordinal}-EAST`,
				`PROCESS BLOCK ${ordinal} · EAST BANK`,
				block,
				1,
				upper.eastWingId,
				lower.eastWingId,
			),
		];
	}).flat();
	const processBlocks = Array.from({ length: processBlockCount }, (_, block) => {
		const ordinal = formatOrdinal(block);
		return processBlock(
			`PROCESS-BLOCK-${ordinal}`,
			`PROCESS BLOCK ${ordinal}`,
			block,
			block * 2,
			block * 2 + 1,
			`BANK-${ordinal}-WEST`,
			`BANK-${ordinal}-EAST`,
		);
	});
	const wallCircuit = Object.freeze({
		id: "FAB-INNER-WALL-CIRCUIT",
		label: "SHARED INNER BAY-WALL CIRCUIT",
	}) satisfies SyntheticFabWallCircuitSpec;
	const westGatewayGap = Math.floor((processBlockCount - 2) / 2);
	const eastGatewayGap = westGatewayGap + 1;
	const spec = Object.freeze({
		version: 7,
		id: "large-fab-60",
		columns: 2,
		rows,
		blocks: processBlockCount,
		spineId: "FAB-INTERBAY-SPINE",
		spineWidthMeters: 24,
		spineGapMeters: 32,
		spineEndMarginMeters: 32,
		rowLinkWindowMeters: 20,
		withinBlockRowPitchMeters: 60,
		processBlockPitchMeters: 160,
		wallCircuitWingGapMeters: 8,
		wallCircuitSpineEndGapMeters: 16,
		outerMarginMeters: 32,
		wallCircuit,
		wings: Object.freeze(wings),
		processRows: Object.freeze(processRows),
		processBanks: Object.freeze(processBanks),
		processBlocks: Object.freeze(processBlocks),
		spineWallLinks: Object.freeze([
			spineWallLink(
				"NORTH-SPINE-WALL-GATE",
				"INTERBAY SPINE ↔ NORTH WALL",
				"FAB-INTERBAY-SPINE",
				"north",
				wallCircuit.id,
				"north",
			),
			spineWallLink(
				"SOUTH-SPINE-WALL-GATE",
				"INTERBAY SPINE ↔ SOUTH WALL",
				"FAB-INTERBAY-SPINE",
				"south",
				wallCircuit.id,
				"south",
			),
		]),
		wallOuterLinks: Object.freeze([
			wallOuterLink(
				"NORTH-WALL-OUTER-GATE",
				"NORTH WALL ↔ NORTH OUTER",
				wallCircuit.id,
				"north",
				Object.freeze({ kind: "CENTER_OFFSET", offsetMeters: -64 }),
			),
			wallOuterLink(
				"EAST-WALL-OUTER-GATE",
				"EAST WALL ↔ EAST OUTER",
				wallCircuit.id,
				"east",
				Object.freeze({ kind: "BLOCK_GAP", gapAfterBlock: eastGatewayGap }),
			),
			wallOuterLink(
				"SOUTH-WALL-OUTER-GATE",
				"SOUTH WALL ↔ SOUTH OUTER",
				wallCircuit.id,
				"south",
				Object.freeze({ kind: "CENTER_OFFSET", offsetMeters: 64 }),
			),
			wallOuterLink(
				"WEST-WALL-OUTER-GATE",
				"WEST WALL ↔ WEST OUTER",
				wallCircuit.id,
				"west",
				Object.freeze({ kind: "BLOCK_GAP", gapAfterBlock: westGatewayGap }),
			),
		]),
	}) satisfies SyntheticFabTopologySpec;
	assertSyntheticFabTopologySpec(spec);
	return spec;
}

export const LARGE_FAB_60_TOPOLOGY_SPEC = createSyntheticFabTopologySpec({
	processBlockCount: 3,
	totalBayCount: 60,
});

assertSyntheticFabTopologySpec(LARGE_FAB_60_TOPOLOGY_SPEC);

export function syntheticFabTopologyBayCount(spec: SyntheticFabTopologySpec): number {
	return spec.wings.reduce((total, wingSpec) => total + wingSpec.bayCount, 0);
}

export function resizeSyntheticFabTopologyBayCount(
	spec: SyntheticFabTopologySpec,
	targetBayCount: number,
): SyntheticFabTopologySpec {
	assertSyntheticFabTopologySpec(spec);
	if (!Number.isSafeInteger(targetBayCount) || targetBayCount < 50 || targetBayCount > 100) {
		throw new RangeError("대규모 합성 FAB의 총 Bay 수는 50-100 정수여야 합니다");
	}
	const baseCount = Math.floor(targetBayCount / spec.wings.length);
	const remainder = targetBayCount % spec.wings.length;
	const wings = [...spec.wings]
		.sort((left, right) => left.row - right.row || left.column - right.column)
		.map((wingSpec, index) => {
			const bayCount = baseCount + (index < remainder ? 1 : 0);
			return Object.freeze({
				...wingSpec,
				bayCount,
				bays: createWingBays(wingSpec.id, wingSpec.label, bayCount),
			});
		});
	const resized = Object.freeze({
		...spec,
		wings: Object.freeze(wings),
	});
	assertSyntheticFabTopologySpec(resized);
	return resized;
}

export function assertSyntheticFabTopologySpec(spec: SyntheticFabTopologySpec): void {
	if (spec.version !== 7) {
		throw new Error(`지원하지 않는 합성 FAB topology version: ${String(spec.version)}`);
	}
	if (!Number.isSafeInteger(spec.columns) || spec.columns !== 2) {
		throw new Error("합성 FAB circulation 문법은 좌우 두 Wing column을 요구합니다");
	}
	if (!Number.isSafeInteger(spec.rows) || spec.rows < 1) {
		throw new Error("합성 FAB row 수가 유효하지 않습니다");
	}
	if (
		!Number.isSafeInteger(spec.blocks) ||
		spec.blocks < SYNTHETIC_FAB_MINIMUM_PROCESS_BLOCKS ||
		spec.blocks > SYNTHETIC_FAB_MAXIMUM_PROCESS_BLOCKS ||
		spec.blocks * 2 !== spec.rows
	) {
		throw new Error(
			`합성 FAB process block은 ${SYNTHETIC_FAB_MINIMUM_PROCESS_BLOCKS}-${SYNTHETIC_FAB_MAXIMUM_PROCESS_BLOCKS}개이며 연속된 두 row씩 구성되어야 합니다`,
		);
	}
	assertIntegerAtLeast(spec.spineWidthMeters, 24, "spine width");
	assertIntegerAtLeast(spec.spineGapMeters, 12, "spine gap");
	assertIntegerAtLeast(spec.spineEndMarginMeters, 12, "spine end margin");
	assertIntegerAtLeast(spec.rowLinkWindowMeters, 12, "row link window");
	if (
		spec.rowLinkWindowMeters >
		spec.spineWidthMeters - SYNTHETIC_FAB_GATEWAY_CORNER_CLEARANCE_METERS * 2
	) {
		throw new Error("합성 FAB row link window가 spine의 사용 가능한 직선 구간을 벗어납니다");
	}
	assertIntegerAtLeast(spec.wallCircuitWingGapMeters, 8, "wall circuit Wing gap");
	assertIntegerAtLeast(spec.wallCircuitSpineEndGapMeters, 8, "wall circuit spine gap");
	assertIntegerAtLeast(spec.outerMarginMeters, 12, "outer margin");
	for (const [value, label] of [
		[spec.spineGapMeters, "spine gap"],
		[spec.wallCircuitWingGapMeters, "wall circuit Wing gap"],
		[spec.wallCircuitSpineEndGapMeters, "wall circuit spine gap"],
		[spec.outerMarginMeters, "outer margin"],
	] as const) {
		assertIntegerAtMost(value, RAIL_NETWORK_LINK_MAXIMUM_GAP_METERS, label);
	}
	if (spec.wings.length !== spec.columns * spec.rows) {
		throw new Error("합성 FAB Wing 수가 row/column 격자와 일치하지 않습니다");
	}

	const wingIds = new Set<string>();
	const bayIds = new Set<string>();
	const positions = new Set<string>();
	let maximumLaneSpacingMeters = 0;
	for (const wingSpec of spec.wings) {
		if (wingIds.has(wingSpec.id)) throw new Error(`중복 합성 FAB Wing id: ${wingSpec.id}`);
		wingIds.add(wingSpec.id);
		if (!Number.isSafeInteger(wingSpec.row) || !Number.isSafeInteger(wingSpec.column)) {
			throw new Error(`합성 FAB Wing ${wingSpec.id} 위치가 정수 격자가 아닙니다`);
		}
		const position = `${wingSpec.row}:${wingSpec.column}`;
		if (positions.has(position)) throw new Error(`중복 합성 FAB Wing 위치: ${position}`);
		positions.add(position);
		if (
			wingSpec.row < 0 ||
			wingSpec.row >= spec.rows ||
			wingSpec.column < 0 ||
			wingSpec.column >= spec.columns
		) {
			throw new Error(`합성 FAB Wing ${wingSpec.id} 위치가 격자 범위를 벗어났습니다`);
		}
		if (
			!Number.isSafeInteger(wingSpec.bayCount) ||
			wingSpec.bayCount < 2 ||
			wingSpec.bayCount > 10
		) {
			throw new Error(`합성 FAB Wing ${wingSpec.id} Bay 수가 2-10 범위를 벗어났습니다`);
		}
		if (wingSpec.bays.length !== wingSpec.bayCount) {
			throw new Error(`합성 FAB Wing ${wingSpec.id}의 Bay 목록과 Bay 수가 일치하지 않습니다`);
		}
		for (const [index, baySpec] of wingSpec.bays.entries()) {
			if (baySpec.index !== index) {
				throw new Error(`합성 FAB Wing ${wingSpec.id}의 Bay 순서가 연속적이지 않습니다`);
			}
			if (bayIds.has(baySpec.id)) {
				throw new Error(`중복 합성 FAB Bay id: ${baySpec.id}`);
			}
			bayIds.add(baySpec.id);
		}
		assertIntegerAtLeast(wingSpec.laneSpacingMeters, 12, `Wing ${wingSpec.id} lane spacing`);
		maximumLaneSpacingMeters = Math.max(maximumLaneSpacingMeters, wingSpec.laneSpacingMeters);
	}
	const totalBayCount = syntheticFabTopologyBayCount(spec);
	if (totalBayCount < SYNTHETIC_FAB_MINIMUM_BAYS || totalBayCount > SYNTHETIC_FAB_MAXIMUM_BAYS) {
		throw new Error(
			`대규모 합성 FAB의 총 Bay 수는 ${SYNTHETIC_FAB_MINIMUM_BAYS}-${SYNTHETIC_FAB_MAXIMUM_BAYS} 범위여야 합니다`,
		);
	}
	assertIntegerAtLeast(
		spec.withinBlockRowPitchMeters,
		maximumLaneSpacingMeters + 24,
		"within-block row pitch",
	);
	assertIntegerAtLeast(
		spec.processBlockPitchMeters,
		spec.withinBlockRowPitchMeters + maximumLaneSpacingMeters * 2 + 50,
		"process block pitch",
	);
	if (
		spec.rowLinkWindowMeters >
		Math.min(
			spec.withinBlockRowPitchMeters,
			spec.processBlockPitchMeters - spec.withinBlockRowPitchMeters,
		) -
			8
	) {
		throw new Error("합성 FAB row link window가 인접 row 연결 영역과 겹칩니다");
	}

	assertProcessRows(spec, wingIds);
	assertProcessBlocksAndBanks(spec, wingIds);

	const linkIds = new Set<string>();
	const graph = new Map<string, Set<string>>();
	const spineNode = spec.spineId;
	const wallNode = spec.wallCircuit.id;
	const outerNode = "FAB-OUTER-CIRCULATION";
	if (!wallNode.trim() || !spec.wallCircuit.label.trim()) {
		throw new Error("합성 FAB shared wall circuit의 id와 label이 필요합니다");
	}
	addGraphNode(graph, spineNode);
	addGraphNode(graph, wallNode);
	addGraphNode(graph, outerNode);

	// Preserve every row/side trunk as a distinct topology node instead of collapsing
	// repeated wall-to-spine edges in the graph Set.
	for (const row of spec.processRows) {
		for (const wingId of [row.leftWingId, row.rightWingId]) {
			const trunkNode = `process-trunk:${row.id}:${wingId}`;
			addGraphNode(graph, trunkNode);
			connectBidirectionalMacroLink(graph, wallNode, trunkNode);
			connectBidirectionalMacroLink(graph, trunkNode, spineNode);
		}
	}

	if (spec.spineWallLinks.length !== 2) {
		throw new Error("합성 FAB central spine에는 north/south wall gateway가 필요합니다");
	}
	const spineWallSides = new Set<string>();
	for (const link of spec.spineWallLinks) {
		assertUniqueLinkId(link.id, linkIds);
		if (link.sourceSpineId !== spineNode) {
			throw new Error(`합성 FAB spine/wall link ${link.id}의 spine id가 일치하지 않습니다`);
		}
		if (link.targetWallCircuitId !== wallNode) {
			throw new Error(`합성 FAB spine/wall link ${link.id}의 wall circuit id가 일치하지 않습니다`);
		}
		if (link.sourceSide !== link.targetSide) {
			throw new Error(
				`합성 FAB spine/wall link ${link.id}가 같은 north/south 면을 사용하지 않습니다`,
			);
		}
		if (spineWallSides.has(link.sourceSide)) {
			throw new Error(`합성 FAB spine/wall gateway 면이 중복되었습니다: ${link.sourceSide}`);
		}
		spineWallSides.add(link.sourceSide);
		connectBidirectionalMacroLink(graph, spineNode, wallNode);
	}
	if (!spineWallSides.has("north") || !spineWallSides.has("south")) {
		throw new Error("합성 FAB central spine은 north/south wall gateway를 모두 가져야 합니다");
	}

	if (spec.wallOuterLinks.length !== SYNTHETIC_FAB_CARDINAL_SIDES.length) {
		throw new Error(
			"합성 FAB shared wall circuit에는 north/east/south/west outer gateway가 필요합니다",
		);
	}
	const wallOuterSides = new Set<SyntheticFabCardinalSide>();
	const usedWallGatewayGaps = new Set<number>();
	for (const link of spec.wallOuterLinks) {
		assertUniqueLinkId(link.id, linkIds);
		if (link.sourceWallCircuitId !== wallNode) {
			throw new Error(`합성 FAB wall/outer link ${link.id}의 wall circuit id가 일치하지 않습니다`);
		}
		if (link.sourceSide !== link.outerSide || wallOuterSides.has(link.sourceSide)) {
			throw new Error(
				`합성 FAB wall/outer gateway 면이 중복되었거나 일치하지 않습니다: ${link.sourceSide}`,
			);
		}
		if (link.sourceSide === "east" || link.sourceSide === "west") {
			if (
				link.placement.kind !== "BLOCK_GAP" ||
				!Number.isSafeInteger(link.placement.gapAfterBlock) ||
				link.placement.gapAfterBlock < 0 ||
				link.placement.gapAfterBlock >= spec.blocks - 1 ||
				usedWallGatewayGaps.has(link.placement.gapAfterBlock)
			) {
				throw new Error(`합성 FAB wall/outer link ${link.id}의 block gap이 유효하지 않습니다`);
			}
			usedWallGatewayGaps.add(link.placement.gapAfterBlock);
		} else {
			if (
				link.placement.kind !== "CENTER_OFFSET" ||
				!Number.isSafeInteger(link.placement.offsetMeters) ||
				Math.abs(link.placement.offsetMeters) < spec.spineWidthMeters + spec.rowLinkWindowMeters
			) {
				throw new Error(`합성 FAB wall/outer link ${link.id}의 center offset이 유효하지 않습니다`);
			}
			assertHorizontalGatewayWindowFitsMinimumWall(spec, link.id, link.placement.offsetMeters);
		}
		wallOuterSides.add(link.sourceSide);
		connectBidirectionalMacroLink(graph, wallNode, outerNode);
	}
	if (wallOuterSides.size !== SYNTHETIC_FAB_CARDINAL_SIDES.length) {
		throw new Error("합성 FAB shared wall circuit은 outer의 네 면에 모두 연결되어야 합니다");
	}
	assertMacroGraphConnectedWithout(graph, null, outerNode, "outer circulation까지");
	assertMacroGraphConnectedWithout(graph, spineNode, outerNode, "spine 장애 시 shared wall을 통해");
	assertMacroGraphConnectedWithout(
		graph,
		outerNode,
		spineNode,
		"outer 장애 시 central spine을 통해",
	);
}

function assertHorizontalGatewayWindowFitsMinimumWall(
	spec: SyntheticFabTopologySpec,
	linkId: string,
	offsetMeters: number,
): void {
	const maximumWingBays = Math.max(...spec.wings.map((wing) => wing.bayCount));
	const corridorLengthMeters = maximumWingBays * SYNTHETIC_FAB_MINIMUM_BAY_PITCH_METERS + 4;
	const wallLengthMeters =
		corridorLengthMeters * 2 +
		spec.spineWidthMeters +
		spec.spineGapMeters * 2 +
		spec.wallCircuitWingGapMeters * 2;
	const center = Math.floor(wallLengthMeters / 2) + offsetMeters;
	const halfBefore = Math.floor(spec.rowLinkWindowMeters / 2);
	const halfAfter = spec.rowLinkWindowMeters - halfBefore;
	if (
		center - halfBefore < SYNTHETIC_FAB_GATEWAY_CORNER_CLEARANCE_METERS ||
		center + halfAfter > wallLengthMeters - SYNTHETIC_FAB_GATEWAY_CORNER_CLEARANCE_METERS
	) {
		throw new Error(
			`합성 FAB wall/outer link ${linkId}의 gateway window가 wall 직선 구간을 벗어납니다`,
		);
	}
}

function assertProcessRows(spec: SyntheticFabTopologySpec, wingIds: ReadonlySet<string>): void {
	if (spec.processRows.length !== spec.rows) {
		throw new Error("합성 FAB process row 수가 row 격자와 일치하지 않습니다");
	}
	const rowIds = new Set<string>();
	const rowIndexes = new Set<number>();
	const rowWingIds = new Set<string>();
	for (const rowSpec of spec.processRows) {
		if (rowIds.has(rowSpec.id)) throw new Error(`중복 합성 FAB process row id: ${rowSpec.id}`);
		rowIds.add(rowSpec.id);
		if (!Number.isSafeInteger(rowSpec.row) || rowSpec.row < 0 || rowSpec.row >= spec.rows) {
			throw new Error(`합성 FAB process row ${rowSpec.id} 위치가 유효하지 않습니다`);
		}
		if (rowIndexes.has(rowSpec.row)) {
			throw new Error(`중복 합성 FAB process row 위치: ${rowSpec.row}`);
		}
		rowIndexes.add(rowSpec.row);
		const leftWing = spec.wings.find((wingSpec) => wingSpec.id === rowSpec.leftWingId);
		const rightWing = spec.wings.find((wingSpec) => wingSpec.id === rowSpec.rightWingId);
		if (!leftWing || !rightWing) {
			throw new Error(`합성 FAB process row ${rowSpec.id}의 Wing이 없습니다`);
		}
		if (
			leftWing.row !== rowSpec.row ||
			leftWing.column !== 0 ||
			rightWing.row !== rowSpec.row ||
			rightWing.column !== 1
		) {
			throw new Error(`합성 FAB process row ${rowSpec.id}의 좌우 Wing 위치가 잘못되었습니다`);
		}
		for (const wingId of [leftWing.id, rightWing.id]) {
			if (rowWingIds.has(wingId)) {
				throw new Error(`합성 FAB Wing ${wingId}가 process row에서 중복되었습니다`);
			}
			rowWingIds.add(wingId);
		}
	}
	if (rowWingIds.size !== wingIds.size) {
		throw new Error("합성 FAB process row가 모든 Wing을 정확히 한 번 포함해야 합니다");
	}
}

function assertProcessBlocksAndBanks(
	spec: SyntheticFabTopologySpec,
	wingIds: ReadonlySet<string>,
): void {
	if (spec.processBanks.length !== spec.blocks * spec.columns) {
		throw new Error("합성 FAB process bank 수가 block/column 격자와 일치하지 않습니다");
	}
	const bankIds = new Set<string>();
	const bankPositions = new Set<string>();
	const bankWingIds = new Set<string>();
	for (const bank of spec.processBanks) {
		if (bankIds.has(bank.id)) throw new Error(`중복 합성 FAB process bank id: ${bank.id}`);
		const position = `${bank.block}:${bank.column}`;
		if (bankPositions.has(position)) {
			throw new Error(`중복 합성 FAB process bank 위치: ${position}`);
		}
		const upperWing = spec.wings.find((wingSpec) => wingSpec.id === bank.upperWingId);
		const lowerWing = spec.wings.find((wingSpec) => wingSpec.id === bank.lowerWingId);
		if (!upperWing || !lowerWing) {
			throw new Error(`합성 FAB process bank ${bank.id}의 Wing이 없습니다`);
		}
		if (
			bank.block < 0 ||
			bank.block >= spec.blocks ||
			bank.column < 0 ||
			bank.column >= spec.columns ||
			upperWing.column !== bank.column ||
			lowerWing.column !== bank.column ||
			lowerWing.row !== upperWing.row + 1
		) {
			throw new Error(`합성 FAB process bank ${bank.id}의 block/column/row가 잘못되었습니다`);
		}
		for (const wingId of [upperWing.id, lowerWing.id]) {
			if (bankWingIds.has(wingId)) {
				throw new Error(`합성 FAB Wing ${wingId}가 process bank에서 중복되었습니다`);
			}
			bankWingIds.add(wingId);
		}
		bankIds.add(bank.id);
		bankPositions.add(position);
	}
	if (bankWingIds.size !== wingIds.size) {
		throw new Error("합성 FAB process bank가 모든 Wing을 정확히 한 번 포함해야 합니다");
	}

	if (spec.processBlocks.length !== spec.blocks) {
		throw new Error("합성 FAB process block 수가 block 격자와 일치하지 않습니다");
	}
	const blockIds = new Set<string>();
	const blockIndexes = new Set<number>();
	const blockRows = new Set<number>();
	const blockBankIds = new Set<string>();
	for (const block of spec.processBlocks) {
		if (blockIds.has(block.id)) throw new Error(`중복 합성 FAB process block id: ${block.id}`);
		if (
			!Number.isSafeInteger(block.block) ||
			block.block < 0 ||
			block.block >= spec.blocks ||
			blockIndexes.has(block.block)
		) {
			throw new Error(`중복 또는 잘못된 합성 FAB process block 위치: ${block.block}`);
		}
		if (
			block.lowerRow !== block.upperRow + 1 ||
			block.upperRow < 0 ||
			block.lowerRow >= spec.rows
		) {
			throw new Error(`합성 FAB process block ${block.id}은 연속된 두 row를 가져야 합니다`);
		}
		const leftBank = spec.processBanks.find((bank) => bank.id === block.leftBankId);
		const rightBank = spec.processBanks.find((bank) => bank.id === block.rightBankId);
		if (
			!leftBank ||
			!rightBank ||
			leftBank.block !== block.block ||
			leftBank.column !== 0 ||
			rightBank.block !== block.block ||
			rightBank.column !== 1
		) {
			throw new Error(`합성 FAB process block ${block.id}의 좌우 bank가 잘못되었습니다`);
		}
		for (const bank of [leftBank, rightBank]) {
			const upperWing = spec.wings.find((wingSpec) => wingSpec.id === bank.upperWingId);
			const lowerWing = spec.wings.find((wingSpec) => wingSpec.id === bank.lowerWingId);
			if (
				!upperWing ||
				!lowerWing ||
				upperWing.row !== block.upperRow ||
				lowerWing.row !== block.lowerRow
			) {
				throw new Error(`합성 FAB process block ${block.id}의 bank row가 일치하지 않습니다`);
			}
			if (blockBankIds.has(bank.id)) {
				throw new Error(`합성 FAB process bank ${bank.id}가 block에서 중복되었습니다`);
			}
			blockBankIds.add(bank.id);
		}
		for (const row of [block.upperRow, block.lowerRow]) {
			if (blockRows.has(row)) {
				throw new Error(`합성 FAB row ${row}가 process block에서 중복되었습니다`);
			}
			blockRows.add(row);
		}
		blockIds.add(block.id);
		blockIndexes.add(block.block);
	}
	if (blockRows.size !== spec.rows || blockBankIds.size !== bankIds.size) {
		throw new Error("합성 FAB process block이 모든 row와 bank를 정확히 한 번 포함해야 합니다");
	}
}

function rowProfile(
	id: string,
	label: string,
	westWingId: string,
	westWingLabel: string,
	eastWingId: string,
	eastWingLabel: string,
): SyntheticFabProcessRowProfile {
	return Object.freeze({
		id,
		label,
		westWingId,
		westWingLabel,
		eastWingId,
		eastWingLabel,
	});
}

function formatOrdinal(index: number): string {
	return (index + 1).toString().padStart(2, "0");
}

function createWingBays(
	wingId: string,
	wingLabel: string,
	bayCount: number,
): readonly SyntheticFabProcessBaySpec[] {
	return Object.freeze(
		Array.from({ length: bayCount }, (_, index) =>
			Object.freeze({
				id: `${wingId}-BAY-${formatOrdinal(index)}`,
				label: `${wingLabel} BAY ${formatOrdinal(index)}`,
				index,
			}),
		),
	);
}

function wing(
	id: string,
	label: string,
	row: number,
	column: number,
	bayCount: number,
	laneSpacingMeters: number,
	bays: readonly SyntheticFabProcessBaySpec[],
): SyntheticFabProcessWingSpec {
	return Object.freeze({
		id,
		label,
		row,
		column,
		bayCount,
		laneSpacingMeters,
		bays,
	});
}

function processRow(
	id: string,
	label: string,
	row: number,
	leftWingId: string,
	rightWingId: string,
): SyntheticFabProcessRowSpec {
	return Object.freeze({ id, label, row, leftWingId, rightWingId });
}

function processBank(
	id: string,
	label: string,
	block: number,
	column: number,
	upperWingId: string,
	lowerWingId: string,
): SyntheticFabProcessBankSpec {
	return Object.freeze({ id, label, block, column, upperWingId, lowerWingId });
}

function processBlock(
	id: string,
	label: string,
	block: number,
	upperRow: number,
	lowerRow: number,
	leftBankId: string,
	rightBankId: string,
): SyntheticFabProcessBlockSpec {
	return Object.freeze({
		id,
		label,
		block,
		upperRow,
		lowerRow,
		leftBankId,
		rightBankId,
	});
}

function spineWallLink(
	id: string,
	label: string,
	sourceSpineId: string,
	sourceSide: "north" | "south",
	targetWallCircuitId: string,
	targetSide: "north" | "south",
): SyntheticFabSpineWallLinkSpec {
	return Object.freeze({
		id,
		label,
		sourceSpineId,
		sourceSide,
		targetWallCircuitId,
		targetSide,
	});
}

function wallOuterLink(
	id: string,
	label: string,
	sourceWallCircuitId: string,
	side: SyntheticFabCardinalSide,
	placement: SyntheticFabWallOuterPlacement,
): SyntheticFabWallOuterLinkSpec {
	return Object.freeze({
		id,
		label,
		sourceWallCircuitId,
		sourceSide: side,
		outerSide: side,
		placement,
	});
}

function assertIntegerAtLeast(value: number, minimum: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`합성 FAB ${label}은 ${minimum} m 이상의 정수여야 합니다`);
	}
}

function assertIntegerAtMost(value: number, maximum: number, label: string): void {
	if (!Number.isSafeInteger(value) || value > maximum) {
		throw new Error(`합성 FAB ${label}은 ${maximum} m 이하의 정수여야 합니다`);
	}
}

function addGraphNode(graph: Map<string, Set<string>>, id: string): void {
	if (graph.has(id)) throw new Error(`중복 합성 FAB 논리 node id: ${id}`);
	graph.set(id, new Set());
}

function assertUniqueLinkId(id: string, ids: Set<string>): void {
	if (ids.has(id)) throw new Error(`중복 합성 FAB link id: ${id}`);
	ids.add(id);
}

/**
 * Each topology edge represents a complete OUTBOUND/RETURN construction macro, so it is
 * intentionally bidirectional at this structural level. Low-level rail direction is verified only
 * after materialization by the compiled physical-path SCC gate.
 */
function connectBidirectionalMacroLink(
	graph: Map<string, Set<string>>,
	left: string,
	right: string,
): void {
	graph.get(left)?.add(right);
	graph.get(right)?.add(left);
}

function assertMacroGraphConnectedWithout(
	graph: ReadonlyMap<string, ReadonlySet<string>>,
	blockedNode: string | null,
	startNode: string,
	context: string,
): void {
	if (blockedNode === startNode || !graph.has(startNode)) {
		throw new Error(`합성 FAB macro topology ${context} 연결 검사의 시작점이 유효하지 않습니다`);
	}
	const visited = new Set<string>();
	const pending = [startNode];
	while (pending.length > 0) {
		const current = pending.pop() as string;
		if (current === blockedNode || visited.has(current)) continue;
		visited.add(current);
		for (const neighbor of graph.get(current) ?? []) {
			if (neighbor !== blockedNode) pending.push(neighbor);
		}
	}
	const expectedNodeCount = graph.size - (blockedNode === null ? 0 : 1);
	if (visited.size !== expectedNodeCount) {
		throw new Error(`합성 FAB macro topology가 ${context} 하나로 연결되지 않았습니다`);
	}
}
