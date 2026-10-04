// Actual Connector Undo/Redo admission matrix over one authored fixture.

import { createHash } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	exerciseAssembleBayActionsDuringHeldReplay,
	readAssembleContext,
	readCurrentPhysicalContract,
} from "./assemble-held-replay-acceptance.mjs";

const VIEWPORTS = Object.freeze([
	{ width: 1440, height: 900 },
	{ width: 760, height: 900 },
	{ width: 390, height: 600 },
]);
const MODES = Object.freeze(["cancel-button", "escape", "release"]);
const BAY_ACTIONS = Object.freeze([
	["assemble-edit-selected-bay-alternating", "assemble-edit-flow-status"],
	["assemble-edit-selected-bay-co-rotating", "assemble-edit-flow-status"],
	["assemble-disconnect-selected-bay", "assemble-disconnect-status"],
	["assemble-delete-selected-bay", "assemble-delete-status"],
]);
const CURSORS = Object.freeze([
	"modelNextAdvancedSwitchId",
	"modelNextPortId",
	"modelNextEquipmentGroupId",
	"modelNextOrganizationId",
	"modelNextRelationshipId",
]);
const STABLE_FIELDS = Object.freeze([
	"projectId",
	"projectName",
	"projectDirty",
	"authoredCells",
	"authoredEdges",
	"physicalPaths",
	"modelChecksum",
	"modelTopologyFingerprint",
	"modelReadinessFingerprint",
	"equipmentGroups",
	"equipmentPorts",
	"projectBlueprints",
	"staticFabOrganizations",
	"modelRelationships",
	"strongComponents",
	"openTerminals",
	"historyCanUndo",
	"historyCanRedo",
	"documentCanUndo",
	"documentCanRedo",
	...CURSORS,
]);

function equal(actual, expected, label) {
	if (!isDeepStrictEqual(actual, expected))
		throw new Error(`${label}: ${JSON.stringify({ actual, expected })}`);
}

function physicalSummary(snapshot) {
	return {
		revision: snapshot.revision,
		contentSha256: createHash("sha256").update(JSON.stringify(snapshot.contract)).digest("hex"),
	};
}

function assertPhysicalMatchesCurrentMetrics(physical, baselinePhysical, metrics, label) {
	equal(
		physical.revision,
		numericMetric(metrics, "modelRevision"),
		`${label} physical current source revision`,
	);
	if (!isDeepStrictEqual(physical.contract, baselinePhysical.contract)) {
		const error = new Error(`${label}: complete physical content changed across replay`);
		error.openfabPhysicalContractEvidence = { baseline: baselinePhysical, current: physical };
		throw error;
	}
}

function integer(value, label, minimum = 0) {
	if (!Number.isSafeInteger(value) || value < minimum)
		throw new Error(`${label}: missing or invalid integer ${String(value)}`);
	return value;
}

function numericMetric(metrics, key) {
	if (
		!Object.hasOwn(metrics, key) ||
		typeof metrics[key] !== "string" ||
		!/^\d+$/.test(metrics[key])
	)
		throw new Error(`Required numeric metric is missing: ${key}`);
	return integer(Number(metrics[key]), key);
}

function requireHelpers(helpers) {
	for (const name of [
		"readMetrics",
		"readStandaloneLoopAuthoringContract",
		"assertProjectUnchanged",
		"assertSingleGuidedPortCommit",
		"waitForWorker",
		"waitForReady",
		"assertLocatorInsideViewport",
		"assertLocatorOwnsHitArea",
		"checkRepairSettleFrames",
		"checkRepairNeutralBodyPoint",
		"checkRepairWheelMovement",
		"parseIntegerTuple",
		"selectOrganizationsThroughAssemble",
		"selectOrganizationIdThroughBrowser",
		"openStaticFabAssembleMenu",
		"closeBrowserResource",
		"recordStep",
	])
		if (typeof helpers?.[name] !== "function")
			throw new Error(`Required current acceptance helper is missing: ${name}`);
}

