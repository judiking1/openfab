import type { AdvancedSwitchMutation } from "./AdvancedSwitch";
import type { EquipmentGroupMutation, PortEquipmentState } from "./EquipmentGroup";
import type { PortMutation } from "./PortRecord";
import type { RailMutation } from "./paint";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import { ALL_DIRECTIONS, moveCell } from "./railShape";
import type {
	StaticFabOrganizationKind,
	StaticFabOrganizationMembership,
	StaticFabOrganizationMutation,
	StaticFabOrganizationState,
} from "./StaticFabOrganization";
import { compareDirectedRailEdges, staticFabOrganizationEdgeKey } from "./StaticFabOrganization";
import { cellKey, decodeRailCell } from "./TileMap";

interface StaticFabOrganizationImpactToken {
	readonly organizationId: number;
	readonly cellCoordinates: Int32Array;
	readonly advancedSwitchIds: Int32Array;
	readonly equipmentGroupIds: Int32Array;
}

interface ActiveStaticFabOrganizationImpactOwner {
	readonly token: StaticFabOrganizationImpactToken;
	readonly owner: StaticFabOrganizationImpactOwner;
}

export interface StaticFabOrganizationImpactOwner {
	readonly organizationId: number;
	readonly kind: StaticFabOrganizationKind;
}

const EMPTY_IMPACT_OWNERS: readonly StaticFabOrganizationImpactOwner[] = Object.freeze([]);
const EMPTY_RELOCATION_AUTHORIZATIONS: ReadonlySet<number> = new Set<number>();

/**
 * Incremental guard for authored changes around validated organization truth.
 *
 * Tokens are cached by immutable membership identity. Rename, remove, undo, and
 * redo therefore switch active tokens without walking a large membership again.
 */
export class StaticFabOrganizationImpactIndex {
	private activeOwnersByOrganizationId = new Map<number, ActiveStaticFabOrganizationImpactOwner>();
	private readonly tokensByMembership = new WeakMap<
		StaticFabOrganizationMembership,
		Map<number, StaticFabOrganizationImpactToken>
	>();
	/** One registered token per currently active stable organization ID. */
	private readonly residentTokensByOrganizationId = new Map<
		number,
		StaticFabOrganizationImpactToken
	>();
	private readonly registeredTokens = new Set<StaticFabOrganizationImpactToken>();
	private readonly tokensByCell = new Map<string, Set<StaticFabOrganizationImpactToken>>();
	private readonly tokensBySwitch = new Map<number, Set<StaticFabOrganizationImpactToken>>();
	private readonly tokensByEquipmentGroup = new Map<
		number,
		Set<StaticFabOrganizationImpactToken>
	>();

	/**
	 * Prepare the complete reverse index for an already validated immutable generation.
	 *
	 * This factory keeps a partially built index private when a checkpoint rejects. The caller owns
	 * the operation scheduler so map-revision and cancellation checks can remain in the surrounding
	 * activation transaction. Every membership item and reverse-index insertion consumes at least one
	 * scheduled operation; a large rail, switch, or equipment membership therefore cannot become one
	 * uninterruptible startup task.
	 */
	static async prepareCooperatively(
		state: StaticFabOrganizationState,
		consumeOperation: () => Promise<void>,
	): Promise<StaticFabOrganizationImpactIndex> {
		const index = new StaticFabOrganizationImpactIndex();
		const active = new Map<number, ActiveStaticFabOrganizationImpactOwner>();
		for (const record of state.records) {
			await consumeOperation();
			const token = await index.tokenForMembershipCooperatively(
				record.id,
				record.membership,
				consumeOperation,
			);
			await index.registerTokenCooperatively(token, consumeOperation);
			index.residentTokensByOrganizationId.set(record.id, token);
			active.set(
				record.id,
				Object.freeze({
					token,
					owner: Object.freeze({ organizationId: record.id, kind: record.kind }),
				}),
			);
		}
		index.activeOwnersByOrganizationId = active;
		return index;
	}

