import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultOpenFabFabProfile, type OpenFabFabProfile } from "../compile/OpenFabFabProfile";
import { NewFabProfileWizard } from "./NewFabProfileWizard";
import {
	bindNewFabProfilePreparedEvidence,
	createNewFabProfileWizardReview,
	NEW_FAB_PROFILE_WIZARD_STEPS,
	newFabProfilePreparedBindingMatches,
	validateNewFabProfileWizardName,
} from "./NewFabProfileWizardModel";

interface PreparedEvidenceFixture {
	readonly fingerprint: string;
}

describe("NewFabProfileWizard model", () => {
	it("derives the default semantic review without claiming preparation or simulation", () => {
		const review = createNewFabProfileWizardReview(defaultOpenFabFabProfile());

		expect(NEW_FAB_PROFILE_WIZARD_STEPS.map((step) => step.label)).toEqual([
			"Layout",
			"Production",
			"Circulation",
			"Review",
		]);
		expect(review.derived.counts).toMatchObject({
			fabs: 1,
			layoutBlocks: 1,
			banks: 2,
			bays: 24,
			singleBays: 12,
			twinBays: 12,
			processLoops: 36,
			requiredBayToBankGatewayPairs: 24,
			requiredBankToDistributorGatewayPairs: 2,
			requiredInterBlockConnectors: 0,
		});
		expect(review.layoutBlocks).toEqual([
			{
				ordinal: 0,
				bankCount: 2,
				bayCount: 24,
				singleBayCount: 12,
				twinBayCount: 12,
				processLoopCount: 36,
			},
		]);
		expect(review).toMatchObject({
			siteEnvelope: "AUTO_FIT",
			profileValid: true,
			verificationStatus: "NOT_YET_VERIFIED",
			portServiceStatus: "NOT_CHECKED",
			simulationReady: false,
		});
	});

	it("keeps the largest supported profile bounded and excludes Layout Blocks from organizations", () => {
		const review = createNewFabProfileWizardReview({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 3,
			banksPerLayoutBlock: 3,
			processLoopsPerBank: 24,
			bayPackingPolicy: "SINGLE",
		});

		expect(review.derived.counts).toMatchObject({
			layoutBlocks: 3,
			banks: 9,
			bays: 216,
			processLoops: 216,
			organizationRecords: 442,
			requiredInterBlockConnectors: 2,
		});
		expect(review.layoutBlocks).toHaveLength(3);
		expect(review.layoutBlocks).toEqual(
			Array.from({ length: 3 }, (_, ordinal) => ({
				ordinal,
				bankCount: 3,
				bayCount: 72,
				singleBayCount: 72,
				twinBayCount: 0,
				processLoopCount: 72,
			})),
		);
		expect(review.derived.counts.organizationRecords).toBe(
			1 +
				review.derived.counts.banks +
				review.derived.counts.bays +
				review.derived.counts.processLoops,
		);
	});

	it("matches the native project-name boundary and never silently normalizes input", () => {
		expect(validateNewFabProfileWizardName("OpenFab Research Fab")).toEqual({
			valid: true,
			reason: null,
		});
		for (const [name, reason] of [
			["", /Enter a project name/],
			[" OpenFab", /before or after/],
			["OpenFab ", /before or after/],
			["A".repeat(121), /120 characters/],
			["Open\u0000Fab", /control characters/],
		] as const) {
			expect(validateNewFabProfileWizardName(name).reason).toMatch(reason);
		}
		expect(validateNewFabProfileWizardName("Open\u007fFab")).toEqual({
			valid: true,
			reason: null,
		});
	});

	it("binds exact prepared evidence to both profile and project name", () => {
		const profile = defaultOpenFabFabProfile();
		const evidence = Object.freeze({ fingerprint: "evidence:default" });
		const binding = bindNewFabProfilePreparedEvidence(profile, "OpenFab Research Fab", evidence);

		expect(binding.evidence).toBe(evidence);
		expect(newFabProfilePreparedBindingMatches(binding, profile, "OpenFab Research Fab")).toBe(
			true,
		);
		expect(newFabProfilePreparedBindingMatches(binding, profile, "Renamed Fab")).toBe(false);
		expect(
			newFabProfilePreparedBindingMatches(
				binding,
				{ ...profile, processLoopsPerBank: 24 },
				"OpenFab Research Fab",
			),
		).toBe(false);
		expect(() => bindNewFabProfilePreparedEvidence(profile, " OpenFab", evidence)).toThrow(
			/before or after/,
		);
	});
});

describe("NewFabProfileWizard static shell rendering", () => {
	it("renders a modal four-step shell with only implemented Layout choices", () => {
		const markup = renderWizard();

		expect(markup).toContain('role="dialog"');
		expect(markup).toContain('aria-modal="true"');
		expect(markup).toContain('data-step="layout"');
		expect(markup).toContain("Layout");
		expect(markup).toContain("Production");
		expect(markup).toContain("Circulation");
		expect(markup).toContain("Review");
		expect(markup).toContain("generator-only physical grouping");
		expect(markup).toContain("They are not organization records");
		expect(markup).toContain("AUTO-FIT");
		expect(markup).toContain("EAST–WEST AXIS");
		expect(markup).toContain("NORTH–SOUTH AXIS");
		expect(markup).toContain('maxLength="120"');
		expect(markup).not.toContain(">PREPARE<");
		expect(markup).not.toContain(">CREATE<");
	});

	it("uses profile language and makes the semantic preview explicitly non-exact", () => {
		const markup = renderWizard({
			...defaultOpenFabFabProfile(),
			layoutBlockCount: 3,
			bankRepetitionAxis: "NORTH_SOUTH",
			banksPerLayoutBlock: 3,
			processLoopsPerBank: 24,
			bayPackingPolicy: "TWIN",
			processLoopLongAxisMeters: 56,
			processLoopCenterPitchMeters: 16,
		});

		expect(markup).toContain("3 generator-only Layout Blocks");
		expect(markup).toContain("9 Banks");
		expect(markup).toContain("108 Bays");
		expect(markup).toContain("216 Process Loops");
		expect(markup).toContain("Bounded semantic preview");
		expect(markup).toContain("exact rail geometry is prepared later");
	});

	it("exposes an inert handoff shell while the dirty-project guard owns the modal", () => {
		const markup = renderWizard(defaultOpenFabFabProfile(), true);

		expect(markup).toContain('data-testid="new-fab-profile-wizard"');
		expect(markup).toContain('data-suspended="true"');
		expect(markup).toContain('aria-hidden="true"');
		expect(markup).not.toContain('aria-modal="true"');
		expect(markup).toContain('data-preparation="idle"');
		expect(markup).toContain('data-creation="idle"');
		expect(markup).toContain('data-layout-blocks="1"');
		expect(markup).toContain('data-banks="2"');
		expect(markup).toContain('data-bays="24"');
		expect(markup).toContain('data-process-loops="36"');
	});
});

function renderWizard(
	profile: OpenFabFabProfile = defaultOpenFabFabProfile(),
	suspended = false,
): string {
	return renderToStaticMarkup(
		<NewFabProfileWizard<PreparedEvidenceFixture>
			initialProfile={profile}
			suspended={suspended}
			onCancel={vi.fn()}
			onPrepare={vi.fn(async () => ({ fingerprint: "prepared:evidence" }))}
			onCreate={vi.fn()}
		/>,
	);
}
