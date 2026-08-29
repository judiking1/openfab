import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import {
	RAIL_ASSEMBLY_CONNECTOR_SCALE_BUDGET,
	RAIL_BAY_FLOW_EDIT_SCALE_BUDGET,
	RAIL_SCALE_ACCEPTANCE_VERSION,
	RAIL_SCALE_BUDGETS,
	RAIL_SEMANTIC_BAY_DELETE_SCALE_BUDGET,
} from "./rail-scale-budgets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "rail-scale");
const port = Number(process.env.OPENFAB_SCALE_PORT ?? 5199);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const connectorOnly = process.env.OPENFAB_SCALE_CONNECTOR_ONLY === "1";
const semanticBayOnly = process.env.OPENFAB_SCALE_SEMANTIC_BAY_ONLY === "1";
const bayFlowEditOnly = process.env.OPENFAB_SCALE_BAY_FLOW_EDIT_ONLY === "1";
const coreOnly = process.env.OPENFAB_SCALE_CORE_ONLY === "1";
if ([connectorOnly, semanticBayOnly, bayFlowEditOnly].filter(Boolean).length > 1) {
	throw new Error(
		"OPENFAB_SCALE_CONNECTOR_ONLY, OPENFAB_SCALE_SEMANTIC_BAY_ONLY, and OPENFAB_SCALE_BAY_FLOW_EDIT_ONLY are mutually exclusive.",
	);
}
if (coreOnly && (connectorOnly || semanticBayOnly || bayFlowEditOnly)) {
	throw new Error("OPENFAB_SCALE_CORE_ONLY cannot be combined with a specialized scale-only gate.");
}
const requestedCounts =
	connectorOnly || semanticBayOnly || bayFlowEditOnly
		? []
		: parseRequestedCounts(process.env.OPENFAB_SCALE_COUNTS);
const chromePath = await resolveChromePath();
const server = startPreviewServer();
let browser;
const results = [];
let assemblyConnectorResult = null;
let semanticBayDeleteResult = null;
let bayFlowEditResult = null;

try {
	await waitForServer(`${baseUrl}/`);
	browser = await chromium.launch({
		executablePath: chromePath,
		headless: true,
		args: [
			"--disable-background-timer-throttling",
			"--disable-renderer-backgrounding",
			"--js-flags=--expose-gc",
		],
	});
	for (const cellCount of requestedCounts) {
		results.push(await runScaleScenario(browser, cellCount));
	}
	if (!coreOnly && !semanticBayOnly && !bayFlowEditOnly) {
		assemblyConnectorResult = await runAssemblyConnectorFirstPaintScenario(browser);
	}
	if (!coreOnly && !connectorOnly && !bayFlowEditOnly) {
		semanticBayDeleteResult = await runSemanticBayDeleteScaleScenario(browser);
	}
	if (!coreOnly && !connectorOnly && !semanticBayOnly) {
		bayFlowEditResult = await runBayFlowEditScaleScenario(browser);
	}
} finally {
	await closeBrowserResource(browser, "browser");
	server.kill("SIGTERM");
}

await mkdir(artifactRoot, { recursive: true });
await writeFile(
	path.join(artifactRoot, "results.json"),
	`${JSON.stringify(
		{
			version: RAIL_SCALE_ACCEPTANCE_VERSION,
			results,
			assemblyConnector: assemblyConnectorResult,
			semanticBayDelete: semanticBayDeleteResult,
			bayFlowEdit: bayFlowEditResult,
		},
		null,
		2,
	)}\n`,
);

for (const result of results) {
	const verdict = result.failures.length === 0 ? "PASS" : "FAIL";
	console.log(
		`${verdict} ${result.cellCount.toLocaleString()} cells | ready ${result.readyMilliseconds.toFixed(1)} ms | startup slice ${result.metrics.startupActivationMaxSlicePhase ?? "unknown"} | edit dispatch ${formatMilliseconds(result.commitMetrics.maxDispatchMilliseconds)} | edit ready ${formatMilliseconds(result.commitMetrics.maxReadyMilliseconds)} | post-edit slice ${result.afterMetrics.modelDerivationActivationMaxSlicePhase ?? "unknown"} | long tasks ${result.longTasks.length} | retained heap ${formatBytes(result.retainedHeapGrowthBytes)}`,
	);
	for (const failure of result.failures) console.error(`  - ${failure}`);
}

if (assemblyConnectorResult) {
	const verdict = assemblyConnectorResult.failures.length === 0 ? "PASS" : "FAIL";
	const overlay = assemblyConnectorResult.overlayCameraBenchmark;
	const overlaySummary = overlay
		? ` | overlay ${overlay.frameCount}f ${formatMilliseconds(overlay.incrementalRenderMeanMilliseconds)} mean / ${overlay.overlayRedrawDelta} redraws / ${overlay.routePathStrokeDelta} strokes | overlay retained JS/embedder/backing ${formatBytes(overlay.retainedHeapGrowth.usedSize)}/${formatBytes(overlay.retainedHeapGrowth.embedderHeapUsedSize)}/${formatBytes(overlay.retainedHeapGrowth.backingStorageSize)}`
		: "";
	console.log(
		`${verdict} ${assemblyConnectorResult.cellCount.toLocaleString()} cells | ready ${formatMilliseconds(assemblyConnectorResult.readyMilliseconds)} | Activity→Assemble paint ${formatMilliseconds(assemblyConnectorResult.activityAssembleFirstPaintMilliseconds)} | NEW FAB paint ${formatMilliseconds(assemblyConnectorResult.newFab.firstPaintMilliseconds)} | NEW FAB steps ${Object.values(assemblyConnectorResult.newFab.interactionPaintMilliseconds).map(formatMilliseconds).join("/")} | NEW FAB prepare ${formatMilliseconds(assemblyConnectorResult.newFab.preparationMilliseconds)} | outline ready ${formatMilliseconds(assemblyConnectorResult.organizationOutlineReadyMilliseconds)} | outline hover ${formatMilliseconds(assemblyConnectorResult.organizationOutlineHoverPaintMilliseconds)} | outline clicks ${assemblyConnectorResult.organizationOutlineClickPaintMilliseconds.map(formatMilliseconds).join("/")} | Assemble paint ${formatMilliseconds(assemblyConnectorResult.assembleFirstPaintMilliseconds)} | fast cancel ${formatMilliseconds(assemblyConnectorResult.fastCancelMilliseconds)} | recommendation ${assemblyConnectorResult.largeMapRecommendation.status}/${assemblyConnectorResult.largeMapRecommendation.attempts} | CONNECT BAYS first paint ${formatMilliseconds(assemblyConnectorResult.firstPaintMilliseconds)} | snapshot handoff ${formatMilliseconds(assemblyConnectorResult.snapshotHandoffMilliseconds)} | snapshot ready ${formatMilliseconds(assemblyConnectorResult.snapshotReadyMilliseconds)} | terminal ready ${formatMilliseconds(assemblyConnectorResult.terminalReadyMilliseconds)} | command Long Tasks ${assemblyConnectorResult.longTasks.length}${overlaySummary}`,
	);
	for (const failure of assemblyConnectorResult.failures) console.error(`  - ${failure}`);
}

if (semanticBayDeleteResult) {
	const verdict = semanticBayDeleteResult.failures.length === 0 ? "PASS" : "FAIL";
	console.log(
		`${verdict} ${semanticBayDeleteResult.cellCount.toLocaleString()} cells | ports ${semanticBayDeleteResult.source.documentPortCount}→${semanticBayDeleteResult.result.documentPortCount} / groups ${semanticBayDeleteResult.source.documentEquipmentGroupCount}→${semanticBayDeleteResult.result.documentEquipmentGroupCount} | ready ${formatMilliseconds(semanticBayDeleteResult.readyMilliseconds)} | startup slice ${semanticBayDeleteResult.source.startupActivationMaxSlicePhase ?? "unknown"} | DELETE dispatch ${formatMilliseconds(semanticBayDeleteResult.commandDispatchMilliseconds)} | first paint ${formatMilliseconds(semanticBayDeleteResult.firstPaintMilliseconds)} | certified ${formatMilliseconds(semanticBayDeleteResult.certificationMilliseconds)} | apply dispatch ${formatMilliseconds(semanticBayDeleteResult.applyDispatchMilliseconds)} | mirror ready ${formatMilliseconds(semanticBayDeleteResult.mirrorReadyMilliseconds)} | derive dispatch/prep ${formatMilliseconds(semanticBayDeleteResult.result.modelDerivationDispatchMilliseconds)}/${formatMilliseconds(semanticBayDeleteResult.result.modelDerivationPreparationMilliseconds)} | post-edit slice ${semanticBayDeleteResult.result.modelDerivationActivationMaxSlicePhase ?? "unknown"} | transfer ${formatBytes(semanticBayDeleteResult.transfer.totalBytes)} | retained JS/embedder/backing ${formatBytes(semanticBayDeleteResult.retainedHeapGrowth.usedSize)}/${formatBytes(semanticBayDeleteResult.retainedHeapGrowth.embedderHeapUsedSize)}/${formatBytes(semanticBayDeleteResult.retainedHeapGrowth.backingStorageSize)} | command/apply Long Tasks ${semanticBayDeleteResult.commandLongTasks.length}/${semanticBayDeleteResult.applyLongTasks.length}`,
	);
	for (const failure of semanticBayDeleteResult.failures) console.error(`  - ${failure}`);
}

if (bayFlowEditResult) {
	const verdict = bayFlowEditResult.failures.length === 0 ? "PASS" : "FAIL";
	console.log(
		`${verdict} ${bayFlowEditResult.cellCount.toLocaleString()} cells | ready ${formatMilliseconds(bayFlowEditResult.readyMilliseconds)} | startup slice ${bayFlowEditResult.source.startupActivationMaxSlicePhase ?? "unknown"} | CO-ROTATING dispatch ${formatMilliseconds(bayFlowEditResult.commandDispatchMilliseconds)} | first paint ${formatMilliseconds(bayFlowEditResult.firstPaintMilliseconds)} | certified ${formatMilliseconds(bayFlowEditResult.certificationMilliseconds)} | response/adopt ${formatMilliseconds(bayFlowEditResult.responseValidationMilliseconds)}/${formatMilliseconds(bayFlowEditResult.adoptionMilliseconds)} | apply dispatch ${formatMilliseconds(bayFlowEditResult.applyDispatchMilliseconds)} | mirror ready ${formatMilliseconds(bayFlowEditResult.mirrorReadyMilliseconds)} | post-edit slice ${bayFlowEditResult.result.modelDerivationActivationMaxSlicePhase ?? "unknown"} | transfer ${formatBytes(bayFlowEditResult.transfer.totalBytes)} | retained JS/embedder/backing ${formatBytes(bayFlowEditResult.retainedHeapGrowth.usedSize)}/${formatBytes(bayFlowEditResult.retainedHeapGrowth.embedderHeapUsedSize)}/${formatBytes(bayFlowEditResult.retainedHeapGrowth.backingStorageSize)} | command/apply Long Tasks ${bayFlowEditResult.commandLongTasks.length}/${bayFlowEditResult.applyLongTasks.length}`,
	);
	for (const failure of bayFlowEditResult.failures) console.error(`  - ${failure}`);
}

if (
	results.some((result) => result.failures.length > 0) ||
	(assemblyConnectorResult?.failures.length ?? 0) > 0 ||
	(semanticBayDeleteResult?.failures.length ?? 0) > 0 ||
	(bayFlowEditResult?.failures.length ?? 0) > 0
) {
	process.exitCode = 1;
}
await Promise.all([
	new Promise((resolve) => process.stdout.write("", resolve)),
	new Promise((resolve) => process.stderr.write("", resolve)),
]);
process.exit(process.exitCode ?? 0);

