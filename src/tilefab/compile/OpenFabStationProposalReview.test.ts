import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import {
	isCertifiedImmutablePortEquipmentMutationPlanGraph,
	type PortEquipmentMutationPlan,
} from "../core/PortEquipmentPlan";
import type { CardinalPortRoute } from "../core/PortRecord";
import { planRailConstruction } from "../core/paint";
import { RailDocument, type RailPatchEvent } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import {
	type HydratedOpenFabStationProposalArtifact,
	hydrateOpenFabStationProposalArtifact,
	OPENFAB_STATION_PROPOSAL_V1_HEADERS,
} from "./OpenFabStationProposalArtifact";
import { parseOpenFabStationProposalCsv } from "./OpenFabStationProposalCsvReader";
import {
	evaluateOpenFabStationProposalReview,
	finalizeOpenFabStationProposalReview,
	OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES,
	type OpenFabStationProposalGroupDecision,
	type OpenFabStationProposalIncludeDecision,
	type OpenFabStationProposalReviewDraft,
	type OpenFabStationProposalReviewIssueCode,
	type OpenFabStationProposalReviewSource,
	planReviewedOpenFabStationProposalBatch,
} from "./OpenFabStationProposalReview";

describe("OpenFabStationProposalReview", () => {
	it("finalizes an explicit mixed review into one ordinary atomic command", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const artifact = proposalArtifact();
		const beforeMap = document.map;
		const beforeEquipment = document.portEquipment;
		const beforeOrganizations = document.organizations;
		const beforeSequence = document.getPatchSequence();
		const events: RailPatchEvent[] = [];
		document.subscribe((event) => events.push(event));

		const evaluation = evaluateOpenFabStationProposalReview(artifact, reviewedDraft(), source);

		expect(evaluation).toMatchObject({
			state: "READY",
			proposalRowCount: 5,
			groupDecisionCount: 3,
			includedPortCount: 5,
			rejectedPortCount: 0,
			equipmentGroupCount: 3,
		});
		expect(evaluation.reviewFingerprint).toMatch(/^openfab-station-proposal-review:v1:/);
		expect(document.map).toBe(beforeMap);
		expect(document.portEquipment).toBe(beforeEquipment);
		expect(document.organizations).toBe(beforeOrganizations);
		expect(document.getPatchSequence()).toBe(beforeSequence);
		expect(events).toHaveLength(0);

		const reviewed = finalizeOpenFabStationProposalReview(evaluation);
		const plan = planReviewedOpenFabStationProposalBatch(reviewed, source);

		expect(plan.valid, plan.reason).toBe(true);
		expect(isCertifiedImmutablePortEquipmentMutationPlanGraph(plan)).toBe(true);
		expect(plan.kind).toBe("place-port-equipment-batch");
		expect(plan.portMutations.map((mutation) => mutation.id)).toEqual([41, 42, 43, 44, 45]);
		expect(plan.equipmentGroupMutations.map((mutation) => mutation.id)).toEqual([9, 10, 11]);
		expect(plan.equipmentGroupMutations.map((mutation) => mutation.after?.kind)).toEqual([
			"OHB",
			"EQ",
			"STK",
		]);
		expect(plan.portMutations.map((mutation) => mutation.after?.direction)).toEqual([
			"WITH_TRAVEL",
			"AGAINST_TRAVEL",
			"AGAINST_TRAVEL",
			"WITH_TRAVEL",
			"WITH_TRAVEL",
		]);
		expect(document.portEquipment).toBe(beforeEquipment);
		expect(document.getPatchSequence()).toBe(beforeSequence);

		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.map).toBe(beforeMap);
		expect(document.map.getRevision()).toBe(beforeMap.getRevision());
		expect(document.portEquipment).toMatchObject({
			nextPortId: 46,
			nextEquipmentGroupId: 12,
			ports: { length: 5 },
			equipmentGroups: { length: 3 },
		});
		expect(document.organizations).toBe(beforeOrganizations);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "place-port-equipment-batch",
			changes: [],
			switchChanges: [],
			portChanges: { length: 5 },
			equipmentGroupChanges: { length: 3 },
			organizationChanges: [],
		});

		expect(document.undo()).toBe(true);
		expect(document.portEquipment).toMatchObject({
			nextPortId: 46,
			nextEquipmentGroupId: 12,
			ports: [],
			equipmentGroups: [],
		});
		expect(events.at(-1)).toMatchObject({
			kind: "undo",
			historyOriginKind: "place-port-equipment-batch",
			portChanges: { length: 5 },
			equipmentGroupChanges: { length: 3 },
		});
		expect(document.redo()).toBe(true);
		expect(document.portEquipment.ports.map((port) => port.id)).toEqual([41, 42, 43, 44, 45]);
		expect(document.commitPortEquipment(plan)).toBe(false);
	});

	it("lowers a homogeneous reviewed proposal to the existing single-kind command", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const draft = reviewedDraft();
		const evaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact([syntheticRows()[0] as SyntheticStationRow]),
			{
				...draft,
				rowDecisions: [draft.rowDecisions[0]],
				groupDecisions: [draft.groupDecisions[0]],
			},
			source,
		);

		expect(evaluation).toMatchObject({
			state: "READY",
			groupDecisionCount: 1,
			includedPortCount: 1,
			equipmentGroupCount: 1,
		});
		const plan = planReviewedOpenFabStationProposalBatch(
			finalizeOpenFabStationProposalReview(evaluation),
			source,
		);
		expect(plan).toMatchObject({ valid: true, kind: "place-ohb" });
		expect(document.commitPortEquipment(plan)).toBe(true);
		expect(document.portEquipment).toMatchObject({
			ports: { length: 1 },
			equipmentGroups: { length: 1 },
		});
	});

	it("blocks every unresolved review dimension and treats all-reject as no changes", () => {
		const document = straightDocument();
		const source = reviewSource(document);

		const heuristicDraft = reviewedDraft();
		const heuristicRows = [...heuristicDraft.rowDecisions];
		heuristicRows[3] = {
			...(heuristicRows[3] as OpenFabStationProposalIncludeDecision),
			directionReview: "CONFIRM_DECLARED",
		};
		const heuristic = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			{ ...heuristicDraft, rowDecisions: heuristicRows },
			source,
		);
		expect(heuristic.state).toBe("BLOCKED");
		expect(heuristic.issueCount("ROW_DIRECTION_REVIEW_INVALID")).toBe(1);
		expect(heuristic.rowIssueMask(3) & issueBit("ROW_DIRECTION_REVIEW_INVALID")).not.toBe(0);

		const noGroups = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			{ ...reviewedDraft(), groupDecisions: [] },
			source,
		);
		expect(noGroups.state).toBe("BLOCKED");
		expect(noGroups.issueCount("ROW_GROUP_MISSING")).toBe(5);

		const unresolvedOrganization = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			{
				...reviewedDraft(),
				organizationPolicy: "PENDING",
			} as unknown as OpenFabStationProposalReviewDraft,
			source,
		);
		expect(unresolvedOrganization.state).toBe("BLOCKED");
		expect(unresolvedOrganization.issueCount("ORGANIZATION_POLICY_UNRESOLVED")).toBe(1);

		const allRejectedDraft: OpenFabStationProposalReviewDraft = {
			rowDecisions: Array.from({ length: 5 }, (_, row) => ({
				row,
				disposition: "REJECT" as const,
				reason: "USER_EXCLUDED" as const,
			})),
			groupDecisions: [],
			rejectedSourceRowsPolicy: "NOT_APPLICABLE",
			unknownColumnsPolicy: "NOT_APPLICABLE",
			organizationPolicy: "EXPLICIT_UNASSIGNED",
		};
		const allRejected = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			allRejectedDraft,
			source,
		);
		expect(allRejected).toMatchObject({
			state: "NO_CHANGES",
			includedPortCount: 0,
			rejectedPortCount: 5,
			equipmentGroupCount: 0,
			reviewFingerprint: null,
		});
		expect(() => finalizeOpenFabStationProposalReview(allRejected)).toThrow(/not ready/i);
		expect(document.portEquipment.ports).toHaveLength(0);
	});

	it("uses source position only as acknowledged evidence after exact attachment selection", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const rows = syntheticRows();
		rows[0] = { ...rows[0], source_x_mm: "99999", source_z_mm: "-99999" };
		const unacknowledged = evaluateOpenFabStationProposalReview(
			proposalArtifact(rows),
			reviewedDraft(),
			source,
		);
		expect(unacknowledged.state).toBe("BLOCKED");
		expect(unacknowledged.issueCount("ROW_SOURCE_POSITION_REVIEW_INVALID")).toBe(1);

		const draft = reviewedDraft();
		const decisions = [...draft.rowDecisions];
		decisions[0] = {
			...(decisions[0] as OpenFabStationProposalIncludeDecision),
			sourcePositionReview: "ACKNOWLEDGE_MISMATCH",
		};
		const evaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact(rows),
			{ ...draft, rowDecisions: decisions },
			source,
		);
		expect(evaluation.state).toBe("READY");
		const plan = planReviewedOpenFabStationProposalBatch(
			finalizeOpenFabStationProposalReview(evaluation),
			source,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.portMutations[0]?.after?.route).toEqual(cardinalRoute(1));
		expect(plan.portMutations[0]?.after?.stationMillimeters).toBe(500);
		expect(JSON.stringify(plan)).not.toContain("99999");
	});

	it("requires explicit overrides for unresolved values and explicit acknowledgement of discarded rows", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const rows = syntheticRows();
		rows[0] = {
			...rows[0],
			station_mm: "600",
			side: "UNRESOLVED",
			direction: "UNKNOWN",
			direction_evidence: "UNKNOWN",
			port_type: "UNRESOLVED",
			physical_group_kind: "UNRESOLVED",
		};
		rows.push(stationRow({ port_key: "Z-DISCARDED-SOURCE_SENTINEL", station_mm: "invalid" }));
		const artifact = proposalArtifact(rows);
		expect(artifact).toMatchObject({ rowCount: 5, rejectedRowCount: 1 });

		const implicit = evaluateOpenFabStationProposalReview(artifact, reviewedDraft(), source);
		expect(implicit.state).toBe("BLOCKED");
		expect(implicit.issueCount("PROPOSAL_REJECTIONS_UNACKNOWLEDGED")).toBe(1);
		expect(implicit.issueCount("ROW_TYPE_REVIEW_INVALID")).toBe(1);
		expect(implicit.issueCount("ROW_STATION_REVIEW_INVALID")).toBe(1);
		expect(implicit.issueCount("ROW_SIDE_OFFSET_REVIEW_INVALID")).toBe(1);
		expect(implicit.issueCount("ROW_DIRECTION_REVIEW_INVALID")).toBe(1);

		const overrideDraft = reviewedDraft();
		const overrideRows = [...overrideDraft.rowDecisions];
		overrideRows[0] = {
			...(overrideRows[0] as OpenFabStationProposalIncludeDecision),
			typeReview: "OVERRIDE",
			stationReview: "OVERRIDE",
			sideOffsetReview: "OVERRIDE",
			directionReview: "OVERRIDE",
		};
		const overrideGroups = [...overrideDraft.groupDecisions];
		overrideGroups[0] = {
			...(overrideGroups[0] as OpenFabStationProposalGroupDecision),
			groupingReview: "OVERRIDE",
		};
		const explicit = evaluateOpenFabStationProposalReview(
			proposalArtifact(rows),
			{
				...overrideDraft,
				rowDecisions: overrideRows,
				groupDecisions: overrideGroups,
				rejectedSourceRowsPolicy: "ACKNOWLEDGE_DISCARDED",
			},
			source,
		);
		expect(explicit.state).toBe("READY");
		const plan = planReviewedOpenFabStationProposalBatch(
			finalizeOpenFabStationProposalReview(explicit),
			source,
		);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.portMutations[0]?.after).toMatchObject({
			portType: "OHB",
			stationMillimeters: 500,
			side: "LEFT",
			lateralOffsetMillimeters: 700,
			direction: "WITH_TRAVEL",
		});
		expect(JSON.stringify(plan)).not.toContain("Z-DISCARDED-SOURCE_SENTINEL");
	});

	it("is source-order independent, redacts proposal identity, and rejects a structural plan clone", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const firstEvaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact(syntheticRows()),
			reviewedDraft(),
			source,
		);
		const reversedDraft = reviewedDraft();
		const secondEvaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact([...syntheticRows()].reverse()),
			{
				...reversedDraft,
				rowDecisions: [...reversedDraft.rowDecisions].reverse(),
				groupDecisions: [...reversedDraft.groupDecisions]
					.reverse()
					.map((group) => ({ ...group, memberRows: [...group.memberRows].reverse() })),
			},
			source,
		);

		expect(firstEvaluation.state).toBe("READY");
		expect(secondEvaluation.state).toBe("READY");
		expect(secondEvaluation.reviewFingerprint).toBe(firstEvaluation.reviewFingerprint);
		const firstReviewed = finalizeOpenFabStationProposalReview(firstEvaluation);
		expect(planReviewedOpenFabStationProposalBatch({ ...firstReviewed }, source)).toMatchObject({
			valid: false,
		});
		const firstPlan = planReviewedOpenFabStationProposalBatch(firstReviewed, source);
		const secondPlan = planReviewedOpenFabStationProposalBatch(
			finalizeOpenFabStationProposalReview(secondEvaluation),
			source,
		);
		expect(secondPlan).toEqual(firstPlan);
		const serialized = JSON.stringify(firstPlan);
		expect(serialized).not.toContain("SOURCE_SENTINEL");
		expect(serialized).not.toContain("ATTACHMENT_ALIAS");
		expect(serialized).not.toContain("ORGANIZATION_ALIAS");

		const clone = structuredClone(firstPlan);
		expect(document.commitPortEquipment(clone)).toBe(false);
		const disguisedSingleKind = {
			...firstPlan,
			kind: "place-ohb",
		} as PortEquipmentMutationPlan;
		expect(document.commitPortEquipment(disguisedSingleKind)).toBe(false);
		const disguisedEdit = {
			...firstPlan,
			kind: "edit-port-equipment",
		} as PortEquipmentMutationPlan;
		expect(document.commitPortEquipment(disguisedEdit)).toBe(false);
		expect(document.portEquipment.ports).toHaveLength(0);
		expect(document.commitPortEquipment(firstPlan)).toBe(true);
		expect(document.portEquipment.ports).toHaveLength(5);
	});

	it("binds finalized evidence to captured authored object identities, not a mutable wrapper", () => {
		const first = straightDocument();
		const second = straightDocument();
		const source = {
			map: first.map,
			portEquipment: first.portEquipment,
			organizations: first.organizations,
			patchSequence: first.getPatchSequence(),
		};
		const evaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			reviewedDraft(),
			source,
		);
		expect(evaluation.state).toBe("READY");
		const reviewed = finalizeOpenFabStationProposalReview(evaluation);

		source.map = second.map;
		source.portEquipment = second.portEquipment;
		source.organizations = second.organizations;
		source.patchSequence = second.getPatchSequence();
		const plan = planReviewedOpenFabStationProposalBatch(reviewed, source);

		expect(plan.valid).toBe(false);
		expect(first.portEquipment.ports).toHaveLength(0);
		expect(second.portEquipment.ports).toHaveLength(0);
	});

	it("snapshots one source generation before checksum and batch issuance", () => {
		const first = straightDocument();
		const second = straightDocument();
		let alternate = false;
		let mapReads = 0;
		let equipmentReads = 0;
		let organizationReads = 0;
		let sequenceReads = 0;
		const source = {
			get map() {
				return !alternate || mapReads++ === 0 ? first.map : second.map;
			},
			get portEquipment() {
				return !alternate || equipmentReads++ === 0 ? first.portEquipment : second.portEquipment;
			},
			get organizations() {
				return !alternate || organizationReads++ === 0 ? first.organizations : second.organizations;
			},
			get patchSequence() {
				return !alternate || sequenceReads++ === 0
					? first.getPatchSequence()
					: second.getPatchSequence();
			},
		};
		const evaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			reviewedDraft(),
			source,
		);
		expect(evaluation.state).toBe("READY");
		const reviewed = finalizeOpenFabStationProposalReview(evaluation);
		alternate = true;
		mapReads = 0;
		equipmentReads = 0;
		organizationReads = 0;
		sequenceReads = 0;

		const plan = planReviewedOpenFabStationProposalBatch(reviewed, source);
		expect(plan.valid, plan.reason).toBe(true);
		expect(plan.kind).toBe("place-port-equipment-batch");
		expect(second.commitPortEquipment(structuredClone(plan))).toBe(false);
		expect(first.commitPortEquipment(plan)).toBe(true);
		expect(first.portEquipment.ports).toHaveLength(5);
		expect(second.portEquipment.ports).toHaveLength(0);
	});

	it("terminally consumes a mixed batch attempted against another isomorphic document", () => {
		const first = straightDocument();
		const second = straightDocument();
		const source = reviewSource(first);
		const evaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			reviewedDraft(),
			source,
		);
		const plan = planReviewedOpenFabStationProposalBatch(
			finalizeOpenFabStationProposalReview(evaluation),
			source,
		);

		expect(plan.kind).toBe("place-port-equipment-batch");
		expect(second.commitPortEquipment(plan)).toBe(false);
		expect(first.commitPortEquipment(plan)).toBe(false);
		expect(first.portEquipment.ports).toHaveLength(0);
		expect(second.portEquipment.ports).toHaveLength(0);
	});

	it("fails closed on malformed facade rows and over-budget group memberships", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const artifact = proposalArtifact();
		const malformedFacade = {
			...artifact,
			readRow: () => ({}),
		} as unknown as HydratedOpenFabStationProposalArtifact;
		const malformedFingerprint = {
			...artifact,
			semanticFingerprint: Symbol("malformed"),
		} as unknown as HydratedOpenFabStationProposalArtifact;
		const throwingScalar = { ...artifact } as Record<string, unknown>;
		Object.defineProperty(throwingScalar, "rejectedRowCount", {
			enumerable: true,
			get: () => {
				throw new Error("untrusted facade getter");
			},
		});

		expect(() =>
			evaluateOpenFabStationProposalReview(malformedFacade, reviewedDraft(), source),
		).not.toThrow();
		const malformed = evaluateOpenFabStationProposalReview(
			malformedFacade,
			reviewedDraft(),
			source,
		);
		expect(malformed.state).toBe("BLOCKED");
		expect(malformed.issueCount("INVALID_SOURCE")).toBe(1);
		for (const candidate of [malformedFingerprint, throwingScalar]) {
			expect(() =>
				evaluateOpenFabStationProposalReview(
					candidate as HydratedOpenFabStationProposalArtifact,
					reviewedDraft(),
					source,
				),
			).not.toThrow();
			const evaluation = evaluateOpenFabStationProposalReview(
				candidate as HydratedOpenFabStationProposalArtifact,
				reviewedDraft(),
				source,
			);
			expect(evaluation.state).toBe("BLOCKED");
			expect(evaluation.issueCount("INVALID_SOURCE")).toBe(1);
		}
		const throwingSource = {
			...source,
			map: {
				getRevision: () => {
					throw new Error("untrusted source getter");
				},
			},
		} as unknown as OpenFabStationProposalReviewSource;
		const invalidSource = evaluateOpenFabStationProposalReview(
			artifact,
			reviewedDraft(),
			throwingSource,
		);
		expect(invalidSource.state).toBe("BLOCKED");
		expect(invalidSource.issueCount("INVALID_SOURCE")).toBe(1);

		const draft = reviewedDraft();
		const oversizedMembership = evaluateOpenFabStationProposalReview(
			artifact,
			{
				...draft,
				groupDecisions: [
					{
						...draft.groupDecisions[0],
						memberRows: new Array<number>(10_000).fill(0),
					} as OpenFabStationProposalGroupDecision,
				],
			},
			source,
		);
		expect(oversizedMembership.state).toBe("BLOCKED");
		expect(oversizedMembership.issueCount("GROUP_DECISION_INVALID")).toBe(1);
	});

	it("rejects draft accessors without invoking values that could change after confirmation", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const artifact = proposalArtifact();

		const stationDraft = reviewedDraft();
		const stationRows = [...stationDraft.rowDecisions];
		const changingStation = {
			...(stationRows[0] as OpenFabStationProposalIncludeDecision),
		};
		let stationReads = 0;
		Object.defineProperty(changingStation, "stationMillimeters", {
			enumerable: true,
			get() {
				stationReads++;
				return stationReads <= 4 ? 500 : 750;
			},
		});
		stationRows[0] = changingStation as OpenFabStationProposalIncludeDecision;
		const stationEvaluation = evaluateOpenFabStationProposalReview(
			artifact,
			{ ...stationDraft, rowDecisions: stationRows },
			source,
		);
		expect(stationReads).toBe(0);
		expect(stationEvaluation.state).toBe("BLOCKED");
		expect(stationEvaluation.issueCount("ROW_DISPOSITION_INVALID")).toBe(1);

		const rejectDraft = reviewedDraft();
		const rejectRows = [...rejectDraft.rowDecisions];
		const accessorReject = { row: 0, disposition: "REJECT" } as Record<string, unknown>;
		let rejectReads = 0;
		Object.defineProperty(accessorReject, "reason", {
			enumerable: true,
			get() {
				rejectReads++;
				return "USER_EXCLUDED";
			},
		});
		rejectRows[0] = accessorReject as unknown as OpenFabStationProposalIncludeDecision;
		const rejectEvaluation = evaluateOpenFabStationProposalReview(
			artifact,
			{ ...rejectDraft, rowDecisions: rejectRows },
			source,
		);
		expect(rejectReads).toBe(0);
		expect(rejectEvaluation.issueCount("ROW_DISPOSITION_INVALID")).toBe(1);

		const routeDraft = reviewedDraft();
		const routeRows = [...routeDraft.rowDecisions];
		const routeDecision = routeRows[0] as OpenFabStationProposalIncludeDecision;
		const accessorRoute = { ...routeDecision.route } as Record<string, unknown>;
		let routeReads = 0;
		Object.defineProperty(accessorRoute, "x", {
			enumerable: true,
			get() {
				routeReads++;
				return 1;
			},
		});
		routeRows[0] = {
			...routeDecision,
			route: accessorRoute as unknown as CardinalPortRoute,
		};
		const routeEvaluation = evaluateOpenFabStationProposalReview(
			artifact,
			{ ...routeDraft, rowDecisions: routeRows },
			source,
		);
		expect(routeReads).toBe(0);
		expect(routeEvaluation.issueCount("ROW_ATTACHMENT_REVIEW_INVALID")).toBe(1);

		const groupDraft = reviewedDraft();
		const groupDecisions = [...groupDraft.groupDecisions];
		const accessorGroup = { ...groupDecisions[0] } as Record<string, unknown>;
		let groupReads = 0;
		Object.defineProperty(accessorGroup, "template", {
			enumerable: true,
			get() {
				groupReads++;
				return "SINGLE";
			},
		});
		groupDecisions[0] = accessorGroup as unknown as OpenFabStationProposalGroupDecision;
		const groupEvaluation = evaluateOpenFabStationProposalReview(
			artifact,
			{ ...groupDraft, groupDecisions },
			source,
		);
		expect(groupReads).toBe(0);
		expect(groupEvaluation.issueCount("GROUP_DECISION_INVALID")).toBe(1);

		const policyDraft = { ...reviewedDraft() } as Record<string, unknown>;
		let policyReads = 0;
		Object.defineProperty(policyDraft, "organizationPolicy", {
			enumerable: true,
			get() {
				policyReads++;
				return "EXPLICIT_UNASSIGNED";
			},
		});
		const policyEvaluation = evaluateOpenFabStationProposalReview(
			artifact,
			policyDraft as unknown as OpenFabStationProposalReviewDraft,
			source,
		);
		expect(policyReads).toBe(0);
		expect(policyEvaluation.state).toBe("BLOCKED");
		expect(policyEvaluation.issueCount("INVALID_DRAFT")).toBe(1);
	});

	it("captures fixed array prefixes without triggering append-on-read Proxy growth", () => {
		const draft = reviewedDraft();
		let numericReads = 0;
		const appendOnNumericRead = <T>(values: T[], append: () => T): T[] => {
			const maximumLength = values.length + 16;
			return new Proxy(values, {
				get(target, property, receiver) {
					if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
						numericReads++;
						if (target.length < maximumLength) target.push(append());
					}
					return Reflect.get(target, property, receiver);
				},
			});
		};

		const rowTarget = [...draft.rowDecisions];
		const proxiedRows = appendOnNumericRead(rowTarget, () => draft.rowDecisions[0]);
		const memberTarget = [...draft.groupDecisions[0].memberRows];
		const groupTarget = draft.groupDecisions.map((group, index) =>
			index === 0
				? {
						...group,
						memberRows: appendOnNumericRead(memberTarget, () => 0),
					}
				: group,
		) as OpenFabStationProposalGroupDecision[];
		const proxiedGroups = appendOnNumericRead(groupTarget, () => draft.groupDecisions[0]);

		const evaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			{
				...draft,
				rowDecisions: proxiedRows,
				groupDecisions: proxiedGroups,
			},
			reviewSource(straightDocument()),
		);

		expect(numericReads).toBe(0);
		expect(rowTarget).toHaveLength(5);
		expect(groupTarget).toHaveLength(3);
		expect(memberTarget).toEqual([0]);
		expect(evaluation).toMatchObject({
			state: "READY",
			proposalRowCount: 5,
			groupDecisionCount: 3,
			includedPortCount: 5,
			equipmentGroupCount: 3,
		});
	});

	it("classifies invalid override values by station and side-offset review dimensions", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const draft = reviewedDraft();
		const rowDecisions = [...draft.rowDecisions];
		rowDecisions[0] = {
			...(rowDecisions[0] as OpenFabStationProposalIncludeDecision),
			stationMillimeters: 1.5,
			stationReview: "OVERRIDE",
		};
		rowDecisions[1] = {
			...(rowDecisions[1] as OpenFabStationProposalIncludeDecision),
			side: "LEFT",
			lateralOffsetMillimeters: 0,
			sideOffsetReview: "OVERRIDE",
		};

		const evaluation = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			{ ...draft, rowDecisions },
			source,
		);

		expect(evaluation.state).toBe("BLOCKED");
		expect(evaluation.issueCount("ROW_STATION_REVIEW_INVALID")).toBe(1);
		expect(evaluation.issueCount("ROW_SIDE_OFFSET_REVIEW_INVALID")).toBe(1);
		expect(evaluation.issueCount("ROW_ATTACHMENT_REVIEW_INVALID")).toBe(0);
	});

	it("rejects duplicate target occupancy and exhausted stable-id cursors before plan issuance", () => {
		const document = straightDocument();
		const source = reviewSource(document);
		const conflictDraft = reviewedDraft();
		const conflictRows = [...conflictDraft.rowDecisions];
		conflictRows[2] = {
			...(conflictRows[2] as OpenFabStationProposalIncludeDecision),
			route: cardinalRoute(4),
		};
		const conflict = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			{ ...conflictDraft, rowDecisions: conflictRows },
			source,
		);
		expect(conflict.state).toBe("BLOCKED");
		expect(conflict.issueCount("PROSPECTIVE_LAYOUT_INVALID")).toBe(1);
		expect(document.portEquipment.ports).toHaveLength(0);

		const exhausted = straightDocument({
			nextPortId: 0x7fff_fffd,
			nextEquipmentGroupId: 9,
			ports: [],
			equipmentGroups: [],
		});
		const exhaustedReview = evaluateOpenFabStationProposalReview(
			proposalArtifact(),
			reviewedDraft(),
			reviewSource(exhausted),
		);
		expect(exhaustedReview.state).toBe("BLOCKED");
		expect(exhaustedReview.issueCount("ID_ALLOCATION_EXHAUSTED")).toBe(1);
		expect(exhausted.portEquipment.ports).toHaveLength(0);
	});
});

