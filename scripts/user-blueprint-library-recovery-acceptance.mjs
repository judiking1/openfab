import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "user-blueprint-library-recovery");
const port = Number(process.env.OPENFAB_LIBRARY_RECOVERY_PORT ?? 5503 + (process.pid % 977));
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const chromePath = await resolveChromePath();
const server = startPreviewServer();
let browser;
let page;
const result = {
	status: "FAIL",
	failure: null,
	steps: [],
	consoleErrors: [],
	pageErrors: [],
	worker: null,
	final: null,
};
let observedRestoreWorkerStarts = 0;

try {
	await mkdir(artifactRoot, { recursive: true });
	await waitForServer(`${baseUrl}/`);
	browser = await chromium.launch({
		executablePath: chromePath,
		headless: true,
		timeout: 20_000,
	});
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		acceptDownloads: true,
	});
	await installRestoreWorkerTelemetry(context);
	page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") result.consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => result.pageErrors.push(error.message));
	await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
	await waitForReady(page);

	const recordA = createRecoveryRecord("recovery-record-a", "Recovery Bay A", 1);
	const recordB = createRecoveryRecord("recovery-record-b", "Recovery Bay B", 2);
	await replaceStoredUserBlueprints(page, [recordA, recordB]);
	await reloadAndOpenUserLibrary(page, 2);
	const twoRecordBundlePath = await backupUserBlueprintLibrary(page, "two-records.openfablib");
	const twoRecordBundleJson = await readFile(twoRecordBundlePath, "utf8");
	const tamperedBundle = JSON.parse(twoRecordBundleJson);
	tamperedBundle.fingerprint = "ofubl1-00000000:00000000";
	const malformedPath = path.join(artifactRoot, "tampered-fingerprint.openfablib");
	await writeFile(malformedPath, `${JSON.stringify(tamperedBundle)}\n`);

	await replaceStoredUserBlueprints(page, [recordA]);
	await reloadAndOpenUserLibrary(page, 1);
	const baseline = await readIsolationMetrics(page);

	observedRestoreWorkerStarts += await exerciseMalformedRestore(page, malformedPath, baseline);
	recordStep("malformed-fails-closed", await readIsolationMetrics(page));

	observedRestoreWorkerStarts += await exerciseInspectionCancellation(
		page,
		twoRecordBundlePath,
		baseline,
	);
	recordStep("worker-cancel", await readRestoreWorkerTelemetry(page));

	observedRestoreWorkerStarts += await exerciseDialogFocusCancellation(
		page,
		twoRecordBundlePath,
		baseline,
	);
	recordStep("dialog-focus-cancel", await readIsolationMetrics(page));

	observedRestoreWorkerStarts += await exerciseMergeAndReload(page, twoRecordBundlePath, baseline, [
		recordA.id,
		recordB.id,
	]);
	recordStep("merge-reload", {
		records: await readStoredUserBlueprintIds(page),
		metrics: await readIsolationMetrics(page),
	});

	observedRestoreWorkerStarts += await exerciseNarrowRestoreLayout(page, twoRecordBundlePath);
	recordStep("responsive-390", await readIsolationMetrics(page));

	const worker = await readRestoreWorkerTelemetry(page);
	assertEqual(worker.restoreLive, 0, "final restore Worker live count");
	assertEqual(worker.heldInspection, false, "final held inspection state");
	assertEqual(worker.restoreTerminated, worker.restoreStarts, "all restore Workers terminated");
	assertEqual(result.consoleErrors.length, 0, "console error count");
	assertEqual(result.pageErrors.length, 0, "page error count");
	assertEqual(observedRestoreWorkerStarts, 5, "observed restore Worker lifecycle count");
	result.worker = { observedStarts: observedRestoreWorkerStarts, finalDocument: worker };
	result.final = await readIsolationMetrics(page);
	result.status = "PASS";
	console.log(
		`PASS user blueprint library recovery | ${observedRestoreWorkerStarts} Workers | 2 durable records | 390px`,
	);
} catch (error) {
	result.failure = error instanceof Error ? `${error.stack ?? error.message}` : String(error);
	console.error(result.failure);
} finally {
	if (page) {
		await page
			.screenshot({ path: path.join(artifactRoot, "final.png"), fullPage: true })
			.catch(() => undefined);
	}
	await writeFile(
		path.join(artifactRoot, "result.json"),
		`${JSON.stringify(result, null, 2)}\n`,
	).catch(() => undefined);
	await closeBrowserResource(browser, "browser");
	await stopPreviewServer(server);
}