async function runAssemblyConnectorFirstPaintScenario(activeBrowser) {
	const budget = RAIL_ASSEMBLY_CONNECTOR_SCALE_BUDGET;
	const context = await activeBrowser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	await context.addInitScript(() => {
		globalThis.__openFabConnectorScale = {
			longTasks: [],
			errors: [],
			rejections: [],
			longTaskSupported: false,
			longTaskTakeRecordsSupported: false,
			observer: null,
			railMirrorWorkerStarts: 0,
			newFabPreparedWorkerStarts: 0,
			newFabPreparedWorkerTerminations: 0,
			newFabPreparedWorkerRequests: [],
			newFabCurrentMapOperations: null,
			organizationOutlineRequests: [],
			activityAssembleFirstFrameAt: null,
		};
		const NativeWorker = globalThis.Worker;
		const newFabPreparedWorkers = new WeakSet();
		const nativeWorkerPostMessage = NativeWorker.prototype.postMessage;
		const nativeWorkerTerminate = NativeWorker.prototype.terminate;
		NativeWorker.prototype.postMessage = function (...argumentsList) {
			const message = argumentsList[0];
			if (newFabPreparedWorkers.has(this)) {
				globalThis.__openFabConnectorScale.newFabPreparedWorkerRequests.push({
					at: performance.now(),
					type: message?.type ?? "",
					requestId: message?.requestId ?? null,
					requestFingerprint: message?.requestFingerprint ?? "",
				});
			}
			if (message?.type === "CAPTURE_STATIC_FAB_ORGANIZATION_OUTLINE") {
				globalThis.__openFabConnectorScale.organizationOutlineRequests.push({
					at: performance.now(),
					requestId: message.requestId,
					epoch: message.epoch,
					expectedSequence: message.expectedSequence,
					expectedRevision: message.expectedRevision,
					expectedChecksum: message.expectedChecksum,
					expectedNextAdvancedSwitchId: message.expectedNextAdvancedSwitchId,
					expectedNextPortId: message.expectedNextPortId,
					expectedNextEquipmentGroupId: message.expectedNextEquipmentGroupId,
					expectedNextOrganizationId: message.expectedNextOrganizationId,
					expectedPhysicalSequence: message.expectedPhysicalSequence,
					expectedPhysicalRevision: message.expectedPhysicalRevision,
					expectedPhysicalFingerprint: message.expectedPhysicalFingerprint,
				});
			}
			return Reflect.apply(nativeWorkerPostMessage, this, argumentsList);
		};
		NativeWorker.prototype.terminate = function (...argumentsList) {
			if (newFabPreparedWorkers.delete(this)) {
				globalThis.__openFabConnectorScale.newFabPreparedWorkerTerminations++;
			}
			return Reflect.apply(nativeWorkerTerminate, this, argumentsList);
		};
		globalThis.Worker = new Proxy(NativeWorker, {
			construct(target, argumentsList) {
				const source = String(argumentsList[0] ?? "");
				const worker = Reflect.construct(target, argumentsList);
				if (/railMirrorWorker/i.test(source)) {
					globalThis.__openFabConnectorScale.railMirrorWorkerStarts++;
				}
				if (/openFabFabPreparedProjectWorker/i.test(source)) {
					globalThis.__openFabConnectorScale.newFabPreparedWorkerStarts++;
					newFabPreparedWorkers.add(worker);
				}
				return worker;
			},
		});
		if (typeof PerformanceObserver !== "undefined") {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					globalThis.__openFabConnectorScale.longTasks.push({
						startTime: entry.startTime,
						duration: entry.duration,
					});
				}
			});
			try {
				observer.observe({ type: "longtask", buffered: true });
				globalThis.__openFabConnectorScale.longTaskSupported = true;
				globalThis.__openFabConnectorScale.longTaskTakeRecordsSupported =
					typeof observer.takeRecords === "function";
				globalThis.__openFabConnectorScale.observer = observer;
			} catch {
				// Unsupported browsers are rejected below.
			}
		}
		addEventListener("error", (event) => {
			globalThis.__openFabConnectorScale.errors.push(String(event.error?.message ?? event.message));
		});
		addEventListener("unhandledrejection", (event) => {
			globalThis.__openFabConnectorScale.rejections.push(String(event.reason));
		});
	});
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	const consoleErrors = [];
	const pageErrors = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const result = {
		cellCount: budget.cellCount,
		readyMilliseconds: Number.POSITIVE_INFINITY,
		newFab: {
			firstPaintMilliseconds: Number.POSITIVE_INFINITY,
			interactionPaintMilliseconds: {},
			interactionLongTasks: {},
			longTaskSupported: false,
			longTaskTakeRecordsSupported: false,
			preparationMilliseconds: Number.POSITIVE_INFINITY,
			preparationLongTasks: [],
			preparedWorkerStartDelta: Number.POSITIVE_INFINITY,
			preparedWorkerTerminationDelta: Number.POSITIVE_INFINITY,
			preparedWorkerRequestTypes: [],
			currentMapOperationsBeforePrepare: {},
			currentMapOperationsAfterPrepare: {},
			preparedState: "",
			preparedStatusText: "",
			preparedCreateVisible: false,
			preparedCreateEnabled: false,
		},
		activityAssembleFirstPaintMilliseconds: Number.POSITIVE_INFINITY,
		activityAssembleLongTasks: [],
		activityAssembleFocusRestored: false,
		organizationOutlineReadyMilliseconds: Number.POSITIVE_INFINITY,
		organizationOutlineStatus: "",
		organizationOutlineCount: 0,
		organizationOutlineBytes: 0,
		organizationOutlineRequestCount: 0,
		organizationOutlineRequestedAfterFirstPaint: false,
		organizationOutlineRequests: [],
		organizationOutlineHoverPaintMilliseconds: Number.POSITIVE_INFINITY,
		organizationOutlineClickPaintMilliseconds: [],
		organizationOutlineSelectionIds: "",
		organizationCanvasActionFocusRestored: false,
		organizationOutlineLongTasks: [],
		organizationCanvasSelectionLongTasks: [],
		organizationExactMaterializationsBefore: Number.POSITIVE_INFINITY,
		organizationExactMaterializationsAfter: Number.POSITIVE_INFINITY,
		assembleFirstPaintMilliseconds: Number.POSITIVE_INFINITY,
		assembleLongTasks: [],
		fastCancelMilliseconds: Number.POSITIVE_INFINITY,
		fastCancelLongTasks: [],
		fastCancelWorkerRestarts: Number.POSITIVE_INFINITY,
		fastCancelErrors: [],
		fastCancelRejections: [],
		largeMapRecommendation: null,
		firstPaintMilliseconds: Number.POSITIVE_INFINITY,
		snapshotHandoffMilliseconds: Number.POSITIVE_INFINITY,
		hydrationMilliseconds: Number.POSITIVE_INFINITY,
		snapshotReadyMilliseconds: Number.POSITIVE_INFINITY,
		terminalReadyMilliseconds: Number.POSITIVE_INFINITY,
		longTasks: [],
		fastSelectionSnapshotStatus: "",
		deferredVerification: false,
		verificationPhase: "",
		verificationReason: "",
		overlayCameraBenchmark: null,
		interactionMatrix: null,
		diagnostics: null,
		failures: [],
	};
	const directory = path.join(artifactRoot, "assembly-connector-100001");
	await mkdir(directory, { recursive: true });

	try {
		const readyStartedAt = performance.now();
		await page.goto(`${baseUrl}/?scaleFixture=${budget.cellCount}&scaleRoots=4`, {
			waitUntil: "domcontentloaded",
			timeout: budget.readyMilliseconds,
		});
		await page.waitForFunction(
			(expectedCount) => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				if (!canvas) return false;
				const startupMessage = canvas.dataset.startupMessage ?? "";
				return (
					startupMessage !== "" ||
					(app?.dataset.startupStatus === "ready" &&
						canvas.dataset.workerStatus === "ready" &&
						Number(canvas.dataset.workerCells) === expectedCount &&
						Number(canvas.dataset.physicalPaths) === expectedCount &&
						Number(canvas.dataset.staticFabOrganizationCount) === 4)
				);
			},
			budget.cellCount,
			{ timeout: budget.readyMilliseconds },
		);
		result.readyMilliseconds = performance.now() - readyStartedAt;
		const startupFailure = await page
			.locator('[data-testid="rail-canvas"]')
			.evaluate((canvas) => canvas.dataset.startupMessage ?? "");
		if (startupFailure) throw new Error(`100k+ fixture startup failed: ${startupFailure}`);

		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const organizationCanvasPoints = await prepareAssemblyOrganizationCanvasViewport(page);
		const assembleMenu = page.locator('[data-testid="static-fab-assemble-menu"]');
		const activityAssembleProbe = await page.evaluate(() => {
			const button = document.querySelector('[data-testid="editor-activity-assemble"]');
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const scale = globalThis.__openFabConnectorScale;
			const api = globalThis.__tileFab;
			if (
				!(button instanceof HTMLButtonElement) ||
				!(app instanceof HTMLElement) ||
				!(canvas instanceof HTMLCanvasElement)
			) {
				throw new Error("The Assemble activity, app, or Rail Canvas is missing.");
			}
			button.focus({ preventScroll: true });
			const startedAt = performance.now();
			const baseline = {
				modelGeneration: Number(canvas.dataset.modelGeneration),
				authoredChecksum: api?.getEditorModel?.().authoredChecksum ?? "",
				workerEpoch: Number(canvas.dataset.workerEpoch),
				workerSequence: Number(canvas.dataset.workerSequence),
				workerRevision: Number(canvas.dataset.workerRevision),
				workerChecksum: canvas.dataset.workerChecksum ?? "",
				workerCells: Number(canvas.dataset.workerCells),
				workerPhysicalSequence: Number(canvas.dataset.workerPhysicalSequence),
				workerPhysicalRevision: Number(canvas.dataset.workerPhysicalRevision),
				workerPhysicalFingerprint: canvas.dataset.workerPhysicalFingerprint ?? "",
				workerPhysicalPaths: Number(canvas.dataset.workerPhysicalPaths),
				staticRedraws: Number(canvas.dataset.staticRedraws),
				physicalBindings: Number(canvas.dataset.physicalBindings),
				physicalPresentationBuilds: Number(canvas.dataset.physicalPresentationBuilds),
				physicalPreparedArtifactBindings: Number(canvas.dataset.physicalPreparedArtifactBindings),
				portSlotPreparedArtifactBindings: Number(canvas.dataset.portSlotPreparedArtifactBindings),
				draftCommittedPreparedBindings: Number(canvas.dataset.draftCommittedPreparedBindings),
				organizationOutlineStatus: app.dataset.organizationOutlineStatus ?? "",
				organizationOutlineRequestCount: Number(app.dataset.organizationOutlineRequestCount),
				organizationOutlineRequests: scale?.organizationOutlineRequests?.length ?? -1,
				railMirrorWorkerStarts: scale?.railMirrorWorkerStarts ?? -1,
			};
			button.click();
			requestAnimationFrame(() => {
				if (scale) scale.activityAssembleFirstFrameAt = performance.now();
			});
			return { startedAt, baseline };
		});
		await assembleMenu.waitFor({
			state: "visible",
			timeout: budget.assembleFirstPaintMilliseconds * 4,
		});
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const activityAssembleMetrics = await page.evaluate(({ startedAt }) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const scale = globalThis.__openFabConnectorScale;
			const api = globalThis.__tileFab;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			return {
				milliseconds: performance.now() - startedAt,
				activity: app?.getAttribute("data-editor-activity") ?? "",
				focusedTestId: document.activeElement?.getAttribute("data-testid") ?? "",
				modelGeneration: Number(canvas?.dataset.modelGeneration),
				authoredChecksum: api?.getEditorModel?.().authoredChecksum ?? "",
				workerEpoch: Number(canvas?.dataset.workerEpoch),
				workerSequence: Number(canvas?.dataset.workerSequence),
				workerRevision: Number(canvas?.dataset.workerRevision),
				workerChecksum: canvas?.dataset.workerChecksum ?? "",
				workerCells: Number(canvas?.dataset.workerCells),
				workerPhysicalSequence: Number(canvas?.dataset.workerPhysicalSequence),
				workerPhysicalRevision: Number(canvas?.dataset.workerPhysicalRevision),
				workerPhysicalFingerprint: canvas?.dataset.workerPhysicalFingerprint ?? "",
				workerPhysicalPaths: Number(canvas?.dataset.workerPhysicalPaths),
				staticRedraws: Number(canvas?.dataset.staticRedraws),
				physicalBindings: Number(canvas?.dataset.physicalBindings),
				physicalPresentationBuilds: Number(canvas?.dataset.physicalPresentationBuilds),
				physicalPreparedArtifactBindings: Number(canvas?.dataset.physicalPreparedArtifactBindings),
				portSlotPreparedArtifactBindings: Number(canvas?.dataset.portSlotPreparedArtifactBindings),
				draftCommittedPreparedBindings: Number(canvas?.dataset.draftCommittedPreparedBindings),
				railMirrorWorkerStarts: scale?.railMirrorWorkerStarts ?? -1,
				activityAssembleFirstFrameAt: scale?.activityAssembleFirstFrameAt ?? null,
				organizationOutlineRequests: [...(scale?.organizationOutlineRequests ?? [])],
				longTaskSupported: scale?.longTaskSupported ?? false,
				longTasks: (scale?.longTasks ?? []).filter(
					(entry) => entry.startTime + entry.duration >= startedAt,
				),
			};
		}, activityAssembleProbe);
		result.activityAssembleFirstPaintMilliseconds = activityAssembleMetrics.milliseconds;
		result.activityAssembleLongTasks = activityAssembleMetrics.longTasks;
		assertAtMost(
			result.failures,
			activityAssembleMetrics.milliseconds,
			budget.assembleFirstPaintMilliseconds,
			"100k+ Activity-to-Assemble first paint",
		);
		assertEqual(
			result.failures,
			activityAssembleMetrics.longTaskSupported,
			true,
			"Activity-to-Assemble Long Task observer support",
		);
		assertEqual(
			result.failures,
			activityAssembleMetrics.longTasks.length,
			0,
			"Activity-to-Assemble main-thread Long Tasks",
		);
		assertEqual(
			result.failures,
			activityAssembleMetrics.activity,
			"assemble",
			"Activity-to-Assemble published activity",
		);
		assertEqual(
			result.failures,
			activityAssembleMetrics.focusedTestId,
			"fab-preset-browser",
			"Activity-to-Assemble first action focus",
		);
		assertEqual(
			result.failures,
			activityAssembleProbe.baseline.organizationOutlineStatus,
			"idle",
			"organization outline remains idle before Assemble",
		);
		assertEqual(
			result.failures,
			activityAssembleProbe.baseline.organizationOutlineRequestCount,
			0,
			"organization outline request count before Assemble",
		);
		assertEqual(
			result.failures,
			activityAssembleProbe.baseline.organizationOutlineRequests,
			0,
			"organization outline Worker requests before Assemble",
		);
		assertAtLeast(
			result.failures,
			activityAssembleProbe.baseline.railMirrorWorkerStarts,
			1,
			"Activity-to-Assemble baseline Rail mirror Worker starts",
		);
		assertEqual(
			result.failures,
			activityAssembleProbe.baseline.workerChecksum.length > 0,
			true,
			"Activity-to-Assemble baseline Worker checksum",
		);
		assertEqual(
			result.failures,
			activityAssembleProbe.baseline.authoredChecksum.length > 0,
			true,
			"Activity-to-Assemble baseline authored checksum",
		);
		assertEqual(
			result.failures,
			activityAssembleProbe.baseline.authoredChecksum,
			activityAssembleProbe.baseline.workerChecksum,
			"Activity-to-Assemble authored/Worker checksum parity",
		);
		assertEqual(
			result.failures,
			activityAssembleProbe.baseline.workerPhysicalFingerprint.length > 0,
			true,
			"Activity-to-Assemble baseline physical fingerprint",
		);
		for (const [label, value] of [
			["model generation", activityAssembleProbe.baseline.modelGeneration],
			["Worker epoch", activityAssembleProbe.baseline.workerEpoch],
			["Worker sequence", activityAssembleProbe.baseline.workerSequence],
			["Worker revision", activityAssembleProbe.baseline.workerRevision],
			["Worker cells", activityAssembleProbe.baseline.workerCells],
			["Worker physical sequence", activityAssembleProbe.baseline.workerPhysicalSequence],
			["Worker physical revision", activityAssembleProbe.baseline.workerPhysicalRevision],
			["Worker physical paths", activityAssembleProbe.baseline.workerPhysicalPaths],
			["Canvas static redraws", activityAssembleProbe.baseline.staticRedraws],
			["physical artifact bindings", activityAssembleProbe.baseline.physicalBindings],
			["physical presentation builds", activityAssembleProbe.baseline.physicalPresentationBuilds],
			[
				"prepared physical artifact bindings",
				activityAssembleProbe.baseline.physicalPreparedArtifactBindings,
			],
			[
				"prepared port-slot artifact bindings",
				activityAssembleProbe.baseline.portSlotPreparedArtifactBindings,
			],
			[
				"prepared draft artifact bindings",
				activityAssembleProbe.baseline.draftCommittedPreparedBindings,
			],
		]) {
			assertEqual(
				result.failures,
				Number.isFinite(value),
				true,
				`Activity-to-Assemble baseline ${label}`,
			);
		}
		for (const [label, actual, expected] of [
			[
				"model generation",
				activityAssembleMetrics.modelGeneration,
				activityAssembleProbe.baseline.modelGeneration,
			],
			[
				"authored checksum",
				activityAssembleMetrics.authoredChecksum,
				activityAssembleProbe.baseline.authoredChecksum,
			],
			[
				"Rail mirror Worker starts",
				activityAssembleMetrics.railMirrorWorkerStarts,
				activityAssembleProbe.baseline.railMirrorWorkerStarts,
			],
			[
				"Worker epoch",
				activityAssembleMetrics.workerEpoch,
				activityAssembleProbe.baseline.workerEpoch,
			],
			[
				"Worker sequence",
				activityAssembleMetrics.workerSequence,
				activityAssembleProbe.baseline.workerSequence,
			],
			[
				"Worker revision",
				activityAssembleMetrics.workerRevision,
				activityAssembleProbe.baseline.workerRevision,
			],
			[
				"Worker checksum",
				activityAssembleMetrics.workerChecksum,
				activityAssembleProbe.baseline.workerChecksum,
			],
			[
				"Worker cells",
				activityAssembleMetrics.workerCells,
				activityAssembleProbe.baseline.workerCells,
			],
			[
				"Worker physical sequence",
				activityAssembleMetrics.workerPhysicalSequence,
				activityAssembleProbe.baseline.workerPhysicalSequence,
			],
			[
				"Worker physical revision",
				activityAssembleMetrics.workerPhysicalRevision,
				activityAssembleProbe.baseline.workerPhysicalRevision,
			],
			[
				"Worker physical fingerprint",
				activityAssembleMetrics.workerPhysicalFingerprint,
				activityAssembleProbe.baseline.workerPhysicalFingerprint,
			],
			[
				"Worker physical paths",
				activityAssembleMetrics.workerPhysicalPaths,
				activityAssembleProbe.baseline.workerPhysicalPaths,
			],
			[
				"Canvas static redraws",
				activityAssembleMetrics.staticRedraws,
				activityAssembleProbe.baseline.staticRedraws,
			],
			[
				"physical artifact bindings",
				activityAssembleMetrics.physicalBindings,
				activityAssembleProbe.baseline.physicalBindings,
			],
			[
				"physical presentation builds",
				activityAssembleMetrics.physicalPresentationBuilds,
				activityAssembleProbe.baseline.physicalPresentationBuilds,
			],
			[
				"prepared physical artifact bindings",
				activityAssembleMetrics.physicalPreparedArtifactBindings,
				activityAssembleProbe.baseline.physicalPreparedArtifactBindings,
			],
			[
				"prepared port-slot artifact bindings",
				activityAssembleMetrics.portSlotPreparedArtifactBindings,
				activityAssembleProbe.baseline.portSlotPreparedArtifactBindings,
			],
			[
				"prepared draft artifact bindings",
				activityAssembleMetrics.draftCommittedPreparedBindings,
				activityAssembleProbe.baseline.draftCommittedPreparedBindings,
			],
		]) {
			assertEqual(result.failures, actual, expected, `Activity-to-Assemble ${label}`);
		}
		await page.waitForFunction(
			() => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				return (
					app?.dataset.organizationOutlineStatus === "ready" ||
					app?.dataset.organizationOutlineStatus === "error"
				);
			},
			undefined,
			{ timeout: budget.organizationOutlineReadyMilliseconds },
		);
		result.organizationOutlineReadyMilliseconds = await page.evaluate(
			(startedAt) => performance.now() - startedAt,
			activityAssembleProbe.startedAt,
		);
		await page.waitForFunction(
			() =>
				Number(
					document.querySelector('[data-testid="rail-canvas"]')?.dataset
						.organizationOutlineBindings,
				) >= 1,
			undefined,
			{ timeout: 2_000 },
		);
		const organizationOutlineMetrics = await page.evaluate(({ startedAt }) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const scale = globalThis.__openFabConnectorScale;
			const api = globalThis.__tileFab;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			const documentModel = api?.getDocument?.();
			return {
				status: app?.dataset.organizationOutlineStatus ?? "",
				count: Number(app?.dataset.organizationOutlineCount),
				bytes: Number(app?.dataset.organizationOutlineBytes),
				requestCount: Number(app?.dataset.organizationOutlineRequestCount),
				lastMilliseconds: Number(app?.dataset.organizationOutlineLastMs),
				selectionEnabled: app?.dataset.organizationOutlineSelectionEnabled ?? "",
				outlineBindings: Number(canvas?.dataset.organizationOutlineBindings),
				outlineVisibleRows: Number(canvas?.dataset.organizationOutlineVisibleRows),
				requests: [...(scale?.organizationOutlineRequests ?? [])],
				firstFrameAt: scale?.activityAssembleFirstFrameAt ?? null,
				modelGeneration: Number(canvas?.dataset.modelGeneration),
				authoredChecksum: api?.getEditorModel?.().authoredChecksum ?? "",
				workerEpoch: Number(canvas?.dataset.workerEpoch),
				workerSequence: Number(canvas?.dataset.workerSequence),
				workerRevision: Number(canvas?.dataset.workerRevision),
				workerChecksum: canvas?.dataset.workerChecksum ?? "",
				workerCells: Number(canvas?.dataset.workerCells),
				workerPhysicalSequence: Number(canvas?.dataset.workerPhysicalSequence),
				workerPhysicalRevision: Number(canvas?.dataset.workerPhysicalRevision),
				workerPhysicalFingerprint: canvas?.dataset.workerPhysicalFingerprint ?? "",
				workerPhysicalPaths: Number(canvas?.dataset.workerPhysicalPaths),
				staticRedraws: Number(canvas?.dataset.staticRedraws),
				physicalBindings: Number(canvas?.dataset.physicalBindings),
				physicalPresentationBuilds: Number(canvas?.dataset.physicalPresentationBuilds),
				physicalPreparedArtifactBindings: Number(canvas?.dataset.physicalPreparedArtifactBindings),
				portSlotPreparedArtifactBindings: Number(canvas?.dataset.portSlotPreparedArtifactBindings),
				draftCommittedPreparedBindings: Number(canvas?.dataset.draftCommittedPreparedBindings),
				railMirrorWorkerStarts: scale?.railMirrorWorkerStarts ?? -1,
				documentRevision: Number(documentModel?.map?.getRevision?.()),
				documentPatchSequence: Number(documentModel?.getPatchSequence?.()),
				documentCanUndo: documentModel?.canUndo ?? null,
				documentCanRedo: documentModel?.canRedo ?? null,
				historyCanUndo: app?.dataset.historyCanUndo ?? "",
				historyCanRedo: app?.dataset.historyCanRedo ?? "",
				projectDirty: app?.dataset.projectDirty ?? "",
				exactMaterializations: Number(canvas?.dataset.organizationExactMaterializations),
				longTaskSupported: scale?.longTaskSupported ?? false,
				longTasks: (scale?.longTasks ?? []).filter(
					(entry) => entry.startTime + entry.duration >= startedAt,
				),
			};
		}, activityAssembleProbe);
		Object.assign(result, {
			organizationOutlineStatus: organizationOutlineMetrics.status,
			organizationOutlineCount: organizationOutlineMetrics.count,
			organizationOutlineBytes: organizationOutlineMetrics.bytes,
			organizationOutlineRequestCount: organizationOutlineMetrics.requestCount,
			organizationOutlineRequests: organizationOutlineMetrics.requests,
			organizationOutlineLongTasks: organizationOutlineMetrics.longTasks,
			organizationExactMaterializationsBefore: organizationOutlineMetrics.exactMaterializations,
		});
		assertAtMost(
			result.failures,
			result.organizationOutlineReadyMilliseconds,
			budget.organizationOutlineReadyMilliseconds,
			"100k+ organization outline ready",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.status,
			"ready",
			"organization outline status",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.count,
			budget.organizationOutlineCount,
			"organization outline semantic row count",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.bytes,
			budget.organizationOutlineBytes,
			"organization outline retained typed bytes",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.requestCount,
			budget.organizationOutlineRequestCount,
			"organization outline UI request count",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.requests.length,
			budget.organizationOutlineRequestCount,
			"organization outline Worker request count",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.selectionEnabled,
			"true",
			"organization outline Canvas selection enabled",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.outlineBindings,
			1,
			"organization outline renderer binding count",
		);
		assertAtLeast(
			result.failures,
			organizationOutlineMetrics.outlineVisibleRows,
			budget.organizationOutlineCount,
			"organization outline visible rows",
		);
		assertAtMost(
			result.failures,
			organizationOutlineMetrics.lastMilliseconds,
			budget.organizationOutlineReadyMilliseconds,
			"organization outline Worker request duration",
		);
		const organizationOutlineRequest = organizationOutlineMetrics.requests[0];
		result.organizationOutlineRequestedAfterFirstPaint = Boolean(
			organizationOutlineRequest &&
				Number.isFinite(organizationOutlineMetrics.firstFrameAt) &&
				organizationOutlineRequest.at >= organizationOutlineMetrics.firstFrameAt,
		);
		assertEqual(
			result.failures,
			result.organizationOutlineRequestedAfterFirstPaint,
			true,
			"organization outline request starts after Activity first paint",
		);
		if (organizationOutlineRequest) {
			for (const [label, actual, expected] of [
				["epoch", organizationOutlineRequest.epoch, activityAssembleProbe.baseline.workerEpoch],
				[
					"source sequence",
					organizationOutlineRequest.expectedSequence,
					activityAssembleProbe.baseline.workerSequence,
				],
				[
					"source revision",
					organizationOutlineRequest.expectedRevision,
					activityAssembleProbe.baseline.workerRevision,
				],
				[
					"source checksum",
					organizationOutlineRequest.expectedChecksum,
					activityAssembleProbe.baseline.workerChecksum,
				],
				["advanced-switch cursor", organizationOutlineRequest.expectedNextAdvancedSwitchId, 1],
				["port cursor", organizationOutlineRequest.expectedNextPortId, 1],
				["equipment-group cursor", organizationOutlineRequest.expectedNextEquipmentGroupId, 1],
				["organization cursor", organizationOutlineRequest.expectedNextOrganizationId, 5],
				[
					"physical sequence",
					organizationOutlineRequest.expectedPhysicalSequence,
					activityAssembleProbe.baseline.workerPhysicalSequence,
				],
				[
					"physical revision",
					organizationOutlineRequest.expectedPhysicalRevision,
					activityAssembleProbe.baseline.workerPhysicalRevision,
				],
				[
					"physical fingerprint",
					organizationOutlineRequest.expectedPhysicalFingerprint,
					activityAssembleProbe.baseline.workerPhysicalFingerprint,
				],
			]) {
				assertEqual(result.failures, actual, expected, `organization outline exact ${label}`);
			}
		}
		assertEqual(
			result.failures,
			organizationOutlineMetrics.longTaskSupported,
			true,
			"organization outline Long Task observer support",
		);
		assertEqual(
			result.failures,
			organizationOutlineMetrics.longTasks.length,
			0,
			"organization outline main-thread Long Tasks",
		);
		assertAssemblyOrganizationSourceUnchanged(
			result.failures,
			activityAssembleProbe.baseline,
			organizationOutlineMetrics,
			"organization outline adoption",
		);
		result.newFab = await exerciseNewFabProfileScaleGate(page, budget, result.failures);
		await page.keyboard.press("Escape");
		await assembleMenu.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() => document.activeElement?.getAttribute("data-testid") === "editor-activity-assemble",
			undefined,
			{ timeout: 10_000 },
		);
		result.activityAssembleFocusRestored = true;

		const assembleProbe = await page.evaluate(() => {
			const button = document.querySelector('[data-testid="editor-activity-assemble"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			if (!(button instanceof HTMLButtonElement) || !(canvas instanceof HTMLCanvasElement)) {
				throw new Error("The task-first Assemble launcher or Rail Canvas is missing.");
			}
			const startedAt = performance.now();
			button.click();
			return {
				startedAt,
				physicalBindings: Number(canvas.dataset.physicalBindings),
				physicalPresentationBuilds: Number(canvas.dataset.physicalPresentationBuilds),
			};
		});
		await assembleMenu.waitFor({
			state: "visible",
			timeout: budget.assembleFirstPaintMilliseconds * 4,
		});
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const assembleMetrics = await page.evaluate(({ startedAt }) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const scale = globalThis.__openFabConnectorScale;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			return {
				milliseconds: performance.now() - startedAt,
				physicalBindings: Number(canvas?.dataset.physicalBindings),
				physicalPresentationBuilds: Number(canvas?.dataset.physicalPresentationBuilds),
				longTaskSupported: scale?.longTaskSupported ?? false,
				longTasks: (scale?.longTasks ?? []).filter(
					(entry) => entry.startTime + entry.duration >= startedAt,
				),
			};
		}, assembleProbe);
		result.assembleFirstPaintMilliseconds = assembleMetrics.milliseconds;
		result.assembleLongTasks = assembleMetrics.longTasks;
		assertAtMost(
			result.failures,
			assembleMetrics.milliseconds,
			budget.assembleFirstPaintMilliseconds,
			"task-first Assemble home first paint",
		);
		assertEqual(
			result.failures,
			assembleMetrics.longTaskSupported,
			true,
			"Assemble home Long Task observer support",
		);
		assertEqual(
			result.failures,
			assembleMetrics.longTasks.length,
			0,
			"task-first Assemble home main-thread Long Tasks",
		);
		assertEqual(
			result.failures,
			assembleMetrics.physicalBindings,
			assembleProbe.physicalBindings,
			"Assemble home physical artifact bindings",
		);
		assertEqual(
			result.failures,
			assembleMetrics.physicalPresentationBuilds,
			assembleProbe.physicalPresentationBuilds,
			"Assemble home physical presentation builds",
		);
		await page.locator('[data-testid="assemble-select-on-canvas"]').click();
		await assembleMenu.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
			undefined,
			{ timeout: 10_000 },
		);
		result.organizationCanvasActionFocusRestored = true;

		const organizationCanvasSelection = await exerciseAssemblyOrganizationCanvasSelection(
			page,
			organizationCanvasPoints,
		);
		const completeOrganizationOutlineLongTasks = organizationCanvasSelection.after.longTasks.filter(
			(entry) => entry.startTime + entry.duration >= activityAssembleProbe.startedAt,
		);
		Object.assign(result, {
			organizationOutlineHoverPaintMilliseconds: organizationCanvasSelection.hoverPaintMilliseconds,
			organizationOutlineClickPaintMilliseconds: organizationCanvasSelection.clickPaintMilliseconds,
			organizationOutlineSelectionIds: organizationCanvasSelection.after.selectionIds,
			organizationOutlineLongTasks: completeOrganizationOutlineLongTasks,
			organizationCanvasSelectionLongTasks: organizationCanvasSelection.longTasks,
			organizationExactMaterializationsAfter:
				organizationCanvasSelection.after.exactMaterializations,
		});
		assertAtMost(
			result.failures,
			organizationCanvasSelection.hoverPaintMilliseconds,
			budget.organizationOutlineHoverPaintMilliseconds,
			"organization outline hover input-to-paint",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.before.selectionCount,
			0,
			"organization Canvas selection baseline count",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.before.selectionIds,
			"",
			"organization Canvas selection baseline IDs",
		);
		for (const [
			index,
			milliseconds,
		] of organizationCanvasSelection.clickPaintMilliseconds.entries()) {
			assertAtMost(
				result.failures,
				milliseconds,
				budget.organizationOutlineClickPaintMilliseconds,
				`organization outline click ${index + 1} input-to-paint`,
			);
		}
		assertEqual(
			result.failures,
			organizationCanvasSelection.after.hoverId,
			"3",
			"organization outline final hover Bay",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.after.selectionCount,
			2,
			"organization Canvas selected Bay count",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.after.selectionIds,
			"1,3",
			"organization Canvas selected Bay IDs",
		);
		assertAtLeast(
			result.failures,
			organizationCanvasSelection.after.outlineHitCandidates,
			1,
			"organization outline hit candidates",
		);
		assertEqual(
			result.failures,
			Number.isFinite(organizationCanvasSelection.before.exactMaterializations),
			true,
			"organization exact materialization baseline",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.before.exactMaterializations,
			organizationOutlineMetrics.exactMaterializations,
			"Assemble menu operations exact membership materializations",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.after.exactMaterializations,
			organizationCanvasSelection.before.exactMaterializations,
			"Canvas organization selection exact membership materializations",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.longTaskSupported,
			true,
			"organization Canvas selection Long Task observer support",
		);
		assertEqual(
			result.failures,
			organizationCanvasSelection.longTasks.length,
			0,
			"organization Canvas selection main-thread Long Tasks",
		);
		assertEqual(
			result.failures,
			completeOrganizationOutlineLongTasks.length,
			0,
			"complete organization outline activity main-thread Long Tasks",
		);
		assertAssemblyOrganizationSourceUnchanged(
			result.failures,
			organizationCanvasSelection.before,
			organizationCanvasSelection.after,
			"organization Canvas selection",
		);
		assertAssemblyOrganizationSourceUnchanged(
			result.failures,
			activityAssembleProbe.baseline,
			organizationCanvasSelection.after,
			"complete organization outline activity",
		);
		assertAssemblyOrganizationAuthoredUnchanged(
			result.failures,
			organizationCanvasSelection.before,
			organizationCanvasSelection.after,
			"organization Canvas selection",
		);
		for (const [label, actual, expected] of [
			[
				"SELECT ON CANVAS outline status",
				organizationCanvasSelection.before.outlineStatus,
				organizationOutlineMetrics.status,
			],
			[
				"SELECT ON CANVAS outline count",
				organizationCanvasSelection.before.outlineCount,
				organizationOutlineMetrics.count,
			],
			[
				"SELECT ON CANVAS outline bytes",
				organizationCanvasSelection.before.outlineBytes,
				organizationOutlineMetrics.bytes,
			],
			[
				"SELECT ON CANVAS outline request count",
				organizationCanvasSelection.before.outlineRequestCount,
				organizationOutlineMetrics.requestCount,
			],
			[
				"SELECT ON CANVAS outline Worker requests",
				organizationCanvasSelection.before.outlineWorkerRequests,
				organizationOutlineMetrics.requests.length,
			],
			[
				"outline status",
				organizationCanvasSelection.after.outlineStatus,
				organizationCanvasSelection.before.outlineStatus,
			],
			[
				"outline count",
				organizationCanvasSelection.after.outlineCount,
				organizationCanvasSelection.before.outlineCount,
			],
			[
				"outline bytes",
				organizationCanvasSelection.after.outlineBytes,
				organizationCanvasSelection.before.outlineBytes,
			],
			[
				"outline request count",
				organizationCanvasSelection.after.outlineRequestCount,
				organizationCanvasSelection.before.outlineRequestCount,
			],
			[
				"outline Worker requests",
				organizationCanvasSelection.after.outlineWorkerRequests,
				organizationCanvasSelection.before.outlineWorkerRequests,
			],
		]) {
			assertEqual(result.failures, actual, expected, `organization Canvas selection ${label}`);
		}
		await page.getByTestId("editor-activity-assemble").click();
		await assembleMenu.waitFor({ state: "visible" });
		const connectAfterCanvasSelection = page.locator(
			'[data-testid="assemble-connect-selected-bays"]',
		);
		await connectAfterCanvasSelection.waitFor({ state: "visible" });
		assertEqual(
			result.failures,
			await connectAfterCanvasSelection.isEnabled(),
			true,
			"Canvas-selected Production Bays enable CONNECT BAYS",
		);
		const fastCancelPanel = page.locator('[data-testid="static-fab-assembly-connector-panel"]');
		const fastCancelProbe = await page.evaluate(() => {
			const button = document.querySelector('[data-testid="assemble-connect-selected-bays"]');
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const scale = globalThis.__openFabConnectorScale;
			if (!(button instanceof HTMLButtonElement) || !(canvas instanceof HTMLCanvasElement)) {
				throw new Error("The fast-cancel Connector controls are missing.");
			}
			const startedAt = performance.now();
			button.click();
			const snapshotStatusBeforeCancel = app?.dataset.assemblyConnectorSnapshotStatus ?? "";
			canvas.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Escape",
					code: "Escape",
					bubbles: true,
					cancelable: true,
				}),
			);
			return {
				startedAt,
				snapshotStatusBeforeCancel,
				workerEpoch: Number(canvas.dataset.workerEpoch),
				workerSequence: Number(canvas.dataset.workerSequence),
				workerRevision: Number(canvas.dataset.workerRevision),
				workerChecksum: canvas.dataset.workerChecksum ?? "",
				physicalBindings: Number(canvas.dataset.physicalBindings),
				physicalPresentationBuilds: Number(canvas.dataset.physicalPresentationBuilds),
				railMirrorWorkerStarts: scale?.railMirrorWorkerStarts ?? -1,
			};
		});
		await fastCancelPanel.waitFor({ state: "hidden" });
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const fastCancelMetrics = await page.evaluate((startedAt) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const scale = globalThis.__openFabConnectorScale;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			return {
				milliseconds: performance.now() - startedAt,
				snapshotStatus: app?.dataset.assemblyConnectorSnapshotStatus ?? "",
			};
		}, fastCancelProbe.startedAt);
		result.fastCancelMilliseconds = fastCancelMetrics.milliseconds;
		assertAtMost(
			result.failures,
			fastCancelMetrics.milliseconds,
			budget.fastCancelMilliseconds,
			"100k+ Connector fast cancel feedback",
		);
		assertEqual(
			result.failures,
			fastCancelProbe.snapshotStatusBeforeCancel,
			"requesting",
			"100k+ Connector fast cancel exercises pending snapshot capture",
		);
		assertEqual(
			result.failures,
			fastCancelMetrics.snapshotStatus,
			"cancelled",
			"100k+ Connector fast cancel snapshot status",
		);

		await page.waitForTimeout(budget.abandonedCaptureWatchdogObservationMilliseconds);
		const fastCancelSettled = await page.evaluate((startedAt) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const scale = globalThis.__openFabConnectorScale;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			return {
				snapshotStatus: app?.dataset.assemblyConnectorSnapshotStatus ?? "",
				workerStatus: canvas?.dataset.workerStatus ?? "",
				workerEpoch: Number(canvas?.dataset.workerEpoch),
				workerSequence: Number(canvas?.dataset.workerSequence),
				workerRevision: Number(canvas?.dataset.workerRevision),
				workerChecksum: canvas?.dataset.workerChecksum ?? "",
				physicalBindings: Number(canvas?.dataset.physicalBindings),
				physicalPresentationBuilds: Number(canvas?.dataset.physicalPresentationBuilds),
				railMirrorWorkerStarts: scale?.railMirrorWorkerStarts ?? -1,
				longTasks: (scale?.longTasks ?? []).filter(
					(entry) => entry.startTime + entry.duration >= startedAt,
				),
				errors: scale?.errors ?? [],
				rejections: scale?.rejections ?? [],
			};
		}, fastCancelProbe.startedAt);
		result.fastCancelLongTasks = fastCancelSettled.longTasks;
		result.fastCancelErrors = fastCancelSettled.errors;
		result.fastCancelRejections = fastCancelSettled.rejections;
		result.fastCancelWorkerRestarts =
			fastCancelSettled.railMirrorWorkerStarts - fastCancelProbe.railMirrorWorkerStarts;
		assertEqual(
			result.failures,
			fastCancelSettled.snapshotStatus,
			"cancelled",
			"100k+ Connector cancelled status after watchdog window",
		);
		assertEqual(
			result.failures,
			fastCancelSettled.workerStatus,
			"ready",
			"100k+ Connector healthy mirror after fast cancel",
		);
		for (const [label, actual, expected] of [
			["Worker epoch", fastCancelSettled.workerEpoch, fastCancelProbe.workerEpoch],
			["Worker sequence", fastCancelSettled.workerSequence, fastCancelProbe.workerSequence],
			["Worker revision", fastCancelSettled.workerRevision, fastCancelProbe.workerRevision],
			["Worker checksum", fastCancelSettled.workerChecksum, fastCancelProbe.workerChecksum],
			[
				"physical artifact bindings",
				fastCancelSettled.physicalBindings,
				fastCancelProbe.physicalBindings,
			],
			[
				"physical presentation builds",
				fastCancelSettled.physicalPresentationBuilds,
				fastCancelProbe.physicalPresentationBuilds,
			],
		]) {
			assertEqual(result.failures, actual, expected, `100k+ fast cancel ${label}`);
		}
		assertEqual(
			result.failures,
			result.fastCancelWorkerRestarts,
			0,
			"100k+ fast cancel Rail mirror Worker restarts",
		);
		assertEqual(
			result.failures,
			fastCancelSettled.longTasks.length,
			0,
			"100k+ Connector fast cancel/watchdog main-thread Long Tasks",
		);
		assertEqual(
			result.failures,
			fastCancelSettled.errors.length,
			0,
			"100k+ Connector fast cancel window errors",
		);
		assertEqual(
			result.failures,
			fastCancelSettled.rejections.length,
			0,
			"100k+ Connector fast cancel unhandled rejections",
		);
		assertEqual(
			result.failures,
			consoleErrors.length,
			0,
			"100k+ Connector fast cancel console errors",
		);
		assertEqual(result.failures, pageErrors.length, 0, "100k+ Connector fast cancel page errors");

		await page.reload({ waitUntil: "domcontentloaded", timeout: budget.readyMilliseconds });
		await page.waitForFunction(
			(expectedCount) => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					app?.dataset.startupStatus === "ready" &&
					canvas?.dataset.workerStatus === "ready" &&
					Number(canvas.dataset.workerCells) === expectedCount &&
					Number(canvas.dataset.physicalPaths) === expectedCount &&
					Number(canvas.dataset.staticFabOrganizationCount) === 4
				);
			},
			budget.cellCount,
			{ timeout: budget.readyMilliseconds },
		);
		await selectAssemblyConnectorScaleBays(page);
		result.largeMapRecommendation = await exerciseLargeMapConnectorManualRecommendationPolicy(
			page,
			budget,
			result.failures,
		);
		await selectAssemblyConnectorScaleBays(page);

		const probe = await page.evaluate(() => {
			const button = document.querySelector('[data-testid="connect-static-fab-assemblies"]');
			if (!(button instanceof HTMLButtonElement))
				throw new Error("CONNECT BAYS button is missing.");
			const startedAt = performance.now();
			button.click();
			return { startedAt };
		});
		const panel = page.locator('[data-testid="static-fab-assembly-connector-panel"]');
		await panel.waitFor({
			state: "visible",
			timeout: budget.firstPaintMilliseconds * 4,
		});
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="tilefab-app"]')?.dataset
					.assemblyConnectorFirstPaintMs !== "",
			undefined,
			{ timeout: budget.firstPaintMilliseconds * 4 },
		);
		const initialPhase = await panel.getAttribute("data-phase");
		const initialPanelContract = await panel.evaluate((element) => {
			const source = element.querySelector('[data-gateway="source"] select');
			const target = element.querySelector('[data-gateway="target"] select');
			const cancel = element.querySelector(".tilefab-assembly-connector-cancel");
			const apply = element.querySelector(".tilefab-assembly-connector-apply");
			return {
				shortcuts: element.getAttribute("aria-keyshortcuts") ?? "",
				sourceValue: source instanceof HTMLSelectElement ? source.value : "missing",
				sourcePlaceholder:
					source instanceof HTMLSelectElement ? (source.options[0]?.textContent ?? "") : "missing",
				targetValue: target instanceof HTMLSelectElement ? target.value : "missing",
				targetPlaceholder:
					target instanceof HTMLSelectElement ? (target.options[0]?.textContent ?? "") : "missing",
				targetDisabled: target instanceof HTMLSelectElement ? target.disabled : false,
				cancelShortcuts: cancel?.getAttribute("aria-keyshortcuts") ?? "",
				applyShortcuts: apply?.getAttribute("aria-keyshortcuts") ?? "",
			};
		});
		for (const [label, actual, expected] of [
			["panel aria-keyshortcuts", initialPanelContract.shortcuts, "Q E Escape Enter"],
			["source placeholder value", initialPanelContract.sourceValue, ""],
			["source placeholder label", initialPanelContract.sourcePlaceholder, "SELECT GATEWAY"],
			["target placeholder value", initialPanelContract.targetValue, ""],
			["target placeholder label", initialPanelContract.targetPlaceholder, "SELECT GATEWAY"],
			["target placeholder disabled", initialPanelContract.targetDisabled, true],
			["Cancel aria-keyshortcuts", initialPanelContract.cancelShortcuts, "Escape"],
			["Apply aria-keyshortcuts", initialPanelContract.applyShortcuts, "Enter"],
		]) {
			assertEqual(result.failures, actual, expected, `Connector ${label}`);
		}
		result.exclusiveTaskSurfaces = await page.evaluate(() => {
			const disabled = (label) => {
				const button = document.querySelector(`button[aria-label="${label}"]`);
				return button instanceof HTMLButtonElement && button.disabled;
			};
			const activityDisabled = (activity) => {
				const button = document.querySelector(`[data-testid="editor-activity-${activity}"]`);
				return button instanceof HTMLButtonElement && button.disabled;
			};
			return {
				assembleDisabled: disabled("FAB 조립"),
				mapDisabled: disabled("FAB 전체 지도"),
				activityBuildDisabled: activityDisabled("build"),
				activityAssembleDisabled: activityDisabled("assemble"),
				activityEquipDisabled: activityDisabled("equip"),
				activityInspectDisabled: activityDisabled("inspect"),
				undoDisabled: disabled("실행 취소"),
				clearDisabled: disabled("전체 삭제"),
				assembleMenus: document.querySelectorAll('[data-testid="static-fab-assemble-menu"]').length,
				ordinaryInspectors: document.querySelectorAll(
					'[data-testid="rail-area-selection-inspector"], [data-testid="port-equipment-inspector"], [data-testid="rail-inspector"], [data-testid="advanced-switch-inspector"]',
				).length,
			};
		});
		for (const [surface, disabled] of Object.entries(result.exclusiveTaskSurfaces).filter(([key]) =>
			key.endsWith("Disabled"),
		)) {
			assertEqual(result.failures, disabled, true, `Connector blocks ${surface}`);
		}
		assertEqual(
			result.failures,
			result.exclusiveTaskSurfaces.assembleMenus,
			0,
			"Connector does not overlap the Assemble task surface",
		);
		assertEqual(
			result.failures,
			result.exclusiveTaskSurfaces.ordinaryInspectors,
			0,
			"Connector hides ordinary inspectors",
		);
		result.fastSelectionSnapshotStatus = await page
			.locator('[data-testid="tilefab-app"]')
			.evaluate((app) => app.dataset.assemblyConnectorSnapshotStatus ?? "");
		if (
			result.fastSelectionSnapshotStatus !== "requesting" &&
			result.fastSelectionSnapshotStatus !== "transferred"
		) {
			result.failures.push(
				`fast gateway selection did not precede hydration: ${result.fastSelectionSnapshotStatus || "missing"}`,
			);
		}
		await panel.locator('[data-gateway="source"] select').selectOption({ index: 2 });
		await page.waitForFunction(() => {
			const target = document.querySelector(
				'[data-testid="static-fab-assembly-connector-panel"] [data-gateway="target"] select',
			);
			return target instanceof HTMLSelectElement && !target.disabled && target.options.length > 1;
		});
		await panel.locator('[data-gateway="target"] select').selectOption({ index: 1 });
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="tilefab-app"]')?.dataset
					.assemblyConnectorDeferredVerification === "true",
			undefined,
			{ timeout: 1_000 },
		);
		result.deferredVerification = true;
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="tilefab-app"]')?.dataset
					.assemblyConnectorSnapshotStatus === "hydrated",
			undefined,
			{ timeout: budget.snapshotReadyMilliseconds },
		);
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const metrics = await page.evaluate(({ startedAt }) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const scale = globalThis.__openFabConnectorScale;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			return {
				firstPaintMilliseconds: Number(app?.dataset.assemblyConnectorFirstPaintMs),
				snapshotHandoffMilliseconds: Number(app?.dataset.assemblyConnectorSnapshotHandoffMs),
				hydrationMilliseconds: Number(app?.dataset.assemblyConnectorHydrationMs),
				snapshotReadyMilliseconds: performance.now() - startedAt,
				sourceCells: Number(app?.dataset.assemblyConnectorSnapshotSourceCells),
				snapshotStatus: app?.dataset.assemblyConnectorSnapshotStatus ?? "",
				selectionCount: Number(app?.dataset.organizationSelectionCount),
				simulationReady: canvas?.dataset.workerSimulationReady ?? "",
				scaleAcceptanceVersion: Number(canvas?.dataset.scaleAcceptanceVersion),
				scaleFixtureCells: Number(canvas?.dataset.scaleFixtureCells),
				longTaskSupported: scale?.longTaskSupported ?? false,
				longTasks: (scale?.longTasks ?? []).filter(
					(entry) => entry.startTime + entry.duration >= startedAt,
				),
				errors: scale?.errors ?? [],
				rejections: scale?.rejections ?? [],
			};
		}, probe);
		Object.assign(result, {
			firstPaintMilliseconds: metrics.firstPaintMilliseconds,
			snapshotHandoffMilliseconds: metrics.snapshotHandoffMilliseconds,
			hydrationMilliseconds: metrics.hydrationMilliseconds,
			snapshotReadyMilliseconds: metrics.snapshotReadyMilliseconds,
			longTasks: metrics.longTasks,
		});
		assertEqual(
			result.failures,
			metrics.sourceCells,
			budget.cellCount,
			"snapshot source cell count",
		);
		assertEqual(result.failures, metrics.snapshotStatus, "hydrated", "snapshot handoff status");
		assertEqual(
			result.failures,
			initialPhase,
			"pick-source-gateway",
			"connector first-paint phase",
		);
		assertEqual(result.failures, metrics.selectionCount, 2, "selected authored Bay count");
		assertEqual(result.failures, metrics.simulationReady, "false", "simulation gate");
		assertEqual(
			result.failures,
			metrics.scaleAcceptanceVersion,
			RAIL_SCALE_ACCEPTANCE_VERSION,
			"scale acceptance contract version",
		);
		assertEqual(
			result.failures,
			metrics.scaleFixtureCells,
			budget.cellCount,
			"scale fixture cells",
		);
		assertAtMost(
			result.failures,
			result.readyMilliseconds,
			budget.readyMilliseconds,
			"100k+ fixture ready",
		);
		assertAtMost(
			result.failures,
			metrics.firstPaintMilliseconds,
			budget.firstPaintMilliseconds,
			"CONNECT BAYS first paint",
		);
		assertAtMost(
			result.failures,
			metrics.snapshotReadyMilliseconds,
			budget.snapshotReadyMilliseconds,
			"authoritative snapshot handoff and hydration",
		);
		await page.waitForFunction(
			() => {
				const phase = document
					.querySelector('[data-testid="static-fab-assembly-connector-panel"]')
					?.getAttribute("data-phase");
				return phase === "ready" || phase === "rejected";
			},
			undefined,
			{ timeout: budget.terminalReadyMilliseconds },
		);
		result.terminalReadyMilliseconds = await page.evaluate(
			(startedAt) => performance.now() - startedAt,
			probe.startedAt,
		);
		const verification = await panel.evaluate((element) => ({
			phase: element.getAttribute("data-phase") ?? "",
			reason:
				element.querySelector(".tilefab-assembly-connector-feedback")?.textContent?.trim() ?? "",
		}));
		result.verificationPhase = verification.phase;
		result.verificationReason = verification.reason;
		assertEqual(
			result.failures,
			verification.phase,
			"ready",
			"100k+ Connector terminal verification",
		);
		assertAtMost(
			result.failures,
			result.terminalReadyMilliseconds,
			budget.terminalReadyMilliseconds,
			"100k+ Connector command-to-terminal readiness",
		);
		if (/not initialized|초기화|종료되었습니다/i.test(verification.reason)) {
			result.failures.push(`fast pre-hydration gateway selection was lost: ${verification.reason}`);
		}
		result.overlayCameraBenchmark = await runAssemblyConnectorOverlayCameraBenchmark(
			page,
			cdp,
			budget,
			result.failures,
		);
		await page.screenshot({
			path: path.join(directory, "fast-selection-verification.png"),
			fullPage: true,
		});
		result.interactionMatrix = await runAssemblyConnectorInteractionMatrix(
			page,
			budget,
			result.failures,
		);
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const finalDiagnostics = await page.evaluate(({ startedAt }) => {
			const scale = globalThis.__openFabConnectorScale;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			return {
				longTaskSupported: scale?.longTaskSupported ?? false,
				longTasks: (scale?.longTasks ?? []).filter(
					(entry) => entry.startTime + entry.duration >= startedAt,
				),
				errors: scale?.errors ?? [],
				rejections: scale?.rejections ?? [],
			};
		}, probe);
		result.longTasks = finalDiagnostics.longTasks;
		result.diagnostics = {
			windowErrors: finalDiagnostics.errors,
			unhandledRejections: finalDiagnostics.rejections,
			consoleErrors,
			pageErrors,
		};
		assertEqual(
			result.failures,
			finalDiagnostics.longTaskSupported,
			true,
			"Long Task observer support",
		);
		assertEqual(
			result.failures,
			finalDiagnostics.longTasks.length,
			0,
			"CONNECT BAYS main-thread Long Tasks",
		);
		assertEqual(result.failures, finalDiagnostics.errors.length, 0, "window errors");
		assertEqual(result.failures, finalDiagnostics.rejections.length, 0, "unhandled rejections");
		assertEqual(result.failures, consoleErrors.length, 0, "console errors");
		assertEqual(result.failures, pageErrors.length, 0, "page errors");
		for (const [label, messages] of [
			["window error", finalDiagnostics.errors],
			["unhandled rejection", finalDiagnostics.rejections],
			["console error", consoleErrors],
			["page error", pageErrors],
		]) {
			for (const message of messages) result.failures.push(`${label}: ${message}`);
		}
		await page.screenshot({
			path: path.join(directory, "interaction-matrix-project-replacement.png"),
			fullPage: true,
		});
	} catch (error) {
		result.failures.push(error instanceof Error ? error.message : String(error));
		await page
			.screenshot({ path: path.join(directory, "interaction-matrix-failure.png"), fullPage: true })
			.catch(() => undefined);
	} finally {
		await closeBrowserResource(context, "assembly connector scale context");
	}
	return result;
}

async function runAssemblyConnectorOverlayCameraBenchmark(page, cdp, budget, failures) {
	const canvas = page.getByTestId("rail-canvas");
	await page.waitForFunction(
		() => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(target?.dataset.connectorOverlayPlanBindings) > 0 &&
				Number(target?.dataset.connectorOverlayRoutePathBuilds) >= 2
			);
		},
		undefined,
		{ timeout: 2_000 },
	);
	await collectBayCommandScaleGarbageOutsideProductWindow(cdp, page, "__openFabConnectorScale");
	const heapBefore = await cdp.send("Runtime.getHeapUsage");
	const before = await canvas.evaluate((element) => ({
		overlayRedraws: Number(element.dataset.overlayRedraws),
		physicalBindings: Number(element.dataset.physicalBindings),
		gatewayBindings: Number(element.dataset.connectorOverlayGatewayBindings),
		planBindings: Number(element.dataset.connectorOverlayPlanBindings),
		routePathBuilds: Number(element.dataset.connectorOverlayRoutePathBuilds),
		routePathStrokes: Number(element.dataset.connectorOverlayRoutePathStrokes),
		routeCellFallbackStrokes: Number(element.dataset.connectorOverlayRouteCellFallbackStrokes),
		visibleGateways: Number(element.dataset.connectorOverlayVisibleGateways),
		renderSamples: Number(element.dataset.renderSamples),
		renderMeanMilliseconds: Number(element.dataset.renderMeanMs),
		renderOver32Milliseconds: Number(element.dataset.renderOver32Ms),
	}));
	const frameWindow = await canvas.evaluate(async (element, frameCount) => {
		const bounds = element.getBoundingClientRect();
		const clientX = bounds.left + bounds.width * 0.5;
		const clientY = bounds.top + bounds.height * 0.5;
		const startedAt = performance.now();
		for (let frame = 0; frame < frameCount; frame++) {
			await new Promise((resolve) => requestAnimationFrame(resolve));
			element.dispatchEvent(
				new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
					clientX,
					clientY,
					deltaY: frame % 2 === 0 ? 1 : -1,
				}),
			);
		}
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		return { startedAt, endedAt: performance.now() };
	}, budget.overlayCameraFrameCount);
	await page.waitForFunction(
		({ baseline, frameCount }) =>
			Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.overlayRedraws) >=
			baseline + frameCount,
		{ baseline: before.overlayRedraws, frameCount: budget.overlayCameraFrameCount },
		{ timeout: 5_000 },
	);
	const after = await canvas.evaluate((element, activeWindow) => {
		const scale = globalThis.__openFabConnectorScale;
		for (const entry of scale?.observer?.takeRecords?.() ?? []) {
			scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
		}
		return {
			overlayRedraws: Number(element.dataset.overlayRedraws),
			physicalBindings: Number(element.dataset.physicalBindings),
			gatewayBindings: Number(element.dataset.connectorOverlayGatewayBindings),
			planBindings: Number(element.dataset.connectorOverlayPlanBindings),
			routePathBuilds: Number(element.dataset.connectorOverlayRoutePathBuilds),
			routePathStrokes: Number(element.dataset.connectorOverlayRoutePathStrokes),
			routeCellFallbackStrokes: Number(element.dataset.connectorOverlayRouteCellFallbackStrokes),
			visibleGateways: Number(element.dataset.connectorOverlayVisibleGateways),
			renderSamples: Number(element.dataset.renderSamples),
			renderMeanMilliseconds: Number(element.dataset.renderMeanMs),
			renderOver32Milliseconds: Number(element.dataset.renderOver32Ms),
			longTasks: (scale?.longTasks ?? []).filter(
				(entry) =>
					entry.startTime < activeWindow.endedAt &&
					entry.startTime + entry.duration >= activeWindow.startedAt,
			),
		};
	}, frameWindow);
	await collectBayCommandScaleGarbageOutsideProductWindow(cdp, page, "__openFabConnectorScale");
	const heapAfter = await cdp.send("Runtime.getHeapUsage");
	const retainedHeapGrowth = heapUsageDelta(heapBefore, heapAfter);
	const retainedHeapBudget = {
		usedSize: Math.max(
			budget.overlayRetainedHeapFloorBytes,
			heapUsageMetric(heapBefore, "usedSize") * budget.overlayRetainedHeapRatio,
		),
		embedderHeapUsedSize: Math.max(
			budget.overlayRetainedEmbedderHeapFloorBytes,
			heapUsageMetric(heapBefore, "embedderHeapUsedSize") * budget.overlayRetainedHeapRatio,
		),
		backingStorageSize: Math.max(
			budget.overlayRetainedBackingStorageFloorBytes,
			heapUsageMetric(heapBefore, "backingStorageSize") * budget.overlayRetainedHeapRatio,
		),
	};
	const overlayRedrawDelta = after.overlayRedraws - before.overlayRedraws;
	const routePathStrokeDelta = after.routePathStrokes - before.routePathStrokes;
	const renderSampleDelta = after.renderSamples - before.renderSamples;
	const renderTotalBefore = before.renderMeanMilliseconds * before.renderSamples;
	const renderTotalAfter = after.renderMeanMilliseconds * after.renderSamples;
	const incrementalRenderMeanMilliseconds =
		renderSampleDelta > 0 ? (renderTotalAfter - renderTotalBefore) / renderSampleDelta : Infinity;

	assertAtLeast(
		failures,
		overlayRedrawDelta,
		budget.overlayCameraFrameCount,
		"Connector overlay camera render count",
	);
	assertEqual(
		failures,
		routePathStrokeDelta,
		overlayRedrawDelta * 2,
		"Connector overlay two cached route strokes per frame",
	);
	for (const [label, actual, expected] of [
		["physical bindings", after.physicalBindings, before.physicalBindings],
		["gateway bindings", after.gatewayBindings, before.gatewayBindings],
		["plan bindings", after.planBindings, before.planBindings],
		["route Path2D builds", after.routePathBuilds, before.routePathBuilds],
		[
			"route cell fallback strokes",
			after.routeCellFallbackStrokes,
			before.routeCellFallbackStrokes,
		],
	]) {
		assertEqual(failures, actual, expected, `Connector overlay camera ${label}`);
	}
	assertEqual(
		failures,
		after.routeCellFallbackStrokes,
		0,
		"Connector overlay browser Path2D route",
	);
	assertAtLeast(failures, after.visibleGateways, 1, "Connector overlay visible gateway count");
	assertAtMost(
		failures,
		after.visibleGateways,
		budget.overlayVisibleGatewayLimit,
		"Connector overlay bounded visible gateway count",
	);
	assertAtMost(
		failures,
		incrementalRenderMeanMilliseconds,
		budget.overlayMeanFrameMilliseconds,
		"Connector overlay camera mean frame",
	);
	assertEqual(
		failures,
		after.renderOver32Milliseconds - before.renderOver32Milliseconds,
		0,
		"Connector overlay camera frames over 32 ms",
	);
	assertEqual(failures, after.longTasks.length, 0, "Connector overlay camera Long Tasks");
	for (const field of ["usedSize", "embedderHeapUsedSize", "backingStorageSize"]) {
		assertAtMost(
			failures,
			retainedHeapGrowth[field],
			retainedHeapBudget[field],
			`Connector overlay post-GC retained ${field}`,
		);
	}
	return {
		frameCount: budget.overlayCameraFrameCount,
		windowMilliseconds: frameWindow.endedAt - frameWindow.startedAt,
		overlayRedrawDelta,
		routePathStrokeDelta,
		incrementalRenderMeanMilliseconds,
		visibleGateways: after.visibleGateways,
		retainedHeapGrowth,
		retainedHeapBudget,
	};
}

