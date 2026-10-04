// Actual held-history Bay admission over an authored fixture.

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	BAY_ACTIONS as ACTIONS,
	assertPhysicalMatchesCurrentMetrics,
	assertRetainedAssembleContext,
	CURSORS,
	equal,
	expectedInverseWithObservedHighWater,
	installOwnedWorkerObserver,
	integer,
	measureReadyBayAction,
	numericMetric,
	physicalSummary,
	requireMirror,
	STABLE_FIELDS,
} from "./assemble-connector-held-acceptance.mjs";
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
const edgeKey = (edge) => `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;

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
		"openStaticFabNavigatorTab",
		"revealOrdinaryEquipmentSlot",
		"clickWorld",
		"exerciseManualStandaloneLoopRegistration",
		"closeBrowserResource",
		"recordStep",
	]) {
		if (typeof helpers?.[name] !== "function")
			throw new Error(`Required current closure helper is missing: ${name}`);
	}
}

function requireSource(source) {
	if (!source || !Array.isArray(source.cells) || source.cells.length === 0)
		throw new Error("Required nonempty authored rail source is missing.");
	for (const key of ["organizations", "equipment", "relationships", "operations"])
		if (!source[key] || typeof source[key] !== "object")
			throw new Error(`Required authored contract is missing: ${key}`);
	if (
		!Array.isArray(source.organizations.records) ||
		!Array.isArray(source.relationships.records) ||
		!Array.isArray(source.equipment.ports) ||
		!Array.isArray(source.equipment.equipmentGroups)
	)
		throw new Error("Required authored record arrays are missing.");
}

function requireStandaloneOwner(source, loopId, label) {
	requireSource(source);
	const owner = source.organizations.records.find((record) => record.id === loopId);
	if (!owner) throw new Error(`${label}: exact registered owner is missing.`);
	equal(owner.kind, "AISLE", `${label} explicit owner kind`);
	equal(owner.declaredSemanticRole, "PROCESS_LOOP", `${label} explicit owner role`);
	equal(owner.parentOrganizationIds, [], `${label} owner remains parentless`);
	if (!Array.isArray(owner.membership?.railEdges) || owner.membership.railEdges.length === 0)
		throw new Error(`${label}: actual Loop direct edge membership is missing.`);
	return owner;
}

function preserveOriginalLoop(initial, current, loopId, label, clearance = 16) {
	const owner = requireStandaloneOwner(initial, loopId, `${label} original`);
	equal(
		requireStandaloneOwner(current, loopId, label),
		owner,
		`${label} exact original Loop record`,
	);
	const currentCells = new Map(current.cells.map(([x, y, encoded]) => [`${x},${y}`, encoded]));
	for (const [x, y, encoded] of initial.cells)
		equal(currentCells.get(`${x},${y}`), encoded, `${label} actual original Loop cell ${x},${y}`);
	const oldCoordinates = new Set(initial.cells.map(([x, y]) => `${x},${y}`));
	const xs = initial.cells.map(([x]) => x),
		ys = initial.cells.map(([, y]) => y);
	const bounds = {
		minX: Math.min(...xs),
		minY: Math.min(...ys),
		maxX: Math.max(...xs),
		maxY: Math.max(...ys),
	};
	for (const [x, y] of current.cells)
		if (
			!oldCoordinates.has(`${x},${y}`) &&
			x >= bounds.minX - clearance &&
			x <= bounds.maxX + clearance &&
			y >= bounds.minY - clearance &&
			y <= bounds.maxY + clearance
		)
			throw new Error(
				`${label}: added Bay/Connector rail encroaches on the registered Loop clearance at ${x},${y}.`,
			);
	for (const field of ["equipment", "operations"])
		equal(current[field], initial[field], `${label} preserves original ${field}`);
	return bounds;
}

async function moveBundleToActualAnchor(page, target, helpers, label) {
	const canvas = page.getByTestId("rail-canvas");
	await canvas.focus();
	for (let step = 0; step < 800; step++) {
		const current = await helpers.readMetrics(page);
		const anchor = helpers.parseIntegerTuple(
			current.organizationBundlePreviewAnchor,
			2,
			`${label} actual anchor`,
		);
		if (isDeepStrictEqual(anchor, target)) break;
		const cursor = [current.cursorX, current.cursorY];
		if (cursor.some((value) => typeof value !== "string" || value.length === 0))
			throw new Error(`${label}: required actual cursor readout missing.`);
		await canvas.press(
			anchor[0] < target[0]
				? "ArrowRight"
				: anchor[0] > target[0]
					? "ArrowLeft"
					: anchor[1] < target[1]
						? "ArrowDown"
						: "ArrowUp",
		);
		// Current source-center snapping can keep anchor unchanged across real1m keys.
		// Wait for actual raw cursor input, then read the application-derived anchor again.
		await page.waitForFunction(
			(previous) => {
				const canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					canvas &&
					[canvas.dataset.cursorX, canvas.dataset.cursorY].every(
						(value) => typeof value === "string" && value.length > 0,
					) &&
					(canvas.dataset.cursorX !== previous[0] || canvas.dataset.cursorY !== previous[1])
				);
			},
			cursor,
			{ timeout: 10_000 },
		);
	}
	equal(
		(await helpers.readMetrics(page)).organizationBundlePreviewAnchor,
		target.join(","),
		`${label} independently chosen actual anchor`,
	);
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset
				.organizationBundlePreviewState === "candidate",
	);
}

async function addThreeBaysAndTwoConnectors(page, registeredSource, loopId, helpers, label) {
	const initialBounds = preserveOriginalLoop(registeredSource, registeredSource, loopId, label);
	await page.getByTestId("editor-activity-assemble").click();
	await page.getByTestId("production-bay-module-browser").click();
	const settings = page.getByTestId("production-bay-module-panel");
	await settings.waitFor({ state: "visible" });
	const selectedFamily = await settings
		.locator('.tilefab-production-bay-family button[aria-pressed="true"]')
		.innerText();
	if (!selectedFamily.includes("TWIN BAY"))
		throw new Error("Actual Production Bay family is not the default Twin Bay.");
	const width = integer(
		Number(
			await settings
				.getByRole("spinbutton", { name: "Outer shell length", exact: true })
				.inputValue(),
		),
		"actual Twin width",
		1,
	);
	const depth = integer(
		Number(
			await settings
				.getByRole("spinbutton", { name: "Outer shell depth", exact: true })
				.inputValue(),
		),
		"actual Twin depth",
		1,
	);
	await settings.getByRole("button", { name: "배치 위치 선택" }).click();
	await settings.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset
				.organizationBundlePreviewState === "candidate",
	);
	const spec = await page.locator(".tilefab-build-spec").innerText();
	if (!/·\s*0°\s*$/.test(spec))
		throw new Error(`Actual Twin placement is not the source-confirmed unrotated default: ${spec}`);
	const base = [initialBounds.maxX + 64, initialBounds.maxY + 64];
	const stride = Math.max(100, width + 64);
	const bayIds = [],
		placements = [],
		connectors = [];
	const canvas = page.getByTestId("rail-canvas");
	for (let index = 0; index < 3; index++) {
		const target = [base[0] + index * stride, base[1]];
		await moveBundleToActualAnchor(page, target, helpers, `${label} Bay ${index}`);
		const before = await helpers.readMetrics(page);
		await canvas.press("Enter");
		const placed = await helpers.waitForWorker(
			page,
			(metrics) =>
				Number(metrics.workerTargetSequence) === Number(before.workerTargetSequence) + 1 &&
				Number(metrics.staticFabOrganizations) === Number(before.staticFabOrganizations) + 3,
			{ timeout: 30_000 },
		);
		helpers.assertSingleGuidedPortCommit(placed, before, `${label} Bay ${index} one actual patch`);
		requireMirror(placed, `${label} Bay ${index}`);
		const id = numericMetric(placed, "lastPlacedOrganizationRootId");
		integer(id, `${label} Bay ${index} actual ID`, 1);
		if (id === loopId || bayIds.includes(id))
			throw new Error("Actual independent Bay root IDs are not distinct.");
		bayIds.push(id);
		const source = await helpers.readStandaloneLoopAuthoringContract(page);
		preserveOriginalLoop(
			registeredSource,
			source,
			loopId,
			`${label} Bay ${index} source isolation`,
		);
		placements.push({ id, target, metrics: placed });
		helpers.recordStep("assemble-loop-fixture-bay", { index, id, target, metrics: placed });
	}
	await canvas.press("Escape");
	for (let index = 0; index < 2; index++) {
		const beforeSelection = await helpers.readMetrics(page);
		const beforeSelectionSource = await helpers.readStandaloneLoopAuthoringContract(page);
		// Registration retains the AISLE filter. Use the existing actual ALL/search
		// navigation before selecting the mixed fixture's exact Bay pair.
		await helpers.selectOrganizationIdThroughBrowser(page, beforeSelection, bayIds[index]);
		await helpers.selectOrganizationsThroughAssemble(page, [bayIds[index], bayIds[index + 1]]);
		const selected = await helpers.readMetrics(page);
		helpers.assertProjectUnchanged(
			selected,
			beforeSelection,
			`${label} pair selection preserves source/history`,
		);
		equal(
			await helpers.readStandaloneLoopAuthoringContract(page),
			beforeSelectionSource,
			`${label} pair selection preserves all five contracts`,
		);
		equal(
			selected.organizationSelectionIds
				.split(",")
				.map(Number)
				.sort((a, b) => a - b),
			[bayIds[index], bayIds[index + 1]].sort((a, b) => a - b),
			`${label} actual exact Bay pair`,
		);
		equal(selected.organizationSelectionCount, "2", `${label} actual pair selection count`);
		helpers.recordStep("assemble-loop-fixture-pair-selection", {
			index,
			before: beforeSelection,
			selected,
		});
		const menu = page.getByTestId("static-fab-assemble-menu");
		await helpers.openStaticFabAssembleMenu(page, menu, `${label} Connector ${index}`);
		const before = await helpers.readMetrics(page),
			beforeSource = await helpers.readStandaloneLoopAuthoringContract(page);
		equal(
			await menu.getByTestId("assemble-connect-selected-bays").isEnabled(),
			true,
			`${label} actual selected pair ready`,
		);
		await menu.getByTestId("assemble-connect-selected-bays").click();
		const connector = page.getByTestId("static-fab-assembly-connector-panel");
		await connector.waitFor({ state: "visible" });
		await page.waitForFunction(
			() => {
				const app = document.querySelector('[data-testid="tilefab-app"]');
				const apply = document.querySelector(".tilefab-assembly-connector-apply");
				return (
					app?.dataset.assemblyConnectorPhase === "ready" &&
					apply instanceof HTMLButtonElement &&
					!apply.disabled
				);
			},
			undefined,
			{ timeout: 30_000 },
		);
		helpers.assertProjectUnchanged(
			await helpers.readMetrics(page),
			before,
			`${label} Connector ${index} review no publication`,
		);
		equal(
			await helpers.readStandaloneLoopAuthoringContract(page),
			beforeSource,
			`${label} Connector ${index} review exact five contracts`,
		);
		await connector.locator(".tilefab-assembly-connector-apply").click();
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
			`${label} Connector ${index} one actual Apply`,
		);
		requireMirror(applied, `${label} Connector ${index}`);
		await connector.waitFor({ state: "hidden" });
		const source = await helpers.readStandaloneLoopAuthoringContract(page);
		preserveOriginalLoop(
			registeredSource,
			source,
			loopId,
			`${label} Connector ${index} source isolation`,
		);
		const oldIds = new Set(beforeSource.relationships.records.map((record) => record.id));
		const added = source.relationships.records.filter((record) => !oldIds.has(record.id));
		equal(added.length, 1, `${label} Connector ${index} one actual relationship`);
		equal(
			[...added[0].participantOrganizationIds].sort((a, b) => a - b),
			[bayIds[index], bayIds[index + 1]].sort((a, b) => a - b),
			`${label} actual participant pair`,
		);
		equal(added[0].hierarchyRole, "BAY_TO_BANK", `${label} actual role`);
		equal(added[0].purpose, "HIERARCHY_LINK", `${label} actual purpose`);
		equal(
			added[0].managedChildOrganizationIds,
			index === 0 ? [bayIds[0], bayIds[1]] : [bayIds[2]],
			`${label} exact managed child set`,
		);
		connectors.push({
			pair: [bayIds[index], bayIds[index + 1]],
			relationship: added[0],
			metrics: applied,
		});
		helpers.recordStep("assemble-loop-fixture-connector", { index, ...connectors[index] });
	}
	return {
		bayIds,
		placements,
		connectors,
		initialBounds,
		actualTwin: { width, depth, spec },
		base,
		stride,
	};
}

// Pure discovery: no assumption that the first map module belongs to this owner.
async function readOwnerOnlyNonPortStraightTarget(page, loopId) {
	return page.evaluate((loopId) => {
		const model = window.__tileFab?.getEditorModel?.(),
			doc = model?.document;
		if (!model?.ownership || !doc || model.ownership.revision !== doc.map.getRevision())
			throw new Error("Exact current source ownership index is missing.");
		if (doc.portEquipment.ports.length !== 0 || doc.portEquipment.equipmentGroups.length !== 0)
			throw new Error(
				"This bounded mixed fixture requires genuine zero-Port/zero-equipment source.",
			);
		const owner = doc.organizations.records.find((record) => record.id === loopId);
		if (
			!owner ||
			owner.kind !== "AISLE" ||
			owner.declaredSemanticRole !== "PROCESS_LOOP" ||
			owner.parentOrganizationIds.length !== 0
		)
			throw new Error("Actual registered parentless owner is missing.");
		const key = (edge) => `${edge.from.x},${edge.from.y}>${edge.to.x},${edge.to.y}`;
		const owned = new Set(owner.membership.railEdges.map(key));
		const other = new Set(
			doc.organizations.records
				.filter((record) => record.id !== loopId)
				.flatMap((record) => record.membership.railEdges.map(key)),
		);
		for (const module of model.ownership.modules) {
			if (
				module.kind !== "straight" ||
				module.advancedSwitchId !== null ||
				module.eraseEdges.length === 0 ||
				!module.eraseEdges.every((edge) => owned.has(key(edge)) && !other.has(key(edge)))
			)
				continue;
			const cell = module.primaryCells.find((cell) => {
				const candidates = model.ownership.candidates(cell);
				return candidates.length === 1 && candidates[0].key === module.key;
			});
			if (!cell) continue;
			const first = module.eraseEdges.find(
				(edge) =>
					!module.eraseEdges.some(
						(other) => other.to.x === edge.from.x && other.to.y === edge.from.y,
					),
			);
			const last = module.eraseEdges.find(
				(edge) =>
					!module.eraseEdges.some(
						(other) => other.from.x === edge.to.x && other.from.y === edge.to.y,
					),
			);
			if (!first || !last) continue;
			return {
				key: module.key,
				x: cell.x + 0.5,
				y: cell.y + 0.5,
				edgeCount: module.eraseEdges.length,
				edges: module.eraseEdges.map((edge) => ({
					from: { x: edge.from.x, y: edge.from.y },
					to: { x: edge.to.x, y: edge.to.y },
				})),
				footprint: module.footprintCells.map((cell) => ({ x: cell.x, y: cell.y })),
				from: { ...first.from },
				to: { ...last.to },
				sequence: doc.getPatchSequence(),
				revision: doc.map.getRevision(),
				loopId,
				portCount: doc.portEquipment.ports.length,
			};
		}
		throw new Error(
			"Combined source has no unambiguous whole straight module belonging only to the registered Loop.",
		);
	}, loopId);
}

async function openCombinedStandaloneLoopRailEdit(page, loopId, helpers, label) {
	const before = await helpers.readMetrics(page),
		beforeSource = await helpers.readStandaloneLoopAuthoringContract(page);
	await helpers.openStaticFabNavigatorTab(page, "organizations");
	const library = page.getByTestId("static-fab-organization-library");
	await library.waitFor({ state: "visible" });
	await library
		.getByRole("tab", { name: `ALL ${before.staticFabOrganizations}`, exact: true })
		.click();
	await library.getByRole("textbox", { name: "저장된 FAB 조직 검색" }).fill("");
	const option = library.locator(`[role="option"][data-organization-id="${loopId}"]`);
	equal(await option.count(), 1, `${label} exact real registered Loop option`);
	await option.click();
	await library.getByRole("tab", { name: "OVERVIEW", exact: true }).click();
	equal(
		await page.getByTestId("tilefab-app").getAttribute("data-selected-port-id"),
		"",
		`${label} no stale Port selection`,
	);
	const edit = page.getByTestId("edit-process-loop-rail");
	await edit.scrollIntoViewIfNeeded();
	await helpers.assertLocatorInsideViewport(page, edit);
	await helpers.assertLocatorOwnsHitArea(edit, `${label} actual mixed-source Loop editor entry`);
	equal(await edit.isEnabled(), true, `${label} actual editor entry ready`);
	await edit.click();
	await page.getByTestId("process-loop-edit-context").waitFor({ state: "visible" });
	equal(
		await page.getByTestId("tilefab-app").getAttribute("data-process-loop-edit-owner"),
		String(loopId),
		`${label} exact actual Loop editor owner`,
	);
	helpers.assertProjectUnchanged(
		await helpers.readMetrics(page),
		before,
		`${label} real entry is source/history neutral`,
	);
	equal(
		await helpers.readStandaloneLoopAuthoringContract(page),
		beforeSource,
		`${label} actual entry all five contracts`,
	);
}

async function readActualRepairHead(page) {
	return page.evaluate(() => {
		const doc = window.__tileFab?.getDocument?.();
		for (const name of [
			"canReplayStaticFabProcessLoopRepair",
			"canReplayStaticFabProcessLoopRegistration",
			"canReplayStaticFabAssemblyConnector",
			"canReplayStaticFabArrangement",
		])
			if (typeof doc?.[name] !== "function")
				throw new Error(`Required actual replay read port absent: ${name}`);
		if (typeof doc.canUndo !== "boolean" || typeof doc.canRedo !== "boolean")
			throw new Error("Actual history flags are missing.");
		const availability = (direction) => ({
			repair: doc.canReplayStaticFabProcessLoopRepair(direction),
			registration: doc.canReplayStaticFabProcessLoopRegistration(direction),
			connector: doc.canReplayStaticFabAssemblyConnector(direction),
			arrangement: doc.canReplayStaticFabArrangement(direction),
		});
		return {
			undo: availability("undo"),
			redo: availability("redo"),
			canUndo: doc.canUndo,
			canRedo: doc.canRedo,
		};
	});
}

export async function createCombinedRegisteredLoopRepairFixture(page, helpers, label) {
	requireHelpers(helpers);
	await helpers.waitForReady(page, { physicalPaths: 0 });
	await page
		.getByTestId("openfab-start-dialog")
		.getByRole("button", { name: /BLANK CANVAS/ })
		.click();
	const registration = await helpers.exerciseManualStandaloneLoopRegistration(
		page,
		`${label}-manual`,
	);
	const loopId = integer(registration.organizationId, "actual registered Loop ID", 1);
	const registeredMetrics = await helpers.waitForWorker(page, () => true),
		registeredSource = await helpers.readStandaloneLoopAuthoringContract(page);
	requireMirror(registeredMetrics, `${label} actual registration`);
	equal(registeredMetrics.authoredCells, "100", `${label} actual manual rectangle cells`);
	equal(registeredMetrics.authoredEdges, "100", `${label} actual manual rectangle edges`);
	equal(registeredMetrics.staticFabOrganizations, "1", `${label} actual registered owner count`);
	equal(registeredMetrics.equipmentPorts, "0", `${label} actual no-Port rectangle`);
	requireStandaloneOwner(registeredSource, loopId, label);
	helpers.recordStep("assemble-loop-fixture-registered", {
		registration,
		registeredMetrics,
		registeredSource,
	});
	const bays = await addThreeBaysAndTwoConnectors(page, registeredSource, loopId, helpers, label);
	const closedMetrics = await helpers.waitForWorker(page, () => true),
		closedSource = await helpers.readStandaloneLoopAuthoringContract(page);
	const target = await readOwnerOnlyNonPortStraightTarget(page, loopId);
	equal(
		target.sequence,
		Number(closedMetrics.modelSequence),
		`${label} exact current target source sequence`,
	);
	helpers.recordStep("assemble-loop-fixture-before-delete", {
		loopId,
		target,
		closedMetrics,
		closedSource,
	});
	await openCombinedStandaloneLoopRailEdit(page, loopId, helpers, label);
	const canvas = page.getByTestId("rail-canvas"),
		select = page.getByTestId("select-process-loop-rail");
	await select.scrollIntoViewIfNeeded();
	await helpers.assertLocatorInsideViewport(page, select);
	await helpers.assertLocatorOwnsHitArea(select, `${label} real owner rail selection`);
	await select.click();
	// The current reveal helper pans through real right drags; clickWorld(false)
	// only reads the actual live camera and sends the actual pointer click.
	await helpers.revealOrdinaryEquipmentSlot(page, target, `${label} exact owner-only whole module`);
	await helpers.clickWorld(page, target, false);
	await page.waitForFunction(
		(key) =>
			document.querySelector('[data-testid="rail-canvas"]')?.dataset.selectedModuleId === key,
		target.key,
	);
	equal(
		await page.getByTestId("tilefab-app").getAttribute("data-process-loop-edit-owner"),
		String(loopId),
		`${label} exact owner survives real pan/select`,
	);
	helpers.assertProjectUnchanged(
		await helpers.readMetrics(page),
		closedMetrics,
		`${label} actual pan/select is source/history neutral`,
	);
	equal(
		await helpers.readStandaloneLoopAuthoringContract(page),
		closedSource,
		`${label} before Delete exact five contracts`,
	);
	await canvas.press("Delete");
	const openedMetrics = await helpers.waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === Number(closedMetrics.workerTargetSequence) + 1,
		{ timeout: 30_000 },
	);
	helpers.assertSingleGuidedPortCommit(
		openedMetrics,
		closedMetrics,
		`${label} actual whole-module Delete one typed patch`,
	);
	requireMirror(openedMetrics, `${label} actual Loop repair publication`);
	equal(
		Number(openedMetrics.authoredEdges),
		Number(closedMetrics.authoredEdges) - target.edgeCount,
		`${label} actual exact directed removal count`,
	);
	if (Number(openedMetrics.openTerminals) < 1)
		throw new Error(`${label}: actual module Delete did not produce an open Loop.`);
	for (const key of CURSORS)
		equal(openedMetrics[key], closedMetrics[key], `${label} Delete preserves allocator ${key}`);
	const openedSource = await helpers.readStandaloneLoopAuthoringContract(page);
	const beforeOwner = requireStandaloneOwner(closedSource, loopId, label),
		afterOwner = requireStandaloneOwner(openedSource, loopId, label);
	for (const field of [
		"id",
		"kind",
		"name",
		"declaredSemanticRole",
		"parentOrganizationIds",
		"properties",
	])
		equal(afterOwner[field], beforeOwner[field], `${label} owner ${field}`);
	for (const field of ["advancedSwitchIds", "equipmentGroupIds"])
		equal(
			afterOwner.membership[field],
			beforeOwner.membership[field],
			`${label} owner membership ${field}`,
		);
	const erased = new Set(target.edges.map(edgeKey));
	equal(
		afterOwner.membership.railEdges.map(edgeKey).sort(),
		beforeOwner.membership.railEdges
			.filter((edge) => !erased.has(edgeKey(edge)))
			.map(edgeKey)
			.sort(),
		`${label} exactly selected owner edges removed`,
	);
	for (const original of closedSource.organizations.records.filter(
		(record) => record.id !== loopId,
	))
		equal(
			openedSource.organizations.records.find((record) => record.id === original.id),
			original,
			`${label} untouched Bay/Bank/child #${original.id}`,
		);
	equal(
		openedSource.organizations.records.length,
		closedSource.organizations.records.length,
		`${label} no unrelated organization added/removed`,
	);
	for (const field of ["equipment", "relationships", "operations"])
		equal(openedSource[field], closedSource[field], `${label} Delete preserves exact ${field}`);
	const touched = new Set(
		target.edges.flatMap((edge) => [`${edge.from.x},${edge.from.y}`, `${edge.to.x},${edge.to.y}`]),
	);
	const openedCells = new Map(openedSource.cells.map(([x, y, encoded]) => [`${x},${y}`, encoded]));
	for (const [x, y, encoded] of closedSource.cells)
		if (!touched.has(`${x},${y}`))
			equal(openedCells.get(`${x},${y}`), encoded, `${label} untouched authored cell ${x},${y}`);
	const expectedUndoSource = expectedInverseWithObservedHighWater(
		closedSource,
		openedSource,
		closedMetrics,
		openedMetrics,
	);
	helpers.recordStep("assemble-loop-fixture-actual-delete", {
		loopId,
		target,
		openedMetrics,
		openedSource,
		expectedUndoSource,
	});
	const exit = page.getByTestId("exit-process-loop-edit");
	await exit.scrollIntoViewIfNeeded();
	await helpers.assertLocatorInsideViewport(page, exit);
	await helpers.assertLocatorOwnsHitArea(exit, `${label} actual Loop editor exit`);
	await exit.click();
	await page.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.processLoopEditOwner === "" &&
			document.querySelector('[data-testid="tilefab-app"]')?.dataset.processLoopOperation === "",
	);
	helpers.assertProjectUnchanged(
		await helpers.readMetrics(page),
		openedMetrics,
		`${label} actual exit retains published repair/history`,
	);
	const baselinePhysical = await readCurrentPhysicalContract(page);
	assertPhysicalMatchesCurrentMetrics(
		baselinePhysical,
		baselinePhysical,
		openedMetrics,
		`${label} open Loop baseline physical`,
	);
	return {
		registration,
		loopId,
		registeredMetrics,
		registeredSource,
		...bays,
		target,
		closedMetrics,
		closedSource,
		baselineMetrics: openedMetrics,
		baselineSource: openedSource,
		baselinePhysical,
		expectedUndoSource,
	};
}