process.exit(result.status === "PASS" ? 0 : 1);

async function installRestoreWorkerTelemetry(context) {
	await context.addInitScript(() => {
		const NativeWorker = globalThis.Worker;
		const telemetry = {
			restoreStarts: 0,
			restoreTerminated: 0,
			restoreLive: 0,
			holdNextInspection: false,
			heldInspection: false,
		};
		Object.defineProperty(globalThis, "__openfabLibraryRecoveryAcceptance", {
			value: telemetry,
			configurable: false,
			writable: false,
		});
		globalThis.Worker = new Proxy(NativeWorker, {
			construct(target, argumentsList) {
				const url = String(argumentsList[0] ?? "");
				const isRestoreWorker = /openFabUserBlueprintLibraryRestoreWorker/i.test(url);
				const worker = Reflect.construct(target, argumentsList);
				if (!isRestoreWorker) return worker;
				telemetry.restoreStarts += 1;
				telemetry.restoreLive += 1;
				const nativePostMessage = worker.postMessage;
				const nativeTerminate = worker.terminate;
				let heldArguments = null;
				let terminated = false;
				Object.defineProperty(worker, "postMessage", {
					configurable: true,
					value(...postArguments) {
						const message = postArguments[0];
						if (
							telemetry.holdNextInspection &&
							message?.type === "INSPECT_OPENFAB_USER_BLUEPRINT_LIBRARY"
						) {
							telemetry.holdNextInspection = false;
							telemetry.heldInspection = true;
							heldArguments = postArguments;
							return;
						}
						return Reflect.apply(nativePostMessage, this, postArguments);
					},
				});
				Object.defineProperty(worker, "terminate", {
					configurable: true,
					value(...terminateArguments) {
						if (!terminated) {
							terminated = true;
							telemetry.restoreTerminated += 1;
							telemetry.restoreLive -= 1;
							if (heldArguments) telemetry.heldInspection = false;
							heldArguments = null;
						}
						return Reflect.apply(nativeTerminate, this, terminateArguments);
					},
				});
				return worker;
			},
		});
	});
}

async function exerciseMalformedRestore(activePage, malformedPath, baseline) {
	const beforeWorker = await readRestoreWorkerTelemetry(activePage);
	await chooseRestoreFile(activePage, malformedPath);
	await waitForEditorStatus(activePage, "전체 라이브러리 백업을 읽지 못했습니다");
	await activePage
		.getByRole("button", { name: "전체 청사진 라이브러리 백업 복원", exact: true })
		.waitFor({ state: "visible" });
	await assertRestoreButtonFocused(activePage, "malformed restore focus return");
	assertEqual(
		await activePage.getByTestId("user-blueprint-library-restore-dialog").count(),
		0,
		"malformed restore dialog count",
	);
	await assertUserBlueprintCount(activePage, 1);
	assertWorldUnchanged(await readIsolationMetrics(activePage), baseline, "malformed restore");
	const afterWorker = await readRestoreWorkerTelemetry(activePage);
	assertEqual(afterWorker.restoreStarts, beforeWorker.restoreStarts + 1, "malformed Worker start");
	assertEqual(
		afterWorker.restoreTerminated,
		beforeWorker.restoreTerminated + 1,
		"malformed Worker termination",
	);
	assertEqual(afterWorker.restoreLive, 0, "malformed Worker live count");
	return afterWorker.restoreStarts - beforeWorker.restoreStarts;
}