	synchronize(state: StaticFabOrganizationState): void {
		const active = new Map<number, ActiveStaticFabOrganizationImpactOwner>();
		for (const record of state.records) {
			const token = this.tokenForMembership(record.id, record.membership);
			const resident = this.residentTokensByOrganizationId.get(record.id);
			if (resident !== token) {
				if (resident) this.unregisterToken(resident);
				this.registerToken(token);
				this.residentTokensByOrganizationId.set(record.id, token);
			} else if (!this.registeredTokens.has(token)) {
				this.registerToken(token);
			}
			active.set(
				record.id,
				Object.freeze({
					token,
					owner: Object.freeze({ organizationId: record.id, kind: record.kind }),
				}),
			);
		}
		for (const [organizationId, token] of this.residentTokensByOrganizationId) {
			if (active.has(organizationId)) continue;
			this.unregisterToken(token);
			this.residentTokensByOrganizationId.delete(organizationId);
		}
		this.activeOwnersByOrganizationId = active;
	}

	organizationIdForCell(x: number, y: number): number | null {
		return this.activeOrganizationId(this.tokensByCell.get(cellKey(x, y)));
	}

	organizationOwnersForCell(x: number, y: number): readonly StaticFabOrganizationImpactOwner[] {
		return this.activeOrganizationOwners(this.tokensByCell.get(cellKey(x, y)));
	}

	organizationIdForSwitch(switchId: number): number | null {
		return this.activeOrganizationId(this.tokensBySwitch.get(switchId));
	}

	organizationOwnersForSwitch(switchId: number): readonly StaticFabOrganizationImpactOwner[] {
		return this.activeOrganizationOwners(this.tokensBySwitch.get(switchId));
	}

	organizationIdForEquipmentGroup(equipmentGroupId: number): number | null {
		return this.activeOrganizationId(this.tokensByEquipmentGroup.get(equipmentGroupId));
	}

	organizationOwnersForEquipmentGroup(
		equipmentGroupId: number,
	): readonly StaticFabOrganizationImpactOwner[] {
		return this.activeOrganizationOwners(this.tokensByEquipmentGroup.get(equipmentGroupId));
	}

	/**
	 * Return bounded overlap candidates for exact membership assignment checks.
	 *
	 * Rail membership is indexed by touched cells for structural-edit protection, so this lookup can
	 * intentionally include an adjacent-edge false positive. Callers must still run the exact directed
	 * edge intersection check before presenting or committing a conflict.
	 */
	organizationOwnersForMembership(
		membership: StaticFabOrganizationMembership,
		kind: StaticFabOrganizationKind | null = null,
	): readonly StaticFabOrganizationImpactOwner[] {
		const ownersById = new Map<number, StaticFabOrganizationImpactOwner>();
		const collect = (owners: readonly StaticFabOrganizationImpactOwner[]): void => {
			for (const owner of owners) {
				if (kind === null || owner.kind === kind) ownersById.set(owner.organizationId, owner);
			}
		};
		for (const edge of membership.railEdges) {
			collect(this.organizationOwnersForCell(edge.from.x, edge.from.y));
			collect(this.organizationOwnersForCell(edge.to.x, edge.to.y));
		}
		for (const switchId of membership.advancedSwitchIds) {
			collect(this.organizationOwnersForSwitch(switchId));
		}
		for (const equipmentGroupId of membership.equipmentGroupIds) {
			collect(this.organizationOwnersForEquipmentGroup(equipmentGroupId));
		}
		if (ownersById.size === 0) return EMPTY_IMPACT_OWNERS;
		return Object.freeze([...ownersById.values()].sort(compareImpactOwners));
	}

	private tokenForMembership(
		organizationId: number,
		membership: StaticFabOrganizationMembership,
	): StaticFabOrganizationImpactToken {
		let tokensForMembership = this.tokensByMembership.get(membership);
		if (!tokensForMembership) {
			tokensForMembership = new Map();
			this.tokensByMembership.set(membership, tokensForMembership);
		}
		const cached = tokensForMembership.get(organizationId);
		if (cached) return cached;

		const cells = new Set<string>();
		const coordinates: number[] = [];
		for (const edge of membership.railEdges) {
			appendUniqueCellCoordinates(cells, coordinates, edge.from.x, edge.from.y);
			appendUniqueCellCoordinates(cells, coordinates, edge.to.x, edge.to.y);
		}
		const token = Object.freeze({
			organizationId,
			cellCoordinates: Int32Array.from(coordinates),
			advancedSwitchIds: Int32Array.from(membership.advancedSwitchIds),
			equipmentGroupIds: Int32Array.from(membership.equipmentGroupIds),
		});
		tokensForMembership.set(organizationId, token);
		return token;
	}

