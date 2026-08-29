import type { DirectedRailEdge } from "./RailModuleOwnership";
import {
	type StaticFabOrganizationMembership,
	type StaticFabOrganizationRecord,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "./StaticFabOrganization";

const HASH_SEED_A = 0x811c9dc5;
const HASH_SEED_B = 0x9e3779b9;

export interface StaticFabOrganizationFingerprint {
	readonly xor: number;
	readonly sum: number;
}

export interface StaticFabOrganizationMembershipFingerprintAccumulator {
	addRailEdge(index: number, edge: DirectedRailEdge): void;
	addAdvancedSwitchId(index: number, id: number): void;
	addEquipmentGroupId(index: number, id: number): void;
	finish(): StaticFabOrganizationFingerprint;
}

const membershipFingerprints = new WeakMap<
	StaticFabOrganizationMembership,
	StaticFabOrganizationFingerprint
>();

export function cachedStaticFabOrganizationMembershipFingerprint(
	membership: StaticFabOrganizationMembership,
): StaticFabOrganizationFingerprint | undefined {
	return membershipFingerprints.get(membership);
}

export function cacheStaticFabOrganizationMembershipFingerprint(
	membership: StaticFabOrganizationMembership,
	fingerprint: StaticFabOrganizationFingerprint,
): void {
	assertFrozenMembershipContainer(membership);
	const canonical = copyStaticFabOrganizationFingerprint(fingerprint);
	const existing = membershipFingerprints.get(membership);
	if (existing && (existing.xor !== canonical.xor || existing.sum !== canonical.sum)) {
		throw new Error("Static FAB organization membership fingerprint conflicts with its cache.");
	}
	membershipFingerprints.set(membership, canonical);
}

/** Replace a cache entry only after the current immutable membership passed full validation. */
export function primeValidatedStaticFabOrganizationMembershipFingerprint(
	membership: StaticFabOrganizationMembership,
	fingerprint: StaticFabOrganizationFingerprint,
): void {
	assertFrozenMembershipContainer(membership);
	membershipFingerprints.set(membership, copyStaticFabOrganizationFingerprint(fingerprint));
}

/** Exact organization contribution used by authored checksums and compact patch guards. */
export function staticFabOrganizationFingerprint(
	record: StaticFabOrganizationRecord,
): StaticFabOrganizationFingerprint {
	let membership = cachedStaticFabOrganizationMembershipFingerprint(record.membership);
	if (!membership) {
		membership = staticFabOrganizationMembershipFingerprint(record.membership);
		if (staticFabOrganizationMembershipContainerIsFrozen(record.membership)) {
			cacheStaticFabOrganizationMembershipFingerprint(record.membership, membership);
		}
	}
	return composeStaticFabOrganizationFingerprint(record, membership);
}

export function staticFabOrganizationMembershipFingerprint(
	membership: StaticFabOrganizationMembership,
): StaticFabOrganizationFingerprint {
	const accumulator = createStaticFabOrganizationMembershipFingerprintAccumulator();
	for (let index = 0; index < membership.railEdges.length; index++) {
		accumulator.addRailEdge(index, membership.railEdges[index] as DirectedRailEdge);
	}
	for (let index = 0; index < membership.advancedSwitchIds.length; index++) {
		accumulator.addAdvancedSwitchId(index, membership.advancedSwitchIds[index] as number);
	}
	for (let index = 0; index < membership.equipmentGroupIds.length; index++) {
		accumulator.addEquipmentGroupId(index, membership.equipmentGroupIds[index] as number);
	}
	return accumulator.finish();
}

/** Build the same membership fingerprint while a caller performs an existing cooperative walk. */
export function createStaticFabOrganizationMembershipFingerprintAccumulator(): StaticFabOrganizationMembershipFingerprintAccumulator {
	let xor = Math.imul(HASH_SEED_A ^ 0x4f52474d, 0x85ebca6b) >>> 0;
	let sum = Math.imul(HASH_SEED_B ^ 0x4f52474d, 0x85ebca6b) >>> 0;
	const mix = (value: number): void => {
		xor = mixHash(xor, value);
		sum = mixHash(sum, value);
	};
	return Object.freeze({
		addRailEdge(index: number, edge: DirectedRailEdge): void {
			mix(index);
			mix(edge.from.x);
			mix(edge.from.y);
			mix(edge.to.x);
			mix(edge.to.y);
		},
		addAdvancedSwitchId(index: number, id: number): void {
			mix(0x10000000 | index);
			mix(id);
		},
		addEquipmentGroupId(index: number, id: number): void {
			mix(0x20000000 | index);
			mix(id);
		},
		finish(): StaticFabOrganizationFingerprint {
			return Object.freeze({ xor: finalizeHash(xor), sum: finalizeHash(sum) });
		},
	});
}

export function composeStaticFabOrganizationFingerprint(
	record: StaticFabOrganizationRecord,
	membership: StaticFabOrganizationFingerprint,
): StaticFabOrganizationFingerprint {
	return Object.freeze({
		xor: composeOrganizationHash(record, membership.xor, HASH_SEED_A),
		sum: composeOrganizationHash(record, membership.sum, HASH_SEED_B),
	});
}

function composeOrganizationHash(
	record: StaticFabOrganizationRecord,
	membershipHash: number,
	seed: number,
): number {
	let hash = Math.imul(seed ^ 0x4f524741, 0x85ebca6b) >>> 0;
	hash = mixHash(hash, hashOrganizationMetadata(record, seed));
	hash = mixHash(hash, membershipHash);
	return finalizeHash(hash);
}

function hashOrganizationMetadata(record: StaticFabOrganizationRecord, seed: number): number {
	let hash = Math.imul(seed ^ 0x4f52474d, 0x85ebca6b) >>> 0;
	hash = mixHash(hash, record.id);
	hash = mixString(hash, record.kind);
	hash = mixString(hash, record.name);
	const parentIds = staticFabOrganizationParentIds(record);
	for (let index = 0; index < parentIds.length; index++) {
		hash = mixHash(hash, index);
		hash = mixHash(hash, parentIds[index] as number);
	}
	const properties = staticFabOrganizationProperties(record);
	hash = mixString(hash, properties.description);
	hash = mixString(hash, properties.color);
	return finalizeHash(hash);
}

function mixHash(hash: number, value: number): number {
	return Math.imul(hash ^ (value | 0), 0x27d4eb2f) >>> 0;
}

function mixString(hash: number, value: string): number {
	let mixed = mixHash(hash, value.length);
	for (let index = 0; index < value.length; index++) {
		mixed = mixHash(mixed, value.charCodeAt(index));
	}
	return mixed;
}

function finalizeHash(hash: number): number {
	let finalized = hash >>> 0;
	finalized ^= finalized >>> 16;
	finalized = Math.imul(finalized, 0x7feb352d) >>> 0;
	finalized ^= finalized >>> 15;
	return finalized >>> 0;
}

function staticFabOrganizationMembershipContainerIsFrozen(
	membership: StaticFabOrganizationMembership,
): boolean {
	return (
		Object.isFrozen(membership) &&
		Object.isFrozen(membership.railEdges) &&
		Object.isFrozen(membership.advancedSwitchIds) &&
		Object.isFrozen(membership.equipmentGroupIds)
	);
}

function assertFrozenMembershipContainer(membership: StaticFabOrganizationMembership): void {
	if (!staticFabOrganizationMembershipContainerIsFrozen(membership)) {
		throw new Error(
			"Static FAB organization membership must be frozen before fingerprint caching.",
		);
	}
}

function copyStaticFabOrganizationFingerprint(
	fingerprint: StaticFabOrganizationFingerprint,
): StaticFabOrganizationFingerprint {
	if (
		!Number.isSafeInteger(fingerprint?.xor) ||
		fingerprint.xor < 0 ||
		fingerprint.xor > 0xffff_ffff ||
		!Number.isSafeInteger(fingerprint.sum) ||
		fingerprint.sum < 0 ||
		fingerprint.sum > 0xffff_ffff
	) {
		throw new Error("Static FAB organization membership fingerprint must be a uint32 pair.");
	}
	return Object.freeze({ xor: fingerprint.xor, sum: fingerprint.sum });
}