async function exerciseInspectionCancellation(activePage, bundlePath, baseline) {
	const beforeWorker = await readRestoreWorkerTelemetry(activePage);
	await activePage.evaluate(() => {
		globalThis.__openfabLibraryRecoveryAcceptance.holdNextInspection = true;
	});
	await chooseRestoreFile(activePage, bundlePath);
	const cancel = activePage.getByRole("button", {
		name: "청사진 라이브러리 파일 검증 취소",
		exact: true,
	});
	await cancel.waitFor({ state: "visible", timeout: 10_000 });
	await activePage.waitForFunction(
		() => globalThis.__openfabLibraryRecoveryAcceptance.heldInspection === true,
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		(await readRestoreWorkerTelemetry(activePage)).heldInspection,
		true,
		"held inspection state",
	);
	await cancel.click();
	await waitForEditorStatus(activePage, "전체 라이브러리 파일 검증을 취소했습니다");
	await activePage
		.getByRole("button", { name: "전체 청사진 라이브러리 백업 복원", exact: true })
		.waitFor({ state: "visible" });
	await assertRestoreButtonFocused(activePage, "inspection cancellation focus return");
	const afterWorker = await readRestoreWorkerTelemetry(activePage);
	assertEqual(afterWorker.restoreStarts, beforeWorker.restoreStarts + 1, "cancelled Worker start");
	assertEqual(
		afterWorker.restoreTerminated,
		beforeWorker.restoreTerminated + 1,
		"cancelled Worker termination",
	);
	assertEqual(afterWorker.restoreLive, 0, "cancelled Worker live count");
	assertWorldUnchanged(await readIsolationMetrics(activePage), baseline, "inspection cancellation");
	return afterWorker.restoreStarts - beforeWorker.restoreStarts;
}

async function exerciseDialogFocusCancellation(activePage, bundlePath, baseline) {
	const beforeWorker = await readRestoreWorkerTelemetry(activePage);
	const dialog = await openRestoreDialog(activePage, bundlePath);
	const close = dialog.getByRole("button", { name: "라이브러리 복원 취소", exact: true });
	assertEqual(
		await close.evaluate((element) => element === document.activeElement),
		true,
		"restore dialog initial close focus",
	);
	await activePage.keyboard.press("Shift+Tab");
	assertEqual(
		await dialog.evaluate((element) => element.contains(document.activeElement)),
		true,
		"restore dialog reverse focus trap",
	);
	await activePage.keyboard.press("Escape");
	await dialog.waitFor({ state: "hidden" });
	await assertRestoreButtonFocused(activePage, "restore dialog Escape focus return");
	await assertUserBlueprintCount(activePage, 1);
	assertWorldUnchanged(await readIsolationMetrics(activePage), baseline, "dialog cancellation");
	const afterWorker = await readRestoreWorkerTelemetry(activePage);
	assertEqual(afterWorker.restoreStarts, beforeWorker.restoreStarts + 1, "dialog Worker start");
	assertEqual(
		afterWorker.restoreTerminated,
		beforeWorker.restoreTerminated + 1,
		"dialog Worker termination",
	);
	assertEqual(afterWorker.restoreLive, 0, "dialog Worker live count");
	return afterWorker.restoreStarts - beforeWorker.restoreStarts;
}

async function exerciseMergeAndReload(activePage, bundlePath, baseline, expectedIds) {
	const beforeWorker = await readRestoreWorkerTelemetry(activePage);
	const dialog = await openRestoreDialog(activePage, bundlePath);
	assertEqual(await dialog.getAttribute("data-mode"), "merge", "restore default mode");
	const merge = dialog.getByRole("button", { name: "MERGE LIBRARY", exact: true });
	await waitForEnabled(merge);
	await merge.click();
	await dialog.waitFor({ state: "hidden", timeout: 30_000 });
	await assertUserBlueprintCount(activePage, 2);
	await assertRestoreButtonFocused(activePage, "merge focus return");
	assertEqual(
		JSON.stringify(await readStoredUserBlueprintIds(activePage)),
		JSON.stringify(expectedIds),
		"merged stored record ids",
	);
	assertWorldUnchanged(await readIsolationMetrics(activePage), baseline, "merge commit");
	const afterCommitWorker = await readRestoreWorkerTelemetry(activePage);
	assertEqual(
		afterCommitWorker.restoreStarts,
		beforeWorker.restoreStarts + 1,
		"merge Worker start",
	);
	assertEqual(
		afterCommitWorker.restoreTerminated,
		beforeWorker.restoreTerminated + 1,
		"merge Worker termination",
	);
	assertEqual(afterCommitWorker.restoreLive, 0, "merge Worker live count");

	await activePage.reload({ waitUntil: "domcontentloaded" });
	await waitForReady(activePage);
	await openUserBlueprintLibrary(activePage);
	await assertUserBlueprintCount(activePage, 2);
	assertEqual(
		JSON.stringify(await readStoredUserBlueprintIds(activePage)),
		JSON.stringify(expectedIds),
		"reloaded stored record ids",
	);
	const afterReload = await readIsolationMetrics(activePage);
	assertEqual(afterReload.physicalPaths, baseline.physicalPaths, "reload physical path count");
	assertEqual(afterReload.workerChecksum, baseline.workerChecksum, "reload Worker checksum");
	assertEqual(afterReload.workerSimulationReady, "false", "reload simulation gate");
	return afterCommitWorker.restoreStarts - beforeWorker.restoreStarts;
}

