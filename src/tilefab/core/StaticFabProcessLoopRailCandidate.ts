import { stableSortSteps } from "./CooperativeSort";
import { type CooperativeTask, createCooperativeTask } from "./CooperativeTask";
import {
	type DirectedRailEdge,
	type RailModuleOwnershipIndex,
	railModuleOwnershipIndexMatchesMap,
} from "./RailModuleOwnership";
import { moveCell, oppositeDirection } from "./railShape";
import {
	compareDirectedRailEdges,
	isCanonicalStaticFabOrganizationState,
	type StaticFabOrganizationKind,
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationState,
	staticFabOrganizationEdgeKey,
} from "./StaticFabOrganization";
import type { StaticFabSelection } from "./StaticFabSelection";
import { cellKey, type TileMap } from "./TileMap";

export interface StaticFabProcessLoopRailCandidateSource {
	readonly map: TileMap;
	readonly ownership: RailModuleOwnershipIndex;
	readonly organizations: StaticFabOrganizationState;
	readonly patchSequence: number;
	readonly selection: StaticFabSelection;
}

/** A rail-only membership candidate; it grants no topology, declaration or command authority. */
export interface StaticFabProcessLoopRailCandidate {
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly moduleKeys: readonly string[];
	/** Existing serializable whole-module union; external switch joins are derived. */
	readonly membership: StaticFabOrganizationMembership;
	/** Candidate topology and overlap scope, including verified selected-module switch joins. */
	readonly topologyMembership: StaticFabOrganizationMembership;
}

export type StaticFabProcessLoopRailCandidateError =
	| Readonly<{ code: "EMPTY_SELECTION" | "STALE_SOURCE" | "CANCELLED" }>
	| Readonly<{ code: "EQUIPMENT_SELECTED"; count: number }>
	| Readonly<{ code: "INVALID_MODULE" | "WHOLE_MODULE_REQUIRED"; moduleKey: string }>
	| Readonly<{
			code: "STORED_MEMBERSHIP_OVERLAP";
			organizationId: number;
			organizationKind: StaticFabOrganizationKind;
			reference:
				| Readonly<{ kind: "DIRECTED_EDGE"; edge: DirectedRailEdge }>
				| Readonly<{ kind: "ADVANCED_SWITCH"; id: number }>;
	  }>;

export type StaticFabProcessLoopRailCandidateResult =
	| Readonly<{ valid: true; candidate: StaticFabProcessLoopRailCandidate }>
	| Readonly<{ valid: false; error: StaticFabProcessLoopRailCandidateError }>;

export interface StaticFabProcessLoopRailCandidatePreparation
	extends CooperativeTask<StaticFabProcessLoopRailCandidateResult> {
	cancel(): void;
}

interface CandidateBinding extends StaticFabProcessLoopRailCandidateSource {
	readonly revision: number;
	readonly mutationGeneration: number;
	readonly active: () => boolean;
}

const candidateBindings = new WeakMap<object, CandidateBinding>();

/**
 * Prepare exact immutable membership without cloning the source map. The required caller guard
 * must include live document/selection identity and patch sequence, including port-only edits.
 */
export function createStaticFabProcessLoopRailCandidatePreparation(
	source: StaticFabProcessLoopRailCandidateSource,
	isCurrent: () => boolean,
): StaticFabProcessLoopRailCandidatePreparation {
	let cancelled = false;
	let invalidated: StaticFabProcessLoopRailCandidateResult | null = null;
	const binding: CandidateBinding = Object.freeze({
		map: source.map,
		ownership: source.ownership,
		organizations: source.organizations,
		patchSequence: source.patchSequence,
		selection: source.selection,
		revision: source.map.getRevision(),
		mutationGeneration: source.map.getMutationGeneration(),
		active: () => {
			if (cancelled || invalidated) return false;
			if (!isCurrent()) {
				invalidate({ code: "STALE_SOURCE" });
				return false;
			}
			return true;
		},
	});
	const steps = prepareSteps(binding);
	let task: CooperativeTask<StaticFabProcessLoopRailCandidateResult> | null =
		createCooperativeTask(steps);
	function invalidate(error: StaticFabProcessLoopRailCandidateError): void {
		if (invalidated) return;
		invalidated = reject(error);
		// Release partial sets/arrays even if a cancelled preparation is temporarily retained.
		task = null;
		steps.return(invalidated);
	}
	const check = (): void => {
		if (invalidated) return;
		if (cancelled) invalidate({ code: "CANCELLED" });
		else if (!bindingMatchesSource(binding, source)) invalidate({ code: "STALE_SOURCE" });
	};
	return {
		get done() {
			check();
			return invalidated !== null || task === null || task.done;
		},
		step(operationBudget = 128) {
			if (!Number.isSafeInteger(operationBudget) || operationBudget <= 0)
				throw new Error("Process Loop candidate operation budget must be a positive safe integer.");
			check();
			if (invalidated || task === null) return 0;
			const operations = task.step(operationBudget);
			check();
			return operations;
		},
		finish() {
			check();
			if (invalidated) return invalidated;
			if (task === null) throw new Error("Process Loop preparation was discarded.");
			return task.finish();
		},
		cancel() {
			cancelled = true;
			check();
		},
	};
}

