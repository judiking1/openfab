import { deriveAdvancedSwitchGeometry } from "./AdvancedSwitch";
import type { PortEquipmentState } from "./EquipmentGroup";
import { analyzeRailNetwork } from "./network";
import { lShapedPath, planRailPath, type RailConstructionPlan, type RailMutation } from "./paint";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import { type RailPatchTransition, railPatchTransitionFingerprint } from "./RailPatchHistory";
import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	directionBetween,
	moveCell,
	oppositeDirection,
} from "./railShape";
import type { StaticFabAssemblyRelationshipStateV1 } from "./StaticFabAssemblyRelationship";
import {
	applyStaticFabOrganizationMutations,
	compareDirectedRailEdges,
	copyStaticFabOrganizationRecord,
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationMutation,
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationDeclaredSemanticRole,
	staticFabOrganizationEdgeKey,
	staticFabOrganizationParentIds,
	staticFabOrganizationStateError,
} from "./StaticFabOrganization";
import {
	StaticFabOrganizationImpactIndex,
	staticFabOrganizationImpactsForPatch,
} from "./StaticFabOrganizationImpactIndex";
import { type Cell, cellKey, encodeRailCell, TileMap } from "./TileMap";

export const STATIC_FAB_AISLE_INTEGRATION_KIND = "integrate-static-fab-aisle" as const;
export const STATIC_FAB_AISLE_INTEGRATION_VERSION = 1 as const;
export const STATIC_FAB_AISLE_INTEGRATION_MAX_EDGES = 4_096;
export const STATIC_FAB_AISLE_INTEGRATION_MAX_GAP = 128;

export interface StaticFabAisleIntegrationIntent {
	readonly version: typeof STATIC_FAB_AISLE_INTEGRATION_VERSION;
	readonly aisleOrganizationId: number;
	readonly bayOrganizationId: number;
	readonly entryGateway: Cell;
	readonly exitGateway: Cell;
}

export interface StaticFabAisleIntegrationPlan {
	readonly kind: typeof STATIC_FAB_AISLE_INTEGRATION_KIND;
	readonly intent: StaticFabAisleIntegrationIntent;
	readonly baseRevision: number;
	readonly basePatchSequence: number;
	readonly draft: RailConstructionPlan;
	readonly entryCells: readonly Cell[];
	readonly exitCells: readonly Cell[];
	readonly organizationMutations: readonly StaticFabOrganizationMutation[];
	readonly organizationImpactAuthorizations: readonly number[];
	readonly nextOrganizationId: number;
	readonly valid: boolean;
	readonly reason: string;
	readonly conflicts: readonly Cell[];
}

export interface StaticFabAisleIntegrationSource {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
}

export interface StaticFabAisleIntegrationOption {
	readonly id: string;
	readonly entryGateway: Cell;
	readonly exitGateway: Cell;
	readonly lengthMeters: number;
}

/** Only this explicit command admits an open, detached, exclusively owned AISLE. */
export function staticFabAisleIntegrationSourceError(
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
	id: number,
): string | null {
	const aisle = organizations.records.find((record) => record.id === id);
	if (!aisle || aisle.kind !== "AISLE") return "편입할 구역 하나를 선택하세요";
	if (staticFabOrganizationDeclaredSemanticRole(aisle) === "PROCESS_LOOP")
		return "독립 Process Loop는 구역 편입 대상이 아닙니다";
	if (
		staticFabOrganizationParentIds(aisle).length ||
		organizations.records.some((record) => staticFabOrganizationParentIds(record).includes(id))
	)
		return "부모·하위 조직이 없는 구역만 편입할 수 있습니다";
	if (
		relationships.records.some(
			(record) =>
				record.parentOrganizationId === id ||
				record.participantOrganizationIds.includes(id) ||
				record.managedChildOrganizationIds.includes(id),
		)
	)
		return "조립 관계가 있는 구역은 편입할 수 없습니다";
	if (
		aisle.membership.advancedSwitchIds.length ||
		!aisle.membership.railEdges.length ||
		aisle.membership.railEdges.length > STATIC_FAB_AISLE_INTEGRATION_MAX_EDGES
	)
		return "일반 레일로 된 작은 구역만 편입할 수 있습니다";
	const edges = new Set(aisle.membership.railEdges.map(staticFabOrganizationEdgeKey));
	const equipment = new Set(aisle.membership.equipmentGroupIds);
	if (
		organizations.records.some(
			(record) =>
				record.id !== id &&
				(record.membership.railEdges.some((edge) =>
					edges.has(staticFabOrganizationEdgeKey(edge)),
				) ||
					record.membership.equipmentGroupIds.some((group) => equipment.has(group))),
		)
	)
		return "다른 조직과 레일·장비 소속을 공유하는 구역은 편입할 수 없습니다";
	return null;
}

