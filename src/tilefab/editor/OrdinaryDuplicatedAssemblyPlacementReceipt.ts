import { recognizeProductionBayModule } from "../core/ProductionBayModuleRecognition";
import type { RailDocument } from "../core/RailDocument";
import type {
	StaticFabOrganizationMutation,
	StaticFabOrganizationRecord,
	StaticFabOrganizationSemanticRole,
	StaticFabOrganizationState,
} from "../core/StaticFabOrganization";
import type { TileMap } from "../core/TileMap";

export type OrdinaryDuplicatedAssemblyRootRole = "TWIN_BAY" | "BAY_BANK";

/** Runtime-only evidence. Serialized project data remains the sole authored source of truth. */
export type OrdinaryDuplicatedAssemblyPlacementReceipt = Readonly<{
	document: RailDocument;
	patchSequence: number;
	bundleFingerprint: string;
	sourceRootOrganizationId: number;
	placedRootOrganizationId: number;
	role: OrdinaryDuplicatedAssemblyRootRole;
	phase: "placed" | "undone";
}>;

export type OrdinaryPlacedAssemblyRecognition = Readonly<{
	placedRoot: StaticFabOrganizationRecord;
	duplicateSourceRoot: StaticFabOrganizationRecord | null;
	role: OrdinaryDuplicatedAssemblyRootRole;
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt | null;
}>;

export type OrdinaryDuplicatedAssemblyUndoProjection = Readonly<{
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt;
	sourceRoot: StaticFabOrganizationRecord;
}>;

export type OrdinaryDuplicatedAssemblyRedoProjection = Readonly<{
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt;
	sourceRoot: StaticFabOrganizationRecord;
	placedRoot: StaticFabOrganizationRecord;
}>;

export type OrdinaryPlacedAssemblyReceiptInvalidationReason = "missing-root" | "unrecognized-root";

/**
 * A large placement mutates the document before the Worker-derived editor model is activated.
 * Receipt invalidation must wait for that semantic projection instead of treating its old role map
 * as evidence about the newly committed root.
 */
export function ordinaryPlacedAssemblyReceiptInvalidationReason(
	context: Readonly<{
		placementActive: boolean;
		placedRootOrganizationId: number | null;
		modelSyncPending: boolean;
		placedRootExists: boolean;
		redoAvailable: boolean;
		recognizedTwinBay: boolean;
		recognizedBayBank: boolean;
	}>,
): OrdinaryPlacedAssemblyReceiptInvalidationReason | null {
	if (
		!context.placementActive ||
		context.placedRootOrganizationId === null ||
		context.modelSyncPending
	) {
		return null;
	}
	if (!context.placedRootExists) return context.redoAvailable ? null : "missing-root";
	return context.recognizedTwinBay || context.recognizedBayBank ? null : "unrecognized-root";
}

/** Keep the common Bank path constant-time; exact Twin Bay recognition remains lazy. */
export function ordinaryDuplicatedAssemblyRootRole(
	semanticRole: StaticFabOrganizationSemanticRole | undefined,
	recognizeTwinBay: () => boolean,
): OrdinaryDuplicatedAssemblyRootRole | null {
	if (!ordinaryDuplicatedAssemblyNeedsTwinBayRecognition(semanticRole)) return "BAY_BANK";
	return recognizeTwinBay() ? "TWIN_BAY" : null;
}

/** Shared UI guard: an explicit Bank role must never enter the full Twin Bay graph recognizer. */
export function ordinaryDuplicatedAssemblyNeedsTwinBayRecognition(
	semanticRole: StaticFabOrganizationSemanticRole | undefined,
	modelSyncPending = false,
): boolean {
	return !modelSyncPending && semanticRole !== "BAY_BANK";
}

export function recognizeOrdinaryDuplicatedAssemblyRootRole(
	map: TileMap,
	organizations: StaticFabOrganizationState,
	semanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>,
	organizationId: number,
): OrdinaryDuplicatedAssemblyRootRole | null {
	return ordinaryDuplicatedAssemblyRootRole(
		semanticRoles.get(organizationId),
		() => recognizeProductionBayModule(map, organizations, organizationId).valid,
	);
}

/**
 * Binds one committed bundle placement to the exact root mutation selected by the portable bundle's
 * root index. The document cursor is never used as an organization identity.
 */
