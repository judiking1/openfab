import { describe, expect, it } from "vitest";
import { decodeRailPatchSoA, encodeRailPatchEvent } from "../worker/railMirrorProtocol";
import { completeCooperativeSteps } from "./CooperativeTask";
import { RAIL_COORDINATE_MAX_METERS } from "./RailCoordinateDomain";
import type { RailPatchEvent } from "./RailDocument";
import type { DirectedRailEdge } from "./RailModuleOwnership";
import { type RailPatchTransition, railPatchTransitionFingerprint } from "./RailPatchHistory";
import {
	compareDirectedRailEdges,
	createCanonicalStaticFabOrganizationStateBuilder,
	type StaticFabOrganizationRecord,
} from "./StaticFabOrganization";
import { assertStaticFabProcessLoopRepairTransitionSteps } from "./StaticFabProcessLoopRepairContract";

describe("standalone Loop rail repair semantic contract (no Apply authority)", () => {
	it("accepts exact detour paint/erase and its inverse without changing owner metadata or equipment", () => {
		const proposal = detour();
		const before = JSON.stringify(proposal);
		expect(validate(proposal)).toEqual({ organizationId: 1 });
		expect(validate(reverse(proposal))).toEqual({ organizationId: 1 });
		expect(validate(structuredClone(proposal))).toEqual({ organizationId: 1 });
		expect(JSON.stringify(proposal)).toBe(before);
		expect(Object.isFrozen(validate(proposal))).toBe(true);
		expect(reverse(reverse(proposal))).toEqual(proposal);
		expect(railPatchTransitionFingerprint(proposal, true)).toBe(
			railPatchTransitionFingerprint(reverse(proposal)),
		);
	});

	it.each([
		{ target: [0, -1], old: [1, 0], before: 0x20, after: 0x10, removed: 0x08, added: 0x04 },
		{ target: [1, 0], old: [0, -1], before: 0x10, after: 0x20, removed: 0x04, added: 0x08 },
		{ target: [0, 1], old: [1, 0], before: 0x20, after: 0x40, removed: 0x08, added: 0x01 },
		{ target: [-1, 0], old: [1, 0], before: 0x20, after: 0x80, removed: 0x08, added: 0x02 },
	] as const)("uses independent reciprocal bytes for direction $after", (value) => {
		const retained = edge(-3, -3, -2, -3);
		const proposal = transition(
			owner([retained, edge(0, 0, value.old[0], value.old[1])]),
			owner([retained, edge(0, 0, value.target[0], value.target[1])]),
			[
				{ x: 0, y: 0, before: value.before, after: value.after },
				{ x: value.old[0], y: value.old[1], before: value.removed, after: 0 },
				{ x: value.target[0], y: value.target[1], before: 0, after: value.added },
			],
		);
		expect(validate(proposal)).toEqual({ organizationId: 1 });
		expect(validate(reverse(proposal))).toEqual({ organizationId: 1 });
	});

	it("preserves unrelated rail bits at a changed cell and refuses changing them", () => {
		const proposal = detour();
		proposal.changes = proposal.changes.map((change) =>
			change.x === 0 && change.y === 0
				? { ...change, before: change.before | 1, after: change.after | 1 }
				: change,
		);
		expect(validate(proposal)).toEqual({ organizationId: 1 });
		proposal.changes = proposal.changes.map((change) =>
			change.x === 0 && change.y === 0 ? { ...change, after: change.after & ~1 } : change,
		);
		expect(() => validate(proposal)).toThrow(/signed edge delta/);
	});

	it("accepts an opened draft and restoration with the same Loop declaration", () => {
		const before = owner([edge(0, 0, 1, 0), edge(1, 0, 2, 0)]);
		const after = owner([edge(1, 0, 2, 0)]);
		const proposal = transition(before, after, [
			{ x: 0, y: 0, before: 0x20, after: 0 },
			{ x: 1, y: 0, before: 0x28, after: 0x20 },
		]);
		expect(validate(proposal)).toEqual({ organizationId: 1 });
		expect(validate(reverse(proposal))).toEqual({ organizationId: 1 });
		expect(after.declaredSemanticRole).toBe("PROCESS_LOOP");
	});

	it.each([
		[-RAIL_COORDINATE_MAX_METERS, -RAIL_COORDINATE_MAX_METERS],
		[RAIL_COORDINATE_MAX_METERS - 2, RAIL_COORDINATE_MAX_METERS],
		[-13, -29],
	] as const)("matches direction reversal at supported coordinates %i,%i", (x, y) => {
		const before = owner([edge(x, y, x + 1, y), edge(x + 1, y, x + 2, y)]);
		const after = owner([edge(x + 1, y, x, y), edge(x + 2, y, x + 1, y)]);
		const proposal = transition(before, after, [
			{ x, y, before: 0x20, after: 0x02 },
			{ x: x + 1, y, before: 0x28, after: 0x82 },
			{ x: x + 2, y, before: 0x08, after: 0x80 },
		]);
		expect(validate(proposal)).toEqual({ organizationId: 1 });
		expect(validate(reverse(proposal))).toEqual({ organizationId: 1 });
	});

	it.each([
		false,
		true,
	])("retains the contract through existing SoA encoding (compact=%s)", (compactOrganizations) => {
		const proposal = detour();
		const event: RailPatchEvent = {
			...proposal,
			sequence: 1,
			// The repair kind is deliberately not enabled by this pure contract checkpoint.
			kind: "edit",
			baseRevision: 2,
			revision: 6,
			relationshipChanges: [],
			relationshipNextIdBefore: 1,
			relationshipNextIdAfter: 1,
		};
		const before = event.organizationChanges[0]?.before as StaticFabOrganizationRecord;
		const packet = encodeRailPatchEvent(event, { compactOrganizations });
		const delivered = structuredClone(packet.patch, { transfer: packet.transfer });
		const decoded = decodeRailPatchSoA(delivered, {
			nextOrganizationId: 2,
			records: [before],
		});
		expect(validate(decoded)).toEqual({ organizationId: 1 });
		expect(validate(reverse(decoded))).toEqual({ organizationId: 1 });
		expect(decoded.changes).toEqual(event.changes);
		expect(decoded.organizationChanges).toEqual(event.organizationChanges);
		const inverse = reverse(event);
		const reversePacket = encodeRailPatchEvent(
			{ ...event, ...inverse, sequence: 2 },
			{ compactOrganizations },
		);
		const reverseDelivered = structuredClone(reversePacket.patch, {
			transfer: reversePacket.transfer,
		});
		const restored = decodeRailPatchSoA(reverseDelivered, {
			nextOrganizationId: 2,
			records: [event.organizationChanges[0]?.after as StaticFabOrganizationRecord],
		});
		expect(validate(restored)).toEqual({ organizationId: 1 });
		expect(restored.organizationChanges[0]?.after).toEqual(before);
		if (compactOrganizations) {
			delivered.organizations.beforeRecordHashes[0] =
				(delivered.organizations.beforeRecordHashes[0] as number) ^ 1;
			expect(() =>
				decodeRailPatchSoA(delivered, { nextOrganizationId: 2, records: [before] }),
			).toThrow(/fingerprint/);
		}
	});

	it("supports an existing owner and preserved cursors at the signed Int32 maximum", () => {
		const id = 0x7fff_fffe;
		const proposal = detour();
		proposal.organizationChanges = proposal.organizationChanges.map((change) => ({
			id,
			before: { ...(change.before as StaticFabOrganizationRecord), id },
			after: { ...(change.after as StaticFabOrganizationRecord), id },
		}));
		proposal.organizationNextIdBefore = 0x7fff_ffff;
		proposal.organizationNextIdAfter = 0x7fff_ffff;
		proposal.relationshipNextIdBefore = 0x7fff_ffff;
		proposal.relationshipNextIdAfter = 0x7fff_ffff;
		expect(validate(proposal)).toEqual({ organizationId: id });
		expect(validate(reverse(proposal))).toEqual({ organizationId: id });
	});

	it.each([
		0,
		-1,
		1.5,
		0x8000_0000,
		Number.NaN,
	])("rejects invalid preserved organization cursor %s", (cursor) => {
		const proposal = detour();
		proposal.organizationNextIdBefore = cursor;
		proposal.organizationNextIdAfter = cursor;
		expect(() => validate(proposal)).toThrow(/cursors/);
	});

	it("rejects owner IDs that have not yet been issued by the cursor", () => {
		const proposal = detour();
		proposal.organizationNextIdBefore = 1;
		proposal.organizationNextIdAfter = 1;
		expect(() => validate(proposal)).toThrow(/existing organization ID/);
	});

	it.each([
		0,
		-1,
		1.5,
		0x8000_0000,
		Number.NaN,
	])("rejects invalid preserved relationship cursor %s", (cursor) => {
		const proposal = detour();
		proposal.relationshipNextIdBefore = cursor;
		proposal.relationshipNextIdAfter = cursor;
		expect(() => validate(proposal)).toThrow(/cursors/);
	});

	it("refuses raw rail edits when the owner has no matching membership delta", () => {
		const proposal = detour();
		const before = proposal.organizationChanges[0]?.before as StaticFabOrganizationRecord;
		proposal.organizationChanges = [{ id: before.id, before, after: before }];
		expect(() => validate(proposal)).toThrow(/signed edge delta/);
	});

	it.each([
		"missing-endpoint",
		"extra-cell",
		"duplicate-cell",
		"wrong-polarity",
		"noop",
	] as const)("refuses a raw bit change with %s instead of exact signed membership changes", (kind) => {
		const proposal = detour();
		if (kind === "missing-endpoint") proposal.changes = proposal.changes.slice(1);
		if (kind === "extra-cell")
			proposal.changes = [...proposal.changes, { x: 8, y: 9, before: 0, after: 0x20 }];
		if (kind === "duplicate-cell")
			proposal.changes = [
				...proposal.changes,
				proposal.changes[0] as RailPatchTransition["changes"][number],
			];
		if (kind === "wrong-polarity")
			proposal.changes = proposal.changes.map((change, index) =>
				index === 0 ? { ...change, before: change.after, after: change.before } : change,
			);
		if (kind === "noop")
			proposal.changes = proposal.changes.map((change, index) =>
				index === 0 ? { ...change, after: change.before } : change,
			);
		const reason =
			kind === "missing-endpoint"
				? /reciprocal endpoint/
				: kind === "noop"
					? /byte mutations/
					: /signed edge delta/;
		expect(() => validate(proposal)).toThrow(reason);
		expect(() => validate(reverse(proposal))).toThrow(reason);
	});

	it.each([
		-1,
		256,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
	])("rejects invalid mutation byte %s", (value) => {
		const proposal = detour();
		proposal.changes = proposal.changes.map((change, index) =>
			index === 0 ? { ...change, before: value } : change,
		);
		expect(() => validate(proposal)).toThrow(/byte mutations/);
		expect(() => validate(reverse(proposal))).toThrow(/byte mutations/);
	});

	it.each([
		Number.NaN,
		Number.POSITIVE_INFINITY,
		0.5,
	])("rejects a nonbyte %s after an otherwise exact pure deletion", (value) => {
		const proposal = transition(
			owner([edge(0, 0, 1, 0), edge(1, 0, 2, 0)]),
			owner([edge(1, 0, 2, 0)]),
			[
				{ x: 0, y: 0, before: 0x20, after: value },
				{ x: 1, y: 0, before: 0x28, after: 0x20 },
			],
		);
		expect(() => validate(proposal)).toThrow(/byte mutations/);
	});

	it.each([
		RAIL_COORDINATE_MAX_METERS + 1,
		-RAIL_COORDINATE_MAX_METERS - 1,
		0.5,
		Number.NaN,
	])("rejects unsupported mutation coordinate %s", (value) => {
		const proposal = detour();
		proposal.changes = proposal.changes.map((change, index) =>
			index === 0 ? { ...change, x: value } : change,
		);
		expect(() => validate(proposal)).toThrow(/supported/);
	});

	it.each([
		"name",
		"description",
		"color",
		"declaration",
		"parent",
		"id",
		"switch",
		"equipment",
		"kind",
	] as const)("refuses changing owner %s as part of rail repair", (kind) => {
		const proposal = detour();
		const change = proposal.organizationChanges[0];
		const after = structuredClone(change?.after) as StaticFabOrganizationRecord;
		const replacement: StaticFabOrganizationRecord = {
			...after,
			...(kind === "name" ? { name: "Different Loop" } : {}),
			...(kind === "declaration" ? { declaredSemanticRole: null } : {}),
			...(kind === "parent" ? { parentOrganizationIds: [9] } : {}),
			...(kind === "id" ? { id: 2 } : {}),
			...(kind === "kind" ? ({ kind: "BAY", declaredSemanticRole: null } as const) : {}),
			properties: {
				description: kind === "description" ? "changed" : "Retained description",
				color: kind === "color" ? "ROSE" : "TEAL",
			},
			membership: {
				...after.membership,
				advancedSwitchIds: kind === "switch" ? [14] : [13],
				equipmentGroupIds: kind === "equipment" ? [8] : [7],
			},
		};
		proposal.organizationChanges = [
			{ id: 1, before: change?.before as StaticFabOrganizationRecord, after: replacement },
		];
		expect(() => validate(proposal)).toThrow();
		expect(() => validate(reverse(proposal))).toThrow();
	});

	it.each([
		"duplicate",
		"unsorted",
		"non-cardinal",
		"unsupported",
	] as const)("checks %s changed rail membership after structured clone", (kind) => {
		const proposal = detour();
		const after = structuredClone(
			proposal.organizationChanges[0]?.after,
		) as StaticFabOrganizationRecord;
		let edges = [...after.membership.railEdges];
		if (kind === "duplicate") edges.splice(1, 0, edges[0] as DirectedRailEdge);
		if (kind === "unsorted") edges.reverse();
		if (kind === "non-cardinal") edges = [edge(0, 0, 1, 1)];
		if (kind === "unsupported")
			edges = [edge(RAIL_COORDINATE_MAX_METERS, 0, RAIL_COORDINATE_MAX_METERS + 1, 0)];
		proposal.organizationChanges = [
			{
				...(proposal.organizationChanges[0] as RailPatchTransition["organizationChanges"][number]),
				after: { ...after, membership: { ...after.membership, railEdges: edges } },
			},
		];
		expect(() => validate(proposal)).toThrow();
		expect(() => validate(reverse(proposal))).toThrow();
	});

	it.each([
		"empty-rail",
		"zero-owner",
		"insert-owner",
		"remove-owner",
		"two-owners",
		"organization-cursor",
		"relationship-cursor",
		"missing-relationship-cursor",
		"impact",
		"ports",
		"groups",
		"switches",
		"relationships",
		"operations",
	] as const)("rejects mixed command authority: %s", (kind) => {
		const proposal = detour();
		const change = proposal
			.organizationChanges[0] as RailPatchTransition["organizationChanges"][number];
		if (kind === "empty-rail") proposal.changes = [];
		if (kind === "zero-owner") proposal.organizationChanges = [];
		if (kind === "insert-owner") proposal.organizationChanges = [{ ...change, before: null }];
		if (kind === "remove-owner") proposal.organizationChanges = [{ ...change, after: null }];
		if (kind === "two-owners") proposal.organizationChanges = [change, change];
		if (kind === "organization-cursor") proposal.organizationNextIdAfter = 3;
		if (kind === "relationship-cursor") proposal.relationshipNextIdAfter = 2;
		if (kind === "missing-relationship-cursor") delete proposal.relationshipNextIdBefore;
		if (kind === "impact") proposal.organizationImpactAuthorizations = [1];
		if (kind === "ports") proposal.portChanges = [{ id: 1, before: null, after: null }];
		if (kind === "groups") proposal.equipmentGroupChanges = [{ id: 1, before: null, after: null }];
		if (kind === "switches") proposal.switchChanges = [{ id: 1, before: null, after: null }];
		if (kind === "relationships")
			proposal.relationshipChanges = [{ id: 1, before: null, after: null }];
		if (kind === "operations")
			proposal.operationalConfigurationPatch = {} as NonNullable<
				RailPatchTransition["operationalConfigurationPatch"]
			>;
		expect(() => validate(proposal)).toThrow();
	});

	it("yields while checking a 100k-edge unchanged prefix and both reciprocal additions", () => {
		const count = 100_000;
		const sourceEdges = Array.from({ length: count }, (_, x) => edge(x, 0, x + 1, 0));
		const before = owner(sourceEdges);
		const after = owner([...sourceEdges, edge(count, 0, count + 1, 0)]);
		const proposal = transition(before, after, [
			{ x: count, y: 0, before: 0x08, after: 0x28 },
			{ x: count + 1, y: 0, before: 0, after: 0x08 },
		]);
		let reads = 0,
			maximumReads = 0,
			yields = 0;
		const observe = (edges: readonly DirectedRailEdge[]): readonly DirectedRailEdge[] =>
			new Proxy(edges, {
				get(target, property, receiver) {
					if (typeof property === "string" && /^\d+$/.test(property)) reads++;
					return Reflect.get(target, property, receiver);
				},
			});
		proposal.organizationChanges = [
			{
				id: 1,
				before: {
					...before,
					membership: { ...before.membership, railEdges: observe(before.membership.railEdges) },
				},
				after: {
					...after,
					membership: { ...after.membership, railEdges: observe(after.membership.railEdges) },
				},
			},
		];
		const steps = assertStaticFabProcessLoopRepairTransitionSteps(proposal);
		let result: IteratorResult<void, { readonly organizationId: number }>;
		do {
			reads = 0;
			result = steps.next();
			maximumReads = Math.max(maximumReads, reads);
			if (!result.done) yields++;
		} while (!result.done);
		expect(result.value).toEqual({ organizationId: 1 });
		expect(yields).toBeGreaterThan(count * 3);
		expect(maximumReads).toBeLessThanOrEqual(4);
		expect(before.membership.railEdges).toHaveLength(count);
		expect(after.membership.railEdges).toHaveLength(count + 1);
	}, 30_000);
});

