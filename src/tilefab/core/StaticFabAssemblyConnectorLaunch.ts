import {
	createSourceBoundCooperativeTask,
	type SourceBoundCooperativeTask,
} from "./SourceBoundCooperativeTask";
import {
	discoverStaticFabAssemblyGatewaysSteps,
	discoverStaticFabOuterCirculationGatewaysSteps,
	STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT,
	type StaticFabAssemblyConnectorHierarchyEligibility,
	type StaticFabAssemblyConnectorHierarchyRole,
	type StaticFabAssemblyConnectorSelectionBounds,
	type StaticFabAssemblyGatewayCandidate,
	staticFabAssemblyConnectorHierarchyEligibilityFromLookup,
	staticFabAssemblyConnectorSelectionBoundsSteps,
	staticFabAssemblyInterbayConnectorHierarchyEligibilityFromLookup,
} from "./StaticFabAssemblyConnector";
import type { StaticFabOrganizationState } from "./StaticFabOrganization";
import {
	assertStaticFabOrganizationMetadataLookupCurrent,
	type StaticFabOrganizationMetadataLookup,
} from "./StaticFabOrganizationMetadataLookup";
import type { TileMap } from "./TileMap";

const launchResultObjects = new WeakSet<object>();
const capturedLaunchRequests = new WeakSet<object>();

class StaticFabAssemblyConnectorLaunchError extends Error {
	readonly code: "INVALID_INPUT" | "STALE_SOURCE" | "FOREIGN_RESULT" | "UNISSUED_RESULT";

	constructor(
		code: "INVALID_INPUT" | "STALE_SOURCE" | "FOREIGN_RESULT" | "UNISSUED_RESULT",
		message: string,
	) {
		super(message);
		this.name = "StaticFabAssemblyConnectorLaunchError";
		this.code = code;
	}
}

export interface StaticFabAssemblyConnectorLaunchInput {
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	/** The same lookup owned by the prepared Checks target index; this task never claims it. */
	readonly metadataLookup: StaticFabOrganizationMetadataLookup;
	readonly organizationIds: readonly [number, number];
	readonly capturedMapRevision: number;
	/** Must compare exact document/project/worker/checksum identity in O(1). */
	readonly isSourceCurrent: (input: StaticFabAssemblyConnectorLaunchInput) => boolean;
}

export interface StaticFabAssemblyConnectorLaunchResult {
	readonly request: StaticFabAssemblyConnectorLaunchInput;
	readonly map: TileMap;
	readonly organizations: StaticFabOrganizationState;
	readonly metadataLookup: StaticFabOrganizationMetadataLookup;
	readonly capturedMapRevision: number;
	readonly organizationIds: readonly [number, number];
	readonly hierarchyRole: StaticFabAssemblyConnectorHierarchyRole | null;
	readonly eligibility: StaticFabAssemblyConnectorHierarchyEligibility;
	readonly purpose: "HIERARCHY_LINK" | "FAB_LOOP" | null;
	readonly gateways: readonly StaticFabAssemblyGatewayCandidate[];
	readonly selectionBounds: StaticFabAssemblyConnectorSelectionBounds | null;
}

/** Rejects forged/foreign launch data before the synchronous session admission path consumes it. */
export function assertStaticFabAssemblyConnectorLaunchResultCurrent(
	result: StaticFabAssemblyConnectorLaunchResult,
	input: StaticFabAssemblyConnectorLaunchInput,
): void {
	const request = captureStaticFabAssemblyConnectorLaunchInput(input);
	if (!launchResultObjects.has(result as object)) {
		throw new StaticFabAssemblyConnectorLaunchError(
			"UNISSUED_RESULT",
			"Assembly Connector launch result is unissued.",
		);
	}
	if (
		result.map !== request.map ||
		result.organizations !== request.organizations ||
		result.metadataLookup !== request.metadataLookup ||
		result.capturedMapRevision !== request.capturedMapRevision ||
		result.request.map !== request.map ||
		result.request.organizations !== request.organizations ||
		result.request.metadataLookup !== request.metadataLookup ||
		result.request.capturedMapRevision !== request.capturedMapRevision ||
		result.request.isSourceCurrent !== request.isSourceCurrent
	)
		throw new StaticFabAssemblyConnectorLaunchError(
			"FOREIGN_RESULT",
			"Assembly Connector launch result source is foreign.",
		);
	if (
		result.organizationIds[0] !==
			Math.min(request.organizationIds[0], request.organizationIds[1]) ||
		result.organizationIds[1] !== Math.max(request.organizationIds[0], request.organizationIds[1])
	)
		throw new StaticFabAssemblyConnectorLaunchError(
			"FOREIGN_RESULT",
			"Assembly Connector launch pair is foreign.",
		);
	assertLaunchCurrent(result, request);
}