function straightDocument(
	portEquipment: PortEquipmentState = {
		nextPortId: 41,
		nextEquipmentGroupId: 9,
		ports: [],
		equipmentGroups: [],
	},
): RailDocument {
	const seed = new RailDocument();
	const rail = planRailConstruction(seed.map, { x: 0, y: 0 }, { x: 16, y: 0 });
	if (!seed.commit(rail)) throw new Error("Synthetic straight rail could not be built.");
	return RailDocument.fromLoadedMap(seed.map, 7, portEquipment);
}

function reviewSource(document: RailDocument): OpenFabStationProposalReviewSource {
	return Object.freeze({
		map: document.map,
		portEquipment: document.portEquipment,
		organizations: document.organizations,
		patchSequence: document.getPatchSequence(),
	});
}

function reviewedDraft(): OpenFabStationProposalReviewDraft {
	const rowDecisions: OpenFabStationProposalIncludeDecision[] = [
		includeDecision(0, "OHB", 1, "LEFT", 700, "WITH_TRAVEL", "CONFIRM_DECLARED"),
		includeDecision(1, "EQ", 4, "CENTER", 0, "AGAINST_TRAVEL", "CONFIRM_DECLARED"),
		includeDecision(2, "EQ", 6, "CENTER", 0, "AGAINST_TRAVEL", "CONFIRM_DECLARED"),
		includeDecision(3, "STK", 10, "CENTER", 0, "WITH_TRAVEL", "CONFIRM_HEURISTIC"),
		includeDecision(4, "STK", 12, "CENTER", 0, "WITH_TRAVEL", "CONFIRM_HEURISTIC"),
	];
	const groupDecisions: OpenFabStationProposalGroupDecision[] = [
		{
			reviewGroupId: 701,
			kind: "OHB",
			template: "SINGLE",
			groupingReview: "CONFIRM_DECLARED",
			memberRows: [0],
		},
		{
			reviewGroupId: 702,
			kind: "EQ",
			pitchMillimeters: 2_000,
			recipe: null,
			groupingReview: "CONFIRM_DECLARED",
			memberRows: [1, 2],
		},
		{
			reviewGroupId: 703,
			kind: "STK",
			template: "FLEX",
			groupingReview: "CONFIRM_DECLARED",
			memberRows: [3, 4],
		},
	];
	return {
		rowDecisions,
		groupDecisions,
		rejectedSourceRowsPolicy: "NOT_APPLICABLE",
		unknownColumnsPolicy: "NOT_APPLICABLE",
		organizationPolicy: "EXPLICIT_UNASSIGNED",
	};
}

