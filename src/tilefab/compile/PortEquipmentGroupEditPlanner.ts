import {
	applyPortEquipmentMutations,
	equipmentGroupEquals,
	type EquipmentGroupRecord,
	type PortEquipmentState,
} from "../core/EquipmentGroup";
import {
	canonicalEquipmentGroupPortIds,
	copyEquipmentGroupWithPortIds,
	equipmentGroupPortBarcode,
} from "../core/EquipmentGroupPortOrder";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import {
	createInvalidPortEquipmentMutationPlan,
	createPortEquipmentMutationPlan,
	type PortEquipmentMutationPlan,
	type PortEquipmentPlanKind,
} from "../core/PortEquipmentPlan";
import { allocatePortEquipmentRecordIds } from "../core/PortEquipmentIdAllocator";
import { PORT_SIDES, portRecordEquals, type PortRecord, type PortSide } from "../core/PortRecord";
import {
	DIR_E,
	DIR_N,
	DIR_S,
	DIR_W,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import type { TileMap } from "../core/TileMap";
import {
	type CompiledPortSlots,
	PORT_SLOT_STATUS,
	type PortSlotAvailabilityIndex,
} from "./PortSlotCompiler";

export type PortEquipmentGroupEditMode = "move" | "copy";
export type PortEquipmentGroupEditQuarterTurns = 0 | 1 | 2 | 3;
export type PortEquipmentGroupEditValidationMode = "preview" | "commit";

export interface PortEquipmentGroupEditSnapshot {
	readonly equipmentGroup: EquipmentGroupRecord;
	readonly ports: readonly PortRecord[];
	readonly anchorPortId: number;
}

export interface PortEquipmentGroupEditPortTarget {
	readonly sourcePortId: number;
	readonly targetPortId: number;
	readonly row: number;
}

export interface PortEquipmentGroupEditMetadata {
	readonly mode: PortEquipmentGroupEditMode;
	readonly sourceEquipmentGroupId: number;
	readonly targetEquipmentGroupId: number;
	readonly sourceAnchorPortId: number;
	readonly targetAnchorRow: number;
	readonly quarterTurns: PortEquipmentGroupEditQuarterTurns;
	readonly portTargets: readonly PortEquipmentGroupEditPortTarget[];
}

export interface PortEquipmentGroupEditPlan extends PortEquipmentMutationPlan {
	readonly groupEdit: PortEquipmentGroupEditMetadata;
}

/** Revision-bound lookup that keeps pointer-move placement O(group port count). */
export class PortEquipmentGroupSlotIndex {
	readonly revision: number;
	readonly portType: CompiledPortSlots["portType"];
	private readonly sourceSlots: CompiledPortSlots;
	private readonly rowByShape: ReadonlyMap<string, number>;

	constructor(slots: CompiledPortSlots) {
		this.revision = slots.revision;
		this.portType = slots.portType;
		this.sourceSlots = slots;
		const mutable = new Map<string, number>();
		for (let row = 0; row < slots.count; row++) {
			const key = portSlotShapeKeyFromRow(slots, row);
			if (!mutable.has(key)) mutable.set(key, row);
		}
		this.rowByShape = mutable;
	}

	rowForPort(port: PortRecord): number | null {
		if (port.portType !== this.portType || port.route.kind !== "CARDINAL_CELL") return null;
		return this.rowByShape.get(portShapeKey(port)) ?? null;
	}

	matches(slots: CompiledPortSlots): boolean {
		return this.sourceSlots === slots;
	}
}

const portEquipmentGroupSlotIndexCache = new WeakMap<
	CompiledPortSlots,
	PortEquipmentGroupSlotIndex
>();

export function portEquipmentGroupSlotIndexFor(
	slots: CompiledPortSlots,
): PortEquipmentGroupSlotIndex {
	const cached = portEquipmentGroupSlotIndexCache.get(slots);
	if (cached) return cached;
	const created = new PortEquipmentGroupSlotIndex(slots);
	portEquipmentGroupSlotIndexCache.set(slots, created);
	return created;
}

export function capturePortEquipmentGroupEditSnapshot(
	state: PortEquipmentState,
	equipmentGroupId: number,
	anchorPortId?: number,
): PortEquipmentGroupEditSnapshot {
	const equipmentGroup = state.equipmentGroups.find(
		(candidate) => candidate.id === equipmentGroupId,
	);
	if (!equipmentGroup) throw new Error(`Equipment group ${equipmentGroupId} no longer exists.`);
	if (equipmentGroup.kind === "OHB") {
		throw new Error("OHB equipment uses the single-port slot editor.");
	}
	if (equipmentGroup.kind === "STK" && equipmentGroup.template === "CUSTOM") {
		throw new Error("Legacy CUSTOM STK equipment cannot use modular group editing.");
	}
	const portById = new Map(state.ports.map((port) => [port.id, port] as const));
	const ports = equipmentGroup.portIds.map((portId) => {
		const port = portById.get(portId);
		if (
			!port ||
			port.equipmentGroupId !== equipmentGroup.id ||
			port.portType !== equipmentGroup.kind
		) {
			throw new Error(
				`Equipment group ${equipmentGroup.id} has an incomplete reciprocal port set.`,
			);
		}
		if (
			port.route.kind !== "CARDINAL_CELL" ||
			port.route.from === 0 ||
			port.route.to === 0 ||
			port.route.to !== oppositeDirection(port.route.from)
		) {
			throw new Error(`PORT-${port.id} is not attached to a straight cardinal rail slot.`);
		}
		return port;
	});
	const resolvedAnchorPortId = anchorPortId ?? equipmentGroup.portIds[0];
	if (!ports.some((port) => port.id === resolvedAnchorPortId)) {
		throw new Error(
			`PORT-${resolvedAnchorPortId} does not belong to equipment group ${equipmentGroup.id}.`,
		);
	}
	return Object.freeze({
		equipmentGroup,
		ports: Object.freeze([...ports]),
		anchorPortId: resolvedAnchorPortId as number,
	});
}

export function planPortEquipmentGroupEdit(
	map: TileMap,
	slots: CompiledPortSlots,
	slotIndex: PortEquipmentGroupSlotIndex,
	availability: PortSlotAvailabilityIndex,
	state: PortEquipmentState,
	sourceEquipmentGroupId: number,
	sourceAnchorPortId: number,
	targetAnchorRow: number,
	mode: PortEquipmentGroupEditMode,
	baseRevision: number,
	basePatchSequence: number,
	validationMode: PortEquipmentGroupEditValidationMode = "commit",
): PortEquipmentGroupEditPlan {
	const kind = editPlanKind(state, sourceEquipmentGroupId, mode);
	const emptyMetadata = metadata(
		mode,
		sourceEquipmentGroupId,
		0,
		sourceAnchorPortId,
		targetAnchorRow,
		0,
		[],
	);
	if (
		slots.revision !== baseRevision ||
		slotIndex.revision !== baseRevision ||
		availability.revision !== baseRevision ||
		!slotIndex.matches(slots) ||
		!availability.matchesState(state)
	) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			"Port slot data is stale.",
		);
	}
	if (slots.portType !== slotIndex.portType || slots.portType !== availability.portType) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			"Port slot catalogs use different equipment types.",
		);
	}
	if (!Number.isInteger(targetAnchorRow) || targetAnchorRow < 0 || targetAnchorRow >= slots.count) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			`Target slot row ${targetAnchorRow} is outside the compiled slot buffer.`,
		);
	}
	let snapshot: PortEquipmentGroupEditSnapshot;
	try {
		snapshot = capturePortEquipmentGroupEditSnapshot(
			state,
			sourceEquipmentGroupId,
			sourceAnchorPortId,
		);
	} catch (error) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			error instanceof Error ? error.message : "Equipment group cannot be captured.",
		);
	}
	if (snapshot.equipmentGroup.kind !== slots.portType) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			`${snapshot.equipmentGroup.kind} editing requires ${snapshot.equipmentGroup.kind} slots.`,
		);
	}

	const sourceAnchor = snapshot.ports.find((port) => port.id === sourceAnchorPortId) as PortRecord;
	const targetAnchor = portShapeFromSlot(slots, targetAnchorRow, sourceAnchor);
	const quarterTurns = quarterTurnsBetween(
		sourceAnchor.route.kind === "CARDINAL_CELL" ? sourceAnchor.route.to : 0,
		targetAnchor.route.kind === "CARDINAL_CELL" ? targetAnchor.route.to : 0,
	);
	if (quarterTurns === null) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			emptyMetadata,
			"Source and target anchor directions cannot be aligned.",
		);
	}

	let targetEquipmentGroupId = sourceEquipmentGroupId;
	let targetPortIds = snapshot.ports.map((port) => port.id);
	if (mode === "copy") {
		try {
			const allocation = allocatePortEquipmentRecordIds(state, snapshot.ports.length, 1);
			targetEquipmentGroupId = allocation.equipmentGroupIds[0] as number;
			targetPortIds = [...allocation.portIds];
		} catch (error) {
			return invalid(
				kind,
				baseRevision,
				basePatchSequence,
				emptyMetadata,
				error instanceof Error ? error.message : "Equipment group IDs cannot be allocated.",
			);
		}
	}

	const targetPorts: PortRecord[] = [];
	for (let index = 0; index < snapshot.ports.length; index++) {
		const sourcePort = snapshot.ports[index] as PortRecord;
		const targetPortId = targetPortIds[index] as number;
		let targetPort: PortRecord;
		try {
			targetPort = transformPortToAnchor(
				sourcePort,
				sourceAnchor,
				targetAnchor,
				quarterTurns,
				targetPortId,
				targetEquipmentGroupId,
			);
		} catch (error) {
			return invalid(
				kind,
				baseRevision,
				basePatchSequence,
				metadata(
					mode,
					sourceEquipmentGroupId,
					targetEquipmentGroupId,
					sourceAnchorPortId,
					targetAnchorRow,
					quarterTurns,
					[],
				),
				error instanceof Error ? error.message : `PORT-${sourcePort.id} cannot be transformed.`,
			);
		}
		targetPorts.push(targetPort);
	}

	const portTargets: PortEquipmentGroupEditPortTarget[] = [];
	let validationError: string | null = null;
	for (let index = 0; index < targetPorts.length; index++) {
		const targetPort = targetPorts[index] as PortRecord;
		const sourcePort = snapshot.ports[index] as PortRecord;
		const targetPortId = targetPort.id;
		const row = slotIndex.rowForPort(targetPort);
		if (row === null) {
			validationError ??= `PORT-${sourcePort.id} has no matching rail slot after transformation.`;
			continue;
		}
		portTargets.push(Object.freeze({ sourcePortId: sourcePort.id, targetPortId, row }));
		if ((slots.statuses[row] as number) !== PORT_SLOT_STATUS.LEGAL) {
			validationError ??= `PORT-${sourcePort.id} maps to an unsafe rail slot.`;
			continue;
		}
		const availabilityResult =
			mode === "move"
				? availability.statusForEquipmentGroup(slots, row, sourceEquipmentGroupId)
				: availability.statusFor(slots, row);
		if (availabilityResult.status !== PORT_SLOT_STATUS.LEGAL) {
			const conflict =
				availabilityResult.conflictingPortId !== 0
					? `PORT-${availabilityResult.conflictingPortId}`
					: availabilityResult.conflictingEquipmentGroupId !== 0
						? `equipment group ${availabilityResult.conflictingEquipmentGroupId}`
						: "the static clearance envelope";
			validationError ??= `PORT-${sourcePort.id} conflicts with ${conflict}.`;
		}
	}
	if (new Set(portTargets.map((target) => target.row)).size !== portTargets.length) {
		validationError ??= "Multiple group ports map to the same rail slot.";
	}
	if (snapshot.equipmentGroup.kind === "STK") {
		const conflictingGroupId = availability.conflictingEquipmentGroupForStkRows(
			slots,
			portTargets.map((target) => target.row),
			mode === "move" ? sourceEquipmentGroupId : 0,
		);
		if (conflictingGroupId !== 0) {
			validationError ??= `STK body span overlaps equipment group ${conflictingGroupId}.`;
		}
	}
	const editMetadata = metadata(
		mode,
		sourceEquipmentGroupId,
		targetEquipmentGroupId,
		sourceAnchorPortId,
		targetAnchorRow,
		quarterTurns,
		portTargets,
	);
	if (validationError) {
		return invalid(kind, baseRevision, basePatchSequence, editMetadata, validationError);
	}

	let targetGroup: EquipmentGroupRecord;
	let finalTargetPorts: readonly PortRecord[];
	try {
		const canonicalIds = canonicalEquipmentGroupPortIds(
			snapshot.equipmentGroup,
			targetPorts.map((port) => port.id),
			targetPorts,
		);
		targetGroup = copyEquipmentGroupWithPortIds(
			snapshot.equipmentGroup,
			targetEquipmentGroupId,
			canonicalIds,
		);
		const canonicalIndex = new Map(canonicalIds.map((id, index) => [id, index] as const));
		finalTargetPorts = Object.freeze(
			targetPorts.map((port) =>
				Object.freeze({
					...port,
					barcode:
						mode === "move"
							? port.barcode
							: equipmentGroupPortBarcode(
									targetGroup.kind,
									targetGroup.id,
									port.id,
									canonicalIndex.get(port.id) as number,
								),
				}),
			),
		);
	} catch (error) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			metadata(
				mode,
				sourceEquipmentGroupId,
				targetEquipmentGroupId,
				sourceAnchorPortId,
				targetAnchorRow,
				quarterTurns,
				portTargets,
			),
			error instanceof Error ? error.message : "Equipment group order cannot be canonicalized.",
		);
	}

	const portMutations =
		mode === "move"
			? finalTargetPorts
					.map((after) => {
						const before = snapshot.ports.find((port) => port.id === after.id) as PortRecord;
						return Object.freeze({ id: after.id, before, after });
					})
					.filter((mutation) => !portRecordEquals(mutation.before, mutation.after))
			: finalTargetPorts.map((after) => Object.freeze({ id: after.id, before: null, after }));
	const equipmentGroupMutations =
		mode === "move"
			? equipmentGroupEquals(snapshot.equipmentGroup, targetGroup)
				? []
				: [
						Object.freeze({
							id: snapshot.equipmentGroup.id,
							before: snapshot.equipmentGroup,
							after: targetGroup,
						}),
					]
			: [
					Object.freeze({
						id: targetGroup.id,
						before: null,
						after: targetGroup,
					}),
				];
	if (portMutations.length === 0 && equipmentGroupMutations.length === 0) {
		return invalid(
			kind,
			baseRevision,
			basePatchSequence,
			editMetadata,
			"Choose a different legal target for this equipment group.",
		);
	}
	if (validationMode === "commit") {
		try {
			const prospective = applyPortEquipmentMutations(
				state,
				portMutations,
				equipmentGroupMutations,
			);
			assertPortEquipmentLayout(map, prospective);
		} catch (error) {
			return invalid(
				kind,
				baseRevision,
				basePatchSequence,
				editMetadata,
				error instanceof Error ? error.message : "Prospective equipment layout is invalid.",
			);
		}
	}
	const base = createPortEquipmentMutationPlan(
		kind,
		baseRevision,
		basePatchSequence,
		portMutations,
		equipmentGroupMutations,
	);
	return Object.freeze({
		...base,
		reason: `${snapshot.equipmentGroup.kind} group ${mode === "move" ? "move" : "copy"} is valid for ${portTargets.length} ports.`,
		groupEdit: editMetadata,
	});
}