async function runAssemblyConnectorInteractionMatrix(page, budget, failures) {
	const canvas = page.getByTestId("rail-canvas");
	const panel = page.getByTestId("static-fab-assembly-connector-panel");
	const windows = {};
	const browserNow = () => page.evaluate(() => performance.now());
	const waitForMatrixCondition = async (label, condition, argument) => {
		try {
			await page.waitForFunction(condition, argument, {
				timeout: budget.terminalReadyMilliseconds,
			});
		} catch (error) {
			const diagnostics = await page.evaluate(() => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const target = document.querySelector('[data-testid="rail-canvas"]');
				const connector = document.querySelector(
					'[data-testid="static-fab-assembly-connector-panel"]',
				);
				const undo = document.querySelector('button[aria-label="실행 취소"]');
				return {
					startupStatus: app?.dataset.startupStatus ?? "",
					connectorPhase: connector?.getAttribute("data-phase") ?? "absent",
					workerStatus: target?.dataset.workerStatus ?? "",
					workerSequence: target?.dataset.workerSequence ?? "",
					workerRevision: target?.dataset.workerRevision ?? "",
					workerCells: target?.dataset.workerCells ?? "",
					workerChecksum: target?.dataset.workerChecksum ?? "",
					modelSyncPending: target?.dataset.modelSyncPending ?? "",
					modelDerivationStatus: target?.dataset.modelDerivationStatus ?? "",
					undoDisabled: undo instanceof HTMLButtonElement ? undo.disabled : "missing",
					activeTestId:
						document.activeElement instanceof HTMLElement
							? (document.activeElement.dataset.testid ?? document.activeElement.tagName)
							: "",
					starterPresent:
						document.querySelector('[data-testid="synthetic-fab-starter-dialog"]') !== null,
				};
			});
			throw new Error(
				`${label}: ${error instanceof Error ? error.message : String(error)} | ${JSON.stringify(diagnostics)}`,
			);
		}
	};
	const waitForTerminalPhase = async () => {
		await page.waitForFunction(
			() => {
				const phase = document
					.querySelector('[data-testid="static-fab-assembly-connector-panel"]')
					?.getAttribute("data-phase");
				return phase === "ready" || phase === "rejected";
			},
			undefined,
			{ timeout: budget.terminalReadyMilliseconds },
		);
		return (await panel.getAttribute("data-phase")) ?? "";
	};
	const sourceSelect = panel.locator('[data-gateway="source"] select');
	await sourceSelect.focus();
	await page.keyboard.press("e");
	await page.waitForFunction(
		() =>
			document
				.querySelector('.tilefab-assembly-connector-side-option[aria-pressed="true"]')
				?.textContent?.trim() === "LEFT",
	);
	const ePhase = await waitForTerminalPhase();
	assertEqual(failures, ePhase, "ready", "Connector focused-select E selects LEFT readiness");
	await sourceSelect.focus();
	await page.keyboard.press("q");
	await page.waitForFunction(
		() =>
			document
				.querySelector('.tilefab-assembly-connector-side-option[aria-pressed="true"]')
				?.textContent?.trim() === "AUTO",
	);
	const qPhase = await waitForTerminalPhase();
	assertEqual(failures, qPhase, "ready", "Connector focused-select Q restores AUTO readiness");

	await page.setViewportSize({ width: 390, height: 844 });
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	const mobileOrder = await panel.evaluate((element) => {
		const controls = [
			...element.querySelectorAll(
				"button:not([disabled]), select:not([disabled]), details > summary",
			),
		].filter((control) => control instanceof HTMLElement);
		const labelFor = (control) =>
			control.getAttribute("aria-label") ??
			control.id ??
			control.textContent?.replace(/\s+/g, " ").trim() ??
			"";
		const rows = controls.map((control, index) => {
			const rect = control.getBoundingClientRect();
			return {
				index,
				label: labelFor(control),
				left: rect.left,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
			};
		});
		const rectsFor = (selector) =>
			[...element.querySelectorAll(selector)].map((control) => {
				const rect = control.getBoundingClientRect();
				return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
			});
		const source = rectsFor('[data-gateway="source"] button, [data-gateway="source"] select');
		const target = rectsFor('[data-gateway="target"] button, [data-gateway="target"] select');
		const side = rectsFor(".tilefab-assembly-connector-side button");
		const summary = element.querySelector("details > summary")?.getBoundingClientRect();
		const cancel = element
			.querySelector(".tilefab-assembly-connector-cancel")
			?.getBoundingClientRect();
		const apply = element
			.querySelector(".tilefab-assembly-connector-apply")
			?.getBoundingClientRect();
		const leftToRight = (rects) =>
			rects.length > 0 &&
			rects.every((rect, index) => index === 0 || rect.left >= rects[index - 1].right);
		return {
			controlCount: rows.length,
			domLabels: rows.map((row) => row.label),
			visualOrder:
				source.length === 3 &&
				target.length === 3 &&
				side.length === 3 &&
				leftToRight(source) &&
				leftToRight(target) &&
				leftToRight(side) &&
				source[0].top < target[0].top &&
				target[0].top < side[0].top &&
				summary &&
				side[0].top < summary.top &&
				cancel &&
				apply &&
				cancel.left < apply.left,
			documentHorizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
			panelHorizontalOverflow: Math.max(0, element.scrollWidth - element.clientWidth),
		};
	});
	assertAtLeast(failures, mobileOrder.controlCount, 10, "Connector mobile focusable controls");
	const mobileTabOrder = [];
	let mobileTabControlsVisible = true;
	const mobileControls = panel.locator(
		"button:not([disabled]), select:not([disabled]), details > summary",
	);
	await mobileControls.first().focus();
	for (let index = 0; index < mobileOrder.controlCount; index++) {
		const active = await panel.evaluate((element) => {
			const control = document.activeElement;
			if (!(control instanceof HTMLElement) || !element.contains(control)) {
				return { label: "OUTSIDE CONNECTOR", visible: false };
			}
			const panelRect = element.getBoundingClientRect();
			const rect = control.getBoundingClientRect();
			return {
				label:
					control.getAttribute("aria-label") ??
					control.id ??
					control.textContent?.replace(/\s+/g, " ").trim() ??
					"",
				visible:
					rect.left >= panelRect.left &&
					rect.right <= panelRect.right &&
					rect.top >= panelRect.top &&
					rect.bottom <= panelRect.bottom,
			};
		});
		mobileTabOrder.push(active.label);
		mobileTabControlsVisible &&= active.visible;
		if (index + 1 < mobileOrder.controlCount) await page.keyboard.press("Tab");
	}
	assertEqual(
		failures,
		JSON.stringify(mobileTabOrder),
		JSON.stringify(mobileOrder.domLabels),
		"Connector mobile Tab order",
	);
	assertEqual(failures, mobileOrder.visualOrder, true, "Connector mobile visual order");
	assertEqual(
		failures,
		mobileTabControlsVisible,
		true,
		"Connector mobile focused controls visible after scroll",
	);
	assertEqual(
		failures,
		mobileOrder.documentHorizontalOverflow,
		0,
		"Connector mobile horizontal overflow",
	);
	assertEqual(
		failures,
		mobileOrder.panelHorizontalOverflow,
		0,
		"Connector mobile panel horizontal overflow",
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);

	const timingSummary = panel.locator("details > summary").first();
	await timingSummary.waitFor({ state: "visible" });
	await timingSummary.focus();
	await page.keyboard.press("Escape");
	await panel.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
	);

	await page.keyboard.press("j");
	await panel.waitFor({ state: "visible" });
	const secondPlaceholder = await panel.evaluate((element) => ({
		source: element.querySelector('[data-gateway="source"] select')?.value ?? "missing",
		target: element.querySelector('[data-gateway="target"] select')?.value ?? "missing",
	}));
	assertEqual(failures, secondPlaceholder.source, "", "Connector re-entry source placeholder");
	assertEqual(failures, secondPlaceholder.target, "", "Connector re-entry target placeholder");
	await panel.locator('[data-gateway="source"] select').selectOption({ index: 2 });
	await page.waitForFunction(() => {
		const target = document.querySelector(
			'[data-testid="static-fab-assembly-connector-panel"] [data-gateway="target"] select',
		);
		return target instanceof HTMLSelectElement && !target.disabled && target.options.length > 1;
	});
	await panel.locator('[data-gateway="target"] select').selectOption({ index: 1 });
	assertEqual(
		failures,
		await waitForTerminalPhase(),
		"ready",
		"Connector re-entry terminal readiness",
	);
	const beforeApply = await canvas.evaluate((element) => ({
		sequence: Number(element.dataset.workerSequence),
		revision: Number(element.dataset.workerRevision),
		checksum: element.dataset.workerChecksum ?? "",
		cells: Number(element.dataset.workerCells),
	}));
	const applyStartedAt = await browserNow();
	await panel.locator('[data-gateway="source"] select').focus();
	await page.keyboard.press("Enter");
	await panel.waitFor({ state: "hidden" });
	await waitForMatrixCondition(
		"Connector Apply mirror/model readiness",
		(source) => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return (
				target?.dataset.workerStatus === "ready" &&
				Number(target.dataset.workerSequence) === source.sequence + 1 &&
				target.dataset.workerChecksum !== source.checksum &&
				target.dataset.modelSyncPending === "false"
			);
		},
		beforeApply,
	);
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
	);
	const afterApply = await page.evaluate(() => {
		const target = document.querySelector('[data-testid="rail-canvas"]');
		const undo = document.querySelector('button[aria-label="실행 취소"]');
		return {
			sequence: Number(target?.dataset.workerSequence),
			revision: Number(target?.dataset.workerRevision),
			checksum: target?.dataset.workerChecksum ?? "",
			cells: Number(target?.dataset.workerCells),
			simulationReady: target?.dataset.workerSimulationReady ?? "",
			undoEnabled: undo instanceof HTMLButtonElement && !undo.disabled,
			canvasFocused: target === document.activeElement,
		};
	});
	windows.apply = { startedAt: applyStartedAt, endedAt: await browserNow() };
	for (const [label, actual, expected] of [
		["Apply Worker sequence", afterApply.sequence, beforeApply.sequence + 1],
		["Apply simulation gate", afterApply.simulationReady, "false"],
		["Apply undo enabled", afterApply.undoEnabled, true],
		["Apply Canvas focus", afterApply.canvasFocused, true],
	]) {
		assertEqual(failures, actual, expected, `Connector ${label}`);
	}
	assertAtLeast(
		failures,
		afterApply.revision,
		beforeApply.revision + 1,
		"Connector Apply Worker revision advanced",
	);
	assertAtLeast(
		failures,
		afterApply.cells,
		beforeApply.cells + 1,
		"Connector Apply authored cells",
	);

	const undoStartedAt = await browserNow();
	await page.getByRole("button", { name: "실행 취소", exact: true }).click();
	await waitForMatrixCondition(
		"Connector Undo mirror/model readiness",
		(source) => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			const restoredChecksum = target?.dataset.workerChecksum?.split(":") ?? [];
			const sourceChecksum = source.checksum.split(":");
			const restoredExceptMonotonicOrganizationCursor =
				restoredChecksum.length === 9 &&
				sourceChecksum.length === 9 &&
				restoredChecksum.every((field, index) => index === 6 || field === sourceChecksum[index]) &&
				Number.parseInt(restoredChecksum[6], 16) > Number.parseInt(sourceChecksum[6], 16);
			return (
				target?.dataset.workerStatus === "ready" &&
				Number(target.dataset.workerSequence) === source.sequence + 1 &&
				Number(target.dataset.workerCells) === source.cells &&
				restoredExceptMonotonicOrganizationCursor &&
				target.dataset.modelSyncPending === "false"
			);
		},
		{
			sequence: afterApply.sequence,
			checksum: beforeApply.checksum,
			cells: beforeApply.cells,
		},
	);
	windows.undo = { startedAt: undoStartedAt, endedAt: await browserNow() };
	const replacementSelectionStartedAt = await browserNow();
	const replacementConnect = await selectAssemblyConnectorScaleBays(page);
	await replacementConnect.click();
	await panel.waitFor({ state: "visible" });
	windows.replacementSelection = {
		startedAt: replacementSelectionStartedAt,
		endedAt: await browserNow(),
	};
	const replacementStartedAt = await browserNow();
	await page.locator(".tilefab-project-trigger").click();
	const projectMenu = page.locator("#tilefab-project-menu");
	await projectMenu.waitFor({ state: "visible" });
	await projectMenu.getByRole("button", { name: "새 프로젝트", exact: true }).click();
	const starterDialog = page.getByTestId("synthetic-fab-starter-dialog");
	await starterDialog.waitFor({ state: "visible" });
	await page.getByTestId("synthetic-fab-starter-blank").click();
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="synthetic-fab-starter-preview"]')
				?.getAttribute("data-starter-id") === "blank",
	);
	await page.getByTestId("create-synthetic-fab-project").click();
	const discard = page.getByRole("button", { name: "저장하지 않고 계속" });
	if (await discard.isVisible({ timeout: 1_000 }).catch(() => false)) await discard.click();
	await panel.waitFor({ state: "hidden" });
	await waitForMatrixCondition(
		"Connector project replacement readiness",
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.dataset.startupStatus === "ready" &&
				target?.dataset.workerStatus === "ready" &&
				Number(target.dataset.workerCells) === 0
			);
		},
		undefined,
	);
	windows.projectReplacement = {
		startedAt: replacementStartedAt,
		endedAt: await browserNow(),
	};
	const replacement = await page.evaluate(() => {
		const target = document.querySelector('[data-testid="rail-canvas"]');
		return {
			connectorPresent:
				document.querySelector('[data-testid="static-fab-assembly-connector-panel"]') !== null,
			workerCells: Number(target?.dataset.workerCells),
			simulationReady: target?.dataset.workerSimulationReady ?? "",
		};
	});
	assertEqual(
		failures,
		replacement.connectorPresent,
		false,
		"Connector project replacement cancellation",
	);
	assertEqual(failures, replacement.workerCells, 0, "Connector replacement blank project cells");
	assertEqual(
		failures,
		replacement.simulationReady,
		"false",
		"Connector replacement simulation gate",
	);
	return {
		ePhase,
		qPhase,
		mobileControlCount: mobileOrder.controlCount,
		appliedSequence: afterApply.sequence,
		projectReplacementCancelled: !replacement.connectorPresent,
		windows,
	};
}

async function runSemanticBayDeleteScaleScenario(activeBrowser) {
	const budget = RAIL_SEMANTIC_BAY_DELETE_SCALE_BUDGET;
	const context = await activeBrowser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	await context.addInitScript(() => {
		const scale = {
			longTasks: [],
			errors: [],
			rejections: [],
			observer: null,
			longTaskSupported: false,
			semanticWorkerStarts: 0,
			semanticWorkerTerminations: 0,
			semanticRequests: [],
			railSnapshotCaptureRequests: [],
			hydrateTransfers: [],
			commandStartedAt: null,
			applyStartedAt: null,
		};
		globalThis.__openFabSemanticBayScale = scale;

		const NativeWorker = globalThis.Worker;
		const semanticWorkers = new WeakSet();
		const nativeWorkerPostMessage = NativeWorker.prototype.postMessage;
		const nativeWorkerTerminate = NativeWorker.prototype.terminate;
		const collectArrayBuffers = (root) => {
			const buffers = new Set();
			const visited = new WeakSet();
			const visit = (value) => {
				if (value === null || typeof value !== "object") return;
				if (value instanceof ArrayBuffer) {
					buffers.add(value);
					return;
				}
				if (ArrayBuffer.isView(value)) {
					if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
					return;
				}
				if (visited.has(value)) return;
				visited.add(value);
				if (value instanceof Map) {
					for (const [key, entry] of value) {
						visit(key);
						visit(entry);
					}
					return;
				}
				if (value instanceof Set) {
					for (const entry of value) visit(entry);
					return;
				}
				for (const entry of Object.values(value)) visit(entry);
			};
			visit(root);
			return [...buffers];
		};

		NativeWorker.prototype.postMessage = function (...argumentsList) {
			const message = argumentsList[0];
			let transferProbe = null;
			if (message?.type === "CAPTURE_RAIL_SNAPSHOT") {
				scale.railSnapshotCaptureRequests.push({
					at: performance.now(),
					requestId: message.requestId,
					epoch: message.epoch,
					expectedSequence: message.expectedSequence,
					expectedRevision: message.expectedRevision,
					expectedChecksum: message.expectedChecksum,
				});
			}
			if (semanticWorkers.has(this)) {
				scale.semanticRequests.push({
					at: performance.now(),
					type: message?.type ?? "",
					requestId: message?.requestId ?? null,
				});
				if (message?.type === "HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION") {
					const transferArgument = argumentsList[1];
					const transferables = Array.isArray(transferArgument)
						? transferArgument
						: Array.isArray(transferArgument?.transfer)
							? transferArgument.transfer
							: [];
					const transferBuffers = transferables.filter((entry) => entry instanceof ArrayBuffer);
					const positiveTransferBuffers = transferBuffers.filter((buffer) => buffer.byteLength > 0);
					const snapshotBuffers = collectArrayBuffers(message.snapshot);
					const uniqueTransferBuffers = new Set(transferBuffers);
					const snapshotBufferSet = new Set(snapshotBuffers);
					transferProbe = {
						at: performance.now(),
						requestId: message.requestId,
						transferCount: transferables.length,
						arrayBufferCount: transferBuffers.length,
						positiveBufferCount: positiveTransferBuffers.length,
						uniqueCount: uniqueTransferBuffers.size,
						duplicateCount: transferBuffers.length - uniqueTransferBuffers.size,
						totalBytes: transferBuffers.reduce((total, buffer) => total + buffer.byteLength, 0),
						snapshotBufferCount: snapshotBuffers.length,
						snapshotBufferBytes: snapshotBuffers.reduce(
							(total, buffer) => total + buffer.byteLength,
							0,
						),
						allArrayBuffers: transferBuffers.length === transferables.length,
						exactTransferSet:
							uniqueTransferBuffers.size === snapshotBufferSet.size &&
							[...uniqueTransferBuffers].every((buffer) => snapshotBufferSet.has(buffer)),
						transferBuffers,
						positiveTransferBuffers,
					};
				}
			}
			const posted = Reflect.apply(nativeWorkerPostMessage, this, argumentsList);
			if (transferProbe) {
				const detachedCount = transferProbe.transferBuffers.filter(
					(buffer) => buffer.byteLength === 0,
				).length;
				const observablyDetachedCount = transferProbe.positiveTransferBuffers.filter(
					(buffer) => buffer.byteLength === 0,
				).length;
				scale.hydrateTransfers.push({
					at: transferProbe.at,
					requestId: transferProbe.requestId,
					transferCount: transferProbe.transferCount,
					arrayBufferCount: transferProbe.arrayBufferCount,
					positiveBufferCount: transferProbe.positiveBufferCount,
					uniqueCount: transferProbe.uniqueCount,
					duplicateCount: transferProbe.duplicateCount,
					totalBytes: transferProbe.totalBytes,
					snapshotBufferCount: transferProbe.snapshotBufferCount,
					snapshotBufferBytes: transferProbe.snapshotBufferBytes,
					allArrayBuffers: transferProbe.allArrayBuffers,
					exactTransferSet: transferProbe.exactTransferSet,
					detachedCount,
					allDetached: detachedCount === transferProbe.transferBuffers.length,
					observablyDetachedCount,
					observableAllDetached:
						observablyDetachedCount === transferProbe.positiveTransferBuffers.length,
				});
			}
			return posted;
		};
		NativeWorker.prototype.terminate = function (...argumentsList) {
			if (semanticWorkers.delete(this)) scale.semanticWorkerTerminations++;
			return Reflect.apply(nativeWorkerTerminate, this, argumentsList);
		};
		globalThis.Worker = new Proxy(NativeWorker, {
			construct(target, argumentsList) {
				const source = String(argumentsList[0] ?? "");
				const worker = Reflect.construct(target, argumentsList);
				if (/staticFabSemanticBayMutationWorker/i.test(source)) {
					scale.semanticWorkerStarts++;
					semanticWorkers.add(worker);
				}
				return worker;
			},
		});

		if (typeof PerformanceObserver !== "undefined") {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
				}
			});
			try {
				observer.observe({ type: "longtask", buffered: true });
				scale.longTaskSupported = true;
				scale.observer = observer;
			} catch {
				// Unsupported browsers are rejected by the acceptance assertions below.
			}
		}
		addEventListener("error", (event) => {
			scale.errors.push(String(event.error?.message ?? event.message));
		});
		addEventListener("unhandledrejection", (event) => {
			scale.rejections.push(String(event.reason));
		});
	});

	const page = await context.newPage();
	const consoleErrors = [];
	const pageErrors = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const result = {
		cellCount: budget.cellCount,
		readyMilliseconds: Number.POSITIVE_INFINITY,
		commandDispatchMilliseconds: Number.POSITIVE_INFINITY,
		firstPaintMilliseconds: Number.POSITIVE_INFINITY,
		certificationMilliseconds: Number.POSITIVE_INFINITY,
		responseValidationMilliseconds: Number.POSITIVE_INFINITY,
		adoptionMilliseconds: Number.POSITIVE_INFINITY,
		applyDispatchMilliseconds: Number.POSITIVE_INFINITY,
		mirrorReadyMilliseconds: Number.POSITIVE_INFINITY,
		source: {},
		evidence: {},
		result: {},
		transfer: {
			transferCount: 0,
			uniqueCount: 0,
			totalBytes: Number.POSITIVE_INFINITY,
			detachedCount: 0,
		},
		instrumentation: {},
		commandLongTasks: [],
		applyLongTasks: [],
		retainedHeapGrowth: {
			usedSize: Number.POSITIVE_INFINITY,
			embedderHeapUsedSize: Number.POSITIVE_INFINITY,
			backingStorageSize: Number.POSITIVE_INFINITY,
		},
		retainedHeapBudget: {},
		heapBefore: null,
		heapAfter: null,
		consoleErrors,
		pageErrors,
		failures: [],
	};
	const directory = path.join(artifactRoot, `semantic-bay-delete-${budget.cellCount}`);
	await mkdir(directory, { recursive: true });

	try {
		const readyStartedAt = performance.now();
		await page.goto(`${baseUrl}/?scaleFixture=${budget.cellCount}&scaleRoots=2`, {
			waitUntil: "domcontentloaded",
			timeout: budget.readyMilliseconds,
		});
		await page.waitForFunction(
			(expected) => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					app?.dataset.startupStatus === "ready" &&
					canvas?.dataset.workerStatus === "ready" &&
					Number(canvas.dataset.workerCells) === expected.cells &&
					Number(canvas.dataset.workerEdges) === expected.authoredEdges &&
					Number(canvas.dataset.workerPorts) === expected.ports &&
					Number(canvas.dataset.workerEquipmentGroups) === expected.equipmentGroups &&
					Number(canvas.dataset.physicalPaths) === expected.physicalPaths &&
					Number(canvas.dataset.staticFabOrganizationCount) === 2 &&
					Number(canvas.dataset.readinessStrongComponents) === 2 &&
					Number(canvas.dataset.readinessOpenTerminals) === 0
				);
			},
			{
				cells: budget.cellCount,
				authoredEdges: budget.sourceAuthoredEdges,
				physicalPaths: budget.sourcePhysicalPaths,
				ports: budget.sourcePortCount,
				equipmentGroups: budget.sourceEquipmentGroupCount,
			},
			{ timeout: budget.readyMilliseconds },
		);
		result.readyMilliseconds = performance.now() - readyStartedAt;
		const startupFailure = await page
			.getByTestId("rail-canvas")
			.evaluate((canvas) => canvas.dataset.startupMessage ?? "");
		if (startupFailure)
			throw new Error(`Semantic Bay scale fixture startup failed: ${startupFailure}`);

		const source = await readSemanticBayScaleState(page);
		result.source = source;
		assertAtMost(
			result.failures,
			result.readyMilliseconds,
			budget.readyMilliseconds,
			"100k+ Semantic Bay fixture readiness",
		);
		assertEqual(
			result.failures,
			source.scaleAcceptanceVersion,
			RAIL_SCALE_ACCEPTANCE_VERSION,
			"Semantic Bay scale acceptance contract version",
		);
		assertEqual(
			result.failures,
			source.scaleFixtureCells,
			budget.cellCount,
			"Semantic Bay authored fixture cell count",
		);
		assertEqual(result.failures, source.workerCells, budget.cellCount, "Semantic Bay source cells");
		assertEqual(
			result.failures,
			source.workerEdges,
			budget.sourceAuthoredEdges,
			"Semantic Bay source authored edges",
		);
		assertEqual(
			result.failures,
			source.physicalPaths,
			budget.sourcePhysicalPaths,
			"Semantic Bay source physical paths",
		);
		assertEqual(result.failures, source.strongComponents, 2, "Semantic Bay source directed SCCs");
		assertEqual(result.failures, source.openTerminals, 0, "Semantic Bay source open terminals");
		assertEqual(result.failures, source.organizations, 2, "Semantic Bay source organizations");
		assertEqual(
			result.failures,
			source.documentPortCount,
			budget.sourcePortCount,
			"Semantic Bay source document ports",
		);
		assertEqual(
			result.failures,
			source.workerPorts,
			budget.sourcePortCount,
			"Semantic Bay source Worker ports",
		);
		assertEqual(
			result.failures,
			source.documentEquipmentGroupCount,
			budget.sourceEquipmentGroupCount,
			"Semantic Bay source document equipment groups",
		);
		assertEqual(
			result.failures,
			source.workerEquipmentGroups,
			budget.sourceEquipmentGroupCount,
			"Semantic Bay source Worker equipment groups",
		);
		assertEqual(result.failures, source.portIds, "1,2,3,4,5", "Semantic Bay source port IDs");
		assertEqual(
			result.failures,
			source.portTypes,
			"EQ,EQ,OHB,STK,OHB",
			"Semantic Bay source port types",
		);
		assertEqual(
			result.failures,
			source.portDirections,
			"WITH_TRAVEL,WITH_TRAVEL,WITH_TRAVEL,WITH_TRAVEL,AGAINST_TRAVEL",
			"Semantic Bay source port directions",
		);
		assertEqual(
			result.failures,
			source.equipmentGroupIds,
			"1,2,3,4",
			"Semantic Bay source equipment group IDs",
		);
		assertEqual(
			result.failures,
			source.equipmentGroupKinds,
			"EQ,OHB,STK,OHB",
			"Semantic Bay source equipment kinds",
		);
		assertEqual(
			result.failures,
			source.organizationEquipmentMembership,
			budget.sourceOrganizationEquipmentMembership,
			"Semantic Bay source organization equipment ownership",
		);
		assertEqual(result.failures, source.nextPortId, budget.nextPortId, "Semantic Bay port cursor");
		assertEqual(
			result.failures,
			source.nextEquipmentGroupId,
			budget.nextEquipmentGroupId,
			"Semantic Bay equipment cursor",
		);
		assertEqual(
			result.failures,
			source.workerTargetChecksum,
			source.workerChecksum,
			"Semantic Bay source target/mirror checksum parity",
		);
		assertEqual(
			result.failures,
			source.documentPatchSequence,
			source.workerSequence,
			"Semantic Bay source document/Worker sequence parity",
		);
		assertEqual(
			result.failures,
			source.documentRevision,
			source.workerRevision,
			"Semantic Bay source document/Worker revision parity",
		);
		assertEqual(
			result.failures,
			source.workerTargetRevision,
			source.workerRevision,
			"Semantic Bay source target/mirror revision parity",
		);
		assertEqual(
			result.failures,
			source.modelChecksum,
			source.workerChecksum,
			"Semantic Bay source model/Worker checksum parity",
		);
		assertEqual(
			result.failures,
			source.modelPhysicalFingerprint,
			source.workerPhysicalFingerprint,
			"Semantic Bay source model/Worker physical parity",
		);
		assertEqual(
			result.failures,
			source.workerSimulationReady,
			false,
			"Semantic Bay simulation gate",
		);

		await activateEditorActivity(page, "assemble");
		await page.locator('button[aria-label^="FAB 조직 ("]').click();
		const organizationLibrary = page.getByTestId("static-fab-organization-library");
		await organizationLibrary.waitFor({ state: "visible" });
		const detachedBay = organizationLibrary.locator('[data-organization-id="1"]');
		await detachedBay.waitFor({ state: "visible" });
		await detachedBay.click();
		await page.waitForFunction(
			() => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				return (
					app?.dataset.organizationSelectionCount === "1" &&
					app.dataset.organizationSelectionIds === "1"
				);
			},
			undefined,
			{ timeout: 10_000 },
		);
		await organizationLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
		const assembleMenu = page.getByTestId("static-fab-assemble-menu");
		if (!(await assembleMenu.isVisible().catch(() => false))) {
			await page.getByTestId("editor-activity-assemble").click();
		}
		await assembleMenu.waitFor({ state: "visible" });
		const disconnect = assembleMenu.getByTestId("assemble-disconnect-selected-bay");
		const remove = assembleMenu.getByTestId("assemble-delete-selected-bay");
		assertEqual(
			result.failures,
			await disconnect.isDisabled(),
			true,
			"detached Bay Disconnect state",
		);
		assertEqual(result.failures, await remove.isEnabled(), true, "detached Bay Delete state");

		const cdp = await context.newCDPSession(page);
		await collectSemanticBayScaleGarbageOutsideProductWindow(cdp, page);
		const heapBefore = await cdp.send("Runtime.getHeapUsage");
		result.heapBefore = heapBefore;
		const commandProbe = await page.evaluate(() => {
			const button = document.querySelector('[data-testid="assemble-delete-selected-bay"]');
			const scale = globalThis.__openFabSemanticBayScale;
			if (!(button instanceof HTMLButtonElement) || !scale) {
				throw new Error("The detached Semantic Bay Delete command is missing.");
			}
			const startedAt = performance.now();
			scale.commandStartedAt = startedAt;
			button.click();
			return { startedAt, dispatchMilliseconds: performance.now() - startedAt };
		});
		result.commandDispatchMilliseconds = commandProbe.dispatchMilliseconds;
		assertAtMost(
			result.failures,
			result.commandDispatchMilliseconds,
			budget.commandDispatchMilliseconds,
			"Semantic Bay Delete command dispatch",
		);

		const dialog = page.getByTestId("semantic-bay-command-dialog");
		await dialog.waitFor({ state: "visible", timeout: budget.firstPaintMilliseconds * 4 });
		await page.waitForFunction(
			() => {
				const candidate = document.querySelector('[data-testid="semantic-bay-command-dialog"]');
				return ["ready", "rejected"].includes(candidate?.getAttribute("data-phase") ?? "");
			},
			undefined,
			{ timeout: budget.certificationMilliseconds },
		);
		const certifiedAt = await page.evaluate(() => performance.now());
		result.certificationMilliseconds = certifiedAt - commandProbe.startedAt;
		if ((await dialog.getAttribute("data-phase")) !== "ready") {
			throw new Error(
				`100k+ detached Semantic Bay Delete was rejected: ${await dialog.textContent()}`,
			);
		}
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const review = await readSemanticBayDeleteEvidence(page);
		const certifiedState = await readSemanticBayScaleState(page);
		const commandDiagnostics = await readSemanticBayScaleDiagnostics(page, {
			commandStartedAt: commandProbe.startedAt,
			commandEndedAt: certifiedAt,
			applyStartedAt: null,
			applyEndedAt: null,
		});
		result.firstPaintMilliseconds = certifiedState.semanticBayFirstPaintMilliseconds;
		result.responseValidationMilliseconds =
			certifiedState.semanticBayResponseValidationMilliseconds;
		result.adoptionMilliseconds = certifiedState.semanticBayAdoptionMilliseconds;
		result.certification = certifiedState;
		result.evidence = review;
		result.instrumentation = commandDiagnostics.instrumentation;
		result.transfer = commandDiagnostics.instrumentation.hydrateTransfers[0] ?? result.transfer;
		result.commandLongTasks = commandDiagnostics.commandLongTasks;

		assertEqual(
			result.failures,
			await dialog.getAttribute("data-action"),
			"DELETE",
			"Delete action",
		);
		assertAtMost(
			result.failures,
			result.firstPaintMilliseconds,
			budget.firstPaintMilliseconds,
			"Semantic Bay Delete first paint",
		);
		assertAtMost(
			result.failures,
			result.certificationMilliseconds,
			budget.certificationMilliseconds,
			"Semantic Bay Delete exact certification",
		);
		assertEqual(
			result.failures,
			certifiedState.semanticBaySnapshotStatus,
			"certified",
			"Semantic Bay certified snapshot status",
		);
		assertEqual(
			result.failures,
			certifiedState.semanticBaySnapshotSourceCells,
			budget.cellCount,
			"Semantic Bay mirror-owned snapshot source size",
		);
		assertAtMost(
			result.failures,
			result.responseValidationMilliseconds,
			budget.responseValidationMilliseconds,
			"Semantic Bay response validation",
		);
		assertAtLeast(
			result.failures,
			result.responseValidationMilliseconds,
			0,
			"Semantic Bay response validation telemetry",
		);
		assertAtMost(
			result.failures,
			result.adoptionMilliseconds,
			budget.adoptionMilliseconds,
			"Semantic Bay one-shot adoption",
		);
		assertAtLeast(
			result.failures,
			result.adoptionMilliseconds,
			0,
			"Semantic Bay one-shot adoption telemetry",
		);
		assertEqual(
			result.failures,
			review.certified,
			true,
			"Semantic Bay topology certification badge",
		);
		assertEqual(
			result.failures,
			review.deletedPortCount,
			budget.deletedPortCount,
			"Semantic Bay exact deleted port review",
		);
		assertEqual(
			result.failures,
			review.deletedEquipmentGroupCount,
			budget.deletedEquipmentGroupCount,
			"Semantic Bay exact deleted equipment review",
		);
		assertEqual(result.failures, review.allClosed, true, "Semantic Bay all-closed evidence");
		for (const [label, actual, expected] of [
			["source authored edges", review.source.authoredEdges, budget.sourceAuthoredEdges],
			["source authored components", review.source.authoredComponents, 2],
			["source directed SCCs", review.source.directedScc, 2],
			["source physical components", review.source.physicalComponents, 2],
			["source open terminals", review.source.openTerminals, 0],
			["source clearance issues", review.source.clearanceIssues, 0],
			["source physical diagnostics", review.source.physicalDiagnostics, 0],
			["result authored edges", review.result.authoredEdges, budget.resultAuthoredEdges],
			["result authored components", review.result.authoredComponents, 1],
			["result directed SCCs", review.result.directedScc, 1],
			["result physical components", review.result.physicalComponents, 1],
			["result open terminals", review.result.openTerminals, 0],
			["result clearance issues", review.result.clearanceIssues, 0],
			["result physical diagnostics", review.result.physicalDiagnostics, 0],
		]) {
			assertEqual(result.failures, actual, expected, `Semantic Bay ${label}`);
		}
		assertEqual(
			result.failures,
			commandDiagnostics.longTaskSupported,
			true,
			"Semantic Bay command Long Task observer support",
		);
		assertEqual(
			result.failures,
			result.commandLongTasks.length,
			0,
			"Semantic Bay certification main-thread Long Tasks",
		);

		const instrumentation = commandDiagnostics.instrumentation;
		assertEqual(
			result.failures,
			instrumentation.semanticWorkerStarts,
			1,
			"Semantic Bay disposable Worker starts",
		);
		assertEqual(
			result.failures,
			instrumentation.semanticWorkerTerminations,
			1,
			"Semantic Bay disposable Worker terminations",
		);
		assertEqual(
			result.failures,
			instrumentation.railSnapshotCaptureRequests.length,
			1,
			"Semantic Bay Rail mirror snapshot captures",
		);
		const snapshotCapture = instrumentation.railSnapshotCaptureRequests[0];
		if (snapshotCapture) {
			assertEqual(
				result.failures,
				snapshotCapture.expectedSequence,
				source.workerSequence,
				"Semantic Bay mirror snapshot source sequence",
			);
			assertEqual(
				result.failures,
				snapshotCapture.expectedRevision,
				source.workerRevision,
				"Semantic Bay mirror snapshot source revision",
			);
			assertEqual(
				result.failures,
				snapshotCapture.expectedChecksum,
				source.workerChecksum,
				"Semantic Bay mirror snapshot source checksum",
			);
			assertAtLeast(
				result.failures,
				snapshotCapture.at,
				commandProbe.startedAt,
				"Semantic Bay deferred mirror snapshot capture",
			);
		}
		assertEqual(
			result.failures,
			instrumentation.semanticRequests.filter(
				(request) => request.type === "HYDRATE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
			).length,
			1,
			"Semantic Bay HYDRATE requests",
		);
		assertEqual(
			result.failures,
			instrumentation.semanticRequests.filter(
				(request) => request.type === "PREPARE_STATIC_FAB_SEMANTIC_BAY_MUTATION",
			).length,
			1,
			"Semantic Bay PREPARE requests",
		);
		assertEqual(
			result.failures,
			instrumentation.hydrateTransfers.length,
			1,
			"Semantic Bay HYDRATE transfer samples",
		);
		const transfer = result.transfer;
		assertExactSnapshotTransfer(result.failures, transfer, budget.transferBytes, "Semantic Bay");
		assertEqual(
			result.failures,
			transfer.totalBytes,
			budget.exactTransferBytes,
			"Semantic Bay exact serialized snapshot bytes",
		);
		assertEqual(
			result.failures,
			transfer.transferCount,
			budget.exactTransferBufferCount,
			"Semantic Bay exact serialized snapshot buffers",
		);
		assertEqual(
			result.failures,
			transfer.positiveBufferCount,
			budget.exactPositiveTransferBufferCount,
			"Semantic Bay exact positive snapshot buffers",
		);

		await page.screenshot({ path: path.join(directory, "certified-review.png"), fullPage: true });
		const beforeApply = await readSemanticBayScaleState(page);
		const applyProbe = await page.evaluate(() => {
			const button = document.querySelector('[data-testid="semantic-bay-command-apply"]');
			const scale = globalThis.__openFabSemanticBayScale;
			if (!(button instanceof HTMLButtonElement) || !scale) {
				throw new Error("The certified Semantic Bay Delete apply command is missing.");
			}
			const startedAt = performance.now();
			scale.applyStartedAt = startedAt;
			button.click();
			return { startedAt, dispatchMilliseconds: performance.now() - startedAt };
		});
		result.applyDispatchMilliseconds = applyProbe.dispatchMilliseconds;
		assertAtMost(
			result.failures,
			result.applyDispatchMilliseconds,
			budget.commandDispatchMilliseconds,
			"Semantic Bay Delete apply dispatch",
		);
		await dialog.waitFor({ state: "hidden", timeout: 2_000 });
		await page.waitForFunction(
			(expected) => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.workerStatus === "ready" &&
					Number(canvas.dataset.workerSequence) === expected.sequence &&
					Number(canvas.dataset.workerTargetSequence) === expected.sequence &&
					Number(canvas.dataset.workerCells) === expected.cells &&
					Number(canvas.dataset.workerEdges) === expected.authoredEdges &&
					Number(canvas.dataset.workerPorts) === expected.ports &&
					Number(canvas.dataset.workerEquipmentGroups) === expected.equipmentGroups &&
					Number(canvas.dataset.physicalPaths) === expected.physicalPaths &&
					Number(canvas.dataset.readinessStrongComponents) === 1 &&
					Number(canvas.dataset.readinessOpenTerminals) === 0 &&
					Number(canvas.dataset.staticFabOrganizationCount) === 0 &&
					Number(canvas.dataset.modelGeneration) === expected.generation &&
					canvas.dataset.modelSyncPending === "false" &&
					canvas.dataset.modelDerivationStatus === "idle" &&
					app?.dataset.organizationSelectionCount === "0"
				);
			},
			{
				sequence: beforeApply.workerSequence + 1,
				cells: budget.resultCellCount,
				authoredEdges: budget.resultAuthoredEdges,
				physicalPaths: budget.resultPhysicalPaths,
				ports: budget.resultPortCount,
				equipmentGroups: budget.resultEquipmentGroupCount,
				generation: beforeApply.modelGeneration + 1,
			},
			{ timeout: budget.mirrorReadyMilliseconds },
		);
		const mirrorReadyAt = await page.evaluate(() => performance.now());
		result.mirrorReadyMilliseconds = mirrorReadyAt - applyProbe.startedAt;
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const applyWindowEndedAt = await page.evaluate(() => performance.now());
		const after = await readSemanticBayScaleState(page);
		result.result = after;
		const finalDiagnostics = await readSemanticBayScaleDiagnostics(page, {
			commandStartedAt: commandProbe.startedAt,
			commandEndedAt: certifiedAt,
			applyStartedAt: applyProbe.startedAt,
			applyEndedAt: applyWindowEndedAt,
		});
		result.commandLongTasks = finalDiagnostics.commandLongTasks;
		result.applyLongTasks = finalDiagnostics.applyLongTasks;
		result.instrumentation = finalDiagnostics.instrumentation;

		assertAtMost(
			result.failures,
			result.mirrorReadyMilliseconds,
			budget.mirrorReadyMilliseconds,
			"Semantic Bay Delete mirror readiness",
		);
		assertEqual(
			result.failures,
			after.workerSequence,
			beforeApply.workerSequence + 1,
			"Semantic Bay Delete Worker sequence",
		);
		assertEqual(
			result.failures,
			after.workerTargetSequence,
			beforeApply.workerTargetSequence + 1,
			"Semantic Bay Delete target sequence",
		);
		assertEqual(
			result.failures,
			after.workerTargetSequence,
			after.workerSequence,
			"Semantic Bay Delete target/mirror sequence parity",
		);
		assertEqual(
			result.failures,
			after.documentPatchSequence,
			beforeApply.documentPatchSequence + 1,
			"Semantic Bay Delete document patch sequence",
		);
		assertEqual(
			result.failures,
			after.documentPatchSequence,
			after.workerSequence,
			"Semantic Bay Delete document/Worker sequence parity",
		);
		assertEqual(
			result.failures,
			after.documentRevision,
			beforeApply.documentRevision + (budget.cellCount - budget.resultCellCount),
			"Semantic Bay Delete document revision delta",
		);
		assertEqual(
			result.failures,
			after.documentRevision,
			after.workerRevision,
			"Semantic Bay Delete document/Worker revision parity",
		);
		assertEqual(
			result.failures,
			after.workerTargetRevision,
			after.workerRevision,
			"Semantic Bay Delete target/mirror revision parity",
		);
		assertEqual(
			result.failures,
			after.workerChecksum === beforeApply.workerChecksum,
			false,
			"Semantic Bay Delete checksum change",
		);
		assertEqual(
			result.failures,
			after.workerTargetChecksum,
			after.workerChecksum,
			"Semantic Bay Delete target/mirror checksum parity",
		);
		assertEqual(
			result.failures,
			after.workerCells,
			budget.resultCellCount,
			"Semantic Bay result cells",
		);
		assertEqual(
			result.failures,
			after.workerEdges,
			budget.resultAuthoredEdges,
			"Semantic Bay result authored edges",
		);
		assertEqual(
			result.failures,
			after.physicalPaths,
			budget.resultPhysicalPaths,
			"Semantic Bay result physical paths",
		);
		assertEqual(result.failures, after.strongComponents, 1, "Semantic Bay result directed SCCs");
		assertEqual(result.failures, after.openTerminals, 0, "Semantic Bay result open terminals");
		assertEqual(result.failures, after.organizations, 0, "Semantic Bay result organizations");
		assertEqual(result.failures, after.workerOrganizations, 0, "Semantic Bay Worker organizations");
		assertEqual(
			result.failures,
			after.documentPortCount,
			budget.resultPortCount,
			"Semantic Bay retained document ports",
		);
		assertEqual(
			result.failures,
			after.workerPorts,
			budget.resultPortCount,
			"Semantic Bay retained Worker ports",
		);
		assertEqual(
			result.failures,
			after.documentEquipmentGroupCount,
			budget.resultEquipmentGroupCount,
			"Semantic Bay retained document equipment groups",
		);
		assertEqual(
			result.failures,
			after.workerEquipmentGroups,
			budget.resultEquipmentGroupCount,
			"Semantic Bay retained Worker equipment groups",
		);
		assertEqual(result.failures, after.portIds, "5", "Semantic Bay retained port identity");
		assertEqual(result.failures, after.portTypes, "OHB", "Semantic Bay retained port type");
		assertEqual(
			result.failures,
			after.portDirections,
			"AGAINST_TRAVEL",
			"Semantic Bay retained port direction",
		);
		assertEqual(
			result.failures,
			after.equipmentGroupIds,
			"4",
			"Semantic Bay retained equipment identity",
		);
		assertEqual(
			result.failures,
			after.equipmentGroupKinds,
			"OHB",
			"Semantic Bay retained equipment kind",
		);
		assertEqual(
			result.failures,
			after.organizationEquipmentMembership,
			"",
			"Semantic Bay removed organization equipment ownership",
		);
		assertEqual(result.failures, after.nextPortId, budget.nextPortId, "Semantic Bay port cursor");
		assertEqual(
			result.failures,
			after.nextEquipmentGroupId,
			budget.nextEquipmentGroupId,
			"Semantic Bay equipment cursor",
		);
		assertEqual(
			result.failures,
			after.modelChecksum,
			after.workerChecksum,
			"Semantic Bay result model/Worker checksum parity",
		);
		assertEqual(
			result.failures,
			after.modelPhysicalFingerprint,
			after.workerPhysicalFingerprint,
			"Semantic Bay result model/Worker physical parity",
		);
		assertEqual(result.failures, after.selectionCount, 0, "Semantic Bay result selection count");
		assertEqual(result.failures, after.selectionIds, "", "Semantic Bay result selection IDs");
		assertEqual(
			result.failures,
			after.workerSimulationReady,
			false,
			"Semantic Bay result simulation gate",
		);
		assertEqual(
			result.failures,
			after.semanticBaySnapshotStatus,
			"committed",
			"Semantic Bay committed telemetry",
		);
		assertEqual(
			result.failures,
			after.modelDerivationStatus,
			"idle",
			"Semantic Bay derived-model status",
		);
		assertEqual(
			result.failures,
			after.modelSyncPending,
			false,
			"Semantic Bay derived-model pending state",
		);
		assertAtMost(
			result.failures,
			after.modelDerivationDispatchMilliseconds,
			budget.modelDerivationDispatchMilliseconds,
			"Semantic Bay derived-model dispatch",
		);
		assertAtMost(
			result.failures,
			after.modelDerivationPreparationMilliseconds,
			budget.modelDerivationPreparationMilliseconds,
			"Semantic Bay prepared draft artifact adoption",
		);
		assertAtMost(
			result.failures,
			after.modelDerivationActivationMaxSliceMilliseconds,
			budget.modelDerivationActivationMaxSliceMilliseconds,
			"Semantic Bay cooperative activation max slice",
		);
		assertEqual(
			result.failures,
			after.draftCommittedAdjacencyBuilds,
			beforeApply.draftCommittedAdjacencyBuilds,
			"Semantic Bay main-thread committed adjacency builds",
		);
		assertEqual(
			result.failures,
			finalDiagnostics.commandLongTasks.length,
			0,
			"Semantic Bay complete certification main-thread Long Tasks",
		);
		assertEqual(
			result.failures,
			finalDiagnostics.applyLongTasks.length,
			0,
			"Semantic Bay apply main-thread Long Tasks",
		);
		assertEqual(
			result.failures,
			finalDiagnostics.instrumentation.semanticWorkerStarts,
			1,
			"Semantic Bay final Worker starts",
		);
		assertEqual(
			result.failures,
			finalDiagnostics.instrumentation.semanticWorkerTerminations,
			1,
			"Semantic Bay final Worker terminations",
		);
		assertEqual(
			result.failures,
			finalDiagnostics.instrumentation.railSnapshotCaptureRequests.length,
			2,
			"Semantic Bay final mirror snapshot captures",
		);
		const resultSnapshotCapture = finalDiagnostics.instrumentation.railSnapshotCaptureRequests[1];
		if (resultSnapshotCapture) {
			assertEqual(
				result.failures,
				resultSnapshotCapture.expectedSequence,
				after.workerSequence,
				"Semantic Bay derived-model snapshot sequence",
			);
			assertEqual(
				result.failures,
				resultSnapshotCapture.expectedRevision,
				after.workerRevision,
				"Semantic Bay derived-model snapshot revision",
			);
			assertEqual(
				result.failures,
				resultSnapshotCapture.expectedChecksum,
				after.workerChecksum,
				"Semantic Bay derived-model snapshot checksum",
			);
			assertAtLeast(
				result.failures,
				resultSnapshotCapture.at,
				applyProbe.startedAt,
				"Semantic Bay post-commit mirror snapshot timing",
			);
		}
		await waitForSemanticBayWorkerRelease(page, 2_000);
		const liveSemanticWorkerUrls = page
			.workers()
			.map((worker) => worker.url())
			.filter((url) => /staticFabSemanticBayMutationWorker/i.test(url));
		result.instrumentation = {
			...result.instrumentation,
			liveSemanticWorkerUrls,
		};
		assertEqual(
			result.failures,
			liveSemanticWorkerUrls.length,
			0,
			"Semantic Bay live Workers after apply",
		);

		Object.assign(
			result,
			await measureBayCommandRetainedHeap(
				cdp,
				page,
				"__openFabSemanticBayScale",
				heapBefore,
				budget,
				result.failures,
				"Semantic Bay",
			),
		);

		const postGcDiagnostics = await readSemanticBayScaleDiagnostics(page, {
			commandStartedAt: commandProbe.startedAt,
			commandEndedAt: certifiedAt,
			applyStartedAt: applyProbe.startedAt,
			applyEndedAt: applyWindowEndedAt,
		});
		result.commandLongTasks = postGcDiagnostics.commandLongTasks;
		result.applyLongTasks = postGcDiagnostics.applyLongTasks;
		assertEqual(
			result.failures,
			postGcDiagnostics.commandLongTasks.length,
			0,
			"Semantic Bay final certification main-thread Long Tasks",
		);
		assertEqual(
			result.failures,
			postGcDiagnostics.applyLongTasks.length,
			0,
			"Semantic Bay final apply main-thread Long Tasks",
		);
		assertEqual(result.failures, postGcDiagnostics.errors.length, 0, "Semantic Bay window errors");
		assertEqual(
			result.failures,
			postGcDiagnostics.rejections.length,
			0,
			"Semantic Bay unhandled rejections",
		);
		assertEqual(result.failures, consoleErrors.length, 0, "Semantic Bay console errors");
		assertEqual(result.failures, pageErrors.length, 0, "Semantic Bay page errors");
		await page.screenshot({ path: path.join(directory, "applied.png"), fullPage: true });
	} catch (error) {
		result.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
		await page
			.screenshot({ path: path.join(directory, "failure.png"), fullPage: true })
			.catch(() => undefined);
	} finally {
		await writeFile(path.join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
		await closeBrowserResource(context, "Semantic Bay Delete scale context");
	}
	return result;
}

