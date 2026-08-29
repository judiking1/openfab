import {
	deriveOpenFabFabProfile,
	type OpenFabFabProfile,
	type OpenFabFabProfileDerived,
	openFabFabProfileFingerprint,
} from "../compile/OpenFabFabProfile";

export const NEW_FAB_PROFILE_WIZARD_STEPS = Object.freeze([
	Object.freeze({ id: "layout" as const, label: "Layout" }),
	Object.freeze({ id: "production" as const, label: "Production" }),
	Object.freeze({ id: "circulation" as const, label: "Circulation" }),
	Object.freeze({ id: "review" as const, label: "Review" }),
]);

export type NewFabProfileWizardStep = (typeof NEW_FAB_PROFILE_WIZARD_STEPS)[number]["id"];

export interface NewFabProfileWizardNameValidation {
	readonly valid: boolean;
	readonly reason: string | null;
}

export interface NewFabProfileWizardBlockSummary {
	readonly ordinal: number;
	readonly bankCount: number;
	readonly bayCount: number;
	readonly singleBayCount: number;
	readonly twinBayCount: number;
	readonly processLoopCount: number;
}

export interface NewFabProfileWizardReview {
	readonly profile: OpenFabFabProfile;
	readonly profileFingerprint: string;
	readonly derived: OpenFabFabProfileDerived;
	readonly layoutBlocks: readonly NewFabProfileWizardBlockSummary[];
	readonly siteEnvelope: "AUTO_FIT";
	readonly profileValid: true;
	readonly verificationStatus: "NOT_YET_VERIFIED";
	readonly portServiceStatus: "NOT_CHECKED";
	readonly simulationReady: false;
}

export interface NewFabProfilePreparedBinding<TPreparedEvidence extends object> {
	readonly profileFingerprint: string;
	readonly projectName: string;
	readonly evidence: TPreparedEvidence;
}

/**
 * Mirrors the native project-name boundary without silently trimming or rewriting user input.
 */
export function validateNewFabProfileWizardName(name: string): NewFabProfileWizardNameValidation {
	if (name.length === 0) {
		return Object.freeze({ valid: false, reason: "Enter a project name." });
	}
	if (name !== name.trim()) {
		return Object.freeze({
			valid: false,
			reason: "Remove spaces before or after the project name.",
		});
	}
	if (name.length > 120) {
		return Object.freeze({
			valid: false,
			reason: "Project name must be 120 characters or fewer.",
		});
	}
	for (const character of name) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && codePoint <= 0x1f) {
			return Object.freeze({
				valid: false,
				reason: "Project name cannot contain control characters.",
			});
		}
	}
	return Object.freeze({ valid: true, reason: null });
}

/**
 * Builds bounded semantic presentation data from authored profile intent. It does not compose rail,
 * inspect a current map, or claim exact preparation evidence.
 */
export function createNewFabProfileWizardReview(input: unknown): NewFabProfileWizardReview {
	const derived = deriveOpenFabFabProfile(input);
	const layoutBlocks = derived.layoutBlocks.map((layoutBlock) => {
		const bays = layoutBlock.banks.flatMap((bank) => bank.bays);
		return Object.freeze({
			ordinal: layoutBlock.ordinal,
			bankCount: layoutBlock.banks.length,
			bayCount: bays.length,
			singleBayCount: bays.filter((bay) => bay.variant === "SINGLE").length,
			twinBayCount: bays.filter((bay) => bay.variant === "TWIN").length,
			processLoopCount: layoutBlock.banks.reduce((total, bank) => total + bank.processLoopCount, 0),
		}) satisfies NewFabProfileWizardBlockSummary;
	});
	return Object.freeze({
		profile: derived.profile,
		profileFingerprint: derived.profileFingerprint,
		derived,
		layoutBlocks: Object.freeze(layoutBlocks),
		siteEnvelope: "AUTO_FIT" as const,
		profileValid: true as const,
		verificationStatus: "NOT_YET_VERIFIED" as const,
		portServiceStatus: "NOT_CHECKED" as const,
		simulationReady: false as const,
	});
}

export function bindNewFabProfilePreparedEvidence<TPreparedEvidence extends object>(
	profile: OpenFabFabProfile,
	projectName: string,
	evidence: TPreparedEvidence,
): NewFabProfilePreparedBinding<TPreparedEvidence> {
	const nameValidation = validateNewFabProfileWizardName(projectName);
	if (!nameValidation.valid) {
		throw new RangeError(nameValidation.reason ?? "Project name is invalid.");
	}
	if (evidence === null || typeof evidence !== "object") {
		throw new TypeError("New Fab preparation must return exact evidence as an object.");
	}
	return Object.freeze({
		profileFingerprint: openFabFabProfileFingerprint(profile),
		projectName,
		evidence,
	});
}

export function newFabProfilePreparedBindingMatches(
	binding: NewFabProfilePreparedBinding<object>,
	profile: OpenFabFabProfile,
	projectName: string,
): boolean {
	return (
		binding.profileFingerprint === openFabFabProfileFingerprint(profile) &&
		binding.projectName === projectName
	);
}