function editPlanKind(
	state: PortEquipmentState,
	equipmentGroupId: number,
	mode: PortEquipmentGroupEditMode,
): PortEquipmentPlanKind {
	if (mode === "move") return "edit-port-equipment";
	const group = state.equipmentGroups.find((candidate) => candidate.id === equipmentGroupId);
	return group?.kind === "STK" ? "place-stk" : "place-eq";
}

function transformPortToAnchor(
	source: PortRecord,
	sourceAnchor: PortRecord,
	targetAnchor: PortRecord,
	quarterTurns: PortEquipmentGroupEditQuarterTurns,
	targetPortId: number,
	targetEquipmentGroupId: number,
): PortRecord {
	if (
		source.route.kind !== "CARDINAL_CELL" ||
		sourceAnchor.route.kind !== "CARDINAL_CELL" ||
		targetAnchor.route.kind !== "CARDINAL_CELL"
	) {
		throw new Error(`PORT-${source.id} is not a cardinal modular port.`);
	}
	const relative = {
		x: source.route.x - sourceAnchor.route.x,
		y: source.route.z - sourceAnchor.route.z,
	};
	const rotated = rotateOffset(relative, quarterTurns);
	const from = rotateDirection(source.route.from, quarterTurns);
	const to = rotateDirection(source.route.to, quarterTurns);
	if (from === 0 || to === 0) throw new Error(`PORT-${source.id} has an open route.`);
	return {
		...source,
		id: targetPortId,
		equipmentGroupId: targetEquipmentGroupId,
		route: {
			kind: "CARDINAL_CELL",
			x: targetAnchor.route.x + rotated.x,
			z: targetAnchor.route.z + rotated.y,
			from,
			to,
		},
	};
}