export function recognizeOrdinaryPlacedAssembly(
	context: Readonly<{
		document: RailDocument;
		patchSequence: number;
		bundleFingerprint: string;
		guidedBuildActive: boolean;
		rootOrganizationIndices: readonly number[];
		organizationMutations: readonly StaticFabOrganizationMutation[];
		origin: "selection-copy" | string;
		captureMode: "DIRECT" | "EFFECTIVE";
		sourceRootOrganizationIds: readonly number[];
		map: TileMap;
		organizations: StaticFabOrganizationState;
		semanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>;
	}>,
): OrdinaryPlacedAssemblyRecognition | null {
	if (context.guidedBuildActive || context.rootOrganizationIndices.length !== 1) return null;
	const rootIndex = context.rootOrganizationIndices[0];
	const placedRoot =
		rootIndex === undefined ? null : (context.organizationMutations[rootIndex]?.after ?? null);
	if (!placedRoot) return null;
	const placedRole = recognizeOrdinaryDuplicatedAssemblyRootRole(
		context.map,
		context.organizations,
		context.semanticRoles,
		placedRoot.id,
	);
	if (!placedRole) return null;
	const sourceRootOrganizationId = context.sourceRootOrganizationIds[0] ?? null;
	const sourceRoot =
		context.origin === "selection-copy" &&
		context.captureMode === "EFFECTIVE" &&
		context.sourceRootOrganizationIds.length === 1 &&
		sourceRootOrganizationId !== null &&
		sourceRootOrganizationId !== placedRoot.id
			? (context.organizations.records.find((record) => record.id === sourceRootOrganizationId) ??
				null)
			: null;
	const sourceRole = sourceRoot
		? recognizeOrdinaryDuplicatedAssemblyRootRole(
				context.map,
				context.organizations,
				context.semanticRoles,
				sourceRoot.id,
			)
		: null;
	if (placedRole !== "TWIN_BAY" && sourceRole !== "BAY_BANK") return null;
	const duplicateSourceRoot = sourceRoot && sourceRole === placedRole ? sourceRoot : null;
	return Object.freeze({
		placedRoot,
		duplicateSourceRoot,
		role: placedRole,
		receipt: duplicateSourceRoot
			? Object.freeze({
					document: context.document,
					patchSequence: context.patchSequence,
					bundleFingerprint: context.bundleFingerprint,
					sourceRootOrganizationId: duplicateSourceRoot.id,
					placedRootOrganizationId: placedRoot.id,
					role: placedRole,
					phase: "placed" as const,
				})
			: null,
	});
}

export function ordinaryDuplicatedAssemblyReceiptIsCurrent(
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt | null,
	context: Readonly<{
		document: RailDocument;
		patchSequence: number;
		bundleFingerprint: string | null;
		sourceRootOrganizationId: number | null;
		placedRootOrganizationId: number | null;
		expectedRole: OrdinaryDuplicatedAssemblyRootRole;
		sourceRole: OrdinaryDuplicatedAssemblyRootRole | null;
		placedRole: OrdinaryDuplicatedAssemblyRootRole | null;
	}>,
): boolean {
	return Boolean(
		receipt?.document === context.document &&
			receipt.phase === "placed" &&
			receipt.patchSequence === context.patchSequence &&
			receipt.bundleFingerprint === context.bundleFingerprint &&
			receipt.role === context.expectedRole &&
			receipt.sourceRootOrganizationId === context.sourceRootOrganizationId &&
			receipt.placedRootOrganizationId === context.placedRootOrganizationId &&
			context.sourceRole === context.expectedRole &&
			context.placedRole === context.expectedRole,
	);
}

export function ordinaryDuplicatedAssemblyUndoCandidate(
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt | null,
	context: Readonly<{
		document: RailDocument;
		patchSequence: number;
		retainedBundleFingerprint: string | null;
		selectedOrganizationIds: readonly number[];
	}>,
): OrdinaryDuplicatedAssemblyPlacementReceipt | null {
	if (
		receipt?.document !== context.document ||
		receipt.phase !== "placed" ||
		receipt.patchSequence !== context.patchSequence ||
		(context.retainedBundleFingerprint !== null &&
			receipt.bundleFingerprint !== context.retainedBundleFingerprint)
	) {
		return null;
	}
	const selectedIds = [...context.selectedOrganizationIds].sort((left, right) => left - right);
	const expectedIds = [receipt.sourceRootOrganizationId, receipt.placedRootOrganizationId].sort(
		(left, right) => left - right,
	);
	return selectedIds.length === 2 && selectedIds.every((id, index) => id === expectedIds[index])
		? receipt
		: null;
}