function requireMirror(metrics, label) {
	for (const key of [
		...STABLE_FIELDS,
		"modelPhysicalFingerprint",
		"modelSequence",
		"modelRevision",
		"workerSequence",
		"workerRevision",
		"workerTargetSequence",
		"workerTargetRevision",
		"workerTargetChecksum",
		"workerChecksum",
		"workerPhysicalSequence",
		"workerPhysicalRevision",
		"workerPhysicalFingerprint",
		"workerSimulationReady",
		"workerStatus",
	]) {
		if (
			!Object.hasOwn(metrics, key) ||
			typeof metrics[key] !== "string" ||
			metrics[key].length === 0
		)
			throw new Error(`${label}: required readout missing ${key}`);
	}
	for (const key of CURSORS) numericMetric(metrics, key);
	for (const key of ["workerSequence", "workerTargetSequence", "workerPhysicalSequence"])
		equal(metrics[key], metrics.modelSequence, `${label} exact current ${key}`);
	for (const key of ["workerRevision", "workerTargetRevision", "workerPhysicalRevision"])
		equal(metrics[key], metrics.modelRevision, `${label} exact current ${key}`);
	for (const key of ["workerTargetChecksum", "workerChecksum"])
		equal(metrics[key], metrics.modelChecksum, `${label} checksum ${key}`);
	equal(
		metrics.workerPhysicalFingerprint,
		metrics.modelPhysicalFingerprint,
		`${label} physical mirror parity`,
	);
	equal(metrics.workerStatus, "ready", `${label} real mirror ready`);
	equal(metrics.workerSimulationReady, "false", `${label} simulation remains gated`);
}

async function readConnectorHead(page) {
	return page.evaluate(() => {
		const doc = window.__tileFab?.getDocument?.();
		if (
			!doc ||
			typeof doc.canReplayStaticFabAssemblyConnector !== "function" ||
			typeof doc.canReplayStaticFabArrangement !== "function" ||
			typeof doc.canReplayStaticFabProcessLoopRegistration !== "function" ||
			typeof doc.canReplayStaticFabProcessLoopRepair !== "function" ||
			typeof doc.canUndo !== "boolean" ||
			typeof doc.canRedo !== "boolean"
		)
			throw new Error("Required actual history read port is absent.");
		const forDirection = (direction) => ({
			connector: doc.canReplayStaticFabAssemblyConnector(direction),
			arrangement: doc.canReplayStaticFabArrangement(direction),
			loop:
				doc.canReplayStaticFabProcessLoopRegistration(direction) ||
				doc.canReplayStaticFabProcessLoopRepair(direction),
		});
		const head = {
			undo: forDirection("undo"),
			redo: forDirection("redo"),
			canUndo: doc.canUndo,
			canRedo: doc.canRedo,
		};
		if (
			[...Object.values(head.undo), ...Object.values(head.redo)].some(
				(value) => typeof value !== "boolean",
			)
		)
			throw new Error("Actual history availability is malformed.");
		return head;
	});
}

// Observer-only init instrumentation: it counts the actual constructed/terminated
// Workers. It never replaces source, history, camera, selection, or Worker results.
async function installOwnedWorkerObserver(context) {
	await context.addInitScript(() => {
		if (Object.hasOwn(globalThis, "__openfabAcceptanceWorkerStarts"))
			throw new Error("Worker observer is already owned.");
		const NativeWorker = globalThis.Worker;
		if (typeof NativeWorker !== "function")
			throw new Error("Native Worker constructor is unavailable.");
		const observed = {
			workerTotal: 0,
			workerTerminated: 0,
			workerLive: 0,
			workerLiveUrls: {},
			urls: [],
		};
		Object.defineProperty(globalThis, "__openfabAcceptanceWorkerStarts", {
			value: observed,
			writable: false,
			configurable: false,
		});
		globalThis.Worker = new Proxy(NativeWorker, {
			construct(target, args) {
				const url = String(args[0] ?? "");
				if (!url) throw new Error("Actual Worker URL is empty.");
				const worker = Reflect.construct(target, args);
				observed.workerTotal++;
				observed.workerLive++;
				observed.workerLiveUrls[url] = (observed.workerLiveUrls[url] ?? 0) + 1;
				observed.urls.push(url);
				const terminate = worker.terminate;
				let terminated = false;
				Object.defineProperty(worker, "terminate", {
					configurable: true,
					value(...args) {
						if (!terminated) {
							terminated = true;
							observed.workerTerminated++;
							observed.workerLive--;
							if (--observed.workerLiveUrls[url] === 0) delete observed.workerLiveUrls[url];
						}
						return Reflect.apply(terminate, this, args);
					},
				});
				return worker;
			},
		});
	});
}

