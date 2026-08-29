import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "static-fab-3d");
const port = Number(process.env.OPENFAB_3D_PORT ?? 5300 + (process.pid % 503));
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const certifiedPresetAssetPattern = /production-fab-60\.default[^/]*\.js(?:\?|$)/i;
const certifiedPresetActivationMaximumLongTaskMilliseconds = 50;
const certifiedPresetActivationMaximumLongTaskCount = 0;
const certifiedPresetActivationTotalLongTaskMilliseconds = 0;
const profileCertifiedPreset = process.env.OPENFAB_PROFILE_CERTIFIED_PRESET === "1";
const chromePath = await resolveChromePath();
const server = startPreviewServer();
let browser;
let page;
let context;
const result = {
	status: "FAIL",
	failure: null,
	certifiedPresetTimings: null,
	certifiedPresetStages: null,
	certifiedPresetWorkers: null,
	certifiedPresetCpuProfile: null,
	certifiedPresetIdentity: null,
	certifiedPresetAssetRequests: null,
	inspectionTimings: null,
	scene: null,
	desktopPixels: null,
	orbitChanged: false,
	selectedModuleId: "",
	mobile: null,
	visibility: null,
	switchHardware: null,
	scale50k: null,
	consoleErrors: [],
	pageErrors: [],
};

