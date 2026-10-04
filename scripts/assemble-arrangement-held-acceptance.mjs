// Actual held-history Bay admission over an authored fixture.

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import * as callerAssertions from "./assemble-connector-held-acceptance.mjs";
import {
	exerciseAssembleBayActionsDuringHeldReplay,
	readAssembleContext,
	readCurrentPhysicalContract,
} from "./assemble-held-replay-acceptance.mjs";

const shared = Object.freeze({ ...callerAssertions, exerciseAssembleBayActionsDuringHeldReplay });
const { equal } = callerAssertions;

function requiredString(value, label) {
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`${label}: required nonempty readout missing.`);
	return value;
}
function positiveId(value, label) {
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new Error(`${label}: required actual positive ID missing.`);
	return value;
}
function requireHelpers(helpers, shared) {
	for (const name of [
		"readMetrics",
		"readStandaloneLoopAuthoringContract",
		"assertProjectUnchanged",
		"assertSingleGuidedPortCommit",
		"waitForWorker",
		"parseIntegerTuple",
		"selectOrganizationsThroughAssemble",
		"selectOrganizationIdThroughBrowser",
		"openStaticFabAssembleMenu",
		"checkRepairSettleFrames",
		"readOrganizationMembershipContract",
		"assertOrganizationArrangementContract",
		"organizationRailTranslation",
		"readCertifiedStarterHierarchy",
		"recordStep",
	])
		if (typeof helpers?.[name] !== "function")
			throw new Error(`Required current runner helper missing: ${name}`);
	for (const name of [
		"readConnectorHead",
		"requireMirror",
		"numericMetric",
		"measureReadyBayAction",
		"expectedInverseWithObservedHighWater",
		"exerciseAssembleBayActionsDuringHeldReplay",
		"assertPhysicalMatchesCurrentMetrics",
		"physicalSummary",
		"assertRetainedAssembleContext",
	])
		if (typeof shared?.[name] !== "function")
			throw new Error(`Required adopted caller/r2 helper missing: ${name}`);
	for (const name of ["BAY_ACTIONS", "CURSORS", "STABLE_FIELDS"])
		if (!Array.isArray(shared?.[name]) || shared[name].length === 0)
			throw new Error(`Required caller field inventory missing: ${name}`);
	equal(
		shared.BAY_ACTIONS.map(([id]) => id),
		[
			"assemble-edit-selected-bay-alternating",
			"assemble-edit-selected-bay-co-rotating",
			"assemble-disconnect-selected-bay",
			"assemble-delete-selected-bay",
		],
		"exact actual four Bay controls",
	);
	equal(
		shared.CURSORS,
		[
			"modelNextAdvancedSwitchId",
			"modelNextPortId",
			"modelNextEquipmentGroupId",
			"modelNextOrganizationId",
			"modelNextRelationshipId",
		],
		"all five allocator metric fields",
	);
}
function oneRecord(records, id, label) {
	if (!Array.isArray(records)) throw new Error(`${label}: required actual records missing.`);
	const matches = records.filter((record) => record.id === id);
	equal(matches.length, 1, `${label} exact record count`);
	return matches[0];
}
function hierarchyIds(records, rootId) {
	const ids = new Set([positiveId(rootId, "actual hierarchy root")]);
	for (let pass = 0; pass < records.length; pass++) {
		const oldSize = ids.size;
		for (const record of records)
			if ((record.parentOrganizationIds ?? []).some((id) => ids.has(id)))
				ids.add(positiveId(record.id, "actual hierarchy child"));
		if (ids.size === oldSize) return [...ids].sort((a, b) => a - b);
	}
	throw new Error("Actual hierarchy closure did not settle within the record bound.");
}
async function assertArrangementHead(page, shared, label) {
	const head = await shared.readConnectorHead(page); // Existing pure reader includes all replay kinds.
	equal(
		head,
		{
			undo: { connector: false, arrangement: true, loop: false },
			redo: { connector: false, arrangement: false, loop: false },
			canUndo: true,
			canRedo: false,
		},
		`${label} Arrangement alone at actual Undo head`,
	);
	return head;
}
async function chooseEffectiveBankPair(page, bankIds, helpers) {
	await helpers.selectOrganizationsThroughAssemble(page, bankIds);
	const menu = page.getByTestId("static-fab-assemble-menu");
	await helpers.openStaticFabAssembleMenu(page, menu, "Arrangement whole-Bank pair scope");
	await menu.getByTestId("assemble-browse-organizations").click();
	const library = page.getByTestId("static-fab-organization-library");
	await library.waitFor({ state: "visible" });
	const effective = library.getByRole("button", { name: "하위 조직 포함", exact: true });
	equal(await effective.count(), 1, "actual EFFECTIVE scope control");
	await effective.click();
	equal(
		await effective.getAttribute("aria-pressed"),
		"true",
		"actual whole hierarchy scope selected",
	);
	const selected = await library
		.locator('[role="option"][aria-selected="true"]')
		.evaluateAll((elements) =>
			elements
				.map((element) => Number(element.getAttribute("data-organization-id")))
				.sort((a, b) => a - b),
		);
	equal(
		selected,
		[...bankIds].sort((a, b) => a - b),
		"actual two Bank option identities",
	);
	await library.getByRole("button", { name: "FAB 조직 라이브러리 닫기" }).click();
}
async function waitArrangementOption(page, axis, mode, label) {
	await page.waitForFunction(
		({ axis, mode }) => {
			const bar = document.querySelector('[data-testid="static-fab-arrangement-bar"]');
			return (
				bar?.getAttribute("data-axis") === axis &&
				bar.getAttribute("data-mode") === mode &&
				["certified", "rejected"].includes(bar.getAttribute("data-phase"))
			);
		},
		{ axis, mode },
		{ timeout: 30_000 },
	);
	const bar = page.getByTestId("static-fab-arrangement-bar");
	if ((await bar.getAttribute("data-phase")) !== "certified")
		throw new Error(
			`${label}: actual option was not certified: ${await bar.locator(".tilefab-arrangement-feedback").innerText()}`,
		);
}

