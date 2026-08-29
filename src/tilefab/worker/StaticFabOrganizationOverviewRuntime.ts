import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { createPortAttachmentSourceIndex } from "../compile/PortAttachmentResolver";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import {
	deriveStaticFabOrganizationOverviewSnapshotFromValidatedSource,
	type StaticFabOrganizationOverviewSnapshot,
	type StaticFabOrganizationOverviewSourceIdentity,
} from "../compile/StaticFabOrganizationOverview";
import {
	deriveStaticFabProjectChecksSnapshot,
	type StaticFabProjectChecksSnapshot,
} from "../compile/StaticFabProjectChecks";
import { analyzeRailNetwork } from "../core/network";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDiagnosticSource } from "./RailMirrorSnapshotDocument";
import { hydrateStaticFabOrganizationSnapshot } from "./StaticFabOrganizationSoA";

export interface PrepareStaticFabOrganizationOverviewRequest {
	readonly type: "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW";
	readonly requestId: number;
	readonly snapshot: RailMirrorSnapshot;
	readonly source: StaticFabOrganizationOverviewSourceIdentity;
	readonly expectedRailReadinessFingerprint: string;
}

export interface PreparedStaticFabOrganizationOverview {
	readonly sourceRevision: number;
	readonly sourceChecksum: string;
	readonly sourceSequence: number;
	readonly overviewSnapshot: StaticFabOrganizationOverviewSnapshot | null;
	readonly overviewError: string | null;
	readonly checksSnapshot: StaticFabProjectChecksSnapshot;
	readonly preparationMilliseconds: number;
}

export interface StaticFabOrganizationOverviewPreparedResponse {
	readonly type: "STATIC_FAB_ORGANIZATION_OVERVIEW_PREPARED";
	readonly requestId: number;
	readonly prepared: PreparedStaticFabOrganizationOverview;
}

export interface StaticFabOrganizationOverviewErrorResponse {
	readonly type: "STATIC_FAB_ORGANIZATION_OVERVIEW_ERROR";
	readonly requestId: number;
	readonly message: string;
}

export type StaticFabOrganizationOverviewWorkerRequest =
	PrepareStaticFabOrganizationOverviewRequest;
export type StaticFabOrganizationOverviewWorkerResponse =
	| StaticFabOrganizationOverviewPreparedResponse
	| StaticFabOrganizationOverviewErrorResponse;

export type StaticFabOrganizationOverviewClock = () => number;

/** Exact overview derivation. Production invokes this only inside its disposable Worker. */
export function prepareStaticFabOrganizationOverview(
	request: PrepareStaticFabOrganizationOverviewRequest,
	now: StaticFabOrganizationOverviewClock = () => performance.now(),
): PreparedStaticFabOrganizationOverview {
	assertRequestIdentity(request);
	const startedAt = now();
	if (!Number.isFinite(startedAt)) {
		throw new Error("Static FAB organization overview clock returned a non-finite start time.");
	}
	const source = hydrateRailMirrorSnapshotDiagnosticSource(request.snapshot);
	const physical = compilePhysicalRail(source.map, request.source.revision);
	const readiness = createRailProjectReadiness(
		analyzeRailNetwork(source.map),
		physical,
		request.source.checksum,
	);
	if (readiness.fingerprint !== request.expectedRailReadinessFingerprint) {
		throw new Error("Static FAB project checks rail readiness fingerprint does not match source.");
	}
	const attachmentSourceIndex = createPortAttachmentSourceIndex(physical);
	const checksSnapshot = deriveStaticFabProjectChecksSnapshot(
		source.map,
		source.portEquipment,
		source.organizations,
		physical,
		readiness,
		{
			...request.source,
			nextAdvancedSwitchId: request.snapshot.nextAdvancedSwitchId,
			nextPortId: request.snapshot.portEquipment.nextPortId,
			nextEquipmentGroupId: request.snapshot.portEquipment.nextEquipmentGroupId,
			nextOrganizationId: request.snapshot.organizations.nextOrganizationId,
		},
		attachmentSourceIndex,
	);
	let overviewSnapshot: StaticFabOrganizationOverviewSnapshot | null = null;
	let overviewError: string | null = null;
	try {
		const organizations = hydrateStaticFabOrganizationSnapshot(request.snapshot.organizations);
		overviewSnapshot = deriveStaticFabOrganizationOverviewSnapshotFromValidatedSource(
			source.map,
			source.portEquipment,
			organizations,
			request.source,
			physical,
			attachmentSourceIndex,
		);
	} catch (error) {
		overviewError =
			error instanceof Error ? error.message : "Static FAB organization overview is unavailable.";
	}
	const finishedAt = now();
	if (!Number.isFinite(finishedAt) || finishedAt < startedAt) {
		throw new Error("Static FAB organization overview clock returned an invalid finish time.");
	}
	return Object.freeze({
		sourceRevision: request.source.revision,
		sourceChecksum: request.source.checksum,
		sourceSequence: request.source.sequence,
		overviewSnapshot,
		overviewError,
		checksSnapshot,
		preparationMilliseconds: finishedAt - startedAt,
	});
}

function assertRequestIdentity(request: PrepareStaticFabOrganizationOverviewRequest): void {
	if (request.type !== "PREPARE_STATIC_FAB_ORGANIZATION_OVERVIEW") {
		throw new Error("Static FAB organization overview Worker request type is invalid.");
	}
	if (!Number.isSafeInteger(request.requestId) || request.requestId < 1) {
		throw new Error("Static FAB organization overview Worker request ID is invalid.");
	}
	if (
		!Number.isSafeInteger(request.source.revision) ||
		request.source.revision < 0 ||
		!Number.isSafeInteger(request.source.sequence) ||
		request.source.sequence < 0 ||
		typeof request.source.checksum !== "string" ||
		request.source.checksum.length === 0
	) {
		throw new Error("Static FAB organization overview Worker source identity is invalid.");
	}
	if (
		typeof request.expectedRailReadinessFingerprint !== "string" ||
		request.expectedRailReadinessFingerprint.length === 0 ||
		request.expectedRailReadinessFingerprint !== request.expectedRailReadinessFingerprint.trim()
	) {
		throw new Error("Static FAB project checks expected rail fingerprint is invalid.");
	}
	if (request.source.revision !== request.snapshot.revision) {
		throw new Error("Static FAB organization overview source revision does not match snapshot.");
	}
	if (request.source.checksum !== request.snapshot.checksum) {
		throw new Error("Static FAB organization overview source checksum does not match snapshot.");
	}
	if (request.source.sequence !== request.snapshot.sequence) {
		throw new Error("Static FAB organization overview source sequence does not match snapshot.");
	}
}