try {
	await mkdir(artifactRoot, { recursive: true });
	await waitForServer(`${baseUrl}/`);
	browser = await chromium.launch({ executablePath: chromePath, headless: true });
	context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	await context.addInitScript(() => {
		const NativeWorker = globalThis.Worker;
		const starts = {
			syntheticFabStarter: 0,
			syntheticFabStarterCertifiedArtifact: 0,
			syntheticFabStarterCertifiedArtifactActive: 0,
			syntheticFabStarterCertifiedArtifactTerminated: 0,
			syntheticFabStarterCertifiedArtifactCreatedAt: null,
			syntheticFabStarterCertifiedArtifactMessageAt: null,
			syntheticFabStarterCertifiedArtifactTerminatedAt: null,
			staticFabInspection3D: 0,
		};
		Object.defineProperty(globalThis, "__openfab3DAcceptanceWorkerStarts", {
			value: starts,
			configurable: false,
			writable: false,
		});
		globalThis.Worker = new Proxy(NativeWorker, {
			construct(target, argumentsList) {
				const url = String(argumentsList[0] ?? "");
				if (/syntheticFabStarterWorker/i.test(url)) starts.syntheticFabStarter += 1;
				if (/staticFabInspection3DWorker/i.test(url)) starts.staticFabInspection3D += 1;
				const worker = Reflect.construct(target, argumentsList);
				if (/syntheticFabStarterCertifiedArtifactWorker/i.test(url)) {
					starts.syntheticFabStarterCertifiedArtifact += 1;
					starts.syntheticFabStarterCertifiedArtifactActive += 1;
					starts.syntheticFabStarterCertifiedArtifactCreatedAt = performance.now();
					worker.addEventListener("message", () => {
						starts.syntheticFabStarterCertifiedArtifactMessageAt = performance.now();
					});
					const terminate = worker.terminate.bind(worker);
					let terminated = false;
					worker.terminate = () => {
						if (!terminated) {
							terminated = true;
							starts.syntheticFabStarterCertifiedArtifactActive -= 1;
							starts.syntheticFabStarterCertifiedArtifactTerminated += 1;
							starts.syntheticFabStarterCertifiedArtifactTerminatedAt = performance.now();
						}
						terminate();
					};
				}
				return worker;
			},
		});
		const longTasks = [];
		Object.defineProperty(globalThis, "__openfab3DAcceptanceLongTasks", {
			value: longTasks,
			configurable: false,
			writable: false,
		});
		const longTaskObservationSupported =
			typeof PerformanceObserver !== "undefined" &&
			PerformanceObserver.supportedEntryTypes.includes("longtask");
		Object.defineProperty(globalThis, "__openfab3DAcceptanceLongTaskSupported", {
			value: longTaskObservationSupported,
			configurable: false,
			writable: false,
		});
		if (longTaskObservationSupported) {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks.push({ startTime: entry.startTime, duration: entry.duration });
				}
			});
			Object.defineProperty(globalThis, "__openfab3DAcceptanceLongTaskObserver", {
				value: observer,
				configurable: false,
				writable: false,
			});
			observer.observe({ type: "longtask", buffered: true });
		}
	});
	page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") result.consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => result.pageErrors.push(error.message));
	let certifiedPresetAssetRequests = 0;
	page.on("request", (request) => {
		if (certifiedPresetAssetPattern.test(request.url())) certifiedPresetAssetRequests++;
	});
	await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
	assertEqual(
		await page.evaluate(() => globalThis.__openfab3DAcceptanceLongTaskSupported === true),
		true,
		"3D acceptance Long Task observation support",
	);
	await waitForReady(page, 0);
	await chooseBlankCanvasForFirstRun(page);
	const presetButton = page.getByRole("button", { name: "FAB 프리셋", exact: true });
	await presetButton.waitFor({ state: "visible" });
	const workersBeforePreset = await syntheticStarterWorkerStarts(page);
	const presetStartedAt = await page.evaluate(() => performance.now());
	await presetButton.click();
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	const shellReadyAt = await page.evaluate(() => performance.now());
	const productionPresetCard = page.getByTestId("synthetic-fab-starter-production-fab-60");
	assertEqual(
		await productionPresetCard.locator(".tilefab-starter-schematic-preview").count(),
		1,
		"lazy preset immediate schematic",
	);
	await productionPresetCard.click();
	await page.waitForFunction(
		() => {
			const preview = document.querySelector('[data-testid="synthetic-fab-starter-preview"]');
			return (
				preview?.getAttribute("data-starter-id") === "production-fab-60" &&
				preview.getAttribute("data-preview-state") === "catalog-ready"
			);
		},
		undefined,
		{ timeout: 5_000 },
	);
	const catalogReadyAt = await page.evaluate(() => performance.now());
	await assertSemanticPresetSchematic(page);
	assertEqual(
		certifiedPresetAssetRequests,
		0,
		"preset catalog does not eagerly fetch exact certified payload",
	);
	assertEqual(
		await syntheticStarterWorkerStarts(page),
		workersBeforePreset,
		"preset catalog starts no generator Worker",
	);
	await waitForAnimationFrames(page, 2);
	const cdp = await context.newCDPSession(page);
	await cdp.send("Network.enable");
	await cdp.send("Network.clearBrowserCache");
	const exactAssetRequestsBeforeAction = certifiedPresetAssetRequests;
	assertEqual(
		exactAssetRequestsBeforeAction,
		0,
		"preset catalog remains exact-payload-free through the action boundary",
	);
	const catalogLongTasks = await readLongTasksSince(page, presetStartedAt);
	const certifiedWorkersBeforeAction = await certifiedArtifactWorkerStats(page);
	let certifiedProfileStartedAt = null;
	if (profileCertifiedPreset) {
		await cdp.send("Profiler.enable");
		await cdp.send("Profiler.start");
		certifiedProfileStartedAt = await page.evaluate(() => performance.now());
	}
	const activationStartedAt = await startCertifiedPresetStageProbe(page);
	await page.getByTestId("create-project-from-synthetic-fab-preset").click();
	await continueWithoutSavingIfVisible(page);
	await page.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.projectName === "OpenFab 60-Bay Rail Foundation" &&
				canvas.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				Number(canvas.dataset.authoredCells) >= 30_000
			);
		},
		undefined,
		{ timeout: 30_000 },
	);
	const activationReadyAt = await page.evaluate(() => performance.now());
	await waitForAnimationFrames(page, 2);
	await page.waitForFunction(
		() => globalThis.__openfabCertifiedPresetStageProbe?.exactCanvasPaintedAt !== null,
		undefined,
		{ timeout: 5_000 },
	);
	const certifiedPresetStages = await readCertifiedPresetStages(page, activationStartedAt);
	const certifiedWorkersAfterActivation = await certifiedArtifactWorkerStats(page);
	if (profileCertifiedPreset) {
		const { profile } = await cdp.send("Profiler.stop");
		const artifactProfileOffset = activationStartedAt - certifiedProfileStartedAt;
		result.certifiedPresetCpuProfile = {
			artifact: summarizeCpuProfile(
				profile,
				artifactProfileOffset,
				artifactProfileOffset + certifiedPresetStages.artifactHydratedMilliseconds,
			),
			certification: summarizeCpuProfile(
				profile,
				artifactProfileOffset + certifiedPresetStages.artifactHydratedMilliseconds,
				artifactProfileOffset + certifiedPresetStages.projectOperationStartedMilliseconds,
			),
			activation: summarizeCpuProfile(profile),
		};
		await cdp.send("Profiler.disable");
	}
	const canonicalBefore = await readCanonicalIdentity(page);
	const activationAssetRequests = certifiedPresetAssetRequests - exactAssetRequestsBeforeAction;
	assertEqual(activationAssetRequests, 1, "action-time exact certified payload request count");
	assertEqual(
		await syntheticStarterWorkerStarts(page),
		workersBeforePreset,
		"certified preset starts no generator Worker",
	);
	assertEqual(
		certifiedWorkersAfterActivation.started - certifiedWorkersBeforeAction.started,
		1,
		"certified preset starts one exact-artifact hydration Worker",
	);
	assertEqual(
		certifiedWorkersAfterActivation.terminated - certifiedWorkersBeforeAction.terminated,
		1,
		"certified preset terminates its exact-artifact hydration Worker",
	);
	assertEqual(
		certifiedWorkersAfterActivation.active,
		0,
		"certified preset leaves no exact-artifact hydration Worker active",
	);
	const activationLongTasks = await readLongTasksSince(page, activationStartedAt);
	result.certifiedPresetTimings = {
		shellMilliseconds: shellReadyAt - presetStartedAt,
		catalogMilliseconds: catalogReadyAt - presetStartedAt,
		activationMilliseconds: activationReadyAt - activationStartedAt,
		catalogMaximumLongTaskMilliseconds: maximumLongTask(catalogLongTasks),
		activationMaximumLongTaskMilliseconds: maximumLongTask(activationLongTasks),
		activationLongTaskCount: activationLongTasks.length,
		activationTotalLongTaskMilliseconds: totalLongTask(activationLongTasks),
	};
	result.certifiedPresetStages = {
		...certifiedPresetStages,
		longTasks: {
			artifact: summarizeLongTasksBetween(
				activationLongTasks,
				activationStartedAt,
				certifiedPresetStages.artifactHydratedAt,
			),
			certification: summarizeLongTasksBetween(
				activationLongTasks,
				certifiedPresetStages.artifactHydratedAt,
				certifiedPresetStages.projectOperationStartedAt,
			),
			projectAdoption: summarizeLongTasksBetween(
				activationLongTasks,
				certifiedPresetStages.projectOperationStartedAt,
				certifiedPresetStages.projectReadyAt,
			),
			exactCanvas: summarizeLongTasksBetween(
				activationLongTasks,
				certifiedPresetStages.projectReadyAt,
				certifiedPresetStages.exactCanvasPaintedAt,
			),
		},
	};
	result.certifiedPresetWorkers = {
		beforeAction: certifiedWorkersBeforeAction,
		afterActivation: certifiedWorkersAfterActivation,
	};
	assertAtLeast(
		certifiedPresetStages.artifactRequestStartedAt,
		activationStartedAt,
		"certified artifact request begins after the explicit action",
	);
	assertAtLeast(
		certifiedPresetStages.artifactResponseEndedAt,
		certifiedPresetStages.artifactRequestStartedAt,
		"certified artifact response follows request start",
	);
	assertAtLeast(
		certifiedPresetStages.artifactHydratedAt,
		certifiedPresetStages.artifactResponseEndedAt,
		"certified artifact hydration follows payload delivery",
	);
	assertAtLeast(
		certifiedPresetStages.projectOperationStartedAt,
		certifiedPresetStages.artifactHydratedAt,
		"project adoption follows certified artifact hydration",
	);
	assertAtLeast(
		certifiedPresetStages.projectReadyAt,
		certifiedPresetStages.projectOperationStartedAt,
		"project ready follows adoption start",
	);
	assertAtLeast(
		certifiedPresetStages.exactCanvasPaintedAt,
		certifiedPresetStages.projectReadyAt,
		"exact Canvas paint follows project readiness",
	);
	result.certifiedPresetIdentity = canonicalBefore;
	result.certifiedPresetAssetRequests = {
		beforeAction: exactAssetRequestsBeforeAction,
		activation: activationAssetRequests,
	};
	assertAtMost(
		result.certifiedPresetTimings.shellMilliseconds,
		250,
		"certified preset shell latency",
	);
	assertAtMost(
		result.certifiedPresetTimings.catalogMilliseconds,
		250,
		"certified preset catalog latency",
	);
	assertAtMost(
		result.certifiedPresetTimings.activationMilliseconds,
		30_000,
		"certified production activation latency",
	);
	assertAtMost(
		result.certifiedPresetTimings.catalogMaximumLongTaskMilliseconds,
		50,
		"certified preset catalog main-thread long task",
	);
	assertEqual(catalogLongTasks.length, 0, "certified preset catalog Long Tasks");
	assertAtMost(
		result.certifiedPresetTimings.activationMaximumLongTaskMilliseconds,
		certifiedPresetActivationMaximumLongTaskMilliseconds,
		"certified preset activation main-thread long task regression ceiling",
	);
	assertAtMost(
		result.certifiedPresetTimings.activationLongTaskCount,
		certifiedPresetActivationMaximumLongTaskCount,
		"certified preset activation Long Task count",
	);
	assertAtMost(
		result.certifiedPresetTimings.activationTotalLongTaskMilliseconds,
		certifiedPresetActivationTotalLongTaskMilliseconds,
		"certified preset activation total Long Task budget",
	);

	assertEqual(canonicalBefore.workerSimulationReady, "false", "simulation gate before 3D");

	await page.getByTestId("editor-activity-assemble").click();
	await page.getByRole("button", { name: "내 청사진", exact: true }).click();
	const blueprintLibrary = page.getByTestId("blueprint-library");
	await blueprintLibrary.waitFor({ state: "visible" });
	const inspectionWorkersBefore = await inspection3DWorkerStarts(page);
	const firstOpenStartedAt = await page.evaluate(() => performance.now());
	await page.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const canvas3D = page.getByTestId("static-fab-inspection-3d-canvas");
	await waitFor3DScene(page, canvas3D);
	await blueprintLibrary.waitFor({ state: "hidden" });
	assertEqual(
		await blueprintLibrary.count(),
		0,
		"3D entry removes the Blueprint authoring surface",
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-editor-activity"),
		"inspect",
		"3D entry publishes the Inspect activity",
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-editor-tool"),
		"inspect",
		"3D entry uses the Inspect tool",
	);
	await waitForAnimationFrames(page, 2);
	const firstOpenReadyAt = await page.evaluate(() => performance.now());
	const firstOpenLongTasks = await readLongTasksSince(page, firstOpenStartedAt);
	assertEqual(
		await inspection3DWorkerStarts(page),
		inspectionWorkersBefore + 1,
		"first 3D inspection Worker start",
	);
	result.scene = await readSceneStats(canvas3D);
	assertAtLeast(result.scene.triangles, 100_000, "3D rail triangles");
	assertAtLeast(result.scene.pickSegments, 10_000, "3D rail pick segments");
	assertAtMost(result.scene.objects, 24, "3D scene object count");
	assertEqual(result.scene.contentBuilds, 1, "initial 3D scene content build count");
	assertAtLeast(result.scene.railChunks, 25, "3D 32 m rail chunk count");
	assertAtLeast(result.scene.visibleRailChunks, 1, "3D visible rail chunks");
	assertAtMost(result.scene.visibleRailChunks, 24, "3D visible rail chunk budget");
	assertAtMost(result.scene.residentRailChunks, 48, "3D resident rail chunk budget");
	await page.getByRole("button", { name: "3D 표시 레이어", exact: true }).click();
	for (const [label, field] of [
		["3D 레일 표시", "sceneRailVisible"],
		["3D 설비와 포트 표시", "sceneEquipmentVisible"],
	]) {
		const control = page.getByRole("button", { name: label, exact: true });
		assertEqual(await control.getAttribute("aria-pressed"), "true", `${label} initial state`);
		await control.click();
		await waitForCanvasDataset(page, field, "false");
		assertEqual((await readSceneStats(canvas3D)).contentBuilds, 1, `${label} hide reuses content`);
		await control.click();
		await waitForCanvasDataset(page, field, "true");
	}
	const switchVisibilityControl = page.getByRole("button", {
		name: "3D 스위치 하드웨어 표시",
		exact: true,
	});
	assertEqual(
		await switchVisibilityControl.getAttribute("aria-pressed"),
		"true",
		"switch visibility initial state",
	);
	await switchVisibilityControl.click();
	await waitForCanvasDataset(page, "sceneSwitchesVisible", "false");
	result.visibility = {
		afterHide: await readSceneStats(canvas3D),
		canonical: await readCanonicalIdentity(page),
	};
	assertEqual(
		result.visibility.afterHide.contentBuilds,
		1,
		"visibility changes do not rebuild content",
	);
	assertIdentityEqual(result.visibility.canonical, canonicalBefore, "after 3D visibility controls");
	await page.getByRole("button", { name: "3D 표시 레이어", exact: true }).click();
	const sceneBeforeOrbit = await readSceneStats(canvas3D);

	const desktopBeforeOrbit = await canvas3D.screenshot({
		path: path.join(artifactRoot, "desktop-isometric.png"),
	});
	result.desktopPixels = await analyzeScreenshot(page, desktopBeforeOrbit);
	assertAtLeast(result.desktopPixels.railLike, 500, "desktop visible rail pixels");
	assertAtLeast(result.desktopPixels.nonBackground, 2_000, "desktop non-background pixels");
	const desktopBounds = await canvas3D.boundingBox();
	if (!desktopBounds) throw new Error("3D desktop canvas has no bounds.");
	await page.mouse.move(
		desktopBounds.x + desktopBounds.width * 0.48,
		desktopBounds.y + desktopBounds.height * 0.45,
	);
	await page.mouse.down();
	await page.mouse.move(
		desktopBounds.x + desktopBounds.width * 0.62,
		desktopBounds.y + desktopBounds.height * 0.55,
		{ steps: 8 },
	);
	await page.mouse.up();
	await page.waitForTimeout(100);
	const desktopAfterOrbit = await canvas3D.screenshot({
		path: path.join(artifactRoot, "desktop-orbit.png"),
	});
	result.orbitChanged = hashBuffer(desktopBeforeOrbit) !== hashBuffer(desktopAfterOrbit);
	assertEqual(result.orbitChanged, true, "orbit changes rendered pixels");
	const sceneAfterOrbit = await readSceneStats(canvas3D);
	assertEqual(
		sceneAfterOrbit.contentBuilds,
		sceneBeforeOrbit.contentBuilds,
		"camera orbit does not rebuild 3D content",
	);
	assertEqual(
		sceneAfterOrbit.chunkMaterializations,
		sceneBeforeOrbit.chunkMaterializations,
		"camera orbit reuses resident rail geometry",
	);
	assertEqual(
		sceneAfterOrbit.viewportRenders,
		sceneBeforeOrbit.viewportRenders,
		"camera orbit does not publish React state",
	);
	assertAtLeast(
		sceneAfterOrbit.chunkSetUpdates,
		result.scene.chunkSetUpdates + 1,
		"camera orbit updates the imperative chunk set",
	);
	assertAtMost(sceneAfterOrbit.visibleRailChunks, 24, "orbit visible rail chunk budget");
	assertAtMost(sceneAfterOrbit.residentRailChunks, 48, "orbit resident rail chunk budget");

	const chunkTraversalStartedAt = await page.evaluate(() => performance.now());
	await canvas3D.focus();
	for (let step = 0; step < 5; step++) {
		await page.keyboard.press("a");
		await waitForAnimationFrames(page, 2);
	}
	for (let step = 0; step < 10; step++) {
		await page.keyboard.press("d");
		await waitForAnimationFrames(page, 2);
	}
	result.chunkTraversal = {
		...(await readSceneStats(canvas3D)),
		longTasks: await readLongTasksSince(page, chunkTraversalStartedAt),
	};
	assertEqual(
		result.chunkTraversal.contentBuilds,
		result.scene.contentBuilds,
		"chunk traversal does not rebuild 3D content",
	);
	assertEqual(
		result.chunkTraversal.viewportRenders,
		sceneBeforeOrbit.viewportRenders,
		"chunk traversal does not publish React state",
	);
	assertAtLeast(
		result.chunkTraversal.chunkMaterializations,
		49,
		"chunk traversal exercises bounded resident churn",
	);
	assertAtLeast(result.chunkTraversal.chunkEvictions, 1, "chunk traversal evicts stale detail");
	assertAtMost(
		result.chunkTraversal.residentRailChunks,
		48,
		"chunk traversal resident rail chunk budget",
	);
	assertEqual(result.chunkTraversal.longTasks.length, 0, "chunk traversal Long Tasks");

	await page.getByRole("button", { name: "위에서 보기", exact: true }).click();
	await page.waitForTimeout(100);
	const selectionAppliesBeforePick = (await readSceneStats(canvas3D)).selectionApplies;
	const pickPhaseStartedAt = await page.evaluate(() => performance.now());
	const pickResult = await pickVisibleRail(page, canvas3D);
	result.selectedModuleId = pickResult.selectedModuleId;
	if (!result.selectedModuleId)
		throw new Error("3D rail click did not resolve semantic ownership.");
	await page.waitForFunction(
		(previousCount) =>
			Number(
				document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')?.dataset
					.sceneSelectionApplies,
			) > previousCount,
		selectionAppliesBeforePick,
		{ timeout: 2_000 },
	);
	const pickLongTasks = await readLongTasksSince(page, pickPhaseStartedAt);
	const sceneAfterPick = await readSceneStats(canvas3D);
	assertEqual(
		sceneAfterPick.contentBuilds,
		result.scene.contentBuilds,
		"selection does not rebuild 3D scene content",
	);
	const distanceBeforeFrame = sceneAfterPick.cameraDistance;
	await page.getByRole("button", { name: "선택 전체 프레임", exact: true }).click();
	await page.waitForFunction(
		(previousDistance) => {
			const distance = Number(
				document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')?.dataset
					.sceneCameraDistance,
			);
			return Number.isFinite(distance) && distance < previousDistance - 0.01;
		},
		distanceBeforeFrame,
		{ timeout: 2_000 },
	);
	const sceneAfterFrame = await readSceneStats(canvas3D);
	assertAtMost(
		sceneAfterFrame.cameraDistance,
		distanceBeforeFrame * 0.5,
		"frame selection camera distance",
	);
	assertEqual(
		sceneAfterFrame.contentBuilds,
		result.scene.contentBuilds,
		"frame selection does not rebuild 3D scene content",
	);
	const framedCanvasBounds = await canvas3D.boundingBox();
	if (!framedCanvasBounds) throw new Error("Framed 3D canvas has no bounds.");
	await page.mouse.click(framedCanvasBounds.x + 8, framedCanvasBounds.y + 8, {
		button: "right",
	});
	await page.waitForTimeout(50);
	assertEqual(
		await page.getByTestId("rail-canvas").getAttribute("data-selected-module-id"),
		result.selectedModuleId,
		"right click preserves semantic selection",
	);
	await page.getByRole("button", { name: "아이소메트릭 보기", exact: true }).click();
	assertEqual(
		await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""),
		"아이소메트릭 보기",
		"global Escape toolbar focus owner",
	);
	await page.keyboard.press("Escape");
	await waitForView(page, "2d");
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-editor-activity"),
		"inspect",
		"2D return preserves the Inspect activity",
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-editor-tool"),
		"inspect",
		"2D return preserves the Inspect tool",
	);
	assertEqual(await page.getByTestId("rail-buildbar").count(), 0, "2D return hides build controls");
	assertEqual(
		await page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? ""),
		"rail-canvas",
		"2D focus recovery after global Escape",
	);
	assertEqual(
		await page.getByTestId("rail-canvas").getAttribute("data-selected-module-id"),
		result.selectedModuleId,
		"2D/3D semantic selection continuity",
	);
	assertIdentityEqual(await readCanonicalIdentity(page), canonicalBefore, "after 3D interaction");

	const cachedWorkersBefore = await inspection3DWorkerStarts(page);
	const cachedOpenStartedAt = await page.evaluate(() => performance.now());
	await page.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	await waitFor3DScene(page, canvas3D);
	await waitForAnimationFrames(page, 2);
	const cachedOpenReadyAt = await page.evaluate(() => performance.now());
	assertEqual(
		await inspection3DWorkerStarts(page),
		cachedWorkersBefore,
		"cached 3D artifact reuse",
	);
	await page.getByRole("button", { name: "3D 표시 레이어", exact: true }).click();
	assertEqual(
		await switchVisibilityControl.getAttribute("aria-pressed"),
		"false",
		"switch visibility survives 2D/3D transition",
	);
	await waitForCanvasDataset(page, "sceneSwitchesVisible", "false");
	await switchVisibilityControl.click();
	await waitForCanvasDataset(page, "sceneSwitchesVisible", "true");
	result.inspectionTimings = {
		firstOpenMilliseconds: firstOpenReadyAt - firstOpenStartedAt,
		cachedOpenMilliseconds: cachedOpenReadyAt - cachedOpenStartedAt,
		maximumPickMilliseconds: pickResult.maximumPickMilliseconds,
		maximumLongTaskMilliseconds: maximumLongTask(firstOpenLongTasks),
		firstOpenLongTasks,
		firstOpenStartedAt,
		maximumPickLongTaskMilliseconds: maximumLongTask(pickLongTasks),
		workerStarts: cachedWorkersBefore,
		selectionAppliesBeforePick,
		selectionAppliesAfterPick: sceneAfterPick.selectionApplies,
		frameDistanceBefore: distanceBeforeFrame,
		frameDistanceAfter: sceneAfterFrame.cameraDistance,
	};
	assertAtMost(result.inspectionTimings.firstOpenMilliseconds, 10_000, "first 3D open latency");
	assertAtMost(result.inspectionTimings.cachedOpenMilliseconds, 2_000, "cached 3D open latency");
	assertAtMost(result.inspectionTimings.maximumPickMilliseconds, 500, "3D semantic pick latency");
	assertAtMost(
		result.inspectionTimings.maximumPickLongTaskMilliseconds,
		50,
		"3D semantic pick main-thread long task",
	);
	assertEqual(pickLongTasks.length, 0, "3D semantic pick Long Tasks");
	assertAtMost(
		result.inspectionTimings.maximumLongTaskMilliseconds,
		50,
		"3D adoption main-thread long task",
	);
	assertEqual(firstOpenLongTasks.length, 0, "3D adoption Long Tasks");

	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForFunction(
		() => {
			const canvasBounds = document
				.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')
				?.getBoundingClientRect();
			const inspectorBounds = document.querySelector(".tilefab-inspector")?.getBoundingClientRect();
			return Boolean(
				canvasBounds &&
					inspectorBounds &&
					inspectorBounds.width > 0 &&
					inspectorBounds.height > 0 &&
					canvasBounds.bottom <= inspectorBounds.top - 8,
			);
		},
		undefined,
		{ timeout: 2_000 },
	);
	await assertMinimumTargetSize(page, ".tilefab-view-switch button", 44, "mobile view switch");
	for (const label of [
		"선택 전체 프레임",
		"위에서 보기",
		"아이소메트릭 보기",
		"3D 표시 레이어",
		"3D 레일 표시",
		"3D 스위치 하드웨어 표시",
		"3D 설비와 포트 표시",
	]) {
		await assertMinimumTargetSize(page, `button[aria-label="${label}"]`, 44, `mobile ${label}`);
	}
	await assertMinimumTargetSize(
		page,
		".tilefab-inspector > header button",
		44,
		"mobile inspector close",
	);
	result.mobile = await page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]');
		const inspector = document.querySelector(".tilefab-inspector");
		const canvasBounds = canvas?.getBoundingClientRect();
		const inspectorBounds = inspector?.getBoundingClientRect();
		return {
			width: innerWidth,
			height: innerHeight,
			overflow: document.documentElement.scrollWidth - innerWidth,
			buildbarPresent: document.querySelector(".tilefab-buildbar") !== null,
			canvasWidth: canvas?.clientWidth ?? 0,
			canvasHeight: canvas?.clientHeight ?? 0,
			canvasBottom: canvasBounds?.bottom ?? 0,
			inspectorTop: inspectorBounds?.top ?? 0,
			inspectorVisible: Boolean(
				inspectorBounds && inspectorBounds.width > 0 && inspectorBounds.height > 0,
			),
		};
	});
	assertEqual(result.mobile.overflow, 0, "mobile horizontal overflow");
	assertEqual(result.mobile.buildbarPresent, false, "mobile authoring toolbar isolation");
	assertEqual(result.mobile.canvasWidth, 390, "mobile 3D canvas width");
	assertAtLeast(result.mobile.canvasHeight, 300, "mobile 3D usable canvas height");
	assertEqual(result.mobile.inspectorVisible, true, "mobile semantic inspector visibility");
	assertAtMost(
		result.mobile.canvasBottom,
		result.mobile.inspectorTop,
		"mobile 3D canvas/inspector overlap",
	);
	await page.screenshot({ path: path.join(artifactRoot, "mobile-390x844.png") });
	assertIdentityEqual(await readCanonicalIdentity(page), canonicalBefore, "after mobile resize");

	await canvas3D.evaluate((canvas) => {
		const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
		const extension = gl?.getExtension("WEBGL_lose_context");
		if (!extension) throw new Error("WEBGL_lose_context is unavailable.");
		extension.loseContext();
	});
	await waitForView(page, "2d");
	assertIdentityEqual(
		await readCanonicalIdentity(page),
		canonicalBefore,
		"after WebGL context loss",
	);

	const switchPage = await context.newPage();
	await switchPage.setViewportSize({ width: 1600, height: 900 });
	switchPage.on("console", (message) => {
		if (message.type() === "error") result.consoleErrors.push(`[switch] ${message.text()}`);
	});
	switchPage.on("pageerror", (error) => result.pageErrors.push(`[switch] ${error.message}`));
	await switchPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
	await waitForReady(switchPage, 0);
	await dragWorld(switchPage, { x: 0.5, y: 0.5 }, { x: 2.5, y: 0.5 });
	await switchPage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(canvas?.dataset.authoredCells) >= 3 &&
				canvas?.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	await switchPage.getByTestId("build-mode-advanced-switch").click();
	await switchPage.getByTestId("advanced-switch-profile-D").click();
	await dragWorld(switchPage, { x: 2.5, y: 0.5 }, { x: 2.5, y: -1.5 });
	await switchPage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.advancedSwitchCount === "1" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const closingRoutes = [
		[
			{ x: 8.5, y: 0.5 },
			{ x: 10.5, y: 0.5 },
		],
		[
			{ x: 10.5, y: 0.5 },
			{ x: 10.5, y: 4.5 },
		],
		[
			{ x: 10.5, y: 4.5 },
			{ x: 0.5, y: 4.5 },
		],
		[
			{ x: 0.5, y: 4.5 },
			{ x: 0.5, y: 0.5 },
		],
		[
			{ x: 8.5, y: -1.5 },
			{ x: 10.5, y: -1.5 },
		],
		[
			{ x: 10.5, y: -1.5 },
			{ x: 10.5, y: -4.5 },
		],
		[
			{ x: 10.5, y: -4.5 },
			{ x: 4.5, y: -4.5 },
		],
		[
			{ x: 4.5, y: -4.5 },
			{ x: 4.5, y: -2.5 },
		],
	];
	for (const [start, end] of closingRoutes) {
		const priorSequence = Number(
			await switchPage.getByTestId("rail-canvas").getAttribute("data-worker-sequence"),
		);
		await switchPage.getByRole("button", { name: "레일 건설", exact: true }).click();
		await switchPage.getByRole("button", { name: "SMART ROUTE", exact: true }).click();
		await dragWorld(switchPage, start, end);
		await waitForMirrorIdle(switchPage, priorSequence + 1);
	}
	await switchPage.keyboard.press("Escape");
	await switchPage.getByRole("button", { name: "3D 검사 뷰", exact: true }).waitFor({
		state: "visible",
		timeout: 10_000,
	});
	try {
		await switchPage.waitForFunction(
			() => !document.querySelector('button[aria-label="3D 검사 뷰"]')?.hasAttribute("disabled"),
			undefined,
			{ timeout: 10_000 },
		);
	} catch {
		const diagnostics = await switchPage.evaluate(() => ({
			buttonTitle: document.querySelector('button[aria-label="3D 검사 뷰"]')?.getAttribute("title"),
			canvas: {
				...document.querySelector('[data-testid="rail-canvas"]')?.dataset,
			},
		}));
		throw new Error(`Switch fixture never became 3D-ready: ${JSON.stringify(diagnostics)}`);
	}
	const switchIdentity = await readCanonicalIdentity(switchPage);
	await switchPage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const switchCanvas3D = switchPage.getByTestId("static-fab-inspection-3d-canvas");
	await waitFor3DScene(switchPage, switchCanvas3D);
	await switchPage.getByRole("button", { name: "위에서 보기", exact: true }).click();
	await waitForAnimationFrames(switchPage, 2);
	const switchCanvasBounds = await switchCanvas3D.boundingBox();
	if (!switchCanvasBounds) throw new Error("3D switch canvas has no visible bounds.");
	await switchPage.mouse.click(
		switchCanvasBounds.x + 24,
		switchCanvasBounds.y + switchCanvasBounds.height / 2,
	);
	assertEqual(
		await switchPage.getByTestId("rail-canvas").getAttribute("data-selected-module-id"),
		"",
		"switch fixture selection cleared before semantic hardware pick",
	);
	await switchPage.screenshot({ path: path.join(artifactRoot, "advanced-switch-hardware.png") });
	const hardwarePick = await pickVisibleAdvancedSwitchHardware(switchPage, switchCanvas3D);
	if (!hardwarePick.selectedModuleId.startsWith("SW-")) {
		throw new Error(
			`3D switch hardware did not resolve semantic ownership: ${hardwarePick.selectedModuleId}`,
		);
	}
	await switchPage.getByRole("button", { name: "3D 표시 레이어", exact: true }).click();
	await switchPage.getByRole("button", { name: "3D 레일 표시", exact: true }).click();
	await waitForCanvasDataset(switchPage, "sceneRailVisible", "false");
	await switchPage.getByRole("button", { name: "3D 스위치 하드웨어 표시", exact: true }).click();
	await waitForCanvasDataset(switchPage, "sceneSwitchesVisible", "false");
	await switchPage.mouse.click(hardwarePick.pageX, hardwarePick.pageY);
	assertEqual(
		await switchPage.getByTestId("rail-canvas").getAttribute("data-selected-module-id"),
		"",
		"hidden rail and switch proxy are not pickable",
	);
	await switchPage.getByRole("button", { name: "3D 스위치 하드웨어 표시", exact: true }).click();
	await waitForCanvasDataset(switchPage, "sceneSwitchesVisible", "true");
	await switchPage.getByRole("button", { name: "3D 표시 레이어", exact: true }).click();
	await switchPage.mouse.click(hardwarePick.pageX, hardwarePick.pageY);
	const switchSelectedFromProxy = await switchPage
		.getByTestId("rail-canvas")
		.getAttribute("data-selected-module-id");
	if (!switchSelectedFromProxy?.startsWith("SW-")) {
		throw new Error(
			"Visible switch proxy did not restore semantic switch picking with rail hidden.",
		);
	}
	const switchScene = await readSceneStats(switchCanvas3D);
	assertEqual(switchScene.advancedSwitchInstances, 1, "advanced-switch rigid instance count");
	assertEqual(switchScene.contentBuilds, 1, "switch visibility/picking does not rebuild content");
	assertIdentityEqual(
		await readCanonicalIdentity(switchPage),
		switchIdentity,
		"after switch 3D picking",
	);
	result.switchHardware = {
		selectedModuleId: switchSelectedFromProxy,
		pickMilliseconds: hardwarePick.pickMilliseconds,
		...switchScene,
	};
	await switchPage.close();

	const scalePage = await context.newPage();
	scalePage.on("console", (message) => {
		if (message.type() === "error") result.consoleErrors.push(`[50k] ${message.text()}`);
	});
	scalePage.on("pageerror", (error) => result.pageErrors.push(`[50k] ${error.message}`));
	await scalePage.goto(`${baseUrl}/?scaleFixture=50000&equipmentPorts=50000`, {
		waitUntil: "domcontentloaded",
	});
	await scalePage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.scaleFixtureCells === "50000" &&
				canvas.dataset.scaleFixtureEquipmentPorts === "50000" &&
				canvas.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				Number(canvas.dataset.authoredCells) === 50_000
			);
		},
		undefined,
		{ timeout: 90_000 },
	);
	const scaleIdentity = await readCanonicalIdentity(scalePage);
	assertEqual(scaleIdentity.workerSimulationReady, "false", "50k simulation gate");
	const scaleEquipmentTarget = Object.freeze({
		portId: 1,
		equipmentGroupId: 1,
		worldX: 0.5,
		worldZ: 0.5,
	});
	const scaleWorkersBefore = await inspection3DWorkerStarts(scalePage);
	const scaleOpenStartedAt = await scalePage.evaluate(() => performance.now());
	const scaleHeapBefore = await readJsHeap(scalePage);
	await scalePage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const scaleCanvas3D = scalePage.getByTestId("static-fab-inspection-3d-canvas");
	await waitFor3DScene(scalePage, scaleCanvas3D, 60_000);
	await waitForAnimationFrames(scalePage, 2);
	const scaleReadyAt = await scalePage.evaluate(() => performance.now());
	const scaleLongTasks = await readLongTasksSince(scalePage, scaleOpenStartedAt);
	const scaleScene = await readSceneStats(scaleCanvas3D);
	const scaleHeapAfter = await readJsHeap(scalePage);
	result.scale50k = {
		openMilliseconds: scaleReadyAt - scaleOpenStartedAt,
		heapBefore: scaleHeapBefore,
		heapAfter: scaleHeapAfter,
		heapDelta: Math.max(0, scaleHeapAfter - scaleHeapBefore),
		longTasks: scaleLongTasks,
		...scaleScene,
	};
	assertEqual(
		await inspection3DWorkerStarts(scalePage),
		scaleWorkersBefore + 1,
		"50k first 3D Worker start",
	);
	assertAtLeast(scaleScene.pickSegments, 49_000, "50k semantic pick segments");
	assertAtLeast(scaleScene.railChunks, 1_500, "50k 32 m rail chunks");
	assertAtMost(scaleScene.visibleRailChunks, 24, "50k visible chunk budget");
	assertAtMost(scaleScene.residentRailChunks, 48, "50k resident chunk budget");
	assertEqual(scaleScene.contentBuilds, 1, "50k scene content build count");
	assertEqual(scaleScene.equipmentSections, 50_000, "50k canonical equipment section count");
	assertEqual(scaleScene.equipmentShellSpans, 100_000, "50k equipment shell span count");
	assertEqual(scaleScene.portInstances, 50_000, "50k canonical port instance count");
	assertEqual(scaleScene.portSlotInstances, 50_000, "50k stable port-slot instance count");
	assertAtLeast(scaleScene.artifactBytes, 1, "50k transferable artifact bytes");
	assertAtMost(scaleScene.artifactBytes, 256 * 1024 * 1024, "50k transferable artifact budget");
	assertAtMost(result.scale50k.openMilliseconds, 30_000, "50k derived-view open latency");
	assertAtMost(
		result.scale50k.equipmentShellPreparationMilliseconds,
		50,
		"50k equipment shell preparation task",
	);
	assertAtMost(result.scale50k.heapDelta, 256 * 1024 * 1024, "50k JS heap growth budget");
	assertAtMost(maximumLongTask(scaleLongTasks), 50, "50k derived-view main-thread Long Task");
	assertEqual(scaleLongTasks.length, 0, "50k derived-view Long Tasks");
	const scaleRailControl = scalePage.getByRole("button", { name: "3D 레일 표시", exact: true });
	await scalePage.getByRole("button", { name: "3D 표시 레이어", exact: true }).click();
	await scaleRailControl.click();
	await waitForCanvasDataset(scalePage, "sceneRailVisible", "false");
	assertEqual(
		(await readSceneStats(scaleCanvas3D)).contentBuilds,
		1,
		"50k visibility toggle reuses compiled geometry",
	);
	await scaleRailControl.click();
	await waitForCanvasDataset(scalePage, "sceneRailVisible", "true");
	await scalePage.getByRole("button", { name: "2D 편집 뷰", exact: true }).click();
	await waitForView(scalePage, "2d");
	await selectScaleEquipmentTargetIn2D(scalePage, scaleEquipmentTarget);
	const scaleReentryStartedAt = await scalePage.evaluate(() => performance.now());
	const scaleReentryHeapBefore = await readJsHeap(scalePage);
	await scalePage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	await waitFor3DScene(scalePage, scaleCanvas3D, 60_000);
	await waitForAnimationFrames(scalePage, 2);
	const scaleReentryReadyAt = await scalePage.evaluate(() => performance.now());
	const scaleReentryLongTasks = await readLongTasksSince(scalePage, scaleReentryStartedAt);
	const scaleReentryScene = await readSceneStats(scaleCanvas3D);
	const scaleReentryHeapAfter = await readJsHeap(scalePage);
	result.scale50k.cachedReentry = {
		openMilliseconds: scaleReentryReadyAt - scaleReentryStartedAt,
		heapDelta: Math.max(0, scaleReentryHeapAfter - scaleReentryHeapBefore),
		longTasks: scaleReentryLongTasks,
		...scaleReentryScene,
	};
	assertEqual(
		await inspection3DWorkerStarts(scalePage),
		scaleWorkersBefore + 1,
		"50k cached 3D re-entry starts no second artifact Worker",
	);
	assertEqual(scaleReentryScene.contentBuilds, 1, "50k cached re-entry scene content build count");
	assertEqual(
		scaleReentryScene.equipmentShellSpans,
		100_000,
		"50k cached re-entry equipment shell spans",
	);
	assertAtMost(
		scaleReentryScene.equipmentShellPreparationMilliseconds,
		5,
		"50k cached equipment shell lookup",
	);
	assertAtMost(
		result.scale50k.cachedReentry.openMilliseconds,
		5_000,
		"50k cached derived-view re-entry latency",
	);
	assertAtMost(
		result.scale50k.cachedReentry.heapDelta,
		128 * 1024 * 1024,
		"50k cached re-entry JS heap growth budget",
	);
	assertEqual(scaleReentryLongTasks.length, 0, "50k cached re-entry Long Tasks");
	const scaleTraversalBefore = await readSceneStats(scaleCanvas3D);
	const scaleTraversalHeapBefore = await readJsHeap(scalePage);
	const scaleTraversalStartedAt = await scalePage.evaluate(() => performance.now());
	const scaleTraversalBounds = await scaleCanvas3D.boundingBox();
	if (!scaleTraversalBounds) throw new Error("50k 3D canvas has no visible bounds for traversal.");
	await scalePage.mouse.move(
		scaleTraversalBounds.x + scaleTraversalBounds.width * 0.42,
		scaleTraversalBounds.y + scaleTraversalBounds.height * 0.44,
	);
	await scalePage.mouse.down();
	await scalePage.mouse.move(
		scaleTraversalBounds.x + scaleTraversalBounds.width * 0.58,
		scaleTraversalBounds.y + scaleTraversalBounds.height * 0.55,
		{ steps: 12 },
	);
	await scalePage.mouse.up();
	await waitForAnimationFrames(scalePage, 2);
	await scalePage.mouse.move(
		scaleTraversalBounds.x + scaleTraversalBounds.width * 0.55,
		scaleTraversalBounds.y + scaleTraversalBounds.height * 0.5,
	);
	await scalePage.mouse.down({ button: "right" });
	await scalePage.mouse.move(
		scaleTraversalBounds.x + scaleTraversalBounds.width * 0.44,
		scaleTraversalBounds.y + scaleTraversalBounds.height * 0.6,
		{ steps: 12 },
	);
	await scalePage.mouse.up({ button: "right" });
	await waitForAnimationFrames(scalePage, 2);
	await scaleCanvas3D.focus();
	for (let step = 0; step < 4; step++) {
		await scalePage.keyboard.press("a");
		await waitForAnimationFrames(scalePage, 2);
	}
	for (let step = 0; step < 8; step++) {
		await scalePage.keyboard.press("d");
		await waitForAnimationFrames(scalePage, 2);
	}
	const scaleTraversalReadyAt = await scalePage.evaluate(() => performance.now());
	const scaleTraversalScene = await readSceneStats(scaleCanvas3D);
	const scaleTraversalHeapAfter = await readJsHeap(scalePage);
	const scaleTraversalLongTasks = await readLongTasksSince(scalePage, scaleTraversalStartedAt);
	const scaleTraversalRenderFrames =
		scaleTraversalScene.renderFrames - scaleTraversalBefore.renderFrames;
	const scaleTraversalRenderMainThreadMilliseconds = Math.max(
		0,
		scaleTraversalScene.renderMainThreadTotalMilliseconds -
			scaleTraversalBefore.renderMainThreadTotalMilliseconds,
	);
	const scaleTraversalChunkUpdateMilliseconds = Math.max(
		0,
		scaleTraversalScene.chunkUpdateTotalMilliseconds -
			scaleTraversalBefore.chunkUpdateTotalMilliseconds,
	);
	result.scale50k.traversal = {
		elapsedMilliseconds: scaleTraversalReadyAt - scaleTraversalStartedAt,
		heapDelta: Math.max(0, scaleTraversalHeapAfter - scaleTraversalHeapBefore),
		renderFrames: scaleTraversalRenderFrames,
		renderMainThreadMilliseconds: scaleTraversalRenderMainThreadMilliseconds,
		averageRenderMainThreadMilliseconds:
			scaleTraversalRenderFrames > 0
				? scaleTraversalRenderMainThreadMilliseconds / scaleTraversalRenderFrames
				: Number.POSITIVE_INFINITY,
		chunkUpdateMilliseconds: scaleTraversalChunkUpdateMilliseconds,
		averageChunkUpdateMilliseconds:
			scaleTraversalRenderFrames > 0
				? scaleTraversalChunkUpdateMilliseconds / scaleTraversalRenderFrames
				: Number.POSITIVE_INFINITY,
		longTasks: scaleTraversalLongTasks,
		...scaleTraversalScene,
	};
	assertAtLeast(scaleTraversalRenderFrames, 14, "50k traversal measured render frames");
	assertEqual(
		scaleTraversalScene.contentBuilds,
		scaleTraversalBefore.contentBuilds,
		"50k traversal does not rebuild Scene content or equipment shell",
	);
	assertEqual(
		scaleTraversalScene.equipmentShellPreparationMilliseconds,
		scaleTraversalBefore.equipmentShellPreparationMilliseconds,
		"50k traversal preserves the prepared equipment shell",
	);
	for (const [field, label] of [
		["equipmentSections", "canonical equipment sections"],
		["equipmentShellSpans", "equipment shell spans"],
		["portInstances", "port instances"],
		["portSlotInstances", "stable port-slot instances"],
	]) {
		assertEqual(
			scaleTraversalScene[field],
			scaleTraversalBefore[field],
			`50k traversal preserves ${label}`,
		);
	}
	assertEqual(
		scaleTraversalScene.viewportRenders,
		scaleTraversalBefore.viewportRenders,
		"50k traversal publishes no React viewport state",
	);
	assertAtLeast(
		scaleTraversalScene.chunkSetUpdates,
		scaleTraversalBefore.chunkSetUpdates + scaleTraversalRenderFrames,
		"50k traversal updates only the imperative detail set",
	);
	assertAtMost(
		result.scale50k.traversal.averageRenderMainThreadMilliseconds,
		16.7,
		"50k traversal average main-thread render work",
	);
	assertAtMost(
		result.scale50k.traversal.renderMainThreadMaximumMilliseconds,
		50,
		"50k traversal maximum main-thread render work",
	);
	assertAtMost(
		result.scale50k.traversal.averageChunkUpdateMilliseconds,
		8,
		"50k traversal average rail chunk update work",
	);
	assertAtMost(
		result.scale50k.traversal.heapDelta,
		64 * 1024 * 1024,
		"50k traversal JS heap growth budget",
	);
	assertAtMost(scaleTraversalScene.visibleRailChunks, 24, "50k traversal visible chunk budget");
	assertAtMost(scaleTraversalScene.residentRailChunks, 48, "50k traversal resident chunk budget");
	assertEqual(scaleTraversalLongTasks.length, 0, "50k traversal Long Tasks");
	assertEqual(
		await inspection3DWorkerStarts(scalePage),
		scaleWorkersBefore + 1,
		"50k traversal starts no artifact Worker",
	);
	assertScaleEquipmentIdentity(
		await readSelectedEquipmentIdentity(scalePage),
		scaleEquipmentTarget,
		"50k selection after traversal",
	);
	const scalePickFrameDistanceBefore = scaleTraversalScene.cameraDistance;
	await scalePage.getByRole("button", { name: "선택 전체 프레임", exact: true }).click();
	await scalePage.waitForFunction(
		(previousDistance) => {
			const canvas = document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]');
			return (
				canvas?.dataset.sceneFrameScope === "selection" &&
				Number(canvas.dataset.sceneCameraDistance) < Number(previousDistance) * 0.1
			);
		},
		scalePickFrameDistanceBefore,
		{ timeout: 10_000 },
	);
	const scaleLayerMenu = scalePage.getByRole("button", { name: "3D 표시 레이어", exact: true });
	await scaleLayerMenu.click();
	await scalePage.getByRole("button", { name: "3D 레일 표시", exact: true }).click();
	await waitForCanvasDataset(scalePage, "sceneRailVisible", "false");
	await scalePage.getByRole("button", { name: "3D 스위치 하드웨어 표시", exact: true }).click();
	await waitForCanvasDataset(scalePage, "sceneSwitchesVisible", "false");
	await scaleLayerMenu.click();
	await waitForAnimationFrames(scalePage, 2);
	const scalePickBefore = await readSceneStats(scaleCanvas3D);
	const scalePickHeapBefore = await readJsHeap(scalePage);
	const scaleClearBeforeBody = await clearScale3DSelection(scalePage, scaleCanvas3D);
	const scaleBodyPick = await pickVisibleScaleEquipment(
		scalePage,
		scaleCanvas3D,
		"body",
		scaleEquipmentTarget,
	);
	const scaleClearBeforePort = await clearScale3DSelection(scalePage, scaleCanvas3D);
	const scalePortPick = await pickVisibleScaleEquipment(scalePage, scaleCanvas3D, "port", null);
	const scalePickScene = await readSceneStats(scaleCanvas3D);
	const scalePickHeapAfter = await readJsHeap(scalePage);
	const scalePickLongTasks = [
		...scaleClearBeforeBody.longTasks,
		...scaleBodyPick.longTasks,
		...scaleClearBeforePort.longTasks,
		...scalePortPick.longTasks,
	];
	result.scale50k.picking = {
		clearBeforeBody: scaleClearBeforeBody,
		port: scalePortPick,
		clearBeforePort: scaleClearBeforePort,
		body: scaleBodyPick,
		heapDelta: Math.max(0, scalePickHeapAfter - scalePickHeapBefore),
		longTasks: scalePickLongTasks,
		...scalePickScene,
	};
	assertAtMost(scalePortPick.pickMilliseconds, 50, "50k visible port pick main-thread work");
	assertAtMost(scaleBodyPick.pickMilliseconds, 50, "50k visible body pick main-thread work");
	assertAtMost(
		scalePickScene.pickMainThreadMaximumMilliseconds,
		50,
		"50k equipment pick cumulative main-thread ceiling",
	);
	assertAtMost(
		result.scale50k.picking.heapDelta,
		32 * 1024 * 1024,
		"50k equipment pick JS heap growth budget",
	);
	assertEqual(scalePickLongTasks.length, 0, "50k equipment pick Long Tasks");
	assertEqual(
		scalePickScene.contentBuilds,
		scalePickBefore.contentBuilds,
		"50k equipment picks do not rebuild Scene content",
	);
	assertEqual(
		scalePickScene.equipmentShellPreparationMilliseconds,
		scalePickBefore.equipmentShellPreparationMilliseconds,
		"50k equipment picks preserve the prepared shell",
	);
	assertEqual(
		await inspection3DWorkerStarts(scalePage),
		scaleWorkersBefore + 1,
		"50k equipment picks start no artifact Worker",
	);
	assertIdentityEqual(
		await readCanonicalIdentity(scalePage),
		scaleIdentity,
		"after 50k 3D inspection",
	);
	await scalePage.screenshot({ path: path.join(artifactRoot, "scale-50k.png") });
	await scalePage.close();
	assertEqual(result.pageErrors.length, 0, "3D page errors");
	assertEqual(result.consoleErrors.length, 0, "3D console errors");

	result.status = "PASS";
	console.log(
		`PASS Static FAB 3D | ${result.scene.triangles} triangles | ${result.scene.pickSegments} pick segments | ${result.selectedModuleId}`,
	);
} catch (error) {
	result.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	throw error;
} finally {
	if (page) {
		await page.screenshot({ path: path.join(artifactRoot, "final.png") }).catch(() => undefined);
		await closeBrowserResource(page, "page");
		page = null;
	}
	await closeBrowserResource(context, "browser context");
	context = null;
	await writeFile(
		path.join(artifactRoot, "result.json"),
		`${JSON.stringify(result, null, 2)}\n`,
	).catch(() => undefined);
	await closeBrowserResource(browser, "browser");
	server.kill("SIGTERM");
}

