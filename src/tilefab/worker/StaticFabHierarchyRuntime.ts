import { compileStaticFabHierarchyIndex } from "../compile/StaticFabHierarchy";
import { captureStaticFabHierarchyIndexSnapshot } from "../compile/StaticFabHierarchySnapshot";
import { buildRailModuleOwnershipIndex } from "../core/RailModuleOwnership";
import type {
	PreparedStaticFabHierarchy,
	PrepareStaticFabHierarchyRequest,
} from "./StaticFabHierarchyProtocol";
import { hydrateRailMirrorSnapshotDocument } from "./RailMirrorSnapshotDocument";

export type StaticFabHierarchyClock = () => number;

/** Factory-wide hierarchy inference. Production calls this only inside its disposable Worker. */
export function prepareStaticFabHierarchy(
	request: PrepareStaticFabHierarchyRequest,
	now: StaticFabHierarchyClock = () => performance.now(),
): PreparedStaticFabHierarchy {
	const startedAt = now();
	const document = hydrateRailMirrorSnapshotDocument(request.snapshot);
	const ownership = buildRailModuleOwnershipIndex(document.map);
	const index = compileStaticFabHierarchyIndex(document.map, ownership);
	return Object.freeze({
		sourceRevision: request.snapshot.revision,
		sourceChecksum: request.snapshot.checksum,
		hierarchySnapshot: captureStaticFabHierarchyIndexSnapshot(index, ownership),
		preparationMilliseconds: now() - startedAt,
	});
}