// Requires the live page restored by the Connector caller and its observed fixture.
// No new context, Worker proxy, checkpoint implementation or initial fixture is duplicated.
export async function createArrangementFixtureFromConnectorPage(page, connectorFixture, helpers) {
	requireHelpers(helpers, shared);
	const evidence = {
		status: "RUNNING",
		stage: "validate-current-Connector-fixture",
		duplicate: null,
		arrangement: null,
	};
	try {
		if (
			!connectorFixture ||
			!Array.isArray(connectorFixture.bayIds) ||
			connectorFixture.bayIds.length !== 3
		)
			throw new Error("Required observed three-Bay fixture is missing.");
		const selectedC = positiveId(connectorFixture.bayIds[2], "original C Bay");
		const initialMetrics = await helpers.waitForWorker(page, () => true);
		shared.requireMirror(initialMetrics, "Arrangement extension entry");
		const initialSource = await helpers.readStandaloneLoopAuthoringContract(page);
		equal(
			initialSource,
			connectorFixture.baselineSource,
			"existing live Connector fixture exact five contracts",
		);
		const originalRelations = initialSource.relationships.records;
		equal(originalRelations.length, 2, "actual A+B then B+C relationships");
		const soleC = originalRelations.filter((record) =>
			record.managedChildOrganizationIds.includes(selectedC),
		);
		equal(soleC.length, 1, "C exactly one actual managed relationship");
		equal(
			soleC[0].managedChildOrganizationIds,
			[selectedC],
			"second actual Connector solely manages C",
		);
		const originalBankId = positiveId(soleC[0].parentOrganizationId, "actual original Bank");
		equal(
			originalRelations.map((record) => record.parentOrganizationId),
			[originalBankId, originalBankId],
			"both actual Connectors share the original Bank",
		);
		const originalBank = oneRecord(
			initialSource.organizations.records,
			originalBankId,
			"original Bank",
		);
		equal(originalBank.kind, "AREA", "stored Bank kind is AREA, separate from BAY_BANK role");
		const initialHierarchy = await helpers.readCertifiedStarterHierarchy(page);
		equal(
			initialHierarchy.bankIds,
			[originalBankId],
			"existing pure reader identifies actual original Bank",
		);
		equal(initialHierarchy.fabIds, [], "actual fixture has no Fab ancestor");
		equal(initialHierarchy.missingParents, 0, "actual original hierarchy parents exist");
		equal(originalBank.parentOrganizationIds ?? [], [], "original Bank is an independent root");
		equal(
			oneRecord(initialSource.organizations.records, selectedC, "original C").parentOrganizationIds,
			[originalBankId],
			"C belongs to actual original Bank",
		);
		const originalIds = hierarchyIds(initialSource.organizations.records, originalBankId);
		equal(
			originalIds,
			initialSource.organizations.records.map((record) => record.id).sort((a, b) => a - b),
			"fixture consists of the whole original Bank hierarchy",
		);
		equal(initialSource.equipment.ports.length, 0, "bounded fixture has no equipment Ports");
		equal(
			initialSource.equipment.equipmentGroups.length,
			0,
			"bounded fixture has no equipment groups",
		);

		evidence.stage = "actual-whole-Bank-duplicate";
		await helpers.selectOrganizationsThroughAssemble(page, [originalBankId]);
		const menu = page.getByTestId("static-fab-assemble-menu");
		await helpers.openStaticFabAssembleMenu(page, menu, "actual original whole-Bank duplicate");
		const duplicate = menu.getByTestId("assemble-duplicate-selection");
		equal(await duplicate.isEnabled(), true, "current actual Bank duplicate eligibility");
		equal(
			await duplicate.getAttribute("data-capture-mode"),
			"EFFECTIVE",
			"Assemble duplicate captures the whole Bank",
		);
		await duplicate.click();
		const canvas = page.getByTestId("rail-canvas");
		await canvas.focus();
		await page.waitForFunction(
			() => {
				const app = document.querySelector('[data-testid="tilefab-app"]'),
					canvas = document.querySelector('[data-testid="rail-canvas"]');
				return (
					app?.dataset.organizationBundleActive === "true" &&
					canvas?.dataset.organizationBundlePreviewState === "candidate" &&
					Boolean(canvas.dataset.organizationBundleSourceBounds) &&
					Boolean(canvas.dataset.organizationBundlePreviewAnchor)
				);
			},
			undefined,
			{ timeout: 10_000 },
		);
		const primed = await helpers.readMetrics(page);
		equal(
			primed.organizationBundleRotation,
			"0",
			"actual duplicate retains zero rotation; no R input",
		);
		const app = page.getByTestId("tilefab-app");
		equal(
			await app.getAttribute("data-organization-bundle-capture-mode"),
			"EFFECTIVE",
			"actual placement capture mode",
		);
		equal(
			await app.getAttribute("data-organization-bundle-root-count"),
			"1",
			"one actual duplicated root",
		);
		equal(
			await app.getAttribute("data-organization-bundle-source-root-ids"),
			String(originalBankId),
			"exact original duplicated Bank ID",
		);
		const sourceBounds = helpers.parseIntegerTuple(
			requiredString(primed.organizationBundleSourceBounds, "actual source bounds"),
			4,
			"actual source bounds",
		);
		const localBounds = helpers.parseIntegerTuple(
			requiredString(
				await app.getAttribute("data-organization-bundle-local-bounds"),
				"actual bundle local bounds",
			),
			4,
			"actual bundle local bounds",
		);
		// Candidate footprint starts40m clear in X and100m displaced in Z. These are
		// keyboard targets derived from current read-only bounds, never camera/model setters.
		const target = [sourceBounds[2] + 40 - localBounds[0], sourceBounds[1] + 100 - localBounds[1]];
		const inputs = [];
		for (let step = 0; step < 2_000; step++) {
			const current = await helpers.readMetrics(page);
			equal(current.organizationBundleRotation, "0", "actual keyboard duplicate never rotates");
			const anchor = helpers.parseIntegerTuple(
				requiredString(current.organizationBundlePreviewAnchor, "actual duplicate anchor"),
				2,
				"actual duplicate anchor",
			);
			if (isDeepStrictEqual(anchor, target)) break;
			const key =
				anchor[0] < target[0]
					? "ArrowRight"
					: anchor[0] > target[0]
						? "ArrowLeft"
						: anchor[1] < target[1]
							? "ArrowDown"
							: "ArrowUp";
			const cursor = [
				requiredString(current.cursorX, "actual cursor X"),
				requiredString(current.cursorY, "actual cursor Z"),
			];
			await canvas.press(key);
			// Source-center snapping can retain the displayed anchor for several1m inputs.
			// Wait for the real raw cursor change, not a fabricated anchor or every-step snap.
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
			inputs.push({ key, beforeAnchor: anchor, beforeCursor: cursor });
		}
		const beforeDuplicate = await helpers.readMetrics(page);
		equal(
			beforeDuplicate.organizationBundlePreviewAnchor,
			target.join(","),
			"bounded actual keyboard duplicate target reached",
		);
		equal(beforeDuplicate.organizationBundleRotation, "0", "actual duplicate pose at commit");
		equal(
			beforeDuplicate.organizationBundlePreviewState,
			"candidate",
			"actual clear placement candidate",
		);
		helpers.assertProjectUnchanged(
			beforeDuplicate,
			initialMetrics,
			"actual duplicate preview preserves source/history",
		);
		equal(
			await helpers.readStandaloneLoopAuthoringContract(page),
			initialSource,
			"actual duplicate preview exact original source",
		);
		await canvas.press("Enter");
		const duplicated = await helpers.waitForWorker(
			page,
			(metrics) =>
				Number(metrics.modelSequence) === Number(beforeDuplicate.modelSequence) + 1 &&
				Number(metrics.staticFabOrganizations) === initialSource.organizations.records.length * 2,
			{ timeout: 30_000 },
		);
		helpers.assertSingleGuidedPortCommit(
			duplicated,
			beforeDuplicate,
			"actual whole-Bank duplicate one typed patch",
		);
		shared.requireMirror(duplicated, "actual whole-Bank duplicate");
		equal(
			duplicated.organizationBundlePlacementPhase,
			"committed",
			"actual duplicate publication committed",
		);
		equal(
			duplicated.organizationBundlePlacementTargetChecksumMatch,
			"true",
			"actual duplicate target checksum",
		);
		const copiedBankId = positiveId(
			shared.numericMetric(duplicated, "lastPlacedOrganizationRootId"),
			"actual copied Bank ID",
		);
		if (copiedBankId === originalBankId)
			throw new Error("Actual duplicated Bank reused original identity.");
		await canvas.press("Escape");
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="tilefab-app"]')?.dataset.organizationBundleActive ===
				"false",
			undefined,
			{ timeout: 10_000 },
		);
		const duplicatedSource = await helpers.readStandaloneLoopAuthoringContract(page);
		for (const original of initialSource.organizations.records)
			equal(
				oneRecord(
					duplicatedSource.organizations.records,
					original.id,
					"duplicate preserves original organization",
				),
				original,
				`duplicate original record ${original.id}`,
			);
		for (const original of originalRelations)
			equal(
				oneRecord(
					duplicatedSource.relationships.records,
					original.id,
					"duplicate preserves original relationship",
				),
				original,
				`duplicate original relationship ${original.id}`,
			);
		const copiedBank = oneRecord(
			duplicatedSource.organizations.records,
			copiedBankId,
			"copied Bank",
		);
		equal(copiedBank.kind, "AREA", "stored copied Bank kind is AREA");
		const copiedHierarchy = await helpers.readCertifiedStarterHierarchy(page);
		equal(
			copiedHierarchy.bankIds,
			[originalBankId, copiedBankId].sort((a, b) => a - b),
			"existing pure reader identifies exactly two actual Banks",
		);
		equal(copiedHierarchy.fabIds, [], "two actual Banks remain independent of any Fab");
		equal(copiedHierarchy.missingParents, 0, "actual copied hierarchy parents exist");
		equal(copiedBank.parentOrganizationIds ?? [], [], "copied Bank is detached independent root");
		const copiedIds = hierarchyIds(duplicatedSource.organizations.records, copiedBankId);
		equal(copiedIds.length, originalIds.length, "duplicate includes whole hierarchy");
		equal(
			copiedIds.some((id) => originalIds.includes(id)),
			false,
			"actual duplicate hierarchy IDs disjoint",
		);
		equal(
			[...originalIds, ...copiedIds].sort((a, b) => a - b),
			duplicatedSource.organizations.records.map((record) => record.id).sort((a, b) => a - b),
			"exact two independent authored Bank hierarchies",
		);
		const copiedRelations = duplicatedSource.relationships.records.filter(
			(record) => !originalRelations.some((original) => original.id === record.id),
		);
		equal(copiedRelations.length, 2, "whole duplicate copies both declared relationships");
		for (const relation of copiedRelations) {
			equal(relation.parentOrganizationId, copiedBankId, "copied relationship owns copied Bank");
			equal(
				[...relation.participantOrganizationIds, ...relation.managedChildOrganizationIds].every(
					(id) => copiedIds.includes(id),
				),
				true,
				"copied relationship references only copied hierarchy",
			);
		}
		equal(
			duplicatedSource.operations,
			initialSource.operations,
			"duplicate preserves operational configuration",
		);
		evidence.duplicate = {
			originalBankId,
			copiedBankId,
			originalIds,
			copiedIds,
			sourceBounds,
			localBounds,
			target,
			inputs,
			beforeMetrics: beforeDuplicate,
			afterMetrics: duplicated,
			afterSource: duplicatedSource,
		};
		helpers.recordStep("assemble-arrangement-fixture-whole-Bank-duplicate", {
			proof: evidence.duplicate,
		});

		evidence.stage = "actual-L-Z-2-review-Enter";
		await chooseEffectiveBankPair(page, [originalBankId, copiedBankId], helpers);
		const preMoveMetrics = await helpers.waitForWorker(page, () => true);
		shared.requireMirror(preMoveMetrics, "actual pre-Arrangement source");
		const preMoveSource = await helpers.readStandaloneLoopAuthoringContract(page);
		equal(preMoveSource, duplicatedSource, "scope/pair selection authors no source");
		const beforeMembership = await helpers.readOrganizationMembershipContract(page);
		await canvas.focus();
		await canvas.press("l");
		const bar = page.getByTestId("static-fab-arrangement-bar");
		await bar.waitFor({ state: "visible" });
		// Current axis/mode input is ignored during capturing. Await the actual option
		// result before each key instead of assuming L synchronously binds a session.
		await page.waitForFunction(
			() =>
				["certified", "rejected"].includes(
					document
						.querySelector('[data-testid="static-fab-arrangement-bar"]')
						?.getAttribute("data-phase"),
				),
			undefined,
			{ timeout: 30_000 },
		);
		await canvas.press("z");
		await page.waitForFunction(
			() => {
				const bar = document.querySelector('[data-testid="static-fab-arrangement-bar"]');
				return (
					bar?.getAttribute("data-axis") === "Z" &&
					["certified", "rejected"].includes(bar.getAttribute("data-phase"))
				);
			},
			undefined,
			{ timeout: 30_000 },
		);
		await canvas.press("2");
		await waitArrangementOption(
			page,
			"Z",
			"ALIGN_CENTER",
			"required actual whole-Bank Arrangement",
		);
		equal(
			await bar.getAttribute("data-source"),
			"ORGANIZATIONS",
			"actual Arrangement uses organization roots",
		);
		const reviewed = await helpers.readMetrics(page);
		equal(reviewed.staticFabArrangementRoots, "2", "actual two whole-Bank Arrangement roots");
		equal(reviewed.staticFabArrangementAxis, "Z", "actual Z review");
		equal(reviewed.staticFabArrangementMode, "ALIGN_CENTER", "actual centre mode2 review");
		equal(reviewed.staticFabArrangementConflicts, "0", "actual conflict-free review");
		equal(
			await page.getByTestId("apply-static-fab-arrangement").isEnabled(),
			true,
			"actual Arrangement Apply eligibility",
		);
		helpers.assertProjectUnchanged(
			reviewed,
			preMoveMetrics,
			"actual Arrangement review authors no mutation",
		);
		equal(
			await helpers.readStandaloneLoopAuthoringContract(page),
			preMoveSource,
			"actual Arrangement review exact five source contracts",
		);
		await canvas.press("Enter");
		const arranged = await helpers.waitForWorker(
			page,
			(metrics) =>
				metrics.staticFabArrangementActive === "false" &&
				Number(metrics.modelSequence) === Number(preMoveMetrics.modelSequence) + 1,
			{ timeout: 30_000 },
		);
		helpers.assertSingleGuidedPortCommit(
			arranged,
			preMoveMetrics,
			"actual Arrangement one typed publication",
		);
		shared.requireMirror(arranged, "actual Arrangement committed");
		if (arranged.modelChecksum === preMoveMetrics.modelChecksum)
			throw new Error("Required actual Arrangement did not change authored geometry.");
		for (const key of shared.CURSORS)
			equal(arranged[key], preMoveMetrics[key], `Arrangement allocates no new identity ${key}`);
		for (const key of [
			"authoredCells",
			"authoredEdges",
			"staticFabOrganizations",
			"modelRelationships",
			"equipmentGroups",
			"equipmentPorts",
			"physicalPaths",
		])
			equal(arranged[key], preMoveMetrics[key], `Arrangement preserves ${key}`);
		const afterMembership = await helpers.readOrganizationMembershipContract(page);
		helpers.assertOrganizationArrangementContract(beforeMembership, afterMembership);
		const movements = beforeMembership.map((before) => {
			const after = oneRecord(afterMembership, before.id, "actual moved organization");
			return {
				id: before.id,
				...helpers.organizationRailTranslation(before.railEdges, after.railEdges),
			};
		});
		const originalMove = oneRecord(movements, originalBankId, "original Bank movement");
		const cMove = oneRecord(movements, selectedC, "original C movement");
		equal(originalMove.x, 0, "original Bank translates only in Z");
		if (!Number.isSafeInteger(originalMove.z) || originalMove.z === 0)
			throw new Error("Original Bank did not genuinely move in Z.");
		equal(
			{ x: cMove.x, z: cMove.z },
			{ x: originalMove.x, z: originalMove.z },
			"original C genuinely follows original Bank",
		);
		const baselineSource = await helpers.readStandaloneLoopAuthoringContract(page);
		equal(
			baselineSource.operations,
			preMoveSource.operations,
			"Arrangement preserves operational configuration",
		);
		const expectedUndoSource = shared.expectedInverseWithObservedHighWater(
			preMoveSource,
			baselineSource,
			preMoveMetrics,
			arranged,
		);
		equal(
			expectedUndoSource,
			preMoveSource,
			"Arrangement exact inverse equals complete actual before-move preimage; no allocator change",
		);
		const head = await assertArrangementHead(page, shared, "actual committed fixture");
		const baselinePhysical = await readCurrentPhysicalContract(page);
		shared.assertPhysicalMatchesCurrentMetrics(
			baselinePhysical,
			baselinePhysical,
			arranged,
			"Arrangement baseline physical",
		);
		evidence.arrangement = {
			preMoveMetrics,
			preMoveSource,
			reviewed,
			beforeMembership,
			afterMembership,
			movements,
			baselineMetrics: arranged,
			baselineSource,
			expectedUndoSource,
			head,
		};
		evidence.status = "PREPARED_BY_ACTUAL_INPUT";
		helpers.recordStep("assemble-arrangement-fixture-real-move", { proof: evidence.arrangement });
		return {
			bayIds: connectorFixture.bayIds,
			originalBankId,
			copiedBankId,
			selectedC,
			baselineMetrics: arranged,
			baselineSource,
			baselinePhysical,
			expectedUndoSource,
			preMoveMetrics,
			preMoveSource,
			movements,
			preparation: evidence,
		};
	} catch (error) {
		evidence.status = "FAIL";
		if (error && typeof error === "object") error.openfabArrangementFixtureDraftEvidence = evidence;
		throw error;
	}
}

