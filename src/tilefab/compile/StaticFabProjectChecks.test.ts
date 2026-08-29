import { describe, expect, it } from "vitest";
import { emptyPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { analyzeRailNetwork } from "../core/network";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DIR_E, DIR_W } from "../core/railShape";
import { emptyStaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { StaticFabOrganizationDiagnosticState } from "../core/StaticFabOrganizationIssues";
import type { TileMap } from "../core/TileMap";
import { checksumRailMap, checksumRailMapDiagnostic } from "../worker/RailMirrorChecksum";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import {
	deriveStaticFabProjectChecksSnapshot,
	hydrateStaticFabProjectChecksSnapshot,
	type StaticFabProjectChecksSourceIdentity,
} from "./StaticFabProjectChecks";

describe("StaticFabProjectChecks", () => {
	it("hydrates a clean closed static FAB artifact from one exact source generation", () => {
		const document = closedLoopDocument();
		const equipment = emptyPortEquipmentState();
		const fixture = deriveFixture(document.map, equipment, 7);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);

		expect(checks).toMatchObject({
			sourceRevision: document.map.getRevision(),
			sourceSequence: 7,
			railReadinessFingerprint: fixture.readinessFingerprint,
			ready: true,
			summary: {
				railReady: true,
				portChecksComplete: true,
				equipmentChecksComplete: true,
				organizationChecksComplete: true,
				portCount: 0,
				equipmentGroupCount: 0,
				organizationCount: 0,
				blockingIssueCount: 0,
				followUpIssueCount: 0,
			},
		});
		expect(checks.issues).toEqual([]);
		expect(checks.locationCount).toBe(0);
		expect(Object.isFrozen(checks)).toBe(true);
	});

	it("surfaces an unreachable port and its equipment consequence with complete locations", () => {
		const document = closedLoopDocument();
		const equipment = unreachableOhbState();
		const fixture = deriveFixture(document.map, equipment, 11);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);
		const portIssue = checks.issues.find((issue) => issue.code === "PORT_ATTACHMENT");
		const equipmentIssue = checks.issues.find(
			(issue) => issue.code === "EQUIPMENT_PARTIAL_ATTACHMENT",
		);

		expect(portIssue).toMatchObject({
			domain: "port",
			role: "primary",
			sourceCode: "STATION_OUT_OF_RANGE",
			affectedCount: 1,
			locationCount: 1,
		});
		expect(equipmentIssue).toMatchObject({
			domain: "equipment",
			role: "consequence",
			sourceCode: "UNREACHABLE_MEMBER_PORT",
			affectedCount: 1,
			locationCount: 1,
		});
		if (!portIssue) throw new Error("Expected PORT_ATTACHMENT issue.");
		expect(checks.summary).toMatchObject({
			portCount: 1,
			portIssueCount: 1,
			equipmentGroupCount: 1,
			equipmentIssueCount: 1,
			blockingIssueCount: 1,
			followUpIssueCount: 1,
		});
		expect(checks.ready).toBe(false);
		for (const issue of checks.issues) {
			for (let index = 0; index < issue.locationCount; index++) {
				expect(checks.readLocation(issue, index)).toMatchObject({
					bounds: {
						minX: expect.any(Number),
						minZ: expect.any(Number),
						maxX: expect.any(Number),
						maxZ: expect.any(Number),
					},
				});
			}
			expect(checks.readLocation(issue, issue.locationCount)).toBeNull();
		}
		expect(checks.readLocation(portIssue, 0)).toMatchObject({
			kind: "port",
			entityId: 1,
			relatedKind: null,
			relatedEntityId: 0,
			measuredValue: null,
			requiredValue: null,
			measurementUnit: "none",
			measurementRelation: "none",
			recordIndex: -1,
			bounds: { minX: 2, minZ: 0, maxX: 3, maxZ: 1 },
		});
	});

	it("owns immutable copies of every transferred column and issue record", () => {
		const document = closedLoopDocument();
		const fixture = deriveFixture(document.map, unreachableOhbState(), 12);
		const delivered = structuredClone(fixture.snapshot);
		const checks = hydrateStaticFabProjectChecksSnapshot(delivered);
		const issue = checks.issues[0];
		if (!issue) throw new Error("Expected a diagnostic issue.");
		const occurrence = checks.readOccurrenceDetail(issue, 0);
		const location = checks.readLocation(issue, 0);
		if (!occurrence || !location) throw new Error("Expected diagnostic occurrence and location.");

		(delivered.issues[0] as { detail: string }).detail = "mutated issue";
		delivered.issueOccurrenceOffsets[0] = 99;
		(delivered.occurrenceDetails as string[]).fill("mutated occurrence");
		delivered.issueLocationOffsets[0] = 99;
		delivered.locationBounds.fill(99);
		delivered.locationKinds.fill(0);
		delivered.locationEntityIds.fill(99);
		delivered.locationOccurrenceIndexes.fill(99);
		delivered.locationDetailIndexes.fill(0);
		(delivered.locationDetails as string[]).fill("mutated location");
		delivered.locationRelatedRecordIndexes.fill(99);
		delivered.locationTokenIndexes.fill(0);
		(delivered.locationTokens as string[]).fill("mutated token");

		expect(issue.detail).not.toBe("mutated issue");
		expect(checks.readOccurrenceDetail(issue, 0)).toBe(occurrence);
		expect(checks.readLocation(issue, 0)).toEqual(location);
	});

	it("keeps an independently invalid port primary when the rail network is also open", () => {
		const document = straightRailDocument();
		const fixture = deriveFixture(document.map, unreachableOhbState(), 12);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);
		const portIssue = checks.issues.find((issue) => issue.code === "PORT_ATTACHMENT");

		expect(checks.summary.railReady).toBe(false);
		expect(portIssue).toMatchObject({
			role: "primary",
			sourceCode: "STATION_OUT_OF_RANGE",
		});
		expect(checks.ready).toBe(false);
	});

	it("retains every reciprocal ownership fault with exact primary and related entities", () => {
		const document = closedLoopDocument();
		const fixture = deriveFixture(document.map, swappedOhbOwnershipState(), 15);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);
		const issues = checks.issues.filter(
			(candidate) =>
				candidate.code === "PORT_EQUIPMENT_INTEGRITY" &&
				candidate.sourceCode === "PORT_GROUP_POINTER_MISMATCH",
		);
		expect(issues).toHaveLength(1);
		const issue = issues[0];
		if (!issue) throw new Error("Expected reciprocal ownership issue.");

		expect(issue).toMatchObject({
			domain: "equipment",
			role: "primary",
			affectedCount: 2,
			locationCount: 4,
		});
		expect(checks.summary.equipmentIssueCount).toBe(2);
		expect(checks.summary).toMatchObject({
			portChecksComplete: false,
			equipmentChecksComplete: false,
			organizationChecksComplete: false,
		});
		expect(checks.readOccurrenceDetail(issue, 0)).toBe(
			"port 1 does not point back to equipment group 1",
		);
		expect(checks.readOccurrenceDetail(issue, 1)).toBe(
			"port 2 does not point back to equipment group 2",
		);
		expect(checks.readOccurrenceDetail(issue, 2)).toBeNull();
		const foreignIssue = { ...issue };
		expect(checks.readOccurrenceDetail(foreignIssue, 0)).toBeNull();
		expect(checks.readLocation(foreignIssue, 0)).toBeNull();
		expect(checks.readLocation(issue, 0)).toMatchObject({
			kind: "port",
			entityId: 1,
			recordIndex: 0,
			occurrenceIndex: 0,
			detail: "port 1 does not point back to equipment group 1",
			relatedKind: "equipment",
			relatedEntityId: 1,
		});
		expect(checks.readLocation(issue, 1)).toMatchObject({
			kind: "equipment",
			entityId: 1,
			relatedKind: "equipment",
			relatedEntityId: 2,
		});
		expect(checks.readLocation(issue, 2)).toMatchObject({
			kind: "port",
			entityId: 2,
			recordIndex: 1,
			occurrenceIndex: 1,
			detail: "port 2 does not point back to equipment group 2",
			relatedKind: "equipment",
			relatedEntityId: 2,
		});
	});

	it("preserves conflicting port pairs and measured spacing in typed Worker columns", () => {
		const document = closedLoopDocument();
		const fixture = deriveFixture(document.map, closeOhbSpacingState(), 16);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);
		const issue = checks.issues.find(
			(candidate) =>
				candidate.code === "PORT_EQUIPMENT_LAYOUT" && candidate.sourceCode === "PORT_SPACING",
		);
		if (!issue) throw new Error("Expected typed port spacing issue.");

		expect(issue).toMatchObject({
			domain: "port",
			affectedCount: 1,
			locationCount: 4,
		});
		expect(checks.summary.portIssueCount).toBe(1);
		expect(checks.readLocation(issue, 0)).toMatchObject({
			kind: "port",
			entityId: 1,
			occurrenceIndex: 0,
			detail: "ports 1 and 2 are closer than 600 mm",
			relatedKind: "equipment",
			relatedEntityId: 2,
			measuredValue: expect.closeTo(300),
			requiredValue: 600,
			measurementUnit: "millimeters",
			measurementRelation: "minimum",
		});
		expect(checks.fingerprint).toMatch(/^sfc3-/);
	});

	it("groups duplicate organization IDs while retaining exact records, peers, and tokens", () => {
		const document = closedLoopDocument();
		const edge = Object.freeze({
			from: Object.freeze({ x: 0, y: 0 }),
			to: Object.freeze({ x: 1, y: 0 }),
		});
		const organizations: StaticFabOrganizationDiagnosticState = Object.freeze({
			nextOrganizationId: 4,
			records: Object.freeze(
				["Alpha Bay", "Beta Bay", "Gamma Bay"].map((name) =>
					Object.freeze({
						id: 1,
						kind: "BAY",
						name,
						parentOrganizationIds: Object.freeze([]),
						properties: Object.freeze({ description: "", color: "CYAN" }),
						membership: Object.freeze({
							railEdges: Object.freeze([edge]),
							advancedSwitchIds: Object.freeze([]),
							equipmentGroupIds: Object.freeze([]),
						}),
					}),
				),
			),
		});
		const fixture = deriveOrganizationFixture(document.map, organizations, 21);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);
		const duplicate = checks.issues.find(
			(issue) =>
				issue.code === "ORGANIZATION_INTEGRITY" && issue.sourceCode === "ORGANIZATION_ID_DUPLICATE",
		);
		if (!duplicate) throw new Error("Expected grouped duplicate organization issue.");

		expect(duplicate).toMatchObject({ affectedCount: 2, locationCount: 4 });
		expect(checks.readLocation(duplicate, 0)).toMatchObject({
			kind: "organization",
			entityId: 1,
			recordIndex: 0,
			relatedKind: "organization",
			relatedEntityId: 1,
			relatedRecordIndex: 1,
			token: "record:0",
		});
		expect(checks.readLocation(duplicate, 3)).toMatchObject({
			recordIndex: 2,
			relatedRecordIndex: 0,
			token: "record:2",
			occurrenceIndex: 1,
		});
		expect(checks.summary.organizationCount).toBe(3);
		expect(checks.summary.organizationIssueCount).toBeGreaterThanOrEqual(2);
	});

	it("retains independent organization faults when port ownership is also invalid", () => {
		const document = closedLoopDocument();
		const edge = Object.freeze({
			from: Object.freeze({ x: 0, y: 0 }),
			to: Object.freeze({ x: 1, y: 0 }),
		});
		const record = (name: string) =>
			Object.freeze({
				id: 1,
				kind: "BAY",
				name,
				parentOrganizationIds: Object.freeze([]),
				properties: Object.freeze({ description: "", color: "CYAN" }),
				membership: Object.freeze({
					railEdges: Object.freeze([edge]),
					advancedSwitchIds: Object.freeze([]),
					equipmentGroupIds: Object.freeze([]),
				}),
			});
		const organizations: StaticFabOrganizationDiagnosticState = Object.freeze({
			nextOrganizationId: 2,
			records: Object.freeze([record("Alpha Bay"), record("Beta Bay")]),
		});
		const fixture = deriveOrganizationFixture(
			document.map,
			organizations,
			22,
			swappedOhbOwnershipState(),
		);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);

		expect(
			checks.issues.some(
				(issue) =>
					issue.code === "PORT_EQUIPMENT_INTEGRITY" &&
					issue.sourceCode === "PORT_GROUP_POINTER_MISMATCH",
			),
		).toBe(true);
		expect(
			checks.issues.some(
				(issue) =>
					issue.code === "ORGANIZATION_INTEGRITY" &&
					issue.sourceCode === "ORGANIZATION_ID_DUPLICATE",
			),
		).toBe(true);
		expect(checks.summary).toMatchObject({
			portChecksComplete: false,
			equipmentChecksComplete: false,
			organizationChecksComplete: false,
		});
	});

	it("frames a missing advanced-switch route at project bounds instead of the origin", () => {
		const document = closedLoopDocument(24, 8, { x: 40, y: 20 });
		const fixture = deriveFixture(document.map, missingSwitchOhbState(), 13);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);
		const portIssue = checks.issues.find((issue) => issue.code === "PORT_ATTACHMENT");
		if (!portIssue) throw new Error("Expected missing-switch PORT_ATTACHMENT issue.");

		expect(portIssue).toMatchObject({
			role: "primary",
			affectedCount: 1,
			locationCount: 1,
		});
		expect(checks.readLocation(portIssue, 0)).toMatchObject({
			kind: "port",
			entityId: 1,
			bounds: { minX: 40, minZ: 20, maxX: 65, maxZ: 29 },
		});
	});

	it("rejects structurally malformed records that cannot have an exact source checksum", () => {
		const document = closedLoopDocument();
		const invalid = unreachableOhbState();
		const malformed: PortEquipmentState = Object.freeze({
			...invalid,
			ports: Object.freeze([
				Object.freeze({
					...(invalid.ports[0] as (typeof invalid.ports)[number]),
					route: Object.freeze({
						kind: "CARDINAL_CELL" as const,
						x: Number.NaN,
						z: 0,
						from: DIR_W,
						to: DIR_E,
					}),
				}),
			]),
		});
		const organizations = emptyStaticFabOrganizationState();
		const checksum = checksumRailMap(document.map, emptyPortEquipmentState(), organizations);
		const physical = compilePhysicalRail(document.map, document.map.getRevision());
		const readiness = createRailProjectReadiness(
			analyzeRailNetwork(document.map),
			physical,
			checksum,
		);
		const source: StaticFabProjectChecksSourceIdentity = Object.freeze({
			revision: document.map.getRevision(),
			checksum,
			sequence: 17,
			nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
			nextPortId: malformed.nextPortId,
			nextEquipmentGroupId: malformed.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
		});
		expect(() =>
			deriveStaticFabProjectChecksSnapshot(
				document.map,
				malformed,
				organizations,
				physical,
				readiness,
				source,
			),
		).toThrow(/source content cannot be checksummed/i);
	});

	it("rejects valid source records whose content does not match the supplied checksum", () => {
		const document = closedLoopDocument();
		const sourceEquipment = closeOhbSpacingState();
		const foreignEquipment = swappedOhbOwnershipState();
		const organizations = emptyStaticFabOrganizationState();
		const checksum = checksumRailMap(document.map, sourceEquipment, organizations);
		const physical = compilePhysicalRail(document.map, document.map.getRevision());
		const readiness = createRailProjectReadiness(
			analyzeRailNetwork(document.map),
			physical,
			checksum,
		);
		const source: StaticFabProjectChecksSourceIdentity = Object.freeze({
			revision: document.map.getRevision(),
			checksum,
			sequence: 18,
			nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
			nextPortId: sourceEquipment.nextPortId,
			nextEquipmentGroupId: sourceEquipment.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
		});

		expect(() =>
			deriveStaticFabProjectChecksSnapshot(
				document.map,
				foreignEquipment,
				organizations,
				physical,
				readiness,
				source,
			),
		).toThrow(/source content checksum is stale/i);
	});

	it("relates every multi-port body conflict to the opposing equipment group", () => {
		const fixture = deriveFixture(straightRailDocument().map, bodyOverlapState(), 19);
		const checks = hydrateStaticFabProjectChecksSnapshot(
			fixture.snapshot,
			fixture.source,
			fixture.readinessFingerprint,
		);
		const issue = checks.issues.find(
			(candidate) =>
				candidate.code === "PORT_EQUIPMENT_LAYOUT" &&
				candidate.sourceCode === "EQ_STK_BODY_OVERLAP",
		);
		if (!issue) throw new Error("Expected EQ/STK body overlap issue.");

		expect(checks.readLocation(issue, 0)).toMatchObject({
			kind: "port",
			entityId: 5,
			relatedKind: "equipment",
			relatedEntityId: 2,
		});
		expect(checks.readLocation(issue, 2)).toMatchObject({
			kind: "port",
			entityId: 3,
			relatedKind: "equipment",
			relatedEntityId: 3,
		});
	});

	it("rejects a compiled physical layout from another map at the same revision", () => {
		const document = closedLoopDocument(24, 8);
		const foreignDocument = closedLoopDocument(24, 8, { x: 100, y: 100 });
		const equipment = emptyPortEquipmentState();
		const organizations = emptyStaticFabOrganizationState();
		const checksum = checksumRailMap(document.map, equipment, organizations);
		const readiness = createRailProjectReadiness(
			analyzeRailNetwork(document.map),
			compilePhysicalRail(document.map, document.map.getRevision()),
			checksum,
		);
		const source: StaticFabProjectChecksSourceIdentity = {
			revision: document.map.getRevision(),
			checksum,
			sequence: 14,
			nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
			nextPortId: equipment.nextPortId,
			nextEquipmentGroupId: equipment.nextEquipmentGroupId,
			nextOrganizationId: organizations.nextOrganizationId,
		};
		const foreignPhysical = compilePhysicalRail(
			foreignDocument.map,
			foreignDocument.map.getRevision(),
		);

		expect(document.map.getRevision()).toBe(foreignDocument.map.getRevision());
		expect(() =>
			deriveStaticFabProjectChecksSnapshot(
				document.map,
				equipment,
				organizations,
				foreignPhysical,
				readiness,
				source,
			),
		).toThrow(/source revision is stale/i);
		expect(() =>
			deriveStaticFabProjectChecksSnapshot(
				document.map,
				equipment,
				organizations,
				structuredClone(foreignPhysical),
				readiness,
				source,
			),
		).toThrow(/source revision is stale/i);
	});

	it("rejects stale source cursors, stale rail identity, and forged typed locations", () => {
		const document = closedLoopDocument();
		const fixture = deriveFixture(document.map, unreachableOhbState(), 13);

		expect(() =>
			hydrateStaticFabProjectChecksSnapshot(fixture.snapshot, {
				...fixture.source,
				nextPortId: fixture.source.nextPortId + 1,
			}),
		).toThrow(/source is stale/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot(
				fixture.snapshot,
				fixture.source,
				"rail-readiness-stale",
			),
		).toThrow(/rail readiness fingerprint is stale/i);
		const forgedBounds = fixture.snapshot.locationBounds.slice();
		forgedBounds[0] = Number.NaN;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationBounds: forgedBounds,
			}),
		).toThrow(/bounds are invalid/i);
		const precisionCollisionBounds = fixture.snapshot.locationBounds.slice();
		precisionCollisionBounds[3] = (precisionCollisionBounds[3] as number) + Number.EPSILON;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationBounds: precisionCollisionBounds,
			}),
		).toThrow(/fingerprint is invalid/i);
		const sharedBounds = new Float64Array(
			new SharedArrayBuffer(fixture.snapshot.locationBounds.byteLength),
		);
		sharedBounds.set(fixture.snapshot.locationBounds);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationBounds: sharedBounds,
			}),
		).toThrow(/location columns are malformed/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationRelatedKinds: new Uint8Array(0),
			}),
		).toThrow(/location columns are malformed/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationRelatedRecordIndexes: new Int32Array(0),
			}),
		).toThrow(/location columns are malformed/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationTokenIndexes: new Uint32Array(0),
			}),
		).toThrow(/location columns are malformed/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationTokens: Object.freeze(["not-empty"]),
			}),
		).toThrow(/tokens must start with an empty sentinel/i);
		const forgedTokenIndexes = fixture.snapshot.locationTokenIndexes.slice();
		forgedTokenIndexes[0] = fixture.snapshot.locationTokens.length;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationTokenIndexes: forgedTokenIndexes,
			}),
		).toThrow(/token index is invalid/i);
		const forgedRelatedRecordIndexes = fixture.snapshot.locationRelatedRecordIndexes.slice();
		forgedRelatedRecordIndexes[0] = 0;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationRelatedRecordIndexes: forgedRelatedRecordIndexes,
			}),
		).toThrow(/related record is invalid/i);
		const forgedMeasurementUnits = fixture.snapshot.locationMeasurementUnits.slice();
		forgedMeasurementUnits[0] = 1;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationMeasurementUnits: forgedMeasurementUnits,
			}),
		).toThrow(/measurement unit is inconsistent/i);
		const forgedMeasurementRelations = fixture.snapshot.locationMeasurementRelations.slice();
		forgedMeasurementRelations[0] = 1;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationMeasurementRelations: forgedMeasurementRelations,
			}),
		).toThrow(/measurement unit is inconsistent/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationRecordIndexes: new Int32Array(0),
			}),
		).toThrow(/location columns are malformed/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationOccurrenceIndexes: new Uint32Array(0),
			}),
		).toThrow(/location columns are malformed/i);
		const forgedOccurrenceIndexes = fixture.snapshot.locationOccurrenceIndexes.slice();
		forgedOccurrenceIndexes[0] = 99;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationOccurrenceIndexes: forgedOccurrenceIndexes,
			}),
		).toThrow(/occurrence index is invalid/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				issueOccurrenceOffsets: new Uint32Array(0),
			}),
		).toThrow(/occurrence columns are malformed/i);
		const forgedOccurrenceOffsets = fixture.snapshot.issueOccurrenceOffsets.slice();
		forgedOccurrenceOffsets[0] = 1;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				issueOccurrenceOffsets: forgedOccurrenceOffsets,
			}),
		).toThrow(/occurrence offsets must start at zero/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				occurrenceDetails: fixture.snapshot.occurrenceDetails.slice(0, -1),
			}),
		).toThrow(/occurrence offsets are invalid/i);
		const forgedOccurrenceDetails = [...fixture.snapshot.occurrenceDetails];
		forgedOccurrenceDetails[0] = `${forgedOccurrenceDetails[0]} altered`;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				occurrenceDetails: forgedOccurrenceDetails,
			}),
		).toThrow(/fingerprint is invalid/i);
		const forgedDetailIndexes = fixture.snapshot.locationDetailIndexes.slice();
		forgedDetailIndexes[0] = fixture.snapshot.locationDetails.length;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				locationDetailIndexes: forgedDetailIndexes,
			}),
		).toThrow(/detail index is invalid/i);
		const forgedOffsets = fixture.snapshot.issueLocationOffsets.slice();
		forgedOffsets[0] = 1;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				issueLocationOffsets: forgedOffsets,
			}),
		).toThrow(/offsets must start at zero/i);
		const duplicatedIssue = fixture.snapshot.issues[0];
		if (!duplicatedIssue) throw new Error("Expected fixture issue.");
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				issues: Object.freeze([...fixture.snapshot.issues, duplicatedIssue]),
			}),
		).toThrow(/issue identity is duplicated/i);
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				fingerprint: "sfc1-forged",
			}),
		).toThrow(/fingerprint is invalid/i);
		const forgedSummary = fixture.snapshot.summary.slice();
		forgedSummary[4] = (forgedSummary[4] as number) + 1;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				summary: forgedSummary,
			}),
		).toThrow(/fingerprint is invalid/i);
		const forgedCompletion = fixture.snapshot.summary.slice();
		forgedCompletion[13] = 2;
		expect(() =>
			hydrateStaticFabProjectChecksSnapshot({
				...fixture.snapshot,
				summary: forgedCompletion,
			}),
		).toThrow(/summary does not match/i);
	});
});