/** Validate the exact post-Undo projection; unrelated records never establish authority. */
export function ordinaryDuplicatedAssemblyUndoProjection(
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt,
	context: Readonly<{
		document: RailDocument;
		patchSequence: number;
		map: TileMap;
		organizations: StaticFabOrganizationState;
		semanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>;
	}>,
): OrdinaryDuplicatedAssemblyUndoProjection | null {
	if (receipt.document !== context.document || receipt.phase !== "placed") return null;
	let sourceRoot: StaticFabOrganizationRecord | null = null;
	let placedRoot: StaticFabOrganizationRecord | null = null;
	for (const record of context.organizations.records) {
		if (record.id === receipt.sourceRootOrganizationId) sourceRoot = record;
		if (record.id === receipt.placedRootOrganizationId) placedRoot = record;
		if (sourceRoot && placedRoot) break;
	}
	if (
		!sourceRoot ||
		placedRoot ||
		recognizeOrdinaryDuplicatedAssemblyRootRole(
			context.map,
			context.organizations,
			context.semanticRoles,
			sourceRoot.id,
		) !== receipt.role
	) {
		return null;
	}
	return Object.freeze({
		receipt: Object.freeze({
			...receipt,
			patchSequence: context.patchSequence,
			phase: "undone",
		}),
		sourceRoot,
	});
}

/**
 * Authorize a Redo without deriving semantic roles until all constant-time receipt and selection
 * gates, plus exact source/target existence checks, have passed.
 */
export function ordinaryDuplicatedAssemblyRedoCandidate(
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt | null,
	context: Readonly<{
		document: RailDocument;
		patchSequence: number;
		retainedBundleFingerprint: string | null;
		selectedOrganizationIds: readonly number[];
		map: TileMap;
		organizations: StaticFabOrganizationState;
		semanticRoles: () => ReadonlyMap<number, StaticFabOrganizationSemanticRole>;
	}>,
): OrdinaryDuplicatedAssemblyPlacementReceipt | null {
	if (
		receipt?.document !== context.document ||
		receipt.phase !== "undone" ||
		receipt.patchSequence !== context.patchSequence ||
		(context.retainedBundleFingerprint !== null &&
			receipt.bundleFingerprint !== context.retainedBundleFingerprint) ||
		context.selectedOrganizationIds.length !== 1 ||
		context.selectedOrganizationIds[0] !== receipt.sourceRootOrganizationId
	) {
		return null;
	}
	let sourceRoot: StaticFabOrganizationRecord | null = null;
	for (const record of context.organizations.records) {
		if (record.id === receipt.placedRootOrganizationId) return null;
		if (record.id === receipt.sourceRootOrganizationId) sourceRoot = record;
	}
	if (!sourceRoot) return null;
	return recognizeOrdinaryDuplicatedAssemblyRootRole(
		context.map,
		context.organizations,
		context.semanticRoles(),
		sourceRoot.id,
	) === receipt.role
		? receipt
		: null;
}

/** Validate the exact source/target role pair after Redo and advance the runtime receipt. */
export function ordinaryDuplicatedAssemblyRedoProjection(
	receipt: OrdinaryDuplicatedAssemblyPlacementReceipt,
	context: Readonly<{
		document: RailDocument;
		patchSequence: number;
		map: TileMap;
		organizations: StaticFabOrganizationState;
		semanticRoles: ReadonlyMap<number, StaticFabOrganizationSemanticRole>;
	}>,
): OrdinaryDuplicatedAssemblyRedoProjection | null {
	if (receipt.document !== context.document || receipt.phase !== "undone") return null;
	let sourceRoot: StaticFabOrganizationRecord | null = null;
	let placedRoot: StaticFabOrganizationRecord | null = null;
	for (const record of context.organizations.records) {
		if (record.id === receipt.sourceRootOrganizationId) sourceRoot = record;
		if (record.id === receipt.placedRootOrganizationId) placedRoot = record;
		if (sourceRoot && placedRoot) break;
	}
	if (!sourceRoot || !placedRoot || sourceRoot.id === placedRoot.id) return null;
	const sourceRole = recognizeOrdinaryDuplicatedAssemblyRootRole(
		context.map,
		context.organizations,
		context.semanticRoles,
		sourceRoot.id,
	);
	const placedRole = recognizeOrdinaryDuplicatedAssemblyRootRole(
		context.map,
		context.organizations,
		context.semanticRoles,
		placedRoot.id,
	);
	return sourceRole === receipt.role && placedRole === receipt.role
		? Object.freeze({
				receipt: Object.freeze({
					...receipt,
					patchSequence: context.patchSequence,
					phase: "placed",
				}),
				sourceRoot,
				placedRoot,
			})
		: null;
}
