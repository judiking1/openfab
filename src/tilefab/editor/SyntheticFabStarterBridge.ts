import type { CentralSpineFabAssemblyPlan } from "../compile/CentralSpineFabAssemblyPlan";
import type { FullFabAssemblyPlan, FullFabLoopPlan } from "../compile/FullFabAssemblyPlan";
import type {
	PairedCirculationCorridorPlan,
	PairedCirculationFabAssemblyPlan,
	PairedCirculationLoopPlan,
} from "../compile/PairedCirculationFabAssemblyPlan";
import type { ParallelHallFabAssemblyPlan } from "../compile/ParallelHallFabAssemblyPlan";
import type { ProductionFabAssemblyPlan } from "../compile/ProductionFabAssemblyPlan";
import type {
	SyntheticFabAssemblyJunctionContract,
	SyntheticFabAssemblyOperation,
	SyntheticFabAssemblyPlan,
} from "../compile/SyntheticFabAssemblyPlan";
import {
	type SyntheticFabStarterRequest,
	syntheticFabStarterAssemblyFingerprint,
	syntheticFabStarterAssemblyPlan,
	syntheticFabStarterCentralSpineAssemblyPlan,
	syntheticFabStarterFullFabAssemblyPlan,
	syntheticFabStarterPairedCirculationAssemblyPlan,
	syntheticFabStarterParallelHallAssemblyPlan,
	syntheticFabStarterProductionAssemblyPlan,
	syntheticFabStarterRequestFingerprint,
} from "../compile/SyntheticFabStarter";
import type { PreparedSyntheticFabStarter } from "../compile/SyntheticFabStarterPreview";
import { isSyntheticFabStarterRouteGeometry } from "../compile/SyntheticFabStarterRouteGeometry";
import { OrderedTypedChecksum } from "../core/OrderedTypedChecksum";
import { ALL_DIRECTIONS, DIR_E, type Direction } from "../core/railShape";
import { staticFabOrganizationBundleError } from "../core/StaticFabOrganizationBundle";
import { staticFabOrganizationBundleFingerprint } from "../core/StaticFabOrganizationBundlePlacement";
import {
	checksumRailMirrorSnapshot,
	RailChecksumAccumulator,
	type RailMirrorSnapshot,
} from "../worker/RailMirrorChecksum";
import type {
	SyntheticFabStarterWorkerRequest,
	SyntheticFabStarterWorkerResponse,
} from "../worker/SyntheticFabStarterProtocol";

export interface SyntheticFabStarterWorkerPort {
	onmessage: ((event: MessageEvent<SyntheticFabStarterWorkerResponse>) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
	onerror: ((event: ErrorEvent) => void) | null;
	postMessage(message: SyntheticFabStarterWorkerRequest): void;
	terminate(): void;
}

export class SyntheticFabStarterBridge {
	private readonly createWorker: () => SyntheticFabStarterWorkerPort;
	private readonly timeoutMilliseconds: number;
	private worker: SyntheticFabStarterWorkerPort | null = null;
	private reject: ((error: Error) => void) | null = null;
	private timeout: ReturnType<typeof globalThis.setTimeout> | null = null;
	private nextRequestId = 1;