async function measureReadyBayAction(page, control, label, helpers) {
	await control.scrollIntoViewIfNeeded();
	await helpers.assertLocatorInsideViewport(page, control);
	await helpers.assertLocatorOwnsHitArea(control, label);
	const measured = await control.evaluate((element) => {
		if (!(element instanceof HTMLButtonElement))
			throw new Error("Bay action is not an actual button.");
		const rect = element.getBoundingClientRect();
		const points = [
			[rect.left + rect.width / 2, rect.top + rect.height / 2],
			[rect.left + 4, rect.top + 4],
			[rect.right - 4, rect.top + 4],
			[rect.left + 4, rect.bottom - 4],
			[rect.right - 4, rect.bottom - 4],
		];
		return {
			width: rect.width,
			height: rect.height,
			x: rect.x,
			y: rect.y,
			disabled: element.disabled,
			pointsOwned: points.map(([x, y]) => element.contains(document.elementFromPoint(x, y))),
		};
	});
	if (measured.width < 44 || measured.height < 44)
		throw new Error(`${label}: actual target is smaller than 44×44 ${JSON.stringify(measured)}`);
	equal(measured.disabled, false, `${label} actual ready button`);
	equal(measured.pointsOwned, [true, true, true, true, true], `${label} five actual hit points`);
	return measured;
}

function expectedInverseWithObservedHighWater(before, after, beforeMetrics, afterMetrics) {
	const inverse = structuredClone(before); // Node-side expected oracle only.
	for (const [contract, key, metric] of [
		["organizations", "nextOrganizationId", "modelNextOrganizationId"],
		["relationships", "nextRelationshipId", "modelNextRelationshipId"],
		["equipment", "nextPortId", "modelNextPortId"],
		["equipment", "nextEquipmentGroupId", "modelNextEquipmentGroupId"],
	]) {
		const old = integer(before[contract]?.[key], `pre-second ${contract}.${key}`);
		const high = integer(after[contract]?.[key], `post-second ${contract}.${key}`);
		if (high < old) throw new Error(`Allocator high-water regressed: ${contract}.${key}`);
		equal(old, numericMetric(beforeMetrics, metric), `pre-second source/metric ${metric}`);
		equal(high, numericMetric(afterMetrics, metric), `post-second source/metric ${metric}`);
		inverse[contract][key] = high;
	}
	// Advanced switch high-water is outside this existing five-contract reader.
	// It is recorded and checked independently on actual Undo/Redo metrics below.
	for (const key of CURSORS) {
		if (numericMetric(afterMetrics, key) < numericMetric(beforeMetrics, key))
			throw new Error(`Observed allocator regressed: ${key}`);
	}
	return inverse;
}

