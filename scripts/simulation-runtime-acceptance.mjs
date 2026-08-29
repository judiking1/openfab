import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "simulation-runtime");
const transferPlanPath = path.join(artifactRoot, "public-runtime-transfer-plan.json");
const replayHistoryPath = path.join(artifactRoot, "public-runtime-replay-history.json");
const residentPlanPath = path.join(artifactRoot, "public-resident-runtime-transfer-plan.json");
const residentReplayPath = path.join(artifactRoot, "public-resident-runtime-replay-history.json");
const port = Number(process.env.OPENFAB_RUNTIME_PORT ?? 5700 + (process.pid % 503));
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const chromePath = await resolveChromePath();
const server = startPreviewServer();
let browser;
let context;
let page;
const result = {
	status: "FAIL",
	failure: null,
	project: null,
	ports: null,
	certificate: null,
	moving2D: null,
	moving3D: null,
	terminal: null,
	cleared: null,
	sourceIsolation: null,
	replayTerminal: null,
	replayCleared: null,
	resident: {
		planPrepared: null,
		moving2D: null,
		moving3D: null,
		planTerminal: null,
		planCleared: null,
		planSourceCleared: null,
		planHandoff: null,
		replayPrepared: null,
		replayTerminal: null,
		replayHandoff: null,
		replayCleared: null,
		replaySourceCleared: null,
		sharedTerminalSemantics: false,
		mutationLifecycle: null,
		operationalHomeMutationLifecycle: null,
		projectReplacementLifecycle: null,
		sourceSwitchLifecycle: null,
		currentSourceIsolationLifecycle: null,
	},
	consoleWarnings: [],
	consoleErrors: [],
	pageErrors: [],
	crossOriginIsolated: null,
};

try {
	await mkdir(artifactRoot, { recursive: true });
	await waitForServer(`${baseUrl}/`);
	browser = await chromium.launch({ executablePath: chromePath, headless: true });
	context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
	await context.addInitScript(() => {
		Object.defineProperty(window, "showOpenFilePicker", {
			configurable: true,
			value: undefined,
		});
		Object.defineProperty(window, "showSaveFilePicker", {
			configurable: true,
			value: undefined,
		});
	});
	page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "warning") result.consoleWarnings.push(message.text());
		if (message.type() === "error") result.consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => result.pageErrors.push(error.message));
	await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
	result.crossOriginIsolated = await page.evaluate(() => globalThis.crossOriginIsolated);
	assertEqual(result.crossOriginIsolated, true, "runtime cross-origin isolation");
	await waitForWorker(page, (metrics) => metrics.physicalPaths === "0");
	await chooseBlankCanvasForFirstRun(page);

	result.project = await createParallelHallProject(page);
	result.ports = await placePublicServiceEquipment(page);
	await selectPublicInteractionPort(page, result.ports);
	await configurePublicOperationalInputs(page, result.ports);
	result.certificate = await certifyExactProject(page);

	await writeFile(
		transferPlanPath,
		`${JSON.stringify(publicTransferPlan(result.ports), null, 2)}\n`,
		"utf8",
	);
	await reviewAndPrepareScenario(page, transferPlanPath, "TRANSFER_PLAN");
	await rm(transferPlanPath, { force: true });
	await authorizeRuntime(page);
	result.moving2D = await startAndPauseMovingRuntime(page);
	result.moving3D = await proveDerived3DParity(page, result.moving2D, result.ports);
	result.terminal = await completeRuntime(page);
	result.cleared = await stopAndProveClear(page);
	result.sourceIsolation = {
		transferPlanCleared: await clearScenarioSource(page, "TRANSFER_PLAN"),
		replayHistoryPrepared: null,
		replayHistoryCleared: null,
		sharedTerminalSemantics: false,
	};

	await writeFile(
		replayHistoryPath,
		`${JSON.stringify(publicReplayHistory(result.ports), null, 2)}\n`,
		"utf8",
	);
	result.sourceIsolation.replayHistoryPrepared = await reviewAndPrepareScenario(
		page,
		replayHistoryPath,
		"REPLAY_HISTORY",
	);
	await rm(replayHistoryPath, { force: true });
	await authorizeRuntime(page);
	result.replayTerminal = await startAndCompleteRuntime(page, "REPLAY_HISTORY");
	assertSameTerminalSemantics(result.terminal, result.replayTerminal);
	result.sourceIsolation.sharedTerminalSemantics = true;
	result.replayCleared = await stopAndProveClear(page);
	result.sourceIsolation.replayHistoryCleared = await clearScenarioSource(page, "REPLAY_HISTORY");

	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(result.ports), null, 2)}\n`,
		"utf8",
	);
	result.resident.planPrepared = await reviewAndPrepareResidentScenario(
		page,
		residentPlanPath,
		"TRANSFER_PLAN",
	);
	await rm(residentPlanPath, { force: true });
	await authorizeResidentRuntime(page);
	result.resident.moving2D = await startAndPauseMovingResidentRuntime(page, result.ports);
	result.resident.moving3D = await proveResidentDerived3DParity(page, result.resident.moving2D);
	result.resident.planHandoff = await resumeAndPauseResidentHandoff(page);
	result.resident.planTerminal = await completeResidentRuntime(page);
	result.resident.planCleared = await stopAndProveResidentClear(page);
	result.resident.planSourceCleared = await clearResidentScenarioSource(page, "TRANSFER_PLAN");

	await writeFile(
		residentReplayPath,
		`${JSON.stringify(publicResidentReplayHistory(result.ports), null, 2)}\n`,
		"utf8",
	);
	result.resident.replayPrepared = await reviewAndPrepareResidentScenario(
		page,
		residentReplayPath,
		"REPLAY_HISTORY",
	);
	await rm(residentReplayPath, { force: true });
	await authorizeResidentRuntime(page);
	const residentReplay = await startAndCompleteResidentRuntime(page, "REPLAY_HISTORY");
	result.resident.replayTerminal = residentReplay.terminal;
	result.resident.replayHandoff = residentReplay.handoff;
	assertSameResidentTerminalSemantics(result.resident.planTerminal, result.resident.replayTerminal);
	result.resident.sharedTerminalSemantics = true;
	result.resident.replayCleared = await stopAndProveResidentClear(page);
	result.resident.replaySourceCleared = await clearResidentScenarioSource(page, "REPLAY_HISTORY");

	result.resident.mutationLifecycle = await proveResidentAuthoredMutationLifecycle(
		page,
		result.ports,
	);
	result.resident.operationalHomeMutationLifecycle =
		await proveResidentOperationalHomeMutationLifecycle(page, result.ports);
	result.resident.projectReplacementLifecycle =
		await proveResidentNativeProjectReplacementLifecycle(page, result.ports);
	result.resident.sourceSwitchLifecycle = await proveResidentActiveSourceSwitchLifecycle(
		page,
		result.ports,
	);
	result.resident.currentSourceIsolationLifecycle =
		await proveCurrentSourceReviewIsolationDuringResidentRun(page, result.ports);

	assertEqual(result.consoleWarnings.length, 0, "console warnings");
	assertEqual(result.consoleErrors.length, 0, "console errors");
	assertEqual(result.pageErrors.length, 0, "page errors");
	result.status = "PASS";
	console.log(
		`PASS simulation runtime | current 1x ${result.moving2D.movement.firstSequence}->${result.moving2D.sequence} + 64x Plan/Replay ${result.terminal.sequence}/${result.replayTerminal.sequence} | resident 1x ${result.resident.moving2D.movement.firstSequence}->${result.resident.moving2D.sequence} in 2D/3D + 64x contention handoff ${result.resident.planHandoff.sequence}/${result.resident.replayHandoff.sequence} · terminal ${result.resident.planTerminal.sequence}/${result.resident.replayTerminal.sequence} | resident ${result.resident.replayTerminal.completed}/2 complete · ${result.resident.replayTerminal.idleHome}/2 homes · storage ${result.resident.replayTerminal.storageOccupied} | edit invalidation ${result.resident.mutationLifecycle.invalidationMilliseconds.toFixed(1)} ms · generation ${result.resident.mutationLifecycle.generation.before}->${result.resident.mutationLifecycle.generation.mutated}->${result.resident.mutationLifecycle.generation.undone} | home removal invalidation ${result.resident.operationalHomeMutationLifecycle.invalidationMilliseconds.toFixed(1)} ms · revision ${result.resident.operationalHomeMutationLifecycle.revision.before}->${result.resident.operationalHomeMutationLifecycle.revision.removed}->${result.resident.operationalHomeMutationLifecycle.revision.restored} | project replacement ${result.resident.projectReplacementLifecycle.invalidationMilliseconds.toFixed(1)} ms · ${result.resident.projectReplacementLifecycle.savedResidentSlotCount}->${result.resident.projectReplacementLifecycle.replacementResidentSlotCount}->${result.resident.projectReplacementLifecycle.restoredResidentSlotCount} homes | Plan→Replay switch ${result.resident.sourceSwitchLifecycle.invalidationMilliseconds.toFixed(1)} ms | current review isolation #${result.resident.currentSourceIsolationLifecycle.sequence}`,
	);
} catch (error) {
	result.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	throw error;
} finally {
	await rm(transferPlanPath, { force: true }).catch(() => undefined);
	await rm(replayHistoryPath, { force: true }).catch(() => undefined);
	await rm(residentPlanPath, { force: true }).catch(() => undefined);
	await rm(residentReplayPath, { force: true }).catch(() => undefined);
	if (page) {
		await page
			.screenshot({ path: path.join(artifactRoot, "final.png"), fullPage: true })
			.catch(() => undefined);
	}
	await writeFile(
		path.join(artifactRoot, "result.json"),
		`${JSON.stringify(result, null, 2)}\n`,
	).catch(() => undefined);
	await closeBrowserResource(page, "page");
	await closeBrowserResource(context, "browser context");
	if (browser) void browser.close().catch(() => undefined);
	server.kill("SIGTERM");
}

process.exit(result.status === "PASS" ? 0 : 1);

async function createParallelHallProject(activePage) {
	await activePage.getByRole("button", { name: "FAB 프리셋", exact: true }).click();
	const dialog = activePage.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	await activePage.getByTestId("synthetic-fab-starter-parallel-hall-fab-12").click();
	await activePage.waitForFunction(
		() => {
			const preview = document.querySelector('[data-testid="synthetic-fab-starter-preview"]');
			const state = preview?.getAttribute("data-preview-state");
			return (
				preview?.getAttribute("data-starter-id") === "parallel-hall-fab-12" &&
				(state === "catalog-ready" || state === "ready")
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	await activePage.getByTestId("synthetic-fab-project-name").fill("OpenFab Runtime Acceptance Lab");
	await activePage.getByTestId("create-project-from-synthetic-fab-preset").click();
	await continueWithoutSavingIfVisible(activePage);
	const metrics = await waitForWorker(
		activePage,
		(candidate) =>
			candidate.projectName === "OpenFab Runtime Acceptance Lab" &&
			candidate.authoredCells === "11028" &&
			candidate.physicalPaths === "11116" &&
			candidate.equipmentPorts === "0",
		{ timeout: 30_000 },
	);
	assertEqual(metrics.workerSimulationReady, "false", "static Worker simulation gate");
	return metrics;
}

async function placePublicServiceEquipment(activePage) {
	await clickActivityCommand(activePage, "equip", "OHB 포트 배치");
	await activePage.waitForFunction(
		() =>
			Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.portSlotLegalCount) >
			1_000,
		undefined,
		{ timeout: 10_000 },
	);
	const initialCandidates = await readLegalOhbCandidates(activePage);
	if (initialCandidates.length < 2)
		throw new Error("Parallel Hall exposes fewer than two OHB slots.");
	const firstTarget = initialCandidates[Math.floor(initialCandidates.length * 0.25)];
	if (!firstTarget) throw new Error("No first public OHB target was selected.");
	await placeOhbAt(activePage, firstTarget, 0);
	const remainingCandidates = await readLegalOhbCandidates(activePage);
	const secondTarget = remainingCandidates.reduce((best, candidate) => {
		if (!best) return candidate;
		return distanceSquared(candidate, firstTarget) > distanceSquared(best, firstTarget)
			? candidate
			: best;
	}, null);
	if (!secondTarget || distanceSquared(secondTarget, firstTarget) < 10_000) {
		throw new Error("No sufficiently separated second public OHB target was found.");
	}
	await placeOhbAt(activePage, secondTarget, 1);
	await activePage.getByTestId("rail-canvas").press("Escape");

	await clickActivityCommand(activePage, "equip", "EQ 포트 행 배치");
	await activePage.waitForFunction(
		() =>
			Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.portSlotLegalCount) >
			1_000,
		undefined,
		{ timeout: 10_000 },
	);
	const straightRuns = await readLegalStraightPortRuns(activePage, "EQ");
	const run = straightRuns.find((candidate) => candidate.items.length >= 3);
	if (!run) throw new Error("Parallel Hall exposes no three-port legal EQ corridor.");
	const runStart = Math.floor((run.items.length - 3) / 2);
	const eqSlots = run.items.slice(runStart, runStart + 3);
	const beforeEq = await readMetrics(activePage);
	await centerWorld(activePage, eqSlots[1]);
	const eqStart = await screenPointForWorld(activePage, eqSlots[0]);
	const eqEnd = await screenPointForWorld(activePage, eqSlots[2]);
	await activePage.mouse.move(eqStart.x, eqStart.y);
	await activePage.mouse.down();
	await activePage.mouse.move(eqEnd.x, eqEnd.y, { steps: 8 });
	await activePage.mouse.up();
	await waitForWorker(
		activePage,
		(metrics) =>
			Number(metrics.equipmentGroups) === Number(beforeEq.equipmentGroups) + 1 &&
			Number(metrics.equipmentPorts) === Number(beforeEq.equipmentPorts) + 3,
	);
	await activePage.getByTestId("rail-canvas").press("Escape");

	await clickActivityCommand(activePage, "equip", "STK 포트 그룹 배치");
	await activePage.getByTestId("stk-template-FLEX").click();
	await activePage.getByRole("button", { name: "전체 보기", exact: true }).click();
	await activePage.waitForTimeout(120);
	await activePage.waitForFunction(
		() =>
			Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.portSlotLegalCount) >
			1_000,
		undefined,
		{ timeout: 10_000 },
	);
	const stkCandidates = await readLegalCardinalPortCandidates(activePage, "STK");
	const stkPair = selectSeparatedPerpendicularStkPortPair(stkCandidates);
	await placeStkDraftPort(activePage, stkPair[0], 1);
	await placeStkDraftPort(activePage, stkPair[1], 2);
	const stkComplete = activePage.getByTestId("stk-complete");
	assertEqual(await stkComplete.isEnabled(), true, "public FLEX STK completion");
	const beforeStk = await readMetrics(activePage);
	await stkComplete.click();
	await waitForWorker(
		activePage,
		(metrics) =>
			Number(metrics.equipmentGroups) === Number(beforeStk.equipmentGroups) + 1 &&
			Number(metrics.equipmentPorts) === Number(beforeStk.equipmentPorts) + 2,
	);
	await activePage.getByTestId("rail-canvas").press("Escape");

	const equipment = await activePage.evaluate(() => {
		const state = window.__tileFab?.getDocument().portEquipment;
		if (!state) throw new Error("Port/equipment project state is unavailable.");
		const groupsById = new Map(state.equipmentGroups.map((group) => [group.id, group]));
		const ports = state.ports
			.map((port) => ({
				id: port.id,
				equipmentGroupId: port.equipmentGroupId,
				barcode: port.barcode,
				kind: groupsById.get(port.equipmentGroupId)?.kind ?? null,
				route: port.route,
				stationMillimeters: port.stationMillimeters,
				side: port.side,
				lateralOffsetMillimeters: port.lateralOffsetMillimeters,
				direction: port.direction,
			}))
			.sort((left, right) => left.id - right.id);
		return {
			ports,
			groups: state.equipmentGroups
				.map((group) => ({ id: group.id, kind: group.kind, portIds: [...group.portIds] }))
				.sort((left, right) => left.id - right.id),
		};
	});
	const ohbPorts = equipment.ports.filter((port) => port.kind === "OHB");
	const eqPorts = equipment.ports.filter((port) => port.kind === "EQ");
	const stkPorts = equipment.ports.filter((port) => port.kind === "STK");
	const eqGroups = equipment.groups.filter((group) => group.kind === "EQ");
	const stkGroups = equipment.groups.filter((group) => group.kind === "STK");
	assertEqual(ohbPorts.length, 2, "public OHB port count");
	assertEqual(eqPorts.length, 3, "public EQ port count");
	assertEqual(stkPorts.length, 2, "public STK port count");
	assertEqual(new Set(ohbPorts.map((port) => port.equipmentGroupId)).size, 2, "OHB group count");
	assertEqual(eqGroups.length, 1, "EQ group count");
	assertEqual(stkGroups.length, 1, "STK group count");
	const stkGroup = stkGroups[0];
	const alphaHomePort = resolveExactAuthoredPort(stkPorts, stkPair[0], "ALPHA");
	const betaHomePort = resolveExactAuthoredPort(stkPorts, stkPair[1], "BETA");
	const alphaHomeWorld = stkPair[0];
	const betaHomeWorld = stkPair[1];
	if (!alphaHomePort || !betaHomePort || !alphaHomeWorld || !betaHomeWorld) {
		throw new Error("Public resident home assignments are incomplete.");
	}
	return {
		source: ohbPorts[0],
		service: eqPorts[0],
		serviceWorld: eqSlots[0],
		servicePorts: eqPorts,
		serviceGroup: eqGroups[0],
		stkPorts,
		stkGroup,
		stkWorlds: stkPair.map((candidate) => ({
			x: candidate.x,
			y: candidate.y,
			orientation: candidate.orientation,
		})),
		destination: ohbPorts[1],
		residentFleet: {
			alpha: {
				vehicleId: "PUBLIC-RESIDENT-OHT-ALPHA",
				homePort: alphaHomePort,
				homeWorld: alphaHomeWorld,
			},
			beta: {
				vehicleId: "PUBLIC-RESIDENT-OHT-BETA",
				homePort: betaHomePort,
				homeWorld: betaHomeWorld,
			},
		},
	};
}