function deriveFixture(map: TileMap, equipment: PortEquipmentState, sequence: number) {
	const organizations = emptyStaticFabOrganizationState();
	const checksum = checksumRailMap(map, equipment, organizations);
	const physical = compilePhysicalRail(map, map.getRevision());
	const readiness = createRailProjectReadiness(analyzeRailNetwork(map), physical, checksum);
	const source: StaticFabProjectChecksSourceIdentity = Object.freeze({
		revision: map.getRevision(),
		checksum,
		sequence,
		nextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
		nextPortId: equipment.nextPortId,
		nextEquipmentGroupId: equipment.nextEquipmentGroupId,
		nextOrganizationId: organizations.nextOrganizationId,
	});
	return Object.freeze({
		source,
		readinessFingerprint: readiness.fingerprint,
		snapshot: deriveStaticFabProjectChecksSnapshot(
			map,
			equipment,
			organizations,
			physical,
			readiness,
			source,
		),
	});
}

function deriveOrganizationFixture(
	map: TileMap,
	organizations: StaticFabOrganizationDiagnosticState,
	sequence: number,
	equipment: PortEquipmentState = emptyPortEquipmentState(),
) {
	const checksum = checksumRailMapDiagnostic(map, equipment, organizations);
	const physical = compilePhysicalRail(map, map.getRevision());
	const readiness = createRailProjectReadiness(analyzeRailNetwork(map), physical, checksum);
	const source: StaticFabProjectChecksSourceIdentity = Object.freeze({
		revision: map.getRevision(),
		checksum,
		sequence,
		nextAdvancedSwitchId: map.getAdvancedSwitchIdCursor(),
		nextPortId: equipment.nextPortId,
		nextEquipmentGroupId: equipment.nextEquipmentGroupId,
		nextOrganizationId: organizations.nextOrganizationId,
	});
	return Object.freeze({
		source,
		readinessFingerprint: readiness.fingerprint,
		snapshot: deriveStaticFabProjectChecksSnapshot(
			map,
			equipment,
			organizations,
			physical,
			readiness,
			source,
		),
	});
}

