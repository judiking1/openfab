import { describe, expect, it } from "vitest";
import type {
	StaticFabOrganizationKind,
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "./StaticFabOrganization";
import {
	reviewStaticFabSemanticHierarchyRecovery,
	STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_ID_SAMPLE_LIMIT,
	STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS,
	STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION,
	type StaticFabSemanticHierarchyRecoveryAction,
	type StaticFabSemanticHierarchyRecoveryTargetRole,
	staticFabSemanticHierarchyRecoveryIntentError,
} from "./StaticFabSemanticHierarchyRecovery";

describe("StaticFabSemanticHierarchyRecovery", () => {
	it("accepts only the exact versioned source intent", () => {
		expect(
			staticFabSemanticHierarchyRecoveryIntentError(intent("DETACH", "BAY_BANK", 2, 1)),
		).toBeNull();
		expect(
			staticFabSemanticHierarchyRecoveryIntentError(intent("DELETE", "BAY_BANK", 1, null)),
		).toBeNull();
		expect(
			staticFabSemanticHierarchyRecoveryIntentError(intent("DELETE", "FAB", 1, null)),
		).toBeNull();
		expect(staticFabSemanticHierarchyRecoveryIntentError(null)).toMatch(/object/);
		expect(
			staticFabSemanticHierarchyRecoveryIntentError({
				...intent("DELETE", "FAB", 1, null),
				extra: true,
			}),
		).toMatch(/fields/);
		expect(
			staticFabSemanticHierarchyRecoveryIntentError({
				...intent("DELETE", "FAB", 1, null),
				version: 2,
			}),
		).toMatch(/version/);
		expect(
			staticFabSemanticHierarchyRecoveryIntentError({
				...intent("DELETE", "FAB", 1, null),
				action: "DISCONNECT",
			}),
		).toMatch(/action/);
		expect(
			staticFabSemanticHierarchyRecoveryIntentError({
				...intent("DELETE", "FAB", 1, null),
				targetRole: "BANK",
			}),
		).toMatch(/target role/);
		expect(
			staticFabSemanticHierarchyRecoveryIntentError({
				...intent("DELETE", "FAB", 1, null),
				targetOrganizationId: 0,
			}),
		).toMatch(/organization id/);
		expect(
			staticFabSemanticHierarchyRecoveryIntentError({
				...intent("DELETE", "FAB", 1, null),
				expectedParentOrganizationId: 0,
			}),
		).toMatch(/expected parent organization id/);
		const missingExpectedParent = Object.freeze({
			version: STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION,
			action: "DELETE",
			targetRole: "FAB",
			targetOrganizationId: 1,
		});
		expect(staticFabSemanticHierarchyRecoveryIntentError(missingExpectedParent)).toMatch(/fields/);
	});

	it("reviews attached Bank detach and delete without certifying downstream impact", () => {
		const organizations = attachedFabState();
		for (const action of ["DETACH", "DELETE"] as const) {
			const review = reviewStaticFabSemanticHierarchyRecovery(
				organizations,
				intent(action, "BAY_BANK", 2, 1),
			);

			expect(review).toMatchObject({
				action,
				targetRole: "BAY_BANK",
				targetOrganizationId: 2,
				expectedParentOrganizationId: 1,
				targetName: "Bank A",
				resolvedSemanticRole: "BAY_BANK",
				attachmentState: "ATTACHED_TO_ROOT_FAB",
				parentFabOrganizationId: 1,
				subtreeOrganizationIdSample: [2, 3, 4],
				subtreeOrganizationCount: 3,
				subtreeOrganizationOmittedCount: 0,
				roleCounts: {
					fab: 0,
					bayBank: 1,
					bay: 1,
					processLoop: 1,
					unrecognized: 0,
				},
				downstreamImpactStatus: "RAIL_PORT_EQUIPMENT_UNREVIEWED",
				accepted: true,
				issueCode: null,
			});
			expect(Object.isFrozen(review)).toBe(true);
			expect(Object.isFrozen(review.subtreeOrganizationIdSample)).toBe(true);
			expect(Object.isFrozen(review.roleCounts)).toBe(true);
			expect(review.subtreeOrganizationFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
		}
	});

	it("allows deletion of a fully detached semantic Bank but rejects redundant detach", () => {
		const organizations = detachedBankState();
		const deletion = reviewStaticFabSemanticHierarchyRecovery(
			organizations,
			intent("DELETE", "BAY_BANK", 1, null),
		);
		const detach = reviewStaticFabSemanticHierarchyRecovery(
			organizations,
			intent("DETACH", "BAY_BANK", 1, null),
		);

		expect(deletion).toMatchObject({
			accepted: true,
			attachmentState: "DETACHED",
			parentFabOrganizationId: null,
			subtreeOrganizationIdSample: [1, 2, 3],
		});
		expect(detach).toMatchObject({
			accepted: false,
			issueCode: "ALREADY_DETACHED",
			attachmentState: "DETACHED",
			subtreeOrganizationIdSample: [1, 2, 3],
		});
	});

	it("reviews only root Fab deletion and explicitly blocks Fab detach", () => {
		const organizations = attachedFabState();
		const deletion = reviewStaticFabSemanticHierarchyRecovery(
			organizations,
			intent("DELETE", "FAB", 1, null),
		);
		const detach = reviewStaticFabSemanticHierarchyRecovery(
			organizations,
			intent("DETACH", "FAB", 1, null),
		);

		expect(deletion).toMatchObject({
			accepted: true,
			attachmentState: "ROOT_FAB",
			parentFabOrganizationId: null,
			subtreeOrganizationIdSample: [1, 2, 3, 4],
			roleCounts: {
				fab: 1,
				bayBank: 1,
				bay: 1,
				processLoop: 1,
				unrecognized: 0,
			},
		});
		expect(detach).toMatchObject({
			accepted: false,
			issueCode: "UNSUPPORTED_OPERATION",
			attachmentState: "ROOT_FAB",
			subtreeOrganizationIdSample: [1, 2, 3, 4],
		});
		expect(detach.reason).toContain("FAB DETACH");
	});

	it("does not promote plain kind or name records to semantic roles", () => {
		const plainBank = state([record(1, "AREA", "Bank A"), record(2, "BAY", "Bay A", [1])]);
		const plainFab = state([record(1, "AREA", "Fab A"), record(2, "AREA", "Bank A", [1])]);

		expect(
			reviewStaticFabSemanticHierarchyRecovery(plainBank, intent("DELETE", "BAY_BANK", 1, null)),
		).toMatchObject({ accepted: false, issueCode: "ROLE_MISMATCH" });
		expect(
			reviewStaticFabSemanticHierarchyRecovery(plainFab, intent("DELETE", "FAB", 1, null)),
		).toMatchObject({ accepted: false, issueCode: "ROLE_MISMATCH" });
	});

	it("fails closed on multiple Bank parents", () => {
		const organizations = state([
			record(1, "AREA", "Fab A"),
			record(2, "AREA", "Bank A", [1, 5]),
			record(3, "BAY", "Bay A", [2]),
			record(4, "AISLE", "Loop A", [3]),
			record(5, "AREA", "Fab B"),
		]);

		expect(
			reviewStaticFabSemanticHierarchyRecovery(organizations, intent("DELETE", "BAY_BANK", 2, 1)),
		).toMatchObject({
			accepted: false,
			issueCode: "AMBIGUOUS_HIERARCHY",
			attachmentState: "UNRESOLVED",
			parentFabOrganizationId: null,
		});
	});

	it("fails closed on a foreign Bank parent and a non-root Fab", () => {
		const foreignParent = state([
			record(1, "PROCESS_FAMILY", "Foreign Owner"),
			record(2, "AREA", "Bank A", [1]),
			record(3, "BAY", "Bay A", [2]),
			record(4, "AISLE", "Loop A", [3]),
		]);
		const nonRootFab = state([
			record(1, "PROCESS_FAMILY", "Foreign Owner"),
			record(2, "AREA", "Fab A", [1]),
			record(3, "AREA", "Bank A", [2]),
			record(4, "BAY", "Bay A", [3]),
			record(5, "AISLE", "Loop A", [4]),
		]);

		expect(
			reviewStaticFabSemanticHierarchyRecovery(foreignParent, intent("DELETE", "BAY_BANK", 2, 1)),
		).toMatchObject({ accepted: false, issueCode: "CROSS_OWNER_PARENT" });
		expect(
			reviewStaticFabSemanticHierarchyRecovery(nonRootFab, intent("DELETE", "FAB", 2, null)),
		).toMatchObject({ accepted: false, issueCode: "CROSS_OWNER_PARENT" });
	});

	it("fails closed when a descendant is shared outside the target subtree", () => {
		const organizations = state([
			record(1, "AREA", "Bank A"),
			record(2, "BAY", "Bay A", [1]),
			record(3, "AISLE", "Loop A", [2, 4]),
			record(4, "BAY", "Bay B"),
		]);
		const review = reviewStaticFabSemanticHierarchyRecovery(
			organizations,
			intent("DELETE", "BAY_BANK", 1, null),
		);

		expect(review).toMatchObject({
			accepted: false,
			issueCode: "SHARED_DESCENDANT_DEPENDENCY",
			subtreeOrganizationIdSample: [1, 2, 3],
			roleCounts: { bayBank: 1, bay: 1, processLoop: 1 },
			downstreamImpactStatus: "RAIL_PORT_EQUIPMENT_UNREVIEWED",
		});
	});

	it("rejects stale attached, detached, and root-Fab parent expectations", () => {
		const attached = attachedFabState();
		const detached = detachedBankState();
		for (const review of [
			reviewStaticFabSemanticHierarchyRecovery(attached, intent("DELETE", "BAY_BANK", 2, null)),
			reviewStaticFabSemanticHierarchyRecovery(attached, intent("DELETE", "BAY_BANK", 2, 99)),
			reviewStaticFabSemanticHierarchyRecovery(detached, intent("DELETE", "BAY_BANK", 1, 1)),
			reviewStaticFabSemanticHierarchyRecovery(attached, intent("DELETE", "FAB", 1, 99)),
		]) {
			expect(review).toMatchObject({
				accepted: false,
				issueCode: "STALE_PARENT_RELATIONSHIP",
			});
		}
		expect(
			reviewStaticFabSemanticHierarchyRecovery(attached, intent("DELETE", "BAY_BANK", 2, null)),
		).toMatchObject({
			expectedParentOrganizationId: null,
			parentFabOrganizationId: 1,
			attachmentState: "ATTACHED_TO_ROOT_FAB",
		});
	});

	it("returns an immutable diagnostic review for malformed intent", () => {
		const review = reviewStaticFabSemanticHierarchyRecovery(attachedFabState(), {
			action: "DELETE",
			targetRole: "FAB",
			targetOrganizationId: 1,
			expectedParentOrganizationId: null,
		});

		expect(review).toMatchObject({
			version: STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION,
			action: "DELETE",
			targetRole: "FAB",
			targetOrganizationId: 1,
			targetName: null,
			attachmentState: "UNRESOLVED",
			subtreeOrganizationIdSample: [],
			subtreeOrganizationOmittedCount: 0,
			subtreeOrganizationFingerprint: null,
			accepted: false,
			issueCode: "INVALID_INTENT",
		});
		expect(Object.isFrozen(review)).toBe(true);
		expect(Object.isFrozen(review.subtreeOrganizationIdSample)).toBe(true);
		expect(Object.isFrozen(review.roleCounts)).toBe(true);
	});

	it("bounds the public subtree id sample while retaining exact count and fingerprint", () => {
		const bank = record(1, "AREA", "Bank A");
		const bays = Array.from({ length: 65 }, (_, index) =>
			record(index + 2, "BAY", `Bay ${index + 1}`, [1]),
		);
		const loops = Array.from({ length: 65 }, (_, index) =>
			record(index + 67, "AISLE", `Loop ${index + 1}`, [index + 2]),
		);
		const review = reviewStaticFabSemanticHierarchyRecovery(
			state([bank, ...bays, ...loops]),
			intent("DELETE", "BAY_BANK", 1, null),
		);

		expect(review).toMatchObject({
			accepted: true,
			subtreeOrganizationCount: 131,
			subtreeOrganizationOmittedCount: 131 - STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_ID_SAMPLE_LIMIT,
			roleCounts: { bayBank: 1, bay: 65, processLoop: 65 },
		});
		expect(review.subtreeOrganizationIdSample).toHaveLength(
			STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_ID_SAMPLE_LIMIT,
		);
		expect(review.subtreeOrganizationIdSample.at(-1)).toBe(
			STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_ID_SAMPLE_LIMIT,
		);
		expect(review.subtreeOrganizationFingerprint).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
	});

	it("rejects an oversized organization source before attempting shape traversal", () => {
		const repeated = record(1, "AREA", "Repeated");
		const organizations = Object.freeze({
			nextOrganizationId: 2,
			records: Object.freeze(
				Array.from(
					{ length: STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_MAX_ORGANIZATIONS + 1 },
					() => repeated,
				),
			),
		}) satisfies StaticFabOrganizationState;

		expect(
			reviewStaticFabSemanticHierarchyRecovery(organizations, intent("DELETE", "FAB", 1, null)),
		).toMatchObject({
			accepted: false,
			issueCode: "SOURCE_LIMIT_EXCEEDED",
			subtreeOrganizationCount: 0,
			subtreeOrganizationFingerprint: null,
		});
	});
});

function intent(
	action: StaticFabSemanticHierarchyRecoveryAction,
	targetRole: StaticFabSemanticHierarchyRecoveryTargetRole,
	targetOrganizationId: number,
	expectedParentOrganizationId: number | null,
) {
	return Object.freeze({
		version: STATIC_FAB_SEMANTIC_HIERARCHY_RECOVERY_VERSION,
		action,
		targetRole,
		targetOrganizationId,
		expectedParentOrganizationId,
	});
}

function attachedFabState(): StaticFabOrganizationState {
	return state([
		record(1, "AREA", "Fab A"),
		record(2, "AREA", "Bank A", [1]),
		record(3, "BAY", "Bay A", [2]),
		record(4, "AISLE", "Loop A", [3]),
	]);
}

function detachedBankState(): StaticFabOrganizationState {
	return state([
		record(1, "AREA", "Bank A"),
		record(2, "BAY", "Bay A", [1]),
		record(3, "AISLE", "Loop A", [2]),
	]);
}

function state(records: readonly StaticFabOrganizationRecord[]): StaticFabOrganizationState {
	const ordered = [...records].sort((left, right) => left.id - right.id);
	return Object.freeze({
		nextOrganizationId: (ordered.at(-1)?.id ?? 0) + 1,
		records: Object.freeze(ordered),
	});
}

function record(
	id: number,
	kind: StaticFabOrganizationKind,
	name: string,
	parentOrganizationIds: readonly number[] = [],
): StaticFabOrganizationRecord {
	return Object.freeze({
		id,
		kind,
		name,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		properties: Object.freeze({ description: "", color: "TEAL" as const }),
		membership: Object.freeze({
			railEdges: Object.freeze([
				Object.freeze({
					from: Object.freeze({ x: id * 2, y: 0 }),
					to: Object.freeze({ x: id * 2 + 1, y: 0 }),
				}),
			]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}