export function staticFabAisleIntegrationIntentError(value: unknown): string | null {
	if (!value || typeof value !== "object") return "구역 편입 명령이 없습니다";
	const intent = value as StaticFabAisleIntegrationIntent;
	if (
		Object.keys(value).sort().join() !==
			["version", "aisleOrganizationId", "bayOrganizationId", "entryGateway", "exitGateway"]
				.sort()
				.join() ||
		intent.version !== STATIC_FAB_AISLE_INTEGRATION_VERSION
	)
		return "구역 편입 명령 형식이 다릅니다";
	if (
		![intent.aisleOrganizationId, intent.bayOrganizationId].every(
			(id) => Number.isSafeInteger(id) && id > 0 && id <= 0x7fffffff,
		) ||
		intent.aisleOrganizationId === intent.bayOrganizationId
	)
		return "구역·Bay 조직 ID가 유효하지 않습니다";
	for (const cell of [intent.entryGateway, intent.exitGateway]) {
		if (
			!cell ||
			typeof cell !== "object" ||
			Object.keys(cell).sort().join() !== "x,y" ||
			!Number.isInteger(cell.x) ||
			!Number.isInteger(cell.y) ||
			Math.abs(cell.x) > 130_048 ||
			Math.abs(cell.y) > 130_048
		)
			return "연결 위치가 유효하지 않습니다";
	}
	return null;
}

export function discoverStaticFabAisleIntegrationOptions(
	source: StaticFabAisleIntegrationSource,
	aisleOrganizationId: number,
	bayOrganizationId: number,
): readonly StaticFabAisleIntegrationOption[] {
	const { aisle, bay, entry, exit } = resolveSource(source, aisleOrganizationId, bayOrganizationId);
	const owned = new Set(bay.membership.railEdges.map(staticFabOrganizationEdgeKey));
	const cells = membershipCells(bay);
	const straight = [...cells.values()].filter((cell) => {
		const rail = source.map.getRail(cell.x, cell.y);
		if (
			bitCount(rail.incoming) !== 1 ||
			bitCount(rail.outgoing) !== 1 ||
			oppositeDirection(rail.incoming as Direction) !== rail.outgoing
		)
			return false;
		return ALL_DIRECTIONS.every((direction) => {
			if (rail.outgoing & direction)
				return owned.has(
					staticFabOrganizationEdgeKey({ from: cell, to: moveCell(cell, direction) }),
				);
			if (rail.incoming & direction)
				return owned.has(
					staticFabOrganizationEdgeKey({ from: moveCell(cell, direction), to: cell }),
				);
			return true;
		});
	});
	const nearby = (terminal: Cell) =>
		straight
			.filter((cell) => distance(cell, terminal) <= STATIC_FAB_AISLE_INTEGRATION_MAX_GAP)
			.sort((a, b) => distance(a, terminal) - distance(b, terminal) || a.x - b.x || a.y - b.y)
			.slice(0, 32);
	const options: StaticFabAisleIntegrationOption[] = [];
	for (const entryGateway of nearby(entry))
		for (const exitGateway of nearby(exit)) {
			if (distance(entryGateway, exitGateway) < 8) continue;
			options.push({
				id: `${aisle.id}:${bay.id}:${cellKey(entryGateway.x, entryGateway.y)}:${cellKey(exitGateway.x, exitGateway.y)}`,
				entryGateway,
				exitGateway,
				lengthMeters: distance(entryGateway, entry) + distance(exit, exitGateway),
			});
		}
	return Object.freeze(
		options
			.sort((a, b) => a.lengthMeters - b.lengthMeters || a.id.localeCompare(b.id))
			.slice(0, 128),
	);
}

