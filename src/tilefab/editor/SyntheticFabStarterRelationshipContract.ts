import type { FullFabAssemblyPlan } from "../compile/FullFabAssemblyPlan";
import { fullFabOrganizationIdentities } from "../compile/FullFabRelationships";
import type { PairedCirculationFabAssemblyPlan } from "../compile/PairedCirculationFabAssemblyPlan";
import { pairedCirculationFabOrganizationIdentities } from "../compile/PairedCirculationFabRelationships";
import type { ParallelHallFabAssemblyPlan } from "../compile/ParallelHallFabAssemblyPlan";
import { parallelHallFabOrganizationIdentities } from "../compile/ParallelHallFabRelationships";
import type { ProductionFabAssemblyPlan } from "../compile/ProductionFabAssemblyPlan";
import { productionFabOrganizationIdentities } from "../compile/ProductionFabRelationships";
import { resolveStaticFabGeneratorRelationships } from "../compile/StaticFabGeneratorRelationshipDescriptor";
import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import { emptyStaticFabAssemblyRelationshipState } from "../core/StaticFabAssemblyRelationship";
import { STATIC_FAB_ORGANIZATION_KINDS } from "../core/StaticFabOrganization";
import { createStaticFabAssemblyRelationshipSnapshot } from "../worker/StaticFabAssemblyRelationshipSoA";

/** Exact producer parity, including the portable copy, before ordinary or certified admission. */
export function syntheticFabStarterRelationshipsMatchPlan(
	prepared: PreparedSyntheticFabStarter,
	productionPlan: ProductionFabAssemblyPlan | null,
	parallelHallPlan: ParallelHallFabAssemblyPlan | null,
	pairedCirculationPlan: PairedCirculationFabAssemblyPlan | null,
	fullFabPlan: FullFabAssemblyPlan | null,
): boolean {
	let expected = emptyStaticFabAssemblyRelationshipState();
	if (
		[productionPlan, parallelHallPlan, pairedCirculationPlan, fullFabPlan].filter(Boolean).length >
		1
	)
		return false;
	const producer = productionPlan ?? parallelHallPlan ?? pairedCirculationPlan ?? fullFabPlan;
	if (producer) {
		const identities = productionPlan
			? productionFabOrganizationIdentities(productionPlan.banks)
			: parallelHallPlan
				? parallelHallFabOrganizationIdentities(parallelHallPlan.banks)
				: pairedCirculationPlan
					? pairedCirculationFabOrganizationIdentities(pairedCirculationPlan.banks)
					: fullFabOrganizationIdentities((fullFabPlan as FullFabAssemblyPlan).banks);
		const keys = identities.map((identity) => identity.key);
		const ids = prepared.snapshot.organizations.organizationIds;
		if (
			ids.length !== keys.length ||
			prepared.snapshot.organizations.nextOrganizationId !== keys.length + 1 ||
			ids.some((id, index) => id !== index + 1) ||
			prepared.placementBundle === null
		)
			return false;
		const idByKey = new Map(keys.map((key, index) => [key, ids[index] as number]));
		const fields = prepared.snapshot.organizations.records;
		const portable = prepared.placementBundle.organizations;
		if (portable.length !== identities.length) return false;
		for (const [index, identity] of identities.entries()) {
			const parentId = identity.parentKey === null ? null : idByKey.get(identity.parentKey);
			if (parentId === undefined) return false;
			const start = fields.parentOrganizationOffsets[index];
			const end = fields.parentOrganizationOffsets[index + 1];
			const row = portable[index];
			if (
				fields.names[index] !== identity.name ||
				STATIC_FAB_ORGANIZATION_KINDS[fields.kinds[index] as number] !== identity.kind ||
				start === undefined ||
				end === undefined ||
				end - start !== (parentId === null ? 0 : 1) ||
				(parentId !== null && fields.parentOrganizationIds[start] !== parentId) ||
				row?.name !== identity.name ||
				row.kind !== identity.kind ||
				!exactValue(row.parentOrganizationIndices, parentId === null ? [] : [parentId - 1])
			)
				return false;
		}
		expected = resolveStaticFabGeneratorRelationships(producer.relationships, idByKey);
	}
	// These producers start at (0, 0), include the whole hierarchy, and allocate dense IDs;
	// therefore complete bundle capture preserves its coordinates and organization ID order.
	return (
		exactValue(
			prepared.snapshot.relationships,
			createStaticFabAssemblyRelationshipSnapshot(expected),
		) &&
		(prepared.placementBundle === null ||
			exactValue(prepared.placementBundle.relationships, expected))
	);
}

/** Compare against the tiny declared shape; reject oversized lists before visiting their entries. */
function exactValue(actual: unknown, expected: unknown): boolean {
	if (actual === expected) return true;
	if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object")
		return false;
	if (ArrayBuffer.isView(expected)) {
		if (
			!ArrayBuffer.isView(actual) ||
			actual.constructor !== expected.constructor ||
			actual.byteLength !== expected.byteLength
		)
			return false;
		const left = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
		const right = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
		return right.every((byte, index) => byte === left[index]);
	}
	if (Array.isArray(expected)) {
		return (
			Array.isArray(actual) &&
			actual.length === expected.length &&
			expected.every((item, index) => exactValue(actual[index], item))
		);
	}
	// Only the declared plain records and typed columns are part of this contract.
	// Reject special objects before enumerating actual keys (including large typed arrays).
	if (
		Object.getPrototypeOf(expected) !== Object.prototype ||
		Object.getPrototypeOf(actual) !== Object.prototype
	)
		return false;
	const keys = Object.keys(expected);
	return (
		Object.keys(actual).length === keys.length &&
		keys.every(
			(key) =>
				Object.hasOwn(actual, key) &&
				exactValue(
					(actual as Record<string, unknown>)[key],
					(expected as Record<string, unknown>)[key],
				),
		)
	);
}