function resolveExactAuthoredPort(ports, authoredCandidate, label) {
	const matches = ports.filter(
		(port) =>
			port.route?.kind === "CARDINAL_CELL" &&
			port.route.x === authoredCandidate.route.x &&
			port.route.z === authoredCandidate.route.z &&
			port.route.from === authoredCandidate.route.from &&
			port.route.to === authoredCandidate.route.to &&
			port.stationMillimeters === authoredCandidate.stationMillimeters &&
			port.side === authoredCandidate.side &&
			port.lateralOffsetMillimeters === authoredCandidate.lateralOffsetMillimeters &&
			port.direction === authoredCandidate.direction,
	);
	if (matches.length !== 1) {
		throw new Error(`${label} resident home draft did not resolve one exact authored port.`);
	}
	return matches[0];
}

async function configurePublicOperationalInputs(activePage, ports) {
	const readinessToggle = activePage.getByTestId("rail-readiness-toggle");
	await readinessToggle.click();
	const checks = activePage.getByTestId("rail-readiness-panel");
	await checks.waitFor({ state: "visible" });
	await activePage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="rail-readiness-panel"]')
				?.getAttribute("data-status") === "ready",
		undefined,
		{ timeout: 30_000 },
	);
	const launch = activePage.locator(".tilefab-operational-launch");
	await launch.click();
	let panel = activePage.getByTestId("operational-configuration-panel");
	await panel.waitFor({ state: "visible" });
	await panel.getByLabel(`PORT-${ports.source.id} transfer role`).selectOption("PICKUP_ONLY");
	await panel.getByLabel(`PORT-${ports.destination.id} transfer role`).selectOption("DROPOFF_ONLY");
	for (const servicePort of ports.servicePorts) {
		await panel.getByLabel(`PORT-${servicePort.id} transfer role`).selectOption("BIDIRECTIONAL");
	}
	for (const stkPort of ports.stkPorts) {
		await panel.getByLabel(`PORT-${stkPort.id} transfer role`).selectOption("BIDIRECTIONAL");
	}

	await panel.locator(".tilefab-operational-tabs button").nth(1).click();
	await panel.getByLabel("New CAPABILITY").fill("PUBLIC_PROCESS");
	await panel.getByLabel("New CAPABILITY").press("Enter");
	await panel.locator("#tilefab-operational-eq-group").selectOption(String(ports.serviceGroup.id));
	await panel
		.getByRole("group", { name: "GROUP DEFAULT", exact: true })
		.getByRole("checkbox", { name: "PUBLIC_PROCESS", exact: true })
		.check();

	await panel.locator(".tilefab-operational-tabs button").nth(2).click();
	await panel.getByLabel("New STORAGE CLASS").fill("PUBLIC_BUFFER");
	await panel.getByLabel("New STORAGE CLASS").press("Enter");
	await panel.getByLabel("New storage policy key").fill("PUBLIC_FIFO");
	await panel.getByLabel("New policy storage class").selectOption("1");
	await panel.getByLabel("New policy priority rank").fill("0");
	await panel.getByLabel("New policy dwell milliseconds").fill("0");
	await panel.locator(".tilefab-operational-policy-form button[type='submit']").click();
	await configureStorageGroup(activePage, panel, ports.source.equipmentGroupId, 2, "OHB");
	await configureStorageGroup(activePage, panel, ports.destination.equipmentGroupId, 0, "OHB");
	await configureStorageGroup(activePage, panel, ports.stkGroup.id, 0, "STK");

	await panel.locator(".tilefab-operational-tabs button").nth(3).click();
	const vehicle = {
		"PROFILE ID": "PUBLIC-OHT-1",
		VERSION: "1",
		"BODY LENGTH (mm)": "1200",
		"REFERENCE → FRONT (mm)": "600",
		"REFERENCE → REAR (mm)": "600",
		"BODY WIDTH (mm)": "400",
		"LATERAL MARGIN (mm)": "50",
		"FRONT MARGIN (mm)": "200",
		"REAR MARGIN (mm)": "200",
		"MAX SPEED (mm/s)": "5000",
		"CONTROL REACTION (ms)": "100",
		"MIN DECELERATION (mm/s²)": "1000",
	};
	for (const [label, value] of Object.entries(vehicle)) await panel.getByLabel(label).fill(value);
	await panel.getByRole("button", { name: "SET PROFILE", exact: true }).click();

	await panel.locator(".tilefab-operational-tabs button").nth(4).click();
	const residentSection = panel.getByRole("region", {
		name: "Resident fleet home slots",
		exact: true,
	});
	for (const resident of [ports.residentFleet.alpha, ports.residentFleet.beta]) {
		await residentSection.getByLabel("New resident vehicle ID").fill(resident.vehicleId);
		await residentSection
			.getByLabel("New resident home port")
			.selectOption(String(resident.homePort.id));
		await residentSection.getByRole("button", { name: "ADD HOME SLOT", exact: true }).click();
	}
	if (!(await residentSection.innerText()).includes("SEPARATE RESIDENT CERTIFICATION REQUIRED")) {
		throw new Error("Resident home editor does not disclose the separate certification gate.");
	}
	await panel.getByRole("button", { name: "APPLY DRAFT", exact: true }).click();
	await waitForWorker(activePage, (metrics) => metrics.operationalRevision === "1");

	panel = activePage.getByTestId("operational-configuration-panel");
	await panel.locator(".tilefab-operational-tabs button").nth(5).click();
	const review = panel.getByRole("button", { name: "REVIEW EXACT SOURCE", exact: true });
	await review.waitFor({ state: "visible" });
	await review.click();
	await waitForWorker(
		activePage,
		(metrics) => metrics.operationalReady === "true" && metrics.operationalRevision === "1",
	);
	panel = activePage.getByTestId("operational-configuration-panel");
	await panel.getByRole("button", { name: "운영 설정 닫기", exact: true }).click();
}

async function configureStorageGroup(
	activePage,
	panel,
	equipmentGroupId,
	initialOccupiedUnits,
	equipmentKind,
) {
	await panel.locator("#tilefab-operational-storage-group").selectOption(String(equipmentGroupId));
	await activePage.waitForFunction(
		(expected) =>
			document
				.querySelector(".tilefab-operational-policy-card header span")
				?.textContent?.includes(`${expected.kind}-${expected.groupId}`),
		{ kind: equipmentKind, groupId: equipmentGroupId },
	);
	const card = panel.locator(".tilefab-operational-policy-card");
	await card.locator("select").first().selectOption("1");
	await card.getByLabel("CAPACITY UNITS").fill("4");
	await card.getByLabel("INITIAL OCCUPIED").fill(String(initialOccupiedUnits));
	await card.getByLabel("HIGH-WATER MARK").fill("3");
	await card.getByRole("button", { name: "SET GROUP", exact: true }).click();
}

async function selectPublicInteractionPort(activePage, ports) {
	await clickActivityCommand(activePage, "inspect", "선택 및 정보");
	await centerWorld(activePage, ports.serviceWorld);
	const point = await screenPointForWorld(activePage, ports.serviceWorld);
	await activePage.mouse.click(point.x, point.y);
	await activePage.waitForFunction(
		(expected) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			return (
				app?.getAttribute("data-selected-port-id") === String(expected.portId) &&
				app.getAttribute("data-selected-equipment-group-id") === String(expected.groupId)
			);
		},
		{ portId: ports.service.id, groupId: ports.serviceGroup.id },
		{ timeout: 10_000 },
	);
}

async function certifyExactProject(activePage) {
	const card = activePage.getByTestId("simulation-readiness-certification");
	try {
		await activePage.waitForFunction(
			() =>
				document
					.querySelector('[data-testid="simulation-readiness-certification"]')
					?.getAttribute("data-phase") === "eligible",
			undefined,
			{ timeout: 30_000 },
		);
	} catch (error) {
		const readinessToggle = activePage.getByTestId("rail-readiness-toggle");
		if ((await readinessToggle.getAttribute("aria-expanded")) !== "true") {
			await readinessToggle.click();
		}
		const readinessText = await activePage.getByTestId("rail-readiness-panel").innerText();
		throw new Error(`Simulation certification stayed blocked:\n${readinessText}`, { cause: error });
	}
	await card.getByRole("button", { name: "CERTIFY", exact: true }).click();
	await activePage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="simulation-readiness-certification"]')
				?.getAttribute("data-phase") === "ready",
		undefined,
		{ timeout: 30_000 },
	);
	const text = await card.innerText();
	const counts = text.match(/PATHS\s*\/\s*RESOURCES\s*([\d,]+)\s*\/\s*([\d,]+)/i);
	if (!counts) {
		throw new Error(`Unexpected public readiness counts: ${text}`);
	}
	const paths = Number(counts[1].replaceAll(",", ""));
	const resources = Number(counts[2].replaceAll(",", ""));
	assertEqual(paths, 11_116, "certified physical path count");
	assertEqual(resources, 11_299, "certified resource count");
	return { phase: "ready", paths, resources };
}

