import { execFile, spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "static-fab-authoring");
const port = Number(process.env.OPENFAB_AUTHORING_PORT ?? 5202 + (process.pid % 997));
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const USER_BLUEPRINT_ACCEPTANCE_PAGE_SIZE = 24;
const PRESET_CATALOG_READY_BUDGET_MILLISECONDS = 2_000;
const PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS = 30_000;
const PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS = 20_000;
const NEW_FAB_PROFILE_PREPARATION_BUDGET_MILLISECONDS = 60_000;
const ATTACHED_BAY_FLOW_HYDRATION_BUDGET_MILLISECONDS = 10_000;
const ATTACHED_BAY_FLOW_WORKER_BUDGET_MILLISECONDS = 15_000;
const ATTACHED_BAY_FLOW_VALIDATION_BUDGET_MILLISECONDS = 2_000;
const ATTACHED_BAY_FLOW_ADOPTION_BUDGET_MILLISECONDS = 2_000;
const EDITOR_V1_RETAINED_HEAP_BUDGET_BYTES = 16 * 1024 * 1024;
const EDITOR_V1_HOST_RSS_GROWTH_BUDGET_BYTES = 128 * 1024 * 1024;
const DEFAULT_SINGLE_BAY_NAME = "Production Bay 1.1";
const DEFAULT_TWIN_BAY_NAME = "Production Bay 1.2";
// Visible ghost geometry is deliberately complete; collision planning remains sampled at 512 cells.
const ORGANIZATION_GHOST_MAX_VISIBLE_RAIL_CELLS = 16_384;
const GUIDED_ONLY_COMPLETE = new Error("Guided-only authoring acceptance completed.");
let contextualSaveResponsiveVerified = false;
const execFileAsync = promisify(execFile);
const chromePath = await resolveChromePath();
const server = startPreviewServer();
let browser;
let desktopPage;
let legacyLargeFabAcceptanceFixturePath = null;
const result = {
	status: "FAIL",
	failure: null,
	steps: [],
	phase4Audit: [],
	final: null,
	downloadBytes: 0,
	secondDownloadBytes: 0,
	consoleErrors: [],
	pageErrors: [],
	workerStarts: null,
};
const REQUIRED_PHASE4_CHECKPOINTS = Object.freeze([
	"large-fab-activated",
	"large-fab-organization-bundle",
	"large-fab-organization-arrangement",
	"large-fab-organization-details",
	"large-fab-authored-structure-routing",
	"large-fab-rail-and-organization",
	"large-fab-eq",
	"large-fab-eq-membership",
	"large-fab-flex-stk-membership",
	"large-fab-port-first-equipment",
	"large-fab-mixed-blueprint",
	"large-fab-actionable-checks",
	"large-fab-static-checks",
	"large-fab-native-reload",
	"large-fab-post-reload-edit",
	"large-fab-autosave-recovery",
]);

try {
	await mkdir(artifactRoot, { recursive: true });
	await waitForServer(`${baseUrl}/`);
	browser = await launchBrowserWithRetry();
	if (process.env.OPENFAB_GUIDED_ACCEPTANCE_ONLY === "1") {
		const guidedPortHandoff = await exerciseGuidedPortHandoffRegression(browser);
		recordStep("guided-port-handoff", guidedPortHandoff);
		result.status = "PASS";
		console.log(
			`PASS Guided Build acceptance | ${guidedPortHandoff.networkRepairCommits} network repairs | ${guidedPortHandoff.checkStatus} checks`,
		);
		throw GUIDED_ONLY_COMPLETE;
	}
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		acceptDownloads: true,
	});
	await context.addInitScript(() => {
		const NativeWorker = globalThis.Worker;
		const starts = {
			workerTotal: 0,
			workerTerminated: 0,
			workerLive: 0,
			workerLiveUrls: {},
			syntheticFabStarter: 0,
			stationProposal: 0,
			staticFabBayFlowEdit: 0,
			staticFabBayFlowEditTerminated: 0,
			staticFabBayFlowEditLive: 0,
			railMirror: 0,
			urls: [],
		};
		Object.defineProperty(globalThis, "__openfabAcceptanceWorkerStarts", {
			value: starts,
			configurable: false,
			writable: false,
		});
		globalThis.Worker = new Proxy(NativeWorker, {
			construct(target, argumentsList) {
				const url = String(argumentsList[0] ?? "");
				const isBayFlowEditWorker = /staticFabBayFlowEditWorker/i.test(url);
				const worker = Reflect.construct(target, argumentsList);
				starts.workerTotal += 1;
				starts.workerLive += 1;
				starts.workerLiveUrls[url] = (starts.workerLiveUrls[url] ?? 0) + 1;
				starts.urls.push(url);
				if (/syntheticFabStarterWorker/i.test(url)) {
					starts.syntheticFabStarter += 1;
				}
				if (/openFabStationProposalWorker/i.test(url)) starts.stationProposal += 1;
				if (isBayFlowEditWorker) {
					starts.staticFabBayFlowEdit += 1;
					starts.staticFabBayFlowEditLive += 1;
				}
				if (/railMirrorWorker/i.test(url)) starts.railMirror += 1;
				const nativeTerminate = worker.terminate;
				let terminated = false;
				Object.defineProperty(worker, "terminate", {
					configurable: true,
					value(...terminateArguments) {
						if (!terminated) {
							terminated = true;
							starts.workerTerminated += 1;
							starts.workerLive -= 1;
							const nextLiveForUrl = (starts.workerLiveUrls[url] ?? 1) - 1;
							if (nextLiveForUrl > 0) starts.workerLiveUrls[url] = nextLiveForUrl;
							else delete starts.workerLiveUrls[url];
							if (isBayFlowEditWorker) {
								starts.staticFabBayFlowEditTerminated += 1;
								starts.staticFabBayFlowEditLive -= 1;
							}
						}
						return Reflect.apply(nativeTerminate, this, terminateArguments);
					},
				});
				return worker;
			},
		});
	});
	desktopPage = await context.newPage();
	desktopPage.on("console", (message) => {
		if (message.type() === "error") result.consoleErrors.push(message.text());
	});
	desktopPage.on("pageerror", (error) => result.pageErrors.push(error.message));
	await desktopPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
	await waitForReady(desktopPage, { physicalPaths: 0 });
	const firstRunDialog = desktopPage.getByTestId("openfab-start-dialog");
	await firstRunDialog.waitFor({ state: "visible" });
	assertEqual(
		await desktopPage.getByTestId("tilefab-app").getAttribute("data-openfab-start-dialog"),
		"true",
		"first-run Guided Build choice",
	);
	const guidedBuildReleaseSurface = await exerciseGuidedBuildReleaseSurface(
		desktopPage,
		firstRunDialog,
	);
	const firstRunPreference = await desktopPage.evaluate(() =>
		JSON.parse(localStorage.getItem("openfab.guided-build.preferences.v1") ?? "null"),
	);
	assertEqual(firstRunPreference?.lastEntryChoice, "blank", "first-run preference choice");
	recordStep("guided-first-run-choice", {
		choice: firstRunPreference.lastEntryChoice,
		navigationAcknowledged: firstRunPreference.navigationAcknowledged,
		...guidedBuildReleaseSurface,
	});
	const expertBuildReleaseSurface = await exerciseExpertBuildReleaseSurface(desktopPage);
	recordStep("expert-build-release-surface", expertBuildReleaseSurface);

	const initialBlank = await readMetrics(desktopPage);
	const stationProposalReview = await exerciseStationProposalReviewEntry(desktopPage, initialBlank);
	recordStep("station-proposal-review-entry", stationProposalReview);
	const commandRegistry = await exerciseEditorCommandHelp(desktopPage, initialBlank);
	recordStep("editor-command-registry", commandRegistry);
	const bayAssemblyPreview = await openSyntheticFabStarter(desktopPage, "bay-assembly");
	assertEqual(bayAssemblyPreview.strongComponents, "1", "Bay Assembly preview network count");
	assertEqual(bayAssemblyPreview.openTerminals, "0", "Bay Assembly preview open terminal count");
	assertProjectUnchanged(await readMetrics(desktopPage), initialBlank, "Bay Assembly preview");
	await desktopPage.getByTestId("create-synthetic-fab-project").click();
	await continueWithoutSavingIfVisible(desktopPage, false);
	const bayAssembly = await waitForWorker(desktopPage, (metrics) => {
		return (
			metrics.physicalPaths === bayAssemblyPreview.physicalPaths &&
			metrics.workerChecksum === bayAssemblyPreview.authoredChecksum &&
			metrics.workerPhysicalFingerprint === bayAssemblyPreview.physicalFingerprint
		);
	});
	assertEqual(bayAssembly.projectName, "OpenFab Process Bay", "Bay Assembly project name");
	assertEqual(bayAssembly.strongComponents, "1", "Bay Assembly project network count");
	assertEqual(bayAssembly.openTerminals, "0", "Bay Assembly project open terminal count");
	assertEqual(bayAssembly.readinessReady, "true", "Bay Assembly authoring readiness");
	assertEqual(bayAssembly.workerSimulationReady, "false", "Bay Assembly simulation gate");
	recordStep("bay-assembly", bayAssembly);
	const arrangedBayAssemblies = await exerciseStaticFabArrangement(desktopPage, bayAssembly);
	recordStep("static-fab-arrangement", arrangedBayAssemblies);

	const defaultBayBank = await openSyntheticFabStarter(desktopPage, "bay-bank");
	const bayCount = desktopPage.getByTestId("synthetic-fab-parameter-bayCount");
	await bayCount.fill("6");
	const configuredBayBank = await waitForStarterPreview(
		desktopPage,
		(preview) => preview.physicalFingerprint !== defaultBayBank.physicalFingerprint,
	);
	assertAtLeast(
		Number(configuredBayBank.directedEdges),
		Number(defaultBayBank.directedEdges) + 1,
		"configured Bay Bank directed edges",
	);
	assertEqual(configuredBayBank.strongComponents, "1", "starter preview directed network count");
	assertEqual(configuredBayBank.openTerminals, "0", "starter preview open terminal count");
	assertProjectUnchanged(await readMetrics(desktopPage), arrangedBayAssemblies, "starter preview");
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "synthetic-starter-desktop.png"),
		fullPage: true,
	});
	await desktopPage.getByTestId("create-synthetic-fab-project").click();
	const guardCancel = desktopPage.getByRole("button", { name: "취소", exact: true });
	await guardCancel.waitFor({ state: "visible" });
	await guardCancel.click();
	await desktopPage.getByTestId("synthetic-fab-starter-dialog").waitFor({ state: "visible" });
	assertEqual(await bayCount.inputValue(), "6", "starter configuration after guard cancel");
	const preservedBayBank = await waitForStarterPreview(
		desktopPage,
		(preview) => preview.physicalFingerprint === configuredBayBank.physicalFingerprint,
	);
	assertEqual(
		preservedBayBank.authoredChecksum,
		configuredBayBank.authoredChecksum,
		"starter preview checksum after guard cancel",
	);
	await desktopPage.getByTestId("create-synthetic-fab-project").click();
	await continueWithoutSavingIfVisible(desktopPage, true);
	const starterFab = await waitForWorker(desktopPage, (metrics) => {
		return (
			metrics.physicalPaths === configuredBayBank.physicalPaths &&
			metrics.workerChecksum === configuredBayBank.authoredChecksum &&
			metrics.workerPhysicalFingerprint === configuredBayBank.physicalFingerprint
		);
	});
	assertEqual(starterFab.projectName, "OpenFab Bay Bank", "starter project name");
	assertEqual(starterFab.strongComponents, "1", "starter project directed network count");
	assertEqual(starterFab.openTerminals, "0", "starter project open terminal count");
	assertEqual(starterFab.readinessReady, "true", "starter project authoring readiness");
	assertEqual(starterFab.workerSimulationReady, "false", "starter project simulation gate");
	assertEqual(starterFab.equipmentGroups, "0", "starter project equipment groups");
	assertEqual(starterFab.equipmentPorts, "0", "starter project equipment ports");
	assertEqual(starterFab.projectBlueprints, "0", "starter project blueprints");
	assertEqual(starterFab.historyCanUndo, "false", "starter project undo history");
	assertEqual(starterFab.historyCanRedo, "false", "starter project redo history");
	recordStep("synthetic-fab-starter", starterFab);

	const starterFirstPath = await saveProject(desktopPage);
	const starterFirstJson = await readFile(starterFirstPath, "utf8");
	await reloadProjectFromFile(desktopPage, starterFirstPath);
	const starterReloaded = await readMetrics(desktopPage);
	assertBoundIdentity(starterReloaded, starterFab, "restored synthetic FAB starter");
	assertEqual(starterReloaded.projectName, starterFab.projectName, "restored starter project name");
	assertEqual(starterReloaded.projectDirty, "false", "restored starter dirty state");
	const starterSecondPath = await saveProjectWithKeyboard(desktopPage);
	const starterSecondJson = await readFile(starterSecondPath, "utf8");
	assertCanonicalAuthoredEquality(starterFirstJson, starterSecondJson);
	recordStep("synthetic-fab-save-load-save", await readMetrics(desktopPage));

	const completeFab = starterReloaded;

	const productionFabCatalog = await openSyntheticFabPreset(desktopPage);
	assertEqual(productionFabCatalog.previewState, "catalog-ready", "production FAB catalog state");
	assertEqual(productionFabCatalog.previewSource, "catalog", "production FAB catalog source");
	assertEqual(productionFabCatalog.defaultBayCount, "60", "production FAB catalog Bay count");
	assertEqual(
		productionFabCatalog.processRows,
		"120",
		"production FAB catalog internal Process Loop count",
	);
	assertEqual(productionFabCatalog.processBanks, "3", "production FAB catalog Bay Bank count");
	assertEqual(productionFabCatalog.processBlocks, "1", "production FAB catalog whole-FAB count");
	assertEqual(productionFabCatalog.interbaySpines, "1", "production FAB interbay spine count");
	assertEqual(
		productionFabCatalog.outerCirculations,
		"1",
		"production FAB outer circulation count",
	);
	assertEqual(productionFabCatalog.bayPitch, "112", "production FAB default Bay pitch");
	assertEqual(productionFabCatalog.railCells, "", "catalog does not hydrate rail cells");
	assertEqual(productionFabCatalog.directedEdges, "", "catalog does not hydrate rail edges");
	assertEqual(productionFabCatalog.physicalPaths, "", "catalog does not hydrate physical paths");
	assertEqual(
		productionFabCatalog.preparedPlanFingerprint,
		"",
		"catalog does not hydrate a prepared plan",
	);
	assertAtMost(
		productionFabCatalog.catalogReadyMilliseconds,
		PRESET_CATALOG_READY_BUDGET_MILLISECONDS,
		"production FAB catalog-ready latency",
	);
	assertProjectUnchanged(
		await readMetrics(desktopPage),
		completeFab,
		"production FAB preset catalog",
	);
	recordStep("production-fab-catalog", productionFabCatalog);
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "production-fab-60-preset-desktop.png"),
		fullPage: true,
	});
	const repeatedProductionFab = await exerciseSyntheticFabPresetRepeatPlacement(
		desktopPage,
		completeFab,
	);
	recordStep("production-fab-repeat-placement", repeatedProductionFab);
	await reloadProjectFromFile(desktopPage, starterFirstPath);
	const repeatPlacementReloaded = await readMetrics(desktopPage);
	assertBoundIdentity(
		repeatPlacementReloaded,
		completeFab,
		"production FAB repeat-placement cleanup reload",
	);
	assertEqual(
		repeatPlacementReloaded.historyCanRedo,
		"false",
		"repeat-placement cleanup clears transient redo history",
	);

	const productionFabPreview = await openPreparedSyntheticFabPreset(desktopPage);
	assertEqual(productionFabPreview.zoneCount, "3", "production FAB preview Bank count");
	assertEqual(productionFabPreview.bayCount, "60", "production FAB preview Bay count");
	assertEqual(
		productionFabPreview.processRows,
		"120",
		"production FAB preview internal Process Loop count",
	);
	assertEqual(productionFabPreview.processBanks, "3", "production FAB preview Bay Bank count");
	assertEqual(productionFabPreview.processBlocks, "1", "production FAB preview whole-FAB count");
	assertEqual(productionFabPreview.interbaySpines, "1", "production FAB interbay spine count");
	assertEqual(
		productionFabPreview.outerCirculations,
		"1",
		"production FAB outer circulation count",
	);
	assertEqual(productionFabPreview.bayPitch, "112", "production FAB default Bay pitch");
	assertEqual(productionFabPreview.operationSequence, "185", "production FAB construction steps");
	assertEqual(
		productionFabPreview.preparedPlanFingerprint,
		productionFabPreview.planFingerprint,
		"production FAB preview canonical plan fingerprint",
	);
	assertAtLeast(
		Number(productionFabPreview.railCells),
		30_000,
		"production FAB preview rail cells",
	);
	assertAtLeast(
		Number(productionFabPreview.directedEdges),
		30_000,
		"production FAB preview directed edges",
	);
	assertAtLeast(
		Number(productionFabPreview.physicalPaths),
		30_000,
		"production FAB preview physical paths",
	);
	assertEqual(productionFabPreview.strongComponents, "1", "production FAB preview network count");
	assertEqual(productionFabPreview.openTerminals, "0", "production FAB preview terminals");
	assertEqual(
		productionFabPreview.previewSource,
		"certified",
		"default production FAB certified preview source",
	);
	assertProjectUnchanged(
		await readMetrics(desktopPage),
		completeFab,
		"production FAB preset preview",
	);
	recordStep("production-fab-preview", productionFabPreview);
	const productionFabWorkersBeforeActivation = await syntheticFabStarterWorkerStarts(desktopPage);
	const productionFabActivationStartedAt = performance.now();
	const productionFabAction = await startSyntheticFabPresetAction(
		desktopPage,
		"create-project-from-synthetic-fab-preset",
	);
	await continueWithoutSavingIfVisible(desktopPage, false);
	const productionFab = await waitForWorker(
		desktopPage,
		(metrics) => {
			return (
				metrics.physicalPaths === productionFabPreview.physicalPaths &&
				metrics.workerChecksum === productionFabPreview.authoredChecksum &&
				metrics.workerPhysicalFingerprint === productionFabPreview.physicalFingerprint
			);
		},
		{ timeout: PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS },
	);
	const productionFabActivationMilliseconds = performance.now() - productionFabActivationStartedAt;
	assertAtMost(
		productionFabActivationMilliseconds,
		PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS,
		"cached production FAB project activation latency",
	);
	const productionFabWorkersAfterActivation = await syntheticFabStarterWorkerStarts(desktopPage);
	recordStep("production-fab-activation", {
		actionInitialState: productionFabAction.initialState,
		actionTransitionState: productionFabAction.transitionState,
		activationMilliseconds: productionFabActivationMilliseconds,
		activationGeneratorWorkerStarts:
			productionFabWorkersAfterActivation - productionFabWorkersBeforeActivation,
		startupMirrorFingerprintMatch: productionFab.startupMirrorFingerprintMatch,
		workerStatus: productionFab.workerStatus,
	});
	assertEqual(
		productionFabWorkersAfterActivation - productionFabWorkersBeforeActivation,
		0,
		"certified production FAB activation avoids generator Worker",
	);
	assertEqual(
		productionFab.projectName,
		"OpenFab 60-Bay Rail Foundation",
		"production FAB project name",
	);
	assertEqual(productionFab.strongComponents, "1", "production FAB project network count");
	assertEqual(productionFab.openTerminals, "0", "production FAB project open terminal count");
	assertEqual(productionFab.readinessReady, "true", "production FAB authoring readiness");
	assertEqual(productionFab.workerSimulationReady, "false", "production FAB simulation gate");
	assertEqual(productionFab.equipmentGroups, "0", "production FAB equipment groups");
	assertEqual(productionFab.equipmentPorts, "0", "production FAB equipment ports");
	assertEqual(productionFab.historyCanUndo, "false", "production FAB undo history");
	await assertFittedMapVisible(desktopPage);
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "production-fab-60-rail-desktop.png"),
		fullPage: true,
	});
	const productionFabCanvasOrganizationSelection =
		await exerciseProductionFabCanvasOrganizationSelection(desktopPage, productionFab);
	recordStep(
		"production-fab-canvas-organization-selection",
		productionFabCanvasOrganizationSelection,
	);

	// Preserve the mature Phase 4 organization regression surface while proving that legacy
	// shape inference is no longer a production entry point.
	const largeFab = await loadLegacyLargeFabAcceptanceFixture(desktopPage);
	const largeFabPreview = Object.freeze({ directedEdges: largeFab.authoredEdges });
	assertEqual(largeFab.projectName, "OpenFab Large FAB", "legacy hierarchy fixture project name");
	assertEqual(largeFab.strongComponents, "1", "legacy hierarchy fixture network count");
	assertEqual(largeFab.openTerminals, "0", "legacy hierarchy fixture terminal count");
	recordPhase4Checkpoint("large-fab-activated", largeFab);
	await assertFittedMapVisible(desktopPage);
	await exerciseStaticFabNavigator(desktopPage);
	recordStep("static-fab-navigator", await readMetrics(desktopPage));
	const largeFabCanvas = desktopPage.getByTestId("rail-canvas");
	await largeFabCanvas.press("Control+a");
	const authoredStructure = desktopPage.getByTestId("static-fab-authored-structure");
	await authoredStructure.waitFor({ state: "visible" });
	const adHocSelection = await readMetrics(desktopPage);
	assertEqual(
		adHocSelection.areaSelectionProvenance,
		"ad-hoc",
		"large FAB whole-map selection provenance",
	);
	assertEqual(
		adHocSelection.staticFabHierarchyRequested,
		"false",
		"ad-hoc selection avoids legacy hierarchy Worker",
	);
	assertEqual(
		await desktopPage.getByTestId("static-fab-hierarchy-scope").count(),
		0,
		"legacy inferred hierarchy panel is absent",
	);
	assertEqual(
		await authoredStructure.getByTestId("area-add-production-bay").count(),
		1,
		"ad-hoc selection exposes authored Production Bay command",
	);
	assertEqual(
		await authoredStructure.getByTestId("area-browse-organizations").count(),
		1,
		"ad-hoc selection exposes authored organization browser",
	);
	const authoredBrowseSource = await readMetrics(desktopPage);
	await authoredStructure.getByTestId("area-browse-organizations").click();
	const emptyAuthoredLibrary = desktopPage.getByTestId("static-fab-organization-library");
	await emptyAuthoredLibrary.waitFor({ state: "visible" });
	assertProjectUnchanged(
		await readMetrics(desktopPage),
		authoredBrowseSource,
		"authored organization routing",
	);
	await emptyAuthoredLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
	await authoredStructure.waitFor({ state: "visible" });
	const areaNameInput = desktopPage.getByTestId("static-fab-area-name");
	await areaNameInput.fill("Acceptance Main FAB");
	await desktopPage.getByTestId("save-static-fab-area").click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "1");
	const areaLibrary = desktopPage.getByTestId("static-fab-organization-library");
	await areaLibrary.waitFor({ state: "visible" });
	const areaSearch = desktopPage.getByRole("textbox", { name: "저장된 FAB 조직 검색" });
	const largeFabEdgeCount = largeFabPreview.directedEdges;
	const mainAreaOptionName = new RegExp(`Acceptance Main FAB ${largeFabEdgeCount} EDGES`);
	const mainBayOptionName = new RegExp(`Acceptance Main Bay ${largeFabEdgeCount} EDGES`);
	const renamedAreaOptionName = new RegExp(
		`Acceptance North Production Hall ${largeFabEdgeCount} EDGES`,
	);
	await areaLibrary.getByRole("tab", { name: "PROPERTIES", exact: true }).click();
	const creationHistoryDescription = areaLibrary.locator(
		".tilefab-organization-detail-panel textarea",
	);
	const unsavedCreationHistoryDraft = "Unsaved draft survives creation undo and redo";
	await creationHistoryDescription.fill(unsavedCreationHistoryDraft);
	await desktopPage.getByRole("button", { name: "실행 취소" }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "0");
	await desktopPage.getByRole("button", { name: "다시 실행" }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "1");
	assertEqual(
		await creationHistoryDescription.inputValue(),
		unsavedCreationHistoryDraft,
		"unsaved organization details survive creation undo/redo",
	);
	await areaLibrary.getByRole("button", { name: "RELOAD", exact: true }).click();
	assertEqual(await creationHistoryDescription.inputValue(), "", "history draft explicit reload");
	await areaLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
	await desktopPage.getByTitle("BAY", { exact: true }).click();
	assertEqual(
		await desktopPage.getByRole("radio", { name: /^BAY ·/ }).isChecked(),
		true,
		"BAY organization kind selection",
	);
	await areaNameInput.fill("Acceptance Main Bay");
	await desktopPage.getByTestId("save-static-fab-area").click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "2");
	await areaLibrary.waitFor({ state: "visible" });
	assertEqual(
		await areaLibrary.getByRole("tab", { name: "ALL 2", exact: true }).count(),
		1,
		"multi-kind organization total",
	);
	assertEqual(
		await areaLibrary.getByRole("tab", { name: "AREA 1", exact: true }).count(),
		1,
		"multi-kind AREA count",
	);
	assertEqual(
		await areaLibrary.getByRole("tab", { name: "BAY 1", exact: true }).count(),
		1,
		"multi-kind BAY count",
	);
	assertEqual(
		await areaLibrary
			.getByRole("option", { name: mainBayOptionName })
			.getAttribute("aria-selected"),
		"true",
		"cross-kind BAY selection context",
	);
	await desktopPage.setViewportSize({ width: 1280, height: 720 });
	await desktopPage.waitForTimeout(100);
	const mainAreaOption = areaLibrary.getByRole("option", { name: mainAreaOptionName });
	const mainBayOption = areaLibrary.getByRole("option", { name: mainBayOptionName });
	await mainBayOption.click();
	assertEqual(await areaLibrary.isVisible(), true, "organization selection keeps panel open");
	assertEqual(
		await mainBayOption.getAttribute("aria-selected"),
		"true",
		"organization selection remains active in the open panel",
	);
	await assertOrganizationEditorLayout(desktopPage, { width: 1280, height: 720 }, "overview");

	await areaLibrary.getByRole("tab", { name: "RELATIONS", exact: true }).click();
	const mainAreaParentRow = areaLibrary
		.locator(".tilefab-organization-parent-list > label")
		.filter({ hasText: "Acceptance Main FAB" });
	const mainAreaParentCheckbox = mainAreaParentRow.getByRole("checkbox");
	assertEqual(await mainAreaParentCheckbox.isChecked(), false, "BAY initial parent relationship");
	await assertOrganizationEditorLayout(desktopPage, { width: 1280, height: 720 }, "relations");
	const beforeRelationshipSave = await readMetrics(desktopPage);
	await mainAreaParentCheckbox.check();
	const saveOrganizationDetails = areaLibrary.getByRole("button", {
		name: "SAVE DETAILS",
		exact: true,
	});
	assertEqual(await saveOrganizationDetails.isEnabled(), true, "relationship save enabled");
	await saveOrganizationDetails.click();
	const relationshipSaved = await waitForWorker(desktopPage, (metrics) => {
		return (
			metrics.staticFabOrganizations === "2" &&
			Number(metrics.workerSequence) === Number(beforeRelationshipSave.workerSequence) + 1
		);
	});
	assertNotEqual(
		relationshipSaved.workerChecksum,
		beforeRelationshipSave.workerChecksum,
		"relationship save authored checksum",
	);
	assertEqual(await mainAreaParentCheckbox.isChecked(), true, "saved BAY parent relationship");
	assertEqual(await saveOrganizationDetails.isDisabled(), true, "saved relationship is clean");
	await assertWorkerMirrorReady(desktopPage, "relationship save");

	await areaLibrary.getByRole("tab", { name: "ALL 2", exact: true }).click();
	await mainBayOption.click();
	await mainAreaOption.click({ modifiers: ["Meta"] });
	assertEqual(
		await areaLibrary.getByRole("option", { selected: true }).count(),
		2,
		"organization Cmd-click multi-selection",
	);
	await areaLibrary.getByRole("button", { name: "EFFECTIVE", exact: true }).click();
	assertEqual(
		await areaLibrary
			.getByRole("button", { name: "EFFECTIVE", exact: true })
			.getAttribute("aria-pressed"),
		"true",
		"organization blueprint effective capture mode",
	);
	const directOrganizationSaveBefore = await readMetrics(desktopPage);
	const directOrganizationProjectJsonBefore = await desktopPage.evaluate(() =>
		JSON.stringify(window.__tileFab?.getProjectBlueprints?.()),
	);
	const saveOrganizationBlueprint = desktopPage.getByTestId("save-organization-blueprint");
	assertEqual(
		await saveOrganizationBlueprint.isEnabled(),
		true,
		"organization direct save enabled",
	);
	await saveOrganizationBlueprint.click();
	await completeContextualBlueprintSave(desktopPage, {
		name: "Acceptance Organized FAB",
		folder: "Acceptance/Organizations",
		destination: "user-library",
		quickSlot: 7,
	});
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "1",
		undefined,
		{ timeout: 10_000 },
	);
	await clickActivityCommand(desktopPage, "assemble", "내 청사진");
	await desktopPage.getByTestId("blueprint-user-tab").click();
	const directOrganizationSaveAfter = await readMetrics(desktopPage);
	assertProjectUnchanged(
		directOrganizationSaveAfter,
		directOrganizationSaveBefore,
		"organization direct user-library save",
	);
	assertExactStaticFabModelIdentity(
		directOrganizationSaveAfter,
		directOrganizationSaveBefore,
		"organization direct user-library model identity",
	);
	assertEqual(
		directOrganizationSaveAfter.railClipboard,
		directOrganizationSaveBefore.railClipboard,
		"organization direct save clipboard kind",
	);
	assertEqual(
		directOrganizationSaveAfter.railClipboardVersion,
		directOrganizationSaveBefore.railClipboardVersion,
		"organization direct save clipboard version",
	);
	assertEqual(
		await desktopPage.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		directOrganizationProjectJsonBefore,
		"organization direct save project blueprint JSON",
	);
	const directOrganizationContract = await desktopPage.evaluate(() => {
		const record = window.__tileFab
			?.getUserBlueprints?.()
			.find((candidate) => candidate.blueprint.name === "Acceptance Organized FAB");
		if (!record || record.blueprint.kind !== "STATIC_FAB_ORGANIZATION") return null;
		return {
			folder: record.folderPath.join("/"),
			organizations: record.blueprint.bundle.organizations.length,
			equipmentGroups: record.blueprint.bundle.equipmentGroups.length,
			ports: record.blueprint.bundle.ports.length,
		};
	});
	if (!directOrganizationContract) {
		throw new Error("Direct organization user blueprint is unavailable or has the wrong kind.");
	}
	assertEqual(
		directOrganizationContract.folder,
		"Acceptance/Organizations",
		"organization direct save folder",
	);
	assertEqual(
		await desktopPage.evaluate(
			() =>
				window.__tileFab
					?.getUserBlueprints?.()
					.find((candidate) => candidate.blueprint.name === "Acceptance Organized FAB")?.quickSlot,
		),
		7,
		"organization direct save quick slot",
	);
	assertEqual(directOrganizationContract.organizations, 2, "organization direct save hierarchy");
	const directOrganizationRecord = desktopPage
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Acceptance Organized FAB" });
	assertEqual(
		await directOrganizationRecord.getAttribute("data-kind"),
		"STATIC_FAB_ORGANIZATION",
		"organization direct save kind",
	);
	const duplicateOrganizationSaveBefore = await readMetrics(desktopPage);
	const activeUserBlueprintTab = desktopPage.getByTestId("blueprint-user-tab");
	await activeUserBlueprintTab.focus();
	await desktopPage.keyboard.press("Control+S");
	const duplicateOrganizationDialog = desktopPage.getByTestId("contextual-blueprint-save-dialog");
	await duplicateOrganizationDialog.waitFor({ state: "visible" });
	assertEqual(
		await duplicateOrganizationDialog.getAttribute("data-destination"),
		"user-library",
		"Ctrl+S follows active browser-local destination",
	);
	assertEqual(
		await duplicateOrganizationDialog.getAttribute("data-source-kind"),
		"organization-selection",
		"duplicate contextual save source precedence",
	);
	await duplicateOrganizationDialog
		.getByRole("textbox", { name: "청사진 이름" })
		.fill("Acceptance Organized FAB");
	await duplicateOrganizationDialog
		.getByRole("textbox", { name: "청사진 폴더" })
		.fill("Acceptance/Organizations");
	await duplicateOrganizationDialog.getByTestId("confirm-contextual-blueprint-save").click();
	const duplicateOrganizationError = duplicateOrganizationDialog.getByRole("alert");
	await duplicateOrganizationError.waitFor({ state: "visible", timeout: 10_000 });
	assertIncludes(
		(await duplicateOrganizationError.textContent()) ?? "",
		"같은 폴더에 이미 있습니다",
		"duplicate organization save conflict feedback",
	);
	const duplicateOrganizationSaveAfter = await readMetrics(desktopPage);
	assertProjectUnchanged(
		duplicateOrganizationSaveAfter,
		duplicateOrganizationSaveBefore,
		"duplicate organization save failure",
	);
	assertExactStaticFabModelIdentity(
		duplicateOrganizationSaveAfter,
		duplicateOrganizationSaveBefore,
		"duplicate organization save failure model identity",
	);
	assertEqual(
		duplicateOrganizationSaveAfter.organizationSelectionCount,
		duplicateOrganizationSaveBefore.organizationSelectionCount,
		"duplicate organization save preserves organization selection",
	);
	assertEqual(
		duplicateOrganizationSaveAfter.selectionModules,
		duplicateOrganizationSaveBefore.selectionModules,
		"duplicate save preserves selected rail modules",
	);
	assertEqual(
		duplicateOrganizationSaveAfter.selectionEquipmentGroups,
		duplicateOrganizationSaveBefore.selectionEquipmentGroups,
		"duplicate save preserves selected equipment groups",
	);
	assertEqual(
		duplicateOrganizationSaveAfter.userBlueprints,
		duplicateOrganizationSaveBefore.userBlueprints,
		"duplicate organization save does not add a browser-local record",
	);
	await duplicateOrganizationError.press("Escape");
	await duplicateOrganizationDialog.waitFor({ state: "hidden" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.id === "tilefab-blueprint-tab-user",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.waitForTimeout(50);
	assertEqual(
		await desktopPage.evaluate(() => document.activeElement?.id),
		"tilefab-blueprint-tab-user",
		"duplicate organization save restores active tab focus",
	);
	await deleteUserBlueprintRecord(
		desktopPage,
		directOrganizationRecord,
		"Acceptance Organized FAB",
	);
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "0",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();
	await desktopPage.getByRole("button", { name: "FAB 조직 (2)", exact: true }).click();
	await areaLibrary.waitFor({ state: "visible" });
	await areaLibrary.getByRole("button", { name: "DIRECT", exact: true }).click();
	await mainBayOption.click();
	await areaLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
	const organizationLauncher = desktopPage.getByRole("button", {
		name: "FAB 조직 (2)",
		exact: true,
	});
	const assembleMenu = desktopPage.getByTestId("static-fab-assemble-menu");
	await assertEditorActivityRailLayout(desktopPage, "desktop");
	const activityAssembleLauncher = desktopPage.getByTestId("editor-activity-assemble");
	const assembleLauncher = await visibleStaticFabAssembleLauncher(desktopPage);
	await activityAssembleLauncher.focus();
	await activityAssembleLauncher.press("Enter");
	await assembleMenu.waitFor({ state: "visible" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "fab-preset-browser",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.keyboard.press("Escape");
	await assembleMenu.waitFor({ state: "hidden" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "editor-activity-assemble",
		undefined,
		{ timeout: 10_000 },
	);
	await organizationLauncher.click();
	await areaLibrary.waitFor({ state: "visible" });
	await organizationLauncher.click();
	await areaLibrary.waitFor({ state: "hidden" });
	const metadataOnlyCanvasSelectionBefore = await readMetrics(desktopPage);
	await openStaticFabAssembleMenu(desktopPage, assembleMenu, "desktop Canvas selection");
	await assembleMenu.waitFor({ state: "visible" });
	await assembleMenu.getByTestId("assemble-select-on-canvas").click();
	await assembleMenu.waitFor({ state: "hidden" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.organizationOutlineStatus === "ready" &&
				canvas.dataset.organizationOutlineCount === "0" &&
				canvas.dataset.organizationOutlineSelectionEnabled === "true"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(await areaLibrary.isVisible(), false, "Canvas Select does not open Organization");
	assertProjectUnchanged(
		await readMetrics(desktopPage),
		metadataOnlyCanvasSelectionBefore,
		"metadata-only Canvas organization selection entry",
	);
	assertEqual(
		await assembleLauncher.getAttribute("aria-controls"),
		"tilefab-static-fab-assemble-panel",
		"responsive Assemble launcher controls",
	);
	await assembleLauncher.focus();
	await assembleLauncher.press("Enter");
	await assembleMenu.waitFor({ state: "visible" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "fab-preset-browser",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.keyboard.press("Escape");
	await assembleMenu.waitFor({ state: "hidden" });
	await waitForStaticFabAssembleLauncherFocus(desktopPage);
	const bottomAssembleLauncher = desktopPage.getByTestId("rail-pattern-browser-toggle");
	assertEqual(
		await bottomAssembleLauncher.getAttribute("aria-controls"),
		"tilefab-static-fab-assemble-panel",
		"bottom Assemble launcher controls",
	);
	await bottomAssembleLauncher.focus();
	await bottomAssembleLauncher.press("Enter");
	await assembleMenu.waitFor({ state: "visible" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "fab-preset-browser",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.keyboard.press("Escape");
	await assembleMenu.waitFor({ state: "hidden" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-pattern-browser-toggle",
		undefined,
		{ timeout: 10_000 },
	);
	await assembleLauncher.click();
	await assembleMenu.waitFor({ state: "visible" });
	await assembleMenu.getByTestId("assemble-open-blueprints").click();
	const assembleBlueprintLibrary = desktopPage.locator("#tilefab-blueprint-library");
	await assembleBlueprintLibrary.waitFor({ state: "visible" });
	await desktopPage.keyboard.press("Escape");
	await assembleBlueprintLibrary.waitFor({ state: "hidden" });
	await waitForStaticFabAssembleLauncherFocus(desktopPage);
	assertEqual(
		await assembleLauncher.evaluate((element) => element === document.activeElement),
		true,
		"Assemble blueprint library restores stable launcher focus",
	);
	await assembleLauncher.click();
	await assembleMenu.waitFor({ state: "visible" });
	const assembleDuplicate = assembleMenu.getByTestId("assemble-duplicate-selection");
	assertEqual(
		await assembleDuplicate.isDisabled(),
		true,
		"metadata-only BAY label is not a semantic Bay duplicate",
	);
	assertEqual(
		await assembleDuplicate.getAttribute("data-capture-mode"),
		"EFFECTIVE",
		"task-first Duplicate capture contract",
	);
	assertIncludes(
		(await assembleDuplicate.getAttribute("title")) ?? "",
		"Fab, Bank, 또는 Bay 조직 하나",
		"metadata-only organization duplicate reason",
	);
	assertIncludes(
		await assembleMenu.getByTestId("assemble-duplicate-status").innerText(),
		"Fab, Bank, 또는 Bay 조직 하나",
		"metadata-only organization visible duplicate reason",
	);
	await assembleLauncher.click();
	await assembleMenu.waitFor({ state: "hidden" });
	await desktopPage.getByRole("button", { name: "FAB 조직 (2)", exact: true }).click();
	await areaLibrary.waitFor({ state: "visible" });
	await mainBayOption.click();
	await mainAreaOption.click({ modifiers: ["Meta"] });
	await areaLibrary.getByRole("button", { name: "EFFECTIVE", exact: true }).click();
	await areaLibrary.getByRole("button", { name: "COPY", exact: true }).click();
	await desktopPage.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
			"true",
	);
	const organizationGhostSaveBefore = await readMetrics(desktopPage);
	const organizationGhostCanvas = desktopPage.getByTestId("rail-canvas");
	await organizationGhostCanvas.focus();
	await desktopPage.keyboard.press("Control+S");
	const organizationGhostSaveDialog = desktopPage.getByTestId("contextual-blueprint-save-dialog");
	await organizationGhostSaveDialog.waitFor({ state: "visible" });
	assertEqual(
		await organizationGhostSaveDialog.getAttribute("data-source-kind"),
		"organization-ghost",
		"held organization contextual save source",
	);
	await desktopPage.keyboard.press("Escape");
	await organizationGhostSaveDialog.waitFor({ state: "hidden" });
	await desktopPage.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
				"true" && document.activeElement?.getAttribute("data-testid") === "rail-canvas",
		undefined,
		{ timeout: 10_000 },
	);
	assertProjectUnchanged(
		await readMetrics(desktopPage),
		organizationGhostSaveBefore,
		"held organization save cancel",
	);
	assertEqual(
		await desktopPage.getByTestId("tilefab-app").getAttribute("data-rail-clipboard"),
		"organization",
		"organization bundle recent clipboard",
	);
	assertEqual(
		await desktopPage.getByTestId("tilefab-app").getAttribute("data-organization-selection-count"),
		"2",
		"organization selection survives placement start",
	);
	await exerciseOrganizationBundleCoarsePreview(desktopPage);
	const organizationBundleBefore = await readMetrics(desktopPage);
	const organizationBundleSourceGeometry = await readRailGeometry(desktopPage);
	if (!organizationBundleSourceGeometry.bounds) {
		throw new Error("organization bundle source bounds are unavailable");
	}
	const organizationBundleSourceBounds = organizationBundleSourceGeometry.bounds;
	const organizationBundleWidth =
		organizationBundleSourceBounds.maxX - organizationBundleSourceBounds.minX + 1;
	const organizationBundleHeight =
		organizationBundleSourceBounds.maxY - organizationBundleSourceBounds.minY + 1;
	const organizationBundleCenterX = Math.round(
		(organizationBundleSourceBounds.minX + organizationBundleSourceBounds.maxX) / 2,
	);
	const organizationBundleCenterY = Math.round(
		(organizationBundleSourceBounds.minY + organizationBundleSourceBounds.maxY) / 2,
	);
	const organizationBundlePointer = await moveOrganizationBundleGhostToCandidate(desktopPage, [
		{
			x: organizationBundleSourceBounds.maxX + Math.ceil(organizationBundleWidth / 2) + 64,
			y: organizationBundleCenterY + Math.ceil(organizationBundleHeight / 3) + 64,
		},
		{
			x: organizationBundleCenterX,
			y: organizationBundleSourceBounds.maxY + Math.ceil(organizationBundleHeight / 2) + 64,
		},
		{
			x: organizationBundleSourceBounds.minX - Math.ceil(organizationBundleWidth / 2) - 64,
			y: organizationBundleCenterY,
		},
	]);
	const organizationBundleAnchor = centeredAnchorForGeometry(
		organizationBundleSourceBounds,
		organizationBundlePointer,
	);
	await clickWorld(desktopPage, offsetCellCenter(organizationBundlePointer));
	const organizationBundlePlaced = await waitForWorker(
		desktopPage,
		(metrics) =>
			metrics.staticFabOrganizations === "4" &&
			Number(metrics.workerTargetSequence) ===
				Number(organizationBundleBefore.workerTargetSequence) + 1,
	);
	assertEqual(
		organizationBundlePlaced.organizationBundlePlacementPlanning,
		"worker",
		"organization bundle exact planning thread",
	);
	assertEqual(
		organizationBundlePlaced.organizationBundlePlacementTicket,
		"consumed",
		"organization bundle one-shot ticket consumed",
	);
	assertEqual(
		organizationBundlePlaced.organizationBundlePlacementPhase,
		"committed",
		"organization bundle placement phase",
	);
	assertEqual(
		organizationBundlePlaced.blueprintPlacementRequestAnchor,
		`${organizationBundleAnchor.x},${organizationBundleAnchor.y}`,
		"organization bundle requested pointer anchor",
	);
	assertEqual(
		organizationBundlePlaced.organizationBundlePlacementTicketAnchor,
		`${organizationBundleAnchor.x},${organizationBundleAnchor.y}`,
		"organization bundle Worker ticket anchor",
	);
	assertEqual(
		organizationBundlePlaced.organizationBundlePlacementPlanAnchor,
		`${organizationBundleAnchor.x},${organizationBundleAnchor.y}`,
		"organization bundle adopted plan anchor",
	);
	assertEqual(
		organizationBundlePlaced.blueprintPlacementAnchor,
		`${organizationBundleAnchor.x},${organizationBundleAnchor.y}`,
		"organization bundle committed plan anchor",
	);
	assertEqual(
		organizationBundlePlaced.organizationBundlePlacementTargetChecksum,
		organizationBundlePlaced.organizationBundlePlacementProspectiveChecksum,
		"organization bundle prospective Worker checksum",
	);
	assertEqual(
		organizationBundlePlaced.organizationBundlePlacementTargetChecksumMatch,
		"true",
		"organization bundle mirror target checksum match",
	);
	assertDurationTelemetry(
		organizationBundlePlaced.organizationBundlePlacementSnapshotMs,
		250,
		"organization bundle snapshot duration",
	);
	assertDurationTelemetry(
		organizationBundlePlaced.organizationBundlePlacementPlanningMs,
		5_000,
		"organization bundle Worker planning duration",
	);
	assertDurationTelemetry(
		organizationBundlePlaced.organizationBundlePlacementValidationMs,
		5_000,
		"organization bundle Worker validation duration",
	);
	assertDurationTelemetry(
		organizationBundlePlaced.organizationBundlePlacementRoundTripMs,
		10_000,
		"organization bundle Worker round trip duration",
	);
	assertDurationTelemetry(
		organizationBundlePlaced.organizationBundlePlacementResponseValidationMs,
		500,
		"organization bundle response validation duration",
	);
	assertDurationTelemetry(
		organizationBundlePlaced.organizationBundlePlacementAdoptionMs,
		1_000,
		"organization bundle main-thread adoption duration",
	);
	assertDurationTelemetry(
		organizationBundlePlaced.organizationBundlePlacementCommitMs,
		3_000,
		"organization bundle atomic commit duration",
	);
	const organizationBundlePlacedGeometry = await readRailGeometry(desktopPage);
	assertTranslatedRailGeometry(
		organizationBundleSourceGeometry,
		organizationBundlePlacedGeometry,
		organizationBundleAnchor,
	);
	assertAddedRailGeometryCenteredAtPointer(
		organizationBundleSourceGeometry,
		organizationBundlePlacedGeometry,
		organizationBundlePointer,
		"organization bundle placement",
	);
	recordStep("organization-bundle-worker-placement", organizationBundlePlaced);
	recordPhase4Checkpoint("large-fab-organization-bundle", organizationBundlePlaced);
	await desktopPage.getByTestId("rail-canvas").press("Escape");
	assertEqual(
		await desktopPage.getByTestId("tilefab-app").getAttribute("data-organization-selection-count"),
		"2",
		"organization selection survives placement cancel",
	);
	await exerciseCurrentLargeFabOrganizationArrangement(
		desktopPage,
		organizationBundlePlaced,
		areaLibrary,
		mainAreaOption,
		mainBayOption,
	);
	await desktopPage.getByRole("button", { name: "실행 취소" }).click();
	const organizationBundleUndone = await waitForWorker(
		desktopPage,
		(metrics) => metrics.staticFabOrganizations === "2",
	);
	await desktopPage.getByTestId("rail-canvas").press("Control+v");
	await desktopPage.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
			"true",
	);
	const cancellationAnchor = { x: 500, y: 300 };
	await clickWorld(desktopPage, offsetCellCenter(cancellationAnchor));
	const cancellationStartedAt = Date.now();
	await desktopPage.getByTestId("rail-canvas").press("Escape");
	await desktopPage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.blueprintPlacementResult === "cancelled" &&
				canvas?.dataset.organizationBundlePlacementPhase === "cancelled" &&
				canvas?.dataset.organizationBundlePlacementTicket === "revoked"
			);
		},
		undefined,
		{ timeout: 1_000 },
	);
	assertAtMost(Date.now() - cancellationStartedAt, 1_000, "organization bundle Escape latency");
	await desktopPage.waitForTimeout(50);
	const organizationBundleCancelled = await readMetrics(desktopPage);
	assertEqual(
		organizationBundleCancelled.workerTargetSequence,
		organizationBundleUndone.workerTargetSequence,
		"cancelled organization bundle patch sequence",
	);
	assertEqual(
		organizationBundleCancelled.workerTargetChecksum,
		organizationBundleUndone.workerTargetChecksum,
		"cancelled organization bundle checksum",
	);
	assertEqual(
		organizationBundleCancelled.staticFabOrganizations,
		organizationBundleUndone.staticFabOrganizations,
		"cancelled organization bundle organization count",
	);
	assertEqual(
		organizationBundleCancelled.historyCanUndo,
		organizationBundleUndone.historyCanUndo,
		"cancelled organization bundle undo history",
	);
	assertEqual(
		organizationBundleCancelled.historyCanRedo,
		organizationBundleUndone.historyCanRedo,
		"cancelled organization bundle redo history",
	);
	await desktopPage.getByRole("button", { name: "FAB 조직 (2)", exact: true }).click();
	await areaLibrary.waitFor({ state: "visible" });
	assertEqual(
		await areaLibrary.getByRole("option", { selected: true }).count(),
		2,
		"organization multi-selection survives placement cancel",
	);

	await areaLibrary.getByRole("tab", { name: "ALL 2", exact: true }).click();
	await mainAreaOption.click();
	assertEqual(
		await areaLibrary.isVisible(),
		true,
		"parent selection keeps organization panel open",
	);
	assertEqual(
		await mainAreaOption.getAttribute("aria-selected"),
		"true",
		"parent organization selection",
	);
	await assertOrganizationEditorLayout(desktopPage, { width: 1280, height: 720 }, "overview");
	await areaLibrary.getByRole("button", { name: "SHOW DIRECT", exact: true }).click();
	await waitForEditorStatus(desktopPage, "Acceptance Main FAB'을 선택했습니다");
	assertEqual(await areaLibrary.isVisible(), true, "SHOW DIRECT keeps organization panel open");
	const directOrganizationSelection = await readMetrics(desktopPage);
	assertAtLeast(
		Number(directOrganizationSelection.selectionModules),
		1,
		"direct organization selection modules",
	);
	const showEffective = areaLibrary.getByRole("button", {
		name: "SHOW EFFECTIVE",
		exact: true,
	});
	assertEqual(await showEffective.count(), 1, "parent exposes effective organization selection");
	await showEffective.click();
	await waitForEditorStatus(desktopPage, "Acceptance Main FAB'과 하위 조직을 선택했습니다");
	assertEqual(await areaLibrary.isVisible(), true, "SHOW EFFECTIVE keeps organization panel open");
	const effectiveOrganizationSelection = await readMetrics(desktopPage);
	assertAtLeast(
		Number(effectiveOrganizationSelection.selectionModules),
		Number(directOrganizationSelection.selectionModules),
		"effective organization selection modules",
	);

	await areaLibrary.getByRole("tab", { name: "PROPERTIES", exact: true }).click();
	const organizationDescription = areaLibrary.locator(
		".tilefab-organization-detail-panel textarea",
	);
	const roseOrganizationColor = areaLibrary.getByRole("button", {
		name: "ROSE",
		exact: true,
	});
	const organizationDescriptionValue = "Acceptance north production and metrology scope";
	await organizationDescription.fill(organizationDescriptionValue);
	await roseOrganizationColor.click();
	await assertOrganizationEditorLayout(desktopPage, { width: 1280, height: 720 }, "properties");
	const beforePropertiesSave = await readMetrics(desktopPage);
	await saveOrganizationDetails.click();
	const propertiesSaved = await waitForWorker(desktopPage, (metrics) => {
		return (
			metrics.staticFabOrganizations === "2" &&
			Number(metrics.workerSequence) === Number(beforePropertiesSave.workerSequence) + 1
		);
	});
	assertNotEqual(
		propertiesSaved.workerChecksum,
		beforePropertiesSave.workerChecksum,
		"properties save authored checksum",
	);
	assertEqual(
		await organizationDescription.inputValue(),
		organizationDescriptionValue,
		"saved organization description",
	);
	assertEqual(
		await roseOrganizationColor.getAttribute("aria-pressed"),
		"true",
		"saved organization color",
	);
	await assertWorkerMirrorReady(desktopPage, "properties save");

	await desktopPage.getByRole("button", { name: "실행 취소" }).click();
	const propertiesUndone = await waitForWorker(desktopPage, (metrics) => {
		return (
			metrics.workerChecksum === beforePropertiesSave.workerChecksum &&
			Number(metrics.workerSequence) === Number(propertiesSaved.workerSequence) + 1
		);
	});
	assertEqual(await organizationDescription.inputValue(), "", "properties undo description");
	assertEqual(
		await areaLibrary
			.getByRole("button", { name: "TEAL", exact: true })
			.getAttribute("aria-pressed"),
		"true",
		"properties undo color",
	);
	await assertWorkerMirrorReady(desktopPage, "properties undo");
	await desktopPage.getByRole("button", { name: "다시 실행" }).click();
	const propertiesRedone = await waitForWorker(desktopPage, (metrics) => {
		return (
			metrics.workerChecksum === propertiesSaved.workerChecksum &&
			Number(metrics.workerSequence) === Number(propertiesUndone.workerSequence) + 1
		);
	});
	assertEqual(
		await organizationDescription.inputValue(),
		organizationDescriptionValue,
		"properties redo description",
	);
	assertEqual(
		await roseOrganizationColor.getAttribute("aria-pressed"),
		"true",
		"properties redo color",
	);
	await assertWorkerMirrorReady(desktopPage, "properties redo");

	await mainBayOption.click();
	await areaLibrary.getByRole("tab", { name: "RELATIONS", exact: true }).click();
	assertEqual(
		await mainAreaParentCheckbox.isChecked(),
		true,
		"parent relationship survives property history",
	);
	await mainAreaOption.click();
	await desktopPage.setViewportSize({ width: 390, height: 844 });
	await desktopPage.waitForTimeout(100);
	await assertOrganizationEditorLayout(desktopPage, { width: 390, height: 844 }, "overview");
	await areaLibrary.getByRole("tab", { name: "RELATIONS", exact: true }).click();
	await assertOrganizationEditorLayout(desktopPage, { width: 390, height: 844 }, "relations");
	await areaLibrary.getByRole("tab", { name: "PROPERTIES", exact: true }).click();
	await assertOrganizationEditorLayout(desktopPage, { width: 390, height: 844 }, "properties");
	assertEqual(
		await organizationDescription.inputValue(),
		organizationDescriptionValue,
		"compact organization properties",
	);
	await desktopPage.setViewportSize({ width: 1440, height: 900 });
	await desktopPage.waitForTimeout(100);
	recordStep("static-fab-organization-details", propertiesRedone);
	recordPhase4Checkpoint("large-fab-organization-details", propertiesRedone);

	await areaLibrary.getByRole("tab", { name: "ALL 2", exact: true }).click();
	await areaSearch.fill("Main FAB");
	const filteredAreaOption = areaLibrary.getByRole("option", { name: mainAreaOptionName });
	assertEqual(
		await filteredAreaOption.getAttribute("tabindex"),
		"0",
		"first filtered organization remains a keyboard entry point",
	);
	await areaSearch.press("Tab");
	assertEqual(
		await filteredAreaOption.evaluate((element) => element === document.activeElement),
		true,
		"Tab enters the filtered organization list",
	);
	await areaSearch.fill("");
	await areaLibrary.getByRole("option", { name: mainBayOptionName }).click();
	await areaLibrary.getByRole("button", { name: "REMOVE METADATA", exact: true }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "1");
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("aria-label") === "저장된 FAB 조직 검색",
	);
	await areaLibrary.getByRole("tab", { name: "AREA 1", exact: true }).click();
	await areaLibrary.getByRole("option", { name: mainAreaOptionName }).click();
	assertEqual(
		await areaLibrary
			.getByRole("option", { name: mainAreaOptionName })
			.getAttribute("aria-selected"),
		"true",
		"saved AREA selection context",
	);
	await areaSearch.fill("Main FAB");
	assertEqual(
		await areaSearch.evaluate((element) => element === document.activeElement),
		true,
		"organization search receives focus when edited",
	);
	const organizationRename = desktopPage.getByRole("textbox", {
		name: "선택한 FAB 조직 이름",
	});
	await organizationRename.fill("Acceptance North Production Hall");
	const areaRenameStartedAt = performance.now();
	await areaLibrary.getByRole("button", { name: "RENAME", exact: true }).click();
	await desktopPage.waitForFunction(
		() => (document.querySelector('input[aria-label="저장된 FAB 조직 검색"]')?.value ?? "") === "",
	);
	await areaLibrary
		.getByRole("option", { name: renamedAreaOptionName })
		.waitFor({ state: "visible" });
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "1");
	assertAtMost(
		performance.now() - areaRenameStartedAt,
		2_000,
		`${Number(largeFabEdgeCount).toLocaleString()}-edge AREA rename acknowledgement duration`,
	);
	assertEqual(await areaSearch.inputValue(), "", "AREA rename clears active filter");
	assertEqual(
		await areaLibrary
			.getByRole("option", { name: renamedAreaOptionName })
			.getAttribute("aria-selected"),
		"true",
		"renamed AREA remains selected",
	);
	const areaRemoveStartedAt = performance.now();
	await areaLibrary.getByRole("button", { name: "REMOVE METADATA", exact: true }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "0");
	assertAtMost(
		performance.now() - areaRemoveStartedAt,
		2_000,
		`${Number(largeFabEdgeCount).toLocaleString()}-edge AREA removal acknowledgement duration`,
	);
	await desktopPage.getByRole("button", { name: "실행 취소" }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "1");
	assertEqual(
		await organizationRename.inputValue(),
		"Acceptance North Production Hall",
		"AREA removal undo restores editor context",
	);
	await desktopPage.getByRole("button", { name: "다시 실행" }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "0");
	assertEqual(
		await areaLibrary.getByRole("option").count(),
		0,
		"AREA removal redo clears stale list context",
	);
	await desktopPage.getByRole("button", { name: "실행 취소" }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "1");
	assertEqual(
		await areaLibrary
			.getByRole("option", { name: renamedAreaOptionName })
			.getAttribute("aria-selected"),
		"true",
		"AREA removal second undo restores selection context",
	);
	await desktopPage.getByRole("button", { name: "다시 실행" }).click();
	await waitForWorker(desktopPage, (metrics) => metrics.staticFabOrganizations === "0");
	await desktopPage.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
	recordStep("persistent-static-fab-area", await readMetrics(desktopPage));
	await largeFabCanvas.press("Control+a");
	await authoredStructure.waitFor({ state: "visible" });
	await desktopPage.setViewportSize({ width: 760, height: 900 });
	await desktopPage.waitForTimeout(150);
	assertEqual(
		await desktopPage.getByTestId("static-fab-hierarchy-scope").count(),
		0,
		"760 px selection does not restore legacy hierarchy",
	);
	await desktopPage.setViewportSize({ width: 390, height: 844 });
	await desktopPage.waitForTimeout(150);
	const compactSelectionPanel = desktopPage.getByRole("complementary", {
		name: "레일 영역 선택",
	});
	await assertLocatorInsideViewport(desktopPage, compactSelectionPanel);
	await authoredStructure.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(desktopPage, authoredStructure);
	const compactAuthoredActions = authoredStructure.locator("button");
	for (let index = 0; index < (await compactAuthoredActions.count()); index++) {
		const box = await compactAuthoredActions.nth(index).boundingBox();
		if (!box || box.height < 44) {
			throw new Error("Compact authored-structure target is smaller than 44 px.");
		}
	}
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "compact-large-fab-authored-structure.png"),
		fullPage: true,
	});
	await desktopPage.setViewportSize({ width: 1440, height: 900 });
	await desktopPage.waitForTimeout(100);
	const authoredPlacementSource = await readMetrics(desktopPage);
	await authoredStructure.getByTestId("area-add-production-bay").click();
	const authoredPlacementPanel = desktopPage.getByTestId("production-bay-module-panel");
	await authoredPlacementPanel.waitFor({ state: "visible" });
	assertEqual(
		await desktopPage.getByTestId("tilefab-app").getAttribute("data-organization-bundle-active"),
		"true",
		"authored structure starts canonical Production Bay placement",
	);
	assertEqual(
		await desktopPage.getByTestId("static-fab-authored-structure").count(),
		0,
		"Production Bay placement leaves the ad-hoc selection workflow",
	);
	assertProjectUnchanged(
		await readMetrics(desktopPage),
		authoredPlacementSource,
		"authored Production Bay preview",
	);
	await authoredPlacementPanel.getByRole("button", { name: "Close Production Bay panel" }).click();
	await authoredPlacementPanel.waitFor({ state: "hidden" });
	const authoredStructureMetrics = await readMetrics(desktopPage);
	assertEqual(
		authoredStructureMetrics.staticFabHierarchyRequested,
		"false",
		"responsive authored-structure journey keeps inference disabled",
	);
	recordStep("large-fab-authored-structure-routing", authoredStructureMetrics);
	recordPhase4Checkpoint("large-fab-authored-structure-routing", authoredStructureMetrics);
	await largeFabCanvas.press("Escape");
	await largeFabCanvas.press("Escape");
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.areaSelectionModules === "0",
	);
	for (const expectedOrganizationCount of [1, 1, 2]) {
		const beforeRestore = await readMetrics(desktopPage);
		await desktopPage.getByRole("button", { name: "실행 취소" }).click();
		await waitForWorker(
			desktopPage,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(beforeRestore.workerTargetSequence) + 1 &&
				Number(metrics.staticFabOrganizations) === expectedOrganizationCount,
		);
	}
	assertEqual(
		(await readMetrics(desktopPage)).staticFabOrganizations,
		"2",
		"Large FAB organizations restored for persistence audit",
	);
	await desktopPage.getByRole("button", { name: "전체 보기" }).click();
	await desktopPage.waitForTimeout(100);
	await assertFittedMapVisible(desktopPage);
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "large-fab-60-rail-desktop.png"),
		fullPage: true,
	});
	recordStep("large-fab-60-preset", largeFab);
	const largeFabAuthored = await exerciseCurrentLargeFabEquipmentAndBlueprint(desktopPage);
	await exerciseCurrentLargeFabContinuity(desktopPage, largeFabAuthored);
	await exercisePersistedLargeFabUserBlueprint(desktopPage);
	assertPhase4AuditContract();

	const emptyStarter = await createSyntheticFabProject(desktopPage, "blank");
	assertEqual(emptyStarter.projectName, "Untitled FAB", "blank starter project name");
	assertEqual(emptyStarter.physicalPaths, "0", "blank starter physical paths");
	assertEqual(emptyStarter.workerSimulationReady, "false", "blank starter simulation gate");
	recordStep("blank-starter", emptyStarter);

	const factoryPatternBefore = await readMetrics(desktopPage);
	const factoryPatternPreview = await openSyntheticFabPattern(desktopPage, "bay-assembly");
	assertProjectUnchanged(
		await readMetrics(desktopPage),
		factoryPatternBefore,
		"synthetic FAB pattern preview",
	);
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "synthetic-pattern-desktop.png"),
		fullPage: true,
	});
	await desktopPage.getByTestId("place-synthetic-fab-pattern").click();
	await desktopPage.waitForFunction(
		() => {
			const app = document.querySelector(".tilefab-app");
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(app?.dataset.areaStampModules) > 0 &&
				canvas?.dataset.activePlanKind === "rail-build" &&
				canvas.dataset.draftPreviewValid === "true"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const preparedFactoryPattern = await readMetrics(desktopPage);
	assertAtLeast(
		Number(preparedFactoryPattern.areaStampModules),
		1,
		"prepared synthetic FAB pattern modules",
	);
	assertEqual(preparedFactoryPattern.areaStampSource, "assembly-pattern", "factory pattern source");
	assertEqual(preparedFactoryPattern.areaStampLabel, "BAY ASSEMBLY", "factory pattern label");
	assertEqual(
		preparedFactoryPattern.activePlanKind,
		"rail-build",
		"factory pattern immediate ghost",
	);
	assertEqual(
		preparedFactoryPattern.draftPreviewValid,
		"true",
		"factory pattern immediate validity",
	);
	await desktopPage.keyboard.press("e");
	await desktopPage.keyboard.press("f");
	const transformedFactoryPattern = await readMetrics(desktopPage);
	assertEqual(transformedFactoryPattern.areaStampRotation, "90", "factory pattern rotation");
	assertEqual(transformedFactoryPattern.areaStampFlow, "reverse", "factory pattern flow reversal");
	await placeActiveConstruction(desktopPage, { x: 0, y: 0 });
	const firstFactoryPattern = await waitForMetricChange(
		desktopPage,
		factoryPatternBefore,
		"physicalPaths",
	);
	assertEqual(
		firstFactoryPattern.physicalPaths,
		factoryPatternPreview.physicalPaths,
		"placed factory pattern physical paths",
	);
	assertEqual(firstFactoryPattern.strongComponents, "1", "first factory pattern network count");
	assertEqual(firstFactoryPattern.openTerminals, "0", "first factory pattern terminals");
	assertEqual(firstFactoryPattern.areaStampRotation, "90", "placed factory pattern rotation");
	assertEqual(firstFactoryPattern.areaStampFlow, "reverse", "placed factory pattern flow");
	assertEqual(
		Number(firstFactoryPattern.workerTargetSequence),
		Number(factoryPatternBefore.workerTargetSequence) + 1,
		"first factory pattern Worker patch",
	);
	assertAtLeast(
		Number(firstFactoryPattern.areaStampModules),
		1,
		"factory pattern remains active for repeat placement",
	);
	const heldPatternBeforeSave = await readMetrics(desktopPage);
	const heldPatternCanvas = desktopPage.getByTestId("rail-canvas");
	await heldPatternCanvas.focus();
	await desktopPage.keyboard.press("Control+S");
	const heldPatternSaveDialog = desktopPage.getByTestId("contextual-blueprint-save-dialog");
	await heldPatternSaveDialog.waitFor({ state: "visible" });
	assertEqual(
		await heldPatternSaveDialog.getAttribute("data-source-kind"),
		"area-ghost",
		"held pattern contextual save source",
	);
	await desktopPage.keyboard.press("Escape");
	await heldPatternSaveDialog.waitFor({ state: "hidden" });
	await desktopPage.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
		undefined,
		{ timeout: 10_000 },
	);
	const heldPatternAfterSaveCancel = await readMetrics(desktopPage);
	assertProjectUnchanged(
		heldPatternAfterSaveCancel,
		heldPatternBeforeSave,
		"held pattern save cancel",
	);
	assertEqual(
		heldPatternAfterSaveCancel.areaStampRotation,
		heldPatternBeforeSave.areaStampRotation,
		"held pattern save cancel rotation",
	);
	assertEqual(
		heldPatternAfterSaveCancel.areaStampFlow,
		heldPatternBeforeSave.areaStampFlow,
		"held pattern save cancel flow",
	);
	assertEqual(
		heldPatternAfterSaveCancel.areaStampModules,
		heldPatternBeforeSave.areaStampModules,
		"held pattern save cancel modules",
	);
	assertEqual(
		heldPatternAfterSaveCancel.areaStampSource,
		heldPatternBeforeSave.areaStampSource,
		"held pattern save cancel source",
	);
	assertEqual(
		heldPatternAfterSaveCancel.areaStampLabel,
		heldPatternBeforeSave.areaStampLabel,
		"held pattern save cancel label",
	);
	const transformedHeldPatternEdges = await readNormalizedAuthoredRailEdges(desktopPage);
	const transformedUserBlueprintCount = Number(heldPatternAfterSaveCancel.userBlueprints);
	const transformedProjectBlueprintJsonBefore = await desktopPage.evaluate(() =>
		JSON.stringify(window.__tileFab?.getProjectBlueprints?.()),
	);
	await heldPatternCanvas.focus();
	await desktopPage.keyboard.press("Control+S");
	await completeContextualBlueprintSave(desktopPage, {
		name: "Acceptance Rotated Reverse Shift",
		folder: "Acceptance/Transformed",
		destination: "user-library",
	});
	await desktopPage.waitForFunction(
		(expectedCount) =>
			Number(document.querySelector(".tilefab-app")?.dataset.userBlueprints) === expectedCount,
		transformedUserBlueprintCount + 1,
		{ timeout: 10_000 },
	);
	const transformedHeldPatternRecord = await desktopPage.evaluate(() => {
		const entry = window.__tileFab
			?.getProjectBlueprints?.()
			.records.find((candidate) => candidate.name === "Acceptance Rotated Reverse Shift");
		const record = window.__tileFab
			?.getUserBlueprints?.()
			.find((candidate) => candidate.blueprint.name === "Acceptance Rotated Reverse Shift");
		return record
			? {
					kind: record.blueprint.kind,
					folder: record.folderPath.join("/"),
					edges: [...record.blueprint.edges].sort(
						(left, right) =>
							left[1] - right[1] || left[0] - right[0] || left[3] - right[3] || left[2] - right[2],
					),
					projectDuplicate: entry !== undefined,
				}
			: null;
	});
	if (!transformedHeldPatternRecord) {
		throw new Error("Transformed held-pattern browser-local blueprint was not saved.");
	}
	assertEqual(
		transformedHeldPatternRecord.kind,
		"RAIL_AREA",
		"transformed held-pattern saved kind",
	);
	assertEqual(
		JSON.stringify(transformedHeldPatternRecord.edges),
		JSON.stringify(transformedHeldPatternEdges),
		"transformed held-pattern exact saved edges",
	);
	assertEqual(
		transformedHeldPatternRecord.folder,
		"Acceptance/Transformed",
		"transformed held-pattern browser-local folder",
	);
	assertEqual(
		transformedHeldPatternRecord.projectDuplicate,
		false,
		"transformed held-pattern does not leak into project blueprints",
	);
	assertEqual(
		await desktopPage.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		transformedProjectBlueprintJsonBefore,
		"transformed browser-local save preserves project blueprint JSON",
	);
	const heldPatternAfterUserSave = await readMetrics(desktopPage);
	assertEqual(
		heldPatternAfterUserSave.areaStampRotation,
		"90",
		"successful transformed save preserves held rotation",
	);
	assertEqual(
		heldPatternAfterUserSave.areaStampFlow,
		"reverse",
		"successful transformed save preserves held flow",
	);
	await desktopPage.keyboard.press("Escape");
	await clickActivityCommand(desktopPage, "assemble", "내 청사진");
	await desktopPage.getByTestId("blueprint-user-tab").click();
	await desktopPage.getByTestId("user-blueprint-all").click();
	await desktopPage
		.getByRole("searchbox", { name: "내 라이브러리 검색" })
		.fill("Acceptance Rotated Reverse Shift");
	const transformedUserRecord = desktopPage
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Acceptance Rotated Reverse Shift" });
	await transformedUserRecord.locator(".tilefab-blueprint-place").click();
	await desktopPage.waitForFunction(
		() => {
			const app = document.querySelector(".tilefab-app");
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(app?.dataset.areaStampModules) > 0 &&
				app?.dataset.areaStampRotation === "0" &&
				app.dataset.areaStampFlow === "forward" &&
				canvas?.dataset.areaStampOrigin === "library"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const repeatedPatternSourceGeometry = await readRailGeometry(desktopPage);
	if (!repeatedPatternSourceGeometry.bounds) {
		throw new Error("Repeated factory pattern source bounds are unavailable.");
	}
	const repeatedPatternSourceBounds = repeatedPatternSourceGeometry.bounds;
	const repeatedPatternPointer = {
		x:
			repeatedPatternSourceBounds.maxX +
			Math.ceil((repeatedPatternSourceBounds.maxX - repeatedPatternSourceBounds.minX + 1) / 2) +
			64,
		y: Math.round((repeatedPatternSourceBounds.minY + repeatedPatternSourceBounds.maxY) / 2),
	};
	await placeActiveConstruction(desktopPage, repeatedPatternPointer);
	const repeatedFactoryPattern = await waitForWorker(
		desktopPage,
		(metrics) => Number(metrics.physicalPaths) === Number(firstFactoryPattern.physicalPaths) * 2,
	);
	assertEqual(repeatedFactoryPattern.strongComponents, "2", "repeated pattern network count");
	assertEqual(repeatedFactoryPattern.openTerminals, "0", "repeated pattern terminals");
	assertEqual(
		Number(repeatedFactoryPattern.workerTargetSequence),
		Number(firstFactoryPattern.workerTargetSequence) + 1,
		"repeated factory pattern Worker patch",
	);
	assertEqual(
		repeatedFactoryPattern.workerSimulationReady,
		"false",
		"repeated pattern simulation gate",
	);
	await desktopPage.keyboard.press("Escape");
	recordStep("factory-pattern-repeated", repeatedFactoryPattern);
	await undoAndRedo(desktopPage, firstFactoryPattern, repeatedFactoryPattern);
	await clickActivityCommand(desktopPage, "assemble", "내 청사진");
	await desktopPage.getByTestId("blueprint-user-tab").click();
	await desktopPage.getByRole("searchbox", { name: "내 라이브러리 검색" }).fill("");
	await desktopPage.getByTestId("save-whole-map-blueprint").click();
	await completeContextualBlueprintSave(desktopPage, {
		name: "Acceptance Factory Preset",
		folder: "Factories",
		destination: "project",
	});
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.projectBlueprints === "1",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.getByRole("tab", { name: /PROJECT/ }).click();
	const wholeMapBlueprint = desktopPage
		.getByTestId("blueprint-record")
		.filter({ hasText: "Acceptance Factory Preset" });
	assertEqual(
		await wholeMapBlueprint.getAttribute("data-kind"),
		"RAIL_AREA",
		"whole-map preset kind",
	);
	const beforeUserPromotion = await readMetrics(desktopPage);
	await runProjectBlueprintRecordCommand(
		wholeMapBlueprint,
		"Acceptance Factory Preset 내 라이브러리에 저장",
	);
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "2",
		undefined,
		{ timeout: 10_000 },
	);
	const afterUserPromotion = await readMetrics(desktopPage);
	assertEqual(
		afterUserPromotion.projectBlueprints,
		"1",
		"user promotion does not mutate project library",
	);
	assertEqual(
		afterUserPromotion.projectDirty,
		beforeUserPromotion.projectDirty,
		"user promotion does not dirty the open project",
	);
	assertEqual(
		afterUserPromotion.modelChecksum,
		beforeUserPromotion.modelChecksum,
		"user promotion does not mutate authored world",
	);
	assertEqual(
		afterUserPromotion.modelSequence,
		beforeUserPromotion.modelSequence,
		"user promotion does not dispatch a Worker patch",
	);
	const beforeDirectWholeMapSave = await readMetrics(desktopPage);
	const directWholeMapProjectJsonBefore = await desktopPage.evaluate(() =>
		JSON.stringify(window.__tileFab?.getProjectBlueprints?.()),
	);
	await desktopPage.getByTestId("save-whole-map-blueprint").click();
	await completeContextualBlueprintSave(desktopPage, {
		name: "Acceptance Whole Map Direct",
		folder: "Factories/Direct",
		destination: "user-library",
	});
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "3",
		undefined,
		{ timeout: 10_000 },
	);
	const afterDirectWholeMapSave = await readMetrics(desktopPage);
	assertProjectUnchanged(
		afterDirectWholeMapSave,
		beforeDirectWholeMapSave,
		"whole-map direct user-library save",
	);
	assertExactStaticFabModelIdentity(
		afterDirectWholeMapSave,
		beforeDirectWholeMapSave,
		"whole-map direct user-library model identity",
	);
	assertEqual(
		await desktopPage.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		directWholeMapProjectJsonBefore,
		"whole-map direct save project blueprint JSON",
	);
	const userBlueprintTab = desktopPage.getByTestId("blueprint-user-tab");
	await userBlueprintTab.click();
	await desktopPage.getByTestId("user-blueprint-all").click();
	await desktopPage.getByRole("searchbox", { name: "내 라이브러리 검색" }).fill("");
	const directWholeMapRecord = desktopPage
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Acceptance Whole Map Direct" });
	assertEqual(
		await directWholeMapRecord.getAttribute("data-kind"),
		"RAIL_AREA",
		"whole-map direct save kind",
	);
	await deleteUserBlueprintRecord(desktopPage, directWholeMapRecord, "Acceptance Whole Map Direct");
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "2",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await userBlueprintTab.getAttribute("aria-selected"),
		"true",
		"user library opens after promotion",
	);
	await userBlueprintTab.focus();
	assertEqual(
		await userBlueprintTab.evaluate((element) => element === document.activeElement),
		true,
		"user library keyboard navigation start focus",
	);
	await userBlueprintTab.press("ArrowRight");
	assertEqual(
		await desktopPage.getByTestId("blueprint-recent-tab").getAttribute("aria-selected"),
		"true",
		"user library ArrowRight reaches Recent",
	);
	await desktopPage.getByTestId("blueprint-recent-tab").press("ArrowRight");
	assertEqual(
		await desktopPage.getByRole("tab", { name: /PROJECT 1/ }).getAttribute("aria-selected"),
		"true",
		"user library ArrowRight wraps to Project",
	);
	await desktopPage.getByRole("tab", { name: /PROJECT 1/ }).press("ArrowRight");
	const promotedUserBlueprint = desktopPage
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Acceptance Factory Preset" });
	assertEqual(
		await promotedUserBlueprint.getAttribute("data-kind"),
		"RAIL_AREA",
		"user library portable kind",
	);
	await assignUserBlueprintQuickSlot(promotedUserBlueprint, "Acceptance Factory Preset", 3);
	await desktopPage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="user-blueprint-record"]')
				?.getAttribute("data-quick-slot") === "3",
		undefined,
		{ timeout: 10_000 },
	);
	const visibleQuickSlot = desktopPage.getByTestId("user-blueprint-quick-slot-3");
	assertEqual(
		await visibleQuickSlot.getAttribute("data-filled"),
		"true",
		"visible quick slot state",
	);
	if (!(await visibleQuickSlot.textContent())?.includes("Acceptance Factory Preset")) {
		throw new Error("Visible quick slot does not identify its assigned user blueprint.");
	}
	const quickSlotBox = await visibleQuickSlot.boundingBox();
	if (!quickSlotBox || quickSlotBox.height < 44) {
		throw new Error("Visible user blueprint quick slot target is smaller than 44 CSS pixels.");
	}
	await desktopPage.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();
	await desktopPage.getByTestId("rail-canvas").focus();
	await desktopPage.keyboard.press("Escape");
	await desktopPage.waitForFunction(
		() =>
			Number(document.querySelector(".tilefab-app")?.getAttribute("data-selection-modules")) === 0,
	);
	const constructionQuickSlot = desktopPage.locator(
		'[data-testid="rail-user-blueprint-quick-slot"][data-quick-slot="3"]',
	);
	await constructionQuickSlot.waitFor({ state: "visible" });
	const constructionQuickSlotBox = await constructionQuickSlot.boundingBox();
	if (!constructionQuickSlotBox || constructionQuickSlotBox.height < 44) {
		throw new Error(
			"Construction-surface user blueprint quick slot is smaller than 44 CSS pixels.",
		);
	}
	const quickSlotBefore = await readMetrics(desktopPage);
	await desktopPage.keyboard.press("Alt+3");
	await desktopPage.waitForFunction(
		() =>
			document.querySelector(".tilefab-app")?.dataset.areaStampOrigin === "library" &&
			Number(document.querySelector(".tilefab-app")?.dataset.areaStampModules) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.keyboard.press("Escape");
	assertProjectUnchanged(await readMetrics(desktopPage), quickSlotBefore, "user quick-slot recall");
	const shareablePresetPath = await saveProject(desktopPage);
	const shareablePresetJson = await readFile(shareablePresetPath, "utf8");
	const shareablePresetProject = JSON.parse(shareablePresetJson);
	assertEqual(
		shareablePresetProject.blueprints.records.length,
		1,
		"shareable project preset count",
	);
	assertEqual(
		shareablePresetProject.blueprints.records[0].name,
		"Acceptance Factory Preset",
		"shareable project preset name",
	);
	assertEqual(
		shareablePresetProject.blueprints.records[0].edges.length,
		Number(factoryPatternPreview.directedEdges) * 2,
		"shareable project preset directed edges",
	);
	recordStep("whole-map-blueprint-saved", await readMetrics(desktopPage));
	const shareablePresetBeforeReload = await readMetrics(desktopPage);
	await reloadProjectFromFile(desktopPage, shareablePresetPath);
	const shareablePresetReloaded = await readMetrics(desktopPage);
	assertBoundIdentity(
		shareablePresetReloaded,
		shareablePresetBeforeReload,
		"restored whole-map Factory Preset",
	);
	assertEqual(shareablePresetReloaded.projectBlueprints, "1", "restored whole-map preset library");
	assertEqual(shareablePresetReloaded.strongComponents, "2", "restored Factory Preset networks");
	const shareablePresetSecondPath = await saveProject(desktopPage);
	const shareablePresetSecondJson = await readFile(shareablePresetSecondPath, "utf8");
	assertCanonicalAuthoredEquality(shareablePresetJson, shareablePresetSecondJson);
	recordStep("whole-map-blueprint-reloaded", shareablePresetReloaded);
	await createSyntheticFabProject(desktopPage, "blank");
	await desktopPage.reload({ waitUntil: "domcontentloaded" });
	await waitForReady(desktopPage, { physicalPaths: 0 });
	await clickActivityCommand(desktopPage, "assemble", "내 청사진");
	await desktopPage.getByTestId("blueprint-user-tab").click();
	await desktopPage.getByTestId("user-blueprint-all").click();
	await desktopPage
		.getByRole("searchbox", { name: "내 라이브러리 검색" })
		.fill("Acceptance Rotated Reverse Shift");
	const reloadedTransformedUserRecord = desktopPage
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Acceptance Rotated Reverse Shift" });
	await reloadedTransformedUserRecord.waitFor({ state: "visible" });
	assertEqual(
		await reloadedTransformedUserRecord.getAttribute("data-kind"),
		"RAIL_AREA",
		"transformed browser-local record survives page reload",
	);
	const reloadedTransformedEdges = await desktopPage.evaluate(() => {
		const record = window.__tileFab
			?.getUserBlueprints?.()
			.find((candidate) => candidate.blueprint.name === "Acceptance Rotated Reverse Shift");
		return record
			? [...record.blueprint.edges].sort(
					(left, right) =>
						left[1] - right[1] || left[0] - right[0] || left[3] - right[3] || left[2] - right[2],
				)
			: null;
	});
	assertEqual(
		JSON.stringify(reloadedTransformedEdges),
		JSON.stringify(transformedHeldPatternEdges),
		"transformed browser-local record exact IndexedDB reload edges",
	);
	const reloadedTransformedPlacementBefore = await readMetrics(desktopPage);
	await reloadedTransformedUserRecord.locator(".tilefab-blueprint-place").click();
	await desktopPage.waitForFunction(
		() =>
			document.querySelector(".tilefab-app")?.dataset.areaStampOrigin === "library" &&
			Number(document.querySelector(".tilefab-app")?.dataset.areaStampModules) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	await placeActiveConstruction(desktopPage, { x: 0, y: 0 });
	const reloadedTransformedPlacement = await waitForWorker(
		desktopPage,
		(metrics) =>
			Number(metrics.workerTargetSequence) ===
				Number(reloadedTransformedPlacementBefore.workerTargetSequence) + 1 &&
			Number(metrics.authoredEdges) === transformedHeldPatternEdges.length,
	);
	assertEqual(
		reloadedTransformedPlacement.workerStatus,
		"ready",
		"reloaded transformed browser-local placement Worker ACK",
	);
	await desktopPage.keyboard.press("Escape");
	await desktopPage.getByRole("button", { name: "실행 취소" }).click();
	await waitForWorker(
		desktopPage,
		(metrics) =>
			Number(metrics.workerTargetSequence) ===
				Number(reloadedTransformedPlacement.workerTargetSequence) + 1 &&
			metrics.workerChecksum === reloadedTransformedPlacementBefore.workerChecksum &&
			metrics.modelChecksum === reloadedTransformedPlacementBefore.modelChecksum,
	);
	await clickActivityCommand(desktopPage, "assemble", "내 청사진");
	await desktopPage.getByTestId("blueprint-user-tab").click();
	await desktopPage.getByTestId("user-blueprint-all").click();
	await desktopPage
		.getByRole("searchbox", { name: "내 라이브러리 검색" })
		.fill("Acceptance Rotated Reverse Shift");
	await deleteUserBlueprintRecord(
		desktopPage,
		reloadedTransformedUserRecord,
		"Acceptance Rotated Reverse Shift",
	);
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "1",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.getByRole("searchbox", { name: "내 라이브러리 검색" }).fill("");
	const crossProjectUserBlueprint = desktopPage
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Acceptance Factory Preset" });
	await crossProjectUserBlueprint.waitFor({ state: "visible" });
	assertEqual(
		await crossProjectUserBlueprint.getAttribute("data-quick-slot"),
		"3",
		"user quick slot survives project replacement",
	);
	assertEqual(
		(await readMetrics(desktopPage)).projectBlueprints,
		"0",
		"user library does not leak into a new project",
	);
	const librarySearch = desktopPage.getByRole("searchbox", { name: "내 라이브러리 검색" });
	await librarySearch.fill("Acceptance Factory");
	const beforeSearchSaveShortcut = await readMetrics(desktopPage);
	await librarySearch.press("Control+s");
	assertEqual(
		(await readMetrics(desktopPage)).projectBlueprints,
		beforeSearchSaveShortcut.projectBlueprints,
		"library search Ctrl+S does not create a project blueprint",
	);
	await crossProjectUserBlueprint.locator(".tilefab-blueprint-place").click();
	await desktopPage.waitForFunction(
		() =>
			document.querySelector(".tilefab-app")?.dataset.areaStampOrigin === "library" &&
			Number(document.querySelector(".tilefab-app")?.dataset.areaStampModules) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	const userPlacementBefore = await readMetrics(desktopPage);
	await placeActiveConstruction(desktopPage, { x: 0, y: 0 });
	const portableRailBlueprint = shareablePresetProject.blueprints.records[0];
	const userPlacementCommitted = await waitForWorker(
		desktopPage,
		(metrics) =>
			Number(metrics.workerTargetSequence) ===
				Number(userPlacementBefore.workerTargetSequence) + 1 &&
			Number(metrics.authoredEdges) ===
				Number(userPlacementBefore.authoredEdges) + portableRailBlueprint.edges.length,
	);
	await undoAndRedo(desktopPage, userPlacementBefore, userPlacementCommitted);
	await desktopPage.getByRole("button", { name: "실행 취소" }).click();
	await waitForWorker(
		desktopPage,
		(metrics) => metrics.workerChecksum === userPlacementBefore.workerChecksum,
	);
	await desktopPage.keyboard.press("Escape");
	await clickActivityCommand(desktopPage, "assemble", "내 청사진");
	await desktopPage.getByTestId("blueprint-user-tab").click();
	const deletePortableBlueprintRecord = desktopPage
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Acceptance Factory Preset" });
	await deleteUserBlueprintRecord(
		desktopPage,
		deletePortableBlueprintRecord,
		"Acceptance Factory Preset",
	);
	await desktopPage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "0",
		undefined,
		{ timeout: 10_000 },
	);
	await desktopPage.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();

	await assertContextualRailTemplateDiscovery(desktopPage);
	const longBay = await placePattern(desktopPage, "long-bay", { x: 0, y: 0 });
	assertEqual(longBay.readinessReady, "true", "Long Bay readiness");
	assertEqual(longBay.strongComponents, "1", "Long Bay directed component count");
	assertAtLeast(Number(longBay.physicalPaths), 1, "Long Bay physical paths");
	recordStep("long-bay", longBay);
	await assertStarterModalIsolation(desktopPage, longBay);

	const placedOhbWorld = await placeOneOhb(desktopPage);
	const equipped = await readMetrics(desktopPage);
	assertEqual(equipped.equipmentGroups, "1", "OHB equipment group count");
	assertEqual(equipped.equipmentPorts, "1", "OHB port count");
	recordStep("ohb", equipped);

	await selectWorldArea(desktopPage, expandBounds({ minX: 0, minY: 0, maxX: 24, maxY: 6 }, 2));
	const selection = await readMetrics(desktopPage);
	assertAtLeast(Number(selection.selectionModules), 1, "selected rail modules");
	assertEqual(selection.selectionEquipmentGroups, "1", "selected equipment groups");
	assertEqual(selection.selectionPorts, "1", "selected equipment ports");
	recordStep("mixed-selection", selection);

	const recentBeforeBlueprintSave = await readMetrics(desktopPage);
	await saveSelectionAsBlueprint(desktopPage, "Whole Flow Bay", "Acceptance");
	const savedBlueprint = await readMetrics(desktopPage);
	assertEqual(savedBlueprint.projectBlueprints, "1", "project blueprint count");
	assertEqual(
		savedBlueprint.railClipboard,
		recentBeforeBlueprintSave.railClipboard,
		"saving does not overwrite recent clipboard",
	);
	assertEqual(
		savedBlueprint.railClipboardVersion,
		recentBeforeBlueprintSave.railClipboardVersion,
		"saving does not write recent clipboard",
	);
	recordStep("blueprint-saved", savedBlueprint);
	const recentClipboardVersion = await exerciseBlueprintClipboardShortcuts(desktopPage);
	recordStep("blueprint-clipboard-shortcuts", await readMetrics(desktopPage));

	const beforeBlueprintCopy = await readMetrics(desktopPage);
	await startSavedBlueprintPlacement(desktopPage, "Whole Flow Bay");
	assertEqual(
		(await readMetrics(desktopPage)).railClipboardVersion,
		recentClipboardVersion,
		"library placement preserves recent clipboard",
	);
	const wholeFlowBayPointer = { x: 12, y: 23 };
	await assertPlacementGhostSurvivesEditorChrome(desktopPage, wholeFlowBayPointer, "library");
	await placeActiveConstruction(desktopPage, wholeFlowBayPointer);
	const duplicated = await waitForMetricChange(desktopPage, beforeBlueprintCopy, "physicalPaths");
	assertEqual(duplicated.equipmentGroups, "2", "duplicated equipment group count");
	assertEqual(duplicated.equipmentPorts, "2", "duplicated equipment port count");
	assertEqual(duplicated.strongComponents, "2", "separate closed Bay component count");
	assertEqual(duplicated.workerSimulationReady, "false", "simulation readiness gate");
	recordStep("blueprint-placed", duplicated);

	await undoAndRedo(desktopPage, beforeBlueprintCopy, duplicated, "library");
	recordStep("undo-redo", await readMetrics(desktopPage));
	await exerciseAtomicCut(desktopPage, expandBounds({ minX: 0, minY: 0, maxX: 24, maxY: 6 }, 2));
	recordStep("atomic-cut", await readMetrics(desktopPage));
	const discoveryShortcuts = await exerciseShapezDiscoveryShortcuts(desktopPage, placedOhbWorld);
	recordStep("shapez-discovery-shortcuts", discoveryShortcuts);

	const beforeBridge = await readMetrics(desktopPage);
	await connectClosedBays(desktopPage, { x: 8, y: 0 }, { x: 8, y: 20 });
	const bridged = await waitForWorker(desktopPage, (metrics) => {
		return (
			Number(metrics.physicalPaths) > Number(beforeBridge.physicalPaths) &&
			metrics.strongComponents === "1"
		);
	});
	assertEqual(bridged.readinessReady, "true", "two-way Bay bridge readiness");
	assertEqual(bridged.openTerminals, "0", "two-way Bay bridge terminals");
	recordStep("two-way-bridge", bridged);
	await undoAndRedo(desktopPage, beforeBridge, bridged);
	const bridgeRestored = await readMetrics(desktopPage);
	assertEqual(
		bridgeRestored.workerChecksum,
		bridged.workerChecksum,
		"bridge redo authored checksum",
	);
	assertEqual(bridgeRestored.strongComponents, "1", "bridge redo directed component count");
	recordStep("two-way-bridge-undo-redo", bridgeRestored);

	const beforeAttachment = await readMetrics(desktopPage);
	await centerWorld(desktopPage, offsetCellCenter({ x: 4, y: 0 }));
	await startPattern(desktopPage, "attached-return", { x: 4, y: 0 });
	const attachmentTarget = await findValidTemplateTarget(desktopPage, "Return Bay", [
		{ x: 4, y: 0 },
		{ x: 10, y: 0 },
		{ x: 16, y: 0 },
		{ x: 4, y: 6 },
		{ x: 10, y: 6 },
		{ x: 16, y: 6 },
		{ x: 4, y: 20 },
		{ x: 10, y: 20 },
		{ x: 16, y: 20 },
	]);
	await clickWorld(desktopPage, attachmentTarget);
	const attached = await waitForMetricChange(desktopPage, beforeAttachment, "physicalPaths");
	assertEqual(attached.strongComponents, "1", "Return Bay attachment component count");
	assertEqual(attached.openTerminals, "0", "Return Bay attachment terminals");
	assertEqual(attached.readinessReady, "true", "Return Bay attachment readiness");
	recordStep("return-bay-attached", attached);
	await desktopPage.keyboard.press("Escape");

	const beforeBypass = await readMetrics(desktopPage);
	await centerWorld(desktopPage, offsetCellCenter({ x: 10, y: 20 }));
	await startPattern(desktopPage, "branch-bypass", { x: 10, y: 20 });
	const bypassTarget = await findValidTemplateTarget(
		desktopPage,
		"Branch Bypass",
		attachmentCandidateGrid(),
	);
	await clickWorld(desktopPage, bypassTarget);
	const bypassed = await waitForMetricChange(desktopPage, beforeBypass, "physicalPaths");
	assertEqual(bypassed.strongComponents, "1", "Branch Bypass component count");
	assertEqual(bypassed.openTerminals, "0", "Branch Bypass terminals");
	assertEqual(bypassed.readinessReady, "true", "Branch Bypass readiness");
	recordStep("branch-bypass-attached", bypassed);
	await desktopPage.keyboard.press("Escape");

	const savedPath = await saveProject(desktopPage);
	const firstJson = await readFile(savedPath, "utf8");
	result.downloadBytes = firstJson.length;
	const savedMetrics = await readMetrics(desktopPage);
	assertEqual(savedMetrics.projectDirty, "false", "saved project dirty state");

	await reloadProjectFromFile(desktopPage, savedPath);
	const restored = await readMetrics(desktopPage);
	assertBoundIdentity(restored, bypassed, "restored whole-flow project");
	assertEqual(restored.equipmentGroups, "2", "restored equipment group count");
	assertEqual(restored.equipmentPorts, "2", "restored equipment port count");
	assertEqual(restored.projectBlueprints, "1", "restored blueprint count");
	assertEqual(restored.projectDirty, "false", "restored project dirty state");
	assertEqual(restored.historyCanUndo, "false", "restored history undo state");
	assertEqual(restored.historyCanRedo, "false", "restored history redo state");
	recordStep("save-load", restored);
	const secondSavedPath = await saveProject(desktopPage);
	const secondJson = await readFile(secondSavedPath, "utf8");
	result.secondDownloadBytes = secondJson.length;
	assertCanonicalAuthoredEquality(firstJson, secondJson);
	recordStep("save-load-save", await readMetrics(desktopPage));

	const membershipAuthoring = await exercisePortEquipmentMembershipAuthoring(desktopPage);
	recordStep("port-equipment-membership-authoring", membershipAuthoring);
	assertEqual(membershipAuthoring.projectDirty, "true", "New Fab dirty source fixture");
	const defaultProfileFab = await exerciseNewFabProfileWizard(desktopPage, membershipAuthoring);
	recordStep("new-fab-profile-authoring", defaultProfileFab);
	const bayFlowEdit = await exerciseBayFlowEdit(desktopPage, defaultProfileFab);
	recordStep("semantic-bay-flow-edit", bayFlowEdit);
	const semanticBayMutation = await exerciseSemanticBayMutation(desktopPage, defaultProfileFab);
	recordStep("semantic-bay-disconnect-delete", semanticBayMutation);
	await reloadProjectFromFile(desktopPage, secondSavedPath);
	const postMembershipRestored = await readMetrics(desktopPage);
	assertBoundIdentity(
		postMembershipRestored,
		restored,
		"restored whole-flow project after membership acceptance",
	);
	for (const key of [
		"projectName",
		"equipmentGroups",
		"equipmentPorts",
		"projectBlueprints",
		"staticFabOrganizations",
	]) {
		assertEqual(
			postMembershipRestored[key],
			restored[key],
			`restored whole-flow project after New Fab ${key}`,
		);
	}
	assertEqual(
		postMembershipRestored.projectDirty,
		"false",
		"restored whole-flow project after New Fab dirty state",
	);
	const maximumLargeFab = await createMaximumLargeFabPreset(desktopPage);
	recordStep("large-fab-100-activation", maximumLargeFab);
	await reloadProjectFromFile(desktopPage, secondSavedPath);
	assertBoundIdentity(
		await readMetrics(desktopPage),
		restored,
		"restored whole-flow project after maximum FAB activation",
	);
	await clickActivityCommand(desktopPage, "build", "레일 건설");

	await desktopPage.getByRole("button", { name: "전체 보기" }).click();
	await desktopPage.waitForTimeout(100);
	await assertFittedMapVisible(desktopPage);
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "desktop-whole-flow.png"),
		fullPage: true,
	});
	await exerciseNarrowLayout(desktopPage);
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "narrow-pattern-browser.png"),
		fullPage: true,
	});
	await exerciseCompactLayout(desktopPage);
	await desktopPage.screenshot({
		path: path.join(artifactRoot, "compact-blueprint-library.png"),
		fullPage: true,
	});
	const retainedHeap = await exerciseEditorV1RetainedHeap(desktopPage);
	recordStep("editor-v1-retained-heap", retainedHeap);
	const guidedPortHandoff = await exerciseGuidedPortHandoffRegression(browser);
	recordStep("guided-port-handoff", guidedPortHandoff);
	const recommendedHierarchy = await exerciseCertifiedStarterRecommendedHierarchy(browser);
	recordStep("certified-starter-recommended-hierarchy", recommendedHierarchy);

	assertEqual(result.consoleErrors.length, 0, "browser console errors");
	assertEqual(result.pageErrors.length, 0, "browser page errors");
	const workerLifetime = await readWorkerLifetime(desktopPage);
	assertEqual(
		workerLifetime.workerTerminated + workerLifetime.workerLive,
		workerLifetime.workerTotal,
		"whole-app Worker lifecycle accounting",
	);
	assertEqual(workerLifetime.workerLive, 1, "one current-project resident Worker");
	const liveWorkerEntries = Object.entries(workerLifetime.workerLiveUrls);
	assertEqual(liveWorkerEntries.length, 1, "one resident Worker URL");
	assertIncludes(liveWorkerEntries[0]?.[0] ?? "", "railMirrorWorker", "resident Rail mirror URL");
	assertEqual(liveWorkerEntries[0]?.[1], 1, "one resident Rail mirror instance");
	recordStep("editor-v1-worker-lifetime", workerLifetime);
	result.status = "PASS";
	result.final = await readMetrics(desktopPage);
	result.workerStarts = await desktopPage.evaluate(
		() => globalThis.__openfabAcceptanceWorkerStarts ?? null,
	);
	console.log(
		`PASS static FAB authoring | ${result.final.physicalPaths} paths | ${result.final.equipmentGroups} equipment | ${result.final.projectBlueprints} blueprint`,
	);
} catch (error) {
	if (error === GUIDED_ONLY_COMPLETE) {
		// The opt-in focused run intentionally skips the whole-editor acceptance sequence.
	} else {
		result.final = desktopPage ? await readMetrics(desktopPage).catch(() => null) : null;
		result.workerStarts = desktopPage
			? await desktopPage
					.evaluate(() => globalThis.__openfabAcceptanceWorkerStarts ?? null)
					.catch(() => null)
			: null;
		result.failure = {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		};
		console.error(error);
	}
} finally {
	if (desktopPage) {
		await desktopPage
			.screenshot({ path: path.join(artifactRoot, "last-state.png"), fullPage: true })
			.catch(() => undefined);
	}
	await writeFile(
		path.join(artifactRoot, "result.json"),
		`${JSON.stringify(result, null, 2)}\n`,
	).catch(() => undefined);
	await closeBrowserResource(desktopPage, "authoring page");
	desktopPage = undefined;
	await closeBrowserResource(browser, "browser");
	await stopPreviewServer(server);
}

await Promise.all([
	new Promise((resolve) => process.stdout.write("", resolve)),
	new Promise((resolve) => process.stderr.write("", resolve)),
]);
process.exit(result.status === "PASS" ? 0 : 1);

function recordStep(name, metrics) {
	result.steps.push({ name, ...metrics });
}

function reportAcceptanceProgress(stage) {
	if (process.env.OPENFAB_ACCEPTANCE_PROGRESS === "1") {
		console.log(`[authoring] ${stage}`);
	}
}

async function exerciseGuidedBuildReleaseSurface(page, firstRunDialog) {
	const before = await readMetrics(page);
	const workerLifetimeBefore = await readWorkerLifetime(page);
	const guidedEntry = firstRunDialog.getByRole("button", { name: /GUIDED BUILD/ });
	await page.waitForFunction(
		() => document.activeElement?.textContent?.includes("GUIDED BUILD") === true,
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await guidedEntry.evaluate((element) => element === document.activeElement),
		true,
		"Guided Build initial keyboard entry focus",
	);
	await guidedEntry.press("Enter");
	const panel = page.getByTestId("guided-build-panel");
	await panel.waitFor({ state: "visible" });
	const canvas = page.getByTestId("rail-canvas");
	await page.waitForFunction(
		() => document.activeElement === document.querySelector('[data-testid="rail-canvas"]'),
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-guided-build-active"),
		"true",
		"Guided Build active surface",
	);
	const guidedChecksToggle = page.getByTestId("rail-readiness-toggle");
	assertEqual(
		(await guidedChecksToggle.innerText()).trim(),
		"CHECKS",
		"Guided defers the premature check warning",
	);
	assertEqual(
		await guidedChecksToggle.getAttribute("data-state"),
		"guided",
		"Guided uses the neutral check presentation",
	);

	const hiddenGuidedSelectors = Object.freeze([
		'[aria-label="맵 통계"]',
		'.tilefab-commands button[aria-label="새 프로젝트"]',
		'.tilefab-commands button[aria-label="FAB 조립"]',
		'.tilefab-commands button[aria-label="FAB 프리셋"]',
		'.tilefab-commands button[aria-label="FAB 전체 지도"]',
		'.tilefab-commands button[aria-label^="FAB 조직"]',
		'.tilefab-commands button[aria-label="프로젝트 열기"]',
		'.tilefab-commands button[aria-label="다른 이름으로 저장"]',
		'.tilefab-commands button[aria-label="3D 검사 뷰"]',
		'.tilefab-commands button[aria-label="물리 레일 외형"]',
		'.tilefab-commands button[aria-label="전체 삭제"]',
	]);
	for (const selector of hiddenGuidedSelectors) {
		assertEqual(
			await page.locator(selector).isHidden(),
			true,
			`Guided progressive surface ${selector}`,
		);
	}
	for (const label of [
		"프로젝트 저장",
		"실행 취소",
		"다시 실행",
		"2D 편집 뷰",
		"전체 보기",
		"명령·단축키",
	]) {
		assertEqual(
			await page.locator(`.tilefab-commands button[aria-label="${label}"]`).isVisible(),
			true,
			`Guided retained header command ${label}`,
		);
	}
	for (const activity of ["build", "assemble", "equip", "inspect"]) {
		assertEqual(
			await page.getByTestId(`editor-activity-${activity}`).count(),
			activity === "build" ? 1 : 0,
			`Guided initial ${activity} activity progressive reveal`,
		);
	}
	assertEqual(
		await page.getByRole("group", { name: "규격 FAB 레일 템플릿" }).count(),
		0,
		"Guided initial Assembly and Blueprint bottom launchers remain deferred",
	);
	assertEqual(
		await page.getByTestId("editor-action-hints").locator(":scope > span").count(),
		0,
		"Guided mission panel owns the only current input",
	);
	assertEqual(
		await page.getByRole("button", { name: "레일 건설", exact: true }).count(),
		0,
		"Guided initial duplicate Build tool deferral",
	);
	const initialGuidedMission = await panel.getAttribute("data-current-mission");
	const guidedProgress = panel.getByRole("progressbar", { name: "Guided Build 진행률" });
	assertEqual(await guidedProgress.getAttribute("max"), "12", "Guided canonical mission count");
	assertEqual(
		await panel.getByTestId("guided-build-mission-detail").count(),
		0,
		"Guided baseline mission omits the duplicate mission eyebrow",
	);
	assertEqual(
		await panel.getByText(/MISSION [12] · (ORIENT|FIRST RAIL)/, { exact: true }).count(),
		0,
		"Guided baseline mission removes the legacy full eyebrow",
	);
	assertEqual(
		await guidedProgress.getAttribute("value"),
		initialGuidedMission === "orient" ? "1" : "2",
		"Guided progress matches the current canonical mission",
	);
	if (initialGuidedMission === "orient") {
		assertEqual(
			await page.getByTestId("rail-buildbar").count(),
			0,
			"Guided Orient buildbar deferral",
		);
		assertEqual(
			await page.getByRole("button", { name: "모듈 철거", exact: true }).count(),
			0,
			"Guided Orient Erase deferral",
		);
	}
	const acknowledgeNavigation = panel.getByRole("button", { name: "이동을 익혔어요", exact: true });
	if ((await acknowledgeNavigation.count()) > 0) {
		await acknowledgeNavigation.click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "first-rail",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await page.getByTestId("editor-activity-rail").locator(":scope > button").count(),
			1,
			"Guided First Rail keeps only Build revealed",
		);
		assertEqual(
			await page.getByTestId("editor-action-hints").locator(":scope > span").count(),
			0,
			"Guided First Rail keeps input ownership in the mission panel",
		);
		const firstRailProgressCue = panel.getByTestId("guided-build-progress-cue");
		await firstRailProgressCue.waitFor({ state: "visible" });
		assertEqual(
			await firstRailProgressCue.getByText("연결 가능한 직선 0 / 1", { exact: true }).count(),
			1,
			"Guided First Rail shows one concrete practice target",
		);
		assertEqual(
			await firstRailProgressCue.getByText(/가로 또는 세로로 15칸 이상/).count(),
			1,
			"Guided First Rail explains the complete drag gesture",
		);
		assertEqual(
			await guidedProgress.getAttribute("aria-valuetext"),
			"2 / 12 · 첫 단방향 레일",
			"Guided First Rail accessible mission progress",
		);
		assertEqual(
			(await guidedChecksToggle.innerText()).trim(),
			"CHECKS",
			"Guided First Rail keeps the check warning deferred",
		);
	}
	if ((await panel.getAttribute("data-current-mission")) === "first-rail") {
		assertEqual(
			await page.getByTestId("rail-buildbar").count(),
			0,
			"Guided First Rail single-option construction bar deferral",
		);
		const railModules = page.getByRole("group", { name: "레일 건설 모듈" });
		assertEqual(await railModules.count(), 0, "Guided First Rail construction catalog deferral");
		assertEqual(
			await page.getByRole("button", { name: "모듈 철거", exact: true }).count(),
			0,
			"Guided First Rail Erase deferral",
		);
		await canvas.focus();
		await page.keyboard.press("Digit2");
		await page.waitForFunction(
			() => document.querySelectorAll('[aria-label="레일 건설 모듈"] > button').length === 2,
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await railModules.getByRole("button", { name: "U-TURN", exact: true }).count(),
			1,
			"Guided explicit U-turn detour remains reachable",
		);
		await page.keyboard.press("Digit1");
		await page.waitForFunction(
			() => document.querySelector('[data-testid="rail-buildbar"]') === null,
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await page.getByTestId("rail-buildbar").count(),
			0,
			"Guided Smart Route return hides the single-option construction bar",
		);
		const cornerPath = page.getByRole("group", { name: "코너 경로" });
		assertEqual(await cornerPath.count(), 0, "Guided First Rail corner-path deferral");
		await page.keyboard.press("KeyQ");
		await cornerPath.waitFor({ state: "visible" });
		assertEqual(
			await cornerPath
				.getByRole("button", { name: "X→Z", exact: true })
				.getAttribute("aria-pressed"),
			"true",
			"Guided First Rail explicit corner detour",
		);
		await cornerPath.getByRole("button", { name: "AUTO", exact: true }).click();
		await cornerPath.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() => document.activeElement === document.querySelector('[data-testid="rail-canvas"]'),
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await canvas.evaluate((element) => element === document.activeElement),
			true,
			"Guided First Rail hidden corner controls return focus to Canvas",
		);
	}
	assertProjectUnchanged(await readMetrics(page), before, "Guided progressive surface");
	assertEqual((await readMetrics(page)).workerSimulationReady, "false", "Guided simulation gate");
	const guidedHelp = page.getByTestId("guided-build-command-help");
	await guidedHelp.focus();
	await guidedHelp.press("Enter");
	const missionHelp = page.getByTestId("guided-build-mission-help");
	await missionHelp.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("editor-command-help").count(),
		0,
		"Guided mission help does not mount the global command registry",
	);
	assertEqual(
		await missionHelp
			.getByText("빈 격자에서 시작점과 도착점을 이어 단방향 레일을 만드세요.")
			.count(),
		1,
		"Guided mission help repeats only the current objective",
	);
	assertEqual(
		await missionHelp.getByText(/현재 도구 드래그/).count(),
		1,
		"Guided mission help uses the current registry-owned input",
	);
	await page.keyboard.press("Escape");
	await missionHelp.waitFor({ state: "hidden" });
	await panel.waitFor({ state: "visible" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "guided-build-command-help",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await guidedHelp.evaluate((element) => element === document.activeElement),
		true,
		"Guided mission help returns focus to the invoking action",
	);

	const compactCameraControls = page.locator(".tilefab-camera-controls");
	assertEqual(
		await compactCameraControls.isHidden(),
		true,
		"Guided desktop keeps the compact camera controls deferred",
	);
	const compactMeasurements = [];
	for (const viewport of [
		{ width: 760, height: 900 },
		{ width: 390, height: 720 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		await compactCameraControls.waitFor({ state: "visible" });
		const zoomBefore = Number(await canvas.getAttribute("data-camera-zoom"));
		await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
		await page.waitForFunction(
			(previousZoom) =>
				Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.cameraZoom) <
				previousZoom,
			zoomBefore,
			{ timeout: 10_000 },
		);
		await compactCameraControls.getByRole("button", { name: "화면 확대", exact: true }).click();
		await page.waitForFunction(
			(previousZoom) =>
				Math.abs(
					Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.cameraZoom) -
						previousZoom,
				) <= 0.001,
			zoomBefore,
			{ timeout: 10_000 },
		);
		const measurements = await page.evaluate(() => {
			const panelElement = document.querySelector('[data-testid="guided-build-panel"]');
			const panelBounds = panelElement?.getBoundingClientRect();
			const topbarElement = document.querySelector(".tilefab-topbar");
			const topbarBounds = topbarElement?.getBoundingClientRect();
			const cameraControlsElement = document.querySelector(".tilefab-camera-controls");
			const cameraControlsBounds = cameraControlsElement?.getBoundingClientRect();
			const panelButtons = panelElement
				? [...panelElement.querySelectorAll("button")].map((button) => {
						const bounds = button.getBoundingClientRect();
						return { width: bounds.width, height: bounds.height };
					})
				: [];
			const cameraButtons = cameraControlsElement
				? [...cameraControlsElement.querySelectorAll("button")].map((button) => {
						const bounds = button.getBoundingClientRect();
						return { width: bounds.width, height: bounds.height };
					})
				: [];
			const railButtons = [
				...document.querySelectorAll('[aria-label="레일 건설 모듈"] > button'),
			].map((button) => {
				const bounds = button.getBoundingClientRect();
				return { width: bounds.width, height: bounds.height };
			});
			return {
				documentScrollWidth: document.documentElement.scrollWidth,
				topbar: topbarBounds
					? {
							x: topbarBounds.x,
							width: topbarBounds.width,
							scrollWidth: topbarElement?.scrollWidth ?? 0,
							clientWidth: topbarElement?.clientWidth ?? 0,
						}
					: null,
				panel: panelBounds
					? {
							x: panelBounds.x,
							y: panelBounds.y,
							width: panelBounds.width,
							height: panelBounds.height,
							scrollWidth: panelElement?.scrollWidth ?? 0,
							clientWidth: panelElement?.clientWidth ?? 0,
							scrollHeight: panelElement?.scrollHeight ?? 0,
							clientHeight: panelElement?.clientHeight ?? 0,
						}
					: null,
				cameraControls: cameraControlsBounds
					? {
							x: cameraControlsBounds.x,
							y: cameraControlsBounds.y,
							width: cameraControlsBounds.width,
							height: cameraControlsBounds.height,
						}
					: null,
				cameraControlsOverlapsPanel:
					Boolean(cameraControlsBounds && panelBounds) &&
					cameraControlsBounds.left < panelBounds.right &&
					cameraControlsBounds.right > panelBounds.left &&
					cameraControlsBounds.top < panelBounds.bottom &&
					cameraControlsBounds.bottom > panelBounds.top,
				panelButtons,
				cameraButtons,
				railButtons,
			};
		});
		if (!measurements.panel) throw new Error(`Guided panel is missing at ${viewport.width} px.`);
		if (!measurements.topbar) throw new Error(`Guided topbar is missing at ${viewport.width} px.`);
		if (!measurements.cameraControls) {
			throw new Error(`Guided camera controls are missing at ${viewport.width} px.`);
		}
		assertAtMost(
			measurements.documentScrollWidth,
			viewport.width,
			`Guided ${viewport.width}px document horizontal overflow`,
		);
		assertAtLeast(measurements.topbar.x, 0, `Guided ${viewport.width}px topbar left bound`);
		assertAtMost(
			measurements.topbar.x + measurements.topbar.width,
			viewport.width,
			`Guided ${viewport.width}px topbar right bound`,
		);
		assertAtMost(
			measurements.topbar.scrollWidth,
			measurements.topbar.clientWidth,
			`Guided ${viewport.width}px topbar horizontal overflow`,
		);
		assertAtLeast(measurements.panel.x, 0, `Guided ${viewport.width}px panel left bound`);
		assertAtMost(
			measurements.panel.x + measurements.panel.width,
			viewport.width,
			`Guided ${viewport.width}px panel right bound`,
		);
		assertAtMost(
			measurements.panel.y + measurements.panel.height,
			viewport.height,
			`Guided ${viewport.width}px panel bottom bound`,
		);
		assertAtMost(
			measurements.panel.scrollWidth,
			measurements.panel.clientWidth,
			`Guided ${viewport.width}px horizontal overflow`,
		);
		assertAtLeast(
			measurements.cameraControls.x,
			0,
			`Guided ${viewport.width}px camera controls left bound`,
		);
		assertAtMost(
			measurements.cameraControls.x + measurements.cameraControls.width,
			viewport.width,
			`Guided ${viewport.width}px camera controls right bound`,
		);
		assertAtMost(
			measurements.cameraControls.y + measurements.cameraControls.height,
			viewport.height,
			`Guided ${viewport.width}px camera controls bottom bound`,
		);
		assertEqual(
			measurements.cameraControlsOverlapsPanel,
			false,
			`Guided ${viewport.width}px camera controls avoid the mission panel`,
		);
		assertEqual(
			measurements.cameraButtons.length,
			3,
			`Guided ${viewport.width}px compact camera control count`,
		);
		for (const [index, bounds] of measurements.panelButtons.entries()) {
			assertAtLeast(bounds.width, 44, `Guided ${viewport.width}px panel button ${index} width`);
			assertAtLeast(bounds.height, 44, `Guided ${viewport.width}px panel button ${index} height`);
		}
		for (const [index, bounds] of measurements.cameraButtons.entries()) {
			assertAtLeast(bounds.width, 44, `Guided ${viewport.width}px camera button ${index} width`);
			assertAtLeast(bounds.height, 44, `Guided ${viewport.width}px camera button ${index} height`);
		}
		for (const [index, bounds] of measurements.railButtons.entries()) {
			assertAtLeast(bounds.width, 44, `Guided ${viewport.width}px rail button ${index} width`);
			assertAtLeast(bounds.height, 44, `Guided ${viewport.width}px rail button ${index} height`);
		}
		await page.screenshot({
			path: path.join(artifactRoot, `guided-build-${viewport.width}x${viewport.height}.png`),
		});
		compactMeasurements.push({
			viewport: `${viewport.width}x${viewport.height}`,
			panelHeight: measurements.panel.height,
			panelScrollHeight: measurements.panel.scrollHeight,
			panelClientHeight: measurements.panel.clientHeight,
			cameraControlsHeight: measurements.cameraControls.height,
		});
	}

	await page.setViewportSize({ width: 1440, height: 900 });
	const guidedExit = panel.getByRole("button", { name: "Guided Build 종료" });
	await guidedExit.focus();
	await guidedExit.press("Escape");
	await panel.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement === document.querySelector('[data-testid="rail-canvas"]'),
		undefined,
		{ timeout: 10_000 },
	);
	await page.locator(".tilefab-project-trigger").click();
	await page.getByRole("button", { name: "가이드 열기", exact: true }).click();
	await firstRunDialog.waitFor({ state: "visible" });
	await firstRunDialog.getByRole("button", { name: /BLANK CANVAS/ }).click();
	await firstRunDialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement === document.querySelector('[data-testid="rail-canvas"]'),
		undefined,
		{ timeout: 10_000 },
	);
	assertProjectUnchanged(await readMetrics(page), before, "Guided exit and Blank Canvas entry");
	assertEqual(
		await canvas.evaluate((element) => element === document.activeElement),
		true,
		"Guided keyboard exit returns focus to Canvas",
	);
	const workerLifetimeAfter = await readWorkerLifetime(page);
	for (const key of ["workerTotal", "workerTerminated", "workerLive"]) {
		assertEqual(
			workerLifetimeAfter[key],
			workerLifetimeBefore[key],
			`Guided UI-only journey ${key}`,
		);
	}
	assertEqual(
		JSON.stringify(workerLifetimeAfter.workerLiveUrls),
		JSON.stringify(workerLifetimeBefore.workerLiveUrls),
		"Guided UI-only journey Worker identity",
	);
	return Object.freeze({
		keyboardEntry: true,
		missionHelpFocusReturn: true,
		keyboardExit: true,
		responsive: compactMeasurements.map((measurement) => Object.freeze(measurement)),
	});
}

async function exerciseGuidedPortHandoffRegression(browserInstance) {
	const context = await browserInstance.newContext({ viewport: { width: 390, height: 844 } });
	let page;
	try {
		page = await context.newPage();
		page.on("console", (message) => {
			if (message.type() === "error") result.consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => result.pageErrors.push(error.message));
		await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
		await waitForReady(page, { physicalPaths: 0 });
		const firstRunDialog = page.getByTestId("openfab-start-dialog");
		await firstRunDialog.waitFor({ state: "visible" });
		await firstRunDialog.getByRole("button", { name: /GUIDED BUILD/ }).click();
		const panel = page.getByTestId("guided-build-panel");
		await panel.waitFor({ state: "visible" });
		const acknowledgeNavigation = panel.getByRole("button", {
			name: "이동을 익혔어요",
			exact: true,
		});
		if ((await acknowledgeNavigation.count()) > 0) await acknowledgeNavigation.click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "first-rail",
			undefined,
			{ timeout: 10_000 },
		);

		const compactCameraControls = page.locator(".tilefab-camera-controls");
		await compactCameraControls.waitFor({ state: "visible" });
		await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
		await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
		await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
		const loopCenter = { x: 7.5, y: 3.5 };
		await centerWorld(page, loopCenter);
		const canvasBox = await page.getByTestId("rail-canvas").boundingBox();
		if (!canvasBox) throw new Error("Guided Port regression Canvas is unavailable.");
		const canvasCenter = {
			x: canvasBox.x + canvasBox.width / 2,
			y: canvasBox.y + canvasBox.height / 2,
		};
		await page.mouse.move(canvasCenter.x, canvasCenter.y);
		await page.mouse.down({ button: "right" });
		await page.mouse.move(canvasCenter.x, canvasCenter.y + 105, { steps: 6 });
		await page.mouse.up({ button: "right" });

		const drawRail = async (start, end, label) => {
			const before = await readMetrics(page);
			const startPoint = await screenPointForWorld(page, offsetCellCenter(start));
			const endPoint = await screenPointForWorld(page, offsetCellCenter(end));
			await page.mouse.move(startPoint.x, startPoint.y);
			await page.mouse.down();
			await page.mouse.move(endPoint.x, endPoint.y, { steps: 8 });
			await page.mouse.up();
			return waitForWorker(
				page,
				(metrics) =>
					Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1,
				{ timeout: 10_000 },
			).catch((error) => {
				throw new Error(`Guided ${label} rail did not commit.`, { cause: error });
			});
		};
		await drawRail({ x: 0, y: 0 }, { x: 15, y: 0 }, "first");
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "process-loop",
			undefined,
			{ timeout: 10_000 },
		);
		await drawRail({ x: 15, y: 0 }, { x: 15, y: 7 }, "outer-leg");
		await drawRail({ x: 15, y: 7 }, { x: 0, y: 7 }, "return-leg");
		const closedLoop = await drawRail({ x: 0, y: 7 }, { x: 0, y: 0 }, "closure");
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "ports",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(closedLoop.workerSimulationReady, "false", "Guided Port simulation gate");

		const pointIsAvailable = async (world) => {
			const point = await screenPointForWorld(page, world);
			return (
				point.x >= canvasBox.x + 48 &&
				point.x <= canvasBox.x + canvasBox.width - 48 &&
				point.y >= canvasBox.y + 330 &&
				point.y <= canvasBox.y + canvasBox.height - 145
			);
		};
		const firstVisibleCandidate = async (type) => {
			for (const candidate of await readLegalPortCandidates(page, type, 256)) {
				if (await pointIsAvailable(candidate)) return candidate;
			}
			throw new Error(`Guided ${type} exposes no unobscured legal candidate.`);
		};

		await panel.getByRole("button", { name: "EQUIP · OHB 열기", exact: true }).click();
		await waitForLegalPortSlots(page);
		const ohbBefore = await readMetrics(page);
		const ohbCandidate = await firstVisibleCandidate("OHB");
		await moveToWorld(page, ohbCandidate);
		await page.waitForTimeout(34);
		await clickWorld(page, ohbCandidate, false);
		await waitForWorker(
			page,
			(metrics) => metrics.equipmentGroups === "1" && metrics.equipmentPorts === "1",
			{ timeout: 10_000 },
		);
		assertEqual(Number(ohbBefore.equipmentGroups), 0, "Guided OHB baseline group count");

		await panel.getByRole("button", { name: "EQUIP · EQ 열기", exact: true }).click();
		await waitForLegalPortSlots(page);
		let eqRun = null;
		for (const run of await readLegalStraightPortRuns(page, "EQ")) {
			for (let index = 0; index <= run.items.length - 3; index += 1) {
				const items = run.items.slice(index, index + 3);
				if ((await Promise.all(items.map(pointIsAvailable))).every(Boolean)) {
					eqRun = items;
					break;
				}
			}
			if (eqRun) break;
		}
		if (!eqRun) throw new Error("Guided EQ exposes no unobscured three-Port run.");
		const eqBefore = await readMetrics(page);
		const eqStart = await screenPointForWorld(page, eqRun[0]);
		const eqEnd = await screenPointForWorld(page, eqRun[2]);
		await page.mouse.move(eqStart.x, eqStart.y);
		await page.mouse.down();
		await page.mouse.move(eqEnd.x, eqEnd.y, { steps: 8 });
		await page.mouse.up();
		const eqPlaced = await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(eqBefore.workerTargetSequence) + 1 &&
				metrics.equipmentGroups === "2" &&
				metrics.equipmentPorts === "4",
			{ timeout: 10_000 },
		);
		assertEqual(
			await page.getByTestId("tilefab-app").getAttribute("data-selected-port-id"),
			"",
			"Guided EQ completion leaves no Expert Port selection",
		);
		assertEqual(
			await page.getByTestId("port-equipment-inspector").count(),
			0,
			"Guided EQ completion leaves no Expert Port inspector",
		);
		assertEqual(
			await panel.getAttribute("data-current-mission"),
			"ports",
			"Guided EQ advances to the STK substep",
		);

		await panel.getByRole("button", { name: "EQUIP · STK 열기", exact: true }).click();
		await waitForLegalPortSlots(page);
		const selectedStk = [];
		for (const candidate of await readLegalPortCandidates(page, "STK", 256)) {
			if (!(await pointIsAvailable(candidate))) continue;
			try {
				await clickAvailableStkSlot(page, candidate, selectedStk.length + 1);
				selectedStk.push(candidate);
			} catch {
				continue;
			}
			if (selectedStk.length === 2) break;
		}
		assertEqual(selectedStk.length, 2, "Guided STK selected Port count");
		await page.getByTestId("stk-complete").click();
		const stkPlaced = await waitForWorker(
			page,
			(metrics) => metrics.equipmentGroups === "3" && metrics.equipmentPorts === "6",
			{ timeout: 10_000 },
		);
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "reuse-loop",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await page.getByTestId("tilefab-app").getAttribute("data-selected-port-id"),
			"",
			"Guided STK completion leaves no Expert Port selection",
		);
		assertEqual(
			await page.getByTestId("port-equipment-inspector").count(),
			0,
			"Guided STK completion leaves no Expert Port inspector",
		);
		assertEqual(stkPlaced.workerSimulationReady, "false", "Guided STK simulation gate");
		await page.screenshot({
			path: path.join(artifactRoot, "guided-port-handoff-390x844.png"),
			fullPage: true,
		});

		await panel.getByRole("button", { name: "INSPECT · Port 포함 Loop 탭", exact: true }).click();
		await clickWorld(page, offsetCellCenter({ x: 0, y: 3 }), false);
		await page.waitForFunction(
			() =>
				(document
					.querySelector('[data-testid="rail-canvas"]')
					?.getAttribute("data-selected-module-id")?.length ?? 0) > 0,
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await page.getByTestId("rail-inspector").count(),
			0,
			"Guided Reuse anchor leaves no Expert rail inspector",
		);
		await panel.getByRole("button", { name: "SELECT · Port 포함 Loop 전체", exact: true }).click();
		await page.waitForFunction(
			() => Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) > 0,
			undefined,
			{ timeout: 10_000 },
		);
		const selectedReuse = await readMetrics(page);
		assertEqual(selectedReuse.selectionEquipmentGroups, "3", "Guided Reuse selected equipment");
		assertEqual(selectedReuse.selectionPorts, "6", "Guided Reuse selected Ports");
		assertEqual(
			await page.getByTestId("rail-area-selection-inspector").count(),
			0,
			"Guided Reuse selection leaves no Expert area inspector",
		);
		await page.screenshot({
			path: path.join(artifactRoot, "guided-reuse-selection-390x844.png"),
			fullPage: true,
		});
		await panel.getByRole("button", { name: "COPY · Port 포함 Loop 복제", exact: true }).click();
		await page.waitForFunction(
			() => Number(document.querySelector(".tilefab-app")?.dataset.areaStampModules) > 0,
			undefined,
			{ timeout: 10_000 },
		);
		await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
		await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
		const duplicateAnchor = { x: 0, y: -9 };
		await centerWorld(page, { x: 7.5, y: -5.5 });
		await moveToWorld(page, offsetCellCenter(duplicateAnchor));
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="rail-canvas"]')
					?.getAttribute("data-draft-preview-valid") === "true",
			undefined,
			{ timeout: 10_000 },
		);
		const duplicateBefore = await readMetrics(page);
		await clickWorld(page, offsetCellCenter(duplicateAnchor), false);
		const duplicated = await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(duplicateBefore.workerTargetSequence) + 1 &&
				metrics.equipmentGroups === "6" &&
				metrics.equipmentPorts === "12",
			{ timeout: 10_000 },
		);
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "bay",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(duplicated.workerSimulationReady, "false", "Guided Reuse simulation gate");
		assertAtLeast(
			Number(await page.getByTestId("tilefab-app").getAttribute("data-area-stamp-modules")),
			1,
			"Guided practice handoff preserves the reusable placement session",
		);
		assertEqual(
			await page.getByTestId("rail-buildbar").count(),
			0,
			"Guided practice handoff hides the completed placement controls",
		);
		const practiceProjectId = duplicated.projectId;
		await page.screenshot({
			path: path.join(artifactRoot, "guided-practice-handoff-390x844.png"),
			fullPage: true,
		});
		await panel.getByRole("button", { name: "START FAB · 새 프로젝트", exact: true }).click();
		await continueWithoutSavingIfVisible(page, true);
		const semanticProject = await waitForWorker(
			page,
			(metrics) =>
				metrics.projectId !== practiceProjectId &&
				metrics.projectOperation === "idle" &&
				metrics.authoredCells === "0" &&
				metrics.equipmentGroups === "0" &&
				metrics.equipmentPorts === "0" &&
				metrics.staticFabOrganizations === "0" &&
				metrics.organizationBundleActive === "true",
			{ timeout: 30_000 },
		);
		assertEqual(semanticProject.workerSimulationReady, "false", "Guided handoff simulation gate");
		await page.screenshot({
			path: path.join(artifactRoot, "guided-semantic-project-start-390x844.png"),
			fullPage: true,
		});
		assertEqual(
			await page.getByTestId("tilefab-app").getAttribute("data-area-stamp-modules"),
			"0",
			"Guided project handoff clears the completed Reuse stamp",
		);
		for (let index = 0; index < 3; index += 1) {
			await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
		}
		const bayBefore = await readMetrics(page);
		const bayPointer = await moveOrganizationBundleGhostToCandidate(page, [
			{ x: 60, y: 0 },
			{ x: -60, y: 0 },
			{ x: 0, y: 50 },
			{ x: 0, y: -50 },
		]);
		await clickWorld(page, offsetCellCenter(bayPointer), false);
		const bayPlaced = await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(bayBefore.workerTargetSequence) + 1 &&
				metrics.staticFabOrganizations === "3" &&
				metrics.organizationBundlePlacementPhase === "committed" &&
				metrics.organizationBundlePlacementTargetChecksumMatch === "true",
			{ timeout: 30_000 },
		);
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "bay-bank",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(bayPlaced.workerSimulationReady, "false", "Guided Bay simulation gate");
		await panel.getByRole("button", { name: "ASSEMBLE · BAY 선택", exact: true }).click();
		await page.waitForFunction(
			() =>
				document.querySelector(".tilefab-app")?.getAttribute("data-navigator-tab") ===
				"organizations",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await page.getByTestId("tilefab-app").getAttribute("data-organization-bundle-active"),
			"false",
			"Guided Bank handoff clears the completed Bay multi-place session",
		);
		const originalBayIds = await page.evaluate(() =>
			(window.__tileFab?.getDocument().organizations.records ?? [])
				.filter((record) => record.kind === "BAY")
				.map((record) => record.id)
				.sort((left, right) => left - right),
		);
		assertEqual(originalBayIds.length, 1, "Guided Bank original Bay count");
		const organizationLibrary = page.getByTestId("static-fab-organization-library");
		await organizationLibrary
			.locator(`[role="option"][data-organization-id="${originalBayIds[0]}"]`)
			.click();
		await panel.getByRole("button", { name: "DUPLICATE · 하위 계층 포함", exact: true }).click();
		await page.waitForFunction(
			() =>
				document.querySelector(".tilefab-app")?.getAttribute("data-organization-bundle-active") ===
				"true",
			undefined,
			{ timeout: 10_000 },
		);
		const duplicatePointer = await waitForPrimedOrganizationDuplicate(page);
		const duplicateBeforeBay = await readMetrics(page);
		await centerWorld(page, offsetCellCenter(duplicatePointer));
		await moveToWorld(page, offsetCellCenter(duplicatePointer));
		await page.waitForFunction(
			(expected) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.cursorX === String(expected.x) &&
					canvas.dataset.cursorY === String(expected.y) &&
					canvas.dataset.organizationBundlePreviewState === "candidate"
				);
			},
			duplicatePointer,
			{ timeout: 10_000 },
		);
		await clickWorld(page, offsetCellCenter(duplicatePointer), false);
		const duplicatedBay = await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) ===
					Number(duplicateBeforeBay.workerTargetSequence) + 1 &&
				metrics.staticFabOrganizations === "6" &&
				metrics.organizationBundlePlacementPhase === "committed" &&
				metrics.organizationBundlePlacementTargetChecksumMatch === "true",
			{ timeout: 30_000 },
		);
		await panel.getByRole("button", { name: "ASSEMBLE · 두 BAY 선택", exact: true }).click();
		await organizationLibrary.waitFor({ state: "visible" });
		const pairSelectionBefore = await readMetrics(page);
		const duplicatedBayIds = await page.evaluate(() =>
			(window.__tileFab?.getDocument().organizations.records ?? [])
				.filter((record) => record.kind === "BAY")
				.map((record) => record.id)
				.sort((left, right) => left - right),
		);
		assertEqual(duplicatedBayIds.length, 2, "Guided Bank duplicated Bay count");
		const selectedBeforePair = new Set(
			pairSelectionBefore.organizationSelectionIds.split(",").filter(Boolean).map(Number),
		);
		for (const bayId of duplicatedBayIds) {
			if (selectedBeforePair.has(bayId)) continue;
			await organizationLibrary.locator(`[role="option"][data-organization-id="${bayId}"]`).click();
		}
		await page.waitForFunction(
			() =>
				document
					.querySelector(".tilefab-app")
					?.getAttribute("data-organization-selection-count") === "2",
			undefined,
			{ timeout: 10_000 },
		);
		const selectedBayPair = await readMetrics(page);
		assertEqual(selectedBayPair.workerSimulationReady, "false", "Guided Bay pair simulation gate");
		assertEqual(
			await organizationLibrary.getAttribute("data-guided-picker"),
			"true",
			"Guided hierarchy keeps the organization picker compact after selection",
		);
		assertEqual(
			await organizationLibrary.locator(".tilefab-organization-editor").isHidden(),
			true,
			"Guided hierarchy keeps the Expert organization editor hidden",
		);
		assertAtMost(
			await page.evaluate(() => document.documentElement.scrollWidth),
			390,
			"Guided Port regression horizontal overflow",
		);
		await page.screenshot({
			path: path.join(artifactRoot, "guided-bay-pair-selection-390x844.png"),
			fullPage: true,
		});
		const connectorBefore = selectedBayPair;
		await panel.getByRole("button", { name: "CONNECT BAYS · BANK 생성", exact: true }).click();
		const connectorPanel = page.getByTestId("static-fab-assembly-connector-panel");
		await connectorPanel.waitFor({ state: "visible" });
		await page.waitForFunction(
			() => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const connector = document.querySelector(
					'[data-testid="static-fab-assembly-connector-panel"]',
				);
				return (
					app?.getAttribute("data-assembly-connector-phase") === "ready" &&
					app.dataset.assemblyConnectorRecommendationStatus === "ready" &&
					connector?.getAttribute("data-hierarchy-role") === "BAY_TO_BANK" &&
					connector.getAttribute("data-purpose") === "HIERARCHY_LINK"
				);
			},
			undefined,
			{ timeout: 30_000 },
		);
		const connectorReady = await readMetrics(page);
		assertProjectUnchanged(
			connectorReady,
			connectorBefore,
			"Guided Bay Connector review-before-Apply",
		);
		assertEqual(
			connectorReady.assemblyConnectorSnapshotStatus,
			"hydrated",
			"Guided Bay Connector snapshot hydration",
		);
		const connectorAttempts = requiredPositiveIntegerAttribute(
			connectorReady.assemblyConnectorRecommendationAttempts,
			"Guided Bay Connector recommendation attempts",
		);
		assertAtMost(connectorAttempts, 8, "Guided Bay Connector recommendation bound");
		assertEqual(
			await connectorPanel.locator(".tilefab-assembly-connector-result").count(),
			1,
			"Guided Bay Connector renders one certified result",
		);
		const connectorApply = connectorPanel.locator(".tilefab-assembly-connector-apply");
		assertEqual(await connectorApply.isEnabled(), true, "Guided Bay Connector Apply available");
		await page.screenshot({
			path: path.join(artifactRoot, "guided-bay-connector-ready-390x844.png"),
			fullPage: true,
		});
		await connectorApply.click();
		const connectedBank = await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(connectorBefore.workerTargetSequence) + 1 &&
				metrics.staticFabOrganizations === "7",
			{ timeout: 30_000 },
		);
		assertEqual(
			connectedBank.workerChecksum,
			connectedBank.workerTargetChecksum,
			"Guided Bay Connector target checksum",
		);
		assertEqual(
			connectedBank.workerChecksum,
			connectedBank.modelChecksum,
			"Guided Bay Connector model checksum",
		);
		assertEqual(
			connectedBank.organizationSelectionCount,
			"2",
			"Guided Bay Connector retains the Bay pair",
		);
		assertEqual(
			connectedBank.workerSimulationReady,
			"false",
			"Guided Bay Connector simulation gate",
		);
		await waitForEditorStatus(page, "두 Production Bay를 연결해 Bay Bank를 만들었습니다");
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "interbay",
			undefined,
			{ timeout: 10_000 },
		);
		await panel.getByRole("button", { name: "ASSEMBLE · BANK 선택", exact: true }).waitFor({
			state: "visible",
		});
		await page.screenshot({
			path: path.join(artifactRoot, "guided-bank-handoff-390x844.png"),
			fullPage: true,
		});
		await panel.getByRole("button", { name: "ASSEMBLE · BANK 선택", exact: true }).click();
		await organizationLibrary.waitFor({ state: "visible" });
		const originalBankHierarchy = await readCertifiedStarterHierarchy(page);
		assertEqual(originalBankHierarchy.bankIds.length, 1, "Guided Interbay original Bank count");
		assertEqual(originalBankHierarchy.fabIds.length, 0, "Guided Interbay pre-Fab count");
		await organizationLibrary
			.locator(`[role="option"][data-organization-id="${originalBankHierarchy.bankIds[0]}"]`)
			.click();
		await panel
			.getByRole("button", { name: "DUPLICATE · BANK 하위 계층 포함", exact: true })
			.click();
		await page.waitForFunction(
			() =>
				document.querySelector(".tilefab-app")?.getAttribute("data-organization-bundle-active") ===
				"true",
			undefined,
			{ timeout: 10_000 },
		);
		const bankDuplicatePointer = await waitForPrimedOrganizationDuplicate(page);
		const bankDuplicateBefore = await readMetrics(page);
		await centerWorld(page, offsetCellCenter(bankDuplicatePointer));
		await moveToWorld(page, offsetCellCenter(bankDuplicatePointer));
		await page.waitForFunction(
			(expected) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.cursorX === String(expected.x) &&
					canvas.dataset.cursorY === String(expected.y) &&
					canvas.dataset.organizationBundlePreviewState === "candidate"
				);
			},
			bankDuplicatePointer,
			{ timeout: 10_000 },
		);
		await clickWorld(page, offsetCellCenter(bankDuplicatePointer), false);
		const duplicatedBank = await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) ===
					Number(bankDuplicateBefore.workerTargetSequence) + 1 &&
				metrics.staticFabOrganizations === "14" &&
				metrics.organizationBundlePlacementPhase === "committed" &&
				metrics.organizationBundlePlacementTargetChecksumMatch === "true",
			{ timeout: 30_000 },
		);
		await panel.getByRole("button", { name: "ASSEMBLE · 두 BANK 선택", exact: true }).click();
		await organizationLibrary.waitFor({ state: "visible" });
		const bankPairSelectionBefore = await readMetrics(page);
		const duplicatedBankHierarchy = await readCertifiedStarterHierarchy(page);
		assertEqual(duplicatedBankHierarchy.bankIds.length, 2, "Guided Interbay duplicated Banks");
		assertEqual(duplicatedBankHierarchy.fabIds.length, 0, "Guided Interbay duplicated pre-Fab");
		const selectedBeforeBankPair = new Set(
			bankPairSelectionBefore.organizationSelectionIds.split(",").filter(Boolean).map(Number),
		);
		for (const bankId of duplicatedBankHierarchy.bankIds) {
			if (selectedBeforeBankPair.has(bankId)) continue;
			await organizationLibrary
				.locator(`[role="option"][data-organization-id="${bankId}"]`)
				.click();
		}
		await page.waitForFunction(
			() =>
				document
					.querySelector(".tilefab-app")
					?.getAttribute("data-organization-selection-count") === "2",
			undefined,
			{ timeout: 10_000 },
		);
		const selectedBankPair = await readMetrics(page);
		assertEqual(
			selectedBankPair.workerSimulationReady,
			"false",
			"Guided Interbay Bank pair simulation gate",
		);
		assertEqual(
			await organizationLibrary.getAttribute("data-guided-picker"),
			"true",
			"Guided Interbay keeps the organization picker compact after selection",
		);
		assertEqual(
			await organizationLibrary.locator(".tilefab-organization-editor").isHidden(),
			true,
			"Guided Interbay keeps the Expert organization editor hidden",
		);
		const interbayNextAction =
			(
				await panel.locator(".tilefab-guided-build-actions button.primary").first().textContent()
			)?.trim() ?? "";
		if (!interbayNextAction.includes("CONNECT BANKS") && !interbayNextAction.includes("ARRANGE")) {
			throw new Error(
				`Guided Interbay exposes no arrangement or Connector continuation: ${JSON.stringify(interbayNextAction)}.`,
			);
		}
		await page.screenshot({
			path: path.join(artifactRoot, "guided-bank-pair-selection-390x844.png"),
			fullPage: true,
		});
		assertEqual(interbayNextAction, "CONNECT BANKS · FAB 생성", "Guided Interbay next action");
		const guidedInterbay = await applyRecommendedAssemblyConnectorFromButton(page, {
			button: panel.getByRole("button", { name: "CONNECT BANKS · FAB 생성", exact: true }),
			hierarchyRole: "BANK_TO_FAB",
			purpose: "HIERARCHY_LINK",
			expectedOrganizationDelta: 1,
			label: "Guided Interbay",
			readyScreenshot: "guided-interbay-ready-390x844.png",
		});
		assertEqual(
			guidedInterbay.applied.staticFabOrganizations,
			"15",
			"Guided Interbay organization count",
		);
		assertEqual(
			guidedInterbay.applied.organizationSelectionCount,
			"2",
			"Guided Interbay retains the Bank pair",
		);
		await waitForEditorStatus(page, "두 Bay Bank를 연결해 Fab을 만들었습니다");
		const interbayHierarchy = await readCertifiedStarterHierarchy(page);
		assertCertifiedTwoBankFab(interbayHierarchy, "Guided Interbay");
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "fab-loop",
			undefined,
			{ timeout: 10_000 },
		);
		const addFabLoop = panel.getByRole("button", {
			name: "ADD FAB LOOP · 외곽 순환",
			exact: true,
		});
		await addFabLoop.waitFor({ state: "visible" });
		await page.screenshot({
			path: path.join(artifactRoot, "guided-fab-loop-handoff-390x844.png"),
			fullPage: true,
		});
		const guidedFabLoop = await applyRecommendedAssemblyConnectorFromButton(page, {
			button: addFabLoop,
			hierarchyRole: "BANK_TO_FAB",
			purpose: "FAB_LOOP",
			expectedOrganizationDelta: 0,
			label: "Guided Fab Loop",
			readyScreenshot: "guided-fab-loop-ready-390x844.png",
		});
		assertEqual(
			guidedFabLoop.applied.staticFabOrganizations,
			"15",
			"Guided Fab Loop organization count",
		);
		assertEqual(
			guidedFabLoop.applied.organizationSelectionCount,
			"2",
			"Guided Fab Loop retains the Bank pair",
		);
		await waitForEditorStatus(page, "Fab 외곽 순환을 추가했습니다");
		const fabLoopHierarchy = await readCertifiedStarterHierarchy(page);
		assertCertifiedTwoBankFab(fabLoopHierarchy, "Guided Fab Loop");
		assertAtLeast(
			fabLoopHierarchy.fabDirectEdgeCounts[0] ?? 0,
			(interbayHierarchy.fabDirectEdgeCounts[0] ?? 0) + 1,
			"Guided Fab Loop extends the existing Fab",
		);
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "checks",
			undefined,
			{ timeout: 10_000 },
		);
		await panel
			.getByRole("button", { name: "INSPECT · CHECKS 열기", exact: true })
			.waitFor({ state: "visible" });
		await page.screenshot({
			path: path.join(artifactRoot, "guided-checks-handoff-390x844.png"),
			fullPage: true,
		});
		await panel.getByRole("button", { name: "INSPECT · CHECKS 열기", exact: true }).click();
		const checksPanel = page.getByTestId("rail-readiness-panel");
		await checksPanel.waitFor({ state: "visible" });
		await page.waitForFunction(
			() =>
				!["", "unchecked", "checking"].includes(
					document
						.querySelector('[data-testid="tilefab-app"]')
						?.getAttribute("data-static-fab-check-status") ?? "",
				),
			undefined,
			{ timeout: 30_000 },
		);
		let guidedChecks = await readMetrics(page);
		await page.screenshot({
			path: path.join(artifactRoot, "guided-checks-result-390x844.png"),
			fullPage: true,
		});
		let networkRepairCommits = 0;
		if (guidedChecks.staticFabCheckStatus !== "ready") {
			assertEqual(guidedChecks.staticFabCheckStatus, "issues", "Guided repair Checks status");
			assertEqual(guidedChecks.staticFabCheckActions, "1", "Guided repair Checks actions");
			assertEqual(guidedChecks.openTerminals, "0", "Guided repair open terminals");
			assertAtLeast(Number(guidedChecks.strongComponents), 2, "Guided repair networks");
			await panel.getByRole("button", { name: "BUILD · 레일망 연결", exact: true }).click();
			await checksPanel.waitFor({ state: "hidden" });
			while (Number(guidedChecks.strongComponents) > 1) {
				guidedChecks = await connectOneGuidedRailNetwork(page, guidedChecks);
				networkRepairCommits += 1;
				await page.screenshot({
					path: path.join(
						artifactRoot,
						`guided-network-repair-${networkRepairCommits}-390x844.png`,
					),
					fullPage: true,
				});
			}
			assertEqual(networkRepairCommits, 2, "Guided repair commit count");
			await panel
				.getByRole("button", { name: "INSPECT · CHECKS 열기", exact: true })
				.waitFor({ state: "visible" });
			await panel.getByRole("button", { name: "INSPECT · CHECKS 열기", exact: true }).click();
			await checksPanel.waitFor({ state: "visible" });
			await page.waitForFunction(
				() =>
					document
						.querySelector('[data-testid="tilefab-app"]')
						?.getAttribute("data-static-fab-check-status") === "ready",
				undefined,
				{ timeout: 30_000 },
			);
			guidedChecks = await readMetrics(page);
		}
		assertEqual(guidedChecks.staticFabCheckStatus, "ready", "Guided Checks status");
		assertEqual(guidedChecks.staticFabCheckIssues, "0", "Guided Checks issues");
		assertEqual(guidedChecks.staticFabCheckActions, "0", "Guided Checks actions");
		assertEqual(guidedChecks.readinessReady, "true", "Guided Checks rail readiness");
		assertEqual(guidedChecks.workerChecksum, guidedChecks.modelChecksum, "Guided Checks source");
		assertEqual(guidedChecks.workerSimulationReady, "false", "Guided Checks simulation gate");
		const confirmChecks = panel.getByRole("button", {
			name: "CHECKS · 검증 결과 확인",
			exact: true,
		});
		await confirmChecks.waitFor({ state: "visible" });
		await page.screenshot({
			path: path.join(artifactRoot, "guided-checks-ready-390x844.png"),
			fullPage: true,
		});
		await confirmChecks.click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "project-save",
			undefined,
			{ timeout: 10_000 },
		);
		await checksPanel.waitFor({ state: "hidden" });
		assertProjectUnchanged(await readMetrics(page), guidedChecks, "Guided Checks acknowledgement");
		await panel.getByRole("button", { name: "PROJECT · 저장", exact: true }).waitFor({
			state: "visible",
		});
		await page.screenshot({
			path: path.join(artifactRoot, "guided-save-handoff-390x844.png"),
			fullPage: true,
		});
		const guidedSaveDownload = page.waitForEvent("download");
		await panel.getByRole("button", { name: "PROJECT · 저장", exact: true }).click();
		const guidedDownload = await guidedSaveDownload;
		const guidedProjectPath = await guidedDownload.path();
		if (!guidedProjectPath) throw new Error("Guided project download has no readable path.");
		await waitForProjectOperation(page, "idle");
		const guidedSaved = await readMetrics(page);
		assertEqual(guidedSaved.projectId, semanticProject.projectId, "Guided save project identity");
		assertEqual(guidedSaved.modelChecksum, guidedChecks.modelChecksum, "Guided save checksum");
		assertEqual(guidedSaved.projectDirty, "false", "Guided save dirty state");
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "project-reopen",
			undefined,
			{ timeout: 10_000 },
		);
		await page.screenshot({
			path: path.join(artifactRoot, "guided-reopen-handoff-390x844.png"),
			fullPage: true,
		});
		const guidedFileChooser = page
			.waitForEvent("filechooser", { timeout: 5_000 })
			.catch(() => null);
		await panel.getByRole("button", { name: "PROJECT · 열기", exact: true }).click();
		await continueWithoutSavingIfVisible(page);
		const chooser = await guidedFileChooser;
		if (!chooser) {
			throw new Error(
				`Guided reopen did not expose a file chooser: ${JSON.stringify({
					metrics: await readMetrics(page),
					pendingProjectAction: await page
						.getByTestId("tilefab-app")
						.getAttribute("data-pending-project-action"),
					status: await page.locator('[role="status"]').last().textContent(),
					fileInputs: await page.locator('input[type="file"]').count(),
				})}`,
			);
		}
		await chooser.setFiles(guidedProjectPath);
		const guidedReopened = await waitForWorker(
			page,
			(metrics) =>
				metrics.projectOperation === "idle" &&
				metrics.projectId === guidedSaved.projectId &&
				metrics.modelChecksum === guidedSaved.modelChecksum &&
				metrics.projectDirty === "false",
			{ timeout: 30_000 },
		);
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "checks",
			undefined,
			{ timeout: 10_000 },
		);
		await panel.getByRole("button", { name: "INSPECT · CHECKS 열기", exact: true }).click();
		await checksPanel.waitFor({ state: "visible" });
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="tilefab-app"]')
					?.getAttribute("data-static-fab-check-status") === "ready",
			undefined,
			{ timeout: 30_000 },
		);
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="guided-build-panel"]')
					?.getAttribute("data-current-mission") === "complete",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(guidedReopened.workerChecksum, guidedSaved.workerChecksum, "Guided reopen source");
		assertEqual(
			guidedReopened.staticFabOrganizations,
			guidedSaved.staticFabOrganizations,
			"Guided reopen organizations",
		);
		assertEqual(guidedReopened.workerSimulationReady, "false", "Guided reopen simulation gate");
		await page.screenshot({
			path: path.join(artifactRoot, "guided-complete-390x844.png"),
			fullPage: true,
		});
		return Object.freeze({
			equipmentGroups: stkPlaced.equipmentGroups,
			equipmentPorts: stkPlaced.equipmentPorts,
			mission: await panel.getAttribute("data-current-mission"),
			selectedPortId: await page.getByTestId("tilefab-app").getAttribute("data-selected-port-id"),
			inspectorCount: await page.getByTestId("port-equipment-inspector").count(),
			reuseSelectionModules: selectedReuse.selectionModules,
			reuseSelectionEquipmentGroups: selectedReuse.selectionEquipmentGroups,
			reuseSelectionPorts: selectedReuse.selectionPorts,
			duplicatedEquipmentGroups: duplicated.equipmentGroups,
			duplicatedEquipmentPorts: duplicated.equipmentPorts,
			bayOrganizations: bayPlaced.staticFabOrganizations,
			bayWorkerSequence: bayPlaced.workerSequence,
			duplicatedBayOrganizations: duplicatedBay.staticFabOrganizations,
			pairSelectionBefore: pairSelectionBefore.organizationSelectionCount,
			pairSelectionAfter: selectedBayPair.organizationSelectionCount,
			connectorAttempts: String(connectorAttempts),
			bankOrganizations: connectedBank.staticFabOrganizations,
			bankWorkerSequence: connectedBank.workerSequence,
			duplicatedBankOrganizations: duplicatedBank.staticFabOrganizations,
			bankPairSelectionBefore: bankPairSelectionBefore.organizationSelectionCount,
			bankPairSelectionAfter: selectedBankPair.organizationSelectionCount,
			interbayNextAction,
			interbayAttempts: String(guidedInterbay.attempts),
			interbayOrganizations: guidedInterbay.applied.staticFabOrganizations,
			fabLoopAttempts: String(guidedFabLoop.attempts),
			fabLoopOrganizations: guidedFabLoop.applied.staticFabOrganizations,
			checkStatus: guidedChecks.staticFabCheckStatus,
			checkIssues: guidedChecks.staticFabCheckIssues,
			checkActions: guidedChecks.staticFabCheckActions,
			networkRepairCommits: String(networkRepairCommits),
			eqWorkerSequence: eqPlaced.workerSequence,
			stkWorkerSequence: stkPlaced.workerSequence,
		});
	} finally {
		await closeBrowserResource(page, "Guided Port handoff page");
		await closeBrowserResource(context, "Guided Port handoff context");
	}
}

async function exerciseExpertBuildReleaseSurface(page) {
	const before = await readMetrics(page);
	const workerLifetimeBefore = await readWorkerLifetime(page);
	const canvas = page.getByTestId("rail-canvas");
	const projectTrigger = page.locator(".tilefab-project-trigger");
	const projectMenu = page.getByRole("group", {
		name: "프로젝트 명령과 최근 프로젝트",
		exact: true,
	});
	const responsive = [];
	assertEqual(
		await page.getByRole("button", { name: "3D 검사 뷰", exact: true }).count(),
		0,
		"Editor v1 defers the Twin View entry",
	);
	await page.getByTestId("rail-readiness-toggle").click();
	const readinessPanel = page.getByTestId("rail-readiness-panel");
	await readinessPanel.waitFor({ state: "visible" });
	assertEqual(
		await readinessPanel
			.locator(
				'.tilefab-operational-launch, [data-testid="simulation-readiness-certification"], [data-testid="simulation-scenario-source-review"], [data-testid="simulation-scenario-run-authorization"], [data-testid="simulation-scenario-active-run"], [data-testid="simulation-resident-scenario-source-review"], [data-testid="simulation-resident-scenario-run-authorization"], [data-testid="simulation-resident-scenario-active-run"]',
			)
			.count(),
		0,
		"Editor v1 defers simulation configuration, source, authority, and run controls",
	);
	await readinessPanel.getByRole("button", { name: "정적 FAB 검사 패널 닫기" }).click();
	await readinessPanel.waitFor({ state: "hidden" });

	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 760, height: 900 },
		{ width: 390, height: 720 },
		{ width: 390, height: 844 },
	]) {
		await page.setViewportSize(viewport);
		await page.waitForTimeout(100);
		await activateEditorActivity(page, "build");
		const accessibility = await readExpertAccessibilitySnapshot(page);
		assertAtMost(
			accessibility.documentScrollWidth,
			viewport.width,
			`Expert ${viewport.width}px document horizontal overflow`,
		);
		assertEqual(
			accessibility.duplicateIds.length,
			0,
			`Expert ${viewport.width}px duplicate DOM ids`,
		);
		assertEqual(
			accessibility.unnamedFocusable.length,
			0,
			`Expert ${viewport.width}px unnamed focusable controls`,
		);
		await assertEditorActivityRailLayout(page, `Expert ${viewport.width}px`);

		for (const activity of ["build", "assemble", "equip", "inspect"]) {
			const activityButton = page.getByTestId(`editor-activity-${activity}`);
			await activityButton.focus();
			await activityButton.press("Enter");
			await page.waitForFunction(
				(expectedActivity) =>
					document
						.querySelector('[data-testid="tilefab-app"]')
						?.getAttribute("data-editor-activity") === expectedActivity,
				activity,
				{ timeout: 10_000 },
			);
			assertEqual(
				await activityButton.getAttribute("aria-pressed"),
				"true",
				`Expert ${viewport.width}px ${activity} keyboard activation`,
			);
			const assembleMenu = page.getByTestId("static-fab-assemble-menu");
			if (activity === "assemble" && (await assembleMenu.isVisible().catch(() => false))) {
				await page.keyboard.press("Escape");
				await assembleMenu.waitFor({ state: "hidden" });
			}
			const activityTools = page.locator(
				`.tilefab-editor-activity-tools[data-activity="${activity}"] > button`,
			);
			for (let index = 0; index < (await activityTools.count()); index += 1) {
				const tool = activityTools.nth(index);
				if (!(await tool.isVisible())) continue;
				await assertLocatorInsideViewport(page, tool);
				const bounds = await tool.boundingBox();
				if (!bounds) throw new Error(`Expert ${activity} tool ${index} has no bounds.`);
				assertAtLeast(
					bounds.width,
					44,
					`Expert ${viewport.width}px ${activity} tool ${index} width`,
				);
				assertAtLeast(
					bounds.height,
					44,
					`Expert ${viewport.width}px ${activity} tool ${index} height`,
				);
			}
		}

		await activateEditorActivity(page, "build");
		const buildActivity = page.getByTestId("editor-activity-build");
		await buildActivity.focus();
		await page.keyboard.press("Tab");
		assertEqual(
			await page.evaluate(
				() => document.activeElement?.getAttribute("data-testid") === "editor-activity-assemble",
			),
			true,
			`Expert ${viewport.width}px activity forward Tab order`,
		);
		await page.keyboard.press("Shift+Tab");
		assertEqual(
			await buildActivity.evaluate((element) => element === document.activeElement),
			true,
			`Expert ${viewport.width}px activity reverse Tab order`,
		);

		for (const [label, control] of [
			["project", projectTrigger],
			["checks", page.getByTestId("rail-readiness-toggle")],
		]) {
			const bounds = await control.boundingBox();
			if (!bounds) throw new Error(`Expert ${viewport.width}px ${label} control has no bounds.`);
			assertAtLeast(bounds.width, 44, `Expert ${viewport.width}px ${label} target width`);
			assertAtLeast(bounds.height, 44, `Expert ${viewport.width}px ${label} target height`);
		}
		if (viewport.width <= 430) {
			const compactHeaderCommands = page.locator(".tilefab-commands > button:visible");
			for (let index = 0; index < (await compactHeaderCommands.count()); index += 1) {
				const bounds = await compactHeaderCommands.nth(index).boundingBox();
				if (!bounds) throw new Error(`Expert compact header command ${index} has no bounds.`);
				assertAtLeast(bounds.width, 44, `Expert compact header command ${index} width`);
				assertAtLeast(bounds.height, 44, `Expert compact header command ${index} height`);
			}
		}
		const railControls = page.locator('[aria-label="레일 건설 모듈"] > button:visible');
		for (let index = 0; index < (await railControls.count()); index += 1) {
			const bounds = await railControls.nth(index).boundingBox();
			if (!bounds) throw new Error(`Expert rail control ${index} has no bounds.`);
			assertAtLeast(bounds.width, 44, `Expert ${viewport.width}px rail control ${index} width`);
			assertAtLeast(bounds.height, 44, `Expert ${viewport.width}px rail control ${index} height`);
		}

		await projectTrigger.focus();
		await projectTrigger.press("Enter");
		await projectMenu.waitFor({ state: "visible" });
		await assertLocatorInsideViewport(page, projectMenu);
		const projectActions = projectMenu.locator("button:not(:disabled)");
		const projectActionCount = await projectActions.count();
		assertAtLeast(projectActionCount, 5, `Expert ${viewport.width}px project actions`);
		const firstProjectAction = projectActions.first();
		await page.waitForFunction(
			() => document.activeElement?.closest("#tilefab-project-menu") !== null,
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await firstProjectAction.evaluate((element) => element === document.activeElement),
			true,
			`Expert ${viewport.width}px project menu initial focus`,
		);
		for (let index = 0; index < projectActionCount; index += 1) {
			const bounds = await projectActions.nth(index).boundingBox();
			if (!bounds) throw new Error(`Expert project action ${index} has no bounds.`);
			assertAtLeast(bounds.width, 44, `Expert ${viewport.width}px project action ${index} width`);
			assertAtLeast(bounds.height, 44, `Expert ${viewport.width}px project action ${index} height`);
		}
		await page.keyboard.press("End");
		assertEqual(
			await projectActions.last().evaluate((element) => element === document.activeElement),
			true,
			`Expert ${viewport.width}px project menu End`,
		);
		await page.keyboard.press("Home");
		assertEqual(
			await firstProjectAction.evaluate((element) => element === document.activeElement),
			true,
			`Expert ${viewport.width}px project menu Home`,
		);
		await page.keyboard.press("ArrowUp");
		assertEqual(
			await projectActions.last().evaluate((element) => element === document.activeElement),
			true,
			`Expert ${viewport.width}px project menu reverse wrap`,
		);
		await page.keyboard.press("ArrowDown");
		assertEqual(
			await firstProjectAction.evaluate((element) => element === document.activeElement),
			true,
			`Expert ${viewport.width}px project menu forward wrap`,
		);
		await page.keyboard.press("Escape");
		await projectMenu.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() => document.activeElement?.classList.contains("tilefab-project-trigger"),
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await projectTrigger.evaluate((element) => element === document.activeElement),
			true,
			`Expert ${viewport.width}px project menu Escape focus return`,
		);

		await page.screenshot({
			path: path.join(artifactRoot, `expert-build-${viewport.width}x${viewport.height}.png`),
		});
		responsive.push(
			Object.freeze({
				viewport: `${viewport.width}x${viewport.height}`,
				focusableControls: accessibility.focusableCount,
				projectActions: projectActionCount,
			}),
		);
	}

	await page.setViewportSize({ width: 1440, height: 900 });
	await activateEditorActivity(page, "build");
	await canvas.focus();
	assertProjectUnchanged(await readMetrics(page), before, "Expert accessibility UI-only journey");
	const workerLifetimeAfter = await readWorkerLifetime(page);
	const disposableWorkersCreated =
		workerLifetimeAfter.workerTotal - workerLifetimeBefore.workerTotal;
	const disposableWorkersTerminated =
		workerLifetimeAfter.workerTerminated - workerLifetimeBefore.workerTerminated;
	assertAtLeast(disposableWorkersCreated, 0, "Expert accessibility disposable Worker starts");
	assertEqual(
		disposableWorkersTerminated,
		disposableWorkersCreated,
		"Expert accessibility disposable Worker termination",
	);
	assertEqual(
		workerLifetimeAfter.workerLive,
		workerLifetimeBefore.workerLive,
		"Expert accessibility resident Worker count",
	);
	assertEqual(
		JSON.stringify(workerLifetimeAfter.workerLiveUrls),
		JSON.stringify(workerLifetimeBefore.workerLiveUrls),
		"Expert accessibility UI-only journey Worker identity",
	);
	return Object.freeze({
		keyboardActivities: true,
		projectMenuKeyboard: true,
		namedFocusableControls: true,
		uniqueDomIds: true,
		deferredLaterStageSurface: true,
		disposableWorkersCreated,
		responsive: responsive.map((measurement) => Object.freeze(measurement)),
	});
}

async function readExpertAccessibilitySnapshot(page) {
	return page.evaluate(() => {
		const visible = (element) => {
			const bounds = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return (
				bounds.width > 0 &&
				bounds.height > 0 &&
				style.display !== "none" &&
				style.visibility !== "hidden" &&
				element.getAttribute("aria-hidden") !== "true"
			);
		};
		const accessibleName = (element) => {
			const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
				.split(/\s+/)
				.filter(Boolean)
				.map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
				.filter(Boolean)
				.join(" ");
			return (
				element.getAttribute("aria-label")?.trim() ||
				labelledBy ||
				element.textContent?.trim() ||
				element.getAttribute("title")?.trim() ||
				element.getAttribute("placeholder")?.trim() ||
				""
			);
		};
		const focusable = [
			...document.querySelectorAll(
				'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
			),
		].filter(visible);
		const idCounts = new Map();
		for (const element of document.querySelectorAll("[id]")) {
			const id = element.id;
			if (id.length > 0) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
		}
		return {
			documentScrollWidth: document.documentElement.scrollWidth,
			focusableCount: focusable.length,
			unnamedFocusable: focusable
				.filter((element) => accessibleName(element).length === 0)
				.map((element) => ({
					tag: element.tagName,
					className: String(element.className),
					testId: element.getAttribute("data-testid") ?? "",
				})),
			duplicateIds: [...idCounts]
				.filter(([, count]) => count > 1)
				.map(([id, count]) => ({ id, count })),
		};
	});
}

function recordPhase4Checkpoint(name, metrics) {
	if (!workerIsSettled(metrics)) {
		throw new Error(`Phase 4 checkpoint ${name} does not have an exact Worker ACK.`);
	}
	result.phase4Audit.push({ name, ...metrics });
}

function assertPhase4AuditContract() {
	assertEqual(
		JSON.stringify(result.phase4Audit.map((checkpoint) => checkpoint.name)),
		JSON.stringify(REQUIRED_PHASE4_CHECKPOINTS),
		"Phase 4 required checkpoint order",
	);
	const projectIds = new Set(result.phase4Audit.map((checkpoint) => checkpoint.projectId));
	assertEqual(projectIds.size, 1, "Phase 4 same-project identity count");
	const [projectId] = projectIds;
	if (!projectId) throw new Error("Phase 4 audit has no project identity.");
	for (const checkpoint of result.phase4Audit) {
		assertEqual(checkpoint.projectId, projectId, `${checkpoint.name} same-project identity`);
		if (!workerIsSettled(checkpoint)) {
			throw new Error(`Phase 4 checkpoint ${checkpoint.name} lost its exact Worker ACK.`);
		}
	}
}

async function placePattern(page, templateId, anchor) {
	await startPattern(page, templateId);
	const before = await readMetrics(page);
	await placeActiveConstruction(page, anchor);
	const after = await waitForMetricChange(page, before, "physicalPaths");
	await page.keyboard.press("Escape");
	return after;
}

async function startPattern(page, templateId, contextCell = null) {
	await page.keyboard.press("Escape");
	if (contextCell) {
		await clickActivityCommand(page, "inspect", "선택 및 정보");
		await clickWorld(page, offsetCellCenter(contextCell), false);
		await clickActivityCommand(page, "inspect", "상황별 편집 명령");
		const palette = page.getByTestId("context-construction-palette");
		await palette.waitFor({ state: "visible" });
		const contextualTemplate = palette.getByTestId(`rail-template-${templateId}`);
		assertEqual(
			await contextualTemplate.count(),
			1,
			`${templateId} is available exactly once for the selected rail context`,
		);
		await contextualTemplate.click();
		await page.getByTestId("rail-canvas").waitFor({ state: "visible" });
		return;
	}
	await clickActivityCommand(page, "build", "레일 건설");
	const toggle = page.getByTestId("rail-pattern-browser-toggle");
	if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
	await openAdvancedRailMotifs(page);
	const template = page.getByTestId(`rail-template-${templateId}`);
	if ((await template.count()) === 0) {
		const category =
			templateId === "outerbay-link" || templateId === "outer-loop" ? "OUTERBAY" : "BAY";
		await page.getByRole("button", { name: category, exact: true }).click();
	}
	await page.getByTestId(`rail-template-${templateId}`).click();
	const patternPanelClose = page.getByRole("button", { name: "패턴 패널 닫기" });
	if (await patternPanelClose.isVisible().catch(() => false)) await patternPanelClose.click();
	await page.getByTestId("rail-canvas").waitFor({ state: "visible" });
}

async function openSyntheticFabPattern(page, starterId) {
	await page.keyboard.press("Escape");
	await clickActivityCommand(page, "build", "레일 건설");
	const toggle = page.getByTestId("rail-pattern-browser-toggle");
	if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
	await openAdvancedRailMotifs(page);
	await page.getByTestId("synthetic-fab-pattern-browser").click();
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	assertEqual(
		await dialog.getAttribute("data-mode"),
		"pattern",
		"synthetic FAB pattern dialog mode",
	);
	assertEqual(
		await page.getByTestId("synthetic-fab-starter-blank").count(),
		0,
		"blank starter hidden from pattern catalog",
	);
	assertEqual(
		await page.getByTestId("synthetic-fab-starter-complete-fab").count(),
		0,
		"complete FAB project starter hidden from repeatable block catalog",
	);
	assertEqual(
		await page.getByTestId("synthetic-fab-starter-large-fab-60").count(),
		0,
		"legacy large FAB preset hidden from repeatable block catalog",
	);
	assertEqual(
		await page.getByTestId("synthetic-fab-starter-production-fab-60").count(),
		0,
		"production FAB preset hidden from repeatable block catalog",
	);
	await page.getByTestId(`synthetic-fab-starter-${starterId}`).click();
	return waitForStarterPreview(page, (preview) => preview.starterId === starterId);
}

async function openAdvancedRailMotifs(page) {
	const details = page.locator("details.tilefab-assemble-advanced");
	await details.waitFor({ state: "visible" });
	if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
	await details.getByTestId("contextual-rail-tool-guidance").waitFor({ state: "visible" });
	assertEqual(
		await details.getByRole("button", { name: "OPEN END", exact: true }).count(),
		0,
		"open terminal repair is not a peer structural category",
	);
	for (const templateId of ["return-loop", "attached-return", "branch-bypass", "outerbay-link"]) {
		assertEqual(
			await details.getByTestId(`rail-template-${templateId}`).count(),
			0,
			`${templateId} is absent from the persistent Advanced gallery`,
		);
	}
}

async function assertContextualRailTemplateDiscovery(page) {
	await page.keyboard.press("Escape");
	await clickActivityCommand(page, "build", "레일 건설");
	const toggle = page.getByTestId("rail-pattern-browser-toggle");
	if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
	await openAdvancedRailMotifs(page);
	await page.keyboard.press("Escape");

	await clickActivityCommand(page, "inspect", "상황별 편집 명령");
	const palette = page.getByTestId("context-construction-palette");
	await palette.waitFor({ state: "visible" });
	assertEqual(
		await palette.getByTestId("rail-template-return-loop").count(),
		1,
		"empty-map terminal U-turn appears in context commands",
	);
	for (const templateId of ["attached-return", "branch-bypass", "outerbay-link"]) {
		assertEqual(
			await palette.getByTestId(`rail-template-${templateId}`).count(),
			0,
			`${templateId} stays hidden without a straight-rail selection`,
		);
	}
	await palette.getByTestId("rail-template-return-loop").click();
	assertEqual(
		await page.getByTestId("rail-canvas").getAttribute("data-template-id"),
		"return-loop",
		"empty-map context command starts the terminal U-turn session",
	);
	await page.keyboard.press("Escape");
}

async function placeActiveConstruction(page, anchor, options = { center: true }) {
	const anchorCenter = offsetCellCenter(anchor);
	if (options.center !== false) await centerWorld(page, anchorCenter);
	await moveToWorld(page, anchorCenter);
	try {
		await page.waitForFunction(
			() => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.templateValid === "true" || canvas?.dataset.draftPreviewValid === "true"
				);
			},
			undefined,
			{ timeout: 10_000 },
		);
	} catch (error) {
		const diagnostics = await page.getByTestId("rail-canvas").evaluate((canvas) => ({
			templateValid: canvas.dataset.templateValid,
			draftPreviewValid: canvas.dataset.draftPreviewValid,
			draftPreviewIssues: canvas.dataset.draftPreviewIssues,
			draftPreviewConflicts: canvas.dataset.draftPreviewConflictCells,
			planValid: canvas.dataset.templatePlanValid,
			placementCode: canvas.dataset.templatePlacementCode,
			feedbackCode: canvas.dataset.templateFeedbackCode,
			feedbackState: canvas.dataset.templateFeedbackState,
			reservedBounds: canvas.dataset.templateReservedBounds,
			conflicts: canvas.dataset.templateConflicts,
		}));
		const feedback = await page.getByTestId("template-placement-feedback").textContent();
		throw new Error(
			`Construction at ${anchor.x},${anchor.y} is not valid: ${JSON.stringify(diagnostics)} · ${feedback ?? ""}`,
			{ cause: error },
		);
	}
	await clickWorld(page, anchorCenter, false);
}

async function findValidTemplateTarget(page, label, candidates) {
	for (const candidate of candidates) {
		const pointer = offsetCellCenter(candidate);
		await centerWorld(page, pointer);
		await moveToWorld(page, pointer);
		await page.waitForFunction(
			(expected) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.pointerCellX === String(expected.x) &&
					canvas.dataset.pointerCellY === String(expected.y)
				);
			},
			candidate,
			{ timeout: 10_000 },
		);
		if ((await page.getByTestId("rail-canvas").getAttribute("data-template-valid")) === "true") {
			return pointer;
		}
	}
	const feedback = await page.getByTestId("template-placement-feedback").textContent();
	throw new Error(`No valid ${label} attachment target was found. ${feedback ?? ""}`);
}

function attachmentCandidateGrid() {
	const candidates = [];
	for (const y of [0, 6, 20, 26]) {
		for (const x of [2, 5, 8, 11, 14, 17, 20, 23]) candidates.push({ x, y });
	}
	for (const x of [0, 8, 24]) {
		for (const y of [2, 4, 9, 12, 15, 18, 22, 24]) candidates.push({ x, y });
	}
	return candidates;
}

async function placeOneOhb(page) {
	await clickActivityCommand(page, "equip", "OHB 포트 배치");
	await page.waitForFunction(
		() =>
			Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.portSlotLegalCount) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	const before = await readMetrics(page);
	let placedSlot = null;
	for (const slot of [
		{ x: 8.5, y: 1.2 },
		{ x: 8.5, y: -0.2 },
	]) {
		await centerWorld(page, slot);
		await moveToWorld(page, slot);
		await page.waitForTimeout(50);
		if ((await page.getByTestId("rail-canvas").getAttribute("data-hover-port-slot")) === "") {
			continue;
		}
		await clickWorld(page, slot, false);
		placedSlot = slot;
		break;
	}
	if (!placedSlot)
		throw new Error("The documented Long Bay station produced no selectable OHB slot.");
	await waitForWorker(
		page,
		(metrics) => Number(metrics.equipmentPorts) > Number(before.equipmentPorts),
	);
	return placedSlot;
}

async function exerciseCurrentLargeFabEquipmentAndBlueprint(page) {
	const baseline = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectName === "OpenFab Large FAB" && Number(metrics.physicalPaths) > 5_000,
	);
	const projectId = baseline.projectId;
	const railFingerprint = baseline.modelPhysicalFingerprint;
	recordPhase4Checkpoint("large-fab-rail-and-organization", baseline);

	await clickActivityCommand(page, "equip", "EQ 포트 행 배치");
	await waitForLegalPortSlots(page);
	const straightRuns = await readLegalStraightPortRuns(page, "EQ");
	const run = straightRuns.find((candidate) => candidate.items.length >= 96);
	if (!run) throw new Error("The 60-Bay FAB exposes no 96 m legal straight port corridor.");
	const windowStart = Math.floor((run.items.length - 84) / 2);
	const eqSlots = run.items.slice(windowStart, windowStart + 3);
	const stkCandidates = run.items.slice(windowStart + 12, windowStart + 55).filter((_, index) => {
		return index % 3 === 0;
	});
	const membershipCandidates = run.items.slice(windowStart + 56, windowStart + 68).reverse();
	const ohbRailCenters = run.items.slice(windowStart + 70, windowStart + 82);
	if (eqSlots.length !== 3 || stkCandidates.length < 4 || ohbRailCenters.length < 4) {
		throw new Error("The selected 60-Bay FAB port corridor is too short for the audit layout.");
	}

	const eqBefore = await readMetrics(page);
	await centerWorld(page, eqSlots[1]);
	const eqStart = await screenPointForWorld(page, eqSlots[0]);
	const eqEnd = await screenPointForWorld(page, eqSlots[2]);
	await page.mouse.move(eqStart.x, eqStart.y);
	await page.mouse.down();
	await page.mouse.move(eqEnd.x, eqEnd.y, { steps: 8 });
	await page.mouse.up();
	const eqPlaced = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) === Number(eqBefore.workerTargetSequence) + 1 &&
			Number(metrics.equipmentGroups) === Number(eqBefore.equipmentGroups) + 1 &&
			Number(metrics.equipmentPorts) === Number(eqBefore.equipmentPorts) + 3,
	);
	assertEqual(eqPlaced.modelPhysicalFingerprint, railFingerprint, "Large FAB EQ physical identity");
	recordPhase4Checkpoint("large-fab-eq", eqPlaced);

	const editEqMembership = page.getByTestId("edit-port-equipment-membership");
	await editEqMembership.waitFor({ state: "visible" });
	await editEqMembership.click();
	await waitForMembershipState(page, { type: "EQ", sourceRows: 3, draftRows: 3 });
	await page.getByTestId("rail-canvas").focus();
	const membershipAxisKeys =
		Math.abs(eqSlots[2].x - eqSlots[0].x) > Math.abs(eqSlots[2].y - eqSlots[0].y)
			? ["ArrowLeft", "ArrowRight"]
			: ["ArrowUp", "ArrowDown"];
	let eqMembershipPortCount = 3;
	for (let endpoint = 0; endpoint < 2 && eqMembershipPortCount === 3; endpoint++) {
		if (endpoint > 0) await page.keyboard.press("e");
		for (const key of membershipAxisKeys) {
			await page.keyboard.press(key);
			await page.waitForTimeout(80);
			eqMembershipPortCount = Number(
				await page.getByTestId("rail-canvas").getAttribute("data-port-membership-draft-rows"),
			);
			if (eqMembershipPortCount !== 3) break;
		}
	}
	if (eqMembershipPortCount === 3) {
		throw new Error("Large FAB EQ membership exposes no editable endpoint candidate.");
	}
	assertAtLeast(eqMembershipPortCount, 2, "Large FAB EQ membership port count");
	await page.getByTestId("complete-port-equipment-membership").click();
	const eqMembershipCommitted = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) === Number(eqPlaced.workerTargetSequence) + 1 &&
			Number(metrics.equipmentGroups) === Number(eqPlaced.equipmentGroups) &&
			Number(metrics.equipmentPorts) ===
				Number(eqPlaced.equipmentPorts) - 3 + eqMembershipPortCount,
	);
	const eqMembershipRedone = await undoAndRedo(page, eqPlaced, eqMembershipCommitted);
	assertEqual(
		eqMembershipRedone.modelPhysicalFingerprint,
		railFingerprint,
		"Large FAB EQ membership physical identity",
	);
	recordPhase4Checkpoint("large-fab-eq-membership", eqMembershipRedone);

	await clickActivityCommand(page, "equip", "STK 포트 그룹 배치");
	await page.getByTestId("stk-template-FLEX").click();
	await waitForLegalPortSlots(page);
	const stkWorlds = [];
	stkWorlds.push(await clickAvailableStkCandidate(page, stkCandidates, 1, stkWorlds));
	stkWorlds.push(await clickAvailableStkCandidate(page, stkCandidates, 2, stkWorlds));
	const stkComplete = page.getByTestId("stk-complete");
	assertEqual(await stkComplete.isEnabled(), true, "Large FAB sparse FLEX STK completion");
	const stkBefore = await readMetrics(page);
	await stkComplete.click();
	const stkPlaced = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) === Number(stkBefore.workerTargetSequence) + 1 &&
			Number(metrics.equipmentGroups) === Number(stkBefore.equipmentGroups) + 1 &&
			Number(metrics.equipmentPorts) === Number(stkBefore.equipmentPorts) + 2,
	);
	assertEqual(
		stkPlaced.modelPhysicalFingerprint,
		railFingerprint,
		"Large FAB STK physical identity",
	);

	const editMembership = page.getByTestId("edit-port-equipment-membership");
	await editMembership.waitFor({ state: "visible" });
	await editMembership.click();
	await waitForMembershipState(page, { type: "STK", sourceRows: 2, draftRows: 2 });
	const membershipBefore = await readMetrics(page);
	const membershipWorld = await clickAvailableStkMembershipCandidate(
		page,
		membershipCandidates,
		3,
		stkWorlds,
	);
	await page.getByTestId("complete-port-equipment-membership").click();
	const membershipCommitted = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) === Number(membershipBefore.workerTargetSequence) + 1 &&
			Number(metrics.equipmentPorts) === Number(membershipBefore.equipmentPorts) + 1,
	);
	assertEqual(
		membershipCommitted.modelPhysicalFingerprint,
		railFingerprint,
		"Large FAB STK membership physical identity",
	);
	await page.getByRole("button", { name: "실행 취소" }).click();
	const membershipUndone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) ===
				Number(membershipCommitted.workerTargetSequence) + 1 &&
			metrics.workerChecksum === membershipBefore.workerChecksum,
	);
	await page.getByRole("button", { name: "다시 실행" }).click();
	const membershipRedone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(membershipUndone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === membershipCommitted.workerChecksum,
	);
	assertEqual(
		membershipRedone.modelPhysicalFingerprint,
		railFingerprint,
		"Large FAB STK membership redo physical identity",
	);
	recordPhase4Checkpoint("large-fab-flex-stk-membership", membershipRedone);

	await clickActivityCommand(page, "equip", "OHB 포트 배치");
	await waitForLegalPortSlots(page);
	const ohbCandidates = await readOhbCandidatesAtRailCenters(page, ohbRailCenters);
	const ohbBefore = await readMetrics(page);
	const ohbWorld = await clickAvailableOhbCandidate(page, ohbCandidates, ohbBefore);
	const equipmentComplete = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) === Number(ohbBefore.workerTargetSequence) + 1 &&
			Number(metrics.equipmentGroups) === Number(ohbBefore.equipmentGroups) + 1 &&
			Number(metrics.equipmentPorts) === Number(ohbBefore.equipmentPorts) + 1,
	);
	assertEqual(
		equipmentComplete.modelPhysicalFingerprint,
		railFingerprint,
		"Large FAB OHB physical identity",
	);
	recordPhase4Checkpoint("large-fab-port-first-equipment", equipmentComplete);

	const selectedWorlds = [...eqSlots, ...stkWorlds, membershipWorld, ohbWorld];
	const selectionBounds = selectedWorlds.reduce(
		(bounds, world) => ({
			minX: Math.min(bounds.minX, world.x - 2),
			minY: Math.min(bounds.minY, world.y - 2),
			maxX: Math.max(bounds.maxX, world.x + 2),
			maxY: Math.max(bounds.maxY, world.y + 2),
		}),
		{
			minX: Number.POSITIVE_INFINITY,
			minY: Number.POSITIVE_INFINITY,
			maxX: Number.NEGATIVE_INFINITY,
			maxY: Number.NEGATIVE_INFINITY,
		},
	);
	await selectWorldArea(page, selectionBounds);
	const selected = await readMetrics(page);
	assertEqual(selected.projectId, projectId, "Large FAB mixed selection project identity");
	assertAtLeast(Number(selected.selectionModules), 3, "Large FAB mixed selection rail modules");
	assertEqual(selected.selectionEquipmentGroups, "3", "Large FAB mixed selection equipment groups");
	assertEqual(
		selected.selectionPorts,
		String(Number(equipmentComplete.equipmentPorts) - Number(baseline.equipmentPorts)),
		"Large FAB mixed selection ports",
	);

	const projectTrigger = page.locator(".tilefab-project-trigger");
	await projectTrigger.click();
	const projectMenu = page.locator("#tilefab-project-menu");
	await projectMenu.waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	await projectMenu.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.classList.contains("tilefab-project-trigger") === true,
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		(await readMetrics(page)).selectionModules,
		selected.selectionModules,
		"Project menu Escape preserves Large FAB selection",
	);
	assertEqual(
		await page.evaluate(() =>
			document.activeElement?.classList.contains("tilefab-project-trigger"),
		),
		true,
		"Project menu Escape restores trigger focus",
	);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(150);
	const compactSelectionHints = page.getByTestId("editor-action-hints");
	await assertLocatorInsideViewport(page, compactSelectionHints);
	const selectionHintIds = [
		"toggle-selection-item",
		"add-selection",
		"subtract-selection",
		"connected-selection",
		"clone-selection",
		"cut-selection",
		"save-selection",
		"delete-selection",
	];
	for (const hintId of selectionHintIds) {
		await assertLocatorInsideViewport(
			page,
			compactSelectionHints.locator(`[data-hint-id="${hintId}"]`),
		);
	}
	await assertLocatorInsideViewport(
		page,
		compactSelectionHints.locator('[data-hint-id="subtract-selection"] .tilefab-mouse-cue'),
	);
	await page.screenshot({
		path: path.join(artifactRoot, "compact-large-fab-mixed-selection.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 390, height: 720 });
	await page.waitForTimeout(100);
	await assertLocatorInsideViewport(page, compactSelectionHints);
	for (const hintId of selectionHintIds) {
		await assertLocatorInsideViewport(
			page,
			compactSelectionHints.locator(`[data-hint-id="${hintId}"]`),
		);
	}
	await assertLocatorInsideViewport(
		page,
		compactSelectionHints.locator('[data-hint-id="subtract-selection"] .tilefab-mouse-cue'),
	);
	await page.screenshot({
		path: path.join(artifactRoot, "compact-720-large-fab-mixed-selection.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);

	await saveSelectionAsBlueprint(page, "Phase 4 Mixed Bay", "Acceptance");
	const blueprintRecord = page
		.getByTestId("blueprint-record")
		.filter({ hasText: "Phase 4 Mixed Bay" });
	assertEqual(
		await blueprintRecord.getAttribute("data-kind"),
		"STATIC_FAB",
		"Large FAB blueprint kind",
	);
	assertEqual(
		await blueprintRecord.getAttribute("data-equipment-groups"),
		"3",
		"Large FAB blueprint equipment groups",
	);
	assertEqual(
		await blueprintRecord.getAttribute("data-ports"),
		selected.selectionPorts,
		"Large FAB blueprint exact selected ports",
	);
	const blueprintContract = await readProjectBlueprintContract(page, "Phase 4 Mixed Bay");
	assertEqual(blueprintContract.kind, "STATIC_FAB", "Large FAB blueprint portable kind");
	assertEqual(blueprintContract.groupCount, 3, "Large FAB blueprint portable groups");
	assertEqual(
		blueprintContract.portCount,
		Number(selected.selectionPorts),
		"Large FAB blueprint portable ports",
	);
	const beforeDirectUserSave = await readMetrics(page);
	const directUserProjectJsonBefore = await page.evaluate(() =>
		JSON.stringify(window.__tileFab?.getProjectBlueprints?.()),
	);
	await page.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();
	await page.getByTestId("rail-canvas").focus();
	await page.keyboard.press("Control+S");
	await completeContextualBlueprintSave(page, {
		name: "Phase 4 Mixed Bay",
		folder: "Acceptance",
		destination: "user-library",
		quickSlot: 4,
	});
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "1",
		undefined,
		{ timeout: 10_000 },
	);
	const afterDirectUserSave = await readMetrics(page);
	assertProjectUnchanged(
		afterDirectUserSave,
		beforeDirectUserSave,
		"mixed direct user-library save",
	);
	assertExactStaticFabModelIdentity(
		afterDirectUserSave,
		beforeDirectUserSave,
		"mixed direct user-library model identity",
	);
	assertEqual(
		afterDirectUserSave.railClipboard,
		beforeDirectUserSave.railClipboard,
		"mixed direct save clipboard kind",
	);
	assertEqual(
		afterDirectUserSave.railClipboardVersion,
		beforeDirectUserSave.railClipboardVersion,
		"mixed direct save clipboard version",
	);
	assertEqual(
		await page.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		directUserProjectJsonBefore,
		"mixed direct save project blueprint JSON",
	);
	await clickActivityCommand(page, "assemble", "내 청사진");
	await page.getByTestId("blueprint-user-tab").click();
	const promotedUserBlueprint = page
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Phase 4 Mixed Bay" });
	await promotedUserBlueprint.waitFor({ state: "visible" });
	assertEqual(
		await promotedUserBlueprint.getAttribute("data-kind"),
		"STATIC_FAB",
		"Large FAB user blueprint portable kind",
	);
	assertEqual(
		await promotedUserBlueprint.getAttribute("data-equipment-groups"),
		"3",
		"Large FAB user blueprint equipment groups",
	);
	assertEqual(
		await promotedUserBlueprint.getAttribute("data-ports"),
		selected.selectionPorts,
		"Large FAB user blueprint ports",
	);
	await page.getByRole("tab", { name: /PROJECT 1/ }).click();
	const blueprintBefore = await readMetrics(page);
	const equipmentBeforeBlueprint = await readPortEquipmentContract(page);
	await startSavedBlueprintPlacement(page, "Phase 4 Mixed Bay");
	const geometry = await readRailGeometry(page);
	if (!geometry.bounds)
		throw new Error("The 60-Bay FAB has no bounds for mixed blueprint placement.");
	const targetAnchor = {
		x: geometry.bounds.maxX + 64,
		y: Math.floor(selectionBounds.minY),
	};
	await placeActiveConstruction(page, targetAnchor);
	const blueprintPlaced = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) === Number(blueprintBefore.workerTargetSequence) + 1 &&
			Number(metrics.authoredEdges) ===
				Number(blueprintBefore.authoredEdges) + blueprintContract.edgeCount &&
			Number(metrics.authoredCells) ===
				Number(blueprintBefore.authoredCells) + blueprintContract.cellCount &&
			Number(metrics.equipmentGroups) ===
				Number(blueprintBefore.equipmentGroups) + blueprintContract.groupCount &&
			Number(metrics.equipmentPorts) ===
				Number(blueprintBefore.equipmentPorts) + blueprintContract.portCount,
	);
	const equipmentAfterBlueprint = await readPortEquipmentContract(page);
	assertPlacedBlueprintEquipmentContract(
		blueprintContract,
		equipmentBeforeBlueprint,
		equipmentAfterBlueprint,
	);
	await undoAndRedo(page, blueprintBefore, blueprintPlaced);
	await page.getByRole("button", { name: "실행 취소" }).click();
	const blueprintCleaned = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(blueprintPlaced.workerTargetSequence) + 3 &&
			metrics.workerChecksum === blueprintBefore.workerChecksum,
	);
	await page.keyboard.press("Escape");
	assertEqual(blueprintCleaned.projectId, projectId, "Large FAB mixed blueprint cleanup project");
	assertEqual(
		blueprintCleaned.modelTopologyFingerprint,
		blueprintBefore.modelTopologyFingerprint,
		"Large FAB mixed blueprint cleanup topology identity",
	);
	recordPhase4Checkpoint("large-fab-mixed-blueprint", blueprintCleaned);
	return blueprintCleaned;
}

async function exerciseCurrentLargeFabContinuity(page, expectedAuthored) {
	const beforeChecks = await readMetrics(page);
	const projectId = beforeChecks.projectId;
	assertEqual(beforeChecks.projectName, "OpenFab Large FAB", "Phase 4 continuity project");
	assertExactStaticFabModelIdentity(beforeChecks, expectedAuthored, "Phase 4 authored handoff");
	assertEqual(beforeChecks.equipmentGroups, "3", "Phase 4 continuity equipment groups");
	assertAtLeast(Number(beforeChecks.equipmentPorts), 6, "Phase 4 continuity equipment ports");
	assertEqual(beforeChecks.projectBlueprints, "1", "Phase 4 continuity blueprints");
	assertEqual(beforeChecks.staticFabOrganizations, "2", "Phase 4 continuity organizations");

	const continuityGeometry = await readRailGeometry(page);
	if (!continuityGeometry.bounds) throw new Error("The 60-Bay FAB has no continuity bounds.");
	const isolatedBay = await placePattern(page, "long-bay", {
		x: continuityGeometry.bounds.maxX + 96,
		y: continuityGeometry.bounds.maxY + 96,
	});
	assertEqual(isolatedBay.projectId, projectId, "actionable CHECKS project identity");
	assertAtLeast(
		Number(isolatedBay.strongComponents),
		Number(beforeChecks.strongComponents) + 1,
		"actionable CHECKS disconnected flow regions",
	);
	const isolatedBayRedone = await undoAndRedo(page, beforeChecks, isolatedBay);
	await page.getByRole("button", { name: "FAB 전체 지도", exact: true }).click();
	const issueNavigator = page.getByTestId("static-fab-navigator-panel");
	await issueNavigator.waitFor({ state: "visible" });
	await page.getByTestId("static-fab-navigator-tab-checks").click();
	const issueChecksPanel = page.getByTestId("rail-readiness-panel");
	await issueChecksPanel.waitFor({ state: "visible" });
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.staticFabCheckStatus === "issues",
		undefined,
		{ timeout: 30_000 },
	);
	const issueChecked = await readMetrics(page);
	assertAtLeast(Number(issueChecked.staticFabCheckActions), 1, "actionable CHECKS actions");
	assertAtLeast(Number(issueChecked.staticFabCheckIssues), 1, "actionable CHECKS issues");
	const firstRailIssue = issueChecksPanel.locator('[data-testid^="rail-readiness-issue-"]').first();
	await firstRailIssue.waitFor({ state: "visible" });
	const issueCode = await firstRailIssue.getAttribute("data-code");
	if (!issueCode) throw new Error("The actionable rail issue has no stable code.");
	await firstRailIssue.click();
	const issueGuide = page.getByTestId("rail-readiness-guide");
	await issueGuide.waitFor({ state: "visible" });
	assertEqual(
		await issueGuide.getAttribute("data-code"),
		issueCode,
		"actionable CHECKS guide code",
	);
	assertEqual(await firstRailIssue.getAttribute("data-active"), "true", "actionable issue focus");
	const nextEdit =
		(await issueGuide.locator(".tilefab-readiness-next-action p").textContent())?.trim() ?? "";
	assertAtLeast(nextEdit.length, 12, "actionable CHECKS next edit guidance");
	const locationText =
		(await issueGuide.locator(".tilefab-readiness-location-nav span").textContent())?.trim() ?? "";
	if (!locationText.includes("X ") || !locationText.includes("Z ")) {
		throw new Error(`Actionable CHECKS did not expose a map location: ${locationText}`);
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	await assertLocatorInsideViewport(page, issueChecksPanel);
	await assertLocatorInsideViewport(page, issueGuide);
	await assertLocatorInsideViewport(page, firstRailIssue);
	await page.screenshot({
		path: path.join(artifactRoot, "compact-large-fab-actionable-checks.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	recordPhase4Checkpoint("large-fab-actionable-checks", issueChecked);
	await issueChecksPanel
		.getByRole("button", { name: "정적 FAB 검사 패널 닫기", exact: true })
		.click();
	await issueChecksPanel.waitFor({ state: "hidden" });
	await page.getByRole("button", { name: "실행 취소" }).click();
	const issueCleaned = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(isolatedBayRedone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeChecks.workerChecksum &&
			metrics.modelChecksum === beforeChecks.modelChecksum,
	);
	assertStaticFabAuthoredContentIdentity(issueCleaned, beforeChecks, "actionable CHECKS cleanup");
	assertRailGeometryIdentity(
		await readRailGeometry(page),
		continuityGeometry,
		"actionable CHECKS cleanup rail geometry",
	);
	const healthyBaseline = issueCleaned;

	await page.getByRole("button", { name: "FAB 전체 지도", exact: true }).click();
	const navigator = page.getByTestId("static-fab-navigator-panel");
	await navigator.waitFor({ state: "visible" });
	await page.getByTestId("static-fab-navigator-tab-checks").click();
	const checksPanel = page.getByTestId("rail-readiness-panel");
	await checksPanel.waitFor({ state: "visible" });
	await page.waitForFunction(
		() => {
			const status = document.querySelector(".tilefab-app")?.dataset.staticFabCheckStatus;
			return Boolean(status && status !== "checking" && status !== "unchecked");
		},
		undefined,
		{ timeout: 30_000 },
	);
	const checked = await readMetrics(page);
	assertExactStaticFabModelIdentity(checked, healthyBaseline, "Large FAB CHECKS");
	assertEqual(checked.staticFabCheckStatus, "ready", "Large FAB CHECKS status");
	assertEqual(checked.staticFabCheckActions, "0", "Large FAB CHECKS actions");
	assertEqual(checked.staticFabCheckIssues, "0", "Large FAB CHECKS issues");
	const exactSource = await checksPanel.evaluate((panel) => {
		const label = Array.from(panel.querySelectorAll("dt")).find(
			(element) => element.textContent?.trim() === "EXACT SOURCE",
		);
		return label?.parentElement?.querySelector("dd")?.textContent?.trim() ?? null;
	});
	assertEqual(exactSource, "MATCHED", "Large FAB CHECKS exact source");
	await checksPanel.getByRole("button", { name: "정적 FAB 검사 패널 닫기", exact: true }).click();
	await checksPanel.waitFor({ state: "hidden" });
	assertExactStaticFabModelIdentity(
		await readMetrics(page),
		healthyBaseline,
		"Large FAB CHECKS close",
	);
	recordPhase4Checkpoint("large-fab-static-checks", checked);

	const firstSavedPath = await saveProject(page);
	const firstSavedJson = await readFile(firstSavedPath, "utf8");
	const saved = await readMetrics(page);
	assertExactStaticFabModelIdentity(saved, healthyBaseline, "Large FAB native save");
	assertEqual(saved.projectDirty, "false", "Large FAB native save dirty state");

	await reloadProjectFromFile(page, firstSavedPath);
	const reloaded = await waitForWorker(
		page,
		(metrics) => metrics.projectId === projectId && metrics.modelChecksum === saved.modelChecksum,
	);
	assertFullStaticFabReloadIdentity(reloaded, saved, "Large FAB native reload");
	assertEqual(reloaded.projectDirty, "false", "Large FAB native reload dirty state");
	assertEqual(reloaded.historyCanUndo, "false", "Large FAB native reload undo reset");
	assertEqual(reloaded.historyCanRedo, "false", "Large FAB native reload redo reset");
	const roundTripPath = await saveProject(page);
	const roundTripJson = await readFile(roundTripPath, "utf8");
	assertCanonicalAuthoredEquality(firstSavedJson, roundTripJson);
	recordPhase4Checkpoint("large-fab-native-reload", reloaded);

	await clickActivityCommand(page, "equip", "OHB 포트 배치");
	await waitForLegalPortSlots(page);
	const continuedEditBefore = await readMetrics(page);
	const continuedEditStartedAt = new Date().toISOString();
	const ohbCandidates = await readLegalPortCandidates(page, "OHB", 256);
	await clickAvailableOhbCandidate(page, ohbCandidates, continuedEditBefore);
	const continuedEdit = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) ===
				Number(continuedEditBefore.workerTargetSequence) + 1 &&
			Number(metrics.equipmentGroups) === Number(continuedEditBefore.equipmentGroups) + 1 &&
			Number(metrics.equipmentPorts) === Number(continuedEditBefore.equipmentPorts) + 1,
	);
	assertEqual(
		continuedEdit.modelPhysicalFingerprint,
		continuedEditBefore.modelPhysicalFingerprint,
		"Large FAB continued OHB edit physical identity",
	);
	const continuedRedone = await undoAndRedo(page, continuedEditBefore, continuedEdit);
	assertEqual(continuedRedone.projectDirty, "true", "Large FAB continued edit dirty state");
	assertEqual(continuedRedone.historyCanUndo, "true", "Large FAB continued edit undo state");
	recordPhase4Checkpoint("large-fab-post-reload-edit", continuedRedone);

	const recovery = await waitForRecoveryRecord(
		page,
		projectId,
		continuedRedone.modelChecksum,
		continuedEditStartedAt,
	);
	const recoveryPayload = JSON.parse(recovery.json);
	assertEqual(
		recoveryPayload.blueprints.records.length,
		Number(continuedRedone.projectBlueprints),
		"Large FAB recovery blueprint library",
	);
	assertEqual(
		recoveryPayload.areas.records.length,
		Number(continuedRedone.staticFabOrganizations),
		"Large FAB recovery organizations",
	);
	await page.reload({ waitUntil: "domcontentloaded" });
	await waitForReady(page, { physicalPaths: 0 });
	const recoveryBanner = page.locator(".tilefab-recovery");
	await recoveryBanner.waitFor({ state: "visible", timeout: 30_000 });
	if (!(await recoveryBanner.textContent())?.includes("OpenFab Large FAB")) {
		throw new Error("Large FAB recovery offer does not identify the interrupted project.");
	}
	await page.setViewportSize({ width: 390, height: 844 });
	await clickActivityCommand(page, "equip", "EQ 포트 행 배치");
	const recoveryPortLayout = await page.evaluate(() => {
		const recoveryElement = document.querySelector(".tilefab-recovery");
		const portBuildbarElement = document.querySelector(".tilefab-port-buildbar");
		const recoveryBounds = recoveryElement?.getBoundingClientRect();
		const portBuildbarBounds = portBuildbarElement?.getBoundingClientRect();
		return {
			documentScrollWidth: document.documentElement.scrollWidth,
			recovery: recoveryBounds ? { top: recoveryBounds.top, bottom: recoveryBounds.bottom } : null,
			portBuildbar: portBuildbarBounds
				? { top: portBuildbarBounds.top, bottom: portBuildbarBounds.bottom }
				: null,
		};
	});
	if (!recoveryPortLayout.recovery || !recoveryPortLayout.portBuildbar) {
		throw new Error("390px recovery and Port-first controls did not render together.");
	}
	assertAtMost(
		recoveryPortLayout.documentScrollWidth,
		390,
		"390px recovery Port-first horizontal overflow",
	);
	assertAtMost(
		recoveryPortLayout.recovery.bottom,
		recoveryPortLayout.portBuildbar.top,
		"390px recovery notice stays above the Port-first buildbar",
	);
	await page.screenshot({
		path: path.join(artifactRoot, "compact-large-fab-recovery-port-first.png"),
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await clickActivityCommand(page, "build", "레일 건설");
	await recoveryBanner.getByRole("button", { name: "복구", exact: true }).click();
	const recovered = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId && metrics.modelChecksum === continuedRedone.modelChecksum,
	);
	assertFullStaticFabReloadIdentity(recovered, continuedRedone, "Large FAB autosave recovery");
	assertEqual(recovered.projectDirty, "true", "Large FAB recovery dirty state");
	assertEqual(recovered.historyCanUndo, "false", "Large FAB recovery undo reset");
	assertEqual(recovered.historyCanRedo, "false", "Large FAB recovery redo reset");
	recordPhase4Checkpoint("large-fab-autosave-recovery", recovered);

	const recoveredSavedPath = await saveProject(page);
	const recoveredSavedJson = await readFile(recoveredSavedPath, "utf8");
	assertCanonicalAuthoredEquality(recovery.json, recoveredSavedJson);
}

async function exercisePersistedLargeFabUserBlueprint(page) {
	reportAcceptanceProgress("user-library:start");
	const beforePlacement = await readMetrics(page);
	const projectId = beforePlacement.projectId;
	const geometry = await readRailGeometry(page);
	if (!geometry.bounds) throw new Error("The recovered 60-Bay FAB has no placement bounds.");
	const blueprintContract = await readProjectBlueprintContract(page, "Phase 4 Mixed Bay");
	const equipmentBefore = await readPortEquipmentContract(page);
	const targetAnchor = {
		x: geometry.bounds.maxX + 16,
		y: Math.floor((geometry.bounds.minY + geometry.bounds.maxY) / 2),
	};
	await fitAndZoomOut(page, 4);

	await clickActivityCommand(page, "assemble", "내 청사진");
	await page.getByTestId("blueprint-user-tab").click();
	const record = page.getByTestId("user-blueprint-record").filter({ hasText: "Phase 4 Mixed Bay" });
	await record.waitFor({ state: "visible" });
	assertEqual(await record.getAttribute("data-kind"), "STATIC_FAB", "reloaded user blueprint kind");
	assertEqual(
		await record.getAttribute("data-equipment-groups"),
		String(blueprintContract.groupCount),
		"reloaded user blueprint groups",
	);
	assertEqual(
		await record.getAttribute("data-ports"),
		String(blueprintContract.portCount),
		"reloaded user blueprint ports",
	);
	assertEqual(
		(await readMetrics(page)).userBlueprintStorage,
		"persistent",
		"reloaded user blueprint IndexedDB durability",
	);

	const portableFileBaseline = await readMetrics(page);
	const portableProjectJsonBefore = await page.evaluate(() =>
		JSON.stringify(window.__tileFab?.getProjectBlueprints?.()),
	);
	const portableUserRecordBefore = await page.evaluate(() => {
		const record = window.__tileFab
			?.getUserBlueprints?.()
			.find((candidate) => candidate.blueprint.name === "Phase 4 Mixed Bay");
		return record ? JSON.stringify(record) : null;
	});
	if (!portableUserRecordBefore) {
		throw new Error("The persisted mixed FAB user blueprint record is unavailable.");
	}
	const recordMenuButton = record.getByTestId("user-blueprint-record-menu");
	const recordMenuBox = await recordMenuButton.boundingBox();
	if (!recordMenuBox || recordMenuBox.width < 44 || recordMenuBox.height < 44) {
		throw new Error(
			`User blueprint record menu target is smaller than 44 px: ${JSON.stringify(recordMenuBox)}`,
		);
	}
	await recordMenuButton.click();
	const recordContext = record.getByTestId("blueprint-record-context");
	await recordContext.waitFor({ state: "visible", timeout: 10_000 });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-command") === "edit-metadata",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await recordContext
			.locator('[role="menuitem"]')
			.evaluateAll((items) => items.filter((item) => item.tabIndex === 0).length),
		1,
		"user blueprint context has one roving tab stop",
	);
	await page.keyboard.press("End");
	assertEqual(
		await page.evaluate(() => document.activeElement?.getAttribute("data-command")),
		"delete-user-blueprint",
		"user blueprint context End navigation",
	);
	await page.keyboard.press("Home");
	assertEqual(
		await page.evaluate(() => document.activeElement?.getAttribute("data-command")),
		"edit-metadata",
		"user blueprint context Home navigation",
	);
	await page.keyboard.press("ArrowUp");
	assertEqual(
		await page.evaluate(() => document.activeElement?.getAttribute("data-command")),
		"delete-user-blueprint",
		"user blueprint context ArrowUp wraps",
	);
	assertEqual(
		await recordContext
			.locator('[role="menuitem"]')
			.evaluateAll((items) => items.filter((item) => item.tabIndex === 0).length),
		1,
		"user blueprint context preserves one roving tab stop after navigation",
	);
	await page.keyboard.press("Escape");
	await recordContext.waitFor({ state: "detached", timeout: 10_000 });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "user-blueprint-record-menu",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await recordMenuButton.evaluate((element) => element === document.activeElement),
		true,
		"user blueprint context Escape focus return",
	);
	const placementTrigger = record.locator(".tilefab-blueprint-place");
	await placementTrigger.focus();
	await placementTrigger.press("Shift+F10");
	await recordContext.waitFor({ state: "visible", timeout: 10_000 });
	await page.keyboard.press("Escape");
	await recordContext.waitFor({ state: "detached", timeout: 10_000 });
	const contextRecordId = await record.getAttribute("data-blueprint-id");
	if (!contextRecordId) throw new Error("Shift+F10 blueprint record id is unavailable.");
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-place`,
			),
		contextRecordId,
		{ timeout: 10_000 },
	);
	assertEqual(
		await placementTrigger.evaluate((element) => element === document.activeElement),
		true,
		"user blueprint Shift+F10 returns focus to the invoking placement control",
	);
	assertProjectUnchanged(
		await readMetrics(page),
		portableFileBaseline,
		"user blueprint context open project isolation",
	);
	assertEqual(
		await page.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		portableProjectJsonBefore,
		"user blueprint context open project JSON isolation",
	);
	assertEqual(
		await page.evaluate(() => {
			const record = window.__tileFab
				?.getUserBlueprints?.()
				.find((candidate) => candidate.blueprint.name === "Phase 4 Mixed Bay");
			return record ? JSON.stringify(record) : null;
		}),
		portableUserRecordBefore,
		"user blueprint context open record isolation",
	);
	reportAcceptanceProgress("user-library:context-keyboard-pass");
	const blueprintDownloadPromise = page.waitForEvent("download");
	await runUserBlueprintRecordCommand(record, "Phase 4 Mixed Bay .openfabbp 내보내기");
	const blueprintDownload = await blueprintDownloadPromise;
	if (!blueprintDownload.suggestedFilename().endsWith(".openfabbp")) {
		throw new Error("User blueprint export did not use the .openfabbp extension.");
	}
	const exportedBlueprintPath = path.join(artifactRoot, "phase-4-mixed-bay.openfabbp");
	await blueprintDownload.saveAs(exportedBlueprintPath);
	const exportedBlueprintJson = await readFile(exportedBlueprintPath, "utf8");
	const exportedBlueprintEnvelope = JSON.parse(exportedBlueprintJson);
	assertEqual(
		Object.keys(exportedBlueprintEnvelope).join(","),
		"blueprint,createdAt,folderPath,id,quickSlot,schemaVersion,updatedAt",
		"portable blueprint canonical envelope keys",
	);
	assertEqual(exportedBlueprintEnvelope.blueprint.kind, "STATIC_FAB", "portable blueprint kind");
	assertEqual(
		exportedBlueprintEnvelope.blueprint.edges.length,
		blueprintContract.edgeCount,
		"portable blueprint directed edges",
	);
	assertEqual(
		exportedBlueprintEnvelope.blueprint.equipmentGroups.length,
		blueprintContract.groupCount,
		"portable blueprint equipment groups",
	);
	assertEqual(
		exportedBlueprintEnvelope.blueprint.ports.length,
		blueprintContract.portCount,
		"portable blueprint ports",
	);
	assertEqual(exportedBlueprintJson.endsWith("\n"), true, "portable blueprint canonical newline");
	const futureTimestamp = "2099-01-01T00:00:00.000Z";
	const futureBlueprintEnvelope = structuredClone(exportedBlueprintEnvelope);
	futureBlueprintEnvelope.createdAt = futureTimestamp;
	futureBlueprintEnvelope.updatedAt = futureTimestamp;
	futureBlueprintEnvelope.blueprint.createdAt = futureTimestamp;
	futureBlueprintEnvelope.blueprint.updatedAt = futureTimestamp;
	const futureBlueprintPath = path.join(artifactRoot, "phase-4-mixed-bay-future.openfabbp");
	await writeFile(
		futureBlueprintPath,
		`${JSON.stringify(futureBlueprintEnvelope, null, "\t")}\n`,
		"utf8",
	);
	assertProjectUnchanged(
		await readMetrics(page),
		portableFileBaseline,
		"user blueprint export project isolation",
	);
	const malformedBlueprintPath = path.join(artifactRoot, "malformed-blueprint.openfabbp");
	await writeFile(malformedBlueprintPath, '{"schemaVersion":1,"id":', "utf8");
	const malformedFileChooserPromise = page.waitForEvent("filechooser");
	await page.getByTestId("user-blueprint-import").click();
	const malformedFileChooser = await malformedFileChooserPromise;
	await malformedFileChooser.setFiles(malformedBlueprintPath);
	await waitForEditorStatus(page, ".openfabbp 파일을 읽지 못했습니다");
	assertEqual(
		await page.getByTestId("user-blueprint-import-preview").count(),
		0,
		"malformed portable blueprint exposes no import preview",
	);
	assertEqual((await readMetrics(page)).userBlueprints, "1", "malformed import library isolation");
	assertProjectUnchanged(
		await readMetrics(page),
		portableFileBaseline,
		"malformed user blueprint import project isolation",
	);
	reportAcceptanceProgress("user-library:export-and-malformed-import-pass");

	const blueprintFileChooserPromise = page.waitForEvent("filechooser");
	await page.getByTestId("user-blueprint-import").click();
	const blueprintFileChooser = await blueprintFileChooserPromise;
	await blueprintFileChooser.setFiles(futureBlueprintPath);
	const importPreview = page.getByTestId("user-blueprint-import-preview");
	await importPreview.waitFor({ state: "visible", timeout: 10_000 });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("aria-label") === "가져올 청사진 이름",
		undefined,
		{ timeout: 10_000 },
	);
	if (!(await importPreview.textContent())?.includes("새 라이브러리 ID")) {
		throw new Error("Duplicate .openfabbp import does not explain its ID collision resolution.");
	}
	assertEqual(
		(await importPreview.textContent())?.includes(`${blueprintContract.edgeCount} EDGES`),
		true,
		"portable blueprint import preview edge count",
	);
	await importPreview.getByLabel("가져올 청사진 이름").fill("Imported Phase 4 Mixed Bay");
	await importPreview.getByLabel("가져올 청사진 폴더").fill("Process/Photo/Reusable/Bays");
	await page.screenshot({
		path: path.join(artifactRoot, "user-blueprint-import-preview.png"),
		fullPage: true,
	});
	await importPreview.getByRole("button", { name: "CANCEL", exact: true }).click();
	await importPreview.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "user-blueprint-import",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page
			.getByTestId("user-blueprint-import")
			.evaluate((element) => element === document.activeElement),
		true,
		"portable blueprint import cancel focus return",
	);
	const repeatedBlueprintFileChooserPromise = page.waitForEvent("filechooser");
	await page.getByTestId("user-blueprint-import").click();
	const repeatedBlueprintFileChooser = await repeatedBlueprintFileChooserPromise;
	await repeatedBlueprintFileChooser.setFiles(futureBlueprintPath);
	await importPreview.waitFor({ state: "visible", timeout: 10_000 });
	await importPreview.getByLabel("가져올 청사진 이름").fill("Imported Phase 4 Mixed Bay");
	await importPreview.getByLabel("가져올 청사진 폴더").fill("Process/Photo/Reusable/Bays");
	await importPreview.getByRole("button", { name: "IMPORT", exact: true }).click();
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "2",
		undefined,
		{ timeout: 10_000 },
	);
	const importedBlueprintRecord = page
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Imported Phase 4 Mixed Bay" });
	await importedBlueprintRecord.waitFor({ state: "visible", timeout: 10_000 });
	reportAcceptanceProgress("user-library:portable-import-pass");
	const importedEnvelopeId = await importedBlueprintRecord.getAttribute("data-blueprint-id");
	if (!importedEnvelopeId) throw new Error("Imported .openfabbp envelope id is unavailable.");
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-place`,
			),
		importedEnvelopeId,
		{ timeout: 10_000 },
	);
	const importedBlueprintContract = await page.evaluate(() => {
		const record = window.__tileFab
			?.getUserBlueprints?.()
			.find((candidate) => candidate.blueprint.name === "Imported Phase 4 Mixed Bay");
		if (!record) return null;
		return {
			id: record.id,
			blueprintId: record.blueprint.id,
			folder: record.folderPath.join("/"),
			quickSlot: record.quickSlot,
			kind: record.blueprint.kind,
			edges: record.blueprint.edges.length,
			groups: record.blueprint.kind === "STATIC_FAB" ? record.blueprint.equipmentGroups.length : 0,
			ports: record.blueprint.kind === "STATIC_FAB" ? record.blueprint.ports.length : 0,
		};
	});
	if (!importedBlueprintContract) throw new Error("Imported .openfabbp record is unavailable.");
	assertEqual(
		await importedBlueprintRecord
			.locator(".tilefab-blueprint-place")
			.evaluate((element) => element === document.activeElement),
		true,
		"portable blueprint import focus target",
	);
	assertNotEqual(
		importedBlueprintContract.id,
		exportedBlueprintEnvelope.id,
		"portable blueprint duplicate envelope id",
	);
	assertEqual(
		importedBlueprintContract.blueprintId,
		exportedBlueprintEnvelope.blueprint.id,
		"portable blueprint authored identity",
	);
	assertEqual(
		importedBlueprintContract.folder,
		"Process/Photo/Reusable/Bays",
		"portable blueprint import folder",
	);
	assertEqual(importedBlueprintContract.kind, "STATIC_FAB", "portable blueprint imported kind");
	assertEqual(
		importedBlueprintContract.edges,
		blueprintContract.edgeCount,
		"portable blueprint imported edges",
	);
	assertEqual(
		importedBlueprintContract.groups,
		blueprintContract.groupCount,
		"portable blueprint imported groups",
	);
	assertEqual(
		importedBlueprintContract.ports,
		blueprintContract.portCount,
		"portable blueprint imported ports",
	);
	const importedDragHandle = importedBlueprintRecord.getByRole("button", {
		name: "Imported Phase 4 Mixed Bay 정리 위치 선택",
		exact: true,
	});
	assertEqual(
		await importedDragHandle.getAttribute("aria-haspopup"),
		"menu",
		"drag handle menu type",
	);
	await importedDragHandle.click();
	const dragHandleContext = importedBlueprintRecord.getByTestId("blueprint-record-context");
	await dragHandleContext.waitFor({ state: "visible", timeout: 10_000 });
	await page.keyboard.press("Escape");
	await dragHandleContext.waitFor({ state: "detached", timeout: 10_000 });
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-record-drag`,
			),
		importedBlueprintContract.id,
		{ timeout: 10_000 },
	);
	assertEqual(
		await importedDragHandle.evaluate((element) => element === document.activeElement),
		true,
		"drag handle menu returns focus to the invoking control",
	);
	await dispatchCanceledLocatorDrag(
		page,
		importedDragHandle,
		page.getByTestId("user-blueprint-drag-slot-8"),
	);
	reportAcceptanceProgress("user-library:quick-slot-drag-start");
	await dispatchLocatorDrag(
		page,
		importedDragHandle,
		page.getByTestId("user-blueprint-drag-slot-9"),
	);
	reportAcceptanceProgress("user-library:quick-slot-drop-dispatched");
	await page.waitForFunction(
		(id) =>
			document
				.querySelector(`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"]`)
				?.getAttribute("data-quick-slot") === "9",
		importedBlueprintContract.id,
		{ timeout: 10_000 },
	);
	reportAcceptanceProgress("user-library:quick-slot-assigned");
	await assignUserBlueprintQuickSlot(importedBlueprintRecord, "Imported Phase 4 Mixed Bay", null);
	reportAcceptanceProgress("user-library:quick-slot-clear-command-finished");
	await page.waitForFunction(
		(id) =>
			document
				.querySelector(`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"]`)
				?.getAttribute("data-quick-slot") === "",
		importedBlueprintContract.id,
		{ timeout: 10_000 },
	);
	reportAcceptanceProgress("user-library:quick-slot-drag-pass");
	await dispatchLocatorDrag(page, importedDragHandle, page.getByTestId("user-blueprint-drag-root"));
	await page.waitForFunction(
		(id) => {
			const record = window.__tileFab
				?.getUserBlueprints?.()
				.find((candidate) => candidate.id === id);
			return record?.folderPath.length === 0;
		},
		importedBlueprintContract.id,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page.evaluate(
			(id) =>
				window.__tileFab?.getUserBlueprints?.().find((candidate) => candidate.id === id)?.blueprint
					.folder ?? null,
			importedBlueprintContract.id,
		),
		"",
		"user blueprint folder drag keeps embedded metadata synchronized",
	);
	reportAcceptanceProgress("user-library:folder-drag-pass");
	assertProjectUnchanged(
		await readMetrics(page),
		portableFileBaseline,
		"user blueprint import project isolation",
	);
	assertEqual(
		await page.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		portableProjectJsonBefore,
		"user blueprint import project JSON isolation",
	);
	const importedBlueprintRecordById = page.locator(
		`[data-testid="user-blueprint-record"][data-blueprint-id="${importedBlueprintContract.id}"]`,
	);
	await runUserBlueprintRecordCommand(
		importedBlueprintRecordById,
		"Imported Phase 4 Mixed Bay 이름과 폴더 편집",
	);
	const importedMetadataName = importedBlueprintRecordById.getByLabel(
		"Imported Phase 4 Mixed Bay 새 이름",
	);
	await page.waitForFunction(
		() =>
			document.activeElement?.getAttribute("aria-label") === "Imported Phase 4 Mixed Bay 새 이름",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await importedMetadataName.evaluate((element) => element === document.activeElement),
		true,
		"user blueprint metadata editor initial focus",
	);
	await importedBlueprintRecordById.getByRole("button", { name: "CANCEL", exact: true }).click();
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-place`,
			),
		importedBlueprintContract.id,
		{ timeout: 10_000 },
	);
	assertEqual(
		await importedBlueprintRecordById
			.locator(".tilefab-blueprint-place")
			.evaluate((element) => element === document.activeElement),
		true,
		"user blueprint metadata cancel focus return",
	);
	await runUserBlueprintRecordCommand(
		importedBlueprintRecordById,
		"Imported Phase 4 Mixed Bay 이름과 폴더 편집",
	);
	const renamedBlueprintNameInput = page
		.locator('input[aria-label="Imported Phase 4 Mixed Bay 새 이름"]:visible')
		.first();
	await renamedBlueprintNameInput.fill("Etch Reusable Mixed Bay");
	const renamedBlueprintFolderInput = page
		.locator('input[aria-label="Imported Phase 4 Mixed Bay 새 폴더"]:visible')
		.first();
	await renamedBlueprintFolderInput.click();
	assertEqual(
		await page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
		"Imported Phase 4 Mixed Bay 새 폴더",
		"user blueprint metadata folder focus",
	);
	await page.keyboard.press("Control+a");
	await page.keyboard.type("Process/Etch/Reusable/Bays");
	assertEqual(
		await renamedBlueprintNameInput.inputValue(),
		"Etch Reusable Mixed Bay",
		"user blueprint metadata name draft",
	);
	assertEqual(
		await renamedBlueprintFolderInput.inputValue(),
		"Process/Etch/Reusable/Bays",
		"user blueprint metadata folder draft",
	);
	await importedBlueprintRecordById.getByRole("button", { name: "SAVE", exact: true }).click();
	const renamedImportedRecord = page
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Etch Reusable Mixed Bay" });
	await renamedImportedRecord.waitFor({ state: "visible", timeout: 10_000 });
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-place`,
			),
		importedBlueprintContract.id,
		{ timeout: 10_000 },
	);
	assertEqual(
		await renamedImportedRecord
			.locator(".tilefab-blueprint-place")
			.evaluate((element) => element === document.activeElement),
		true,
		"user blueprint metadata save focus return",
	);
	await page.waitForFunction(
		(id) =>
			document
				.querySelector(`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"]`)
				?.getAttribute("data-blueprint-name") === "Etch Reusable Mixed Bay",
		importedBlueprintContract.id,
		{ timeout: 10_000 },
	);
	const renamedImportedContract = await page.evaluate((id) => {
		const record = window.__tileFab?.getUserBlueprints?.().find((candidate) => candidate.id === id);
		return record
			? {
					id: record.id,
					name: record.blueprint.name,
					folder: record.folderPath.join("/"),
					blueprintFolder: record.blueprint.folder,
					edges: record.blueprint.edges.length,
				}
			: null;
	}, importedBlueprintContract.id);
	if (!renamedImportedContract) throw new Error("Renamed user blueprint is unavailable.");
	assertEqual(
		renamedImportedContract.name,
		"Etch Reusable Mixed Bay",
		"user blueprint metadata name",
	);
	assertEqual(
		renamedImportedContract.id,
		importedBlueprintContract.id,
		"user blueprint metadata edit preserves envelope id",
	);
	assertEqual(
		renamedImportedContract.folder,
		"Process/Etch/Reusable/Bays",
		"user blueprint metadata folder",
	);
	assertEqual(
		renamedImportedContract.blueprintFolder,
		"Process/Etch/Reusable/Bays",
		"user blueprint embedded folder",
	);
	assertEqual(
		renamedImportedContract.edges,
		blueprintContract.edgeCount,
		"user blueprint metadata edit preserves geometry",
	);
	assertProjectUnchanged(
		await readMetrics(page),
		portableFileBaseline,
		"user blueprint metadata project isolation",
	);
	reportAcceptanceProgress("user-library:metadata-pass");
	const interruptedDeleteContext = await openBlueprintRecordContext(renamedImportedRecord, "user");
	await interruptedDeleteContext
		.getByRole("menuitem", {
			name: "Etch Reusable Mixed Bay 내 라이브러리에서 삭제",
			exact: true,
		})
		.click();
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-command") === "delete-user-blueprint",
		undefined,
		{ timeout: 10_000 },
	);
	const blueprintCountBeforeSurfaceSwitch = await page
		.getByTestId("tilefab-app")
		.getAttribute("data-user-blueprints");
	const interruptedAssembleMenu = page.getByTestId("static-fab-assemble-menu");
	await openStaticFabAssembleMenu(page, interruptedAssembleMenu, "blueprint context interruption");
	await page.locator("#tilefab-blueprint-library").waitFor({ state: "hidden" });
	await page.getByTestId("editor-activity-assemble").click();
	await interruptedAssembleMenu.waitFor({ state: "hidden" });
	await page.getByTestId("rail-blueprint-library-toggle").click();
	await page.locator("#tilefab-blueprint-tab-user").click();
	await page.getByTestId("blueprint-user-panel").waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("blueprint-record-context").count(),
		0,
		"task-surface switch clears pending user blueprint context",
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-user-blueprints"),
		blueprintCountBeforeSurfaceSwitch,
		"task-surface switch does not confirm pending blueprint deletion",
	);

	const renamedImportedDragHandle = renamedImportedRecord.getByRole("button", {
		name: "Etch Reusable Mixed Bay 정리 위치 선택",
		exact: true,
	});
	await dispatchLocatorDrag(
		page,
		renamedImportedDragHandle,
		page.getByTestId("user-blueprint-drag-trash"),
	);
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-command") === "delete-user-blueprint",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page.evaluate(() => document.activeElement?.textContent?.includes("CONFIRM DELETE")),
		true,
		"drag-to-trash confirm command focus",
	);
	await page.keyboard.press("Enter");
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "1",
		undefined,
		{ timeout: 10_000 },
	);
	const deleteRecovery = page.getByTestId("user-blueprint-delete-recovery");
	await deleteRecovery.waitFor({ state: "visible", timeout: 10_000 });
	const recoveryViewport = page.viewportSize();
	if (!recoveryViewport) throw new Error("Blueprint delete recovery viewport is unavailable.");
	try {
		await page.setViewportSize({ width: 390, height: 720 });
		await deleteRecovery.scrollIntoViewIfNeeded();
		await assertLocatorInsideViewport(page, deleteRecovery);
		for (const size of await deleteRecovery.locator("button").evaluateAll((buttons) =>
			buttons.map((button) => {
				const bounds = button.getBoundingClientRect();
				return { width: bounds.width, height: bounds.height };
			}),
		)) {
			assertAtLeast(size.width, 44, "390px delete recovery control width");
			assertAtLeast(size.height, 44, "390px delete recovery control height");
		}
	} finally {
		await page.setViewportSize(recoveryViewport);
	}
	await deleteRecovery.getByRole("button", { name: "UNDO DELETE", exact: true }).click();
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "2",
		undefined,
		{ timeout: 10_000 },
	);
	const restoredImportedRecord = page
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Etch Reusable Mixed Bay" });
	await restoredImportedRecord.waitFor({ state: "visible", timeout: 10_000 });
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-place`,
			),
		renamedImportedContract.id,
		{ timeout: 10_000 },
	);
	assertEqual(
		await restoredImportedRecord
			.locator(".tilefab-blueprint-place")
			.evaluate((element) => element === document.activeElement),
		true,
		"recoverable delete focus target",
	);
	const restoredImportedContract = await page.evaluate(() => {
		const record = window.__tileFab
			?.getUserBlueprints?.()
			.find((candidate) => candidate.blueprint.name === "Etch Reusable Mixed Bay");
		return record
			? {
					id: record.id,
					folder: record.folderPath.join("/"),
					edges: record.blueprint.edges.length,
				}
			: null;
	});
	if (!restoredImportedContract) throw new Error("Restored user blueprint is unavailable.");
	assertEqual(
		restoredImportedContract.id,
		renamedImportedContract.id,
		"recoverable delete restores envelope id",
	);
	assertEqual(
		restoredImportedContract.folder,
		"Process/Etch/Reusable/Bays",
		"recoverable delete restores folder",
	);
	assertEqual(
		restoredImportedContract.edges,
		blueprintContract.edgeCount,
		"recoverable delete restores geometry",
	);
	assertProjectUnchanged(
		await readMetrics(page),
		portableFileBaseline,
		"user blueprint recoverable delete project isolation",
	);
	reportAcceptanceProgress("user-library:delete-recovery-pass");

	await deleteUserBlueprintRecord(page, restoredImportedRecord, "Etch Reusable Mixed Bay");
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "1",
		undefined,
		{ timeout: 10_000 },
	);
	await page.getByRole("button", { name: "삭제 복구 알림 닫기" }).click();
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "blueprint-user-tab",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page
			.getByTestId("blueprint-user-tab")
			.evaluate((element) => element === document.activeElement),
		true,
		"delete recovery dismissal focus return",
	);
	await page.getByRole("button", { name: "ALL", exact: true }).click();
	await record.waitFor({ state: "visible", timeout: 10_000 });
	assertEqual(
		await page.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		portableProjectJsonBefore,
		"portable blueprint workflow project JSON isolation",
	);
	assertEqual(
		await page.evaluate(() => {
			const record = window.__tileFab
				?.getUserBlueprints?.()
				.find((candidate) => candidate.blueprint.name === "Phase 4 Mixed Bay");
			return record ? JSON.stringify(record) : null;
		}),
		portableUserRecordBefore,
		"portable blueprint workflow preserves source record",
	);
	const portableFileWorkflowFinal = await readMetrics(page);
	assertExactStaticFabModelIdentity(
		portableFileWorkflowFinal,
		portableFileBaseline,
		"portable blueprint workflow exact model isolation",
	);
	assertEqual(
		portableFileWorkflowFinal.railClipboardVersion,
		portableFileBaseline.railClipboardVersion,
		"portable blueprint workflow clipboard version isolation",
	);

	const projectBlueprintIdsBeforePromotion = await page.evaluate(
		() => window.__tileFab?.getProjectBlueprints?.().records.map(({ id }) => id) ?? [],
	);
	const beforeProjectPromotion = await readMetrics(page);
	await runUserBlueprintRecordCommand(record, "Phase 4 Mixed Bay 현재 프로젝트에 추가");
	await page.waitForFunction(
		(expected) =>
			Number(document.querySelector(".tilefab-app")?.dataset.projectBlueprints) === expected,
		Number(beforeProjectPromotion.projectBlueprints) + 1,
		{ timeout: 10_000 },
	);
	const afterProjectPromotion = await readMetrics(page);
	assertEqual(
		afterProjectPromotion.workerTargetSequence,
		beforeProjectPromotion.workerTargetSequence,
		"user-to-project promotion dispatches no Worker patch",
	);
	assertEqual(
		afterProjectPromotion.modelChecksum,
		beforeProjectPromotion.modelChecksum,
		"user-to-project promotion preserves authored content",
	);
	const promotedProjectBlueprint = await page.evaluate((previousIds) => {
		const previous = new Set(previousIds);
		const record = window.__tileFab
			?.getProjectBlueprints?.()
			.records.find((candidate) => !previous.has(candidate.id));
		return record
			? {
					id: record.id,
					name: record.name,
					kind: record.kind,
					folder: record.folder,
					favorite: record.favorite,
					edgeCount: record.edges.length,
					groupCount: record.kind === "STATIC_FAB" ? record.equipmentGroups.length : 0,
					portCount: record.kind === "STATIC_FAB" ? record.ports.length : 0,
				}
			: null;
	}, projectBlueprintIdsBeforePromotion);
	if (!promotedProjectBlueprint) throw new Error("User blueprint was not copied into the project.");
	assertEqual(
		promotedProjectBlueprint.kind,
		"STATIC_FAB",
		"user-to-project promotion preserves blueprint kind",
	);
	assertEqual(
		promotedProjectBlueprint.edgeCount,
		blueprintContract.edgeCount,
		"user-to-project promotion preserves directed edges",
	);
	assertEqual(
		promotedProjectBlueprint.groupCount,
		blueprintContract.groupCount,
		"user-to-project promotion preserves equipment groups",
	);
	assertEqual(
		promotedProjectBlueprint.portCount,
		blueprintContract.portCount,
		"user-to-project promotion preserves ports",
	);
	assertEqual(promotedProjectBlueprint.folder, "Acceptance", "user-to-project folder metadata");
	assertEqual(promotedProjectBlueprint.favorite, false, "user-to-project favorite metadata");
	reportAcceptanceProgress("user-library:project-promotion-pass");
	await page
		.getByRole("tab", {
			name: new RegExp(`PROJECT ${afterProjectPromotion.projectBlueprints}`),
		})
		.click();
	const promotedProjectRecord = page.locator(
		`[data-testid="blueprint-record"][data-blueprint-id="${promotedProjectBlueprint.id}"]`,
	);
	await runProjectBlueprintRecordCommand(
		promotedProjectRecord,
		`${promotedProjectBlueprint.name} 삭제`,
	);
	await page.waitForFunction(
		(expected) =>
			Number(document.querySelector(".tilefab-app")?.dataset.projectBlueprints) === expected,
		Number(beforeProjectPromotion.projectBlueprints),
		{ timeout: 10_000 },
	);
	await page.getByTestId("blueprint-user-tab").click();

	const quarantineBaseline = await readMetrics(page);
	const quarantineProjectJson = await page.evaluate(() =>
		JSON.stringify(window.__tileFab?.getProjectBlueprints?.()),
	);
	const quarantineUserBlueprintJson = await page.evaluate(() =>
		JSON.stringify(window.__tileFab?.getUserBlueprints?.()),
	);
	const corruptBlueprintRecord = {
		id: "acceptance-corrupt-blueprint",
		schemaVersion: 99,
		note: { source: "acceptance", values: [1, true, null] },
	};
	await putRawUserBlueprintRecord(page, corruptBlueprintRecord);
	await page.getByTestId("user-blueprint-refresh").click();
	await page.waitForFunction(
		() => {
			const app = document.querySelector(".tilefab-app");
			return (
				app?.dataset.userBlueprintRejected === "1" && app.dataset.userBlueprintDiagnostics === "1"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const quarantine = page.getByTestId("user-blueprint-quarantine");
	await quarantine.waitFor({ state: "visible", timeout: 10_000 });
	const quarantineText = await quarantine.textContent();
	if (!quarantineText?.includes("INVALID_FIELD") || !quarantineText.includes("$.note")) {
		throw new Error(`Corrupt user-blueprint diagnostics are incomplete: ${quarantineText ?? ""}`);
	}
	const quarantineDetected = await readMetrics(page);
	assertEqual(
		quarantineDetected.userBlueprints,
		quarantineBaseline.userBlueprints,
		"quarantine valid library",
	);
	assertEqual(quarantineDetected.userBlueprintRejected, "1", "quarantine rejected count");
	assertEqual(quarantineDetected.userBlueprintDiagnostics, "1", "quarantine diagnostic count");
	assertEqual(
		quarantineDetected.userBlueprintRejectedLowerBound,
		"false",
		"quarantine exact rejected count",
	);
	assertExactStaticFabModelIdentity(
		quarantineDetected,
		quarantineBaseline,
		"quarantine discovery model isolation",
	);
	assertEqual(
		quarantineDetected.railClipboardVersion,
		quarantineBaseline.railClipboardVersion,
		"quarantine discovery clipboard isolation",
	);
	assertEqual(
		await page.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		quarantineProjectJson,
		"quarantine discovery project JSON isolation",
	);
	assertEqual(
		await page.evaluate(() => JSON.stringify(window.__tileFab?.getUserBlueprints?.())),
		quarantineUserBlueprintJson,
		"quarantine discovery valid library isolation",
	);
	reportAcceptanceProgress("user-library:quarantine-pass");

	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	await record.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, page.getByTestId("blueprint-user-panel"));
	await assertLocatorInsideViewport(
		page,
		page.getByRole("searchbox", { name: "내 라이브러리 검색" }),
	);
	await assertLocatorInsideViewport(page, page.getByTestId("user-blueprint-import"));
	await assertLocatorInsideViewport(page, page.getByTestId("user-blueprint-refresh"));
	await assertLocatorInsideViewport(page, record);
	const compactDragHandle = record.getByRole("button", {
		name: "Phase 4 Mixed Bay 정리 위치 선택",
		exact: true,
	});
	const compactMenuButton = record.getByTestId("user-blueprint-record-menu");
	await assertLocatorInsideViewport(page, compactDragHandle);
	await assertLocatorInsideViewport(page, compactMenuButton);
	for (const [label, locator] of [
		["drag", compactDragHandle],
		["menu", compactMenuButton],
	]) {
		const box = await locator.boundingBox();
		if (!box || box.width < 44 || box.height < 44) {
			throw new Error(
				`Compact user blueprint ${label} target is smaller than 44 px: ${JSON.stringify(box)}`,
			);
		}
	}
	const compactContext = await openBlueprintRecordContext(record, "user");
	for (const commandName of [
		"Phase 4 Mixed Bay 이름과 폴더 편집",
		"Phase 4 Mixed Bay quick slot 편집",
		"Phase 4 Mixed Bay .openfabbp 내보내기",
		"Phase 4 Mixed Bay 현재 프로젝트에 추가",
		"Phase 4 Mixed Bay 내 라이브러리에서 삭제",
	]) {
		const command = compactContext.getByRole("menuitem", { name: commandName, exact: true });
		await command.scrollIntoViewIfNeeded();
		await assertLocatorInsideViewport(page, command);
		const box = await command.boundingBox();
		if (!box || box.width < 44 || box.height < 44) {
			throw new Error(
				`Compact user blueprint command is smaller than 44 px: ${commandName} ${JSON.stringify(box)}`,
			);
		}
	}
	await page.keyboard.press("Escape");
	await compactContext.waitFor({ state: "detached", timeout: 10_000 });
	await page.setViewportSize({ width: 390, height: 720 });
	await page.waitForTimeout(100);
	await record.scrollIntoViewIfNeeded();
	const shortContext = await openBlueprintRecordContext(record, "user");
	const shortDeleteCommand = shortContext.getByRole("menuitem", {
		name: "Phase 4 Mixed Bay 내 라이브러리에서 삭제",
		exact: true,
	});
	await shortDeleteCommand.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, shortDeleteCommand);
	const shortDeleteBox = await shortDeleteCommand.boundingBox();
	if (!shortDeleteBox || shortDeleteBox.width < 44 || shortDeleteBox.height < 44) {
		throw new Error(
			`Short viewport blueprint command is smaller than 44 px: ${JSON.stringify(shortDeleteBox)}`,
		);
	}
	await page.keyboard.press("Escape");
	await shortContext.waitFor({ state: "detached", timeout: 10_000 });
	reportAcceptanceProgress("user-library:compact-context-pass");
	const quarantineExport = quarantine.getByRole("button", {
		name: "격리 레코드 1 원본 진단 JSON 내보내기",
	});
	await quarantineExport.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, quarantineExport);
	const quarantineExportBox = await quarantineExport.boundingBox();
	if (!quarantineExportBox || quarantineExportBox.width < 44 || quarantineExportBox.height < 44) {
		throw new Error(
			`Quarantine export target is smaller than 44 px: ${JSON.stringify(quarantineExportBox)}`,
		);
	}
	await page.screenshot({
		path: path.join(artifactRoot, "compact-user-blueprint-library.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	const quarantineDownloadPromise = page.waitForEvent("download");
	await quarantineExport.click();
	const quarantineDownload = await quarantineDownloadPromise;
	if (!quarantineDownload.suggestedFilename().endsWith(".openfabbp.invalid.json")) {
		throw new Error(
			`Quarantine export used an import-looking filename: ${quarantineDownload.suggestedFilename()}`,
		);
	}
	const quarantineArtifactPath = path.join(
		artifactRoot,
		"acceptance-corrupt-blueprint.openfabbp.invalid.json",
	);
	await quarantineDownload.saveAs(quarantineArtifactPath);
	const quarantineArtifactJson = await readFile(quarantineArtifactPath, "utf8");
	assertEqual(
		quarantineArtifactJson,
		`${JSON.stringify(corruptBlueprintRecord, null, "\t")}\n`,
		"quarantine exact raw JSON export",
	);
	const quarantineExported = await readMetrics(page);
	assertExactStaticFabModelIdentity(
		quarantineExported,
		quarantineBaseline,
		"quarantine export model isolation",
	);
	assertEqual(
		quarantineExported.railClipboardVersion,
		quarantineBaseline.railClipboardVersion,
		"quarantine export clipboard isolation",
	);
	assertEqual(
		await page.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
		quarantineProjectJson,
		"quarantine export project JSON isolation",
	);
	await deleteRawUserBlueprintRecord(page, corruptBlueprintRecord.id);
	await page.getByTestId("user-blueprint-refresh").click();
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprintDiagnostics === "0",
		undefined,
		{ timeout: 10_000 },
	);
	await quarantine.waitFor({ state: "hidden", timeout: 10_000 });
	reportAcceptanceProgress("user-library:quarantine-cleanup-pass");

	const paginationSeedIds = await page.evaluate(async (count) => {
		const source = window.__tileFab?.getUserBlueprints?.()[0];
		if (!source) throw new Error("User blueprint pagination source is unavailable.");
		const folderPath = ["Focus", "Pagination", "Records", "Tail"];
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open("openfab-native-projects", 3);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const ids = Array.from({ length: count }, (_, index) => `acceptance-focus-${index}`);
		await new Promise((resolve, reject) => {
			const transaction = database.transaction("user-blueprints", "readwrite");
			const store = transaction.objectStore("user-blueprints");
			for (const [index, id] of ids.entries()) {
				const name = `Focus Record ${String(index).padStart(2, "0")}`;
				store.put({
					...structuredClone(source),
					id,
					folderPath,
					quickSlot: null,
					blueprint: {
						...structuredClone(source.blueprint),
						id: `acceptance-focus-blueprint-${index}`,
						name,
						folder: folderPath.join("/"),
						favorite: false,
					},
				});
			}
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
		database.close();
		return ids;
	}, 25);
	const paginationImportChooserPromise = page.waitForEvent("filechooser");
	await page.getByTestId("user-blueprint-import").click();
	const paginationImportChooser = await paginationImportChooserPromise;
	await paginationImportChooser.setFiles(futureBlueprintPath);
	await importPreview.waitFor({ state: "visible", timeout: 10_000 });
	await importPreview.getByLabel("가져올 청사진 이름").fill("ZZZ Focus Target");
	await importPreview.getByLabel("가져올 청사진 폴더").fill("Focus/Pagination/Records/Tail");
	await importPreview.getByRole("button", { name: "IMPORT", exact: true }).click();
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "27",
		undefined,
		{ timeout: 10_000 },
	);
	const paginationTarget = page
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "ZZZ Focus Target" });
	await paginationTarget.waitFor({ state: "visible", timeout: 10_000 });
	const paginationTargetId = await paginationTarget.getAttribute("data-blueprint-id");
	if (!paginationTargetId) throw new Error("Pagination focus target id is unavailable.");
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-place`,
			),
		paginationTargetId,
		{ timeout: 10_000 },
	);
	assertEqual(
		await paginationTarget
			.locator(".tilefab-blueprint-place")
			.evaluate((element) => element === document.activeElement),
		true,
		"user blueprint focus beyond first 24 records",
	);
	await page.getByTestId("user-blueprint-all").click();
	for (const folder of ["Focus", "Pagination", "Records", "Tail"]) {
		await page
			.getByTestId("user-blueprint-folders")
			.getByRole("button", { name: new RegExp(`^${folder}\\b`) })
			.click();
	}
	const showMoreBlueprints = page.getByTestId("user-blueprint-show-more");
	await showMoreBlueprints.focus();
	await page.keyboard.press("Enter");
	const firstRevealedBlueprintId = paginationSeedIds[USER_BLUEPRINT_ACCEPTANCE_PAGE_SIZE];
	await page.waitForFunction(
		(id) =>
			document.activeElement ===
			document.querySelector(
				`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"] .tilefab-blueprint-place`,
			),
		firstRevealedBlueprintId,
		{ timeout: 10_000 },
	);
	assertEqual(
		await showMoreBlueprints.count(),
		0,
		"user blueprint final page removes the exhausted show-more command",
	);
	await page.evaluate(
		async (ids) => {
			const database = await new Promise((resolve, reject) => {
				const request = indexedDB.open("openfab-native-projects", 3);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			await new Promise((resolve, reject) => {
				const transaction = database.transaction("user-blueprints", "readwrite");
				const store = transaction.objectStore("user-blueprints");
				for (const id of ids) store.delete(id);
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
			database.close();
		},
		[...paginationSeedIds, paginationTargetId],
	);
	await page.getByTestId("user-blueprint-all").click();
	await record.waitFor({ state: "visible", timeout: 10_000 });
	reportAcceptanceProgress("user-library:pagination-pass");
	await exerciseUserBlueprintCrossTabRefresh(page, futureBlueprintPath);
	reportAcceptanceProgress("user-library:cross-tab-pass");

	await record.locator(".tilefab-blueprint-place").click();
	await page.waitForFunction(
		() =>
			document.querySelector(".tilefab-app")?.dataset.areaStampOrigin === "library" &&
			Number(document.querySelector(".tilefab-app")?.dataset.areaStampModules) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	await placeActiveConstruction(page, targetAnchor, { center: false });
	const placed = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectId === projectId &&
			Number(metrics.workerTargetSequence) === Number(beforePlacement.workerTargetSequence) + 1 &&
			Number(metrics.authoredEdges) ===
				Number(beforePlacement.authoredEdges) + blueprintContract.edgeCount &&
			Number(metrics.authoredCells) ===
				Number(beforePlacement.authoredCells) + blueprintContract.cellCount &&
			Number(metrics.equipmentGroups) ===
				Number(beforePlacement.equipmentGroups) + blueprintContract.groupCount &&
			Number(metrics.equipmentPorts) ===
				Number(beforePlacement.equipmentPorts) + blueprintContract.portCount,
	);
	assertPlacedBlueprintEquipmentContract(
		blueprintContract,
		equipmentBefore,
		await readPortEquipmentContract(page),
	);
	await undoAndRedo(page, beforePlacement, placed, "library");
	await page.getByRole("button", { name: "실행 취소" }).click();
	const cleaned = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(placed.workerTargetSequence) + 3 &&
			metrics.workerChecksum === beforePlacement.workerChecksum &&
			metrics.modelChecksum === beforePlacement.modelChecksum,
	);
	assertStaticFabWorldContentIdentity(
		cleaned,
		beforePlacement,
		"persisted mixed user blueprint cleanup",
	);
	assertAtLeast(
		Number(cleaned.modelNextPortId),
		Number(beforePlacement.modelNextPortId) + blueprintContract.portCount,
		"persisted mixed user blueprint cleanup keeps port ids monotonic",
	);
	assertAtLeast(
		Number(cleaned.modelNextEquipmentGroupId),
		Number(beforePlacement.modelNextEquipmentGroupId) + blueprintContract.groupCount,
		"persisted mixed user blueprint cleanup keeps equipment ids monotonic",
	);
	reportAcceptanceProgress("user-library:placement-roundtrip-pass");
	await page.keyboard.press("Escape");

	await clickActivityCommand(page, "assemble", "내 청사진");
	await page.getByTestId("blueprint-user-tab").click();
	const cleanupUserBlueprintRecord = page
		.getByTestId("user-blueprint-record")
		.filter({ hasText: "Phase 4 Mixed Bay" });
	await deleteUserBlueprintRecord(page, cleanupUserBlueprintRecord, "Phase 4 Mixed Bay");
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "0",
		undefined,
		{ timeout: 10_000 },
	);
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "blueprint-user-tab",
	);
	await page.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();
	const finalUserBlueprintState = await readMetrics(page);
	assertEqual(finalUserBlueprintState.userBlueprints, "0", "deleted user blueprint count");
	assertEqual(
		finalUserBlueprintState.areaStampModules,
		"0",
		"user blueprint placement is inactive",
	);
	assertEqual(finalUserBlueprintState.areaStampOrigin, "", "user blueprint origin is cleared");
	assertStaticFabWorldContentIdentity(
		finalUserBlueprintState,
		beforePlacement,
		"persisted user blueprint final authored state",
	);
	recordStep("large-fab-user-blueprint-roundtrip", finalUserBlueprintState);
	reportAcceptanceProgress("user-library:complete");
}

async function exerciseUserBlueprintCrossTabRefresh(primaryPage, portableBlueprintPath) {
	const baseline = await readMetrics(primaryPage);
	const projectBlueprintJson = await primaryPage.evaluate(() =>
		JSON.stringify(window.__tileFab?.getProjectBlueprints?.()),
	);
	assertEqual(
		baseline.userBlueprintCrossTabAvailable,
		"true",
		"primary cross-tab channel availability",
	);
	const secondaryPage = await primaryPage.context().newPage();
	secondaryPage.on("console", (message) => {
		if (message.type() === "error") {
			result.consoleErrors.push(`[cross-tab] ${message.text()}`);
		}
	});
	secondaryPage.on("pageerror", (error) => result.pageErrors.push(`[cross-tab] ${error.message}`));
	try {
		await secondaryPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
		await waitForReady(secondaryPage, { physicalPaths: 0 });
		await secondaryPage.waitForFunction(
			() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "1",
			undefined,
			{ timeout: 10_000 },
		);
		await clickActivityCommand(secondaryPage, "assemble", "내 청사진");
		await secondaryPage.getByTestId("blueprint-user-tab").click();
		const secondaryBaseline = await readMetrics(secondaryPage);
		assertEqual(
			secondaryBaseline.userBlueprintCrossTabAvailable,
			"true",
			"secondary cross-tab channel availability",
		);

		const backupDownloadPromise = secondaryPage.waitForEvent("download");
		await secondaryPage
			.getByRole("button", { name: "전체 청사진 라이브러리 백업 파일 생성", exact: true })
			.click();
		const backupDownload = await backupDownloadPromise;
		const backupPath = path.join(artifactRoot, "cross-tab-original.openfablib");
		await backupDownload.saveAs(backupPath);

		const original = await readUserBlueprintByName(secondaryPage, "Phase 4 Mixed Bay");
		if (!original) throw new Error("Cross-tab source blueprint is unavailable.");
		await editUserBlueprintMetadata(
			secondaryPage,
			"Phase 4 Mixed Bay",
			"Cross Tab Renamed",
			original.folderPath.join("/"),
		);
		await waitForCrossTabBlueprint(primaryPage, {
			name: "Cross Tab Renamed",
			count: 1,
			minimumNotifications: Number(baseline.userBlueprintCrossTabNotifications) + 1,
		});

		const primarySearch = primaryPage.getByRole("searchbox", { name: "내 라이브러리 검색" });
		await primarySearch.fill("Cross Tab Renamed");
		const focusedPrimaryRecord = primaryPage
			.getByTestId("user-blueprint-record")
			.filter({ hasText: "Cross Tab Renamed" });
		await focusedPrimaryRecord.waitFor({ state: "visible", timeout: 10_000 });
		const focusedPrimaryButton = focusedPrimaryRecord.locator(".tilefab-blueprint-place");
		await focusedPrimaryButton.focus();
		await assignCrossTabUserBlueprintQuickSlot(secondaryPage, "Cross Tab Renamed", 6);
		await primaryPage.waitForFunction(
			(id) => {
				const record = document.querySelector(
					`[data-testid="user-blueprint-record"][data-blueprint-id="${id}"]`,
				);
				return (
					record?.getAttribute("data-quick-slot") === "6" &&
					document.activeElement === record.querySelector(".tilefab-blueprint-place")
				);
			},
			original.id,
			{ timeout: 10_000 },
		);
		await editUserBlueprintMetadata(
			secondaryPage,
			"Cross Tab Renamed",
			"Cross Tab Renamed",
			"CrossTab/Remote",
		);
		await waitForCrossTabBlueprint(primaryPage, {
			name: "Cross Tab Renamed",
			folder: "CrossTab/Remote",
			count: 1,
			minimumNotifications: Number(baseline.userBlueprintCrossTabNotifications) + 3,
		});

		const importChooserPromise = secondaryPage.waitForEvent("filechooser");
		await secondaryPage.getByTestId("user-blueprint-import").click();
		const importChooser = await importChooserPromise;
		await importChooser.setFiles(portableBlueprintPath);
		const importPreview = secondaryPage.getByTestId("user-blueprint-import-preview");
		await importPreview.waitFor({ state: "visible", timeout: 10_000 });
		await importPreview.getByLabel("가져올 청사진 이름").fill("Cross Tab Imported");
		await importPreview.getByLabel("가져올 청사진 폴더").fill("");
		await importPreview.getByRole("button", { name: "IMPORT", exact: true }).click();
		await waitForCrossTabBlueprint(primaryPage, {
			name: "Cross Tab Imported",
			count: 2,
			minimumNotifications: Number(baseline.userBlueprintCrossTabNotifications) + 4,
		});

		await secondaryPage
			.getByRole("searchbox", { name: "내 라이브러리 검색" })
			.fill("Cross Tab Imported");
		const importedRecord = secondaryPage
			.getByTestId("user-blueprint-record")
			.filter({ hasText: "Cross Tab Imported" });
		await importedRecord.waitFor({ state: "visible", timeout: 10_000 });
		await deleteUserBlueprintRecord(secondaryPage, importedRecord, "Cross Tab Imported");
		await primaryPage.waitForFunction(
			() => document.querySelector(".tilefab-app")?.dataset.userBlueprints === "1",
			undefined,
			{ timeout: 10_000 },
		);
		await secondaryPage
			.getByTestId("user-blueprint-delete-recovery")
			.getByRole("button", { name: "UNDO DELETE", exact: true })
			.click();
		await waitForCrossTabBlueprint(primaryPage, {
			name: "Cross Tab Imported",
			count: 2,
			minimumNotifications: Number(baseline.userBlueprintCrossTabNotifications) + 6,
		});

		const restoreChooserPromise = secondaryPage.waitForEvent("filechooser");
		await secondaryPage
			.getByRole("button", { name: "전체 청사진 라이브러리 백업 복원", exact: true })
			.click();
		const restoreChooser = await restoreChooserPromise;
		await restoreChooser.setFiles(backupPath);
		const restoreDialog = secondaryPage.getByTestId("user-blueprint-library-restore-dialog");
		await restoreDialog.waitFor({ state: "visible", timeout: 30_000 });
		await restoreDialog.getByRole("radio", { name: /REPLACE/ }).check();
		await restoreDialog
			.getByRole("checkbox", { name: "현재 라이브러리를 교체한다는 것을 확인했습니다" })
			.check();
		const replaceButton = restoreDialog.getByRole("button", {
			name: "REPLACE LIBRARY",
			exact: true,
		});
		await replaceButton.waitFor({ state: "visible", timeout: 30_000 });
		await waitForEnabled(replaceButton, 30_000);

		await editUserBlueprintMetadata(
			primaryPage,
			"Cross Tab Renamed",
			"Primary Concurrent",
			"CrossTab/Remote",
		);
		await secondaryPage.waitForFunction(
			() => document.querySelector(".tilefab-app")?.dataset.userBlueprintCrossTabPending === "true",
			undefined,
			{ timeout: 10_000 },
		);
		await replaceButton.click();
		await restoreDialog
			.getByRole("alert")
			.filter({ hasText: "다른 창에서 라이브러리가 변경되었습니다" })
			.waitFor({ state: "visible", timeout: 30_000 });
		const rebasedRestoreDialog = secondaryPage.getByTestId("user-blueprint-library-restore-dialog");
		await rebasedRestoreDialog.getByRole("radio", { name: /REPLACE/ }).check();
		await rebasedRestoreDialog
			.getByRole("checkbox", { name: "현재 라이브러리를 교체한다는 것을 확인했습니다" })
			.check();
		const rebasedReplaceButton = rebasedRestoreDialog.getByRole("button", {
			name: "REPLACE LIBRARY",
			exact: true,
		});
		await waitForEnabled(rebasedReplaceButton, 30_000);
		await rebasedReplaceButton.click();
		await rebasedRestoreDialog.waitFor({ state: "hidden", timeout: 30_000 });
		await waitForCrossTabBlueprint(primaryPage, {
			name: "Phase 4 Mixed Bay",
			count: 1,
			minimumNotifications: Number(baseline.userBlueprintCrossTabNotifications) + 7,
		});
		await secondaryPage.waitForFunction(
			() => {
				const app = document.querySelector(".tilefab-app");
				return (
					app?.dataset.userBlueprintCrossTabPending === "false" &&
					app.dataset.userBlueprintCrossTabInFlight === "false"
				);
			},
			undefined,
			{ timeout: 10_000 },
		);

		const beforeQuiescence = await readCrossTabTelemetry(primaryPage);
		await primaryPage.waitForTimeout(250);
		assertEqual(
			await readCrossTabTelemetry(primaryPage),
			beforeQuiescence,
			"cross-tab refresh reaches quiescence without an update loop",
		);
		const primaryAfter = await readMetrics(primaryPage);
		const secondaryAfter = await readMetrics(secondaryPage);
		assertExactStaticFabModelIdentity(primaryAfter, baseline, "cross-tab primary model isolation");
		assertEqual(
			primaryAfter.railClipboardVersion,
			baseline.railClipboardVersion,
			"cross-tab primary clipboard isolation",
		);
		assertEqual(
			await primaryPage.evaluate(() => JSON.stringify(window.__tileFab?.getProjectBlueprints?.())),
			projectBlueprintJson,
			"cross-tab primary project blueprint isolation",
		);
		assertExactStaticFabModelIdentity(
			secondaryAfter,
			secondaryBaseline,
			"cross-tab secondary model isolation",
		);
		recordStep("user-library-cross-tab", {
			primary: await readCrossTabTelemetry(primaryPage),
			secondary: await readCrossTabTelemetry(secondaryPage),
		});
		await primaryPage.getByTestId("user-blueprint-all").click();
		await primaryPage
			.getByTestId("user-blueprint-record")
			.filter({ hasText: "Phase 4 Mixed Bay" })
			.waitFor({ state: "visible", timeout: 10_000 });
	} finally {
		await secondaryPage.close();
	}
}

async function editUserBlueprintMetadata(page, currentName, nextName, folder) {
	await page.getByRole("searchbox", { name: "내 라이브러리 검색" }).fill(currentName);
	const record = page.getByTestId("user-blueprint-record").filter({ hasText: currentName });
	await record.waitFor({ state: "visible", timeout: 10_000 });
	await runUserBlueprintRecordCommand(record, `${currentName} 이름과 폴더 편집`);
	const editor = page.locator(".tilefab-user-blueprint-metadata-editor");
	const nameInput = editor.getByLabel(`${currentName} 새 이름`, { exact: true });
	const folderInput = editor.getByLabel(`${currentName} 새 폴더`, { exact: true });
	await nameInput.fill(nextName);
	await folderInput.fill(folder);
	assertEqual(
		await nameInput.inputValue(),
		nextName,
		"user blueprint metadata isolated name draft",
	);
	assertEqual(
		await folderInput.inputValue(),
		folder,
		"user blueprint metadata isolated folder draft",
	);
	await editor.getByRole("button", { name: "SAVE", exact: true }).click();
	try {
		await page.waitForFunction(
			({ expectedName, expectedFolder }) => {
				const record = window.__tileFab
					?.getUserBlueprints?.()
					.find((candidate) => candidate.blueprint.name === expectedName);
				return record?.folderPath.join("/") === expectedFolder;
			},
			{ expectedName: nextName, expectedFolder: folder },
			{ timeout: 10_000 },
		);
	} catch (error) {
		const diagnostic = await page.evaluate(() => {
			const app = document.querySelector(".tilefab-app");
			return {
				records: window.__tileFab?.getUserBlueprints?.() ?? [],
				status: document.querySelector(".tilefab-statusbar")?.textContent ?? "",
				crossTab: {
					pending: app?.getAttribute("data-user-blueprint-cross-tab-pending") ?? "",
					inFlight: app?.getAttribute("data-user-blueprint-cross-tab-in-flight") ?? "",
					outcome: app?.getAttribute("data-user-blueprint-cross-tab-outcome") ?? "",
				},
			};
		});
		throw new Error(`User blueprint metadata did not settle: ${JSON.stringify(diagnostic)}`, {
			cause: error,
		});
	}
}

async function assignCrossTabUserBlueprintQuickSlot(page, name, slot) {
	await page.getByRole("searchbox", { name: "내 라이브러리 검색" }).fill(name);
	const record = page.getByTestId("user-blueprint-record").filter({ hasText: name });
	await record.waitFor({ state: "visible", timeout: 10_000 });
	const context = await openBlueprintRecordContext(record, "user");
	await context.getByRole("menuitem", { name: `${name} quick slot 편집`, exact: true }).click();
	await context
		.getByRole("menuitemradio", { name: `${name} Quick Slot ${slot} 지정`, exact: true })
		.click();
	await page.waitForFunction(
		({ expectedName, expectedSlot }) =>
			window.__tileFab
				?.getUserBlueprints?.()
				.find((candidate) => candidate.blueprint.name === expectedName)?.quickSlot === expectedSlot,
		{ expectedName: name, expectedSlot: slot },
		{ timeout: 10_000 },
	);
}

async function readUserBlueprintByName(page, name) {
	return page.evaluate(
		(expectedName) =>
			window.__tileFab
				?.getUserBlueprints?.()
				.find((candidate) => candidate.blueprint.name === expectedName) ?? null,
		name,
	);
}

async function waitForCrossTabBlueprint(
	page,
	{ name, folder = null, count, minimumNotifications },
) {
	await page.waitForFunction(
		(expected) => {
			const app = document.querySelector(".tilefab-app");
			const records = window.__tileFab?.getUserBlueprints?.() ?? [];
			const record = records.find((candidate) => candidate.blueprint.name === expected.name);
			return (
				record !== undefined &&
				(expected.folder === null || record.folderPath.join("/") === expected.folder) &&
				records.length === expected.count &&
				Number(app?.getAttribute("data-user-blueprint-cross-tab-notifications") ?? 0) >=
					expected.minimumNotifications &&
				Number(app?.getAttribute("data-user-blueprint-cross-tab-refreshes") ?? 0) > 0 &&
				app?.getAttribute("data-user-blueprint-cross-tab-in-flight") === "false"
			);
		},
		{ name, folder, count, minimumNotifications },
		{ timeout: 30_000 },
	);
}

async function readCrossTabTelemetry(page) {
	return page.getByTestId("tilefab-app").evaluate((app) =>
		JSON.stringify({
			notifications: Number(app.dataset.userBlueprintCrossTabNotifications ?? 0),
			refreshes: Number(app.dataset.userBlueprintCrossTabRefreshes ?? 0),
			pending: app.dataset.userBlueprintCrossTabPending ?? "",
			inFlight: app.dataset.userBlueprintCrossTabInFlight ?? "",
			outcome: app.dataset.userBlueprintCrossTabOutcome ?? "",
		}),
	);
}

async function waitForEnabled(locator, timeout) {
	const startedAt = Date.now();
	while (await locator.isDisabled()) {
		if (Date.now() - startedAt >= timeout)
			throw new Error("Timed out waiting for enabled control.");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}

async function exerciseCurrentLargeFabOrganizationArrangement(
	page,
	beforeArrangement,
	organizationLibrary,
	mainAreaOption,
	mainBayOption,
) {
	const canvas = page.getByTestId("rail-canvas");
	const organizationMembershipBefore = await readOrganizationMembershipContract(page);
	await page.getByRole("button", { name: "FAB 조직 (4)", exact: true }).click();
	await organizationLibrary.waitFor({ state: "visible" });
	const allTab = organizationLibrary.getByRole("tab", { name: "ALL 4", exact: true });
	if (await allTab.isVisible().catch(() => false)) await allTab.click();
	const options = organizationLibrary.getByRole("option");
	assertEqual(await options.count(), 4, "Large FAB arrangement organization choices");
	await options.first().click();
	for (let index = 1; index < 4; index++) {
		await options.nth(index).click({ modifiers: ["Meta"] });
	}
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.organizationSelectionCount === "4",
	);
	await organizationLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();

	await canvas.focus();
	await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
	assertEqual(
		await canvas.evaluate((element) => element === document.activeElement),
		true,
		"Large FAB arrangement Canvas focus survives Organization close",
	);
	await canvas.press("l");
	const bar = page.getByTestId("static-fab-arrangement-bar");
	await bar.waitFor({ state: "visible" });
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.staticFabArrangementActive ===
			"true",
	);
	assertEqual(
		await bar.getAttribute("data-source"),
		"ORGANIZATIONS",
		"Large FAB arrangement source",
	);
	assertEqual(
		await canvas.getAttribute("data-static-fab-arrangement-roots"),
		"2",
		"Large FAB arrangement canonical roots",
	);

	if ((await bar.getAttribute("data-axis")) !== "Z") {
		await bar.locator(".tilefab-arrangement-axis button").nth(1).click();
	}
	if ((await bar.getAttribute("data-mode")) !== "ALIGN_CENTER") {
		await bar.locator('button[data-mode="ALIGN_CENTER"]').click();
	}
	await page.waitForFunction(
		() => {
			const commandBar = document.querySelector('[data-testid="static-fab-arrangement-bar"]');
			return (
				commandBar?.getAttribute("data-axis") === "Z" &&
				commandBar.getAttribute("data-mode") === "ALIGN_CENTER" &&
				["certified", "rejected"].includes(commandBar.getAttribute("data-phase") ?? "")
			);
		},
		undefined,
		{ timeout: 30_000 },
	);
	if ((await bar.getAttribute("data-phase")) !== "certified") {
		throw new Error(
			`The required Z/ALIGN_CENTER organization arrangement was not certified: ${await bar.locator(".tilefab-arrangement-feedback").textContent()}`,
		);
	}
	const certified = await readMetrics(page);
	assertEqual(certified.staticFabArrangementRoots, "2", "certified organization root count");
	assertEqual(certified.staticFabArrangementAxis, "Z", "certified organization axis");
	assertEqual(certified.staticFabArrangementMode, "ALIGN_CENTER", "certified organization mode");
	assertEqual(certified.staticFabArrangementConflicts, "0", "certified organization conflicts");
	assertEqual(
		certified.workerChecksum,
		beforeArrangement.workerChecksum,
		"organization arrangement preview is derived",
	);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	await assertLocatorInsideViewport(page, bar);
	await assertLocatorInsideViewport(page, page.getByTestId("apply-static-fab-arrangement"));
	await page.screenshot({
		path: path.join(artifactRoot, "compact-large-fab-organization-arrangement.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 1280, height: 720 });
	await page.waitForTimeout(100);

	await page.getByTestId("apply-static-fab-arrangement").click();
	const arranged = await waitForWorker(
		page,
		(metrics) =>
			metrics.staticFabArrangementActive === "false" &&
			Number(metrics.workerTargetSequence) === Number(beforeArrangement.workerTargetSequence) + 1,
	);
	assertNotEqual(
		arranged.workerChecksum,
		beforeArrangement.workerChecksum,
		"Large FAB organization arrangement checksum",
	);
	assertEqual(
		arranged.staticFabOrganizations,
		beforeArrangement.staticFabOrganizations,
		"Large FAB arrangement organization count",
	);
	assertEqual(
		arranged.physicalPaths,
		beforeArrangement.physicalPaths,
		"Large FAB arrangement physical path count",
	);
	assertOrganizationArrangementContract(
		organizationMembershipBefore,
		await readOrganizationMembershipContract(page),
	);

	await page.getByRole("button", { name: "실행 취소" }).click();
	const undone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(arranged.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeArrangement.workerChecksum,
	);
	await page.getByRole("button", { name: "다시 실행" }).click();
	const redone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(undone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === arranged.workerChecksum,
	);
	recordPhase4Checkpoint("large-fab-organization-arrangement", redone);
	await page.getByRole("button", { name: "실행 취소" }).click();
	await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(redone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeArrangement.workerChecksum,
	);

	await page.getByRole("button", { name: "FAB 조직 (4)", exact: true }).click();
	await organizationLibrary.waitFor({ state: "visible" });
	await mainBayOption.click();
	await mainAreaOption.click({ modifiers: ["Meta"] });
	assertEqual(
		await organizationLibrary.getByRole("option", { selected: true }).count(),
		2,
		"Large FAB original organization selection restored",
	);
	await organizationLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
}

async function readOrganizationMembershipContract(page) {
	return page.evaluate(() => {
		const state = window.__tileFab?.getEditorModel().document.organizations;
		if (!state) throw new Error("Static FAB organizations are unavailable.");
		return state.records.map((record) => ({
			id: record.id,
			kind: record.kind,
			parentOrganizationIds: [...(record.parentOrganizationIds ?? [])],
			railEdges: record.membership.railEdges.map((edge) => [
				edge.from.x,
				edge.from.y,
				edge.to.x,
				edge.to.y,
			]),
			advancedSwitchIds: [...record.membership.advancedSwitchIds],
			equipmentGroupIds: [...record.membership.equipmentGroupIds],
		}));
	});
}

function assertOrganizationArrangementContract(before, after) {
	assertEqual(after.length, before.length, "organization arrangement record count");
	const afterById = new Map(after.map((record) => [record.id, record]));
	const translations = new Map();
	for (const source of before) {
		const target = afterById.get(source.id);
		if (!target) throw new Error(`Organization ${source.id} disappeared during arrangement.`);
		assertEqual(target.kind, source.kind, `organization ${source.id} arrangement kind`);
		assertEqual(
			JSON.stringify(target.parentOrganizationIds),
			JSON.stringify(source.parentOrganizationIds),
			`organization ${source.id} arrangement parents`,
		);
		assertEqual(
			JSON.stringify(target.advancedSwitchIds),
			JSON.stringify(source.advancedSwitchIds),
			`organization ${source.id} arrangement switches`,
		);
		assertEqual(
			JSON.stringify(target.equipmentGroupIds),
			JSON.stringify(source.equipmentGroupIds),
			`organization ${source.id} arrangement equipment`,
		);
		assertEqual(
			JSON.stringify(normalizedEdgeGeometry(target.railEdges)),
			JSON.stringify(normalizedEdgeGeometry(source.railEdges)),
			`organization ${source.id} arrangement relative rail geometry`,
		);
		const translation = organizationRailTranslation(source.railEdges, target.railEdges);
		translations.set(source.id, translation);
		if (translation.x === 0 && translation.z === 0) {
			throw new Error(`Organization ${source.id} did not move during the required arrangement.`);
		}
	}
	const roots = before.filter((record) => record.parentOrganizationIds.length === 0);
	assertEqual(roots.length, 2, "organization arrangement canonical root count");
	for (const source of before) {
		const translation = translations.get(source.id);
		for (const parentId of source.parentOrganizationIds) {
			assertEqual(
				JSON.stringify(translation),
				JSON.stringify(translations.get(parentId)),
				`organization ${source.id} arrangement follows parent ${parentId}`,
			);
		}
	}
}

function organizationRailTranslation(sourceEdges, targetEdges) {
	if (sourceEdges.length === 0 || targetEdges.length === 0) {
		throw new Error("Organization arrangement records must retain non-empty rail membership.");
	}
	const sourceMinX = Math.min(...sourceEdges.flatMap((edge) => [edge[0], edge[2]]));
	const sourceMinZ = Math.min(...sourceEdges.flatMap((edge) => [edge[1], edge[3]]));
	const targetMinX = Math.min(...targetEdges.flatMap((edge) => [edge[0], edge[2]]));
	const targetMinZ = Math.min(...targetEdges.flatMap((edge) => [edge[1], edge[3]]));
	return { x: targetMinX - sourceMinX, z: targetMinZ - sourceMinZ };
}

function normalizedEdgeGeometry(edges) {
	if (edges.length === 0) return [];
	const minX = Math.min(...edges.flatMap((edge) => [edge[0], edge[2]]));
	const minZ = Math.min(...edges.flatMap((edge) => [edge[1], edge[3]]));
	return edges
		.map((edge) => [edge[0] - minX, edge[1] - minZ, edge[2] - minX, edge[3] - minZ])
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

async function readLegalStraightPortRuns(page, portType) {
	return page.evaluate((type) => {
		const slots = window.__tileFab?.getEditorModel().portSlotArtifacts[type]?.slots;
		if (!slots) throw new Error(`${type} port slot artifacts are unavailable.`);
		const lines = new Map();
		for (let row = 0; row < slots.count; row++) {
			if (slots.statuses[row] !== 0) continue;
			const x = slots.worldPositions[row * 2];
			const y = slots.worldPositions[row * 2 + 1];
			const tangentX = slots.tangents[row * 2];
			const tangentY = slots.tangents[row * 2 + 1];
			const orientation = Math.abs(tangentX) > 0.9 ? "H" : Math.abs(tangentY) > 0.9 ? "V" : null;
			if (!orientation) continue;
			const moving = orientation === "H" ? x : y;
			const fixed = orientation === "H" ? y : x;
			const sign = orientation === "H" ? Math.sign(tangentX) : Math.sign(tangentY);
			const key = `${orientation}:${Math.round(fixed * 1_000)}:${sign}`;
			const line = lines.get(key) ?? [];
			line.push({ row, x, y, moving });
			lines.set(key, line);
		}
		const runs = [];
		for (const line of lines.values()) {
			line.sort((left, right) => left.moving - right.moving);
			let run = [];
			for (const item of line) {
				if (run.length > 0 && Math.abs(item.moving - run.at(-1).moving - 1) > 0.01) {
					if (run.length >= 3) runs.push({ items: run });
					run = [];
				}
				run.push({ row: item.row, x: item.x, y: item.y });
			}
			if (run.length >= 3) runs.push({ items: run });
		}
		return runs.sort((left, right) => right.items.length - left.items.length);
	}, portType);
}

async function readProjectBlueprintContract(page, name) {
	return page.evaluate((blueprintName) => {
		const record = window.__tileFab
			?.getProjectBlueprints?.()
			.records.find((candidate) => candidate.name === blueprintName);
		if (!record) throw new Error(`Blueprint ${blueprintName} is unavailable.`);
		const cells = new Set();
		for (const edge of record.edges) {
			cells.add(`${edge[0]},${edge[1]}`);
			cells.add(`${edge[2]},${edge[3]}`);
		}
		return {
			kind: record.kind,
			edgeCount: record.edges.length,
			cellCount: cells.size,
			groupCount: record.kind === "STATIC_FAB" ? record.equipmentGroups.length : 0,
			portCount: record.kind === "STATIC_FAB" ? record.ports.length : 0,
			groups:
				record.kind === "STATIC_FAB"
					? record.equipmentGroups.map((group) => ({
							kind: group.kind,
							template: "template" in group ? group.template : null,
							pitchMillimeters: "pitchMillimeters" in group ? group.pitchMillimeters : null,
							recipe: "recipe" in group ? group.recipe : null,
							portCount: group.portIndices.length,
						}))
					: [],
			ports:
				record.kind === "STATIC_FAB"
					? record.ports.map((port) => ({
							groupKind: record.equipmentGroups[port.equipmentGroupIndex]?.kind ?? "",
							x: port.route.cell[0],
							z: port.route.cell[1],
							from: port.route.from,
							to: port.route.to,
							stationMillimeters: port.stationMillimeters,
							side: port.side,
							lateralOffsetMillimeters: port.lateralOffsetMillimeters,
							direction: port.direction,
							portType: port.portType,
						}))
					: [],
		};
	}, name);
}

async function readPortEquipmentContract(page) {
	return page.evaluate(() => {
		const equipment = window.__tileFab?.getEditorModel().document.portEquipment;
		if (!equipment) throw new Error("Port equipment state is unavailable.");
		return {
			groups: equipment.equipmentGroups.map((group) => ({
				id: group.id,
				kind: group.kind,
				template: "template" in group ? group.template : null,
				pitchMillimeters: "pitchMillimeters" in group ? group.pitchMillimeters : null,
				recipe: "recipe" in group ? group.recipe : null,
				portIds: [...group.portIds],
			})),
			ports: equipment.ports.map((port) => ({
				id: port.id,
				equipmentGroupId: port.equipmentGroupId,
				route: { ...port.route },
				stationMillimeters: port.stationMillimeters,
				side: port.side,
				lateralOffsetMillimeters: port.lateralOffsetMillimeters,
				direction: port.direction,
				portType: port.portType,
			})),
		};
	});
}

function assertPlacedBlueprintEquipmentContract(source, before, after) {
	const previousGroupIds = new Set(before.groups.map((group) => group.id));
	const previousPortIds = new Set(before.ports.map((port) => port.id));
	const groups = after.groups.filter((group) => !previousGroupIds.has(group.id));
	const ports = after.ports.filter((port) => !previousPortIds.has(port.id));
	assertEqual(groups.length, source.groupCount, "placed blueprint exact new group count");
	assertEqual(ports.length, source.portCount, "placed blueprint exact new port count");

	const sourceGroups = source.groups.map(blueprintGroupSignature).sort();
	const placedGroups = groups
		.map((group) =>
			blueprintGroupSignature({
				...group,
				portCount: group.portIds.length,
			}),
		)
		.sort();
	assertEqual(
		JSON.stringify(placedGroups),
		JSON.stringify(sourceGroups),
		"placed blueprint group kinds and membership counts",
	);

	const groupsById = new Map(groups.map((group) => [group.id, group]));
	const portsById = new Map(ports.map((port) => [port.id, port]));
	for (const group of groups) {
		for (const portId of group.portIds) {
			const port = portsById.get(portId);
			if (!port || port.equipmentGroupId !== group.id || port.portType !== group.kind) {
				throw new Error(`Placed blueprint group ${group.id} has an invalid port membership.`);
			}
		}
	}
	for (const port of ports) {
		if (!groupsById.get(port.equipmentGroupId)?.portIds.includes(port.id)) {
			throw new Error(`Placed blueprint port ${port.id} is not owned by its new group.`);
		}
		if (port.route.kind !== "CARDINAL_CELL") {
			throw new Error(`Placed blueprint port ${port.id} did not preserve a cardinal route.`);
		}
	}

	const sourcePortGeometry = normalizedBlueprintPortGeometry(source.ports);
	const placedPortGeometry = normalizedBlueprintPortGeometry(
		ports.map((port) => ({
			groupKind: groupsById.get(port.equipmentGroupId)?.kind ?? "",
			x: port.route.x,
			z: port.route.z,
			from: directionName(port.route.from),
			to: directionName(port.route.to),
			stationMillimeters: port.stationMillimeters,
			side: port.side,
			lateralOffsetMillimeters: port.lateralOffsetMillimeters,
			direction: port.direction,
			portType: port.portType,
		})),
	);
	assertEqual(
		JSON.stringify(placedPortGeometry),
		JSON.stringify(sourcePortGeometry),
		"placed blueprint relative port geometry",
	);
}

function blueprintGroupSignature(group) {
	return JSON.stringify([
		group.kind,
		group.template ?? null,
		group.pitchMillimeters ?? null,
		group.recipe ?? null,
		group.portCount,
	]);
}

function normalizedBlueprintPortGeometry(ports) {
	const minX = Math.min(...ports.map((port) => port.x));
	const minZ = Math.min(...ports.map((port) => port.z));
	return ports
		.map((port) => [
			port.groupKind,
			port.x - minX,
			port.z - minZ,
			port.from,
			port.to,
			port.stationMillimeters,
			port.side,
			port.lateralOffsetMillimeters,
			port.direction,
			port.portType,
		])
		.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function directionName(direction) {
	return { 1: "N", 2: "E", 4: "S", 8: "W" }[direction] ?? String(direction);
}

async function readOhbCandidatesAtRailCenters(page, railCenters) {
	return page.evaluate((centers) => {
		const slots = window.__tileFab?.getEditorModel().portSlotArtifacts.OHB.slots;
		if (!slots) throw new Error("OHB port slot artifacts are unavailable.");
		const candidates = [];
		for (let row = 0; row < slots.count; row++) {
			if (slots.statuses[row] !== 0) continue;
			const railX = slots.railPositions[row * 2];
			const railY = slots.railPositions[row * 2 + 1];
			if (!centers.some((center) => Math.hypot(center.x - railX, center.y - railY) < 0.05)) {
				continue;
			}
			candidates.push({
				row,
				x: slots.worldPositions[row * 2],
				y: slots.worldPositions[row * 2 + 1],
			});
		}
		return candidates;
	}, railCenters);
}

async function readLegalPortCandidates(page, portType, limit = 128) {
	return page.evaluate(
		({ type, maximum }) => {
			const slots = window.__tileFab?.getEditorModel().portSlotArtifacts[type]?.slots;
			if (!slots) throw new Error(`${type} port slot artifacts are unavailable.`);
			const candidates = [];
			for (let row = 0; row < slots.count && candidates.length < maximum; row++) {
				if (slots.statuses[row] !== 0) continue;
				candidates.push({
					row,
					x: slots.worldPositions[row * 2],
					y: slots.worldPositions[row * 2 + 1],
				});
			}
			return candidates;
		},
		{ type: portType, maximum: limit },
	);
}

async function clickAvailableStkCandidate(page, candidates, expectedRows, excluded) {
	const app = page.getByTestId("tilefab-app");
	for (const candidate of candidates) {
		if (excluded.some((world) => Math.hypot(world.x - candidate.x, world.y - candidate.y) < 0.1)) {
			continue;
		}
		await ensureWorldPointVisible(page, candidate);
		await moveToWorld(page, candidate);
		await page.waitForTimeout(34);
		if ((await page.getByTestId("rail-canvas").getAttribute("data-hover-port-slot")) === "") {
			continue;
		}
		const beforeRows = Number(await app.getAttribute("data-stk-draft-rows"));
		await clickWorld(page, candidate, false);
		const nextRows = await waitForDatasetNumberChange(
			page,
			".tilefab-app",
			"stkDraftRows",
			beforeRows,
		);
		if (nextRows === expectedRows) return candidate;
		if (nextRows !== null) {
			throw new Error(
				`FLEX STK draft changed from ${beforeRows} to ${nextRows}; expected ${expectedRows}.`,
			);
		}
	}
	throw new Error(`No legal FLEX STK candidate produced ${expectedRows} draft ports.`);
}

async function clickAvailableStkMembershipCandidate(page, candidates, expectedRows, excluded) {
	const canvas = page.getByTestId("rail-canvas");
	for (const candidate of candidates) {
		if (excluded.some((world) => Math.hypot(world.x - candidate.x, world.y - candidate.y) < 0.1)) {
			continue;
		}
		await ensureWorldPointVisible(page, candidate);
		await moveToWorld(page, candidate);
		await page.waitForTimeout(34);
		if ((await canvas.getAttribute("data-hover-port-slot")) === "") continue;
		const beforeRows = Number(await canvas.getAttribute("data-port-membership-draft-rows"));
		await clickWorld(page, candidate, false);
		const nextRows = await waitForDatasetNumberChange(
			page,
			'[data-testid="rail-canvas"]',
			"portMembershipDraftRows",
			beforeRows,
		);
		if (nextRows === expectedRows) return candidate;
		if (nextRows !== null) {
			throw new Error(
				`FLEX STK membership changed from ${beforeRows} to ${nextRows}; expected ${expectedRows}.`,
			);
		}
	}
	throw new Error(`No legal FLEX STK membership candidate produced ${expectedRows} ports.`);
}

async function waitForDatasetNumberChange(page, selector, datasetKey, before, timeout = 1_000) {
	try {
		await page.waitForFunction(
			({ targetSelector, key, previous }) => {
				const element = document.querySelector(targetSelector);
				return Number(element?.dataset[key]) !== previous;
			},
			{ targetSelector: selector, key: datasetKey, previous: before },
			{ timeout },
		);
	} catch {
		return null;
	}
	return page.evaluate(
		({ targetSelector, key }) => Number(document.querySelector(targetSelector)?.dataset[key]),
		{ targetSelector: selector, key: datasetKey },
	);
}

async function clickAvailableOhbCandidate(page, candidates, before) {
	for (const candidate of candidates) {
		await ensureWorldPointVisible(page, candidate);
		await moveToWorld(page, candidate);
		await page.waitForTimeout(34);
		if ((await page.getByTestId("rail-canvas").getAttribute("data-hover-port-slot")) === "") {
			continue;
		}
		const beforeGroups = Number(before.equipmentGroups);
		await clickWorld(page, candidate, false);
		const nextGroups = await waitForDatasetNumberChange(
			page,
			".tilefab-app",
			"equipmentGroups",
			beforeGroups,
			2_000,
		);
		if (nextGroups === beforeGroups + 1) return candidate;
		if (nextGroups !== null) {
			throw new Error(
				`OHB placement changed equipment groups from ${beforeGroups} to ${nextGroups}.`,
			);
		}
	}
	throw new Error("No legal OHB candidate could be placed on the selected Large FAB corridor.");
}

async function exercisePortEquipmentMembershipAuthoring(page) {
	await createSyntheticFabProject(page, "bay-assembly");
	await placePattern(page, "long-bay", { x: 200, y: 0 });
	await page.keyboard.press("Escape");
	const initial = await readMetrics(page);
	const canvas = page.getByTestId("rail-canvas");
	await clickActivityCommand(page, "equip", "EQ 포트 행 배치");
	await waitForLegalPortSlots(page);
	await centerWorld(page, { x: 24, y: 5 });
	const eqStart = await screenPointForWorld(page, { x: 8.5, y: 0.5 });
	const eqEnd = await screenPointForWorld(page, { x: 10.5, y: 0.5 });
	await page.mouse.move(eqStart.x, eqStart.y);
	await page.mouse.down();
	await page.mouse.move(eqEnd.x, eqEnd.y, { steps: 8 });
	await page.mouse.up();
	const eqPlaced = await waitForWorker(
		page,
		(metrics) => metrics.equipmentGroups === "1" && metrics.equipmentPorts === "3",
	);
	assertEqual(
		eqPlaced.workerPhysicalFingerprint,
		initial.workerPhysicalFingerprint,
		"EQ placement physical identity",
	);

	const editMembership = page.getByTestId("edit-port-equipment-membership");
	await editMembership.waitFor({ state: "visible" });
	await editMembership.click();
	await waitForMembershipState(page, { type: "EQ", sourceRows: 3, draftRows: 3 });
	const pristine = await readMetrics(page);
	assertEqual(
		await page.getByTestId("complete-port-equipment-membership").isDisabled(),
		true,
		"pristine EQ membership completion",
	);
	await canvas.focus();
	await page.keyboard.press("Enter");
	await page.waitForTimeout(50);
	assertEqual(
		await canvas.getAttribute("data-port-membership-active"),
		"true",
		"pristine Enter keeps EQ membership active",
	);
	await page.keyboard.press("b");
	await page.keyboard.press("Control+c");
	assertEqual(
		await canvas.getAttribute("data-port-membership-active"),
		"true",
		"membership edit owns Canvas tool shortcuts",
	);
	assertEqual(
		(await canvas.getAttribute("class"))?.includes("tilefab-canvas--eq"),
		true,
		"membership shortcut isolation retains EQ tool",
	);
	assertEqual(
		(await readMetrics(page)).workerTargetSequence,
		pristine.workerTargetSequence,
		"pristine Enter does not publish a Worker patch",
	);

	const endpoint = page.getByTestId("switch-eq-membership-endpoint");
	const endpointLabelBefore = await endpoint.getAttribute("aria-label");
	await endpoint.focus();
	await page.keyboard.press("Enter");
	const endpointLabelAfter = await endpoint.getAttribute("aria-label");
	if (!endpointLabelBefore || !endpointLabelAfter || endpointLabelAfter === endpointLabelBefore) {
		throw new Error("Focused EQ endpoint button did not receive Enter.");
	}
	assertEqual(
		await canvas.getAttribute("data-port-membership-active"),
		"true",
		"focused endpoint Enter does not complete membership",
	);
	const cancelMembership = page.getByTestId("cancel-port-equipment-membership");
	await cancelMembership.focus();
	await page.keyboard.press("Enter");
	await waitForMembershipInactive(page);
	assertEqual(
		(await canvas.getAttribute("class"))?.includes("tilefab-canvas--inspect"),
		true,
		"membership cancel returns to inspect",
	);

	await editMembership.waitFor({ state: "visible" });
	await editMembership.click();
	await waitForMembershipState(page, { type: "EQ", sourceRows: 3, draftRows: 3 });
	await canvas.focus();
	await page.keyboard.press("e");
	await page.keyboard.press("ArrowRight");
	await page.waitForFunction(
		() => {
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				railCanvas?.dataset.portMembershipActive === "true" &&
				Number(railCanvas.dataset.portMembershipDraftRows) !== 3
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const eqDraftCount = Number(await canvas.getAttribute("data-port-membership-draft-rows"));
	if (eqDraftCount < 2) throw new Error(`EQ membership draft became invalid: ${eqDraftCount}.`);
	await page.getByTestId("complete-port-equipment-membership").waitFor({ state: "visible" });
	await page.waitForFunction(
		() => {
			const complete = document.querySelector('[data-testid="complete-port-equipment-membership"]');
			return complete instanceof HTMLButtonElement && !complete.disabled;
		},
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page.getByTestId("complete-port-equipment-membership").isEnabled(),
		true,
		"dirty EQ membership completion",
	);
	await canvas.focus();
	await page.keyboard.press("Enter");
	const eqCommitted = await waitForWorker(
		page,
		(metrics) =>
			metrics.equipmentPorts === String(eqDraftCount) &&
			Number(metrics.workerTargetSequence) === Number(eqPlaced.workerTargetSequence) + 1,
	);
	assertEqual(
		eqCommitted.workerPhysicalFingerprint,
		initial.workerPhysicalFingerprint,
		"EQ membership physical identity",
	);
	await page.getByRole("button", { name: "실행 취소" }).click();
	const eqUndone = await waitForWorker(
		page,
		(metrics) =>
			metrics.equipmentPorts === "3" &&
			Number(metrics.workerTargetSequence) === Number(eqCommitted.workerTargetSequence) + 1,
	);
	await page.getByRole("button", { name: "다시 실행" }).click();
	const eqRedone = await waitForWorker(
		page,
		(metrics) =>
			metrics.equipmentPorts === String(eqDraftCount) &&
			Number(metrics.workerTargetSequence) === Number(eqUndone.workerTargetSequence) + 1,
	);
	assertEqual(eqRedone.workerChecksum, eqCommitted.workerChecksum, "EQ membership atomic redo");

	await editMembership.waitFor({ state: "visible" });
	await editMembership.click();
	await waitForMembershipState(page, {
		type: "EQ",
		sourceRows: eqDraftCount,
		draftRows: eqDraftCount,
	});
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(150);
	const membershipBar = page.getByTestId("port-equipment-membership-editbar");
	const membershipHints = page.getByTestId("editor-action-hints");
	await assertLocatorInsideViewport(page, membershipBar);
	await assertLocatorInsideViewport(page, membershipHints);
	for (const hintId of [
		"navigate-equipment-membership",
		"switch-equipment-endpoint",
		"complete-equipment-membership",
		"cancel-equipment-membership",
	]) {
		await assertLocatorInsideViewport(page, membershipHints.locator(`[data-hint-id="${hintId}"]`));
	}
	assertEqual(
		await membershipHints.locator('[data-hint-id="edit-equipment-membership"]').isVisible(),
		false,
		"compact membership hides duplicate pointer hint",
	);
	assertEqual(
		await membershipHints.locator('[data-hint-id="pan-equipment-membership"]').isVisible(),
		false,
		"compact membership hides secondary pan hint",
	);
	for (const control of [
		page.getByTestId("switch-eq-membership-endpoint"),
		page.getByTestId("complete-port-equipment-membership"),
		page.getByTestId("cancel-port-equipment-membership"),
	]) {
		await assertLocatorInsideViewport(page, control);
	}
	assertEqual(
		await canvas.getAttribute("aria-describedby"),
		"tilefab-port-membership-description",
		"membership canvas description",
	);
	if (
		!(await page.locator("#tilefab-port-membership-description").textContent())?.includes(
			"Q 또는 E",
		)
	) {
		throw new Error("EQ membership description does not explain endpoint switching.");
	}
	if (!(await canvas.getAttribute("aria-keyshortcuts"))?.includes("Enter")) {
		throw new Error("Membership canvas does not expose keyboard shortcuts.");
	}
	await page.screenshot({
		path: path.join(artifactRoot, "compact-equipment-membership.png"),
		fullPage: true,
	});
	await page.getByTestId("cancel-port-equipment-membership").focus();
	await page.keyboard.press("Enter");
	await waitForMembershipInactive(page);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);

	await clickActivityCommand(page, "equip", "STK 포트 그룹 배치");
	await page.getByTestId("stk-template-FLEX").click();
	await waitForLegalPortSlots(page);
	const selectedStkSlots = [];
	for (const candidate of await legalPortSlotWorlds(page, "STK")) {
		if (
			selectedStkSlots.some(
				(selected) => Math.hypot(selected.x - candidate.x, selected.y - candidate.y) < 120,
			)
		) {
			continue;
		}
		await ensureWorldPointVisible(page, candidate);
		try {
			await clickAvailableStkSlot(page, candidate, selectedStkSlots.length + 1);
			selectedStkSlots.push(candidate);
		} catch {
			continue;
		}
		if (selectedStkSlots.length === 2) break;
	}
	assertEqual(selectedStkSlots.length, 2, "sparse FLEX STK selected slot count");
	const stkComplete = page.getByTestId("stk-complete");
	assertEqual(await stkComplete.isEnabled(), true, "sparse FLEX STK completion");
	await stkComplete.click();
	const stkPlaced = await waitForWorker(
		page,
		(metrics) =>
			metrics.equipmentGroups === "2" && metrics.equipmentPorts === String(eqDraftCount + 2),
	);
	assertEqual(
		stkPlaced.workerPhysicalFingerprint,
		initial.workerPhysicalFingerprint,
		"STK placement physical identity",
	);

	await editMembership.waitFor({ state: "visible" });
	await editMembership.click();
	await waitForMembershipState(page, { type: "STK", sourceRows: 2, draftRows: 2 });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(150);
	const compactStkHints = page.getByTestId("editor-action-hints");
	await assertLocatorInsideViewport(page, page.getByTestId("port-equipment-membership-editbar"));
	await assertLocatorInsideViewport(page, compactStkHints);
	for (const hintId of [
		"navigate-equipment-membership",
		"toggle-equipment-membership",
		"complete-equipment-membership",
		"cancel-equipment-membership",
	]) {
		await assertLocatorInsideViewport(page, compactStkHints.locator(`[data-hint-id="${hintId}"]`));
	}
	if (!(await canvas.getAttribute("aria-keyshortcuts"))?.includes("Space")) {
		throw new Error("STK membership Canvas does not expose the Space shortcut.");
	}
	if (
		!(await page.locator("#tilefab-port-membership-description").textContent())?.includes("Space")
	) {
		throw new Error("STK membership description does not explain station toggling.");
	}
	await page.screenshot({
		path: path.join(artifactRoot, "compact-stk-membership.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	await canvas.focus();
	let keyboardX = Number(await canvas.getAttribute("data-port-membership-keyboard-x"));
	const targetKeyboardX = Math.floor(Math.max(...selectedStkSlots.map((slot) => slot.x)));
	let expandedSearchRadius = 0;
	let expandedSearchSteps = 0;
	for (let attempt = 0; attempt < 256 && keyboardX < targetKeyboardX; attempt++) {
		const previousX = keyboardX;
		await page.keyboard.press("ArrowRight");
		await page.waitForFunction(
			(before) => {
				const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
				return Number(railCanvas?.dataset.portMembershipKeyboardX) > before;
			},
			previousX,
			{ timeout: 10_000 },
		);
		keyboardX = Number(await canvas.getAttribute("data-port-membership-keyboard-x"));
		expandedSearchRadius = Math.max(
			expandedSearchRadius,
			Number(await canvas.getAttribute("data-port-membership-search-radius-last")),
		);
		expandedSearchSteps = Math.max(
			expandedSearchSteps,
			Number(await canvas.getAttribute("data-port-membership-search-steps-last")),
		);
	}
	assertAtLeast(keyboardX, targetKeyboardX, "STK membership cursor reaches detached distant loop");
	assertAtLeast(expandedSearchRadius, 0, "STK membership search radius telemetry");
	assertAtLeast(expandedSearchSteps, 0, "STK membership search step telemetry");
	for (let offset = 0; offset < 4; offset++) {
		const previousX = Number(await canvas.getAttribute("data-port-membership-keyboard-x"));
		await page.keyboard.press("ArrowRight");
		await page.waitForFunction(
			(before) => {
				const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
				return Number(railCanvas?.dataset.portMembershipKeyboardX) > before;
			},
			previousX,
			{ timeout: 10_000 },
		);
	}
	await page.keyboard.press("Space");
	await waitForMembershipState(page, { type: "STK", sourceRows: 2, draftRows: 3 });
	await page.keyboard.press("Enter");
	const stkCommitted = await waitForWorker(
		page,
		(metrics) =>
			metrics.equipmentPorts === String(eqDraftCount + 3) &&
			Number(metrics.workerTargetSequence) === Number(stkPlaced.workerTargetSequence) + 1,
	);
	await page.getByRole("button", { name: "실행 취소" }).click();
	const stkUndone = await waitForWorker(
		page,
		(metrics) =>
			metrics.equipmentPorts === String(eqDraftCount + 2) &&
			Number(metrics.workerTargetSequence) === Number(stkCommitted.workerTargetSequence) + 1,
	);
	await page.getByRole("button", { name: "다시 실행" }).click();
	const stkRedone = await waitForWorker(
		page,
		(metrics) =>
			metrics.equipmentPorts === String(eqDraftCount + 3) &&
			Number(metrics.workerTargetSequence) === Number(stkUndone.workerTargetSequence) + 1,
	);
	assertEqual(stkRedone.workerChecksum, stkCommitted.workerChecksum, "STK membership atomic redo");
	assertEqual(
		stkRedone.workerPhysicalFingerprint,
		initial.workerPhysicalFingerprint,
		"STK membership physical identity",
	);
	return stkRedone;
}

async function waitForLegalPortSlots(page) {
	await page.waitForFunction(
		() =>
			Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.portSlotLegalCount) > 0,
		undefined,
		{ timeout: 10_000 },
	);
}

async function legalPortSlotWorlds(page, portType) {
	return page.evaluate((requestedPortType) => {
		const slots =
			window.__tileFab?.getEditorModel?.().portSlotArtifacts?.[requestedPortType]?.slots;
		if (!slots || slots.portType !== requestedPortType) return [];
		const worlds = [];
		for (let row = 0; row < slots.count; row++) {
			if (Number(slots.statuses[row]) !== 0) continue;
			worlds.push({
				x: Number(slots.worldPositions[row * 2]),
				y: Number(slots.worldPositions[row * 2 + 1]),
			});
		}
		return worlds;
	}, portType);
}

async function clickAvailableStkSlot(page, world, expectedRows) {
	const app = page.getByTestId("tilefab-app");
	for (const offset of [
		{ x: 0, y: 0 },
		{ x: 0, y: -0.2 },
		{ x: 0, y: 0.2 },
		{ x: -0.2, y: 0 },
		{ x: 0.2, y: 0 },
	]) {
		const candidate = { x: world.x + offset.x, y: world.y + offset.y };
		await moveToWorld(page, candidate);
		await page.waitForTimeout(34);
		await clickWorld(page, candidate, false);
		await page.waitForTimeout(34);
		if (Number(await app.getAttribute("data-stk-draft-rows")) === expectedRows) return;
	}
	throw new Error(`FLEX STK slot ${world.x},${world.y} is not selectable.`);
}

async function waitForMembershipState(page, expected) {
	await page.waitForFunction(
		(value) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.portMembershipActive === "true" &&
				canvas.dataset.portMembershipType === value.type &&
				Number(canvas.dataset.portMembershipSourceRows) === value.sourceRows &&
				Number(canvas.dataset.portMembershipDraftRows) === value.draftRows
			);
		},
		expected,
		{ timeout: 10_000 },
	);
}

async function waitForMembershipInactive(page) {
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.portMembershipActive ===
			"false",
		undefined,
		{ timeout: 10_000 },
	);
}

async function selectWorldArea(page, bounds) {
	await clickActivityCommand(page, "inspect", "선택 및 정보");
	await fitAndZoomOut(page, 1);
	await centerWorld(page, {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
	});
	const start = await screenPointForWorld(page, { x: bounds.minX, y: bounds.minY });
	const end = await screenPointForWorld(page, { x: bounds.maxX, y: bounds.maxY });
	await page.keyboard.down("Shift");
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 12 });
	await page.mouse.up();
	await page.keyboard.up("Shift");
	await page.waitForFunction(
		() => Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) > 0,
		undefined,
		{ timeout: 10_000 },
	);
}

async function modifyWorldAreaSelection(page, startWorld, endWorld, operation) {
	if (operation !== "add" && operation !== "subtract") {
		throw new Error(`Unsupported selection operation ${operation}.`);
	}
	const start = await screenPointForWorld(page, startWorld);
	const end = await screenPointForWorld(page, endWorld);
	await page.keyboard.down("Shift");
	if (operation === "subtract") await page.keyboard.down("Alt");
	try {
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(end.x, end.y, { steps: 8 });
		await page.mouse.up();
	} finally {
		if (operation === "subtract") await page.keyboard.up("Alt");
		await page.keyboard.up("Shift");
	}
}

async function saveSelectionAsBlueprint(page, name, folder) {
	const beforeCount = Number((await readMetrics(page)).projectBlueprints);
	const trigger = page.getByTestId("save-rail-area-blueprint");
	await trigger.click();
	const dialog = page.getByTestId("contextual-blueprint-save-dialog");
	await dialog.waitFor({ state: "visible" });
	assertEqual(await dialog.getAttribute("data-source-kind"), "area-selection", "save source kind");
	if (!contextualSaveResponsiveVerified) {
		const previousViewport = page.viewportSize();
		await page.setViewportSize({ width: 390, height: 720 });
		await page.waitForTimeout(50);
		const bounds = await dialog.boundingBox();
		if (!bounds) throw new Error("Contextual blueprint save dialog has no layout bounds.");
		assertAtLeast(bounds.x, 8, "390px contextual save left margin");
		assertAtLeast(390 - (bounds.x + bounds.width), 8, "390px contextual save right margin");
		assertAtLeast(720 - (bounds.y + bounds.height), 8, "390px contextual save bottom margin");
		for (const control of await dialog
			.locator("button:visible, input:not([type='radio']):visible")
			.all()) {
			const controlBounds = await control.boundingBox();
			if (controlBounds) assertAtLeast(controlBounds.height, 44, "contextual save target height");
		}
		assertEqual(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
			true,
			"390px contextual save horizontal overflow",
		);
		await page.setViewportSize(previousViewport ?? { width: 1440, height: 900 });
		await page.waitForTimeout(50);
		await page.keyboard.press("Escape");
		await dialog.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() => document.activeElement?.getAttribute("data-testid") === "save-rail-area-blueprint",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await trigger.evaluate((element) => document.activeElement === element),
			true,
			"save cancel focus return",
		);
		await trigger.click();
		await dialog.waitFor({ state: "visible" });
		contextualSaveResponsiveVerified = true;
	}
	await completeContextualBlueprintSave(page, {
		name,
		folder,
		destination: "project",
		submitWithShortcut: true,
	});
	await page.waitForFunction(
		(expectedCount) =>
			Number(document.querySelector(".tilefab-app")?.dataset.projectBlueprints) === expectedCount,
		beforeCount + 1,
		{ timeout: 10_000 },
	);
	const blueprintLibrary = page.locator("#tilefab-blueprint-library");
	if (!(await blueprintLibrary.isVisible())) {
		await clickActivityCommand(page, "assemble", "내 청사진");
	}
	await page.getByRole("tab", { name: /PROJECT/ }).click();
}

async function completeContextualBlueprintSave(
	page,
	{ name, folder = "", destination = "project", quickSlot = null, submitWithShortcut = false },
) {
	const dialog = page.getByTestId("contextual-blueprint-save-dialog");
	await dialog.waitFor({ state: "visible" });
	await dialog.getByRole("textbox", { name: "청사진 이름" }).fill(name);
	await dialog.getByRole("textbox", { name: "청사진 폴더" }).fill(folder);
	await dialog
		.getByTestId(
			destination === "user-library" ? "contextual-save-user-library" : "contextual-save-project",
		)
		.click();
	if (destination === "user-library") {
		await dialog
			.getByTestId(
				quickSlot === null
					? "contextual-save-quick-slot-none"
					: `contextual-save-quick-slot-${quickSlot}`,
			)
			.click();
	}
	const confirm = dialog.getByTestId("confirm-contextual-blueprint-save");
	assertEqual(await confirm.isEnabled(), true, "contextual blueprint save enabled");
	if (submitWithShortcut) await page.keyboard.press("Control+S");
	else await confirm.click();
	await dialog.waitFor({ state: "hidden", timeout: 10_000 });
}

async function exerciseBlueprintClipboardShortcuts(page) {
	const beforeCopy = await readMetrics(page);
	const savedTab = page.getByRole("tab", { name: /PROJECT 1/ });
	assertEqual(
		await savedTab.getAttribute("aria-selected"),
		"true",
		"saved blueprint tab after Ctrl+S",
	);
	await page.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();
	await page.keyboard.press("Control+C");
	await page.waitForFunction(
		(previousVersion) => {
			const app = document.querySelector(".tilefab-app");
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.dataset.railClipboard === "area" &&
				app.dataset.areaStampOrigin === "selection-copy" &&
				Number(app.dataset.areaStampModules) > 0 &&
				Number(canvas?.dataset.railClipboardVersion) > Number(previousVersion)
			);
		},
		beforeCopy.railClipboardVersion,
		{ timeout: 10_000 },
	);
	const copied = await readMetrics(page);
	if (Number(copied.railClipboardVersion) <= Number(beforeCopy.railClipboardVersion)) {
		throw new Error("Explicit selection copy did not advance the Recent clipboard version.");
	}
	await page.getByTestId("rail-canvas").focus();
	await page.keyboard.press("Shift+F");
	const afterUnsupportedMirror = await readMetrics(page);
	assertEqual(
		afterUnsupportedMirror.areaStampFlow,
		copied.areaStampFlow,
		"Shift+F does not reverse blueprint flow",
	);
	assertExactStaticFabModelIdentity(
		afterUnsupportedMirror,
		copied,
		"unsupported Shift+F world isolation",
	);
	const placementHints = page.getByTestId("editor-action-hints");
	await placementHints.locator('[data-hint-id="place-blueprint"]').waitFor({ state: "visible" });
	assertEqual(
		await placementHints.locator('[data-hint-id="clone-selection"]').count(),
		0,
		"active blueprint ghost outranks retained selection hints",
	);
	await assertLocatorInsideViewport(
		page,
		await activityCommandButton(page, "assemble", "내 청사진"),
	);
	await clickActivityCommand(page, "assemble", "내 청사진");
	await page.getByTestId("blueprint-recent-tab").click();
	await page.getByTestId("blueprint-recent-record").waitFor({ state: "visible" });
	await page.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();
	await page.keyboard.press("Escape");
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.areaStampModules === "0",
		undefined,
		{ timeout: 10_000 },
	);
	await page.keyboard.press("Control+V");
	await page.waitForFunction(
		() => {
			const app = document.querySelector(".tilefab-app");
			return app?.dataset.areaStampOrigin === "recent" && Number(app.dataset.areaStampModules) > 0;
		},
		undefined,
		{ timeout: 10_000 },
	);
	await assertRmbPlacementControls(page, "recent");
	await clickActivityCommand(page, "assemble", "내 청사진");
	await page.getByRole("tab", { name: /PROJECT 1/ }).click();
	return copied.railClipboardVersion;
}

async function exerciseAtomicCut(page, bounds) {
	await page.keyboard.press("Escape");
	await selectWorldArea(page, bounds);
	const beforeCut = await readMetrics(page);
	await page.keyboard.press("Control+X");
	const cut = await waitForWorker(page, (metrics) => {
		return (
			Number(metrics.workerTargetSequence) === Number(beforeCut.workerTargetSequence) + 1 &&
			Number(metrics.authoredEdges) < Number(beforeCut.authoredEdges) &&
			Number(metrics.equipmentGroups) === Number(beforeCut.equipmentGroups) - 1 &&
			Number(metrics.railClipboardVersion) === Number(beforeCut.railClipboardVersion) + 1
		);
	});
	assertEqual(cut.railClipboard, "area", "atomic cut clipboard kind");
	assertEqual(cut.selectionModules, "0", "atomic cut clears selection after commit");
	assertEqual(cut.areaStampModules, "0", "atomic cut does not enter placement mode");
	assertAtLeast(Number(cut.railClipboardHistory), 2, "bounded recent clipboard history");

	await page.keyboard.press("Control+Z");
	const restored = await waitForWorker(page, (metrics) => {
		return (
			metrics.workerChecksum === beforeCut.workerChecksum &&
			metrics.equipmentGroups === beforeCut.equipmentGroups &&
			metrics.equipmentPorts === beforeCut.equipmentPorts
		);
	});
	assertEqual(
		restored.railClipboardVersion,
		cut.railClipboardVersion,
		"undo keeps the successfully published cut clipboard",
	);
	await page.keyboard.press("Control+V");
	await page.waitForFunction(
		() => {
			const app = document.querySelector(".tilefab-app");
			return app?.dataset.areaStampOrigin === "recent" && Number(app.dataset.areaStampModules) > 0;
		},
		undefined,
		{ timeout: 10_000 },
	);
	await page.keyboard.press("Escape");
}

async function exerciseShapezDiscoveryShortcuts(page, ohbWorld) {
	await page.keyboard.press("Escape");
	await clickActivityCommand(page, "inspect", "선택 및 정보");
	const canvas = page.getByTestId("rail-canvas");
	await centerWorld(page, ohbWorld);
	await moveToWorld(page, ohbWorld);
	await canvas.focus();
	const beforeEquipmentClone = await readMetrics(page);
	await page.keyboard.press("c");
	await page
		.locator('.tilefab-port-buildbar[data-port-intent="copy"][data-port-type="OHB"]')
		.waitFor({ state: "visible", timeout: 10_000 });
	const equipmentClone = await readMetrics(page);
	assertEqual(
		equipmentClone.railClipboardVersion,
		beforeEquipmentClone.railClipboardVersion,
		"C OHB clone preserves rail clipboard version",
	);
	assertExactStaticFabModelIdentity(
		equipmentClone,
		beforeEquipmentClone,
		"C OHB clone world isolation",
	);
	await page.keyboard.press("Escape");
	await assertBuildSnapDoesNotMoveAreaSelection(page);
	await clickActivityCommand(page, "inspect", "선택 및 정보");

	const railWorld = { x: 16.5, y: 0.5 };
	await moveToWorld(page, railWorld);
	await canvas.focus();

	const beforeClone = await readMetrics(page);
	await page.keyboard.press("c");
	await page.waitForFunction(
		(previous) => {
			const app = document.querySelector(".tilefab-app");
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.dataset.railClipboard === "module" &&
				Number(app.dataset.railClipboardHistory) === previous.history + 1 &&
				Number(railCanvas?.dataset.railClipboardVersion) === previous.version + 1 &&
				railCanvas?.dataset.placementGhostActive === "true"
			);
		},
		{
			history: Number(beforeClone.railClipboardHistory),
			version: Number(beforeClone.railClipboardVersion),
		},
		{ timeout: 10_000 },
	);
	const cloned = await readMetrics(page);
	assertEqual(cloned.railClipboard, "module", "C hover clone clipboard kind");
	assertEqual(
		Number(cloned.railClipboardHistory),
		Number(beforeClone.railClipboardHistory) + 1,
		"C hover clone Recent history",
	);
	assertExactStaticFabModelIdentity(cloned, beforeClone, "C hover clone world isolation");

	await page.keyboard.press("Escape");
	await clickActivityCommand(page, "inspect", "선택 및 정보");
	await moveToWorld(page, railWorld);
	await canvas.focus();
	await page.keyboard.press("o");
	try {
		await page.waitForFunction(
			() =>
				Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) > 0 &&
				Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionCells) > 0,
			undefined,
			{ timeout: 10_000 },
		);
	} catch (error) {
		const diagnostic = await page.evaluate(() => {
			const app = document.querySelector(".tilefab-app");
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return {
				status: document.querySelector(".tilefab-statusbar [role='status']")?.textContent ?? "",
				activity: app?.getAttribute("data-editor-activity") ?? "",
				tool: app?.getAttribute("data-editor-tool") ?? "",
				selectionModules: app?.dataset.areaSelectionModules ?? "",
				selectionCells: app?.dataset.areaSelectionCells ?? "",
				selectionEquipmentGroups: app?.dataset.areaSelectionEquipmentGroups ?? "",
				selectionPorts: app?.dataset.areaSelectionPorts ?? "",
				cursor: `${canvas?.dataset.cursorX ?? ""},${canvas?.dataset.cursorY ?? ""}`,
				activePlanKind: canvas?.dataset.activePlanKind ?? "",
				placementGhostActive: canvas?.dataset.placementGhostActive ?? "",
			};
		});
		throw new Error(`O connected-selection diagnostic: ${JSON.stringify(diagnostic)}`, {
			cause: error,
		});
	}
	const connected = await readMetrics(page);
	assertAtLeast(Number(connected.selectionModules), 1, "O connected rail modules");
	assertAtLeast(Number(connected.selectionCells), 1, "O connected rail cells");
	assertEqual(connected.selectionEquipmentGroups, "1", "O connected equipment groups");
	assertEqual(connected.selectionPorts, "1", "O connected equipment ports");

	const railPoint = await screenPointForWorld(page, railWorld);
	await page.keyboard.down("Control");
	await page.mouse.click(railPoint.x, railPoint.y);
	await page.keyboard.up("Control");
	await page.waitForFunction(
		(previousCount) =>
			Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) ===
			previousCount - 1,
		Number(connected.selectionModules),
		{ timeout: 10_000 },
	);
	const toggledOut = await readMetrics(page);
	assertEqual(
		Number(toggledOut.selectionModules),
		Number(connected.selectionModules) - 1,
		"Ctrl+click removes one complete rail module",
	);
	assertExactStaticFabModelIdentity(toggledOut, connected, "Ctrl+click remove world isolation");

	await page.keyboard.down("Control");
	await page.mouse.click(railPoint.x, railPoint.y);
	await page.keyboard.up("Control");
	await page.waitForFunction(
		(expectedCount) =>
			Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) ===
			expectedCount,
		Number(connected.selectionModules),
		{ timeout: 10_000 },
	);
	const toggledIn = await readMetrics(page);
	assertEqual(
		toggledIn.selectionModules,
		connected.selectionModules,
		"Ctrl+click restores one complete rail module",
	);
	assertExactStaticFabModelIdentity(toggledIn, connected, "Ctrl+click add world isolation");

	await centerWorld(page, ohbWorld);
	const equipmentPoint = await screenPointForWorld(page, ohbWorld);
	await page.keyboard.down("Control");
	await page.mouse.click(equipmentPoint.x, equipmentPoint.y);
	await page.keyboard.up("Control");
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.areaSelectionEquipmentGroups === "0",
		undefined,
		{ timeout: 10_000 },
	);
	const equipmentToggledOut = await readMetrics(page);
	assertEqual(
		equipmentToggledOut.selectionModules,
		connected.selectionModules,
		"Ctrl+click equipment toggle preserves rail modules",
	);
	assertEqual(
		equipmentToggledOut.selectionPorts,
		"0",
		"Ctrl+click removes complete equipment ports",
	);
	assertExactStaticFabModelIdentity(
		equipmentToggledOut,
		connected,
		"Ctrl+click equipment remove world isolation",
	);
	await page.keyboard.down("Control");
	await page.mouse.click(equipmentPoint.x, equipmentPoint.y);
	await page.keyboard.up("Control");
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.areaSelectionEquipmentGroups === "1",
		undefined,
		{ timeout: 10_000 },
	);
	const equipmentToggledIn = await readMetrics(page);
	assertEqual(
		equipmentToggledIn.selectionPorts,
		connected.selectionPorts,
		"Ctrl+click restores complete equipment group",
	);
	assertExactStaticFabModelIdentity(
		equipmentToggledIn,
		connected,
		"Ctrl+click equipment add world isolation",
	);
	await centerWorld(page, railWorld);
	assertExactStaticFabModelIdentity(
		connected,
		beforeClone,
		"O connected selection world isolation",
	);
	assertAtLeast(Number(connected.selectionModules), 2, "subtractive selection source modules");
	await modifyWorldAreaSelection(
		page,
		{ x: railWorld.x - 0.4, y: railWorld.y - 0.4 },
		{ x: railWorld.x + 0.4, y: railWorld.y + 0.4 },
		"subtract",
	);
	await page.waitForFunction(
		(previousModules) =>
			Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) <
			previousModules,
		Number(connected.selectionModules),
		{ timeout: 10_000 },
	);
	const subtracted = await readMetrics(page);
	if (Number(subtracted.selectionModules) >= Number(connected.selectionModules)) {
		throw new Error(
			`Alt/Option+Shift subtract did not reduce modules: ${subtracted.selectionModules}/${connected.selectionModules}`,
		);
	}
	assertEqual(
		subtracted.selectionEquipmentGroups,
		connected.selectionEquipmentGroups,
		"rail-only subtract preserves complete equipment groups",
	);
	assertEqual(
		subtracted.selectionPorts,
		connected.selectionPorts,
		"rail-only subtract preserves equipment ports",
	);
	assertExactStaticFabModelIdentity(subtracted, connected, "subtractive selection world isolation");

	await page.keyboard.press("b");
	await page.getByTestId("blueprint-library").waitFor({ state: "visible" });
	const libraryOpen = await readMetrics(page);
	for (const key of [
		"selectionModules",
		"selectionCells",
		"selectionEquipmentGroups",
		"selectionPorts",
		"railClipboard",
		"railClipboardHistory",
		"railClipboardActiveIndex",
		"railClipboardVersion",
	]) {
		assertEqual(libraryOpen[key], subtracted[key], `B library preserves ${key}`);
	}
	assertExactStaticFabModelIdentity(libraryOpen, subtracted, "B library world isolation");
	await page.getByRole("button", { name: "청사진 라이브러리 닫기" }).click();
	await canvas.focus();

	const beforeRecentCycle = await readMetrics(page);
	assertAtLeast(Number(beforeRecentCycle.railClipboardHistory), 2, "RECENT cycle history");
	const canvasBox = await canvas.boundingBox();
	if (!canvasBox) throw new Error("Rail canvas has no visible bounds for RECENT wheel acceptance.");
	await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, 120);
	await page.keyboard.up("Control");
	await page.waitForFunction(
		(previousIndex) => {
			const app = document.querySelector(".tilefab-app");
			const railCanvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.dataset.railClipboardActiveIndex !== previousIndex &&
				railCanvas?.dataset.placementGhostActive === "true"
			);
		},
		beforeRecentCycle.railClipboardActiveIndex,
		{ timeout: 10_000 },
	);
	const recentCycled = await readMetrics(page);
	assertNotEqual(
		recentCycled.railClipboardActiveIndex,
		beforeRecentCycle.railClipboardActiveIndex,
		"Ctrl+wheel changes active RECENT blueprint",
	);
	assertEqual(recentCycled.cameraZoom, beforeRecentCycle.cameraZoom, "Ctrl+wheel preserves zoom");
	assertExactStaticFabModelIdentity(
		recentCycled,
		beforeRecentCycle,
		"Ctrl+wheel RECENT world isolation",
	);

	await page.keyboard.press("Escape");
	const beforeOrdinaryWheel = await readMetrics(page);
	await page.mouse.wheel(0, 120);
	await page.waitForFunction(
		(previousZoom) =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.cameraZoom !== previousZoom,
		beforeOrdinaryWheel.cameraZoom,
		{ timeout: 10_000 },
	);
	const ordinaryWheel = await readMetrics(page);
	assertNotEqual(ordinaryWheel.cameraZoom, beforeOrdinaryWheel.cameraZoom, "ordinary wheel zoom");
	assertEqual(
		ordinaryWheel.railClipboardActiveIndex,
		beforeOrdinaryWheel.railClipboardActiveIndex,
		"ordinary wheel preserves active RECENT blueprint",
	);
	assertExactStaticFabModelIdentity(
		ordinaryWheel,
		beforeOrdinaryWheel,
		"ordinary wheel world isolation",
	);
	return ordinaryWheel;
}

async function exerciseStationProposalReviewEntry(page, baseline) {
	const source = [
		"identity_scope,port_key,attachment_scope,attachment_alias,station_mm,side,lateral_offset_mm,direction,direction_evidence,port_type,physical_group_key,physical_group_kind,organization_alias,source_x_mm,source_z_mm",
		"PUBLIC_TEST,PUBLIC_OHB_1,PUBLIC_RAIL,PUBLIC_ROUTE_1,500,LEFT,700,WITH_TRAVEL,DECLARED,OHB,PUBLIC_GROUP_1,OHB,,,",
	].join("\n");
	const workerStartsBefore = await page.evaluate(
		() => globalThis.__openfabAcceptanceWorkerStarts?.stationProposal ?? -1,
	);
	const chooserPromise = page.waitForEvent("filechooser");
	await clickActivityCommand(page, "equip", "Station proposal 가져오기");
	const chooser = await chooserPromise;
	await chooser.setFiles({
		name: "public-station-review.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(source, "utf8"),
	});
	const panel = page.getByTestId("openfab-station-proposal-review");
	await panel.waitFor({ state: "visible" });
	assertEqual(await panel.getAttribute("data-phase"), "reviewing", "station review phase");
	assertEqual(await panel.getAttribute("data-row-count"), "1", "station review row count");
	assertEqual(
		await panel.getAttribute("data-capture-ready"),
		"false",
		"station review requires explicit decisions",
	);
	assertEqual(
		await panel.locator(".tilefab-station-review-list").getAttribute("data-rendered-rows"),
		"1",
		"station review virtual row count",
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-station-review-phase"),
		"reviewing",
		"station review app contract",
	);
	assertProjectUnchanged(await readMetrics(page), baseline, "station proposal review open");
	const workerStartsAfter = await page.evaluate(
		() => globalThis.__openfabAcceptanceWorkerStarts?.stationProposal ?? -1,
	);
	assertEqual(
		workerStartsAfter - workerStartsBefore,
		1,
		"station proposal file uses one disposable reader Worker",
	);
	await panel.getByRole("button", { name: "Station review 닫기" }).click();
	await panel.waitFor({ state: "hidden" });
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-station-review-phase"),
		"",
		"station review cancellation clears app contract",
	);
	assertProjectUnchanged(await readMetrics(page), baseline, "station proposal review cancellation");
	await activateEditorActivity(page, "build");
	return {
		rows: 1,
		renderedRows: 1,
		readerWorkerStarts: workerStartsAfter - workerStartsBefore,
		projectChecksum: baseline.authoredChecksum,
	};
}

async function exerciseEditorCommandHelp(page, baseline) {
	const canvas = page.getByTestId("rail-canvas");
	const helpButton = page.getByRole("button", { name: "명령·단축키", exact: true });
	const dialog = page.getByTestId("editor-command-help");
	const search = page.getByRole("searchbox", { name: "명령 또는 단축키 검색" });
	const closeButton = page.getByRole("button", { name: "명령 도움말 닫기", exact: true });

	const canvasShortcuts = (await canvas.getAttribute("aria-keyshortcuts")) ?? "";
	for (const shortcut of ["F1", "Shift+/", "Control+C", "Meta+C"]) {
		if (!canvasShortcuts.includes(shortcut)) {
			throw new Error(`canvas aria-keyshortcuts does not expose ${shortcut}`);
		}
	}
	const helpShortcuts = (await helpButton.getAttribute("aria-keyshortcuts")) ?? "";
	if (!helpShortcuts.includes("F1") || !helpShortcuts.includes("Shift+/")) {
		throw new Error("command help trigger does not expose F1 and ? through aria-keyshortcuts");
	}

	await canvas.focus();
	await page.keyboard.press("F1");
	await dialog.waitFor({ state: "visible", timeout: 10_000 });
	await search.waitFor({ state: "visible" });
	assertEqual(
		await search.evaluate((element) => document.activeElement === element),
		true,
		"F1 command help search focus",
	);
	const commandCount = await dialog.locator("[data-command-id]").count();
	assertAtLeast(commandCount, 50, "discoverable editor command count");

	await search.fill("Ctrl+C");
	await page.waitForFunction(
		() =>
			document.querySelectorAll('[data-testid="editor-command-help"] [data-command-id]').length ===
			1,
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await dialog.locator("[data-command-id]").getAttribute("data-command-id"),
		"selection.copy",
		"Ctrl+C command search result",
	);
	await search.fill("LMB drag");
	await page.waitForFunction(
		() =>
			document.querySelectorAll('[data-testid="editor-command-help"] [data-command-id]').length > 0,
		undefined,
		{ timeout: 10_000 },
	);
	assertAtLeast(
		await dialog.locator("[data-command-id]").count(),
		1,
		"pointer command search result",
	);
	await search.fill("");
	await search.focus();
	await page.keyboard.press("Tab");
	assertEqual(
		await closeButton.evaluate((element) => document.activeElement === element),
		true,
		"command help forward focus wrap",
	);
	await page.keyboard.press("Shift+Tab");
	assertEqual(
		await search.evaluate((element) => document.activeElement === element),
		true,
		"command help reverse focus wrap",
	);
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await canvas.evaluate((element) => document.activeElement === element),
		true,
		"F1 command help canvas focus restoration",
	);

	await helpButton.click();
	await dialog.waitFor({ state: "visible" });
	await closeButton.click();
	await dialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("aria-label") === "명령·단축키",
		undefined,
		{ timeout: 10_000 },
	);

	const projectTrigger = page.locator(".tilefab-project-trigger");
	const projectMenu = page.locator("#tilefab-project-menu");
	await projectTrigger.click();
	await projectMenu.waitFor({ state: "visible" });
	await projectMenu.locator("button").first().focus();
	await page.keyboard.press("F1");
	await projectMenu.waitFor({ state: "hidden" });
	await dialog.waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.classList.contains("tilefab-project-trigger"),
		undefined,
		{ timeout: 10_000 },
	);

	await page.setViewportSize({ width: 390, height: 844 });
	await canvas.focus();
	await page.keyboard.press("F1");
	await dialog.waitFor({ state: "visible" });
	const compactLayout = await dialog.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const close = element.querySelector("header button")?.getBoundingClientRect();
		const searchInput = element.querySelector("input[type='search']")?.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top,
			right: rect.right,
			bottom: rect.bottom,
			closeWidth: close?.width ?? 0,
			closeHeight: close?.height ?? 0,
			searchHeight: searchInput?.height ?? 0,
			horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
		};
	});
	assertAtLeast(compactLayout.left, 7, "390px command help left margin");
	assertAtLeast(compactLayout.top, 7, "390px command help top margin");
	assertAtMost(compactLayout.right, 383, "390px command help right edge");
	assertAtMost(compactLayout.bottom, 837, "390px command help bottom edge");
	assertAtLeast(compactLayout.closeWidth, 44, "390px command help close width");
	assertAtLeast(compactLayout.closeHeight, 44, "390px command help close height");
	assertAtLeast(compactLayout.searchHeight, 44, "390px command help search height");
	assertEqual(compactLayout.horizontalOverflow, 0, "390px command help horizontal overflow");
	await page.screenshot({
		path: path.join(artifactRoot, "editor-command-help-390px.png"),
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	await page.setViewportSize({ width: 1440, height: 900 });

	await canvas.focus();
	await page.keyboard.press("Shift+/");
	await dialog.waitFor({ state: "visible", timeout: 10_000 });
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });

	const after = await readMetrics(page);
	assertProjectUnchanged(after, baseline, "editor command help");
	assertExactStaticFabModelIdentity(after, baseline, "editor command help");
	return {
		...after,
		commandCount,
		compactHorizontalOverflow: compactLayout.horizontalOverflow,
		compactCloseTarget: `${compactLayout.closeWidth}x${compactLayout.closeHeight}`,
	};
}

async function assertBuildSnapDoesNotMoveAreaSelection(page) {
	const canvas = page.getByTestId("rail-canvas");
	await centerWorld(page, { x: 16.5, y: 0 });
	await startPattern(page, "attached-return", { x: 16, y: 0 });
	const candidates = [
		{ x: 16.5, y: 1.2 },
		{ x: 16.5, y: 1.6 },
		{ x: 16.5, y: -0.2 },
		{ x: 16.5, y: -0.6 },
	];
	let snapped = null;
	for (const candidate of candidates) {
		await moveToWorld(page, candidate);
		await page.waitForTimeout(50);
		const metrics = await readMetrics(page);
		if (
			Number(metrics.cursorX) !== Math.floor(candidate.x) ||
			Number(metrics.cursorY) !== Math.floor(candidate.y)
		) {
			snapped = candidate;
			break;
		}
	}
	if (!snapped) {
		throw new Error("Build-snap selection fixture did not resolve a snapped Return Bay anchor.");
	}

	const before = await readMetrics(page);
	const end = {
		x: snapped.x,
		y: snapped.y > 0 ? snapped.y + 1.6 : snapped.y - 1.6,
	};
	const startScreen = await screenPointForWorld(page, snapped);
	const endScreen = await screenPointForWorld(page, end);
	await page.keyboard.down("Shift");
	try {
		await page.mouse.move(startScreen.x, startScreen.y);
		await page.mouse.down();
		await page.mouse.move(endScreen.x, endScreen.y, { steps: 8 });
		await page.mouse.up();
	} finally {
		await page.keyboard.up("Shift");
	}
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.placementGhostActive ===
			"false",
		undefined,
		{ timeout: 10_000 },
	);
	const selected = await readMetrics(page);
	assertEqual(selected.selectionModules, "0", "Build snap does not move raw area selection");
	assertEqual(
		selected.selectionEquipmentGroups,
		"0",
		"Build snap does not capture equipment outside the raw marquee",
	);
	assertExactStaticFabModelIdentity(selected, before, "Build snap area-selection isolation");
	await canvas.focus();
}

async function startSavedBlueprintPlacement(page, name) {
	const record = page.getByTestId("blueprint-record").filter({ hasText: name });
	await record.getByTestId("blueprint-place").click();
	await page.waitForFunction(
		() => {
			const app = document.querySelector(".tilefab-app");
			return app?.dataset.areaStampOrigin === "library" && Number(app.dataset.areaStampModules) > 0;
		},
		undefined,
		{ timeout: 10_000 },
	);
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
}

async function assertPlacementGhostSurvivesEditorChrome(page, world, expectedOrigin) {
	const cellCenter = offsetCellCenter(world);
	await centerWorld(page, cellCenter);
	await moveToWorld(page, cellCenter);
	try {
		await page.waitForFunction(
			(origin) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.areaStampOrigin === origin &&
					canvas.dataset.placementGhostActive === "true"
				);
			},
			expectedOrigin,
			{ timeout: 10_000 },
		);
	} catch (error) {
		throw new Error(
			`Placement ghost did not render after canvas entry: ${JSON.stringify(await readMetrics(page))}`,
			{ cause: error },
		);
	}
	const beforeChrome = await readMetrics(page);
	const buildbar = page.getByTestId("rail-buildbar");
	const buildbarBox = await buildbar.boundingBox();
	if (!buildbarBox) throw new Error("Active placement command bar is not visible.");
	await page.mouse.move(
		buildbarBox.x + Math.min(buildbarBox.width - 2, Math.max(2, buildbarBox.width / 2)),
		buildbarBox.y + Math.min(buildbarBox.height - 2, Math.max(2, buildbarBox.height / 2)),
	);
	try {
		await page.waitForFunction(
			({ origin, anchor }) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.areaStampOrigin === origin &&
					canvas.dataset.placementGhostActive === "true" &&
					canvas.dataset.placementGhostAnchor === anchor
				);
			},
			{ origin: expectedOrigin, anchor: beforeChrome.placementGhostAnchor },
			{ timeout: 10_000 },
		);
	} catch (error) {
		throw new Error(
			`Placement ghost changed over editor chrome: ${JSON.stringify({ before: beforeChrome, after: await readMetrics(page) })}`,
			{ cause: error },
		);
	}
	const retained = await readMetrics(page);
	assertEqual(retained.areaStampOrigin, expectedOrigin, `${expectedOrigin} placement origin`);
	assertEqual(
		retained.placementGhostActive,
		"true",
		`${expectedOrigin} ghost retained over chrome`,
	);
	assertEqual(
		retained.placementGhostAnchor,
		beforeChrome.placementGhostAnchor,
		`${expectedOrigin} ghost anchor retained over chrome`,
	);
}

async function assertRmbPlacementControls(page, expectedOrigin) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no visible bounds.");
	const start = {
		x: box.x + Math.max(80, box.width * 0.45),
		y: box.y + Math.max(80, box.height * 0.35),
	};
	await page.mouse.move(start.x, start.y);
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.placementGhostAnchor !== "",
		undefined,
		{ timeout: 10_000 },
	);
	const beforePan = await readMetrics(page);
	await page.mouse.down({ button: "right" });
	await page.mouse.move(start.x + 24, start.y + 12, { steps: 4 });
	await page.mouse.up({ button: "right" });
	await page.waitForFunction(
		({ origin, offsetX, offsetY }) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.areaStampOrigin === origin &&
				canvas.dataset.placementGhostActive === "true" &&
				canvas.dataset.placementGhostAnchor !== "" &&
				canvas.dataset.placementGhostAnchor ===
					`${canvas.dataset.cursorX},${canvas.dataset.cursorY}` &&
				canvas.dataset.cameraOffsetX !== offsetX &&
				canvas.dataset.cameraOffsetY !== offsetY
			);
		},
		{
			origin: expectedOrigin,
			offsetX: beforePan.cameraOffsetX,
			offsetY: beforePan.cameraOffsetY,
		},
		{ timeout: 10_000 },
	);
	const afterPan = await readMetrics(page);
	assertEqual(afterPan.areaStampOrigin, expectedOrigin, "RMB drag preserves placement");
	assertEqual(afterPan.placementGhostActive, "true", "RMB drag preserves placement ghost");
	assertEqual(
		afterPan.placementGhostAnchor,
		`${afterPan.cursorX},${afterPan.cursorY}`,
		"RMB drag refreshes the ghost at the final cursor cell",
	);
	assertEqual(
		afterPan.railClipboardVersion,
		beforePan.railClipboardVersion,
		"RMB drag preserves the Recent clipboard",
	);
	await page.mouse.click(start.x + 24, start.y + 12, { button: "right" });
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.areaStampModules === "0",
		undefined,
		{ timeout: 10_000 },
	);
}

async function undoAndRedo(page, before, after, expectedPlacementOrigin = null) {
	assertEqual(after.historyCanUndo, "true", "history can undo before undo");
	await page.getByRole("button", { name: "실행 취소" }).click();
	const undone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(after.workerTargetSequence) + 1 &&
			metrics.workerChecksum === before.workerChecksum &&
			metrics.modelChecksum === before.modelChecksum,
	);
	assertEqual(undone.equipmentGroups, before.equipmentGroups, "undo equipment groups");
	assertEqual(undone.equipmentPorts, before.equipmentPorts, "undo equipment ports");
	assertEqual(undone.workerChecksum, before.workerChecksum, "undo authored checksum");
	assertEqual(undone.modelChecksum, before.modelChecksum, "undo active model checksum");
	assertEqual(
		undone.modelTopologyFingerprint,
		before.modelTopologyFingerprint,
		"undo topology fingerprint",
	);
	assertEqual(undone.strongComponents, before.strongComponents, "undo directed components");
	assertEqual(undone.openTerminals, before.openTerminals, "undo open terminals");
	assertEqual(undone.readinessReady, before.readinessReady, "undo readiness");
	assertEqual(undone.historyCanRedo, "true", "history can redo after undo");
	if (expectedPlacementOrigin) {
		assertEqual(undone.areaStampOrigin, expectedPlacementOrigin, "undo retains repeat placement");
		assertAtLeast(Number(undone.areaStampModules), 1, "undo repeat placement modules");
	}
	assertEqual(
		Number(undone.workerTargetSequence),
		Number(after.workerTargetSequence) + 1,
		"undo Worker patch sequence",
	);
	await page.getByRole("button", { name: "다시 실행" }).click();
	const redone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(undone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === after.workerChecksum &&
			metrics.modelChecksum === after.modelChecksum,
	);
	assertEqual(redone.equipmentGroups, after.equipmentGroups, "redo equipment groups");
	assertEqual(redone.equipmentPorts, after.equipmentPorts, "redo equipment ports");
	assertEqual(redone.workerChecksum, after.workerChecksum, "redo authored checksum");
	assertEqual(redone.modelChecksum, after.modelChecksum, "redo active model checksum");
	assertEqual(
		redone.modelTopologyFingerprint,
		after.modelTopologyFingerprint,
		"redo topology fingerprint",
	);
	assertEqual(redone.strongComponents, after.strongComponents, "redo directed components");
	assertEqual(redone.openTerminals, after.openTerminals, "redo open terminals");
	assertEqual(redone.readinessReady, after.readinessReady, "redo readiness");
	assertEqual(redone.historyCanUndo, "true", "history can undo after redo");
	assertEqual(redone.historyCanRedo, "false", "history redo stack is consumed");
	if (expectedPlacementOrigin) {
		assertEqual(redone.areaStampOrigin, expectedPlacementOrigin, "redo retains repeat placement");
		assertAtLeast(Number(redone.areaStampModules), 1, "redo repeat placement modules");
	}
	assertEqual(
		Number(redone.workerTargetSequence),
		Number(undone.workerTargetSequence) + 1,
		"redo Worker patch sequence",
	);
	return redone;
}

async function readGuidedRailLinkComponents(page) {
	return page.evaluate(() => {
		const map = window.__tileFab?.getDocument().map;
		if (!map) throw new Error("Guided network repair cannot read the active rail map.");
		const directions = [
			{ bit: 1, dx: 0, dy: -1 },
			{ bit: 2, dx: 1, dy: 0 },
			{ bit: 4, dx: 0, dy: 1 },
			{ bit: 8, dx: -1, dy: 0 },
		];
		const rails = new Map();
		map.forEachRail((x, y, rail) => {
			rails.set(`${x},${y}`, {
				x,
				y,
				incoming: rail.incoming,
				outgoing: rail.outgoing,
			});
		});
		const unseen = new Set(rails.keys());
		const components = [];
		while (unseen.size > 0) {
			const first = unseen.values().next().value;
			if (typeof first !== "string") break;
			unseen.delete(first);
			const pending = [first];
			const cells = [];
			while (pending.length > 0) {
				const key = pending.pop();
				const rail = rails.get(key);
				if (!rail) continue;
				cells.push({ x: rail.x, y: rail.y });
				const connectionMask = rail.incoming | rail.outgoing;
				for (const direction of directions) {
					if ((connectionMask & direction.bit) === 0) continue;
					const neighborKey = `${rail.x + direction.dx},${rail.y + direction.dy}`;
					if (!unseen.delete(neighborKey)) continue;
					pending.push(neighborKey);
				}
			}
			cells.sort((left, right) => left.y - right.y || left.x - right.x);
			components.push({
				size: cells.length,
				bounds: cells.reduce(
					(bounds, cell) => ({
						minX: Math.min(bounds.minX, cell.x),
						minY: Math.min(bounds.minY, cell.y),
						maxX: Math.max(bounds.maxX, cell.x),
						maxY: Math.max(bounds.maxY, cell.y),
					}),
					{ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
				),
				cells,
			});
		}
		components.sort((left, right) => left.size - right.size);
		return components;
	});
}

function guidedRailLinkCandidatePairs(components) {
	if (components.length < 2) return [];
	const source = components[0];
	const target = components[components.length - 1];
	return source.cells
		.flatMap((sourceCell) =>
			target.cells.map((targetCell) => ({
				source: sourceCell,
				target: targetCell,
				distance: Math.abs(sourceCell.x - targetCell.x) + Math.abs(sourceCell.y - targetCell.y),
			})),
		)
		.sort(
			(left, right) =>
				left.distance - right.distance ||
				left.source.y - right.source.y ||
				left.source.x - right.source.x ||
				left.target.y - right.target.y ||
				left.target.x - right.target.x,
		)
		.slice(0, 240);
}

async function guidedRailLinkPointsAreInteractive(page, sourcePoint, targetPoint) {
	return page.evaluate(
		({ sourcePoint, targetPoint }) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			if (!canvas) return false;
			return [sourcePoint, targetPoint].every(({ x, y }) => {
				const element = document.elementFromPoint(x, y);
				return element === canvas || element?.closest('[data-testid="rail-canvas"]') === canvas;
			});
		},
		{ sourcePoint, targetPoint },
	);
}

async function resetGuidedRailLinkAnchor(page, steps) {
	await page.keyboard.press("Escape");
	await page.waitForFunction(
		() => document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage === "source",
		undefined,
		{ timeout: 5_000 },
	);
	await steps.waitFor({ state: "visible" });
}

async function connectOneGuidedRailNetwork(page, before) {
	const expectedBefore = Number(before.strongComponents);
	const components = await readGuidedRailLinkComponents(page);
	assertEqual(components.length, expectedBefore, "Guided repair discovered rail networks");
	const pairs = guidedRailLinkCandidatePairs(components);
	if (pairs.length === 0) {
		throw new Error(`Guided repair found no candidate rail pair: ${JSON.stringify(components)}`);
	}
	const steps = page.getByTestId("network-link-steps");
	await steps.waitFor({ state: "visible" });
	assertEqual(await steps.getAttribute("data-stage"), "source", "Guided repair initial stage");
	const compactCameraControls = page.locator(".tilefab-camera-controls");
	await compactCameraControls.waitFor({ state: "visible" });
	await compactCameraControls.getByRole("button", { name: "전체 화면 맞춤", exact: true }).click();
	await compactCameraControls.getByRole("button", { name: "화면 축소", exact: true }).click();
	const failures = [];
	reportAcceptanceProgress(
		`guided-network-repair:${expectedBefore}:components-${components.map(({ size }) => size).join("-")}:pairs-${pairs.length}`,
	);
	for (const [pairIndex, pair] of pairs.slice(0, 16).entries()) {
		const midpoint = {
			x: (pair.source.x + pair.target.x + 1) / 2,
			y: (pair.source.y + pair.target.y + 1) / 2,
		};
		let sourcePoint = await screenPointForWorld(page, offsetCellCenter(pair.source));
		let targetPoint = await screenPointForWorld(page, offsetCellCenter(pair.target));
		if (!(await guidedRailLinkPointsAreInteractive(page, sourcePoint, targetPoint))) {
			await centerWorld(page, midpoint);
			sourcePoint = await screenPointForWorld(page, offsetCellCenter(pair.source));
			targetPoint = await screenPointForWorld(page, offsetCellCenter(pair.target));
			if (!(await guidedRailLinkPointsAreInteractive(page, sourcePoint, targetPoint))) continue;
		}
		await page.mouse.move(sourcePoint.x, sourcePoint.y);
		await page.mouse.down();
		try {
			await page.waitForFunction(
				() =>
					document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage === "target",
				undefined,
				{ timeout: 2_500 },
			);
		} catch {
			await page.mouse.up();
			failures.push({ ...pair, failure: "source" });
			reportAcceptanceProgress(
				`guided-network-repair:${expectedBefore}:pair-${pairIndex + 1}:source-rejected`,
			);
			await resetGuidedRailLinkAnchor(page, steps);
			continue;
		}
		await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 18 });
		try {
			await page.waitForFunction(
				() =>
					document.querySelector('[data-testid="rail-canvas"]')?.dataset.activePlanKind ===
						"network-link" &&
					document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage === "valid",
				undefined,
				{ timeout: 3_000 },
			);
		} catch {
			const preview = await page.evaluate(() => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return {
					stage: document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage,
					plan: canvas?.dataset.activePlanKind,
					valid: canvas?.dataset.draftPreviewValid,
					issues: canvas?.dataset.draftPreviewIssues,
				};
			});
			await page.mouse.up();
			failures.push({ ...pair, failure: "target", preview });
			reportAcceptanceProgress(
				`guided-network-repair:${expectedBefore}:pair-${pairIndex + 1}:target-${preview.stage ?? "missing"}-${preview.valid ?? "missing"}`,
			);
			await resetGuidedRailLinkAnchor(page, steps);
			continue;
		}
		await page.mouse.up();
		try {
			await page.waitForFunction(
				(expectedSequence) =>
					Number(
						document.querySelector('[data-testid="rail-canvas"]')?.dataset.workerTargetSequence,
					) === expectedSequence,
				Number(before.workerTargetSequence) + 1,
				{ timeout: 3_000 },
			);
		} catch (error) {
			const diagnostics = await page.evaluate(
				({ pair, sourcePoint, targetPoint }) => {
					const canvas = document.querySelector('[data-testid="rail-canvas"]');
					return {
						pair,
						sourcePoint,
						targetPoint,
						cursor: `${canvas?.dataset.cursorX ?? ""},${canvas?.dataset.cursorY ?? ""}`,
						stage: document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage,
						status: document.querySelector(".tilefab-statusbar [role=status]")?.textContent,
						preview: document.querySelector(".tilefab-status-preview")?.textContent,
						sequence: canvas?.dataset.workerTargetSequence,
					};
				},
				{ pair, sourcePoint, targetPoint },
			);
			throw new Error(
				`Guided repair valid preview did not commit: ${JSON.stringify(diagnostics)}`,
				{
					cause: error,
				},
			);
		}
		const committed = await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1 &&
				Number(metrics.strongComponents) === expectedBefore - 1 &&
				metrics.workerChecksum === metrics.modelChecksum &&
				metrics.workerSimulationReady === "false",
			{ timeout: 30_000 },
		);
		assertEqual(committed.openTerminals, "0", "Guided repair keeps rail closed");
		reportAcceptanceProgress(
			`guided-network-repair:${expectedBefore}->${committed.strongComponents}:committed`,
		);
		return committed;
	}
	throw new Error(
		`Guided repair could not connect ${expectedBefore} networks: ${JSON.stringify({ components: components.map(({ size, bounds }) => ({ size, bounds })), failures: failures.slice(-12) })}`,
	);
}

async function connectClosedBays(page, source, target) {
	await page.keyboard.press("Escape");
	await clickActivityCommand(page, "build", "레일 건설");
	await page.getByRole("button", { name: /SMART ROUTE/ }).click();
	const steps = page.getByTestId("network-link-steps");
	await steps.waitFor({ state: "visible" });
	assertEqual(await steps.getAttribute("data-stage"), "source", "two-way link initial stage");
	await assertCompactSmartLinkLayout(page, steps);
	await fitAndZoomOut(page, 1);
	await assertInvalidSmartLinkSourceRejected(page, steps, { x: 32, y: 10 });
	const sourcePoint = await screenPointForWorld(page, offsetCellCenter(source));
	const targetPoint = await screenPointForWorld(page, offsetCellCenter(target));
	await page.mouse.move(sourcePoint.x, sourcePoint.y);
	await page.mouse.down();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage === "target",
		undefined,
		{ timeout: 10_000 },
	);
	await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 18 });
	try {
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="rail-canvas"]')?.dataset.activePlanKind ===
					"network-link" &&
				document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage === "valid",
			undefined,
			{ timeout: 10_000 },
		);
	} catch (error) {
		const diagnostics = await page.evaluate(
			({ source, target }) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				const map = window.__tileFab?.getDocument().map;
				return {
					stage: document.querySelector('[data-testid="network-link-steps"]')?.dataset.stage,
					activePlanKind: canvas?.dataset.activePlanKind,
					draftPreviewValid: canvas?.dataset.draftPreviewValid,
					draftPreviewIssues: canvas?.dataset.draftPreviewIssues,
					draftPreviewConflicts: canvas?.dataset.draftPreviewConflictCells,
					sourceEncoded: map?.getEncoded(source.x, source.y),
					targetEncoded: map?.getEncoded(target.x, target.y),
					bounds: map?.bounds(),
					camera: window.__tileFab?.camera,
				};
			},
			{ source, target },
		);
		await page.mouse.up();
		throw new Error(`Closed Bay link preview failed: ${JSON.stringify(diagnostics)}`, {
			cause: error,
		});
	}
	await page.mouse.up();
}

async function assertInvalidSmartLinkSourceRejected(page, steps, invalidSource) {
	const before = await readMetrics(page);
	const invalidPoint = await screenPointForWorld(page, offsetCellCenter(invalidSource));
	await page.mouse.move(invalidPoint.x, invalidPoint.y);
	await page.mouse.down();
	await page.mouse.up();
	assertEqual(await steps.getAttribute("data-stage"), "source", "invalid link source stage");
	assertEqual(
		await page.getByTestId("rail-canvas").getAttribute("data-active-plan-kind"),
		null,
		"invalid link source preview",
	);
	const rejected = await waitForWorker(
		page,
		(metrics) => metrics.workerChecksum === before.workerChecksum,
	);
	assertEqual(rejected.physicalPaths, before.physicalPaths, "invalid link source physical paths");
	assertEqual(rejected.historyCanUndo, before.historyCanUndo, "invalid link source history");
}

async function assertCompactSmartLinkLayout(page, steps) {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	await assertLocatorInsideViewport(page, page.getByTestId("rail-buildbar"));
	await assertLocatorInsideViewport(page, steps);
	for (const name of [
		/SMART ROUTE/,
		/U-TURN/,
		/^SHIFT/,
		/2×2 SWITCH/,
		"ASSEMBLE",
		/BLUEPRINTS 1/,
		"RECENT",
		"AUTO",
		"X→Z",
		"Z→X",
	]) {
		await assertLocatorInsideViewport(page, legacyBuildbarButton(page, name));
	}
	await page.screenshot({
		path: path.join(artifactRoot, "compact-smart-route-link.png"),
		fullPage: true,
	});
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	await steps.waitFor({ state: "visible" });
}

async function saveProject(page) {
	await waitForProjectOperation(page, "idle");
	const saveButton = page.getByRole("button", { name: "프로젝트 저장" });
	await saveButton.waitFor({ state: "visible" });
	if (await saveButton.isDisabled()) {
		throw new Error(
			"OpenFab project save remained disabled after the project operation became idle.",
		);
	}
	const downloadPromise = page.waitForEvent("download");
	await saveButton.click();
	const download = await downloadPromise;
	const downloadPath = await download.path();
	if (!downloadPath) throw new Error("OpenFab project download has no readable path.");
	await waitForProjectOperation(page, "idle");
	return downloadPath;
}

async function putRawUserBlueprintRecord(page, value) {
	await page.evaluate(async (record) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open("openfab-native-projects", 3);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise((resolve, reject) => {
			const transaction = database.transaction("user-blueprints", "readwrite");
			transaction.objectStore("user-blueprints").put(record);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
		database.close();
	}, value);
}

async function deleteRawUserBlueprintRecord(page, id) {
	await page.evaluate(async (recordId) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open("openfab-native-projects", 3);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise((resolve, reject) => {
			const transaction = database.transaction("user-blueprints", "readwrite");
			transaction.objectStore("user-blueprints").delete(recordId);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
		database.close();
	}, id);
}

async function saveProjectWithKeyboard(page) {
	const canvas = page.getByTestId("rail-canvas");
	await canvas.focus();
	const downloadPromise = page.waitForEvent("download");
	await canvas.press("Control+s");
	const download = await downloadPromise;
	const downloadPath = await download.path();
	if (!downloadPath) throw new Error("Keyboard OpenFab project save has no readable path.");
	await waitForProjectOperation(page, "idle");
	return downloadPath;
}

async function reloadProjectFromFile(page, filePath) {
	await createSyntheticFabProject(page, "blank");
	const chooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "프로젝트 열기" }).click();
	const openDiscard = page.getByRole("button", { name: "저장하지 않고 계속" });
	if (await openDiscard.isVisible().catch(() => false)) await openDiscard.click();
	const chooser = await chooserPromise;
	await chooser.setFiles(filePath);
	await waitForWorker(page, (metrics) => Number(metrics.physicalPaths) > 0);
}

async function loadLegacyLargeFabAcceptanceFixture(page) {
	await reloadProjectFromFile(page, await createLegacyLargeFabAcceptanceFixture());
	const loaded = await readMetrics(page);
	assertEqual(loaded.projectName, "OpenFab Large FAB", "legacy Large FAB fixture manifest");
	assertEqual(loaded.strongComponents, "1", "legacy Large FAB fixture network count");
	assertEqual(loaded.openTerminals, "0", "legacy Large FAB fixture terminal count");
	return loaded;
}

async function createLegacyLargeFabAcceptanceFixture() {
	if (legacyLargeFabAcceptanceFixturePath !== null) return legacyLargeFabAcceptanceFixturePath;
	const { createServer } = await import("vite");
	const vite = await createServer({
		root,
		appType: "custom",
		logLevel: "silent",
		server: { middlewareMode: true },
	});
	try {
		const starter = await vite.ssrLoadModule("/src/tilefab/compile/SyntheticFabStarter.ts");
		const project = await vite.ssrLoadModule("/src/tilefab/project/OpenFabProject.ts");
		const codec = await vite.ssrLoadModule("/src/tilefab/project/OpenFabProjectCodec.ts");
		const build = starter.buildSyntheticFabStarter(
			starter.defaultSyntheticFabStarterRequest("large-fab-60"),
		);
		const manifest = project.createOpenFabProjectManifest(
			"openfab-acceptance-legacy-large-fab",
			"OpenFab Large FAB",
			"2024-01-01T00:00:00.000Z",
		);
		const serialized = codec.serializeOpenFabProject(
			project.captureOpenFabProject(build.document, { manifest }),
		);
		const fixturePath = path.join(artifactRoot, "legacy-large-fab-60-acceptance.openfab.json");
		await writeFile(fixturePath, serialized, "utf8");
		legacyLargeFabAcceptanceFixturePath = fixturePath;
		return fixturePath;
	} finally {
		await vite.close();
	}
}

async function waitForRecoveryRecord(
	page,
	projectId,
	authoredChecksum,
	minimumUpdatedAt = "",
	timeout = 30_000,
) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const record = await page.evaluate(async (id) => {
			return new Promise((resolve) => {
				const open = indexedDB.open("openfab-native-projects");
				open.onerror = () => resolve(null);
				open.onsuccess = () => {
					const database = open.result;
					if (!database.objectStoreNames.contains("recovery-projects")) {
						database.close();
						resolve(null);
						return;
					}
					const transaction = database.transaction("recovery-projects", "readonly");
					const read = transaction.objectStore("recovery-projects").get(id);
					read.onerror = () => {
						database.close();
						resolve(null);
					};
					read.onsuccess = () => {
						const value = read.result ?? null;
						database.close();
						resolve(value);
					};
				};
			});
		}, projectId);
		if (
			record?.authoredChecksum === authoredChecksum &&
			typeof record.json === "string" &&
			typeof record.updatedAt === "string" &&
			record.updatedAt >= minimumUpdatedAt
		) {
			return record;
		}
		await page.waitForTimeout(100);
	}
	throw new Error(
		`Timed out waiting for recovery ${projectId} at checksum ${authoredChecksum}: ${JSON.stringify(await readMetrics(page))}`,
	);
}

async function exerciseNarrowLayout(page) {
	await page.setViewportSize({ width: 760, height: 900 });
	await page.waitForTimeout(250);
	await assertEditorActivityRailLayout(page, "760px");
	await exerciseSyntheticStarterLayout(page);
	const canvasBox = await page.getByTestId("rail-canvas").boundingBox();
	if (!canvasBox || canvasBox.width < 700 || canvasBox.height < 650) {
		throw new Error(`Narrow canvas is clipped: ${JSON.stringify(canvasBox)}.`);
	}
	for (const name of [
		/SMART ROUTE/,
		/U-TURN/,
		/^SHIFT/,
		/2×2 SWITCH/,
		"ASSEMBLE",
		/BLUEPRINTS 1/,
		"AUTO",
	]) {
		await assertLocatorInsideViewport(page, legacyBuildbarButton(page, name));
	}
	const patternToggle = page.getByTestId("rail-pattern-browser-toggle");
	await patternToggle.click();
	await exerciseProductionBayPanelLayout(page);
	await patternToggle.click();
	await openAdvancedRailMotifs(page);
	assertEqual(
		await page.getByTestId("rail-template-return-loop").count(),
		0,
		"terminal repair stays out of the 760px flat gallery",
	);
	assertEqual(
		await page
			.getByRole("button", { name: "PROCESS LOOPS", exact: true })
			.getAttribute("aria-pressed"),
		"true",
		"terminal repair re-entry restores a structural category",
	);
	await page.getByRole("button", { name: "SPINES", exact: true }).click();
	await page.getByTestId("rail-template-interbay-spine").click();
	const configurator = page.getByTestId("pattern-configurator");
	assertEqual(await configurator.isVisible(), false, "pattern browser collapses after selection");
	const configToggle = page.getByTestId("pattern-config-toggle");
	await assertLocatorInsideViewport(page, configToggle);
	await configToggle.click();
	await configurator.waitFor({ state: "visible" });
	const configBox = await configurator.boundingBox();
	if (!configBox || configBox.x < 0 || configBox.y < 0 || configBox.x + configBox.width > 760) {
		throw new Error(`Narrow pattern configurator is clipped: ${JSON.stringify(configBox)}.`);
	}
	await page.getByTestId("template-flow-toggle").click();
	await page.getByTestId("template-rotate-clockwise").click();
	await page.keyboard.press("Escape");
	const metrics = await readMetrics(page);
	assertEqual(metrics.workerStatus, "ready", "narrow layout Worker status");
	assertEqual(metrics.workerSimulationReady, "false", "narrow layout simulation gate");
}

async function exerciseProductionBayPanelLayout(page) {
	const launcher = page.getByTestId("production-bay-module-browser");
	await launcher.click();
	const panel = page.getByRole("region", { name: "Production Bay" });
	await panel.waitFor({ state: "visible" });
	await assertLocatorInsideViewport(page, panel);

	const app = page.getByTestId("tilefab-app");
	assertEqual(
		await app.evaluate((element) => {
			for (let current = element; current; current = current.parentElement) {
				if (current.inert || current.getAttribute("aria-hidden") === "true") return true;
			}
			return false;
		}),
		false,
		"Production Bay keeps the Canvas interactive",
	);
	assertEqual(
		await page.locator('[aria-modal="true"]').count(),
		0,
		"Production Bay current-map surface is non-modal",
	);
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
			"true",
	);
	assertEqual(await panel.getAttribute("data-live-preview"), "active", "Production Bay live ghost");

	const decrementShellGap = page.getByRole("button", {
		name: "Decrease Shell clearance",
	});
	assertEqual(await decrementShellGap.isDisabled(), true, "Production Bay minimum stepper state");
	for (const locator of [decrementShellGap, page.getByRole("button", { name: "CANVAS" })]) {
		const box = await locator.boundingBox();
		if (!box || box.width < 44 || box.height < 44) {
			throw new Error(`Production Bay control is smaller than 44px: ${JSON.stringify(box)}.`);
		}
	}

	const beforeFootprint = await panel.getByText(/40 × 22 m/).count();
	assertEqual(beforeFootprint, 1, "Production Bay default footprint");
	const historyBeforeConfiguration = {
		undo: await app.getAttribute("data-history-can-undo"),
		redo: await app.getAttribute("data-history-can-redo"),
	};
	await page.getByRole("button", { name: "Increase Outer shell length" }).click();
	assertEqual(
		await panel.getByText(/41 × 22 m/).count(),
		1,
		"Production Bay live dimension update",
	);
	const depthInput = page.getByRole("spinbutton", { name: "Outer shell depth" });
	await depthInput.fill("7");
	assertEqual(
		await panel.getAttribute("data-live-preview"),
		"paused",
		"Production Bay invalid draft pauses live updates",
	);
	assertEqual(
		await app.getAttribute("data-organization-bundle-active"),
		"true",
		"Production Bay invalid draft retains last valid ghost",
	);
	assertEqual(
		await app.getAttribute("data-history-can-undo"),
		historyBeforeConfiguration.undo,
		"Production Bay configuration undo state",
	);
	assertEqual(
		await app.getAttribute("data-history-can-redo"),
		historyBeforeConfiguration.redo,
		"Production Bay configuration redo state",
	);
	await depthInput.fill("22");
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="production-bay-module-panel"]')
				?.getAttribute("data-live-preview") === "active",
	);
	await page.getByRole("button", { name: "CANVAS" }).click();
	assertEqual(
		await page.getByTestId("rail-canvas").evaluate((element) => element === document.activeElement),
		true,
		"Production Bay Canvas handoff",
	);
	await page.keyboard.press("r");
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleRotation ===
			"90",
	);
	assertEqual(
		await panel.getByText("Rotation 90°", { exact: true }).count(),
		1,
		"Production Bay rotation feedback",
	);
	assertEqual(await panel.isVisible(), true, "Production Bay panel survives Canvas rotation");
	await page.keyboard.press("Escape");
	await panel.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
			"false",
	);
	assertEqual(
		await page.getByTestId("rail-canvas").evaluate((element) => element === document.activeElement),
		true,
		"Production Bay cancel returns to Canvas",
	);
}

async function exerciseProductionFabCanvasOrganizationSelection(page, sourceMetrics) {
	const before = await readMetrics(page);
	assertExactStaticFabModelIdentity(before, sourceMetrics, "Canvas organization selection source");
	assertEqual(before.organizationSelectionCount, "0", "initial Canvas organization selection");
	assertEqual(before.organizationSelectionIds, "", "initial Canvas organization selection IDs");
	const fixture = await readSemanticOrganizationSelectionFixture(page);
	assertEqual(fixture.roleCounts.FAB, 1, "Canvas outline Fab count");
	assertEqual(fixture.roleCounts.BAY_BANK, 3, "Canvas outline Bay Bank count");
	assertEqual(fixture.roleCounts.BAY, 60, "Canvas outline Bay count");
	assertEqual(fixture.targets.length, 3, "Canvas outline deterministic Bay targets");
	// This certified layout has disjoint same-role effective AABBs. Keep chooser coverage explicitly
	// unit-only until a public-safe certified overlap fixture can exercise its responsive DOM surface.
	assertEqual(
		fixture.overlap,
		null,
		"certified Production FAB has no deterministic same-role overlap chooser fixture",
	);

	const desktopReady = await enterCanvasOrganizationSelectionFromAssembleMenu(
		page,
		fixture.semanticOrganizationCount,
		"desktop",
	);
	assertAtLeast(
		Number(desktopReady.organizationOutlineRequestCount),
		1,
		"Canvas outline request count",
	);
	assertAtLeast(Number(desktopReady.organizationOutlineBytes), 1, "Canvas outline retained bytes");
	assertAtLeast(
		Number(desktopReady.organizationOutlineVisibleRows),
		1,
		"Canvas outline viewport rows",
	);
	assertAtLeast(
		Number(desktopReady.organizationOutlineBindings),
		1,
		"Canvas outline renderer bindings",
	);
	assertAtLeast(
		Number(desktopReady.organizationOutlineQueryCandidates),
		1,
		"Canvas outline viewport query candidates",
	);
	const outlineRequestCount = desktopReady.organizationOutlineRequestCount;
	const outlineBindingCount = desktopReady.organizationOutlineBindings;
	const keyboardCanvas = page.getByTestId("rail-canvas");
	const keyboardShortcuts = (await keyboardCanvas.getAttribute("aria-keyshortcuts")) ?? "";
	assertIncludes(keyboardShortcuts, "ArrowRight", "Canvas organization keyboard navigation");
	assertIncludes(keyboardShortcuts, "Enter", "Canvas organization keyboard selection");
	await page.keyboard.press("Home");
	await page.waitForFunction(
		() =>
			(document.querySelector('[data-testid="rail-canvas"]')?.dataset.organizationOutlineHoverId ??
				"") !== "",
		undefined,
		{ timeout: 10_000 },
	);
	const keyboardHoverId = (await readMetrics(page)).organizationOutlineHoverId;
	await page.keyboard.press("Enter");
	await page.waitForFunction(
		(expectedId) => {
			const app = document.querySelector(".tilefab-app");
			return (
				app?.dataset.organizationSelectionCount === "1" &&
				app.dataset.organizationSelectionIds === expectedId
			);
		},
		keyboardHoverId,
		{ timeout: 10_000 },
	);
	await page.keyboard.press("Control+Enter");
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.organizationSelectionCount === "0",
		undefined,
		{ timeout: 10_000 },
	);
	const afterKeyboardSelection = await readMetrics(page);
	assertEqual(
		afterKeyboardSelection.organizationExactMaterializations,
		before.organizationExactMaterializations,
		"keyboard Canvas selection keeps exact membership lazy",
	);
	assertProjectUnchanged(afterKeyboardSelection, before, "keyboard Canvas organization selection");
	assertExactStaticFabModelIdentity(
		afterKeyboardSelection,
		before,
		"keyboard Canvas organization selection identity",
	);
	const firstTarget = fixture.targets[0];
	const secondTarget = fixture.targets[1];
	const thirdTarget = fixture.targets[2];
	if (!firstTarget || !secondTarget || !thirdTarget) {
		throw new Error("Production FAB Canvas organization targets are incomplete.");
	}

	await hoverSemanticOrganizationTarget(page, firstTarget);
	const hovered = await readMetrics(page);
	assertEqual(
		hovered.organizationOutlineHoverId,
		String(firstTarget.organizationId),
		"Canvas outline hover identity",
	);
	assertAtLeast(
		Number(hovered.organizationOutlineHitCandidates),
		1,
		"Canvas outline point-hit candidates",
	);
	assertEqual(hovered.organizationSelectionCount, "0", "Canvas hover does not select");
	assertProjectUnchanged(hovered, before, "Canvas organization hover");
	assertExactStaticFabModelIdentity(hovered, before, "Canvas organization hover identity");

	await clickSemanticOrganizationTarget(page, firstTarget, null, [firstTarget.organizationId]);
	await waitForEditorStatus(page, firstTarget.displayName);
	await clickSemanticOrganizationTarget(page, firstTarget, "Control", []);
	assertProjectUnchanged(
		await readMetrics(page),
		before,
		"desktop plain and primary Canvas organization selection",
	);

	await page.setViewportSize({ width: 760, height: 900 });
	await page.waitForTimeout(100);
	const narrowReady = await enterCanvasOrganizationSelectionFromAssembleMenu(
		page,
		fixture.semanticOrganizationCount,
		"760px",
	);
	assertEqual(
		narrowReady.organizationOutlineRequestCount,
		outlineRequestCount,
		"760px Canvas outline artifact reuse",
	);
	await clickSemanticOrganizationTarget(page, firstTarget, null, [firstTarget.organizationId]);
	await clickSemanticOrganizationTarget(page, secondTarget, "Control", [
		firstTarget.organizationId,
		secondTarget.organizationId,
	]);
	await waitForEditorStatus(page, "2개 조직 선택");
	assertProjectUnchanged(
		await readMetrics(page),
		before,
		"760px plain and primary Canvas organization selection",
	);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	const compactReady = await enterCanvasOrganizationSelectionFromAssembleMenu(
		page,
		fixture.semanticOrganizationCount,
		"390px",
	);
	assertEqual(
		compactReady.organizationOutlineRequestCount,
		outlineRequestCount,
		"390px Canvas outline artifact reuse",
	);
	await clickSemanticOrganizationTarget(page, thirdTarget, null, [thirdTarget.organizationId]);
	await clickSemanticOrganizationTarget(page, firstTarget, "Shift", [
		thirdTarget.organizationId,
		firstTarget.organizationId,
	]);
	await waitForEditorStatus(page, "2개 조직 선택");

	await clickSemanticOrganizationMiss(page, fixture.outsideWorld, "Control");
	const afterPrimaryMiss = await readMetrics(page);
	assertEqual(
		afterPrimaryMiss.organizationSelectionCount,
		"2",
		"primary-modifier Canvas miss preserves selection",
	);
	assertEqual(
		afterPrimaryMiss.organizationSelectionIds,
		[firstTarget.organizationId, thirdTarget.organizationId]
			.sort((left, right) => left - right)
			.join(","),
		"primary-modifier Canvas miss preserves selection IDs",
	);
	assertProjectUnchanged(
		afterPrimaryMiss,
		before,
		"390px plain, Shift, and primary-miss Canvas organization selection",
	);
	await clickSemanticOrganizationMiss(page, fixture.outsideWorld, null);
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.organizationSelectionCount === "0",
		undefined,
		{ timeout: 10_000 },
	);
	await waitForEditorStatus(page, "Canvas 조직 선택을 해제했습니다");

	await touchSemanticOrganizationTarget(page, secondTarget, [secondTarget.organizationId]);
	await waitForEditorStatus(page, secondTarget.displayName);
	const beforeTouchPan = await readMetrics(page);
	await dragTouchAtSemanticOrganizationTarget(page, secondTarget);
	await page.waitForFunction(
		(expected) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.cameraOffsetX !== expected.x || canvas.dataset.cameraOffsetY !== expected.y
			);
		},
		{ x: beforeTouchPan.cameraOffsetX, y: beforeTouchPan.cameraOffsetY },
		{ timeout: 10_000 },
	);
	const afterTouchPan = await readMetrics(page);
	assertEqual(
		afterTouchPan.organizationSelectionIds,
		String(secondTarget.organizationId),
		"touch drag pans without changing the tapped organization",
	);
	assertProjectUnchanged(afterTouchPan, before, "390px touch tap and pan organization selection");
	await clickSemanticOrganizationMiss(page, fixture.outsideWorld, null);
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.organizationSelectionCount === "0",
		undefined,
		{ timeout: 10_000 },
	);

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	const after = await readMetrics(page);
	assertEqual(
		after.organizationOutlineRequestCount,
		outlineRequestCount,
		"Canvas selection does not recapture the outline",
	);
	assertEqual(
		after.organizationOutlineBindings,
		outlineBindingCount,
		"Canvas selection does not rebind the outline",
	);
	assertEqual(after.organizationSelectionCount, "0", "Canvas selection cleanup");
	assertEqual(after.organizationSelectionIds, "", "Canvas selection ID cleanup");
	assertProjectUnchanged(after, before, "Canvas organization selection complete journey");
	assertExactStaticFabModelIdentity(
		after,
		before,
		"Canvas organization selection complete identity",
	);
	return {
		...after,
		outlineOrganizations: fixture.semanticOrganizationCount,
		outlineRequestCount,
		overlapChooserExercised: false,
		overlapChooserCoverage: "unit-only-no-certified-overlap",
		touchTapAndPan: true,
		responsiveWidths: [1440, 760, 390],
	};
}

async function enterCanvasOrganizationSelectionFromAssembleMenu(page, expectedCount, label) {
	const menu = page.getByTestId("static-fab-assemble-menu");
	await openStaticFabAssembleMenu(page, menu, label);
	await page.waitForFunction(
		(count) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.organizationOutlineStatus === "ready" &&
				canvas.dataset.organizationOutlineSelectionEnabled === "true" &&
				Number(canvas.dataset.organizationOutlineCount) === Number(count)
			);
		},
		expectedCount,
		{ timeout: 30_000 },
	);
	const selectOnCanvas = menu.getByTestId("assemble-select-on-canvas");
	await assertLocatorInsideViewport(page, selectOnCanvas);
	assertIncludes(
		await selectOnCanvas.innerText(),
		"SELECT ON CANVAS",
		`${label} Canvas Select label`,
	);
	const bounds = await selectOnCanvas.boundingBox();
	if (!bounds || bounds.width < 44 || bounds.height < 44) {
		throw new Error(
			`${label} Canvas Select target is smaller than 44px: ${JSON.stringify(bounds)}.`,
		);
	}
	await selectOnCanvas.click();
	await menu.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
		undefined,
		{ timeout: 10_000 },
	);
	const canvas = page.getByTestId("rail-canvas");
	assertIncludes(
		(await canvas.getAttribute("aria-describedby")) ?? "",
		"tilefab-organization-outline-canvas-description",
		`${label} Canvas organization description binding`,
	);
	assertIncludes(
		await page.locator("#tilefab-organization-outline-canvas-description").innerText(),
		"Fab, Bank 또는 Bay",
		`${label} Canvas organization instructions`,
	);
	await waitForEditorStatus(page, "Canvas에서 Fab, Bank 또는 Bay를 선택하세요");
	await page.waitForFunction(
		() =>
			Number(
				document
					.querySelector('[data-testid="rail-canvas"]')
					?.getAttribute("data-organization-outline-visible-rows"),
			) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	return readMetrics(page);
}

async function hoverSemanticOrganizationTarget(page, target) {
	await positionSemanticOrganizationTarget(page, target.world);
	await moveToWorld(page, target.world);
	await page.waitForFunction(
		(organizationId) =>
			document
				.querySelector('[data-testid="rail-canvas"]')
				?.getAttribute("data-organization-outline-hover-id") === String(organizationId),
		target.organizationId,
		{ timeout: 10_000 },
	);
}

async function positionSemanticOrganizationTarget(page, world) {
	await page.evaluate((targetWorld) => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const api = window.__tileFab;
		if (!(canvas instanceof HTMLCanvasElement) || !api?.camera || !api.renderer) {
			throw new Error("Rail Canvas camera is unavailable for semantic organization selection.");
		}
		const camera = api.camera;
		const current = api.renderer.worldToScreen(targetWorld, camera);
		const target = {
			x: canvas.clientWidth / 2,
			y: canvas.clientHeight / 2,
		};
		camera.offsetX += target.x - current.x;
		camera.offsetY += target.y - current.y;
		api.renderer.invalidateStatic();
		api.scheduleRender();
	}, world);
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	const point = await screenPointForWorld(page, world);
	if (
		!box ||
		Math.abs(point.x - (box.x + box.width / 2)) > 2 ||
		Math.abs(point.y - (box.y + box.height / 2)) > 2
	) {
		throw new Error(
			`Could not position semantic organization target ${world.x},${world.y}: ${JSON.stringify({ box, point })}.`,
		);
	}
}

async function clickSemanticOrganizationTarget(page, target, modifier, expectedOrganizationIds) {
	await hoverSemanticOrganizationTarget(page, target);
	const point = await screenPointForWorld(page, target.world);
	if (modifier) await page.keyboard.down(modifier);
	try {
		await page.mouse.click(point.x, point.y);
	} finally {
		if (modifier) await page.keyboard.up(modifier);
	}
	const expectedIds = [...expectedOrganizationIds].sort((left, right) => left - right).join(",");
	await page.waitForFunction(
		(ids) => {
			const app = document.querySelector(".tilefab-app");
			return (
				app?.dataset.organizationSelectionCount ===
					String(ids === "" ? 0 : ids.split(",").length) &&
				app.dataset.organizationSelectionIds === ids
			);
		},
		expectedIds,
		{ timeout: 10_000 },
	);
}

async function clickSemanticOrganizationMiss(page, world, modifier) {
	await centerWorld(page, world);
	const point = await screenPointForWorld(page, world);
	if (modifier) await page.keyboard.down(modifier);
	try {
		await page.mouse.click(point.x, point.y);
	} finally {
		if (modifier) await page.keyboard.up(modifier);
	}
	await page.waitForTimeout(50);
}

async function touchSemanticOrganizationTarget(page, target, expectedOrganizationIds) {
	await centerWorld(page, target.world);
	const point = await screenPointForWorld(page, target.world);
	await dispatchSingleTouchGesture(page, [point]);
	const expectedIds = [...expectedOrganizationIds].sort((left, right) => left - right).join(",");
	await page.waitForFunction(
		(ids) => {
			const app = document.querySelector(".tilefab-app");
			return (
				app?.dataset.organizationSelectionCount ===
					String(ids === "" ? 0 : ids.split(",").length) &&
				app.dataset.organizationSelectionIds === ids
			);
		},
		expectedIds,
		{ timeout: 10_000 },
	);
}

async function dragTouchAtSemanticOrganizationTarget(page, target) {
	await centerWorld(page, target.world);
	const start = await screenPointForWorld(page, target.world);
	await dispatchSingleTouchGesture(
		page,
		Array.from({ length: 5 }, (_, index) => ({
			x: start.x + index * 8,
			y: start.y + index * 4,
		})),
	);
}

async function dispatchSingleTouchGesture(page, points) {
	const first = points[0];
	if (!first) throw new Error("Touch gesture needs at least one point.");
	const session = await page.context().newCDPSession(page);
	const touchPoint = (point) => ({
		x: point.x,
		y: point.y,
		radiusX: 1,
		radiusY: 1,
		force: 1,
		id: 1,
	});
	try {
		await session.send("Emulation.setTouchEmulationEnabled", {
			enabled: true,
			maxTouchPoints: 1,
		});
		await session.send("Input.dispatchTouchEvent", {
			type: "touchStart",
			touchPoints: [touchPoint(first)],
		});
		for (const point of points.slice(1)) {
			await session.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [touchPoint(point)],
			});
		}
		await session.send("Input.dispatchTouchEvent", {
			type: "touchEnd",
			touchPoints: [],
		});
	} finally {
		await session
			.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 })
			.catch(() => undefined);
		await session.detach().catch(() => undefined);
	}
}

async function readSemanticOrganizationSelectionFixture(page) {
	return page.evaluate(() => {
		const documentState = window.__tileFab?.getDocument();
		const records = documentState?.organizations.records;
		const mapBounds = documentState?.map.bounds();
		if (!records || !mapBounds) throw new Error("Semantic organization fixture is unavailable.");
		const recordsById = new Map(records.map((record) => [record.id, record]));
		const childrenByParentId = new Map();
		for (const record of records) {
			for (const parentId of record.parentOrganizationIds ?? []) {
				const children = childrenByParentId.get(parentId);
				if (children) children.push(record);
				else childrenByParentId.set(parentId, [record]);
			}
		}
		const roles = new Map();
		for (const record of records) {
			if (
				record.kind === "AISLE" &&
				(record.parentOrganizationIds ?? []).some(
					(parentId) => recordsById.get(parentId)?.kind === "BAY",
				)
			) {
				roles.set(record.id, "PROCESS_LOOP");
			}
		}
		for (const record of records) {
			if (
				record.kind === "BAY" &&
				(childrenByParentId.get(record.id) ?? []).some(
					(child) => roles.get(child.id) === "PROCESS_LOOP",
				)
			) {
				roles.set(record.id, "BAY");
			}
		}
		for (const record of records) {
			if (
				record.kind === "AREA" &&
				(childrenByParentId.get(record.id) ?? []).some((child) => roles.get(child.id) === "BAY")
			) {
				roles.set(record.id, "BAY_BANK");
			}
		}
		for (const record of records) {
			if (
				record.kind === "AREA" &&
				(childrenByParentId.get(record.id) ?? []).some(
					(child) => roles.get(child.id) === "BAY_BANK",
				)
			) {
				roles.set(record.id, "FAB");
			}
		}

		const includePoint = (bounds, point) =>
			bounds
				? {
						minX: Math.min(bounds.minX, point.x),
						minZ: Math.min(bounds.minZ, point.y),
						maxX: Math.max(bounds.maxX, point.x),
						maxZ: Math.max(bounds.maxZ, point.y),
					}
				: { minX: point.x, minZ: point.y, maxX: point.x, maxZ: point.y };
		const unionBounds = (left, right) => {
			if (!left) return right ? { ...right } : null;
			if (!right) return { ...left };
			return {
				minX: Math.min(left.minX, right.minX),
				minZ: Math.min(left.minZ, right.minZ),
				maxX: Math.max(left.maxX, right.maxX),
				maxZ: Math.max(left.maxZ, right.maxZ),
			};
		};
		const directBoundsById = new Map();
		for (const record of records) {
			let bounds = null;
			for (const edge of record.membership.railEdges) {
				bounds = includePoint(bounds, {
					x: Math.min(edge.from.x, edge.to.x),
					y: Math.min(edge.from.y, edge.to.y),
				});
				bounds = includePoint(bounds, {
					x: Math.max(edge.from.x, edge.to.x) + 1,
					y: Math.max(edge.from.y, edge.to.y) + 1,
				});
			}
			directBoundsById.set(record.id, bounds);
		}
		const effectiveBoundsById = new Map();
		const visiting = new Set();
		const effectiveBounds = (organizationId) => {
			const cached = effectiveBoundsById.get(organizationId);
			if (cached !== undefined) return cached;
			if (visiting.has(organizationId)) throw new Error("Organization fixture contains a cycle.");
			visiting.add(organizationId);
			let bounds = directBoundsById.get(organizationId) ?? null;
			for (const child of childrenByParentId.get(organizationId) ?? []) {
				bounds = unionBounds(bounds, effectiveBounds(child.id));
			}
			visiting.delete(organizationId);
			effectiveBoundsById.set(organizationId, bounds);
			return bounds;
		};
		const semantic = records
			.map((record) => ({
				organizationId: record.id,
				displayName: record.name,
				semanticRole: roles.get(record.id),
				bounds: effectiveBounds(record.id),
			}))
			.filter(
				(candidate) =>
					(candidate.semanticRole === "FAB" ||
						candidate.semanticRole === "BAY_BANK" ||
						candidate.semanticRole === "BAY") &&
					candidate.bounds,
			)
			.sort((left, right) => left.organizationId - right.organizationId);
		const contains = (bounds, point) =>
			point.x >= bounds.minX &&
			point.x <= bounds.maxX &&
			point.y >= bounds.minZ &&
			point.y <= bounds.maxZ;
		const fractions = [0.5, 0.25, 0.75, 0.125, 0.875, 0.375, 0.625];
		const bays = semantic.filter((candidate) => candidate.semanticRole === "BAY");
		const targets = [];
		for (const bay of bays) {
			let world = null;
			for (const xFraction of fractions) {
				for (const zFraction of fractions) {
					const candidate = {
						x: bay.bounds.minX + (bay.bounds.maxX - bay.bounds.minX) * xFraction,
						y: bay.bounds.minZ + (bay.bounds.maxZ - bay.bounds.minZ) * zFraction,
					};
					if (bays.filter((other) => contains(other.bounds, candidate)).length === 1) {
						world = candidate;
						break;
					}
				}
				if (world) break;
			}
			if (world) targets.push({ ...bay, world });
			if (targets.length === 3) break;
		}

		const priority = ["BAY", "BAY_BANK", "FAB"];
		let overlap = null;
		for (let roleIndex = 0; roleIndex < priority.length && !overlap; roleIndex++) {
			const role = priority[roleIndex];
			const peers = semantic.filter((candidate) => candidate.semanticRole === role);
			const higher = semantic.filter((candidate) =>
				priority.slice(0, roleIndex).includes(candidate.semanticRole),
			);
			for (let leftIndex = 0; leftIndex < peers.length && !overlap; leftIndex++) {
				for (let rightIndex = leftIndex + 1; rightIndex < peers.length && !overlap; rightIndex++) {
					const left = peers[leftIndex];
					const right = peers[rightIndex];
					const intersection = {
						minX: Math.max(left.bounds.minX, right.bounds.minX),
						minZ: Math.max(left.bounds.minZ, right.bounds.minZ),
						maxX: Math.min(left.bounds.maxX, right.bounds.maxX),
						maxZ: Math.min(left.bounds.maxZ, right.bounds.maxZ),
					};
					if (
						intersection.maxX - intersection.minX < 1 ||
						intersection.maxZ - intersection.minZ < 1
					) {
						continue;
					}
					for (const xFraction of fractions) {
						for (const zFraction of fractions) {
							const world = {
								x: intersection.minX + (intersection.maxX - intersection.minX) * xFraction,
								y: intersection.minZ + (intersection.maxZ - intersection.minZ) * zFraction,
							};
							const candidates = peers.filter((candidate) => contains(candidate.bounds, world));
							if (
								candidates.length >= 2 &&
								!higher.some((candidate) => contains(candidate.bounds, world))
							) {
								overlap = {
									organizationId: candidates[0].organizationId,
									displayName: candidates[0].displayName,
									semanticRole: role,
									world,
									candidateIds: candidates.map((candidate) => candidate.organizationId),
								};
								break;
							}
						}
						if (overlap) break;
					}
				}
			}
		}

		return {
			semanticOrganizationCount: semantic.length,
			roleCounts: {
				FAB: semantic.filter((candidate) => candidate.semanticRole === "FAB").length,
				BAY_BANK: semantic.filter((candidate) => candidate.semanticRole === "BAY_BANK").length,
				BAY: bays.length,
			},
			targets,
			overlap,
			outsideWorld: { x: mapBounds.maxX + 64, y: mapBounds.maxY + 64 },
		};
	});
}

async function exerciseNewFabProfileWizard(page, before) {
	reportAcceptanceProgress("new-fab-profile:start");
	await page.setViewportSize({ width: 1440, height: 900 });
	const desktop = await openNewFabProfileWizard(page);
	await exerciseNewFabProfileWizardChoices(page, desktop.wizard);
	await assertNewFabProfileWizardFocusTrap(page, desktop.wizard);
	await page.screenshot({
		path: path.join(artifactRoot, "new-fab-profile-review-desktop.png"),
		fullPage: true,
	});

	await desktop.wizard.getByTestId("new-fab-profile-prepare").click();
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="new-fab-profile-wizard"]')
				?.getAttribute("data-preparation") === "preparing",
		undefined,
		{ timeout: 10_000 },
	);
	await page.keyboard.press("Escape");
	await desktop.wizard.waitFor({ state: "hidden" });
	await assertNewFabProfileOpenerFocus(page, "desktop prepare abort");
	await page.waitForTimeout(250);
	assertProjectUnchanged(await readMetrics(page), before, "New Fab aborted preparation");

	const responsive = [];
	for (const viewport of [
		{ width: 760, height: 900, label: "760px" },
		{ width: 390, height: 844, label: "390px" },
	]) {
		responsive.push(await exerciseResponsiveNewFabProfileWizard(page, viewport, before));
	}

	await page.setViewportSize({ width: 1440, height: 900 });
	const creation = await openNewFabProfileWizard(page);
	await navigateDefaultNewFabProfileToReview(page, creation.wizard);
	const preparationStartedAt = performance.now();
	await creation.wizard.getByTestId("new-fab-profile-prepare").click();
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="new-fab-profile-wizard"]')
				?.getAttribute("data-preparation") === "prepared",
		undefined,
		{ timeout: NEW_FAB_PROFILE_PREPARATION_BUDGET_MILLISECONDS },
	);
	const preparationMilliseconds = performance.now() - preparationStartedAt;
	assertAtMost(
		preparationMilliseconds,
		NEW_FAB_PROFILE_PREPARATION_BUDGET_MILLISECONDS,
		"New Fab exact preparation latency",
	);
	assertProjectUnchanged(await readMetrics(page), before, "New Fab prepared source isolation");
	assertEqual(
		await creation.wizard.getAttribute("data-creation"),
		"idle",
		"New Fab prepared creation state",
	);
	await assertNewFabProfileExactEvidence(creation.wizard);
	const create = creation.wizard.getByTestId("new-fab-profile-create");
	await create.waitFor({ state: "visible" });
	await assertLocatorInsideViewport(page, create);
	await page.screenshot({
		path: path.join(artifactRoot, "new-fab-profile-prepared-desktop.png"),
		fullPage: true,
	});

	await create.click();
	const dirtyGuard = page.locator(".tilefab-project-guard");
	await assertNewFabProfileDirtyGuardSuspension(page, creation.wizard, before, "cancel attempt");
	await page.screenshot({
		path: path.join(artifactRoot, "new-fab-profile-dirty-guard-cancel-desktop.png"),
		fullPage: true,
	});
	await dirtyGuard.getByRole("button", { name: "취소", exact: true }).click();
	await dirtyGuard.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => {
			const root = document.querySelector('[data-testid="new-fab-profile-wizard"]');
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				root?.getAttribute("data-step") === "review" &&
				root.getAttribute("data-preparation") === "idle" &&
				root.getAttribute("data-creation") === "failed" &&
				root.getAttribute("data-suspended") === "false" &&
				app?.getAttribute("data-pending-project-action") === "" &&
				document.activeElement === root.querySelector(".tilefab-new-fab-step-heading h2")
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await creation.wizard.getByTestId("new-fab-profile-create").count(),
		0,
		"New Fab dirty-guard cancel revokes prepared CREATE",
	);
	assertIncludes(
		(await creation.wizard.innerText()).toUpperCase(),
		"CREATE FAILED",
		"New Fab dirty-guard cancel feedback",
	);
	assertProjectUnchanged(await readMetrics(page), before, "New Fab dirty-guard cancel isolation");

	const freshPreparationStartedAt = performance.now();
	await creation.wizard.getByTestId("new-fab-profile-prepare").click();
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="new-fab-profile-wizard"]')
				?.getAttribute("data-preparation") === "preparing",
		undefined,
		{ timeout: 10_000 },
	);
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="new-fab-profile-wizard"]')
				?.getAttribute("data-preparation") === "prepared",
		undefined,
		{ timeout: NEW_FAB_PROFILE_PREPARATION_BUDGET_MILLISECONDS },
	);
	const freshPreparationMilliseconds = performance.now() - freshPreparationStartedAt;
	assertAtMost(
		freshPreparationMilliseconds,
		NEW_FAB_PROFILE_PREPARATION_BUDGET_MILLISECONDS,
		"New Fab fresh preparation after dirty-guard cancel latency",
	);
	assertEqual(
		await creation.wizard.getAttribute("data-creation"),
		"idle",
		"New Fab fresh preparation resets failed creation",
	);
	await assertNewFabProfileExactEvidence(creation.wizard);
	await create.waitFor({ state: "visible" });
	assertProjectUnchanged(
		await readMetrics(page),
		before,
		"New Fab fresh preparation source isolation",
	);

	await create.click();
	await assertNewFabProfileDirtyGuardSuspension(page, creation.wizard, before, "discard resume");
	assertEqual(
		await creation.wizard.getAttribute("data-creation"),
		"creating",
		"New Fab discard guard owns one-shot CREATE",
	);
	await page.screenshot({
		path: path.join(artifactRoot, "new-fab-profile-dirty-guard-desktop.png"),
		fullPage: true,
	});
	await dirtyGuard.getByRole("button", { name: "저장하지 않고 계속" }).click();
	await dirtyGuard.waitFor({ state: "hidden" });
	await creation.wizard.waitFor({ state: "hidden" });
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-new-fab-profile-wizard-open"),
		"false",
		"New Fab discard resume closes wizard after activation",
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-pending-project-action"),
		"",
		"New Fab discard resume clears pending action",
	);

	const activated = await waitForWorker(
		page,
		(metrics) =>
			metrics.authoredCells === "11282" &&
			metrics.authoredEdges === "11432" &&
			metrics.physicalPaths === "11478" &&
			metrics.staticFabOrganizations === "63",
		{ timeout: NEW_FAB_PROFILE_PREPARATION_BUDGET_MILLISECONDS },
	);
	assertEqual(activated.projectName, "New OpenFab Fab", "default New Fab project name");
	assertEqual(activated.authoredCells, "11282", "default New Fab authored cell count");
	assertEqual(activated.authoredEdges, "11432", "default New Fab authored edge count");
	assertEqual(activated.staticFabOrganizations, "63", "default New Fab organization record count");
	assertEqual(activated.startupStatus, "ready", "default New Fab startup state");
	assertEqual(activated.startupMirrorFingerprintMatch, "true", "default New Fab mirror identity");
	assertEqual(activated.workerStatus, "ready", "default New Fab Worker state");
	assertEqual(activated.physicalPaths, "11478", "default New Fab physical path count");
	assertEqual(activated.strongComponents, "1", "default New Fab directed network count");
	assertEqual(activated.openTerminals, "0", "default New Fab open terminal count");
	assertEqual(activated.readinessReady, "true", "default New Fab rail authoring readiness");
	assertEqual(activated.workerSimulationReady, "false", "default New Fab simulation gate");
	assertEqual(activated.equipmentGroups, "0", "default New Fab equipment groups");
	assertEqual(activated.equipmentPorts, "0", "default New Fab equipment ports");
	if (!workerIsSettled(activated)) {
		throw new Error("Default New Fab project did not reach an exact startup and mirror ACK.");
	}
	const hierarchy = await readDefaultNewFabOrganizationContract(page);
	assertDefaultNewFabOrganizationContract(hierarchy);
	await page.getByRole("button", { name: "전체 보기" }).click();
	await page.waitForTimeout(100);
	await page.screenshot({
		path: path.join(artifactRoot, "new-fab-default-project-desktop.png"),
		fullPage: true,
	});
	reportAcceptanceProgress("new-fab-profile:pass");
	return {
		...activated,
		preparationMilliseconds,
		freshPreparationMilliseconds,
		responsive,
		hierarchy,
		screenshots: Object.freeze([
			"new-fab-profile-review-desktop.png",
			"new-fab-profile-review-760x900.png",
			"new-fab-profile-review-390x844.png",
			"new-fab-profile-prepared-desktop.png",
			"new-fab-profile-dirty-guard-cancel-desktop.png",
			"new-fab-profile-dirty-guard-desktop.png",
			"new-fab-default-project-desktop.png",
		]),
		dirtyGuardResumeAction: "discard",
		sameRoleOverlapCoverage: "not-exercised-no-public-fixture-claim",
	};
}

async function exerciseBayFlowEdit(page, source) {
	reportAcceptanceProgress("bay-flow-edit:start");
	await page.setViewportSize({ width: 1440, height: 900 });
	const initialWorkerLifecycle = await readBayFlowEditWorkerLifecycle(page);
	const singleSelection = await selectDefaultBayThroughOrganizationBrowser(
		page,
		source,
		DEFAULT_SINGLE_BAY_NAME,
	);
	const menu = page.getByTestId("static-fab-assemble-menu");
	await openStaticFabAssembleMenu(page, menu);
	const selectedBayCommands = menu.getByRole("region", { name: "Selected Bay commands" });
	const singleAlternating = selectedBayCommands.getByTestId(
		"assemble-edit-selected-bay-alternating",
	);
	const singleCoRotating = selectedBayCommands.getByTestId(
		"assemble-edit-selected-bay-co-rotating",
	);
	assertEqual(
		await singleAlternating.isEnabled(),
		false,
		"desktop Single Bay ALTERNATING disabled",
	);
	assertEqual(await singleCoRotating.isEnabled(), false, "desktop Single Bay CO-ROTATING disabled");
	assertEqual(
		await page.getByTestId("bay-flow-edit-dialog").count(),
		0,
		"desktop Single Bay does not open a flow review",
	);
	assertEqual(
		(await readBayFlowEditWorkerLifecycle(page)).started,
		initialWorkerLifecycle.started,
		"desktop Single Bay does not start a flow Worker",
	);
	assertEqual(
		(await readMetrics(page)).organizationSelectionIds,
		singleSelection.selectedBayId,
		"desktop Single Bay exact selection",
	);
	await menu.getByTestId("assemble-browse-organizations").click();
	const { selectedBayId } = await chooseDefaultTwinBayInOpenOrganizationBrowser(page, source);
	const desktopSource = await readMetrics(page);
	assertEqual(
		desktopSource.workerChecksum,
		source.workerChecksum,
		"desktop Bay flow source checksum",
	);
	assertEqual(desktopSource.organizationSelectionIds, selectedBayId, "desktop Twin Bay selection");
	await assertOrganizationBrowseSelectionContext(page, desktopSource, "desktop Twin Bay");
	const desktop = await exerciseCertifiedBayFlowEditJourney(page, {
		label: "desktop",
		selectedBayId,
		source: desktopSource,
		coRotatingScreenshot: "bay-flow-edit-co-rotating-review-desktop.png",
		alternatingScreenshot: "bay-flow-edit-alternating-review-desktop.png",
		responsive: false,
		testEscape: false,
	});

	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	await openStaticFabAssembleMenu(page, menu);
	const browseOrganizations = menu.getByTestId("assemble-browse-organizations");
	await browseOrganizations.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, browseOrganizations);
	await browseOrganizations.click();
	const narrowSelection = await chooseDefaultTwinBayInOpenOrganizationBrowser(page, source);
	assertEqual(narrowSelection.selectedBayId, selectedBayId, "390px Twin Bay selection identity");
	const narrowSource = await readMetrics(page);
	assertEqual(
		narrowSource.workerChecksum,
		desktopSource.workerChecksum,
		"390px Bay flow source checksum",
	);
	await assertAuthoredOrganizationSelectionContext(page, narrowSource, "390px Twin Bay");
	const narrow = await exerciseCertifiedBayFlowEditJourney(page, {
		label: "390px",
		selectedBayId,
		source: narrowSource,
		coRotatingScreenshot: "bay-flow-edit-co-rotating-review-390x844.png",
		alternatingScreenshot: "bay-flow-edit-alternating-review-390x844.png",
		responsive: true,
		testEscape: true,
	});
	assertEqual(
		narrow.targetChecksum,
		desktop.targetChecksum,
		"desktop and 390px deterministic Bay flow target checksum",
	);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	const finalWorkerLifecycle = await readBayFlowEditWorkerLifecycle(page);
	assertEqual(
		finalWorkerLifecycle.started - initialWorkerLifecycle.started,
		5,
		"attached Bay flow Worker start count",
	);
	assertEqual(
		finalWorkerLifecycle.terminated - initialWorkerLifecycle.terminated,
		5,
		"attached Bay flow Worker termination count",
	);
	assertEqual(finalWorkerLifecycle.live, 0, "attached Bay flow Worker live count");
	reportAcceptanceProgress("bay-flow-edit:pass");
	return {
		...narrow.restored,
		selectedBayId,
		sourceChecksum: desktopSource.workerChecksum,
		targetChecksum: desktop.targetChecksum,
		desktopFirstPaintMilliseconds: desktop.firstPaintMilliseconds,
		desktopReverseFirstPaintMilliseconds: desktop.reverseFirstPaintMilliseconds,
		narrowFirstPaintMilliseconds: narrow.firstPaintMilliseconds,
		narrowReverseFirstPaintMilliseconds: narrow.reverseFirstPaintMilliseconds,
		screenshots: [
			"bay-flow-edit-co-rotating-review-desktop.png",
			"bay-flow-edit-alternating-review-desktop.png",
			"bay-flow-edit-co-rotating-review-390x844.png",
			"bay-flow-edit-alternating-review-390x844.png",
		],
	};
}

async function exerciseCertifiedBayFlowEditJourney(
	page,
	{
		label,
		selectedBayId,
		source,
		coRotatingScreenshot,
		alternatingScreenshot,
		responsive,
		testEscape,
	},
) {
	const menu = page.getByTestId("static-fab-assemble-menu");
	await openStaticFabAssembleMenu(page, menu);
	const selectedBayCommands = menu.getByRole("region", { name: "Selected Bay commands" });
	const alternating = selectedBayCommands.getByTestId("assemble-edit-selected-bay-alternating");
	const coRotating = selectedBayCommands.getByTestId("assemble-edit-selected-bay-co-rotating");
	assertEqual(await alternating.count(), 1, `${label} explicit ALTERNATING action count`);
	assertEqual(await coRotating.count(), 1, `${label} explicit CO-ROTATING action count`);
	assertEqual(
		await alternating.getAttribute("data-target-pattern"),
		"alternating",
		`${label} ALTERNATING target binding`,
	);
	assertEqual(
		await coRotating.getAttribute("data-target-pattern"),
		"co-rotating",
		`${label} CO-ROTATING target binding`,
	);
	assertEqual(await alternating.isEnabled(), true, `${label} ALTERNATING availability`);
	assertEqual(await coRotating.isEnabled(), true, `${label} CO-ROTATING availability`);
	assertEqual(
		await selectedBayCommands.getByRole("button", { name: /toggle/i }).count(),
		0,
		`${label} Bay flow does not expose a toggle command`,
	);
	assertIncludes(await alternating.innerText(), "ALTERNATING", `${label} ALTERNATING label`);
	assertIncludes(await coRotating.innerText(), "CO-ROTATING", `${label} CO-ROTATING label`);

	if (responsive) {
		for (const [controlLabel, locator] of [
			["ALTERNATING", alternating],
			["CO-ROTATING", coRotating],
		]) {
			await locator.scrollIntoViewIfNeeded();
			await assertLocatorInsideViewport(page, locator);
			const bounds = await locator.boundingBox();
			if (!bounds || bounds.width < 44 || bounds.height < 44) {
				throw new Error(
					`${label} Bay flow ${controlLabel} target is smaller than 44px: ${JSON.stringify(bounds)}.`,
				);
			}
		}
		assertEqual(
			await menu.evaluate((element) => Math.max(0, element.scrollWidth - element.clientWidth)),
			0,
			`${label} Assemble menu horizontal overflow`,
		);
	}

	if (testEscape) {
		const beforeEscape = await readMetrics(page);
		const cancelledReview = await openCertifiedBayFlowEditReview(page, coRotating, {
			label: `${label} Escape review`,
			selectedBayId,
			source,
			sourceInternalFlowPattern: "alternating",
			targetInternalFlowPattern: "co-rotating",
			responsive,
		});
		await page.keyboard.press("Escape");
		await cancelledReview.dialog.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() =>
				document.activeElement?.getAttribute("data-testid") ===
				"assemble-edit-selected-bay-co-rotating",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await coRotating.evaluate((element) => element === document.activeElement),
			true,
			`${label} Escape restores the explicit target launcher`,
		);
		assertProjectUnchanged(await readMetrics(page), beforeEscape, `${label} canceled flow review`);
		await openStaticFabAssembleMenu(page, menu);
	}

	const review = await openCertifiedBayFlowEditReview(page, coRotating, {
		label,
		selectedBayId,
		source,
		sourceInternalFlowPattern: "alternating",
		targetInternalFlowPattern: "co-rotating",
		responsive,
	});
	await page.screenshot({
		path: path.join(artifactRoot, coRotatingScreenshot),
		fullPage: true,
	});
	const beforeApply = await readMetrics(page);
	await review.apply.click();
	await review.dialog.waitFor({ state: "hidden" });
	const applied = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(beforeApply.workerTargetSequence) + 1 &&
			metrics.organizationSelectionIds === selectedBayId,
		{ timeout: 30_000 },
	);
	assertNotEqual(applied.workerChecksum, beforeApply.workerChecksum, `${label} target checksum`);
	assertBayFlowCountIdentity(applied, beforeApply, `${label} flow replacement`);
	assertEqual(applied.organizationSelectionCount, "1", `${label} Bay selection count`);
	assertEqual(applied.organizationSelectionIds, selectedBayId, `${label} Bay selection identity`);
	await assertAuthoredOrganizationSelectionContext(page, applied, `${label} Apply`);
	assertEqual(applied.workerStatus, "ready", `${label} mirror status`);
	assertEqual(applied.modelSyncPending, "false", `${label} model sync status`);
	assertEqual(applied.workerChecksum, applied.modelChecksum, `${label} mirror/model checksum`);
	assertEqual(applied.workerSimulationReady, "false", `${label} simulation gate`);
	assertEqual(applied.bayFlowEditSnapshotStatus, "committed", `${label} commit telemetry`);
	assertEqual(await menu.isVisible(), false, `${label} Apply closes Assemble menu`);
	assertEqual(
		await page.getByTestId("rail-canvas").evaluate((element) => element === document.activeElement),
		true,
		`${label} Apply returns focus to Canvas`,
	);

	await page.getByRole("button", { name: "실행 취소" }).click();
	const undone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(applied.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeApply.workerChecksum &&
			metrics.organizationSelectionIds === selectedBayId,
		{ timeout: 30_000 },
	);
	assertBayFlowExactSource(undone, beforeApply, `${label} undo`);
	await assertAuthoredOrganizationSelectionContext(page, undone, `${label} undo`);
	await dispatchBayFlowRedo(page, responsive, undone, `${label} redo`);
	const redone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(undone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === applied.workerChecksum &&
			metrics.organizationSelectionIds === selectedBayId,
		{ timeout: 30_000 },
	);
	assertBayFlowCountIdentity(redone, applied, `${label} redo`);
	assertEqual(
		redone.modelTopologyFingerprint,
		applied.modelTopologyFingerprint,
		`${label} redo topology`,
	);
	assertEqual(
		redone.modelPhysicalFingerprint,
		redone.workerPhysicalFingerprint,
		`${label} redo mirror/model physical identity`,
	);
	assertEqual(redone.workerSimulationReady, "false", `${label} redo simulation gate`);
	await assertAuthoredOrganizationSelectionContext(page, redone, `${label} redo`);

	await openStaticFabAssembleMenu(page, menu);
	assertEqual(await alternating.isEnabled(), true, `${label} reverse ALTERNATING availability`);
	const reverseReview = await openCertifiedBayFlowEditReview(page, alternating, {
		label: `${label} reverse`,
		selectedBayId,
		source: redone,
		sourceInternalFlowPattern: "co-rotating",
		targetInternalFlowPattern: "alternating",
		responsive,
	});
	await page.screenshot({
		path: path.join(artifactRoot, alternatingScreenshot),
		fullPage: true,
	});
	const beforeReverseApply = await readMetrics(page);
	assertEqual(
		beforeReverseApply.workerChecksum,
		applied.workerChecksum,
		`${label} reverse source checksum`,
	);
	await reverseReview.apply.click();
	await reverseReview.dialog.waitFor({ state: "hidden" });
	const restored = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) ===
				Number(beforeReverseApply.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeApply.workerChecksum &&
			metrics.organizationSelectionIds === selectedBayId,
		{ timeout: 30_000 },
	);
	assertBayFlowExactSource(restored, beforeApply, `${label} reverse Apply source restore`);
	await assertAuthoredOrganizationSelectionContext(page, restored, `${label} reverse Apply`);
	assertEqual(restored.bayFlowEditSnapshotStatus, "committed", `${label} reverse commit telemetry`);
	assertEqual(await menu.isVisible(), false, `${label} reverse Apply closes Assemble menu`);
	assertEqual(
		await page.getByTestId("rail-canvas").evaluate((element) => element === document.activeElement),
		true,
		`${label} reverse Apply returns focus to Canvas`,
	);
	await page.getByRole("button", { name: "실행 취소" }).click();
	const reverseUndone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(restored.workerTargetSequence) + 1 &&
			metrics.workerChecksum === applied.workerChecksum &&
			metrics.organizationSelectionIds === selectedBayId,
		{ timeout: 30_000 },
	);
	assertBayFlowCountIdentity(reverseUndone, applied, `${label} reverse undo`);
	await assertAuthoredOrganizationSelectionContext(page, reverseUndone, `${label} reverse undo`);
	assertEqual(
		reverseUndone.modelTopologyFingerprint,
		applied.modelTopologyFingerprint,
		`${label} reverse undo topology`,
	);
	assertEqual(
		reverseUndone.modelPhysicalFingerprint,
		reverseUndone.workerPhysicalFingerprint,
		`${label} reverse undo mirror/model physical identity`,
	);
	assertEqual(
		reverseUndone.workerSimulationReady,
		"false",
		`${label} reverse undo simulation gate`,
	);
	await dispatchBayFlowRedo(page, responsive, reverseUndone, `${label} reverse redo`);
	const reverseRedone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(reverseUndone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeApply.workerChecksum &&
			metrics.organizationSelectionIds === selectedBayId,
		{ timeout: 30_000 },
	);
	assertBayFlowExactSource(reverseRedone, beforeApply, `${label} reverse redo source restore`);
	await assertAuthoredOrganizationSelectionContext(page, reverseRedone, `${label} reverse redo`);
	return {
		restored: reverseRedone,
		targetChecksum: applied.workerChecksum,
		firstPaintMilliseconds: review.firstPaintMilliseconds,
		reverseFirstPaintMilliseconds: reverseReview.firstPaintMilliseconds,
	};
}

async function dispatchBayFlowRedo(page, responsive, source, label) {
	assertEqual(source.historyCanRedo, "true", `${label} history availability`);
	if (!responsive) {
		await page.getByRole("button", { name: "다시 실행" }).click();
		return;
	}
	const redo = page.getByLabel("다시 실행", { exact: true });
	assertEqual(await redo.isHidden(), true, `${label} compact toolbar policy`);
	const canvas = page.getByTestId("rail-canvas");
	await canvas.focus();
	assertEqual(
		await canvas.evaluate((element) => element === document.activeElement),
		true,
		`${label} Canvas shortcut focus`,
	);
	await page.keyboard.press("Meta+Shift+z");
}

async function openCertifiedBayFlowEditReview(
	page,
	target,
	{
		label,
		selectedBayId,
		source,
		sourceInternalFlowPattern,
		targetInternalFlowPattern,
		responsive,
	},
) {
	const root = page.getByTestId("tilefab-app");
	const sourceFlowLabel = staticFabBayFlowLabel(sourceInternalFlowPattern);
	const targetFlowLabel = staticFabBayFlowLabel(targetInternalFlowPattern);
	const workerLifecycleBefore = await readBayFlowEditWorkerLifecycle(page);
	await target.click();
	const dialog = page.getByTestId("bay-flow-edit-dialog");
	await dialog.waitFor({ state: "visible" });
	assertEqual(await dialog.getAttribute("data-action"), "EDIT_FLOW", `${label} dialog action`);
	assertEqual(
		await dialog.getAttribute("data-target-pattern"),
		targetInternalFlowPattern,
		`${label} explicit target`,
	);
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "bay-flow-edit-cancel",
		undefined,
		{ timeout: 10_000 },
	);
	await page.waitForFunction(
		() => {
			const candidate = document.querySelector('[data-testid="bay-flow-edit-dialog"]');
			return ["ready", "rejected"].includes(candidate?.getAttribute("data-phase") ?? "");
		},
		undefined,
		{ timeout: 30_000 },
	);
	await page.waitForFunction(
		() => globalThis.__openfabAcceptanceWorkerStarts?.staticFabBayFlowEditLive === 0,
		undefined,
		{ timeout: 10_000 },
	);
	const workerLifecycleAfter = await readBayFlowEditWorkerLifecycle(page);
	assertEqual(
		workerLifecycleAfter.started,
		workerLifecycleBefore.started + 1,
		`${label} disposable Worker start`,
	);
	assertEqual(
		workerLifecycleAfter.terminated,
		workerLifecycleBefore.terminated + 1,
		`${label} disposable Worker termination`,
	);
	assertEqual(workerLifecycleAfter.live, 0, `${label} disposable Worker live count`);
	if ((await dialog.getAttribute("data-phase")) !== "ready") {
		throw new Error(`${label} Bay flow edit was rejected: ${await dialog.textContent()}`);
	}
	assertEqual(
		await page
			.getByTestId("bay-flow-edit-cancel")
			.evaluate((element) => element === document.activeElement),
		true,
		`${label} Worker result preserves Cancel focus`,
	);
	const modalIsolation = await page.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const backgroundRoot = app?.closest("#root");
		return {
			inert: backgroundRoot instanceof HTMLElement ? backgroundRoot.inert : false,
			ariaHidden: backgroundRoot?.getAttribute("aria-hidden") ?? null,
		};
	});
	assertEqual(modalIsolation.inert, true, `${label} dialog background inert`);
	assertEqual(modalIsolation.ariaHidden, "true", `${label} dialog background aria hidden`);
	assertEqual(
		await root.getAttribute("data-bay-flow-edit-command-phase"),
		"ready",
		`${label} command phase`,
	);
	assertEqual(
		await root.getAttribute("data-bay-flow-edit-command-target"),
		targetInternalFlowPattern,
		`${label} command target`,
	);
	assertEqual(
		await root.getAttribute("data-bay-flow-edit-command-id"),
		selectedBayId,
		`${label} command Bay identity`,
	);
	assertEqual(
		await root.getAttribute("data-bay-flow-edit-snapshot-status"),
		"certified",
		`${label} exact Worker certification`,
	);
	assertEqual(
		await root.getAttribute("data-bay-flow-edit-snapshot-source-cells"),
		source.authoredCells,
		`${label} mirror-owned source size`,
	);
	const firstPaintAttribute = await root.getAttribute("data-bay-flow-edit-first-paint-ms");
	const handoffAttribute = await root.getAttribute("data-bay-flow-edit-snapshot-handoff-ms");
	assertNotEqual(firstPaintAttribute, null, `${label} first-paint telemetry presence`);
	assertNotEqual(handoffAttribute, null, `${label} snapshot-handoff telemetry presence`);
	assertNotEqual(firstPaintAttribute, "", `${label} first-paint telemetry`);
	assertNotEqual(handoffAttribute, "", `${label} snapshot-handoff telemetry`);
	const firstPaintMilliseconds = Number(firstPaintAttribute);
	const snapshotHandoffMilliseconds = Number(handoffAttribute);
	assertAtMost(firstPaintMilliseconds, 100, `${label} dialog first paint`);
	assertAtLeast(
		snapshotHandoffMilliseconds,
		firstPaintMilliseconds,
		`${label} snapshot starts only after dialog first paint`,
	);
	for (const [timingLabel, attribute, budgetMilliseconds] of [
		[
			"hydration",
			"data-bay-flow-edit-hydration-ms",
			ATTACHED_BAY_FLOW_HYDRATION_BUDGET_MILLISECONDS,
		],
		[
			"Worker round trip",
			"data-bay-flow-edit-worker-round-trip-ms",
			ATTACHED_BAY_FLOW_WORKER_BUDGET_MILLISECONDS,
		],
		[
			"response validation",
			"data-bay-flow-edit-response-validation-ms",
			ATTACHED_BAY_FLOW_VALIDATION_BUDGET_MILLISECONDS,
		],
		[
			"plan adoption",
			"data-bay-flow-edit-adoption-ms",
			ATTACHED_BAY_FLOW_ADOPTION_BUDGET_MILLISECONDS,
		],
	]) {
		const value = await root.getAttribute(attribute);
		assertNotEqual(value, null, `${label} ${timingLabel} telemetry presence`);
		assertNotEqual(value, "", `${label} ${timingLabel} telemetry`);
		assertAtLeast(Number(value), 0, `${label} ${timingLabel} timing`);
		assertAtMost(Number(value), budgetMilliseconds, `${label} ${timingLabel} budget`);
	}
	const text = (await dialog.textContent()) ?? "";
	assertIncludes(
		text,
		`${sourceFlowLabel} → ${targetFlowLabel}`,
		`${label} exact replacement review`,
	);
	assertIncludes(text, "FIXED", `${label} fixed authored evidence`);
	assertIncludes(text, "external gateway", `${label} fixed gateway statement`);
	assertIncludes(text, "FIXED CONNECTOR", `${label} fixed connector evidence`);
	assertIncludes(text, "EXACT · SOURCE-BOUND", `${label} source-bound certification`);
	assertIncludes(text, "Source and result counts are equal", `${label} exact count evidence`);
	assertIncludes(text, "zero open", `${label} closed topology evidence`);
	const connectorEvidence = dialog
		.locator(".tilefab-semantic-bay-bounded-details p")
		.filter({ hasText: "FIXED CONNECTOR" });
	assertEqual(await connectorEvidence.count(), 1, `${label} fixed connector row count`);
	const connectorText = (await connectorEvidence.textContent()) ?? "";
	if (connectorText.includes("NONE")) {
		throw new Error(`${label} attached Twin Bay did not expose its fixed gateway route.`);
	}
	assertIncludes(connectorText, ":", `${label} fixed gateway directed-edge keys`);
	await connectorEvidence.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, connectorEvidence);
	assertEqual(
		await dialog.getByRole("region", { name: "Exact flow replacement review" }).isVisible(),
		true,
		`${label} exact review visibility`,
	);
	assertEqual(
		await dialog.getByRole("region", { name: "Worker topology evidence" }).isVisible(),
		true,
		`${label} Worker evidence visibility`,
	);
	const cancel = page.getByTestId("bay-flow-edit-cancel");
	const apply = page.getByTestId("bay-flow-edit-apply");
	if (responsive) await assertNarrowBayFlowDialogLayout(page, dialog, cancel, apply, label);
	await connectorEvidence.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, connectorEvidence);
	return { dialog, cancel, apply, firstPaintMilliseconds };
}

async function assertNarrowBayFlowDialogLayout(page, dialog, cancel, apply, label) {
	for (const [controlLabel, locator] of [
		["dialog", dialog],
		["Cancel", cancel],
		["Apply", apply],
	]) {
		await assertLocatorInsideViewport(page, locator);
		if (controlLabel === "dialog") continue;
		const bounds = await locator.boundingBox();
		if (!bounds || bounds.width < 44 || bounds.height < 44) {
			throw new Error(
				`${label} Bay flow ${controlLabel} target is smaller than 44px: ${JSON.stringify(bounds)}.`,
			);
		}
	}
	assertEqual(
		await dialog.evaluate((element) => Math.max(0, element.scrollWidth - element.clientWidth)),
		0,
		`${label} dialog horizontal overflow`,
	);
	assertEqual(
		await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)),
		0,
		`${label} page horizontal overflow`,
	);
	const frameBefore = await dialog.evaluate((element) => {
		const header = element.querySelector(":scope > header");
		const workspace = element.querySelector(".tilefab-semantic-bay-workspace");
		const footer = element.querySelector(":scope > footer");
		if (
			!(header instanceof HTMLElement) ||
			!(workspace instanceof HTMLElement) ||
			!(footer instanceof HTMLElement)
		) {
			throw new Error("Bay flow dialog frame is incomplete.");
		}
		const headerRect = header.getBoundingClientRect();
		const footerRect = footer.getBoundingClientRect();
		return {
			headerTop: Math.round(headerRect.top),
			footerBottom: Math.round(footerRect.bottom),
			workspaceOverflow: workspace.scrollHeight - workspace.clientHeight,
			dialogOverflow: getComputedStyle(element).overflow,
			workspaceOverflowY: getComputedStyle(workspace).overflowY,
		};
	});
	assertEqual(frameBefore.dialogOverflow, "hidden", `${label} fixed dialog frame overflow`);
	assertEqual(frameBefore.workspaceOverflowY, "auto", `${label} internally scrolling review body`);
	assertAtLeast(frameBefore.workspaceOverflow, 0, `${label} bounded review body overflow`);
	await dialog.locator(".tilefab-semantic-bay-workspace").evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	const frameAfter = await dialog.evaluate((element) => {
		const header = element.querySelector(":scope > header");
		const footer = element.querySelector(":scope > footer");
		if (!(header instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
			throw new Error("Bay flow dialog frame is incomplete.");
		}
		return {
			headerTop: Math.round(header.getBoundingClientRect().top),
			footerBottom: Math.round(footer.getBoundingClientRect().bottom),
		};
	});
	assertEqual(frameAfter.headerTop, frameBefore.headerTop, `${label} fixed dialog header`);
	assertEqual(frameAfter.footerBottom, frameBefore.footerBottom, `${label} fixed dialog footer`);
	await cancel.focus();
	await page.keyboard.press("Shift+Tab");
	assertEqual(
		await apply.evaluate((element) => element === document.activeElement),
		true,
		`${label} focus trap wraps backward to Apply`,
	);
	await page.keyboard.press("Tab");
	assertEqual(
		await cancel.evaluate((element) => element === document.activeElement),
		true,
		`${label} focus trap wraps forward to Cancel`,
	);
}

function assertBayFlowCountIdentity(actual, expected, label) {
	for (const key of [
		"authoredCells",
		"authoredEdges",
		"physicalPaths",
		"staticFabOrganizations",
		"equipmentGroups",
		"equipmentPorts",
		"strongComponents",
		"openTerminals",
		"workerCells",
		"workerEdges",
		"workerOrganizations",
		"workerPhysicalPaths",
	]) {
		assertEqual(actual[key], expected[key], `${label} ${key}`);
	}
}

function assertBayFlowExactSource(actual, expected, label) {
	assertBayFlowCountIdentity(actual, expected, label);
	assertEqual(actual.workerChecksum, expected.workerChecksum, `${label} authored checksum`);
	assertEqual(actual.modelChecksum, expected.modelChecksum, `${label} model checksum`);
	assertEqual(
		actual.modelPhysicalFingerprint,
		actual.workerPhysicalFingerprint,
		`${label} mirror/model physical identity`,
	);
	assertEqual(
		actual.modelTopologyFingerprint,
		expected.modelTopologyFingerprint,
		`${label} topology fingerprint`,
	);
	assertEqual(
		actual.modelReadinessFingerprint,
		expected.modelReadinessFingerprint,
		`${label} readiness fingerprint`,
	);
	assertEqual(
		actual.organizationSelectionIds,
		expected.organizationSelectionIds,
		`${label} selection`,
	);
	assertEqual(actual.workerStatus, "ready", `${label} mirror status`);
	assertEqual(actual.modelSyncPending, "false", `${label} model sync status`);
	assertEqual(actual.workerSimulationReady, "false", `${label} simulation gate`);
}

async function assertAuthoredOrganizationSelectionContext(page, metrics, label) {
	assertEqual(metrics.areaSelectionProvenance, "organization", `${label} selection provenance`);
	assertEqual(metrics.staticFabHierarchyRequested, "false", `${label} legacy hierarchy request`);
	assertEqual(
		await page.getByTestId("static-fab-hierarchy-scope").count(),
		0,
		`${label} legacy inferred hierarchy panel`,
	);
}

async function assertOrganizationBrowseSelectionContext(page, metrics, label) {
	assertEqual(
		metrics.areaSelectionProvenance,
		"",
		`${label} browse selection remains unmaterialized`,
	);
	assertEqual(metrics.staticFabHierarchyRequested, "false", `${label} legacy hierarchy request`);
	assertEqual(
		await page.getByTestId("static-fab-hierarchy-scope").count(),
		0,
		`${label} legacy inferred hierarchy panel`,
	);
}

function staticFabBayFlowLabel(pattern) {
	if (pattern === "alternating") return "ALTERNATING";
	if (pattern === "co-rotating") return "CO-ROTATING";
	throw new Error(`Unsupported Bay flow acceptance pattern: ${String(pattern)}.`);
}

async function readBayFlowEditWorkerLifecycle(page) {
	return page.evaluate(() => {
		const starts = globalThis.__openfabAcceptanceWorkerStarts;
		return {
			started: starts?.staticFabBayFlowEdit ?? 0,
			terminated: starts?.staticFabBayFlowEditTerminated ?? 0,
			live: starts?.staticFabBayFlowEditLive ?? 0,
		};
	});
}

async function readWorkerLifetime(page) {
	return page.evaluate(() => {
		const starts = globalThis.__openfabAcceptanceWorkerStarts;
		return {
			workerTotal: starts?.workerTotal ?? 0,
			workerTerminated: starts?.workerTerminated ?? 0,
			workerLive: starts?.workerLive ?? 0,
			workerLiveUrls: { ...(starts?.workerLiveUrls ?? {}) },
		};
	});
}

async function exerciseEditorV1RetainedHeap(page) {
	const beforeProject = await readMetrics(page);
	const blueprintLibraryToggle = page.getByTestId("rail-blueprint-library-toggle");
	if ((await blueprintLibraryToggle.getAttribute("aria-pressed")) === "true") {
		await blueprintLibraryToggle.click();
		await page.getByTestId("blueprint-library").waitFor({ state: "hidden" });
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	const session = await page.context().newCDPSession(page);
	try {
		await cycleEditorV1UiOnlySurfaces(page, 4);
		const before = await collectGarbageAndReadHeap(page, session);
		const hostResidentBytesBefore = await readDescendantResidentBytes(process.pid);
		await cycleEditorV1UiOnlySurfaces(page, 20);
		const after = await collectGarbageAndReadHeap(page, session);
		const hostResidentBytesAfter = await readDescendantResidentBytes(process.pid);
		const retained = Object.freeze({
			iterations: 20,
			usedJSHeapSizeBefore: before.usedSize,
			usedJSHeapSizeAfter: after.usedSize,
			usedJSHeapSizeDelta: Math.max(0, after.usedSize - before.usedSize),
			embedderHeapBefore: before.embedderHeapUsedSize,
			embedderHeapAfter: after.embedderHeapUsedSize,
			embedderHeapDelta: Math.max(0, after.embedderHeapUsedSize - before.embedderHeapUsedSize),
			backingStorageBefore: before.backingStorageSize,
			backingStorageAfter: after.backingStorageSize,
			backingStorageDelta: Math.max(0, after.backingStorageSize - before.backingStorageSize),
			hostResidentBytesBefore,
			hostResidentBytesAfter,
			hostResidentBytesDelta: Math.max(0, hostResidentBytesAfter - hostResidentBytesBefore),
		});
		assertAtLeast(retained.usedJSHeapSizeBefore, 1, "Editor v1 retained JS heap baseline");
		assertAtMost(
			retained.usedJSHeapSizeDelta,
			EDITOR_V1_RETAINED_HEAP_BUDGET_BYTES,
			"Editor v1 retained JS heap growth",
		);
		assertAtMost(
			retained.embedderHeapDelta,
			EDITOR_V1_RETAINED_HEAP_BUDGET_BYTES,
			"Editor v1 retained embedder heap growth",
		);
		assertAtMost(
			retained.backingStorageDelta,
			EDITOR_V1_RETAINED_HEAP_BUDGET_BYTES,
			"Editor v1 retained backing storage growth",
		);
		assertAtMost(
			retained.hostResidentBytesDelta,
			EDITOR_V1_HOST_RSS_GROWTH_BUDGET_BYTES,
			"Editor v1 host process-tree RSS growth",
		);
		assertProjectUnchanged(
			await readMetrics(page),
			beforeProject,
			"Editor v1 retained heap UI-only cycle",
		);
		return retained;
	} finally {
		await session.detach();
	}
}

async function cycleEditorV1UiOnlySurfaces(page, iterations) {
	const canvas = page.getByTestId("rail-canvas");
	const commandHelp = page.getByTestId("editor-command-help");
	const projectTrigger = page.locator(".tilefab-project-trigger");
	const projectMenu = page.locator("#tilefab-project-menu");
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		await canvas.focus();
		await page.keyboard.press("F1");
		await commandHelp.waitFor({ state: "visible" });
		await page.keyboard.press("Escape");
		await commandHelp.waitFor({ state: "hidden" });
		await projectTrigger.click();
		await projectMenu.waitFor({ state: "visible" });
		await page.keyboard.press("Escape");
		await projectMenu.waitFor({ state: "hidden" });
	}
}

async function collectGarbageAndReadHeap(page, session) {
	await session.send("HeapProfiler.collectGarbage");
	await page.waitForTimeout(100);
	const usage = await session.send("Runtime.getHeapUsage");
	return {
		usedSize: Number(usage.usedSize ?? 0),
		embedderHeapUsedSize: Number(usage.embedderHeapUsedSize ?? 0),
		backingStorageSize: Number(usage.backingStorageSize ?? 0),
	};
}

async function readDescendantResidentBytes(rootProcessId) {
	const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid=,rss="], {
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
	});
	const processes = stdout
		.split("\n")
		.map((line) => line.trim().split(/\s+/, 3).map(Number))
		.filter(
			([processId, parentProcessId, residentKilobytes]) =>
				Number.isSafeInteger(processId) &&
				Number.isSafeInteger(parentProcessId) &&
				Number.isFinite(residentKilobytes),
		)
		.map(([processId, parentProcessId, residentKilobytes]) => ({
			processId,
			parentProcessId,
			residentKilobytes,
		}));
	const descendants = new Set([rootProcessId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const candidate of processes) {
			if (descendants.has(candidate.processId) || !descendants.has(candidate.parentProcessId)) {
				continue;
			}
			descendants.add(candidate.processId);
			changed = true;
		}
	}
	return (
		processes
			.filter((candidate) => descendants.has(candidate.processId))
			.reduce((total, candidate) => total + candidate.residentKilobytes, 0) * 1024
	);
}

async function selectDefaultTwinBayThroughOrganizationBrowser(page, source) {
	return selectDefaultBayThroughOrganizationBrowser(page, source, DEFAULT_TWIN_BAY_NAME);
}

async function selectDefaultBayThroughOrganizationBrowser(page, source, organizationName) {
	await activateEditorActivity(page, "assemble");
	const organizationLauncher = page.getByRole("button", {
		name: `FAB 조직 (${source.staticFabOrganizations})`,
		exact: true,
	});
	await organizationLauncher.click();
	return chooseNamedBayInOpenOrganizationBrowser(page, source, organizationName);
}

async function chooseDefaultTwinBayInOpenOrganizationBrowser(page, source) {
	return chooseNamedBayInOpenOrganizationBrowser(page, source, DEFAULT_TWIN_BAY_NAME);
}

async function chooseNamedBayInOpenOrganizationBrowser(page, source, organizationName) {
	const organizationLibrary = page.getByTestId("static-fab-organization-library");
	await organizationLibrary.waitFor({ state: "visible" });
	await organizationLibrary
		.getByRole("tab", { name: `ALL ${source.staticFabOrganizations}` })
		.click();
	await organizationLibrary.getByRole("textbox", { name: "저장된 FAB 조직 검색" }).fill("");
	const bayOption = organizationLibrary.locator(
		`[role="option"][data-organization-name="${organizationName}"]`,
	);
	await bayOption.waitFor({ state: "visible" });
	await bayOption.click();
	await organizationLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-organization-selection-count") === "1",
		undefined,
		{ timeout: 10_000 },
	);
	const selectedBayId = await page
		.getByTestId("tilefab-app")
		.getAttribute("data-organization-selection-ids");
	if (!selectedBayId) throw new Error("Semantic Bay acceptance selection has no organization id.");
	return { organizationLibrary, bayOption, selectedBayId };
}

async function visibleStaticFabAssembleLauncher(page) {
	const headerLauncher = page.locator('.tilefab-commands button[aria-label="FAB 조립"]');
	if (await headerLauncher.isVisible().catch(() => false)) return headerLauncher;
	const activityLauncher = page.getByTestId("editor-activity-assemble");
	await activityLauncher.waitFor({ state: "visible" });
	return activityLauncher;
}

async function waitForStaticFabAssembleLauncherFocus(page) {
	await page.waitForFunction(
		() => {
			const header = document.querySelector('.tilefab-commands button[aria-label="FAB 조립"]');
			const activity = document.querySelector('[data-testid="editor-activity-assemble"]');
			const visibleHeader = header instanceof HTMLElement && header.offsetParent !== null;
			return document.activeElement === (visibleHeader ? header : activity);
		},
		undefined,
		{ timeout: 10_000 },
	);
}

async function openStaticFabAssembleMenu(page, menu, label = "Assemble") {
	if (await menu.isVisible().catch(() => false)) return;
	const launcher = await visibleStaticFabAssembleLauncher(page);
	const launcherBounds = await launcher.boundingBox();
	const minimumTarget =
		(await launcher.getAttribute("data-testid")) === "editor-activity-assemble" ? 44 : 34;
	if (
		!launcherBounds ||
		launcherBounds.width < minimumTarget ||
		launcherBounds.height < minimumTarget
	) {
		throw new Error(`${label} Assemble launcher is too small: ${JSON.stringify(launcherBounds)}.`);
	}
	await launcher.click();
	await menu.waitFor({ state: "visible" });
}

async function exerciseSemanticBayMutation(page, source) {
	reportAcceptanceProgress("semantic-bay-mutation:start");
	await page.setViewportSize({ width: 1440, height: 900 });
	const { organizationLibrary, bayOption, selectedBayId } =
		await selectDefaultTwinBayThroughOrganizationBrowser(page, source);

	const menu = page.getByTestId("static-fab-assemble-menu");
	const openMenu = async () => openStaticFabAssembleMenu(page, menu, "semantic Bay");
	await openMenu();
	const disconnect = menu.getByTestId("assemble-disconnect-selected-bay");
	const remove = menu.getByTestId("assemble-delete-selected-bay");
	assertEqual(await disconnect.isEnabled(), true, "semantic Bay Disconnect availability");
	assertEqual(await remove.isEnabled(), true, "semantic Bay attached Delete availability");
	assertIncludes(
		await menu.getByTestId("assemble-disconnect-status").innerText(),
		"폐회로",
		"semantic Bay Disconnect visible review status",
	);

	const beforeCancel = await readMetrics(page);
	await disconnect.click();
	let dialog = page.getByTestId("semantic-bay-command-dialog");
	await dialog.waitFor({ state: "visible" });
	assertEqual(await dialog.getAttribute("data-action"), "DISCONNECT", "Disconnect dialog action");
	assertEqual(
		await page
			.getByTestId("semantic-bay-command-cancel")
			.evaluate((element) => element === document.activeElement),
		true,
		"Disconnect dialog initial cancel focus",
	);
	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-semantic-bay-snapshot-status") === "requesting",
		undefined,
		{ polling: 1, timeout: 10_000 },
	);
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() =>
			document.activeElement?.getAttribute("data-testid") === "assemble-disconnect-selected-bay",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-semantic-bay-snapshot-status"),
		"cancelled",
		"Disconnect cancellation terminates in-flight mirror snapshot capture",
	);
	assertProjectUnchanged(await readMetrics(page), beforeCancel, "semantic Bay canceled analysis");

	await page.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-organization-outline-status") === "ready",
		undefined,
		{ timeout: 30_000 },
	);
	const canvasRenderSamplesBeforeReview = await waitForRailCanvasRenderQuiescence(
		page,
		"semantic Bay review source",
	);
	await disconnect.click();
	dialog = page.getByTestId("semantic-bay-command-dialog");
	await dialog.waitFor({ state: "visible" });
	await page.waitForFunction(
		() => {
			const candidate = document.querySelector('[data-testid="semantic-bay-command-dialog"]');
			return ["ready", "rejected"].includes(candidate?.getAttribute("data-phase") ?? "");
		},
		undefined,
		{ timeout: 30_000 },
	);
	if ((await dialog.getAttribute("data-phase")) !== "ready") {
		throw new Error(`Semantic Bay Disconnect was rejected: ${await dialog.textContent()}`);
	}
	const modalIsolation = await page.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const backgroundRoot = app?.closest("#root");
		return {
			inert: backgroundRoot instanceof HTMLElement ? backgroundRoot.inert : false,
			ariaHidden: backgroundRoot?.getAttribute("aria-hidden") ?? null,
			activeTestId: document.activeElement?.getAttribute("data-testid") ?? null,
		};
	});
	assertEqual(modalIsolation.inert, true, "semantic Bay dialog background inert");
	assertEqual(modalIsolation.ariaHidden, "true", "semantic Bay dialog background aria hidden");
	assertEqual(
		modalIsolation.activeTestId,
		"semantic-bay-command-cancel",
		"Worker result does not steal semantic Bay dialog focus",
	);
	const root = page.getByTestId("tilefab-app");
	assertEqual(
		await root.getAttribute("data-semantic-bay-snapshot-status"),
		"certified",
		"semantic Bay exact Worker status",
	);
	assertEqual(
		await root.getAttribute("data-semantic-bay-snapshot-source-cells"),
		source.authoredCells,
		"semantic Bay mirror-owned snapshot source size",
	);
	assertAtMost(
		Number(await root.getAttribute("data-semantic-bay-first-paint-ms")),
		100,
		"semantic Bay modal first paint",
	);
	assertEqual(
		await readRailCanvasRenderSamples(page),
		canvasRenderSamplesBeforeReview,
		"semantic Bay review does not repaint the unchanged Rail Canvas",
	);
	assertAtLeast(
		Number(await root.getAttribute("data-semantic-bay-snapshot-handoff-ms")),
		0,
		"semantic Bay deferred snapshot handoff",
	);
	assertIncludes(
		(await dialog.textContent()) ?? "",
		"All source and result components are independently closed",
		"semantic Bay exact closed-component evidence",
	);
	assertIncludes(
		(await dialog.textContent()) ?? "",
		"PRESERVED",
		"semantic Bay Disconnect preserved review",
	);
	assertIncludes(
		(await dialog.textContent()) ?? "",
		"REMOVED",
		"semantic Bay Disconnect removed review",
	);
	await page.screenshot({
		path: path.join(artifactRoot, "semantic-bay-disconnect-review.png"),
		fullPage: true,
	});

	const beforeDisconnect = await readMetrics(page);
	await page.getByTestId("semantic-bay-command-apply").click();
	await dialog.waitFor({ state: "hidden" });
	const disconnected = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(beforeDisconnect.workerTargetSequence) + 1 &&
			metrics.organizationSelectionCount === "1",
	);
	assertNotEqual(
		disconnected.workerChecksum,
		beforeDisconnect.workerChecksum,
		"Disconnect checksum",
	);
	assertEqual(
		Number(disconnected.strongComponents),
		Number(beforeDisconnect.strongComponents) + 1,
		"Disconnect component delta",
	);
	assertEqual(disconnected.openTerminals, "0", "Disconnect open terminals");
	assertEqual(
		disconnected.staticFabOrganizations,
		beforeDisconnect.staticFabOrganizations,
		"Disconnect organization preservation",
	);
	assertEqual(disconnected.organizationSelectionIds, selectedBayId, "Disconnect Bay selection");
	assertEqual(disconnected.workerSimulationReady, "false", "Disconnect simulation gate");
	assertEqual(
		await root.getAttribute("data-semantic-bay-snapshot-status"),
		"committed",
		"Disconnect command commit telemetry",
	);
	assertEqual(await menu.isVisible(), false, "Disconnect success closes Assemble menu");
	assertEqual(
		await page.getByTestId("rail-canvas").evaluate((element) => element === document.activeElement),
		true,
		"Disconnect success returns focus to Canvas",
	);

	await page.getByRole("button", { name: "실행 취소" }).click();
	const disconnectUndone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(disconnected.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeDisconnect.workerChecksum,
	);
	await page.getByRole("button", { name: "다시 실행" }).click();
	const disconnectRedone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(disconnectUndone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === disconnected.workerChecksum,
	);
	assertEqual(
		disconnectRedone.organizationSelectionIds,
		selectedBayId,
		"Disconnect redo selection",
	);

	await openMenu();
	assertEqual(await disconnect.isDisabled(), true, "detached Bay cannot Disconnect twice");
	assertEqual(await remove.isEnabled(), true, "detached Bay Delete availability");
	await remove.click();
	dialog = page.getByTestId("semantic-bay-command-dialog");
	await dialog.waitFor({ state: "visible" });
	await page.waitForFunction(
		() => {
			const candidate = document.querySelector('[data-testid="semantic-bay-command-dialog"]');
			return ["ready", "rejected"].includes(candidate?.getAttribute("data-phase") ?? "");
		},
		undefined,
		{ timeout: 30_000 },
	);
	if ((await dialog.getAttribute("data-phase")) !== "ready") {
		throw new Error(`Detached semantic Bay Delete was rejected: ${await dialog.textContent()}`);
	}
	assertEqual(await dialog.getAttribute("data-action"), "DELETE", "Delete dialog action");
	assertIncludes(
		(await dialog.textContent()) ?? "",
		"physical Δ-1",
		"detached Delete physical component delta review",
	);
	await page.screenshot({
		path: path.join(artifactRoot, "semantic-bay-delete-review.png"),
		fullPage: true,
	});
	const beforeDelete = await readMetrics(page);
	await page.getByTestId("semantic-bay-command-apply").click();
	await dialog.waitFor({ state: "hidden" });
	const deleted = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(beforeDelete.workerTargetSequence) + 1 &&
			metrics.organizationSelectionCount === "0",
	);
	assertEqual(
		Number(deleted.strongComponents),
		Number(beforeDelete.strongComponents) - 1,
		"detached Delete component delta",
	);
	assertEqual(deleted.openTerminals, "0", "detached Delete open terminals");
	assertAtMost(
		Number(deleted.staticFabOrganizations),
		Number(beforeDelete.staticFabOrganizations) - 2,
		"detached Delete organization cascade",
	);
	assertEqual(deleted.organizationSelectionIds, "", "Delete prunes Bay selection immediately");
	assertEqual(deleted.workerSimulationReady, "false", "Delete simulation gate");

	await page.getByRole("button", { name: "실행 취소" }).click();
	const deleteUndone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(deleted.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeDelete.workerChecksum,
	);
	assertEqual(
		deleteUndone.staticFabOrganizations,
		beforeDelete.staticFabOrganizations,
		"Delete undo restores organizations",
	);
	await page.getByRole("button", { name: "다시 실행" }).click();
	const deleteRedone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(deleteUndone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === deleted.workerChecksum,
	);
	await page.getByRole("button", { name: "실행 취소" }).click();
	const deleteRestored = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(deleteRedone.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeDelete.workerChecksum,
	);
	await page.getByRole("button", { name: "실행 취소" }).click();
	const sourceRestored = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(deleteRestored.workerTargetSequence) + 1 &&
			metrics.workerChecksum === beforeDisconnect.workerChecksum,
	);
	assertEqual(
		sourceRestored.staticFabOrganizations,
		source.staticFabOrganizations,
		"source restore",
	);
	assertEqual(sourceRestored.strongComponents, source.strongComponents, "source component restore");

	const beforeResponsiveReview = await readMetrics(page);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(100);
	await openMenu();
	const browseOrganizations = menu.getByTestId("assemble-browse-organizations");
	await assertLocatorInsideViewport(page, browseOrganizations);
	await browseOrganizations.click();
	await organizationLibrary.waitFor({ state: "visible" });
	await organizationLibrary
		.getByRole("tab", { name: `ALL ${source.staticFabOrganizations}` })
		.click();
	await organizationLibrary.getByRole("textbox", { name: "저장된 FAB 조직 검색" }).fill("");
	await bayOption.waitFor({ state: "visible" });
	await bayOption.click();
	await organizationLibrary.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "editor-activity-assemble",
		undefined,
		{ timeout: 10_000 },
	);
	await page.waitForFunction(
		(expectedId) =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-organization-selection-ids") === expectedId,
		selectedBayId,
		{ timeout: 10_000 },
	);
	await openMenu();
	await disconnect.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, disconnect);
	assertEqual(
		await disconnect.isEnabled(),
		true,
		"390px restored semantic Bay Disconnect availability",
	);
	await disconnect.click();
	dialog = page.getByTestId("semantic-bay-command-dialog");
	await dialog.waitFor({ state: "visible" });
	await page.waitForFunction(
		() => {
			const candidate = document.querySelector('[data-testid="semantic-bay-command-dialog"]');
			return ["ready", "rejected"].includes(candidate?.getAttribute("data-phase") ?? "");
		},
		undefined,
		{ timeout: 30_000 },
	);
	if ((await dialog.getAttribute("data-phase")) !== "ready") {
		throw new Error(
			`Responsive semantic Bay Disconnect was rejected: ${await dialog.textContent()}`,
		);
	}
	const responsiveCancel = page.getByTestId("semantic-bay-command-cancel");
	const responsiveApply = page.getByTestId("semantic-bay-command-apply");
	for (const [label, locator] of [
		["dialog", dialog],
		["Cancel", responsiveCancel],
		["Apply", responsiveApply],
	]) {
		await assertLocatorInsideViewport(page, locator);
		if (label === "dialog") continue;
		const bounds = await locator.boundingBox();
		if (!bounds || bounds.width < 44 || bounds.height < 44) {
			throw new Error(
				`390px semantic Bay ${label} target is smaller than 44px: ${JSON.stringify(bounds)}.`,
			);
		}
	}
	assertEqual(
		await dialog.evaluate((element) => Math.max(0, element.scrollWidth - element.clientWidth)),
		0,
		"390px semantic Bay dialog horizontal overflow",
	);
	await responsiveCancel.focus();
	await page.keyboard.press("Shift+Tab");
	assertEqual(
		await responsiveApply.evaluate((element) => element === document.activeElement),
		true,
		"390px semantic Bay focus trap wraps backward to Apply",
	);
	await page.keyboard.press("Tab");
	assertEqual(
		await responsiveCancel.evaluate((element) => element === document.activeElement),
		true,
		"390px semantic Bay focus trap wraps forward to Cancel",
	);
	await page.screenshot({
		path: path.join(artifactRoot, "semantic-bay-disconnect-review-390x844.png"),
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() =>
			document.activeElement?.getAttribute("data-testid") === "assemble-disconnect-selected-bay",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await disconnect.evaluate((element) => element === document.activeElement),
		true,
		"390px semantic Bay Disconnect launcher focus restore",
	);
	assertProjectUnchanged(
		await readMetrics(page),
		beforeResponsiveReview,
		"390px semantic Bay canceled review",
	);
	if (await menu.isVisible().catch(() => false)) {
		await page.getByTestId("editor-activity-assemble").click();
		await menu.waitFor({ state: "hidden" });
	}
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	reportAcceptanceProgress("semantic-bay-mutation:pass");
	return {
		...sourceRestored,
		selectedBayId,
		firstPaintMilliseconds: Number(await root.getAttribute("data-semantic-bay-first-paint-ms")),
		disconnectChecksum: disconnected.workerChecksum,
		deleteChecksum: deleted.workerChecksum,
		screenshots: [
			"semantic-bay-disconnect-review.png",
			"semantic-bay-delete-review.png",
			"semantic-bay-disconnect-review-390x844.png",
		],
	};
}

async function assertNewFabProfileDirtyGuardSuspension(page, wizard, before, phase) {
	const dirtyGuard = page.locator(".tilefab-project-guard");
	await dirtyGuard.waitFor({ state: "visible", timeout: 10_000 });
	assertEqual(await wizard.getAttribute("data-suspended"), "true", `${phase} wizard suspension`);
	const suspendedWizard = await wizard.evaluate((element) => ({
		ariaHidden: element.getAttribute("aria-hidden"),
		backdropInert: element.parentElement?.inert ?? false,
	}));
	assertEqual(suspendedWizard.ariaHidden, "true", `${phase} wizard aria suspension`);
	assertEqual(suspendedWizard.backdropInert, true, `${phase} wizard inert suspension`);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-pending-project-action"),
		"new-profile-fab",
		`${phase} pending action`,
	);
	for (const actionName of ["저장하지 않고 계속", "저장 후 계속"]) {
		const action = dirtyGuard.getByRole("button", { name: actionName });
		assertEqual(await action.isEnabled(), true, `${phase} ${actionName} action`);
		await assertLocatorInsideViewport(page, action);
	}
	assertProjectUnchanged(await readMetrics(page), before, `${phase} source isolation`);
}

async function openNewFabProfileWizard(page) {
	await activateEditorActivity(page, "assemble");
	const menu = page.getByTestId("static-fab-assemble-menu");
	await openStaticFabAssembleMenu(page, menu, "New Fab profile");
	const opener = menu.getByTestId("fab-preset-browser");
	await opener.scrollIntoViewIfNeeded();
	await opener.click();
	const wizard = page.getByTestId("new-fab-profile-wizard");
	await wizard.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-new-fab-profile-wizard-open"),
		"true",
		"New Fab wizard open telemetry",
	);
	assertEqual(
		JSON.stringify(
			await wizard
				.locator(".tilefab-new-fab-steps li strong")
				.evaluateAll((labels) => labels.map((label) => label.textContent?.trim() ?? "")),
		),
		JSON.stringify(["Layout", "Production", "Circulation", "Review"]),
		"New Fab four-step order",
	);
	assertEqual(
		await wizard.locator(".tilefab-new-fab-name input").inputValue(),
		"New OpenFab Fab",
		"New Fab default project name",
	);
	await assertNewFabProfileStep(page, wizard, "layout", "Layout");
	return { opener, wizard };
}

async function exerciseNewFabProfileWizardChoices(page, wizard) {
	await assertNewFabProfileDefaultCounts(wizard);
	await assertNewFabProfileCopy(wizard, "Layout");
	await assertNewFabProfileRadioContract(wizard, "new-fab-layout-blocks", ["1", "2", "3"], "1");
	await assertNewFabProfileRadioContract(
		wizard,
		"new-fab-bank-direction",
		["EAST_WEST", "NORTH_SOUTH"],
		"EAST_WEST",
	);
	await selectNewFabProfileRadio(wizard, "new-fab-layout-blocks", "3");
	await selectNewFabProfileRadio(wizard, "new-fab-bank-direction", "NORTH_SOUTH");
	await wizard.getByTestId("new-fab-profile-next").click();
	await assertNewFabProfileStep(page, wizard, "production", "Production");
	await assertNewFabProfileCopy(wizard, "Production");
	await assertNewFabProfileRadioContract(
		wizard,
		"new-fab-banks-per-layout-block",
		["1", "2", "3"],
		"2",
	);
	await assertNewFabProfileRadioContract(
		wizard,
		"new-fab-process-loops-per-bank",
		["12", "18", "24"],
		"18",
	);
	await assertNewFabProfileRadioContract(
		wizard,
		"new-fab-bay-packing",
		["SINGLE", "TWIN", "BALANCED_V1"],
		"BALANCED_V1",
	);
	await assertNewFabProfileRadioContract(
		wizard,
		"new-fab-process-loop-long-axis",
		["36", "48", "56"],
		"48",
	);
	await assertNewFabProfileRadioContract(
		wizard,
		"new-fab-process-loop-center-spacing",
		["12", "14", "16"],
		"14",
	);
	for (const [name, value] of [
		["new-fab-banks-per-layout-block", "3"],
		["new-fab-process-loops-per-bank", "24"],
		["new-fab-bay-packing", "TWIN"],
		["new-fab-process-loop-long-axis", "56"],
		["new-fab-process-loop-center-spacing", "16"],
	]) {
		await selectNewFabProfileRadio(wizard, name, value);
	}
	await wizard.getByTestId("new-fab-profile-next").click();
	await assertNewFabProfileStep(page, wizard, "circulation", "Circulation");
	await assertNewFabProfileCirculationContract(wizard, "PAIRED DIRECTED AUTO");
	await wizard.getByTestId("new-fab-profile-back").click();
	await assertNewFabProfileStep(page, wizard, "production", "Production");
	for (const [name, value] of [
		["new-fab-banks-per-layout-block", "3"],
		["new-fab-process-loops-per-bank", "24"],
		["new-fab-bay-packing", "TWIN"],
		["new-fab-process-loop-long-axis", "56"],
		["new-fab-process-loop-center-spacing", "16"],
	]) {
		assertEqual(
			await newFabProfileRadio(wizard, name, value).isChecked(),
			true,
			`New Fab Back persistence ${name}`,
		);
	}
	for (const [name, value] of [
		["new-fab-banks-per-layout-block", "2"],
		["new-fab-process-loops-per-bank", "18"],
		["new-fab-bay-packing", "BALANCED_V1"],
		["new-fab-process-loop-long-axis", "48"],
		["new-fab-process-loop-center-spacing", "14"],
	]) {
		await selectNewFabProfileRadio(wizard, name, value);
	}
	await wizard.getByTestId("new-fab-profile-back").click();
	await assertNewFabProfileStep(page, wizard, "layout", "Layout");
	assertEqual(
		await newFabProfileRadio(wizard, "new-fab-layout-blocks", "3").isChecked(),
		true,
		"New Fab Layout Block Back persistence",
	);
	assertEqual(
		await newFabProfileRadio(wizard, "new-fab-bank-direction", "NORTH_SOUTH").isChecked(),
		true,
		"New Fab axis Back persistence",
	);
	await selectNewFabProfileRadio(wizard, "new-fab-layout-blocks", "1");
	await selectNewFabProfileRadio(wizard, "new-fab-bank-direction", "EAST_WEST");
	await navigateDefaultNewFabProfileToReview(page, wizard);
}

async function navigateDefaultNewFabProfileToReview(page, wizard) {
	if ((await wizard.getAttribute("data-step")) === "layout") {
		await assertNewFabProfileDefaultCounts(wizard);
		await assertNewFabProfileCopy(wizard, "Layout");
		await wizard.getByTestId("new-fab-profile-next").click();
	}
	await assertNewFabProfileStep(page, wizard, "production", "Production");
	await assertNewFabProfileDefaultCounts(wizard);
	await assertNewFabProfileCopy(wizard, "Production");
	await wizard.getByTestId("new-fab-profile-next").click();
	await assertNewFabProfileStep(page, wizard, "circulation", "Circulation");
	await assertNewFabProfileCirculationContract(wizard);
	await wizard.getByTestId("new-fab-profile-next").click();
	await assertNewFabProfileStep(page, wizard, "review", "Review");
	await assertNewFabProfileReviewContract(wizard);
}

async function assertNewFabProfileStep(page, wizard, step, heading) {
	await page.waitForFunction(
		({ expectedStep, expectedHeading }) => {
			const root = document.querySelector('[data-testid="new-fab-profile-wizard"]');
			const activeHeading = root?.querySelector(".tilefab-new-fab-step-heading h2");
			return (
				root?.getAttribute("data-step") === expectedStep &&
				activeHeading?.textContent?.trim() === expectedHeading &&
				document.activeElement === activeHeading
			);
		},
		{ expectedStep: step, expectedHeading: heading },
		{ timeout: 10_000 },
	);
	const activeStep = wizard.locator('.tilefab-new-fab-steps li[aria-current="step"]');
	assertEqual(await activeStep.count(), 1, `New Fab ${heading} active step count`);
	assertEqual(
		(await activeStep.locator("strong").textContent())?.trim(),
		heading,
		`New Fab ${heading} active step label`,
	);
	const stepPanel = wizard.getByTestId(`new-fab-${step}-step`);
	assertEqual(await stepPanel.count(), 1, `New Fab ${heading} semantic panel`);
	assertEqual(await stepPanel.isVisible(), true, `New Fab ${heading} semantic panel visibility`);
	assertEqual(
		await wizard.getByTestId("new-fab-profile-prepare").count(),
		step === "review" ? 1 : 0,
		`New Fab PREPARE availability on ${heading}`,
	);
}

async function assertNewFabProfileDefaultCounts(wizard) {
	for (const [attribute, expected] of [
		["data-layout-blocks", "1"],
		["data-banks", "2"],
		["data-bays", "24"],
		["data-process-loops", "36"],
	]) {
		assertEqual(await wizard.getAttribute(attribute), expected, `New Fab default ${attribute}`);
	}
}

async function assertNewFabProfileRadioContract(wizard, name, values, checked) {
	const actualValues = await wizard
		.locator(`input[name="${name}"]`)
		.evaluateAll((inputs) => inputs.map((input) => input.value));
	assertEqual(JSON.stringify(actualValues), JSON.stringify(values), `${name} supported choices`);
	assertEqual(
		await newFabProfileRadio(wizard, name, checked).isChecked(),
		true,
		`${name} default choice`,
	);
}

function newFabProfileRadio(wizard, name, value) {
	return wizard.locator(`input[name="${name}"][value="${value}"]`);
}

async function selectNewFabProfileRadio(wizard, name, value) {
	const radio = newFabProfileRadio(wizard, name, value);
	await radio.check();
	assertEqual(await radio.isChecked(), true, `${name} choice ${value}`);
}

async function assertNewFabProfileCopy(wizard, step) {
	const text = await wizard.evaluate((element) => element.innerText.replace(/\s+/g, " ").trim());
	const forbidden = text.match(/\b(?:frontage|depth|wing|legacy|certified|certification|semi)\b/i);
	if (forbidden) {
		throw new Error(`${step} contains forbidden New Fab term ${JSON.stringify(forbidden[0])}.`);
	}
}

async function assertNewFabProfileCirculationContract(
	wizard,
	interBlockConnector = "NOT REQUIRED FOR ONE LAYOUT BLOCK",
) {
	await assertNewFabProfileCopy(wizard, "Circulation");
	const text = (
		await wizard.evaluate((element) => element.innerText.replace(/\s+/g, " ").trim())
	).toUpperCase();
	for (const expected of [
		"BANK DISTRIBUTOR PAIRED COLLECTOR",
		"FAB CIRCULATION PAIRED OPPOSITE FLOW",
		`INTER-BLOCK CONNECTOR ${interBlockConnector}`,
		"PERIMETER REDUNDANCY OFF",
		"RAIL PROFILE R500 · 4 M LANE PAIR",
	]) {
		assertIncludes(text, expected, `New Fab circulation policy ${expected}`);
	}
	if (/R600/i.test(text)) throw new Error("New Fab exposes unsupported R600 profile selection.");
}

async function assertNewFabProfileReviewContract(wizard) {
	await assertNewFabProfileDefaultCounts(wizard);
	await assertNewFabProfileCopy(wizard, "Review");
	assertEqual(
		await wizard.getAttribute("data-preparation"),
		"idle",
		"New Fab Review initial preparation state",
	);
	assertEqual(
		await wizard.getByTestId("new-fab-profile-create").count(),
		0,
		"New Fab CREATE unavailable before PREPARE",
	);
	assertEqual(
		await wizard.getByTestId("new-fab-profile-exact-evidence").count(),
		0,
		"New Fab exact evidence remains hidden before PREPARE",
	);
	const text = (
		await wizard.evaluate((element) => element.innerText.replace(/\s+/g, " ").trim())
	).toUpperCase();
	for (const expected of [
		"PROFILE VALID",
		"NOT YET VERIFIED",
		"PORT SERVICE · NOT CHECKED",
		"SIMULATION · NOT SIMULATED",
		"SIMULATIONREADY · FALSE",
		"BAY INTERNAL PAIRS 48",
		"BAY → BANK PAIRS 24",
		"BANK → CIRCULATION PAIRS 2",
		"INTER-BLOCK CONNECTORS 0",
		"INTERNAL ADAPTERS 96",
	]) {
		assertIncludes(text, expected, `New Fab Review contract ${expected}`);
	}
}

async function assertNewFabProfileExactEvidence(wizard) {
	const evidence = wizard.getByTestId("new-fab-profile-exact-evidence");
	await evidence.waitFor({ state: "visible", timeout: 10_000 });
	const text = (await evidence.innerText())
		.replace(/,/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase();
	for (const expected of [
		"OPENFAB VERIFIED · STATIC AUTHORING",
		"FAB FOOTPRINT 328 × 212 M",
		"RAIL CELLS 11282",
		"DIRECTED EDGES 11432",
		"PHYSICAL PATHS 11478",
		"PHYSICAL COMPONENTS 1",
		"DIRECTED SCC 1",
		"OPEN TERMINALS 0",
		"ORGANIZATION RECORDS 63",
		"GEOMETRY · VERIFIED",
		"DIRECTED TOPOLOGY · VERIFIED",
		"GATEWAY REACHABILITY · VERIFIED",
		"ORGANIZATION · VERIFIED",
		"PORT SERVICE · NOT CHECKED",
		"OPERATIONAL · NOT SIMULATED",
	]) {
		assertIncludes(text, expected, `New Fab exact Review evidence ${expected}`);
	}
	if (!/PREPARATION COST \d+(?:\.\d+)? MS/.test(text)) {
		throw new Error(`New Fab exact Review omits measured preparation cost: ${text}`);
	}
}

async function assertNewFabProfileWizardFocusTrap(page, wizard) {
	const close = wizard.getByRole("button", { name: "Close New Fab wizard" });
	await close.focus();
	await page.keyboard.press("Shift+Tab");
	assertEqual(
		await page.evaluate(
			() => document.activeElement?.getAttribute("data-testid") === "new-fab-profile-prepare",
		),
		true,
		"New Fab focus trap wraps backward to PREPARE",
	);
	await page.keyboard.press("Tab");
	assertEqual(
		await close.evaluate((element) => document.activeElement === element),
		true,
		"New Fab focus trap wraps forward to Close",
	);
}

async function assertNewFabProfileOpenerFocus(page, phase) {
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "fab-preset-browser",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-new-fab-profile-wizard-open"),
		"false",
		`${phase} wizard closed telemetry`,
	);
}

async function exerciseResponsiveNewFabProfileWizard(page, viewport, before) {
	await page.setViewportSize({ width: viewport.width, height: viewport.height });
	await page.waitForTimeout(100);
	const { wizard } = await openNewFabProfileWizard(page);
	const maximumProfile = viewport.width === 390;
	if (maximumProfile) await navigateMaximumNewFabProfileToReview(page, wizard);
	else await navigateDefaultNewFabProfileToReview(page, wizard);
	const footer = wizard.locator(".tilefab-new-fab-footer");
	const workspace = wizard.locator(".tilefab-new-fab-workspace");
	for (const control of [
		wizard.getByRole("button", { name: "Close New Fab wizard" }),
		wizard.getByTestId("new-fab-profile-back"),
		wizard.getByTestId("new-fab-profile-prepare"),
	]) {
		await assertLocatorInsideViewport(page, control);
		const bounds = await control.boundingBox();
		if (!bounds || bounds.width < 44 || bounds.height < 44) {
			throw new Error(
				`${viewport.label} New Fab target is smaller than 44px: ${JSON.stringify(bounds)}.`,
			);
		}
	}
	const layout = await wizard.evaluate((element) => {
		const dialog = element.getBoundingClientRect();
		const footerElement = element.querySelector(".tilefab-new-fab-footer");
		const footerBounds = footerElement?.getBoundingClientRect();
		const workspaceElement = element.querySelector(".tilefab-new-fab-workspace");
		const schematicElement = element.querySelector(".tilefab-new-fab-schematic");
		return {
			dialog: {
				left: dialog.left,
				top: dialog.top,
				right: dialog.right,
				bottom: dialog.bottom,
			},
			footerTop: footerBounds?.top ?? -1,
			footerBottom: footerBounds?.bottom ?? -1,
			dialogHorizontalOverflow: Math.max(0, element.scrollWidth - element.clientWidth),
			documentHorizontalOverflow: Math.max(
				0,
				document.documentElement.scrollWidth - window.innerWidth,
			),
			workspaceOverflowY: workspaceElement ? getComputedStyle(workspaceElement).overflowY : "",
			schematicOverflowY: schematicElement ? getComputedStyle(schematicElement).overflowY : "",
			schematicVerticalOverflow: schematicElement
				? Math.max(0, schematicElement.scrollHeight - schematicElement.clientHeight)
				: -1,
		};
	});
	assertAtLeast(layout.dialog.left, 0, `${viewport.label} New Fab dialog left`);
	assertAtLeast(layout.dialog.top, 0, `${viewport.label} New Fab dialog top`);
	assertAtMost(layout.dialog.right, viewport.width, `${viewport.label} New Fab dialog right`);
	assertAtMost(layout.dialog.bottom, viewport.height, `${viewport.label} New Fab dialog bottom`);
	assertEqual(
		layout.dialogHorizontalOverflow,
		0,
		`${viewport.label} New Fab dialog horizontal overflow`,
	);
	assertEqual(
		layout.documentHorizontalOverflow,
		0,
		`${viewport.label} New Fab document horizontal overflow`,
	);
	assertEqual(
		layout.workspaceOverflowY,
		"auto",
		`${viewport.label} New Fab workspace scroll owner`,
	);
	assertEqual(
		layout.schematicOverflowY,
		"visible",
		`${viewport.label} New Fab schematic does not own scrolling`,
	);
	assertEqual(
		layout.schematicVerticalOverflow,
		0,
		`${viewport.label} New Fab schematic internal vertical overflow`,
	);
	if (maximumProfile) {
		assertEqual(await wizard.getAttribute("data-layout-blocks"), "3", "390px max Layout Blocks");
		assertEqual(await wizard.getAttribute("data-banks"), "9", "390px max Banks");
		assertEqual(await wizard.getAttribute("data-bays"), "216", "390px max Bays");
		assertEqual(await wizard.getAttribute("data-process-loops"), "216", "390px max loops");
	}
	const footerTopBeforeScroll = layout.footerTop;
	await workspace.evaluate((element) => {
		element.scrollTop = element.scrollHeight;
	});
	await page.waitForTimeout(50);
	const footerTopAfterScroll = await footer.evaluate(
		(element) => element.getBoundingClientRect().top,
	);
	assertAtMost(
		Math.abs(footerTopAfterScroll - footerTopBeforeScroll),
		1,
		`${viewport.label} New Fab sticky footer displacement`,
	);
	assertAtMost(layout.footerBottom, viewport.height, `${viewport.label} New Fab footer bottom`);
	await page.screenshot({
		path: path.join(
			artifactRoot,
			`new-fab-profile-review-${viewport.width}x${viewport.height}.png`,
		),
		fullPage: true,
	});
	await page.keyboard.press("Escape");
	await wizard.waitFor({ state: "hidden" });
	await assertNewFabProfileOpenerFocus(page, `${viewport.label} responsive close`);
	assertProjectUnchanged(
		await readMetrics(page),
		before,
		`${viewport.label} New Fab responsive source isolation`,
	);
	return {
		viewport: `${viewport.width}x${viewport.height}`,
		profile: maximumProfile ? "maximum" : "default",
		dialogHorizontalOverflow: layout.dialogHorizontalOverflow,
		documentHorizontalOverflow: layout.documentHorizontalOverflow,
		footerTop: footerTopBeforeScroll,
		footerBottom: layout.footerBottom,
	};
}

async function navigateMaximumNewFabProfileToReview(page, wizard) {
	await selectNewFabProfileRadio(wizard, "new-fab-layout-blocks", "3");
	await selectNewFabProfileRadio(wizard, "new-fab-bank-direction", "NORTH_SOUTH");
	await wizard.getByTestId("new-fab-profile-next").click();
	await assertNewFabProfileStep(page, wizard, "production", "Production");
	for (const [name, value] of [
		["new-fab-banks-per-layout-block", "3"],
		["new-fab-process-loops-per-bank", "24"],
		["new-fab-bay-packing", "SINGLE"],
		["new-fab-process-loop-long-axis", "56"],
		["new-fab-process-loop-center-spacing", "16"],
	]) {
		await selectNewFabProfileRadio(wizard, name, value);
	}
	await wizard.getByTestId("new-fab-profile-next").click();
	await assertNewFabProfileStep(page, wizard, "circulation", "Circulation");
	await assertNewFabProfileCirculationContract(wizard, "PAIRED DIRECTED AUTO");
	await wizard.getByTestId("new-fab-profile-next").click();
	await assertNewFabProfileStep(page, wizard, "review", "Review");
}

async function readDefaultNewFabOrganizationContract(page) {
	return page.evaluate(() => {
		const documentState = window.__tileFab?.getDocument();
		const organizations = documentState?.organizations;
		const map = documentState?.map;
		if (!organizations || !map) throw new Error("Default New Fab organization state is missing.");
		const records = organizations.records;
		const byId = new Map(records.map((record) => [record.id, record]));
		const parentIds = (record) => record.parentOrganizationIds ?? [];
		const childrenByParentId = new Map();
		for (const record of records) {
			for (const parentId of parentIds(record)) {
				const children = childrenByParentId.get(parentId);
				if (children) children.push(record);
				else childrenByParentId.set(parentId, [record]);
			}
		}
		const roots = records.filter((record) => parentIds(record).length === 0);
		const loops = records.filter((record) => record.kind === "AISLE");
		const bays = records.filter((record) => record.kind === "BAY");
		const banks = records.filter(
			(record) =>
				record.kind === "AREA" &&
				parentIds(record).length === 1 &&
				(childrenByParentId.get(record.id) ?? []).every((child) => child.kind === "BAY"),
		);
		const fabs = roots.filter(
			(record) =>
				record.kind === "AREA" &&
				(childrenByParentId.get(record.id) ?? []).every((child) => banks.includes(child)),
		);
		const edgeClaims = records.flatMap((record) => record.membership.railEdges);
		const edgeKeys = edgeClaims.map(
			(edge) => `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`,
		);
		const kindCounts = Object.fromEntries(
			["AREA", "BAY", "AISLE", "PROCESS_FAMILY"].map((kind) => [
				kind,
				records.filter((record) => record.kind === kind).length,
			]),
		);
		return {
			recordCount: records.length,
			nextOrganizationId: organizations.nextOrganizationId,
			kindCounts,
			fabs: fabs.length,
			banks: banks.length,
			bays: bays.length,
			processLoops: loops.length,
			rootCount: roots.length,
			layoutBlockRecords: records.filter((record) => /layout\s*block/i.test(record.name)).length,
			invalidHierarchyNames:
				fabs.filter((record) => record.name !== "OpenFab").length +
				banks.filter((record) => !/^Bay Bank \d+$/.test(record.name)).length +
				bays.filter((record) => !/^Production Bay \d+\.\d+$/.test(record.name)).length +
				loops.filter((record) => !/^Process Loop \d+\.\d+\.\d+$/.test(record.name)).length,
			invalidLoopParents: loops.filter((record) => {
				const parents = parentIds(record);
				return parents.length !== 1 || byId.get(parents[0])?.kind !== "BAY";
			}).length,
			invalidBayShape: bays.filter((record) => {
				const parents = parentIds(record);
				const children = childrenByParentId.get(record.id) ?? [];
				return (
					parents.length !== 1 ||
					!banks.includes(byId.get(parents[0])) ||
					(children.length !== 1 && children.length !== 2) ||
					children.some((child) => child.kind !== "AISLE")
				);
			}).length,
			invalidBankShape: banks.filter((record) => {
				const parents = parentIds(record);
				const children = childrenByParentId.get(record.id) ?? [];
				return (
					parents.length !== 1 ||
					!fabs.includes(byId.get(parents[0])) ||
					children.length !== 12 ||
					children.some((child) => child.kind !== "BAY")
				);
			}).length,
			invalidFabShape: fabs.filter((record) => {
				const children = childrenByParentId.get(record.id) ?? [];
				return children.length !== 2 || children.some((child) => !banks.includes(child));
			}).length,
			bayLoopHistogram: {
				single: bays.filter((record) => (childrenByParentId.get(record.id) ?? []).length === 1)
					.length,
				twin: bays.filter((record) => (childrenByParentId.get(record.id) ?? []).length === 2)
					.length,
			},
			edgeClaims: edgeClaims.length,
			uniqueEdgeClaims: new Set(edgeKeys).size,
			mapEdges: map.edgeCount,
		};
	});
}

function assertDefaultNewFabOrganizationContract(hierarchy) {
	assertEqual(hierarchy.recordCount, 63, "default New Fab organization records");
	assertEqual(hierarchy.nextOrganizationId, 64, "default New Fab organization cursor");
	assertEqual(
		JSON.stringify(hierarchy.kindCounts),
		JSON.stringify({ AREA: 3, BAY: 24, AISLE: 36, PROCESS_FAMILY: 0 }),
		"default New Fab organization kinds",
	);
	assertEqual(hierarchy.fabs, 1, "default New Fab Fab hierarchy roots");
	assertEqual(hierarchy.banks, 2, "default New Fab Bank hierarchy nodes");
	assertEqual(hierarchy.bays, 24, "default New Fab Bay hierarchy nodes");
	assertEqual(hierarchy.processLoops, 36, "default New Fab Process Loop hierarchy nodes");
	assertEqual(hierarchy.rootCount, 1, "default New Fab single organization root");
	assertEqual(hierarchy.layoutBlockRecords, 0, "default New Fab generator-only Layout Blocks");
	assertEqual(hierarchy.invalidHierarchyNames, 0, "default New Fab public hierarchy names");
	assertEqual(hierarchy.invalidLoopParents, 0, "default New Fab Process Loop parent contract");
	assertEqual(hierarchy.invalidBayShape, 0, "default New Fab Bay child contract");
	assertEqual(hierarchy.invalidBankShape, 0, "default New Fab Bank child contract");
	assertEqual(hierarchy.invalidFabShape, 0, "default New Fab Fab child contract");
	assertEqual(
		JSON.stringify(hierarchy.bayLoopHistogram),
		JSON.stringify({ single: 12, twin: 12 }),
		"default New Fab balanced Bay packing",
	);
	assertEqual(hierarchy.edgeClaims, 11_432, "default New Fab owned edge claims");
	assertEqual(hierarchy.uniqueEdgeClaims, 11_432, "default New Fab unique edge claims");
	assertEqual(hierarchy.mapEdges, 11_432, "default New Fab complete edge ownership");
}

async function exerciseCompactLayout(page) {
	const patternClose = page.getByRole("button", { name: "패턴 패널 닫기" });
	if (await patternClose.isVisible().catch(() => false)) await patternClose.click();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(250);
	await assertEditorActivityRailLayout(page, "390px");
	await exerciseSyntheticStarterLayout(page);
	const canvasBox = await page.getByTestId("rail-canvas").boundingBox();
	if (!canvasBox || canvasBox.width < 380 || canvasBox.height < 700) {
		throw new Error(`Compact canvas is clipped: ${JSON.stringify(canvasBox)}.`);
	}
	for (const [activity, commands] of [
		["build", ["레일 건설", "모듈 철거"]],
		["assemble", ["내 청사진"]],
		[
			"equip",
			["Station proposal 가져오기", "OHB 포트 배치", "EQ 포트 행 배치", "STK 포트 그룹 배치"],
		],
		["inspect", ["선택 및 정보", "상황별 편집 명령"]],
	]) {
		const activityButton = await activateEditorActivity(page, activity);
		await assertLocatorInsideViewport(page, activityButton);
		const activityBounds = await activityButton.boundingBox();
		if (!activityBounds || activityBounds.width < 44 || activityBounds.height < 44) {
			throw new Error(
				`390px ${activity} activity target is smaller than 44px: ${JSON.stringify(activityBounds)}.`,
			);
		}
		for (const name of commands) {
			await assertLocatorInsideViewport(page, await activityCommandButton(page, activity, name));
		}
	}
	await activateEditorActivity(page, "build");
	for (const name of [
		/SMART ROUTE/,
		/U-TURN/,
		/^SHIFT/,
		/2×2 SWITCH/,
		"ASSEMBLE",
		/BLUEPRINTS 1/,
		"RECENT",
		"AUTO",
		"X→Z",
		"Z→X",
	]) {
		await assertLocatorInsideViewport(page, legacyBuildbarButton(page, name));
	}
	const compactAssembleMenu = page.getByTestId("static-fab-assemble-menu");
	const compactOrganizationLibrary = page.getByTestId("static-fab-organization-library");
	const compactHeaderAssemble = page.getByRole("button", { name: "FAB 조립", exact: true });
	const compactActivityAssemble = page.getByTestId("editor-activity-assemble");
	assertEqual(
		await compactHeaderAssemble.isHidden(),
		true,
		"390px duplicate Assemble header hidden",
	);
	await openStaticFabAssembleMenu(page, compactAssembleMenu, "390px release surface");
	await compactAssembleMenu.getByTestId("assemble-select-on-canvas").click();
	await compactAssembleMenu.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await compactOrganizationLibrary.isVisible(),
		false,
		"390px Canvas Select keeps Organization closed",
	);
	await compactActivityAssemble.click();
	await compactAssembleMenu.waitFor({ state: "visible" });
	await compactActivityAssemble.click();
	await compactAssembleMenu.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "editor-activity-assemble",
		undefined,
		{ timeout: 10_000 },
	);
	await page.getByTestId("rail-pattern-browser-toggle").click();
	await compactAssembleMenu.waitFor({ state: "visible" });
	await assertLocatorInsideViewport(page, compactAssembleMenu);
	const compactAssembleLayout = await compactAssembleMenu.evaluate((menu) => {
		const taskIds = [
			"fab-preset-browser",
			"production-bay-module-browser",
			"assemble-open-blueprints",
			"assemble-browse-organizations",
			"assemble-select-on-canvas",
			"assemble-duplicate-selection",
			"assemble-connect-selected-bays",
		];
		return {
			horizontalOverflow: Math.max(0, menu.scrollWidth - menu.clientWidth),
			documentHorizontalOverflow: Math.max(
				0,
				document.documentElement.scrollWidth - window.innerWidth,
			),
			taskRects: taskIds.map((id) => {
				const rect = menu.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
				return rect ? { top: rect.top, left: rect.left } : { top: -1, left: -1 };
			}),
		};
	});
	assertEqual(
		compactAssembleLayout.horizontalOverflow,
		0,
		"390px Assemble home horizontal overflow",
	);
	assertEqual(
		compactAssembleLayout.documentHorizontalOverflow,
		0,
		"390px Assemble document horizontal overflow",
	);
	const [
		newFabRect,
		addBayRect,
		blueprintRect,
		browseRect,
		selectRect,
		duplicateRect,
		connectRect,
	] = compactAssembleLayout.taskRects;
	assertEqual(
		[
			newFabRect,
			addBayRect,
			blueprintRect,
			browseRect,
			selectRect,
			duplicateRect,
			connectRect,
		].every((rect) => rect.top >= 0 && rect.left >= 0),
		true,
		"390px Assemble task presence",
	);
	assertEqual(
		newFabRect.top < addBayRect.top &&
			addBayRect.top < blueprintRect.top &&
			blueprintRect.top < browseRect.top &&
			Math.abs(browseRect.top - selectRect.top) < 1 &&
			browseRect.left < selectRect.left &&
			selectRect.top < duplicateRect.top,
		true,
		"390px Assemble task-first visual order",
	);
	assertEqual(duplicateRect.top < connectRect.top, true, "390px Assemble Connector action order");
	assertEqual(
		await page.locator(".tilefab-recovery").isHidden(),
		true,
		"390px Assemble keeps the recovery notice off task controls",
	);
	for (const control of [
		compactAssembleMenu.getByTestId("fab-preset-browser"),
		compactAssembleMenu.getByTestId("production-bay-module-browser"),
		compactAssembleMenu.getByTestId("assemble-open-blueprints"),
		compactAssembleMenu.getByTestId("assemble-browse-organizations"),
		compactAssembleMenu.getByTestId("assemble-select-on-canvas"),
		compactAssembleMenu.getByTestId("assemble-duplicate-selection"),
		compactAssembleMenu.getByTestId("assemble-connect-selected-bays"),
	]) {
		await assertLocatorInsideViewport(page, control);
		const bounds = await control.boundingBox();
		if (!bounds || bounds.height < 44) {
			throw new Error(`390px Assemble target is smaller than 44px: ${JSON.stringify(bounds)}.`);
		}
	}
	await page.screenshot({
		path: path.join(artifactRoot, "static-fab-assemble-home-390x844.png"),
		fullPage: true,
	});
	await exerciseProductionBayPanelLayout(page);
	await page.getByTestId("editor-activity-assemble").click();
	await compactAssembleMenu.waitFor({ state: "visible" });
	const compactReadinessToggle = page.getByTestId("rail-readiness-toggle");
	const compactReadinessPanel = page.getByTestId("rail-readiness-panel");
	await compactReadinessToggle.click();
	await compactAssembleMenu.waitFor({ state: "hidden" });
	await compactReadinessPanel.waitFor({ state: "visible" });
	await compactReadinessToggle.click();
	await compactReadinessPanel.waitFor({ state: "hidden" });
	await activateEditorActivity(page, "assemble");
	await compactAssembleMenu.waitFor({ state: "visible" });
	await openAdvancedRailMotifs(page);
	await page.getByRole("button", { name: "PROCESS LOOPS", exact: true }).click();
	await page.getByTestId("rail-template-long-bay").click();
	const configurator = page.getByTestId("pattern-configurator");
	assertEqual(
		await configurator.isVisible(),
		false,
		"compact pattern browser collapses after selection",
	);
	const configToggle = page.getByTestId("pattern-config-toggle");
	await assertLocatorInsideViewport(page, configToggle);
	const compactTemplateId = await page.getByTestId("rail-canvas").getAttribute("data-template-id");
	assertEqual(
		typeof compactTemplateId === "string" && compactTemplateId.length > 0,
		true,
		"compact template placement session exists before reopening Assemble",
	);
	await page.getByTestId("editor-activity-assemble").click();
	await configurator.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("rail-canvas").getAttribute("data-template-id"),
		compactTemplateId,
		"active Assemble re-entry preserves the template placement session",
	);
	assertEqual(
		await configurator.evaluate((element) => element.contains(document.activeElement)),
		true,
		"active Assemble re-entry focuses the preserved template configurator",
	);
	await assertLocatorInsideViewport(page, configurator);
	const overflow = await configurator.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
	}));
	if (overflow.scrollWidth > overflow.clientWidth + 1) {
		throw new Error(`Compact configurator overflows horizontally: ${JSON.stringify(overflow)}.`);
	}
	const flowToggle = page.getByTestId("template-flow-toggle");
	const rotateClockwise = page.getByTestId("template-rotate-clockwise");
	const aisleIncrease = page.getByRole("button", { name: "AISLE 늘리기" });
	for (const control of [flowToggle, rotateClockwise, aisleIncrease]) {
		await assertLocatorInsideViewport(page, control);
	}
	await flowToggle.click();
	await rotateClockwise.click();
	await aisleIncrease.click();
	await page.keyboard.press("Escape");
	const patternPanelClose = page.getByRole("button", { name: "패턴 패널 닫기" });
	if (await patternPanelClose.isVisible().catch(() => false)) await patternPanelClose.click();
	await page.getByTestId("rail-blueprint-library-toggle").click();
	await assertLocatorInsideViewport(page, page.getByTestId("blueprint-library"));
	const record = page.getByTestId("blueprint-record").filter({ hasText: "Whole Flow Bay" });
	await record.waitFor({ state: "visible" });
	await assertLocatorInsideViewport(page, record);
	assertEqual(await record.getAttribute("data-kind"), "STATIC_FAB", "compact blueprint kind");
	assertEqual(await record.getAttribute("data-equipment-groups"), "1", "compact blueprint groups");
	assertEqual(await record.getAttribute("data-ports"), "1", "compact blueprint ports");
}

async function openSyntheticFabStarter(page, starterId) {
	const directNewProject = page.getByRole("button", { name: "새 프로젝트", exact: true });
	if (await directNewProject.isVisible().catch(() => false)) {
		await directNewProject.click();
	} else {
		await page.locator(".tilefab-project-trigger").click();
		await page.getByRole("button", { name: "새 프로젝트", exact: true }).click();
	}
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("synthetic-fab-starter-production-fab-60").count(),
		0,
		"production FAB is exclusive to FAB PRESETS",
	);
	await page.getByTestId(`synthetic-fab-starter-${starterId}`).click();
	return waitForStarterPreview(page, (preview) => preview.starterId === starterId);
}

async function openSyntheticFabPreset(page) {
	const catalogStartedAt = performance.now();
	const syntheticFabStarterWorkersBeforeCatalog = await syntheticFabStarterWorkerStarts(page);
	await page.getByRole("button", { name: "FAB 프리셋", exact: true }).click();
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	assertEqual(await dialog.getAttribute("data-mode"), "preset", "FAB preset dialog mode");
	const presetCard = page.getByTestId("synthetic-fab-starter-production-fab-60");
	const catalogSchematic = presetCard.locator("svg.tilefab-starter-schematic-preview");
	assertEqual(await catalogSchematic.count(), 1, "production FAB immediate catalog schematic");
	assertEqual(
		await presetCard.locator(".tilefab-starter-marker").count(),
		0,
		"production FAB catalog avoids compiled physical markers",
	);
	await presetCard.click();
	const preview = page.getByTestId("synthetic-fab-starter-preview");
	const metrics = await waitForStarterCatalogReady(
		page,
		(candidate) =>
			candidate.starterId === "production-fab-60" &&
			candidate.processBanks === "3" &&
			candidate.processRows === "120",
	);
	const compactSchematic = preview.locator("svg.tilefab-starter-schematic-preview");
	assertEqual(await compactSchematic.count(), 1, "production FAB compact preview schematic");
	assertEqual(
		await preview.locator("canvas.tilefab-starter-exact-preview").count(),
		0,
		"production FAB preview omits oversized exact Canvas geometry",
	);
	assertEqual(
		await preview.getAttribute("data-preview-state"),
		"catalog-ready",
		"production FAB catalog-ready state",
	);
	assertEqual(metrics.previewSource, "catalog", "production FAB catalog preview source");
	assertEqual(
		(await page.getByTestId("synthetic-fab-preview-source").innerText()).trim(),
		"OPENFAB VERIFIED · READY ON DEMAND",
		"production FAB catalog uses scoped OpenFab verification copy",
	);
	assertEqual(
		await page.getByTestId("synthetic-fab-verification-scopes").count(),
		0,
		"production FAB catalog defers exact scopes until artifact hydration",
	);
	assertEqual(
		await preview.locator(".tilefab-starter-schematic-shell").getAttribute("data-pending"),
		"false",
		"production FAB catalog schematic is immediately available",
	);
	assertEqual(
		await dialog.getAttribute("data-independent-verification"),
		"pending",
		"production FAB exact verification is deferred",
	);
	assertEqual(
		await page.getByTestId("create-project-from-synthetic-fab-preset").isDisabled(),
		false,
		"production FAB NEW PROJECT command is available from the catalog",
	);
	assertEqual(
		await page.getByTestId("place-synthetic-fab-preset").isDisabled(),
		false,
		"production FAB repeat-placement command is available from the catalog",
	);
	assertEqual(
		await page.getByTestId("create-synthetic-fab-preset").count(),
		0,
		"obsolete production FAB create command is absent",
	);
	assertEqual(
		await syntheticFabStarterWorkerStarts(page),
		syntheticFabStarterWorkersBeforeCatalog,
		"production FAB catalog starts no generator Worker",
	);
	const semanticPathData = await compactSchematic
		.locator("path[data-role]")
		.evaluateAll((paths) =>
			Object.fromEntries(
				paths.map((path) => [path.getAttribute("data-role"), path.getAttribute("d")]),
			),
		);
	for (const role of ["outer", "spine", "process"]) {
		if (!semanticPathData[role]) {
			throw new Error(`Production FAB compact schematic has no ${role} path data.`);
		}
	}
	assertEqual(
		await preview.locator('.tilefab-starter-schematic-legend [data-role="process"]').textContent(),
		"BANK · BAY · PROCESS LOOP",
		"production FAB schematic hierarchy legend",
	);
	const catalogReadyMilliseconds = performance.now() - catalogStartedAt;
	return Object.freeze({
		...metrics,
		defaultBayCount: await page.getByTestId("synthetic-fab-parameter-bayCount").inputValue(),
		catalogReadyMilliseconds,
		syntheticFabStarterWorkersBeforeCatalog,
		syntheticFabStarterWorkersAfterCatalog: await syntheticFabStarterWorkerStarts(page),
	});
}

async function openPreparedSyntheticFabPreset(page) {
	const restoreStartedAt = performance.now();
	const workersBeforeRestore = await syntheticFabStarterWorkerStarts(page);
	await page.getByRole("button", { name: "FAB 프리셋", exact: true }).click();
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	await page.getByTestId("synthetic-fab-starter-production-fab-60").click();
	const prepared = await waitForStarterPreview(
		page,
		(candidate) => candidate.starterId === "production-fab-60",
	);
	assertEqual(
		await page.getByTestId("synthetic-fab-starter-preview").getAttribute("data-preview-state"),
		"ready",
		"cached production FAB exact preview state",
	);
	assertEqual(prepared.previewSource, "certified", "cached production FAB preview source");
	assertEqual(
		await dialog.getAttribute("data-independent-verification"),
		"certified",
		"cached production FAB certification evidence",
	);
	assertEqual(
		(await page.getByTestId("synthetic-fab-preview-source").innerText()).trim(),
		"OPENFAB VERIFIED · STATIC AUTHORING",
		"cached production FAB uses scoped OpenFab verification copy",
	);
	const verificationScopes = page.getByTestId("synthetic-fab-verification-scopes");
	assertEqual(await verificationScopes.count(), 1, "cached production FAB scope evidence");
	const verificationScopeText = (await verificationScopes.innerText())
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase();
	for (const scope of [
		"RAIL GEOMETRY · VERIFIED",
		"DIRECTED TOPOLOGY · VERIFIED",
		"ORGANIZATION · VERIFIED",
		"PORT SERVICE · NOT CHECKED",
	]) {
		assertIncludes(verificationScopeText, scope, `cached production FAB scope ${scope}`);
	}
	const visibleDialogText = await dialog.evaluate((element) => element.innerText);
	if (/\bCERTIFIED\b/.test(visibleDialogText)) {
		throw new Error("FAB preset dialog retains legacy CERTIFIED user-facing copy.");
	}
	assertEqual(
		await syntheticFabStarterWorkerStarts(page),
		workersBeforeRestore,
		"cached production FAB restore starts no generator Worker",
	);
	const cacheRestoreMilliseconds = performance.now() - restoreStartedAt;
	assertAtMost(
		cacheRestoreMilliseconds,
		PRESET_CATALOG_READY_BUDGET_MILLISECONDS,
		"cached production FAB preview restore latency",
	);
	return Object.freeze({ ...prepared, cacheRestoreMilliseconds });
}

async function exerciseSyntheticFabPresetRepeatPlacement(page, before) {
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	const workersBeforePreparation = await syntheticFabStarterWorkerStarts(page);
	const preparationStartedAt = performance.now();
	const action = await startSyntheticFabPresetAction(page, "place-synthetic-fab-preset");
	await dialog.waitFor({
		state: "hidden",
		timeout: PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS,
	});
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
			"true",
		undefined,
		{ timeout: PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS },
	);
	const preparationMilliseconds = performance.now() - preparationStartedAt;
	assertAtMost(
		preparationMilliseconds,
		PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS,
		"production FAB repeat-placement preparation latency",
	);
	assertEqual(
		await syntheticFabStarterWorkerStarts(page),
		workersBeforePreparation,
		"certified repeat-placement preparation starts no generator Worker",
	);
	assertProjectUnchanged(await readMetrics(page), before, "production FAB prepared repeat ghost");
	await zoomOutForFactoryPlacement(page);

	const sourceGeometry = await readRailGeometry(page);
	const sourceEdges = await readNormalizedAuthoredRailEdges(page);
	const sourceBounds = sourceGeometry.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	const firstPointer = await moveOrganizationBundleGhostToCandidate(page, [
		{ x: sourceBounds.maxX + 2_000, y: sourceBounds.maxY + 1_000 },
		{ x: sourceBounds.maxX + 3_000, y: sourceBounds.maxY + 2_000 },
		{ x: sourceBounds.minX - 3_000, y: sourceBounds.minY - 2_000 },
	]);
	const firstPlacementStartedAt = performance.now();
	await clickWorld(page, offsetCellCenter(firstPointer), false);
	const firstPlaced = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1 &&
			Number(metrics.authoredCells) > Number(before.authoredCells),
		{ timeout: PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS },
	);
	const firstPlacementMilliseconds = performance.now() - firstPlacementStartedAt;
	assertAtMost(
		firstPlacementMilliseconds,
		PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS,
		"first production FAB placement latency",
	);
	assertEqual(firstPlaced.organizationBundleActive, "true", "repeat ghost after first placement");
	assertEqual(
		firstPlaced.organizationBundlePlacementPlanning,
		"worker",
		"first production FAB exact placement thread",
	);
	assertEqual(
		firstPlaced.organizationBundlePlacementPhase,
		"committed",
		"first production FAB placement phase",
	);
	assertDurationTelemetry(
		firstPlaced.organizationBundlePlacementRoundTripMs,
		PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS,
		"first production FAB placement Worker round trip",
	);
	const firstGeometry = await readRailGeometry(page);
	const firstAdded = assertAddedRailGeometryCenteredAtPointer(
		sourceGeometry,
		firstGeometry,
		firstPointer,
		"first production FAB placement",
	);
	const firstAnchor = `${firstAdded.bounds.minX},${firstAdded.bounds.minY}`;
	for (const [value, label] of [
		[firstPlaced.blueprintPlacementRequestAnchor, "request"],
		[firstPlaced.organizationBundlePlacementTicketAnchor, "Worker ticket"],
		[firstPlaced.organizationBundlePlacementPlanAnchor, "Worker plan"],
		[firstPlaced.blueprintPlacementAnchor, "committed"],
	]) {
		assertEqual(value, firstAnchor, `first centered production FAB ${label} anchor`);
	}

	const firstWidth = firstAdded.bounds.maxX - firstAdded.bounds.minX;
	const firstHeight = firstAdded.bounds.maxY - firstAdded.bounds.minY;
	const secondPointer = await moveOrganizationBundleGhostToCandidate(page, [
		{ x: firstPointer.x + firstWidth + 100, y: firstPointer.y },
		{ x: firstPointer.x, y: firstPointer.y + firstHeight + 100 },
		{ x: firstPointer.x + firstWidth + 200, y: firstPointer.y + firstHeight + 200 },
	]);
	const secondPlacementStartedAt = performance.now();
	await clickWorld(page, offsetCellCenter(secondPointer), false);
	const secondPlaced = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(firstPlaced.workerTargetSequence) + 1 &&
			Number(metrics.authoredCells) > Number(firstPlaced.authoredCells),
		{ timeout: PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS },
	);
	const secondPlacementMilliseconds = performance.now() - secondPlacementStartedAt;
	assertAtMost(
		secondPlacementMilliseconds,
		PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS,
		"second production FAB placement latency",
	);
	assertEqual(secondPlaced.organizationBundleActive, "true", "repeat ghost after second placement");
	const secondGeometry = await readRailGeometry(page);
	const secondAdded = assertAddedRailGeometryCenteredAtPointer(
		firstGeometry,
		secondGeometry,
		secondPointer,
		"second production FAB placement",
	);
	assertEqual(
		secondAdded.cells.length,
		firstAdded.cells.length,
		"repeat placement rail-cell increment",
	);
	for (const key of ["authoredCells", "authoredEdges", "physicalPaths", "staticFabOrganizations"]) {
		assertEqual(
			Number(secondPlaced[key]) - Number(firstPlaced[key]),
			Number(firstPlaced[key]) - Number(before[key]),
			`repeat placement ${key} increment`,
		);
	}
	const firstOrganizationIdIncrement =
		Number(firstPlaced.modelNextOrganizationId) - Number(before.modelNextOrganizationId);
	assertAtLeast(firstOrganizationIdIncrement, 1, "first repeat placement fresh organization IDs");
	assertEqual(
		Number(secondPlaced.modelNextOrganizationId) - Number(firstPlaced.modelNextOrganizationId),
		firstOrganizationIdIncrement,
		"second repeat placement fresh organization IDs",
	);
	assertNotEqual(
		secondPlaced.workerChecksum,
		firstPlaced.workerChecksum,
		"second repeat placement authored identity",
	);

	await page.getByTestId("rail-canvas").press("Control+z");
	const firstUndone = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(secondPlaced.workerTargetSequence) + 1 &&
			metrics.authoredCells === firstPlaced.authoredCells &&
			metrics.authoredEdges === firstPlaced.authoredEdges &&
			metrics.staticFabOrganizations === firstPlaced.staticFabOrganizations,
		{ timeout: PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS },
	);
	assertEqual(firstUndone.organizationBundleActive, "true", "repeat ghost after first undo");
	await page.getByTestId("rail-canvas").press("Control+z");
	const restored = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(firstUndone.workerTargetSequence) + 1 &&
			metrics.authoredCells === before.authoredCells &&
			metrics.authoredEdges === before.authoredEdges &&
			metrics.staticFabOrganizations === before.staticFabOrganizations,
		{ timeout: PRESET_FACTORY_PLACEMENT_BUDGET_MILLISECONDS },
	);
	assertEqual(restored.organizationBundleActive, "true", "repeat ghost after second undo");
	assertRailGeometryIdentity(
		await readRailGeometry(page),
		sourceGeometry,
		"repeat-placement undo restoration",
	);
	assertEqual(
		JSON.stringify(await readNormalizedAuthoredRailEdges(page)),
		JSON.stringify(sourceEdges),
		"repeat-placement undo restored directed rail edges",
	);
	for (const key of [
		"physicalPaths",
		"authoredCells",
		"authoredEdges",
		"equipmentGroups",
		"equipmentPorts",
		"staticFabOrganizations",
		"strongComponents",
		"openTerminals",
		"readinessReady",
		"modelTopologyFingerprint",
	]) {
		assertEqual(restored[key], before[key], `repeat-placement undo restoration ${key}`);
	}
	if (!workerIsSettled(restored)) {
		throw new Error("repeat-placement undo restoration does not have an exact Worker ACK.");
	}
	assertEqual(
		restored.modelNextOrganizationId,
		secondPlaced.modelNextOrganizationId,
		"repeat-placement undo keeps organization IDs monotonic",
	);
	assertNotEqual(
		restored.workerChecksum,
		before.workerChecksum,
		"repeat-placement undo preserves the allocator high-water mark",
	);
	assertEqual(restored.projectDirty, "true", "repeat-placement allocator state remains dirty");
	await page.getByTestId("rail-canvas").press("Escape");
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
			"false",
		undefined,
		{ timeout: 10_000 },
	);

	return Object.freeze({
		actionInitialState: action.initialState,
		actionTransitionState: action.transitionState,
		actionTransitionMilliseconds: action.transitionMilliseconds,
		preparationMilliseconds,
		firstPlacementMilliseconds,
		secondPlacementMilliseconds,
		placedRailCells: firstAdded.cells.length,
		placedOrganizations: firstOrganizationIdIncrement,
		firstPointer: `${firstPointer.x},${firstPointer.y}`,
		secondPointer: `${secondPointer.x},${secondPointer.y}`,
	});
}

async function startSyntheticFabPresetAction(page, testId) {
	const preview = page.getByTestId("synthetic-fab-starter-preview");
	const initialState = (await preview.getAttribute("data-preview-state")) ?? "";
	const action = page.getByTestId(testId);
	assertEqual(await action.isDisabled(), false, `${testId} is available`);
	const transitionStartedAt = performance.now();
	const transition = page.waitForFunction(
		(expectedInitialState) => {
			const currentDialog = document.querySelector('[data-testid="synthetic-fab-starter-dialog"]');
			if (!currentDialog) return "closed";
			if (currentDialog.getAttribute("data-busy") === "true") return "busy";
			const currentPreview = document.querySelector(
				'[data-testid="synthetic-fab-starter-preview"]',
			);
			const state = currentPreview?.getAttribute("data-preview-state") ?? "missing";
			return state !== expectedInitialState ? state : "";
		},
		initialState,
		{ timeout: PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS },
	);
	await action.click();
	const transitionHandle = await transition;
	const transitionState = await transitionHandle.jsonValue();
	await transitionHandle.dispose();
	const transitionMilliseconds = performance.now() - transitionStartedAt;
	assertAtMost(
		transitionMilliseconds,
		PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS,
		`${testId} state-transition latency`,
	);
	if (!["verifying", "ready", "busy", "closed"].includes(transitionState)) {
		throw new Error(`${testId} published an unexpected transition state: ${transitionState}`);
	}
	return Object.freeze({ initialState, transitionState, transitionMilliseconds });
}

async function createMaximumLargeFabPreset(page) {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.getByRole("button", { name: "FAB 프리셋", exact: true }).click();
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	await page.getByTestId("synthetic-fab-starter-production-fab-60").click();
	const workersBeforeConfiguration = await syntheticFabStarterWorkerStarts(page);
	await page.getByTestId("synthetic-fab-parameter-processBlockCount").fill("6");
	await page.getByTestId("synthetic-fab-parameter-bayPitchMeters").fill("140");
	await page.getByTestId("synthetic-fab-parameter-bayCount").fill("100");
	const catalog = await waitForStarterCatalogReady(
		page,
		(candidate) =>
			candidate.starterId === "production-fab-60" &&
			candidate.processBanks === "6" &&
			candidate.bayPitch === "140" &&
			candidate.processRows === "200",
	);
	assertEqual(catalog.previewState, "catalog-ready", "maximum FAB catalog state");
	assertEqual(catalog.previewSource, "catalog", "maximum FAB catalog source");
	assertEqual(catalog.processRows, "200", "maximum FAB catalog Process Loop count");
	assertEqual(catalog.processBanks, "6", "maximum FAB catalog Bay Bank count");
	assertEqual(catalog.processBlocks, "1", "maximum FAB catalog whole-FAB count");
	assertEqual(catalog.railCells, "", "maximum FAB catalog defers rail hydration");
	assertEqual(catalog.preparedPlanFingerprint, "", "maximum FAB catalog defers exact plan");
	assertEqual(
		await page.getByTestId("synthetic-fab-parameter-bayCount").inputValue(),
		"100",
		"maximum FAB catalog Bay count",
	);
	assertEqual(
		await syntheticFabStarterWorkerStarts(page),
		workersBeforeConfiguration,
		"maximum FAB configuration starts no generator Worker",
	);
	const activationStartedAt = performance.now();
	const action = await startSyntheticFabPresetAction(
		page,
		"create-project-from-synthetic-fab-preset",
	);
	await continueWithoutSavingIfVisible(page);
	const activated = await waitForWorker(
		page,
		(metrics) =>
			metrics.projectName === "OpenFab 60-Bay Rail Foundation" &&
			metrics.workerTargetSequence === "308" &&
			Number(metrics.authoredCells) >= 30_000 &&
			Number(metrics.authoredEdges) >= 30_000,
		{ timeout: PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS },
	);
	const activationMilliseconds = performance.now() - activationStartedAt;
	assertEqual(
		activated.projectName,
		"OpenFab 60-Bay Rail Foundation",
		"maximum activated FAB project name",
	);
	assertEqual(activated.strongComponents, "1", "maximum activated FAB network count");
	assertEqual(activated.openTerminals, "0", "maximum activated FAB terminals");
	assertEqual(activated.readinessReady, "true", "maximum activated FAB readiness");
	assertEqual(activated.workerSimulationReady, "false", "maximum activated FAB simulation gate");
	assertAtLeast(Number(activated.authoredCells), 30_000, "maximum activated FAB authored cells");
	assertAtLeast(Number(activated.authoredEdges), 30_000, "maximum activated FAB authored edges");
	assertAtLeast(Number(activated.physicalPaths), 30_000, "maximum activated FAB physical paths");
	assertEqual(activated.workerTargetSequence, "308", "maximum activated FAB operation sequence");
	assertEqual(
		activated.startupMirrorFingerprintMatch,
		"true",
		"maximum activated FAB startup/mirror identity",
	);
	assertAtLeast(
		await syntheticFabStarterWorkerStarts(page),
		workersBeforeConfiguration + 1,
		"maximum custom FAB starts its generator Worker only after NEW PROJECT",
	);
	assertAtMost(
		activationMilliseconds,
		PRESET_SOURCE_PREPARATION_BUDGET_MILLISECONDS,
		"maximum FAB independent verification and activation duration",
	);
	await page.getByRole("button", { name: "전체 보기" }).click();
	await page.waitForTimeout(100);
	await assertFittedMapVisible(page);
	await page.screenshot({
		path: path.join(artifactRoot, "production-fab-100-activated.png"),
		fullPage: true,
	});
	const firstSavedPath = await saveProject(page);
	const firstSavedJson = await readFile(firstSavedPath, "utf8");
	await reloadProjectFromFile(page, firstSavedPath);
	const reloaded = await readMetrics(page);
	assertBoundIdentity(reloaded, activated, "restored maximum activated FAB");
	assertEqual(reloaded.projectName, activated.projectName, "restored maximum FAB project name");
	assertEqual(reloaded.projectDirty, "false", "restored maximum FAB dirty state");
	await page.getByRole("button", { name: "전체 보기" }).click();
	await page.waitForTimeout(100);
	await assertFittedMapVisible(page);
	const secondSavedPath = await saveProject(page);
	const secondSavedJson = await readFile(secondSavedPath, "utf8");
	assertCanonicalAuthoredEquality(firstSavedJson, secondSavedJson);
	return Object.freeze({
		...reloaded,
		actionInitialState: action.initialState,
		actionTransitionState: action.transitionState,
		activationMilliseconds,
	});
}

async function createSyntheticFabProject(page, starterId) {
	const preview = await openSyntheticFabStarter(page, starterId);
	await page.getByTestId("create-synthetic-fab-project").click();
	await continueWithoutSavingIfVisible(page);
	return waitForWorker(page, (metrics) => {
		return (
			metrics.physicalPaths === preview.physicalPaths &&
			metrics.workerChecksum === preview.authoredChecksum &&
			metrics.workerPhysicalFingerprint === preview.physicalFingerprint
		);
	});
}

async function exerciseStaticFabArrangement(page, baseline) {
	const canvas = page.getByTestId("rail-canvas");
	await page.getByRole("button", { name: "전체 보기" }).click();
	await page.waitForTimeout(100);
	await canvas.press("Control+a");
	await page.waitForFunction(
		() => Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) > 0,
	);
	const sourceSelection = await readMetrics(page);
	assertAtLeast(Number(sourceSelection.selectionModules), 2, "arrangement source module selection");

	const sourceGeometry = await readRailGeometry(page);
	if (!sourceGeometry.bounds) throw new Error("Static FAB arrangement source has no rail bounds.");
	await canvas.press("Control+c");
	await page.waitForFunction(
		() => document.querySelector('[data-testid="rail-canvas"]')?.dataset.areaStampSource !== "",
	);
	const sourceSpanX = sourceGeometry.bounds.maxX - sourceGeometry.bounds.minX;
	const sourceSpanZ = sourceGeometry.bounds.maxY - sourceGeometry.bounds.minY;
	// Blueprint and organization-bundle ghosts are pointer-centered. Keep the committed footprint,
	// not merely its pointer, clear of the source before arranging all three independent roots.
	const copyAnchor = {
		x: sourceGeometry.bounds.maxX + 20 + Math.ceil(sourceSpanX / 2),
		y: sourceGeometry.bounds.maxY + 27 + Math.ceil(sourceSpanZ / 2),
	};
	await clickWorld(page, offsetCellCenter(copyAnchor));
	await waitForWorker(page, (metrics) => {
		return (
			Number(metrics.workerSequence) === Number(baseline.workerSequence) + 1 &&
			Number(metrics.authoredCells) === Number(baseline.authoredCells) * 2 &&
			Number(metrics.authoredEdges) === Number(baseline.authoredEdges) * 2
		);
	});
	const secondCopyAnchor = {
		x: copyAnchor.x + sourceSpanX + 20,
		y: copyAnchor.y + sourceSpanZ + 27,
	};
	await clickWorld(page, offsetCellCenter(secondCopyAnchor));
	await waitForWorker(page, (metrics) => {
		return (
			Number(metrics.workerSequence) === Number(baseline.workerSequence) + 2 &&
			Number(metrics.authoredCells) === Number(baseline.authoredCells) * 3 &&
			Number(metrics.authoredEdges) === Number(baseline.authoredEdges) * 3
		);
	});
	await canvas.press("Escape");
	await clickActivityCommand(page, "equip", "EQ 포트 행 배치");
	await page.locator(".tilefab-port-buildbar").waitFor({ state: "visible" });
	await canvas.press("Control+a");
	await page.waitForFunction(
		(expected) =>
			Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) === expected,
		Number(sourceSelection.selectionModules) * 3,
	);
	const beforeArrangement = await readMetrics(page);
	assertEqual(
		beforeArrangement.selectionModules,
		String(Number(sourceSelection.selectionModules) * 3),
		"arrangement complete target selection",
	);

	await clickActivityCommand(page, "inspect", "상황별 편집 명령");
	await page.getByTestId("context-construction-palette").waitFor({ state: "visible" });
	await page.getByTestId("start-static-fab-arrangement").click();
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.staticFabArrangementActive ===
			"true",
	);
	assertEqual(
		await page.getByTestId("context-construction-palette").count(),
		0,
		"arrangement closes the previous context command surface",
	);
	assertEqual(
		await page.getByTestId("rail-area-selection-inspector").count(),
		0,
		"arrangement hides ordinary selection inspectors",
	);
	assertEqual(
		await page.locator(".tilefab-port-buildbar").count(),
		0,
		"arrangement hides the inactive equipment build surface",
	);
	for (const [name, label] of [
		["FAB 조립", "Assemble"],
		["FAB 전체 지도", "Map"],
		["실행 취소", "Undo"],
		["전체 삭제", "Clear"],
	]) {
		const headerCommand = page.locator(`.tilefab-commands button[aria-label="${name}"]`);
		assertEqual(await headerCommand.count(), 1, `arrangement retains ${label} command owner`);
		assertEqual(await headerCommand.isDisabled(), true, `arrangement blocks ${label} task surface`);
	}
	for (const activity of ["build", "assemble", "equip", "inspect"]) {
		assertEqual(
			await page.getByTestId(`editor-activity-${activity}`).isDisabled(),
			true,
			`arrangement blocks ${activity} activity`,
		);
	}
	assertEqual(
		await page.getByTestId("static-fab-assemble-menu").count(),
		0,
		"arrangement does not overlap the Assemble task surface",
	);
	const exclusiveCanvasBox = await canvas.boundingBox();
	if (!exclusiveCanvasBox) throw new Error("Arrangement Canvas has no bounds for input locks.");
	await page.mouse.click(
		exclusiveCanvasBox.x + exclusiveCanvasBox.width / 2,
		exclusiveCanvasBox.y + exclusiveCanvasBox.height / 2,
		{ button: "middle" },
	);
	assertEqual(
		await page.getByTestId("context-construction-palette").count(),
		0,
		"arrangement blocks Canvas middle-click context commands",
	);
	const recentIndexBeforeExclusiveWheel = await page
		.getByTestId("tilefab-app")
		.getAttribute("data-rail-clipboard-active-index");
	await page.mouse.move(
		exclusiveCanvasBox.x + exclusiveCanvasBox.width / 2,
		exclusiveCanvasBox.y + exclusiveCanvasBox.height / 2,
	);
	await page.keyboard.down("Control");
	await page.mouse.wheel(0, 120);
	await page.keyboard.up("Control");
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-rail-clipboard-active-index"),
		recentIndexBeforeExclusiveWheel,
		"arrangement blocks modifier-wheel Blueprint placement",
	);
	assertEqual(
		(await readMetrics(page)).staticFabArrangementActive,
		"true",
		"modifier-wheel lock preserves arrangement",
	);
	await canvas.press("z");
	await canvas.press("2");
	try {
		await page.waitForFunction(() => {
			const dataset = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
			return (
				dataset?.staticFabArrangementPhase === "certified" &&
				dataset.staticFabArrangementAxis === "Z" &&
				dataset.staticFabArrangementMode === "ALIGN_CENTER"
			);
		});
	} catch (error) {
		const diagnostics = await readMetrics(page);
		const arrangementFeedback = await page
			.getByTestId("static-fab-arrangement-bar")
			.innerText()
			.catch(() => "");
		await page
			.screenshot({
				path: path.join(artifactRoot, "static-fab-arrangement-failure.png"),
				fullPage: true,
			})
			.catch(() => undefined);
		throw new Error(
			`Bay Assembly arrangement did not certify: ${JSON.stringify({
				phase: diagnostics.staticFabArrangementPhase,
				axis: diagnostics.staticFabArrangementAxis,
				mode: diagnostics.staticFabArrangementMode,
				roots: diagnostics.staticFabArrangementRoots,
				conflicts: diagnostics.staticFabArrangementConflicts,
				feedback: arrangementFeedback,
			})}`,
			{ cause: error },
		);
	}
	const certified = await readMetrics(page);
	assertAtLeast(
		Number(certified.staticFabArrangementRoots),
		3,
		"arrangement independent root count",
	);
	assertEqual(certified.staticFabArrangementConflicts, "0", "arrangement conflict count");
	const projectTrigger = page.locator(".tilefab-project-trigger");
	await projectTrigger.click();
	await projectTrigger.press("Tab");
	await page.waitForFunction(
		() => document.activeElement?.closest("#tilefab-project-menu") !== null,
		undefined,
		{ timeout: 10_000 },
	);
	await page.keyboard.press("Escape");
	await page.locator("#tilefab-project-menu").waitFor({ state: "hidden" });
	assertEqual(
		(await readMetrics(page)).staticFabArrangementPhase,
		"certified",
		"project menu keyboard navigation preserves arrangement",
	);
	const helpButton = page.getByRole("button", { name: "명령·단축키", exact: true });
	await helpButton.focus();
	await helpButton.press("Enter");
	await page.getByRole("dialog", { name: "명령·단축키" }).waitFor({ state: "visible" });
	await page.keyboard.press("Escape");
	await page.getByRole("dialog", { name: "명령·단축키" }).waitFor({ state: "hidden" });
	assertEqual(
		(await readMetrics(page)).staticFabArrangementPhase,
		"certified",
		"safe Help keyboard activation preserves arrangement",
	);
	await page.getByRole("button", { name: "FAB 프리셋", exact: true }).click();
	const presetDialog = page.getByTestId("synthetic-fab-starter-dialog");
	await presetDialog.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("place-synthetic-fab-preset").isDisabled(),
		true,
		"arrangement blocks preset repeat placement",
	);
	await page.getByTestId("synthetic-fab-placement-blocked").waitFor({ state: "visible" });
	assertEqual(
		await page.getByLabel("NEW PROJECT NAME", { exact: true }).count(),
		1,
		"repeat-placement warning does not alter the New Project input label",
	);
	assertEqual(
		await page.getByTestId("place-synthetic-fab-preset").getAttribute("aria-describedby"),
		"tilefab-starter-placement-status",
		"repeat-placement warning owns only the repeat action description",
	);
	assertEqual(
		await page.getByTestId("create-project-from-synthetic-fab-preset").isEnabled(),
		true,
		"arrangement retains explicit New Project transition",
	);
	assertEqual(
		await page
			.getByTestId("create-project-from-synthetic-fab-preset")
			.getAttribute("aria-describedby"),
		"tilefab-starter-create-status",
		"New Project retains its creation readiness description",
	);
	await page.getByTestId("close-synthetic-fab-starter").click();
	await presetDialog.waitFor({ state: "hidden" });
	const presetLauncher = page.getByRole("button", { name: "FAB 프리셋", exact: true });
	await presetLauncher.focus();
	await page.evaluate(() => {
		globalThis.__openFabExclusiveSavePrevented = null;
		const observeSave = (event) => {
			if (!(event.code === "KeyS" && (event.ctrlKey || event.metaKey))) return;
			globalThis.__openFabExclusiveSavePrevented = event.defaultPrevented;
			globalThis.removeEventListener("keydown", observeSave);
		};
		globalThis.addEventListener("keydown", observeSave);
	});
	await presetLauncher.press("Control+s");
	assertEqual(
		await page.evaluate(() => globalThis.__openFabExclusiveSavePrevented),
		true,
		"project-scope focus does not bypass the contextual save lock",
	);
	assertEqual(
		(await readMetrics(page)).staticFabArrangementPhase,
		"certified",
		"closing preset dialog preserves arrangement",
	);
	assertAtLeast(
		Number(certified.staticFabArrangementSourcePlanIndex),
		1,
		"arrangement source session first plan",
	);
	assertAtLeast(
		Number(certified.staticFabArrangementSessionHydrationMs),
		0,
		"arrangement source session hydration telemetry",
	);
	assertAtLeast(
		Number(certified.staticFabArrangementSessionCompilationMs),
		0,
		"arrangement source session compilation telemetry",
	);
	assertEqual(
		certified.staticFabArrangementTargetCellsOmitted,
		"false",
		"arrangement exact target preview",
	);
	assertEqual(
		certified.workerSequence,
		beforeArrangement.workerSequence,
		"arrangement preview does not mutate Worker mirror",
	);

	await page.setViewportSize({ width: 390, height: 720 });
	await page.waitForTimeout(120);
	const compactLayout = await page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const bar = document.querySelector('[data-testid="static-fab-arrangement-bar"]');
		const map = window.__tileFab?.getDocument().map;
		const camera = window.__tileFab?.camera;
		const canvasRect = canvas?.getBoundingClientRect();
		const barRect = bar?.getBoundingClientRect();
		const bounds = map?.bounds();
		if (!canvasRect || !barRect || !bounds || !camera) return null;
		return {
			barLeft: barRect.left,
			barRight: barRect.right,
			barTop: barRect.top,
			barBottom: barRect.bottom,
			railBottom: canvasRect.top + camera.offsetY + (bounds.maxY + 1) * camera.zoom,
			buttons: [...bar.querySelectorAll("button")].map((button) => {
				const rect = button.getBoundingClientRect();
				return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
			}),
		};
	});
	if (!compactLayout) throw new Error("Static FAB arrangement compact layout is unavailable.");
	assertAtLeast(compactLayout.barLeft, 0, "compact arrangement bar left edge");
	assertAtMost(compactLayout.barRight, 390, "compact arrangement bar right edge");
	assertAtMost(compactLayout.barBottom, 720, "compact arrangement bar bottom edge");
	assertAtMost(
		compactLayout.railBottom,
		compactLayout.barTop - 4,
		"compact arrangement bar keeps selected rail visible",
	);
	assertEqual(compactLayout.buttons.length, 9, "compact arrangement command count");
	for (const [index, button] of compactLayout.buttons.entries()) {
		assertAtLeast(button.left, compactLayout.barLeft, `compact arrangement command ${index} left`);
		assertAtMost(
			button.right,
			compactLayout.barRight,
			`compact arrangement command ${index} right`,
		);
		assertAtLeast(button.top, compactLayout.barTop, `compact arrangement command ${index} top`);
		assertAtMost(
			button.bottom,
			compactLayout.barBottom,
			`compact arrangement command ${index} bottom`,
		);
	}

	const centerMode = page.locator(
		'[data-testid="static-fab-arrangement-bar"] button[data-mode="ALIGN_CENTER"]',
	);
	await centerMode.focus();
	await centerMode.press("Control+z");
	await page.waitForTimeout(120);
	const isolated = await readMetrics(page);
	assertEqual(
		isolated.workerSequence,
		beforeArrangement.workerSequence,
		"arrangement command bar blocks global undo",
	);
	await centerMode.press("Tab");
	assertEqual(
		await page.evaluate(() =>
			document.activeElement?.closest(".tilefab-arrangementbar") ? "command-bar" : "outside",
		),
		"command-bar",
		"arrangement Tab focus containment",
	);

	await page.emulateMedia({ reducedMotion: "reduce" });
	await canvas.focus();
	await canvas.press("x");
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.staticFabArrangementPhase ===
			"planning",
	);
	assertEqual(
		await page
			.locator(".tilefab-arrangement-summary > svg")
			.evaluate((element) => getComputedStyle(element).animationName),
		"none",
		"arrangement reduced-motion planning indicator",
	);
	await page.waitForFunction(() => {
		const phase = document.querySelector('[data-testid="rail-canvas"]')?.dataset
			.staticFabArrangementPhase;
		return phase === "certified" || phase === "rejected";
	});
	const xCertified = await readMetrics(page);
	assertAtLeast(
		Number(xCertified.staticFabArrangementSourcePlanIndex),
		Number(certified.staticFabArrangementSourcePlanIndex) + 1,
		"arrangement source session reuses hydration for X option result",
	);
	await canvas.press("z");
	await canvas.press("2");
	await page.waitForFunction((previousPlanIndex) => {
		const dataset = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
		return (
			dataset?.staticFabArrangementPhase === "certified" &&
			Number(dataset.staticFabArrangementSourcePlanIndex) >= Number(previousPlanIndex) + 1
		);
	}, Number(xCertified.staticFabArrangementSourcePlanIndex));
	const zCertified = await readMetrics(page);
	assertAtLeast(
		Number(zCertified.staticFabArrangementSourcePlanIndex),
		Number(xCertified.staticFabArrangementSourcePlanIndex) + 1,
		"arrangement source session reuses hydration for Z option",
	);
	assertEqual(
		zCertified.staticFabArrangementSessionHydrationMs,
		certified.staticFabArrangementSessionHydrationMs,
		"arrangement source session hydration remains single-shot",
	);
	await page.emulateMedia({ reducedMotion: "no-preference" });

	const cameraBeforePan = await page.evaluate(() => ({ ...window.__tileFab?.camera }));
	const canvasBox = await canvas.boundingBox();
	if (!canvasBox) throw new Error("Static FAB arrangement Canvas has no visible bounds.");
	await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + 120);
	await page.mouse.down({ button: "right" });
	await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 28, canvasBox.y + 138, { steps: 4 });
	await page.mouse.up({ button: "right" });
	await page.mouse.wheel(0, -120);
	await page.waitForTimeout(100);
	const cameraAfterPan = await page.evaluate(() => ({ ...window.__tileFab?.camera }));
	assertNotEqual(cameraAfterPan.offsetX, cameraBeforePan.offsetX, "arrangement RMB pan continuity");
	assertNotEqual(cameraAfterPan.zoom, cameraBeforePan.zoom, "arrangement wheel zoom continuity");
	assertEqual(
		(await readMetrics(page)).staticFabArrangementPhase,
		"certified",
		"arrangement remains certified after camera interaction",
	);

	await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + 120, {
		button: "right",
	});
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.staticFabArrangementActive ===
			"false",
	);
	const cancelled = await readMetrics(page);
	assertEqual(
		cancelled.selectionModules,
		beforeArrangement.selectionModules,
		"arrangement cancel selection",
	);
	assertEqual(
		cancelled.workerSequence,
		beforeArrangement.workerSequence,
		"arrangement cancel Worker sequence",
	);

	await page.setViewportSize({ width: 1440, height: 900 });
	await canvas.focus();
	await canvas.press("l");
	await canvas.press("z");
	await canvas.press("2");
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.staticFabArrangementPhase ===
			"certified",
	);

	await canvas.press("Enter");
	const arranged = await waitForWorker(page, (metrics) => {
		return (
			metrics.staticFabArrangementActive === "false" &&
			Number(metrics.workerSequence) === Number(beforeArrangement.workerSequence) + 1
		);
	});
	assertEqual(
		arranged.authoredCells,
		beforeArrangement.authoredCells,
		"arrangement authored cells",
	);
	assertEqual(
		arranged.authoredEdges,
		beforeArrangement.authoredEdges,
		"arrangement authored edges",
	);
	assertNotEqual(
		arranged.workerChecksum,
		beforeArrangement.workerChecksum,
		"arrangement translated checksum",
	);
	assertEqual(
		arranged.selectionModules,
		beforeArrangement.selectionModules,
		"arrangement selection restoration",
	);
	assertEqual(
		await page.evaluate(() => document.activeElement?.getAttribute("data-testid")),
		"rail-canvas",
		"arrangement Canvas focus restoration",
	);

	await page.getByRole("button", { name: "실행 취소" }).click();
	const undone = await waitForWorker(page, (metrics) => {
		return (
			Number(metrics.workerSequence) === Number(arranged.workerSequence) + 1 &&
			metrics.workerChecksum === beforeArrangement.workerChecksum
		);
	});
	assertEqual(undone.authoredCells, beforeArrangement.authoredCells, "arrangement undo cells");
	assertEqual(undone.authoredEdges, beforeArrangement.authoredEdges, "arrangement undo edges");

	await page.getByRole("button", { name: "다시 실행" }).click();
	const redone = await waitForWorker(page, (metrics) => {
		return (
			Number(metrics.workerSequence) === Number(undone.workerSequence) + 1 &&
			metrics.workerChecksum === arranged.workerChecksum
		);
	});
	assertEqual(redone.authoredCells, arranged.authoredCells, "arrangement redo cells");
	assertEqual(redone.authoredEdges, arranged.authoredEdges, "arrangement redo edges");
	await clickActivityCommand(page, "build", "레일 건설");
	return redone;
}

async function waitForStarterPreview(page, predicate) {
	const preview = page.getByTestId("synthetic-fab-starter-preview");
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const metrics = await readStarterPreviewMetrics(preview);
		if (
			metrics.previewState === "worker-error" ||
			metrics.previewState === "invalid-request" ||
			metrics.previewState === "invalid"
		) {
			const message =
				(await preview
					.locator(".tilefab-starter-preview-error")
					.textContent()
					.catch(() => null)) ??
				(await page
					.getByTestId("synthetic-fab-operation-error")
					.textContent()
					.catch(() => null)) ??
				"No preview diagnostic was published.";
			throw new Error(`Synthetic FAB starter preview failed (${metrics.previewState}): ${message}`);
		}
		if (
			metrics.authoredChecksum &&
			metrics.operationSequence &&
			metrics.physicalFingerprint &&
			metrics.analysisFingerprint &&
			metrics.requestFingerprint &&
			predicate(metrics)
		)
			return metrics;
		await page.waitForTimeout(25);
	}
	throw new Error("Timed out waiting for a compiled synthetic FAB starter preview.");
}

async function waitForStarterCatalogReady(page, predicate) {
	const preview = page.getByTestId("synthetic-fab-starter-preview");
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		const metrics = await readStarterPreviewMetrics(preview);
		if (
			metrics.previewState === "worker-error" ||
			metrics.previewState === "invalid-request" ||
			metrics.previewState === "invalid"
		) {
			const message =
				(await page
					.getByTestId("synthetic-fab-operation-error")
					.textContent()
					.catch(() => null)) ?? "No catalog diagnostic was published.";
			throw new Error(`Synthetic FAB preset catalog failed (${metrics.previewState}): ${message}`);
		}
		if (metrics.previewState === "catalog-ready" && predicate(metrics)) return metrics;
		await page.waitForTimeout(25);
	}
	throw new Error(
		`Timed out waiting for a catalog-ready synthetic FAB preset. ${JSON.stringify(await readStarterPreviewMetrics(preview))}`,
	);
}

async function readStarterPreviewMetrics(preview) {
	return preview.evaluate((element) => ({
		previewState: element.dataset.previewState ?? "",
		previewSource: element.dataset.previewSource ?? "",
		starterId: element.dataset.starterId ?? "",
		railCells: element.dataset.railCells ?? "",
		zoneCount: element.dataset.zoneCount ?? "",
		bayCount: element.dataset.bayCount ?? "",
		bayPitch: element.dataset.bayPitch ?? "",
		processRows: element.dataset.processRows ?? "",
		processBanks: element.dataset.processBanks ?? "",
		processBlocks: element.dataset.processBlocks ?? "",
		interbaySpines: element.dataset.interbaySpines ?? "",
		wallCircuits: element.dataset.wallCircuits ?? "",
		outerCirculations: element.dataset.outerCirculations ?? "",
		wallCircuitLinks: element.dataset.wallCircuitLinks ?? "",
		outerGateways: element.dataset.outerGateways ?? "",
		planFingerprint: element.dataset.planFingerprint ?? "",
		preparedPlanFingerprint: element.dataset.preparedPlanFingerprint ?? "",
		directedEdges: element.dataset.directedEdges ?? "",
		physicalPaths: element.dataset.physicalPaths ?? "",
		strongComponents: element.dataset.strongComponents ?? "",
		openTerminals: element.dataset.openTerminals ?? "",
		authoredChecksum: element.dataset.authoredChecksum ?? "",
		operationSequence: element.dataset.operationSequence ?? "",
		physicalFingerprint: element.dataset.physicalFingerprint ?? "",
		analysisFingerprint: element.dataset.analysisFingerprint ?? "",
		requestFingerprint: element.dataset.requestFingerprint ?? "",
	}));
}

async function syntheticFabStarterWorkerStarts(page) {
	return page.evaluate(() => globalThis.__openfabAcceptanceWorkerStarts?.syntheticFabStarter ?? -1);
}

async function continueWithoutSavingIfVisible(page, expected = null) {
	const discard = page.getByRole("button", { name: "저장하지 않고 계속" });
	const visible = await discard.isVisible().catch(() => false);
	if (expected !== null) assertEqual(visible, expected, "unsaved transition guard visibility");
	if (visible) await discard.click();
}

async function assertStarterModalIsolation(page, before) {
	const directNewProject = page.locator('.tilefab-commands button[aria-label="새 프로젝트"]');
	const returnFocusTarget = (await directNewProject.isVisible().catch(() => false))
		? directNewProject
		: page.locator(".tilefab-project-trigger");
	await openSyntheticFabStarter(page, "bay-assembly");
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	const app = page.getByTestId("tilefab-app");
	assertEqual(
		await app.evaluate((element) => {
			for (let current = element; current; current = current.parentElement) {
				if (current.inert) return true;
			}
			return false;
		}),
		true,
		"starter background inert state",
	);
	await dialog.focus();
	await page.keyboard.press("Shift+Tab");
	assertEqual(
		await dialog.evaluate((element) => element.contains(document.activeElement)),
		true,
		"starter focus trap",
	);
	await dialog.focus();
	await page.keyboard.press("Meta+Z");
	await page.keyboard.press("Delete");
	await page.waitForTimeout(50);
	assertProjectUnchanged(await readMetrics(page), before, "starter modal shortcut isolation");
	await page.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	await page.waitForTimeout(50);
	assertEqual(
		await returnFocusTarget.evaluate((element) => element === document.activeElement),
		true,
		"starter opener focus restore",
	);
}

async function exerciseSyntheticStarterLayout(page) {
	const before = await readMetrics(page);
	await openSyntheticFabStarter(page, "bay-bank");
	const dialog = page.getByTestId("synthetic-fab-starter-dialog");
	const activeStarter = page.getByTestId("synthetic-fab-starter-bay-bank");
	const previewStage = page.locator(".tilefab-starter-preview-stage");
	const parameter = page.getByTestId("synthetic-fab-parameter-bayCount");
	const create = page.getByTestId("create-synthetic-fab-project");
	const dialogBox = await dialog.boundingBox();
	const viewport = page.viewportSize();
	if (
		!dialogBox ||
		!viewport ||
		dialogBox.x < 0 ||
		dialogBox.y < 0 ||
		dialogBox.x + dialogBox.width > viewport.width ||
		dialogBox.y + dialogBox.height > viewport.height
	) {
		throw new Error(
			`Synthetic starter dialog is outside the viewport: ${JSON.stringify({ dialogBox, viewport })}.`,
		);
	}
	for (const control of [activeStarter, previewStage, create]) {
		await control.scrollIntoViewIfNeeded();
		await assertLocatorInsideViewport(page, control);
	}
	await page.screenshot({
		path: path.join(artifactRoot, `synthetic-starter-${viewport.width}px.png`),
		fullPage: true,
	});
	await parameter.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, parameter);
	const overflow = await dialog.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
	}));
	if (overflow.scrollWidth > overflow.clientWidth + 1) {
		throw new Error(
			`Synthetic starter dialog overflows horizontally: ${JSON.stringify(overflow)}.`,
		);
	}
	await page.getByTestId("close-synthetic-fab-starter").click();
	await dialog.waitFor({ state: "hidden" });
	assertProjectUnchanged(await readMetrics(page), before, "responsive starter preview");

	await page.getByRole("button", { name: "FAB 프리셋", exact: true }).click();
	const presetDialog = page.getByTestId("synthetic-fab-starter-dialog");
	await presetDialog.waitFor({ state: "visible" });
	const presetConfiguration = page.getByRole("group", { name: "스타터 치수" });
	await assertLocatorInsideViewport(page, presetConfiguration);
	const presetBayCount = page.getByTestId("synthetic-fab-parameter-bayCount");
	const initialPresetBayCount = await presetBayCount.inputValue();
	await presetBayCount.fill(String(Number(initialPresetBayCount) + 1));
	await presetBayCount.press("Escape");
	assertEqual(
		await presetBayCount.inputValue(),
		initialPresetBayCount,
		"FAB preset numeric Escape restores value",
	);
	assertEqual(await presetDialog.isVisible(), true, "FAB preset numeric Escape keeps dialog open");
	assertEqual(
		await presetBayCount.evaluate((element) => element === document.activeElement),
		true,
		"FAB preset numeric Escape preserves focus",
	);
	const presetOverflow = await presetDialog.evaluate((element) => ({
		clientWidth: element.clientWidth,
		scrollWidth: element.scrollWidth,
	}));
	if (presetOverflow.scrollWidth > presetOverflow.clientWidth + 1) {
		throw new Error(
			`Large FAB preset dialog overflows horizontally: ${JSON.stringify(presetOverflow)}.`,
		);
	}
	await page.screenshot({
		path: path.join(artifactRoot, `large-fab-preset-${viewport.width}px.png`),
		fullPage: true,
	});
	await page.getByTestId("close-synthetic-fab-starter").click();
	await presetDialog.waitFor({ state: "hidden" });
	assertProjectUnchanged(await readMetrics(page), before, "responsive large FAB preset preview");

	await openSyntheticFabPattern(page, "bay-assembly");
	const patternDialog = page.getByTestId("synthetic-fab-starter-dialog");
	const placePattern = page.getByTestId("place-synthetic-fab-pattern");
	await assertLocatorInsideViewport(page, patternDialog);
	await placePattern.scrollIntoViewIfNeeded();
	await assertLocatorInsideViewport(page, placePattern);
	await page.screenshot({
		path: path.join(artifactRoot, `synthetic-pattern-${viewport.width}px.png`),
		fullPage: true,
	});
	await placePattern.click();
	await patternDialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => Number(document.querySelector(".tilefab-app")?.dataset.areaStampModules) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	await assertLocatorInsideViewport(page, page.getByTestId("area-stamp-multi-place-status"));
	const placementExit = page.getByTestId("area-stamp-exit");
	await assertLocatorInsideViewport(page, placementExit);
	await page.screenshot({
		path: path.join(artifactRoot, `synthetic-pattern-placement-${viewport.width}px.png`),
		fullPage: true,
	});
	await placementExit.click();
	await page.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.areaStampModules === "0",
		undefined,
		{ timeout: 10_000 },
	);
	const patternPanelClose = page.getByRole("button", { name: "패턴 패널 닫기" });
	if (await patternPanelClose.isVisible().catch(() => false)) await patternPanelClose.click();
	assertProjectUnchanged(await readMetrics(page), before, "responsive FAB pattern preview");
}

async function exerciseCertifiedStarterRecommendedHierarchy(browserInstance) {
	const context = await browserInstance.newContext({ viewport: { width: 390, height: 844 } });
	let page;
	try {
		page = await context.newPage();
		page.on("console", (message) => {
			if (message.type() === "error") result.consoleErrors.push(message.text());
		});
		page.on("pageerror", (error) => result.pageErrors.push(error.message));
		await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
		await waitForReady(page, { physicalPaths: 0 });
		const firstRunDialog = page.getByTestId("openfab-start-dialog");
		await firstRunDialog.waitFor({ state: "visible" });
		await firstRunDialog.getByRole("button", { name: /BLANK CANVAS/ }).click();
		await firstRunDialog.waitFor({ state: "hidden" });

		const preview = await openSyntheticFabStarter(page, "bay-bank");
		assertEqual(preview.bayCount, "4", "recommended hierarchy starter Bay count");
		await page.getByTestId("create-synthetic-fab-project").click();
		await continueWithoutSavingIfVisible(page, false);
		const starter = await waitForWorker(
			page,
			(metrics) =>
				metrics.physicalPaths === preview.physicalPaths &&
				metrics.workerChecksum === preview.authoredChecksum &&
				metrics.workerPhysicalFingerprint === preview.physicalFingerprint,
			{ timeout: 30_000 },
		);
		assertEqual(starter.staticFabOrganizations, "13", "recommended hierarchy starter records");
		assertEqual(starter.workerSimulationReady, "false", "recommended hierarchy simulation gate");
		const starterHierarchy = await readCertifiedStarterHierarchy(page);
		assertEqual(starterHierarchy.bankIds.length, 1, "recommended hierarchy starter Bank count");
		assertEqual(starterHierarchy.fabIds.length, 0, "recommended hierarchy starter Fab count");

		await selectOrganizationsThroughAssemble(page, starterHierarchy.bankIds);
		const assembleMenu = page.getByTestId("static-fab-assemble-menu");
		await openStaticFabAssembleMenu(page, assembleMenu, "recommended hierarchy duplicate");
		const duplicate = assembleMenu.getByTestId("assemble-duplicate-selection");
		assertEqual(
			await duplicate.isEnabled(),
			true,
			"recommended hierarchy Bank duplicate available",
		);
		const beforeDuplicate = await readMetrics(page);
		await duplicate.click();
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="tilefab-app"]')
					?.getAttribute("data-organization-bundle-active") === "true",
			undefined,
			{ timeout: 10_000 },
		);
		const duplicatePointer = await waitForPrimedOrganizationDuplicate(page);
		await centerWorld(page, offsetCellCenter(duplicatePointer));
		await moveToWorld(page, offsetCellCenter(duplicatePointer));
		await page.waitForFunction(
			(expected) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.cursorX === String(expected.x) &&
					canvas.dataset.cursorY === String(expected.y) &&
					canvas.dataset.organizationBundlePreviewState === "candidate"
				);
			},
			duplicatePointer,
			{ timeout: 10_000 },
		);
		await clickWorld(page, offsetCellCenter(duplicatePointer), false);
		const duplicated = await waitForWorker(
			page,
			(metrics) =>
				metrics.staticFabOrganizations === "26" &&
				Number(metrics.workerTargetSequence) === Number(beforeDuplicate.workerTargetSequence) + 1,
			{ timeout: 30_000 },
		);
		assertEqual(
			duplicated.organizationBundlePlacementPhase,
			"committed",
			"recommended hierarchy duplicate commit",
		);
		assertEqual(
			duplicated.organizationBundlePlacementTargetChecksumMatch,
			"true",
			"recommended hierarchy duplicate target checksum",
		);
		await page.getByTestId("rail-canvas").press("Escape");
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="tilefab-app"]')
					?.getAttribute("data-organization-bundle-active") === "false",
			undefined,
			{ timeout: 10_000 },
		);

		const duplicatedHierarchy = await readCertifiedStarterHierarchy(page);
		assertEqual(duplicatedHierarchy.bankIds.length, 2, "recommended hierarchy duplicated Banks");
		assertEqual(duplicatedHierarchy.fabIds.length, 0, "recommended hierarchy pre-Interbay Fabs");
		await selectOrganizationsThroughAssemble(page, duplicatedHierarchy.bankIds);

		const interbay = await applyRecommendedAssemblyConnector(page, {
			purpose: "HIERARCHY_LINK",
			expectedOrganizationDelta: 1,
			label: "recommended Interbay",
		});
		assertAtLeast(interbay.attempts, 1, "recommended Interbay attempt count");
		assertAtMost(interbay.attempts, 8, "recommended Interbay attempt bound");
		assertEqual(interbay.applied.staticFabOrganizations, "27", "recommended Interbay records");
		assertEqual(
			interbay.applied.organizationSelectionCount,
			"2",
			"recommended Interbay retained Bank selection",
		);
		const interbayHierarchy = await readCertifiedStarterHierarchy(page);
		assertCertifiedTwoBankFab(interbayHierarchy, "recommended Interbay");

		const fabLoop = await applyRecommendedAssemblyConnector(page, {
			purpose: "FAB_LOOP",
			expectedOrganizationDelta: 0,
			label: "recommended Fab Loop",
		});
		assertAtLeast(fabLoop.attempts, 1, "recommended Fab Loop attempt count");
		assertAtMost(fabLoop.attempts, 8, "recommended Fab Loop attempt bound");
		assertEqual(fabLoop.applied.staticFabOrganizations, "27", "recommended Fab Loop records");
		const finalHierarchy = await readCertifiedStarterHierarchy(page);
		assertCertifiedTwoBankFab(finalHierarchy, "recommended Fab Loop");
		assertAtLeast(
			finalHierarchy.fabDirectEdgeCounts[0] ?? 0,
			(interbayHierarchy.fabDirectEdgeCounts[0] ?? 0) + 1,
			"recommended Fab Loop extends the existing Fab",
		);

		await page.getByTestId("rail-readiness-toggle").click();
		const checks = page.getByTestId("rail-readiness-panel");
		await checks.waitFor({ state: "visible" });
		await page.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="tilefab-app"]')
					?.getAttribute("data-static-fab-check-status") === "ready",
			undefined,
			{ timeout: 30_000 },
		);
		const checked = await readMetrics(page);
		assertEqual(checked.authoredCells, "5708", "recommended hierarchy final cells");
		assertEqual(checked.staticFabOrganizations, "27", "recommended hierarchy final records");
		assertEqual(checked.staticFabCheckStatus, "ready", "recommended hierarchy Checks status");
		assertEqual(checked.staticFabCheckIssues, "0", "recommended hierarchy Checks issues");
		assertEqual(checked.staticFabCheckActions, "0", "recommended hierarchy Checks actions");
		assertEqual(checked.readinessReady, "true", "recommended hierarchy static readiness");
		assertEqual(checked.workerSimulationReady, "false", "recommended hierarchy simulation gate");
		assertEqual(
			checked.workerChecksum,
			checked.modelChecksum,
			"recommended hierarchy exact source",
		);
		assertEqual(
			await checks.getAttribute("data-status"),
			"ready",
			"recommended hierarchy Checks panel status",
		);
		await page.screenshot({
			path: path.join(artifactRoot, "certified-starter-recommended-hierarchy-390x844.png"),
			fullPage: true,
		});
		return {
			cells: Number(checked.authoredCells),
			organizations: Number(checked.staticFabOrganizations),
			issues: Number(checked.staticFabCheckIssues),
			interbayAttempts: interbay.attempts,
			fabLoopAttempts: fabLoop.attempts,
			interbayChecksum: interbay.applied.workerChecksum,
			fabLoopChecksum: fabLoop.applied.workerChecksum,
			simulationReady: checked.workerSimulationReady,
		};
	} finally {
		if (page) {
			await page
				.screenshot({
					path: path.join(artifactRoot, "certified-starter-recommended-hierarchy-last-state.png"),
					fullPage: true,
				})
				.catch(() => undefined);
			await closeBrowserResource(page, "recommended hierarchy page");
		}
		await closeBrowserResource(context, "recommended hierarchy context");
	}
}

async function waitForPrimedOrganizationDuplicate(page) {
	await page.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.organizationBundlePreviewState === "candidate" &&
				Boolean(canvas.dataset.organizationBundlePreviewAnchor) &&
				Boolean(canvas.dataset.organizationBundleSourceBounds)
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const metrics = await readMetrics(page);
	const sourceBounds = parseIntegerTuple(
		metrics.organizationBundleSourceBounds,
		4,
		"source bounds",
	);
	const previewAnchor = parseIntegerTuple(
		metrics.organizationBundlePreviewAnchor,
		2,
		"preview anchor",
	);
	const [minX, minY, maxX, maxY] = sourceBounds;
	const [anchorX, anchorY] = previewAnchor;
	return Object.freeze({
		x: anchorX + Math.round((maxX - minX) / 2),
		y: anchorY + Math.round((maxY - minY) / 2),
	});
}

function parseIntegerTuple(encoded, length, label) {
	const values = encoded.split(",").map(Number);
	if (values.length !== length || values.some((value) => !Number.isSafeInteger(value))) {
		throw new Error(`${label} is invalid: ${JSON.stringify(encoded)}.`);
	}
	return values;
}

async function selectOrganizationsThroughAssemble(page, organizationIds) {
	if (organizationIds.length === 0)
		throw new Error("Organization selection requires one or more IDs.");
	const menu = page.getByTestId("static-fab-assemble-menu");
	await openStaticFabAssembleMenu(page, menu, "recommended hierarchy selection");
	await menu.getByTestId("assemble-browse-organizations").click();
	const library = page.getByTestId("static-fab-organization-library");
	await library.waitFor({ state: "visible" });
	for (let index = 0; index < organizationIds.length; index += 1) {
		const option = library.locator(
			`[role="option"][data-organization-id="${organizationIds[index]}"]`,
		);
		await option.waitFor({ state: "visible" });
		await option.click(index === 0 ? undefined : { modifiers: ["Meta"] });
	}
	await library.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
	await page.waitForFunction(
		(expected) =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-organization-selection-count") === String(expected),
		organizationIds.length,
		{ timeout: 10_000 },
	);
}

async function applyRecommendedAssemblyConnector(
	page,
	{ purpose, expectedOrganizationDelta, label },
) {
	const menu = page.getByTestId("static-fab-assemble-menu");
	await openStaticFabAssembleMenu(page, menu, label);
	const start = menu.getByTestId("assemble-connect-selected-bays");
	assertEqual(await start.isEnabled(), true, `${label} command available`);
	const before = await readMetrics(page);
	await start.click();
	const panel = page.getByTestId("static-fab-assembly-connector-panel");
	await panel.waitFor({ state: "visible" });
	await page.waitForFunction(
		(expectedPurpose) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const connector = document.querySelector(
				'[data-testid="static-fab-assembly-connector-panel"]',
			);
			return (
				app?.getAttribute("data-assembly-connector-phase") === "ready" &&
				app.dataset.assemblyConnectorRecommendationStatus === "ready" &&
				connector?.getAttribute("data-purpose") === expectedPurpose
			);
		},
		purpose,
		{ timeout: 30_000 },
	);
	const ready = await readMetrics(page);
	assertProjectUnchanged(ready, before, `${label} review-before-Apply`);
	assertEqual(ready.assemblyConnectorSnapshotStatus, "hydrated", `${label} snapshot hydration`);
	assertEqual(
		ready.assemblyConnectorRecommendationStatus,
		"ready",
		`${label} recommendation status`,
	);
	const attempts = requiredPositiveIntegerAttribute(
		ready.assemblyConnectorRecommendationAttempts,
		`${label} recommendation attempts`,
	);
	assertEqual(await panel.getAttribute("data-hierarchy-role"), "BANK_TO_FAB", `${label} role`);
	assertEqual(await panel.getAttribute("data-purpose"), purpose, `${label} purpose`);
	const apply = panel.locator(".tilefab-assembly-connector-apply");
	assertEqual(await apply.isEnabled(), true, `${label} Apply available`);
	await apply.click();
	const applied = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1 &&
			Number(metrics.staticFabOrganizations) ===
				Number(before.staticFabOrganizations) + expectedOrganizationDelta,
		{ timeout: 30_000 },
	);
	assertEqual(applied.workerChecksum, applied.workerTargetChecksum, `${label} target checksum`);
	assertEqual(applied.workerChecksum, applied.modelChecksum, `${label} model checksum`);
	assertEqual(applied.workerSimulationReady, "false", `${label} simulation gate`);
	return Object.freeze({ before, ready, applied, attempts });
}

async function applyRecommendedAssemblyConnectorFromButton(
	page,
	{ button, hierarchyRole, purpose, expectedOrganizationDelta, label, readyScreenshot },
) {
	assertEqual(await button.isEnabled(), true, `${label} command available`);
	const before = await readMetrics(page);
	await button.click();
	const panel = page.getByTestId("static-fab-assembly-connector-panel");
	await panel.waitFor({ state: "visible" });
	await page.waitForFunction(
		(expected) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const connector = document.querySelector(
				'[data-testid="static-fab-assembly-connector-panel"]',
			);
			return (
				app?.getAttribute("data-assembly-connector-phase") === "ready" &&
				app.dataset.assemblyConnectorRecommendationStatus === "ready" &&
				connector?.getAttribute("data-hierarchy-role") === expected.hierarchyRole &&
				connector.getAttribute("data-purpose") === expected.purpose
			);
		},
		{ hierarchyRole, purpose },
		{ timeout: 30_000 },
	);
	const ready = await readMetrics(page);
	assertProjectUnchanged(ready, before, `${label} review-before-Apply`);
	assertEqual(ready.assemblyConnectorSnapshotStatus, "hydrated", `${label} snapshot hydration`);
	assertEqual(
		ready.assemblyConnectorRecommendationStatus,
		"ready",
		`${label} recommendation status`,
	);
	const attempts = requiredPositiveIntegerAttribute(
		ready.assemblyConnectorRecommendationAttempts,
		`${label} recommendation attempts`,
	);
	assertAtMost(attempts, 8, `${label} recommendation bound`);
	assertEqual(await panel.getAttribute("data-hierarchy-role"), hierarchyRole, `${label} role`);
	assertEqual(await panel.getAttribute("data-purpose"), purpose, `${label} purpose`);
	assertEqual(
		await panel.locator(".tilefab-assembly-connector-result").count(),
		1,
		`${label} certified result count`,
	);
	const apply = panel.locator(".tilefab-assembly-connector-apply");
	assertEqual(await apply.isEnabled(), true, `${label} Apply available`);
	if (readyScreenshot) {
		await page.screenshot({
			path: path.join(artifactRoot, readyScreenshot),
			fullPage: true,
		});
	}
	await apply.click();
	const applied = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1 &&
			Number(metrics.staticFabOrganizations) ===
				Number(before.staticFabOrganizations) + expectedOrganizationDelta,
		{ timeout: 30_000 },
	);
	assertEqual(applied.workerChecksum, applied.workerTargetChecksum, `${label} target checksum`);
	assertEqual(applied.workerChecksum, applied.modelChecksum, `${label} model checksum`);
	assertEqual(applied.workerSimulationReady, "false", `${label} simulation gate`);
	return Object.freeze({ before, ready, applied, attempts });
}

async function readCertifiedStarterHierarchy(page) {
	return page.evaluate(() => {
		const organizations = window.__tileFab?.getDocument().organizations;
		if (!organizations) throw new Error("Certified starter organizations are unavailable.");
		const records = organizations.records;
		const byId = new Map(records.map((record) => [record.id, record]));
		const childrenByParentId = new Map();
		for (const record of records) {
			for (const parentId of record.parentOrganizationIds ?? []) {
				const children = childrenByParentId.get(parentId);
				if (children) children.push(record);
				else childrenByParentId.set(parentId, [record]);
			}
		}
		const banks = records.filter((record) => {
			const children = childrenByParentId.get(record.id) ?? [];
			return (
				record.kind === "AREA" &&
				children.length > 0 &&
				children.every((child) => child.kind === "BAY")
			);
		});
		const bankIds = new Set(banks.map((record) => record.id));
		const fabs = records.filter((record) => {
			const children = childrenByParentId.get(record.id) ?? [];
			return (
				record.kind === "AREA" &&
				children.length > 0 &&
				children.every((child) => bankIds.has(child.id))
			);
		});
		return {
			bankIds: banks.map((record) => record.id).sort((left, right) => left - right),
			fabIds: fabs.map((record) => record.id).sort((left, right) => left - right),
			bankParentIds: banks.map((record) => ({
				id: record.id,
				parentIds: [...(record.parentOrganizationIds ?? [])].sort((left, right) => left - right),
			})),
			fabDirectEdgeCounts: fabs.map((record) => record.membership.railEdges.length),
			missingParents: records
				.flatMap((record) => record.parentOrganizationIds ?? [])
				.filter((parentId) => !byId.has(parentId)).length,
		};
	});
}

function assertCertifiedTwoBankFab(hierarchy, label) {
	assertEqual(hierarchy.bankIds.length, 2, `${label} Bank count`);
	assertEqual(hierarchy.fabIds.length, 1, `${label} Fab count`);
	assertEqual(hierarchy.missingParents, 0, `${label} missing parent count`);
	const fabId = hierarchy.fabIds[0];
	for (const bank of hierarchy.bankParentIds) {
		assertEqual(JSON.stringify(bank.parentIds), JSON.stringify([fabId]), `${label} Bank parent`);
	}
}

function assertProjectUnchanged(actual, expected, phase) {
	for (const key of [
		"physicalPaths",
		"projectId",
		"projectName",
		"projectDirty",
		"modelSequence",
		"modelRevision",
		"modelChecksum",
		"modelPhysicalFingerprint",
		"workerTargetSequence",
		"workerTargetRevision",
		"workerTargetChecksum",
		"workerSequence",
		"workerRevision",
		"workerChecksum",
		"workerPhysicalSequence",
		"workerPhysicalRevision",
		"workerPhysicalFingerprint",
		"equipmentGroups",
		"equipmentPorts",
		"projectBlueprints",
		"staticFabOrganizations",
		"historyCanUndo",
		"historyCanRedo",
	]) {
		assertEqual(actual[key], expected[key], `${phase} ${key}`);
	}
}

async function waitForEditorStatus(page, expectedText) {
	await page
		.locator(".tilefab-statusbar [role='status']")
		.filter({ hasText: expectedText })
		.waitFor({ state: "visible", timeout: 10_000 });
}

async function exerciseStaticFabNavigator(page) {
	const before = await readMetrics(page);
	await page.getByRole("button", { name: "FAB 전체 지도", exact: true }).click();
	const panel = page.getByTestId("static-fab-navigator-panel");
	await panel.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-editor-activity"),
		"inspect",
		"navigator enters the Inspect activity",
	);
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-editor-tool"),
		"inspect",
		"navigator enters the Inspect tool",
	);
	assertEqual(
		await page.getByTestId("rail-buildbar").count(),
		0,
		"navigator hides the rail construction bar",
	);
	const minimap = page.getByTestId("static-fab-minimap");
	await minimap.waitFor({ state: "visible" });
	const pixelsHandle = await page.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="static-fab-minimap"]');
			const context = canvas?.getContext("2d");
			if (!canvas || !context || canvas.width === 0 || canvas.height === 0) return false;
			const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let railLike = 0;
			for (let offset = 0; offset < image.length; offset += 4) {
				if ((image[offset + 1] ?? 0) > 24 && (image[offset + 2] ?? 0) > 24) railLike++;
			}
			return railLike >= 100 ? { width: canvas.width, height: canvas.height, railLike } : false;
		},
		undefined,
		{ timeout: 10_000 },
	);
	const pixels = await pixelsHandle.jsonValue();
	assertAtLeast(pixels.width, 1, "navigator backing width");
	assertAtLeast(pixels.height, 1, "navigator backing height");
	assertAtLeast(pixels.railLike, 100, "navigator rendered rail silhouette pixels");
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-navigator-tab"),
		"map",
		"navigator MAP tab state",
	);

	const minimapBox = await minimap.boundingBox();
	if (!minimapBox) throw new Error("Navigator minimap has no interactive bounds.");
	await page.mouse.click(
		minimapBox.x + minimapBox.width * 0.6,
		minimapBox.y + minimapBox.height * 0.5,
	);
	await page.waitForFunction(
		(expected) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.cameraOffsetX !== expected.x || canvas?.dataset.cameraOffsetY !== expected.y
			);
		},
		{ x: before.cameraOffsetX, y: before.cameraOffsetY },
		{ timeout: 10_000 },
	);
	const afterPan = await readMetrics(page);
	assertProjectUnchanged(afterPan, before, "navigator camera pan");
	assertNotEqual(
		`${afterPan.cameraOffsetX}:${afterPan.cameraOffsetY}`,
		`${before.cameraOffsetX}:${before.cameraOffsetY}`,
		"navigator camera position",
	);

	await page.getByTestId("static-fab-navigator-tab-map").press("ArrowRight");
	const organizationLibrary = page.getByTestId("static-fab-organization-library");
	await organizationLibrary.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-navigator-tab"),
		"organizations",
		"navigator ORGANIZATIONS keyboard tab",
	);
	await page.waitForFunction(
		() =>
			document.activeElement?.getAttribute("data-testid") ===
			"static-fab-navigator-tab-organizations",
	);
	assertEqual(await page.getByTestId("static-fab-minimap").count(), 1, "organization minimap");
	await page.getByTestId("static-fab-navigator-tab-organizations").press("ArrowRight");
	const readinessPanel = page.getByTestId("rail-readiness-panel");
	await readinessPanel.waitFor({ state: "visible" });
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-navigator-tab"),
		"checks",
		"navigator CHECKS keyboard tab",
	);
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "static-fab-navigator-tab-checks",
	);
	assertEqual(await page.getByTestId("static-fab-minimap").count(), 1, "readiness minimap");
	await page.waitForFunction(
		() => {
			const status = document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-static-fab-check-status");
			return status !== null && status !== undefined && status !== "checking";
		},
		undefined,
		{ timeout: 30_000 },
	);
	const wholeProjectChecks = await page.getByTestId("tilefab-app").evaluate((app) => ({
		statusAttribute: app.getAttribute("data-static-fab-check-status"),
		actionCountAttribute: app.getAttribute("data-static-fab-check-actions"),
		checkCountAttribute: app.getAttribute("data-static-fab-check-issues"),
	}));
	if (
		wholeProjectChecks.statusAttribute === null ||
		!["ready", "issues", "error"].includes(wholeProjectChecks.statusAttribute)
	) {
		throw new Error(
			`whole-project data-check-status: expected ready, issues, or error, received ${JSON.stringify(wholeProjectChecks.statusAttribute)}`,
		);
	}
	const wholeProjectCheckActions = requiredNonNegativeIntegerAttribute(
		wholeProjectChecks.actionCountAttribute,
		"whole-project data-check-action-count",
	);
	const wholeProjectCheckCount = requiredNonNegativeIntegerAttribute(
		wholeProjectChecks.checkCountAttribute,
		"whole-project data-check-count",
	);
	assertNotEqual(
		wholeProjectChecks.statusAttribute,
		"error",
		"whole-project static FAB checks status",
	);
	assertAtLeast(wholeProjectCheckActions, 0, "whole-project static FAB check actions");
	assertAtLeast(
		wholeProjectCheckCount,
		wholeProjectCheckActions,
		"whole-project static FAB check issues",
	);
	const panelCheckAttributes = await readinessPanel.evaluate((panel) => ({
		statusAttribute: panel.getAttribute("data-status"),
		checkCountAttribute: panel.getAttribute("data-check-issues"),
	}));
	assertEqual(
		panelCheckAttributes.statusAttribute,
		wholeProjectChecks.statusAttribute,
		"CHECKS panel data-check-status",
	);
	assertEqual(
		requiredNonNegativeIntegerAttribute(
			panelCheckAttributes.checkCountAttribute,
			"CHECKS panel data-check-count",
		),
		wholeProjectCheckCount,
		"CHECKS panel data-check-count consistency",
	);
	const exactSourceValue = await readinessPanel.evaluate((panel) => {
		const label = Array.from(panel.querySelectorAll("dt")).find(
			(element) => element.textContent?.trim() === "EXACT SOURCE",
		);
		return label?.parentElement?.querySelector("dd")?.textContent?.trim() ?? null;
	});
	assertEqual(exactSourceValue, "MATCHED", "whole-project exact source contract");

	await page.setViewportSize({ width: 720, height: 900 });
	await page.waitForTimeout(100);
	const compact = await page.evaluate(() => {
		const panel = document.querySelector('[data-testid="rail-readiness-panel"]');
		const buildbar = document.querySelector(".tilefab-buildbar");
		const panelBounds = panel?.getBoundingClientRect();
		const buildbarBounds = buildbar?.getBoundingClientRect();
		return {
			horizontalOverflow:
				document.documentElement.scrollWidth - document.documentElement.clientWidth,
			overlap:
				Boolean(panelBounds) &&
				Boolean(buildbarBounds) &&
				panelBounds.bottom > buildbarBounds.y &&
				panelBounds.y < buildbarBounds.bottom &&
				panelBounds.right > buildbarBounds.x &&
				panelBounds.x < buildbarBounds.right,
		};
	});
	assertAtMost(compact.horizontalOverflow, 0, "compact navigator horizontal overflow");
	assertEqual(compact.overlap, false, "compact navigator/buildbar overlap");
	await page.screenshot({
		path: path.join(artifactRoot, "static-fab-navigator-compact.png"),
		fullPage: true,
	});

	await page.setViewportSize({ width: 1440, height: 900 });
	await page.waitForTimeout(100);
	await readinessPanel
		.getByRole("button", { name: "정적 FAB 검사 패널 닫기", exact: true })
		.click();
	await readinessPanel.waitFor({ state: "hidden" });
	assertEqual(
		await page.getByTestId("tilefab-app").getAttribute("data-navigator-tab"),
		"",
		"navigator close state",
	);
	assertProjectUnchanged(await readMetrics(page), before, "navigator tab workflow");
	await exerciseFocusedStaticFabProjectChecks(page.context());
}

async function exerciseFocusedStaticFabProjectChecks(context) {
	const fixturePlans = await createHierarchyAmbiguityFixturePlans();
	const page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") result.consoleErrors.push(`[focused-checks] ${message.text()}`);
	});
	page.on("pageerror", (error) => result.pageErrors.push(`[focused-checks] ${error.message}`));
	try {
		await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
		await waitForReady(page, { physicalPaths: 0 });
		await loadLegacyLargeFabAcceptanceFixture(page);

		let finalDirectCommit = null;
		for (const [index, plan] of fixturePlans.entries()) {
			const commit = await page.evaluate((candidate) => {
				const document = window.__tileFab?.getDocument();
				if (!document) return null;
				const beforeSequence = document.getPatchSequence();
				const beforeRevision = document.map.getRevision();
				const committed = document.commit(candidate);
				return {
					committed,
					beforeSequence,
					beforeRevision,
					afterSequence: document.getPatchSequence(),
					afterRevision: document.map.getRevision(),
					commandError: document.getLastCommandError(),
				};
			}, plan);
			if (!commit) throw new Error(`Focused CHECKS fixture ${index + 1} has no document.`);
			assertEqual(commit.committed, true, `focused CHECKS fixture mutation ${index + 1}`);
			assertEqual(commit.commandError, null, `focused CHECKS fixture error ${index + 1}`);
			assertEqual(
				commit.afterSequence,
				commit.beforeSequence + 1,
				`focused CHECKS fixture sequence ${index + 1}`,
			);
			assertAtLeast(
				commit.afterRevision,
				commit.beforeRevision + 1,
				`focused CHECKS fixture revision ${index + 1}`,
			);
			finalDirectCommit = commit;
		}
		if (!finalDirectCommit) throw new Error("Focused CHECKS fixture has no committed plans.");

		// Direct fixture commits deliberately bypass React. One undo/redo round trip routes the final
		// state through the real editor history command and Worker-derived model activation boundary.
		await page.keyboard.press("Meta+z");
		const undoSource = await page.evaluate(() => {
			const document = window.__tileFab?.getDocument();
			return document
				? {
						sequence: document.getPatchSequence(),
						revision: document.map.getRevision(),
					}
				: null;
		});
		if (!undoSource) throw new Error("Focused CHECKS undo source is unavailable.");
		assertEqual(
			undoSource.sequence,
			finalDirectCommit.afterSequence + 1,
			"focused CHECKS fixture undo sequence",
		);
		await waitForWorker(page, (metrics) => {
			return (
				metrics.modelSyncPending === "false" &&
				metrics.workerSequence === String(undoSource.sequence) &&
				metrics.workerRevision === String(undoSource.revision)
			);
		});

		await page.keyboard.press("Meta+Shift+z");
		const redoSource = await page.evaluate(() => {
			const document = window.__tileFab?.getDocument();
			return document
				? {
						sequence: document.getPatchSequence(),
						revision: document.map.getRevision(),
					}
				: null;
		});
		if (!redoSource) throw new Error("Focused CHECKS redo source is unavailable.");
		assertEqual(
			redoSource.sequence,
			undoSource.sequence + 1,
			"focused CHECKS fixture redo sequence",
		);
		await waitForWorker(page, (metrics) => {
			return (
				metrics.modelSyncPending === "false" &&
				metrics.workerSequence === String(redoSource.sequence) &&
				metrics.workerRevision === String(redoSource.revision)
			);
		});

		await page.setViewportSize({ width: 390, height: 844 });
		await page.waitForTimeout(100);
		const checksToggle = page.getByTestId("rail-readiness-toggle");
		await assertLocatorInsideViewport(page, checksToggle);
		await checksToggle.click();
		const readinessPanel = page.getByTestId("rail-readiness-panel");
		await readinessPanel.waitFor({ state: "visible" });
		await page.waitForFunction(
			() => {
				const status = document
					.querySelector('[data-testid="tilefab-app"]')
					?.getAttribute("data-static-fab-check-status");
				return status === "ready" || status === "issues" || status === "error";
			},
			undefined,
			{ timeout: 30_000 },
		);
		const focusedCheckIdentity = await page.getByTestId("tilefab-app").evaluate((app) => ({
			statusAttribute: app.getAttribute("data-static-fab-check-status"),
			checkCountAttribute: app.getAttribute("data-static-fab-check-issues"),
		}));
		assertEqual(focusedCheckIdentity.statusAttribute, "issues", "focused CHECKS terminal status");
		assertAtLeast(
			requiredNonNegativeIntegerAttribute(
				focusedCheckIdentity.checkCountAttribute,
				"focused CHECKS data-check-count",
			),
			1,
			"focused CHECKS issue count",
		);
		const focusedProjectIssue = readinessPanel.locator(
			'[data-testid^="static-fab-project-issue-"][data-code="HIERARCHY_AMBIGUOUS"]',
		);
		assertEqual(await focusedProjectIssue.count(), 1, "stable hierarchy project issue");
		await focusedProjectIssue.click();
		const focusedProjectGuide = page.getByTestId("static-fab-project-check-guide");
		await focusedProjectGuide.waitFor({ state: "visible" });
		assertEqual(
			await focusedProjectIssue.getAttribute("data-active"),
			"true",
			"390 px focused project issue",
		);
		assertEqual(
			await readinessPanel.getAttribute("data-focused"),
			"true",
			"390 px focused CHECKS panel state",
		);
		const mobileClose = readinessPanel.getByRole("button", {
			name: "정적 FAB 검사 패널 닫기",
			exact: true,
		});
		await assertLocatorInsideViewport(page, mobileClose);
		await assertLocatorInsideViewport(page, focusedProjectGuide);
		const focusedMobile = await page.evaluate(() => {
			const panel = document.querySelector('[data-testid="rail-readiness-panel"]');
			const guide = document.querySelector('[data-testid="static-fab-project-check-guide"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const buildbar = document.querySelector(".tilefab-buildbar");
			const tools = document.querySelector(".tilefab-tools");
			const close = panel?.querySelector('button[aria-label="정적 FAB 검사 패널 닫기"]');
			if (!panel || !guide || !canvas || !close) return null;
			const isVisible = (element) => {
				const bounds = element.getBoundingClientRect();
				const style = getComputedStyle(element);
				return (
					bounds.width > 0 &&
					bounds.height > 0 &&
					style.display !== "none" &&
					style.visibility !== "hidden"
				);
			};
			const intersects = (left, right) =>
				left.bottom > right.top &&
				left.top < right.bottom &&
				left.right > right.left &&
				left.left < right.right;
			const panelBounds = panel.getBoundingClientRect();
			const guideBounds = guide.getBoundingClientRect();
			const canvasBounds = canvas.getBoundingClientRect();
			const buildbarBounds =
				buildbar && isVisible(buildbar) ? buildbar.getBoundingClientRect() : null;
			const toolsBounds = tools && isVisible(tools) ? tools.getBoundingClientRect() : null;
			const closeBounds = close.getBoundingClientRect();
			const panelStyle = getComputedStyle(panel);
			const panelIsBottomSheet =
				panelBounds.width >= canvasBounds.width * 0.75 && panelBounds.top >= canvasBounds.top + 80;
			const mapLeft = Math.max(
				canvasBounds.left,
				toolsBounds && intersects(toolsBounds, canvasBounds)
					? toolsBounds.right + 8
					: canvasBounds.left,
			);
			const mapRight = panelIsBottomSheet
				? canvasBounds.right
				: Math.min(canvasBounds.right, panelBounds.left - 8);
			const mapBottom = panelIsBottomSheet
				? Math.min(canvasBounds.bottom, panelBounds.top - 8)
				: canvasBounds.bottom;
			const locationText =
				guide.querySelector(".tilefab-readiness-location-nav span")?.textContent ?? "";
			const locationMatch = locationText.match(
				/X\s+(-?\d+(?:\.\d+)?)(?:\s+TO\s+(-?\d+(?:\.\d+)?))?\s+·\s+Z\s+(-?\d+(?:\.\d+)?)(?:\s+TO\s+(-?\d+(?:\.\d+)?))?/,
			);
			const camera = window.__tileFab?.camera;
			let focusedScreenPoint = null;
			if (locationMatch && camera) {
				const minX = Number(locationMatch[1]);
				const maxX = locationMatch[2] === undefined ? minX + 1 : Number(locationMatch[2]);
				const minZ = Number(locationMatch[3]);
				const maxZ = locationMatch[4] === undefined ? minZ + 1 : Number(locationMatch[4]);
				focusedScreenPoint = {
					x: canvasBounds.left + Number(camera.offsetX) + ((minX + maxX) / 2) * Number(camera.zoom),
					y: canvasBounds.top + Number(camera.offsetY) + ((minZ + maxZ) / 2) * Number(camera.zoom),
				};
			}
			const closeHit = document.elementFromPoint(
				closeBounds.left + closeBounds.width / 2,
				closeBounds.top + closeBounds.height / 2,
			);
			return {
				viewportWidth: window.innerWidth,
				viewportHeight: window.innerHeight,
				documentHorizontalOverflow:
					document.documentElement.scrollWidth - document.documentElement.clientWidth,
				panelHorizontalOverflow: panel.scrollWidth - panel.clientWidth,
				guideHorizontalOverflow: guide.scrollWidth - guide.clientWidth,
				panelVerticalOverflowHandled:
					panel.scrollHeight <= panel.clientHeight + 1 ||
					panelStyle.overflowY === "auto" ||
					panelStyle.overflowY === "scroll",
				panelInsideViewport:
					panelBounds.left >= 0 &&
					panelBounds.top >= 0 &&
					panelBounds.right <= window.innerWidth &&
					panelBounds.bottom <= window.innerHeight,
				panelIsBottomSheet,
				buildbarOverlap: buildbarBounds ? intersects(panelBounds, buildbarBounds) : false,
				visibleMapWidth: Math.max(0, mapRight - mapLeft),
				visibleMapHeight: Math.max(0, mapBottom - canvasBounds.top),
				mapLeft,
				mapRight,
				mapTop: canvasBounds.top,
				mapBottom,
				focusedScreenPoint,
				locationText,
				closeAccessibleName: close.getAttribute("aria-label"),
				closeDisabled: close.disabled,
				closeHitTarget: closeHit !== null && close.contains(closeHit),
				closeWidth: closeBounds.width,
				closeHeight: closeBounds.height,
				guideInsidePanelHorizontally:
					guideBounds.left >= panelBounds.left - 1 && guideBounds.right <= panelBounds.right + 1,
			};
		});
		if (!focusedMobile) throw new Error("390 px focused CHECKS audit could not resolve its UI.");
		assertEqual(focusedMobile.viewportWidth, 390, "focused CHECKS viewport width");
		assertEqual(focusedMobile.viewportHeight, 844, "focused CHECKS viewport height");
		assertEqual(focusedMobile.panelInsideViewport, true, "focused CHECKS panel viewport bounds");
		assertEqual(focusedMobile.panelIsBottomSheet, true, "focused CHECKS bottom-sheet layout");
		assertEqual(focusedMobile.buildbarOverlap, false, "focused CHECKS/buildbar overlap");
		assertAtLeast(
			focusedMobile.visibleMapWidth,
			focusedMobile.viewportWidth * 0.6,
			"focused CHECKS visible map width",
		);
		assertAtLeast(
			focusedMobile.visibleMapHeight,
			focusedMobile.viewportHeight * 0.18,
			"focused CHECKS visible map height",
		);
		assertAtMost(
			focusedMobile.documentHorizontalOverflow,
			0,
			"focused CHECKS document horizontal overflow",
		);
		assertAtMost(
			focusedMobile.panelHorizontalOverflow,
			1,
			"focused CHECKS panel horizontal overflow",
		);
		assertAtMost(
			focusedMobile.guideHorizontalOverflow,
			1,
			"focused project guide horizontal overflow",
		);
		assertEqual(
			focusedMobile.panelVerticalOverflowHandled,
			true,
			"focused CHECKS vertical overflow handling",
		);
		assertEqual(
			focusedMobile.guideInsidePanelHorizontally,
			true,
			"focused project guide panel bounds",
		);
		assertEqual(
			focusedMobile.closeAccessibleName,
			"정적 FAB 검사 패널 닫기",
			"focused CHECKS close accessible name",
		);
		assertEqual(focusedMobile.closeDisabled, false, "focused CHECKS close enabled state");
		assertEqual(focusedMobile.closeHitTarget, true, "focused CHECKS close hit target");
		assertAtLeast(focusedMobile.closeWidth, 44, "focused CHECKS close target width");
		assertAtLeast(focusedMobile.closeHeight, 44, "focused CHECKS close target height");
		if (!focusedMobile.focusedScreenPoint) {
			throw new Error(
				`390 px focused project guide did not expose a usable location: ${JSON.stringify(focusedMobile.locationText)}`,
			);
		}
		const focusedHorizontalMargin = Math.min(40, focusedMobile.visibleMapWidth * 0.15);
		const focusedVerticalMargin = Math.min(32, focusedMobile.visibleMapHeight * 0.15);
		assertAtLeast(
			focusedMobile.focusedScreenPoint.x,
			focusedMobile.mapLeft + focusedHorizontalMargin,
			"focused project issue horizontal viewport start",
		);
		assertAtMost(
			focusedMobile.focusedScreenPoint.x,
			focusedMobile.mapRight - focusedHorizontalMargin,
			"focused project issue horizontal viewport end",
		);
		assertAtLeast(
			focusedMobile.focusedScreenPoint.y,
			focusedMobile.mapTop + focusedVerticalMargin,
			"focused project issue vertical viewport start",
		);
		assertAtMost(
			focusedMobile.focusedScreenPoint.y,
			focusedMobile.mapBottom - focusedVerticalMargin,
			"focused project issue vertical viewport end",
		);
		await page.screenshot({
			path: path.join(artifactRoot, "static-fab-checks-focused-390px.png"),
			fullPage: true,
		});

		const beforeClose = await page.evaluate(() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const toggle = document.querySelector('[data-testid="rail-readiness-toggle"]');
			const authoredDocument = window.__tileFab?.getDocument();
			if (!app || !toggle || !authoredDocument) return null;
			return {
				statusAttribute: app.getAttribute("data-static-fab-check-status"),
				checkCountAttribute: app.getAttribute("data-static-fab-check-issues"),
				toggleText: toggle.textContent?.replace(/\s+/g, " ").trim() ?? "",
				sourceRevision: authoredDocument.map.getRevision(),
				sourceSequence: authoredDocument.getPatchSequence(),
			};
		});
		if (!beforeClose) throw new Error("Focused CHECKS close identity is unavailable.");
		requiredNonNegativeIntegerAttribute(
			beforeClose.checkCountAttribute,
			"focused CHECKS pre-close data-check-count",
		);
		await mobileClose.click();
		await readinessPanel.waitFor({ state: "hidden" });
		await page.waitForFunction(
			() => document.activeElement?.getAttribute("data-testid") === "rail-readiness-toggle",
			undefined,
			{ timeout: 5_000 },
		);
		const afterClose = await page.evaluate(() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const toggle = document.querySelector('[data-testid="rail-readiness-toggle"]');
			const authoredDocument = window.__tileFab?.getDocument();
			return {
				panelCount: document.querySelectorAll('[data-testid="rail-readiness-panel"]').length,
				statusAttribute: app?.getAttribute("data-static-fab-check-status") ?? null,
				checkCountAttribute: app?.getAttribute("data-static-fab-check-issues") ?? null,
				toggleText: toggle?.textContent?.replace(/\s+/g, " ").trim() ?? "",
				toggleExpanded: toggle?.getAttribute("aria-expanded") ?? null,
				activeTestId: document.activeElement?.getAttribute("data-testid") ?? null,
				navigatorTab: app?.getAttribute("data-navigator-tab") ?? null,
				sourceRevision: authoredDocument?.map.getRevision() ?? null,
				sourceSequence: authoredDocument?.getPatchSequence() ?? null,
			};
		});
		assertEqual(afterClose.panelCount, 0, "focused CHECKS panel removed after close");
		assertEqual(
			afterClose.statusAttribute,
			beforeClose.statusAttribute,
			"focused CHECKS status survives close",
		);
		assertEqual(
			afterClose.checkCountAttribute,
			beforeClose.checkCountAttribute,
			"focused CHECKS count survives close",
		);
		assertEqual(
			afterClose.toggleText,
			beforeClose.toggleText,
			"focused CHECKS topbar meaning survives close",
		);
		assertEqual(
			afterClose.sourceRevision,
			beforeClose.sourceRevision,
			"focused CHECKS source revision survives close",
		);
		assertEqual(
			afterClose.sourceSequence,
			beforeClose.sourceSequence,
			"focused CHECKS source sequence survives close",
		);
		assertEqual(afterClose.toggleExpanded, "false", "focused CHECKS toggle collapsed state");
		assertEqual(afterClose.activeTestId, "rail-readiness-toggle", "focused CHECKS focus return");
		assertEqual(afterClose.navigatorTab, "", "focused CHECKS navigator close state");
	} finally {
		await page.close();
	}
}

async function createHierarchyAmbiguityFixturePlans() {
	const { createServer } = await import("vite");
	const vite = await createServer({
		root,
		appType: "custom",
		logLevel: "silent",
		server: { middlewareMode: true },
	});
	try {
		const starter = await vite.ssrLoadModule("/src/tilefab/compile/SyntheticFabStarter.ts");
		const hierarchy = await vite.ssrLoadModule("/src/tilefab/compile/StaticFabHierarchy.ts");
		const ownership = await vite.ssrLoadModule("/src/tilefab/core/RailModuleOwnership.ts");
		const edit = await vite.ssrLoadModule("/src/tilefab/core/edit.ts");
		const build = starter.buildSyntheticFabStarter(
			starter.defaultSyntheticFabStarterRequest("large-fab-60"),
		);
		const fixtureEntityIds = ["IMPLANT", "METAL-BACK"];
		const plans = [];
		for (const entityId of fixtureEntityIds) {
			const step = build.steps.find(
				(candidate) => candidate.kind === "network-link" && candidate.entityId === entityId,
			);
			if (!step?.anchor) {
				throw new Error(`Focused CHECKS fixture cannot resolve ${entityId} branch anchor.`);
			}
			const plan = edit.planRemoveBranchRoute(build.document.map, step.anchor);
			if (!plan.valid) {
				throw new Error(`Focused CHECKS fixture cannot remove ${entityId}: ${plan.reason}`);
			}
			plans.push(JSON.parse(JSON.stringify(plan)));
			if (!build.document.commit(plan)) {
				throw new Error(
					`Focused CHECKS fixture failed to commit ${entityId}: ${build.document.getLastCommandError() ?? "unknown command error"}`,
				);
			}
		}
		const compiled = hierarchy.compileStaticFabHierarchyIndex(
			build.document.map,
			ownership.buildRailModuleOwnershipIndex(build.document.map),
		);
		const ambiguousBranches = compiled.branches.filter(
			(branch) => branch.processRowPairing.state === "ambiguous",
		);
		assertEqual(ambiguousBranches.length, 1, "focused CHECKS hierarchy ambiguity fixture");
		return Object.freeze(plans);
	} finally {
		await vite.close();
	}
}

async function assertWorkerMirrorReady(page, phase) {
	const metrics = await readMetrics(page);
	if (!workerIsSettled(metrics)) {
		throw new Error(`${phase} did not settle the Worker mirror: ${JSON.stringify(metrics)}.`);
	}
	const status = page.getByTestId("rail-worker-status");
	assertEqual(await status.getAttribute("data-state"), "ready", `${phase} Worker status state`);
	assertEqual(
		(await status.textContent())?.replace(/\s+/g, " ").trim(),
		"MIRROR READY",
		`${phase} visible Worker status`,
	);
}

async function assertOrganizationEditorLayout(page, expectedViewport, expectedTab) {
	const viewport = page.viewportSize();
	assertEqual(viewport?.width, expectedViewport.width, `${expectedTab} viewport width`);
	assertEqual(viewport?.height, expectedViewport.height, `${expectedTab} viewport height`);
	const library = page.getByTestId("static-fab-organization-library");
	await library.waitFor({ state: "visible" });
	await assertLocatorInsideViewport(page, library);
	const audit = await library.evaluate((root) => {
		const isRendered = (element) => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			return (
				rect.width > 0 &&
				rect.height > 0 &&
				style.display !== "none" &&
				style.visibility !== "hidden"
			);
		};
		const labelFor = (element) =>
			element.getAttribute("aria-label") ??
			element.getAttribute("title") ??
			element.textContent?.replace(/\s+/g, " ").trim() ??
			element.tagName;
		const controls = Array.from(
			root.querySelectorAll(
				"button, input:not([type='checkbox']):not([type='radio']), textarea, [role='option'], .tilefab-organization-parent-list > label",
			),
		).filter(isRendered);
		const undersizedControls = controls
			.map((element) => ({
				label: labelFor(element),
				height: element.getBoundingClientRect().height,
			}))
			.filter((entry) => entry.height < 43.5);
		const overflowNodes = [
			root,
			...root.querySelectorAll(
				".tilefab-organization-filters, .tilefab-organization-search, .tilefab-organization-list, .tilefab-organization-editor, .tilefab-organization-detail-tabs, .tilefab-organization-detail-panel, .tilefab-organization-editor-actions, .tilefab-organization-editor-footer, .tilefab-organization-parent-list, .tilefab-organization-colors",
			),
		]
			.filter(isRendered)
			.map((element) => ({
				label: element === root ? "organization-library" : element.className,
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
				children: Array.from(element.children).map((child) => {
					const childStyle = getComputedStyle(child);
					return {
						label: child.className || child.tagName,
						clientWidth: child.clientWidth,
						scrollWidth: child.scrollWidth,
						minWidth: childStyle.minWidth,
					};
				}),
			}))
			.filter((entry) => entry.scrollWidth > entry.clientWidth + 1);
		const editor = root.querySelector(".tilefab-organization-editor");
		return {
			activeTab: editor?.getAttribute("data-tab") ?? "",
			controlCount: controls.length,
			undersizedControls,
			overflowNodes,
		};
	});
	assertEqual(audit.activeTab, expectedTab, `${expectedTab} organization editor tab`);
	assertAtLeast(audit.controlCount, 1, `${expectedTab} organization controls`);
	if (audit.undersizedControls.length > 0) {
		throw new Error(
			`${expectedViewport.width}x${expectedViewport.height} ${expectedTab} organization controls are smaller than 44 px: ${JSON.stringify(audit.undersizedControls)}.`,
		);
	}
	if (audit.overflowNodes.length > 0) {
		throw new Error(
			`${expectedViewport.width}x${expectedViewport.height} ${expectedTab} organization UI overflows horizontally: ${JSON.stringify(audit.overflowNodes)}.`,
		);
	}
	await assertLocatorInsideViewport(
		page,
		library.getByRole("tab", {
			name: expectedTab.toLocaleUpperCase("en-US"),
			exact: true,
		}),
	);
	await assertLocatorInsideViewport(
		page,
		library.getByRole("button", { name: "SAVE DETAILS", exact: true }),
	);
}

async function openBlueprintRecordContext(record, scope = "user") {
	const context = record.getByTestId("blueprint-record-context");
	if (!(await context.isVisible().catch(() => false))) {
		await record
			.getByTestId(scope === "project" ? "blueprint-record-menu" : "user-blueprint-record-menu")
			.click();
	}
	await context.waitFor({ state: "visible", timeout: 10_000 });
	return context;
}

async function runUserBlueprintRecordCommand(record, commandName) {
	const context = await openBlueprintRecordContext(record, "user");
	await context.getByRole("menuitem", { name: commandName, exact: true }).click();
}

async function runProjectBlueprintRecordCommand(record, commandName) {
	const context = await openBlueprintRecordContext(record, "project");
	await context.getByRole("menuitem", { name: commandName, exact: true }).click();
}

async function assignUserBlueprintQuickSlot(record, recordName, quickSlot) {
	const context = await openBlueprintRecordContext(record, "user");
	await context
		.getByRole("menuitem", { name: `${recordName} quick slot 편집`, exact: true })
		.click();
	const slotContext = record.getByTestId("blueprint-record-context");
	await slotContext.waitFor({ state: "visible", timeout: 10_000 });
	if (quickSlot === null) {
		await slotContext.getByRole("menuitemradio", { name: "NONE", exact: true }).click();
		return;
	}
	await slotContext
		.getByRole("menuitemradio", {
			name: `${recordName} Quick Slot ${quickSlot} 지정`,
			exact: true,
		})
		.click();
}

async function deleteUserBlueprintRecord(page, record, recordName) {
	const context = await openBlueprintRecordContext(record, "user");
	await context
		.getByRole("menuitem", {
			name: `${recordName} 내 라이브러리에서 삭제`,
			exact: true,
		})
		.click();
	const confirm = context.getByRole("menuitem", { name: `${recordName} 삭제 확인`, exact: true });
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-command") === "delete-user-blueprint",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await confirm.evaluate((element) => element === document.activeElement),
		true,
		"user blueprint delete confirmation focus",
	);
	await page.keyboard.press("Enter");
}

async function dispatchLocatorDrag(page, source, target) {
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	try {
		await source.dispatchEvent("dragstart", { dataTransfer });
		assertEqual(
			await page.getByTestId("blueprint-user-panel").getAttribute("data-dragging"),
			"true",
			"user blueprint drag session starts without React state",
		);
		if ((await target.getAttribute("data-testid"))?.startsWith("user-blueprint-drag-")) {
			await target.waitFor({ state: "visible", timeout: 10_000 });
		}
		await target.dispatchEvent("dragenter", { dataTransfer });
		await target.dispatchEvent("dragover", { dataTransfer });
		assertEqual(
			await target.getAttribute("data-drop-state"),
			"active",
			"user blueprint drag target feedback",
		);
		await target.dispatchEvent("drop", { dataTransfer });
		await source.dispatchEvent("dragend", { dataTransfer });
		assertEqual(
			await page.getByTestId("blueprint-user-panel").getAttribute("data-dragging"),
			null,
			"user blueprint drag session cleanup",
		);
	} finally {
		await dataTransfer.dispose();
	}
}

async function dispatchCanceledLocatorDrag(page, source, target) {
	const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
	try {
		const renderSequenceBefore = await page.evaluate(
			() => window.__tileFab?.getReactRenderSequence?.() ?? -1,
		);
		await source.dispatchEvent("dragstart", { dataTransfer });
		await target.waitFor({ state: "visible", timeout: 10_000 });
		for (let index = 0; index < 64; index += 1) {
			await target.dispatchEvent("dragover", { dataTransfer });
		}
		await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
		assertEqual(
			await page.evaluate(() => window.__tileFab?.getReactRenderSequence?.() ?? -1),
			renderSequenceBefore,
			"user blueprint dragover does not rerender the React root",
		);
		await source.dispatchEvent("dragend", { dataTransfer });
		assertEqual(
			await page.getByTestId("blueprint-user-panel").getAttribute("data-dragging"),
			null,
			"canceled user blueprint drag clears the drag session",
		);
		assertEqual(
			await target.getAttribute("data-drop-state"),
			null,
			"canceled user blueprint drag clears target feedback",
		);
	} finally {
		await dataTransfer.dispose();
	}
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
	assertEqual(
		await button.getAttribute("aria-pressed"),
		"true",
		`${activity} activity pressed state`,
	);
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

function legacyBuildbarButton(page, accessibleName) {
	return accessibleName === "ASSEMBLE"
		? page.getByTestId("rail-pattern-browser-toggle")
		: page.getByRole("button", { name: accessibleName });
}

async function assertEditorActivityRailLayout(page, label) {
	const activities = ["build", "assemble", "equip", "inspect"];
	const app = page.getByTestId("tilefab-app");
	const activeActivity = await app.getAttribute("data-editor-activity");
	let pressedCount = 0;
	let previousTop = Number.NEGATIVE_INFINITY;
	for (const activity of activities) {
		const testId = `editor-activity-${activity}`;
		const button = page.getByTestId(testId);
		await assertLocatorInsideViewport(page, button);
		const bounds = await button.boundingBox();
		if (!bounds) throw new Error(`${label} ${activity} activity has no layout bounds.`);
		assertAtLeast(bounds.width, 44, `${label} ${activity} activity target width`);
		assertAtLeast(bounds.height, 44, `${label} ${activity} activity target height`);
		if (bounds.y <= previousTop) {
			throw new Error(`${label} activity visual order is not Build → Assemble → Equip → Inspect.`);
		}
		previousTop = bounds.y;
		assertEqual(
			await page.evaluate(
				({ x, y, expectedTestId }) =>
					document
						.elementFromPoint(x, y)
						?.closest(`[data-testid="${expectedTestId}"]`)
						?.getAttribute("data-testid") === expectedTestId,
				{
					x: bounds.x + bounds.width / 2,
					y: bounds.y + bounds.height / 2,
					expectedTestId: testId,
				},
			),
			true,
			`${label} ${activity} activity center hit target`,
		);
		const visibleLabel = await button.locator("strong").evaluate((element) => {
			const labelBounds = element.getBoundingClientRect();
			const buttonBounds = element.closest("button")?.getBoundingClientRect();
			return {
				text: element.textContent?.trim() ?? "",
				inside:
					buttonBounds !== undefined &&
					labelBounds.left >= buttonBounds.left - 0.5 &&
					labelBounds.right <= buttonBounds.right + 0.5,
			};
		});
		assertEqual(visibleLabel.text, activity.toUpperCase(), `${label} ${activity} visible label`);
		assertEqual(visibleLabel.inside, true, `${label} ${activity} visible label clipping`);
		const pressed = (await button.getAttribute("aria-pressed")) === "true";
		if (pressed) pressedCount += 1;
		assertEqual(pressed, activity === activeActivity, `${label} ${activity} pressed identity`);
	}
	assertEqual(pressedCount, 1, `${label} single active editor activity`);
}

async function assertLocatorInsideViewport(page, locator) {
	const box = await locator.boundingBox();
	const viewport = page.viewportSize();
	const visibility = await locator.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const clippingAncestors = [];
		let left = Math.max(0, rect.left);
		let top = Math.max(0, rect.top);
		let right = Math.min(window.innerWidth, rect.right);
		let bottom = Math.min(window.innerHeight, rect.bottom);
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			const style = getComputedStyle(parent);
			const parentRect = parent.getBoundingClientRect();
			if (style.overflowX !== "visible") {
				left = Math.max(left, parentRect.left);
				right = Math.min(right, parentRect.right);
			}
			if (style.overflowY !== "visible") {
				top = Math.max(top, parentRect.top);
				bottom = Math.min(bottom, parentRect.bottom);
			}
			if (style.overflowX !== "visible" || style.overflowY !== "visible") {
				clippingAncestors.push({
					className: parent.className,
					height: parentRect.height,
					overflowX: style.overflowX,
					overflowY: style.overflowY,
				});
			}
		}
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const hit = document.elementFromPoint(centerX, centerY);
		return {
			visibleWidth: Math.max(0, right - left),
			visibleHeight: Math.max(0, bottom - top),
			width: rect.width,
			height: rect.height,
			hitTarget: hit !== null && element.contains(hit),
			label:
				element.getAttribute("aria-label") ?? element.getAttribute("title") ?? element.textContent,
			parentLabel: element.parentElement?.getAttribute("aria-label") ?? "",
			clippingAncestors,
		};
	});
	if (
		!box ||
		!viewport ||
		box.x < 0 ||
		box.y < 0 ||
		box.x + box.width > viewport.width ||
		box.y + box.height > viewport.height ||
		visibility.visibleWidth < visibility.width - 1 ||
		visibility.visibleHeight < visibility.height - 1 ||
		!visibility.hitTarget
	) {
		throw new Error(
			`Active control is clipped or occluded: ${JSON.stringify({ box, viewport, visibility })}.`,
		);
	}
}

async function assertFittedMapVisible(page) {
	const canvas = page.getByTestId("rail-canvas");
	const encodedBounds = await canvas.getAttribute("data-fitted-map-bounds");
	const bounds = encodedBounds?.split(",").map(Number);
	if (!bounds || bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) {
		throw new Error(`Fit command did not publish valid map bounds: ${encodedBounds ?? "missing"}.`);
	}
	const [minX, minY, maxX, maxY] = bounds;
	const canvasBox = await canvas.boundingBox();
	const toolsBox = await page.locator(".tilefab-tools").boundingBox();
	const hintsBox = await page.locator(".tilefab-action-hints").boundingBox();
	const buildbar = page.getByTestId("rail-buildbar");
	const buildbarBox = (await buildbar.count()) > 0 ? await buildbar.boundingBox() : null;
	if (!canvasBox || !toolsBox || !hintsBox) throw new Error("Fit visibility overlays are missing.");
	const upperLeft = await screenPointForWorld(page, { x: minX, y: minY });
	const lowerRight = await screenPointForWorld(page, { x: maxX + 1, y: maxY + 1 });
	const obstructionLeft = toolsBox.x + toolsBox.width + 8;
	const obstructionTop = Math.min(hintsBox.y, buildbarBox?.y ?? Number.POSITIVE_INFINITY);
	if (
		upperLeft.x < obstructionLeft ||
		upperLeft.y < canvasBox.y + 8 ||
		lowerRight.x > canvasBox.x + canvasBox.width ||
		lowerRight.y > obstructionTop - 8
	) {
		throw new Error(
			`Fitted map is obscured: ${JSON.stringify({ upperLeft, lowerRight, canvasBox, obstructionTop })}.`,
		);
	}
}

async function fitAndZoomOut(page, steps) {
	await page.getByRole("button", { name: "전체 보기" }).click();
	const box = await page.getByTestId("rail-canvas").boundingBox();
	if (!box) throw new Error("Rail canvas has no visible bounds.");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (let index = 0; index < steps; index++) await page.mouse.wheel(0, 200);
	await page.waitForTimeout(80);
}

async function centerWorld(page, world) {
	for (let attempt = 0; attempt < 48; attempt++) {
		const box = await page.getByTestId("rail-canvas").boundingBox();
		if (!box) throw new Error("Rail canvas has no visible bounds.");
		const point = await screenPointForWorld(page, world);
		const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		const delta = { x: center.x - point.x, y: center.y - point.y };
		if (Math.abs(delta.x) <= 2 && Math.abs(delta.y) <= 2) return;
		const step = {
			x: Math.max(-box.width * 0.3, Math.min(box.width * 0.3, delta.x)),
			y: Math.max(-box.height * 0.3, Math.min(box.height * 0.3, delta.y)),
		};
		await page.mouse.move(center.x, center.y);
		await page.mouse.down({ button: "right" });
		await page.mouse.move(center.x + step.x, center.y + step.y, { steps: 5 });
		await page.mouse.up({ button: "right" });
	}
	throw new Error(`Could not center world point ${world.x},${world.y}.`);
}

async function ensureWorldPointVisible(page, world) {
	for (let attempt = 0; attempt < 48; attempt++) {
		const box = await page.getByTestId("rail-canvas").boundingBox();
		if (!box) throw new Error("Rail canvas has no visible bounds.");
		const point = await screenPointForWorld(page, world);
		const visible =
			point.x >= box.x + 80 &&
			point.x <= box.x + box.width - 340 &&
			point.y >= box.y + 48 &&
			point.y <= box.y + box.height - 150;
		if (visible) return;
		const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		const delta = { x: center.x - point.x, y: center.y - point.y };
		const step = {
			x: Math.max(-box.width * 0.3, Math.min(box.width * 0.3, delta.x)),
			y: Math.max(-box.height * 0.3, Math.min(box.height * 0.3, delta.y)),
		};
		await page.mouse.move(center.x, center.y);
		await page.mouse.down({ button: "right" });
		await page.mouse.move(center.x + step.x, center.y + step.y, { steps: 5 });
		await page.mouse.up({ button: "right" });
	}
	throw new Error(`Could not reveal world point ${world.x},${world.y}.`);
}

async function moveToWorld(page, world) {
	const point = await screenPointForWorld(page, world);
	await page.mouse.move(point.x, point.y);
}

async function moveOrganizationBundleGhostToCandidate(page, pointerCandidates) {
	for (const pointer of pointerCandidates) {
		await centerWorld(page, offsetCellCenter(pointer));
		await moveToWorld(page, offsetCellCenter(pointer));
		await page.waitForFunction(
			(expected) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas?.dataset.cursorX === String(expected.x) &&
					canvas.dataset.cursorY === String(expected.y) &&
					(canvas.dataset.organizationBundlePreviewState === "candidate" ||
						canvas.dataset.organizationBundlePreviewState === "sampled-collision")
				);
			},
			pointer,
			{ timeout: 10_000 },
		);
		const state = await page
			.getByTestId("rail-canvas")
			.getAttribute("data-organization-bundle-preview-state");
		if (state === "candidate") return Object.freeze({ ...pointer });
	}
	throw new Error(
		`Could not find a collision-free organization-bundle pointer: ${JSON.stringify(pointerCandidates)}`,
	);
}

async function zoomOutForFactoryPlacement(page) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas is unavailable for factory placement zoom.");
	const initialZoom = Number((await readMetrics(page)).cameraZoom);
	if (initialZoom <= 1) return;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	for (let index = 0; index < 8; index++) await page.mouse.wheel(0, 600);
	await page.waitForFunction(
		(beforeZoom) => Number(window.__tileFab?.camera?.zoom) < Number(beforeZoom),
		initialZoom,
		{ timeout: 10_000 },
	);
}

async function clickWorld(page, world, center = true) {
	if (center) await centerWorld(page, world);
	const point = await screenPointForWorld(page, world);
	await page.mouse.click(point.x, point.y);
}

async function screenPointForWorld(page, world) {
	const canvas = page.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no visible bounds.");
	const camera = await page.evaluate(() => {
		const activeCamera = window.__tileFab?.camera;
		return activeCamera
			? {
					offsetX: Number(activeCamera.offsetX),
					offsetY: Number(activeCamera.offsetY),
					zoom: Number(activeCamera.zoom),
				}
			: null;
	});
	if (!camera) throw new Error("Rail editor camera is unavailable.");
	return {
		x: box.x + camera.offsetX + world.x * camera.zoom,
		y: box.y + camera.offsetY + world.y * camera.zoom,
	};
}

async function readRailGeometry(page) {
	return page.evaluate(() => {
		const map = window.__tileFab?.getDocument().map;
		if (!map) throw new Error("Rail editor map is unavailable.");
		const cells = [];
		map.forEachRail((x, y) => cells.push([x, y]));
		cells.sort((left, right) => left[1] - right[1] || left[0] - right[0]);
		return { cells, bounds: map.bounds() };
	});
}

async function readNormalizedAuthoredRailEdges(page) {
	return page.evaluate(() => {
		const map = window.__tileFab?.getDocument().map;
		if (!map) throw new Error("Rail editor map is unavailable.");
		const bounds = map.bounds();
		if (!bounds) return [];
		const directions = [
			[1, 0, -1],
			[2, 1, 0],
			[4, 0, 1],
			[8, -1, 0],
		];
		const edges = [];
		map.forEachRail((x, y, rail) => {
			for (const [direction, deltaX, deltaY] of directions) {
				if ((rail.outgoing & direction) === 0) continue;
				edges.push([
					x - bounds.minX,
					y - bounds.minY,
					x + deltaX - bounds.minX,
					y + deltaY - bounds.minY,
				]);
			}
		});
		return edges.sort(
			(left, right) =>
				left[1] - right[1] || left[0] - right[0] || left[3] - right[3] || left[2] - right[2],
		);
	});
}

function assertTranslatedRailGeometry(source, committed, anchor) {
	if (!source.bounds)
		throw new Error("organization bundle translated geometry: missing source bounds");
	const added = addedRailGeometry(source, committed, "organization bundle translated geometry");
	assertEqual(added.cells.length, source.cells.length, "organization bundle translated cell count");
	assertEqual(added.bounds.minX, anchor.x, "organization bundle translated minimum X");
	assertEqual(added.bounds.minY, anchor.y, "organization bundle translated minimum Z");
	assertEqual(
		added.bounds.maxX - added.bounds.minX,
		source.bounds.maxX - source.bounds.minX,
		"organization bundle translated X span",
	);
	assertEqual(
		added.bounds.maxY - added.bounds.minY,
		source.bounds.maxY - source.bounds.minY,
		"organization bundle translated Z span",
	);
}

function assertAddedRailGeometryCenteredAtPointer(source, committed, pointer, label) {
	const added = addedRailGeometry(source, committed, label);
	const centerX = (added.bounds.minX + added.bounds.maxX + 1) / 2;
	const centerY = (added.bounds.minY + added.bounds.maxY + 1) / 2;
	assertAtMost(Math.abs(centerX - (pointer.x + 0.5)), 0.5, `${label} centered X`);
	assertAtMost(Math.abs(centerY - (pointer.y + 0.5)), 0.5, `${label} centered Z`);
	return added;
}

function addedRailGeometry(source, committed, label) {
	if (!committed.bounds) throw new Error(`${label}: missing committed rail bounds`);
	const sourceKeys = new Set(source.cells.map(([x, y]) => `${x},${y}`));
	const cells = committed.cells.filter(([x, y]) => !sourceKeys.has(`${x},${y}`));
	if (cells.length === 0) throw new Error(`${label}: no added rail cells`);
	const bounds = cells.reduce(
		(current, [x, y]) => ({
			minX: Math.min(current.minX, x),
			minY: Math.min(current.minY, y),
			maxX: Math.max(current.maxX, x),
			maxY: Math.max(current.maxY, y),
		}),
		{
			minX: Number.POSITIVE_INFINITY,
			minY: Number.POSITIVE_INFINITY,
			maxX: Number.NEGATIVE_INFINITY,
			maxY: Number.NEGATIVE_INFINITY,
		},
	);
	return Object.freeze({ cells: Object.freeze(cells), bounds: Object.freeze(bounds) });
}

function centeredAnchorForGeometry(bounds, pointer) {
	return Object.freeze({
		x: Math.round(pointer.x - (bounds.maxX - bounds.minX) / 2),
		y: Math.round(pointer.y - (bounds.maxY - bounds.minY) / 2),
	});
}

function assertRailGeometryIdentity(actual, expected, phase) {
	assertEqual(JSON.stringify(actual.bounds), JSON.stringify(expected.bounds), `${phase} bounds`);
	assertEqual(JSON.stringify(actual.cells), JSON.stringify(expected.cells), `${phase} cells`);
}

function expandBounds(bounds, margin) {
	return {
		minX: bounds.minX - margin,
		minY: bounds.minY - margin,
		maxX: bounds.maxX + 1 + margin,
		maxY: bounds.maxY + 1 + margin,
	};
}

function offsetCellCenter(cell) {
	return { x: cell.x + 0.5, y: cell.y + 0.5 };
}

async function waitForMetricChange(page, before, key) {
	return waitForWorker(page, (metrics) => metrics[key] !== before[key]);
}

async function waitForReady(page, expected) {
	return waitForWorker(page, (metrics) => {
		return (
			expected.physicalPaths === undefined ||
			metrics.physicalPaths === String(expected.physicalPaths)
		);
	});
}

async function waitForWorker(page, predicate, { timeout = 20_000 } = {}) {
	await page.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false"
			);
		},
		undefined,
		{ timeout },
	);
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const metrics = await readMetrics(page);
		if (workerIsSettled(metrics) && predicate(metrics)) return metrics;
		await page.waitForTimeout(50);
	}
	throw new Error(
		`Timed out waiting for authored state. ${JSON.stringify(await readMetrics(page))}`,
	);
}

async function exerciseOrganizationBundleCoarsePreview(page) {
	const canvas = page.getByTestId("rail-canvas");
	await page.waitForFunction(
		() => {
			const candidate = document.querySelector('[data-testid="rail-canvas"]');
			return (
				candidate?.dataset.organizationBundlePreviewPlanning === "coarse-preview" &&
				Number(candidate.dataset.organizationBundlePreviewPlans) > 0
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const before = await readMetrics(page);
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("Organization bundle preview canvas is not visible.");
	const moveCount = 24;
	for (let index = 0; index < moveCount; index++) {
		const column = index % 6;
		const row = Math.floor(index / 6);
		await page.mouse.move(
			bounds.x + bounds.width * (0.28 + column * 0.08),
			bounds.y + bounds.height * (0.28 + row * 0.1),
		);
	}
	await page.waitForFunction(
		(previousPlans) =>
			Number(
				document.querySelector('[data-testid="rail-canvas"]')?.dataset
					.organizationBundlePreviewPlans,
			) > previousPlans,
		Number(before.organizationBundlePreviewPlans),
		{ timeout: 10_000 },
	);
	await page.waitForTimeout(150);
	const after = await readMetrics(page);
	assertEqual(
		after.organizationBundlePreviewPlanning,
		"coarse-preview",
		"organization bundle hover uses coarse planning",
	);
	assertAtLeast(
		Number(after.organizationBundlePreviewPlans),
		Number(before.organizationBundlePreviewPlans) + 1,
		"organization bundle hover plans latest pointer",
	);
	assertAtMost(
		Number(after.organizationBundlePreviewPlans),
		Number(before.organizationBundlePreviewPlans) + moveCount + 2,
		"organization bundle hover plans at most once per pointer frame",
	);
	assertEqual(
		after.ghostCompiles,
		before.ghostCompiles,
		"organization coarse preview avoids exact ghost compilation",
	);
	assertAtMost(
		Number(after.organizationBundlePreviewCollisionReads),
		1_024,
		"organization coarse preview collision reads",
	);
	assertAtMost(
		Number(after.organizationBundlePreviewSampledCells),
		512,
		"organization coarse preview sampled cells",
	);
	assertAtMost(
		Number(after.organizationBundlePreviewVisibleCells),
		ORGANIZATION_GHOST_MAX_VISIBLE_RAIL_CELLS,
		"organization coarse preview visible cells",
	);
	assertAtMost(
		Number(after.organizationBundlePreviewVisiblePorts),
		2_048,
		"organization coarse preview visible ports",
	);
	assertAtLeast(
		Number(after.organizationBundlePreviewVisibleChunks),
		1,
		"organization coarse preview visible chunks",
	);
	assertAtMost(
		Number(after.organizationBundlePreviewMaxMs),
		50,
		"organization coarse preview maximum planning duration",
	);
}

async function readMetrics(page) {
	return page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const app = document.querySelector(".tilefab-app");
		const model = window.__tileFab?.getEditorModel();
		const authoredDocument = model?.document;
		const worker = window.__tileFab?.getWorkerState();
		const modelPhysicalFingerprint = window.__tileFab?.getModelPhysicalFingerprint?.() ?? "";
		return {
			startupStatus: canvas?.dataset.startupStatus ?? "",
			startupMirrorFingerprintMatch: canvas?.dataset.startupMirrorFingerprintMatch ?? "",
			modelSyncPending: canvas?.dataset.modelSyncPending ?? "",
			physicalPaths: canvas?.dataset.physicalPaths ?? "",
			authoredCells: canvas?.dataset.authoredCells ?? "",
			authoredEdges: canvas?.dataset.authoredEdges ?? "",
			projectDirty: canvas?.dataset.projectDirty ?? "",
			projectId: canvas?.dataset.projectId ?? "",
			projectName: canvas?.dataset.projectName ?? "",
			modelSequence: String(authoredDocument?.getPatchSequence() ?? ""),
			modelRevision: String(model?.map.getRevision() ?? ""),
			modelChecksum: model?.authoredChecksum ?? "",
			modelPhysicalFingerprint,
			modelReadinessFingerprint: model?.readiness.fingerprint ?? "",
			modelTopologyFingerprint: model?.readiness.topologyFingerprint ?? "",
			modelNextAdvancedSwitchId: String(model?.map.getAdvancedSwitchIdCursor() ?? ""),
			modelNextPortId: String(authoredDocument?.portEquipment.nextPortId ?? ""),
			modelNextEquipmentGroupId: String(authoredDocument?.portEquipment.nextEquipmentGroupId ?? ""),
			modelNextOrganizationId: String(authoredDocument?.organizations.nextOrganizationId ?? ""),
			workerStatus: canvas?.dataset.workerStatus ?? "",
			workerTargetSequence: canvas?.dataset.workerTargetSequence ?? "",
			workerTargetRevision: canvas?.dataset.workerTargetRevision ?? "",
			workerTargetChecksum: canvas?.dataset.workerTargetChecksum ?? "",
			workerTargetCells: canvas?.dataset.workerTargetCells ?? "",
			workerTargetEdges: canvas?.dataset.workerTargetEdges ?? "",
			workerTargetSwitches: canvas?.dataset.workerTargetSwitches ?? "",
			workerTargetPorts: canvas?.dataset.workerTargetPorts ?? "",
			workerTargetEquipmentGroups: canvas?.dataset.workerTargetEquipmentGroups ?? "",
			workerTargetOrganizations: canvas?.dataset.workerTargetOrganizations ?? "",
			workerSequence: canvas?.dataset.workerSequence ?? "",
			workerRevision: canvas?.dataset.workerRevision ?? "",
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerCells: canvas?.dataset.workerCells ?? "",
			workerEdges: canvas?.dataset.workerEdges ?? "",
			workerSwitches: canvas?.dataset.workerSwitches ?? "",
			workerPorts: canvas?.dataset.workerPorts ?? "",
			workerEquipmentGroups: canvas?.dataset.workerEquipmentGroups ?? "",
			workerOrganizations: canvas?.dataset.workerOrganizations ?? "",
			workerPhysicalSequence: canvas?.dataset.workerPhysicalSequence ?? "",
			workerPhysicalRevision: canvas?.dataset.workerPhysicalRevision ?? "",
			workerPhysicalPaths: canvas?.dataset.workerPhysicalPaths ?? "",
			workerPhysicalFingerprint: canvas?.dataset.workerPhysicalFingerprint ?? "",
			workerSimulationReady: String(worker?.simulationReady ?? ""),
			workerPhysicalValid: String(worker?.physicalValid ?? ""),
			blueprintPlacementRequestAnchor: canvas?.dataset.blueprintPlacementRequestAnchor ?? "",
			blueprintPlacementAnchor: canvas?.dataset.blueprintPlacementAnchor ?? "",
			readinessReady: canvas?.dataset.readinessReady ?? "",
			strongComponents: canvas?.dataset.readinessStrongComponents ?? "",
			openTerminals: canvas?.dataset.readinessOpenTerminals ?? "",
			equipmentGroups: app?.dataset.equipmentGroups ?? "",
			equipmentPorts: app?.dataset.equipmentPorts ?? "",
			projectBlueprints: app?.dataset.projectBlueprints ?? "",
			userBlueprints: app?.dataset.userBlueprints ?? "",
			blueprintSaveDestination: app?.dataset.blueprintSaveDestination ?? "",
			userBlueprintStorage: app?.dataset.userBlueprintStorage ?? "",
			userBlueprintRejected: app?.dataset.userBlueprintRejected ?? "",
			userBlueprintDiagnostics: app?.dataset.userBlueprintDiagnostics ?? "",
			userBlueprintRejectedLowerBound: app?.dataset.userBlueprintRejectedLowerBound ?? "",
			userBlueprintDiagnosticsTruncated: app?.dataset.userBlueprintDiagnosticsTruncated ?? "",
			userBlueprintOverflow: app?.dataset.userBlueprintOverflow ?? "",
			userBlueprintCrossTabAvailable: app?.dataset.userBlueprintCrossTabAvailable ?? "",
			userBlueprintCrossTabNotifications: app?.dataset.userBlueprintCrossTabNotifications ?? "",
			userBlueprintCrossTabRefreshes: app?.dataset.userBlueprintCrossTabRefreshes ?? "",
			userBlueprintCrossTabPending: app?.dataset.userBlueprintCrossTabPending ?? "",
			userBlueprintCrossTabInFlight: app?.dataset.userBlueprintCrossTabInFlight ?? "",
			userBlueprintCrossTabOutcome: app?.dataset.userBlueprintCrossTabOutcome ?? "",
			railClipboard: app?.dataset.railClipboard ?? "",
			railClipboardHistory: app?.dataset.railClipboardHistory ?? "",
			railClipboardActiveIndex: app?.dataset.railClipboardActiveIndex ?? "",
			userBlueprintQuickSlots: app?.dataset.userBlueprintQuickSlots ?? "",
			railClipboardVersion: canvas?.dataset.railClipboardVersion ?? "",
			areaStampModules: app?.dataset.areaStampModules ?? "",
			areaStampSource: canvas?.dataset.areaStampSource ?? "",
			areaStampOrigin: canvas?.dataset.areaStampOrigin ?? "",
			areaStampLabel: canvas?.dataset.areaStampLabel ?? "",
			areaStampRotation: app?.dataset.areaStampRotation ?? "",
			areaStampFlow: app?.dataset.areaStampFlow ?? "",
			activePlanKind: canvas?.dataset.activePlanKind ?? "",
			placementGhostActive: canvas?.dataset.placementGhostActive ?? "",
			placementGhostAnchor: canvas?.dataset.placementGhostAnchor ?? "",
			cursorX: canvas?.dataset.cursorX ?? "",
			cursorY: canvas?.dataset.cursorY ?? "",
			cameraOffsetX: canvas?.dataset.cameraOffsetX ?? "",
			cameraOffsetY: canvas?.dataset.cameraOffsetY ?? "",
			cameraZoom: canvas?.dataset.cameraZoom ?? "",
			draftPreviewValid: canvas?.dataset.draftPreviewValid ?? "",
			networkLinkGhostMode: canvas?.dataset.networkLinkGhostMode ?? "",
			networkLinkPresentedRouteCells: canvas?.dataset.networkLinkPresentedRouteCells ?? "",
			selectionModules: app?.dataset.areaSelectionModules ?? "",
			selectionCells: app?.dataset.areaSelectionCells ?? "",
			selectionEquipmentGroups: app?.dataset.areaSelectionEquipmentGroups ?? "",
			selectionPorts: app?.dataset.areaSelectionPorts ?? "",
			areaSelectionProvenance: app?.dataset.areaSelectionProvenance ?? "",
			staticFabHierarchyRequested: app?.dataset.staticFabHierarchyRequested ?? "",
			organizationSelectionCount: app?.dataset.organizationSelectionCount ?? "",
			organizationSelectionIds: app?.dataset.organizationSelectionIds ?? "",
			semanticBayCommandPhase: app?.dataset.semanticBayCommandPhase ?? "",
			semanticBayCommandAction: app?.dataset.semanticBayCommandAction ?? "",
			semanticBayCommandId: app?.dataset.semanticBayCommandId ?? "",
			semanticBaySnapshotStatus: app?.dataset.semanticBaySnapshotStatus ?? "",
			semanticBayFirstPaintMs: app?.dataset.semanticBayFirstPaintMs ?? "",
			semanticBaySnapshotHandoffMs: app?.dataset.semanticBaySnapshotHandoffMs ?? "",
			semanticBayHydrationMs: app?.dataset.semanticBayHydrationMs ?? "",
			semanticBayWorkerRoundTripMs: app?.dataset.semanticBayWorkerRoundTripMs ?? "",
			semanticBayResponseValidationMs: app?.dataset.semanticBayResponseValidationMs ?? "",
			semanticBayAdoptionMs: app?.dataset.semanticBayAdoptionMs ?? "",
			bayFlowEditCommandPhase: app?.dataset.bayFlowEditCommandPhase ?? "",
			bayFlowEditCommandTarget: app?.dataset.bayFlowEditCommandTarget ?? "",
			bayFlowEditCommandId: app?.dataset.bayFlowEditCommandId ?? "",
			bayFlowEditSnapshotStatus: app?.dataset.bayFlowEditSnapshotStatus ?? "",
			bayFlowEditFirstPaintMs: app?.dataset.bayFlowEditFirstPaintMs ?? "",
			bayFlowEditSnapshotHandoffMs: app?.dataset.bayFlowEditSnapshotHandoffMs ?? "",
			bayFlowEditHydrationMs: app?.dataset.bayFlowEditHydrationMs ?? "",
			bayFlowEditWorkerRoundTripMs: app?.dataset.bayFlowEditWorkerRoundTripMs ?? "",
			bayFlowEditResponseValidationMs: app?.dataset.bayFlowEditResponseValidationMs ?? "",
			bayFlowEditAdoptionMs: app?.dataset.bayFlowEditAdoptionMs ?? "",
			organizationOutlineStatus: canvas?.dataset.organizationOutlineStatus ?? "",
			organizationOutlineCount: canvas?.dataset.organizationOutlineCount ?? "",
			organizationOutlineBytes: canvas?.dataset.organizationOutlineBytes ?? "",
			organizationOutlineRequestCount: canvas?.dataset.organizationOutlineRequestCount ?? "",
			organizationOutlineLastMs: canvas?.dataset.organizationOutlineLastMs ?? "",
			organizationOutlineSelectionEnabled:
				canvas?.dataset.organizationOutlineSelectionEnabled ?? "",
			organizationOutlineHoverId: canvas?.dataset.organizationOutlineHoverId ?? "",
			organizationOutlineBindings: canvas?.dataset.organizationOutlineBindings ?? "",
			organizationOutlineQueryCandidates: canvas?.dataset.organizationOutlineQueryCandidates ?? "",
			organizationOutlineVisibleRows: canvas?.dataset.organizationOutlineVisibleRows ?? "",
			organizationOutlineHitCandidates: canvas?.dataset.organizationOutlineHitCandidates ?? "",
			organizationBundleActive: app?.dataset.organizationBundleActive ?? "",
			organizationBundleRotation: app?.dataset.organizationBundleRotation ?? "",
			staticFabArrangementActive: canvas?.dataset.staticFabArrangementActive ?? "",
			staticFabArrangementRoots: canvas?.dataset.staticFabArrangementRoots ?? "",
			staticFabArrangementAxis: canvas?.dataset.staticFabArrangementAxis ?? "",
			staticFabArrangementMode: canvas?.dataset.staticFabArrangementMode ?? "",
			staticFabArrangementPhase: canvas?.dataset.staticFabArrangementPhase ?? "",
			staticFabArrangementConflicts: canvas?.dataset.staticFabArrangementConflicts ?? "",
			staticFabArrangementSessionHydrationMs:
				canvas?.dataset.staticFabArrangementSessionHydrationMs ?? "",
			staticFabArrangementSessionCompilationMs:
				canvas?.dataset.staticFabArrangementSessionCompilationMs ?? "",
			staticFabArrangementSourcePlanIndex:
				canvas?.dataset.staticFabArrangementSourcePlanIndex ?? "",
			staticFabArrangementTargetCellsOmitted:
				canvas?.dataset.staticFabArrangementTargetCellsOmitted ?? "",
			staticFabOrganizations: canvas?.dataset.staticFabOrganizationCount ?? "",
			staticFabCheckStatus: app?.dataset.staticFabCheckStatus ?? "",
			staticFabCheckActions: app?.dataset.staticFabCheckActions ?? "",
			staticFabCheckIssues: app?.dataset.staticFabCheckIssues ?? "",
			projectOperation: app?.dataset.projectOperation ?? "",
			autosaveCharacters: canvas?.dataset.autosaveCharacters ?? "",
			ghostCompiles: canvas?.dataset.ghostCompiles ?? "",
			organizationBundlePreviewState: canvas?.dataset.organizationBundlePreviewState ?? "",
			organizationBundlePreviewPlanning: canvas?.dataset.organizationBundlePreviewPlanning ?? "",
			organizationBundlePreviewPlans: canvas?.dataset.organizationBundlePreviewPlans ?? "",
			organizationBundlePreviewLastMs: canvas?.dataset.organizationBundlePreviewLastMs ?? "",
			organizationBundlePreviewMaxMs: canvas?.dataset.organizationBundlePreviewMaxMs ?? "",
			organizationBundlePreviewCollisionReads:
				canvas?.dataset.organizationBundlePreviewCollisionReads ?? "",
			organizationBundlePreviewSampledCells:
				canvas?.dataset.organizationBundlePreviewSampledCells ?? "",
			organizationBundlePreviewVisibleChunks:
				canvas?.dataset.organizationBundlePreviewVisibleChunks ?? "",
			organizationBundlePreviewVisibleCells:
				canvas?.dataset.organizationBundlePreviewVisibleCells ?? "",
			organizationBundlePreviewVisiblePorts:
				canvas?.dataset.organizationBundlePreviewVisiblePorts ?? "",
			organizationBundlePreviewAnchor: canvas?.dataset.organizationBundlePreviewAnchor ?? "",
			organizationBundleSourceBounds: canvas?.dataset.organizationBundleSourceBounds ?? "",
			organizationBundlePlacementPlanning:
				canvas?.dataset.organizationBundlePlacementPlanning ?? "",
			organizationBundlePlacementPhase: canvas?.dataset.organizationBundlePlacementPhase ?? "",
			organizationBundlePlacementPlanningMs:
				canvas?.dataset.organizationBundlePlacementPlanningMs ?? "",
			organizationBundlePlacementValidationMs:
				canvas?.dataset.organizationBundlePlacementValidationMs ?? "",
			organizationBundlePlacementSnapshotMs:
				canvas?.dataset.organizationBundlePlacementSnapshotMs ?? "",
			organizationBundlePlacementRoundTripMs:
				canvas?.dataset.organizationBundlePlacementRoundTripMs ?? "",
			organizationBundlePlacementResponseValidationMs:
				canvas?.dataset.organizationBundlePlacementResponseValidationMs ?? "",
			organizationBundlePlacementAdoptionMs:
				canvas?.dataset.organizationBundlePlacementAdoptionMs ?? "",
			organizationBundlePlacementCommitMs:
				canvas?.dataset.organizationBundlePlacementCommitMs ?? "",
			organizationBundlePlacementTicket: canvas?.dataset.organizationBundlePlacementTicket ?? "",
			organizationBundlePlacementTicketAnchor:
				canvas?.dataset.organizationBundlePlacementTicketAnchor ?? "",
			organizationBundlePlacementPlanAnchor:
				canvas?.dataset.organizationBundlePlacementPlanAnchor ?? "",
			organizationBundlePlacementProspectiveChecksum:
				canvas?.dataset.organizationBundlePlacementProspectiveChecksum ?? "",
			organizationBundlePlacementTargetChecksum:
				canvas?.dataset.organizationBundlePlacementTargetChecksum ?? "",
			organizationBundlePlacementTargetChecksumMatch:
				canvas?.dataset.organizationBundlePlacementTargetChecksumMatch ?? "",
			assemblyConnectorPhase: app?.dataset.assemblyConnectorPhase ?? "",
			assemblyConnectorSnapshotStatus: app?.dataset.assemblyConnectorSnapshotStatus ?? "",
			assemblyConnectorRecommendationStatus:
				app?.dataset.assemblyConnectorRecommendationStatus ?? "",
			assemblyConnectorRecommendationAttempts:
				app?.dataset.assemblyConnectorRecommendationAttempts ?? "",
			historyCanUndo: app?.dataset.historyCanUndo ?? "",
			historyCanRedo: app?.dataset.historyCanRedo ?? "",
		};
	});
}

async function readRailCanvasRenderSamples(page) {
	return page.evaluate(() => {
		const samples = window.__tileFab?.getPerformanceStats?.().renderSamples;
		if (!Number.isSafeInteger(samples) || samples < 0) {
			throw new Error("Rail Canvas render telemetry is unavailable.");
		}
		return samples;
	});
}

async function waitForRailCanvasRenderQuiescence(page, label) {
	let previous = await readRailCanvasRenderSamples(page);
	for (let attempt = 0; attempt < 8; attempt += 1) {
		await page.waitForTimeout(125);
		const current = await readRailCanvasRenderSamples(page);
		if (current === previous) return current;
		previous = current;
	}
	throw new Error(`${label} Canvas render telemetry did not become quiescent.`);
}

function workerIsSettled(metrics) {
	return (
		metrics.startupStatus === "ready" &&
		metrics.modelSyncPending === "false" &&
		metrics.workerStatus === "ready" &&
		metrics.workerSequence !== "" &&
		metrics.workerSequence === metrics.workerTargetSequence &&
		metrics.workerRevision === metrics.workerTargetRevision &&
		metrics.workerChecksum === metrics.workerTargetChecksum &&
		metrics.workerCells === metrics.workerTargetCells &&
		metrics.workerEdges === metrics.workerTargetEdges &&
		metrics.workerSwitches === metrics.workerTargetSwitches &&
		metrics.workerPorts === metrics.workerTargetPorts &&
		metrics.workerEquipmentGroups === metrics.workerTargetEquipmentGroups &&
		metrics.workerOrganizations === metrics.workerTargetOrganizations &&
		metrics.workerCells === metrics.authoredCells &&
		metrics.workerEdges === metrics.authoredEdges &&
		metrics.workerSequence === metrics.modelSequence &&
		metrics.workerRevision === metrics.modelRevision &&
		metrics.workerChecksum === metrics.modelChecksum &&
		metrics.workerPhysicalSequence === metrics.workerTargetSequence &&
		metrics.workerPhysicalRevision === metrics.workerTargetRevision &&
		metrics.workerPhysicalPaths === metrics.physicalPaths &&
		metrics.workerPhysicalFingerprint === metrics.modelPhysicalFingerprint &&
		metrics.workerPhysicalValid === "true" &&
		metrics.workerSimulationReady === "false"
	);
}

function assertBoundIdentity(actual, expected, phase) {
	assertEqual(actual.physicalPaths, expected.physicalPaths, `${phase} physical paths`);
	assertEqual(actual.authoredCells, expected.authoredCells, `${phase} authored cells`);
	assertEqual(actual.authoredEdges, expected.authoredEdges, `${phase} authored edges`);
	assertEqual(actual.projectId, expected.projectId, `${phase} project id`);
	assertEqual(
		actual.workerTargetSequence,
		expected.workerTargetSequence,
		`${phase} target sequence`,
	);
	assertEqual(
		actual.workerTargetRevision,
		expected.workerTargetRevision,
		`${phase} target revision`,
	);
	assertEqual(actual.workerSequence, expected.workerSequence, `${phase} current sequence`);
	assertEqual(actual.workerRevision, expected.workerRevision, `${phase} current revision`);
	assertEqual(
		actual.workerTargetChecksum,
		expected.workerTargetChecksum,
		`${phase} target checksum`,
	);
	for (const key of [
		"workerTargetCells",
		"workerTargetEdges",
		"workerTargetSwitches",
		"workerTargetPorts",
		"workerTargetEquipmentGroups",
		"workerTargetOrganizations",
		"workerCells",
		"workerEdges",
		"workerSwitches",
		"workerPorts",
		"workerEquipmentGroups",
		"workerOrganizations",
	]) {
		assertEqual(actual[key], expected[key], `${phase} ${key}`);
	}
	assertEqual(actual.workerChecksum, expected.workerChecksum, `${phase} authored checksum`);
	assertEqual(
		actual.workerPhysicalSequence,
		expected.workerPhysicalSequence,
		`${phase} physical sequence`,
	);
	assertEqual(
		actual.workerPhysicalRevision,
		expected.workerPhysicalRevision,
		`${phase} physical revision`,
	);
	assertEqual(
		actual.workerPhysicalPaths,
		expected.workerPhysicalPaths,
		`${phase} Worker physical paths`,
	);
	assertEqual(
		actual.workerPhysicalFingerprint,
		expected.workerPhysicalFingerprint,
		`${phase} physical fingerprint`,
	);
	assertEqual(actual.startupMirrorFingerprintMatch, "true", `${phase} startup/mirror identity`);
	assertEqual(actual.workerSimulationReady, "false", `${phase} simulation gate`);
	assertEqual(actual.workerStatus, "ready", `${phase} Worker status`);
}

function assertExactStaticFabModelIdentity(actual, expected, phase) {
	for (const key of [
		"projectId",
		"projectName",
		"physicalPaths",
		"authoredCells",
		"authoredEdges",
		"modelSequence",
		"modelRevision",
		"modelChecksum",
		"modelPhysicalFingerprint",
		"modelReadinessFingerprint",
		"modelTopologyFingerprint",
		"modelNextAdvancedSwitchId",
		"modelNextPortId",
		"modelNextEquipmentGroupId",
		"modelNextOrganizationId",
		"equipmentGroups",
		"equipmentPorts",
		"projectBlueprints",
		"staticFabOrganizations",
		"strongComponents",
		"openTerminals",
		"readinessReady",
		"workerTargetSequence",
		"workerTargetRevision",
		"workerTargetChecksum",
		"workerSequence",
		"workerRevision",
		"workerChecksum",
		"workerPhysicalSequence",
		"workerPhysicalRevision",
		"workerPhysicalPaths",
		"workerPhysicalFingerprint",
	]) {
		assertEqual(actual[key], expected[key], `${phase} ${key}`);
	}
	if (!workerIsSettled(actual)) {
		throw new Error(`${phase} does not have an exact Worker ACK.`);
	}
}

function assertStaticFabAuthoredContentIdentity(actual, expected, phase) {
	assertStaticFabWorldContentIdentity(actual, expected, phase);
	for (const key of [
		"modelNextAdvancedSwitchId",
		"modelNextPortId",
		"modelNextEquipmentGroupId",
		"modelNextOrganizationId",
	]) {
		assertEqual(actual[key], expected[key], `${phase} ${key}`);
	}
}

function assertStaticFabWorldContentIdentity(actual, expected, phase) {
	for (const key of [
		"projectId",
		"projectName",
		"physicalPaths",
		"authoredCells",
		"authoredEdges",
		"modelChecksum",
		"modelReadinessFingerprint",
		"modelTopologyFingerprint",
		"equipmentGroups",
		"equipmentPorts",
		"projectBlueprints",
		"staticFabOrganizations",
		"strongComponents",
		"openTerminals",
		"readinessReady",
		"workerChecksum",
		"workerPhysicalPaths",
	]) {
		assertEqual(actual[key], expected[key], `${phase} ${key}`);
	}
	if (!workerIsSettled(actual)) {
		throw new Error(`${phase} does not have an exact Worker ACK.`);
	}
}

function assertFullStaticFabReloadIdentity(actual, expected, phase) {
	assertBoundIdentity(actual, expected, phase);
	assertExactStaticFabModelIdentity(actual, expected, phase);
	assertEqual(actual.workerPhysicalValid, "true", `${phase} physical validity`);
	assertEqual(actual.workerSimulationReady, "false", `${phase} simulation gate`);
}

function assertCanonicalAuthoredEquality(firstJson, secondJson) {
	const first = JSON.parse(firstJson);
	const second = JSON.parse(secondJson);
	delete first.manifest.updatedAt;
	delete second.manifest.updatedAt;
	assertEqual(JSON.stringify(second), JSON.stringify(first), "save-load-save authored JSON");
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}

function assertNotEqual(actual, unexpected, label) {
	if (actual === unexpected) {
		throw new Error(`${label}: expected a value different from ${JSON.stringify(unexpected)}`);
	}
}

function assertIncludes(actual, expectedPart, label) {
	if (!actual.includes(expectedPart)) {
		throw new Error(`${label}: expected ${JSON.stringify(actual)} to include ${expectedPart}`);
	}
}

function assertAtLeast(actual, minimum, label) {
	if (!Number.isFinite(actual) || actual < minimum) {
		throw new Error(`${label}: expected at least ${minimum}, received ${actual}`);
	}
}

function assertAtMost(actual, maximum, label) {
	if (!Number.isFinite(actual) || actual > maximum) {
		throw new Error(`${label}: expected at most ${maximum}, received ${actual}`);
	}
}

function requiredNonNegativeIntegerAttribute(value, label) {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label}: expected a present attribute, received ${JSON.stringify(value)}`);
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
		throw new Error(`${label}: expected a finite non-negative integer, received ${value}`);
	}
	return parsed;
}

function requiredPositiveIntegerAttribute(value, label) {
	const parsed = requiredNonNegativeIntegerAttribute(value, label);
	assertAtLeast(parsed, 1, label);
	return parsed;
}

function assertDurationTelemetry(value, maximum, label) {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`${label}: expected non-empty telemetry, received ${JSON.stringify(value)}`);
	}
	const milliseconds = Number(value);
	assertAtLeast(milliseconds, 0, label);
	assertAtMost(milliseconds, maximum, label);
}

async function waitForProjectOperation(page, operation) {
	await page.waitForFunction(
		(expected) => document.querySelector(".tilefab-app")?.dataset.projectOperation === expected,
		operation,
		{ timeout: 10_000 },
	);
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

async function launchBrowserWithRetry() {
	let lastError;
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			return await chromium.launch({
				executablePath: chromePath,
				headless: true,
				timeout: 20_000,
			});
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	throw lastError;
}

async function stopPreviewServer(child) {
	if (child.exitCode !== null) return;
	const exited = new Promise((resolve) => {
		child.once("exit", resolve);
		child.once("error", resolve);
	});
	child.kill("SIGTERM");
	await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
	if (child.exitCode === null) child.kill("SIGKILL");
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
	throw new Error(`Static FAB authoring preview did not start at ${url}.`);
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