process.exit(result.status === "PASS" ? 0 : 1);

async function chooseBlankCanvasForFirstRun(activePage) {
	const dialog = activePage.getByTestId("openfab-start-dialog");
	await dialog.waitFor({ state: "visible" });
	await dialog.getByRole("button", { name: /BLANK CANVAS/ }).click();
	await dialog.waitFor({ state: "hidden" });
}

async function waitForReady(activePage, physicalPaths, timeout = 15_000) {
	await activePage.waitForFunction(
		(expectedPaths) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				canvas.dataset.physicalPaths === String(expectedPaths)
			);
		},
		physicalPaths,
		{ timeout },
	);
}

async function waitForMirrorIdle(activePage, minimumSequence = 0) {
	await activePage.waitForFunction(
		(expectedSequence) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				Number(canvas.dataset.workerSequence) >= expectedSequence
			);
		},
		minimumSequence,
		{ timeout: 10_000 },
	);
}

async function waitForView(activePage, mode) {
	await activePage.waitForFunction(
		(expected) =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.viewMode === expected,
		mode,
		{ timeout: 5_000 },
	);
}

async function continueWithoutSavingIfVisible(activePage) {
	const discard = activePage.getByRole("button", { name: "저장하지 않고 계속" });
	if (await discard.isVisible().catch(() => false)) await discard.click();
}