function closedLoopDocument(
	width = 24,
	height = 8,
	origin: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
): RailDocument {
	const document = new RailDocument();
	for (const [from, to] of [
		[
			{ x: origin.x, y: origin.y },
			{ x: origin.x + width, y: origin.y },
		],
		[
			{ x: origin.x + width, y: origin.y },
			{ x: origin.x + width, y: origin.y + height },
		],
		[
			{ x: origin.x + width, y: origin.y + height },
			{ x: origin.x, y: origin.y + height },
		],
		[
			{ x: origin.x, y: origin.y + height },
			{ x: origin.x, y: origin.y },
		],
	] as const) {
		const plan = planRailConstruction(document.map, from, to);
		if (!plan.valid || !document.commit(plan)) {
			throw new Error(`Closed loop fixture failed: ${plan.reason}`);
		}
	}
	return document;
}

function straightRailDocument(): RailDocument {
	const document = new RailDocument();
	const plan = planRailConstruction(document.map, { x: 0, y: 0 }, { x: 24, y: 0 });
	if (!plan.valid || !document.commit(plan)) {
		throw new Error(`Straight rail fixture failed: ${plan.reason}`);
	}
	return document;
}

function unreachableOhbState(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: 1,
				equipmentGroupId: 1,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: 2,
					z: 0,
					from: DIR_W,
					to: DIR_E,
				}),
				stationMillimeters: 100_000,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 1_000,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "OHB-UNREACHABLE-1",
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([1]),
			}),
		]),
	});
}