async function exerciseNarrowRestoreLayout(activePage, bundlePath) {
	await activePage.setViewportSize({ width: 390, height: 844 });
	const baseline = await readIsolationMetrics(activePage);
	const beforeWorker = await readRestoreWorkerTelemetry(activePage);
	const dialog = await openRestoreDialog(activePage, bundlePath);
	const layout = await dialog.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			viewportWidth: innerWidth,
			viewportHeight: innerHeight,
			documentClientWidth: document.documentElement.clientWidth,
			documentScrollWidth: document.documentElement.scrollWidth,
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
		};
	});
	if (
		layout.x < 0 ||
		layout.y < 0 ||
		layout.x + layout.width > layout.viewportWidth + 1 ||
		layout.y + layout.height > layout.viewportHeight + 1 ||
		layout.scrollWidth > layout.clientWidth + 1 ||
		layout.documentScrollWidth > layout.documentClientWidth + 1
	) {
		throw new Error(`390px restore dialog overflow: ${JSON.stringify(layout)}.`);
	}
	const controls = [
		dialog.getByRole("button", { name: "라이브러리 복원 취소", exact: true }),
		dialog.getByRole("button", { name: "CANCEL", exact: true }),
		dialog.getByRole("button", { name: "MERGE LIBRARY", exact: true }),
	];
	for (const control of controls) {
		await control.scrollIntoViewIfNeeded();
		const box = await control.boundingBox();
		if (!box || box.width < 44 || box.height < 44) {
			throw new Error(`390px restore control is below 44px: ${JSON.stringify(box)}.`);
		}
	}
	await activePage.screenshot({
		path: path.join(artifactRoot, "restore-dialog-390px.png"),
		fullPage: true,
	});
	await dialog.getByRole("button", { name: "CANCEL", exact: true }).click();
	await dialog.waitFor({ state: "hidden" });
	await assertRestoreButtonFocused(activePage, "390px cancel focus return");
	assertWorldUnchanged(await readIsolationMetrics(activePage), baseline, "390px restore dialog");
	const afterWorker = await readRestoreWorkerTelemetry(activePage);
	assertEqual(afterWorker.restoreStarts, beforeWorker.restoreStarts + 1, "390px Worker start");
	assertEqual(
		afterWorker.restoreTerminated,
		beforeWorker.restoreTerminated + 1,
		"390px Worker termination",
	);
	assertEqual(afterWorker.restoreLive, 0, "390px Worker live count");
	return afterWorker.restoreStarts - beforeWorker.restoreStarts;
}

async function openRestoreDialog(activePage, bundlePath) {
	await chooseRestoreFile(activePage, bundlePath);
	const dialog = activePage.getByTestId("user-blueprint-library-restore-dialog");
	await dialog.waitFor({ state: "visible", timeout: 30_000 });
	await waitForEnabled(dialog.getByRole("button", { name: "MERGE LIBRARY", exact: true }));
	return dialog;
}

async function chooseRestoreFile(activePage, filePath) {
	const chooserPromise = activePage.waitForEvent("filechooser");
	await activePage
		.getByRole("button", { name: "전체 청사진 라이브러리 백업 복원", exact: true })
		.click();
	const chooser = await chooserPromise;
	await chooser.setFiles(filePath);
}