export async function createThreeBayTwoConnectorFixture(page, helpers) {
	await helpers.waitForReady(page, { physicalPaths: 0 });
	const start = page.getByTestId("openfab-start-dialog");
	await start.waitFor({ state: "visible" });
	await start.getByRole("button", { name: /BLANK CANVAS/ }).click();
	await helpers.waitForReady(page, { physicalPaths: 0 });
	await page.getByTestId("editor-activity-assemble").click();
	await page.getByTestId("production-bay-module-browser").click();
	const settings = page.getByTestId("production-bay-module-panel");
	await settings.waitFor({ state: "visible" });
	await settings.getByRole("button", { name: "배치 위치 선택" }).click();
	await settings.waitFor({ state: "hidden" });
	const canvas = page.getByTestId("rail-canvas");
	await canvas.focus();
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset
				.organizationBundlePreviewState === "candidate",
	);
	const origin = helpers.parseIntegerTuple(
		(await helpers.readMetrics(page)).organizationBundlePreviewAnchor,
		2,
		"three-Bay initial actual anchor",
	);
	const bayIds = [],
		placements = [];
	for (let ordinal = 0; ordinal < 3; ordinal++) {
		const target = [origin[0] + ordinal * 100, origin[1]];
		for (let step = 0; step < 400; step++) {
			const anchor = helpers.parseIntegerTuple(
				(await helpers.readMetrics(page)).organizationBundlePreviewAnchor,
				2,
				"three-Bay actual keyboard anchor",
			);
			if (isDeepStrictEqual(anchor, target)) break;
			await canvas.press(
				anchor[0] < target[0]
					? "ArrowRight"
					: anchor[0] > target[0]
						? "ArrowLeft"
						: anchor[1] < target[1]
							? "ArrowDown"
							: "ArrowUp",
			);
			await page.waitForFunction(
				(previous) =>
					document.querySelector('[data-testid="rail-canvas"]')?.dataset
						.organizationBundlePreviewAnchor !== previous,
				anchor.join(","),
			);
		}
		const before = await helpers.readMetrics(page);
		equal(
			before.organizationBundlePreviewAnchor,
			target.join(","),
			`actual Bay ${ordinal} keyboard target`,
		);
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="rail-canvas"]')?.dataset
					.organizationBundlePreviewState === "candidate",
		);
		await canvas.press("Enter");
		const placed = await helpers.waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1 &&
				Number(metrics.staticFabOrganizations) > Number(before.staticFabOrganizations),
			{ timeout: 30_000 },
		);
		helpers.assertSingleGuidedPortCommit(
			placed,
			before,
			`actual Bay ${ordinal} one placement patch`,
		);
		requireMirror(placed, `actual Bay ${ordinal}`);
		const id = numericMetric(placed, "lastPlacedOrganizationRootId");
		integer(id, `actual Bay ${ordinal} ID`, 1);
		if (bayIds.includes(id)) throw new Error("Actual Bay roots are not distinct.");
		bayIds.push(id);
		placements.push({ id, target, metrics: placed });
		helpers.recordStep("assemble-held-fixture-bay", { ordinal, id, target, metrics: placed });
	}
	await canvas.press("Escape");
	const connectors = [];
	let preSecondSource, preSecondMetrics, postSecondSource, postSecondMetrics;
	for (let index = 0; index < 2; index++) {
		await helpers.selectOrganizationsThroughAssemble(page, [bayIds[index], bayIds[index + 1]]);
		const menu = page.getByTestId("static-fab-assemble-menu");
		await helpers.openStaticFabAssembleMenu(page, menu, `actual Connector ${index}`);
		const before = await helpers.readMetrics(page);
		const beforeSource = await helpers.readStandaloneLoopAuthoringContract(page);
		if (index === 1) {
			preSecondMetrics = before;
			preSecondSource = beforeSource;
		}
		equal(
			await menu.getByTestId("assemble-connect-selected-bays").isEnabled(),
			true,
			`actual Connector ${index} ready entry`,
		);
		await menu.getByTestId("assemble-connect-selected-bays").click();
		const panel = page.getByTestId("static-fab-assembly-connector-panel");
		await panel.waitFor({ state: "visible" });
		await page.waitForFunction(
			() => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const button = document.querySelector(".tilefab-assembly-connector-apply");
				return (
					app?.dataset.assemblyConnectorPhase === "ready" &&
					button instanceof HTMLButtonElement &&
					!button.disabled
				);
			},
			undefined,
			{ timeout: 30_000 },
		);
		helpers.assertProjectUnchanged(
			await helpers.readMetrics(page),
			before,
			`actual Connector ${index} review before Apply`,
		);
		equal(
			await helpers.readStandaloneLoopAuthoringContract(page),
			beforeSource,
			`actual Connector ${index} review all five contracts`,
		);
		await panel.locator(".tilefab-assembly-connector-apply").click();
		const applied = await helpers.waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1 &&
				Number(metrics.modelRelationships) === index + 1,
			{ timeout: 30_000 },
		);
		helpers.assertSingleGuidedPortCommit(
			applied,
			before,
			`actual Connector ${index} one Apply patch`,
		);
		requireMirror(applied, `actual Connector ${index} Apply`);
		await panel.waitFor({ state: "hidden" });
		const source = await helpers.readStandaloneLoopAuthoringContract(page);
		const oldIds = new Set(beforeSource.relationships.records.map((record) => record.id));
		const added = source.relationships.records.filter((record) => !oldIds.has(record.id));
		equal(added.length, 1, `actual Connector ${index} one new relationship`);
		equal(
			[...added[0].participantOrganizationIds].sort((a, b) => a - b),
			[bayIds[index], bayIds[index + 1]].sort((a, b) => a - b),
			`actual Connector ${index} participant pair`,
		);
		equal(added[0].hierarchyRole, "BAY_TO_BANK", `actual Connector ${index} exact role`);
		equal(added[0].purpose, "HIERARCHY_LINK", `actual Connector ${index} exact purpose`);
		equal(
			added[0].managedChildOrganizationIds,
			index === 0 ? [bayIds[0], bayIds[1]] : [bayIds[2]],
			`actual Connector ${index} exact managed children`,
		);
		connectors.push({
			pair: [bayIds[index], bayIds[index + 1]],
			relationship: added[0],
			beforeMetrics: before,
			afterMetrics: applied,
		});
		if (index === 1) {
			postSecondMetrics = applied;
			postSecondSource = source;
		}
		helpers.recordStep("assemble-held-fixture-connector", { index, ...connectors[index] });
	}
	equal(
		postSecondSource.relationships.records.length,
		2,
		"actual fixture has exactly two declared relationships",
	);
	const expectedUndoSource = expectedInverseWithObservedHighWater(
		preSecondSource,
		postSecondSource,
		preSecondMetrics,
		postSecondMetrics,
	);
	const baselinePhysical = await readCurrentPhysicalContract(page);
	equal(
		baselinePhysical.revision,
		numericMetric(postSecondMetrics, "modelRevision"),
		"fixture physical exact source revision",
	);
	return {
		bayIds,
		origin,
		placements,
		connectors,
		preSecondMetrics,
		preSecondSource,
		baselineMetrics: postSecondMetrics,
		baselineSource: postSecondSource,
		baselinePhysical,
		expectedUndoSource,
	};
}