async function assertRestoredLoopFixture(page, fixture, helpers, sequence, label) {
	const metrics = await helpers.waitForWorker(page, () => true);
	requireMirror(metrics, label);
	equal(
		numericMetric(metrics, "modelSequence"),
		sequence,
		`${label} cumulative exact source sequence`,
	);
	for (const key of STABLE_FIELDS)
		equal(metrics[key], fixture.baselineMetrics[key], `${label} exact restored ${key}`);
	equal(
		await helpers.readStandaloneLoopAuthoringContract(page),
		fixture.baselineSource,
		`${label} same exact open Loop/Bay source`,
	);
	const head = await readActualRepairHead(page);
	equal(
		head,
		{
			undo: { repair: true, registration: false, connector: false, arrangement: false },
			redo: { repair: false, registration: false, connector: false, arrangement: false },
			canUndo: true,
			canRedo: false,
		},
		`${label} actual repair Undo head, no registration substitution`,
	);
	equal(
		await page.getByTestId("tilefab-app").getAttribute("data-process-loop-edit-owner"),
		"",
		`${label} actual old Loop context remains exited`,
	);
	const physical = await readCurrentPhysicalContract(page);
	assertPhysicalMatchesCurrentMetrics(physical, fixture.baselinePhysical, metrics, label);
	return { metrics, head, physical: physicalSummary(physical) };
}