export function captureStaticFabAssemblyConnectorLaunchInput(
	input: StaticFabAssemblyConnectorLaunchInput,
): StaticFabAssemblyConnectorLaunchInput {
	if (input !== null && typeof input === "object" && capturedLaunchRequests.has(input as object))
		return input;
	if (
		input === null ||
		typeof input !== "object" ||
		input.map === null ||
		typeof input.map !== "object" ||
		input.organizations === null ||
		typeof input.organizations !== "object" ||
		input.metadataLookup === null ||
		typeof input.metadataLookup !== "object" ||
		typeof input.isSourceCurrent !== "function" ||
		!Array.isArray(input.organizationIds) ||
		input.organizationIds.length !== 2 ||
		!positiveInt32(input.organizationIds[0]) ||
		!positiveInt32(input.organizationIds[1]) ||
		!Number.isSafeInteger(input.capturedMapRevision) ||
		input.capturedMapRevision < 0 ||
		typeof input.map.getRevision !== "function"
	) {
		throw new StaticFabAssemblyConnectorLaunchError(
			"INVALID_INPUT",
			"Assembly Connector launch input is invalid.",
		);
	}
	const organizationIds = Object.freeze([
		input.organizationIds[0] as number,
		input.organizationIds[1] as number,
	]) as readonly [number, number];
	const request = Object.freeze({
		map: input.map,
		organizations: input.organizations,
		metadataLookup: input.metadataLookup,
		organizationIds,
		capturedMapRevision: input.capturedMapRevision,
		isSourceCurrent: input.isSourceCurrent,
	});
	capturedLaunchRequests.add(request);
	return request;
}

function assertLaunchCurrent(
	result: StaticFabAssemblyConnectorLaunchResult,
	request: StaticFabAssemblyConnectorLaunchInput,
): void {
	if (
		request.map !== result.map ||
		request.organizations !== result.organizations ||
		request.metadataLookup !== result.metadataLookup
	) {
		throw new StaticFabAssemblyConnectorLaunchError(
			"FOREIGN_RESULT",
			"Assembly Connector launch source changed.",
		);
	}
	assertRequestCurrent(request);
}

function assertRequestCurrent(request: StaticFabAssemblyConnectorLaunchInput): void {
	const beforeRevision = request.map.getRevision();
	if (beforeRevision !== request.capturedMapRevision) {
		throw new StaticFabAssemblyConnectorLaunchError(
			"STALE_SOURCE",
			"Assembly Connector launch map is stale.",
		);
	}
	const current = request.isSourceCurrent(request);
	const afterPredicateRevision = request.map.getRevision();
	if (current !== true || afterPredicateRevision !== request.capturedMapRevision) {
		throw new StaticFabAssemblyConnectorLaunchError(
			"STALE_SOURCE",
			"Assembly Connector launch source is stale.",
		);
	}
	assertStaticFabOrganizationMetadataLookupCurrent(request.metadataLookup, request.organizations);
	const afterLookupRevision = request.map.getRevision();
	if (afterLookupRevision !== request.capturedMapRevision) {
		throw new StaticFabAssemblyConnectorLaunchError(
			"STALE_SOURCE",
			"Assembly Connector launch changed during lookup.",
		);
	}
}

/**
 * Cooperative Checks launch preparation. It is advisory UI preparation only: it creates no
 * route, patch, relationship, gateway authority, Worker proof, or organization mutation.
 * The caller must pass the index-owned lookup. This phase never claims or revokes that lookup.
 */