function portShapeFromSlot(slots: CompiledPortSlots, row: number, source: PortRecord): PortRecord {
	return {
		...source,
		route: {
			kind: "CARDINAL_CELL",
			x: slots.routeXs[row] as number,
			z: slots.routeZs[row] as number,
			from: slots.routeFromDirections[row] as Direction,
			to: slots.routeToDirections[row] as Direction,
		},
		stationMillimeters: slots.stationMillimeters[row] as number,
		side: PORT_SIDES[slots.sides[row] as number] as PortSide,
		lateralOffsetMillimeters: slots.lateralOffsetMillimeters[row] as number,
	};
}

function portShapeKey(port: PortRecord): string {
	if (port.route.kind !== "CARDINAL_CELL") return "";
	return [
		port.route.x,
		port.route.z,
		port.route.from,
		port.route.to,
		port.stationMillimeters,
		port.side,
		port.lateralOffsetMillimeters,
	].join(":");
}

function portSlotShapeKeyFromRow(slots: CompiledPortSlots, row: number): string {
	return [
		slots.routeXs[row],
		slots.routeZs[row],
		slots.routeFromDirections[row],
		slots.routeToDirections[row],
		slots.stationMillimeters[row],
		PORT_SIDES[slots.sides[row] as number],
		slots.lateralOffsetMillimeters[row],
	].join(":");
}