function missingSwitchOhbState(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 2,
		nextEquipmentGroupId: 2,
		ports: Object.freeze([
			Object.freeze({
				id: 1,
				equipmentGroupId: 1,
				route: Object.freeze({
					kind: "ADVANCED_SWITCH_SEGMENT" as const,
					switchId: 999,
					profileClass: "A" as const,
					role: "THROAT" as const,
					portIndex: null,
					segmentOrdinal: 0,
				}),
				stationMillimeters: 0,
				side: "LEFT" as const,
				lateralOffsetMillimeters: 1_000,
				direction: "WITH_TRAVEL" as const,
				portType: "OHB" as const,
				barcode: "OHB-MISSING-SWITCH-1",
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([1]),
			}),
		]),
	});
}

function swappedOhbOwnershipState(): PortEquipmentState {
	const port = (id: number, equipmentGroupId: number, x: number) =>
		Object.freeze({
			id,
			equipmentGroupId,
			route: Object.freeze({
				kind: "CARDINAL_CELL" as const,
				x,
				z: 0,
				from: DIR_W,
				to: DIR_E,
			}),
			stationMillimeters: 500,
			side: "LEFT" as const,
			lateralOffsetMillimeters: 1_000,
			direction: "WITH_TRAVEL" as const,
			portType: "OHB" as const,
			barcode: `OHB-SWAPPED-${id}`,
		});
	return Object.freeze({
		nextPortId: 3,
		nextEquipmentGroupId: 3,
		ports: Object.freeze([port(1, 2, 2), port(2, 1, 4)]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([1]),
			}),
			Object.freeze({
				id: 2,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([2]),
			}),
		]),
	});
}