async function runBayFlowEditScaleScenario(activeBrowser) {
	const budget = RAIL_BAY_FLOW_EDIT_SCALE_BUDGET;
	const context = await activeBrowser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	await context.addInitScript(() => {
		const scale = {
			longTasks: [],
			errors: [],
			rejections: [],
			observer: null,
			longTaskSupported: false,
			workerStarts: 0,
			workerTerminations: 0,
			hierarchyWorkerStarts: 0,
			hierarchyWorkerTerminations: 0,
			workerRequests: [],
			railSnapshotCaptureRequests: [],
			hydrateTransfers: [],
			commandStartedAt: null,
			applyStartedAt: null,
		};
		globalThis.__openFabBayFlowEditScale = scale;

		const NativeWorker = globalThis.Worker;
		const bayFlowWorkers = new WeakSet();
		const hierarchyWorkers = new WeakSet();
		const nativeWorkerPostMessage = NativeWorker.prototype.postMessage;
		const nativeWorkerTerminate = NativeWorker.prototype.terminate;
		const collectArrayBuffers = (root) => {
			const buffers = new Set();
			const visited = new WeakSet();
			const visit = (value) => {
				if (value === null || typeof value !== "object") return;
				if (value instanceof ArrayBuffer) {
					buffers.add(value);
					return;
				}
				if (ArrayBuffer.isView(value)) {
					if (value.buffer instanceof ArrayBuffer) buffers.add(value.buffer);
					return;
				}
				if (visited.has(value)) return;
				visited.add(value);
				if (value instanceof Map) {
					for (const [key, entry] of value) {
						visit(key);
						visit(entry);
					}
					return;
				}
				if (value instanceof Set) {
					for (const entry of value) visit(entry);
					return;
				}
				for (const entry of Object.values(value)) visit(entry);
			};
			visit(root);
			return [...buffers];
		};

		NativeWorker.prototype.postMessage = function (...argumentsList) {
			const message = argumentsList[0];
			let transferProbe = null;
			if (
				message?.type === "CAPTURE_RAIL_SNAPSHOT" &&
				scale.commandStartedAt !== null &&
				scale.applyStartedAt === null
			) {
				scale.railSnapshotCaptureRequests.push({
					at: performance.now(),
					requestId: message.requestId,
					epoch: message.epoch,
					expectedSequence: message.expectedSequence,
					expectedRevision: message.expectedRevision,
					expectedChecksum: message.expectedChecksum,
				});
			}
			if (bayFlowWorkers.has(this)) {
				if (
					message?.type === "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT" ||
					message?.type === "PREPARE_STATIC_FAB_BAY_FLOW_EDIT"
				) {
					scale.workerRequests.push({
						at: performance.now(),
						type: message.type,
						requestId: message.requestId ?? null,
					});
				}
				if (message?.type === "HYDRATE_STATIC_FAB_BAY_FLOW_EDIT") {
					const transferArgument = argumentsList[1];
					const transferables = Array.isArray(transferArgument)
						? transferArgument
						: Array.isArray(transferArgument?.transfer)
							? transferArgument.transfer
							: [];
					const transferBuffers = transferables.filter((entry) => entry instanceof ArrayBuffer);
					const positiveTransferBuffers = transferBuffers.filter((buffer) => buffer.byteLength > 0);
					const snapshotBuffers = collectArrayBuffers(message.snapshot);
					const uniqueTransferBuffers = new Set(transferBuffers);
					const snapshotBufferSet = new Set(snapshotBuffers);
					transferProbe = {
						at: performance.now(),
						requestId: message.requestId,
						transferCount: transferables.length,
						arrayBufferCount: transferBuffers.length,
						positiveBufferCount: positiveTransferBuffers.length,
						uniqueCount: uniqueTransferBuffers.size,
						duplicateCount: transferBuffers.length - uniqueTransferBuffers.size,
						totalBytes: transferBuffers.reduce((total, buffer) => total + buffer.byteLength, 0),
						snapshotBufferCount: snapshotBuffers.length,
						snapshotBufferBytes: snapshotBuffers.reduce(
							(total, buffer) => total + buffer.byteLength,
							0,
						),
						allArrayBuffers: transferBuffers.length === transferables.length,
						exactTransferSet:
							uniqueTransferBuffers.size === snapshotBufferSet.size &&
							[...uniqueTransferBuffers].every((buffer) => snapshotBufferSet.has(buffer)),
						transferBuffers,
						positiveTransferBuffers,
					};
				}
			}
			const posted = Reflect.apply(nativeWorkerPostMessage, this, argumentsList);
			if (transferProbe) {
				const detachedCount = transferProbe.transferBuffers.filter(
					(buffer) => buffer.byteLength === 0,
				).length;
				const observablyDetachedCount = transferProbe.positiveTransferBuffers.filter(
					(buffer) => buffer.byteLength === 0,
				).length;
				scale.hydrateTransfers.push({
					at: transferProbe.at,
					requestId: transferProbe.requestId,
					transferCount: transferProbe.transferCount,
					arrayBufferCount: transferProbe.arrayBufferCount,
					positiveBufferCount: transferProbe.positiveBufferCount,
					uniqueCount: transferProbe.uniqueCount,
					duplicateCount: transferProbe.duplicateCount,
					totalBytes: transferProbe.totalBytes,
					snapshotBufferCount: transferProbe.snapshotBufferCount,
					snapshotBufferBytes: transferProbe.snapshotBufferBytes,
					allArrayBuffers: transferProbe.allArrayBuffers,
					exactTransferSet: transferProbe.exactTransferSet,
					detachedCount,
					allDetached: detachedCount === transferProbe.transferBuffers.length,
					observablyDetachedCount,
					observableAllDetached:
						observablyDetachedCount === transferProbe.positiveTransferBuffers.length,
				});
			}
			return posted;
		};
		NativeWorker.prototype.terminate = function (...argumentsList) {
			if (bayFlowWorkers.delete(this)) scale.workerTerminations++;
			if (hierarchyWorkers.delete(this)) scale.hierarchyWorkerTerminations++;
			return Reflect.apply(nativeWorkerTerminate, this, argumentsList);
		};
		globalThis.Worker = new Proxy(NativeWorker, {
			construct(target, argumentsList) {
				const source = String(argumentsList[0] ?? "");
				const worker = Reflect.construct(target, argumentsList);
				if (/staticFabBayFlowEditWorker/i.test(source)) {
					scale.workerStarts++;
					bayFlowWorkers.add(worker);
				}
				if (/staticFabHierarchyWorker/i.test(source)) {
					scale.hierarchyWorkerStarts++;
					hierarchyWorkers.add(worker);
				}
				return worker;
			},
		});

		if (typeof PerformanceObserver !== "undefined") {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
				}
			});
			try {
				observer.observe({ type: "longtask", buffered: true });
				scale.longTaskSupported = true;
				scale.observer = observer;
			} catch {
				// Unsupported browsers are rejected by the acceptance assertions below.
			}
		}
		addEventListener("error", (event) => {
			scale.errors.push(String(event.error?.message ?? event.message));
		});
		addEventListener("unhandledrejection", (event) => {
			scale.rejections.push(String(event.reason));
		});
	});

	const page = await context.newPage();
	const consoleErrors = [];
	const pageErrors = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const result = {
		cellCount: budget.cellCount,
		readyMilliseconds: Number.POSITIVE_INFINITY,
		commandDispatchMilliseconds: Number.POSITIVE_INFINITY,
		firstPaintMilliseconds: Number.POSITIVE_INFINITY,
		certificationMilliseconds: Number.POSITIVE_INFINITY,
		hydrationMilliseconds: Number.POSITIVE_INFINITY,
		workerRoundTripMilliseconds: Number.POSITIVE_INFINITY,
		responseValidationMilliseconds: Number.POSITIVE_INFINITY,
		adoptionMilliseconds: Number.POSITIVE_INFINITY,
		applyDispatchMilliseconds: Number.POSITIVE_INFINITY,
		mirrorReadyMilliseconds: Number.POSITIVE_INFINITY,
		source: {},
		review: {},
		result: {},
		transfer: {
			transferCount: 0,
			uniqueCount: 0,
			totalBytes: Number.POSITIVE_INFINITY,
			detachedCount: 0,
		},
		instrumentation: {},
		commandLongTasks: [],
		applyLongTasks: [],
		retainedHeapGrowth: {
			usedSize: Number.POSITIVE_INFINITY,
			embedderHeapUsedSize: Number.POSITIVE_INFINITY,
			backingStorageSize: Number.POSITIVE_INFINITY,
		},
		retainedHeapSignedDelta: {
			usedSize: Number.POSITIVE_INFINITY,
			embedderHeapUsedSize: Number.POSITIVE_INFINITY,
			backingStorageSize: Number.POSITIVE_INFINITY,
		},
		retainedHeapBudget: {},
		memoryCycle: null,
		coldHeapBefore: null,
		heapBefore: null,
		heapAfter: null,
		consoleErrors,
		pageErrors,
		failures: [],
	};
	const directory = path.join(artifactRoot, `bay-flow-edit-${budget.cellCount}`);
	await mkdir(directory, { recursive: true });

	try {
		const readyStartedAt = performance.now();
		await page.goto(`${baseUrl}/?scaleFixture=${budget.cellCount}&scaleRoots=${budget.rootCount}`, {
			waitUntil: "domcontentloaded",
			timeout: budget.readyMilliseconds,
		});
		await page.waitForFunction(
			(expected) => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					app?.dataset.startupStatus === "ready" &&
					canvas?.dataset.workerStatus === "ready" &&
					Number(canvas.dataset.workerCells) === expected.cells &&
					Number(canvas.dataset.workerEdges) === expected.authoredEdges &&
					Number(canvas.dataset.physicalPaths) === expected.physicalPaths &&
					Number(canvas.dataset.staticFabOrganizationCount) === expected.organizations &&
					Number(canvas.dataset.readinessStrongComponents) === expected.strongComponents &&
					Number(canvas.dataset.readinessOpenTerminals) === 0
				);
			},
			{
				cells: budget.cellCount,
				authoredEdges: budget.sourceAuthoredEdges,
				physicalPaths: budget.sourcePhysicalPaths,
				organizations: budget.organizationCount,
				strongComponents: budget.strongComponentCount,
			},
			{ timeout: budget.readyMilliseconds },
		);
		result.readyMilliseconds = performance.now() - readyStartedAt;
		const startupFailure = await page
			.getByTestId("rail-canvas")
			.evaluate((canvas) => canvas.dataset.startupMessage ?? "");
		if (startupFailure)
			throw new Error(`Bay Flow Edit scale fixture startup failed: ${startupFailure}`);

		const source = await readBayFlowEditScaleState(page);
		result.source = source;
		assertAtMost(
			result.failures,
			result.readyMilliseconds,
			budget.readyMilliseconds,
			"100k+ Bay Flow Edit fixture readiness",
		);
		for (const [label, actual, expected] of [
			[
				"serialized startup schema contract",
				source.scaleAcceptanceVersion,
				budget.startupSchemaVersion,
			],
			[
				"acceptance/startup schema version parity",
				budget.startupSchemaVersion,
				RAIL_SCALE_ACCEPTANCE_VERSION,
			],
			["fixture cells", source.scaleFixtureCells, budget.cellCount],
			["source cells", source.workerCells, budget.cellCount],
			["source authored edges", source.workerEdges, budget.sourceAuthoredEdges],
			["source physical paths", source.physicalPaths, budget.sourcePhysicalPaths],
			["source directed SCCs", source.strongComponents, budget.strongComponentCount],
			["source open terminals", source.openTerminals, 0],
			["source organizations", source.organizations, budget.organizationCount],
			["source target/mirror checksum parity", source.workerTargetChecksum, source.workerChecksum],
			["source model/mirror checksum parity", source.modelChecksum, source.workerChecksum],
			[
				"source model/Worker physical parity",
				source.modelPhysicalFingerprint,
				source.workerPhysicalFingerprint,
			],
			["simulation gate", source.workerSimulationReady, false],
		]) {
			assertEqual(result.failures, actual, expected, `Bay Flow Edit ${label}`);
		}
		assertAtLeast(
			result.failures,
			source.modelPhysicalFingerprint.length,
			1,
			"Bay Flow Edit source physical fingerprint",
		);

		await activateEditorActivity(page, "assemble");
		await page.locator('button[aria-label^="FAB 조직 ("]').click();
		const organizationLibrary = page.getByTestId("static-fab-organization-library");
		await organizationLibrary.waitFor({ state: "visible" });
		const detachedBay = organizationLibrary.locator(
			`[data-organization-id="${budget.targetBayOrganizationId}"]`,
		);
		await detachedBay.waitFor({ state: "visible" });
		await detachedBay.click();
		await page.waitForFunction(
			(expectedOrganizationId) => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				return (
					app?.dataset.organizationSelectionCount === "1" &&
					app.dataset.organizationSelectionIds === String(expectedOrganizationId)
				);
			},
			budget.targetBayOrganizationId,
			{ timeout: 10_000 },
		);
		await organizationLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
		const assembleMenu = page.getByTestId("static-fab-assemble-menu");
		if (!(await assembleMenu.isVisible().catch(() => false))) {
			await page.getByTestId("editor-activity-assemble").click();
		}
		await assembleMenu.waitFor({ state: "visible" });
		const target = assembleMenu.getByTestId("assemble-edit-selected-bay-co-rotating");
		assertEqual(
			result.failures,
			await target.isEnabled(),
			true,
			"explicit CO-ROTATING target state",
		);
		assertEqual(
			result.failures,
			await target.getAttribute("data-target-pattern"),
			budget.targetInternalFlowPattern,
			"explicit CO-ROTATING target identity",
		);

		const cdp = await context.newCDPSession(page);
		await collectBayFlowEditScaleGarbageOutsideProductWindow(cdp, page);
		result.coldHeapBefore = await cdp.send("Runtime.getHeapUsage");
		const commandProbe = await page.evaluate(() => {
			const button = document.querySelector(
				'[data-testid="assemble-edit-selected-bay-co-rotating"]',
			);
			const scale = globalThis.__openFabBayFlowEditScale;
			if (!(button instanceof HTMLButtonElement) || !scale) {
				throw new Error("The explicit Bay Flow Edit CO-ROTATING command is missing.");
			}
			const startedAt = performance.now();
			scale.commandStartedAt = startedAt;
			button.click();
			return { startedAt, dispatchMilliseconds: performance.now() - startedAt };
		});
		result.commandDispatchMilliseconds = commandProbe.dispatchMilliseconds;
		assertAtMost(
			result.failures,
			result.commandDispatchMilliseconds,
			budget.commandDispatchMilliseconds,
			"Bay Flow Edit command dispatch",
		);

		const dialog = page.getByTestId("bay-flow-edit-dialog");
		await dialog.waitFor({ state: "visible", timeout: budget.firstPaintMilliseconds * 4 });
		await page.waitForFunction(
			() => {
				const candidate = document.querySelector('[data-testid="bay-flow-edit-dialog"]');
				return ["ready", "rejected"].includes(candidate?.getAttribute("data-phase") ?? "");
			},
			undefined,
			{ timeout: budget.certificationMilliseconds },
		);
		const certifiedAt = await page.evaluate(() => performance.now());
		result.certificationMilliseconds = certifiedAt - commandProbe.startedAt;
		if ((await dialog.getAttribute("data-phase")) !== "ready") {
			throw new Error(`100k+ Bay Flow Edit was rejected: ${await dialog.textContent()}`);
		}
		const commandWindowEndedAt = await page.evaluate(
			() =>
				new Promise((resolve) =>
					requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))),
				),
		);
		const review = await readBayFlowEditEvidence(page);
		const certifiedState = await readBayFlowEditScaleState(page);
		const commandDiagnostics = await readBayFlowEditScaleDiagnostics(page, {
			commandStartedAt: commandProbe.startedAt,
			commandEndedAt: commandWindowEndedAt,
			applyStartedAt: null,
			applyEndedAt: null,
		});
		result.firstPaintMilliseconds = certifiedState.bayFlowEditFirstPaintMilliseconds;
		result.hydrationMilliseconds = certifiedState.bayFlowEditHydrationMilliseconds;
		result.workerRoundTripMilliseconds = certifiedState.bayFlowEditWorkerRoundTripMilliseconds;
		result.responseValidationMilliseconds =
			certifiedState.bayFlowEditResponseValidationMilliseconds;
		result.adoptionMilliseconds = certifiedState.bayFlowEditAdoptionMilliseconds;
		result.certification = certifiedState;
		result.review = review;
		result.instrumentation = commandDiagnostics.instrumentation;
		result.transfer = commandDiagnostics.instrumentation.hydrateTransfers[0] ?? result.transfer;
		result.commandLongTasks = commandDiagnostics.commandLongTasks;

		assertEqual(result.failures, review.phase, "ready", "Bay Flow Edit ready review phase");
		assertEqual(
			result.failures,
			review.targetInternalFlowPattern,
			budget.targetInternalFlowPattern,
			"Bay Flow Edit ready review target",
		);
		assertEqual(
			result.failures,
			review.sourceInternalFlowPattern,
			budget.sourceInternalFlowPattern,
			"Bay Flow Edit recognized source flow",
		);
		assertEqual(result.failures, review.detachedBay, true, "Bay Flow Edit detached gateway review");
		assertEqual(
			result.failures,
			review.certified,
			true,
			"Bay Flow Edit Worker certification badge",
		);
		assertEqual(
			result.failures,
			review.countsEqual,
			true,
			"Bay Flow Edit source/result count parity review",
		);
		assertEqual(
			result.failures,
			review.removedDirectedEdges,
			budget.replacedDirectedEdgeCount,
			"Bay Flow Edit exact removed directed edges",
		);
		assertEqual(
			result.failures,
			review.addedDirectedEdges,
			budget.replacedDirectedEdgeCount,
			"Bay Flow Edit exact added directed edges",
		);
		assertEqual(
			result.failures,
			review.changedCells,
			budget.changedCellCount,
			"Bay Flow Edit exact changed cells",
		);
		assertEqual(
			result.failures,
			review.changedOrganizations,
			budget.changedOrganizationCount,
			"Bay Flow Edit exact changed existing memberships",
		);
		for (const [label, actual, expected] of [
			["source authored cells", review.authoredCells, budget.cellCount],
			["source authored edges", review.authoredEdges, budget.sourceAuthoredEdges],
			["source authored weak components", review.authoredComponents, budget.weakComponentCount],
			[
				"source authored directed SCCs",
				review.authoredStrongComponents,
				budget.strongComponentCount,
			],
			["source physical paths", review.physicalPaths, budget.sourcePhysicalPaths],
			["source physical weak components", review.physicalComponents, budget.weakComponentCount],
			[
				"source physical directed SCCs",
				review.physicalStrongComponents,
				budget.strongComponentCount,
			],
			["prospective authored edges", review.prospectiveAuthoredEdges, budget.resultAuthoredEdges],
			["prospective physical paths", review.prospectivePhysicalPaths, budget.resultPhysicalPaths],
		]) {
			assertEqual(result.failures, actual, expected, `Bay Flow Edit ${label}`);
		}
		for (const [label, actual, maximum] of [
			["first paint", result.firstPaintMilliseconds, budget.firstPaintMilliseconds],
			["exact certification", result.certificationMilliseconds, budget.certificationMilliseconds],
			["hydration", result.hydrationMilliseconds, budget.hydrationMilliseconds],
			["Worker round trip", result.workerRoundTripMilliseconds, budget.workerRoundTripMilliseconds],
			[
				"response validation",
				result.responseValidationMilliseconds,
				budget.responseValidationMilliseconds,
			],
			["one-shot adoption", result.adoptionMilliseconds, budget.adoptionMilliseconds],
		]) {
			assertAtMost(result.failures, actual, maximum, `Bay Flow Edit ${label}`);
		}
		for (const [label, actual, expected] of [
			["certified snapshot status", certifiedState.bayFlowEditSnapshotStatus, "certified"],
			[
				"pre-Apply organization browse selection remains unmaterialized",
				certifiedState.areaSelectionProvenance,
				"",
			],
			["legacy hierarchy request", certifiedState.staticFabHierarchyRequested, false],
			[
				"mirror-owned snapshot source size",
				certifiedState.bayFlowEditSnapshotSourceCells,
				budget.cellCount,
			],
			["command Long Task observer support", commandDiagnostics.longTaskSupported, true],
			["certification main-thread Long Tasks", result.commandLongTasks.length, 0],
		]) {
			assertEqual(result.failures, actual, expected, `Bay Flow Edit ${label}`);
		}
		assertAtLeast(
			result.failures,
			result.responseValidationMilliseconds,
			0,
			"Bay Flow Edit response validation telemetry",
		);
		assertAtLeast(
			result.failures,
			result.adoptionMilliseconds,
			0,
			"Bay Flow Edit one-shot adoption telemetry",
		);

		const instrumentation = commandDiagnostics.instrumentation;
		for (const [label, actual, expected] of [
			["disposable Worker starts", instrumentation.workerStarts, 1],
			["disposable Worker terminations", instrumentation.workerTerminations, 1],
			["legacy hierarchy Worker starts", instrumentation.hierarchyWorkerStarts, 0],
			["legacy hierarchy Worker terminations", instrumentation.hierarchyWorkerTerminations, 0],
			["mirror snapshot captures", instrumentation.railSnapshotCaptureRequests.length, 1],
			["Worker requests", instrumentation.workerRequests.length, 2],
			[
				"HYDRATE request",
				instrumentation.workerRequests[0]?.type,
				"HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
			],
			[
				"PREPARE request",
				instrumentation.workerRequests[1]?.type,
				"PREPARE_STATIC_FAB_BAY_FLOW_EDIT",
			],
			["HYDRATE transfer samples", instrumentation.hydrateTransfers.length, 1],
		]) {
			assertEqual(result.failures, actual, expected, `Bay Flow Edit ${label}`);
		}
		const snapshotCapture = instrumentation.railSnapshotCaptureRequests[0];
		if (snapshotCapture) {
			for (const [label, actual, expected] of [
				["sequence", snapshotCapture.expectedSequence, source.workerSequence],
				["revision", snapshotCapture.expectedRevision, source.workerRevision],
				["checksum", snapshotCapture.expectedChecksum, source.workerChecksum],
			]) {
				assertEqual(
					result.failures,
					actual,
					expected,
					`Bay Flow Edit mirror snapshot source ${label}`,
				);
			}
			assertAtLeast(
				result.failures,
				snapshotCapture.at,
				commandProbe.startedAt + result.firstPaintMilliseconds,
				"Bay Flow Edit snapshot capture deferred until first paint",
			);
		}
		const transfer = result.transfer;
		assertExactSnapshotTransfer(result.failures, transfer, budget.transferBytes, "Bay Flow Edit");

		await page.screenshot({ path: path.join(directory, "certified-review.png"), fullPage: true });
		const beforeApply = await readBayFlowEditScaleState(page);
		const applyProbe = await page.evaluate(() => {
			const button = document.querySelector('[data-testid="bay-flow-edit-apply"]');
			const scale = globalThis.__openFabBayFlowEditScale;
			if (!(button instanceof HTMLButtonElement) || !scale) {
				throw new Error("The certified Bay Flow Edit apply command is missing.");
			}
			const startedAt = performance.now();
			scale.applyStartedAt = startedAt;
			button.click();
			return { startedAt, dispatchMilliseconds: performance.now() - startedAt };
		});
		result.applyDispatchMilliseconds = applyProbe.dispatchMilliseconds;
		assertAtMost(
			result.failures,
			result.applyDispatchMilliseconds,
			budget.commandDispatchMilliseconds,
			"Bay Flow Edit apply dispatch",
		);
		await dialog.waitFor({ state: "hidden", timeout: 2_000 });
		await page.waitForFunction(
			(expected) => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.workerStatus === "ready" &&
					Number(canvas.dataset.workerSequence) === expected.sequence &&
					Number(canvas.dataset.workerTargetSequence) === expected.sequence &&
					Number(canvas.dataset.workerCells) === expected.cells &&
					Number(canvas.dataset.workerEdges) === expected.authoredEdges &&
					Number(canvas.dataset.physicalPaths) === expected.physicalPaths &&
					Number(canvas.dataset.readinessStrongComponents) === expected.strongComponents &&
					Number(canvas.dataset.readinessOpenTerminals) === 0 &&
					Number(canvas.dataset.staticFabOrganizationCount) === expected.organizations &&
					Number(canvas.dataset.workerOrganizations) === expected.organizations &&
					Number(canvas.dataset.modelGeneration) === expected.generation &&
					canvas.dataset.modelSyncPending === "false" &&
					canvas.dataset.modelDerivationStatus === "idle" &&
					app?.dataset.organizationSelectionCount === "1" &&
					app.dataset.organizationSelectionIds === String(expected.targetBayOrganizationId)
				);
			},
			{
				sequence: beforeApply.workerSequence + 1,
				cells: budget.cellCount,
				authoredEdges: budget.resultAuthoredEdges,
				physicalPaths: budget.resultPhysicalPaths,
				strongComponents: budget.strongComponentCount,
				organizations: budget.organizationCount,
				generation: beforeApply.modelGeneration + 1,
				targetBayOrganizationId: budget.targetBayOrganizationId,
			},
			{ timeout: budget.mirrorReadyMilliseconds },
		);
		const mirrorReadyAt = await page.evaluate(() => performance.now());
		result.mirrorReadyMilliseconds = mirrorReadyAt - applyProbe.startedAt;
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		const applyWindowEndedAt = await page.evaluate(() => performance.now());
		const after = await readBayFlowEditScaleState(page);
		result.result = after;
		const finalDiagnostics = await readBayFlowEditScaleDiagnostics(page, {
			commandStartedAt: commandProbe.startedAt,
			commandEndedAt: commandWindowEndedAt,
			applyStartedAt: applyProbe.startedAt,
			applyEndedAt: applyWindowEndedAt,
		});
		result.commandLongTasks = finalDiagnostics.commandLongTasks;
		result.applyLongTasks = finalDiagnostics.applyLongTasks;
		result.instrumentation = finalDiagnostics.instrumentation;

		assertAtMost(
			result.failures,
			result.mirrorReadyMilliseconds,
			budget.mirrorReadyMilliseconds,
			"Bay Flow Edit mirror/model readiness",
		);
		for (const [label, actual, expected] of [
			["Worker sequence", after.workerSequence, beforeApply.workerSequence + 1],
			["target sequence", after.workerTargetSequence, beforeApply.workerTargetSequence + 1],
			[
				"Worker revision",
				after.workerRevision,
				beforeApply.workerRevision + budget.changedCellCount,
			],
			[
				"target revision",
				after.workerTargetRevision,
				beforeApply.workerTargetRevision + budget.changedCellCount,
			],
			[
				"document revision",
				after.documentRevision,
				beforeApply.documentRevision + budget.changedCellCount,
			],
			["checksum change", after.workerChecksum === beforeApply.workerChecksum, false],
			["target/mirror checksum parity", after.workerTargetChecksum, after.workerChecksum],
			["model/mirror checksum parity", after.modelChecksum, after.workerChecksum],
			[
				"model/Worker physical parity",
				after.modelPhysicalFingerprint,
				after.workerPhysicalFingerprint,
			],
			["result cells", after.workerCells, source.workerCells],
			["result authored edges", after.workerEdges, source.workerEdges],
			["result physical paths", after.physicalPaths, source.physicalPaths],
			["result directed SCCs", after.strongComponents, source.strongComponents],
			["result organizations", after.organizations, source.organizations],
			["Worker organizations", after.workerOrganizations, source.workerOrganizations],
			["organization identities", after.organizationIds, source.organizationIds],
			["next organization ID", after.nextOrganizationId, source.nextOrganizationId],
			["equipment ports", after.equipmentPorts, source.equipmentPorts],
			["equipment groups", after.equipmentGroups, source.equipmentGroups],
			["result open terminals", after.openTerminals, 0],
			["preserved selection count", after.selectionCount, 1],
			["preserved selection ID", after.selectionIds, String(budget.targetBayOrganizationId)],
			["preserved selection provenance", after.areaSelectionProvenance, "organization"],
			["legacy hierarchy remains idle", after.staticFabHierarchyRequested, false],
			["result simulation gate", after.workerSimulationReady, false],
			["committed telemetry", after.bayFlowEditSnapshotStatus, "committed"],
			["derived-model status", after.modelDerivationStatus, "idle"],
			["derived-model pending state", after.modelSyncPending, false],
			[
				"main-thread committed adjacency builds",
				after.draftCommittedAdjacencyBuilds,
				beforeApply.draftCommittedAdjacencyBuilds,
			],
			[
				"complete certification main-thread Long Tasks",
				finalDiagnostics.commandLongTasks.length,
				0,
			],
			["apply main-thread Long Tasks", finalDiagnostics.applyLongTasks.length, 0],
			["final Worker starts", finalDiagnostics.instrumentation.workerStarts, 1],
			["final Worker terminations", finalDiagnostics.instrumentation.workerTerminations, 1],
			[
				"final legacy hierarchy Worker starts",
				finalDiagnostics.instrumentation.hierarchyWorkerStarts,
				0,
			],
			[
				"final legacy hierarchy Worker terminations",
				finalDiagnostics.instrumentation.hierarchyWorkerTerminations,
				0,
			],
			[
				"final command snapshot captures",
				finalDiagnostics.instrumentation.railSnapshotCaptureRequests.length,
				1,
			],
		]) {
			assertEqual(result.failures, actual, expected, `Bay Flow Edit ${label}`);
		}
		assertAtLeast(
			result.failures,
			after.modelPhysicalFingerprint.length,
			1,
			"Bay Flow Edit result physical fingerprint",
		);
		for (const [label, actual, maximum] of [
			[
				"derived-model dispatch",
				after.modelDerivationDispatchMilliseconds,
				budget.modelDerivationDispatchMilliseconds,
			],
			[
				"prepared draft artifact adoption",
				after.modelDerivationPreparationMilliseconds,
				budget.modelDerivationPreparationMilliseconds,
			],
			[
				"cooperative activation max slice",
				after.modelDerivationActivationMaxSliceMilliseconds,
				budget.modelDerivationActivationMaxSliceMilliseconds,
			],
		]) {
			assertAtMost(result.failures, actual, maximum, `Bay Flow Edit ${label}`);
		}

		await waitForBayFlowEditWorkerRelease(page, 2_000);
		const liveWorkerUrls = page
			.workers()
			.map((worker) => worker.url())
			.filter((url) => /staticFabBayFlowEditWorker/i.test(url));
		result.instrumentation = { ...result.instrumentation, liveWorkerUrls };
		assertEqual(
			result.failures,
			liveWorkerUrls.length,
			0,
			"Bay Flow Edit live Workers after apply",
		);
		for (const [label, actual, expected] of [
			["warm target history can undo", after.historyCanUndo, "true"],
			["warm target history can redo", after.historyCanRedo, "false"],
			["warm target Assemble menu", await assembleMenu.isVisible(), false],
			[
				"warm target Canvas focus",
				await page
					.getByTestId("rail-canvas")
					.evaluate((element) => element === document.activeElement),
				true,
			],
		]) {
			assertEqual(result.failures, actual, expected, `Bay Flow Edit ${label}`);
		}

		await resetBayFlowEditScaleCycleInstrumentation(page);
		await collectBayFlowEditScaleGarbageOutsideProductWindow(cdp, page);
		const heapBefore = await cdp.send("Runtime.getHeapUsage");
		result.heapBefore = heapBefore;
		result.memoryCycle = await exerciseBayFlowEditRetainedHeapCycle(
			page,
			budget,
			source,
			after,
			result.failures,
		);
		await resetBayFlowEditScaleCycleInstrumentation(page);
		Object.assign(
			result,
			await measureBayCommandRetainedHeap(
				cdp,
				page,
				"__openFabBayFlowEditScale",
				heapBefore,
				budget,
				result.failures,
				"Bay Flow Edit same-terminal cycle",
				true,
			),
		);

		const postGcDiagnostics = await readBayFlowEditScaleDiagnostics(page, {
			commandStartedAt: commandProbe.startedAt,
			commandEndedAt: commandWindowEndedAt,
			applyStartedAt: applyProbe.startedAt,
			applyEndedAt: applyWindowEndedAt,
		});
		result.commandLongTasks = postGcDiagnostics.commandLongTasks;
		result.applyLongTasks = postGcDiagnostics.applyLongTasks;
		for (const [label, actual] of [
			["final certification main-thread Long Tasks", postGcDiagnostics.commandLongTasks.length],
			["final apply main-thread Long Tasks", postGcDiagnostics.applyLongTasks.length],
			["window errors", postGcDiagnostics.errors.length],
			["unhandled rejections", postGcDiagnostics.rejections.length],
			["console errors", consoleErrors.length],
			["page errors", pageErrors.length],
		]) {
			assertEqual(result.failures, actual, 0, `Bay Flow Edit ${label}`);
		}
		await page.screenshot({ path: path.join(directory, "applied.png"), fullPage: true });
	} catch (error) {
		result.failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
		await page
			.screenshot({ path: path.join(directory, "failure.png"), fullPage: true })
			.catch(() => undefined);
	} finally {
		await writeFile(path.join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
		await closeBrowserResource(context, "Bay Flow Edit scale context");
	}
	return result;
}