	private async tokenForMembershipCooperatively(
		organizationId: number,
		membership: StaticFabOrganizationMembership,
		consumeOperation: () => Promise<void>,
	): Promise<StaticFabOrganizationImpactToken> {
		let tokensForMembership = this.tokensByMembership.get(membership);
		if (!tokensForMembership) {
			tokensForMembership = new Map();
			this.tokensByMembership.set(membership, tokensForMembership);
		}
		const cached = tokensForMembership.get(organizationId);
		if (cached) return cached;

		const cells = new Set<string>();
		const coordinates: number[] = [];
		for (const edge of membership.railEdges) {
			appendUniqueCellCoordinates(cells, coordinates, edge.from.x, edge.from.y);
			appendUniqueCellCoordinates(cells, coordinates, edge.to.x, edge.to.y);
			await consumeOperation();
		}
		const cellCoordinates = new Int32Array(coordinates.length);
		for (let index = 0; index < coordinates.length; index++) {
			cellCoordinates[index] = coordinates[index] as number;
			await consumeOperation();
		}
		const advancedSwitchIds = new Int32Array(membership.advancedSwitchIds.length);
		for (let index = 0; index < membership.advancedSwitchIds.length; index++) {
			advancedSwitchIds[index] = membership.advancedSwitchIds[index] as number;
			await consumeOperation();
		}
		const equipmentGroupIds = new Int32Array(membership.equipmentGroupIds.length);
		for (let index = 0; index < membership.equipmentGroupIds.length; index++) {
			equipmentGroupIds[index] = membership.equipmentGroupIds[index] as number;
			await consumeOperation();
		}
		const token = Object.freeze({
			organizationId,
			cellCoordinates,
			advancedSwitchIds,
			equipmentGroupIds,
		});
		tokensForMembership.set(organizationId, token);
		return token;
	}

	private registerToken(token: StaticFabOrganizationImpactToken): void {
		if (this.registeredTokens.has(token)) return;
		for (let index = 0; index < token.cellCoordinates.length; index += 2) {
			appendImpactToken(
				this.tokensByCell,
				cellKey(token.cellCoordinates[index], token.cellCoordinates[index + 1]),
				token,
			);
		}
		for (const switchId of token.advancedSwitchIds) {
			appendImpactToken(this.tokensBySwitch, switchId, token);
		}
		for (const groupId of token.equipmentGroupIds) {
			appendImpactToken(this.tokensByEquipmentGroup, groupId, token);
		}
		this.registeredTokens.add(token);
	}

	private async registerTokenCooperatively(
		token: StaticFabOrganizationImpactToken,
		consumeOperation: () => Promise<void>,
	): Promise<void> {
		if (this.registeredTokens.has(token)) return;
		for (let index = 0; index < token.cellCoordinates.length; index += 2) {
			appendImpactToken(
				this.tokensByCell,
				cellKey(token.cellCoordinates[index], token.cellCoordinates[index + 1]),
				token,
			);
			await consumeOperation();
		}
		for (const switchId of token.advancedSwitchIds) {
			appendImpactToken(this.tokensBySwitch, switchId, token);
			await consumeOperation();
		}
		for (const groupId of token.equipmentGroupIds) {
			appendImpactToken(this.tokensByEquipmentGroup, groupId, token);
			await consumeOperation();
		}
		this.registeredTokens.add(token);
	}

