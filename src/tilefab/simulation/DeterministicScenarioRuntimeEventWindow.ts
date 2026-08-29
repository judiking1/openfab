import type {
	SimulationReplayHistoryRecord,
	SimulationScenarioManifest,
	SimulationTransferPlanRecord,
} from "../compile/SimulationScenarioManifest";
import type { DeterministicScenarioEvent } from "./DeterministicScenarioAdmissionCore";
import type { DeterministicScenarioResourceEvent } from "./DeterministicScenarioResourceState";

export const DETERMINISTIC_SCENARIO_RUNTIME_EVENT_WINDOW_MAXIMUM_PER_STREAM = 6;

export interface DeterministicScenarioRuntimeEventSource {
	readonly eventCount: number;
	readonly resourceEventCount: number;
	eventAt(index: number): DeterministicScenarioEvent;
	resourceEventAt(index: number): DeterministicScenarioResourceEvent;
}

interface DeterministicScenarioRuntimeEventRecordIdentity {
	readonly requestRow: number;
	readonly recordId: string;
	readonly loadId: string;
	readonly sourcePortId: number;
	readonly destinationPortId: number;
}

export interface DeterministicScenarioRuntimeCoreEventRow
	extends DeterministicScenarioRuntimeEventRecordIdentity {
	readonly sequence: number;
	readonly timeMicroseconds: number;
	readonly type: DeterministicScenarioEvent["type"];
	readonly vehicleTokenId: number;
	readonly loadRow: number;
}

export interface DeterministicScenarioRuntimeResourceEventRow
	extends DeterministicScenarioRuntimeEventRecordIdentity {
	readonly sequence: number;
	readonly timeMicroseconds: number;
	readonly type: DeterministicScenarioResourceEvent["type"];
	readonly loadRow: number;
	readonly resourceRow: number;
}

export interface DeterministicScenarioRuntimeEventWindow {
	readonly sourceKind: SimulationScenarioManifest["sourceKind"];
	readonly coreEventCount: number;
	readonly coreStartIndex: number;
	readonly resourceEventCount: number;
	readonly resourceStartIndex: number;
	readonly coreRows: readonly DeterministicScenarioRuntimeCoreEventRow[];
	readonly resourceRows: readonly DeterministicScenarioRuntimeResourceEventRow[];
}

/**
 * Copy only the tail of each canonical event stream. Core and resource rows stay separate because
 * their independently ordered logs do not claim a synthetic cross-stream tie order.
 */
export function selectDeterministicScenarioRuntimeEventWindow(
	source: DeterministicScenarioRuntimeEventSource,
	manifest: SimulationScenarioManifest,
): DeterministicScenarioRuntimeEventWindow {
	assertEventCount(source.eventCount, "core");
	assertEventCount(source.resourceEventCount, "resource");
	const coreStartIndex = Math.max(
		0,
		source.eventCount - DETERMINISTIC_SCENARIO_RUNTIME_EVENT_WINDOW_MAXIMUM_PER_STREAM,
	);
	const resourceStartIndex = Math.max(
		0,
		source.resourceEventCount - DETERMINISTIC_SCENARIO_RUNTIME_EVENT_WINDOW_MAXIMUM_PER_STREAM,
	);
	const coreRows: DeterministicScenarioRuntimeCoreEventRow[] = [];
	for (let index = coreStartIndex; index < source.eventCount; index++) {
		const event = source.eventAt(index);
		const identity = recordIdentity(manifest, event.requestRow);
		coreRows.push(
			Object.freeze({
				...identity,
				sequence: event.sequence,
				timeMicroseconds: event.timeMicroseconds,
				type: event.type,
				vehicleTokenId: event.vehicleTokenId,
				loadRow: event.loadRow,
			}),
		);
	}
	const resourceRows: DeterministicScenarioRuntimeResourceEventRow[] = [];
	for (let index = resourceStartIndex; index < source.resourceEventCount; index++) {
		const event = source.resourceEventAt(index);
		const identity = recordIdentity(manifest, event.requestRow);
		resourceRows.push(
			Object.freeze({
				...identity,
				sequence: index + 1,
				timeMicroseconds: event.timeMicroseconds,
				type: event.type,
				loadRow: event.loadRow,
				resourceRow: event.resourceRow,
			}),
		);
	}
	return Object.freeze({
		sourceKind: manifest.sourceKind,
		coreEventCount: source.eventCount,
		coreStartIndex,
		resourceEventCount: source.resourceEventCount,
		resourceStartIndex,
		coreRows: Object.freeze(coreRows),
		resourceRows: Object.freeze(resourceRows),
	});
}

function recordIdentity(
	manifest: SimulationScenarioManifest,
	requestRow: number,
): DeterministicScenarioRuntimeEventRecordIdentity {
	if (!Number.isSafeInteger(requestRow) || requestRow < 0) {
		throw new Error("Scenario runtime event request row is invalid.");
	}
	const record = manifest.records[requestRow];
	if (!record) throw new Error(`Scenario runtime event request row ${requestRow} is unavailable.`);
	return Object.freeze({
		requestRow,
		recordId:
			manifest.sourceKind === "TRANSFER_PLAN"
				? (record as SimulationTransferPlanRecord).transferId
				: (record as SimulationReplayHistoryRecord).historyEventId,
		loadId: record.loadId,
		sourcePortId: record.sourcePortId,
		destinationPortId: record.destinationPortId,
	});
}

function assertEventCount(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`Scenario runtime ${label} event count is invalid.`);
	}
}
