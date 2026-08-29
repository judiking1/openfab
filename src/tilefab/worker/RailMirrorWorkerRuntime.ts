import {
	checksumOperationalConfigurationState,
	copyOperationalConfigurationState,
} from "../core/OperationalConfiguration";
import { RailPatchMirror, RailPhysicalPublicationError } from "./RailPatchMirror";
import { describeRailPhysicalPublication } from "./RailPhysicalLayout";
import {
	decodeRailPatchSoA,
	type MainToRailMirrorMessage,
	type RailMirrorToMainMessage,
} from "./railMirrorProtocol";

/** Synchronous worker protocol state machine shared by production worker wiring and tests. */
export class RailMirrorWorkerRuntime {
	private activeEpochValue = 0;
	private terminalErrorLatched = false;
	private readonly mirror: RailPatchMirror;

	constructor(mirror: RailPatchMirror = new RailPatchMirror()) {
		this.mirror = mirror;
	}

	get activeEpoch(): number {
		return this.activeEpochValue;
	}

	get physicalPublication() {
		return this.mirror.getPhysicalPublication();
	}

	get mirrorState() {
		return this.mirror.state;
	}

	handle(message: MainToRailMirrorMessage): RailMirrorToMainMessage | null {
		if (this.terminalErrorLatched) return null;
		if (message.type === "SYNC_RAIL") return this.handleSync(message);
		if (message.type === "CAPTURE_RAIL_SNAPSHOT") return this.handleSnapshotCapture(message);
		if (message.type === "CAPTURE_STATIC_FAB_ORGANIZATION_OUTLINE") {
			return this.handleOrganizationOutlineCapture(message);
		}
		return this.handlePatch(message);
	}

	private handleOrganizationOutlineCapture(
		message: Extract<MainToRailMirrorMessage, { type: "CAPTURE_STATIC_FAB_ORGANIZATION_OUTLINE" }>,
	): RailMirrorToMainMessage {
		const fail = (reason: string): RailMirrorToMainMessage => ({
			type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURE_FAILED",
			epoch: message.epoch,
			requestId: message.requestId,
			message: reason,
		});
		if (!Number.isSafeInteger(message.requestId) || message.requestId <= 0) {
			return fail("Static FAB organization outline request ID is invalid.");
		}
		let source: ReturnType<RailPatchMirror["getOrganizationOutlineSourceIdentity"]>;
		try {
			source = this.mirror.getOrganizationOutlineSourceIdentity();
		} catch {
			return fail("Rail mirror is not synchronized for organization outline capture.");
		}
		if (
			message.epoch !== this.activeEpochValue ||
			message.expectedSequence !== source.sequence ||
			message.expectedRevision !== source.revision ||
			message.expectedChecksum !== source.checksum ||
			message.expectedNextAdvancedSwitchId !== source.nextAdvancedSwitchId ||
			message.expectedNextPortId !== source.nextPortId ||
			message.expectedNextEquipmentGroupId !== source.nextEquipmentGroupId ||
			message.expectedNextOrganizationId !== source.nextOrganizationId ||
			message.expectedPhysicalSequence !== source.physicalSequence ||
			message.expectedPhysicalRevision !== source.physicalRevision ||
			message.expectedPhysicalFingerprint !== source.physicalFingerprint
		) {
			return fail(
				"Static FAB organization outline request does not match the synchronized mirror identity.",
			);
		}
		try {
			const outline = this.mirror.captureOrganizationOutline();
			return {
				type: "STATIC_FAB_ORGANIZATION_OUTLINE_CAPTURED",
				epoch: message.epoch,
				requestId: message.requestId,
				outline,
			};
		} catch (error) {
			return fail(errorMessage(error));
		}
	}

	private handleSnapshotCapture(
		message: Extract<MainToRailMirrorMessage, { type: "CAPTURE_RAIL_SNAPSHOT" }>,
	): RailMirrorToMainMessage {
		const state = this.mirror.state;
		const fail = (reason: string): RailMirrorToMainMessage => ({
			type: "RAIL_SNAPSHOT_CAPTURE_FAILED",
			epoch: message.epoch,
			requestId: message.requestId,
			message: reason,
		});
		if (!Number.isSafeInteger(message.requestId) || message.requestId <= 0) {
			return fail("Rail snapshot capture request ID is invalid.");
		}
		if (
			message.epoch !== this.activeEpochValue ||
			message.expectedSequence !== state.sequence ||
			message.expectedRevision !== state.revision ||
			message.expectedChecksum !== state.checksum
		) {
			return fail("Rail snapshot capture request does not match the synchronized mirror identity.");
		}
		try {
			const snapshot = this.mirror.captureSnapshot();
			if (
				snapshot.nextAdvancedSwitchId !== message.expectedNextAdvancedSwitchId ||
				snapshot.portEquipment.nextPortId !== message.expectedNextPortId ||
				snapshot.portEquipment.nextEquipmentGroupId !== message.expectedNextEquipmentGroupId ||
				snapshot.organizations.nextOrganizationId !== message.expectedNextOrganizationId
			) {
				return this.latchTerminalError(
					message.epoch,
					new Error("Rail snapshot capture cursors do not match the requested authored identity."),
				);
			}
			return {
				type: "RAIL_SNAPSHOT_CAPTURED",
				epoch: message.epoch,
				requestId: message.requestId,
				snapshot,
			};
		} catch (error) {
			return this.latchTerminalError(message.epoch, error);
		}
	}