async function exerciseNewFabProfileScaleGate(activePage, budget, failures) {
	await installNewFabCurrentMapOperationProbe(activePage);
	const baseline = await readNewFabScaleIdentity(activePage);
	assertEqual(
		failures,
		baseline.newFabPreparedWorkerStarts,
		0,
		"NEW FAB baseline prepared Worker starts",
	);
	assertEqual(
		failures,
		baseline.newFabPreparedWorkerTerminations,
		0,
		"NEW FAB baseline prepared Worker terminations",
	);
	assertEqual(failures, baseline.longTaskSupported, true, "NEW FAB Long Task observer support");
	assertEqual(
		failures,
		baseline.longTaskTakeRecordsSupported,
		true,
		"NEW FAB Long Task takeRecords support",
	);
	assertEqual(
		failures,
		baseline.authoredChecksum,
		baseline.workerChecksum,
		"NEW FAB baseline authored/Worker checksum parity",
	);
	assertEqual(
		failures,
		baseline.workerSimulationReady,
		"false",
		"NEW FAB baseline simulation readiness gate",
	);
	assertNewFabCurrentMapOperationsEmpty(
		failures,
		baseline.currentMapOperations,
		"NEW FAB baseline",
	);

	const interactions = {};
	interactions.firstPaint = await measureNewFabClickToPaint(
		activePage,
		'[data-testid="fab-preset-browser"]',
		"layout",
	);
	assertNewFabInteraction(
		failures,
		interactions.firstPaint,
		budget.newFabFirstPaintMilliseconds,
		"NEW FAB first visible paint",
	);

	interactions.layoutUpdate = await measureNewFabClickToPaint(
		activePage,
		'input[name="new-fab-bank-direction"][value="NORTH_SOUTH"]',
		"layout",
	);
	assertNewFabInteraction(
		failures,
		interactions.layoutUpdate,
		budget.newFabInteractionMilliseconds,
		"NEW FAB Step 1 profile update",
	);
	assertEqual(
		failures,
		await activePage
			.locator('input[name="new-fab-bank-direction"][value="NORTH_SOUTH"]')
			.isChecked(),
		true,
		"NEW FAB Step 1 selected repetition axis",
	);

	interactions.productionNavigation = await measureNewFabClickToPaint(
		activePage,
		'[data-testid="new-fab-profile-next"]',
		"production",
	);
	assertNewFabInteraction(
		failures,
		interactions.productionNavigation,
		budget.newFabInteractionMilliseconds,
		"NEW FAB Step 2 navigation",
	);
	interactions.productionUpdate = await measureNewFabClickToPaint(
		activePage,
		'input[name="new-fab-process-loops-per-bank"][value="12"]',
		"production",
	);
	assertNewFabInteraction(
		failures,
		interactions.productionUpdate,
		budget.newFabInteractionMilliseconds,
		"NEW FAB Step 2 profile update",
	);
	assertEqual(
		failures,
		await activePage
			.locator('input[name="new-fab-process-loops-per-bank"][value="12"]')
			.isChecked(),
		true,
		"NEW FAB Step 2 selected Process Loop target",
	);
	interactions.productionRestore = await measureNewFabClickToPaint(
		activePage,
		'input[name="new-fab-process-loops-per-bank"][value="18"]',
		"production",
	);
	assertNewFabInteraction(
		failures,
		interactions.productionRestore,
		budget.newFabInteractionMilliseconds,
		"NEW FAB Step 2 default profile restoration",
	);
	assertEqual(
		failures,
		await activePage
			.locator('input[name="new-fab-process-loops-per-bank"][value="18"]')
			.isChecked(),
		true,
		"NEW FAB Step 2 restored default Process Loop target before PREPARE",
	);

	interactions.circulationNavigation = await measureNewFabClickToPaint(
		activePage,
		'[data-testid="new-fab-profile-next"]',
		"circulation",
	);
	assertNewFabInteraction(
		failures,
		interactions.circulationNavigation,
		budget.newFabInteractionMilliseconds,
		"NEW FAB Step 3 navigation",
	);
	interactions.reviewNavigation = await measureNewFabClickToPaint(
		activePage,
		'[data-testid="new-fab-profile-next"]',
		"review",
	);
	assertNewFabInteraction(
		failures,
		interactions.reviewNavigation,
		budget.newFabInteractionMilliseconds,
		"NEW FAB Review navigation",
	);

	const beforePrepare = await readNewFabScaleIdentity(activePage);
	assertNewFabCurrentProjectUnchanged(failures, baseline, beforePrepare, "NEW FAB before PREPARE");
	assertEqual(
		failures,
		beforePrepare.newFabPreparedWorkerStarts,
		baseline.newFabPreparedWorkerStarts,
		"NEW FAB starts no prepared Worker before PREPARE",
	);
	assertEqual(
		failures,
		beforePrepare.newFabPreparedWorkerRequests.length,
		0,
		"NEW FAB sends no prepared Worker request before PREPARE",
	);
	assertNewFabCurrentMapOperationsEmpty(
		failures,
		beforePrepare.currentMapOperations,
		"NEW FAB before PREPARE",
	);

	const prepareProbe = await activePage
		.locator('[data-testid="new-fab-profile-prepare"]')
		.evaluate((button) => {
			const scale = globalThis.__openFabConnectorScale;
			if (!(button instanceof HTMLButtonElement) || !scale?.observer) {
				throw new Error("The NEW FAB PREPARE control or scale observer is missing.");
			}
			for (const entry of scale.observer.takeRecords()) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			const probe = {
				startedAt: performance.now(),
				workerStarts: scale.newFabPreparedWorkerStarts,
				workerTerminations: scale.newFabPreparedWorkerTerminations,
				workerRequests: scale.newFabPreparedWorkerRequests.length,
			};
			button.click();
			return probe;
		});
	await activePage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="new-fab-profile-wizard"]')
				?.getAttribute("data-preparation") === "prepared",
		undefined,
		{ timeout: budget.newFabPreparationTimeoutMilliseconds },
	);
	const create = activePage.locator('[data-testid="new-fab-profile-create"]');
	await create.waitFor({ state: "visible", timeout: 5_000 });
	await activePage.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	const prepared = await readNewFabScaleIdentity(activePage, prepareProbe.startedAt);
	const preparedWorkerStartDelta = prepared.newFabPreparedWorkerStarts - prepareProbe.workerStarts;
	const preparedWorkerTerminationDelta =
		prepared.newFabPreparedWorkerTerminations - prepareProbe.workerTerminations;
	const preparedWorkerRequests = prepared.newFabPreparedWorkerRequests.slice(
		prepareProbe.workerRequests,
	);
	const preparedWorkerRequestTypes = preparedWorkerRequests.map((request) => request.type);
	const preparedWizardState = await activePage
		.locator('[data-testid="new-fab-profile-wizard"]')
		.evaluate((wizard) => ({
			state: wizard.getAttribute("data-preparation") ?? "",
			statusText:
				wizard.querySelector(".tilefab-new-fab-review-status strong")?.textContent?.trim() ?? "",
		}));
	const preparedCreateVisible = await create.isVisible();
	const preparedCreateEnabled = await create.isEnabled();
	const exactEvidenceText = (
		await activePage.locator('[data-testid="new-fab-profile-exact-evidence"]').innerText()
	)
		.replace(/,/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase();
	assertEqual(
		failures,
		preparedWorkerStartDelta,
		budget.newFabPreparedWorkerStarts,
		"NEW FAB exact prepared Worker starts",
	);
	assertEqual(
		failures,
		preparedWorkerTerminationDelta,
		budget.newFabPreparedWorkerStarts,
		"NEW FAB disposable prepared Worker terminations",
	);
	assertEqual(
		failures,
		JSON.stringify(preparedWorkerRequestTypes),
		JSON.stringify([
			"VERIFY_OPENFAB_FAB_PROJECT_MATERIALIZATION",
			"PREPARE_OPENFAB_FAB_PROJECT_SOURCE",
		]),
		"NEW FAB prepared Worker request operations",
	);
	assertEqual(
		failures,
		new Set(preparedWorkerRequests.map((request) => request.requestId)).size,
		1,
		"NEW FAB prepared Worker shared request identity",
	);
	assertEqual(
		failures,
		new Set(preparedWorkerRequests.map((request) => request.requestFingerprint)).size,
		1,
		"NEW FAB prepared Worker shared request fingerprint",
	);
	assertEqual(
		failures,
		preparedWorkerRequests.every((request) => request.requestFingerprint.length > 0),
		true,
		"NEW FAB prepared Worker non-empty request fingerprint",
	);
	assertEqual(failures, preparedWizardState.state, "prepared", "NEW FAB prepared wizard state");
	assertEqual(
		failures,
		preparedWizardState.statusText,
		"PREPARED RESULT RECEIVED",
		"NEW FAB prepared wizard status",
	);
	assertEqual(failures, preparedCreateVisible, true, "NEW FAB prepared CREATE visibility");
	assertEqual(failures, preparedCreateEnabled, true, "NEW FAB prepared CREATE availability");
	for (const expected of [
		"OPENFAB VERIFIED · STATIC AUTHORING",
		"RAIL CELLS 11282",
		"DIRECTED EDGES 11432",
		"PHYSICAL PATHS 11478",
		"GATEWAY REACHABILITY · VERIFIED",
	]) {
		assertEqual(
			failures,
			exactEvidenceText.includes(expected),
			true,
			`NEW FAB prepared exact evidence ${expected}`,
		);
	}
	assertNewFabCurrentProjectUnchanged(failures, beforePrepare, prepared, "NEW FAB after PREPARE");
	assertNewFabCurrentMapOperationsEmpty(
		failures,
		prepared.currentMapOperations,
		"NEW FAB after PREPARE",
	);

	await activePage.locator('[data-testid="new-fab-profile-close"]').click();
	await activePage.locator('[data-testid="new-fab-profile-wizard"]').waitFor({ state: "hidden" });

	const interactionPaintMilliseconds = Object.fromEntries(
		Object.entries(interactions)
			.filter(([key]) => key !== "firstPaint")
			.map(([key, metrics]) => [key, metrics.milliseconds]),
	);
	const interactionLongTasks = Object.fromEntries(
		Object.entries(interactions).map(([key, metrics]) => [key, metrics.longTasks]),
	);
	return {
		firstPaintMilliseconds: interactions.firstPaint.milliseconds,
		interactionPaintMilliseconds,
		interactionLongTasks,
		longTaskSupported: prepared.longTaskSupported,
		longTaskTakeRecordsSupported: prepared.longTaskTakeRecordsSupported,
		preparationMilliseconds: prepared.measuredAt - prepareProbe.startedAt,
		preparationLongTasks: prepared.windowLongTasks,
		preparedWorkerStartDelta,
		preparedWorkerTerminationDelta,
		preparedWorkerRequestTypes,
		currentMapOperationsBeforePrepare: beforePrepare.currentMapOperations,
		currentMapOperationsAfterPrepare: prepared.currentMapOperations,
		preparedState: preparedWizardState.state,
		preparedStatusText: preparedWizardState.statusText,
		preparedCreateVisible,
		preparedCreateEnabled,
	};
}

async function installNewFabCurrentMapOperationProbe(activePage) {
	await activePage.evaluate(() => {
		const scale = globalThis.__openFabConnectorScale;
		const map = globalThis.__tileFab?.getDocument?.()?.map;
		if (!scale || !map) throw new Error("The NEW FAB current-map probe cannot access its source.");
		const operationNames = ["clone", "forEachRail", "forEachAdvancedSwitch", "bounds"];
		const operations = Object.fromEntries(operationNames.map((name) => [name, 0]));
		for (const name of operationNames) {
			const original = map[name];
			if (typeof original !== "function") {
				throw new Error(`The current TileMap operation ${name} is unavailable.`);
			}
			Object.defineProperty(map, name, {
				configurable: true,
				writable: true,
				value(...argumentsList) {
					operations[name]++;
					return Reflect.apply(original, this, argumentsList);
				},
			});
		}
		scale.newFabCurrentMapOperations = operations;
	});
}

async function measureNewFabClickToPaint(activePage, selector, expectedStep) {
	const control = activePage.locator(selector);
	await control.waitFor({ state: "attached", timeout: 5_000 });
	const probe = await control.evaluate((element) => {
		const scale = globalThis.__openFabConnectorScale;
		if (!(element instanceof HTMLElement) || !scale?.observer) {
			throw new Error("The NEW FAB interaction control or Long Task observer is missing.");
		}
		for (const entry of scale.observer.takeRecords()) {
			scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
		}
		const startedAt = performance.now();
		element.click();
		return { startedAt };
	});
	await activePage.waitForFunction(
		(step) =>
			document
				.querySelector('[data-testid="new-fab-profile-wizard"]')
				?.getAttribute("data-step") === step,
		expectedStep,
		{ timeout: 5_000 },
	);
	await activePage.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	return activePage.evaluate(({ startedAt }) => {
		const scale = globalThis.__openFabConnectorScale;
		for (const entry of scale?.observer?.takeRecords?.() ?? []) {
			scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
		}
		const finishedAt = performance.now();
		return {
			milliseconds: finishedAt - startedAt,
			longTaskSupported: scale?.longTaskSupported ?? false,
			longTaskTakeRecordsSupported: scale?.longTaskTakeRecordsSupported ?? false,
			longTasks: (scale?.longTasks ?? []).filter(
				(entry) => entry.startTime < finishedAt && entry.startTime + entry.duration >= startedAt,
			),
		};
	}, probe);
}

async function readNewFabScaleIdentity(activePage, windowStartedAt = null) {
	return activePage.evaluate((startedAt) => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const scale = globalThis.__openFabConnectorScale;
		const api = globalThis.__tileFab;
		const documentModel = api?.getDocument?.();
		if (!(app instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement) || !documentModel) {
			throw new Error("The NEW FAB scale identity cannot access the active project.");
		}
		for (const entry of scale?.observer?.takeRecords?.() ?? []) {
			scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
		}
		const measuredAt = performance.now();
		const organizationOutlineRequest = scale?.organizationOutlineRequests?.at(-1) ?? null;
		return {
			measuredAt,
			modelGeneration: Number(canvas.dataset.modelGeneration),
			authoredChecksum: api?.getEditorModel?.().authoredChecksum ?? "",
			documentRevision: documentModel.map.getRevision(),
			documentPatchSequence: documentModel.getPatchSequence(),
			documentCellCount: documentModel.map.size,
			documentEdgeCount: documentModel.map.edgeCount,
			documentSwitchCount: documentModel.map.advancedSwitchCount,
			nextAdvancedSwitchId: documentModel.map.getAdvancedSwitchIdCursor(),
			nextPortId: documentModel.portEquipment.nextPortId,
			nextEquipmentGroupId: documentModel.portEquipment.nextEquipmentGroupId,
			nextOrganizationId: documentModel.organizations.nextOrganizationId,
			documentPortCount: documentModel.portEquipment.ports.length,
			documentEquipmentGroupCount: documentModel.portEquipment.equipmentGroups.length,
			documentOrganizationCount: documentModel.organizations.records.length,
			documentCanUndo: documentModel.canUndo,
			documentCanRedo: documentModel.canRedo,
			historyCanUndo: app.dataset.historyCanUndo ?? "",
			historyCanRedo: app.dataset.historyCanRedo ?? "",
			projectDirty: app.dataset.projectDirty ?? "",
			projectId: canvas.dataset.projectId ?? "",
			projectName: canvas.dataset.projectName ?? "",
			appProjectName: app.dataset.projectName ?? "",
			railMirrorWorkerStarts: scale?.railMirrorWorkerStarts ?? -1,
			railMirrorCursorRequestCount: scale?.organizationOutlineRequests?.length ?? -1,
			railMirrorNextAdvancedSwitchId:
				organizationOutlineRequest?.expectedNextAdvancedSwitchId ?? null,
			railMirrorNextPortId: organizationOutlineRequest?.expectedNextPortId ?? null,
			railMirrorNextEquipmentGroupId:
				organizationOutlineRequest?.expectedNextEquipmentGroupId ?? null,
			railMirrorNextOrganizationId: organizationOutlineRequest?.expectedNextOrganizationId ?? null,
			workerStatus: canvas.dataset.workerStatus ?? "",
			workerEpoch: Number(canvas.dataset.workerEpoch),
			workerSequence: Number(canvas.dataset.workerSequence),
			workerRevision: Number(canvas.dataset.workerRevision),
			workerChecksum: canvas.dataset.workerChecksum ?? "",
			workerCells: Number(canvas.dataset.workerCells),
			workerEdges: Number(canvas.dataset.workerEdges),
			workerSwitches: Number(canvas.dataset.workerSwitches),
			workerPorts: Number(canvas.dataset.workerPorts),
			workerEquipmentGroups: Number(canvas.dataset.workerEquipmentGroups),
			workerOrganizations: Number(canvas.dataset.workerOrganizations),
			workerTargetSequence: Number(canvas.dataset.workerTargetSequence),
			workerTargetRevision: Number(canvas.dataset.workerTargetRevision),
			workerTargetChecksum: canvas.dataset.workerTargetChecksum ?? "",
			workerPhysicalSequence: Number(canvas.dataset.workerPhysicalSequence),
			workerPhysicalRevision: Number(canvas.dataset.workerPhysicalRevision),
			workerPhysicalFingerprint: canvas.dataset.workerPhysicalFingerprint ?? "",
			workerPhysicalPaths: Number(canvas.dataset.workerPhysicalPaths),
			workerSimulationReady: canvas.dataset.workerSimulationReady ?? "",
			staticRedraws: Number(canvas.dataset.staticRedraws),
			physicalBindings: Number(canvas.dataset.physicalBindings),
			physicalPresentationBuilds: Number(canvas.dataset.physicalPresentationBuilds),
			physicalPreparedArtifactBindings: Number(canvas.dataset.physicalPreparedArtifactBindings),
			portSlotPreparedArtifactBindings: Number(canvas.dataset.portSlotPreparedArtifactBindings),
			draftCommittedPreparedBindings: Number(canvas.dataset.draftCommittedPreparedBindings),
			exactMaterializations: Number(canvas.dataset.organizationExactMaterializations),
			newFabPreparedWorkerStarts: scale?.newFabPreparedWorkerStarts ?? -1,
			newFabPreparedWorkerTerminations: scale?.newFabPreparedWorkerTerminations ?? -1,
			newFabPreparedWorkerRequests: [...(scale?.newFabPreparedWorkerRequests ?? [])],
			currentMapOperations: { ...(scale?.newFabCurrentMapOperations ?? {}) },
			longTaskSupported: scale?.longTaskSupported ?? false,
			longTaskTakeRecordsSupported: scale?.longTaskTakeRecordsSupported ?? false,
			windowLongTasks:
				typeof startedAt === "number"
					? (scale?.longTasks ?? []).filter(
							(entry) =>
								entry.startTime < measuredAt && entry.startTime + entry.duration >= startedAt,
						)
					: [],
		};
	}, windowStartedAt);
}

function assertNewFabInteraction(failures, metrics, budget, label) {
	assertAtMost(failures, metrics.milliseconds, budget, label);
	assertEqual(failures, metrics.longTaskSupported, true, `${label} Long Task observer support`);
	assertEqual(
		failures,
		metrics.longTaskTakeRecordsSupported,
		true,
		`${label} Long Task takeRecords support`,
	);
	assertEqual(failures, metrics.longTasks.length, 0, `${label} main-thread Long Tasks`);
}

function assertNewFabCurrentProjectUnchanged(failures, before, after, label) {
	for (const [field, actual, expected] of [
		["model generation", after.modelGeneration, before.modelGeneration],
		["authored checksum", after.authoredChecksum, before.authoredChecksum],
		["authored revision", after.documentRevision, before.documentRevision],
		["authored patch sequence", after.documentPatchSequence, before.documentPatchSequence],
		["authored cell count", after.documentCellCount, before.documentCellCount],
		["authored edge count", after.documentEdgeCount, before.documentEdgeCount],
		["authored switch count", after.documentSwitchCount, before.documentSwitchCount],
		["advanced-switch cursor", after.nextAdvancedSwitchId, before.nextAdvancedSwitchId],
		["port cursor", after.nextPortId, before.nextPortId],
		["equipment-group cursor", after.nextEquipmentGroupId, before.nextEquipmentGroupId],
		["organization cursor", after.nextOrganizationId, before.nextOrganizationId],
		["port count", after.documentPortCount, before.documentPortCount],
		[
			"equipment-group count",
			after.documentEquipmentGroupCount,
			before.documentEquipmentGroupCount,
		],
		["organization count", after.documentOrganizationCount, before.documentOrganizationCount],
		["document undo state", after.documentCanUndo, before.documentCanUndo],
		["document redo state", after.documentCanRedo, before.documentCanRedo],
		["UI undo state", after.historyCanUndo, before.historyCanUndo],
		["UI redo state", after.historyCanRedo, before.historyCanRedo],
		["project dirty state", after.projectDirty, before.projectDirty],
		["project id", after.projectId, before.projectId],
		["project name", after.projectName, before.projectName],
		["app project name", after.appProjectName, before.appProjectName],
		["Rail mirror Worker starts", after.railMirrorWorkerStarts, before.railMirrorWorkerStarts],
		[
			"Rail mirror cursor request count",
			after.railMirrorCursorRequestCount,
			before.railMirrorCursorRequestCount,
		],
		[
			"Rail mirror advanced-switch cursor",
			after.railMirrorNextAdvancedSwitchId,
			before.railMirrorNextAdvancedSwitchId,
		],
		["Rail mirror port cursor", after.railMirrorNextPortId, before.railMirrorNextPortId],
		[
			"Rail mirror equipment-group cursor",
			after.railMirrorNextEquipmentGroupId,
			before.railMirrorNextEquipmentGroupId,
		],
		[
			"Rail mirror organization cursor",
			after.railMirrorNextOrganizationId,
			before.railMirrorNextOrganizationId,
		],
		["Worker status", after.workerStatus, before.workerStatus],
		["Worker epoch", after.workerEpoch, before.workerEpoch],
		["Worker sequence", after.workerSequence, before.workerSequence],
		["Worker revision", after.workerRevision, before.workerRevision],
		["Worker checksum", after.workerChecksum, before.workerChecksum],
		["Worker cells", after.workerCells, before.workerCells],
		["Worker edges", after.workerEdges, before.workerEdges],
		["Worker switches", after.workerSwitches, before.workerSwitches],
		["Worker ports", after.workerPorts, before.workerPorts],
		["Worker equipment groups", after.workerEquipmentGroups, before.workerEquipmentGroups],
		["Worker organizations", after.workerOrganizations, before.workerOrganizations],
		["Worker target sequence", after.workerTargetSequence, before.workerTargetSequence],
		["Worker target revision", after.workerTargetRevision, before.workerTargetRevision],
		["Worker target checksum", after.workerTargetChecksum, before.workerTargetChecksum],
		["Worker physical sequence", after.workerPhysicalSequence, before.workerPhysicalSequence],
		["Worker physical revision", after.workerPhysicalRevision, before.workerPhysicalRevision],
		[
			"Worker physical fingerprint",
			after.workerPhysicalFingerprint,
			before.workerPhysicalFingerprint,
		],
		["Worker physical paths", after.workerPhysicalPaths, before.workerPhysicalPaths],
		["Worker simulation readiness", after.workerSimulationReady, before.workerSimulationReady],
		["Canvas static redraws", after.staticRedraws, before.staticRedraws],
		["physical artifact bindings", after.physicalBindings, before.physicalBindings],
		[
			"physical presentation builds",
			after.physicalPresentationBuilds,
			before.physicalPresentationBuilds,
		],
		[
			"prepared physical artifact bindings",
			after.physicalPreparedArtifactBindings,
			before.physicalPreparedArtifactBindings,
		],
		[
			"prepared port-slot artifact bindings",
			after.portSlotPreparedArtifactBindings,
			before.portSlotPreparedArtifactBindings,
		],
		[
			"prepared draft artifact bindings",
			after.draftCommittedPreparedBindings,
			before.draftCommittedPreparedBindings,
		],
		[
			"organization exact materializations",
			after.exactMaterializations,
			before.exactMaterializations,
		],
	]) {
		assertEqual(failures, actual, expected, `${label} ${field}`);
	}
}

function assertNewFabCurrentMapOperationsEmpty(failures, operations, label) {
	for (const [operation, count] of Object.entries(operations)) {
		assertEqual(failures, count, 0, `${label} current-map ${operation} calls`);
	}
}

async function prepareAssemblyOrganizationCanvasViewport(activePage) {
	const points = await activePage.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const api = globalThis.__tileFab;
		const rect = canvas?.getBoundingClientRect();
		if (!(canvas instanceof HTMLCanvasElement) || !rect || !api?.renderer || !api.camera) {
			throw new Error("The organization scale viewport cannot access the Rail Canvas camera.");
		}
		const camera = api.camera;
		camera.rotation = 0;
		camera.zoom = 8;
		const projectedCenter = api.renderer.worldToScreen(
			{ x: 48, y: 28 },
			{ ...camera, offsetX: 0, offsetY: 0 },
		);
		camera.offsetX = canvas.clientWidth / 2 - projectedCenter.x;
		camera.offsetY = canvas.clientHeight / 2 - projectedCenter.y;
		api.renderer.invalidateStatic();
		api.scheduleRender();
		// The public-safe fixture owns Bay 1 at [0,36]×[0,56] and Bay 3 at
		// [60,96]×[0,56]. Their effective-bounds centers avoid authored rail cells on purpose:
		// this gate exercises the Worker-derived semantic AABB rather than physical-path hit testing.
		const pointAt = (x, y) => {
			const point = api.renderer.worldToScreen({ x, y }, camera);
			return { x: rect.left + point.x, y: rect.top + point.y };
		};
		return {
			firstBay: pointAt(18, 28),
			secondBay: pointAt(78, 28),
			canvasBounds: {
				left: rect.left,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom,
			},
		};
	});
	await activePage.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	await activePage.waitForFunction(
		() => document.querySelector('[data-testid="rail-canvas"]')?.dataset.cameraZoom === "8.000",
		undefined,
		{ timeout: 2_000 },
	);
	for (const [label, point] of [
		["first Bay", points.firstBay],
		["second Bay", points.secondBay],
	]) {
		if (
			point.x <= points.canvasBounds.left ||
			point.x >= points.canvasBounds.right ||
			point.y <= points.canvasBounds.top ||
			point.y >= points.canvasBounds.bottom
		) {
			throw new Error(`The ${label} effective-bounds center is outside the Rail Canvas.`);
		}
	}
	return points;
}

async function exerciseAssemblyOrganizationCanvasSelection(activePage, points) {
	const canvas = activePage.getByTestId("rail-canvas");
	await canvas.focus();
	const before = await readAssemblyOrganizationCanvasMetrics(activePage);

	let startedAt = performance.now();
	await activePage.mouse.move(points.firstBay.x, points.firstBay.y);
	await activePage.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	const hoverPaintMilliseconds = performance.now() - startedAt;
	await activePage.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.organizationOutlineHoverId ===
			"1",
		undefined,
		{ timeout: 2_000 },
	);

	const clickPaintMilliseconds = [];
	startedAt = performance.now();
	await activePage.mouse.click(points.firstBay.x, points.firstBay.y);
	await activePage.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				app?.dataset.organizationSelectionCount === "1" &&
				app.dataset.organizationSelectionIds === "1"
			);
		},
		undefined,
		{ timeout: 2_000 },
	);
	await activePage.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	clickPaintMilliseconds.push(performance.now() - startedAt);

	startedAt = performance.now();
	await activePage.keyboard.down("Meta");
	try {
		await activePage.mouse.click(points.secondBay.x, points.secondBay.y);
	} finally {
		await activePage.keyboard.up("Meta");
	}
	await activePage.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				app?.dataset.organizationSelectionCount === "2" &&
				app.dataset.organizationSelectionIds === "1,3"
			);
		},
		undefined,
		{ timeout: 2_000 },
	);
	await activePage.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	clickPaintMilliseconds.push(performance.now() - startedAt);
	await activePage.waitForFunction(
		() => {
			const dataset = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
			return (
				dataset?.organizationOutlineHoverId === "3" &&
				Number(dataset.organizationOutlineHitCandidates) >= 1
			);
		},
		undefined,
		{ timeout: 2_000 },
	);
	const after = await readAssemblyOrganizationCanvasMetrics(activePage);
	return {
		before,
		after,
		hoverPaintMilliseconds,
		clickPaintMilliseconds,
		longTaskSupported: after.longTaskSupported,
		longTasks: after.longTasks.filter(
			(entry) => entry.startTime + entry.duration >= before.measuredAt,
		),
	};
}

async function readAssemblyOrganizationCanvasMetrics(activePage) {
	return activePage.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const scale = globalThis.__openFabConnectorScale;
		const api = globalThis.__tileFab;
		for (const entry of scale?.observer?.takeRecords?.() ?? []) {
			scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
		}
		const documentModel = api?.getDocument?.();
		return {
			measuredAt: performance.now(),
			modelGeneration: Number(canvas?.dataset.modelGeneration),
			authoredChecksum: api?.getEditorModel?.().authoredChecksum ?? "",
			workerEpoch: Number(canvas?.dataset.workerEpoch),
			workerSequence: Number(canvas?.dataset.workerSequence),
			workerRevision: Number(canvas?.dataset.workerRevision),
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerCells: Number(canvas?.dataset.workerCells),
			workerPhysicalSequence: Number(canvas?.dataset.workerPhysicalSequence),
			workerPhysicalRevision: Number(canvas?.dataset.workerPhysicalRevision),
			workerPhysicalFingerprint: canvas?.dataset.workerPhysicalFingerprint ?? "",
			workerPhysicalPaths: Number(canvas?.dataset.workerPhysicalPaths),
			staticRedraws: Number(canvas?.dataset.staticRedraws),
			physicalBindings: Number(canvas?.dataset.physicalBindings),
			physicalPresentationBuilds: Number(canvas?.dataset.physicalPresentationBuilds),
			physicalPreparedArtifactBindings: Number(canvas?.dataset.physicalPreparedArtifactBindings),
			portSlotPreparedArtifactBindings: Number(canvas?.dataset.portSlotPreparedArtifactBindings),
			draftCommittedPreparedBindings: Number(canvas?.dataset.draftCommittedPreparedBindings),
			railMirrorWorkerStarts: scale?.railMirrorWorkerStarts ?? -1,
			documentRevision: Number(documentModel?.map?.getRevision?.()),
			documentPatchSequence: Number(documentModel?.getPatchSequence?.()),
			documentCanUndo: documentModel?.canUndo ?? null,
			documentCanRedo: documentModel?.canRedo ?? null,
			historyCanUndo: app?.dataset.historyCanUndo ?? "",
			historyCanRedo: app?.dataset.historyCanRedo ?? "",
			projectDirty: app?.dataset.projectDirty ?? "",
			selectionCount: Number(app?.dataset.organizationSelectionCount),
			selectionIds: app?.dataset.organizationSelectionIds ?? "",
			exactMaterializations: Number(canvas?.dataset.organizationExactMaterializations),
			outlineStatus: app?.dataset.organizationOutlineStatus ?? "",
			outlineCount: Number(app?.dataset.organizationOutlineCount),
			outlineBytes: Number(app?.dataset.organizationOutlineBytes),
			outlineRequestCount: Number(app?.dataset.organizationOutlineRequestCount),
			outlineWorkerRequests: scale?.organizationOutlineRequests?.length ?? -1,
			outlineHitCandidates: Number(canvas?.dataset.organizationOutlineHitCandidates),
			hoverId: canvas?.dataset.organizationOutlineHoverId ?? "",
			longTaskSupported: scale?.longTaskSupported ?? false,
			longTasks: [...(scale?.longTasks ?? [])],
		};
	});
}