	constructor(
		createWorker: () => SyntheticFabStarterWorkerPort = () =>
			new Worker(new URL("../worker/syntheticFabStarterWorker.ts", import.meta.url), {
				type: "module",
			}) as SyntheticFabStarterWorkerPort,
		timeoutMilliseconds = 30_000,
	) {
		this.createWorker = createWorker;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	prepare(request: SyntheticFabStarterRequest): Promise<PreparedSyntheticFabStarter> {
		this.cancel();
		let requestFingerprint: string;
		let expectedPlanFingerprint: string | null;
		let assemblyPlan: SyntheticFabAssemblyPlan | null;
		let pairedCirculationPlan: PairedCirculationFabAssemblyPlan | null;
		let fullFabPlan: FullFabAssemblyPlan | null;
		let parallelHallPlan: ParallelHallFabAssemblyPlan | null;
		let centralSpinePlan: CentralSpineFabAssemblyPlan | null;
		let productionPlan: ProductionFabAssemblyPlan | null;
		try {
			requestFingerprint = syntheticFabStarterRequestFingerprint(request);
			expectedPlanFingerprint = syntheticFabStarterAssemblyFingerprint(request);
			assemblyPlan = syntheticFabStarterAssemblyPlan(request);
			pairedCirculationPlan = syntheticFabStarterPairedCirculationAssemblyPlan(request);
			fullFabPlan = syntheticFabStarterFullFabAssemblyPlan(request);
			parallelHallPlan = syntheticFabStarterParallelHallAssemblyPlan(request);
			centralSpinePlan = syntheticFabStarterCentralSpineAssemblyPlan(request);
			productionPlan = syntheticFabStarterProductionAssemblyPlan(request);
		} catch (error) {
			return Promise.reject(normalizeWorkerError(error, "FAB starter request is invalid."));
		}
		let worker: SyntheticFabStarterWorkerPort;
		try {
			worker = this.createWorker();
		} catch (error) {
			return Promise.reject(normalizeWorkerError(error, "FAB starter Worker creation failed."));
		}
		this.worker = worker;
		const requestId = this.nextRequestId++;
		return new Promise((resolve, reject) => {
			this.reject = reject;
			const fail = (error: Error): void => {
				if (this.worker !== worker) return;
				this.reject = null;
				this.releaseWorker();
				reject(error);
			};
			worker.onmessage = (event) => {
				const response = event.data;
				if (!isSyntheticFabStarterWorkerResponse(response)) {
					fail(new Error("FAB starter Worker returned a malformed response."));
					return;
				}
				if (response.requestId !== requestId) {
					fail(new Error("FAB starter Worker returned a stale response."));
					return;
				}
				if (response.type === "SYNTHETIC_FAB_STARTER_PREPARATION_ERROR") {
					fail(new Error(response.message));
					return;
				}
				if (
					!preparedMatchesRequest(
						response.prepared,
						requestFingerprint,
						expectedPlanFingerprint,
						assemblyPlan,
						pairedCirculationPlan,
						fullFabPlan,
						parallelHallPlan,
						centralSpinePlan,
						productionPlan,
					)
				) {
					fail(new Error("FAB starter Worker returned a mismatched prepared project."));
					return;
				}
				this.releaseWorker();
				this.reject = null;
				resolve(response.prepared);
			};
			worker.onmessageerror = () => {
				fail(new Error("FAB starter Worker response could not be decoded."));
			};
			worker.onerror = (event) => {
				fail(new Error(event.message || "FAB starter Worker failed."));
			};
			this.timeout = globalThis.setTimeout(() => {
				fail(new Error("FAB starter Worker timed out."));
			}, this.timeoutMilliseconds);
			try {
				worker.postMessage({
					type: "PREPARE_SYNTHETIC_FAB_STARTER",
					requestId,
					starter: request,
				});
			} catch (error) {
				fail(normalizeWorkerError(error, "FAB starter Worker request failed."));
			}
		});
	}

	cancel(): void {
		const reject = this.reject;
		this.reject = null;
		this.releaseWorker();
		reject?.(new DOMException("FAB starter preparation cancelled.", "AbortError"));
	}

	dispose(): void {
		this.cancel();
	}

	private releaseWorker(): void {
		if (this.timeout !== null) {
			globalThis.clearTimeout(this.timeout);
			this.timeout = null;
		}
		const worker = this.worker;
		if (!worker) return;
		this.worker = null;
		worker.onmessage = null;
		worker.onmessageerror = null;
		worker.onerror = null;
		worker.terminate();
	}
}

export interface SyntheticFabStarterIndependentPreparationBridge {
	prepare(request: SyntheticFabStarterRequest): Promise<PreparedSyntheticFabStarter>;
	cancel(): void;
	dispose(): void;
}

export async function independentlyVerifyPreparedSyntheticFabStarter(
	prepared: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
	signal: AbortSignal,
	createBridge: () => SyntheticFabStarterIndependentPreparationBridge = () =>
		new SyntheticFabStarterBridge(),
): Promise<PreparedSyntheticFabStarter> {
	if (signal.aborted) throw new DOMException("FAB starter verification cancelled.", "AbortError");
	const bridge = createBridge();
	const cancel = (): void => bridge.cancel();
	signal.addEventListener("abort", cancel, { once: true });
	try {
		const independent = await bridge.prepare(request);
		if (!preparedSyntheticFabStarterMatchesIndependentPreparation(prepared, independent, request)) {
			throw new Error("Prepared FAB does not match an independent materialization of its plan.");
		}
		return independent;
	} finally {
		signal.removeEventListener("abort", cancel);
		bridge.dispose();
	}
}

export function preparedSyntheticFabStarterMatchesRequest(
	prepared: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
): boolean {
	try {
		return preparedMatchesRequest(
			prepared,
			syntheticFabStarterRequestFingerprint(request),
			syntheticFabStarterAssemblyFingerprint(request),
			syntheticFabStarterAssemblyPlan(request),
			syntheticFabStarterPairedCirculationAssemblyPlan(request),
			syntheticFabStarterFullFabAssemblyPlan(request),
			syntheticFabStarterParallelHallAssemblyPlan(request),
			syntheticFabStarterCentralSpineAssemblyPlan(request),
			syntheticFabStarterProductionAssemblyPlan(request),
		);
	} catch {
		return false;
	}
}

export function preparedSyntheticFabStarterMatchesIndependentPreparation(
	prepared: PreparedSyntheticFabStarter,
	independent: PreparedSyntheticFabStarter,
	request: SyntheticFabStarterRequest,
): boolean {
	return (
		prepared !== independent &&
		preparedSyntheticFabStarterMatchesRequest(prepared, request) &&
		preparedSyntheticFabStarterMatchesRequest(independent, request) &&
		preparedSyntheticFabStarterMaterializationFingerprint(prepared) ===
			preparedSyntheticFabStarterMaterializationFingerprint(independent)
	);
}

export function preparedSyntheticFabStarterMaterializationFingerprint(
	prepared: PreparedSyntheticFabStarter,
): string {
	const checksum = new OrderedTypedChecksum();
	checksum.addStrings([
		prepared.requestFingerprint,
		prepared.planFingerprint ?? "no-plan",
		prepared.authoredChecksum,
		prepared.analysisFingerprint,
		prepared.physicalFingerprint,
		prepared.readinessFingerprint,
		prepared.snapshot.checksum,
		prepared.placementBundleFingerprint ?? "no-placement-bundle",
		prepared.exactGeometry?.fingerprint ?? "no-exact-route-geometry",
	]);
	checksum.addNumbers([
		prepared.authoredRevision,
		prepared.authoringReady ? 1 : 0,
		prepared.snapshot.sequence,
		prepared.snapshot.revision,
		prepared.snapshot.nextAdvancedSwitchId,
		prepared.summary.zoneCount,
		prepared.summary.bayCount,
		prepared.summary.railCells,
		prepared.summary.directedEdges,
		prepared.summary.physicalPaths,
		prepared.summary.totalLengthMeters,
		prepared.summary.junctions,
		prepared.summary.openTerminals,
		prepared.summary.strongComponents,
	]);
	if (prepared.summary.bounds) {
		checksum.addNumbers([
			prepared.summary.bounds.minX,
			prepared.summary.bounds.minY,
			prepared.summary.bounds.maxX,
			prepared.summary.bounds.maxY,
			prepared.summary.bounds.widthMeters,
			prepared.summary.bounds.heightMeters,
		]);
	} else {
		checksum.addStrings(["no-bounds"]);
	}
	for (const step of prepared.steps) {
		checksum.addStrings([
			step.kind,
			step.templateId,
			step.hierarchyRole,
			step.entityId ?? "no-entity",
			step.connectionId ?? "no-connection",
			step.connectionRole ?? "no-connection-role",
			step.label,
			step.pose?.side ?? "no-side",
			step.pose?.flow ?? "no-flow",
			...step.bayIds,
		]);
		checksum.addNumbers([
			step.ordinal,
			step.bayCount,
			step.anchor.x,
			step.anchor.y,
			step.targetAnchor?.x ?? -1,
			step.targetAnchor?.y ?? -1,
			step.junctions?.sourceDeparture.x ?? -1,
			step.junctions?.sourceDeparture.y ?? -1,
			step.junctions?.sourceArrival.x ?? -1,
			step.junctions?.sourceArrival.y ?? -1,
			step.junctions?.targetArrival.x ?? -1,
			step.junctions?.targetArrival.y ?? -1,
			step.junctions?.targetDeparture.x ?? -1,
			step.junctions?.targetDeparture.y ?? -1,
			step.pose?.forward ?? -1,
			step.addedEdges,
			step.outboundTurns ?? -1,
			step.returnTurns ?? -1,
		]);
	}
	return checksum.digest();
}

function preparedMatchesRequest(
	prepared: PreparedSyntheticFabStarter,
	requestFingerprint: string,
	expectedPlanFingerprint: string | null,
	assemblyPlan: SyntheticFabAssemblyPlan | null,
	pairedCirculationPlan: PairedCirculationFabAssemblyPlan | null,
	fullFabPlan: FullFabAssemblyPlan | null,
	parallelHallPlan: ParallelHallFabAssemblyPlan | null,
	centralSpinePlan: CentralSpineFabAssemblyPlan | null,
	productionPlan: ProductionFabAssemblyPlan | null,
): boolean {
	try {
		const checksum = RailChecksumAccumulator.fromDigest(prepared.authoredChecksum);
		return (
			isPreparedSyntheticFabStarterPayload(prepared) &&
			prepared.requestFingerprint === requestFingerprint &&
			prepared.planFingerprint === expectedPlanFingerprint &&
			syntheticFabStarterRequestFingerprint(prepared.request) === requestFingerprint &&
			preparedStepsMatchAssemblyPlan(
				prepared.steps,
				assemblyPlan,
				pairedCirculationPlan,
				fullFabPlan,
				parallelHallPlan,
				centralSpinePlan,
				productionPlan,
			) &&
			prepared.snapshot.checksum === prepared.authoredChecksum &&
			checksumRailMirrorSnapshot(prepared.snapshot) === prepared.authoredChecksum &&
			prepared.snapshot.revision === prepared.authoredRevision &&
			prepared.snapshot.sequence === prepared.steps.length &&
			checksum.cellCount === prepared.summary.railCells &&
			checksum.edgeCount === prepared.summary.directedEdges &&
			prepared.snapshot.xs.length === prepared.summary.railCells &&
			preparedSummaryMatchesAssemblyPlan(
				prepared,
				assemblyPlan,
				pairedCirculationPlan,
				fullFabPlan,
				parallelHallPlan,
				centralSpinePlan,
				productionPlan,
			) &&
			preparedSummaryBoundsMatchSnapshot(prepared)
		);
	} catch {
		return false;
	}
}

function preparedStepsMatchAssemblyPlan(
	steps: PreparedSyntheticFabStarter["steps"],
	assemblyPlan: SyntheticFabAssemblyPlan | null,
	pairedCirculationPlan: PairedCirculationFabAssemblyPlan | null,
	fullFabPlan: FullFabAssemblyPlan | null,
	parallelHallPlan: ParallelHallFabAssemblyPlan | null,
	centralSpinePlan: CentralSpineFabAssemblyPlan | null,
	productionPlan: ProductionFabAssemblyPlan | null,
): boolean {
	if (pairedCirculationPlan) {
		return preparedStepsMatchPairedCirculationPlan(steps, pairedCirculationPlan);
	}
	if (fullFabPlan) return preparedStepsMatchFullFabPlan(steps, fullFabPlan);
	if (parallelHallPlan) return preparedStepsMatchParallelHallPlan(steps, parallelHallPlan);
	if (centralSpinePlan) return preparedStepsMatchCentralSpinePlan(steps, centralSpinePlan);
	if (productionPlan) return preparedStepsMatchProductionPlan(steps, productionPlan);
	if (!assemblyPlan) return true;
	const expectedStepCount =
		assemblyPlan.operations.length +
		assemblyPlan.operations.reduce(
			(total, operation) =>
				total + (operation.kind === "process-trunk" ? operation.bayPlacements.length : 0),
			0,
		);
	if (steps.length !== expectedStepCount) return false;
	let cursor = 0;
	for (const operation of assemblyPlan.operations) {
		if (!preparedStepMatchesAssemblyOperation(steps[cursor], operation)) return false;
		cursor += 1;
		if (operation.kind !== "process-trunk") continue;
		for (const placement of operation.bayPlacements) {
			const step = steps[cursor];
			if (
				!step ||
				step.kind !== "template" ||
				step.templateId !== "branch-bypass" ||
				step.hierarchyRole !== "process-bay" ||
				step.entityId !== placement.id ||
				step.connectionId !== null ||
				step.connectionRole !== null ||
				step.bayCount !== 1 ||
				step.bayIds.length !== 1 ||
				step.bayIds[0] !== placement.id ||
				step.anchor.x !== placement.anchor.x ||
				step.anchor.y !== placement.anchor.y ||
				step.targetAnchor !== null ||
				step.junctions !== null ||
				step.pose === null ||
				step.pose.forward !== placement.pose.forward ||
				step.pose.side !== placement.pose.side ||
				step.pose.flow !== placement.pose.flow ||
				step.outboundTurns !== null ||
				step.returnTurns !== null ||
				step.addedEdges < 1
			) {
				return false;
			}
			cursor += 1;
		}
	}
	return cursor === steps.length;
}

function preparedStepsMatchPairedCirculationPlan(
	steps: PreparedSyntheticFabStarter["steps"],
	plan: PairedCirculationFabAssemblyPlan,
): boolean {
	const processLoopCount = plan.banks.reduce(
		(total, bank) =>
			total + bank.bays.reduce((bankTotal, bay) => bankTotal + bay.processLoops.length, 0),
		0,
	);
	const expectedStepCount =
		2 +
		plan.outer.turnbacks.length +
		plan.halls.length +
		plan.gateways.length +
		plan.profile.bayCount * 2 +
		processLoopCount;
	if (steps.length !== expectedStepCount) return false;
	if (
		!preparedLoopStepMatches(
			steps[0],
			plan.outer.laneA,
			"outer-circulation",
			plan.outer.laneA.id,
			[],
		) ||
		!preparedLoopStepMatches(
			steps[1],
			plan.outer.laneB,
			"outer-circulation",
			plan.outer.laneB.id,
			[],
		)
	) {
		return false;
	}
	let cursor = 2;
	for (const turnback of plan.outer.turnbacks) {
		if (!preparedPairedTurnbackStepMatches(steps[cursor], turnback)) return false;
		cursor += 1;
	}
	for (const hall of plan.halls) {
		if (!preparedPairedCorridorStepMatches(steps[cursor], hall.interbay)) {
			return false;
		}
		cursor += 1;
	}
	for (const gateway of plan.gateways) {
		const step = steps[cursor];
		if (
			!step ||
			step.kind !== "network-link" ||
			step.templateId !== "network-link" ||
			step.hierarchyRole !== "network-link" ||
			step.entityId !== gateway.id ||
			step.connectionId !== gateway.id ||
			step.connectionRole !== "wall-outer" ||
			step.anchor.x !== gateway.sourceAnchor.x ||
			step.anchor.y !== gateway.sourceAnchor.y ||
			step.targetAnchor?.x !== gateway.targetAnchor.x ||
			step.targetAnchor.y !== gateway.targetAnchor.y ||
			step.pose !== null ||
			!sameJunctionContract(step.junctions, gateway.exactJunctions) ||
			step.outboundTurns !== gateway.expectedOutboundTurns ||
			step.returnTurns !== gateway.expectedReturnTurns ||
			step.bayCount !== 0 ||
			step.bayIds.length !== 0 ||
			step.addedEdges < 1
		) {
			return false;
		}
		cursor += 1;
	}
	for (const bank of plan.banks) {
		for (const bay of bank.bays) {
			const shell = steps[cursor];
			if (
				!shell ||
				shell.kind !== "template" ||
				shell.templateId !== "outer-loop" ||
				shell.hierarchyRole !== "process-bay" ||
				shell.entityId !== bay.id ||
				shell.anchor.x !== bay.shellAnchor.x ||
				shell.anchor.y !== bay.shellAnchor.y ||
				shell.pose?.forward !== bay.shellPose.forward ||
				shell.pose.side !== bay.shellPose.side ||
				shell.pose.flow !== bay.shellPose.flow ||
				shell.bayCount !== 1 ||
				shell.bayIds[0] !== bay.id ||
				shell.addedEdges < 1
			) {
				return false;
			}
			cursor += 1;
			for (const processLoop of bay.processLoops) {
				const loop = steps[cursor];
				if (
					!loop ||
					loop.kind !== "template" ||
					loop.templateId !== "outerbay-link" ||
					loop.hierarchyRole !== "process-loop" ||
					loop.entityId !== processLoop.id ||
					loop.anchor.x !== processLoop.anchor.x ||
					loop.anchor.y !== processLoop.anchor.y ||
					loop.pose?.forward !== processLoop.pose.forward ||
					loop.pose.side !== processLoop.pose.side ||
					loop.pose.flow !== processLoop.pose.flow ||
					loop.bayCount !== 1 ||
					loop.bayIds[0] !== bay.id ||
					loop.addedEdges < 1
				) {
					return false;
				}
				cursor += 1;
			}
			const gateway = steps[cursor];
			if (
				!gateway ||
				gateway.kind !== "network-link" ||
				gateway.templateId !== "network-link" ||
				gateway.hierarchyRole !== "network-link" ||
				gateway.entityId !== bay.gateway.id ||
				gateway.connectionId !== bay.gateway.id ||
				gateway.connectionRole !== "process-row" ||
				gateway.anchor.x !== bay.gateway.sourceAnchor.x ||
				gateway.anchor.y !== bay.gateway.sourceAnchor.y ||
				gateway.targetAnchor?.x !== bay.gateway.targetAnchor.x ||
				gateway.targetAnchor.y !== bay.gateway.targetAnchor.y ||
				gateway.pose !== null ||
				!sameJunctionContract(gateway.junctions, bay.gateway.exactJunctions) ||
				gateway.outboundTurns !== bay.gateway.expectedOutboundTurns ||
				gateway.returnTurns !== bay.gateway.expectedReturnTurns ||
				gateway.bayCount !== 0 ||
				gateway.bayIds.length !== 0 ||
				gateway.addedEdges < 1
			) {
				return false;
			}
			cursor += 1;
		}
	}
	return cursor === steps.length;
}

function preparedPairedTurnbackStepMatches(
	step: PreparedSyntheticFabStarter["steps"][number] | undefined,
	turnback: PairedCirculationFabAssemblyPlan["outer"]["turnbacks"][number],
): boolean {
	const entityId = `FAB-OUTER-${turnback.id.toUpperCase()}-TURNBACK`;
	return (
		step?.kind === "paired-turnback" &&
		step.templateId === "paired-turnback" &&
		step.hierarchyRole === "outer-circulation" &&
		step.entityId === entityId &&
		step.connectionId === turnback.id &&
		step.connectionRole === "outer-turnback" &&
		step.anchor.x === turnback.departure.cell.x &&
		step.anchor.y === turnback.departure.cell.y &&
		step.targetAnchor?.x === turnback.arrival.cell.x &&
		step.targetAnchor.y === turnback.arrival.cell.y &&
		step.junctions === null &&
		step.pose === null &&
		step.outboundTurns === 0 &&
		step.returnTurns === null &&
		step.addedEdges === turnback.laneSpacingMeters
	);
}

function sameJunctionContract(
	actual: SyntheticFabAssemblyJunctionContract | null,
	expected: SyntheticFabAssemblyJunctionContract,
): boolean {
	return (
		actual !== null &&
		actual.sourceDeparture.x === expected.sourceDeparture.x &&
		actual.sourceDeparture.y === expected.sourceDeparture.y &&
		actual.sourceArrival.x === expected.sourceArrival.x &&
		actual.sourceArrival.y === expected.sourceArrival.y &&
		actual.targetArrival.x === expected.targetArrival.x &&
		actual.targetArrival.y === expected.targetArrival.y &&
		actual.targetDeparture.x === expected.targetDeparture.x &&
		actual.targetDeparture.y === expected.targetDeparture.y
	);
}

function preparedPairedCorridorStepMatches(
	step: PreparedSyntheticFabStarter["steps"][number] | undefined,
	corridor: PairedCirculationCorridorPlan,
): boolean {
	return (
		step?.kind === "paired-corridor" &&
		step.templateId === "paired-corridor" &&
		step.hierarchyRole === "interbay-spine" &&
		step.entityId === corridor.id &&
		step.anchor.x === corridor.origin.x &&
		step.anchor.y === corridor.origin.y &&
		step.pose?.forward === corridor.pose.forward &&
		step.pose.side === corridor.pose.side &&
		step.pose.flow === corridor.pose.flow &&
		step.connectionId === null &&
		step.connectionRole === null &&
		step.targetAnchor === null &&
		step.junctions === null &&
		step.outboundTurns === 2 &&
		step.returnTurns === 2 &&
		step.bayCount === 0 &&
		step.bayIds.length === 0 &&
		step.addedEdges === corridor.lengthMeters * 2 + corridor.laneSpacingMeters * 2 + 4
	);
}

function preparedStepsMatchParallelHallPlan(
	steps: PreparedSyntheticFabStarter["steps"],
	plan: ParallelHallFabAssemblyPlan,
): boolean {
	const expectedStepCount =
		2 + plan.banks.length + plan.gateways.length + plan.profile.bayCount * 3;
	if (steps.length !== expectedStepCount) return false;
	if (
		!preparedLoopStepMatches(steps[0], plan.outer, "outer-circulation", plan.outer.id, []) ||
		!preparedLoopStepMatches(
			steps[1],
			plan.interbaySpine,
			"interbay-spine",
			plan.interbaySpine.id,
			[],
		)
	) {
		return false;
	}

	let cursor = 2;
	for (const bank of plan.banks) {
		if (
			!preparedLoopStepMatches(
				steps[cursor],
				bank.collector,
				"bay-bank",
				bank.id,
				bank.bays.map((bay) => bay.id),
			)
		) {
			return false;
		}
		cursor += 1;
	}
	for (const gateway of plan.gateways) {
		const step = steps[cursor];
		if (
			!step ||
			step.kind !== "network-link" ||
			step.templateId !== "network-link" ||
			step.hierarchyRole !== "network-link" ||
			step.entityId !== gateway.id ||
			step.connectionId !== gateway.id ||
			step.connectionRole !==
				(gateway.ownerId === "PARALLEL-HALL-FAB" ? "wall-outer" : "spine-wall") ||
			step.anchor.x !== gateway.sourceAnchor.x ||
			step.anchor.y !== gateway.sourceAnchor.y ||
			step.targetAnchor?.x !== gateway.targetAnchor.x ||
			step.targetAnchor.y !== gateway.targetAnchor.y ||
			step.pose !== null ||
			step.junctions === null ||
			step.outboundTurns !== 0 ||
			step.returnTurns !== 0 ||
			step.bayCount !== 0 ||
			step.bayIds.length !== 0 ||
			step.addedEdges < 1
		) {
			return false;
		}
		cursor += 1;
	}
	for (const bank of plan.banks) {
		for (const bay of bank.bays) {
			const expected = [bay, ...bay.processLoops];
			for (let index = 0; index < expected.length; index += 1) {
				const placement = expected[index];
				const step = steps[cursor];
				if (
					!placement ||
					!step ||
					step.kind !== "template" ||
					step.templateId !== "outerbay-link" ||
					step.hierarchyRole !== (index === 0 ? "process-bay" : "process-loop") ||
					step.entityId !== placement.id ||
					step.anchor.x !== placement.anchor.x ||
					step.anchor.y !== placement.anchor.y ||
					step.pose?.forward !== placement.pose.forward ||
					step.pose.side !== placement.pose.side ||
					step.pose.flow !== placement.pose.flow ||
					step.connectionId !== null ||
					step.connectionRole !== null ||
					step.targetAnchor !== null ||
					step.junctions !== null ||
					step.outboundTurns !== null ||
					step.returnTurns !== null ||
					step.bayCount !== 1 ||
					step.bayIds.length !== 1 ||
					step.bayIds[0] !== bay.id ||
					step.addedEdges < 1
				) {
					return false;
				}
				cursor += 1;
			}
		}
	}
	return cursor === steps.length;
}

function preparedStepsMatchFullFabPlan(
	steps: PreparedSyntheticFabStarter["steps"],
	plan: FullFabAssemblyPlan,
): boolean {
	const expectedStepCount =
		1 + plan.halls.length + plan.banks.length + plan.gateways.length + plan.profile.bayCount * 3;
	if (steps.length !== expectedStepCount) return false;
	if (!preparedLoopStepMatches(steps[0], plan.outer, "outer-circulation", plan.outer.id, [])) {
		return false;
	}

	let cursor = 1;
	for (const hall of plan.halls) {
		if (
			!preparedLoopStepMatches(
				steps[cursor],
				hall.interbaySpine,
				"interbay-spine",
				hall.interbaySpine.id,
				[],
			)
		) {
			return false;
		}
		cursor += 1;
	}
	for (const bank of plan.banks) {
		if (
			!preparedLoopStepMatches(
				steps[cursor],
				bank.collector,
				"bay-bank",
				bank.id,
				bank.bays.map((bay) => bay.id),
			)
		) {
			return false;
		}
		cursor += 1;
	}
	for (const gateway of plan.gateways) {
		const step = steps[cursor];
		if (
			!step ||
			step.kind !== "network-link" ||
			step.templateId !== "network-link" ||
			step.hierarchyRole !== "network-link" ||
			step.entityId !== gateway.id ||
			step.connectionId !== gateway.id ||
			step.connectionRole !== (gateway.ownerId === "FULL-FAB" ? "wall-outer" : "spine-wall") ||
			step.anchor.x !== gateway.sourceAnchor.x ||
			step.anchor.y !== gateway.sourceAnchor.y ||
			step.targetAnchor?.x !== gateway.targetAnchor.x ||
			step.targetAnchor.y !== gateway.targetAnchor.y ||
			step.pose !== null ||
			step.junctions === null ||
			step.outboundTurns !== 0 ||
			step.returnTurns !== 0 ||
			step.bayCount !== 0 ||
			step.bayIds.length !== 0 ||
			step.addedEdges < 1
		) {
			return false;
		}
		cursor += 1;
	}
	for (const bank of plan.banks) {
		for (const bay of bank.bays) {
			const expected = [bay, ...bay.processLoops];
			for (let index = 0; index < expected.length; index += 1) {
				const placement = expected[index];
				const step = steps[cursor];
				if (
					!placement ||
					!step ||
					step.kind !== "template" ||
					step.templateId !== "outerbay-link" ||
					step.hierarchyRole !== (index === 0 ? "process-bay" : "process-loop") ||
					step.entityId !== placement.id ||
					step.anchor.x !== placement.anchor.x ||
					step.anchor.y !== placement.anchor.y ||
					step.pose?.forward !== placement.pose.forward ||
					step.pose.side !== placement.pose.side ||
					step.pose.flow !== placement.pose.flow ||
					step.connectionId !== null ||
					step.connectionRole !== null ||
					step.targetAnchor !== null ||
					step.junctions !== null ||
					step.outboundTurns !== null ||
					step.returnTurns !== null ||
					step.bayCount !== 1 ||
					step.bayIds.length !== 1 ||
					step.bayIds[0] !== bay.id ||
					step.addedEdges < 1
				) {
					return false;
				}
				cursor += 1;
			}
		}
	}
	return cursor === steps.length;
}

function preparedLoopStepMatches(
	step: PreparedSyntheticFabStarter["steps"][number] | undefined,
	loop: ParallelHallFabAssemblyPlan["outer"] | FullFabLoopPlan | PairedCirculationLoopPlan,
	hierarchyRole: PreparedSyntheticFabStarter["steps"][number]["hierarchyRole"],
	entityId: string,
	bayIds: readonly string[],
): boolean {
	return (
		step?.kind === "template" &&
		step.templateId === "outer-loop" &&
		step.hierarchyRole === hierarchyRole &&
		step.entityId === entityId &&
		step.anchor.x === loop.origin.x &&
		step.anchor.y === loop.origin.y &&
		step.pose?.forward === loop.pose.forward &&
		step.pose.side === loop.pose.side &&
		step.pose.flow === loop.pose.flow &&
		step.connectionId === null &&
		step.connectionRole === null &&
		step.targetAnchor === null &&
		step.junctions === null &&
		step.outboundTurns === null &&
		step.returnTurns === null &&
		step.bayCount === bayIds.length &&
		step.bayIds.length === bayIds.length &&
		step.bayIds.every((id, index) => id === bayIds[index]) &&
		step.addedEdges > 0
	);
}

function preparedStepsMatchCentralSpinePlan(
	steps: PreparedSyntheticFabStarter["steps"],
	plan: CentralSpineFabAssemblyPlan,
): boolean {
	if (steps.length !== 2 + plan.profile.bayCount * 3) return false;
	const outer = steps[0];
	const spine = steps[1];
	if (
		!outer ||
		outer.kind !== "template" ||
		outer.templateId !== "outer-loop" ||
		outer.hierarchyRole !== "outer-circulation" ||
		outer.entityId !== plan.outer.id ||
		outer.anchor.x !== plan.outer.origin.x ||
		outer.anchor.y !== plan.outer.origin.y ||
		outer.pose?.forward !== plan.outer.pose.forward ||
		outer.pose.side !== plan.outer.pose.side ||
		outer.pose.flow !== plan.outer.pose.flow ||
		!spine ||
		spine.kind !== "template" ||
		spine.templateId !== "outer-loop" ||
		spine.hierarchyRole !== "interbay-spine" ||
		spine.entityId !== plan.interbaySpine.id ||
		spine.anchor.x !== plan.interbaySpine.origin.x ||
		spine.anchor.y !== plan.interbaySpine.origin.y ||
		spine.pose?.forward !== plan.interbaySpine.pose.forward ||
		spine.pose.side !== plan.interbaySpine.pose.side ||
		spine.pose.flow !== plan.interbaySpine.pose.flow
	) {
		return false;
	}

	let cursor = 2;
	for (const bank of plan.banks) {
		for (const bay of bank.bays) {
			const baySteps = steps.slice(cursor, cursor + 3);
			const envelope = baySteps[0];
			if (
				baySteps.length !== 3 ||
				!envelope ||
				envelope.templateId !== "outer-loop" ||
				envelope.hierarchyRole !== "process-bay" ||
				envelope.entityId !== bay.id ||
				envelope.anchor.x !== bay.anchor.x ||
				envelope.anchor.y !== bay.anchor.y ||
				bay.processLoops.length !== 2 ||
				baySteps.some((step, index) => {
					const expected = index === 0 ? bay : bay.processLoops[index - 1];
					return (
						!step ||
						!expected ||
						step.kind !== "template" ||
						step.templateId !== (index === 0 ? "outer-loop" : "outerbay-link") ||
						step.hierarchyRole !== (index === 0 ? "process-bay" : "process-loop") ||
						step.entityId !== expected.id ||
						step.anchor.x !== expected.anchor.x ||
						step.anchor.y !== expected.anchor.y ||
						step.pose?.forward !== expected.pose.forward ||
						step.pose.side !== expected.pose.side ||
						step.pose.flow !== expected.pose.flow ||
						step.bayCount !== 1 ||
						step.bayIds.length !== 1 ||
						step.bayIds[0] !== bay.id ||
						step.connectionId !== null ||
						step.connectionRole !== null ||
						step.targetAnchor !== null ||
						step.junctions !== null ||
						step.addedEdges < 1
					);
				})
			) {
				return false;
			}
			cursor += 3;
		}
	}
	return cursor === steps.length;
}

function preparedStepsMatchProductionPlan(
	steps: PreparedSyntheticFabStarter["steps"],
	plan: ProductionFabAssemblyPlan,
): boolean {
	if (steps.length !== 2 + plan.banks.length + plan.profile.bayCount * 3) return false;
	const outer = steps[0];
	const spine = steps[1];
	if (
		!outer ||
		outer.kind !== "template" ||
		outer.templateId !== "outer-loop" ||
		outer.hierarchyRole !== "outer-circulation" ||
		outer.entityId !== plan.outer.id ||
		outer.anchor.x !== plan.outer.origin.x ||
		outer.anchor.y !== plan.outer.origin.y ||
		outer.pose?.forward !== plan.outer.pose.forward ||
		outer.pose.side !== plan.outer.pose.side ||
		outer.pose.flow !== plan.outer.pose.flow ||
		!spine ||
		spine.kind !== "template" ||
		spine.templateId !== "outer-loop" ||
		spine.hierarchyRole !== "interbay-spine" ||
		spine.entityId !== plan.interbaySpine.id ||
		spine.anchor.x !== plan.interbaySpine.origin.x ||
		spine.anchor.y !== plan.interbaySpine.origin.y ||
		spine.pose?.forward !== plan.interbaySpine.pose.forward ||
		spine.pose.side !== plan.interbaySpine.pose.side ||
		spine.pose.flow !== plan.interbaySpine.pose.flow
	) {
		return false;
	}

	let cursor = 2;
	for (const bank of plan.banks) {
		const collector = steps[cursor++];
		if (
			!collector ||
			collector.kind !== "template" ||
			collector.templateId !== "outer-loop" ||
			collector.hierarchyRole !== "bay-bank" ||
			collector.entityId !== bank.id ||
			collector.bayCount !== bank.bayCount ||
			collector.bayIds.length !== bank.bays.length ||
			collector.bayIds.some((bayId, index) => bayId !== bank.bays[index]?.id) ||
			collector.anchor.x !== bank.collector.origin.x ||
			collector.anchor.y !== bank.collector.origin.y ||
			collector.pose?.forward !== bank.collector.pose.forward ||
			collector.pose.side !== bank.collector.pose.side ||
			collector.pose.flow !== bank.collector.pose.flow
		) {
			return false;
		}
		for (const bay of bank.bays) {
			const baySteps = steps.slice(cursor, cursor + 3);
			const bayEnvelope = baySteps[0];
			const firstProcessLoop = baySteps[1];
			const secondProcessLoop = baySteps[2];
			const firstProcessLoopPlan = bay.processLoops[0];
			const secondProcessLoopPlan = bay.processLoops[1];
			if (
				baySteps.length !== 3 ||
				!firstProcessLoopPlan ||
				!secondProcessLoopPlan ||
				bay.processLoops.length !== 2 ||
				bayEnvelope.kind !== "template" ||
				bayEnvelope?.templateId !== "outer-loop" ||
				bayEnvelope.hierarchyRole !== "process-bay" ||
				bayEnvelope.entityId !== bay.id ||
				bayEnvelope.anchor.x !== bay.anchor.x ||
				bayEnvelope.anchor.y !== bay.anchor.y ||
				firstProcessLoop?.templateId !== "outerbay-link" ||
				firstProcessLoop.hierarchyRole !== "process-loop" ||
				firstProcessLoop.entityId !== firstProcessLoopPlan.id ||
				firstProcessLoop.anchor.x !== firstProcessLoopPlan.anchor.x ||
				firstProcessLoop.anchor.y !== firstProcessLoopPlan.anchor.y ||
				secondProcessLoop?.templateId !== "outerbay-link" ||
				secondProcessLoop.hierarchyRole !== "process-loop" ||
				secondProcessLoop.entityId !== secondProcessLoopPlan.id ||
				secondProcessLoop.anchor.x !== secondProcessLoopPlan.anchor.x ||
				secondProcessLoop.anchor.y !== secondProcessLoopPlan.anchor.y ||
				baySteps.some(
					(step, index) =>
						!step ||
						step.kind !== "template" ||
						step.bayCount !== 1 ||
						step.bayIds.length !== 1 ||
						step.bayIds[0] !== bay.id ||
						step.pose?.forward !==
							(index === 0 ? bay.pose : bay.processLoops[index - 1]?.pose)?.forward ||
						step.pose.side !== (index === 0 ? bay.pose : bay.processLoops[index - 1]?.pose)?.side ||
						step.pose.flow !== (index === 0 ? bay.pose : bay.processLoops[index - 1]?.pose)?.flow ||
						step.connectionId !== null ||
						step.connectionRole !== null ||
						step.targetAnchor !== null ||
						step.junctions !== null ||
						step.addedEdges < 1,
				)
			) {
				return false;
			}
			cursor += 3;
		}
	}
	return cursor === steps.length;
}

function preparedStepMatchesAssemblyOperation(
	step: PreparedSyntheticFabStarter["steps"][number] | undefined,
	operation: SyntheticFabAssemblyOperation,
): boolean {
	if (!step || step.ordinal < 1 || step.label !== operation.label || step.addedEdges < 1)
		return false;
	if (operation.kind === "link") {
		return (
			step.kind === "network-link" &&
			step.templateId === "network-link" &&
			step.hierarchyRole === "network-link" &&
			step.entityId === null &&
			step.connectionId === operation.id &&
			step.connectionRole === operation.role &&
			step.bayCount === 0 &&
			step.bayIds.length === 0 &&
			step.targetAnchor !== null &&
			step.junctions !== null &&
			step.pose === null &&
			step.outboundTurns === 0 &&
			step.returnTurns === 0
		);
	}
	if (operation.kind === "process-trunk") {
		return (
			step.kind === "network-link" &&
			step.templateId === "network-link" &&
			step.hierarchyRole === "process-wing" &&
			step.entityId === operation.wingId &&
			step.connectionId === operation.id &&
			step.connectionRole === "process-row" &&
			step.bayCount === operation.wing.profile.bayCount &&
			step.bayIds.length === operation.wing.profile.bays.length &&
			step.bayIds.every((bayId, index) => bayId === operation.wing.profile.bays[index]?.id) &&
			step.anchor.x === operation.sourceRun.anchor.x &&
			step.anchor.y === operation.sourceRun.anchor.y &&
			step.targetAnchor?.x === operation.targetRun.anchor.x &&
			step.targetAnchor.y === operation.targetRun.anchor.y &&
			junctionsEqual(step.junctions, operation.exactJunctions) &&
			step.pose === null &&
			step.outboundTurns === 0 &&
			step.returnTurns === 0
		);
	}
	if (
		step.kind !== "template" ||
		step.templateId !== "outer-loop" ||
		step.hierarchyRole !== operation.role ||
		step.entityId !== operation.id ||
		step.connectionId !== null ||
		step.connectionRole !== null
	) {
		return false;
	}
	const expectedOrigin = operation.loop.origin;
	const expectedFlow = operation.loop.flow;
	return (
		step.anchor.x === expectedOrigin.x &&
		step.anchor.y === expectedOrigin.y &&
		step.targetAnchor === null &&
		step.junctions === null &&
		step.pose?.forward === DIR_E &&
		step.pose.side === "right" &&
		step.pose.flow === expectedFlow &&
		step.outboundTurns === null &&
		step.returnTurns === null &&
		step.bayCount === 0 &&
		step.bayIds.length === 0
	);
}

function preparedSummaryMatchesAssemblyPlan(
	prepared: PreparedSyntheticFabStarter,
	assemblyPlan: SyntheticFabAssemblyPlan | null,
	pairedCirculationPlan: PairedCirculationFabAssemblyPlan | null,
	fullFabPlan: FullFabAssemblyPlan | null,
	parallelHallPlan: ParallelHallFabAssemblyPlan | null,
	centralSpinePlan: CentralSpineFabAssemblyPlan | null,
	productionPlan: ProductionFabAssemblyPlan | null,
): boolean {
	if (pairedCirculationPlan) {
		return (
			prepared.summary.zoneCount === pairedCirculationPlan.banks.length &&
			prepared.summary.bayCount === pairedCirculationPlan.profile.bayCount &&
			prepared.summary.openTerminals === 0 &&
			prepared.summary.strongComponents === 1
		);
	}
	if (fullFabPlan) {
		return (
			prepared.summary.zoneCount === fullFabPlan.banks.length &&
			prepared.summary.bayCount === fullFabPlan.profile.bayCount &&
			prepared.summary.openTerminals === 0 &&
			prepared.summary.strongComponents === 1
		);
	}
	if (parallelHallPlan) {
		return (
			prepared.summary.zoneCount === parallelHallPlan.banks.length &&
			prepared.summary.bayCount === parallelHallPlan.profile.bayCount &&
			prepared.summary.openTerminals === 0 &&
			prepared.summary.strongComponents === 1
		);
	}
	if (centralSpinePlan) {
		return (
			prepared.summary.zoneCount === centralSpinePlan.banks.length &&
			prepared.summary.bayCount === centralSpinePlan.profile.bayCount &&
			prepared.summary.openTerminals === 0 &&
			prepared.summary.strongComponents === 1
		);
	}
	if (productionPlan) {
		return (
			prepared.summary.zoneCount === productionPlan.profile.bankCount &&
			prepared.summary.bayCount === productionPlan.profile.bayCount &&
			prepared.summary.openTerminals === 0 &&
			prepared.summary.strongComponents === 1
		);
	}
	if (!assemblyPlan) return true;
	return (
		prepared.summary.zoneCount === assemblyPlan.layout.wings.length &&
		prepared.summary.bayCount ===
			assemblyPlan.layout.wings.reduce((total, wing) => total + wing.bays.length, 0) &&
		prepared.summary.openTerminals === 0 &&
		prepared.summary.strongComponents === 1
	);
}

function preparedSummaryBoundsMatchSnapshot(prepared: PreparedSyntheticFabStarter): boolean {
	const xs = prepared.snapshot.xs;
	const ys = prepared.snapshot.ys;
	if (xs.length !== ys.length) return false;
	if (xs.length === 0) return prepared.summary.bounds === null;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let index = 0; index < xs.length; index++) {
		const x = xs[index] as number;
		const y = ys[index] as number;
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	const bounds = prepared.summary.bounds;
	return (
		bounds !== null &&
		bounds.minX === minX &&
		bounds.minY === minY &&
		bounds.maxX === maxX &&
		bounds.maxY === maxY &&
		bounds.widthMeters === maxX - minX &&
		bounds.heightMeters === maxY - minY
	);
}

function isPreparedSyntheticFabStarterPayload(prepared: PreparedSyntheticFabStarter): boolean {
	if (!isRecord(prepared) || !isRecord(prepared.request) || !isRecord(prepared.summary)) {
		return false;
	}
	if (
		typeof prepared.requestFingerprint !== "string" ||
		!(prepared.planFingerprint === null || typeof prepared.planFingerprint === "string") ||
		typeof prepared.authoredChecksum !== "string" ||
		!Number.isSafeInteger(prepared.authoredRevision) ||
		prepared.authoredRevision < 0 ||
		typeof prepared.analysisFingerprint !== "string" ||
		typeof prepared.physicalFingerprint !== "string" ||
		typeof prepared.readinessFingerprint !== "string" ||
		typeof prepared.authoringReady !== "boolean" ||
		!Array.isArray(prepared.steps) ||
		!isRailMirrorSnapshotPayload(prepared.snapshot) ||
		!preparedPlacementBundleMatches(prepared)
	) {
		return false;
	}
	for (const field of [
		"zoneCount",
		"bayCount",
		"railCells",
		"directedEdges",
		"physicalPaths",
		"totalLengthMeters",
		"junctions",
		"openTerminals",
		"strongComponents",
	] as const) {
		if (!isFiniteNonnegative(prepared.summary[field])) return false;
	}
	if (
		prepared.summary.bounds !== null &&
		(!isRecord(prepared.summary.bounds) ||
			![
				prepared.summary.bounds.minX,
				prepared.summary.bounds.minY,
				prepared.summary.bounds.maxX,
				prepared.summary.bounds.maxY,
				prepared.summary.bounds.widthMeters,
				prepared.summary.bounds.heightMeters,
			].every(Number.isFinite))
	) {
		return false;
	}
	if (
		!prepared.steps.every(
			(step, index) =>
				isRecord(step) &&
				step.ordinal === index + 1 &&
				typeof step.label === "string" &&
				(step.kind === "template" ||
					step.kind === "paired-corridor" ||
					step.kind === "paired-turnback" ||
					step.kind === "network-link") &&
				typeof step.templateId === "string" &&
				typeof step.hierarchyRole === "string" &&
				(step.entityId === null || typeof step.entityId === "string") &&
				(step.connectionId === null || typeof step.connectionId === "string") &&
				(step.connectionRole === null || typeof step.connectionRole === "string") &&
				typeof step.bayCount === "number" &&
				Number.isSafeInteger(step.bayCount) &&
				step.bayCount >= 0 &&
				Array.isArray(step.bayIds) &&
				step.bayIds.every((bayId) => typeof bayId === "string") &&
				isCell(step.anchor) &&
				(step.targetAnchor === null || isCell(step.targetAnchor)) &&
				(step.junctions === null || isNetworkLinkJunctions(step.junctions)) &&
				(step.pose === null || isRailTemplatePose(step.pose)) &&
				typeof step.addedEdges === "number" &&
				Number.isSafeInteger(step.addedEdges) &&
				step.addedEdges >= 0 &&
				(step.outboundTurns === null || isFiniteNonnegative(step.outboundTurns)) &&
				(step.returnTurns === null || isFiniteNonnegative(step.returnTurns)),
		)
	) {
		return false;
	}
	if (prepared.request.id === "large-fab-60") {
		return (
			prepared.geometry === null &&
			isSyntheticFabStarterRouteGeometry(prepared.exactGeometry, prepared.physicalFingerprint)
		);
	}
	if (prepared.exactGeometry !== null) return false;
	if (prepared.geometry === null) return true;
	return (
		isRecord(prepared.geometry) &&
		isRecord(prepared.geometry.bounds) &&
		[
			prepared.geometry.bounds.minX,
			prepared.geometry.bounds.minY,
			prepared.geometry.bounds.maxX,
			prepared.geometry.bounds.maxY,
		].every(Number.isFinite) &&
		typeof prepared.geometry.pathData === "string" &&
		Number.isFinite(prepared.geometry.markerScale) &&
		prepared.geometry.markerScale > 0 &&
		Array.isArray(prepared.geometry.markers) &&
		prepared.geometry.markers.every(
			(marker) =>
				isRecord(marker) &&
				Number.isFinite(marker.x) &&
				Number.isFinite(marker.y) &&
				Number.isFinite(marker.angleDegrees),
		)
	);
}

function preparedPlacementBundleMatches(prepared: PreparedSyntheticFabStarter): boolean {
	if (prepared.placementBundle === null || prepared.placementBundleFingerprint === null) {
		return prepared.placementBundle === null && prepared.placementBundleFingerprint === null;
	}
	if (typeof prepared.placementBundleFingerprint !== "string") return false;
	if (staticFabOrganizationBundleError(prepared.placementBundle) !== null) return false;
	return (
		staticFabOrganizationBundleFingerprint(prepared.placementBundle) ===
		prepared.placementBundleFingerprint
	);
}

function isCell(value: unknown): value is Readonly<{ x: number; y: number }> {
	return isRecord(value) && Number.isSafeInteger(value.x) && Number.isSafeInteger(value.y);
}

function isNetworkLinkJunctions(value: unknown): value is SyntheticFabAssemblyJunctionContract {
	return (
		isRecord(value) &&
		isCell(value.sourceDeparture) &&
		isCell(value.sourceArrival) &&
		isCell(value.targetArrival) &&
		isCell(value.targetDeparture)
	);
}

function junctionsEqual(
	actual: SyntheticFabAssemblyJunctionContract | null,
	expected: SyntheticFabAssemblyJunctionContract,
): boolean {
	return (
		actual !== null &&
		actual.sourceDeparture.x === expected.sourceDeparture.x &&
		actual.sourceDeparture.y === expected.sourceDeparture.y &&
		actual.sourceArrival.x === expected.sourceArrival.x &&
		actual.sourceArrival.y === expected.sourceArrival.y &&
		actual.targetArrival.x === expected.targetArrival.x &&
		actual.targetArrival.y === expected.targetArrival.y &&
		actual.targetDeparture.x === expected.targetDeparture.x &&
		actual.targetDeparture.y === expected.targetDeparture.y
	);
}

function isRailTemplatePose(
	value: unknown,
): value is Readonly<{ forward: number; side: string; flow?: string }> {
	return (
		isRecord(value) &&
		typeof value.forward === "number" &&
		Number.isSafeInteger(value.forward) &&
		ALL_DIRECTIONS.includes(value.forward as Direction) &&
		(value.side === "left" || value.side === "right") &&
		(value.flow === undefined || value.flow === "forward" || value.flow === "reverse")
	);
}

function isRailMirrorSnapshotPayload(value: unknown): value is RailMirrorSnapshot {
	if (!isRecord(value)) return false;
	return (
		Number.isSafeInteger(value.sequence) &&
		Number.isSafeInteger(value.revision) &&
		Number.isSafeInteger(value.nextAdvancedSwitchId) &&
		value.xs instanceof Int32Array &&
		value.ys instanceof Int32Array &&
		value.encoded instanceof Uint8Array &&
		value.switchIds instanceof Int32Array &&
		isRecord(value.switchRecords) &&
		isRecord(value.portEquipment) &&
		typeof value.checksum === "string"
	);
}

function isFiniteNonnegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSyntheticFabStarterWorkerResponse(
	value: unknown,
): value is SyntheticFabStarterWorkerResponse {
	if (!value || typeof value !== "object") return false;
	const response = value as Partial<SyntheticFabStarterWorkerResponse>;
	if (!Number.isSafeInteger(response.requestId)) return false;
	if (response.type === "SYNTHETIC_FAB_STARTER_PREPARATION_ERROR") {
		return typeof response.message === "string";
	}
	return (
		response.type === "SYNTHETIC_FAB_STARTER_PREPARED" &&
		typeof response.prepared === "object" &&
		response.prepared !== null
	);
}

function normalizeWorkerError(error: unknown, fallback: string): Error {
	return error instanceof Error ? error : new Error(fallback);
}