/** Both legs are staged privately. No source geometry or equipment is moved or removed. */
export function planStaticFabAisleIntegration(
	source: StaticFabAisleIntegrationSource,
	patchSequence: number,
	intent: StaticFabAisleIntegrationIntent,
): {
	readonly plan: StaticFabAisleIntegrationPlan;
	readonly prospective: StaticFabAisleIntegrationSource | null;
} {
	let entryCells: readonly Cell[] = [],
		exitCells: readonly Cell[] = [];
	let conflicts: readonly Cell[] = [];
	const emptyDraft: RailConstructionPlan = {
		kind: "build",
		baseRevision: source.map.getRevision(),
		cells: [],
		mutations: [],
		valid: false,
		reason: "연결 후보 없음",
		conflicts: [],
		newEdges: 0,
		lengthMeters: 0,
		turns: 0,
		bend: "horizontal-first",
	};
	try {
		const intentError = staticFabAisleIntegrationIntentError(intent);
		if (intentError) throw new Error(intentError);
		const stateError = staticFabOrganizationStateError(
			source.map,
			source.portEquipment,
			source.organizations,
		);
		if (stateError) throw new Error(stateError);
		const { aisle, bay, entry, exit } = resolveSource(
			source,
			intent.aisleOrganizationId,
			intent.bayOrganizationId,
		);
		if (
			distance(entry, intent.entryGateway) > STATIC_FAB_AISLE_INTEGRATION_MAX_GAP ||
			distance(exit, intent.exitGateway) > STATIC_FAB_AISLE_INTEGRATION_MAX_GAP
		)
			throw new Error("연결 거리가 지원 범위를 넘습니다");
		let lastReason = "두 연결을 함께 만들 수 없습니다";
		for (const entryHorizontal of [true, false])
			for (const exitHorizontal of [true, false]) {
				entryCells = lShapedPath(intent.entryGateway, entry, entryHorizontal);
				exitCells = lShapedPath(exit, intent.exitGateway, exitHorizontal);
				try {
					assertEmptyCorridor(source.map, entryCells);
					assertEmptyCorridor(source.map, exitCells);
					const map = source.map.clone();
					const first = planRailPath(map, entryCells);
					if (!first.valid) {
						conflicts = first.conflicts;
						throw new Error(first.reason);
					}
					map.applyAtomicMutations(first.mutations, []);
					const second = planRailPath(map, exitCells);
					if (!second.valid) {
						conflicts = second.conflicts;
						throw new Error(second.reason);
					}
					map.applyAtomicMutations(second.mutations, []);
					const mutations = combineMutations(source.map, map, [
						...first.mutations,
						...second.mutations,
					]);
					const added = [...pathEdges(entryCells), ...pathEdges(exitCells)];
					const afterAisle = copyStaticFabOrganizationRecord({
						...aisle,
						parentOrganizationIds: [bay.id],
					});
					const afterBay = copyStaticFabOrganizationRecord({
						...bay,
						membership: {
							...bay.membership,
							railEdges: [...bay.membership.railEdges, ...added].sort(compareDirectedRailEdges),
						},
					});
					const organizationMutations = [
						{ id: aisle.id, before: aisle, after: afterAisle },
						{ id: bay.id, before: bay, after: afterBay },
					].sort((a, b) => a.id - b.id);
					const organizations = applyStaticFabOrganizationMutations(
						source.organizations,
						organizationMutations,
						source.organizations.nextOrganizationId,
					);
					const prospective = {
						map,
						organizations,
						portEquipment: source.portEquipment,
						relationships: source.relationships,
					};
					const authorizations = impactIds(source, mutations);
					assertStaticFabAisleIntegrationTransition(
						source,
						prospective,
						mutations,
						organizationMutations,
						authorizations,
					);
					const draft: RailConstructionPlan = {
						...emptyDraft,
						mutations,
						cells: [...entryCells, ...exitCells],
						valid: true,
						reason: "Bay 편입 검토 준비됨",
						conflicts: [],
						newEdges: added.length,
						lengthMeters: first.lengthMeters + second.lengthMeters,
						turns: first.turns + second.turns,
					};
					return {
						plan: {
							kind: STATIC_FAB_AISLE_INTEGRATION_KIND,
							intent,
							baseRevision: source.map.getRevision(),
							basePatchSequence: patchSequence,
							draft,
							entryCells,
							exitCells,
							organizationMutations,
							organizationImpactAuthorizations: authorizations,
							nextOrganizationId: source.organizations.nextOrganizationId,
							valid: true,
							reason: draft.reason,
							conflicts: [],
						},
						prospective,
					};
				} catch (error) {
					lastReason = error instanceof Error ? error.message : String(error);
				}
			}
		throw new Error(lastReason);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return {
			plan: {
				kind: STATIC_FAB_AISLE_INTEGRATION_KIND,
				intent,
				baseRevision: source.map.getRevision(),
				basePatchSequence: patchSequence,
				draft: { ...emptyDraft, reason, cells: [...entryCells, ...exitCells], conflicts },
				entryCells,
				exitCells,
				organizationMutations: [],
				organizationImpactAuthorizations: [],
				nextOrganizationId: source.organizations.nextOrganizationId,
				valid: false,
				reason,
				conflicts,
			},
			prospective: null,
		};
	}
}

