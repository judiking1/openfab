import { describe, expect, it } from "vitest";
import { publishSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponents } from "../compile/SimulationReadinessTestFixture";
import type { StaticFabProjectChecks } from "../compile/StaticFabProjectChecks";
import { INITIAL_RAIL_WORKER_STATE } from "../worker/RailWorkerBridge";
import {
	boundLiveSimulationReadinessMatchesSource,
	liveSimulationReadinessSourceKey,
	resolveLiveSimulationReadinessEligibility,
} from "./LiveSimulationReadiness";

describe("LiveSimulationReadiness", () => {
	it("requires exact static checks, reviewed operations, and synchronized physical mirror", () => {
		const input = eligibleInput();
		const eligible = resolveLiveSimulationReadinessEligibility(input);

		expect(eligible).toMatchObject({ eligible: true });
		if (!eligible.eligible) throw new Error("Expected an eligible live source.");
		expect(eligible.source).toMatchObject({
			patchSequence: 7,
			revision: 3,
			authoredChecksum: "authored",
			physicalFingerprint: "physical",
			operationalConfigurationRevision: 5,
		});

		expect(
			resolveLiveSimulationReadinessEligibility({ ...input, operationalIssueCount: 1 }),
		).toMatchObject({ eligible: false, code: "OPERATIONAL_CONFIGURATION_REQUIRED" });
		expect(
			resolveLiveSimulationReadinessEligibility({ ...input, staticChecks: null }),
		).toMatchObject({ eligible: false, code: "STATIC_CHECKS_REQUIRED" });
		expect(
			resolveLiveSimulationReadinessEligibility({
				...input,
				worker: { ...input.worker, physicalSequence: 6 },
			}),
		).toMatchObject({ eligible: false, code: "RAIL_MIRROR_REQUIRED" });
	});

	it("distinguishes failed checks from stale check identity", () => {
		const input = eligibleInput();
		expect(
			resolveLiveSimulationReadinessEligibility({
				...input,
				staticChecks: { ...input.staticChecks, ready: false } as StaticFabProjectChecks,
			}),
		).toMatchObject({ eligible: false, code: "STATIC_CHECKS_FAILED" });
		expect(
			resolveLiveSimulationReadinessEligibility({
				...input,
				staticChecks: {
					...input.staticChecks,
					sourceSequence: 6,
				} as StaticFabProjectChecks,
			}),
		).toMatchObject({ eligible: false, code: "SOURCE_IDENTITY_MISMATCH" });
	});

	it("retains a certificate only for the complete bound live source", () => {
		const components = buildSimulationReadinessTestComponents();
		const published = publishSimulationReadinessSnapshot(components);
		const input = eligibleInput({
			patchSequence: components.foundation.source.patchSequence,
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
			physicalFingerprint: components.foundation.source.physicalFingerprint,
			railReadinessFingerprint: components.foundation.source.readinessFingerprint,
		});
		const eligibility = resolveLiveSimulationReadinessEligibility(input);
		if (!eligibility.eligible) throw new Error("Expected certificate fixture to be eligible.");
		const binding = { source: eligibility.source, published };

		expect(boundLiveSimulationReadinessMatchesSource(binding, eligibility.source)).toBe(true);
		expect(
			boundLiveSimulationReadinessMatchesSource(binding, {
				...eligibility.source,
				operationalConfigurationFingerprint: "changed",
			}),
		).toBe(false);
		expect(liveSimulationReadinessSourceKey(eligibility.source)).not.toBe(
			liveSimulationReadinessSourceKey({
				...eligibility.source,
				staticChecksFingerprint: "new-checks",
			}),
		);
	});
});

function eligibleInput(
	overrides: Partial<{
		patchSequence: number;
		revision: number;
		authoredChecksum: string;
		physicalFingerprint: string;
		railReadinessFingerprint: string;
	}> = {},
) {
	const patchSequence = overrides.patchSequence ?? 7;
	const revision = overrides.revision ?? 3;
	const authoredChecksum = overrides.authoredChecksum ?? "authored";
	const physicalFingerprint = overrides.physicalFingerprint ?? "physical";
	const railReadinessFingerprint = overrides.railReadinessFingerprint ?? "rail-ready";
	const staticChecks = {
		sourceSequence: patchSequence,
		sourceRevision: revision,
		sourceChecksum: authoredChecksum,
		sourceNextAdvancedSwitchId: 9,
		sourceNextPortId: 11,
		sourceNextEquipmentGroupId: 13,
		sourceNextOrganizationId: 15,
		railReadinessFingerprint,
		fingerprint: "static-checks",
		ready: true,
	} as StaticFabProjectChecks;
	const worker = {
		...INITIAL_RAIL_WORKER_STATE,
		status: "ready" as const,
		targetSequence: patchSequence,
		sequence: patchSequence,
		targetRevision: revision,
		revision,
		targetChecksum: authoredChecksum,
		checksum: authoredChecksum,
		physicalSequence: patchSequence,
		physicalRevision: revision,
		physicalFingerprint,
		targetOperationalConfigurationRevision: 5,
		operationalConfigurationRevision: 5,
		targetOperationalConfigurationFingerprint: "operations",
		operationalConfigurationFingerprint: "operations",
	};
	return {
		modelGeneration: 21,
		patchSequence,
		revision,
		authoredChecksum,
		railReadinessFingerprint,
		railReadinessReady: true,
		operationalConfigurationRevision: 5,
		operationalConfigurationFingerprint: "operations",
		operationalIssueCount: 0,
		nextAdvancedSwitchId: 9,
		nextPortId: 11,
		nextEquipmentGroupId: 13,
		nextOrganizationId: 15,
		staticChecks,
		worker,
	};
}
