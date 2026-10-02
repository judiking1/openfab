import { isSupportedRailCoordinate } from "./RailCoordinateDomain";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import type { RailPatchTransition } from "./RailPatchHistory";
import { directionBetween, oppositeDirection } from "./railShape";
import {
	compareDirectedRailEdges,
	isCanonicalStaticFabOrganizationRecord,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
	staticFabOrganizationRecordShapeErrorSteps,
} from "./StaticFabOrganization";
import { cellKey } from "./TileMap";

export const STATIC_FAB_PROCESS_LOOP_REPAIR_KIND = "repair-static-fab-process-loop";

/** A semantic contract, not a source-bound Apply or permission to bypass ownership/Port guards. */
export function* assertStaticFabProcessLoopRepairTransitionSteps(
	transition: RailPatchTransition,
): Generator<void, { readonly organizationId: number }> {
	if (
		!Array.isArray(transition.changes) ||
		transition.changes.length === 0 ||
		!Array.isArray(transition.organizationChanges) ||
		transition.organizationChanges.length !== 1
	)
		throw new Error("Loop rail repair requires rail changes and exactly one existing owner.");
	for (const changes of [
		transition.switchChanges,
		transition.portChanges,
		transition.equipmentGroupChanges,
		transition.relationshipChanges ?? [],
		transition.organizationImpactAuthorizations ?? [],
	]) {
		if (!Array.isArray(changes) || changes.length !== 0)
			throw new Error(
				"Loop rail repair cannot change sidecars, equipment, relationships or impact authorizations.",
			);
	}
	if (
		(transition.operationalConfigurationPatch ?? null) !== null ||
		!positiveInt32(transition.organizationNextIdBefore) ||
		transition.organizationNextIdBefore !== transition.organizationNextIdAfter ||
		!positiveInt32(transition.relationshipNextIdBefore) ||
		transition.relationshipNextIdBefore !== transition.relationshipNextIdAfter
	)
		throw new Error("Loop rail repair must preserve static cursors and operational configuration.");
	const change = transition.organizationChanges[0];
	if (
		!change?.before ||
		!change.after ||
		!positiveInt32(change.id) ||
		change.before.id !== change.id ||
		change.after.id !== change.id ||
		change.id >= transition.organizationNextIdBefore
	)
		throw new Error("Loop rail repair may update one existing organization ID only.");
	const before = change.before,
		after = change.after;
	for (const record of [before, after]) {
		if (!isCanonicalStaticFabOrganizationRecord(record)) {
			const error = yield* staticFabOrganizationRecordShapeErrorSteps(record);
			if (error) throw new Error(error);
		}
		if (
			record.kind !== "AISLE" ||
			record.declaredSemanticRole !== "PROCESS_LOOP" ||
			staticFabOrganizationParentIds(record).length !== 0
		)
			throw new Error("Loop rail repair requires an explicit parentless AISLE Process Loop.");
	}
	const beforeProperties = staticFabOrganizationProperties(before);
	const afterProperties = staticFabOrganizationProperties(after);
	if (
		before.name !== after.name ||
		beforeProperties.description !== afterProperties.description ||
		beforeProperties.color !== afterProperties.color
	)
		throw new Error("Loop rail repair must preserve owner name and metadata.");
	for (const [left, right] of [
		[before.membership.advancedSwitchIds, after.membership.advancedSwitchIds],
		[before.membership.equipmentGroupIds, after.membership.equipmentGroupIds],
	] as const) {
		if (left.length !== right.length)
			throw new Error("Loop rail repair must preserve switch and direct equipment membership.");
		for (let index = 0; index < left.length; index++) {
			yield;
			if (left[index] !== right[index])
				throw new Error("Loop rail repair must preserve switch and direct equipment membership.");
		}
	}
	const expected = new Map<string, { added: number; removed: number }>();
	const include = (edge: DirectedRailEdge, added: boolean): void => {
		const direction = directionBetween(edge.from, edge.to);
		if (
			direction === null ||
			!isSupportedRailCoordinate(edge.from.x, edge.from.y) ||
			!isSupportedRailCoordinate(edge.to.x, edge.to.y)
		)
			throw new Error("Loop rail repair edges must be supported adjacent cardinal cells.");
		for (const [cell, bits] of [
			[edge.from, direction << 4],
			[edge.to, oppositeDirection(direction)],
		] as const) {
			const key = cellKey(cell.x, cell.y);
			const masks = expected.get(key) ?? { added: 0, removed: 0 };
			if (added) masks.added |= bits;
			else masks.removed |= bits;
			expected.set(key, masks);
		}
	};
	const sourceEdges = before.membership.railEdges,
		targetEdges = after.membership.railEdges;
	let sourceIndex = 0,
		targetIndex = 0;
	while (sourceIndex < sourceEdges.length || targetIndex < targetEdges.length) {
		yield;
		const source = sourceEdges[sourceIndex],
			target = targetEdges[targetIndex];
		const order = source && target ? compareDirectedRailEdges(source, target) : source ? -1 : 1;
		if (order === 0) {
			sourceIndex++;
			targetIndex++;
		} else if (order < 0) {
			include(source as DirectedRailEdge, false);
			sourceIndex++;
		} else {
			include(target as DirectedRailEdge, true);
			targetIndex++;
		}
	}
	const touched = new Set<string>();
	for (const mutation of transition.changes) {
		yield;
		if (
			!isSupportedRailCoordinate(mutation.x, mutation.y) ||
			!byte(mutation.before) ||
			!byte(mutation.after) ||
			mutation.before === mutation.after
		)
			throw new Error("Loop rail repair requires supported nonempty byte mutations.");
		const key = cellKey(mutation.x, mutation.y);
		const masks = expected.get(key);
		if (
			touched.has(key) ||
			!masks ||
			masks.removed !== (mutation.before & ~mutation.after) ||
			masks.added !== (mutation.after & ~mutation.before)
		)
			throw new Error(
				"Loop rail repair cell bits must exactly match the owner's signed edge delta.",
			);
		touched.add(key);
		expected.delete(key);
	}
	if (expected.size !== 0)
		throw new Error("Loop rail repair is missing a reciprocal endpoint mutation.");
	return Object.freeze({ organizationId: change.id });
}

function positiveInt32(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0x7fff_ffff;
}
function byte(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xff;
}