async function assertRestoredFixture(page, fixture, helpers, sequence, label) {
	const current = await helpers.waitForWorker(page, () => true);
	requireMirror(current, label);
	equal(
		numericMetric(current, "modelSequence"),
		sequence,
		`${label} exact cumulative source sequence`,
	);
	for (const key of STABLE_FIELDS)
		equal(current[key], fixture.baselineMetrics[key], `${label} baseline ${key}`);
	const physical = await readCurrentPhysicalContract(page);
	assertPhysicalMatchesCurrentMetrics(physical, fixture.baselinePhysical, current, label);
	equal(
		await helpers.readStandaloneLoopAuthoringContract(page),
		fixture.baselineSource,
		`${label} same exact five-contract fixture`,
	);
	const head = await readConnectorHead(page);
	equal(
		head,
		{
			undo: { connector: true, arrangement: false, loop: false },
			redo: { connector: false, arrangement: false, loop: false },
			canUndo: true,
			canRedo: false,
		},
		`${label} second Connector is still the exact actual replay kind at head`,
	);
	return { metrics: current, head, physical: physicalSummary(physical) };
}

async function assertRetainedAssembleContext(page, before, label) {
	const current = await readAssembleContext(page);
	for (const key of [
		"activity",
		"tool",
		"selection",
		"selectionCount",
		"loopOwner",
		"operation",
		"loopOperation",
		"menuPresent",
		"semanticDialog",
		"flowDialog",
		"semanticPhase",
		"flowPhase",
	])
		equal(current[key], before[key], `${label} retained ${key} before any reselection`);
	const menu = page.getByTestId("static-fab-assemble-menu");
	equal(await menu.isVisible(), true, `${label} retained visible Assemble menu`);
	for (const [id, statusId] of BAY_ACTIONS) {
		equal(await menu.getByTestId(id).count(), 1, `${label} retained unique ${id}`);
		equal(await menu.getByTestId(id).isEnabled(), true, `${label} ready again ${id}`);
		equal(
			await menu.getByTestId(statusId).getAttribute("data-ready"),
			"true",
			`${label} current ready ${statusId}`,
		);
	}
	return current;
}