/** Recomputed at commit and by the rail mirror; authorization IDs alone never grant this scope. */
export function assertStaticFabAisleIntegrationTransition(
	before: StaticFabAisleIntegrationSource,
	after: StaticFabAisleIntegrationSource,
	mutations: readonly RailMutation[],
	organizationMutations: readonly StaticFabOrganizationMutation[],
	authorizations: readonly number[],
): void {
	if (
		organizationMutations.length !== 2 ||
		!mutations.length ||
		before.organizations.nextOrganizationId !== after.organizations.nextOrganizationId
	)
		throw new Error("구역 편입은 기존 구역과 Bay만 함께 변경해야 합니다");
	const change = organizationMutations.find((item) => item.before?.kind === "AISLE");
	const parent = organizationMutations.find((item) => item.before?.kind === "BAY");
	if (!change?.before || !change.after || !parent?.before || !parent.after)
		throw new Error("구역·Bay 변경이 불완전합니다");
	const { aisle, bay, entry, exit } = resolveSource(before, change.id, parent.id);
	if (
		JSON.stringify(change.after) !==
		JSON.stringify(copyStaticFabOrganizationRecord({ ...aisle, parentOrganizationIds: [bay.id] }))
	)
		throw new Error("구역의 레일·장비 소속과 메타데이터를 유지해야 합니다");
	const added = directedAddedEdges(before.map, after.map, mutations);
	if (!added.length) throw new Error("두 연결선이 없습니다");
	const expectedBay = copyStaticFabOrganizationRecord({
		...bay,
		membership: {
			...bay.membership,
			railEdges: [...bay.membership.railEdges, ...added].sort(compareDirectedRailEdges),
		},
	});
	if (JSON.stringify(parent.after) !== JSON.stringify(expectedBay))
		throw new Error("연결 레일·접속부는 대상 Bay의 정확한 소속이어야 합니다");
	const exact = impactIds(before, mutations);
	if (
		JSON.stringify(exact) !== JSON.stringify(authorizations) ||
		exact.length !== 2 ||
		!exact.includes(aisle.id) ||
		!exact.includes(bay.id)
	)
		throw new Error("연결이 다른 조직 또는 소유 밖 접속부를 변경합니다");
	const touchedOld = mutations.filter((mutation) => mutation.before !== 0);
	const endpoints = new Set([cellKey(entry.x, entry.y), cellKey(exit.x, exit.y)]);
	const seams = touchedOld.filter((cell) => !endpoints.has(cellKey(cell.x, cell.y)));
	if (touchedOld.length !== 4 || seams.length !== 2)
		throw new Error("두 끝과 Bay의 두 접속부만 변경할 수 있습니다");
	const bayEdges = new Set(bay.membership.railEdges.map(staticFabOrganizationEdgeKey));
	for (const seam of seams) {
		const oldRail = before.map.getRail(seam.x, seam.y),
			newRail = after.map.getRail(seam.x, seam.y);
		if (
			bitCount(oldRail.incoming) !== 1 ||
			bitCount(oldRail.outgoing) !== 1 ||
			oppositeDirection(oldRail.incoming as Direction) !== oldRail.outgoing ||
			bitCount(newRail.incoming | newRail.outgoing) !== 3
		)
			throw new Error("Bay 직접 소유 직선의 분기·합류 위치를 선택하세요");
		for (const direction of ALL_DIRECTIONS) {
			if (
				oldRail.outgoing & direction &&
				!bayEdges.has(staticFabOrganizationEdgeKey({ from: seam, to: moveCell(seam, direction) }))
			)
				throw new Error("Bay 밖 소유의 접속부입니다");
			if (
				oldRail.incoming & direction &&
				!bayEdges.has(staticFabOrganizationEdgeKey({ from: moveCell(seam, direction), to: seam }))
			)
				throw new Error("Bay 밖 소유의 접속부입니다");
		}
	}
	const stateError = staticFabOrganizationStateError(
		after.map,
		after.portEquipment,
		after.organizations,
	);
	if (stateError) throw new Error(stateError);
	const network = analyzeRailNetwork(staticFabAisleIntegrationComponentMap(after.map, entry));
	if (network.status !== "closed")
		throw new Error("편입 후 Bay 순환망 전체가 방향을 따라 연결되어야 합니다");
}