async function restoredFixture(page, fixture, helpers, shared, sequence, label) {
	const metrics = await helpers.waitForWorker(page, () => true);
	shared.requireMirror(metrics, label);
	equal(
		shared.numericMetric(metrics, "modelSequence"),
		sequence,
		`${label} exact cumulative sequence`,
	);
	for (const key of shared.STABLE_FIELDS)
		equal(metrics[key], fixture.baselineMetrics[key], `${label} stable source/history ${key}`);
	equal(
		await helpers.readStandaloneLoopAuthoringContract(page),
		fixture.baselineSource,
		`${label} exact same five-contract moved fixture`,
	);
	const physical = await readCurrentPhysicalContract(page);
	shared.assertPhysicalMatchesCurrentMetrics(physical, fixture.baselinePhysical, metrics, label);
	return {
		metrics,
		head: await assertArrangementHead(page, shared, label),
		physical: shared.physicalSummary(physical),
	};
}
async function readySelectedC(page, fixture, helpers, shared, sequence, label) {
	const before = await restoredFixture(page, fixture, helpers, shared, sequence, label);
	await helpers.selectOrganizationIdThroughBrowser(page, before.metrics, fixture.selectedC);
	if ((await helpers.readMetrics(page)).editorActivity !== "assemble")
		await page.getByTestId("editor-activity-assemble").click();
	const menu = page.getByTestId("static-fab-assemble-menu");
	await helpers.openStaticFabAssembleMenu(page, menu, label);
	await page.waitForFunction(
		(id) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				app?.dataset.editorActivity === "assemble" &&
				app.dataset.organizationSelectionIds === String(id) &&
				app.dataset.organizationSelectionCount === "1"
			);
		},
		fixture.selectedC,
		{ timeout: 10_000 },
	);
	await helpers.checkRepairSettleFrames(page);
	const ready = [];
	for (const [id, statusId] of shared.BAY_ACTIONS) {
		const control = menu.getByTestId(id),
			status = menu.getByTestId(statusId);
		equal(await control.count(), 1, `${label} one ready ${id}`);
		equal(await status.count(), 1, `${label} required availability ${statusId}`);
		equal(await control.isEnabled(), true, `${label} original C action ready ${id}`);
		equal(
			await status.getAttribute("data-ready"),
			"true",
			`${label} current original C source availability`,
		);
		ready.push({
			id,
			statusId,
			statusText: await status.innerText(),
			geometry: await shared.measureReadyBayAction(page, control, `${label} ready ${id}`, helpers),
		});
	}
	helpers.assertProjectUnchanged(
		await helpers.readMetrics(page),
		before.metrics,
		`${label} real C/menu selection preserves source/history`,
	);
	return {
		ready,
		...(await restoredFixture(page, fixture, helpers, shared, sequence, `${label} before hold`)),
		context: await readAssembleContext(page),
		viewport: page.viewportSize(),
	};
}