function assertAssemblyOrganizationSourceUnchanged(failures, before, after, label) {
	for (const [field, actual, expected] of [
		["model generation", after.modelGeneration, before.modelGeneration],
		["authored checksum", after.authoredChecksum, before.authoredChecksum],
		["Rail mirror Worker starts", after.railMirrorWorkerStarts, before.railMirrorWorkerStarts],
		["Worker epoch", after.workerEpoch, before.workerEpoch],
		["Worker sequence", after.workerSequence, before.workerSequence],
		["Worker revision", after.workerRevision, before.workerRevision],
		["Worker checksum", after.workerChecksum, before.workerChecksum],
		["Worker cells", after.workerCells, before.workerCells],
		["Worker physical sequence", after.workerPhysicalSequence, before.workerPhysicalSequence],
		["Worker physical revision", after.workerPhysicalRevision, before.workerPhysicalRevision],
		[
			"Worker physical fingerprint",
			after.workerPhysicalFingerprint,
			before.workerPhysicalFingerprint,
		],
		["Worker physical paths", after.workerPhysicalPaths, before.workerPhysicalPaths],
		["Canvas static redraws", after.staticRedraws, before.staticRedraws],
		["physical artifact bindings", after.physicalBindings, before.physicalBindings],
		[
			"physical presentation builds",
			after.physicalPresentationBuilds,
			before.physicalPresentationBuilds,
		],
		[
			"prepared physical artifact bindings",
			after.physicalPreparedArtifactBindings,
			before.physicalPreparedArtifactBindings,
		],
		[
			"prepared port-slot artifact bindings",
			after.portSlotPreparedArtifactBindings,
			before.portSlotPreparedArtifactBindings,
		],
		[
			"prepared draft artifact bindings",
			after.draftCommittedPreparedBindings,
			before.draftCommittedPreparedBindings,
		],
	]) {
		assertEqual(failures, actual, expected, `${label} ${field}`);
	}
}

function assertAssemblyOrganizationAuthoredUnchanged(failures, before, after, label) {
	for (const [field, actual, expected] of [
		["authored revision", after.documentRevision, before.documentRevision],
		["authored patch sequence", after.documentPatchSequence, before.documentPatchSequence],
		["document undo state", after.documentCanUndo, before.documentCanUndo],
		["document redo state", after.documentCanRedo, before.documentCanRedo],
		["UI undo state", after.historyCanUndo, before.historyCanUndo],
		["UI redo state", after.historyCanRedo, before.historyCanRedo],
		["project dirty state", after.projectDirty, before.projectDirty],
	]) {
		assertEqual(failures, actual, expected, `${label} ${field}`);
	}
}

async function selectAssemblyConnectorScaleBays(activePage) {
	await activePage.locator('button[aria-label^="FAB 조직 ("]').click();
	await activePage.locator('[data-testid="static-fab-organization-library"]').waitFor({
		state: "visible",
	});
	const reload = activePage.getByRole("button", { name: "RELOAD", exact: true });
	if (await reload.isVisible().catch(() => false)) {
		await reload.click();
		await reload.waitFor({ state: "hidden" });
	}
	await activePage.locator('[data-organization-id="1"]').click();
	await activePage.locator('[data-organization-id="3"]').click({ modifiers: ["Meta"] });
	const connect = activePage.locator('[data-testid="connect-static-fab-assemblies"]');
	await connect.waitFor({ state: "visible" });
	if (await connect.isDisabled()) {
		throw new Error("The 100k+ fixture did not expose two eligible Production Bays.");
	}
	return connect;
}

async function exerciseLargeMapConnectorManualRecommendationPolicy(activePage, budget, failures) {
	const panel = activePage.getByTestId("static-fab-assembly-connector-panel");
	const baseline = await activePage.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const documentModel = globalThis.__tileFab?.getDocument?.();
		return {
			modelGeneration: Number(canvas?.dataset.modelGeneration),
			workerSequence: Number(canvas?.dataset.workerSequence),
			workerRevision: Number(canvas?.dataset.workerRevision),
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerCells: Number(canvas?.dataset.workerCells),
			documentRevision: Number(documentModel?.map?.getRevision?.()),
			documentPatchSequence: Number(documentModel?.getPatchSequence?.()),
		};
	});
	await activePage.getByTestId("connect-static-fab-assemblies").click();
	await panel.waitFor({ state: "visible" });
	await activePage.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				app?.dataset.assemblyConnectorSnapshotStatus === "hydrated" &&
				app.dataset.assemblyConnectorRecommendationStatus === "manual"
			);
		},
		undefined,
		{ timeout: budget.snapshotReadyMilliseconds },
	);
	const metrics = await activePage.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const connector = document.querySelector('[data-testid="static-fab-assembly-connector-panel"]');
		const documentModel = globalThis.__tileFab?.getDocument?.();
		return {
			status: app?.dataset.assemblyConnectorRecommendationStatus ?? "",
			attempts: Number(app?.dataset.assemblyConnectorRecommendationAttempts),
			snapshotStatus: app?.dataset.assemblyConnectorSnapshotStatus ?? "",
			sourceCells: Number(app?.dataset.assemblyConnectorSnapshotSourceCells),
			phase: connector?.getAttribute("data-phase") ?? "",
			selectionCount: Number(app?.dataset.organizationSelectionCount),
			modelGeneration: Number(canvas?.dataset.modelGeneration),
			workerSequence: Number(canvas?.dataset.workerSequence),
			workerRevision: Number(canvas?.dataset.workerRevision),
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerCells: Number(canvas?.dataset.workerCells),
			documentRevision: Number(documentModel?.map?.getRevision?.()),
			documentPatchSequence: Number(documentModel?.getPatchSequence?.()),
		};
	});
	for (const [label, actual, expected] of [
		["recommendation status", metrics.status, "manual"],
		["recommendation attempts", metrics.attempts, 0],
		["snapshot status", metrics.snapshotStatus, "hydrated"],
		["snapshot source cells", metrics.sourceCells, budget.cellCount],
		["Connector phase", metrics.phase, "pick-source-gateway"],
		["selected authored Bay count", metrics.selectionCount, 2],
		["model generation", metrics.modelGeneration, baseline.modelGeneration],
		["Worker sequence", metrics.workerSequence, baseline.workerSequence],
		["Worker revision", metrics.workerRevision, baseline.workerRevision],
		["Worker checksum", metrics.workerChecksum, baseline.workerChecksum],
		["Worker cells", metrics.workerCells, baseline.workerCells],
		["authored revision", metrics.documentRevision, baseline.documentRevision],
		["authored patch sequence", metrics.documentPatchSequence, baseline.documentPatchSequence],
	]) {
		assertEqual(failures, actual, expected, `100k+ manual recommendation policy ${label}`);
	}
	await panel.locator(".tilefab-assembly-connector-cancel").click();
	await panel.waitFor({ state: "hidden" });
	return {
		status: metrics.status,
		attempts: metrics.attempts,
		snapshotStatus: metrics.snapshotStatus,
		sourceCells: metrics.sourceCells,
		phase: metrics.phase,
	};
}

async function runScaleScenario(activeBrowser, cellCount) {
	const budget = RAIL_SCALE_BUDGETS[cellCount];
	if (!budget) throw new Error(`No scale budget exists for ${cellCount} cells.`);
	const context = await activeBrowser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	await context.addInitScript(() => {
		globalThis.__openFabScale = { longTasks: [], errors: [], rejections: [], observer: null };
		if (typeof PerformanceObserver !== "undefined") {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					globalThis.__openFabScale.longTasks.push({
						startTime: entry.startTime,
						duration: entry.duration,
					});
				}
			});
			try {
				observer.observe({ type: "longtask", buffered: true });
				globalThis.__openFabScale.observer = observer;
			} catch {
				// Unsupported browsers are rejected by the acceptance assertions.
			}
		}
		addEventListener("error", (event) => {
			globalThis.__openFabScale.errors.push(String(event.error?.message ?? event.message));
		});
		addEventListener("unhandledrejection", (event) => {
			globalThis.__openFabScale.rejections.push(String(event.reason));
		});
	});
	const page = await context.newPage();
	const consoleErrors = [];
	const pageErrors = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	const failures = [];
	let metrics = {};
	let interactionMetrics = {};
	let afterMetrics = {};
	let commitMetrics = {};
	let arrangementMetrics = {};
	let ohbMetrics = {};
	let membershipMetrics = {};
	let patternMetrics = {};
	let blueprintMetrics = {};
	let readyMilliseconds = Number.POSITIVE_INFINITY;
	let retainedHeapGrowthBytes = Number.POSITIVE_INFINITY;
	let membershipRetainedHeapGrowth = {
		usedSize: Number.POSITIVE_INFINITY,
		embedderHeapUsedSize: Number.POSITIVE_INFINITY,
		backingStorageSize: Number.POSITIVE_INFINITY,
	};
	let longTasks = [];
	const timeline = [];
	const directory = path.join(artifactRoot, String(cellCount));
	await mkdir(directory, { recursive: true });

	try {
		const startedAt = performance.now();
		await page.goto(`${baseUrl}/?scaleFixture=${cellCount}`, {
			waitUntil: "domcontentloaded",
			timeout: budget.readyMilliseconds,
		});
		await page.waitForFunction(
			(expectedCount) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.startupStatus === "ready" &&
					canvas.dataset.workerStatus === "ready" &&
					Number(canvas.dataset.physicalPaths) === expectedCount
				);
			},
			cellCount,
			{ timeout: budget.readyMilliseconds },
		);
		readyMilliseconds = performance.now() - startedAt;
		metrics = await readCanvasMetrics(page);
		timeline.push({ label: "ready", at: await page.evaluate(() => performance.now()) });
		const cdp = await context.newCDPSession(page);
		await collectScaleGarbageOutsideProductWindow(cdp, page);
		const heapBefore = await cdp.send("Runtime.getHeapUsage");
		commitMetrics = await exerciseCommitWorkflow(
			page,
			Number(metrics.modelGeneration),
			cellCount,
			budget.commitReadyMilliseconds,
		);
		timeline.push({ label: "commit-workflow", at: await page.evaluate(() => performance.now()) });
		afterMetrics = await readCanvasMetrics(page);
		ohbMetrics = await exerciseOhbRowWorkflow(
			page,
			Number(afterMetrics.modelGeneration),
			cellCount + 5,
			budget.commitReadyMilliseconds,
		);
		timeline.push({ label: "ohb-workflow", at: await page.evaluate(() => performance.now()) });
		afterMetrics = await readCanvasMetrics(page);
		let heapBeforeMembershipEdit = null;
		membershipMetrics = await exerciseEqMembershipWorkflow(
			page,
			Number(afterMetrics.modelGeneration),
			cellCount + 5,
			6,
			budget.commitReadyMilliseconds,
			async () => {
				await collectScaleGarbageOutsideProductWindow(cdp, page);
				heapBeforeMembershipEdit = await cdp.send("Runtime.getHeapUsage");
			},
		);
		timeline.push({
			label: "eq-membership-workflow",
			at: await page.evaluate(() => performance.now()),
		});
		await collectScaleGarbageOutsideProductWindow(cdp, page);
		const heapAfterMembership = await cdp.send("Runtime.getHeapUsage");
		if (!heapBeforeMembershipEdit) {
			throw new Error("EQ membership heap baseline was not captured after fixture placement.");
		}
		membershipRetainedHeapGrowth = heapUsageGrowth(heapBeforeMembershipEdit, heapAfterMembership);
		afterMetrics = await readCanvasMetrics(page);
		blueprintMetrics =
			cellCount === 10_000
				? await exerciseFactoryScaleBlueprintPreview(
						page,
						budget.blueprintPlacementReadyMilliseconds,
					)
				: { skipped: true };
		timeline.push({ label: "factory-blueprint", at: await page.evaluate(() => performance.now()) });
		afterMetrics = await readCanvasMetrics(page);
		const baselineCounters = cacheCounters(afterMetrics);

		patternMetrics = await exercisePatternPreview(page);
		timeline.push({ label: "pattern-preview", at: await page.evaluate(() => performance.now()) });
		await exerciseEditor(page);
		timeline.push({ label: "editor-workflow", at: await page.evaluate(() => performance.now()) });
		arrangementMetrics = await exerciseArrangementScalePage(
			context,
			cellCount,
			budget.arrangementReadyMilliseconds,
			consoleErrors,
			pageErrors,
		);
		timeline.push({
			label: "arrangement-session-workflow",
			at: await page.evaluate(() => performance.now()),
		});
		await page.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		interactionMetrics = await readCanvasMetrics(page);
		afterMetrics = interactionMetrics;
		await collectScaleGarbageOutsideProductWindow(cdp, page);
		const heapAfter = await cdp.send("Runtime.getHeapUsage");
		retainedHeapGrowthBytes = Math.max(0, heapAfter.usedSize - heapBefore.usedSize);
		const diagnostics = await page.evaluate(() => {
			const scale = globalThis.__openFabScale;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			return {
				longTasks: scale?.longTasks ?? [],
				errors: scale?.errors ?? [],
				rejections: scale?.rejections ?? [],
			};
		});
		longTasks = diagnostics.longTasks;
		const injectedErrors = diagnostics;

		assertEqual(
			failures,
			metrics.scaleAcceptanceVersion,
			String(RAIL_SCALE_ACCEPTANCE_VERSION),
			"scale acceptance contract version",
		);
		assertEqual(
			failures,
			metrics.scaleFixtureCells,
			String(cellCount),
			"authored fixture cell count",
		);
		assertEqual(failures, metrics.physicalPaths, String(cellCount), "compiled physical path count");
		assertEqual(failures, metrics.startupStatus, "ready", "startup status");
		assertEqual(failures, metrics.workerStatus, "ready", "mirror Worker status");
		assertEqual(failures, metrics.workerSimulationReady, "false", "simulation gate");
		assertEqual(
			failures,
			metrics.startupAuthoredChecksum,
			metrics.workerChecksum,
			"authored checksum",
		);
		assertEqual(
			failures,
			metrics.startupPhysicalFingerprint,
			metrics.workerPhysicalFingerprint,
			"physical fingerprint",
		);
		assertEqual(
			failures,
			metrics.startupMirrorFingerprintMatch,
			"true",
			"startup/mirror fingerprint match",
		);
		assertAtLeast(
			failures,
			numberMetric(metrics, "physicalPreparedArtifactBindings"),
			1,
			"prepared renderer binding",
		);
		assertAtLeast(
			failures,
			numberMetric(metrics, "draftCommittedPreparedBindings"),
			1,
			"prepared draft binding",
		);
		assertAtMost(
			failures,
			numberMetric(metrics, "startupWorkerPortSlotArtifactsMs"),
			budget.portSlotArtifactMilliseconds,
			"Worker port slot artifact preparation",
		);
		assertAtMost(
			failures,
			readyMilliseconds,
			budget.readyMilliseconds,
			"navigation to mirror-ready",
		);
		assertAtMost(
			failures,
			numberMetric(metrics, "startupWorkerTotalMs"),
			budget.workerMilliseconds,
			"Worker startup",
		);
		assertAtMost(
			failures,
			numberMetric(metrics, "startupActivationMaxSliceMs"),
			budget.activationSliceMilliseconds,
			"activation slice",
		);
		assertAtMost(
			failures,
			numberMetric(interactionMetrics, "renderMaxMs"),
			budget.canvasMilliseconds,
			"Canvas execution",
		);
		assertAtMost(
			failures,
			numberMetric(interactionMetrics, "interactionMaxMs"),
			budget.interactionMilliseconds,
			"interaction planning",
		);
		assertAtMost(
			failures,
			numberMetric(interactionMetrics, "visiblePaths"),
			budget.visiblePathCandidates,
			"visible path candidates",
		);
		assertAtMost(
			failures,
			numberMetric(interactionMetrics, "physicalSelectionCandidates"),
			budget.selectionCandidates,
			"selection candidates",
		);
		assertAtLeast(
			failures,
			numberMetric(interactionMetrics, "portSlotPreparedArtifactBindings"),
			1,
			"prepared port slot renderer binding",
		);
		assertAtLeast(
			failures,
			numberMetric(interactionMetrics, "portSlotCount"),
			cellCount * 2,
			"compiled OHB slot count",
		);
		assertAtMost(
			failures,
			numberMetric(interactionMetrics, "portSlotCount"),
			(cellCount + 5) * 2,
			"compiled OHB slot count",
		);
		assertAtMost(
			failures,
			numberMetric(interactionMetrics, "visiblePortSlots"),
			budget.visiblePortSlots,
			"visible port slot candidates",
		);
		assertEqual(
			failures,
			interactionMetrics.selectedModuleSource === "" ? "missing" : "selected",
			"selected",
			"module selection",
		);
		assertEqual(
			failures,
			interactionMetrics.railPresentationMode,
			"profiled",
			"presentation mode round trip",
		);
		assertEqual(
			failures,
			interactionMetrics.modelGeneration,
			String(
				Number(metrics.modelGeneration) +
					(blueprintMetrics.skipped ? 6 : 8) +
					membershipMetrics.generationDelta,
			),
			"non-committing model generation",
		);
		assertEqual(failures, ohbMetrics.committedPortCount, 6, "OHB row committed port count");
		assertEqual(failures, ohbMetrics.undoPortCount, 0, "OHB row atomic undo");
		assertEqual(failures, ohbMetrics.redoPortCount, 6, "OHB row atomic redo");
		assertEqual(failures, ohbMetrics.sequenceDelta, 3, "OHB row Worker patch sequence");
		assertEqual(failures, ohbMetrics.cancelStable, true, "OHB row Escape cancellation");
		assertEqual(failures, ohbMetrics.physicalStable, true, "OHB row physical identity reuse");
		assertEqual(failures, ohbMetrics.slotBindingStable, true, "OHB row slot index reuse");
		assertEqual(failures, ohbMetrics.derivationStable, true, "OHB row rail derivation reuse");
		assertEqual(failures, membershipMetrics.committedPortCount, 70, "EQ membership commit");
		assertEqual(failures, membershipMetrics.undoPortCount, 9, "EQ membership atomic undo");
		assertEqual(failures, membershipMetrics.redoPortCount, 70, "EQ membership atomic redo");
		assertEqual(failures, membershipMetrics.sequenceDelta, 4, "EQ membership Worker patches");
		assertEqual(
			failures,
			membershipMetrics.maximumMemberCountRejected,
			true,
			"EQ 65th port rejection",
		);
		assertEqual(
			failures,
			membershipMetrics.physicalStable,
			true,
			"EQ membership physical identity reuse",
		);
		assertEqual(
			failures,
			membershipMetrics.slotBindingStable,
			true,
			"EQ membership slot index reuse",
		);
		assertEqual(
			failures,
			membershipMetrics.derivationStable,
			true,
			"EQ membership rail derivation reuse",
		);
		assertAtMost(
			failures,
			membershipMetrics.candidateRowsMax,
			budget.membershipCandidateRows,
			"EQ membership bounded candidate rows",
		);
		assertAtLeast(
			failures,
			membershipMetrics.queryCount,
			71,
			"EQ membership indexed query samples",
		);
		assertEqual(
			failures,
			membershipMetrics.searchCount,
			membershipMetrics.expectedSearchCount,
			"EQ membership progressive search samples",
		);
		assertEqual(failures, membershipMetrics.searchStepsMax, 1, "EQ membership local search window");
		assertAtLeast(
			failures,
			membershipMetrics.interactionCount,
			71,
			"EQ membership interaction samples",
		);
		assertAtMost(
			failures,
			membershipMetrics.interactionMaxMilliseconds,
			budget.membershipInteractionMilliseconds,
			"EQ membership keyboard interaction",
		);
		assertAtMost(
			failures,
			membershipMetrics.planMaxMilliseconds,
			budget.membershipPlanMilliseconds,
			"EQ membership commit planner",
		);
		assertAtLeast(
			failures,
			membershipMetrics.inputPaintCount,
			membershipMetrics.expectedInputPaintCount,
			"EQ membership input-to-paint samples",
		);
		assertEqual(
			failures,
			membershipMetrics.maximumRejectedCount,
			1,
			"EQ membership maximum rejection branch",
		);
		assertEqual(
			failures,
			membershipMetrics.commitDispatchCount,
			1,
			"EQ membership commit dispatch samples",
		);
		assertEqual(failures, membershipMetrics.planCount, 1, "EQ membership planner samples");
		assertAtMost(
			failures,
			membershipMetrics.inputPaintMaxMilliseconds,
			budget.membershipInputPaintMilliseconds,
			"EQ membership input-to-paint latency",
		);
		assertAtMost(
			failures,
			membershipMetrics.commitDispatchMaxMilliseconds,
			budget.membershipCommitDispatchMilliseconds,
			"EQ membership document commit dispatch",
		);
		assertAtMost(
			failures,
			membershipMetrics.commitReadyMilliseconds,
			budget.membershipCommitReadyMilliseconds,
			"EQ membership Worker/model ready latency",
		);
		const membershipRetainedBudget = Math.max(
			budget.membershipRetainedHeapFloorBytes,
			heapUsageMetric(heapBeforeMembershipEdit, "usedSize") * budget.membershipRetainedHeapRatio,
		);
		assertAtMost(
			failures,
			membershipRetainedHeapGrowth.usedSize,
			membershipRetainedBudget,
			"EQ membership post-GC JS heap growth",
		);
		const membershipRetainedEmbedderBudget = Math.max(
			budget.membershipRetainedEmbedderHeapFloorBytes,
			heapUsageMetric(heapBeforeMembershipEdit, "embedderHeapUsedSize") *
				budget.membershipRetainedHeapRatio,
		);
		assertAtMost(
			failures,
			membershipRetainedHeapGrowth.embedderHeapUsedSize,
			membershipRetainedEmbedderBudget,
			"EQ membership post-GC embedder heap growth",
		);
		const membershipRetainedBackingStorageBudget = Math.max(
			budget.membershipRetainedBackingStorageFloorBytes,
			heapUsageMetric(heapBeforeMembershipEdit, "backingStorageSize") *
				budget.membershipRetainedHeapRatio,
		);
		assertAtMost(
			failures,
			membershipRetainedHeapGrowth.backingStorageSize,
			membershipRetainedBackingStorageBudget,
			"EQ membership post-GC backing storage growth",
		);
		if (!blueprintMetrics.skipped) {
			assertEqual(failures, blueprintMetrics.active, true, "factory blueprint activation");
			assertEqual(
				failures,
				blueprintMetrics.validationLevel,
				"topology-only",
				"factory blueprint pointer validation",
			);
			assertEqual(
				failures,
				blueprintMetrics.ghostCompileDelta,
				0,
				"factory blueprint compact ghost compilation",
			);
			assertEqual(
				failures,
				blueprintMetrics.modelGenerationStable,
				true,
				"factory blueprint non-committing preview",
			);
			assertEqual(failures, blueprintMetrics.cancelled, true, "factory blueprint cancellation");
			assertEqual(
				failures,
				blueprintMetrics.pendingObserved,
				true,
				"factory blueprint async validation state",
			);
			assertEqual(
				failures,
				blueprintMetrics.placementResult,
				"committed",
				"factory blueprint exact placement",
			);
			assertEqual(failures, blueprintMetrics.undoRestored, true, "factory blueprint atomic undo");
			assertEqual(
				failures,
				blueprintMetrics.pendingUndoObserved,
				true,
				"factory blueprint pending undo state",
			);
			assertEqual(
				failures,
				blueprintMetrics.pendingUndoPreservedHistory,
				true,
				"factory blueprint pending undo history preservation",
			);
			assertAtMost(
				failures,
				blueprintMetrics.clickDispatchMilliseconds,
				budget.blueprintPlacementDispatchMilliseconds,
				"factory blueprint click dispatch",
			);
			assertAtMost(
				failures,
				blueprintMetrics.placementReadyMilliseconds,
				budget.blueprintPlacementReadyMilliseconds,
				"factory blueprint Worker validation",
			);
			assertAtLeast(
				failures,
				blueprintMetrics.workerPlanningMilliseconds,
				0,
				"factory blueprint Worker planning telemetry",
			);
			assertAtLeast(
				failures,
				blueprintMetrics.workerValidationMilliseconds,
				0,
				"factory blueprint Worker validation telemetry",
			);
			assertAtLeast(
				failures,
				blueprintMetrics.selectedCells,
				cellCount,
				"factory blueprint exact selection",
			);
			assertAtLeast(
				failures,
				blueprintMetrics.interactionSampleDelta,
				20,
				"factory blueprint pointer samples",
			);
		}
		assertEqual(failures, patternMetrics.staticStable, true, "pattern pointer static layer reuse");
		assertEqual(failures, patternMetrics.telemetryPresent, true, "pattern placement telemetry");
		assertEqual(failures, patternMetrics.accessibilityLinked, true, "pattern accessibility link");
		assertEqual(failures, patternMetrics.cancelCleared, true, "pattern Escape telemetry cleanup");
		assertAtLeast(failures, patternMetrics.ghostCompileDelta, 1, "pattern ghost compilation");
		assertAtLeast(failures, patternMetrics.interactionSampleDelta, 20, "pattern pointer samples");
		for (const [name, before] of Object.entries(baselineCounters)) {
			assertEqual(failures, interactionMetrics[name], before, `${name} cache stability`);
		}
		assertEqual(
			failures,
			afterMetrics.modelGeneration,
			String(
				Number(metrics.modelGeneration) +
					(blueprintMetrics.skipped ? 6 : 8) +
					membershipMetrics.generationDelta,
			),
			"commit/undo/redo model generations",
		);
		assertEqual(
			failures,
			afterMetrics.physicalPaths,
			String(cellCount + 5),
			"redo physical path count",
		);
		assertEqual(failures, afterMetrics.workerStatus, "ready", "post-redo mirror Worker status");
		assertEqual(failures, afterMetrics.modelSyncPending, "false", "post-redo model activation");
		assertEqual(
			failures,
			afterMetrics.modelDerivationStatus,
			"idle",
			"post-redo derivation status",
		);
		assertEqual(failures, afterMetrics.workerSimulationReady, "false", "post-redo simulation gate");
		assertAtMost(
			failures,
			numberMetric(afterMetrics, "modelDerivationDispatchMs"),
			budget.commitDispatchMilliseconds,
			"main-thread commit snapshot dispatch",
		);
		assertAtMost(
			failures,
			numberMetric(afterMetrics, "modelDerivationActivationMaxSliceMs"),
			budget.activationSliceMilliseconds,
			"post-commit activation slice",
		);
		assertAtMost(
			failures,
			commitMetrics.maxDispatchMilliseconds,
			budget.commitDispatchMilliseconds + 25,
			"pointer/key commit dispatch wall time",
		);
		assertAtMost(
			failures,
			commitMetrics.maxReadyMilliseconds,
			budget.commitReadyMilliseconds,
			"commit/undo/redo mirror-ready activation",
		);
		assertAtLeast(failures, arrangementMetrics.rootCount, 2, "arrangement independent roots");
		assertEqual(
			failures,
			arrangementMetrics.selectedModules,
			2,
			"arrangement bounded source selection",
		);
		assertEqual(
			failures,
			arrangementMetrics.sourcePlanIndexes.length,
			2,
			"arrangement observed option plans",
		);
		assertAtLeast(
			failures,
			arrangementMetrics.sourcePlanIndexes[0],
			1,
			"arrangement initial source plan index",
		);
		assertAtLeast(
			failures,
			arrangementMetrics.sourcePlanIndexes[1],
			arrangementMetrics.sourcePlanIndexes[0] + 1,
			"arrangement reused-source plan index",
		);
		assertEqual(
			failures,
			arrangementMetrics.sessionTelemetryStable,
			true,
			"arrangement source hydrated once",
		);
		assertEqual(
			failures,
			arrangementMetrics.initialPhase,
			"certified",
			"arrangement initial prospective certification",
		);
		assertEqual(
			failures,
			arrangementMetrics.changedPhase,
			"certified",
			"arrangement reused-source prospective certification",
		);
		assertEqual(
			failures,
			arrangementMetrics.authoredStateStable,
			true,
			"arrangement preview authored state",
		);
		assertEqual(failures, arrangementMetrics.cancelled, true, "arrangement session cancellation");
		assertEqual(
			failures,
			arrangementMetrics.longTaskDelta,
			0,
			"arrangement planning main-thread Long Tasks",
		);
		assertEqual(
			failures,
			arrangementMetrics.selectionLongTaskEntries.length,
			0,
			"arrangement selection main-thread Long Tasks",
		);
		assertEqual(failures, arrangementMetrics.pageLongTasks, 0, "arrangement page total Long Tasks");
		assertAtMost(
			failures,
			arrangementMetrics.pageReadyMilliseconds,
			budget.arrangementReadyMilliseconds,
			"arrangement page startup",
		);
		assertAtMost(
			failures,
			arrangementMetrics.startDispatchMilliseconds,
			budget.arrangementDispatchMilliseconds,
			"arrangement source dispatch",
		);
		assertAtMost(
			failures,
			arrangementMetrics.initialReadyMilliseconds,
			budget.arrangementReadyMilliseconds,
			"arrangement source initialization",
		);
		assertAtMost(
			failures,
			arrangementMetrics.optionReadyMilliseconds,
			budget.arrangementReadyMilliseconds,
			"arrangement reused-source option",
		);
		assertEqual(failures, metrics.longTaskSupported, "true", "Long Task observer support");
		assertEqual(failures, longTasks.length, 0, "navigation and interaction Long Tasks");
		assertEqual(failures, consoleErrors.length, 0, "console errors");
		assertEqual(failures, pageErrors.length, 0, "page errors");
		assertEqual(failures, injectedErrors.errors.length, 0, "window errors");
		assertEqual(failures, injectedErrors.rejections.length, 0, "unhandled rejections");
		const retainedBudget = Math.max(
			budget.retainedHeapFloorBytes,
			heapBefore.usedSize * budget.retainedHeapRatio,
		);
		assertAtMost(failures, retainedHeapGrowthBytes, retainedBudget, "post-GC retained heap growth");
	} catch (error) {
		failures.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
	}

	if (failures.length > 0) {
		await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true });
	}
	const result = {
		cellCount,
		readyMilliseconds,
		retainedHeapGrowthBytes,
		membershipRetainedHeapGrowth,
		metrics,
		interactionMetrics,
		afterMetrics,
		commitMetrics,
		arrangementMetrics,
		ohbMetrics,
		membershipMetrics,
		blueprintMetrics,
		patternMetrics,
		longTasks,
		timeline,
		consoleErrors,
		pageErrors,
		failures,
	};
	await writeFile(path.join(directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	await closeBrowserResource(page, `${cellCount.toLocaleString()}-cell page`);
	await closeBrowserResource(context, `${cellCount.toLocaleString()}-cell context`);
	return result;
}

async function closeBrowserResource(resource, label) {
	if (!resource) return;
	let timeout;
	try {
		await Promise.race([
			resource.close(),
			new Promise((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`${label} close timed out after 5 seconds.`)),
					5_000,
				);
			}),
		]);
	} catch (error) {
		console.warn(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timeout);
	}
}

async function readSemanticBayScaleState(page) {
	return page.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const api = globalThis.__tileFab;
		const railDocument = api?.getDocument?.();
		const editorModel = api?.getEditorModel?.();
		const workerState = api?.getWorkerState?.();
		const numberFrom = (element, name) => {
			const value = element?.dataset?.[name];
			return value === undefined || value === "" ? Number.NaN : Number(value);
		};
		return {
			startupStatus: app?.dataset.startupStatus ?? "",
			workerStatus: canvas?.dataset.workerStatus ?? "",
			workerSequence: numberFrom(canvas, "workerSequence"),
			workerTargetSequence: numberFrom(canvas, "workerTargetSequence"),
			workerRevision: numberFrom(canvas, "workerRevision"),
			workerTargetRevision: numberFrom(canvas, "workerTargetRevision"),
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerTargetChecksum: canvas?.dataset.workerTargetChecksum ?? "",
			modelChecksum: editorModel?.authoredChecksum ?? "",
			modelPhysicalFingerprint: api?.getModelPhysicalFingerprint?.() ?? "",
			workerPhysicalFingerprint: workerState?.physicalFingerprint ?? "",
			workerCells: numberFrom(canvas, "workerCells"),
			workerEdges: numberFrom(canvas, "workerEdges"),
			workerPorts: numberFrom(canvas, "workerPorts"),
			workerEquipmentGroups: numberFrom(canvas, "workerEquipmentGroups"),
			physicalPaths: numberFrom(canvas, "physicalPaths"),
			strongComponents: numberFrom(canvas, "readinessStrongComponents"),
			openTerminals: numberFrom(canvas, "readinessOpenTerminals"),
			organizations: numberFrom(canvas, "staticFabOrganizationCount"),
			workerOrganizations: numberFrom(canvas, "workerOrganizations"),
			selectionCount: numberFrom(app, "organizationSelectionCount"),
			selectionIds: app?.dataset.organizationSelectionIds ?? "",
			workerSimulationReady: canvas?.dataset.workerSimulationReady === "true",
			modelGeneration: numberFrom(canvas, "modelGeneration"),
			modelSyncPending: canvas?.dataset.modelSyncPending === "true",
			modelDerivationStatus: canvas?.dataset.modelDerivationStatus ?? "",
			modelDerivationDispatchMilliseconds: numberFrom(canvas, "modelDerivationDispatchMs"),
			modelDerivationWorkerMilliseconds: numberFrom(canvas, "modelDerivationWorkerMs"),
			modelDerivationActivationMilliseconds: numberFrom(canvas, "modelDerivationActivationMs"),
			modelDerivationActivationMaxSliceMilliseconds: numberFrom(
				canvas,
				"modelDerivationActivationMaxSliceMs",
			),
			modelDerivationActivationMaxSlicePhase:
				canvas?.dataset.modelDerivationActivationMaxSlicePhase ?? "",
			modelDerivationPreparationMilliseconds: numberFrom(canvas, "modelDerivationPreparationMs"),
			startupActivationMaxSlicePhase: canvas?.dataset.startupActivationMaxSlicePhase ?? "",
			draftCommittedAdjacencyBuilds: numberFrom(canvas, "draftCommittedAdjacencyBuilds"),
			renderLastMilliseconds: numberFrom(canvas, "renderLastMs"),
			renderMaxMilliseconds: numberFrom(canvas, "renderMaxMs"),
			scaleAcceptanceVersion: numberFrom(canvas, "scaleAcceptanceVersion"),
			scaleFixtureCells: numberFrom(canvas, "scaleFixtureCells"),
			semanticBaySnapshotStatus: app?.dataset.semanticBaySnapshotStatus ?? "",
			semanticBaySnapshotSourceCells: numberFrom(app, "semanticBaySnapshotSourceCells"),
			semanticBayFirstPaintMilliseconds: numberFrom(app, "semanticBayFirstPaintMs"),
			semanticBaySnapshotHandoffMilliseconds: numberFrom(app, "semanticBaySnapshotHandoffMs"),
			semanticBayHydrationMilliseconds: numberFrom(app, "semanticBayHydrationMs"),
			semanticBayWorkerRoundTripMilliseconds: numberFrom(app, "semanticBayWorkerRoundTripMs"),
			semanticBayResponseValidationMilliseconds: numberFrom(app, "semanticBayResponseValidationMs"),
			semanticBayAdoptionMilliseconds: numberFrom(app, "semanticBayAdoptionMs"),
			documentPatchSequence: Number(railDocument?.getPatchSequence?.()),
			documentRevision: Number(railDocument?.map?.getRevision?.()),
			documentPortCount: Number(railDocument?.portEquipment?.ports?.length),
			documentEquipmentGroupCount: Number(railDocument?.portEquipment?.equipmentGroups?.length),
			nextPortId: Number(railDocument?.portEquipment?.nextPortId),
			nextEquipmentGroupId: Number(railDocument?.portEquipment?.nextEquipmentGroupId),
			portIds: railDocument?.portEquipment?.ports?.map((port) => port.id).join(",") ?? "",
			portTypes: railDocument?.portEquipment?.ports?.map((port) => port.portType).join(",") ?? "",
			portDirections:
				railDocument?.portEquipment?.ports?.map((port) => port.direction).join(",") ?? "",
			equipmentGroupIds:
				railDocument?.portEquipment?.equipmentGroups?.map((group) => group.id).join(",") ?? "",
			equipmentGroupKinds:
				railDocument?.portEquipment?.equipmentGroups?.map((group) => group.kind).join(",") ?? "",
			organizationEquipmentMembership:
				railDocument?.organizations?.records
					?.map((record) => `${record.id}:${record.membership.equipmentGroupIds.join(",")}`)
					.join("|") ?? "",
		};
	});
}