	private handleSync(
		message: Extract<MainToRailMirrorMessage, { type: "SYNC_RAIL" }>,
	): RailMirrorToMainMessage | null {
		if (message.epoch < this.activeEpochValue) return null;
		const current = this.mirror.state;
		if (
			message.epoch === this.activeEpochValue &&
			(message.snapshot.sequence < current.sequence ||
				(message.snapshot.sequence === current.sequence &&
					message.snapshot.revision < current.revision))
		) {
			return null;
		}
		let incomingOperationalFingerprint: string;
		try {
			incomingOperationalFingerprint = checksumOperationalConfigurationState(
				copyOperationalConfigurationState(message.operationalConfiguration),
			);
		} catch (error) {
			return this.latchTerminalError(message.epoch, error);
		}
		if (
			message.epoch === this.activeEpochValue &&
			message.snapshot.sequence === current.sequence &&
			message.snapshot.revision === current.revision &&
			message.snapshot.checksum === current.checksum &&
			message.operationalConfiguration.revision === current.operationalConfigurationRevision &&
			incomingOperationalFingerprint === current.operationalConfigurationFingerprint
		) {
			return {
				type: "RAIL_SYNCED",
				epoch: this.activeEpochValue,
				...current,
				...describeRailPhysicalPublication(this.mirror.getPhysicalPublication()),
			};
		}
		try {
			const railState = this.mirror.sync(
				message.snapshot,
				message.historyLedger,
				message.operationalConfiguration,
			);
			this.activeEpochValue = message.epoch;
			return {
				type: "RAIL_SYNCED",
				epoch: message.epoch,
				...railState,
				...describeRailPhysicalPublication(this.mirror.getPhysicalPublication()),
			};
		} catch (error) {
			return this.latchTerminalError(message.epoch, error);
		}
	}

	private handlePatch(
		message: Extract<MainToRailMirrorMessage, { type: "APPLY_RAIL_PATCH" }>,
	): RailMirrorToMainMessage | null {
		const state = this.mirror.state;
		if (message.epoch < this.activeEpochValue) return null;
		if (message.epoch > this.activeEpochValue) {
			return {
				type: "RAIL_DESYNC",
				epoch: message.epoch,
				expectedSequence: state.sequence + 1,
				expectedRevision: state.revision,
				receivedSequence: message.patch.sequence,
				receivedBaseRevision: message.patch.baseRevision,
				message: `Rail patch epoch ${message.epoch} does not match active epoch ${this.activeEpochValue}.`,
			};
		}

		try {
			const railState = this.mirror.applyPatch(
				decodeRailPatchSoA(message.patch, this.mirror.organizationState),
			);
			return {
				type: "RAIL_PATCH_APPLIED",
				epoch: this.activeEpochValue,
				...railState,
				...describeRailPhysicalPublication(this.mirror.getPhysicalPublication()),
			};
		} catch (error) {
			const current = this.mirror.state;
			if (error instanceof RailPhysicalPublicationError) {
				return this.latchTerminalError(this.activeEpochValue, error);
			}
			return {
				type: "RAIL_DESYNC",
				epoch: this.activeEpochValue,
				expectedSequence: current.sequence + 1,
				expectedRevision: current.revision,
				receivedSequence: message.patch.sequence,
				receivedBaseRevision: message.patch.baseRevision,
				message: errorMessage(error),
			};
		}
	}

	private latchTerminalError(
		epoch: number,
		error: unknown,
	): Extract<RailMirrorToMainMessage, { type: "RAIL_MIRROR_ERROR" }> {
		this.terminalErrorLatched = true;
		const state = this.mirror.state;
		return {
			type: "RAIL_MIRROR_ERROR",
			epoch,
			sequence: state.sequence,
			revision: state.revision,
			message: errorMessage(error),
		};
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unknown rail mirror worker error.";
}
