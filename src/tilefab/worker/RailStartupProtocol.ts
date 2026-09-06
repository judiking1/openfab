import type { CompiledPhysicalLayout } from "../compile/PhysicalRailCompiler";
import type { PortSlotPreparedArtifactCatalog } from "../compile/PortSlotPreparedArtifacts";
import type { RailDraftPreparedArtifacts } from "../compile/RailDraftPreparedArtifacts";
import type { RailProjectReadiness } from "../compile/RailProjectReadiness";
import type { RailNetworkAnalysis } from "../core/network";
import type { OperationalConfigurationState } from "../core/OperationalConfiguration";
import type { RailModuleOwnershipIndexSnapshot } from "../core/RailModuleOwnership";
import type { OpenFabProjectBlueprintSection } from "../project/OpenFabBlueprintLibrary";
import type {
	OPENFAB_PROJECT_SCHEMA_VERSION,
	OpenFabProjectManifest,
	OpenFabProjectView,
} from "../project/OpenFabProject";
import type { CompiledPhysicalRailRenderArtifacts } from "../render/PhysicalRailRenderArtifacts";
import type { RailMirrorSnapshot } from "./RailMirrorChecksum";

/** Worker-to-main startup payload contract. Bump whenever a required wire field changes. */
export const RAIL_STARTUP_SCHEMA_VERSION = 22;
/** Public browser scale acceptance contract; intentionally independent from the wire schema. */
export const RAIL_SCALE_ACCEPTANCE_VERSION = 18;
export const RAIL_ASSEMBLY_CONNECTOR_SCALE_PROBE_CELLS = 100_001;
export const RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS = 100_002;
export const RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS = 100_004;
export const RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_TARGET_BAY_ID = 1;
export const RAIL_BAY_FLOW_EDIT_SCALE_PROBE_ROOT_COUNT = 3 as const;
export const RAIL_BAY_FLOW_EDIT_SCALE_PROBE_TARGET_BAY_ID = 1;

/** Public-safe v18 sidecar contract layered onto the existing 100,002-cell Delete fixture. */
export const RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_METADATA = Object.freeze({
	cellCount: RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_CELLS,
	rootCount: 2 as const,
	targetBayOrganizationId: RAIL_SEMANTIC_BAY_DELETE_SCALE_PROBE_TARGET_BAY_ID,
	sourcePortCount: 5,
	sourceEquipmentGroupCount: 4,
	deletedPortIds: Object.freeze([1, 2, 3, 4]),
	deletedEquipmentGroupIds: Object.freeze([1, 2, 3]),
	deletedEquipmentKinds: Object.freeze(["EQ", "OHB", "STK"] as const),
	bayEquipmentGroupIds: Object.freeze([2]),
	processLoopOrganizationId: 2,
	processLoopEquipmentGroupIds: Object.freeze([1, 3]),
	retainedPortIds: Object.freeze([5]),
	retainedEquipmentGroupIds: Object.freeze([4]),
	nextPortId: 6,
	nextEquipmentGroupId: 5,
});

/** Public-safe, deterministic browser acceptance contract for exact Twin Bay flow replacement. */
export const RAIL_BAY_FLOW_EDIT_SCALE_PROBE_METADATA = Object.freeze({
	cellCount: RAIL_BAY_FLOW_EDIT_SCALE_PROBE_CELLS,
	rootCount: RAIL_BAY_FLOW_EDIT_SCALE_PROBE_ROOT_COUNT,
	authoredEdgeCount: 100_008,
	physicalPathCount: 100_012,
	organizationCount: 3,
	weakComponentCount: 2,
	strongComponentCount: 2,
	targetBayOrganizationId: RAIL_BAY_FLOW_EDIT_SCALE_PROBE_TARGET_BAY_ID,
	sourceInternalFlowPattern: "alternating" as const,
	targetInternalFlowPattern: "co-rotating" as const,
});

export interface RailScaleProbeStartupSource {
	readonly kind: "scale-probe";
	readonly cellCount: number;
	readonly rootCount?: 1 | 2 | 3 | 4;
	/** Exact public-safe OHB population used only by the serialized 3D browser scale gate. */
	readonly equipmentPortCount?: number;
}