async function syntheticStarterWorkerStarts(activePage) {
	return activePage.evaluate(
		() => globalThis.__openfab3DAcceptanceWorkerStarts?.syntheticFabStarter ?? -1,
	);
}

async function certifiedArtifactWorkerStats(activePage) {
	return activePage.evaluate(() => {
		const starts = globalThis.__openfab3DAcceptanceWorkerStarts;
		return {
			started: starts?.syntheticFabStarterCertifiedArtifact ?? -1,
			active: starts?.syntheticFabStarterCertifiedArtifactActive ?? -1,
			terminated: starts?.syntheticFabStarterCertifiedArtifactTerminated ?? -1,
			createdAt: starts?.syntheticFabStarterCertifiedArtifactCreatedAt ?? null,
			messageAt: starts?.syntheticFabStarterCertifiedArtifactMessageAt ?? null,
			terminatedAt: starts?.syntheticFabStarterCertifiedArtifactTerminatedAt ?? null,
		};
	});
}

async function startCertifiedPresetStageProbe(activePage) {
	return activePage.evaluate(() => {
		globalThis.__openfabCertifiedPresetStageProbe?.observer?.disconnect();
		const probe = {
			startedAt: performance.now(),
			artifactHydratedAt: null,
			projectOperationStartedAt: null,
			projectReadyAt: null,
			exactCanvasPaintedAt: null,
			exactCanvasPaintScheduled: false,
			observer: null,
		};
		const scan = () => {
			const now = performance.now();
			const preview = document.querySelector('[data-testid="synthetic-fab-starter-preview"]');
			if (
				probe.artifactHydratedAt === null &&
				preview?.getAttribute("data-preview-state") === "ready" &&
				preview.getAttribute("data-preview-source") === "certified"
			) {
				probe.artifactHydratedAt = now;
			}
			const app = document.querySelector('[data-testid="tilefab-app"]');
			if (
				probe.projectOperationStartedAt === null &&
				app?.getAttribute("data-project-operation") === "creating"
			) {
				probe.projectOperationStartedAt = now;
			}
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			if (
				probe.projectReadyAt === null &&
				canvas?.dataset.projectName === "OpenFab 60-Bay Rail Foundation" &&
				canvas.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				Number(canvas.dataset.authoredCells) >= 30_000
			) {
				probe.projectReadyAt = now;
			}
			if (probe.projectReadyAt !== null && !probe.exactCanvasPaintScheduled) {
				probe.exactCanvasPaintScheduled = true;
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						probe.exactCanvasPaintedAt = performance.now();
					});
				});
			}
		};
		probe.observer = new MutationObserver(scan);
		probe.observer.observe(document.documentElement, {
			subtree: true,
			attributes: true,
			attributeFilter: [
				"data-preview-state",
				"data-preview-source",
				"data-project-operation",
				"data-project-name",
				"data-startup-status",
				"data-worker-status",
				"data-model-sync-pending",
				"data-authored-cells",
			],
		});
		globalThis.__openfabCertifiedPresetStageProbe = probe;
		scan();
		return probe.startedAt;
	});
}