async function prepareReadySelectedC(page, fixture, helpers, sequence, label) {
	const before = await assertRestoredFixture(
		page,
		fixture,
		helpers,
		sequence,
		`${label} before actual selection`,
	);
	await helpers.selectOrganizationIdThroughBrowser(page, before.metrics, fixture.bayIds[2]);
	if ((await helpers.readMetrics(page)).editorActivity !== "assemble")
		await page.getByTestId("editor-activity-assemble").click();
	const menu = page.getByTestId("static-fab-assemble-menu");
	await helpers.openStaticFabAssembleMenu(page, menu, `${label} actual Assemble reopen`);
	await page.waitForFunction(
		(selectedId) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				app?.dataset.editorActivity === "assemble" &&
				app.dataset.organizationSelectionIds === String(selectedId) &&
				app.dataset.organizationSelectionCount === "1"
			);
		},
		fixture.bayIds[2],
		{ timeout: 10_000 },
	);
	await helpers.checkRepairSettleFrames(page);
	const ready = [];
	for (const [id, statusId] of BAY_ACTIONS) {
		const button = menu.getByTestId(id),
			status = menu.getByTestId(statusId);
		equal(await button.count(), 1, `${label} exact ready ${id}`);
		equal(await button.isEnabled(), true, `${label} actual ready ${id}`);
		equal(
			await status.getAttribute("data-ready"),
			"true",
			`${label} actual current ready ${statusId}`,
		);
		ready.push({
			id,
			statusId,
			statusText: await status.innerText(),
			geometry: await measureReadyBayAction(page, button, `${label} ready ${id}`, helpers),
		});
	}
	helpers.assertProjectUnchanged(
		await helpers.readMetrics(page),
		before.metrics,
		`${label} actual selection/menu/geometry does not author or consume history`,
	);
	const restored = await assertRestoredFixture(
		page,
		fixture,
		helpers,
		sequence,
		`${label} immediately before hold`,
	);
	return {
		ready,
		...restored,
		context: await readAssembleContext(page),
		viewport: page.viewportSize(),
	};
}

