import { describe, expect, it } from "vitest";
import type {
	RailProjectReadiness,
	RailProjectReadinessIssue,
	RailProjectReadinessSummary,
} from "../compile/RailProjectReadiness";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { terminalForwardDirection } from "../core/RailModulePlanner";
import {
	railReadinessIssueCorridorAt,
	railReadinessIssueGuide,
	railReadinessIssueLocationAt,
	railReadinessIssueLocationCount,
	railReadinessIssueLocationsAreComplete,
	railReadinessIssuePathIdentityAt,
	railReadinessOpenTerminalRepairLocation,
} from "./RailReadinessIssueGuide";

describe("RailReadinessIssueGuide", () => {
	it("explains why a visually joined rail can still fail directed flow", () => {
		const base = report({ weakComponents: 1, strongComponents: 17, minimumReturnLinks: 1 });
		const diagnosticReport = {
			...base,
			locations: {
				...base.locations,
				oneWayCorridorOffsets: new Uint32Array([0, 4]),
				oneWayCorridorCells: new Int32Array([20, 4, 19, 4, -4, 8, -5, 8]),
				oneWayCorridorBoundaries: new Int32Array([20, 4, 19, 4, -4, 8, -5, 8]),
			},
		} satisfies RailProjectReadiness;
		const diagnostic = issue("MULTIPLE_STRONG_COMPONENTS", 1, "ONE_WAY_CORRIDOR");
		const guide = railReadinessIssueGuide(diagnosticReport, diagnostic);

		expect(guide).toMatchObject({
			title: "ONE-WAY BRIDGE NEEDS A RETURN LINK",
			metric: "1 ONE-WAY BRIDGE",
			repairTool: "replace-one-way",
			repairLabel: "AUTO REBUILD LINK",
			technicalLabel: "DIRECTED CONNECTIVITY",
			role: "primary",
			highlightKind: "corridor",
		});
		expect(guide.summary).toContain("레일 선형 자체가 끊어진 것은 아닙니다");
		expect(guide.action).toContain("ONE-WAY OUT");
		expect(guide.action).toContain("OUTBOUND와 RETURN 쌍");
		expect(railReadinessIssueLocationCount(diagnosticReport, diagnostic)).toBe(1);
		expect(railReadinessIssueCorridorAt(diagnosticReport, diagnostic, 0)).toEqual({
			cells: [
				{ x: 20, y: 4 },
				{ x: 19, y: 4 },
				{ x: -4, y: 8 },
				{ x: -5, y: 8 },
			],
			departure: { from: { x: 20, y: 4 }, to: { x: 19, y: 4 } },
			arrival: { from: { x: -4, y: 8 }, to: { x: -5, y: 8 } },
		});
	});

	it("marks a physical SCC as a dependent check while authored flow is split", () => {
		const guide = railReadinessIssueGuide(
			report({ strongComponents: 17, physicalStrongComponents: 23 }),
			issue("PHYSICAL_DISCONNECTED", 23),
		);

		expect(guide).toMatchObject({
			title: "PHYSICAL FLOW RECHECK",
			metric: "WAITING FOR FLOW FIX",
			repairTool: null,
			repairLabel: null,
			role: "consequence",
			causedByCode: "MULTIPLE_STRONG_COMPONENTS",
			highlightKind: "path",
		});
		expect(guide.action).toContain("자동으로 다시 컴파일");
	});

	it("navigates every typed SCC representative beyond the bounded issue samples", () => {
		const base = report({ strongComponents: 20 });
		const representatives = new Int32Array(40);
		for (let index = 0; index < 20; index++) {
			representatives[index * 2] = index - 10;
			representatives[index * 2 + 1] = index * 2;
		}
		const fullReport: RailProjectReadiness = {
			...base,
			locations: {
				...base.locations,
				strongComponentRepresentativeCells: representatives,
			},
		};
		const diagnostic = issue("MULTIPLE_STRONG_COMPONENTS", 20);

		expect(railReadinessIssueLocationCount(fullReport, diagnostic)).toBe(20);
		expect(railReadinessIssueLocationAt(fullReport, diagnostic, 17)).toEqual({ x: 7, y: 34 });
		expect(railReadinessIssueLocationAt(fullReport, diagnostic, 20)).toBeNull();
	});

	it("navigates a single large clearance class beyond its bounded samples", () => {
		const diagnostic = issue("CLEARANCE_CONFLICT", 20, "BEAM_INTRUSION");
		const base = report({ clearanceIssues: 20 });
		const identities = new Int32Array(40 * 14);
		for (let index = 0; index < 40; index++) {
			identities[index * 14 + 2] = index;
			identities[index * 14 + 3] = -index;
		}
		const fullReport: RailProjectReadiness = {
			...base,
			issues: [diagnostic],
			locations: { ...base.locations, clearancePathIdentities: identities },
		};

		expect(railReadinessIssueLocationCount(fullReport, diagnostic)).toBe(40);
		expect(railReadinessIssueLocationAt(fullReport, diagnostic, 39)).toEqual({ x: 39, y: -39 });
		expect(railReadinessIssuePathIdentityAt(fullReport, diagnostic, 39)?.[2]).toBe(39);
	});

	it("keeps invalid-path focus cells paired with sorted path identities", () => {
		const first = new Int32Array(14);
		first[0] = 9;
		first[2] = 20;
		first[3] = -4;
		const second = new Int32Array(14);
		second[0] = 2;
		second[2] = -8;
		second[3] = 7;
		const diagnostic = {
			...issue("INVALID_PHYSICAL_PATH", 2),
			cells: [{ x: -8, y: 7 }],
			pathIdentities: [first, second],
		};
		const diagnosticReport = report({ invalidPhysicalPaths: 2 });

		expect(railReadinessIssueLocationCount(diagnosticReport, diagnostic)).toBe(2);
		expect(railReadinessIssueLocationAt(diagnosticReport, diagnostic, 0)).toEqual({ x: 20, y: -4 });
		expect(railReadinessIssueLocationAt(diagnosticReport, diagnostic, 1)).toEqual({ x: -8, y: 7 });
		expect(railReadinessIssuePathIdentityAt(diagnosticReport, diagnostic, 0)).toEqual(first);
		expect(railReadinessIssueLocationsAreComplete(diagnosticReport, diagnostic)).toBe(true);
	});

	it("uses the correct engineering count noun instead of an affected-cell label", () => {
		expect(
			railReadinessIssueGuide(report({ openTerminals: 2 }), issue("OPEN_TERMINAL", 2)).metric,
		).toBe("2 OPEN ENDS");
		expect(
			railReadinessIssueGuide(
				report({ clearanceIssues: 1 }),
				issue("CLEARANCE_CONFLICT", 1, "BEAM_INTRUSION"),
			),
		).toMatchObject({ technicalLabel: "BEAM INTRUSION", highlightKind: "path" });
	});

	it("treats directed SCC fallout as a follow-up while open ends remain", () => {
		const guide = railReadinessIssueGuide(
			report({ openTerminals: 2, strongComponents: 3 }),
			issue("MULTIPLE_STRONG_COMPONENTS", 3),
		);

		expect(guide).toMatchObject({ role: "consequence", causedByCode: "OPEN_TERMINAL" });
	});

	it("counts joining disconnected closed loops as one root repair", () => {
		const guide = railReadinessIssueGuide(
			report({ weakComponents: 2, strongComponents: 2 }),
			issue("MULTIPLE_STRONG_COMPONENTS", 2),
		);

		expect(guide).toMatchObject({
			role: "consequence",
			causedByCode: "DISCONNECTED_NETWORK",
			repairLabel: "BUILD A BRIDGE",
		});
	});

	it("marks bounded multi-class diagnostics as samples", () => {
		const first = issue("CLEARANCE_CONFLICT", 20, "BEAM_INTRUSION");
		const second = issue("CLEARANCE_CONFLICT", 4, "PARALLEL_ENVELOPE");
		const diagnosticReport = { ...report({ clearanceIssues: 24 }), issues: [first, second] };

		expect(railReadinessIssueLocationCount(diagnosticReport, first)).toBe(1);
		expect(railReadinessIssueLocationsAreComplete(diagnosticReport, first)).toBe(false);
	});

	it("does not mistake two sampled clearance cells per conflict for a complete conflict list", () => {
		const first = {
			...issue("CLEARANCE_CONFLICT", 12, "BEAM_INTRUSION"),
			cells: Array.from({ length: 16 }, (_, index) => ({ x: index, y: 0 })),
			pathIdentities: Array.from({ length: 16 }, () => new Int32Array(14)),
		};
		const second = issue("CLEARANCE_CONFLICT", 1, "INSTALLATION_CLEARANCE");
		const diagnosticReport = { ...report({ clearanceIssues: 13 }), issues: [first, second] };

		expect(railReadinessIssueLocationsAreComplete(diagnosticReport, first)).toBe(false);
	});

	it("redirects a source-terminal repair action to a buildable sink", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const diagnostic = issue("OPEN_TERMINAL", 2);
		const base = report({ openTerminals: 2, closure: "open" });
		const diagnosticReport: RailProjectReadiness = {
			...base,
			issues: [diagnostic],
			locations: {
				...base.locations,
				openTerminalCells: new Int32Array([0, 0, 4, 0]),
			},
		};
		const sourceIndex = terminalForwardDirection(document.map, { x: 0, y: 0 }) === null ? 0 : 1;
		const repair = railReadinessOpenTerminalRepairLocation(
			diagnosticReport,
			diagnostic,
			document.map,
			sourceIndex,
		);

		expect(repair).not.toBeNull();
		expect(
			terminalForwardDirection(document.map, repair?.cell as { x: number; y: number }),
		).not.toBeNull();
		expect(repair?.index).not.toBe(sourceIndex);
	});

	it("returns the full typed physical identity paired with path navigation", () => {
		const diagnostic = issue("PHYSICAL_OPEN_PATH", 2);
		const base = report({ physicalOpenPaths: 2 });
		const identities = new Int32Array(28);
		identities[14] = 91;
		identities[16] = 7;
		identities[17] = -3;
		const diagnosticReport: RailProjectReadiness = {
			...base,
			locations: { ...base.locations, physicalOpenPathIdentities: identities },
		};

		const identity = railReadinessIssuePathIdentityAt(diagnosticReport, diagnostic, 1);
		expect(identity).toHaveLength(14);
		expect(identity?.[0]).toBe(91);
		expect(identity?.[2]).toBe(7);
		expect(identity?.[3]).toBe(-3);
	});
});

