import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { StaticFabAssemblyRelationshipStateV1 } from "../core/StaticFabAssemblyRelationship";
import {
	type StaticFabOrganizationRecord,
	type StaticFabOrganizationState,
	staticFabOrganizationDeclaredSemanticRole,
	staticFabOrganizationParentIds,
	staticFabOrganizationProperties,
} from "../core/StaticFabOrganization";
import { staticFabOrganizationMembershipFingerprint } from "../core/StaticFabOrganizationFingerprint";
import type { TileMap } from "../core/TileMap";
import { checksumRailMap, checksumRailMapLegacyVersionTwo } from "./RailMirrorChecksum";

/** Authenticate historical recovery bytes only. These digests are never Worker patch authority. */
export function checksumLegacyOpenFabProject(
	projectVersion: number,
	map: TileMap,
	portEquipment: PortEquipmentState,
	organizations: StaticFabOrganizationState,
	relationships: StaticFabAssemblyRelationshipStateV1,
): string {
	if (!Number.isInteger(projectVersion) || projectVersion < 0 || projectVersion > 14)
		throw new Error("Unsupported legacy project checksum version.");
	if (
		portEquipment.equipmentGroups.some(
			(group) => group.kind === "EQ" && group.bodyDimensions !== undefined,
		)
	)
		throw new Error("Historical projects cannot carry authored EQ body dimensions.");
	if (projectVersion === 14)
		return checksumRailMap(map, portEquipment, organizations, relationships);
	if (
		organizations.records.some(
			(record) => staticFabOrganizationDeclaredSemanticRole(record) !== null,
		)
	)
		throw new Error("Historical projects cannot declare organization roles.");
	if (projectVersion >= 11)
		return checksumRailMapLegacyVersionTwo(map, portEquipment, organizations, relationships);
	if (relationships.records.length !== 0 || relationships.nextRelationshipId !== 1)
		throw new Error("Historical project checksum cannot contain relationships.");
	if (
		projectVersion <= 5 &&
		(organizations.records.length !== 0 || organizations.nextOrganizationId !== 1)
	)
		throw new Error("Historical project checksum cannot contain organizations.");
	if (
		projectVersion <= 1 &&
		(portEquipment.ports.length !== 0 ||
			portEquipment.equipmentGroups.length !== 0 ||
			portEquipment.nextPortId !== 1 ||
			portEquipment.nextEquipmentGroupId !== 1)
	)
		throw new Error("Historical project checksum cannot contain equipment.");
	if (
		projectVersion === 6 &&
		organizations.records.some(
			(record) =>
				staticFabOrganizationParentIds(record).length !== 0 ||
				staticFabOrganizationProperties(record).description !== "" ||
				staticFabOrganizationProperties(record).color !== "TEAL",
		)
	)
		throw new Error("Historical v6 organization checksum cannot contain newer metadata.");
	const fields = checksumRailMap(
		map,
		portEquipment,
		projectVersion === 6 ? { records: [], nextOrganizationId: 1 } : organizations,
		relationships,
	).split(":");
	if (projectVersion === 6) {
		let xor = Number.parseInt(fields[10] as string, 16),
			sum = Number.parseInt(fields[11] as string, 16);
		for (const record of organizations.records) {
			const membership = staticFabOrganizationMembershipFingerprint(record.membership);
			xor = (xor ^ legacyVersionSixOrganizationHash(record, membership.xor, 0x811c9dc5)) >>> 0;
			sum = (sum + legacyVersionSixOrganizationHash(record, membership.sum, 0x9e3779b9)) >>> 0;
		}
		fields[6] = hex(organizations.records.length);
		fields[7] = hex(organizations.nextOrganizationId);
		fields[10] = hex(xor);
		fields[11] = hex(sum);
	}
	const indices =
		projectVersion <= 1
			? [1, 2, 3, 10, 11]
			: projectVersion <= 5
				? [1, 2, 3, 4, 5, 10, 11]
				: [1, 2, 3, 4, 5, 6, 7, 10, 11];
	return indices.map((index) => fields[index]).join(":");
}

function legacyVersionSixOrganizationHash(
	record: StaticFabOrganizationRecord,
	membershipHash: number,
	seed: number,
): number {
	let metadata = Math.imul(seed ^ 0x4f52474d, 0x85ebca6b) >>> 0;
	metadata = mix(metadata, record.id);
	metadata = mixString(metadata, record.kind);
	metadata = mixString(metadata, record.name);
	let hash = Math.imul(seed ^ 0x4f524741, 0x85ebca6b) >>> 0;
	hash = mix(hash, finalize(metadata));
	return finalize(mix(hash, membershipHash));
}
function mix(hash: number, value: number): number {
	return Math.imul(hash ^ (value | 0), 0x27d4eb2f) >>> 0;
}
function mixString(hash: number, value: string): number {
	let result = mix(hash, value.length);
	for (let index = 0; index < value.length; index++) result = mix(result, value.charCodeAt(index));
	return result;
}
function finalize(hash: number): number {
	let result = hash ^ (hash >>> 16);
	result = Math.imul(result, 0x7feb352d);
	return (result ^ (result >>> 15)) >>> 0;
}
function hex(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