async function backupUserBlueprintLibrary(activePage, fileName) {
	const downloadPromise = activePage.waitForEvent("download");
	await activePage
		.getByRole("button", { name: "전체 청사진 라이브러리 백업 파일 생성", exact: true })
		.click();
	const download = await downloadPromise;
	const filePath = path.join(artifactRoot, fileName);
	await download.saveAs(filePath);
	return filePath;
}

async function reloadAndOpenUserLibrary(activePage, expectedCount) {
	await activePage.reload({ waitUntil: "domcontentloaded" });
	await waitForReady(activePage);
	await openUserBlueprintLibrary(activePage);
	await assertUserBlueprintCount(activePage, expectedCount);
}

async function openUserBlueprintLibrary(activePage) {
	const userTab = activePage.getByTestId("blueprint-user-tab");
	if (!(await userTab.isVisible().catch(() => false))) {
		await activateEditorActivity(activePage, "assemble");
		await activePage.getByRole("button", { name: "내 청사진", exact: true }).click();
		await userTab.waitFor({ state: "visible" });
	}
	await userTab.click();
	await activePage.getByTestId("blueprint-user-panel").waitFor({ state: "visible" });
}

async function activateEditorActivity(activePage, activity) {
	const app = activePage.getByTestId("tilefab-app");
	const button = activePage.getByTestId(`editor-activity-${activity}`);
	await button.waitFor({ state: "visible" });
	if ((await app.getAttribute("data-editor-activity")) !== activity) await button.click();
	await activePage.waitForFunction(
		(expected) =>
			document
				.querySelector('[data-testid="tilefab-app"]')
				?.getAttribute("data-editor-activity") === expected,
		activity,
		{ timeout: 10_000 },
	);
}

async function assertUserBlueprintCount(activePage, count) {
	await activePage.waitForFunction(
		(expected) =>
			document.querySelector(".tilefab-app")?.dataset.userBlueprints === String(expected),
		count,
		{ timeout: 10_000 },
	);
}

async function assertRestoreButtonFocused(activePage, label) {
	try {
		await activePage.waitForFunction(
			() =>
				document.activeElement?.getAttribute("aria-label") === "전체 청사진 라이브러리 백업 복원",
			undefined,
			{ timeout: 10_000 },
		);
	} catch {
		const focus = await activePage.evaluate(() => ({
			tagName: document.activeElement?.tagName ?? "",
			ariaLabel: document.activeElement?.getAttribute("aria-label") ?? "",
			testId: document.activeElement?.getAttribute("data-testid") ?? "",
			text: document.activeElement?.textContent?.trim().slice(0, 120) ?? "",
			restoreCount: document.querySelectorAll('[aria-label="전체 청사진 라이브러리 백업 복원"]')
				.length,
		}));
		throw new Error(`${label}: focus did not return. ${JSON.stringify(focus)}`);
	}
	assertEqual(
		await activePage.evaluate(
			() =>
				document.activeElement?.getAttribute("aria-label") === "전체 청사진 라이브러리 백업 복원",
		),
		true,
		label,
	);
}

async function waitForEnabled(locator) {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (await locator.isEnabled().catch(() => false)) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("Timed out waiting for an enabled restore command.");
}

async function waitForEditorStatus(activePage, expectedText) {
	await activePage
		.locator(".tilefab-statusbar [role='status']")
		.filter({ hasText: expectedText })
		.waitFor({ state: "visible", timeout: 10_000 });
}

async function waitForReady(activePage) {
	await activePage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				canvas.dataset.workerSequence === canvas.dataset.workerTargetSequence &&
				canvas.dataset.workerChecksum === canvas.dataset.workerTargetChecksum
			);
		},
		undefined,
		{ timeout: 20_000 },
	);
}

