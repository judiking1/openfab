import { describe, expect, it } from "vitest";
import { buildSimulationResidentReadinessTestSources } from "../compile/SimulationResidentReadinessTestFixture";
import {
	checksumOperationalConfiguration,
	emptyOperationalConfigurationState,
	reviewOperationalConfiguration,
} from "../core/OperationalConfiguration";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { DeterministicResidentActiveRunOwner } from "../simulation/DeterministicResidentActiveRunOwner";
import type {
	SimulationResidentScenarioPreparationWorkerRequest,
	SimulationResidentScenarioPreparationWorkerResponse,
} from "../worker/SimulationResidentScenarioPreparationWorkerProtocol";
import { prepareSimulationResidentScenarioWorkerRequest } from "../worker/SimulationResidentScenarioPreparationWorkerRuntime";
import { collectTransferableBuffers } from "../worker/TransferableBuffers";
import { SimulationResidentScenarioEditorController } from "./SimulationResidentScenarioEditorController";
import {
	SimulationResidentScenarioPreparationBridge,
	type SimulationResidentScenarioPreparationWorkerPort,
} from "./SimulationResidentScenarioPreparationBridge";
import { SimulationResidentScenarioSession } from "./SimulationResidentScenarioSession";

class ControllerResidentPreparationWorker
	implements SimulationResidentScenarioPreparationWorkerPort
{
	onmessage:
		| ((event: MessageEvent<SimulationResidentScenarioPreparationWorkerResponse>) => void)
		| null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	terminated = false;

	postMessage(
		message: SimulationResidentScenarioPreparationWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		const delivered = structuredClone(message, { transfer });
		queueMicrotask(() => void this.respond(delivered));
	}

	terminate(): void {
		this.terminated = true;
	}

	private async respond(
		request: SimulationResidentScenarioPreparationWorkerRequest,
	): Promise<void> {
		if (this.terminated) return;
		try {
			const response = await prepareSimulationResidentScenarioWorkerRequest(request);
			const transfer = collectTransferableBuffers(response);
			this.onmessage?.({
				data: structuredClone(response, { transfer: [...transfer] }),
			} as MessageEvent<SimulationResidentScenarioPreparationWorkerResponse>);
		} catch (error) {
			this.onerror?.({
				message: error instanceof Error ? error.message : "resident preparation failed",
			} as ErrorEvent);
		}
	}
}

class ControllerResidentPreparation extends SimulationResidentScenarioPreparationBridge {
	disposed = false;

	constructor() {
		super(() => new ControllerResidentPreparationWorker());
	}

	override dispose(): void {
		this.disposed = true;
		super.dispose();
	}
}