async function readSemanticBayDeleteEvidence(page) {
	return page.getByTestId("semantic-bay-command-dialog").evaluate((dialog) => {
		const evidence = dialog.querySelector(".tilefab-semantic-bay-evidence");
		const review = dialog.querySelector(".tilefab-semantic-bay-review");
		if (!(evidence instanceof HTMLElement) || !(review instanceof HTMLElement)) {
			throw new Error("Semantic Bay exact impact review or Worker topology evidence is missing.");
		}
		const columns = [...evidence.querySelectorAll(".tilefab-semantic-bay-evidence-grid dl")];
		if (columns.length !== 2) {
			throw new Error(`Expected two Semantic Bay topology columns, received ${columns.length}.`);
		}
		const readColumn = (column, heading) => {
			const rows = new Map();
			for (const row of column.querySelectorAll(":scope > div")) {
				const rowLabel = row.querySelector("dt")?.textContent?.trim() ?? "";
				const value = row.querySelector("dd")?.textContent?.trim() ?? "";
				if (rowLabel) rows.set(rowLabel, value);
			}
			const number = (label) => {
				const value = rows.get(label);
				if (value === undefined) return Number.NaN;
				return Number(value.replaceAll(",", "").replace(/[^0-9-]/g, ""));
			};
			return {
				authoredEdges: number(heading),
				authoredComponents: number("AUTHORED COMPONENTS"),
				directedScc: number("DIRECTED SCC"),
				physicalComponents: number("PHYSICAL COMPONENTS"),
				openTerminals: number("OPEN TERMINALS"),
				clearanceIssues: number("CLEARANCE ISSUES"),
				physicalDiagnostics: number("PHYSICAL DIAGNOSTICS"),
			};
		};
		return {
			certified: evidence.dataset.certified === "true",
			deletedEquipmentGroupCount: Number(review.dataset.reviewEquipmentGroupCount),
			deletedPortCount: Number(review.dataset.reviewPortCount),
			allClosed: (evidence.textContent ?? "").includes(
				"All source and result components are independently closed",
			),
			source: readColumn(columns[0], "SOURCE"),
			result: readColumn(columns[1], "RESULT"),
		};
	});
}

async function readSemanticBayScaleDiagnostics(page, windows) {
	const diagnostics = await readBayCommandScaleDiagnostics(page, windows, {
		globalName: "__openFabSemanticBayScale",
		workerStartsKey: "semanticWorkerStarts",
		workerTerminationsKey: "semanticWorkerTerminations",
		workerRequestsKey: "semanticRequests",
	});
	return {
		...diagnostics,
		instrumentation: {
			semanticWorkerStarts: diagnostics.instrumentation.workerStarts,
			semanticWorkerTerminations: diagnostics.instrumentation.workerTerminations,
			semanticRequests: diagnostics.instrumentation.workerRequests,
			railSnapshotCaptureRequests: diagnostics.instrumentation.railSnapshotCaptureRequests,
			hydrateTransfers: diagnostics.instrumentation.hydrateTransfers,
		},
	};
}

async function collectSemanticBayScaleGarbageOutsideProductWindow(cdp, page) {
	await collectBayCommandScaleGarbageOutsideProductWindow(cdp, page, "__openFabSemanticBayScale");
}

async function waitForSemanticBayWorkerRelease(page, timeoutMilliseconds) {
	await waitForScaleWorkerRelease(
		page,
		timeoutMilliseconds,
		/staticFabSemanticBayMutationWorker/i,
		"Semantic Bay",
	);
}

async function readBayFlowEditScaleState(page) {
	return page.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const api = globalThis.__tileFab;
		const railDocument = api?.getDocument?.();
		const editorModel = api?.getEditorModel?.();
		const workerState = api?.getWorkerState?.();
		const numberFrom = (element, name) => {
			const value = element?.dataset?.[name];
			return value === undefined || value === "" ? Number.NaN : Number(value);
		};
		return {
			startupStatus: app?.dataset.startupStatus ?? "",
			workerStatus: canvas?.dataset.workerStatus ?? "",
			workerSequence: numberFrom(canvas, "workerSequence"),
			workerTargetSequence: numberFrom(canvas, "workerTargetSequence"),
			workerRevision: numberFrom(canvas, "workerRevision"),
			workerTargetRevision: numberFrom(canvas, "workerTargetRevision"),
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerTargetChecksum: canvas?.dataset.workerTargetChecksum ?? "",
			modelChecksum: editorModel?.authoredChecksum ?? "",
			modelReadinessFingerprint: editorModel?.readiness?.fingerprint ?? "",
			modelTopologyFingerprint: editorModel?.readiness?.topologyFingerprint ?? "",
			modelPhysicalFingerprint: api?.getModelPhysicalFingerprint?.() ?? "",
			workerPhysicalFingerprint: workerState?.physicalFingerprint ?? "",
			workerCells: numberFrom(canvas, "workerCells"),
			workerEdges: numberFrom(canvas, "workerEdges"),
			physicalPaths: numberFrom(canvas, "physicalPaths"),
			strongComponents: numberFrom(canvas, "readinessStrongComponents"),
			openTerminals: numberFrom(canvas, "readinessOpenTerminals"),
			organizations: numberFrom(canvas, "staticFabOrganizationCount"),
			workerOrganizations: numberFrom(canvas, "workerOrganizations"),
			selectionCount: numberFrom(app, "organizationSelectionCount"),
			selectionIds: app?.dataset.organizationSelectionIds ?? "",
			areaSelectionProvenance: app?.dataset.areaSelectionProvenance ?? "",
			staticFabHierarchyRequested: app?.dataset.staticFabHierarchyRequested === "true",
			historyCanUndo: app?.dataset.historyCanUndo ?? "",
			historyCanRedo: app?.dataset.historyCanRedo ?? "",
			workerSimulationReady: canvas?.dataset.workerSimulationReady === "true",
			modelGeneration: numberFrom(canvas, "modelGeneration"),
			modelSyncPending: canvas?.dataset.modelSyncPending === "true",
			modelDerivationStatus: canvas?.dataset.modelDerivationStatus ?? "",
			modelDerivationDispatchMilliseconds: numberFrom(canvas, "modelDerivationDispatchMs"),
			modelDerivationWorkerMilliseconds: numberFrom(canvas, "modelDerivationWorkerMs"),
			modelDerivationActivationMilliseconds: numberFrom(canvas, "modelDerivationActivationMs"),
			modelDerivationActivationMaxSliceMilliseconds: numberFrom(
				canvas,
				"modelDerivationActivationMaxSliceMs",
			),
			modelDerivationActivationMaxSlicePhase:
				canvas?.dataset.modelDerivationActivationMaxSlicePhase ?? "",
			modelDerivationPreparationMilliseconds: numberFrom(canvas, "modelDerivationPreparationMs"),
			startupActivationMaxSlicePhase: canvas?.dataset.startupActivationMaxSlicePhase ?? "",
			draftCommittedAdjacencyBuilds: numberFrom(canvas, "draftCommittedAdjacencyBuilds"),
			scaleAcceptanceVersion: numberFrom(canvas, "scaleAcceptanceVersion"),
			scaleFixtureCells: numberFrom(canvas, "scaleFixtureCells"),
			bayFlowEditSnapshotStatus: app?.dataset.bayFlowEditSnapshotStatus ?? "",
			bayFlowEditSnapshotSourceCells: numberFrom(app, "bayFlowEditSnapshotSourceCells"),
			bayFlowEditFirstPaintMilliseconds: numberFrom(app, "bayFlowEditFirstPaintMs"),
			bayFlowEditSnapshotHandoffMilliseconds: numberFrom(app, "bayFlowEditSnapshotHandoffMs"),
			bayFlowEditHydrationMilliseconds: numberFrom(app, "bayFlowEditHydrationMs"),
			bayFlowEditWorkerRoundTripMilliseconds: numberFrom(app, "bayFlowEditWorkerRoundTripMs"),
			bayFlowEditResponseValidationMilliseconds: numberFrom(app, "bayFlowEditResponseValidationMs"),
			bayFlowEditAdoptionMilliseconds: numberFrom(app, "bayFlowEditAdoptionMs"),
			documentPatchSequence: Number(railDocument?.getPatchSequence?.()),
			documentRevision: Number(railDocument?.map?.getRevision?.()),
			organizationIds:
				railDocument?.organizations?.records?.map((record) => record.id).join(",") ?? "",
			nextOrganizationId: Number(railDocument?.organizations?.nextOrganizationId),
			equipmentPorts: Number(railDocument?.portEquipment?.ports?.length),
			equipmentGroups: Number(railDocument?.portEquipment?.equipmentGroups?.length),
		};
	});
}

async function readBayFlowEditEvidence(page) {
	return page.getByTestId("bay-flow-edit-dialog").evaluate((dialog) => {
		const parseNumber = (value) => Number(String(value ?? "").replaceAll(",", ""));
		const review = dialog.querySelector(".tilefab-semantic-bay-review");
		const evidence = dialog.querySelector(".tilefab-semantic-bay-evidence");
		if (!(review instanceof HTMLElement) || !(evidence instanceof HTMLElement)) {
			throw new Error("Bay Flow Edit exact review or Worker evidence is missing.");
		}
		const replaced = review.querySelector('[data-impact="removed"]')?.textContent ?? "";
		const fixed = review.querySelector('[data-impact="preserved"]')?.textContent ?? "";
		const replacement = replaced.match(
			/ALTERNATING\s*→\s*CO-ROTATING\s*·\s*([\d,]+)\s+removed\s*\+\s*([\d,]+)\s+added directed edges/i,
		);
		const changed = replaced.match(
			/([\d,]+)\s+changed cells\s*·\s*([\d,]+)\s+existing memberships/i,
		);
		const articles = [...evidence.querySelectorAll(".tilefab-semantic-bay-evidence-grid article")];
		const authored = articles.find((article) => (article.textContent ?? "").includes("AUTHORED"));
		const physical = articles.find((article) => (article.textContent ?? "").includes("PHYSICAL"));
		const authoredMatch = (authored?.textContent ?? "").match(
			/([\d,]+)\s+cells\s*·\s*([\d,]+)\s+edges\s*·\s*([\d,]+)\s+weak\s*\/\s*([\d,]+)\s+SCC/i,
		);
		const physicalMatch = (physical?.textContent ?? "").match(
			/([\d,]+)\s+paths\s*·\s*([\d,]+)\s+weak\s*\/\s*([\d,]+)\s+SCC/i,
		);
		const candidate =
			evidence.querySelector(".tilefab-semantic-bay-candidate-note")?.textContent ?? "";
		const prospective = candidate.match(
			/Source and result counts are equal:\s*authored\s+([\d,]+)\s+edges\s*·\s*physical\s+([\d,]+)\s+paths/i,
		);
		return {
			phase: dialog.dataset.phase ?? "",
			targetInternalFlowPattern: dialog.dataset.targetPattern ?? "",
			sourceInternalFlowPattern: replacement ? "alternating" : "",
			detachedBay: /Detached Bay\s*·\s*no external connector/i.test(fixed),
			certified: /EXACT\s*·\s*SOURCE-BOUND/i.test(evidence.textContent ?? ""),
			countsEqual: /Source and result counts are equal/i.test(candidate),
			removedDirectedEdges: replacement ? parseNumber(replacement[1]) : Number.NaN,
			addedDirectedEdges: replacement ? parseNumber(replacement[2]) : Number.NaN,
			changedCells: changed ? parseNumber(changed[1]) : Number.NaN,
			changedOrganizations: changed ? parseNumber(changed[2]) : Number.NaN,
			authoredCells: authoredMatch ? parseNumber(authoredMatch[1]) : Number.NaN,
			authoredEdges: authoredMatch ? parseNumber(authoredMatch[2]) : Number.NaN,
			authoredComponents: authoredMatch ? parseNumber(authoredMatch[3]) : Number.NaN,
			authoredStrongComponents: authoredMatch ? parseNumber(authoredMatch[4]) : Number.NaN,
			physicalPaths: physicalMatch ? parseNumber(physicalMatch[1]) : Number.NaN,
			physicalComponents: physicalMatch ? parseNumber(physicalMatch[2]) : Number.NaN,
			physicalStrongComponents: physicalMatch ? parseNumber(physicalMatch[3]) : Number.NaN,
			prospectiveAuthoredEdges: prospective ? parseNumber(prospective[1]) : Number.NaN,
			prospectivePhysicalPaths: prospective ? parseNumber(prospective[2]) : Number.NaN,
		};
	});
}

async function readBayFlowEditScaleDiagnostics(page, windows) {
	return readBayCommandScaleDiagnostics(page, windows, {
		globalName: "__openFabBayFlowEditScale",
		workerStartsKey: "workerStarts",
		workerTerminationsKey: "workerTerminations",
		workerRequestsKey: "workerRequests",
	});
}

async function collectBayFlowEditScaleGarbageOutsideProductWindow(cdp, page) {
	await collectBayCommandScaleGarbageOutsideProductWindow(cdp, page, "__openFabBayFlowEditScale");
}

async function waitForBayFlowEditWorkerRelease(page, timeoutMilliseconds) {
	await waitForScaleWorkerRelease(
		page,
		timeoutMilliseconds,
		/staticFabBayFlowEditWorker/i,
		"Bay Flow Edit",
	);
}

async function resetBayFlowEditScaleCycleInstrumentation(page) {
	await page.evaluate(() => {
		const scale = globalThis.__openFabBayFlowEditScale;
		if (!scale) throw new Error("Bay Flow Edit scale instrumentation is missing.");
		for (const entry of scale.observer?.takeRecords?.() ?? []) {
			scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
		}
		scale.workerStarts = 0;
		scale.workerTerminations = 0;
		scale.hierarchyWorkerStarts = 0;
		scale.hierarchyWorkerTerminations = 0;
		scale.workerRequests.length = 0;
		scale.railSnapshotCaptureRequests.length = 0;
		scale.hydrateTransfers.length = 0;
		scale.commandStartedAt = null;
		scale.applyStartedAt = null;
	});
}

async function exerciseBayFlowEditRetainedHeapCycle(page, budget, source, warmTarget, failures) {
	await page.getByRole("button", { name: "실행 취소" }).click();
	await page.waitForFunction(
		(expected) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.workerStatus === "ready" &&
				Number(canvas.dataset.workerSequence) === expected.sequence &&
				Number(canvas.dataset.workerTargetSequence) === expected.sequence &&
				canvas.dataset.workerChecksum === expected.checksum &&
				canvas.dataset.workerTargetChecksum === expected.checksum &&
				Number(canvas.dataset.modelGeneration) === expected.generation &&
				canvas.dataset.modelSyncPending === "false" &&
				canvas.dataset.modelDerivationStatus === "idle" &&
				app?.dataset.organizationSelectionIds === String(expected.targetBayOrganizationId)
			);
		},
		{
			sequence: warmTarget.workerSequence + 1,
			checksum: source.workerChecksum,
			generation: warmTarget.modelGeneration + 1,
			targetBayOrganizationId: budget.targetBayOrganizationId,
		},
		{ timeout: budget.mirrorReadyMilliseconds },
	);
	const restoredSource = await readBayFlowEditScaleState(page);
	for (const [label, actual, expected] of [
		["source cells", restoredSource.workerCells, source.workerCells],
		["source authored edges", restoredSource.workerEdges, source.workerEdges],
		["source physical paths", restoredSource.physicalPaths, source.physicalPaths],
		["source organizations", restoredSource.organizations, source.organizations],
		["source organization identities", restoredSource.organizationIds, source.organizationIds],
		["source next organization ID", restoredSource.nextOrganizationId, source.nextOrganizationId],
		[
			"source Worker revision",
			restoredSource.workerRevision,
			warmTarget.workerRevision + budget.changedCellCount,
		],
		[
			"source target revision",
			restoredSource.workerTargetRevision,
			warmTarget.workerTargetRevision + budget.changedCellCount,
		],
		[
			"source document revision",
			restoredSource.documentRevision,
			warmTarget.documentRevision + budget.changedCellCount,
		],
		["source history can undo", restoredSource.historyCanUndo, "false"],
		["source history can redo", restoredSource.historyCanRedo, "true"],
	]) {
		assertEqual(failures, actual, expected, `Bay Flow Edit memory cycle ${label}`);
	}

	await activateEditorActivity(page, "assemble");
	const assembleMenu = page.getByTestId("static-fab-assemble-menu");
	if (!(await assembleMenu.isVisible().catch(() => false))) {
		await page.getByTestId("editor-activity-assemble").click();
	}
	await assembleMenu.waitFor({ state: "visible" });
	const target = assembleMenu.getByTestId("assemble-edit-selected-bay-co-rotating");
	if (!(await target.isEnabled())) {
		throw new Error(
			"The Bay Flow Edit memory cycle target is unavailable after source restoration.",
		);
	}
	const commandStartedAt = await page.evaluate(() => {
		const scale = globalThis.__openFabBayFlowEditScale;
		const button = document.querySelector('[data-testid="assemble-edit-selected-bay-co-rotating"]');
		if (!scale || !(button instanceof HTMLButtonElement)) {
			throw new Error("The Bay Flow Edit memory cycle command is missing.");
		}
		const startedAt = performance.now();
		scale.commandStartedAt = startedAt;
		scale.applyStartedAt = null;
		button.click();
		return startedAt;
	});
	const dialog = page.getByTestId("bay-flow-edit-dialog");
	await dialog.waitFor({ state: "visible", timeout: budget.firstPaintMilliseconds * 4 });
	await page.waitForFunction(
		() => {
			const candidate = document.querySelector('[data-testid="bay-flow-edit-dialog"]');
			return ["ready", "rejected"].includes(candidate?.getAttribute("data-phase") ?? "");
		},
		undefined,
		{ timeout: budget.certificationMilliseconds },
	);
	const certifiedAt = await page.evaluate(() => performance.now());
	if ((await dialog.getAttribute("data-phase")) !== "ready") {
		throw new Error(`Bay Flow Edit memory cycle was rejected: ${await dialog.textContent()}`);
	}
	const commandWindowEndedAt = await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))),
			),
	);
	const applyStartedAt = await page.evaluate(() => {
		const scale = globalThis.__openFabBayFlowEditScale;
		const button = document.querySelector('[data-testid="bay-flow-edit-apply"]');
		if (!scale || !(button instanceof HTMLButtonElement)) {
			throw new Error("The Bay Flow Edit memory cycle Apply command is missing.");
		}
		const startedAt = performance.now();
		scale.applyStartedAt = startedAt;
		button.click();
		return startedAt;
	});
	await dialog.waitFor({ state: "hidden", timeout: 2_000 });
	await page.waitForFunction(
		(expected) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.workerStatus === "ready" &&
				Number(canvas.dataset.workerSequence) === expected.sequence &&
				Number(canvas.dataset.workerTargetSequence) === expected.sequence &&
				canvas.dataset.workerChecksum === expected.checksum &&
				canvas.dataset.workerTargetChecksum === expected.checksum &&
				Number(canvas.dataset.modelGeneration) === expected.generation &&
				canvas.dataset.modelSyncPending === "false" &&
				canvas.dataset.modelDerivationStatus === "idle" &&
				app?.dataset.organizationSelectionIds === String(expected.targetBayOrganizationId)
			);
		},
		{
			sequence: restoredSource.workerSequence + 1,
			checksum: warmTarget.workerChecksum,
			generation: restoredSource.modelGeneration + 1,
			targetBayOrganizationId: budget.targetBayOrganizationId,
		},
		{ timeout: budget.mirrorReadyMilliseconds },
	);
	const applyWindowEndedAt = await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now()))),
			),
	);
	await waitForBayFlowEditWorkerRelease(page, 2_000);
	const diagnostics = await readBayFlowEditScaleDiagnostics(page, {
		commandStartedAt,
		commandEndedAt: commandWindowEndedAt,
		applyStartedAt,
		applyEndedAt: applyWindowEndedAt,
	});
	for (const [label, actual, expected] of [
		["disposable Worker starts", diagnostics.instrumentation.workerStarts, 1],
		["disposable Worker terminations", diagnostics.instrumentation.workerTerminations, 1],
		["legacy hierarchy Worker starts", diagnostics.instrumentation.hierarchyWorkerStarts, 0],
		[
			"legacy hierarchy Worker terminations",
			diagnostics.instrumentation.hierarchyWorkerTerminations,
			0,
		],
		["mirror snapshot captures", diagnostics.instrumentation.railSnapshotCaptureRequests.length, 1],
		["Worker requests", diagnostics.instrumentation.workerRequests.length, 2],
		[
			"HYDRATE request",
			diagnostics.instrumentation.workerRequests[0]?.type,
			"HYDRATE_STATIC_FAB_BAY_FLOW_EDIT",
		],
		[
			"PREPARE request",
			diagnostics.instrumentation.workerRequests[1]?.type,
			"PREPARE_STATIC_FAB_BAY_FLOW_EDIT",
		],
		["HYDRATE transfer samples", diagnostics.instrumentation.hydrateTransfers.length, 1],
		["certification Long Tasks", diagnostics.commandLongTasks.length, 0],
		["apply Long Tasks", diagnostics.applyLongTasks.length, 0],
		["window errors", diagnostics.errors.length, 0],
		["unhandled rejections", diagnostics.rejections.length, 0],
	]) {
		assertEqual(failures, actual, expected, `Bay Flow Edit memory cycle ${label}`);
	}
	const snapshotCapture = diagnostics.instrumentation.railSnapshotCaptureRequests[0];
	if (snapshotCapture) {
		for (const [label, actual, expected] of [
			["snapshot sequence", snapshotCapture.expectedSequence, restoredSource.workerSequence],
			["snapshot revision", snapshotCapture.expectedRevision, restoredSource.workerRevision],
			["snapshot checksum", snapshotCapture.expectedChecksum, restoredSource.workerChecksum],
		]) {
			assertEqual(failures, actual, expected, `Bay Flow Edit memory cycle ${label}`);
		}
	}
	const transfer = diagnostics.instrumentation.hydrateTransfers[0];
	if (transfer) {
		assertExactSnapshotTransfer(
			failures,
			transfer,
			budget.transferBytes,
			"Bay Flow Edit memory cycle",
		);
	}

	const repeatedTarget = await readBayFlowEditScaleState(page);
	for (const key of [
		"workerChecksum",
		"workerTargetChecksum",
		"modelChecksum",
		"modelReadinessFingerprint",
		"modelTopologyFingerprint",
		"workerCells",
		"workerEdges",
		"physicalPaths",
		"strongComponents",
		"openTerminals",
		"organizations",
		"workerOrganizations",
		"selectionCount",
		"selectionIds",
		"areaSelectionProvenance",
		"staticFabHierarchyRequested",
		"workerSimulationReady",
		"modelSyncPending",
		"modelDerivationStatus",
		"organizationIds",
		"nextOrganizationId",
		"equipmentPorts",
		"equipmentGroups",
		"historyCanUndo",
		"historyCanRedo",
	]) {
		assertEqual(
			failures,
			repeatedTarget[key],
			warmTarget[key],
			`Bay Flow Edit same-terminal heap cycle ${key}`,
		);
	}
	assertAtLeast(
		failures,
		repeatedTarget.modelPhysicalFingerprint.length,
		1,
		"Bay Flow Edit same-terminal heap cycle model physical fingerprint",
	);
	assertEqual(
		failures,
		repeatedTarget.modelPhysicalFingerprint,
		repeatedTarget.workerPhysicalFingerprint,
		"Bay Flow Edit same-terminal heap cycle current model/Worker physical fingerprint",
	);
	for (const [label, actual, expected] of [
		[
			"Worker revision",
			repeatedTarget.workerRevision,
			restoredSource.workerRevision + budget.changedCellCount,
		],
		[
			"target revision",
			repeatedTarget.workerTargetRevision,
			restoredSource.workerTargetRevision + budget.changedCellCount,
		],
		[
			"document revision",
			repeatedTarget.documentRevision,
			restoredSource.documentRevision + budget.changedCellCount,
		],
	]) {
		assertEqual(
			failures,
			actual,
			expected,
			`Bay Flow Edit same-terminal heap cycle exact ${label}`,
		);
	}
	assertEqual(
		failures,
		repeatedTarget.modelPhysicalFingerprint !== warmTarget.modelPhysicalFingerprint,
		true,
		"Bay Flow Edit same-terminal heap cycle revision-bound physical generation",
	);
	assertEqual(
		failures,
		await assembleMenu.isVisible(),
		false,
		"Bay Flow Edit same-terminal heap cycle Assemble menu",
	);
	assertEqual(
		failures,
		await page.getByTestId("rail-canvas").evaluate((element) => element === document.activeElement),
		true,
		"Bay Flow Edit same-terminal heap cycle Canvas focus",
	);
	return {
		commandMilliseconds: certifiedAt - commandStartedAt,
		commandWindowMilliseconds: commandWindowEndedAt - commandStartedAt,
		applyMilliseconds: applyWindowEndedAt - applyStartedAt,
		workerStarts: diagnostics.instrumentation.workerStarts,
		workerTerminations: diagnostics.instrumentation.workerTerminations,
		hierarchyWorkerStarts: diagnostics.instrumentation.hierarchyWorkerStarts,
		hierarchyWorkerTerminations: diagnostics.instrumentation.hierarchyWorkerTerminations,
		transferBytes: transfer?.totalBytes ?? 0,
		sourceSequence: restoredSource.workerSequence,
		targetSequence: repeatedTarget.workerSequence,
		sourceRevision: restoredSource.workerRevision,
		targetRevision: repeatedTarget.workerRevision,
		sameTerminalChecksum: repeatedTarget.workerChecksum === warmTarget.workerChecksum,
	};
}

async function readBayCommandScaleDiagnostics(page, windows, keys) {
	return page.evaluate(
		({ windows: activeWindows, keys: instrumentationKeys }) => {
			const scale = globalThis[instrumentationKeys.globalName];
			if (!scale) throw new Error(`${instrumentationKeys.globalName} instrumentation is missing.`);
			for (const entry of scale.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			const overlapping = (entry, startedAt, endedAt) =>
				Number.isFinite(startedAt) &&
				Number.isFinite(endedAt) &&
				entry.startTime < endedAt &&
				entry.startTime + entry.duration >= startedAt;
			return {
				longTaskSupported: scale.longTaskSupported,
				commandLongTasks: scale.longTasks.filter((entry) =>
					overlapping(entry, activeWindows.commandStartedAt, activeWindows.commandEndedAt),
				),
				applyLongTasks: scale.longTasks.filter((entry) =>
					overlapping(entry, activeWindows.applyStartedAt, activeWindows.applyEndedAt),
				),
				instrumentation: {
					workerStarts: scale[instrumentationKeys.workerStartsKey],
					workerTerminations: scale[instrumentationKeys.workerTerminationsKey],
					hierarchyWorkerStarts: scale.hierarchyWorkerStarts ?? 0,
					hierarchyWorkerTerminations: scale.hierarchyWorkerTerminations ?? 0,
					workerRequests: [...scale[instrumentationKeys.workerRequestsKey]],
					railSnapshotCaptureRequests: [...scale.railSnapshotCaptureRequests],
					hydrateTransfers: [...scale.hydrateTransfers],
				},
				errors: [...scale.errors],
				rejections: [...scale.rejections],
			};
		},
		{ windows, keys },
	);
}

async function collectBayCommandScaleGarbageOutsideProductWindow(cdp, page, globalName) {
	const startedAt = await page.evaluate(() => performance.now());
	await cdp.send("HeapProfiler.collectGarbage");
	const endedAt = await page.evaluate(() => performance.now());
	await page.evaluate(
		({ startedAt: excludedStart, endedAt: excludedEnd, globalName: instrumentationName }) => {
			const scale = globalThis[instrumentationName];
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			if (!scale) return;
			scale.longTasks = scale.longTasks.filter(
				(entry) =>
					entry.startTime + entry.duration <= excludedStart || entry.startTime >= excludedEnd,
			);
		},
		{ startedAt, endedAt, globalName },
	);
}

async function measureBayCommandRetainedHeap(
	cdp,
	page,
	globalName,
	heapBefore,
	budget,
	failures,
	label,
	requireSameTerminalShape = false,
) {
	await collectBayCommandScaleGarbageOutsideProductWindow(cdp, page, globalName);
	const heapAfter = await cdp.send("Runtime.getHeapUsage");
	const retainedHeapSignedDelta = heapUsageDelta(heapBefore, heapAfter);
	const retainedHeapBudget = {
		usedSize: Math.max(
			budget.retainedHeapFloorBytes,
			heapUsageMetric(heapBefore, "usedSize") * budget.retainedHeapRatio,
		),
		embedderHeapUsedSize: Math.max(
			budget.retainedEmbedderHeapFloorBytes,
			heapUsageMetric(heapBefore, "embedderHeapUsedSize") * budget.retainedHeapRatio,
		),
		backingStorageSize: Math.max(
			budget.retainedBackingStorageFloorBytes,
			heapUsageMetric(heapBefore, "backingStorageSize") * budget.retainedHeapRatio,
		),
	};
	for (const field of ["usedSize", "embedderHeapUsedSize", "backingStorageSize"]) {
		assertAtMost(
			failures,
			retainedHeapSignedDelta[field],
			retainedHeapBudget[field],
			`${label} post-GC signed retained ${field}`,
		);
		if (requireSameTerminalShape) {
			assertAtLeast(
				failures,
				retainedHeapSignedDelta[field],
				-retainedHeapBudget[field],
				`${label} post-GC same-terminal release ${field}`,
			);
		}
	}
	return {
		heapAfter,
		retainedHeapGrowth: retainedHeapSignedDelta,
		retainedHeapSignedDelta,
		retainedHeapBudget,
	};
}

async function waitForScaleWorkerRelease(page, timeoutMilliseconds, workerPattern, label) {
	const startedAt = performance.now();
	while (page.workers().some((worker) => workerPattern.test(worker.url()))) {
		if (performance.now() - startedAt >= timeoutMilliseconds) {
			throw new Error(`${label} Worker remained live after ${timeoutMilliseconds} ms.`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function collectScaleGarbageOutsideProductWindow(cdp, page) {
	const startedAt = await page.evaluate(() => performance.now());
	await cdp.send("HeapProfiler.collectGarbage");
	const endedAt = await page.evaluate(() => performance.now());
	await page.evaluate(
		({ startedAt: excludedStart, endedAt: excludedEnd }) => {
			const scale = globalThis.__openFabScale;
			for (const entry of scale?.observer?.takeRecords?.() ?? []) {
				scale.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
			}
			if (!scale) return;
			scale.longTasks = scale.longTasks.filter(
				(entry) =>
					entry.startTime + entry.duration <= excludedStart || entry.startTime >= excludedEnd,
			);
		},
		{ startedAt, endedAt },
	);
}

async function exerciseEditor(page) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no interaction bounds.");
	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;
	const cell = 38;

	await canvas.focus();
	await page.keyboard.press("v");
	await page.mouse.click(centerX + cell * 0.5, centerY + cell * 0.5);
	await clickActivityCommand(page, "build", "레일 건설");
	await page.mouse.move(centerX + cell * 2.5, centerY + cell * 0.5);
	await page.mouse.down();
	await page.mouse.move(centerX + cell * 2.5, centerY + cell * 3.5, { steps: 10 });
	await page.keyboard.press("Escape");
	await page.mouse.up();

	await canvas.focus();
	await canvas.press("v");
	await canvas.press("v");
	await clickActivityCommand(page, "equip", "OHB 포트 배치");
	for (let index = 0; index < 120; index++) {
		await page.mouse.move(centerX + 20 + (index % 20) * 5, centerY + 20 + (index % 7) * 4);
	}
	await canvas.focus();
	for (const key of ["w", "a", "s", "d", "q", "e"]) await page.keyboard.press(key);
	await page.mouse.move(centerX, centerY);
	await page.mouse.down({ button: "right" });
	await page.mouse.move(centerX + 48, centerY + 32, { steps: 8 });
	await page.mouse.up({ button: "right" });
}

async function exerciseFactoryScaleBlueprintPreview(page, readyTimeoutMilliseconds) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no factory-blueprint interaction bounds.");
	await canvas.focus();
	const startedAt = await page.evaluate(() => performance.now());
	const before = await readCanvasMetrics(page);
	await page.keyboard.press("Control+a");
	const inspector = page.getByTestId("rail-area-selection-inspector");
	await inspector.waitFor({ state: "visible" });
	const selectedAt = await page.evaluate(() => performance.now());
	const selectedCells = Number(await inspector.getAttribute("data-cell-count"));
	await page.keyboard.press("Control+c");
	await page.getByText("MULTI-PLACE ON", { exact: true }).waitFor({ state: "visible" });
	const copiedAt = await page.evaluate(() => performance.now());
	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;
	for (let index = 0; index < 30; index++) {
		await page.mouse.move(
			centerX - 500 + (index % 25) * 40,
			centerY - 40 + Math.floor(index / 25) * 80,
		);
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	}
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	const preview = await readCanvasMetrics(page);
	const active = await page.getByText("MULTI-PLACE ON", { exact: true }).isVisible();
	const generationBeforePlacement = Number(preview.modelGeneration);
	const pathsBeforePlacement = Number(preview.physicalPaths);
	const clickStartedAt = performance.now();
	await page.mouse.click(centerX, centerY - 140);
	const clickDispatchMilliseconds = performance.now() - clickStartedAt;
	const pendingObserved =
		(await canvas.getAttribute("data-blueprint-placement-pending")) === "true";
	const placementStartedAt = performance.now();
	const placementOutcomeHandle = await page.waitForFunction(
		() => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return (
				target?.dataset.blueprintPlacementPending === "false" &&
				target.dataset.blueprintPlacementResult &&
				target.dataset.blueprintPlacementResult !== "pending" &&
				target.dataset.blueprintPlacementResult
			);
		},
		undefined,
		{ timeout: readyTimeoutMilliseconds },
	);
	const placementOutcome = await placementOutcomeHandle.jsonValue();
	await placementOutcomeHandle.dispose();
	if (placementOutcome !== "committed") {
		const status = await page.locator(".tilefab-statusbar").innerText();
		throw new Error(`Factory blueprint placement ${placementOutcome}: ${status}`);
	}
	await page.waitForFunction(
		(expectedGeneration) => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return (
				target?.dataset.modelSyncPending === "false" &&
				target.dataset.workerStatus === "ready" &&
				Number(target.dataset.modelGeneration) === expectedGeneration
			);
		},
		generationBeforePlacement + 1,
		{ timeout: readyTimeoutMilliseconds },
	);
	const placementReadyMilliseconds = performance.now() - placementStartedAt;
	const placed = await readCanvasMetrics(page);
	const placementResult = placed.blueprintPlacementResult;
	const workerPlanningMilliseconds = Number(placed.blueprintPlacementPlanningMs);
	const workerValidationMilliseconds = Number(placed.blueprintPlacementValidationMs);
	await page.getByRole("button", { name: "실행 취소" }).click();
	await page.waitForFunction(
		(expected) => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return (
				target?.dataset.modelSyncPending === "false" &&
				target.dataset.workerStatus === "ready" &&
				Number(target.dataset.modelGeneration) === expected.generation &&
				Number(target.dataset.physicalPaths) === expected.paths
			);
		},
		{
			generation: generationBeforePlacement + 2,
			paths: pathsBeforePlacement,
		},
		{ timeout: readyTimeoutMilliseconds },
	);
	const afterUndo = await readCanvasMetrics(page);
	const undoRestored =
		Number(afterUndo.physicalPaths) === pathsBeforePlacement &&
		Number(afterUndo.modelGeneration) === generationBeforePlacement + 2;
	await canvas.focus();
	await page.keyboard.press("Control+v");
	await page.getByText("MULTI-PLACE ON", { exact: true }).waitFor({ state: "visible" });
	await page.mouse.click(centerX, centerY - 140);
	const pendingUndoObserved =
		(await canvas.getAttribute("data-blueprint-placement-pending")) === "true";
	await page.keyboard.press("Control+z");
	await page.waitForFunction(
		(expected) => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return (
				target?.dataset.blueprintPlacementPending === "false" &&
				target.dataset.blueprintPlacementResult === "cancelled" &&
				Number(target.dataset.modelGeneration) === expected.generation &&
				Number(target.dataset.physicalPaths) === expected.paths
			);
		},
		{ generation: generationBeforePlacement + 2, paths: pathsBeforePlacement },
		{ timeout: readyTimeoutMilliseconds },
	);
	const afterPendingUndo = await readCanvasMetrics(page);
	const pendingUndoPreservedHistory =
		afterPendingUndo.modelGeneration === afterUndo.modelGeneration &&
		afterPendingUndo.physicalPaths === afterUndo.physicalPaths;
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	await canvas.press("Escape");
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	await clickActivityCommand(page, "equip", "OHB 포트 배치");
	await page.waitForFunction(
		(previousBindings) => {
			const target = document.querySelector('[data-testid="rail-canvas"]');
			return Number(target?.dataset.portSlotPreparedArtifactBindings) > previousBindings;
		},
		Number(before.portSlotPreparedArtifactBindings),
		{ timeout: readyTimeoutMilliseconds },
	);
	const cancelledMetrics = await readCanvasMetrics(page);
	const cancelled = !(await page.getByText("MULTI-PLACE ON", { exact: true }).isVisible());
	return {
		skipped: false,
		selectMilliseconds: selectedAt - startedAt,
		copyMilliseconds: copiedAt - selectedAt,
		active,
		activeAfterEscape: !cancelled,
		selectedCells,
		validationLevel: preview.draftPreviewValidation,
		validationAfterEscape: cancelledMetrics.draftPreviewValidation,
		ghostCompileDelta: Number(preview.ghostCompiles) - Number(before.ghostCompiles),
		interactionSampleDelta: Number(preview.interactionSamples) - Number(before.interactionSamples),
		modelGenerationStable: preview.modelGeneration === before.modelGeneration,
		modelGenerationAfterEscape: cancelledMetrics.modelGeneration,
		modelGenerationBefore: before.modelGeneration,
		pendingObserved,
		placementResult,
		clickDispatchMilliseconds,
		placementReadyMilliseconds,
		workerPlanningMilliseconds,
		workerValidationMilliseconds,
		undoRestored,
		pendingUndoObserved,
		pendingUndoPreservedHistory,
		cancelled:
			cancelled &&
			cancelledMetrics.draftPreviewValidation === undefined &&
			Number(cancelledMetrics.modelGeneration) === Number(before.modelGeneration) + 2,
	};
}