function validate(proposal: RailPatchTransition): { readonly organizationId: number } {
	return completeCooperativeSteps(assertStaticFabProcessLoopRepairTransitionSteps(proposal));
}

function edge(x: number, y: number, tx: number, ty: number): DirectedRailEdge {
	return { from: { x, y }, to: { x: tx, y: ty } };
}

function owner(edges: readonly DirectedRailEdge[]): StaticFabOrganizationRecord {
	const builder = createCanonicalStaticFabOrganizationStateBuilder(2);
	for (const value of [...edges].sort(compareDirectedRailEdges)) builder.addRailEdge(value);
	builder.addAdvancedSwitchId(13);
	builder.addEquipmentGroupId(7);
	builder.finishRecord({
		id: 1,
		kind: "AISLE",
		name: "Manual Loop",
		declaredSemanticRole: "PROCESS_LOOP",
		description: "Retained description",
		color: "TEAL",
	});
	return builder.finish().records[0] as StaticFabOrganizationRecord;
}

function transition(
	before: StaticFabOrganizationRecord,
	after: StaticFabOrganizationRecord,
	changes: RailPatchTransition["changes"],
): RailPatchTransition {
	return {
		changes,
		switchChanges: [],
		portChanges: [],
		equipmentGroupChanges: [],
		organizationChanges: [{ id: 1, before, after }],
		organizationNextIdBefore: 2,
		organizationNextIdAfter: 2,
		relationshipChanges: [],
		relationshipNextIdBefore: 1,
		relationshipNextIdAfter: 1,
		organizationImpactAuthorizations: [],
		operationalConfigurationPatch: null,
	};
}

function detour(): RailPatchTransition {
	return transition(
		owner([edge(0, 0, 1, 0), edge(1, 0, 2, 0)]),
		owner([edge(0, 0, 0, 1), edge(0, 1, 1, 1), edge(1, 1, 1, 0), edge(1, 0, 2, 0)]),
		[
			{ x: 0, y: 0, before: 0x20, after: 0x40 },
			{ x: 1, y: 0, before: 0x28, after: 0x24 },
			{ x: 0, y: 1, before: 0, after: 0x21 },
			{ x: 1, y: 1, before: 0, after: 0x18 },
		],
	);
}

function reverse(proposal: RailPatchTransition): RailPatchTransition {
	return {
		...proposal,
		changes: proposal.changes.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
		organizationChanges: proposal.organizationChanges.map((change) => ({
			...change,
			before: change.after,
			after: change.before,
		})),
	};
}