describe("SimulationResidentScenarioEditorController", () => {
	it("prepares, authorizes, and starts one exact resident run without publishing the snapshot", async () => {
		const fixture = await controllerFixture();
		await prepareController(fixture);
		expect(fixture.controller.getState()).toMatchObject({
			projectId: "PROJECT-RESIDENT-CONTROLLER-1",
			source: {
				sourceKind: "TRANSFER_PLAN",
				acceptedRecordCount: 1,
				rejectedRecordCount: 0,
			},
			session: { phase: "PREPARED", requestCount: 1, vehicleCount: 1 },
			authorization: null,
			activeRun: { phase: "IDLE" },
		});
		expect(JSON.stringify(fixture.controller.getState())).not.toContain("poseWorldXMeters");

		const authorization = await fixture.controller.authorizeCurrentPrepared(fixture.components);
		expect(fixture.controller.getState().authorization).toMatchObject({
			fingerprint: authorization.fingerprint,
			preparationGeneration: 1,
			authorizationGeneration: 1,
			requestCount: 1,
			vehicleCount: 1,
		});
		await expect(fixture.controller.start(64)).resolves.toMatchObject({
			phase: "ACTIVE",
			generation: 1,
			speedMultiplier: 64,
			latestPublication: { sequence: 1 },
		});
		expect(fixture.controller.getState().authorization).toBeNull();
		expect(fixture.owner.advanceByWallClockMicroseconds(1_000).publication).toMatchObject({
			sequence: 2,
		});
		expect(fixture.controller.stop()).toBe(true);
		expect(fixture.controller.getState().activeRun).toMatchObject({
			phase: "STOPPED",
			reason: "EXPLICIT_STOP",
		});
	});

	it("invalidates prepared authority and active ownership on one authored mutation", async () => {
		const fixture = await controllerFixture();
		await prepareController(fixture);
		await fixture.controller.authorizeCurrentPrepared(fixture.components);
		await fixture.controller.start(1);

		expect(
			fixture.document.commit(
				planRailConstruction(fixture.document.map, { x: 0, y: 0 }, { x: 3, y: 0 }),
			),
		).toBe(true);
		expect(fixture.controller.getState()).toMatchObject({
			session: { phase: "INVALIDATED", reason: "AUTHORED_MUTATION" },
			authorization: null,
			activeRun: { phase: "STOPPED", reason: "AUTHORED_MUTATION" },
		});
		expect(() => fixture.owner.advanceByWallClockMicroseconds(1)).toThrow(/no resident/i);
	});

	it("discards a grant issued after a concurrent authored lifecycle change", async () => {
		const fixture = await controllerFixture();
		await prepareController(fixture);
		const pending = fixture.controller.authorizeCurrentPrepared(fixture.components);
		fixture.document.commit(
			planRailConstruction(fixture.document.map, { x: 0, y: 0 }, { x: 3, y: 0 }),
		);

		await expect(pending).rejects.toThrow(/newer editor lifecycle/i);
		expect(fixture.controller.getState()).toMatchObject({
			authorization: null,
			session: { phase: "INVALIDATED", reason: "AUTHORED_MUTATION" },
		});
		await expect(fixture.controller.start(1)).rejects.toThrow(/authorization/i);
	});

	it("keeps only the latest concurrent authorization and lets revoke cancel one in flight", async () => {
		const fixture = await controllerFixture();
		await prepareController(fixture);
		const older = fixture.controller.authorizeCurrentPrepared(fixture.components);
		const latest = fixture.controller.authorizeCurrentPrepared(fixture.components);

		await expect(older).rejects.toThrow(/newer editor lifecycle/i);
		await expect(latest).resolves.toMatchObject({ authorizationGeneration: 2 });
		expect(fixture.controller.getState().authorization).toMatchObject({
			authorizationGeneration: 2,
		});

		fixture.controller.revokeAuthorization();
		const revoked = fixture.controller.authorizeCurrentPrepared(fixture.components);
		fixture.controller.revokeAuthorization();
		await expect(revoked).rejects.toThrow(/newer editor lifecycle/i);
		expect(fixture.controller.getState().authorization).toBeNull();
	});

	it("rejects static or operational sources outside the exact current document identity", async () => {
		const fixture = await controllerFixture();
		fixture.liveSourceIdentity.authoredChecksum = "foreign-authored-source";
		await expect(prepareController(fixture)).rejects.toThrow(/AUTHORED_CHECKSUM/);

		fixture.liveSourceIdentity.authoredChecksum =
			fixture.components.foundation.source.authoredChecksum;
		fixture.liveSourceIdentity.operationalConfigurationFingerprint = "foreign-operations";
		await expect(prepareController(fixture)).rejects.toThrow(/OPERATIONAL_CONFIGURATION/);
		expect(fixture.controller.getState()).toMatchObject({
			source: null,
			session: { phase: "IDLE" },
		});
	});

	it("replaces project identity, detaches the old document, and clears source authority", async () => {
		const fixture = await controllerFixture();
		await prepareController(fixture);
		await fixture.controller.authorizeCurrentPrepared(fixture.components);
		const replacement = new RailDocument();
		fixture.controller.replaceProject("PROJECT-RESIDENT-CONTROLLER-2", replacement);

		expect(fixture.controller.getState()).toMatchObject({
			projectId: "PROJECT-RESIDENT-CONTROLLER-2",
			source: null,
			authorization: null,
			session: { phase: "INVALIDATED", reason: "PROJECT_REPLACEMENT" },
		});
		fixture.document.commit(
			planRailConstruction(fixture.document.map, { x: 10, y: 0 }, { x: 13, y: 0 }),
		);
		expect(fixture.controller.getState().session).toMatchObject({
			phase: "INVALIDATED",
			reason: "PROJECT_REPLACEMENT",
		});
	});

	it("makes controller disposal terminal across session, owner, and preparation port", async () => {
		const fixture = await controllerFixture();
		await prepareController(fixture);
		await fixture.controller.authorizeCurrentPrepared(fixture.components);
		await fixture.controller.start(1);

		fixture.controller.dispose();
		expect(fixture.preparation.disposed).toBe(true);
		expect(fixture.owner.getState()).toMatchObject({ phase: "STOPPED", reason: "UNMOUNT" });
		expect(() => fixture.controller.stop()).toThrow(/disposed/i);
		fixture.controller.dispose();
	});
});