function includeDecision(
	row: number,
	portType: "OHB" | "EQ" | "STK",
	x: number,
	side: "CENTER" | "LEFT" | "RIGHT",
	lateralOffsetMillimeters: number,
	direction: "WITH_TRAVEL" | "AGAINST_TRAVEL",
	directionReview: OpenFabStationProposalIncludeDecision["directionReview"],
): OpenFabStationProposalIncludeDecision {
	return {
		row,
		disposition: "INCLUDE",
		identityAction: "CREATE_NEW",
		portType,
		typeReview: "CONFIRM_DECLARED",
		attachmentReview: "USER_SELECTED_EXACT_ROUTE",
		route: cardinalRoute(x),
		stationMillimeters: 500,
		stationReview: "CONFIRM_DECLARED",
		side,
		lateralOffsetMillimeters,
		sideOffsetReview: "CONFIRM_DECLARED",
		direction,
		directionReview,
		sourcePositionReview: "NOT_PROVIDED",
	};
}

function cardinalRoute(x: number): CardinalPortRoute {
	return { kind: "CARDINAL_CELL" as const, x, z: 0, from: DIR_W, to: DIR_E };
}

function proposalArtifact(
	rows: readonly SyntheticStationRow[] = syntheticRows(),
): HydratedOpenFabStationProposalArtifact {
	const headers = [...OPENFAB_STATION_PROPOSAL_V1_HEADERS];
	const csv = [
		headers.join(","),
		...rows.map((row) => headers.map((header) => csvCell(row[header] ?? "")).join(",")),
	].join("\n");
	const result = parseOpenFabStationProposalCsv(new TextEncoder().encode(csv));
	if (!result.ok) throw new Error(`Synthetic proposal failed: ${result.failure.code}`);
	return hydrateOpenFabStationProposalArtifact(result.artifact);
}