async function readCertifiedPresetStages(activePage, activationStartedAt) {
	return activePage.evaluate((startedAt) => {
		const probe = globalThis.__openfabCertifiedPresetStageProbe;
		if (
			!probe ||
			probe.artifactHydratedAt === null ||
			probe.projectOperationStartedAt === null ||
			probe.projectReadyAt === null ||
			probe.exactCanvasPaintedAt === null
		) {
			throw new Error(`Certified preset stage probe is incomplete: ${JSON.stringify(probe)}`);
		}
		probe.observer?.disconnect();
		const resource = performance
			.getEntriesByType("resource")
			.filter((entry) => /production-fab-60\.default[^/]*\.js(?:\?|$)/i.test(entry.name))
			.at(-1);
		if (!resource) throw new Error("Certified preset resource timing is unavailable.");
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		if (!(canvas instanceof HTMLCanvasElement)) {
			throw new Error("Certified preset Canvas timing telemetry is unavailable.");
		}
		return {
			artifactRequestStartedAt: resource.startTime,
			artifactResponseEndedAt: resource.responseEnd,
			artifactHydratedAt: probe.artifactHydratedAt,
			projectOperationStartedAt: probe.projectOperationStartedAt,
			projectReadyAt: probe.projectReadyAt,
			exactCanvasPaintedAt: probe.exactCanvasPaintedAt,
			artifactRequestStartedMilliseconds: resource.startTime - startedAt,
			artifactResponseEndedMilliseconds: resource.responseEnd - startedAt,
			artifactHydratedMilliseconds: probe.artifactHydratedAt - startedAt,
			projectOperationStartedMilliseconds: probe.projectOperationStartedAt - startedAt,
			projectReadyMilliseconds: probe.projectReadyAt - startedAt,
			exactCanvasPaintedMilliseconds: probe.exactCanvasPaintedAt - startedAt,
			artifactTransferBytes: resource.transferSize,
			artifactDecodedBytes: resource.decodedBodySize,
			startupWorkerMilliseconds: Number(canvas.dataset.startupWorkerTotalMs ?? 0),
			startupActivationMilliseconds: Number(canvas.dataset.startupActivationTotalMs ?? 0),
			startupActivationMaxSliceMilliseconds: Number(
				canvas.dataset.startupActivationMaxSliceMs ?? 0,
			),
			startupActivationMaxSlicePhase: canvas.dataset.startupActivationMaxSlicePhase ?? "",
			startupActivationYields: Number(canvas.dataset.startupActivationYields ?? 0),
		};
	}, activationStartedAt);
}