function closeOhbSpacingState(): PortEquipmentState {
	const port = (id: number, stationMillimeters: number) =>
		Object.freeze({
			id,
			equipmentGroupId: id,
			route: Object.freeze({
				kind: "CARDINAL_CELL" as const,
				x: 2,
				z: 0,
				from: DIR_W,
				to: DIR_E,
			}),
			stationMillimeters,
			side: "LEFT" as const,
			lateralOffsetMillimeters: 1_000,
			direction: "WITH_TRAVEL" as const,
			portType: "OHB" as const,
			barcode: `OHB-CLOSE-${id}`,
		});
	return Object.freeze({
		nextPortId: 3,
		nextEquipmentGroupId: 3,
		ports: Object.freeze([port(1, 100), port(2, 400)]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 1,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([1]),
			}),
			Object.freeze({
				id: 2,
				kind: "OHB" as const,
				template: "SINGLE" as const,
				portIds: Object.freeze([2]),
			}),
		]),
	});
}

function bodyOverlapState(): PortEquipmentState {
	const port = (id: number, equipmentGroupId: number, x: number, portType: "OHB" | "EQ" | "STK") =>
		Object.freeze({
			id,
			equipmentGroupId,
			route: Object.freeze({
				kind: "CARDINAL_CELL" as const,
				x,
				z: 0,
				from: DIR_W,
				to: DIR_E,
			}),
			stationMillimeters: 500,
			side: portType === "OHB" ? ("LEFT" as const) : ("CENTER" as const),
			lateralOffsetMillimeters: portType === "OHB" ? 700 : 0,
			direction: "WITH_TRAVEL" as const,
			portType,
			barcode: `${portType}-${equipmentGroupId}-P${id}`,
		});
	return Object.freeze({
		nextPortId: 8,
		nextEquipmentGroupId: 5,
		ports: Object.freeze([
			port(1, 1, 2, "STK"),
			port(2, 1, 8, "STK"),
			port(3, 2, 4, "STK"),
			port(4, 2, 10, "STK"),
			port(5, 3, 5, "EQ"),
			port(6, 3, 7, "EQ"),
			port(7, 4, 6, "OHB"),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({ id: 1, kind: "STK" as const, template: "FLEX" as const, portIds: [1, 2] }),
			Object.freeze({ id: 2, kind: "STK" as const, template: "FLEX" as const, portIds: [3, 4] }),
			Object.freeze({
				id: 3,
				kind: "EQ" as const,
				pitchMillimeters: 2_000,
				recipe: null,
				portIds: [5, 6],
			}),
			Object.freeze({ id: 4, kind: "OHB" as const, template: "SINGLE" as const, portIds: [7] }),
		]),
	});
}
