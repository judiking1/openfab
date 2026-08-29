import { RailMirrorWorkerRuntime } from "./RailMirrorWorkerRuntime";
import {
	type MainToRailMirrorMessage,
	type RailMirrorToMainMessage,
	railMirrorSnapshotTransfers,
	staticFabOrganizationOutlineTransfers,
} from "./railMirrorProtocol";

const runtime = new RailMirrorWorkerRuntime();

self.onmessage = (event: MessageEvent<MainToRailMirrorMessage>): void => {
	const response = runtime.handle(event.data);
	if (response) post(response);
};

function post(message: RailMirrorToMainMessage): void {
	const transfer =
		message.type === "RAIL_SNAPSHOT_CAPTURED"
			? railMirrorSnapshotTransfers(message.snapshot)
			: message.type === "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED"
				? staticFabOrganizationOutlineTransfers(message.outline)
				: [];
	self.postMessage(message, transfer);
}