async function inspection3DWorkerStarts(activePage) {
	return activePage.evaluate(
		() => globalThis.__openfab3DAcceptanceWorkerStarts?.staticFabInspection3D ?? -1,
	);
}

async function waitFor3DScene(activePage, canvas, timeout = 15_000) {
	await canvas.waitFor({ state: "visible", timeout });
	await activePage.waitForFunction(
		() =>
			Number(
				document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')?.dataset
					.sceneTriangles,
			) > 0,
		undefined,
		{ timeout },
	);
}

async function waitForCanvasDataset(activePage, field, expected) {
	await activePage.waitForFunction(
		({ key, value }) =>
			document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')?.dataset[key] ===
			value,
		{ key: field, value: expected },
		{ timeout: 2_000 },
	);
}

async function waitForAnimationFrames(activePage, count) {
	await activePage.evaluate(
		(frameCount) =>
			new Promise((resolve) => {
				let remaining = frameCount;
				const next = () => {
					remaining--;
					if (remaining <= 0) resolve();
					else requestAnimationFrame(next);
				};
				requestAnimationFrame(next);
			}),
		count,
	);
}

async function readLongTasksSince(activePage, startedAt) {
	return activePage.evaluate((start) => {
		const entries = globalThis.__openfab3DAcceptanceLongTasks ?? [];
		for (const entry of globalThis.__openfab3DAcceptanceLongTaskObserver?.takeRecords() ?? []) {
			entries.push({ startTime: entry.startTime, duration: entry.duration });
		}
		return entries.filter((entry) => entry.startTime >= start);
	}, startedAt);
}

async function readJsHeap(activePage) {
	return activePage.evaluate(() => Number(globalThis.performance?.memory?.usedJSHeapSize ?? 0));
}

function maximumLongTask(entries) {
	return Math.max(0, ...entries.map((entry) => entry.duration));
}

function totalLongTask(entries) {
	return entries.reduce((total, entry) => total + entry.duration, 0);
}

function summarizeLongTasksBetween(entries, startedAt, endedAt) {
	const withinStage = entries.filter(
		(entry) => entry.startTime >= startedAt && entry.startTime < endedAt,
	);
	return {
		count: withinStage.length,
		maximumMilliseconds: maximumLongTask(withinStage),
		totalMilliseconds: totalLongTask(withinStage),
		entries: withinStage,
	};
}

function summarizeCpuProfile(profile, startedMilliseconds = 0, endedMilliseconds = Infinity) {
	const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
	const selfMicroseconds = new Map();
	let elapsedMicroseconds = 0;
	for (let index = 0; index < (profile.samples?.length ?? 0); index++) {
		const nodeId = profile.samples[index];
		const elapsed = profile.timeDeltas?.[index] ?? 0;
		elapsedMicroseconds += elapsed;
		if (
			elapsedMicroseconds < startedMilliseconds * 1_000 ||
			elapsedMicroseconds >= endedMilliseconds * 1_000
		) {
			continue;
		}
		selfMicroseconds.set(nodeId, (selfMicroseconds.get(nodeId) ?? 0) + elapsed);
	}
	return [...selfMicroseconds.entries()]
		.map(([nodeId, microseconds]) => {
			const frame = nodes.get(nodeId)?.callFrame;
			return {
				functionName: frame?.functionName || "(anonymous)",
				url: frame?.url ?? "",
				lineNumber: (frame?.lineNumber ?? -1) + 1,
				columnNumber: (frame?.columnNumber ?? -1) + 1,
				selfMilliseconds: microseconds / 1_000,
			};
		})
		.sort((left, right) => right.selfMilliseconds - left.selfMilliseconds)
		.slice(0, 50);
}

async function assertSemanticPresetSchematic(activePage) {
	const preview = activePage.getByTestId("synthetic-fab-starter-preview");
	assertEqual(
		await preview.locator("canvas.tilefab-starter-exact-preview").count(),
		0,
		"production FAB omits oversized exact preview Canvas",
	);
	const roles = await preview
		.locator("svg.tilefab-starter-schematic-preview path[data-role]")
		.evaluateAll((paths) => paths.map((path) => path.getAttribute("data-role")));
	for (const role of ["outer", "spine", "process"]) {
		if (!roles.includes(role)) throw new Error(`Production FAB schematic has no ${role} path.`);
	}
}