function resolveSource(
	source: StaticFabAisleIntegrationSource,
	aisleId: number,
	bayId: number,
): {
	aisle: StaticFabOrganizationRecord;
	bay: StaticFabOrganizationRecord;
	entry: Cell;
	exit: Cell;
} {
	const reason = staticFabAisleIntegrationSourceError(
		source.organizations,
		source.relationships,
		aisleId,
	);
	if (reason) throw new Error(reason);
	const aisle = source.organizations.records.find(
		(record) => record.id === aisleId,
	) as StaticFabOrganizationRecord;
	const bay = source.organizations.records.find((record) => record.id === bayId);
	if (
		!bay ||
		bay.kind !== "BAY" ||
		deriveStaticFabOrganizationSemanticRoles(source.organizations).get(bay.id) !== "BAY"
	)
		throw new Error("대상 Production Bay 하나를 선택하세요");
	const isolated = mapFromEdges(aisle.membership.railEdges);
	const analysis = analyzeRailNetwork(isolated);
	if (analysis.components !== 1 || analysis.openEnds !== 2 || analysis.unsafeJunctions)
		throw new Error("단일 연결 구역의 입구 1개·출구 1개가 필요합니다");
	let entry: Cell | null = null,
		exit: Cell | null = null;
	isolated.forEachRail((x, y, rail, encoded) => {
		if (source.map.getEncoded(x, y) !== encoded || source.map.getAdvancedSwitchOwningCell(x, y))
			throw new Error("구역 끝이 다른 레일·스위치에 연결되어 있습니다");
		if (!rail.incoming) {
			if (entry) throw new Error("구역 입구는 하나여야 합니다");
			entry = { x, y };
		}
		if (!rail.outgoing) {
			if (exit) throw new Error("구역 출구는 하나여야 합니다");
			exit = { x, y };
		}
	});
	if (!entry || !exit) throw new Error("구역 입구·출구가 없습니다");
	return { aisle, bay, entry, exit };
}