export interface RailSnapshotStartupSource {
	readonly kind: "snapshot";
	readonly snapshot: RailMirrorSnapshot;
}

export interface RailProjectJsonStartupSource {
	readonly kind: "project-json";
	readonly json: string;
}

/** Internal fast path for a newly-created project whose authored snapshot is already certified. */
export interface RailProjectSnapshotStartupSource {
	readonly kind: "project-snapshot";
	readonly snapshot: RailMirrorSnapshot;
	readonly manifest: OpenFabProjectManifest;
}

export type RailStartupSource =
	| RailScaleProbeStartupSource
	| RailSnapshotStartupSource
	| RailProjectSnapshotStartupSource
	| RailProjectJsonStartupSource;

export type RailStartupPayloadSource =
	| RailScaleProbeStartupSource
	| {
			readonly kind: "snapshot";
			readonly sequence: number;
			readonly revision: number;
			readonly checksum: string;
	  }
	| {
			readonly kind: "project";
			readonly manifest: OpenFabProjectManifest;
			readonly view: OpenFabProjectView | null;
			readonly blueprints: OpenFabProjectBlueprintSection;
			readonly operations: OperationalConfigurationState;
			readonly schemaVersion: typeof OPENFAB_PROJECT_SCHEMA_VERSION;
			readonly migratedFromVersion: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | null;
			readonly sequence: number;
			readonly revision: number;
			readonly checksum: string;
	  };

export interface RailStartupTimings {
	readonly sourceMilliseconds: number;
	readonly snapshotMilliseconds: number;
	readonly analysisMilliseconds: number;
	readonly ownershipMilliseconds: number;
	readonly physicalMilliseconds: number;
	readonly readinessMilliseconds: number;
	readonly interactionArtifactsMilliseconds: number;
	readonly portSlotArtifactsMilliseconds: number;
	readonly validationMilliseconds: number;
	readonly fingerprintMilliseconds: number;
	readonly totalMilliseconds: number;
}

export interface RailStartupPayload {
	readonly schemaVersion: typeof RAIL_STARTUP_SCHEMA_VERSION;
	readonly source: RailStartupPayloadSource;
	readonly authoredChecksum: string;
	/**
	 * Supplemental digest for plain physical metadata and readiness issue details omitted from the
	 * bulk typed artifact fingerprints. Cross-artifact aliases are still checked by identity.
	 */
	readonly plainMetadataFingerprint: string;
	readonly snapshot: RailMirrorSnapshot;
	readonly analysis: RailStartupFingerprintedBoundValue<RailNetworkAnalysis>;
	readonly ownership: RailStartupFingerprintedBoundValue<RailModuleOwnershipIndexSnapshot>;
	readonly physical: RailStartupBoundValue<CompiledPhysicalLayout> & {
		readonly fingerprint: string;
	};
	readonly readiness: RailStartupFingerprintedBoundValue<RailProjectReadiness> & {
		readonly physicalFingerprint: string;
	};
	readonly renderArtifacts: RailStartupPhysicalBoundValue<CompiledPhysicalRailRenderArtifacts>;
	readonly draftArtifacts: RailStartupPhysicalBoundValue<RailDraftPreparedArtifacts>;
	readonly portSlotArtifacts: RailStartupPhysicalBoundValue<PortSlotPreparedArtifactCatalog>;
	readonly timings: RailStartupTimings;
}

export interface RailStartupBoundValue<Value> {
	readonly authoredChecksum: string;
	readonly value: Value;
}

export interface RailStartupFingerprintedBoundValue<Value> extends RailStartupBoundValue<Value> {
	readonly fingerprint: string;
}

export interface RailStartupPhysicalBoundValue<Value> extends RailStartupBoundValue<Value> {
	readonly physicalFingerprint: string;
	readonly artifactFingerprint: string;
}

export type MainToRailStartupMessage = {
	readonly type: "LOAD_RAIL_STARTUP";
	readonly requestId: number;
	readonly source: RailStartupSource;
};

export type RailStartupToMainMessage =
	| {
			readonly type: "RAIL_STARTUP_READY";
			readonly requestId: number;
			readonly payload: RailStartupPayload;
	  }
	| {
			readonly type: "RAIL_STARTUP_ERROR";
			readonly requestId: number;
			readonly message: string;
	  };