async function readCanonicalIdentity(activePage) {
	return activePage.getByTestId("rail-canvas").evaluate((canvas) => ({
		projectId: canvas.dataset.projectId ?? "",
		projectName: canvas.dataset.projectName ?? "",
		projectDirty: canvas.dataset.projectDirty ?? "",
		modelGeneration: canvas.dataset.modelGeneration ?? "",
		authoredCells: canvas.dataset.authoredCells ?? "",
		authoredEdges: canvas.dataset.authoredEdges ?? "",
		physicalPaths: canvas.dataset.physicalPaths ?? "",
		workerSequence: canvas.dataset.workerSequence ?? "",
		workerChecksum: canvas.dataset.workerChecksum ?? "",
		workerPhysicalFingerprint: canvas.dataset.workerPhysicalFingerprint ?? "",
		workerSimulationReady: canvas.dataset.workerSimulationReady ?? "",
		workerStatus: canvas.dataset.workerStatus ?? "",
	}));
}

async function readSceneStats(canvas) {
	return canvas.evaluate((element) => ({
		generation: Number(element.dataset.sceneGeneration ?? -1),
		artifactBytes: Number(element.dataset.sceneArtifactBytes ?? 0),
		triangles: Number(element.dataset.sceneTriangles ?? 0),
		pickSegments: Number(element.dataset.scenePickSegments ?? 0),
		objects: Number(element.dataset.sceneObjects ?? 0),
		instancedMeshes: Number(element.dataset.sceneInstancedMeshes ?? 0),
		pickProxies: Number(element.dataset.scenePickProxies ?? 0),
		contentBuilds: Number(element.dataset.sceneContentBuilds ?? 0),
		selectionApplies: Number(element.dataset.sceneSelectionApplies ?? 0),
		cameraDistance: Number(element.dataset.sceneCameraDistance ?? 0),
		cameraTargetX: Number(element.dataset.sceneCameraTargetX ?? 0),
		cameraTargetZ: Number(element.dataset.sceneCameraTargetZ ?? 0),
		railChunks: Number(element.dataset.sceneRailChunks ?? 0),
		visibleRailChunks: Number(element.dataset.sceneVisibleRailChunks ?? 0),
		residentRailChunks: Number(element.dataset.sceneResidentRailChunks ?? 0),
		chunkSetUpdates: Number(element.dataset.sceneChunkSetUpdates ?? 0),
		chunkMaterializations: Number(element.dataset.sceneChunkMaterializations ?? 0),
		chunkEvictions: Number(element.dataset.sceneChunkEvictions ?? 0),
		renderFrames: Number(element.dataset.sceneRenderFrames ?? 0),
		renderMainThreadTotalMilliseconds: Number(element.dataset.sceneRenderMainThreadTotalMs ?? 0),
		renderMainThreadMaximumMilliseconds: Number(
			element.dataset.sceneRenderMainThreadMaximumMs ?? 0,
		),
		chunkUpdateTotalMilliseconds: Number(element.dataset.sceneChunkUpdateTotalMs ?? 0),
		chunkUpdateMaximumMilliseconds: Number(element.dataset.sceneChunkUpdateMaximumMs ?? 0),
		pickAttempts: Number(element.dataset.scenePickAttempts ?? 0),
		pickMainThreadTotalMilliseconds: Number(element.dataset.scenePickMainThreadTotalMs ?? 0),
		pickMainThreadMaximumMilliseconds: Number(element.dataset.scenePickMainThreadMaximumMs ?? 0),
		pickMainThreadLastMilliseconds: Number(element.dataset.scenePickMainThreadLastMs ?? 0),
		lastPickSource: element.dataset.sceneLastPickSource ?? "",
		viewportRenders: Number(element.dataset.viewportRenders ?? 0),
		advancedSwitchInstances: Number(element.dataset.sceneAdvancedSwitchInstances ?? 0),
		equipmentSections: Number(element.dataset.sceneEquipmentInstances ?? 0),
		equipmentShellSpans: Number(element.dataset.sceneEquipmentShellSpans ?? 0),
		equipmentShellPreparationMilliseconds: Number(
			element.dataset.sceneEquipmentShellPreparationMs ?? 0,
		),
		portInstances: Number(element.dataset.scenePortInstances ?? 0),
		portSlotInstances: Number(element.dataset.scenePortSlotInstances ?? 0),
		railVisible: element.dataset.sceneRailVisible === "true",
		switchesVisible: element.dataset.sceneSwitchesVisible === "true",
		equipmentVisible: element.dataset.sceneEquipmentVisible === "true",
	}));
}

async function selectScaleEquipmentTargetIn2D(activePage, target) {
	const inspectActivity = activePage.getByTestId("editor-activity-inspect");
	if ((await inspectActivity.getAttribute("aria-pressed")) !== "true") {
		await inspectActivity.click();
	}
	const inspectCommand = activePage.getByRole("button", { name: "선택 및 정보", exact: true });
	await inspectCommand.waitFor({ state: "visible" });
	await inspectCommand.click();
	const canvas = activePage.getByTestId("rail-canvas");
	let point = await screenPointForWorld(activePage, { x: target.worldX, y: target.worldZ });
	await activePage.mouse.move(point.x, point.y);
	for (let step = 0; step < 48; step++) await activePage.mouse.wheel(0, -120);
	await waitForAnimationFrames(activePage, 2);
	point = await screenPointForWorld(activePage, { x: target.worldX, y: target.worldZ });
	const bounds = await canvas.boundingBox();
	if (
		!bounds ||
		point.x < bounds.x ||
		point.x > bounds.x + bounds.width ||
		point.y < bounds.y ||
		point.y > bounds.y + bounds.height
	) {
		throw new Error(
			`50k equipment target is outside the visible 2D Canvas: ${JSON.stringify(point)}`,
		);
	}
	await activePage.mouse.click(point.x, point.y);
	await activePage.waitForFunction(
		(expected) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				app?.getAttribute("data-selected-port-id") === String(expected.portId) &&
				app.getAttribute("data-selected-equipment-group-id") === String(expected.equipmentGroupId)
			);
		},
		target,
		{ timeout: 5_000 },
	);
}

async function clearScale3DSelection(activePage, canvas) {
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("50k 3D equipment Canvas has no visible bounds.");
	for (const [offsetX, offsetY] of [
		[8, 8],
		[bounds.width - 8, 8],
		[8, bounds.height - 8],
		[bounds.width - 8, bounds.height - 8],
	]) {
		const before = await readSceneStats(canvas);
		const startedAt = await activePage.evaluate(() => performance.now());
		await activePage.mouse.click(bounds.x + offsetX, bounds.y + offsetY);
		await activePage.waitForFunction(
			(previousAttempts) =>
				Number(
					document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')?.dataset
						.scenePickAttempts,
				) > previousAttempts,
			before.pickAttempts,
			{ timeout: 5_000 },
		);
		const after = await readSceneStats(canvas);
		const selected = await readSelectedEquipmentIdentity(activePage);
		if (
			after.lastPickSource === "none" &&
			selected.portId === null &&
			selected.equipmentGroupId === null
		) {
			return Object.freeze({
				pickMilliseconds: after.pickMainThreadLastMilliseconds,
				pickSource: after.lastPickSource,
				longTasks: await readLongTasksSince(activePage, startedAt),
			});
		}
	}
	throw new Error("50k 3D equipment selection could not be cleared at a visible Canvas corner.");
}