function quarterTurnsBetween(
	source: 0 | Direction,
	target: 0 | Direction,
): PortEquipmentGroupEditQuarterTurns | null {
	if (source === 0 || target === 0) return null;
	const directions = [DIR_N, DIR_E, DIR_S, DIR_W] as const;
	const sourceIndex = directions.indexOf(source);
	const targetIndex = directions.indexOf(target);
	if (sourceIndex < 0 || targetIndex < 0) return null;
	return ((targetIndex - sourceIndex + directions.length) %
		directions.length) as PortEquipmentGroupEditQuarterTurns;
}

function rotateOffset(
	offset: Readonly<{ x: number; y: number }>,
	quarterTurns: PortEquipmentGroupEditQuarterTurns,
): Readonly<{ x: number; y: number }> {
	if (quarterTurns === 0) return offset;
	if (quarterTurns === 1) return { x: -offset.y, y: offset.x };
	if (quarterTurns === 2) return { x: -offset.x, y: -offset.y };
	return { x: offset.y, y: -offset.x };
}

function rotateDirection(
	direction: 0 | Direction,
	quarterTurns: PortEquipmentGroupEditQuarterTurns,
): 0 | Direction {
	if (direction === 0) return 0;
	const vector = moveCell({ x: 0, y: 0 }, direction);
	const rotated = rotateOffset(vector, quarterTurns);
	const resolved = directionBetween({ x: 0, y: 0 }, rotated);
	if (resolved === null) throw new Error("Cardinal direction rotation failed.");
	return resolved;
}

function metadata(
	mode: PortEquipmentGroupEditMode,
	sourceEquipmentGroupId: number,
	targetEquipmentGroupId: number,
	sourceAnchorPortId: number,
	targetAnchorRow: number,
	quarterTurns: PortEquipmentGroupEditQuarterTurns,
	portTargets: readonly PortEquipmentGroupEditPortTarget[],
): PortEquipmentGroupEditMetadata {
	return Object.freeze({
		mode,
		sourceEquipmentGroupId,
		targetEquipmentGroupId,
		sourceAnchorPortId,
		targetAnchorRow,
		quarterTurns,
		portTargets: Object.freeze([...portTargets]),
	});
}

function invalid(
	kind: PortEquipmentPlanKind,
	baseRevision: number,
	basePatchSequence: number,
	groupEdit: PortEquipmentGroupEditMetadata,
	reason: string,
): PortEquipmentGroupEditPlan {
	return Object.freeze({
		...createInvalidPortEquipmentMutationPlan(kind, baseRevision, basePatchSequence, reason),
		groupEdit,
	});
}