function issue(
	code: RailProjectReadinessIssue["code"],
	affectedCount: number,
	sourceCode: string | null = null,
): RailProjectReadinessIssue {
	return {
		id: `${code}:fixture`,
		code,
		sourceCode,
		message: "fixture",
		affectedCount,
		cells: [{ x: 1, y: 2 }],
		pathIdentities: [],
	};
}

function report(overrides: Partial<RailProjectReadinessSummary>): RailProjectReadiness {
	const summary: RailProjectReadinessSummary = {
		cells: 10,
		edges: 10,
		physicalPaths: 10,
		closure: "closed",
		weakComponents: 1,
		strongComponents: 1,
		minimumReturnLinks: 0,
		openTerminals: 0,
		junctions: 0,
		unsupportedJunctions: 0,
		topologyErrors: 0,
		physicalTerminals: 0,
		physicalOpenPaths: 0,
		physicalStrongComponents: 1,
		invalidPhysicalPaths: 0,
		clearanceIssues: 0,
		...overrides,
	};
	return {
		version: 3,
		status: "blocked",
		ready: false,
		authoredChecksum: "fixture",
		topologyFingerprint: "fixture",
		fingerprint: "fixture",
		summary,
		locations: {
			openTerminalCells: new Int32Array(),
			componentRepresentativeCells: new Int32Array(),
			strongComponentRepresentativeCells: new Int32Array(),
			oneWayCorridorOffsets: new Uint32Array([0]),
			oneWayCorridorCells: new Int32Array(),
			oneWayCorridorBoundaries: new Int32Array(),
			unsupportedJunctionCells: new Int32Array(),
			topologyErrorCells: new Int32Array(),
			physicalTerminalCells: new Int32Array(),
			physicalOpenPathIdentities: new Int32Array(),
			physicalStrongComponentPathIdentities: new Int32Array(),
			clearanceCells: new Int32Array(),
			clearancePathIdentities: new Int32Array(),
		},
		issues: [],
	};
}