async function prepareController(fixture: Awaited<ReturnType<typeof controllerFixture>>) {
	return fixture.controller.prepare(
		fixture.components,
		fixture.operational,
		{
			sourceKind: "TRANSFER_PLAN",
			manifestId: "RESIDENT-CONTROLLER-PLAN-1",
			mappingVersion: 1,
			records: [
				{
					transferId: "TRANSFER-A",
					releaseTimeMicroseconds: 0,
					loadId: "LOAD-A",
					vehicleId: "OHT-001",
					sourcePortId: 1,
					destinationPortId: 2,
				},
			],
		},
		{
			eqProcessTimings: [
				{
					sourceOrdinal: 0,
					capabilityId: 1,
					processingDurationMicroseconds: 2_000_000,
				},
			],
		},
		{
			eqResources: [
				{
					equipmentGroupId: 2,
					concurrentCapacity: 2,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [{ loadId: "LOAD-A", equipmentGroupId: 1 }],
		},
	);
}

async function controllerFixture() {
	const sources = await buildSimulationResidentReadinessTestSources();
	const components = {
		foundation: sources.foundation,
		trackResources: sources.trackResources,
		stationCapabilities: sources.stationCapabilities,
		equipmentResources: sources.equipmentResources,
		occupancyPolicy: sources.occupancyPolicy,
	};
	const operational = reviewOperationalConfiguration(
		{
			...emptyOperationalConfigurationState(),
			nextResidentHomeSlotId: 2,
			residentHomeSlots: [
				{
					id: 1,
					vehicleId: "OHT-001",
					anchorPortId: 3,
					policy: "DEDICATED_HOME_RETURN",
				},
			],
		},
		{
			revision: components.foundation.source.revision,
			authoredChecksum: components.foundation.source.authoredChecksum,
		},
	);
	const document = new RailDocument();
	const preparation = new ControllerResidentPreparation();
	const session = new SimulationResidentScenarioSession(preparation);
	const owner = new DeterministicResidentActiveRunOwner({
		cadenceMicroseconds: 1_000,
		maximumPoseCount: 1,
	});
	const liveSourceIdentity = {
		patchSequence: components.foundation.source.patchSequence,
		revision: components.foundation.source.revision,
		authoredChecksum: components.foundation.source.authoredChecksum,
		operationalConfigurationFingerprint: checksumOperationalConfiguration(operational),
	};
	const controller = new SimulationResidentScenarioEditorController(
		"PROJECT-RESIDENT-CONTROLLER-1",
		document,
		session,
		owner,
		() => ({ ...liveSourceIdentity }),
	);
	return {
		components,
		operational,
		document,
		preparation,
		session,
		owner,
		controller,
		liveSourceIdentity,
	};
}