	private unregisterToken(token: StaticFabOrganizationImpactToken): void {
		if (!this.registeredTokens.delete(token)) return;
		for (let index = 0; index < token.cellCoordinates.length; index += 2) {
			removeImpactToken(
				this.tokensByCell,
				cellKey(token.cellCoordinates[index], token.cellCoordinates[index + 1]),
				token,
			);
		}
		for (const switchId of token.advancedSwitchIds) {
			removeImpactToken(this.tokensBySwitch, switchId, token);
		}
		for (const groupId of token.equipmentGroupIds) {
			removeImpactToken(this.tokensByEquipmentGroup, groupId, token);
		}
	}

	private activeOrganizationId(
		candidates: ReadonlySet<StaticFabOrganizationImpactToken> | undefined,
	): number | null {
		if (!candidates) return null;
		let firstOrganizationId: number | null = null;
		for (const token of candidates) {
			const active = this.activeOwnersByOrganizationId.get(token.organizationId);
			if (
				active?.token === token &&
				(firstOrganizationId === null || token.organizationId < firstOrganizationId)
			) {
				firstOrganizationId = token.organizationId;
			}
		}
		return firstOrganizationId;
	}

	private activeOrganizationOwners(
		candidates: ReadonlySet<StaticFabOrganizationImpactToken> | undefined,
	): readonly StaticFabOrganizationImpactOwner[] {
		if (!candidates) return EMPTY_IMPACT_OWNERS;
		const owners: StaticFabOrganizationImpactOwner[] = [];
		for (const token of candidates) {
			const active = this.activeOwnersByOrganizationId.get(token.organizationId);
			if (active?.token === token) owners.push(active.owner);
		}
		if (owners.length === 0) return EMPTY_IMPACT_OWNERS;
		owners.sort(compareImpactOwners);
		return Object.freeze(owners);
	}
}

/** Return the first organization whose validated membership can be invalidated by this patch. */
export function staticFabOrganizationImpactForPatch(
	index: StaticFabOrganizationImpactIndex,
	railChanges: readonly RailMutation[],
	switchChanges: readonly AdvancedSwitchMutation[],
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	beforePortEquipment: PortEquipmentState,
	afterPortEquipment: PortEquipmentState,
): number | null {
	for (const change of railChanges) {
		const organizationId = index.organizationIdForCell(change.x, change.y);
		if (organizationId !== null) return organizationId;
	}
	for (const change of switchChanges) {
		const organizationId = index.organizationIdForSwitch(change.id);
		if (organizationId !== null) return organizationId;
	}

	const changedGroupIds = changedEquipmentGroupIdsForPatch(
		portChanges,
		equipmentGroupChanges,
		beforePortEquipment,
		afterPortEquipment,
	);
	for (const groupId of changedGroupIds) {
		const organizationId = index.organizationIdForEquipmentGroup(groupId);
		if (organizationId !== null) return organizationId;
	}
	return null;
}

/**
 * Return every active organization owner touched by a patch, deduplicated and sorted by stable ID.
 * Cross-kind overlap is legal, so callers can report the complete edit diagnostic in one attempt.
 */
export function staticFabOrganizationImpactsForPatch(
	index: StaticFabOrganizationImpactIndex,
	railChanges: readonly RailMutation[],
	switchChanges: readonly AdvancedSwitchMutation[],
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	beforePortEquipment: PortEquipmentState,
	afterPortEquipment: PortEquipmentState,
): readonly StaticFabOrganizationImpactOwner[] {
	const ownersById = new Map<number, StaticFabOrganizationImpactOwner>();
	const collect = (owners: readonly StaticFabOrganizationImpactOwner[]): void => {
		for (const owner of owners) ownersById.set(owner.organizationId, owner);
	};
	for (const change of railChanges) {
		collect(index.organizationOwnersForCell(change.x, change.y));
	}
	for (const change of switchChanges) {
		collect(index.organizationOwnersForSwitch(change.id));
	}
	const changedGroupIds = changedEquipmentGroupIdsForPatch(
		portChanges,
		equipmentGroupChanges,
		beforePortEquipment,
		afterPortEquipment,
	);
	for (const groupId of changedGroupIds) {
		collect(index.organizationOwnersForEquipmentGroup(groupId));
	}
	if (ownersById.size === 0) return EMPTY_IMPACT_OWNERS;
	return Object.freeze([...ownersById.values()].sort(compareImpactOwners));
}