// Read-only settled-context oracle. Never restore selection, activity or menu here:
// those actual UI inputs belong only to the separate pre-hold preparation below.
async function assertSettledCAssembleContext(page, fixture, helpers, expectedTool, label) {
	await helpers.checkRepairSettleFrames(page);
	const context = await page.evaluate(() => {
		const apps = document.querySelectorAll('[data-testid="tilefab-app"]');
		if (apps.length !== 1)
			throw new Error("Required exact current App readout is missing or ambiguous.");
		const app = apps[0];
		const required = (name) => {
			if (!app.hasAttribute(name))
				throw new Error(`Required settled App readout is missing: ${name}`);
			return app.getAttribute(name);
		};
		return {
			activity: required("data-editor-activity"),
			tool: required("data-editor-tool"),
			selectionIds: required("data-organization-selection-ids"),
			selectionCount: required("data-organization-selection-count"),
			projectOperation: required("data-project-operation"),
			loopOwner: required("data-process-loop-edit-owner"),
			loopOperation: required("data-process-loop-operation"),
			semanticPhase: required("data-semantic-bay-command-phase"),
			semanticAction: required("data-semantic-bay-command-action"),
			semanticId: required("data-semantic-bay-command-id"),
			flowPhase: required("data-bay-flow-edit-command-phase"),
			flowTarget: required("data-bay-flow-edit-command-target"),
			flowId: required("data-bay-flow-edit-command-id"),
			genericHistoryCount: document.querySelectorAll(
				'[data-testid="static-fab-arrangement-history"]',
			).length,
			semanticDialogCount: document.querySelectorAll('[data-testid="semantic-bay-command-dialog"]')
				.length,
			flowDialogCount: document.querySelectorAll('[data-testid="bay-flow-edit-dialog"]').length,
		};
	});
	equal(context.activity, "assemble", `${label} retained Assemble activity`);
	equal(context.selectionIds, String(fixture.bayIds[2]), `${label} retained exact original C`);
	equal(context.selectionCount, "1", `${label} retained single original C`);
	if (typeof context.tool !== "string" || context.tool.length === 0)
		throw new Error(`${label}: actual retained tool readout is invalid.`);
	if (expectedTool !== null)
		equal(context.tool, expectedTool, `${label} retained actual pre-hold tool`);
	equal(context.projectOperation, "idle", `${label} settled actual project idle`);
	for (const key of [
		"loopOwner",
		"loopOperation",
		"semanticPhase",
		"semanticAction",
		"semanticId",
		"flowPhase",
		"flowTarget",
		"flowId",
	])
		equal(context[key], "", `${label} no pending operation or Bay command ${key}`);
	for (const key of ["genericHistoryCount", "semanticDialogCount", "flowDialogCount"])
		equal(context[key], 0, `${label} no pending preparation or Bay dialog ${key}`);
	const menu = page.getByTestId("static-fab-assemble-menu");
	equal(await menu.count(), 1, `${label} same unique Assemble menu`);
	equal(await menu.isVisible(), true, `${label} retained visible Assemble menu`);
	const buttons = [],
		availability = {};
	for (const [id, statusId] of ACTIONS) {
		const button = menu.getByTestId(id),
			status = menu.getByTestId(statusId);
		equal(await button.count(), 1, `${label} exact restored Bay control ${id}`);
		equal(await button.isEnabled(), true, `${label} restored Bay control enabled ${id}`);
		buttons.push({ id, enabled: true });
		if (!Object.hasOwn(availability, statusId)) {
			equal(await status.count(), 1, `${label} exact current availability ${statusId}`);
			const ready = await status.getAttribute("data-ready");
			equal(ready, "true", `${label} restored current source availability ${statusId}`);
			availability[statusId] = { ready, text: await status.innerText() };
		}
	}
	equal(Object.keys(availability).length, 3, `${label} all three current availability readouts`);
	return { context, buttons, availability, menuVisible: true };
}