function assertEmptyCorridor(map: TileMap, cells: readonly Cell[]): void {
	if (cells.length < 2) throw new Error("연결선 길이가 부족합니다");
	for (const cell of cells.slice(1, -1))
		if (map.hasRail(cell.x, cell.y) || map.getAdvancedSwitchOwningCell(cell.x, cell.y))
			throw new Error(`연결 경로가 기존 레일과 겹칩니다 · X ${cell.x} · Z ${cell.y}`);
}

function combineMutations(
	before: TileMap,
	after: TileMap,
	changes: readonly RailMutation[],
): RailMutation[] {
	return [...new Map(changes.map((cell) => [cellKey(cell.x, cell.y), cell])).values()]
		.map(({ x, y }) => ({ x, y, before: before.getEncoded(x, y), after: after.getEncoded(x, y) }))
		.filter((cell) => cell.before !== cell.after)
		.sort((a, b) => a.x - b.x || a.y - b.y);
}

function directedAddedEdges(
	before: TileMap,
	after: TileMap,
	mutations: readonly RailMutation[],
): DirectedRailEdge[] {
	const edges: DirectedRailEdge[] = [];
	for (const mutation of mutations) {
		if ((mutation.after & mutation.before) !== mutation.before)
			throw new Error("기존 레일을 제거하거나 방향을 바꿀 수 없습니다");
		const old = before.getRail(mutation.x, mutation.y),
			next = after.getRail(mutation.x, mutation.y);
		for (const direction of ALL_DIRECTIONS)
			if (next.outgoing & direction && !(old.outgoing & direction))
				edges.push({ from: { x: mutation.x, y: mutation.y }, to: moveCell(mutation, direction) });
	}
	return edges.sort(compareDirectedRailEdges);
}

function pathEdges(cells: readonly Cell[]): DirectedRailEdge[] {
	return cells.slice(1).map((to, index) => ({ from: cells[index] as Cell, to }));
}

function mapFromEdges(edges: readonly DirectedRailEdge[]): TileMap {
	const map = new TileMap();
	for (const edge of edges) {
		const direction = directionBetween(edge.from, edge.to);
		if (direction === null) throw new Error("구역 레일 방향이 유효하지 않습니다");
		const a = map.getRail(edge.from.x, edge.from.y),
			b = map.getRail(edge.to.x, edge.to.y);
		map.setEncoded(
			edge.from.x,
			edge.from.y,
			encodeRailCell({ incoming: a.incoming, outgoing: a.outgoing | direction }),
		);
		map.setEncoded(
			edge.to.x,
			edge.to.y,
			encodeRailCell({ incoming: b.incoming | oppositeDirection(direction), outgoing: b.outgoing }),
		);
	}
	return map;
}

export function staticFabAisleIntegrationComponentMap(map: TileMap, start: Cell): TileMap {
	const hydrator = TileMap.createHydrator(),
		queued = [start],
		visited = new Set<string>(),
		switchIds = new Set<number>();
	for (let index = 0; index < queued.length; index++) {
		const cell = queued[index] as Cell,
			key = cellKey(cell.x, cell.y);
		if (visited.has(key)) continue;
		visited.add(key);
		const rail = map.getRail(cell.x, cell.y);
		const encoded = map.getEncoded(cell.x, cell.y);
		if (encoded) hydrator.addEncodedCell(cell.x, cell.y, encoded);
		const switchRecord = map.getAdvancedSwitchOwningCell(cell.x, cell.y);
		if (switchRecord && !switchIds.has(switchRecord.id)) {
			switchIds.add(switchRecord.id);
			hydrator.addAdvancedSwitch(switchRecord);
			// A compiled switch is one module, including every port and its reserved footprint.
			queued.push(...deriveAdvancedSwitchGeometry(switchRecord).claimedCells);
		}
		for (const direction of ALL_DIRECTIONS)
			if ((rail.incoming | rail.outgoing) & direction) queued.push(moveCell(cell, direction));
	}
	return hydrator.finish(map.getRevision(), map.getAdvancedSwitchIdCursor());
}