async function pickVisibleScaleEquipment(activePage, canvas, kind, expected) {
	const image = await canvas.screenshot();
	await writeFile(path.join(artifactRoot, `scale-50k-pick-${kind}.png`), image);
	const candidates = await activePage.evaluate(
		async ({ dataUrl, candidateKind }) => {
			const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
			const scratch = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = scratch.getContext("2d", { willReadFrequently: true });
			if (!context) return [];
			context.drawImage(bitmap, 0, 0);
			const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
			const points = [];
			const matchesPortAt = (x, y) => {
				const offset = (y * bitmap.width + x) * 4;
				const red = pixels[offset] ?? 0;
				const green = pixels[offset + 1] ?? 0;
				const blue = pixels[offset + 2] ?? 0;
				return green > 180 && blue > 170 && green > red * 1.12 && blue > red * 1.02;
			};
			const matchesBodyAt = (x, y) => {
				const offset = (y * bitmap.width + x) * 4;
				const red = pixels[offset] ?? 0;
				const green = pixels[offset + 1] ?? 0;
				const blue = pixels[offset + 2] ?? 0;
				const teal = green > 35 && green > red * 1.08 && blue > red && blue < 175;
				const neutral =
					red > 38 &&
					green > 38 &&
					blue > 34 &&
					Math.max(red, green, blue) - Math.min(red, green, blue) < 48 &&
					red < 190;
				return (teal || neutral) && !matchesPortAt(x, y);
			};
			for (let y = 4; y < bitmap.height - 4; y += 2) {
				for (let x = 4; x < bitmap.width - 4; x += 2) {
					const matches = candidateKind === "port" ? matchesPortAt(x, y) : matchesBodyAt(x, y);
					if (!matches) continue;
					let nearPort = false;
					if (candidateKind === "body") {
						for (
							let nearbyY = Math.max(0, y - 8);
							nearbyY <= Math.min(bitmap.height - 1, y + 8);
							nearbyY += 2
						) {
							for (
								let nearbyX = Math.max(0, x - 8);
								nearbyX <= Math.min(bitmap.width - 1, x + 8);
								nearbyX += 2
							) {
								if (matchesPortAt(nearbyX, nearbyY)) {
									nearPort = true;
									break;
								}
							}
							if (nearPort) break;
						}
					}
					if (!nearPort) points.push({ x, y });
				}
				if (y % 32 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
			}
			const centerX = bitmap.width / 2;
			const centerY = bitmap.height / 2;
			points.sort(
				(left, right) =>
					(left.x - centerX) ** 2 +
					(left.y - centerY) ** 2 -
					((right.x - centerX) ** 2 + (right.y - centerY) ** 2),
			);
			bitmap.close();
			return points.slice(0, 240);
		},
		{
			dataUrl: `data:image/png;base64,${image.toString("base64")}`,
			candidateKind: kind,
		},
	);
	if (candidates.length === 0) throw new Error(`No visible 50k equipment ${kind} pixels found.`);
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("50k 3D equipment Canvas has no visible bounds.");
	const expectedSource = kind === "port" ? "port" : "equipment-body";
	const diagnostics = { sources: {}, samples: [], maximumPickMilliseconds: 0 };
	const interactionLongTasks = [];
	for (const candidate of candidates) {
		const before = await readSceneStats(canvas);
		const pageX = bounds.x + candidate.x;
		const pageY = bounds.y + candidate.y;
		const startedAt = await activePage.evaluate(() => performance.now());
		await activePage.mouse.click(pageX, pageY);
		await activePage.waitForFunction(
			(previousAttempts) =>
				Number(
					document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')?.dataset
						.scenePickAttempts,
				) > previousAttempts,
			before.pickAttempts,
			{ timeout: 5_000 },
		);
		const after = await readSceneStats(canvas);
		const selected = await readSelectedEquipmentIdentity(activePage);
		interactionLongTasks.push(...(await readLongTasksSince(activePage, startedAt)));
		diagnostics.sources[after.lastPickSource] =
			(diagnostics.sources[after.lastPickSource] ?? 0) + 1;
		diagnostics.maximumPickMilliseconds = Math.max(
			diagnostics.maximumPickMilliseconds,
			after.pickMainThreadLastMilliseconds,
		);
		if (diagnostics.samples.length < 8) {
			diagnostics.samples.push({ candidate, source: after.lastPickSource, selected });
		}
		const identityMatches = expected
			? selected.portId === expected.portId &&
				selected.equipmentGroupId === expected.equipmentGroupId
			: selected.portId !== null &&
				selected.portId >= 1 &&
				selected.portId <= 50_000 &&
				selected.equipmentGroupId === selected.portId;
		if (after.lastPickSource === expectedSource && identityMatches) {
			return Object.freeze({
				portId: selected.portId,
				equipmentGroupId: selected.equipmentGroupId,
				pickSource: after.lastPickSource,
				pickMilliseconds: after.pickMainThreadLastMilliseconds,
				longTasks: interactionLongTasks,
				pageX,
				pageY,
			});
		}
	}
	throw new Error(
		`Visible 50k equipment ${kind} pixels did not resolve a canonical framed identity: ${JSON.stringify(diagnostics)}.`,
	);
}

async function readSelectedEquipmentIdentity(activePage) {
	return activePage.getByTestId("tilefab-app").evaluate((element) => {
		const portId = Number(element.dataset.selectedPortId);
		const equipmentGroupId = Number(element.dataset.selectedEquipmentGroupId);
		return {
			portId: Number.isSafeInteger(portId) && portId > 0 ? portId : null,
			equipmentGroupId:
				Number.isSafeInteger(equipmentGroupId) && equipmentGroupId > 0 ? equipmentGroupId : null,
		};
	});
}

function assertScaleEquipmentIdentity(actual, expected, label) {
	assertEqual(actual.portId, expected.portId, `${label} port ID`);
	assertEqual(actual.equipmentGroupId, expected.equipmentGroupId, `${label} equipment-group ID`);
}

async function analyzeScreenshot(activePage, image) {
	return activePage.evaluate(
		async (dataUrl) => {
			const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
			const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = canvas.getContext("2d", { willReadFrequently: true });
			if (!context) throw new Error("Screenshot analysis context is unavailable.");
			context.drawImage(bitmap, 0, 0);
			const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
			let railLike = 0;
			let nonBackground = 0;
			for (let offset = 0; offset < pixels.length; offset += 4) {
				const red = pixels[offset] ?? 0;
				const green = pixels[offset + 1] ?? 0;
				const blue = pixels[offset + 2] ?? 0;
				if (red + green + blue > 42) nonBackground++;
				if (green > 100 && blue > 100 && green > red * 1.05) railLike++;
			}
			bitmap.close();
			return { width: canvas.width, height: canvas.height, railLike, nonBackground };
		},
		`data:image/png;base64,${image.toString("base64")}`,
	);
}

async function pickVisibleRail(activePage, canvas) {
	const image = await canvas.screenshot();
	const candidates = await activePage.evaluate(
		async (dataUrl) => {
			const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
			const scratch = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = scratch.getContext("2d", { willReadFrequently: true });
			if (!context) return [];
			context.drawImage(bitmap, 0, 0);
			const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
			const points = [];
			for (let y = 6; y < bitmap.height - 6; y += 5) {
				for (let x = 6; x < bitmap.width - 6; x += 5) {
					const offset = (y * bitmap.width + x) * 4;
					const red = pixels[offset] ?? 0;
					const green = pixels[offset + 1] ?? 0;
					const blue = pixels[offset + 2] ?? 0;
					if (green > 125 && blue > 125 && green > red * 1.05) points.push({ x, y });
					if (points.length >= 80) break;
				}
				if (points.length >= 80) break;
			}
			bitmap.close();
			return points;
		},
		`data:image/png;base64,${image.toString("base64")}`,
	);
	const bounds = await canvas.boundingBox();
	if (!bounds) return { selectedModuleId: "", maximumPickMilliseconds: 0, pageX: 0, pageY: 0 };
	for (const candidate of candidates) {
		const pageX = bounds.x + candidate.x;
		const pageY = bounds.y + candidate.y;
		const startedAt = await activePage.evaluate(() => performance.now());
		await activePage.mouse.click(pageX, pageY);
		const selected = await activePage
			.getByTestId("rail-canvas")
			.getAttribute("data-selected-module-id");
		if (selected) {
			const readyAt = await activePage.evaluate(() => performance.now());
			return {
				selectedModuleId: selected,
				maximumPickMilliseconds: readyAt - startedAt,
				pageX,
				pageY,
			};
		}
	}
	return { selectedModuleId: "", maximumPickMilliseconds: 0, pageX: 0, pageY: 0 };
}

async function pickVisibleAdvancedSwitchHardware(activePage, canvas) {
	const image = await canvas.screenshot();
	const candidates = await activePage.evaluate(
		async (dataUrl) => {
			const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
			const scratch = new OffscreenCanvas(bitmap.width, bitmap.height);
			const context = scratch.getContext("2d", { willReadFrequently: true });
			if (!context) return [];
			context.drawImage(bitmap, 0, 0);
			const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
			const points = [];
			for (let y = 4; y < bitmap.height - 4; y += 2) {
				for (let x = 4; x < bitmap.width - 4; x += 2) {
					const offset = (y * bitmap.width + x) * 4;
					const red = pixels[offset] ?? 0;
					const green = pixels[offset + 1] ?? 0;
					const blue = pixels[offset + 2] ?? 0;
					if (red > 95 && green > 75 && blue < red * 0.75 && green > blue * 1.15) {
						points.push({ x, y });
					}
				}
			}
			const centerX = bitmap.width / 2;
			const centerY = bitmap.height / 2;
			const sorted = points
				.sort(
					(a, b) =>
						(a.x - centerX) ** 2 +
						(a.y - centerY) ** 2 -
						((b.x - centerX) ** 2 + (b.y - centerY) ** 2),
				)
				.slice(0, 240);
			bitmap.close();
			return sorted;
		},
		`data:image/png;base64,${image.toString("base64")}`,
	);
	const bounds = await canvas.boundingBox();
	if (!bounds) return { selectedModuleId: "", pickMilliseconds: 0, pageX: 0, pageY: 0 };
	for (const candidate of candidates) {
		const pageX = bounds.x + candidate.x;
		const pageY = bounds.y + candidate.y;
		const startedAt = await activePage.evaluate(() => performance.now());
		await activePage.mouse.click(pageX, pageY);
		const selectedModuleId =
			(await activePage.getByTestId("rail-canvas").getAttribute("data-selected-module-id")) ?? "";
		if (selectedModuleId.startsWith("SW-")) {
			return {
				selectedModuleId,
				pickMilliseconds: (await activePage.evaluate(() => performance.now())) - startedAt,
				pageX,
				pageY,
			};
		}
	}
	return { selectedModuleId: "", pickMilliseconds: 0, pageX: 0, pageY: 0 };
}

async function dragWorld(activePage, startWorld, endWorld) {
	const start = await screenPointForWorld(activePage, startWorld);
	const end = await screenPointForWorld(activePage, endWorld);
	await activePage.mouse.move(start.x, start.y);
	await activePage.mouse.down();
	await activePage.mouse.move(end.x, end.y, { steps: 10 });
	await activePage.mouse.up();
}

async function screenPointForWorld(activePage, world) {
	const canvas = activePage.getByTestId("rail-canvas");
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("Rail canvas has no bounds for world input.");
	const camera = await activePage.evaluate(() => {
		const value = globalThis.__tileFab?.camera;
		return value
			? { offsetX: Number(value.offsetX), offsetY: Number(value.offsetY), zoom: Number(value.zoom) }
			: null;
	});
	if (!camera) throw new Error("Rail camera is unavailable for world input.");
	return {
		x: bounds.x + camera.offsetX + world.x * camera.zoom,
		y: bounds.y + camera.offsetY + world.y * camera.zoom,
	};
}

async function assertMinimumTargetSize(activePage, selector, minimum, label) {
	const targets = activePage.locator(selector);
	const count = await targets.count();
	if (count === 0) throw new Error(`${label}: no matching target.`);
	for (let index = 0; index < count; index++) {
		const target = targets.nth(index);
		await target.scrollIntoViewIfNeeded();
		const bounds = await target.boundingBox();
		if (!bounds || bounds.width < minimum || bounds.height < minimum) {
			throw new Error(
				`${label} ${index}: expected at least ${minimum} CSS pixels, received ${JSON.stringify(bounds)}`,
			);
		}
		const centerX = bounds.x + bounds.width / 2;
		const centerY = bounds.y + bounds.height / 2;
		const hit = await target.evaluate(
			(element, point) => {
				const hitElement = document.elementFromPoint(point.x, point.y);
				return {
					hittable: hitElement === element || (hitElement !== null && element.contains(hitElement)),
					hitTag: hitElement?.tagName ?? "",
					hitClass: String(hitElement?.className ?? ""),
					hitLabel: hitElement?.getAttribute("aria-label") ?? "",
					hitButtonLabel: hitElement?.closest("button")?.getAttribute("aria-label") ?? "",
				};
			},
			{ x: centerX, y: centerY },
		);
		if (!hit.hittable) {
			throw new Error(`${label} ${index}: center point is occluded by ${JSON.stringify(hit)}.`);
		}
	}
}

function assertIdentityEqual(actual, expected, label) {
	assertEqual(JSON.stringify(actual), JSON.stringify(expected), `${label} canonical identity`);
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}

function assertAtLeast(actual, expected, label) {
	if (!(actual >= expected))
		throw new Error(`${label}: expected >= ${expected}, received ${actual}`);
}

function assertAtMost(actual, expected, label) {
	if (!(actual <= expected))
		throw new Error(`${label}: expected <= ${expected}, received ${actual}`);
}

function hashBuffer(buffer) {
	return createHash("sha256").update(buffer).digest("hex");
}

function startPreviewServer() {
	const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
	const child = spawn(
		process.execPath,
		[vite, "preview", "--host", host, "--port", String(port), "--strictPort"],
		{ cwd: root, stdio: ["ignore", "ignore", "pipe"] },
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
	throw new Error(`OpenFab 3D preview did not start at ${url}.`);
}

async function closeBrowserResource(resource, label) {
	if (!resource) return;
	let timeout;
	try {
		await Promise.race([
			resource.close(),
			new Promise((_, reject) => {
				timeout = setTimeout(
					() => reject(new Error(`${label} close timed out after 15 seconds.`)),
					15_000,
				);
			}),
		]);
	} catch (error) {
		console.warn(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timeout);
	}
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
			// Continue to the next supported executable.
		}
	}
	throw new Error("Chrome or Chromium is required for Static FAB 3D acceptance.");
}