async function readIsolationMetrics(activePage) {
	return activePage.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const app = document.querySelector(".tilefab-app");
		const model = globalThis.__tileFab?.getEditorModel?.();
		const worker = globalThis.__tileFab?.getWorkerState?.();
		return {
			physicalPaths: canvas?.dataset.physicalPaths ?? "",
			authoredCells: canvas?.dataset.authoredCells ?? "",
			authoredEdges: canvas?.dataset.authoredEdges ?? "",
			projectId: canvas?.dataset.projectId ?? "",
			projectDirty: canvas?.dataset.projectDirty ?? "",
			modelSequence: String(model?.document?.getPatchSequence?.() ?? ""),
			modelRevision: String(model?.map?.getRevision?.() ?? ""),
			modelChecksum: model?.authoredChecksum ?? "",
			workerTargetSequence: canvas?.dataset.workerTargetSequence ?? "",
			workerTargetRevision: canvas?.dataset.workerTargetRevision ?? "",
			workerTargetChecksum: canvas?.dataset.workerTargetChecksum ?? "",
			workerSequence: canvas?.dataset.workerSequence ?? "",
			workerRevision: canvas?.dataset.workerRevision ?? "",
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerPhysicalFingerprint: canvas?.dataset.workerPhysicalFingerprint ?? "",
			workerSimulationReady: String(worker?.simulationReady ?? ""),
			equipmentGroups: app?.dataset.equipmentGroups ?? "",
			equipmentPorts: app?.dataset.equipmentPorts ?? "",
			projectBlueprints: app?.dataset.projectBlueprints ?? "",
			historyCanUndo: app?.dataset.historyCanUndo ?? "",
			historyCanRedo: app?.dataset.historyCanRedo ?? "",
			railClipboard: app?.dataset.railClipboard ?? "",
			railClipboardHistory: app?.dataset.railClipboardHistory ?? "",
		};
	});
}

function assertWorldUnchanged(actual, expected, phase) {
	for (const key of [
		"physicalPaths",
		"authoredCells",
		"authoredEdges",
		"projectId",
		"projectDirty",
		"modelSequence",
		"modelRevision",
		"modelChecksum",
		"workerTargetSequence",
		"workerTargetRevision",
		"workerTargetChecksum",
		"workerSequence",
		"workerRevision",
		"workerChecksum",
		"workerPhysicalFingerprint",
		"workerSimulationReady",
		"equipmentGroups",
		"equipmentPorts",
		"projectBlueprints",
		"historyCanUndo",
		"historyCanRedo",
		"railClipboard",
		"railClipboardHistory",
	]) {
		assertEqual(actual[key], expected[key], `${phase} ${key}`);
	}
}

async function replaceStoredUserBlueprints(activePage, records) {
	await activePage.evaluate(async (nextRecords) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open("openfab-native-projects", 3);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		await new Promise((resolve, reject) => {
			const transaction = database.transaction("user-blueprints", "readwrite");
			const store = transaction.objectStore("user-blueprints");
			store.clear();
			for (const record of nextRecords) store.put(record);
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
		});
		database.close();
	}, records);
}

async function readStoredUserBlueprintIds(activePage) {
	return activePage.evaluate(async () => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open("openfab-native-projects", 3);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const records = await new Promise((resolve, reject) => {
			const transaction = database.transaction("user-blueprints", "readonly");
			const request = transaction.objectStore("user-blueprints").getAll();
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		database.close();
		return records.map(({ id }) => id).sort();
	});
}

function createRecoveryRecord(id, name, quickSlot) {
	const timestamp = "2026-08-26T00:00:00.000Z";
	return {
		schemaVersion: 1,
		id,
		folderPath: ["Recovery"],
		quickSlot,
		createdAt: timestamp,
		updatedAt: timestamp,
		blueprint: {
			id: `${id}-portable`,
			kind: "RAIL_AREA",
			name,
			folder: "",
			favorite: false,
			createdAt: timestamp,
			updatedAt: timestamp,
			sourceModuleCount: 1,
			widthMeters: 1,
			heightMeters: 1,
			edges: [
				[0, 0, 1, 0],
				[0, 1, 0, 0],
				[1, 0, 1, 1],
				[1, 1, 0, 1],
			],
		},
	};
}

async function readRestoreWorkerTelemetry(activePage) {
	return activePage.evaluate(() => ({ ...globalThis.__openfabLibraryRecoveryAcceptance }));
}

function recordStep(name, value) {
	result.steps.push({ name, value });
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`,
		);
	}
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
	throw new Error(`Blueprint library recovery preview did not start at ${url}.`);
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