async function prepareReadyC(page, fixture, helpers, sequence, label) {
	const before = await assertRestoredLoopFixture(
		page,
		fixture,
		helpers,
		sequence,
		`${label} before selection`,
	);
	await helpers.selectOrganizationIdThroughBrowser(page, before.metrics, fixture.bayIds[2]);
	if ((await helpers.readMetrics(page)).editorActivity !== "assemble")
		await page.getByTestId("editor-activity-assemble").click();
	const menu = page.getByTestId("static-fab-assemble-menu");
	await helpers.openStaticFabAssembleMenu(page, menu, `${label} actual menu`);
	await page.waitForFunction((id) => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		return (
			app?.dataset.editorActivity === "assemble" &&
			app.dataset.organizationSelectionIds === String(id) &&
			app.dataset.organizationSelectionCount === "1"
		);
	}, fixture.bayIds[2]);
	await helpers.checkRepairSettleFrames(page);
	const ready = [];
	for (const [id, statusId] of ACTIONS) {
		const button = menu.getByTestId(id),
			status = menu.getByTestId(statusId);
		equal(await button.isEnabled(), true, `${label} actual ready ${id}`);
		equal(await status.getAttribute("data-ready"), "true", `${label} actual ready ${statusId}`);
		ready.push({
			id,
			statusId,
			text: await status.innerText(),
			geometry: await measureReadyBayAction(page, button, `${label} ${id}`, helpers),
		});
	}
	helpers.assertProjectUnchanged(
		await helpers.readMetrics(page),
		before.metrics,
		`${label} actual selection/menu is neutral`,
	);
	const restored = await assertRestoredLoopFixture(
		page,
		fixture,
		helpers,
		sequence,
		`${label} immediately before hold`,
	);
	const settledContext = await assertSettledCAssembleContext(
		page,
		fixture,
		helpers,
		null,
		`${label} actual ready context`,
	);
	return {
		ready,
		...restored,
		settledContext,
		context: await readAssembleContext(page),
		viewport: page.viewportSize(),
	};
}