function membershipCells(record: StaticFabOrganizationRecord): ReadonlyMap<string, Cell> {
	return new Map(
		record.membership.railEdges
			.flatMap((edge) => [edge.from, edge.to])
			.map((cell) => [cellKey(cell.x, cell.y), cell]),
	);
}

function distance(a: Cell, b: Cell): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** Mirror authoring/Redo independently rebuilds this command; Undo uses the exact private ledger. */
export function assertStaticFabAisleIntegrationPatchSource(
	source: StaticFabAisleIntegrationSource,
	patchSequence: number,
	patch: RailPatchTransition,
): void {
	if (
		patch.switchChanges.length ||
		patch.portChanges.length ||
		patch.equipmentGroupChanges.length ||
		(patch.relationshipChanges?.length ?? 0) ||
		patch.operationalConfigurationPatch ||
		patch.organizationNextIdBefore !== patch.organizationNextIdAfter ||
		patch.organizationChanges.length !== 2
	)
		throw new Error("구역 편입 patch 범위가 유효하지 않습니다");
	const aisle = patch.organizationChanges.find((item) => item.before?.kind === "AISLE");
	const bay = patch.organizationChanges.find((item) => item.before?.kind === "BAY");
	if (!aisle?.after || !bay?.after) throw new Error("구역 편입 조직 변경이 불완전합니다");
	const { entry, exit } = resolveSource(source, aisle.id, bay.id);
	const seams = patch.changes.filter(
		(cell) =>
			cell.before !== 0 &&
			cellKey(cell.x, cell.y) !== cellKey(entry.x, entry.y) &&
			cellKey(cell.x, cell.y) !== cellKey(exit.x, exit.y),
	);
	const branch = seams.find((cell) => (cell.after & 0xf0) !== (cell.before & 0xf0));
	const merge = seams.find((cell) => (cell.after & 0x0f) !== (cell.before & 0x0f));
	if (seams.length !== 2 || !branch || !merge || branch === merge)
		throw new Error("구역 편입은 Bay 분기·합류 한 쌍이어야 합니다");
	const result = planStaticFabAisleIntegration(source, patchSequence, {
		version: 1,
		aisleOrganizationId: aisle.id,
		bayOrganizationId: bay.id,
		entryGateway: { x: branch.x, y: branch.y },
		exitGateway: { x: merge.x, y: merge.y },
	});
	if (!result.plan.valid) throw new Error(result.plan.reason);
	const plan = result.plan;
	const expected: RailPatchTransition = {
		changes: plan.draft.mutations,
		switchChanges: [],
		portChanges: [],
		equipmentGroupChanges: [],
		organizationChanges: plan.organizationMutations,
		organizationNextIdBefore: plan.nextOrganizationId,
		organizationNextIdAfter: plan.nextOrganizationId,
		organizationImpactAuthorizations: plan.organizationImpactAuthorizations,
		operationalConfigurationPatch: null,
	};
	if (railPatchTransitionFingerprint(expected) !== railPatchTransitionFingerprint(patch))
		throw new Error("구역 편입 patch가 현재 원본의 전체 두 연결과 다릅니다");
}

function impactIds(
	source: StaticFabAisleIntegrationSource,
	mutations: readonly RailMutation[],
): readonly number[] {
	const index = new StaticFabOrganizationImpactIndex();
	index.synchronize(source.organizations);
	return staticFabOrganizationImpactsForPatch(
		index,
		mutations,
		[],
		[],
		[],
		source.portEquipment,
		source.portEquipment,
	)
		.map((owner) => owner.organizationId)
		.sort((a, b) => a - b);
}
