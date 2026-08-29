import type { OpenFabUserBlueprintRecord } from "../project/OpenFabUserBlueprintLibrary";
import {
	createOpenFabUserBlueprintLibraryReplaceImpact,
	createOpenFabUserBlueprintLibraryRestorePreflight,
	type OpenFabUserBlueprintLibraryBundle,
	type OpenFabUserBlueprintLibraryRestorePreflight,
	parseOpenFabUserBlueprintLibraryBundleJson,
	planOpenFabUserBlueprintLibraryRestore,
	previewOpenFabUserBlueprintLibraryRestorePlan,
} from "../project/OpenFabUserBlueprintLibraryBundle";
import type {
	OpenFabUserBlueprintLibraryRestoreDecisionEntries,
	OpenFabUserBlueprintLibraryRestoreInspectedResponse,
	OpenFabUserBlueprintLibraryRestoreWorkerRequest,
	OpenFabUserBlueprintLibraryRestoreWorkerResponse,
} from "./OpenFabUserBlueprintLibraryRestoreProtocol";

export class OpenFabUserBlueprintLibraryRestoreRuntime {
	private bundle: OpenFabUserBlueprintLibraryBundle | null = null;
	private preflight: OpenFabUserBlueprintLibraryRestorePreflight | null = null;
	private readonly createId: () => string;

	constructor(createId: () => string = createDefaultRestoreIdFactory()) {
		this.createId = createId;
	}

	handle(
		request: OpenFabUserBlueprintLibraryRestoreWorkerRequest,
	): OpenFabUserBlueprintLibraryRestoreWorkerResponse {
		const startedAt = monotonicNow();
		try {
			if (request.type === "INSPECT_OPENFAB_USER_BLUEPRINT_LIBRARY") {
				this.bundle = parseOpenFabUserBlueprintLibraryBundleJson(request.json);
				return this.inspectCurrent(request.requestId, request.currentRecords, startedAt);
			}
			if (request.type === "REBASE_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE") {
				return this.inspectCurrent(request.requestId, request.currentRecords, startedAt);
			}
			const preflight = this.requirePreflight();
			const decisions = decisionMap(request.decisions);
			if (request.type === "PREVIEW_OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE") {
				return Object.freeze({
					type: "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PREVIEWED",
					requestId: request.requestId,
					preview: previewOpenFabUserBlueprintLibraryRestorePlan(
						preflight,
						request.mode,
						decisions,
					),
					elapsedMilliseconds: elapsedSince(startedAt),
				});
			}
			return Object.freeze({
				type: "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_PLANNED",
				requestId: request.requestId,
				plan: planOpenFabUserBlueprintLibraryRestore(preflight, request.mode, decisions, {
					createId: this.createId,
					restoredAt: request.restoredAt,
				}),
				elapsedMilliseconds: elapsedSince(startedAt),
			});
		} catch (error) {
			return Object.freeze({
				type: "OPENFAB_USER_BLUEPRINT_LIBRARY_RESTORE_ERROR",
				requestId: request.requestId,
				message: error instanceof Error ? error.message : "Blueprint library restore failed.",
			});
		}
	}

	private inspectCurrent(
		requestId: number,
		currentRecords: readonly OpenFabUserBlueprintRecord[],
		startedAt: number,
	): OpenFabUserBlueprintLibraryRestoreInspectedResponse {
		if (!this.bundle) throw new Error("Blueprint library restore session is not initialized.");
		this.preflight = createOpenFabUserBlueprintLibraryRestorePreflight(this.bundle, currentRecords);
		return Object.freeze({
			type: "OPENFAB_USER_BLUEPRINT_LIBRARY_INSPECTED",
			requestId,
			bundle: this.bundle,
			preflight: this.preflight,
			replaceImpact: createOpenFabUserBlueprintLibraryReplaceImpact(this.preflight),
			elapsedMilliseconds: elapsedSince(startedAt),
		});
	}

	private requirePreflight(): OpenFabUserBlueprintLibraryRestorePreflight {
		if (!this.preflight) throw new Error("Blueprint library restore session is not initialized.");
		return this.preflight;
	}
}

export function inspectOpenFabUserBlueprintLibraryRestore(
	request: OpenFabUserBlueprintLibraryRestoreWorkerRequest,
): OpenFabUserBlueprintLibraryRestoreWorkerResponse {
	return new OpenFabUserBlueprintLibraryRestoreRuntime(
		() => "user-blueprint-00000000-0000-4000-8000-000000000000",
	).handle(request);
}

function decisionMap(
	entries: OpenFabUserBlueprintLibraryRestoreDecisionEntries,
): ReadonlyMap<string, "keep-current" | "import-copy"> {
	return new Map(entries);
}

function createDefaultRestoreIdFactory(): () => string {
	let fallbackOrdinal = 0;
	return () => {
		if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
			return `user-blueprint-${crypto.randomUUID()}`;
		}
		const ordinal = (fallbackOrdinal++).toString(36).padStart(36, "0").slice(-36);
		return `user-blueprint-${ordinal}`;
	};
}

function elapsedSince(startedAt: number): number {
	return Math.max(0, monotonicNow() - startedAt);
}

function monotonicNow(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}