type SyntheticStationRow = Partial<
	Record<(typeof OPENFAB_STATION_PROPOSAL_V1_HEADERS)[number], string>
>;

function syntheticRows(): SyntheticStationRow[] {
	return [
		stationRow({
			port_key: "A-OHB-SOURCE_SENTINEL",
			secondary_aliases: "OHB-SOURCE_SENTINEL-ALT",
			port_type: "OHB",
			physical_group_key: "OHB-SOURCE_SENTINEL-GROUP",
			physical_group_kind: "OHB",
			side: "LEFT",
			lateral_offset_mm: "700",
			direction: "WITH_TRAVEL",
			direction_evidence: "DECLARED",
		}),
		stationRow({
			port_key: "B-EQ-SOURCE_SENTINEL",
			port_type: "EQ",
			physical_group_key: "EQ-SOURCE_SENTINEL-GROUP",
			physical_group_kind: "EQ",
			side: "CENTER",
			lateral_offset_mm: "0",
			direction: "AGAINST_TRAVEL",
			direction_evidence: "DECLARED",
		}),
		stationRow({
			port_key: "C-EQ-SOURCE_SENTINEL",
			port_type: "EQ",
			physical_group_key: "EQ-SOURCE_SENTINEL-GROUP",
			physical_group_kind: "EQ",
			side: "CENTER",
			lateral_offset_mm: "0",
			direction: "AGAINST_TRAVEL",
			direction_evidence: "DECLARED",
		}),
		stationRow({
			port_key: "D-STK-SOURCE_SENTINEL",
			port_type: "STK",
			physical_group_key: "STK-SOURCE_SENTINEL-GROUP",
			physical_group_kind: "STK",
			side: "CENTER",
			lateral_offset_mm: "0",
			direction: "WITH_TRAVEL",
			direction_evidence: "HEURISTIC",
		}),
		stationRow({
			port_key: "E-STK-SOURCE_SENTINEL",
			port_type: "STK",
			physical_group_key: "STK-SOURCE_SENTINEL-GROUP",
			physical_group_kind: "STK",
			side: "CENTER",
			lateral_offset_mm: "0",
			direction: "WITH_TRAVEL",
			direction_evidence: "HEURISTIC",
		}),
	];
}

function stationRow(overrides: SyntheticStationRow): SyntheticStationRow {
	return {
		identity_scope: "PUBLIC-SYNTHETIC-SCOPE-SOURCE_SENTINEL",
		port_key: "PORT-SOURCE_SENTINEL",
		secondary_aliases: "",
		attachment_scope: "PUBLIC-RAIL-SCOPE-SOURCE_SENTINEL",
		attachment_alias: "ATTACHMENT_ALIAS_SOURCE_SENTINEL",
		station_mm: "500",
		side: "CENTER",
		lateral_offset_mm: "0",
		direction: "WITH_TRAVEL",
		direction_evidence: "DECLARED",
		port_type: "OHB",
		physical_group_key: "GROUP-SOURCE_SENTINEL",
		physical_group_kind: "OHB",
		organization_alias: "ORGANIZATION_ALIAS_SOURCE_SENTINEL",
		source_x_mm: "",
		source_z_mm: "",
		...overrides,
	};
}

function csvCell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function issueBit(code: OpenFabStationProposalReviewIssueCode): number {
	return 2 ** OPENFAB_STATION_PROPOSAL_REVIEW_ISSUE_CODES.indexOf(code);
}