async function reviewAndPrepareScenario(activePage, filePath, sourceKind) {
	const card = activePage.getByTestId("simulation-scenario-source-review");
	const command = sourceKind === "TRANSFER_PLAN" ? "LOAD TRANSFER PLAN" : "LOAD REPLAY HISTORY";
	const button = card.getByRole("button", { name: command, exact: true });
	await button.scrollIntoViewIfNeeded();
	const [chooser] = await Promise.all([activePage.waitForEvent("filechooser"), button.click()]);
	await chooser.setFiles(filePath);
	await waitForPhase(activePage, "simulation-scenario-source-review", "reviewed", 10_000);
	assertEqual(await card.getAttribute("data-source-kind"), sourceKind, `${sourceKind} review kind`);
	const records = card.getByRole("region", { name: "Accepted scenario records", exact: true });
	assertEqual(
		Number(await records.getAttribute("data-window-start")),
		0,
		`${sourceKind} review start`,
	);
	assertEqual(Number(await records.getAttribute("data-window-end")), 4, `${sourceKind} review end`);
	assertEqual(
		Number(await records.getAttribute("data-record-count")),
		4,
		`${sourceKind} review count`,
	);
	const recordText = await records.innerText();
	if (
		!recordText.includes("PUBLIC-LOAD-1") ||
		!recordText.includes("PUBLIC-LOAD-2") ||
		!recordText.includes("PORT")
	) {
		throw new Error(`${sourceKind} canonical record review is incomplete: ${recordText}`);
	}
	await card.getByRole("button", { name: "PREPARE", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-source-review", "prepared", 30_000);
	assertEqual(
		await card.getAttribute("data-source-kind"),
		sourceKind,
		`${sourceKind} prepared kind`,
	);
	return { sourceKind, phase: "prepared" };
}

async function authorizeRuntime(activePage) {
	const authorization = activePage.getByTestId("simulation-scenario-run-authorization");
	await waitForPhase(activePage, "simulation-scenario-run-authorization", "prepared", 10_000);
	await authorization.getByRole("button", { name: "AUTHORIZE LIMITED RUN", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-run-authorization", "authorized", 10_000);
}

async function startAndPauseMovingRuntime(activePage) {
	const card = activePage.getByTestId("simulation-scenario-active-run");
	await card.getByLabel("Simulation speed").selectOption("1");
	await card.getByRole("button", { name: "START SAFE RUNTIME", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-active-run", "active", 10_000);
	await card.getByRole("button", { name: "RUN CLOCK", exact: true }).click();
	await activePage.waitForFunction(
		() => {
			const kpis = document.querySelector('[data-testid="simulation-runtime-kpis"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(kpis?.getAttribute("data-publication-sequence")) > 0 &&
				kpis?.getAttribute("data-request-in-transit") === "1" &&
				canvas?.dataset.simulationRuntimePoses === "1" &&
				canvas.dataset.simulationRuntimeVisiblePoses === "1" &&
				(canvas.dataset.simulationRuntimePoseFingerprint?.length ?? 0) > 0
			);
		},
		undefined,
		{ timeout: 15_000 },
	);
	const firstMovingRuntime = await read2DRuntime(activePage);
	await activePage.waitForFunction(
		(first) => {
			const kpis = document.querySelector('[data-testid="simulation-runtime-kpis"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const sequence = Number(canvas?.dataset.simulationRuntimeSequence);
			const fingerprint = canvas?.dataset.simulationRuntimePoseFingerprint ?? "";
			return (
				sequence > Math.max(5, Number(first.sequence)) &&
				Number(kpis?.getAttribute("data-publication-sequence")) === sequence &&
				canvas?.dataset.simulationRuntimePoses === "1" &&
				canvas.dataset.simulationRuntimeVisiblePoses === "1" &&
				fingerprint.length > 0 &&
				fingerprint !== first.poseFingerprint
			);
		},
		firstMovingRuntime,
		{ timeout: 15_000 },
	);
	await card.getByRole("button", { name: "PAUSE CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-active-run", "paused", 10_000);
	await activePage.waitForFunction(
		() => {
			const kpis = document.querySelector('[data-testid="simulation-runtime-kpis"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const publicationSequence = kpis?.getAttribute("data-publication-sequence") ?? "0";
			return (
				Number(publicationSequence) > 0 &&
				canvas?.dataset.simulationRuntimeSequence === publicationSequence &&
				canvas.dataset.simulationRuntimePoses === "1"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const runtime = await read2DRuntime(activePage);
	const kpiSequence = Number(
		await activePage
			.getByTestId("simulation-runtime-kpis")
			.getAttribute("data-publication-sequence"),
	);
	assertEqual(runtime.sequence, kpiSequence, "paused 2D/KPI publication sequence");
	if (runtime.poseFingerprint === firstMovingRuntime.poseFingerprint) {
		throw new Error("Paused 2D runtime pose did not move between canonical publications.");
	}
	return {
		...runtime,
		movement: {
			firstSequence: firstMovingRuntime.sequence,
			firstPoseFingerprint: firstMovingRuntime.poseFingerprint,
		},
	};
}

async function proveDerived3DParity(activePage, moving2D, ports) {
	const sequence = moving2D.sequence;
	const stkSectionFraming = await proveStkSectionFraming(activePage, sequence, ports);
	await activePage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const canvas = activePage.getByTestId("static-fab-inspection-3d-canvas");
	await canvas.waitFor({ state: "visible" });
	await activePage.waitForFunction(
		() => {
			const target = document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]');
			return (
				Number(target?.dataset.sceneRuntimeSequence) > 0 &&
				target.dataset.sceneRuntimeVehicles === "1" &&
				Number(target.dataset.sceneRuntimeUpdates) >= 1
			);
		},
		undefined,
		{ timeout: 30_000 },
	);
	const metrics = await canvas.evaluate((target) => ({
		sequence: Number(target.dataset.sceneRuntimeSequence),
		poseFingerprint: target.dataset.sceneRuntimePoseFingerprint ?? "",
		vehicles: Number(target.dataset.sceneRuntimeVehicles),
		updates: Number(target.dataset.sceneRuntimeUpdates),
		contentBuilds: Number(target.dataset.sceneContentBuilds),
		equipmentSections: Number(target.dataset.sceneEquipmentInstances),
		equipmentShellSpans: Number(target.dataset.sceneEquipmentShellSpans),
		portInstances: Number(target.dataset.scenePortInstances),
		portSlotInstances: Number(target.dataset.scenePortSlotInstances),
		cameraDistance: Number(target.dataset.sceneCameraDistance),
	}));
	assertEqual(metrics.sequence, sequence, "paused 2D/3D publication sequence");
	assertEqual(
		metrics.poseFingerprint,
		moving2D.poseFingerprint,
		"paused 2D/3D moving-pose fingerprint",
	);
	assertEqual(metrics.contentBuilds, 1, "3D static content build count");
	assertEqual(metrics.equipmentSections, 5, "3D canonical equipment section count");
	assertEqual(metrics.equipmentShellSpans, 12, "3D port-derived equipment shell span count");
	assertEqual(metrics.portInstances, 7, "3D canonical port instance count");
	assertEqual(metrics.portSlotInstances, 7, "3D stable port-slot instance count");
	await activePage.getByRole("button", { name: "선택 전체 프레임", exact: true }).click();
	await activePage.waitForFunction(
		(previousDistance) =>
			Number(
				document
					.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')
					?.getAttribute("data-scene-camera-distance"),
			) < Number(previousDistance),
		metrics.cameraDistance,
		{ timeout: 10_000 },
	);
	metrics.framedCameraDistance = Number(await canvas.getAttribute("data-scene-camera-distance"));
	assertEqual(
		Number(await canvas.getAttribute("data-scene-content-builds")),
		1,
		"3D equipment framing static content build count",
	);
	const expectedServicePortIds = ports.servicePorts.map((port) => port.id).sort((a, b) => a - b);
	const expectedServiceGroupId = ports.serviceGroup.id;
	const layerMenu = activePage.getByRole("button", { name: "3D 표시 레이어", exact: true });
	await layerMenu.click();
	const railVisibility = activePage.getByRole("button", { name: "3D 레일 표시", exact: true });
	const switchVisibility = activePage.getByRole("button", {
		name: "3D 스위치 하드웨어 표시",
		exact: true,
	});
	await railVisibility.click();
	await switchVisibility.click();
	await waitForCanvasDataset(activePage, "sceneRailVisible", "false");
	await waitForCanvasDataset(activePage, "sceneSwitchesVisible", "false");
	await layerMenu.click();
	await clear3DSelectionAtCanvasCorner(activePage, canvas);
	const bodyPick = await pickVisibleEquipment(activePage, canvas, "body", {
		portIds: expectedServicePortIds,
		equipmentGroupId: expectedServiceGroupId,
	});
	assertEqual(
		Number(await canvas.getAttribute("data-scene-content-builds")),
		1,
		"3D equipment body pick static content build count",
	);
	await clear3DSelectionAtCanvasCorner(activePage, canvas);
	const slotPick = await pickVisibleEquipment(activePage, canvas, "slot", {
		portIds: expectedServicePortIds,
		equipmentGroupId: expectedServiceGroupId,
	});

	await layerMenu.click();
	const equipmentVisibility = activePage.getByRole("button", {
		name: "3D 설비와 포트 표시",
		exact: true,
	});
	await equipmentVisibility.click();
	await waitForCanvasDataset(activePage, "sceneEquipmentVisible", "false");
	assertEquipmentIdentity(
		await readSelectedEquipmentIdentity(activePage),
		slotPick,
		"hidden equipment preserves semantic selection",
	);
	await activePage.mouse.click(bodyPick.pageX, bodyPick.pageY);
	await activePage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-selected-port-id") === "",
		undefined,
		{ timeout: 10_000 },
	);
	assertEquipmentIdentity(
		await readSelectedEquipmentIdentity(activePage),
		{ portId: null, equipmentGroupId: null },
		"hidden equipment proxy is not pickable",
	);
	await equipmentVisibility.click();
	await waitForCanvasDataset(activePage, "sceneEquipmentVisible", "true");
	await layerMenu.click();
	const portPick = await pickVisibleEquipment(activePage, canvas, "port", {
		portIds: expectedServicePortIds,
		equipmentGroupId: expectedServiceGroupId,
	});
	assertAtLeast(
		Math.hypot(bodyPick.pageX - portPick.pageX, bodyPick.pageY - portPick.pageY),
		8,
		"3D equipment body/port pick pixel separation",
	);
	assertAtLeast(
		Math.hypot(slotPick.pageX - portPick.pageX, slotPick.pageY - portPick.pageY),
		20,
		"3D equipment slot-adjacent/port pick pixel separation",
	);
	assertEqual(
		Number(await canvas.getAttribute("data-scene-content-builds")),
		1,
		"3D equipment layer and port-pick static content build count",
	);
	await activePage.screenshot({
		path: path.join(artifactRoot, "moving-3d-equipment.png"),
		fullPage: true,
	});

	await layerMenu.click();
	await railVisibility.click();
	await switchVisibility.click();
	await waitForCanvasDataset(activePage, "sceneRailVisible", "true");
	await waitForCanvasDataset(activePage, "sceneSwitchesVisible", "true");
	await layerMenu.click();
	const selectedBeforeContextLoss = await readSelectedEquipmentIdentity(activePage);
	await canvas.evaluate((target) => {
		const gl = target.getContext("webgl2") ?? target.getContext("webgl");
		const extension = gl?.getExtension("WEBGL_lose_context");
		if (!extension) throw new Error("WEBGL_lose_context is unavailable.");
		extension.loseContext();
	});
	await activePage.waitForFunction(
		() =>
			document.querySelector('[data-testid="tilefab-app"]')?.getAttribute("data-view-mode") ===
			"2d",
		undefined,
		{ timeout: 10_000 },
	);
	assertEquipmentIdentity(
		await readSelectedEquipmentIdentity(activePage),
		selectedBeforeContextLoss,
		"WebGL loss fallback preserves equipment selection",
	);
	const fallbackRuntime = await read2DRuntime(activePage);
	assertEqual(fallbackRuntime.sequence, sequence, "WebGL loss fallback runtime sequence");
	assertEqual(
		fallbackRuntime.poseFingerprint,
		moving2D.poseFingerprint,
		"WebGL loss fallback moving-pose fingerprint",
	);
	await activePage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const recoveredCanvas = activePage.getByTestId("static-fab-inspection-3d-canvas");
	await recoveredCanvas.waitFor({ state: "visible" });
	await activePage.waitForFunction(
		(expected) => {
			const target = document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]');
			return (
				Number(target?.getAttribute("data-scene-runtime-sequence")) === Number(expected.sequence) &&
				target?.getAttribute("data-scene-runtime-pose-fingerprint") === expected.poseFingerprint &&
				target?.getAttribute("data-scene-equipment-shell-spans") === "12" &&
				target?.getAttribute("data-scene-port-slot-instances") === "7"
			);
		},
		moving2D,
		{ timeout: 30_000 },
	);
	assertEquipmentIdentity(
		await readSelectedEquipmentIdentity(activePage),
		selectedBeforeContextLoss,
		"fresh 3D context preserves equipment selection",
	);
	assertEqual(
		Number(await recoveredCanvas.getAttribute("data-scene-content-builds")),
		1,
		"fresh 3D context builds static content once",
	);
	metrics.equipmentInteraction = {
		bodyPick,
		slotPick,
		portPick,
		hiddenProxyClearedSelection: true,
		contextLossFallbackSequence: fallbackRuntime.sequence,
		recoveredContentBuilds: Number(await recoveredCanvas.getAttribute("data-scene-content-builds")),
		recoveredSelection: await readSelectedEquipmentIdentity(activePage),
	};
	metrics.stkSectionFraming = stkSectionFraming;
	await activePage.screenshot({
		path: path.join(artifactRoot, "moving-3d.png"),
		fullPage: true,
	});
	return metrics;
}

async function proveStkSectionFraming(activePage, sequence, ports) {
	const [horizontalWorld, verticalWorld] = ports.stkWorlds;
	const [horizontalPort, verticalPort] = ports.stkPorts;
	if (!horizontalWorld || !verticalWorld || !horizontalPort || !verticalPort) {
		throw new Error("Public FLEX STK section-framing fixture is incomplete.");
	}
	assertEqual(horizontalWorld.orientation, "H", "horizontal STK section fixture orientation");
	assertEqual(verticalWorld.orientation, "V", "vertical STK section fixture orientation");
	assertAtLeast(
		Math.hypot(horizontalWorld.x - verticalWorld.x, horizontalWorld.y - verticalWorld.y),
		120,
		"canonical FLEX STK section separation",
	);
	await selectPortEquipmentIn2D(activePage, horizontalPort.id, ports.stkGroup.id, horizontalWorld);
	let canvas = await openRuntime3DScene(activePage, sequence);
	const horizontal = await frameSelectedPortSection(activePage, canvas, horizontalWorld);
	await activePage.getByRole("button", { name: "선택 전체 프레임", exact: true }).click();
	await waitForCanvasDataset(activePage, "sceneFrameScope", "selection");
	const wholeGroup = await read3DFrame(canvas);
	assertAtLeast(
		wholeGroup.cameraDistance,
		horizontal.cameraDistance * 4,
		"whole FLEX STK group framing remains wider than one local section",
	);
	const groupMidpoint = {
		x: (horizontalWorld.x + verticalWorld.x) * 0.5,
		y: (horizontalWorld.y + verticalWorld.y) * 0.5,
	};
	assertAtMost(
		Math.hypot(
			wholeGroup.cameraTargetX - groupMidpoint.x,
			wholeGroup.cameraTargetZ - groupMidpoint.y,
		),
		2,
		"whole FLEX STK group frame target",
	);

	await activePage.getByRole("button", { name: "2D 편집 뷰", exact: true }).click();
	await waitForView(activePage, "2d");
	await selectPortEquipmentIn2D(activePage, verticalPort.id, ports.stkGroup.id, verticalWorld);
	canvas = await openRuntime3DScene(activePage, sequence);
	const vertical = await frameSelectedPortSection(activePage, canvas, verticalWorld);
	if (horizontal.framedPortBodySectionRow === vertical.framedPortBodySectionRow) {
		throw new Error(
			"Horizontal and vertical FLEX STK ports framed the same canonical section row.",
		);
	}
	assertAtLeast(
		Math.hypot(
			horizontal.cameraTargetX - vertical.cameraTargetX,
			horizontal.cameraTargetZ - vertical.cameraTargetZ,
		),
		118,
		"FLEX STK section-local frame target separation",
	);

	await activePage.getByRole("button", { name: "2D 편집 뷰", exact: true }).click();
	await waitForView(activePage, "2d");
	await selectPortEquipmentIn2D(
		activePage,
		ports.service.id,
		ports.serviceGroup.id,
		ports.serviceWorld,
	);
	return { horizontal, vertical, wholeGroup };
}

async function openRuntime3DScene(activePage, sequence) {
	await activePage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const canvas = activePage.getByTestId("static-fab-inspection-3d-canvas");
	await canvas.waitFor({ state: "visible" });
	await activePage.waitForFunction(
		(expectedSequence) => {
			const target = document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]');
			return (
				Number(target?.dataset.sceneRuntimeSequence) === Number(expectedSequence) &&
				Number(target?.dataset.sceneSelectionApplies) >= 2 &&
				target?.dataset.sceneEquipmentInstances === "5" &&
				target.dataset.sceneEquipmentShellSpans === "12" &&
				target.dataset.scenePortSlotInstances === "7"
			);
		},
		sequence,
		{ timeout: 30_000 },
	);
	return canvas;
}

async function frameSelectedPortSection(activePage, canvas, expectedWorld) {
	await canvas.press("Shift+F");
	await waitForCanvasDataset(activePage, "sceneFrameScope", "port-section");
	const frame = await read3DFrame(canvas);
	assertAtMost(frame.cameraDistance, 20, "section-local FLEX STK camera distance");
	assertAtMost(
		Math.hypot(frame.cameraTargetX - expectedWorld.x, frame.cameraTargetZ - expectedWorld.y),
		2,
		"section-local FLEX STK frame target",
	);
	assertEqual(
		Number(await canvas.getAttribute("data-scene-content-builds")),
		1,
		"section-local FLEX STK framing content build count",
	);
	return frame;
}

async function read3DFrame(canvas) {
	return canvas.evaluate((target) => ({
		cameraDistance: Number(target.dataset.sceneCameraDistance),
		cameraTargetX: Number(target.dataset.sceneCameraTargetX),
		cameraTargetZ: Number(target.dataset.sceneCameraTargetZ),
		frameScope: target.dataset.sceneFrameScope,
		framedPortBodySectionRow:
			target.dataset.sceneFramedPortBodySectionRow === ""
				? null
				: Number(target.dataset.sceneFramedPortBodySectionRow),
	}));
}

async function selectPortEquipmentIn2D(activePage, portId, equipmentGroupId, world) {
	await clickActivityCommand(activePage, "inspect", "선택 및 정보");
	await centerWorld(activePage, world);
	for (let attempt = 0; attempt < 6; attempt++) {
		const point = await screenPointForWorld(activePage, world);
		await activePage.mouse.move(point.x, point.y);
		if (attempt > 0) await activePage.mouse.wheel(0, -420);
		await activePage.mouse.click(point.x, point.y);
		try {
			await activePage.waitForFunction(
				(expected) => {
					const app = document.querySelector('[data-testid="tilefab-app"]');
					return (
						app?.getAttribute("data-selected-port-id") === String(expected.portId) &&
						app.getAttribute("data-selected-equipment-group-id") ===
							String(expected.equipmentGroupId)
					);
				},
				{ portId, equipmentGroupId },
				{ timeout: 750 },
			);
			return;
		} catch {
			// Zoom around the exact canonical world point and retry through the visible Canvas path.
		}
	}
	throw new Error(`Could not select PORT-${portId} / equipment-${equipmentGroupId} in 2D.`);
}

async function clear3DSelectionAtCanvasCorner(activePage, canvas) {
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("3D equipment canvas has no bounds.");
	await activePage.mouse.click(bounds.x + 8, bounds.y + 8);
	await activePage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-selected-port-id") === "",
		undefined,
		{ timeout: 10_000 },
	);
}

async function pickVisibleEquipment(activePage, canvas, kind, expected) {
	const image = await canvas.screenshot();
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
				return green > 125 && blue > 110 && green > red * 1.12 && blue > red * 1.02;
			};
			const matchesBodySurfaceAt = (x, y) => {
				const offset = (y * bitmap.width + x) * 4;
				const red = pixels[offset] ?? 0;
				const green = pixels[offset + 1] ?? 0;
				const blue = pixels[offset + 2] ?? 0;
				const greenEquipmentSurface =
					green > 35 && green > red * 1.1 && green > blue * 1.02 && blue < 150;
				const neutralEquipmentSurface =
					red > 42 &&
					green > 40 &&
					blue > 36 &&
					Math.max(red, green, blue) - Math.min(red, green, blue) < 46 &&
					red < 190;
				return (greenEquipmentSurface || neutralEquipmentSurface) && !matchesPortAt(x, y);
			};
			const hasBodySurfaceToward = (x, y, deltaX, deltaY) => {
				for (let distance = 4; distance <= 28; distance += 2) {
					const targetX = x + deltaX * distance;
					const targetY = y + deltaY * distance;
					if (
						targetX >= 0 &&
						targetX < bitmap.width &&
						targetY >= 0 &&
						targetY < bitmap.height &&
						matchesBodySurfaceAt(targetX, targetY)
					) {
						return true;
					}
				}
				return false;
			};
			for (let y = 4; y < bitmap.height - 4; y += 2) {
				for (let x = 4; x < bitmap.width - 4; x += 2) {
					const offset = (y * bitmap.width + x) * 4;
					const red = pixels[offset] ?? 0;
					const green = pixels[offset + 1] ?? 0;
					const blue = pixels[offset + 2] ?? 0;
					const matchesPort = matchesPortAt(x, y);
					let portPixelNearby = false;
					if (candidateKind === "body" || candidateKind === "slot") {
						const proximityRadius = candidateKind === "slot" ? 24 : 10;
						for (
							let nearbyY = Math.max(0, y - proximityRadius);
							nearbyY <= Math.min(bitmap.height - 1, y + proximityRadius);
							nearbyY += 2
						) {
							for (
								let nearbyX = Math.max(0, x - proximityRadius);
								nearbyX <= Math.min(bitmap.width - 1, x + proximityRadius);
								nearbyX += 2
							) {
								if (matchesPortAt(nearbyX, nearbyY)) {
									portPixelNearby = true;
									break;
								}
							}
							if (portPixelNearby) break;
						}
					}
					const matchesBody = matchesBodySurfaceAt(x, y) && !portPixelNearby;
					const matchesSlot =
						red < 32 &&
						green < 52 &&
						blue < 52 &&
						!portPixelNearby &&
						hasBodySurfaceToward(x, y, -1, 0) &&
						hasBodySurfaceToward(x, y, 1, 0) &&
						hasBodySurfaceToward(x, y, 0, -1) &&
						hasBodySurfaceToward(x, y, 0, 1);
					if (
						(candidateKind === "port" && matchesPort) ||
						(candidateKind === "body" && matchesBody) ||
						(candidateKind === "slot" && matchesSlot)
					) {
						points.push({ x, y });
					}
				}
			}
			const centerX = bitmap.width / 2;
			const centerY = bitmap.height / 2;
			const ordered = points
				.sort(
					(left, right) =>
						(left.x - centerX) ** 2 +
						(left.y - centerY) ** 2 -
						((right.x - centerX) ** 2 + (right.y - centerY) ** 2),
				)
				.slice(0, 600);
			bitmap.close();
			return ordered;
		},
		{
			dataUrl: `data:image/png;base64,${image.toString("base64")}`,
			candidateKind: kind,
		},
	);
	if (candidates.length === 0) throw new Error(`No visible 3D equipment ${kind} pixels found.`);
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("3D equipment canvas has no bounds.");
	for (const candidate of candidates) {
		const pageX = bounds.x + candidate.x;
		const pageY = bounds.y + candidate.y;
		await activePage.mouse.click(pageX, pageY);
		const selected = await readSelectedEquipmentIdentity(activePage);
		if (
			selected.portId !== null &&
			expected.portIds.includes(selected.portId) &&
			selected.equipmentGroupId === expected.equipmentGroupId
		) {
			return { ...selected, pageX, pageY, candidateKind: kind };
		}
	}
	throw new Error(`Visible 3D equipment ${kind} pixels did not resolve canonical selection.`);
}

async function readSelectedEquipmentIdentity(activePage) {
	return activePage.getByTestId("tilefab-app").evaluate((target) => {
		const portId = Number(target.dataset.selectedPortId);
		const equipmentGroupId = Number(target.dataset.selectedEquipmentGroupId);
		return {
			portId: Number.isSafeInteger(portId) && portId > 0 ? portId : null,
			equipmentGroupId:
				Number.isSafeInteger(equipmentGroupId) && equipmentGroupId > 0 ? equipmentGroupId : null,
		};
	});
}

function assertEquipmentIdentity(actual, expected, label) {
	assertEqual(actual.portId, expected.portId, `${label} port ID`);
	assertEqual(actual.equipmentGroupId, expected.equipmentGroupId, `${label} equipment-group ID`);
}

async function waitForCanvasDataset(activePage, field, value) {
	await activePage.waitForFunction(
		({ datasetField, expected }) =>
			document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]')?.dataset[
				datasetField
			] === expected,
		{ datasetField: field, expected: value },
		{ timeout: 10_000 },
	);
}

async function waitForView(activePage, mode) {
	await activePage.waitForFunction(
		(expected) =>
			document.querySelector('[data-testid="tilefab-app"]')?.getAttribute("data-view-mode") ===
			expected,
		mode,
		{ timeout: 10_000 },
	);
}

async function completeRuntime(activePage) {
	await activePage.getByRole("button", { name: "2D 편집 뷰", exact: true }).click();
	const readinessToggle = activePage.getByTestId("rail-readiness-toggle");
	await readinessToggle.waitFor({ state: "visible" });
	if ((await readinessToggle.getAttribute("aria-expanded")) !== "true") {
		await readinessToggle.click();
	}
	await activePage.getByTestId("rail-readiness-panel").waitFor({ state: "visible" });
	const card = activePage.getByTestId("simulation-scenario-active-run");
	await card.getByLabel("Simulation speed").selectOption("64");
	await card.getByRole("button", { name: "RESUME CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-active-run", "completed", 20_000);
	return readAndAssertTerminalRuntime(activePage);
}

async function startAndCompleteRuntime(activePage, sourceKind) {
	const card = activePage.getByTestId("simulation-scenario-active-run");
	await card.getByLabel("Simulation speed").selectOption("64");
	await card.getByRole("button", { name: "START SAFE RUNTIME", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-active-run", "active", 10_000);
	assertEqual(
		await card.getAttribute("data-source-kind"),
		sourceKind,
		`${sourceKind} active run kind`,
	);
	await card.getByRole("button", { name: "RUN CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-active-run", "completed", 20_000);
	return readAndAssertTerminalRuntime(activePage);
}

async function readAndAssertTerminalRuntime(activePage) {
	const kpis = activePage.getByTestId("simulation-runtime-kpis");
	const terminal = {
		sequence: Number(await kpis.getAttribute("data-publication-sequence")),
		completed: Number(await kpis.getAttribute("data-request-completed")),
		inTransit: Number(await kpis.getAttribute("data-request-in-transit")),
		serviceReady: Number(await kpis.getAttribute("data-service-ready")),
		serviceActive: Number(await kpis.getAttribute("data-service-active")),
		eqDestinationRequests: Number(await kpis.getAttribute("data-eq-destination-requests")),
		eqReady: Number(await kpis.getAttribute("data-eq-ready")),
		eqActive: Number(await kpis.getAttribute("data-eq-active")),
		storageResources: Number(await kpis.getAttribute("data-storage-resources")),
		storageOccupied: Number(await kpis.getAttribute("data-storage-occupied")),
		storageReserved: Number(await kpis.getAttribute("data-storage-reserved")),
		coreEvents: Number(await kpis.getAttribute("data-core-events")),
		resourceEvents: Number(await kpis.getAttribute("data-resource-events")),
		terminal: await kpis.getAttribute("data-terminal"),
	};
	assertEqual(terminal.completed, 4, "terminal request completion");
	assertEqual(terminal.inTransit, 0, "terminal in-transit count");
	assertEqual(terminal.serviceReady, 4, "terminal destination service completion");
	assertEqual(terminal.serviceActive, 0, "terminal active destination service count");
	assertEqual(terminal.eqDestinationRequests, 2, "terminal EQ destination request count");
	assertEqual(terminal.eqReady, 2, "terminal EQ ready count");
	assertEqual(terminal.eqActive, 0, "terminal EQ active count");
	assertEqual(terminal.storageResources, 2, "terminal storage resource count");
	assertEqual(terminal.storageOccupied, 2, "terminal storage occupied units");
	assertEqual(terminal.storageReserved, 0, "terminal storage reserved units");
	assertAtLeast(terminal.coreEvents, 1, "terminal core event count");
	assertAtLeast(terminal.resourceEvents, 1, "terminal resource event count");
	assertEqual(terminal.terminal, "true", "terminal publication trigger");
	const events = activePage.getByTestId("simulation-runtime-events");
	assertEqual(
		Number(await events.getAttribute("data-core-event-count")),
		terminal.coreEvents,
		"terminal core event-window count",
	);
	assertEqual(
		Number(await events.getAttribute("data-core-window-start")),
		Math.max(0, terminal.coreEvents - 6),
		"terminal core event-window start",
	);
	assertEqual(
		Number(await events.getAttribute("data-resource-event-count")),
		terminal.resourceEvents,
		"terminal resource event-window count",
	);
	assertEqual(
		Number(await events.getAttribute("data-resource-window-start")),
		Math.max(0, terminal.resourceEvents - 6),
		"terminal resource event-window start",
	);
	const eventRows = await events.getByRole("listitem").count();
	if (eventRows < 2 || eventRows > 12) {
		throw new Error(`Terminal event-window row budget is invalid: ${eventRows}`);
	}
	return terminal;
}

async function stopAndProveClear(activePage) {
	const card = activePage.getByTestId("simulation-scenario-active-run");
	await card.getByRole("button", { name: "STOP & DISCARD", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-active-run", "stopped", 10_000);
	assertEqual(
		await activePage.getByTestId("simulation-runtime-events").count(),
		0,
		"stopped runtime event-window clear",
	);
	await activePage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.simulationRuntimeSequence === "0" &&
				canvas.dataset.simulationRuntimePoseFingerprint === "" &&
				canvas.dataset.simulationRuntimePoses === "0" &&
				canvas.dataset.simulationRuntimeVisiblePoses === "0"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	return read2DRuntime(activePage);
}

async function clearScenarioSource(activePage, expectedSourceKind) {
	const card = activePage.getByTestId("simulation-scenario-source-review");
	assertEqual(
		await card.getAttribute("data-source-kind"),
		expectedSourceKind,
		`${expectedSourceKind} source before clear`,
	);
	await card.getByRole("button", { name: "CLEAR", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-source-review", "empty", 10_000);
	assertEqual(
		await card.getAttribute("data-source-kind"),
		"NONE",
		`${expectedSourceKind} source clear`,
	);
	return { previousSourceKind: expectedSourceKind, phase: "empty", sourceKind: "NONE" };
}

async function reviewAndPrepareResidentScenario(activePage, filePath, sourceKind) {
	await ensureFabCheckOpen(activePage);
	const card = activePage.getByTestId("simulation-resident-scenario-source-review");
	const command = sourceKind === "TRANSFER_PLAN" ? "LOAD RESIDENT PLAN" : "LOAD RESIDENT REPLAY";
	const button = card.getByRole("button", { name: command, exact: true });
	await button.scrollIntoViewIfNeeded();
	assertEqual(await button.isEnabled(), true, `${sourceKind} resident source chooser enabled`);
	const [chooser] = await Promise.all([activePage.waitForEvent("filechooser"), button.click()]);
	await chooser.setFiles(filePath);
	await waitForPhase(activePage, "simulation-resident-scenario-source-review", "reviewed", 15_000);
	assertEqual(
		await card.getAttribute("data-source-kind"),
		sourceKind,
		`${sourceKind} resident review kind`,
	);
	const records = card.getByRole("region", {
		name: "Bounded accepted resident scenario records",
		exact: true,
	});
	assertEqual(
		Number(await records.getAttribute("data-record-count")),
		2,
		`${sourceKind} resident record count`,
	);
	assertEqual(
		Number(await records.getAttribute("data-preview-count")),
		2,
		`${sourceKind} resident preview count`,
	);
	const text = await records.innerText();
	for (const identity of [
		"PUBLIC-RESIDENT-OHT-ALPHA",
		"PUBLIC-RESIDENT-OHT-BETA",
		"PUBLIC-RESIDENT-LOAD-ALPHA",
		"PUBLIC-RESIDENT-LOAD-BETA",
	]) {
		if (!text.includes(identity)) {
			throw new Error(`${sourceKind} resident canonical review is missing ${identity}: ${text}`);
		}
	}
	if (!text.includes("PORT")) {
		throw new Error(`${sourceKind} resident canonical review is incomplete: ${text}`);
	}
	await card.getByRole("button", { name: "PREPARE RESIDENT", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-source-review", "prepared", 30_000);
	return { sourceKind, phase: "prepared", recordCount: 2 };
}

async function authorizeResidentRuntime(activePage) {
	const authorization = activePage.getByTestId("simulation-resident-scenario-run-authorization");
	await waitForPhase(
		activePage,
		"simulation-resident-scenario-run-authorization",
		"prepared",
		10_000,
	);
	await authorization.getByRole("button", { name: "AUTHORIZE RESIDENT RUN", exact: true }).click();
	await waitForPhase(
		activePage,
		"simulation-resident-scenario-run-authorization",
		"authorized",
		15_000,
	);
}

async function startAndPauseMovingResidentRuntime(activePage, ports) {
	const residentHomeWorld = ports.residentFleet.alpha.homeWorld;
	await centerWorld(activePage, residentHomeWorld);
	const card = activePage.getByTestId("simulation-resident-scenario-active-run");
	await card.getByLabel("Resident simulation speed").selectOption("1");
	await card.getByRole("button", { name: "START RESIDENT RUNTIME", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "active", 15_000);
	assertEqual(
		await activePage
			.getByTestId("simulation-scenario-active-run")
			.getByRole("button", { name: "START SAFE RUNTIME", exact: true })
			.isDisabled(),
		true,
		"current Start lock during resident run",
	);
	await card.getByRole("button", { name: "RUN CLOCK", exact: true }).click();
	await waitForResidentContention(activePage);
	const first = await read2DRuntime(activePage);
	await activePage.waitForFunction(
		(initial) => {
			const kpis = document.querySelector('[data-testid="simulation-resident-runtime-kpis"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const sequence = Number(canvas?.dataset.simulationRuntimeSequence);
			const fingerprint = canvas?.dataset.simulationRuntimePoseFingerprint ?? "";
			return (
				sequence >= Number(initial.sequence) + 3 &&
				Number(kpis?.getAttribute("data-publication-sequence")) === sequence &&
				kpis?.getAttribute("data-vehicle-moving") === "1" &&
				kpis?.getAttribute("data-request-waiting-cycle") === "1" &&
				kpis?.getAttribute("data-vehicle-waiting-cycle") === "1" &&
				canvas?.dataset.simulationRuntimePoses === "2" &&
				canvas.dataset.simulationRuntimeVisiblePoses === "2" &&
				fingerprint.length > 0 &&
				fingerprint !== initial.poseFingerprint
			);
		},
		first,
		{ timeout: 20_000 },
	);
	await card.getByRole("button", { name: "PAUSE CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "paused", 10_000);
	const paused = await read2DRuntime(activePage);
	const kpiSequence = Number(
		await activePage
			.getByTestId("simulation-resident-runtime-kpis")
			.getAttribute("data-publication-sequence"),
	);
	assertEqual(paused.sequence, kpiSequence, "paused resident 2D/KPI publication sequence");
	if (paused.poseFingerprint === first.poseFingerprint) {
		throw new Error("Paused resident 2D pose did not move between canonical publications.");
	}
	return {
		...paused,
		contention: {
			moving: 1,
			waitingCycle: 1,
			nonHomeTrackOwned: Number(
				await activePage
					.getByTestId("simulation-resident-runtime-kpis")
					.getAttribute("data-non-home-track-owned"),
			),
		},
		movement: { firstSequence: first.sequence, firstPoseFingerprint: first.poseFingerprint },
	};
}

async function proveResidentDerived3DParity(activePage, moving2D) {
	await activePage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const canvas = activePage.getByTestId("static-fab-inspection-3d-canvas");
	await canvas.waitFor({ state: "visible" });
	await activePage.waitForFunction(
		(expected) => {
			const target = document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]');
			return (
				Number(target?.dataset.sceneRuntimeSequence) === Number(expected.sequence) &&
				target?.dataset.sceneRuntimePoseFingerprint === expected.poseFingerprint &&
				target?.dataset.sceneRuntimeVehicles === "2"
			);
		},
		moving2D,
		{ timeout: 30_000 },
	);
	const metrics = await canvas.evaluate((target) => ({
		sequence: Number(target.dataset.sceneRuntimeSequence),
		poseFingerprint: target.dataset.sceneRuntimePoseFingerprint ?? "",
		vehicles: Number(target.dataset.sceneRuntimeVehicles),
		contentBuilds: Number(target.dataset.sceneContentBuilds),
	}));
	assertEqual(metrics.sequence, moving2D.sequence, "resident paused 2D/3D sequence");
	assertEqual(
		metrics.poseFingerprint,
		moving2D.poseFingerprint,
		"resident paused 2D/3D pose fingerprint",
	);
	assertEqual(metrics.vehicles, 2, "resident derived 3D vehicle count");
	assertEqual(metrics.contentBuilds, 1, "resident 3D static content reuse");
	await activePage.getByRole("button", { name: "2D 편집 뷰", exact: true }).click();
	await waitForView(activePage, "2d");
	return metrics;
}

async function resumeAndPauseResidentHandoff(activePage) {
	await ensureFabCheckOpen(activePage);
	const card = activePage.getByTestId("simulation-resident-scenario-active-run");
	const before = await read2DRuntime(activePage);
	await card.getByLabel("Resident simulation speed").selectOption("64");
	await card.getByRole("button", { name: "RESUME CLOCK", exact: true }).click();
	await waitForResidentHandoff(activePage, before.poseFingerprint);
	await card.getByRole("button", { name: "PAUSE CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "paused", 10_000);
	return readResidentHandoffFacts(activePage);
}

async function completeResidentRuntime(activePage) {
	await ensureFabCheckOpen(activePage);
	const card = activePage.getByTestId("simulation-resident-scenario-active-run");
	await card.getByLabel("Resident simulation speed").selectOption("64");
	await card.getByRole("button", { name: "RESUME CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "completed", 30_000);
	return readAndAssertResidentTerminalRuntime(activePage);
}

async function startAndCompleteResidentRuntime(activePage, sourceKind) {
	await ensureFabCheckOpen(activePage);
	const card = activePage.getByTestId("simulation-resident-scenario-active-run");
	await card.getByLabel("Resident simulation speed").selectOption("64");
	await card.getByRole("button", { name: "START RESIDENT RUNTIME", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "active", 15_000);
	assertEqual(
		await card.getAttribute("data-source-kind"),
		sourceKind,
		`${sourceKind} resident active run kind`,
	);
	await card.getByRole("button", { name: "RUN CLOCK", exact: true }).click();
	await waitForResidentContention(activePage);
	const contention = await read2DRuntime(activePage);
	await waitForResidentHandoff(activePage, contention.poseFingerprint);
	const handoff = await readResidentHandoffFacts(activePage);
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "completed", 30_000);
	return { handoff, terminal: await readAndAssertResidentTerminalRuntime(activePage) };
}

async function waitForResidentContention(activePage) {
	await activePage.waitForFunction(
		() => {
			const kpis = document.querySelector('[data-testid="simulation-resident-runtime-kpis"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				Number(kpis?.getAttribute("data-publication-sequence")) > 0 &&
				kpis?.getAttribute("data-request-completed") === "0" &&
				kpis?.getAttribute("data-request-waiting-cycle") === "1" &&
				kpis?.getAttribute("data-vehicle-moving") === "1" &&
				kpis?.getAttribute("data-vehicle-waiting-cycle") === "1" &&
				Number(kpis?.getAttribute("data-non-home-track-owned")) > 0 &&
				canvas?.dataset.simulationRuntimePoses === "2" &&
				canvas.dataset.simulationRuntimeVisiblePoses === "2" &&
				(canvas.dataset.simulationRuntimePoseFingerprint?.length ?? 0) > 0
			);
		},
		undefined,
		{ timeout: 30_000 },
	);
}

async function waitForResidentHandoff(activePage, previousPoseFingerprint) {
	await activePage.waitForFunction(
		(previous) => {
			const kpis = document.querySelector('[data-testid="simulation-resident-runtime-kpis"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const fingerprint = canvas?.dataset.simulationRuntimePoseFingerprint ?? "";
			return (
				kpis?.getAttribute("data-request-completed") === "1" &&
				kpis?.getAttribute("data-request-waiting-cycle") === "0" &&
				kpis?.getAttribute("data-vehicle-idle") === "1" &&
				kpis?.getAttribute("data-vehicle-moving") === "1" &&
				kpis?.getAttribute("data-vehicle-waiting-cycle") === "0" &&
				Number(kpis?.getAttribute("data-non-home-track-owned")) > 0 &&
				canvas?.dataset.simulationRuntimePoses === "2" &&
				canvas.dataset.simulationRuntimeVisiblePoses === "2" &&
				fingerprint.length > 0 &&
				fingerprint !== previous
			);
		},
		previousPoseFingerprint,
		{ timeout: 30_000 },
	);
}

async function readResidentHandoffFacts(activePage) {
	const runtime = await read2DRuntime(activePage);
	const kpis = activePage.getByTestId("simulation-resident-runtime-kpis");
	return {
		...runtime,
		completed: Number(await kpis.getAttribute("data-request-completed")),
		idleHome: Number(await kpis.getAttribute("data-vehicle-idle")),
		moving: Number(await kpis.getAttribute("data-vehicle-moving")),
		waitingCycle: Number(await kpis.getAttribute("data-vehicle-waiting-cycle")),
		nonHomeTrackOwned: Number(await kpis.getAttribute("data-non-home-track-owned")),
	};
}

async function readAndAssertResidentTerminalRuntime(activePage) {
	const kpis = activePage.getByTestId("simulation-resident-runtime-kpis");
	const terminal = {
		sequence: Number(await kpis.getAttribute("data-publication-sequence")),
		completed: Number(await kpis.getAttribute("data-request-completed")),
		serviceReady: Number(await kpis.getAttribute("data-service-ready")),
		serviceActive: Number(await kpis.getAttribute("data-service-active")),
		idleHome: Number(await kpis.getAttribute("data-vehicle-idle")),
		moving: Number(await kpis.getAttribute("data-vehicle-moving")),
		nonHomeTrackOwned: Number(await kpis.getAttribute("data-non-home-track-owned")),
		switchConflictOwned: Number(await kpis.getAttribute("data-switch-conflict-owned")),
		storageOccupied: Number(await kpis.getAttribute("data-storage-occupied")),
		storageReserved: Number(await kpis.getAttribute("data-storage-reserved")),
		coreEvents: Number(await kpis.getAttribute("data-core-events")),
		resourceEvents: Number(await kpis.getAttribute("data-resource-events")),
		terminal: await kpis.getAttribute("data-terminal"),
	};
	assertEqual(terminal.completed, 2, "resident terminal request completion");
	assertEqual(terminal.serviceReady, 2, "resident terminal service completion");
	assertEqual(terminal.serviceActive, 0, "resident terminal active service count");
	assertEqual(terminal.idleHome, 2, "resident terminal idle-home vehicle count");
	assertEqual(terminal.moving, 0, "resident terminal moving vehicle count");
	assertEqual(terminal.nonHomeTrackOwned, 0, "resident terminal non-home track release");
	assertEqual(terminal.switchConflictOwned, 0, "resident terminal switch release");
	assertEqual(terminal.storageOccupied, 2, "resident terminal storage occupied units");
	assertEqual(terminal.storageReserved, 0, "resident terminal storage reservations");
	assertEqual(terminal.coreEvents, 10, "resident terminal Core event count");
	assertEqual(terminal.resourceEvents, 10, "resident terminal resource event count");
	assertEqual(terminal.terminal, "true", "resident terminal publication trigger");
	const events = activePage.getByTestId("simulation-resident-runtime-events");
	assertEqual(
		Number(await events.getAttribute("data-core-event-count")),
		terminal.coreEvents,
		"resident terminal Core event-tail total",
	);
	assertEqual(
		await events.getAttribute("data-core-events-truncated"),
		"true",
		"resident Core truncation disclosure",
	);
	assertEqual(
		Number(await events.getAttribute("data-resource-event-count")),
		terminal.resourceEvents,
		"resident terminal resource event-tail total",
	);
	assertEqual(
		await events.getAttribute("data-resource-events-truncated"),
		"true",
		"resident resource truncation disclosure",
	);
	assertEqual(await events.getByRole("listitem").count(), 16, "resident two-stream tail row cap");
	const text = await events.innerText();
	for (const fact of [
		"VEHICLE RETURNED HOME",
		"CYCLE ADMITTED",
		"STORAGE SOURCE RELEASED",
		"STORAGE SERVICE READY",
	]) {
		if (!text.includes(fact)) throw new Error(`Resident event tail is missing ${fact}: ${text}`);
	}
	return terminal;
}

async function stopAndProveResidentClear(activePage) {
	const card = activePage.getByTestId("simulation-resident-scenario-active-run");
	await card.getByRole("button", { name: "STOP & DISCARD", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "stopped", 10_000);
	assertEqual(
		await activePage.getByTestId("simulation-resident-runtime-kpis").count(),
		0,
		"stopped resident KPI clear",
	);
	assertEqual(
		await activePage.getByTestId("simulation-resident-runtime-events").count(),
		0,
		"stopped resident event clear",
	);
	await activePage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.simulationRuntimeSequence === "0" &&
				canvas.dataset.simulationRuntimePoseFingerprint === "" &&
				canvas.dataset.simulationRuntimePoses === "0" &&
				canvas.dataset.simulationRuntimeVisiblePoses === "0"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	return read2DRuntime(activePage);
}

async function clearResidentScenarioSource(activePage, expectedSourceKind) {
	const card = activePage.getByTestId("simulation-resident-scenario-source-review");
	assertEqual(
		await card.getAttribute("data-source-kind"),
		expectedSourceKind,
		`${expectedSourceKind} resident source before clear`,
	);
	await card.getByRole("button", { name: "CLEAR", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-source-review", "empty", 10_000);
	assertEqual(
		await card.getAttribute("data-source-kind"),
		"NONE",
		`${expectedSourceKind} resident source clear`,
	);
	return { previousSourceKind: expectedSourceKind, phase: "empty", sourceKind: "NONE" };
}

async function proveResidentAuthoredMutationLifecycle(activePage, ports) {
	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	await reviewAndPrepareResidentScenario(activePage, residentPlanPath, "TRANSFER_PLAN");
	await rm(residentPlanPath, { force: true });
	await authorizeResidentRuntime(activePage);
	const moving = await startAndPauseMovingResidentRuntime(activePage, ports);
	const activeRun = activePage.getByTestId("simulation-resident-scenario-active-run");
	await activeRun.getByRole("button", { name: "RESUME CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "running", 10_000);
	assertEqual(
		await activeRun.getAttribute("data-clock-phase"),
		"RUNNING",
		"resident clock running",
	);

	const before = await readMetrics(activePage);
	const beforeCertificate = await activePage
		.getByTestId("tilefab-app")
		.getAttribute("data-simulation-readiness-certificate");
	if (!beforeCertificate) throw new Error("Resident mutation fixture has no exact certificate.");

	const mutation = await commitVisibleOhbMutation(activePage, before);
	await ensureFabCheckOpen(activePage);
	const invalidated = await readResidentInvalidationFacts(activePage);
	assertEqual(invalidated.sessionPhase, "INVALIDATED", "resident session mutation invalidation");
	assertEqual(invalidated.ownerPhase, "STOPPED", "resident owner mutation invalidation");
	assertEqual(invalidated.sourcePhase, "invalidated", "resident retained source invalidation");
	assertEqual(invalidated.sourceKind, "TRANSFER_PLAN", "resident invalidated source kind");
	assertEqual(invalidated.authorizationPhase, "invalidated", "resident authority revocation");
	assertEqual(invalidated.activeRunPhase, "stopped", "resident active owner stop");
	assertEqual(invalidated.clockPhase, "STOPPED", "resident clock stop");
	assertEqual(invalidated.stopReason, "AUTHORED_MUTATION", "resident mutation stop reason");
	assertEqual(invalidated.residentKpis, 0, "resident mutation KPI clear");
	assertEqual(invalidated.residentEvents, 0, "resident mutation event clear");
	assertEqual(invalidated.currentSourcePhase, "empty", "current source remains unavailable");
	assertEqual(invalidated.currentStartDisabled, true, "current Start remains unavailable");
	assertEqual(invalidated.readinessPhase, "blocked", "mutation certificate invalidation");
	assertEqual(invalidated.operationalReady, "false", "mutation operational-review invalidation");
	assertEqual(invalidated.canvas.sequence, 0, "mutation Canvas sequence clear");
	assertEqual(invalidated.canvas.poseFingerprint, "", "mutation Canvas fingerprint clear");
	assertEqual(invalidated.canvas.poses, 0, "mutation Canvas pose clear");
	assertEqual(invalidated.canvas.visiblePoses, 0, "mutation visible Canvas pose clear");
	assertAtMost(mutation.invalidationMilliseconds, 2_000, "visible mutation invalidation latency");
	await proveClearedResidentDerived3D(activePage);

	const undone = await undoVisibleOhbMutation(activePage, before, mutation.metrics);
	assertEqual(undone.operationalReady, "true", "Undo restores exact operational review");
	await ensureFabCheckOpen(activePage);
	assertEqual(
		await activePage
			.getByTestId("simulation-resident-scenario-source-review")
			.getAttribute("data-phase"),
		"invalidated",
		"Undo does not revive resident source",
	);
	assertEqual(
		await activePage
			.getByTestId("simulation-resident-scenario-run-authorization")
			.getAttribute("data-phase"),
		"invalidated",
		"Undo does not revive resident authority",
	);

	const operationalReview = await confirmExactOperationalConfiguration(activePage, before);
	const recertified = await certifyExactProject(activePage);
	const afterCertificate = await activePage
		.getByTestId("tilefab-app")
		.getAttribute("data-simulation-readiness-certificate");
	if (!afterCertificate || afterCertificate === beforeCertificate) {
		throw new Error("Undo/review did not issue a new-generation readiness certificate.");
	}
	const staleSource = activePage.getByTestId("simulation-resident-scenario-source-review");
	assertEqual(await staleSource.getAttribute("data-phase"), "invalidated", "stale resident source");
	assertEqual(
		await staleSource.getByRole("button", { name: "PREPARE RESIDENT", exact: true }).isDisabled(),
		true,
		"stale resident source cannot prepare after recertification",
	);
	assertEqual(
		await activePage
			.getByTestId("simulation-scenario-active-run")
			.getByRole("button", { name: "START SAFE RUNTIME", exact: true })
			.isDisabled(),
		true,
		"current Start remains unavailable after recertification",
	);

	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	const freshPrepared = await reviewAndPrepareResidentScenario(
		activePage,
		residentPlanPath,
		"TRANSFER_PLAN",
	);
	await rm(residentPlanPath, { force: true });
	const freshSourceCleared = await clearResidentScenarioSource(activePage, "TRANSFER_PLAN");

	return {
		movingSequence: moving.sequence,
		invalidationMilliseconds: mutation.invalidationMilliseconds,
		mutationWorld: mutation.world,
		generation: {
			before: Number(before.modelGeneration),
			mutated: Number(mutation.metrics.modelGeneration),
			undone: Number(undone.modelGeneration),
		},
		equipment: {
			portsBefore: Number(before.equipmentPorts),
			portsMutated: Number(mutation.metrics.equipmentPorts),
			portsUndone: Number(undone.equipmentPorts),
		},
		certificateRotated: true,
		operationalReview,
		recertified,
		freshPrepared,
		freshSourceCleared,
	};
}

async function proveResidentOperationalHomeMutationLifecycle(activePage, ports) {
	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	await reviewAndPrepareResidentScenario(activePage, residentPlanPath, "TRANSFER_PLAN");
	await rm(residentPlanPath, { force: true });
	await authorizeResidentRuntime(activePage);
	const moving = await startAndPauseMovingResidentRuntime(activePage, ports);
	const activeRun = activePage.getByTestId("simulation-resident-scenario-active-run");
	await activeRun.getByRole("button", { name: "RESUME CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "running", 10_000);
	assertEqual(
		await activeRun.getAttribute("data-clock-phase"),
		"RUNNING",
		"resident operational-home mutation clock running",
	);

	const before = await readMetrics(activePage);
	const beforeCertificate = await activePage
		.getByTestId("tilefab-app")
		.getAttribute("data-simulation-readiness-certificate");
	if (!beforeCertificate) {
		throw new Error("Resident operational-home mutation fixture has no exact certificate.");
	}

	const removal = await removeExplicitResidentHomeThroughOperationalUi(activePage, ports, before);
	const invalidated = await readResidentInvalidationFacts(activePage);
	assertEqual(
		invalidated.sessionPhase,
		"INVALIDATED",
		"resident home removal session invalidation",
	);
	assertEqual(invalidated.ownerPhase, "STOPPED", "resident home removal owner invalidation");
	assertEqual(invalidated.sourcePhase, "invalidated", "resident home removal retained source");
	assertEqual(invalidated.sourceKind, "TRANSFER_PLAN", "resident home removal source kind");
	assertEqual(
		invalidated.authorizationPhase,
		"invalidated",
		"resident home removal authority revocation",
	);
	assertEqual(invalidated.activeRunPhase, "stopped", "resident home removal active owner stop");
	assertEqual(invalidated.clockPhase, "STOPPED", "resident home removal clock stop");
	assertEqual(invalidated.stopReason, "AUTHORED_MUTATION", "resident home removal stop reason");
	assertEqual(invalidated.residentKpis, 0, "resident home removal KPI clear");
	assertEqual(invalidated.residentEvents, 0, "resident home removal event clear");
	assertEqual(invalidated.currentSourcePhase, "empty", "resident home removal current isolation");
	assertEqual(invalidated.currentStartDisabled, true, "resident home removal current Start lock");
	assertEqual(invalidated.readinessPhase, "blocked", "resident home removal certificate block");
	assertEqual(invalidated.operationalReady, "false", "resident home removal review block");
	assertEqual(invalidated.canvas.sequence, 0, "resident home removal Canvas sequence clear");
	assertEqual(
		invalidated.canvas.poseFingerprint,
		"",
		"resident home removal Canvas fingerprint clear",
	);
	assertEqual(invalidated.canvas.poses, 0, "resident home removal Canvas pose clear");
	assertEqual(
		invalidated.canvas.visiblePoses,
		0,
		"resident home removal visible Canvas pose clear",
	);
	assertAtMost(removal.invalidationMilliseconds, 2_000, "resident home removal latency");
	await proveClearedResidentDerived3D(activePage);

	const removedOperationalReview = await confirmExactOperationalConfiguration(
		activePage,
		removal.metrics,
	);
	const removedRecertified = await certifyExactProject(activePage);
	const removedCertificate = await activePage
		.getByTestId("tilefab-app")
		.getAttribute("data-simulation-readiness-certificate");
	if (!removedCertificate || removedCertificate === beforeCertificate) {
		throw new Error("Removing the explicit BETA home did not rotate readiness certification.");
	}
	const retainedSource = activePage.getByTestId("simulation-resident-scenario-source-review");
	assertEqual(
		await retainedSource.getAttribute("data-phase"),
		"invalidated",
		"resident removed-home retained source stays invalidated",
	);
	assertEqual(
		await retainedSource
			.getByRole("button", { name: "PREPARE RESIDENT", exact: true })
			.isDisabled(),
		true,
		"resident removed-home retained source cannot prepare",
	);

	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	const mismatchedReview = await reviewResidentPlanWithMissingExplicitHome(
		activePage,
		residentPlanPath,
		ports.residentFleet,
	);
	await rm(residentPlanPath, { force: true });
	const mismatchedSourceCleared = await clearResidentScenarioSource(activePage, "TRANSFER_PLAN");

	const reviewUndoBefore = await readMetrics(activePage);
	await activePage.getByRole("button", { name: "실행 취소", exact: true }).click();
	const reviewUndone = await waitForWorker(
		activePage,
		(candidate) =>
			candidate.operationalRevision === removal.metrics.operationalRevision &&
			candidate.operationalReady === "false" &&
			Number(candidate.modelGeneration) > Number(reviewUndoBefore.modelGeneration),
		{ timeout: 30_000 },
	);
	await activePage.getByRole("button", { name: "실행 취소", exact: true }).click();
	const restored = await waitForWorker(
		activePage,
		(candidate) =>
			Number(candidate.operationalRevision) === Number(removal.metrics.operationalRevision) + 1 &&
			candidate.operationalReady === "false" &&
			Number(candidate.modelGeneration) > Number(reviewUndone.modelGeneration),
		{ timeout: 30_000 },
	);
	const restoredAssignments = await inspectExactResidentHomeAssignments(activePage, ports);
	const restoredOperationalReview = await confirmExactOperationalConfiguration(
		activePage,
		restored,
	);
	const restoredRecertified = await certifyExactProject(activePage);
	const restoredCertificate = await activePage
		.getByTestId("tilefab-app")
		.getAttribute("data-simulation-readiness-certificate");
	if (
		!restoredCertificate ||
		restoredCertificate === beforeCertificate ||
		restoredCertificate === removedCertificate
	) {
		throw new Error("Restoring both exact homes did not issue a fresh-generation certificate.");
	}

	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	const freshPrepared = await reviewAndPrepareResidentScenario(
		activePage,
		residentPlanPath,
		"TRANSFER_PLAN",
	);
	await rm(residentPlanPath, { force: true });
	const freshSourceCleared = await clearResidentScenarioSource(activePage, "TRANSFER_PLAN");

	return {
		movingSequence: moving.sequence,
		removedVehicleId: ports.residentFleet.beta.vehicleId,
		removedHomePortId: ports.residentFleet.beta.homePort.id,
		removedSlotId: removal.slotId,
		invalidationMilliseconds: removal.invalidationMilliseconds,
		revision: {
			before: Number(before.operationalRevision),
			removed: Number(removal.metrics.operationalRevision),
			restored: Number(restored.operationalRevision),
		},
		generation: {
			before: Number(before.modelGeneration),
			removed: Number(removal.metrics.modelGeneration),
			reviewUndone: Number(reviewUndone.modelGeneration),
			restored: Number(restored.modelGeneration),
		},
		removedOperationalReview,
		removedRecertified,
		mismatchedReview,
		mismatchedSourceCleared,
		restoredAssignments,
		restoredOperationalReview,
		restoredRecertified,
		freshPrepared,
		freshSourceCleared,
	};
}

async function removeExplicitResidentHomeThroughOperationalUi(activePage, ports, before) {
	await ensureFabCheckOpen(activePage);
	const launch = activePage.locator(".tilefab-operational-launch");
	await launch.waitFor({ state: "visible" });
	assertEqual(await launch.isEnabled(), true, "resident home mutation operational launch");
	await launch.click();
	let panel = activePage.getByTestId("operational-configuration-panel");
	await panel.waitFor({ state: "visible" });
	await panel.locator(".tilefab-operational-tabs button").nth(4).click();
	const residentSection = panel.getByRole("region", {
		name: "Resident fleet home slots",
		exact: true,
	});
	const slotId = await residentSlotIdForVehicle(
		residentSection,
		ports.residentFleet.beta.vehicleId,
	);
	assertEqual(
		await residentSection.getByLabel(`Resident slot ${slotId} home port`).inputValue(),
		String(ports.residentFleet.beta.homePort.id),
		"explicit BETA home before removal",
	);
	await residentSection
		.getByRole("button", { name: `Remove resident home slot ${slotId}`, exact: true })
		.click();
	const remainingVehicleIds = await residentVehicleIds(residentSection);
	assertEqual(remainingVehicleIds.length, 1, "resident home draft slot count after removal");
	assertEqual(
		remainingVehicleIds[0],
		ports.residentFleet.alpha.vehicleId,
		"resident home draft retains exact ALPHA",
	);

	const releasedAt = performance.now();
	await panel.getByRole("button", { name: "APPLY DRAFT", exact: true }).click();
	await activePage.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.getAttribute("data-resident-scenario-session-phase") === "INVALIDATED" &&
				app.getAttribute("data-resident-scenario-owner-phase") === "STOPPED" &&
				canvas?.dataset.simulationRuntimeSequence === "0" &&
				canvas.dataset.simulationRuntimePoses === "0"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const invalidationMilliseconds = performance.now() - releasedAt;
	const metrics = await waitForWorker(
		activePage,
		(candidate) =>
			Number(candidate.operationalRevision) === Number(before.operationalRevision) + 1 &&
			Number(candidate.modelGeneration) > Number(before.modelGeneration) &&
			candidate.authoredCells === before.authoredCells &&
			candidate.physicalPaths === before.physicalPaths &&
			candidate.equipmentPorts === before.equipmentPorts &&
			candidate.equipmentGroups === before.equipmentGroups,
		{ timeout: 30_000 },
	);
	panel = activePage.getByTestId("operational-configuration-panel");
	await panel.getByRole("button", { name: "운영 설정 닫기", exact: true }).click();
	return { slotId, invalidationMilliseconds, metrics };
}

async function reviewResidentPlanWithMissingExplicitHome(activePage, filePath, residentFleet) {
	await ensureFabCheckOpen(activePage);
	const card = activePage.getByTestId("simulation-resident-scenario-source-review");
	const button = card.getByRole("button", { name: "LOAD RESIDENT PLAN", exact: true });
	await button.scrollIntoViewIfNeeded();
	assertEqual(await button.isEnabled(), true, "removed-home resident source chooser enabled");
	const [chooser] = await Promise.all([activePage.waitForEvent("filechooser"), button.click()]);
	await chooser.setFiles(filePath);
	await waitForPhase(activePage, "simulation-resident-scenario-source-review", "reviewed", 15_000);
	assertEqual(
		await card.getAttribute("data-source-kind"),
		"TRANSFER_PLAN",
		"removed-home resident review kind",
	);
	const records = card.getByRole("region", {
		name: "Bounded accepted resident scenario records",
		exact: true,
	});
	assertEqual(
		Number(await records.getAttribute("data-record-count")),
		1,
		"removed-home accepted resident record count",
	);
	assertEqual(
		Number(await records.getAttribute("data-preview-count")),
		1,
		"removed-home accepted resident preview count",
	);
	const acceptedText = await records.innerText();
	if (!acceptedText.includes(residentFleet.alpha.vehicleId)) {
		throw new Error(`Removed-home review lost the exact ALPHA record: ${acceptedText}`);
	}
	if (acceptedText.includes(residentFleet.beta.vehicleId)) {
		throw new Error(`Removed-home review incorrectly accepted BETA: ${acceptedText}`);
	}
	const issues = card.getByRole("list", {
		name: "Bounded resident scenario rejection issues",
		exact: true,
	});
	const issueText = await issues.innerText();
	if (!issueText.includes("#1 · UNKNOWN_VEHICLE")) {
		throw new Error(`Removed-home BETA rejection is missing: ${issueText}`);
	}
	return {
		sourceKind: "TRANSFER_PLAN",
		acceptedRecordCount: 1,
		rejectedRecordCount: 1,
		acceptedVehicleId: residentFleet.alpha.vehicleId,
		rejectedVehicleId: residentFleet.beta.vehicleId,
		issueCode: "UNKNOWN_VEHICLE",
	};
}

async function inspectExactResidentHomeAssignments(activePage, ports) {
	await ensureFabCheckOpen(activePage);
	const launch = activePage.locator(".tilefab-operational-launch");
	await launch.waitFor({ state: "visible" });
	assertEqual(await launch.isEnabled(), true, "restored resident homes operational launch");
	await launch.click();
	let panel = activePage.getByTestId("operational-configuration-panel");
	await panel.waitFor({ state: "visible" });
	await panel.locator(".tilefab-operational-tabs button").nth(4).click();
	const residentSection = panel.getByRole("region", {
		name: "Resident fleet home slots",
		exact: true,
	});
	const vehicleIds = await residentVehicleIds(residentSection);
	assertEqual(vehicleIds.length, 2, "restored resident home slot count");
	const assignments = [];
	for (const resident of [ports.residentFleet.alpha, ports.residentFleet.beta]) {
		const slotId = await residentSlotIdForVehicle(residentSection, resident.vehicleId);
		const homePortId = Number(
			await residentSection.getByLabel(`Resident slot ${slotId} home port`).inputValue(),
		);
		assertEqual(homePortId, resident.homePort.id, `restored ${resident.vehicleId} exact home`);
		assignments.push({ slotId, vehicleId: resident.vehicleId, homePortId });
	}
	panel = activePage.getByTestId("operational-configuration-panel");
	await panel.getByRole("button", { name: "운영 설정 닫기", exact: true }).click();
	return { slotCount: 2, assignments };
}

async function residentSlotIdForVehicle(residentSection, vehicleId) {
	const matches = await residentSection
		.locator('input[aria-label^="Resident slot "][aria-label$=" vehicle ID"]')
		.evaluateAll(
			(inputs, expectedVehicleId) =>
				inputs
					.filter((input) => input.value === expectedVehicleId)
					.map((input) => {
						const match = input
							.getAttribute("aria-label")
							?.match(/^Resident slot (\d+) vehicle ID$/);
						return match ? Number(match[1]) : null;
					})
					.filter((slotId) => slotId !== null),
			vehicleId,
		);
	assertEqual(matches.length, 1, `explicit resident slot identity for ${vehicleId}`);
	return matches[0];
}

async function residentVehicleIds(residentSection) {
	return residentSection
		.locator('input[aria-label^="Resident slot "][aria-label$=" vehicle ID"]')
		.evaluateAll((inputs) => inputs.map((input) => input.value));
}

async function proveResidentNativeProjectReplacementLifecycle(activePage, ports) {
	const savedResidentProject = await savePublicOpenFabProject(activePage, "resident project");
	assertSavedResidentHomeAssignments(savedResidentProject, ports.residentFleet);
	assertEqual(savedResidentProject.metrics.projectDirty, "false", "saved resident project clean");
	assertEqual(
		savedResidentProject.residentHomeSlots.length,
		2,
		"saved resident project home count",
	);

	const replacementCreated = await createParallelHallProject(activePage);
	if (replacementCreated.projectId === savedResidentProject.manifestId) {
		throw new Error("Replacement project reused the resident project manifest identity.");
	}
	const savedReplacementProject = await savePublicOpenFabProject(activePage, "replacement project");
	assertEqual(
		savedReplacementProject.residentHomeSlots.length,
		0,
		"replacement project resident home count",
	);
	assertEqual(
		savedReplacementProject.metrics.equipmentPorts,
		"0",
		"replacement project equipment ports",
	);

	const reopenedResidentProject = await openPublicOpenFabProject(
		activePage,
		savedResidentProject.filePath,
		(candidate) =>
			candidate.projectId === savedResidentProject.manifestId &&
			candidate.equipmentPorts === "7" &&
			candidate.equipmentGroups === "4" &&
			candidate.operationalReady === "true",
	);
	assertEqual(
		reopenedResidentProject.workerChecksum,
		savedResidentProject.metrics.workerChecksum,
		"resident project authored checksum round trip",
	);
	assertEqual(
		reopenedResidentProject.workerPhysicalFingerprint,
		savedResidentProject.metrics.workerPhysicalFingerprint,
		"resident project physical fingerprint round trip",
	);
	assertEqual(reopenedResidentProject.projectDirty, "false", "reopened resident project clean");
	const reopenedAssignments = await inspectExactResidentHomeAssignments(activePage, ports);
	const reopenedCertified = await certifyExactProject(activePage);
	const reopenedCertificate = await activePage
		.getByTestId("tilefab-app")
		.getAttribute("data-simulation-readiness-certificate");
	if (!reopenedCertificate) throw new Error("Reopened resident project was not certified.");

	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	await reviewAndPrepareResidentScenario(activePage, residentPlanPath, "TRANSFER_PLAN");
	await rm(residentPlanPath, { force: true });
	await authorizeResidentRuntime(activePage);
	const moving = await startAndPauseMovingResidentRuntime(activePage, ports);
	const moving3D = await proveResidentDerived3DParity(activePage, moving);
	await ensureFabCheckOpen(activePage);
	const activeRun = activePage.getByTestId("simulation-resident-scenario-active-run");
	await activeRun.getByRole("button", { name: "RESUME CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "running", 10_000);
	assertEqual(
		await activeRun.getAttribute("data-clock-phase"),
		"RUNNING",
		"resident project replacement clock running",
	);

	const beforeReplacement = await readMetrics(activePage);
	const replacementChooserPromise = activePage.waitForEvent("filechooser");
	await activePage.getByRole("button", { name: "프로젝트 열기", exact: true }).click();
	const replacementChooser = await replacementChooserPromise;
	const releasedAt = performance.now();
	await replacementChooser.setFiles(savedReplacementProject.filePath);
	await activePage.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.getAttribute("data-resident-scenario-session-phase") === "INVALIDATED" &&
				app.getAttribute("data-resident-scenario-owner-phase") === "STOPPED" &&
				canvas?.dataset.simulationRuntimeSequence === "0" &&
				canvas.dataset.simulationRuntimePoses === "0"
			);
		},
		undefined,
		{ timeout: 30_000 },
	);
	const invalidationMilliseconds = performance.now() - releasedAt;
	const replacementLoaded = await waitForWorker(
		activePage,
		(candidate) =>
			candidate.projectId === savedReplacementProject.manifestId &&
			candidate.equipmentPorts === "0" &&
			candidate.equipmentGroups === "0" &&
			candidate.operationalReady === "false" &&
			Number(candidate.modelGeneration) > Number(beforeReplacement.modelGeneration),
		{ timeout: 30_000 },
	);
	await waitForProjectOperation(activePage, "idle");
	await ensureFabCheckOpen(activePage);
	const invalidated = await readResidentInvalidationFacts(activePage);
	assertEqual(
		invalidated.sessionPhase,
		"INVALIDATED",
		"resident project replacement session invalidation",
	);
	assertEqual(invalidated.ownerPhase, "STOPPED", "resident project replacement owner stop");
	assertEqual(invalidated.sourcePhase, "empty", "resident project replacement source clear");
	assertEqual(invalidated.sourceKind, "NONE", "resident project replacement source kind clear");
	assertEqual(
		invalidated.authorizationPhase,
		"invalidated",
		"resident project replacement authority revocation",
	);
	assertEqual(invalidated.activeRunPhase, "stopped", "resident project replacement active stop");
	assertEqual(invalidated.clockPhase, "STOPPED", "resident project replacement clock stop");
	assertEqual(
		invalidated.stopReason,
		"PROJECT_REPLACEMENT",
		"resident project replacement stop reason",
	);
	assertEqual(invalidated.residentKpis, 0, "resident project replacement KPI clear");
	assertEqual(invalidated.residentEvents, 0, "resident project replacement event clear");
	assertEqual(invalidated.currentSourcePhase, "empty", "replacement current source isolation");
	assertEqual(invalidated.currentStartDisabled, true, "replacement current Start lock");
	assertEqual(invalidated.readinessPhase, "blocked", "replacement readiness block");
	assertEqual(invalidated.operationalReady, "false", "replacement operational block");
	assertEqual(invalidated.canvas.sequence, 0, "project replacement Canvas sequence clear");
	assertEqual(
		invalidated.canvas.poseFingerprint,
		"",
		"project replacement Canvas fingerprint clear",
	);
	assertEqual(invalidated.canvas.poses, 0, "project replacement Canvas pose clear");
	assertEqual(invalidated.canvas.visiblePoses, 0, "project replacement visible Canvas pose clear");
	assertAtMost(invalidationMilliseconds, 5_000, "resident project replacement invalidation");
	await proveClearedResidentDerived3D(activePage);

	const restoredResidentProject = await openPublicOpenFabProject(
		activePage,
		savedResidentProject.filePath,
		(candidate) =>
			candidate.projectId === savedResidentProject.manifestId &&
			candidate.equipmentPorts === "7" &&
			candidate.equipmentGroups === "4" &&
			candidate.operationalReady === "true",
	);
	assertEqual(
		restoredResidentProject.workerChecksum,
		savedResidentProject.metrics.workerChecksum,
		"restored resident project authored checksum",
	);
	assertEqual(
		restoredResidentProject.workerPhysicalFingerprint,
		savedResidentProject.metrics.workerPhysicalFingerprint,
		"restored resident project physical fingerprint",
	);
	const restoredAssignments = await inspectExactResidentHomeAssignments(activePage, ports);
	const restoredCertified = await certifyExactProject(activePage);
	const restoredCertificate = await activePage
		.getByTestId("tilefab-app")
		.getAttribute("data-simulation-readiness-certificate");
	if (!restoredCertificate) {
		throw new Error("Restored resident project did not issue an exact certificate.");
	}
	assertAtLeast(
		Number(restoredResidentProject.modelGeneration),
		Number(reopenedResidentProject.modelGeneration) + 1,
		"restored resident project fresh model generation",
	);
	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	const freshPrepared = await reviewAndPrepareResidentScenario(
		activePage,
		residentPlanPath,
		"TRANSFER_PLAN",
	);
	await rm(residentPlanPath, { force: true });
	const freshSourceCleared = await clearResidentScenarioSource(activePage, "TRANSFER_PLAN");

	return {
		savedResidentProjectId: savedResidentProject.manifestId,
		savedReplacementProjectId: savedReplacementProject.manifestId,
		savedResidentBytes: savedResidentProject.serializedBytes,
		savedResidentSlotCount: savedResidentProject.residentHomeSlots.length,
		replacementResidentSlotCount: savedReplacementProject.residentHomeSlots.length,
		restoredResidentSlotCount: restoredAssignments.slotCount,
		reopenedAssignments,
		restoredAssignments,
		reopenedCertified,
		restoredCertified,
		certificateContentDeterministic: restoredCertificate === reopenedCertificate,
		movingSequence: moving.sequence,
		moving3DSequence: moving3D.sequence,
		invalidationMilliseconds,
		generation: {
			before: Number(beforeReplacement.modelGeneration),
			replacement: Number(replacementLoaded.modelGeneration),
			restored: Number(restoredResidentProject.modelGeneration),
		},
		freshPrepared,
		freshSourceCleared,
	};
}

async function proveResidentActiveSourceSwitchLifecycle(activePage, ports) {
	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	await reviewAndPrepareResidentScenario(activePage, residentPlanPath, "TRANSFER_PLAN");
	await rm(residentPlanPath, { force: true });
	await authorizeResidentRuntime(activePage);
	const moving = await startAndPauseMovingResidentRuntime(activePage, ports);
	const activeRun = activePage.getByTestId("simulation-resident-scenario-active-run");
	await activeRun.getByRole("button", { name: "RESUME CLOCK", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-active-run", "running", 10_000);
	assertEqual(
		await activeRun.getAttribute("data-clock-phase"),
		"RUNNING",
		"resident source switch Plan clock running",
	);

	await writeFile(
		residentReplayPath,
		`${JSON.stringify(publicResidentReplayHistory(ports), null, 2)}\n`,
		"utf8",
	);
	const sourceCard = activePage.getByTestId("simulation-resident-scenario-source-review");
	const replayButton = sourceCard.getByRole("button", {
		name: "LOAD RESIDENT REPLAY",
		exact: true,
	});
	assertEqual(await replayButton.isEnabled(), true, "active Plan Replay chooser enabled");
	const chooserPromise = activePage.waitForEvent("filechooser");
	await replayButton.click();
	const chooser = await chooserPromise;
	const releasedAt = performance.now();
	await chooser.setFiles(residentReplayPath);
	await activePage.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const source = document.querySelector(
				'[data-testid="simulation-resident-scenario-source-review"]',
			);
			return (
				app?.getAttribute("data-resident-scenario-session-phase") === "INVALIDATED" &&
				app.getAttribute("data-resident-scenario-owner-phase") === "STOPPED" &&
				source?.getAttribute("data-phase") === "reviewed" &&
				source.getAttribute("data-source-kind") === "REPLAY_HISTORY" &&
				canvas?.dataset.simulationRuntimeSequence === "0" &&
				canvas.dataset.simulationRuntimePoses === "0"
			);
		},
		undefined,
		{ timeout: 15_000 },
	);
	const invalidationMilliseconds = performance.now() - releasedAt;
	await rm(residentReplayPath, { force: true });
	const invalidated = await readResidentInvalidationFacts(activePage);
	assertEqual(invalidated.sessionPhase, "INVALIDATED", "resident source switch session");
	assertEqual(invalidated.ownerPhase, "STOPPED", "resident source switch owner stop");
	assertEqual(invalidated.sourcePhase, "reviewed", "resident Replay local review phase");
	assertEqual(invalidated.sourceKind, "REPLAY_HISTORY", "resident Replay local review kind");
	assertEqual(invalidated.authorizationPhase, "invalidated", "resident source switch authority");
	assertEqual(invalidated.activeRunPhase, "stopped", "resident source switch active stop");
	assertEqual(invalidated.clockPhase, "STOPPED", "resident source switch clock stop");
	assertEqual(invalidated.stopReason, "SOURCE_SWITCH", "resident source switch stop reason");
	assertEqual(invalidated.residentKpis, 0, "resident source switch KPI clear");
	assertEqual(invalidated.residentEvents, 0, "resident source switch event clear");
	assertEqual(invalidated.currentSourcePhase, "empty", "source switch current source isolation");
	assertEqual(invalidated.currentStartDisabled, true, "source switch current Start lock");
	assertEqual(invalidated.readinessPhase, "ready", "source switch preserves exact certificate");
	assertEqual(invalidated.operationalReady, "true", "source switch preserves operational review");
	assertEqual(invalidated.canvas.sequence, 0, "source switch Canvas sequence clear");
	assertEqual(invalidated.canvas.poseFingerprint, "", "source switch Canvas fingerprint clear");
	assertEqual(invalidated.canvas.poses, 0, "source switch Canvas pose clear");
	assertEqual(invalidated.canvas.visiblePoses, 0, "source switch visible Canvas pose clear");
	assertAtMost(invalidationMilliseconds, 2_000, "resident source switch invalidation latency");

	const records = sourceCard.getByRole("region", {
		name: "Bounded accepted resident scenario records",
		exact: true,
	});
	assertEqual(Number(await records.getAttribute("data-record-count")), 2, "Replay review records");
	assertEqual(Number(await records.getAttribute("data-preview-count")), 2, "Replay preview rows");
	const reviewText = await records.innerText();
	for (const identity of [
		"PUBLIC-RESIDENT-OHT-ALPHA",
		"PUBLIC-RESIDENT-OHT-BETA",
		"PUBLIC-RESIDENT-LOAD-ALPHA",
		"PUBLIC-RESIDENT-LOAD-BETA",
	]) {
		if (!reviewText.includes(identity)) {
			throw new Error(`Replay source-switch review is missing ${identity}: ${reviewText}`);
		}
	}
	assertEqual(
		await sourceCard.getByRole("button", { name: "PREPARE RESIDENT", exact: true }).isEnabled(),
		true,
		"Replay review requires explicit preparation",
	);
	await sourceCard.getByRole("button", { name: "PREPARE RESIDENT", exact: true }).click();
	await waitForPhase(activePage, "simulation-resident-scenario-source-review", "prepared", 30_000);
	await proveClearedResidentDerived3D(activePage);
	await ensureFabCheckOpen(activePage);
	const authorization = activePage.getByTestId("simulation-resident-scenario-run-authorization");
	assertEqual(
		await authorization.getAttribute("data-phase"),
		"prepared",
		"Replay source switch requires one-shot authorization",
	);
	assertEqual(
		await activePage
			.getByTestId("simulation-resident-scenario-active-run")
			.getByRole("button", { name: "START RESIDENT RUNTIME", exact: true })
			.isDisabled(),
		true,
		"Replay source switch Start locked before authorization",
	);
	const replaySourceCleared = await clearResidentScenarioSource(activePage, "REPLAY_HISTORY");

	return {
		movingSequence: moving.sequence,
		invalidationMilliseconds,
		stopReason: "SOURCE_SWITCH",
		localReview: {
			sourceKind: "REPLAY_HISTORY",
			recordCount: 2,
			previewCount: 2,
		},
		preparedWithoutAuthorization: true,
		replaySourceCleared,
	};
}

async function proveCurrentSourceReviewIsolationDuringResidentRun(activePage, ports) {
	await writeFile(
		residentPlanPath,
		`${JSON.stringify(publicResidentTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	await reviewAndPrepareResidentScenario(activePage, residentPlanPath, "TRANSFER_PLAN");
	await rm(residentPlanPath, { force: true });
	await authorizeResidentRuntime(activePage);
	const moving = await startAndPauseMovingResidentRuntime(activePage, ports);
	assertAtLeast(
		moving.contention.nonHomeTrackOwned,
		1,
		"current source isolation resident contention ownership",
	);
	const baseline3D = await proveResidentDerived3DParity(activePage, moving);
	await ensureFabCheckOpen(activePage);
	const baseline = await readResidentIsolationSnapshot(activePage);
	assertEqual(baseline.runPhase, "paused", "current source isolation resident run phase");
	assertEqual(baseline.clockPhase, "PAUSED", "current source isolation resident clock phase");
	assertEqual(baseline.ownerPhase, "ACTIVE", "current source isolation resident owner phase");
	assertEqual(
		await activePage.getByTestId("simulation-scenario-source-review").getAttribute("data-phase"),
		"empty",
		"current source isolation initial source",
	);

	await writeFile(
		transferPlanPath,
		`${JSON.stringify(publicTransferPlan(ports), null, 2)}\n`,
		"utf8",
	);
	const currentSource = activePage.getByTestId("simulation-scenario-source-review");
	const loadPlan = currentSource.getByRole("button", {
		name: "LOAD TRANSFER PLAN",
		exact: true,
	});
	assertEqual(await loadPlan.isEnabled(), true, "resident-owned current Plan chooser enabled");
	const [chooser] = await Promise.all([activePage.waitForEvent("filechooser"), loadPlan.click()]);
	await chooser.setFiles(transferPlanPath);
	await waitForPhase(activePage, "simulation-scenario-source-review", "reviewed", 10_000);
	await rm(transferPlanPath, { force: true });
	assertEqual(
		await currentSource.getAttribute("data-source-kind"),
		"TRANSFER_PLAN",
		"resident-owned current Plan review kind",
	);
	const records = currentSource.getByRole("region", {
		name: "Accepted scenario records",
		exact: true,
	});
	assertEqual(
		Number(await records.getAttribute("data-record-count")),
		4,
		"resident-owned current Plan review count",
	);
	assertResidentIsolationSnapshot(
		await readResidentIsolationSnapshot(activePage),
		baseline,
		"current Plan local review",
	);

	const currentAuthorization = activePage.getByTestId("simulation-scenario-run-authorization");
	const currentRun = activePage.getByTestId("simulation-scenario-active-run");
	assertEqual(
		await currentAuthorization.getAttribute("data-phase"),
		"invalidated",
		"current authorization retains revoked state before preparation",
	);
	assertEqual(
		await currentAuthorization
			.getByRole("button", { name: "AUTHORIZE LIMITED RUN", exact: true })
			.isDisabled(),
		true,
		"current authorization remains unavailable before preparation",
	);
	assertEqual(
		await currentRun.getAttribute("data-phase"),
		"stopped",
		"current run owner preserves explicit stopped state",
	);
	assertEqual(
		await currentRun.getAttribute("data-source-kind"),
		"NONE",
		"current run owns no concurrent source",
	);
	const currentStart = currentRun.getByRole("button", {
		name: "START SAFE RUNTIME",
		exact: true,
	});
	assertEqual(await currentStart.isDisabled(), true, "current Start locked during local review");

	await currentSource.getByRole("button", { name: "PREPARE", exact: true }).click();
	await waitForPhase(activePage, "simulation-scenario-source-review", "prepared", 30_000);
	await waitForPhase(activePage, "simulation-scenario-run-authorization", "prepared", 10_000);
	assertEqual(
		await currentStart.isDisabled(),
		true,
		"current Start locked after isolated preparation",
	);
	assertResidentIsolationSnapshot(
		await readResidentIsolationSnapshot(activePage),
		baseline,
		"current Plan preparation",
	);

	const authorize = currentAuthorization.getByRole("button", {
		name: "AUTHORIZE LIMITED RUN",
		exact: true,
	});
	assertEqual(
		await authorize.isEnabled(),
		true,
		"current one-shot authorization remains local while resident owns runtime",
	);
	await authorize.click();
	await waitForPhase(activePage, "simulation-scenario-run-authorization", "authorized", 10_000);
	assertEqual(
		await currentRun.getAttribute("data-phase"),
		"stopped",
		"authorized current run remains stopped",
	);
	assertEqual(await currentStart.isDisabled(), true, "authorized current Start remains disabled");
	assertResidentIsolationSnapshot(
		await readResidentIsolationSnapshot(activePage),
		baseline,
		"current Plan one-shot authorization",
	);

	await currentStart.evaluate((button) => button.click());
	await activePage.waitForTimeout(100);
	assertEqual(await currentRun.getAttribute("data-phase"), "stopped", "forced current Start no-op");
	assertEqual(
		await currentRun.getAttribute("data-source-kind"),
		"NONE",
		"forced current Start acquires no source",
	);
	assertResidentIsolationSnapshot(
		await readResidentIsolationSnapshot(activePage),
		baseline,
		"blocked current Start",
	);

	const currentSourceCleared = await clearScenarioSource(activePage, "TRANSFER_PLAN");
	await waitForPhase(activePage, "simulation-scenario-run-authorization", "invalidated", 10_000);
	const cleared = await readResidentIsolationSnapshot(activePage);
	assertResidentIsolationSnapshot(cleared, baseline, "current source clear");
	const final3D = await proveResidentDerived3DParity(activePage, moving);
	for (const field of ["sequence", "poseFingerprint", "vehicles"]) {
		assertEqual(final3D[field], baseline3D[field], `current source isolation 3D ${field}`);
	}
	await ensureFabCheckOpen(activePage);
	const residentCleared = await stopAndProveResidentClear(activePage);
	const residentSourceCleared = await clearResidentScenarioSource(activePage, "TRANSFER_PLAN");

	return {
		sequence: baseline.canvas.sequence,
		poseFingerprint: baseline.canvas.poseFingerprint,
		currentPrepared: true,
		currentAuthorized: true,
		currentStartBlocked: true,
		currentSourceCleared,
		residentCleared,
		residentSourceCleared,
	};
}

async function readResidentIsolationSnapshot(activePage) {
	return activePage.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const source = document.querySelector(
			'[data-testid="simulation-resident-scenario-source-review"]',
		);
		const authorization = document.querySelector(
			'[data-testid="simulation-resident-scenario-run-authorization"]',
		);
		const run = document.querySelector('[data-testid="simulation-resident-scenario-active-run"]');
		const kpis = document.querySelector('[data-testid="simulation-resident-runtime-kpis"]');
		const events = document.querySelector('[data-testid="simulation-resident-runtime-events"]');
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const attribute = (element, name) => element?.getAttribute(name) ?? "";
		return {
			sessionPhase: attribute(app, "data-resident-scenario-session-phase"),
			ownerPhase: attribute(app, "data-resident-scenario-owner-phase"),
			sourcePhase: attribute(source, "data-phase"),
			sourceKind: attribute(source, "data-source-kind"),
			authorizationPhase: attribute(authorization, "data-phase"),
			runPhase: attribute(run, "data-phase"),
			clockPhase: attribute(run, "data-clock-phase"),
			outcome: {
				publicationSequence: attribute(kpis, "data-publication-sequence"),
				requestCompleted: attribute(kpis, "data-request-completed"),
				requestWaitingCycle: attribute(kpis, "data-request-waiting-cycle"),
				serviceReady: attribute(kpis, "data-service-ready"),
				serviceActive: attribute(kpis, "data-service-active"),
				vehicleIdle: attribute(kpis, "data-vehicle-idle"),
				vehicleWaitingCycle: attribute(kpis, "data-vehicle-waiting-cycle"),
				vehicleMoving: attribute(kpis, "data-vehicle-moving"),
				nonHomeTrackOwned: attribute(kpis, "data-non-home-track-owned"),
				switchConflictOwned: attribute(kpis, "data-switch-conflict-owned"),
				storageOccupied: attribute(kpis, "data-storage-occupied"),
				storageReserved: attribute(kpis, "data-storage-reserved"),
				coreEvents: attribute(kpis, "data-core-events"),
				resourceEvents: attribute(kpis, "data-resource-events"),
				terminal: attribute(kpis, "data-terminal"),
			},
			events: {
				coreCount: attribute(events, "data-core-event-count"),
				coreTruncated: attribute(events, "data-core-events-truncated"),
				resourceCount: attribute(events, "data-resource-event-count"),
				resourceTruncated: attribute(events, "data-resource-events-truncated"),
				text: events?.textContent ?? "",
			},
			canvas: {
				sequence: Number(canvas?.getAttribute("data-simulation-runtime-sequence") ?? 0),
				poseFingerprint: attribute(canvas, "data-simulation-runtime-pose-fingerprint"),
				poses: Number(canvas?.getAttribute("data-simulation-runtime-poses") ?? 0),
				visiblePoses: Number(canvas?.getAttribute("data-simulation-runtime-visible-poses") ?? 0),
			},
		};
	});
}

function assertResidentIsolationSnapshot(actual, expected, label) {
	assertEqual(JSON.stringify(actual), JSON.stringify(expected), `${label} resident isolation`);
}

async function savePublicOpenFabProject(activePage, label) {
	await waitForProjectOperation(activePage, "idle");
	const saveButton = activePage.getByRole("button", { name: "프로젝트 저장", exact: true });
	await saveButton.waitFor({ state: "visible" });
	assertEqual(await saveButton.isEnabled(), true, `${label} save enabled`);
	const downloadPromise = activePage.waitForEvent("download");
	await saveButton.click();
	const download = await downloadPromise;
	const filePath = await download.path();
	if (!filePath) throw new Error(`${label} download has no readable path.`);
	await waitForProjectOperation(activePage, "idle");
	const metrics = await readMetrics(activePage);
	const serialized = await readFile(filePath, "utf8");
	const project = JSON.parse(serialized);
	if (project?.kind !== "openfab/tilefab-project" || typeof project?.manifest?.id !== "string") {
		throw new Error(`${label} did not serialize a canonical OpenFab project.`);
	}
	if (!Array.isArray(project?.operations?.residentHomeSlots)) {
		throw new Error(`${label} serialized no resident home-slot array.`);
	}
	assertEqual(metrics.projectId, project.manifest.id, `${label} manifest binding`);
	assertEqual(metrics.projectDirty, "false", `${label} clean after save`);
	return {
		filePath,
		manifestId: project.manifest.id,
		serializedBytes: Buffer.byteLength(serialized),
		residentHomeSlots: project.operations.residentHomeSlots,
		metrics,
	};
}

async function openPublicOpenFabProject(activePage, filePath, predicate) {
	await waitForProjectOperation(activePage, "idle");
	const chooserPromise = activePage.waitForEvent("filechooser");
	await activePage.getByRole("button", { name: "프로젝트 열기", exact: true }).click();
	const discard = activePage.getByRole("button", { name: "저장하지 않고 계속", exact: true });
	if (await discard.isVisible().catch(() => false)) await discard.click();
	const chooser = await chooserPromise;
	await chooser.setFiles(filePath);
	const metrics = await waitForWorker(activePage, predicate, { timeout: 30_000 });
	await waitForProjectOperation(activePage, "idle");
	return metrics;
}

function assertSavedResidentHomeAssignments(savedProject, residentFleet) {
	for (const resident of [residentFleet.alpha, residentFleet.beta]) {
		const matches = savedProject.residentHomeSlots.filter(
			(slot) => slot.vehicleId === resident.vehicleId,
		);
		assertEqual(matches.length, 1, `saved exact home assignment for ${resident.vehicleId}`);
		assertEqual(
			matches[0].anchorPortId,
			resident.homePort.id,
			`saved stable home port for ${resident.vehicleId}`,
		);
	}
}

async function waitForProjectOperation(activePage, operation) {
	await activePage.waitForFunction(
		(expected) =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-project-operation") === expected,
		operation,
		{ timeout: 30_000 },
	);
}

async function commitVisibleOhbMutation(activePage, before) {
	const readinessToggle = activePage.getByTestId("rail-readiness-toggle");
	if ((await readinessToggle.getAttribute("aria-expanded")) === "true") {
		await readinessToggle.click();
	}
	await activePage.getByTestId("rail-canvas").press("Escape");
	await clickActivityCommand(activePage, "equip", "OHB 포트 배치");
	await activePage.waitForFunction(
		() =>
			Number(document.querySelector('[data-testid="rail-canvas"]')?.dataset.portSlotLegalCount) >
			1_000,
		undefined,
		{ timeout: 10_000 },
	);
	const candidates = await readLegalOhbCandidates(activePage);
	const world = candidates[Math.floor(candidates.length * 0.62)];
	if (!world) throw new Error("Visible mutation has no legal OHB target.");
	await centerWorld(activePage, world);
	const point = await screenPointForWorld(activePage, world);
	await activePage.mouse.move(point.x, point.y);
	await activePage.waitForFunction(
		() =>
			(document.querySelector('[data-testid="rail-canvas"]')?.dataset.hoverPortSlot ?? "") !== "",
		undefined,
		{ timeout: 5_000 },
	);
	const releasedAt = performance.now();
	await activePage.mouse.click(point.x, point.y);
	await activePage.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.getAttribute("data-resident-scenario-session-phase") === "INVALIDATED" &&
				app.getAttribute("data-resident-scenario-owner-phase") === "STOPPED" &&
				canvas?.dataset.simulationRuntimeSequence === "0" &&
				canvas.dataset.simulationRuntimePoses === "0"
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const invalidationMilliseconds = performance.now() - releasedAt;
	const metrics = await waitForWorker(
		activePage,
		(candidate) =>
			Number(candidate.modelGeneration) === Number(before.modelGeneration) + 1 &&
			Number(candidate.equipmentPorts) === Number(before.equipmentPorts) + 1 &&
			Number(candidate.equipmentGroups) === Number(before.equipmentGroups) + 1 &&
			candidate.authoredCells === before.authoredCells &&
			candidate.physicalPaths === before.physicalPaths,
		{ timeout: 30_000 },
	);
	return { world, invalidationMilliseconds, metrics };
}

async function readResidentInvalidationFacts(activePage) {
	const app = activePage.getByTestId("tilefab-app");
	const residentSource = activePage.getByTestId("simulation-resident-scenario-source-review");
	const residentAuthorization = activePage.getByTestId(
		"simulation-resident-scenario-run-authorization",
	);
	const residentRun = activePage.getByTestId("simulation-resident-scenario-active-run");
	const currentRun = activePage.getByTestId("simulation-scenario-active-run");
	return {
		sessionPhase: await app.getAttribute("data-resident-scenario-session-phase"),
		ownerPhase: await app.getAttribute("data-resident-scenario-owner-phase"),
		sourcePhase: await residentSource.getAttribute("data-phase"),
		sourceKind: await residentSource.getAttribute("data-source-kind"),
		authorizationPhase: await residentAuthorization.getAttribute("data-phase"),
		activeRunPhase: await residentRun.getAttribute("data-phase"),
		clockPhase: await residentRun.getAttribute("data-clock-phase"),
		stopReason: await residentRun.getAttribute("data-stop-reason"),
		residentKpis: await activePage.getByTestId("simulation-resident-runtime-kpis").count(),
		residentEvents: await activePage.getByTestId("simulation-resident-runtime-events").count(),
		currentSourcePhase: await activePage
			.getByTestId("simulation-scenario-source-review")
			.getAttribute("data-phase"),
		currentStartDisabled: await currentRun
			.getByRole("button", { name: "START SAFE RUNTIME", exact: true })
			.isDisabled(),
		readinessPhase: await activePage
			.getByTestId("simulation-readiness-certification")
			.getAttribute("data-phase"),
		operationalReady: await app.getAttribute("data-operational-configuration-ready"),
		canvas: await read2DRuntime(activePage),
	};
}

async function proveClearedResidentDerived3D(activePage) {
	await activePage.getByRole("button", { name: "3D 검사 뷰", exact: true }).click();
	const canvas = activePage.getByTestId("static-fab-inspection-3d-canvas");
	await canvas.waitFor({ state: "visible" });
	await activePage.waitForFunction(
		() => {
			const target = document.querySelector('[data-testid="static-fab-inspection-3d-canvas"]');
			return (
				target?.getAttribute("data-scene-runtime-sequence") === "0" &&
				target.getAttribute("data-scene-runtime-pose-fingerprint") === "" &&
				target.getAttribute("data-scene-runtime-vehicles") === "0"
			);
		},
		undefined,
		{ timeout: 30_000 },
	);
	await activePage.getByRole("button", { name: "2D 편집 뷰", exact: true }).click();
	await waitForView(activePage, "2d");
}

async function undoVisibleOhbMutation(activePage, before, mutated) {
	await activePage.getByTestId("rail-canvas").press("Escape");
	await activePage.getByRole("button", { name: "실행 취소", exact: true }).click();
	const undone = await waitForWorker(
		activePage,
		(candidate) =>
			Number(candidate.modelGeneration) === Number(mutated.modelGeneration) + 1 &&
			candidate.authoredCells === before.authoredCells &&
			candidate.physicalPaths === before.physicalPaths &&
			candidate.equipmentPorts === before.equipmentPorts &&
			candidate.equipmentGroups === before.equipmentGroups,
		{ timeout: 30_000 },
	);
	assertEqual(undone.equipmentPorts, before.equipmentPorts, "Undo equipment-port identity");
	assertEqual(undone.equipmentGroups, before.equipmentGroups, "Undo equipment-group identity");
	return undone;
}

async function confirmExactOperationalConfiguration(activePage, before) {
	await ensureFabCheckOpen(activePage);
	await activePage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="rail-readiness-panel"]')
				?.getAttribute("data-status") === "ready",
		undefined,
		{ timeout: 30_000 },
	);
	const launch = activePage.locator(".tilefab-operational-launch");
	await launch.waitFor({ state: "visible" });
	assertEqual(await launch.isEnabled(), true, "operational re-review launch");
	await launch.click();
	let panel = activePage.getByTestId("operational-configuration-panel");
	await panel.waitFor({ state: "visible" });
	await panel.locator(".tilefab-operational-tabs button").nth(5).click();
	const review = panel.getByRole("button", { name: "REVIEW EXACT SOURCE", exact: true });
	await review.waitFor({ state: "visible" });
	const reviewActionRequired = await review.isEnabled();
	if (reviewActionRequired) await review.click();
	const reviewed = await waitForWorker(activePage, (metrics) => {
		return (
			metrics.operationalReady === "true" &&
			metrics.operationalRevision === before.operationalRevision
		);
	});
	panel = activePage.getByTestId("operational-configuration-panel");
	await panel.getByRole("button", { name: "운영 설정 닫기", exact: true }).click();
	return {
		revision: Number(reviewed.operationalRevision),
		phase: reviewActionRequired ? "reviewed" : "exact-review-restored",
	};
}

function assertSameResidentTerminalSemantics(transferPlan, replayHistory) {
	for (const field of [
		"completed",
		"serviceReady",
		"serviceActive",
		"idleHome",
		"moving",
		"nonHomeTrackOwned",
		"switchConflictOwned",
		"storageOccupied",
		"storageReserved",
		"coreEvents",
		"resourceEvents",
		"terminal",
	]) {
		assertEqual(replayHistory[field], transferPlan[field], `shared resident terminal ${field}`);
	}
}

async function ensureFabCheckOpen(activePage) {
	const panel = activePage.getByTestId("rail-readiness-panel");
	if (await panel.isVisible().catch(() => false)) return;
	await activePage.getByTestId("rail-readiness-toggle").click();
	await panel.waitFor({ state: "visible" });
}

function assertSameTerminalSemantics(transferPlan, replayHistory) {
	for (const field of [
		"completed",
		"inTransit",
		"serviceReady",
		"serviceActive",
		"eqDestinationRequests",
		"eqReady",
		"eqActive",
		"storageResources",
		"storageOccupied",
		"storageReserved",
		"coreEvents",
		"resourceEvents",
		"terminal",
	]) {
		assertEqual(replayHistory[field], transferPlan[field], `shared terminal ${field}`);
	}
}

async function read2DRuntime(activePage) {
	return activePage.getByTestId("rail-canvas").evaluate((canvas) => ({
		sequence: Number(canvas.dataset.simulationRuntimeSequence),
		poseFingerprint: canvas.dataset.simulationRuntimePoseFingerprint ?? "",
		poses: Number(canvas.dataset.simulationRuntimePoses),
		visiblePoses: Number(canvas.dataset.simulationRuntimeVisiblePoses),
		draws: Number(canvas.dataset.simulationRuntimeDraws),
	}));
}

function publicTransferPlan(ports) {
	return {
		schemaVersion: 1,
		source: {
			sourceKind: "TRANSFER_PLAN",
			manifestId: "OPENFAB-PUBLIC-RUNTIME-ACCEPTANCE",
			mappingVersion: 1,
			records: [
				{
					transferId: "PUBLIC-TRANSFER-TO-EQ",
					releaseTimeMicroseconds: 10,
					loadId: "PUBLIC-LOAD-1",
					sourcePortId: ports.source.id,
					destinationPortId: ports.service.id,
				},
				{
					transferId: "PUBLIC-TRANSFER-TO-OHB",
					releaseTimeMicroseconds: 20,
					loadId: "PUBLIC-LOAD-1",
					sourcePortId: ports.service.id,
					destinationPortId: ports.destination.id,
				},
				{
					transferId: "PUBLIC-TRANSFER-2-TO-EQ",
					releaseTimeMicroseconds: 30_000_000,
					loadId: "PUBLIC-LOAD-2",
					sourcePortId: ports.source.id,
					destinationPortId: ports.service.id,
				},
				{
					transferId: "PUBLIC-TRANSFER-2-TO-OHB",
					releaseTimeMicroseconds: 30_000_010,
					loadId: "PUBLIC-LOAD-2",
					sourcePortId: ports.service.id,
					destinationPortId: ports.destination.id,
				},
			],
		},
		serviceTimingInput: {
			eqProcessTimings: [
				{
					sourceOrdinal: 0,
					capabilityId: 1,
					processingDurationMicroseconds: 2_000_000,
				},
				{
					sourceOrdinal: 2,
					capabilityId: 1,
					processingDurationMicroseconds: 2_000_000,
				},
			],
		},
		resourceRunInput: {
			eqResources: [
				{
					equipmentGroupId: ports.serviceGroup.id,
					concurrentCapacity: 1,
					availabilityMode: "ALWAYS",
					availabilityWindows: [],
				},
			],
			initialStorageLoads: [
				{ loadId: "PUBLIC-LOAD-1", equipmentGroupId: ports.source.equipmentGroupId },
				{ loadId: "PUBLIC-LOAD-2", equipmentGroupId: ports.source.equipmentGroupId },
			],
		},
	};
}

function publicReplayHistory(ports) {
	const plan = publicTransferPlan(ports);
	return {
		...plan,
		source: {
			sourceKind: "REPLAY_HISTORY",
			manifestId: "OPENFAB-PUBLIC-RUNTIME-REPLAY-ACCEPTANCE",
			mappingVersion: 1,
			records: plan.source.records.map((record, index) => ({
				historyEventId: `PUBLIC-HISTORY-${index + 1}`,
				observedTimeMicroseconds: record.releaseTimeMicroseconds,
				loadId: record.loadId,
				sourcePortId: record.sourcePortId,
				destinationPortId: record.destinationPortId,
			})),
		},
	};
}

function publicResidentTransferPlan(ports) {
	return {
		schemaVersion: 1,
		profileId: "OPENFAB_RESIDENT_HOME_RETURN_SCENARIO_FILE_V1",
		source: {
			sourceKind: "TRANSFER_PLAN",
			manifestId: "OPENFAB-PUBLIC-RESIDENT-RUNTIME-ACCEPTANCE",
			mappingVersion: 1,
			records: [
				{
					transferId: "PUBLIC-RESIDENT-ALPHA-CYCLE",
					releaseTimeMicroseconds: 10,
					loadId: "PUBLIC-RESIDENT-LOAD-ALPHA",
					vehicleId: ports.residentFleet.alpha.vehicleId,
					sourcePortId: ports.source.id,
					destinationPortId: ports.destination.id,
				},
				{
					transferId: "PUBLIC-RESIDENT-BETA-CYCLE",
					releaseTimeMicroseconds: 10,
					loadId: "PUBLIC-RESIDENT-LOAD-BETA",
					vehicleId: ports.residentFleet.beta.vehicleId,
					sourcePortId: ports.source.id,
					destinationPortId: ports.destination.id,
				},
			],
		},
		serviceTimingInput: { eqProcessTimings: [] },
		resourceRunInput: {
			eqResources: [],
			initialStorageLoads: [
				{
					loadId: "PUBLIC-RESIDENT-LOAD-ALPHA",
					equipmentGroupId: ports.source.equipmentGroupId,
				},
				{
					loadId: "PUBLIC-RESIDENT-LOAD-BETA",
					equipmentGroupId: ports.source.equipmentGroupId,
				},
			],
		},
	};
}

function publicResidentReplayHistory(ports) {
	const plan = publicResidentTransferPlan(ports);
	return {
		...plan,
		source: {
			sourceKind: "REPLAY_HISTORY",
			manifestId: "OPENFAB-PUBLIC-RESIDENT-RUNTIME-REPLAY-ACCEPTANCE",
			mappingVersion: 1,
			records: plan.source.records.map((record, index) => ({
				historyEventId: `PUBLIC-RESIDENT-HISTORY-${index + 1}`,
				observedTimeMicroseconds: record.releaseTimeMicroseconds,
				loadId: record.loadId,
				vehicleId: record.vehicleId,
				sourcePortId: record.sourcePortId,
				destinationPortId: record.destinationPortId,
			})),
		},
	};
}

async function placeOhbAt(activePage, candidate, beforeCount) {
	await centerWorld(activePage, candidate);
	const point = await screenPointForWorld(activePage, candidate);
	await activePage.mouse.move(point.x, point.y);
	await activePage.waitForFunction(
		() =>
			(document.querySelector('[data-testid="rail-canvas"]')?.dataset.hoverPortSlot ?? "") !== "",
		undefined,
		{ timeout: 5_000 },
	);
	await activePage.mouse.click(point.x, point.y);
	await waitForWorker(activePage, (metrics) => Number(metrics.equipmentPorts) === beforeCount + 1);
}

async function readLegalOhbCandidates(activePage) {
	return activePage.evaluate(() => {
		const slots = window.__tileFab?.getEditorModel().portSlotArtifacts.OHB.slots;
		if (!slots) throw new Error("OHB slot artifacts are unavailable.");
		const candidates = [];
		for (let row = 0; row < slots.count; row++) {
			if (slots.statuses[row] !== 0) continue;
			candidates.push({
				row,
				x: slots.worldPositions[row * 2],
				y: slots.worldPositions[row * 2 + 1],
			});
		}
		return candidates;
	});
}

async function readLegalStraightPortRuns(activePage, portType) {
	return activePage.evaluate((type) => {
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

async function readLegalCardinalPortCandidates(activePage, portType) {
	return activePage.evaluate((type) => {
		const slots = window.__tileFab?.getEditorModel().portSlotArtifacts[type]?.slots;
		if (!slots) throw new Error(`${type} port slot artifacts are unavailable.`);
		const candidates = [];
		for (let row = 0; row < slots.count; row++) {
			if (slots.statuses[row] !== 0) continue;
			const tangentX = Number(slots.tangents[row * 2]);
			const tangentY = Number(slots.tangents[row * 2 + 1]);
			const orientation = Math.abs(tangentX) > 0.9 ? "H" : Math.abs(tangentY) > 0.9 ? "V" : null;
			if (!orientation) continue;
			candidates.push({
				row,
				x: Number(slots.worldPositions[row * 2]),
				y: Number(slots.worldPositions[row * 2 + 1]),
				orientation,
				route: {
					x: Number(slots.routeXs[row]),
					z: Number(slots.routeZs[row]),
					from: Number(slots.routeFromDirections[row]),
					to: Number(slots.routeToDirections[row]),
				},
				stationMillimeters: Number(slots.stationMillimeters[row]),
				side: ["CENTER", "LEFT", "RIGHT"][Number(slots.sides[row])],
				lateralOffsetMillimeters: Number(slots.lateralOffsetMillimeters[row]),
				direction: ["WITH_TRAVEL", "AGAINST_TRAVEL"][Number(slots.directions[row])],
			});
		}
		return candidates;
	}, portType);
}

function selectSeparatedPerpendicularStkPortPair(candidates) {
	let selected = null;
	for (const horizontal of candidates) {
		if (horizontal.orientation !== "H") continue;
		for (const vertical of candidates) {
			if (vertical.orientation !== "V") continue;
			const distance = Math.sqrt(distanceSquared(horizontal, vertical));
			if (distance < 120) continue;
			if (!selected || distance < selected.distance) {
				selected = { horizontal, vertical, distance };
			}
		}
	}
	if (!selected) {
		throw new Error("Parallel Hall exposes no 120 m separated perpendicular FLEX STK pair.");
	}
	return [selected.horizontal, selected.vertical];
}

async function placeStkDraftPort(activePage, candidate, expectedRows) {
	for (const offset of [
		{ x: 0, y: 0 },
		{ x: 0, y: -0.2 },
		{ x: 0, y: 0.2 },
		{ x: -0.2, y: 0 },
		{ x: 0.2, y: 0 },
	]) {
		const point = await screenPointForWorld(activePage, {
			x: candidate.x + offset.x,
			y: candidate.y + offset.y,
		});
		await activePage.mouse.move(point.x, point.y);
		try {
			await activePage.waitForFunction(
				(expectedRow) =>
					document
						.querySelector('[data-testid="rail-canvas"]')
						?.getAttribute("data-hover-port-slot") === String(expectedRow),
				candidate.row,
				{ timeout: 1_000 },
			);
		} catch {
			continue;
		}
		const beforeRows = Number(
			await activePage.getByTestId("tilefab-app").getAttribute("data-stk-draft-rows"),
		);
		await activePage.mouse.down();
		await activePage.mouse.up();
		try {
			await activePage.waitForFunction(
				(previousRows) =>
					Number(
						document
							.querySelector('[data-testid="tilefab-app"]')
							?.getAttribute("data-stk-draft-rows"),
					) !== previousRows,
				beforeRows,
				{ timeout: 1_000 },
			);
		} catch {
			continue;
		}
		const rows = Number(
			await activePage.getByTestId("tilefab-app").getAttribute("data-stk-draft-rows"),
		);
		if (rows === expectedRows) return;
		if (rows !== expectedRows - 1) {
			const reason =
				(await activePage.locator(".tilefab-build-spec > span").getAttribute("title")) ??
				"no draft reason";
			throw new Error(
				`FLEX STK draft changed ${beforeRows} -> ${rows} at ${candidate.orientation} ${candidate.x},${candidate.y}; expected ${expectedRows}; ${reason}.`,
			);
		}
	}
	throw new Error(`FLEX STK candidate ${candidate.x},${candidate.y} was not selectable.`);
}

function distanceSquared(left, right) {
	return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

async function clickActivityCommand(activePage, activity, accessibleName) {
	const activityButton = activePage.getByTestId(`editor-activity-${activity}`);
	if ((await activityButton.getAttribute("aria-pressed")) !== "true") await activityButton.click();
	const command = activePage.getByRole("button", { name: accessibleName, exact: true });
	await command.waitFor({ state: "visible" });
	await command.click();
}

async function chooseBlankCanvasForFirstRun(activePage) {
	const dialog = activePage.getByTestId("openfab-start-dialog");
	if (!(await dialog.isVisible().catch(() => false))) return;
	await dialog.getByRole("button", { name: /BLANK CANVAS/ }).click();
	await dialog.waitFor({ state: "hidden" });
}

async function centerWorld(activePage, world) {
	for (let attempt = 0; attempt < 48; attempt++) {
		const box = await activePage.getByTestId("rail-canvas").boundingBox();
		if (!box) throw new Error("Rail canvas has no visible bounds.");
		const point = await screenPointForWorld(activePage, world);
		const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		const delta = { x: center.x - point.x, y: center.y - point.y };
		if (Math.abs(delta.x) <= 2 && Math.abs(delta.y) <= 2) return;
		const step = {
			x: Math.max(-box.width * 0.3, Math.min(box.width * 0.3, delta.x)),
			y: Math.max(-box.height * 0.3, Math.min(box.height * 0.3, delta.y)),
		};
		await activePage.mouse.move(center.x, center.y);
		await activePage.mouse.down({ button: "right" });
		await activePage.mouse.move(center.x + step.x, center.y + step.y, { steps: 5 });
		await activePage.mouse.up({ button: "right" });
	}
	throw new Error(`Could not center world point ${world.x},${world.y}.`);
}

async function screenPointForWorld(activePage, world) {
	const canvas = activePage.getByTestId("rail-canvas");
	const box = await canvas.boundingBox();
	if (!box) throw new Error("Rail canvas has no visible bounds.");
	const camera = await activePage.evaluate(() => {
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

async function waitForPhase(activePage, testId, phase, timeout) {
	await activePage.waitForFunction(
		({ selector, expected }) =>
			document.querySelector(`[data-testid="${selector}"]`)?.getAttribute("data-phase") ===
			expected,
		{ selector: testId, expected: phase },
		{ timeout },
	);
}

async function waitForWorker(activePage, predicate, { timeout = 20_000 } = {}) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const metrics = await readMetrics(activePage);
		if (
			metrics.startupStatus === "ready" &&
			metrics.workerStatus === "ready" &&
			metrics.modelSyncPending === "false" &&
			metrics.workerSequence === metrics.workerTargetSequence &&
			predicate(metrics)
		) {
			return metrics;
		}
		await activePage.waitForTimeout(50);
	}
	throw new Error(
		`Timed out waiting for project state: ${JSON.stringify(await readMetrics(activePage))}`,
	);
}

async function readMetrics(activePage) {
	return activePage.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const worker = window.__tileFab?.getWorkerState();
		return {
			startupStatus: canvas?.dataset.startupStatus ?? "",
			workerStatus: canvas?.dataset.workerStatus ?? "",
			modelSyncPending: canvas?.dataset.modelSyncPending ?? "",
			modelGeneration: canvas?.dataset.modelGeneration ?? "",
			projectId: canvas?.dataset.projectId ?? "",
			workerSequence: canvas?.dataset.workerSequence ?? "",
			workerTargetSequence: canvas?.dataset.workerTargetSequence ?? "",
			workerSimulationReady: String(worker?.simulationReady ?? ""),
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerPhysicalFingerprint: canvas?.dataset.workerPhysicalFingerprint ?? "",
			projectName: canvas?.dataset.projectName ?? "",
			projectDirty: canvas?.dataset.projectDirty ?? "",
			authoredCells: canvas?.dataset.authoredCells ?? "",
			physicalPaths: canvas?.dataset.physicalPaths ?? "",
			equipmentPorts: app?.dataset.equipmentPorts ?? "",
			equipmentGroups: app?.dataset.equipmentGroups ?? "",
			operationalRevision: app?.dataset.operationalConfigurationRevision ?? "",
			operationalReady: app?.dataset.operationalConfigurationReady ?? "",
		};
	});
}

async function continueWithoutSavingIfVisible(activePage) {
	const discard = activePage.getByRole("button", { name: "저장하지 않고 계속", exact: true });
	if (await discard.isVisible().catch(() => false)) await discard.click();
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}

function assertAtLeast(actual, minimum, label) {
	if (actual < minimum)
		throw new Error(`${label}: expected at least ${minimum}, received ${actual}`);
}

function assertAtMost(actual, maximum, label) {
	if (actual > maximum)
		throw new Error(`${label}: expected at most ${maximum}, received ${actual}`);
}

function startPreviewServer() {
	const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
	const child = spawn(
		process.execPath,
		[vite, "preview", "--host", host, "--port", String(port), "--strictPort", "--mode", "runtime"],
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
	throw new Error(`Simulation runtime preview did not start at ${url}.`);
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
			// Try the next explicit browser path.
		}
	}
	throw new Error("Chrome or Chromium is required for simulation runtime acceptance.");
}
