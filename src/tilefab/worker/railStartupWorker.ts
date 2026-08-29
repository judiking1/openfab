import type { MainToRailStartupMessage, RailStartupToMainMessage } from "./RailStartupProtocol";
import { compileRailStartup } from "./RailStartupRuntime";
import { collectTransferableBuffers } from "./TransferableBuffers";

self.onmessage = (event: MessageEvent<MainToRailStartupMessage>): void => {
	const request = event.data;
	if (request.type !== "LOAD_RAIL_STARTUP") return;
	try {
		const payload = compileRailStartup(request.source);
		const message: RailStartupToMainMessage = {
			type: "RAIL_STARTUP_READY",
			requestId: request.requestId,
			payload,
		};
		self.postMessage(message, { transfer: collectTransferableBuffers(payload) });
	} catch (error) {
		const message: RailStartupToMainMessage = {
			type: "RAIL_STARTUP_ERROR",
			requestId: request.requestId,
			message: error instanceof Error ? error.message : "Unknown rail startup Worker error.",
		};
		self.postMessage(message);
	}
};
