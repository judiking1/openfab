import { describe, expect, it } from "vitest";
import { certifyProductionBayModule } from "../compile/ProductionBayModuleCompiler";
import type { ProductionBayModuleRequest } from "../core/ProductionBayModulePlanner";
import { DIR_E } from "../core/railShape";
import type {
	StaticFabOrganizationRecord,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import type { StaticFabOrganizationBundle } from "../core/StaticFabOrganizationBundle";
import {
	EMPTY_GUIDED_BUILD_BAY_BANK_EVIDENCE,
	guidedBuildTwinBayPairCenterAligned,
	summarizeGuidedBuildBayBankEvidence,
} from "./GuidedBuildBayBankEvidence";

describe("summarizeGuidedBuildBayBankEvidence", () => {
	it("publishes empty evidence without inventing a Bank", () => {
		expect(summarizeGuidedBuildBayBankEvidence(state([]))).toEqual(
			EMPTY_GUIDED_BUILD_BAY_BANK_EVIDENCE,
		);
	});

	it("recognizes two detached Twin Bays and only skips redundant alignment on a shared center axis", () => {
		const aligned = twoTwinBays({ x: 0, y: 0 }, { x: 60, y: 0 });
		const offset = twoTwinBays({ x: 0, y: 0 }, { x: 60, y: 3 });

		expect(summarizeGuidedBuildBayBankEvidence(aligned)).toMatchObject({
			twinProductionBayCount: 2,
			detachedTwinBayCount: 2,
			alignedDetachedTwinBayPairCount: 1,
			semanticBayBankCount: 0,
			railBearingTwinBayBankCount: 0,
		});
		expect(summarizeGuidedBuildBayBankEvidence(offset).alignedDetachedTwinBayPairCount).toBe(0);
		expect(guidedBuildTwinBayPairCenterAligned(aligned, [1, 4])).toBe(true);
		expect(guidedBuildTwinBayPairCenterAligned(offset, [1, 4])).toBe(false);
		expect(guidedBuildTwinBayPairCenterAligned(aligned, [1, 2])).toBe(false);
	});

	it("does not complete from an empty metadata parent even when the DAG derives a Bank role", () => {
		const detached = twoTwinBays({ x: 0, y: 0 }, { x: 60, y: 0 });
		const bankId = detached.nextOrganizationId;
		const records = detached.records.map((record) =>
			record.kind === "BAY"
				? freezeRecord({ ...record, parentOrganizationIds: Object.freeze([bankId]) })
				: record,
		);
		const emptyBank = organization(bankId, "AREA", [], []);

		expect(summarizeGuidedBuildBayBankEvidence(state([...records, emptyBank]))).toMatchObject({
			semanticBayBankCount: 1,
			railBearingTwinBayBankCount: 0,
			bankedTwinBayCount: 2,
		});
	});

	it("completes from one explicit rail-bearing Bank with two certified Twin Bay children", () => {
		const detached = twoTwinBays({ x: 0, y: 0 }, { x: 60, y: 0 });
		const bankId = detached.nextOrganizationId;
		const records = detached.records.map((record) =>
			record.kind === "BAY"
				? freezeRecord({ ...record, parentOrganizationIds: Object.freeze([bankId]) })
				: record,
		);
		const connectorBank = organization(bankId, "AREA", [], [edge(40, 11, 60, 11)]);

		expect(summarizeGuidedBuildBayBankEvidence(state([...records, connectorBank]))).toEqual({
			twinProductionBayCount: 2,
			detachedTwinBayCount: 0,
			alignedDetachedTwinBayPairCount: 0,
			semanticBayBankCount: 1,
			railBearingTwinBayBankCount: 1,
			bankedTwinBayCount: 2,
		});
	});
});

function twoTwinBays(
	leftAnchor: Readonly<{ x: number; y: number }>,
	rightAnchor: Readonly<{ x: number; y: number }>,
): StaticFabOrganizationState {
	const bundle = certifiedBundle();
	const leftRecords = translateRecords(recordsFromBundle(bundle, 1), leftAnchor);
	const rightRecords = translateRecords(
		recordsFromBundle(bundle, leftRecords.length + 1),
		rightAnchor,
	);
	return state([...leftRecords, ...rightRecords]);
}

function certifiedBundle(): StaticFabOrganizationBundle {
	const request: ProductionBayModuleRequest = {
		anchor: { x: 0, y: 0 },
		outerLengthMeters: 40,
		outerDepthMeters: 22,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		processLoopCount: 2,
		pose: { forward: DIR_E, side: "right", flow: "forward" },
	};
	return certifyProductionBayModule(request).organizationBundle;
}

function translateRecords(
	records: readonly StaticFabOrganizationRecord[],
	delta: Readonly<{ x: number; y: number }>,
): readonly StaticFabOrganizationRecord[] {
	return records.map((record) =>
		freezeRecord({
			...record,
			membership: Object.freeze({
				...record.membership,
				railEdges: Object.freeze(
					record.membership.railEdges.map((railEdge) =>
						edge(
							railEdge.from.x + delta.x,
							railEdge.from.y + delta.y,
							railEdge.to.x + delta.x,
							railEdge.to.y + delta.y,
						),
					),
				),
			}),
		}),
	);
}

function recordsFromBundle(
	bundle: StaticFabOrganizationBundle,
	firstId: number,
): readonly StaticFabOrganizationRecord[] {
	return bundle.organizations.map((source, index) =>
		organization(
			firstId + index,
			source.kind,
			source.parentOrganizationIndices.map((parentIndex) => firstId + parentIndex),
			source.membership.railEdgeIndices.map(
				(edgeIndex) =>
					bundle.railEdges[
						edgeIndex
					] as StaticFabOrganizationRecord["membership"]["railEdges"][number],
			),
		),
	);
}

function state(records: readonly StaticFabOrganizationRecord[]): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId: records.reduce((maximum, record) => Math.max(maximum, record.id), 0) + 1,
		records: Object.freeze([...records]),
	});
}

function organization(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	parentOrganizationIds: readonly number[],
	railEdges: StaticFabOrganizationRecord["membership"]["railEdges"],
): StaticFabOrganizationRecord {
	return freezeRecord({
		id,
		kind,
		name: `${kind}-${id}`,
		parentOrganizationIds: Object.freeze([...parentOrganizationIds]),
		membership: Object.freeze({
			railEdges: Object.freeze([...railEdges]),
			advancedSwitchIds: Object.freeze([]),
			equipmentGroupIds: Object.freeze([]),
		}),
	});
}

function freezeRecord(record: StaticFabOrganizationRecord): StaticFabOrganizationRecord {
	return Object.freeze(record);
}

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}
