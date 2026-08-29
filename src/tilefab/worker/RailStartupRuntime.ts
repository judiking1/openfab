import { compilePhysicalPathCellIndex } from "../compile/PhysicalPathLookup";
import { compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { resolvePortAttachment } from "../compile/PortAttachmentResolver";
import {
	checksumPortSlotPreparedArtifactCatalog,
	compilePortSlotPreparedArtifactCatalog,
	portSlotPreparedArtifactCatalogMatch,
} from "../compile/PortSlotPreparedArtifacts";
import {
	checksumRailDraftPreparedArtifacts,
	compileRailDraftPreparedArtifacts,
	railDraftPreparedArtifactsMatch,
} from "../compile/RailDraftPreparedArtifacts";
import { createRailProjectReadiness } from "../compile/RailProjectReadiness";
import { analyzeRailNetwork, checksumRailNetworkAnalysis } from "../core/network";
import { emptyOperationalConfigurationState } from "../core/OperationalConfiguration";
import { assertPortEquipmentLayout } from "../core/PortEquipmentLayoutValidator";
import type { RailDocument } from "../core/RailDocument";
import {
	buildRailModuleOwnershipIndex,
	checksumRailModuleOwnershipSnapshot,
} from "../core/RailModuleOwnership";
import { createEmptyOpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import {
	createRailSnapshotFromOpenFabProject,
	OPENFAB_PROJECT_SCHEMA_VERSION,
	type OpenFabProjectManifest,
} from "../project/OpenFabProject";
import {
	type OpenFabProjectParseResult,
	parseOpenFabProjectJson,
	validateOpenFabProjectManifest,
} from "../project/OpenFabProjectCodec";
import {
	checksumPhysicalRailRenderArtifacts,
	compilePhysicalRailRenderArtifacts,
	physicalRailRenderArtifactsMatch,
} from "../render/PhysicalRailRenderArtifacts";
import { captureRailMirrorSnapshot, type RailMirrorSnapshot } from "./RailMirrorChecksum";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";
import {
	checksumRailPhysicalLayout,
	validateRailPhysicalLayoutContract,
} from "./RailPhysicalLayout";
import {
	createRailEquipmentScaleProbeDocument,
	createRailScaleProbeDocument,
} from "./RailStartupFixture";
import type {
	RailStartupPayload,
	RailStartupSource,
	RailStartupTimings,
} from "./RailStartupProtocol";
import { RAIL_STARTUP_SCHEMA_VERSION } from "./RailStartupProtocol";
import { checksumRailStartupPlainMetadata } from "./RailStartupTransportContract";

export type RailStartupClock = () => number;

interface ResolvedRailStartupSource {
	readonly document: RailDocument;
	readonly projectParse: OpenFabProjectParseResult | null;
	readonly projectManifest: OpenFabProjectManifest | null;
}

/** Pure one-shot compiler used inside the disposable startup Worker. */
export function compileRailStartup(
	source: RailStartupSource,
	now: RailStartupClock = () => performance.now(),
): RailStartupPayload {
	const totalStartedAt = now();
	const sourceMeasurement = measure(now, () => resolveSourceDocument(source));
	const document = sourceMeasurement.value.document;
	const snapshotMeasurement = measure(now, () =>
		captureRailMirrorSnapshot(
			document.map,
			document.getPatchSequence(),
			document.portEquipment,
			document.organizations,
		),
	);
	const authoredChecksum = snapshotMeasurement.value.snapshot.checksum;
	const analysisMeasurement = measure(now, () => analyzeRailNetwork(document.map));
	const ownershipMeasurement = measure(now, () =>
		buildRailModuleOwnershipIndex(document.map).captureSnapshot(),
	);
	const physicalMeasurement = measure(now, () => compilePhysicalRail(document.map));
	if (!physicalMeasurement.value.valid) {
		const first = physicalMeasurement.value.diagnostics[0];
		throw new Error(
			first
				? `Rail startup source is not a valid authored map: ${first.code} at ${first.cell.x},${first.cell.y}: ${first.message}`
				: "Rail startup source is not a valid authored map.",
		);
	}
	const readinessMeasurement = measure(now, () =>
		createRailProjectReadiness(
			analysisMeasurement.value,
			physicalMeasurement.value,
			authoredChecksum,
		),
	);
	const interactionArtifactsMeasurement = measure(now, () => {
		const cellIndex = compilePhysicalPathCellIndex(physicalMeasurement.value.paths);
		const render = compilePhysicalRailRenderArtifacts(physicalMeasurement.value.paths, cellIndex);
		return {
			render,
			draft: compileRailDraftPreparedArtifacts(
				physicalMeasurement.value,
				cellIndex,
				render.adjacency,
			),
		};
	});
	const portSlotArtifactsMeasurement = measure(now, () =>
		compilePortSlotPreparedArtifactCatalog(physicalMeasurement.value),
	);
	const validationMeasurement = measure(now, () => {
		validateRailPhysicalLayoutContract(physicalMeasurement.value);
		assertPortEquipmentLayout(document.map, document.portEquipment);
		for (const port of document.portEquipment.ports) {
			const attachment = resolvePortAttachment(physicalMeasurement.value, port);
			if (!attachment.ok) {
				throw new Error(
					`Port ${port.id} attachment is invalid (${attachment.code}): ${attachment.message}`,
				);
			}
		}
		if (
			physicalMeasurement.value.revision !== snapshotMeasurement.value.snapshot.revision ||
			ownershipMeasurement.value.revision !== snapshotMeasurement.value.snapshot.revision ||
			!physicalRailRenderArtifactsMatch(
				physicalMeasurement.value.paths,
				interactionArtifactsMeasurement.value.render,
			) ||
			!railDraftPreparedArtifactsMatch(
				physicalMeasurement.value,
				interactionArtifactsMeasurement.value.draft,
			) ||
			!portSlotPreparedArtifactCatalogMatch(
				physicalMeasurement.value,
				portSlotArtifactsMeasurement.value,
			)
		) {
			throw new Error("Startup derived revisions do not match the authored snapshot.");
		}
	});
	const fingerprintMeasurement = measure(now, () => {
		const analysis = checksumRailNetworkAnalysis(analysisMeasurement.value, authoredChecksum);
		const ownership = checksumRailModuleOwnershipSnapshot(
			ownershipMeasurement.value,
			authoredChecksum,
		);
		const physical = checksumRailPhysicalLayout(physicalMeasurement.value);
		return {
			analysis,
			ownership,
			physical,
			plainMetadata: checksumRailStartupPlainMetadata(
				physicalMeasurement.value,
				readinessMeasurement.value,
			),
			render: checksumPhysicalRailRenderArtifacts(
				interactionArtifactsMeasurement.value.render,
				physical,
			),
			draft: checksumRailDraftPreparedArtifacts(
				interactionArtifactsMeasurement.value.draft,
				physical,
			),
			portSlots: checksumPortSlotPreparedArtifactCatalog(
				portSlotArtifactsMeasurement.value,
				physical,
			),
		};
	});
	const timings: RailStartupTimings = Object.freeze({
		sourceMilliseconds: sourceMeasurement.duration,
		snapshotMilliseconds: snapshotMeasurement.duration,
		analysisMilliseconds: analysisMeasurement.duration,
		ownershipMilliseconds: ownershipMeasurement.duration,
		physicalMilliseconds: physicalMeasurement.duration,
		readinessMilliseconds: readinessMeasurement.duration,
		interactionArtifactsMilliseconds: interactionArtifactsMeasurement.duration,
		portSlotArtifactsMilliseconds: portSlotArtifactsMeasurement.duration,
		validationMilliseconds: validationMeasurement.duration,
		fingerprintMilliseconds: fingerprintMeasurement.duration,
		totalMilliseconds: Math.max(0, now() - totalStartedAt),
	});
	const {
		analysis: analysisFingerprint,
		ownership: ownershipFingerprint,
		physical: physicalFingerprint,
		plainMetadata: plainMetadataFingerprint,
		render: renderArtifactFingerprint,
		draft: draftArtifactFingerprint,
		portSlots: portSlotArtifactFingerprint,
	} = fingerprintMeasurement.value;
	return Object.freeze({
		schemaVersion: RAIL_STARTUP_SCHEMA_VERSION,
		source: describeSource(source, sourceMeasurement.value, snapshotMeasurement.value.snapshot),
		authoredChecksum,
		plainMetadataFingerprint,
		snapshot: snapshotMeasurement.value.snapshot,
		analysis: Object.freeze({
			authoredChecksum,
			fingerprint: analysisFingerprint,
			value: analysisMeasurement.value,
		}),
		ownership: Object.freeze({
			authoredChecksum,
			fingerprint: ownershipFingerprint,
			value: ownershipMeasurement.value,
		}),
		physical: Object.freeze({
			authoredChecksum,
			fingerprint: physicalFingerprint,
			value: physicalMeasurement.value,
		}),
		readiness: Object.freeze({
			authoredChecksum,
			physicalFingerprint,
			fingerprint: readinessMeasurement.value.fingerprint,
			value: readinessMeasurement.value,
		}),
		renderArtifacts: Object.freeze({
			authoredChecksum,
			physicalFingerprint,
			artifactFingerprint: renderArtifactFingerprint,
			value: interactionArtifactsMeasurement.value.render,
		}),
		draftArtifacts: Object.freeze({
			authoredChecksum,
			physicalFingerprint,
			artifactFingerprint: draftArtifactFingerprint,
			value: interactionArtifactsMeasurement.value.draft,
		}),
		portSlotArtifacts: Object.freeze({
			authoredChecksum,
			physicalFingerprint,
			artifactFingerprint: portSlotArtifactFingerprint,
			value: portSlotArtifactsMeasurement.value,
		}),
		timings,
	});
}

function resolveSourceDocument(source: RailStartupSource): ResolvedRailStartupSource {
	if (source.kind === "scale-probe") {
		let document: RailDocument;
		if (source.equipmentPortCount === undefined) {
			document = createRailScaleProbeDocument(source.cellCount, source.rootCount);
		} else {
			if (source.rootCount !== undefined && source.rootCount !== 1) {
				throw new Error("Equipment scale probe requires exactly one rail root.");
			}
			if (source.cellCount !== source.equipmentPortCount) {
				throw new Error("Equipment scale probe requires one rail cell per port.");
			}
			document = createRailEquipmentScaleProbeDocument(source.equipmentPortCount);
		}
		return Object.freeze({
			document,
			projectParse: null,
			projectManifest: null,
		});
	}
	if (source.kind === "project-json") {
		const projectParse = parseOpenFabProjectJson(source.json);
		return Object.freeze({
			document: hydrateRailMirrorSnapshotDocument(
				createRailSnapshotFromOpenFabProject(projectParse.project),
			),
			projectParse,
			projectManifest: null,
		});
	}
	if (source.kind === "project-snapshot") {
		return Object.freeze({
			document: hydrateRailMirrorSnapshotDocument(source.snapshot),
			projectParse: null,
			projectManifest: validateOpenFabProjectManifest(source.manifest),
		});
	}
	return Object.freeze({
		document: hydrateRailMirrorSnapshotDocument(source.snapshot),
		projectParse: null,
		projectManifest: null,
	});
}

function describeSource(
	source: RailStartupSource,
	resolved: ResolvedRailStartupSource,
	snapshot: RailMirrorSnapshot,
): RailStartupPayload["source"] {
	if (source.kind === "scale-probe") return Object.freeze({ ...source });
	if (source.kind === "project-json") {
		const projectParse = resolved.projectParse;
		if (!projectParse) throw new Error("Rail project startup metadata is missing.");
		return Object.freeze({
			kind: "project",
			manifest: projectParse.project.manifest,
			view: projectParse.project.view,
			blueprints: projectParse.project.blueprints,
			operations: projectParse.project.operations,
			schemaVersion: projectParse.project.schemaVersion,
			migratedFromVersion: projectParse.migratedFromVersion,
			sequence: snapshot.sequence,
			revision: snapshot.revision,
			checksum: snapshot.checksum,
		});
	}
	if (source.kind === "project-snapshot") {
		const manifest = resolved.projectManifest;
		if (!manifest) throw new Error("Rail project snapshot startup metadata is missing.");
		return Object.freeze({
			kind: "project",
			manifest,
			view: null,
			blueprints: createEmptyOpenFabProjectBlueprintSection(),
			operations: emptyOperationalConfigurationState(),
			schemaVersion: OPENFAB_PROJECT_SCHEMA_VERSION,
			migratedFromVersion: null,
			sequence: snapshot.sequence,
			revision: snapshot.revision,
			checksum: snapshot.checksum,
		});
	}
	return Object.freeze({
		kind: "snapshot",
		sequence: snapshot.sequence,
		revision: snapshot.revision,
		checksum: snapshot.checksum,
	});
}

function measure<Result>(
	now: RailStartupClock,
	operation: () => Result,
): { readonly value: Result; readonly duration: number } {
	const startedAt = now();
	const value = operation();
	return { value, duration: Math.max(0, now() - startedAt) };
}