// Owns no context or timers itself. The caller supplies its owned actual Worker observer,
// page/error collectors, current helpers, and current owned checkpoint/refusal procedure.
export async function exerciseAssembleArrangementHeldExtension(
	page,
	connectorFixture,
	{ artifactRoot, viewports, releaseModes },
	helpers,
) {
	requireHelpers(helpers, shared);
	equal(
		viewports,
		[
			{ width: 1440, height: 900 },
			{ width: 760, height: 900 },
			{ width: 390, height: 600 },
		],
		"explicit intended three actual Arrangement viewports",
	);
	equal(
		releaseModes,
		["cancel-button", "escape", "release"],
		"three distinct fresh hold release modes",
	);
	const proof = {
		status: "RUNNING",
		scope: "arrangement-undo-three-viewports-nine-cases-same-moved-fixture",
		fixture: null,
		cases: [],
		currentCase: null,
	};
	try {
		await page.setViewportSize(viewports[0]);
		await helpers.checkRepairSettleFrames(page);
		proof.fixture = await createArrangementFixtureFromConnectorPage(
			page,
			connectorFixture,
			helpers,
		);
		let sequence = shared.numericMetric(proof.fixture.baselineMetrics, "modelSequence");
		for (const viewport of viewports) {
			await page.setViewportSize(viewport);
			await helpers.checkRepairSettleFrames(page);
			equal(page.viewportSize(), viewport, "actual Arrangement matrix viewport");
			for (const releaseMode of releaseModes) {
				const label = `assemble-arrangement-held-${viewport.width}x${viewport.height}-${releaseMode}`;
				proof.currentCase = {
					label,
					viewport,
					releaseMode,
					phase: "prepare",
					prehold: null,
					returnedProof: null,
					metricSamples: [],
				};
				const prehold = await readySelectedC(page, proof.fixture, helpers, shared, sequence, label);
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
				const held = await shared.exerciseAssembleBayActionsDuringHeldReplay(
					page,
					{
						kind: "arrangement",
						releaseMode,
						selectedBayId: proof.fixture.selectedC,
						expectedUndoSource: proof.fixture.expectedUndoSource,
						label,
						compactScroller: true,
					},
					observedHelpers,
				);
				proof.currentCase.returnedProof = held;
				proof.currentCase.phase = "verify-restoration";
				equal(held.viewport, viewport, `${label} actual held viewport`);
				equal(
					held.attempted?.map((item) => item.action),
					["Alternating", "Co-rotating", "Disconnect", "Delete"],
					`${label} all four actual refusal hits`,
				);
				if (
					!held.scroller ||
					typeof held.scroller.range !== "number" ||
					!Number.isFinite(held.scroller.range)
				)
					throw new Error(`${label}: required actual owned scroller evidence missing.`);
				equal(
					held.scroller.wheelExercised,
					held.scroller.range > 1,
					`${label} trusted wheel exactly when overflowing`,
				);
				equal(
					held.scroller.coverage,
					held.scroller.range > 1 ? "overflow-exact-end-start-repeats" : "fit-no-wheel-proof",
					`${label} actual wheel/fit scope`,
				);
				if (releaseMode === "release") {
					const undone = metricSamples.find(
						(metrics) => shared.numericMetric(metrics, "modelSequence") === sequence + 1,
					);
					if (!undone) throw new Error(`${label}: actual released Undo metrics missing.`);
					shared.requireMirror(undone, `${label} actual inverse Undo`);
					for (const key of shared.CURSORS)
						equal(
							undone[key],
							proof.fixture.baselineMetrics[key],
							`${label} Undo observed allocator high-water ${key}`,
						);
					equal(Number(held.undoneSequence), sequence + 1, `${label} actual Undo one patch`);
					equal(Number(held.redoneSequence), sequence + 2, `${label} actual Redo one patch`);
					sequence += 2;
				} else
					equal(
						Number(held.cancelledSequence),
						sequence,
						`${label} explicit cancellation consumes no publication`,
					);
				const restored = await restoredFixture(
					page,
					proof.fixture,
					helpers,
					shared,
					sequence,
					`${label} after case`,
				);
				restored.context = await shared.assertRetainedAssembleContext(
					page,
					prehold.context,
					`${label} after case BEFORE any reselection`,
				);
				proof.currentCase.restored = restored;
				proof.currentCase.phase = "capture-completed-case";
				const screenshot = `${label}-restored.png`;
				await page.screenshot({ path: path.join(artifactRoot, screenshot) });
				const entry = {
					label,
					viewport,
					releaseMode,
					prehold,
					held,
					metricSamples,
					restored,
					screenshot,
				};
				proof.cases.push(entry);
				helpers.recordStep("assemble-arrangement-held-case", { proof: entry });
				proof.currentCase = null;
			}
		}
		equal(proof.cases.length, 9, "exact actual Arrangement3×3 matrix");
		equal(
			sequence,
			shared.numericMetric(proof.fixture.baselineMetrics, "modelSequence") + 6,
			"only three normal Undo/Redo pairs author six patches",
		);
		proof.finalMetrics = (
			await restoredFixture(
				page,
				proof.fixture,
				helpers,
				shared,
				sequence,
				"Arrangement final same moved fixture",
			)
		).metrics;
		proof.status = "PASS";
		return proof;
	} catch (error) {
		proof.status = "FAIL";
		proof.failure = {
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : null,
			fixture: error?.openfabArrangementFixtureDraftEvidence ?? null,
			held: error?.openfabAssembleDraftEvidence ?? null,
			physical: error?.openfabPhysicalContractEvidence ?? null,
		};
		proof.finalMetrics = await helpers
			.readMetrics(page)
			.catch((failure) => ({ readFailure: String(failure) }));
		for (const [key, read] of [
			["failureSource", () => helpers.readStandaloneLoopAuthoringContract(page)],
			["failurePhysical", () => readCurrentPhysicalContract(page)],
			["failureHead", () => shared.readConnectorHead(page)],
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
		if (error && typeof error === "object") error.openfabArrangementHeldEvidence = proof;
		await page
			.screenshot({ path: path.join(artifactRoot, "assemble-arrangement-held-failure.png") })
			.catch((failure) => {
				proof.screenshotFailure = String(failure);
			});
		helpers.recordStep("assemble-arrangement-held-extension-failure", { proof });
		throw error; // Existing caller retains FAIL and closes its owned context in finally.
	}
}