export async function exerciseCombinedRegisteredLoopHeldMatrix(
	browser,
	{ baseUrl, artifactRoot, onConsoleError, onPageError },
	helpers,
) {
	requireHelpers(helpers);
	if (typeof onConsoleError !== "function" || typeof onPageError !== "function")
		throw new Error("Required error collectors are missing.");
	const context = await browser.newContext({ viewport: VIEWPORTS[0], acceptDownloads: true });
	let page;
	const proof = {
		status: "RUNNING",
		scope: "registered-Loop-repair-Undo-same-combined-source-three-viewports-nine-cases",
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
		proof.fixture = await createCombinedRegisteredLoopRepairFixture(
			page,
			helpers,
			"assemble-loop-fixture",
		);
		let sequence = numericMetric(proof.fixture.baselineMetrics, "modelSequence");
		for (const viewport of VIEWPORTS) {
			await page.setViewportSize(viewport);
			await helpers.checkRepairSettleFrames(page);
			equal(page.viewportSize(), viewport, "actual combined Loop matrix viewport");
			for (const releaseMode of MODES) {
				const label = `assemble-loop-held-${viewport.width}x${viewport.height}-${releaseMode}`;
				proof.currentCase = {
					label,
					viewport,
					releaseMode,
					phase: "prepare",
					prehold: null,
					returnedProof: null,
					metricSamples: [],
				};
				const prehold = await prepareReadyC(page, proof.fixture, helpers, sequence, label);
				proof.currentCase.prehold = prehold;
				proof.currentCase.phase = "held-replay";
				const metricSamples = proof.currentCase.metricSamples;
				const observed = {
					...helpers,
					readMetrics: async (target) => {
						const metrics = await helpers.readMetrics(target);
						metricSamples.push(metrics);
						return metrics;
					},
				};
				const held = await exerciseAssembleBayActionsDuringHeldReplay(
					page,
					{
						kind: "loop",
						releaseMode,
						selectedBayId: proof.fixture.bayIds[2],
						expectedUndoSource: proof.fixture.expectedUndoSource,
						label,
						compactScroller: true,
					},
					observed,
				);
				proof.currentCase.returnedProof = held;
				proof.currentCase.phase = "verify-restoration";
				equal(held.viewport, viewport, `${label} actual held viewport`);
				equal(
					held.attempted.map((item) => item.action),
					["Alternating", "Co-rotating", "Disconnect", "Delete"],
					`${label} all four actual blocked hits`,
				);
				if (!held.scroller || typeof held.scroller.range !== "number")
					throw new Error(`${label}: missing measured own menu scroller result.`);
				equal(
					held.scroller.wheelExercised,
					held.scroller.range > 1,
					`${label} actual neutral trusted wheel on measured overflow`,
				);
				equal(
					held.scroller.coverage,
					held.scroller.range > 1 ? "overflow-exact-end-start-repeats" : "fit-no-wheel-proof",
					`${label} exact bounded scrolling coverage`,
				);
				if (releaseMode === "release") {
					const undone = metricSamples.find(
						(metrics) => numericMetric(metrics, "modelSequence") === sequence + 1,
					);
					if (!undone) throw new Error(`${label}: actual Undo metrics missing.`);
					requireMirror(undone, `${label} released Undo`);
					for (const key of CURSORS)
						equal(
							undone[key],
							proof.fixture.baselineMetrics[key],
							`${label} Undo allocator high-water ${key}`,
						);
					equal(Number(held.undoneSequence), sequence + 1, `${label} exact one Undo`);
					equal(Number(held.redoneSequence), sequence + 2, `${label} exact one Redo`);
					sequence += 2;
				} else
					equal(
						Number(held.cancelledSequence),
						sequence,
						`${label} cancellation consumes no publication`,
					);
				const restored = await assertRestoredLoopFixture(
					page,
					proof.fixture,
					helpers,
					sequence,
					`${label} restored`,
				);
				const settledContext = await assertSettledCAssembleContext(
					page,
					proof.fixture,
					helpers,
					prehold.settledContext.context.tool,
					`${label} restored context BEFORE any reselection`,
				);
				restored.context = await assertRetainedAssembleContext(
					page,
					prehold.context,
					`${label} retained C/context/four ready BEFORE any reselection`,
				);
				proof.currentCase.restored = restored;
				proof.currentCase.settledContext = settledContext;
				proof.currentCase.phase = "capture-completed-case";
				const png = `${label}-restored.png`;
				await page.screenshot({ path: path.join(artifactRoot, png) });
				const entry = {
					label,
					viewport,
					releaseMode,
					prehold,
					...held,
					metricSamples,
					restored,
					settledContext,
					screenshot: png,
				};
				proof.cases.push(entry);
				helpers.recordStep("assemble-loop-held-case", { proof: entry });
				proof.currentCase = null;
			}
		}
		equal(proof.cases.length, 9, "combined Loop matrix requires all nine actual cases");
		for (const viewport of VIEWPORTS)
			equal(
				proof.cases
					.filter((entry) => isDeepStrictEqual(entry.viewport, viewport))
					.map((entry) => entry.releaseMode),
				MODES,
				`combined Loop exact modes ${viewport.width}x${viewport.height}`,
			);
		equal(
			sequence,
			numericMetric(proof.fixture.baselineMetrics, "modelSequence") + 6,
			"only three actual Loop repair Undo/Redo pairs publish",
		);
		proof.finalMetrics = (
			await assertRestoredLoopFixture(
				page,
				proof.fixture,
				helpers,
				sequence,
				"combined Loop final same fixture",
			)
		).metrics;
		proof.finalSettledContext = await assertSettledCAssembleContext(
			page,
			proof.fixture,
			helpers,
			proof.cases.at(-1).prehold.settledContext.context.tool,
			"combined Loop final context BEFORE any reselection",
		);
		proof.workerStarts = await page.evaluate(() => {
			const observer = globalThis.__openfabAcceptanceWorkerStarts;
			if (!observer) throw new Error("Actual Worker observer missing at final capture.");
			return structuredClone(observer);
		});
		proof.status = "PASS";
		return proof;
	} catch (error) {
		proof.status = "FAIL";
		proof.failure = {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : null,
			held: error?.openfabAssembleDraftEvidence ?? null,
			physical: error?.openfabPhysicalContractEvidence ?? null,
		};
		if (page) {
			proof.finalMetrics = await helpers
				.readMetrics(page)
				.catch((failure) => ({ readFailure: String(failure) }));
			for (const [key, read] of [
				["failureSource", () => helpers.readStandaloneLoopAuthoringContract(page)],
				["failurePhysical", () => readCurrentPhysicalContract(page)],
				["failureHead", () => readActualRepairHead(page)],
				["failureContext", () => readAssembleContext(page)],
				[
					"workerStarts",
					() =>
						page.evaluate(() => {
							const observed = globalThis.__openfabAcceptanceWorkerStarts;
							if (!observed) throw new Error("Actual Worker observer missing at failure capture.");
							return structuredClone(observed);
						}),
				],
			])
				proof[key] = await read().catch((failure) => ({ readFailure: String(failure) }));
			await page
				.screenshot({ path: path.join(artifactRoot, "assemble-loop-held-failure.png") })
				.catch((failure) => {
					proof.screenshotFailure = String(failure);
				});
		}
		if (error && typeof error === "object") error.openfabLoopHeldEvidence = proof;
		helpers.recordStep("assemble-loop-held-matrix-failure", { proof });
		throw error;
	} finally {
		await helpers.closeBrowserResource(context, "external combined Loop held context");
	}
}
