import { validateAdvancedSwitchTopology } from "../core/AdvancedSwitch";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { RailDocument } from "../core/RailDocument";
import type { StaticFabOrganizationState } from "../core/StaticFabOrganization";
import type { StaticFabOrganizationDiagnosticState } from "../core/StaticFabOrganizationIssues";
import { TileMap } from "../core/TileMap";
import {
	readAdvancedSwitchRecord,
	validateAdvancedSwitchRecordFieldLengths,
} from "./AdvancedSwitchSoA";
import { hydratePortEquipmentSnapshotRecords } from "./PortEquipmentSoA";
import {
	assertInt32Coordinate,
	checksumRailMirrorSnapshotDiagnostic,
	type RailMirrorSnapshot,
} from "./RailMirrorChecksum";
import {
	hydrateStaticFabOrganizationDiagnosticSnapshot,
	hydrateStaticFabOrganizationSnapshot,
} from "./StaticFabOrganizationSoA";

export interface RailMirrorDiagnosticSource {
	readonly map: TileMap;
	readonly sequence: number;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationDiagnosticState;
}

/**
 * Hydrate checksum-verified records for read-only diagnostics without activating an invalid document.
 * Individual record encoding remains strict; cross-record/map invariants are left to typed collectors.
 */
export function hydrateRailMirrorSnapshotDiagnosticSource(
	snapshot: RailMirrorSnapshot,
): RailMirrorDiagnosticSource {
	if (checksumRailMirrorSnapshotDiagnostic(snapshot) !== snapshot.checksum) {
		throw new Error("Rail snapshot source checksum does not match its typed buffers.");
	}
	if (!Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 0) {
		throw new Error("Rail snapshot source sequence is invalid.");
	}
	if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
		throw new Error("Rail snapshot source revision is invalid.");
	}
	if (!Number.isSafeInteger(snapshot.nextAdvancedSwitchId) || snapshot.nextAdvancedSwitchId < 1) {
		throw new Error("Rail snapshot source advanced switch cursor is invalid.");
	}
	validateAdvancedSwitchRecordFieldLengths(
		snapshot.switchRecords,
		snapshot.switchIds.length,
		"Rail snapshot source",
	);
	const hydrator = TileMap.createHydrator();
	for (let index = 0; index < snapshot.encoded.length; index++) {
		const x = snapshot.xs[index] as number;
		const y = snapshot.ys[index] as number;
		const encoded = snapshot.encoded[index] as number;
		assertInt32Coordinate(x, "snapshot x");
		assertInt32Coordinate(y, "snapshot y");
		hydrator.addEncodedCell(x, y, encoded);
	}
	for (let index = 0; index < snapshot.switchIds.length; index++) {
		const id = snapshot.switchIds[index] as number;
		hydrator.addAdvancedSwitch(
			readAdvancedSwitchRecord(snapshot.switchRecords, index, id, `Rail snapshot switch ${id}`),
		);
	}
	const map = hydrator.finish(snapshot.revision, snapshot.nextAdvancedSwitchId);
	return Object.freeze({
		map,
		sequence: snapshot.sequence,
		portEquipment: hydratePortEquipmentSnapshotRecords(snapshot.portEquipment),
		organizations: hydrateStaticFabOrganizationDiagnosticSnapshot(snapshot.organizations),
	});
}

/** Hydrate one validated authored document from the platform-neutral Worker snapshot contract. */
export function hydrateRailMirrorSnapshotDocument(snapshot: RailMirrorSnapshot): RailDocument {
	const source = hydrateRailMirrorSnapshotDiagnosticSource(snapshot);
	const organizations: StaticFabOrganizationState = hydrateStaticFabOrganizationSnapshot(
		snapshot.organizations,
	);
	let topologyError: string | null = null;
	source.map.forEachAdvancedSwitch((record) => {
		const issue = validateAdvancedSwitchTopology((x, y) => source.map.getEncoded(x, y), record)[0];
		if (!topologyError && issue) topologyError = issue.message;
	});
	if (topologyError) {
		throw new Error(`Rail snapshot source switch topology is invalid: ${topologyError}`);
	}
	return RailDocument.fromLoadedMap(
		source.map,
		source.sequence,
		source.portEquipment,
		organizations,
	);
}