/**
 * Require every protected owner touched by authored content edits to remove itself or change
 * membership at the same authored location. Metadata-only and spatially unrelated organization
 * mutations cannot authorize a protected structural edit.
 */
export function unhandledStaticFabOrganizationImpacts(
	index: StaticFabOrganizationImpactIndex,
	impacts: readonly StaticFabOrganizationImpactOwner[],
	organizationChanges: readonly StaticFabOrganizationMutation[],
	railChanges: readonly RailMutation[],
	switchChanges: readonly AdvancedSwitchMutation[],
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	beforePortEquipment: PortEquipmentState,
	afterPortEquipment: PortEquipmentState,
	authorizedRelocationOrganizationIds: ReadonlySet<number> = EMPTY_RELOCATION_AUTHORIZATIONS,
): readonly StaticFabOrganizationImpactOwner[] {
	if (impacts.length === 0) return EMPTY_IMPACT_OWNERS;
	const changesByOrganizationId = new Map(
		organizationChanges.map((change) => [change.id, change] as const),
	);
	const changedRailEdges = changedDirectedRailEdges(railChanges);
	const changedSwitchIds = new Set(switchChanges.map((change) => change.id));
	const changedEquipmentGroupIds = changedEquipmentGroupIdsForPatch(
		portChanges,
		equipmentGroupChanges,
		beforePortEquipment,
		afterPortEquipment,
	);
	const unhandled = impacts.filter((owner) => {
		// Existing-ID relocation keeps switch/group membership IDs stable. Only an exact
		// Worker-certified arrangement command may explicitly authorize that narrow case.
		if (authorizedRelocationOrganizationIds.has(owner.organizationId)) return false;
		const change = changesByOrganizationId.get(owner.organizationId);
		if (!change?.before) return true;
		if (!change.after) return false;
		return !organizationMembershipDeltaHandlesEveryProtectedChange(
			index,
			owner.organizationId,
			change.before.membership,
			change.after.membership,
			changedRailEdges,
			changedSwitchIds,
			changedEquipmentGroupIds,
		);
	});
	return unhandled.length === 0 ? EMPTY_IMPACT_OWNERS : Object.freeze(unhandled);
}

function organizationMembershipDeltaHandlesEveryProtectedChange(
	index: StaticFabOrganizationImpactIndex,
	organizationId: number,
	before: StaticFabOrganizationMembership,
	after: StaticFabOrganizationMembership,
	changedRailEdges: readonly DirectedRailEdge[],
	changedSwitchIds: ReadonlySet<number>,
	changedEquipmentGroupIds: ReadonlySet<number>,
): boolean {
	if (before === after) return false;
	let sawProtectedChange = false;
	for (const edge of changedRailEdges) {
		if (!organizationOwnsEitherEndpoint(index, organizationId, edge)) continue;
		sawProtectedChange = true;
		if (
			canonicalEdgeIncludes(before.railEdges, edge) === canonicalEdgeIncludes(after.railEdges, edge)
		) {
			return false;
		}
	}
	for (const switchId of changedSwitchIds) {
		if (!ownersInclude(index.organizationOwnersForSwitch(switchId), organizationId)) continue;
		sawProtectedChange = true;
		if (
			canonicalNumberIncludes(before.advancedSwitchIds, switchId) ===
			canonicalNumberIncludes(after.advancedSwitchIds, switchId)
		) {
			return false;
		}
	}
	for (const equipmentGroupId of changedEquipmentGroupIds) {
		if (
			!ownersInclude(index.organizationOwnersForEquipmentGroup(equipmentGroupId), organizationId)
		) {
			continue;
		}
		sawProtectedChange = true;
		if (
			canonicalNumberIncludes(before.equipmentGroupIds, equipmentGroupId) ===
			canonicalNumberIncludes(after.equipmentGroupIds, equipmentGroupId)
		) {
			return false;
		}
	}
	return sawProtectedChange;
}