export function createStaticFabAssemblyConnectorLaunchPreparation(
	input: StaticFabAssemblyConnectorLaunchInput,
): SourceBoundCooperativeTask<StaticFabAssemblyConnectorLaunchResult> {
	const request = captureStaticFabAssemblyConnectorLaunchInput(input);
	const assertCurrent = (): void => {
		assertRequestCurrent(request);
	};

	function* prepare(): Generator<void, StaticFabAssemblyConnectorLaunchResult> {
		let childSteps: Generator<void, unknown> | null = null;
		const temporaryGateways: StaticFabAssemblyGatewayCandidate[] = [];
		try {
			assertCurrent();
			const [firstId, secondId] = request.organizationIds;
			const firstRole = request.metadataLookup.semanticRole(firstId);
			yield;
			assertCurrent();
			const secondRole = request.metadataLookup.semanticRole(secondId);
			yield;
			assertCurrent();
			const organizationIds = Object.freeze(
				[firstId, secondId].sort((left, right) => left - right),
			) as readonly [number, number];
			const hierarchyRole: StaticFabAssemblyConnectorHierarchyRole | null =
				firstRole === "BAY" && secondRole === "BAY"
					? "BAY_TO_BANK"
					: firstRole === "BAY_BANK" && secondRole === "BAY_BANK"
						? "BANK_TO_FAB"
						: null;
			let eligibility: StaticFabAssemblyConnectorHierarchyEligibility;
			if (hierarchyRole === "BANK_TO_FAB") {
				eligibility = staticFabAssemblyInterbayConnectorHierarchyEligibilityFromLookup(
					request.organizations,
					request.metadataLookup,
					firstId,
					secondId,
				);
			} else {
				eligibility = staticFabAssemblyConnectorHierarchyEligibilityFromLookup(
					request.organizations,
					request.metadataLookup,
					firstId,
					secondId,
				);
			}
			assertCurrent();
			if (!eligibility.valid || hierarchyRole === null) {
				const result = Object.freeze({
					request,
					map: request.map,
					organizations: request.organizations,
					metadataLookup: request.metadataLookup,
					capturedMapRevision: request.capturedMapRevision,
					organizationIds,
					hierarchyRole,
					eligibility,
					purpose: null,
					gateways: Object.freeze([]),
					selectionBounds: null,
				});
				launchResultObjects.add(result);
				return result;
			}
			const purpose = eligibility.purpose;
			for (const organizationId of organizationIds) {
				childSteps =
					purpose === "FAB_LOOP"
						? discoverStaticFabOuterCirculationGatewaysSteps(
								request.map,
								request.organizations,
								request.metadataLookup,
								organizationId,
								STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT,
							)
						: discoverStaticFabAssemblyGatewaysSteps(
								request.map,
								request.organizations,
								request.metadataLookup,
								organizationId,
								STATIC_FAB_ASSEMBLY_GATEWAY_LIMIT,
							);
				const discovered = yield* driveChildSteps(
					childSteps as Generator<void, readonly StaticFabAssemblyGatewayCandidate[]>,
					assertCurrent,
				);
				childSteps = null;
				for (const gateway of discovered) {
					assertCurrent();
					temporaryGateways.push(gateway);
					yield;
				}
			}
			childSteps = staticFabAssemblyConnectorSelectionBoundsSteps(
				request.organizations,
				organizationIds,
			);
			const selectionBounds = yield* driveChildSteps(
				childSteps as Generator<void, StaticFabAssemblyConnectorSelectionBounds | null>,
				assertCurrent,
			);
			childSteps = null;
			assertCurrent();
			const result = Object.freeze({
				request,
				map: request.map,
				organizations: request.organizations,
				metadataLookup: request.metadataLookup,
				capturedMapRevision: request.capturedMapRevision,
				organizationIds,
				hierarchyRole,
				eligibility,
				purpose,
				gateways: Object.freeze([...temporaryGateways]),
				selectionBounds,
			});
			launchResultObjects.add(result);
			return result;
		} finally {
			childSteps?.return(undefined as never);
			temporaryGateways.length = 0;
		}
	}

	return createSourceBoundCooperativeTask(prepare(), assertCurrent);
}

function* driveChildSteps<T>(
	steps: Generator<void, T>,
	assertCurrent: () => void,
): Generator<void, T> {
	try {
		while (true) {
			assertCurrent();
			const next = steps.next();
			if (next.done) {
				assertCurrent();
				return next.value;
			}
			yield;
		}
	} finally {
		steps.return(undefined as never);
	}
}

function positiveInt32(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0 && (value as number) <= 0x7fff_ffff;
}