async function exercisePatternPreview(page) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no pattern-preview interaction bounds.");
	await clickActivityCommand(page, "build", "레일 건설");
	const patternToggle = page.getByTestId("rail-pattern-browser-toggle");
	if ((await patternToggle.getAttribute("aria-pressed")) !== "true") await patternToggle.click();
	const advancedMotifs = page.locator("details.tilefab-assemble-advanced");
	await advancedMotifs.waitFor({ state: "visible" });
	if ((await advancedMotifs.getAttribute("open")) === null) {
		await advancedMotifs.locator("summary").click();
	}
	await page.getByTestId("rail-template-long-bay").waitFor({ state: "visible" });
	await page.getByTestId("rail-template-long-bay").click();

	const centerX = box.x + box.width / 2;
	const centerY = box.y + box.height / 2;
	await page.mouse.move(centerX, centerY);
	await canvas.evaluate(
		(element) =>
			new Promise((resolve) => {
				let previous = element.dataset.staticRedraws;
				let stableFrames = 0;
				const sample = () => {
					const next = element.dataset.staticRedraws;
					stableFrames = next === previous ? stableFrames + 1 : 0;
					previous = next;
					if (stableFrames >= 4) resolve();
					else requestAnimationFrame(sample);
				};
				requestAnimationFrame(sample);
			}),
	);
	const before = await readCanvasMetrics(page);
	for (let index = 0; index < 120; index++) {
		await page.mouse.move(centerX - 180 + (index % 30) * 12, centerY - 90 + (index % 11) * 9);
	}
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	const preview = await readCanvasMetrics(page);
	const accessibilityLinked = await page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const panel = document.querySelector('[data-testid="template-placement-feedback"]');
		const announcement = panel?.querySelector('[aria-live="polite"]');
		return (
			canvas?.getAttribute("aria-describedby") === panel?.id &&
			panel?.getAttribute("aria-label") === "패턴 배치 판정" &&
			/ENTRY|EXIT|ORIGIN/.test(announcement?.textContent ?? "") &&
			(announcement?.textContent ?? "").includes("Reserved")
		);
	});
	await canvas.press("Escape");
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
	const cancelled = await readCanvasMetrics(page);
	const accessibilityCleared = await page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const panel = document.querySelector('[data-testid="template-placement-feedback"]');
		const announcement = panel?.querySelector('[aria-live="polite"]');
		return (
			canvas?.hasAttribute("aria-describedby") === false &&
			panel?.hidden === true &&
			(panel?.querySelector("strong")?.textContent ?? "") === "" &&
			(panel?.querySelector("p")?.textContent ?? "") === "" &&
			Array.from(panel?.querySelectorAll("dd") ?? []).every(
				(element) => element.textContent === "",
			) &&
			(announcement?.textContent ?? "") === "" &&
			announcement?.hasAttribute("data-key") === false
		);
	});

	return {
		staticStable: preview.staticRedraws === before.staticRedraws,
		staticRedrawsBefore: Number(before.staticRedraws),
		staticRedrawsAfter: Number(preview.staticRedraws),
		staticRedrawDelta: Number(preview.staticRedraws) - Number(before.staticRedraws),
		telemetryPresent:
			preview.templateFeedbackCode !== "" &&
			preview.templateFeedbackState !== "" &&
			Number(preview.templateReserved) > 0 &&
			Number(preview.templateHandles) > 0,
		accessibilityLinked,
		cancelCleared:
			cancelled.templateValid === undefined &&
			cancelled.templatePlanValid === undefined &&
			cancelled.templatePlacementCode === undefined &&
			cancelled.templateFeedbackCode === undefined &&
			cancelled.templateFeedbackState === undefined &&
			cancelled.templateOccupied === undefined &&
			cancelled.templateReserved === undefined &&
			cancelled.templateReservedBounds === undefined &&
			cancelled.templateHandles === undefined &&
			cancelled.templateConflicts === undefined &&
			cancelled.templateTopology === undefined &&
			cancelled.templateGeometry === undefined &&
			accessibilityCleared,
		feedbackCode: preview.templateFeedbackCode,
		feedbackState: preview.templateFeedbackState,
		ghostCompileDelta: Number(preview.ghostCompiles) - Number(before.ghostCompiles),
		interactionSampleDelta: Number(preview.interactionSamples) - Number(before.interactionSamples),
	};
}

async function exerciseOhbRowWorkflow(
	page,
	initialGeneration,
	physicalPathCount,
	readyTimeoutMilliseconds,
) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no OHB interaction bounds.");
	const browserTimeline = {
		startedAt: await page.evaluate(() => performance.now()),
	};
	await clickActivityCommand(page, "equip", "OHB 포트 배치");
	await page.waitForFunction(
		() => {
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(railCanvas?.dataset.portSlotPreparedArtifactBindings) > 0 &&
				Number(railCanvas.dataset.portSlotCount) > 0
			);
		},
		undefined,
		{ timeout: readyTimeoutMilliseconds },
	);
	browserTimeline.toolReadyAt = await page.evaluate(() => performance.now());
	const before = await readCanvasMetrics(page);
	const initialSequence = Number(before.workerSequence);
	const initialFingerprint = before.workerPhysicalFingerprint;
	const initialBinding = before.portSlotPreparedArtifactBindings;
	const cameraOffsetX = numberMetric(before, "cameraOffsetX");
	const cameraOffsetY = numberMetric(before, "cameraOffsetY");
	const zoom = numberMetric(before, "cameraZoom");
	if (before.cameraRotation !== "0")
		throw new Error("OHB scale workflow requires top-view rotation 0.");
	const start = {
		x: box.x + cameraOffsetX + zoom * 2.5,
		y: box.y + cameraOffsetY + zoom * 1.2,
	};
	const end = {
		x: box.x + cameraOffsetX + zoom * 7.5,
		y: start.y,
	};

	await page.mouse.move(start.x, start.y);
	browserTimeline.anchorHoveredAt = await page.evaluate(() => performance.now());
	await page.mouse.down();
	browserTimeline.pointerDownAt = await page.evaluate(() => performance.now());
	await page.mouse.move(end.x, end.y, { steps: 12 });
	browserTimeline.dragMovedAt = await page.evaluate(() => performance.now());
	await page.mouse.up();
	browserTimeline.commitDispatchedAt = await page.evaluate(() => performance.now());
	await waitForStaticGeneration(
		page,
		initialGeneration + 1,
		physicalPathCount,
		initialSequence + 1,
		6,
		readyTimeoutMilliseconds,
	);
	browserTimeline.commitReadyAt = await page.evaluate(() => performance.now());
	const committed = await readCanvasMetrics(page);

	await page.keyboard.press("Control+z");
	browserTimeline.undoDispatchedAt = await page.evaluate(() => performance.now());
	await waitForStaticGeneration(
		page,
		initialGeneration + 2,
		physicalPathCount,
		initialSequence + 2,
		0,
		readyTimeoutMilliseconds,
	);
	browserTimeline.undoReadyAt = await page.evaluate(() => performance.now());
	const undone = await readCanvasMetrics(page);

	await page.keyboard.press("Control+Shift+z");
	browserTimeline.redoDispatchedAt = await page.evaluate(() => performance.now());
	await waitForStaticGeneration(
		page,
		initialGeneration + 3,
		physicalPathCount,
		initialSequence + 3,
		6,
		readyTimeoutMilliseconds,
	);
	browserTimeline.redoReadyAt = await page.evaluate(() => performance.now());
	const redone = await readCanvasMetrics(page);
	const cancelStart = {
		x: box.x + cameraOffsetX + zoom * 9.5,
		y: start.y,
	};
	const cancelEnd = {
		x: box.x + cameraOffsetX + zoom * 11.5,
		y: start.y,
	};
	await page.mouse.move(cancelStart.x, cancelStart.y);
	await page.mouse.down();
	await page.mouse.move(cancelEnd.x, cancelEnd.y, { steps: 6 });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await page.waitForFunction(
		([expectedGeneration, expectedSequence]) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(canvas?.dataset.modelGeneration) === expectedGeneration &&
				Number(canvas.dataset.workerSequence) === expectedSequence &&
				Number(canvas.dataset.portAvailabilityPorts) === 6 &&
				Number(canvas.dataset.ohbDraftRows) === 0 &&
				canvas.dataset.workerStatus === "ready"
			);
		},
		[initialGeneration + 3, initialSequence + 3],
		{ timeout: readyTimeoutMilliseconds },
	);
	const cancelled = await readCanvasMetrics(page);
	return {
		committedPortCount: Number(committed.portAvailabilityPorts),
		undoPortCount: Number(undone.portAvailabilityPorts),
		redoPortCount: Number(redone.portAvailabilityPorts),
		sequenceDelta: Number(redone.workerSequence) - initialSequence,
		cancelStable:
			cancelled.modelGeneration === redone.modelGeneration &&
			cancelled.workerSequence === redone.workerSequence &&
			cancelled.workerChecksum === redone.workerChecksum &&
			cancelled.portAvailabilityPorts === redone.portAvailabilityPorts &&
			cancelled.ohbDraftRows === "0",
		slotBindings: [
			initialBinding,
			committed.portSlotPreparedArtifactBindings,
			undone.portSlotPreparedArtifactBindings,
			redone.portSlotPreparedArtifactBindings,
		],
		physicalStable:
			committed.workerPhysicalFingerprint === initialFingerprint &&
			undone.workerPhysicalFingerprint === initialFingerprint &&
			redone.workerPhysicalFingerprint === initialFingerprint,
		slotBindingStable:
			committed.portSlotPreparedArtifactBindings === initialBinding &&
			undone.portSlotPreparedArtifactBindings === initialBinding &&
			redone.portSlotPreparedArtifactBindings === initialBinding,
		derivationStable:
			committed.modelDerivationWorkerMs === before.modelDerivationWorkerMs &&
			undone.modelDerivationWorkerMs === before.modelDerivationWorkerMs &&
			redone.modelDerivationWorkerMs === before.modelDerivationWorkerMs,
		browserTimeline,
	};
}

async function exerciseEqMembershipWorkflow(
	page,
	initialGeneration,
	physicalPathCount,
	existingPortCount,
	readyTimeoutMilliseconds,
	onFixtureReady,
) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no EQ membership interaction bounds.");
	const browserTimeline = {
		startedAt: await page.evaluate(() => performance.now()),
	};
	await clickActivityCommand(page, "equip", "EQ 포트 행 배치");
	await canvas.focus();
	await page.waitForFunction(
		() => {
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(railCanvas?.dataset.portSlotPreparedArtifactBindings) > 0 &&
				Number(railCanvas.dataset.portSlotCount) > 0
			);
		},
		undefined,
		{ timeout: readyTimeoutMilliseconds },
	);
	browserTimeline.toolReadyAt = await page.evaluate(() => performance.now());
	const beforePlacement = await readCanvasMetrics(page);
	const initialSequence = Number(beforePlacement.workerSequence);
	const initialFingerprint = beforePlacement.workerPhysicalFingerprint;
	const cameraOffsetX = numberMetric(beforePlacement, "cameraOffsetX");
	const cameraOffsetY = numberMetric(beforePlacement, "cameraOffsetY");
	const zoom = numberMetric(beforePlacement, "cameraZoom");
	if (beforePlacement.cameraRotation !== "0")
		throw new Error("EQ membership scale workflow requires top-view rotation 0.");
	const start = {
		x: box.x + cameraOffsetX + zoom * 8.5,
		y: box.y + cameraOffsetY + zoom * 0.5,
	};
	const end = {
		x: box.x + cameraOffsetX + zoom * 10.5,
		y: start.y,
	};

	await page.mouse.move(start.x, start.y);
	browserTimeline.anchorHoveredAt = await page.evaluate(() => performance.now());
	await page.mouse.down();
	browserTimeline.pointerDownAt = await page.evaluate(() => performance.now());
	await page.mouse.move(end.x, end.y, { steps: 8 });
	browserTimeline.dragMovedAt = await page.evaluate(() => performance.now());
	await page.mouse.up();
	browserTimeline.fixtureDispatchedAt = await page.evaluate(() => performance.now());
	await waitForStaticEquipmentGeneration(
		page,
		initialGeneration + 1,
		physicalPathCount,
		initialSequence + 1,
		existingPortCount + 3,
		readyTimeoutMilliseconds,
	);
	browserTimeline.fixtureReadyAt = await page.evaluate(() => performance.now());
	const placed = await readCanvasMetrics(page);
	const initialBinding = placed.portSlotPreparedArtifactBindings;
	const initialDerivationMilliseconds = placed.modelDerivationWorkerMs;
	await onFixtureReady();

	const editMembership = page.getByTestId("edit-port-equipment-membership");
	await editMembership.click();
	await page.waitForFunction(
		() => {
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				railCanvas?.dataset.portMembershipActive === "true" &&
				railCanvas.dataset.portMembershipType === "EQ" &&
				Number(railCanvas.dataset.portMembershipSourceRows) === 3 &&
				Number(railCanvas.dataset.portMembershipDraftRows) === 3
			);
		},
		undefined,
		{ timeout: readyTimeoutMilliseconds },
	);
	await canvas.focus();
	const inputPaintMaxima = [];
	let inputOrdinal = 0;
	const recordMembershipInput = async (key) => {
		const sample = await pressMembershipKeyAndWaitForPaint(page, key, readyTimeoutMilliseconds);
		inputOrdinal++;
		if (sample.newMaximum) inputPaintMaxima.push({ ...sample, ordinal: inputOrdinal });
	};
	await recordMembershipInput("e");
	let expansionInputCount = 0;
	for (let index = 0; index < 70; index++) {
		const draftRows = Number(await canvas.getAttribute("data-port-membership-draft-rows"));
		if (draftRows === 64) break;
		await recordMembershipInput("ArrowRight");
		expansionInputCount++;
	}
	await page.waitForFunction(
		() => {
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return Number(railCanvas?.dataset.portMembershipDraftRows) === 64;
		},
		undefined,
		{ timeout: readyTimeoutMilliseconds },
	);
	const maximum = await readCanvasMetrics(page);
	await recordMembershipInput("ArrowRight");
	const rejected = await readCanvasMetrics(page);
	const maximumMemberCountRejected =
		maximum.portMembershipDraftRows === "64" &&
		rejected.portMembershipDraftRows === "64" &&
		rejected.portMembershipKeyboardRow === maximum.portMembershipKeyboardRow &&
		Number(rejected.portMembershipMaximumRejectedCount) ===
			Number(maximum.portMembershipMaximumRejectedCount) + 1;

	const commitStartedAt = await page.evaluate(() => performance.now());
	await recordMembershipInput("Enter");
	await waitForStaticEquipmentGeneration(
		page,
		initialGeneration + 2,
		physicalPathCount,
		initialSequence + 2,
		existingPortCount + 64,
		readyTimeoutMilliseconds,
	);
	const commitReadyMilliseconds = await page.evaluate(
		(startedAt) => performance.now() - startedAt,
		commitStartedAt,
	);
	const expectedInputPaintCount = expansionInputCount + 3;
	const expectedSearchCount = expansionInputCount + 1;
	await page.waitForFunction(
		(expectedPaintCount) => {
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(railCanvas?.dataset.portMembershipInputPaintCount) >= expectedPaintCount &&
				Number(railCanvas.dataset.portMembershipPlanCount) === 1 &&
				Number(railCanvas.dataset.portMembershipCommitDispatchCount) === 1
			);
		},
		expectedInputPaintCount,
		{ timeout: readyTimeoutMilliseconds },
	);
	const committed = await readCanvasMetrics(page);

	await page.keyboard.press("Control+z");
	await waitForStaticEquipmentGeneration(
		page,
		initialGeneration + 3,
		physicalPathCount,
		initialSequence + 3,
		existingPortCount + 3,
		readyTimeoutMilliseconds,
	);
	const undone = await readCanvasMetrics(page);

	await page.keyboard.press("Control+Shift+z");
	await waitForStaticEquipmentGeneration(
		page,
		initialGeneration + 4,
		physicalPathCount,
		initialSequence + 4,
		existingPortCount + 64,
		readyTimeoutMilliseconds,
	);
	const redone = await readCanvasMetrics(page);

	return {
		generationDelta: 4,
		committedPortCount: Number(committed.equipmentPorts),
		undoPortCount: Number(undone.equipmentPorts),
		redoPortCount: Number(redone.equipmentPorts),
		sequenceDelta: Number(redone.workerSequence) - initialSequence,
		maximumMemberCountRejected,
		candidateRowsMax: numberMetric(rejected, "portMembershipCandidateRowsMax"),
		queryCount: numberMetric(rejected, "portMembershipQueryCount"),
		searchCount: numberMetric(rejected, "portMembershipSearchCount"),
		searchRadiusMax: numberMetric(rejected, "portMembershipSearchRadiusMax"),
		searchStepsMax: numberMetric(rejected, "portMembershipSearchStepsMax"),
		maximumRejectedCount: numberMetric(rejected, "portMembershipMaximumRejectedCount"),
		expectedInputPaintCount,
		expectedSearchCount,
		interactionCount: numberMetric(rejected, "portMembershipInteractionCount"),
		interactionMaxMilliseconds: numberMetric(rejected, "portMembershipInteractionMaxMs"),
		planMaxMilliseconds: numberMetric(committed, "portMembershipPlanMaxMs"),
		planCount: numberMetric(committed, "portMembershipPlanCount"),
		inputPaintCount: numberMetric(committed, "portMembershipInputPaintCount"),
		inputPaintMaxMilliseconds: numberMetric(committed, "portMembershipInputPaintMaxMs"),
		inputPaintMaxima,
		commitDispatchCount: numberMetric(committed, "portMembershipCommitDispatchCount"),
		commitDispatchMaxMilliseconds: numberMetric(committed, "portMembershipCommitDispatchMaxMs"),
		commitReadyMilliseconds,
		browserTimeline,
		physicalStable:
			placed.workerPhysicalFingerprint === initialFingerprint &&
			committed.workerPhysicalFingerprint === initialFingerprint &&
			undone.workerPhysicalFingerprint === initialFingerprint &&
			redone.workerPhysicalFingerprint === initialFingerprint,
		slotBindingStable:
			committed.portSlotPreparedArtifactBindings === initialBinding &&
			undone.portSlotPreparedArtifactBindings === initialBinding &&
			redone.portSlotPreparedArtifactBindings === initialBinding,
		derivationStable:
			committed.modelDerivationWorkerMs === initialDerivationMilliseconds &&
			undone.modelDerivationWorkerMs === initialDerivationMilliseconds &&
			redone.modelDerivationWorkerMs === initialDerivationMilliseconds,
	};
}

async function pressMembershipKeyAndWaitForPaint(page, key, timeoutMilliseconds) {
	const canvas = page.getByTestId("rail-canvas");
	const before = await canvas.evaluate((element) => ({
		count: Number(element.dataset.portMembershipInputPaintCount ?? 0),
		maximumMilliseconds: Number(element.dataset.portMembershipInputPaintMaxMs ?? 0),
	}));
	await page.keyboard.press(key);
	await page.waitForFunction(
		(previous) => {
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return Number(railCanvas?.dataset.portMembershipInputPaintCount) > Number(previous);
		},
		String(before.count),
		{ timeout: timeoutMilliseconds },
	);
	return canvas.evaluate(
		(element, { key: inputKey, previousMaximum }) => {
			const maximumMilliseconds = Number(element.dataset.portMembershipInputPaintMaxMs ?? 0);
			return {
				key: inputKey,
				lastMilliseconds: Number(element.dataset.portMembershipInputPaintLastMs ?? 0),
				maximumMilliseconds,
				newMaximum: maximumMilliseconds > previousMaximum,
			};
		},
		{ key, previousMaximum: before.maximumMilliseconds },
	);
}

async function exerciseCommitWorkflow(
	page,
	initialGeneration,
	initialPathCount,
	readyTimeoutMilliseconds,
) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no commit interaction bounds.");
	const constructionPoints = await page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const api = globalThis.__tileFab;
		const rect = canvas?.getBoundingClientRect();
		if (!rect || !api?.renderer || !api.camera || !api.getDocument().map.getRail(0, 0)) return null;
		const start = api.renderer.tileCenterAtScreen({ x: 0, y: 0 }, api.camera);
		const end = api.renderer.tileCenterAtScreen({ x: -5, y: 0 }, api.camera);
		return {
			start: { x: rect.left + start.x, y: rect.top + start.y },
			end: { x: rect.left + end.x, y: rect.top + end.y },
		};
	});
	if (!constructionPoints) throw new Error("Scale commit route endpoints are unavailable.");
	const dispatchMilliseconds = [];
	const readyMilliseconds = [];

	await clickActivityCommand(page, "build", "레일 건설");
	const closePatternBrowser = page.getByRole("button", { name: "패턴 패널 닫기" });
	if (await closePatternBrowser.isVisible()) await closePatternBrowser.click();
	await canvas.focus();
	await page.mouse.click(constructionPoints.start.x, constructionPoints.start.y);
	await page.mouse.move(constructionPoints.end.x, constructionPoints.end.y);
	let startedAt = performance.now();
	await page.mouse.click(constructionPoints.end.x, constructionPoints.end.y);
	dispatchMilliseconds.push(performance.now() - startedAt);
	startedAt = performance.now();
	await waitForDerivedGeneration(
		page,
		initialGeneration + 1,
		initialPathCount + 5,
		readyTimeoutMilliseconds,
	);
	readyMilliseconds.push(performance.now() - startedAt);

	startedAt = performance.now();
	await page.keyboard.press("Control+z");
	dispatchMilliseconds.push(performance.now() - startedAt);
	startedAt = performance.now();
	await waitForDerivedGeneration(
		page,
		initialGeneration + 2,
		initialPathCount,
		readyTimeoutMilliseconds,
	);
	readyMilliseconds.push(performance.now() - startedAt);

	startedAt = performance.now();
	await page.keyboard.press("Control+Shift+z");
	dispatchMilliseconds.push(performance.now() - startedAt);
	startedAt = performance.now();
	await waitForDerivedGeneration(
		page,
		initialGeneration + 3,
		initialPathCount + 5,
		readyTimeoutMilliseconds,
	);
	readyMilliseconds.push(performance.now() - startedAt);

	return {
		dispatchMilliseconds,
		readyMilliseconds,
		maxDispatchMilliseconds: Math.max(...dispatchMilliseconds),
		maxReadyMilliseconds: Math.max(...readyMilliseconds),
	};
}

async function exerciseArrangementSessionWorkflow(page, readyTimeoutMilliseconds) {
	const canvas = page.getByTestId("rail-canvas");
	const before = await readCanvasMetrics(page);
	const selectionBaseline = await page.evaluate(() => ({
		count: globalThis.__openFabScale?.longTasks.length ?? 0,
		at: performance.now(),
	}));
	const selectionPoints = await page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const api = globalThis.__tileFab;
		const rect = canvas?.getBoundingClientRect();
		if (!rect || !api?.renderer || !api.camera) return null;
		const start = api.renderer.worldToScreen({ x: -0.5, y: -0.5 }, api.camera);
		const end = api.renderer.worldToScreen({ x: 7.5, y: 5.5 }, api.camera);
		return {
			start: { x: rect.left + start.x, y: rect.top + start.y },
			end: { x: rect.left + end.x, y: rect.top + end.y },
		};
	});
	if (!selectionPoints) throw new Error("Arrangement probe selection bounds are unavailable.");
	await canvas.focus();
	await page.mouse.move(selectionPoints.start.x, selectionPoints.start.y);
	await page.keyboard.down("Shift");
	await page.mouse.down();
	await page.mouse.move(selectionPoints.end.x, selectionPoints.end.y, { steps: 8 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	const inspector = page.getByTestId("rail-area-selection-inspector");
	await inspector.waitFor({ state: "visible", timeout: readyTimeoutMilliseconds });
	const selectedModules = Number(await inspector.getAttribute("data-module-count"));
	const selectionMeasurement = await page.evaluate(
		(startIndex) => ({
			at: performance.now(),
			longTasks: (globalThis.__openFabScale?.longTasks ?? []).slice(startIndex),
			arrangementLongTaskStart: globalThis.__openFabScale?.longTasks.length ?? 0,
		}),
		selectionBaseline.count,
	);

	const startedAt = performance.now();
	await page.keyboard.press("l");
	const startDispatchMilliseconds = performance.now() - startedAt;
	const dispatchedAt = await page.evaluate(() => performance.now());
	await page.waitForFunction(
		() => {
			const dataset = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
			return (
				dataset?.staticFabArrangementActive === "true" &&
				dataset.staticFabArrangementPhase !== "planning" &&
				Number(dataset.staticFabArrangementSourcePlanIndex) >= 1
			);
		},
		undefined,
		{ timeout: readyTimeoutMilliseconds },
	);
	const initialReadyMilliseconds = performance.now() - startedAt;
	const initial = await readCanvasMetrics(page);
	const initialReadyAt = await page.evaluate(() => performance.now());
	const initialPlanIndex = Number(initial.staticFabArrangementSourcePlanIndex);
	const optionStartedAt = performance.now();
	await page.keyboard.press("x");
	await page.keyboard.press("3");
	await page.waitForFunction(
		(expectedPlanIndex) => {
			const dataset = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
			return (
				dataset?.staticFabArrangementActive === "true" &&
				dataset.staticFabArrangementPhase !== "planning" &&
				dataset.staticFabArrangementAxis === "X" &&
				dataset.staticFabArrangementMode === "ALIGN_MAX" &&
				Number(dataset.staticFabArrangementSourcePlanIndex) >= expectedPlanIndex
			);
		},
		initialPlanIndex + 1,
		{ timeout: readyTimeoutMilliseconds },
	);
	const optionReadyMilliseconds = performance.now() - optionStartedAt;
	const changed = await readCanvasMetrics(page);
	const optionReadyAt = await page.evaluate(() => performance.now());
	const changedPlanIndex = Number(changed.staticFabArrangementSourcePlanIndex);
	const rootCount = Number(changed.staticFabArrangementRoots);

	await canvas.focus();
	await page.keyboard.press("Escape");
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.staticFabArrangementActive ===
			"false",
		undefined,
		{ timeout: readyTimeoutMilliseconds },
	);
	await canvas.focus();
	await page.keyboard.press("Escape");
	const after = await readCanvasMetrics(page);
	const longTaskEntries = await page.evaluate(
		(startIndex) => (globalThis.__openFabScale?.longTasks ?? []).slice(startIndex),
		selectionMeasurement.arrangementLongTaskStart,
	);

	return {
		selectedModules,
		rootCount,
		sourcePlanIndexes: [initialPlanIndex, changedPlanIndex],
		sessionHydrationMilliseconds: Number(initial.staticFabArrangementSessionHydrationMs),
		sessionCompilationMilliseconds: Number(initial.staticFabArrangementSessionCompilationMs),
		sessionTelemetryStable:
			changed.staticFabArrangementSessionHydrationMs ===
				initial.staticFabArrangementSessionHydrationMs &&
			changed.staticFabArrangementSessionCompilationMs ===
				initial.staticFabArrangementSessionCompilationMs,
		authoredStateStable:
			after.modelGeneration === before.modelGeneration &&
			after.workerSequence === before.workerSequence &&
			after.workerChecksum === before.workerChecksum &&
			after.physicalPaths === before.physicalPaths,
		cancelled: after.staticFabArrangementActive === "false",
		longTaskDelta: longTaskEntries.length,
		longTaskEntries,
		selectionLongTaskEntries: selectionMeasurement.longTasks,
		selectionMilliseconds: selectionMeasurement.at - selectionBaseline.at,
		browserTimeline: {
			selectionStartedAt: selectionBaseline.at,
			selectedAt: selectionMeasurement.at,
			dispatchedAt,
			initialReadyAt,
			optionReadyAt,
		},
		startDispatchMilliseconds,
		initialReadyMilliseconds,
		optionReadyMilliseconds,
		initialPhase: initial.staticFabArrangementPhase,
		changedPhase: changed.staticFabArrangementPhase,
	};
}

async function exerciseArrangementScalePage(
	context,
	cellCount,
	readyTimeoutMilliseconds,
	consoleErrors,
	pageErrors,
) {
	const page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	try {
		const startedAt = performance.now();
		await page.goto(`${baseUrl}/?scaleFixture=${cellCount}&scaleRoots=3`, {
			waitUntil: "domcontentloaded",
			timeout: readyTimeoutMilliseconds,
		});
		await page.waitForFunction(
			(expectedCount) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.startupStatus === "ready" &&
					canvas.dataset.workerStatus === "ready" &&
					Number(canvas.dataset.physicalPaths) === expectedCount
				);
			},
			cellCount,
			{ timeout: readyTimeoutMilliseconds },
		);
		const pageReadyMilliseconds = performance.now() - startedAt;
		const metrics = await readCanvasMetrics(page);
		if (metrics.scaleAcceptanceVersion !== String(RAIL_SCALE_ACCEPTANCE_VERSION)) {
			throw new Error("Arrangement scale page uses a stale acceptance contract.");
		}
		const workflow = await exerciseArrangementSessionWorkflow(page, readyTimeoutMilliseconds);
		const pageLongTasks = await page.evaluate(
			() => globalThis.__openFabScale?.longTasks.length ?? 0,
		);
		return { ...workflow, pageReadyMilliseconds, pageLongTasks };
	} finally {
		await closeBrowserResource(page, `${cellCount.toLocaleString()}-cell arrangement page`);
	}
}

async function waitForDerivedGeneration(page, generation, physicalPathCount, timeout) {
	await page.waitForFunction(
		([expectedGeneration, expectedPaths]) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(canvas?.dataset.modelGeneration) === expectedGeneration &&
				Number(canvas.dataset.physicalPaths) === expectedPaths &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				canvas.dataset.modelDerivationStatus === "idle"
			);
		},
		[generation, physicalPathCount],
		{ timeout },
	);
}

async function waitForStaticGeneration(
	page,
	generation,
	physicalPathCount,
	workerSequence,
	portCount,
	timeout,
) {
	await page.waitForFunction(
		([expectedGeneration, expectedPaths, expectedSequence, expectedPorts]) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(canvas?.dataset.modelGeneration) === expectedGeneration &&
				Number(canvas.dataset.physicalPaths) === expectedPaths &&
				Number(canvas.dataset.workerSequence) === expectedSequence &&
				Number(canvas.dataset.portAvailabilityPorts) === expectedPorts &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false"
			);
		},
		[generation, physicalPathCount, workerSequence, portCount],
		{ timeout },
	);
}

async function waitForStaticEquipmentGeneration(
	page,
	generation,
	physicalPathCount,
	workerSequence,
	portCount,
	timeout,
) {
	await page.waitForFunction(
		([expectedGeneration, expectedPaths, expectedSequence, expectedPorts]) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				Number(canvas?.dataset.modelGeneration) === expectedGeneration &&
				Number(canvas.dataset.physicalPaths) === expectedPaths &&
				Number(canvas.dataset.workerSequence) === expectedSequence &&
				Number(app?.dataset.equipmentPorts) === expectedPorts &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false"
			);
		},
		[generation, physicalPathCount, workerSequence, portCount],
		{ timeout },
	);
}

async function activateEditorActivity(page, activity) {
	if (!["build", "assemble", "equip", "inspect"].includes(activity)) {
		throw new Error(`Unknown editor activity: ${String(activity)}.`);
	}
	const app = page.getByTestId("tilefab-app");
	const button = page.getByTestId(`editor-activity-${activity}`);
	await button.waitFor({ state: "visible" });
	if (await button.isDisabled()) {
		throw new Error(
			`Editor activity ${activity} is unavailable: ${(await button.getAttribute("title")) ?? "no reason"}.`,
		);
	}
	if ((await app.getAttribute("data-editor-activity")) !== activity) await button.click();
	await page.waitForFunction(
		(expectedActivity) =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-editor-activity") === expectedActivity,
		activity,
		{ timeout: 10_000 },
	);
	if ((await button.getAttribute("aria-pressed")) !== "true") {
		throw new Error(`Editor activity ${activity} did not publish its pressed state.`);
	}
	return button;
}

async function activityCommandButton(page, activity, accessibleName) {
	await activateEditorActivity(page, activity);
	const command = page.getByRole("button", { name: accessibleName, exact: true });
	await command.waitFor({ state: "visible" });
	return command;
}

async function clickActivityCommand(page, activity, accessibleName) {
	const command = await activityCommandButton(page, activity, accessibleName);
	await command.click();
	await page.waitForFunction(
		(expectedActivity) =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-editor-activity") === expectedActivity,
		activity,
		{ timeout: 10_000 },
	);
	return command;
}

async function readCanvasMetrics(page) {
	return page.getByTestId("rail-canvas").evaluate((canvas) => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		return {
			...canvas.dataset,
			equipmentGroups: app?.dataset.equipmentGroups ?? "",
			equipmentPorts: app?.dataset.equipmentPorts ?? "",
		};
	});
}

function cacheCounters(metrics) {
	return {
		physicalBindings: metrics.physicalBindings,
		physicalPresentationBuilds: metrics.physicalPresentationBuilds,
		physicalPreparedArtifactBindings: metrics.physicalPreparedArtifactBindings,
		portSlotPreparedArtifactBindings: metrics.portSlotPreparedArtifactBindings,
		draftCommittedIndexBuilds: metrics.draftCommittedIndexBuilds,
		draftCommittedPreparedBindings: metrics.draftCommittedPreparedBindings,
	};
}

function numberMetric(metrics, name) {
	const value = Number(metrics[name]);
	if (!Number.isFinite(value)) throw new Error(`Metric ${name} is missing or non-finite.`);
	return value;
}

function heapUsageGrowth(before, after) {
	return {
		usedSize: Math.max(0, heapUsageMetric(after, "usedSize") - heapUsageMetric(before, "usedSize")),
		embedderHeapUsedSize: Math.max(
			0,
			heapUsageMetric(after, "embedderHeapUsedSize") -
				heapUsageMetric(before, "embedderHeapUsedSize"),
		),
		backingStorageSize: Math.max(
			0,
			heapUsageMetric(after, "backingStorageSize") - heapUsageMetric(before, "backingStorageSize"),
		),
	};
}

function heapUsageDelta(before, after) {
	return {
		usedSize: heapUsageMetric(after, "usedSize") - heapUsageMetric(before, "usedSize"),
		embedderHeapUsedSize:
			heapUsageMetric(after, "embedderHeapUsedSize") -
			heapUsageMetric(before, "embedderHeapUsedSize"),
		backingStorageSize:
			heapUsageMetric(after, "backingStorageSize") - heapUsageMetric(before, "backingStorageSize"),
	};
}

function heapUsageMetric(metrics, name) {
	const value = Number(metrics[name]);
	if (!Number.isFinite(value)) throw new Error(`Heap metric ${name} is missing or non-finite.`);
	return value;
}

function assertEqual(failures, actual, expected, label) {
	if (actual !== expected)
		failures.push(`${label}: expected ${String(expected)}, received ${String(actual)}`);
}

function assertAtMost(failures, actual, maximum, label) {
	if (!(actual <= maximum)) failures.push(`${label}: ${actual} exceeds ${maximum}`);
}

function assertAtLeast(failures, actual, minimum, label) {
	if (!(actual >= minimum)) failures.push(`${label}: ${actual} is below ${minimum}`);
}

function assertExactSnapshotTransfer(failures, transfer, maximumBytes, label) {
	assertAtLeast(failures, transfer.totalBytes, 1, `${label} transfer bytes`);
	assertAtMost(failures, transfer.totalBytes, maximumBytes, `${label} bounded transfer bytes`);
	assertEqual(
		failures,
		transfer.transferCount,
		transfer.arrayBufferCount,
		`${label} transfer ArrayBuffer-only contract`,
	);
	assertEqual(
		failures,
		transfer.uniqueCount,
		transfer.transferCount,
		`${label} unique transfer buffers`,
	);
	assertAtLeast(
		failures,
		transfer.positiveBufferCount,
		1,
		`${label} observably detachable buffers`,
	);
	assertEqual(failures, transfer.duplicateCount, 0, `${label} duplicate transfers`);
	assertEqual(failures, transfer.allArrayBuffers, true, `${label} transfer kinds`);
	assertEqual(failures, transfer.exactTransferSet, true, `${label} exact snapshot transfer set`);
	assertEqual(
		failures,
		transfer.snapshotBufferCount,
		transfer.transferCount,
		`${label} snapshot buffer coverage`,
	);
	assertEqual(
		failures,
		transfer.snapshotBufferBytes,
		transfer.totalBytes,
		`${label} snapshot byte coverage`,
	);
	assertEqual(failures, transfer.allDetached, true, `${label} transferred buffer detachment`);
	assertEqual(
		failures,
		transfer.detachedCount,
		transfer.transferCount,
		`${label} detached buffer count`,
	);
	assertEqual(
		failures,
		transfer.observableAllDetached,
		true,
		`${label} observable transferred buffer detachment`,
	);
	assertEqual(
		failures,
		transfer.observablyDetachedCount,
		transfer.positiveBufferCount,
		`${label} observably detached buffer count`,
	);
}

function parseRequestedCounts(value) {
	if (!value) return [10_000, 50_000];
	const counts = value.split(",").map((entry) => Number(entry.trim()));
	if (counts.length === 0 || counts.some((count) => !RAIL_SCALE_BUDGETS[count])) {
		throw new Error(
			`OPENFAB_SCALE_COUNTS must contain only ${Object.keys(RAIL_SCALE_BUDGETS).join(", ")}.`,
		);
	}
	return counts;
}

function startPreviewServer() {
	const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
	const child = spawn(
		process.execPath,
		[vite, "preview", "--host", host, "--port", String(port), "--strictPort"],
		{ cwd: root, stdio: ["ignore", "pipe", "pipe"] },
	);
	child.stderr.on("data", (chunk) => process.stderr.write(chunk));
	return child;
}

async function waitForServer(url) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// Preview is still starting.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Scale preview did not start at ${url}.`);
}

async function resolveChromePath() {
	const candidates = [
		process.env.OPENFAB_CHROME_BIN,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
	].filter(Boolean);
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next platform path.
		}
	}
	throw new Error("Chrome was not found. Set OPENFAB_CHROME_BIN to its executable path.");
}

function formatBytes(value) {
	if (!Number.isFinite(value)) return "n/a";
	return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatMilliseconds(value) {
	return Number.isFinite(value) ? `${value.toFixed(1)} ms` : "n/a";
}