function changedDirectedRailEdges(
	railChanges: readonly RailMutation[],
): readonly DirectedRailEdge[] {
	const changedByKey = new Map<string, DirectedRailEdge>();
	for (const change of railChanges) {
		const before = decodeRailCell(change.before);
		const after = decodeRailCell(change.after);
		for (const direction of ALL_DIRECTIONS) {
			if (((before.outgoing ^ after.outgoing) & direction) !== 0) {
				const edge = Object.freeze({
					from: Object.freeze({ x: change.x, y: change.y }),
					to: Object.freeze(moveCell(change, direction)),
				});
				changedByKey.set(staticFabOrganizationEdgeKey(edge), edge);
			}
			if (((before.incoming ^ after.incoming) & direction) !== 0) {
				const edge = Object.freeze({
					from: Object.freeze(moveCell(change, direction)),
					to: Object.freeze({ x: change.x, y: change.y }),
				});
				changedByKey.set(staticFabOrganizationEdgeKey(edge), edge);
			}
		}
	}
	return Object.freeze([...changedByKey.values()].sort(compareDirectedRailEdges));
}

function organizationOwnsEitherEndpoint(
	index: StaticFabOrganizationImpactIndex,
	organizationId: number,
	edge: DirectedRailEdge,
): boolean {
	return (
		ownersInclude(index.organizationOwnersForCell(edge.from.x, edge.from.y), organizationId) ||
		ownersInclude(index.organizationOwnersForCell(edge.to.x, edge.to.y), organizationId)
	);
}

function ownersInclude(
	owners: readonly StaticFabOrganizationImpactOwner[],
	organizationId: number,
): boolean {
	return owners.some((owner) => owner.organizationId === organizationId);
}

function canonicalEdgeIncludes(
	edges: readonly DirectedRailEdge[],
	target: DirectedRailEdge,
): boolean {
	let low = 0;
	let high = edges.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const comparison = compareDirectedRailEdges(edges[middle] as DirectedRailEdge, target);
		if (comparison === 0) return true;
		if (comparison < 0) low = middle + 1;
		else high = middle - 1;
	}
	return false;
}

function canonicalNumberIncludes(values: readonly number[], target: number): boolean {
	let low = 0;
	let high = values.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const value = values[middle] as number;
		if (value === target) return true;
		if (value < target) low = middle + 1;
		else high = middle - 1;
	}
	return false;
}

function changedEquipmentGroupIdsForPatch(
	portChanges: readonly PortMutation[],
	equipmentGroupChanges: readonly EquipmentGroupMutation[],
	beforePortEquipment: PortEquipmentState,
	afterPortEquipment: PortEquipmentState,
): Set<number> {
	const changedGroupIds = new Set(equipmentGroupChanges.map((change) => change.id));
	if (portChanges.length === 0) return changedGroupIds;
	const changedPortIds = new Set(portChanges.map((change) => change.id));
	for (const state of [beforePortEquipment, afterPortEquipment]) {
		for (const group of state.equipmentGroups) {
			if (group.portIds.some((portId) => changedPortIds.has(portId))) {
				changedGroupIds.add(group.id);
			}
		}
	}
	return changedGroupIds;
}

function compareImpactOwners(
	left: StaticFabOrganizationImpactOwner,
	right: StaticFabOrganizationImpactOwner,
): number {
	return left.organizationId - right.organizationId;
}

function appendUniqueCellCoordinates(
	keys: Set<string>,
	coordinates: number[],
	x: number,
	y: number,
): void {
	const key = cellKey(x, y);
	if (keys.has(key)) return;
	keys.add(key);
	coordinates.push(x, y);
}

function appendImpactToken<Key>(
	index: Map<Key, Set<StaticFabOrganizationImpactToken>>,
	key: Key,
	token: StaticFabOrganizationImpactToken,
): void {
	const tokens = index.get(key);
	if (tokens) tokens.add(token);
	else index.set(key, new Set([token]));
}

function removeImpactToken<Key>(
	index: Map<Key, Set<StaticFabOrganizationImpactToken>>,
	key: Key,
	token: StaticFabOrganizationImpactToken,
): void {
	const tokens = index.get(key);
	if (!tokens) return;
	tokens.delete(token);
	if (tokens.size === 0) index.delete(key);
}