export async function exerciseAssembleConnectorHeldIntegration(
	browser,
	{ baseUrl, artifactRoot, onConsoleError, onPageError, includeArrangement = false },
	helpers,
) {
	requireHelpers(helpers);
	if (typeof onConsoleError !== "function" || typeof onPageError !== "function")
		throw new Error("Required error collectors are missing.");
	const context = await browser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true });
	let page;
	const proof = {
		status: "RUNNING",
		scope: "connector-undo-three-viewports-nine-cases-same-page-source",
		fixture: null,
		cases: [],
		currentCase: null,
		finalMetrics: null,
		workerStarts: null,
	};
	try {
		await installOwnedWorkerObserver(context);
		page = await context.newPage();
		page.on("console", (message) => {
			if (message.type() === "error") onConsoleError(message.text());
		});
		page.on("pageerror", (error) => onPageError(error.message));
		await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
		proof.fixture = await createThreeBayTwoConnectorFixture(page, helpers);
		let sequence = numericMetric(proof.fixture.baselineMetrics, "modelSequence");
		for (const viewport of VIEWPORTS) {
			await page.setViewportSize(viewport); // Browser viewport input, no app camera/source setter.
			await helpers.checkRepairSettleFrames(page);
			equal(page.viewportSize(), viewport, "actual matrix viewport");
			for (const releaseMode of MODES) {
				const label = `assemble-connector-held-${viewport.width}x${viewport.height}-${releaseMode}`;
				proof.currentCase = {
					label,
					viewport,
					releaseMode,
					phase: "prepare",
					prehold: null,
					returnedProof: null,
					metricSamples: [],
				};
				const prehold = await prepareReadySelectedC(page, proof.fixture, helpers, sequence, label);
				proof.currentCase.prehold = prehold;
				proof.currentCase.phase = "held-replay";
				const metricSamples = proof.currentCase.metricSamples;
				const observedHelpers = {
					...helpers,
					readMetrics: async (target) => {
						const metrics = await helpers.readMetrics(target);
						metricSamples.push(metrics);
						return metrics;
					},
				};
				const caseProof = await exerciseAssembleBayActionsDuringHeldReplay(
					page,
					{
						kind: "connector",
						releaseMode,
						selectedBayId: proof.fixture.bayIds[2],
						expectedUndoSource: proof.fixture.expectedUndoSource,
						label,
						compactScroller: true,
					},
					observedHelpers,
				);
				proof.currentCase.returnedProof = caseProof;
				proof.currentCase.phase = "verify-restoration";
				equal(caseProof.viewport, viewport, `${label} helper actual viewport`);
				equal(caseProof.attempted.length, 4, `${label} all four disabled Bay actions actually hit`);
				equal(
					caseProof.attempted.map((item) => item.action),
					["Alternating", "Co-rotating", "Disconnect", "Delete"],
					`${label} exact attempted actions`,
				);
				if (!caseProof.scroller || typeof caseProof.scroller.range !== "number")
					throw new Error(`${label}: missing measured owned menu scroller result.`);
				equal(
					caseProof.scroller.wheelExercised,
					caseProof.scroller.range > 1,
					`${label} real owned wheel required exactly when overflowing`,
				);
				if (caseProof.scroller.range > 1)
					equal(
						caseProof.scroller.coverage,
						"overflow-exact-end-start-repeats",
						`${label} repeated actual wheel endpoints`,
					);
				else
					equal(
						caseProof.scroller.coverage,
						"fit-no-wheel-proof",
						`${label} explicit fit without wheel claim`,
					);
				if (releaseMode === "release") {
					const undone = metricSamples.find(
						(metrics) => numericMetric(metrics, "modelSequence") === sequence + 1,
					);
					if (!undone) throw new Error(`${label}: actual Undo metric read is missing.`);
					requireMirror(undone, `${label} actual released Undo`);
					for (const key of CURSORS)
						equal(
							undone[key],
							proof.fixture.baselineMetrics[key],
							`${label} Undo observed allocator high-water ${key}`,
						);
					equal(Number(caseProof.undoneSequence), sequence + 1, `${label} exact Undo sequence`);
					equal(Number(caseProof.redoneSequence), sequence + 2, `${label} exact Redo sequence`);
					sequence += 2;
				} else {
					equal(
						Number(caseProof.cancelledSequence),
						sequence,
						`${label} cancellation consumes no source/history publication`,
					);
				}
				const restored = await assertRestoredFixture(
					page,
					proof.fixture,
					helpers,
					sequence,
					`${label} after case`,
				);
				restored.context = await assertRetainedAssembleContext(page, prehold.context, label);
				proof.currentCase.restored = restored;
				proof.currentCase.phase = "capture-completed-case";
				const png = `${label}-restored.png`;
				await page.screenshot({ path: path.join(artifactRoot, png) });
				const entry = {
					label,
					viewport,
					releaseMode,
					prehold,
					...caseProof,
					metricSamples,
					restored,
					screenshot: png,
				};
				proof.cases.push(entry);
				helpers.recordStep("assemble-connector-held-case", { proof: entry });
				proof.currentCase = null;
			}
		}
		equal(proof.cases.length, 9, "all nine actual Connector held cases completed");
		for (const viewport of VIEWPORTS)
			equal(
				proof.cases
					.filter((entry) => isDeepStrictEqual(entry.viewport, viewport))
					.map((entry) => entry.releaseMode),
				MODES,
				`all three actual release modes at ${viewport.width}x${viewport.height}`,
			);
		equal(
			sequence,
			numericMetric(proof.fixture.baselineMetrics, "modelSequence") + 6,
			"nine cases author only three real Undo/Redo pairs",
		);
		proof.finalMetrics = (
			await assertRestoredFixture(
				page,
				proof.fixture,
				helpers,
				sequence,
				"matrix final same fixture",
			)
		).metrics;
		if (includeArrangement) {
			const { exerciseAssembleArrangementHeldExtension } = await import(
				"./assemble-arrangement-held-acceptance.mjs"
			);
			proof.connectorFinalMetrics = proof.finalMetrics;
			proof.arrangement = await exerciseAssembleArrangementHeldExtension(
				page,
				proof.fixture,
				{ artifactRoot, viewports: VIEWPORTS, releaseModes: MODES },
				helpers,
			);
			equal(proof.arrangement.status, "PASS", "actual Arrangement extension status");
			equal(proof.arrangement.cases.length, 9, "separate actual Arrangement9 count");
			proof.finalMetrics = proof.arrangement.finalMetrics;
			proof.scope = "connector9-plus-arrangement9-separate-same-page-source-phases";
			helpers.recordStep("assemble-arrangement-held-extension", { proof: proof.arrangement });
		}

		proof.workerStarts = await page.evaluate(() => {
			const observed = globalThis.__openfabAcceptanceWorkerStarts;
			if (!observed) throw new Error("Actual Worker observer is missing at final capture.");
			return structuredClone(observed);
		});
		proof.status = "PASS";
		return proof;
	} catch (error) {
		proof.status = "FAIL";
		proof.failure = {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : null,
			held: error?.openfabAssembleDraftEvidence ?? null,
			arrangement: error?.openfabArrangementHeldEvidence ?? null,
			physical: error?.openfabPhysicalContractEvidence ?? null,
		};
		if (page) {
			proof.finalMetrics = await helpers
				.readMetrics(page)
				.catch((failure) => ({ readFailure: String(failure) }));
			for (const [key, read] of [
				["failureSource", () => helpers.readStandaloneLoopAuthoringContract(page)],
				["failurePhysical", () => readCurrentPhysicalContract(page)],
				["failureHead", () => readConnectorHead(page)],
				["failureContext", () => readAssembleContext(page)],
				[
					"workerStarts",
					() => page.evaluate(() => structuredClone(globalThis.__openfabAcceptanceWorkerStarts)),
				],
			])
				proof[key] = await read().catch((failure) => ({ readFailure: String(failure) }));
			await page
				.screenshot({ path: path.join(artifactRoot, "assemble-connector-held-failure.png") })
				.catch((failure) => {
					proof.screenshotFailure = String(failure);
				});
		}
		helpers.recordStep("assemble-connector-held-matrix-failure", { proof });
		throw error;
	} finally {
		await helpers.closeBrowserResource(context, "external Connector held matrix context");
	}
}

export {
	assertPhysicalMatchesCurrentMetrics,
	assertRetainedAssembleContext,
	BAY_ACTIONS,
	CURSORS,
	equal,
	expectedInverseWithObservedHighWater,
	installOwnedWorkerObserver,
	integer,
	measureReadyBayAction,
	numericMetric,
	physicalSummary,
	readConnectorHead,
	requireMirror,
	STABLE_FIELDS,
};
