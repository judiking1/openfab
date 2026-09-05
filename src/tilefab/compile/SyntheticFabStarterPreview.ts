import { checksumRailNetworkAnalysis } from "../core/network";
import {
	captureStaticFabOrganizationBundle,
	type StaticFabOrganizationBundle,
} from "../core/StaticFabOrganizationBundle";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import {
	type CompiledRailPresentation,
	compilePhysicalRailPresentation,
	compilePhysicalRailRuns,
} from "../render/PhysicalRailPresentation";
import { captureRailMirrorSnapshot, type RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { PATH_KIND, samplePhysicalPath } from "./PhysicalPathCompiler";
import { createRailProjectReadiness } from "./RailProjectReadiness";
import type {
	SyntheticFabStarterBuildStep,
	SyntheticFabStarterRequest,
	SyntheticFabStarterSummary,
} from "./SyntheticFabStarter";
import {
	buildSyntheticFabStarter,
	syntheticFabStarterRequestFingerprint,
} from "./SyntheticFabStarter";
import {
	captureSyntheticFabStarterRouteGeometry,
	type SyntheticFabStarterRouteGeometry,
} from "./SyntheticFabStarterRouteGeometry";

export interface SyntheticFabStarterPreviewGeometry {
	readonly bounds: Readonly<{
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}>;
	readonly pathData: string;
	readonly markers: readonly Readonly<{
		x: number;
		y: number;
		angleDegrees: number;
	}>[];
	readonly markerScale: number;
}

export interface PreparedSyntheticFabStarter {
	readonly request: SyntheticFabStarterRequest;
	readonly requestFingerprint: string;
	readonly planFingerprint: string | null;
	readonly summary: SyntheticFabStarterSummary;
	readonly steps: readonly SyntheticFabStarterBuildStep[];
	readonly authoredChecksum: string;
	readonly authoredRevision: number;
	readonly analysisFingerprint: string;
	readonly physicalFingerprint: string;
	readonly readinessFingerprint: string;
	readonly authoringReady: boolean;
	readonly snapshot: RailMirrorSnapshot;
	readonly placementBundle: StaticFabOrganizationBundle | null;
	readonly placementBundleFingerprint: string | null;
	readonly geometry: SyntheticFabStarterPreviewGeometry | null;
	readonly exactGeometry: SyntheticFabStarterRouteGeometry | null;
}

/**
 * Produces the serializable payload shared by starter preview and project creation.
 * The browser bridge runs this on a dedicated Worker for large FAB presets.
 */
export function prepareSyntheticFabStarter(
	request: SyntheticFabStarterRequest,
): PreparedSyntheticFabStarter {
	const build = buildSyntheticFabStarter(request);
	const readiness = createRailProjectReadiness(
		build.analysis,
		build.physical,
		build.authoredChecksum,
	);
	const placement = starterPlacementBundle(build);
	return Object.freeze({
		request: build.request,
		requestFingerprint: syntheticFabStarterRequestFingerprint(build.request),
		planFingerprint: build.planFingerprint,
		summary: build.summary,
		steps: build.steps,
		authoredChecksum: build.authoredChecksum,
		authoredRevision: build.document.map.getRevision(),
		analysisFingerprint: checksumRailNetworkAnalysis(build.analysis, build.authoredChecksum),
		physicalFingerprint: build.physicalFingerprint,
		readinessFingerprint: readiness.fingerprint,
		authoringReady: readiness.ready,
		snapshot: captureRailMirrorSnapshot(
			build.document.map,
			build.document.getPatchSequence(),
			build.document.portEquipment,
			build.document.organizations,
			build.document.relationships,
		).snapshot,
		placementBundle: placement?.bundle ?? null,
		placementBundleFingerprint: placement?.fingerprint ?? null,
		geometry:
			shouldOmitInlinePreviewGeometry(build.request.id) || build.physical.paths.pathCount === 0
				? null
				: starterPreviewGeometry(compilePhysicalRailPresentation(build.physical.paths)),
		exactGeometry:
			build.request.id === "large-fab-60" && build.physical.paths.pathCount > 0
				? captureSyntheticFabStarterRouteGeometry(
						build.physical.paths,
						build.physicalFingerprint,
						compilePhysicalRailRuns(build.physical.paths),
					)
				: null,
	});
}

function starterPlacementBundle(build: ReturnType<typeof buildSyntheticFabStarter>): Readonly<{
	bundle: StaticFabOrganizationBundle;
	fingerprint: string;
}> | null {
	if (
		build.request.id !== "paired-circulation-fab-52" &&
		build.request.id !== "full-fab-52" &&
		build.request.id !== "parallel-hall-fab-12" &&
		build.request.id !== "central-spine-fab-24" &&
		build.request.id !== "production-fab-60"
	) {
		return null;
	}
	const rootIds = build.document.organizations.records
		.filter((record) => (record.parentOrganizationIds ?? []).length === 0)
		.map((record) => record.id);
	if (rootIds.length !== 1) {
		throw new Error("A placeable FAB preset must have exactly one root organization.");
	}
	const captured = captureStaticFabOrganizationBundle(
		build.document.map,
		build.document.portEquipment,
		build.document.getPatchSequence(),
		build.document.organizations,
		rootIds,
		"EFFECTIVE",
	);
	if (!captured.valid) throw new Error(`FAB preset bundle capture failed: ${captured.reason}`);
	return Object.freeze({
		bundle: captured.bundle,
		fingerprint: staticFabOrganizationBundleFingerprint(captured.bundle),
	});
}

function shouldOmitInlinePreviewGeometry(id: SyntheticFabStarterRequest["id"]): boolean {
	return (
		id === "large-fab-60" ||
		id === "paired-circulation-fab-52" ||
		id === "full-fab-52" ||
		id === "parallel-hall-fab-12" ||
		id === "central-spine-fab-24" ||
		id === "production-fab-60"
	);
}

function starterPreviewGeometry(
	presentation: CompiledRailPresentation,
): SyntheticFabStarterPreviewGeometry {
	const source = presentation.source;
	const runs = presentation.runs;
	let pathData = "";
	for (let index = 0; index < runs.count; index++) {
		const runStart = runs.offsets[index] as number;
		const runEnd = runs.offsets[index + 1] as number;
		let move = true;
		for (let memberIndex = runStart; memberIndex < runEnd; memberIndex++) {
			const pathIndex = runs.pathIndices[memberIndex] as number;
			const pointStart = source.offsets[pathIndex] as number;
			const pointEnd = source.offsets[pathIndex + 1] as number;
			for (let pointIndex = pointStart; pointIndex < pointEnd; pointIndex++) {
				const offset = pointIndex * 2;
				pathData += `${move ? "M" : " L"} ${source.positions[offset]} ${source.positions[offset + 1]} `;
				move = false;
			}
		}
	}
	const bounds = physicalBounds(source.positions);
	const markerCandidates: Array<{
		x: number;
		y: number;
		angleDegrees: number;
	}> = [];
	for (let pathIndex = 0; pathIndex < source.pathCount; pathIndex++) {
		const kind = source.kinds[pathIndex] as number;
		if (kind === PATH_KIND.INVALID || kind === PATH_KIND.TERMINAL) continue;
		const length = source.lengths[pathIndex] as number;
		if (length <= 0.001) continue;
		const sample = samplePhysicalPath(source, pathIndex, length / 2);
		if (!sample) continue;
		markerCandidates.push({
			x: sample.x,
			y: sample.y,
			angleDegrees: (Math.atan2(sample.tangentY, sample.tangentX) * 180) / Math.PI,
		});
	}
	const markerStep = Math.max(1, Math.ceil(markerCandidates.length / 18));
	const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
	return Object.freeze({
		bounds,
		pathData: pathData.trim(),
		markers: Object.freeze(
			markerCandidates.filter((_, index) => index % markerStep === 0).slice(0, 18),
		),
		markerScale: Math.max(0.7, Math.min(2.8, extent * 0.018)),
	});
}

function physicalBounds(positions: Float32Array): SyntheticFabStarterPreviewGeometry["bounds"] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < positions.length; index += 2) {
		const x = positions[index] as number;
		const y = positions[index + 1] as number;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return Object.freeze({ minX, minY, maxX, maxY });
}
