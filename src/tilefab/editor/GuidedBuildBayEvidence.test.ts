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
	EMPTY_GUIDED_BUILD_BAY_EVIDENCE,
	summarizeGuidedBuildBayEvidence,
} from "./GuidedBuildBayEvidence";

describe("summarizeGuidedBuildBayEvidence", () => {
	it("publishes empty evidence without inventing a Bay", () => {
		expect(summarizeGuidedBuildBayEvidence({ nextOrganizationId: 1, records: [] })).toEqual(
			EMPTY_GUIDED_BUILD_BAY_EVIDENCE,
		);
	});

	it("does not treat a BAY label without Process Loop children as semantic completion", () => {
		const organizations = stateFromRecords([record(1, "BAY", [], [edge(0, 0, 1, 0)])]);

		expect(summarizeGuidedBuildBayEvidence(organizations)).toEqual({
			semanticBayCount: 0,
			twinProductionBayCount: 0,
			directProcessLoopCount: 0,
		});
	});

	it("distinguishes a certified Single Bay from the guided Twin Bay target", () => {
		const single = organizationStateFromCertifiedBundle(
			certifyProductionBayModule(request(1)).organizationBundle,
		);
		const twin = organizationStateFromCertifiedBundle(
			certifyProductionBayModule(request(2)).organizationBundle,
		);

		expect(summarizeGuidedBuildBayEvidence(single)).toEqual({
			semanticBayCount: 1,
			twinProductionBayCount: 0,
			directProcessLoopCount: 1,
		});
		expect(summarizeGuidedBuildBayEvidence(twin)).toEqual({
			semanticBayCount: 1,
			twinProductionBayCount: 1,
			directProcessLoopCount: 2,
		});
	});

	it("keeps the Twin Bay milestone satisfied after the Bay gains one canonical Bank parent", () => {
		const detached = organizationStateFromCertifiedBundle(
			certifyProductionBayModule(request(2)).organizationBundle,
		);
		const bay = detached.records[0] as StaticFabOrganizationRecord;
		const attached = stateFromRecords([
			Object.freeze({ ...bay, parentOrganizationIds: Object.freeze([4]) }),
			...(detached.records.slice(1) as readonly StaticFabOrganizationRecord[]),
			record(4, "AREA", [], [edge(100, 100, 101, 100)]),
		]);

		expect(summarizeGuidedBuildBayEvidence(attached)).toEqual({
			semanticBayCount: 1,
			twinProductionBayCount: 1,
			directProcessLoopCount: 2,
		});
	});
});

function request(processLoopCount: 1 | 2): ProductionBayModuleRequest {
	return {
		anchor: { x: 0, y: 0 },
		outerLengthMeters: 40,
		outerDepthMeters: 22,
		shellMarginMeters: 3,
		processLoopGapMeters: 4,
		gatewayLengthMeters: 6,
		processLoopCount,
		pose: { forward: DIR_E, side: "right", flow: "forward" },
	};
}

function organizationStateFromCertifiedBundle(
	bundle: StaticFabOrganizationBundle,
): StaticFabOrganizationState {
	const records = bundle.organizations.map((organization, index) =>
		record(
			index + 1,
			organization.kind,
			organization.parentOrganizationIndices.map((parentIndex) => parentIndex + 1),
			organization.membership.railEdgeIndices.map(
				(edgeIndex) =>
					bundle.railEdges[
						edgeIndex
					] as StaticFabOrganizationRecord["membership"]["railEdges"][number],
			),
		),
	);
	return stateFromRecords(records);
}

function stateFromRecords(
	records: readonly StaticFabOrganizationRecord[],
): StaticFabOrganizationState {
	return Object.freeze({
		nextOrganizationId: records.length + 1,
		records: Object.freeze([...records]),
	});
}

function record(
	id: number,
	kind: StaticFabOrganizationRecord["kind"],
	parentOrganizationIds: readonly number[],
	railEdges: StaticFabOrganizationRecord["membership"]["railEdges"],
): StaticFabOrganizationRecord {
	return Object.freeze({
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

function edge(fromX: number, fromY: number, toX: number, toY: number) {
	return Object.freeze({
		from: Object.freeze({ x: fromX, y: fromY }),
		to: Object.freeze({ x: toX, y: toY }),
	});
}
