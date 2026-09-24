import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import {
	checksumStaticFabAssemblyRelationshipState,
	copyStaticFabAssemblyRelationshipState,
	remapStaticFabAssemblyRelationshipRecord,
	type StaticFabAssemblyRelationshipRecordV1,
	type StaticFabAssemblyRelationshipStateV1,
} from "../core/StaticFabAssemblyRelationship";

export const STATIC_FAB_GENERATOR_RELATIONSHIP_DESCRIPTOR_VERSION = 1 as const;

/** Organization references are one-based indexes into this explicit seed-key table, not runtime IDs. */
export interface StaticFabGeneratorRelationshipDescriptor {
	readonly version: typeof STATIC_FAB_GENERATOR_RELATIONSHIP_DESCRIPTOR_VERSION;
	readonly organizationKeys: readonly string[];
	readonly relationships: StaticFabAssemblyRelationshipStateV1;
	readonly fingerprint: string;
}

const descriptors = new WeakSet<StaticFabGeneratorRelationshipDescriptor>();

/** Pure declaration only. The final document must still validate every edge, owner, and seam. */
export function createStaticFabGeneratorRelationshipDescriptor(
	organizationKeys: readonly string[],
	records: readonly StaticFabAssemblyRelationshipRecordV1[],
): StaticFabGeneratorRelationshipDescriptor {
	assertSeedKeys(organizationKeys);
	const relationships = copyStaticFabAssemblyRelationshipState({
		nextRelationshipId: records.length + 1,
		records,
	});
	const localIds = new Map(organizationKeys.map((_, index) => [index + 1, index + 1]));
	for (const [index, record] of relationships.records.entries()) {
		if (record.id !== index + 1 || record.reviewPolicy !== "AUTHORING_NON_DETACHABLE") {
			throw new Error("Generator relationships require dense IDs and non-detachable identity.");
		}
		// The existing complete remapper also checks nested support/seam owner references.
		remapStaticFabAssemblyRelationshipRecord(record, {
			relationshipId: record.id,
			organizationIds: localIds,
			quarterTurns: 0,
			offset: { x: 0, y: 0 },
		});
	}
	const keys = Object.freeze([...organizationKeys]);
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings(["STATIC_FAB_GENERATOR_RELATIONSHIP_DESCRIPTOR_V1"]);
	checksum.addNumbers([keys.length]);
	checksum.addStrings(keys);
	checksum.addStrings([checksumStaticFabAssemblyRelationshipState(relationships)]);
	const descriptor = Object.freeze({
		version: STATIC_FAB_GENERATOR_RELATIONSHIP_DESCRIPTOR_VERSION,
		organizationKeys: keys,
		relationships,
		fingerprint: checksum.digest(),
	});
	descriptors.add(descriptor);
	return descriptor;
}

/** Resolve only declared seed keys. No map scan, name matching, or hierarchy inference occurs here. */
export function resolveStaticFabGeneratorRelationships(
	descriptor: StaticFabGeneratorRelationshipDescriptor,
	organizationIdByKey: ReadonlyMap<string, number>,
): StaticFabAssemblyRelationshipStateV1 {
	if (!descriptors.has(descriptor))
		throw new Error("Generator relationship descriptor is untrusted.");
	const ids = new Map<number, number>();
	const targets = new Set<number>();
	for (const [index, key] of descriptor.organizationKeys.entries()) {
		const id = organizationIdByKey.get(key);
		if (!Number.isInteger(id) || id === undefined || id < 1 || id >= 2_147_483_647) {
			throw new Error(`Generator relationship organization '${key}' has no valid ID.`);
		}
		if (targets.has(id))
			throw new Error("Generator relationship seed keys alias one organization.");
		targets.add(id);
		ids.set(index + 1, id);
	}
	return copyStaticFabAssemblyRelationshipState({
		nextRelationshipId: descriptor.relationships.nextRelationshipId,
		records: descriptor.relationships.records.map((record) =>
			remapStaticFabAssemblyRelationshipRecord(record, {
				relationshipId: record.id,
				organizationIds: ids,
				quarterTurns: 0,
				offset: { x: 0, y: 0 },
			}),
		),
	});
}

function assertSeedKeys(keys: readonly string[]): void {
	if (keys.length > 100_000) throw new Error("Generator relationship seed-key budget exceeded.");
	const seen = new Set<string>();
	for (const key of keys) {
		if (
			typeof key !== "string" ||
			key.length === 0 ||
			key.length > 160 ||
			key !== key.trim() ||
			[...key].some((character) => {
				const code = character.charCodeAt(0);
				return code < 32 || code === 127;
			}) ||
			seen.has(key)
		) {
			throw new Error("Generator relationship seed keys must be unique, bounded identifiers.");
		}
		seen.add(key);
	}
}