/** Reject copied/forged candidates and every different or mutated authored source generation. */
export function staticFabProcessLoopRailCandidateMatchesSource(
	candidate: unknown,
	source: StaticFabProcessLoopRailCandidateSource,
): candidate is StaticFabProcessLoopRailCandidate {
	if (typeof candidate !== "object" || candidate === null) return false;
	const binding = candidateBindings.get(candidate);
	return binding !== undefined && bindingMatchesSource(binding, source);
}

function bindingMatchesSource(
	binding: CandidateBinding,
	source: StaticFabProcessLoopRailCandidateSource,
): boolean {
	return (
		binding.map === source.map &&
		binding.ownership === source.ownership &&
		binding.organizations === source.organizations &&
		binding.selection === source.selection &&
		binding.patchSequence === source.patchSequence &&
		binding.revision === source.map.getRevision() &&
		binding.mutationGeneration === source.map.getMutationGeneration() &&
		railModuleOwnershipIndexMatchesMap(source.ownership, source.map) &&
		binding.active()
	);
}

function* prepareSteps(
	source: CandidateBinding,
): Generator<void, StaticFabProcessLoopRailCandidateResult> {
	const selection = source.selection;
	if (
		!Number.isSafeInteger(source.patchSequence) ||
		source.patchSequence < 0 ||
		selection.basePatchSequence !== source.patchSequence ||
		selection.baseRevision !== source.revision ||
		selection.rail.revision !== source.revision ||
		!isCanonicalStaticFabOrganizationState(source.organizations) ||
		!Object.isFrozen(selection) ||
		!Object.isFrozen(selection.rail) ||
		!Object.isFrozen(selection.rail.ownerships) ||
		!Object.isFrozen(selection.equipmentGroups)
	)
		return reject({ code: "STALE_SOURCE" });
	if (selection.equipmentGroups.length > 0)
		return reject({ code: "EQUIPMENT_SELECTED", count: selection.equipmentGroups.length });
	if (selection.rail.ownerships.length === 0) return reject({ code: "EMPTY_SELECTION" });

	const moduleKeys: string[] = [];
	const seenModules = new Set<string>();
	const edgesByKey = new Map<string, DirectedRailEdge>();
	const switchIds = new Set<number>();
	const selectedCells = new Set<string>();
	for (const selected of selection.rail.ownerships) {
		if (seenModules.has(selected.key) || source.ownership.find(selected.key) !== selected)
			return reject({ code: "INVALID_MODULE", moduleKey: selected.key });
		seenModules.add(selected.key);
		moduleKeys.push(selected.key);
		yield;
		for (const edge of selected.eraseEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			if (!edgesByKey.has(key)) edgesByKey.set(key, copyEdge(edge));
			selectedCells.add(cellKey(edge.from.x, edge.from.y));
			selectedCells.add(cellKey(edge.to.x, edge.to.y));
			yield;
		}
		if (selected.advancedSwitchId !== null) switchIds.add(selected.advancedSwitchId);
		yield;
	}
	if (edgesByKey.size === 0 && switchIds.size === 0) return reject({ code: "EMPTY_SELECTION" });
	const boundaryEdges = new Map<string, DirectedRailEdge>();

	// Switch erase footprints exclude external joins. Include only real boundary edges whose
	// switch and outside rail module are both already selected; never expand to another module.
	for (const id of switchIds) {
		const record = source.map.getAdvancedSwitch(id);
		if (!record) return reject({ code: "INVALID_MODULE", moduleKey: `SW-${id}` });
		for (const port of deriveAdvancedSwitchGeometry(record).ports) {
			const outside = moveCell(port.cell, port.direction);
			if (selectedCells.has(cellKey(outside.x, outside.y))) {
				const from = port.role === "input" ? outside : port.cell;
				const to = port.role === "input" ? port.cell : outside;
				const direction =
					port.role === "input" ? oppositeDirection(port.direction) : port.direction;
				if (
					(source.map.getRail(from.x, from.y).outgoing & direction) !== 0 &&
					(source.map.getRail(to.x, to.y).incoming & oppositeDirection(direction)) !== 0
				) {
					const edge = copyEdge({ from, to });
					const key = staticFabOrganizationEdgeKey(edge);
					if (!edgesByKey.has(key)) boundaryEdges.set(key, edge);
				}
			}
			yield;
		}
	}

	// Every touched module must be included completely; never silently expand the selection.
	for (const module of source.ownership.modules) {
		let touched = module.advancedSwitchId !== null && switchIds.has(module.advancedSwitchId);
		let complete = module.advancedSwitchId === null || switchIds.has(module.advancedSwitchId);
		yield;
		for (const edge of module.eraseEdges) {
			const present = edgesByKey.has(staticFabOrganizationEdgeKey(edge));
			touched ||= present;
			complete &&= present;
			yield;
		}
		if (touched && !complete)
			return reject({ code: "WHOLE_MODULE_REQUIRED", moduleKey: module.key });
	}
	for (const record of source.organizations.records) {
		yield;
		for (const edge of record.membership.railEdges) {
			const key = staticFabOrganizationEdgeKey(edge);
			const candidateEdge = edgesByKey.get(key) ?? boundaryEdges.get(key);
			if (candidateEdge)
				return reject({
					code: "STORED_MEMBERSHIP_OVERLAP",
					organizationId: record.id,
					organizationKind: record.kind,
					reference: Object.freeze({ kind: "DIRECTED_EDGE", edge: candidateEdge }),
				});
			yield;
		}
		for (const id of record.membership.advancedSwitchIds) {
			if (switchIds.has(id))
				return reject({
					code: "STORED_MEMBERSHIP_OVERLAP",
					organizationId: record.id,
					organizationKind: record.kind,
					reference: Object.freeze({ kind: "ADVANCED_SWITCH", id }),
				});
			yield;
		}
	}
	const railEdges: DirectedRailEdge[] = [];
	for (const edge of edgesByKey.values()) {
		railEdges.push(edge);
		yield;
	}
	const advancedSwitchIds: number[] = [];
	for (const id of switchIds) {
		advancedSwitchIds.push(id);
		yield;
	}
	yield* stableSortSteps(moduleKeys, compareStrings);
	yield* stableSortSteps(railEdges, compareDirectedRailEdges);
	yield* stableSortSteps(advancedSwitchIds, (left, right) => left - right);
	const topologyEdges: DirectedRailEdge[] = [];
	for (const edge of railEdges) {
		topologyEdges.push(edge);
		yield;
	}
	for (const edge of boundaryEdges.values()) {
		topologyEdges.push(edge);
		yield;
	}
	yield* stableSortSteps(topologyEdges, compareDirectedRailEdges);
	const frozenSwitchIds = Object.freeze(advancedSwitchIds);
	const equipmentGroupIds = Object.freeze([] as number[]);
	const candidate: StaticFabProcessLoopRailCandidate = Object.freeze({
		baseRevision: source.revision,
		basePatchSequence: source.patchSequence,
		moduleKeys: Object.freeze(moduleKeys),
		membership: Object.freeze({
			railEdges: Object.freeze(railEdges),
			advancedSwitchIds: frozenSwitchIds,
			equipmentGroupIds,
		}),
		topologyMembership: Object.freeze({
			railEdges: Object.freeze(topologyEdges),
			advancedSwitchIds: frozenSwitchIds,
			equipmentGroupIds,
		}),
	});
	candidateBindings.set(candidate, source);
	return Object.freeze({ valid: true, candidate });
}

function copyEdge(edge: DirectedRailEdge): DirectedRailEdge {
	return Object.freeze({
		from: Object.freeze({ x: edge.from.x, y: edge.from.y }),
		to: Object.freeze({ x: edge.to.x, y: edge.to.y }),
	});
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function reject(
	error: StaticFabProcessLoopRailCandidateError,
): StaticFabProcessLoopRailCandidateResult {
	return Object.freeze({ valid: false, error: Object.freeze(error) });
}

import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
