import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "openfab-project");
const port = Number(process.env.OPENFAB_PROJECT_PORT ?? 5201);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const chromePath = await resolveChromePath();
const server = startPreviewServer();
let browser;
let page;
let invalidPath = "";
const result = {
	status: "FAIL",
	authoredChecksum: "",
	physicalFingerprint: "",
	firstBytes: 0,
	secondBytes: 0,
	recoveryCleanupRemoved: 0,
	relationshipStartup: null,
};

try {
	await mkdir(artifactRoot, { recursive: true });
	await waitForServer(`${baseUrl}/`);
	browser = await chromium.launch({ executablePath: chromePath, headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	page = await context.newPage();
	await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
	await waitForReady(page, 0);
	await chooseBlankCanvasForFirstRun(page);

	await buildFiveMeterRail(page);
	const authored = await readProjectMetrics(page);
	assertEqual(authored.physicalPaths, "5", "authored physical path count");
	assertEqual(authored.workerStatus, "ready", "authored Worker mirror status");
	assertEqual(authored.workerSimulationReady, "false", "simulation readiness gate");

	await page.waitForTimeout(2_000);
	await page.reload({ waitUntil: "domcontentloaded" });
	const recoveryOffer = page.getByRole("region", { name: /별도 복구본/ });
	const restoreRecovery = recoveryOffer.getByRole("button", {
		name: "현재 프로젝트를 교체해 복구",
		exact: true,
	});
	await restoreRecovery.waitFor({ state: "visible" });
	assertIncludes(
		await recoveryOffer.innerText(),
		"복구하면 현재 'Untitled FAB' 프로젝트를 교체합니다",
		"recovery offer names the current project replacement",
	);
	await page.waitForTimeout(2_000);
	await buildFiveMeterRail(page);
	const competing = await readProjectMetrics(page);
	assertEqual(competing.projectDirty, "true", "competing current project dirty state");
	if (competing.projectId === authored.projectId) {
		throw new Error("Crash-recovery guard did not start from a distinct current project.");
	}
	assertEqual(
		await recoveryOffer.getAttribute("data-recovery-project-id"),
		authored.projectId,
		"recovery offer remains bound to the interrupted project",
	);
	const offeredRecovery = await readRecoveryRecord(page, authored.projectId);
	assertEqual(offeredRecovery?.projectId, authored.projectId, "recovery envelope project id");
	assertEqual(
		offeredRecovery ? JSON.parse(offeredRecovery.json).manifest.id : null,
		authored.projectId,
		"recovery payload project id",
	);
	await restoreRecovery.click();
	const recoveryGuard = page.getByRole("dialog", {
		name: "현재 프로젝트를 저장한 뒤 복구할까요?",
		exact: true,
	});
	await recoveryGuard.waitFor({ state: "visible" });
	assertIncludes(
		await recoveryGuard.innerText(),
		"현재 'Untitled FAB' 프로젝트를 'Untitled FAB' 복구본으로 교체합니다",
		"dirty-project recovery guard explains replacement",
	);
	await recoveryGuard.getByRole("button", { name: "취소", exact: true }).click();
	await recoveryGuard.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.textContent?.trim() === "현재 프로젝트를 교체해 복구",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await restoreRecovery.evaluate((element) => element === document.activeElement),
		true,
		"recovery guard cancel restores the recovery action",
	);
	assertEqual(
		await recoveryOffer.getAttribute("data-recovery-project-id"),
		authored.projectId,
		"recovery offer remains stable after guard cancel",
	);
	await restoreRecovery.click();
	await recoveryGuard.waitFor({ state: "visible" });
	await recoveryGuard.getByRole("button", { name: "저장하지 않고 복구", exact: true }).click();
	await waitForBoundProject(page, authored.projectId, 5);
	const recovered = await readProjectMetrics(page);
	assertBoundIdentity(recovered, authored, "crash recovery");
	assertEqual(recovered.projectDirty, "true", "recovered project remains unsaved");

	const firstDownloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "프로젝트 저장" }).click();
	const firstDownload = await firstDownloadPromise;
	const firstPath = await firstDownload.path();
	if (!firstPath) throw new Error("First OpenFab download has no readable path.");
	await waitForProjectOperation(page, "idle");
	const saved = await readProjectMetrics(page);
	assertEqual(saved.projectDirty, "false", "saved project dirty state");

	await createBlankProject(page);
	const openChooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "프로젝트 열기" }).click();
	const openDiscard = page.getByRole("button", { name: "저장하지 않고 계속" });
	if (await openDiscard.isVisible().catch(() => false)) await openDiscard.click();
	const openChooser = await openChooserPromise;
	await openChooser.setFiles(firstPath);
	await waitForReady(page, 5);
	const loaded = await readProjectMetrics(page);
	assertBoundIdentity(loaded, authored, "file load");
	assertEqual(loaded.projectDirty, "false", "loaded project dirty state");

	const secondDownloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "프로젝트 저장" }).click();
	const secondDownload = await secondDownloadPromise;
	const secondPath = await secondDownload.path();
	if (!secondPath) throw new Error("Second OpenFab download has no readable path.");
	await waitForProjectOperation(page, "idle");
	const firstJson = await readFile(firstPath, "utf8");
	const secondJson = await readFile(secondPath, "utf8");
	assertCanonicalAuthoredEquality(firstJson, secondJson);

	invalidPath = path.join(artifactRoot, "invalid.openfab");
	await writeFile(invalidPath, '{"kind":"openfab/tilefab-project","schemaVersion":999}\n');
	const invalidChooserPromise = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "프로젝트 열기" }).click();
	const invalidChooser = await invalidChooserPromise;
	await invalidChooser.setFiles(invalidPath);
	await page.getByText(/기존 프로젝트 유지/).waitFor({ state: "visible" });
	const afterInvalid = await readProjectMetrics(page);
	assertBoundIdentity(afterInvalid, authored, "malformed-file rollback");

	result.relationshipStartup = await exerciseRelationshipProjectStartup(page);

	await seedIsolatedRecoveryCleanupInventory(page, 55);
	await page.reload({ waitUntil: "domcontentloaded" });
	await waitForReady(page, 0);
	const cleanupRecoveryOffer = page.getByRole("region", { name: /별도 복구본/ });
	await cleanupRecoveryOffer.waitFor({ state: "visible" });
	assertEqual(
		await cleanupRecoveryOffer.getAttribute("data-recovery-count"),
		"55",
		"seeded recovery inventory count",
	);
	await cleanupRecoveryOffer.getByRole("button", { name: "목록 55개", exact: true }).click();
	const cleanupTrigger = cleanupRecoveryOffer.getByRole("button", {
		name: "오래된 복구본 정리",
		exact: true,
	});
	await cleanupTrigger.click();
	const cleanupDialog = page.getByRole("dialog", {
		name: "오래된 복구본을 정리할까요?",
		exact: true,
	});
	await cleanupDialog.waitFor({ state: "visible" });
	assertEqual(
		await cleanupDialog.getAttribute("data-removable-count"),
		"5",
		"recovery cleanup removable count",
	);
	assertEqual(
		await cleanupDialog.getAttribute("data-retained-count"),
		"50",
		"recovery cleanup retained count",
	);
	await cleanupDialog.getByRole("button", { name: "취소", exact: true }).click();
	await cleanupDialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.activeElement?.textContent?.trim() === "오래된 복구본 정리",
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(
		await cleanupTrigger.evaluate((element) => element === document.activeElement),
		true,
		"recovery cleanup cancel restores the cleanup action",
	);
	assertEqual(
		await cleanupRecoveryOffer.getAttribute("data-recovery-count"),
		"55",
		"recovery cleanup cancel preserves every candidate",
	);
	await cleanupTrigger.click();
	await cleanupDialog.waitFor({ state: "visible" });
	await cleanupDialog.getByRole("button", { name: "오래된 복구본 영구 삭제", exact: true }).click();
	await cleanupDialog.waitFor({ state: "hidden" });
	await page.waitForFunction(
		() => document.querySelector(".tilefab-recovery")?.getAttribute("data-recovery-count") === "50",
		undefined,
		{ timeout: 10_000 },
	);
	const cleanupStores = await readRecoveryStoreCounts(page);
	assertEqual(cleanupStores.payloads, 50, "recovery cleanup payload count");
	assertEqual(cleanupStores.summaries, 50, "recovery cleanup summary count");
	assertEqual(cleanupStores.oldestProjectId, "cleanup-seed-5", "recovery cleanup retention floor");
	result.recoveryCleanupRemoved = 5;

	result.status = "PASS";
	result.authoredChecksum = authored.workerChecksum;
	result.physicalFingerprint = authored.workerPhysicalFingerprint;
	result.firstBytes = firstJson.length;
	result.secondBytes = secondJson.length;
	console.log(
		`PASS OpenFab project round trip | ${authored.physicalPaths} paths | ${authored.workerChecksum} | ${authored.workerPhysicalFingerprint}`,
	);
} finally {
	if (page) {
		await page
			.screenshot({ path: path.join(artifactRoot, "acceptance.png"), fullPage: true })
			.catch(() => undefined);
	}
	await writeFile(
		path.join(artifactRoot, "result.json"),
		`${JSON.stringify(result, null, 2)}\n`,
	).catch(() => undefined);
	if (invalidPath) await rm(invalidPath, { force: true });
	await closeBrowserResource(browser, "browser");
	server.kill("SIGTERM");
}

await Promise.all([
	new Promise((resolve) => process.stdout.write("", resolve)),
	new Promise((resolve) => process.stderr.write("", resolve)),
]);
process.exit(result.status === "PASS" ? 0 : 1);

// Test-only explicit Contact evidence with a future creation time exercises native save clock skew.
// Ordinary file load must never infer relationships.
async function createRelationshipProjectFixture(directory) {
	const source = await createServer({
		root,
		configFile: false,
		appType: "custom",
		logLevel: "error",
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true },
	});
	try {
		const { productionBankContactFixture } = await source.ssrLoadModule(
			"/src/tilefab/compile/StaticFabAssemblyRelationshipTestFixture.ts",
		);
		const { RailDocument } = await source.ssrLoadModule("/src/tilefab/core/RailDocument.ts");
		const { captureOpenFabProject, createOpenFabProjectManifest } = await source.ssrLoadModule(
			"/src/tilefab/project/OpenFabProject.ts",
		);
		const { serializeOpenFabProject } = await source.ssrLoadModule(
			"/src/tilefab/project/OpenFabProjectCodec.ts",
		);
		const { captureRailMirrorSnapshot } = await source.ssrLoadModule(
			"/src/tilefab/worker/RailMirrorChecksum.ts",
		);
		const fixture = productionBankContactFixture();
		const document = RailDocument.fromLoadedMap(
			fixture.map,
			17,
			fixture.portEquipment,
			fixture.organizations,
			undefined,
			fixture.relationships,
		);
		const projectId = "relationship-startup-production-60";
		const project = captureOpenFabProject(document, {
			manifest: createOpenFabProjectManifest(
				projectId,
				"Synthetic Contact startup",
				"2099-01-01T00:00:00.000Z",
			),
		});
		const checksum = captureRailMirrorSnapshot(
			document.map,
			17,
			document.portEquipment,
			document.organizations,
			document.relationships,
		).snapshot.checksum;
		const file = path.join(directory, "production-contact.openfab");
		const json = serializeOpenFabProject(project);
		await writeFile(file, json);
		assertEqual(document.map.size, 30_488, "relationship fixture cells");
		assertEqual(document.organizations.records.length, 184, "relationship fixture organizations");
		assertEqual(document.relationships.records.length, 1, "relationship fixture records");
		return { file, projectId, checksum, json };
	} finally {
		await source.close();
	}
}

async function exerciseRelationshipProjectStartup(activePage) {
	const directory = await mkdtemp(path.join(tmpdir(), "openfab-relationship-project-"));
	try {
		const fixture = await createRelationshipProjectFixture(directory);
		await activePage.evaluate(() => {
			window.__openfabRelationshipLongTasks = [];
			window.__openfabRelationshipObserver = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					window.__openfabRelationshipLongTasks.push({
						startTime: entry.startTime,
						duration: entry.duration,
					});
				}
			});
			window.__openfabRelationshipObserver.observe({ type: "longtask", buffered: false });
		});
		const first = await openRelationshipProject(activePage, fixture.file, fixture);
		const downloadPromise = activePage.waitForEvent("download");
		await activePage.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
		const download = await downloadPromise;
		const savedPath = await download.path();
		if (!savedPath) throw new Error("Relationship project save has no downloaded file.");
		await waitForProjectOperation(activePage, "idle");
		const original = JSON.parse(fixture.json);
		const saved = JSON.parse(await readFile(savedPath, "utf8"));
		for (const section of [
			"rail",
			"ports",
			"equipment",
			"areas",
			"relationships",
			"operations",
			"blueprints",
			"scenarios",
		]) {
			assertEqual(Object.hasOwn(saved, section), true, `relationship saved ${section} exists`);
			assertEqual(
				JSON.stringify(saved[section]),
				JSON.stringify(original[section]),
				`relationship saved ${section}`,
			);
		}
		assertEqual(
			saved.manifest.createdAt,
			original.manifest.createdAt,
			"saved project creation time",
		);
		assertEqual(
			saved.manifest.updatedAt >= original.manifest.updatedAt,
			true,
			"saved project timestamps remain monotonic across host clock skew",
		);
		assertEqual(saved.relationships.records.length, 1, "saved nonempty relationship count");
		assertEqual(saved.relationships.nextRelationshipId, 2, "saved relationship cursor");
		const reopened = await openRelationshipProject(activePage, savedPath, fixture);
		assertEqual(
			reopened.physicalFingerprint,
			first.physicalFingerprint,
			"relationship reopened physical identity",
		);
		console.log(
			`PASS nonempty relationship project startup | 30,488 cells | 184 organizations | 1 relationship | slices ${first.maxSliceMilliseconds.toFixed(1)}/${reopened.maxSliceMilliseconds.toFixed(1)} ms | Long Tasks 0/0 | native save/reopen | monotonic manifest timestamps`,
		);
		return { first, reopened };
	} finally {
		await activePage
			.evaluate(() => {
				window.__openfabRelationshipObserver?.disconnect();
				delete window.__openfabRelationshipObserver;
				delete window.__openfabRelationshipLongTasks;
				delete window.__openfabRelationshipStartedAt;
			})
			.catch(() => undefined);
		await rm(directory, { recursive: true, force: true });
	}
}

async function openRelationshipProject(activePage, file, fixture) {
	const chooserPromise = activePage.waitForEvent("filechooser");
	await activePage.getByRole("button", { name: "프로젝트 열기", exact: true }).click();
	const chooser = await chooserPromise;
	await activePage.evaluate(() => {
		window.__openfabRelationshipLongTasks = [];
		window.__openfabRelationshipStartedAt = performance.now();
	});
	// The second open has the same project identity; require its new opening transition first.
	const opening = activePage.waitForFunction(
		() => document.querySelector(".tilefab-app")?.dataset.projectOperation === "opening",
		undefined,
		{ timeout: 20_000 },
	);
	await chooser.setFiles(file);
	await opening;
	await activePage.waitForFunction(
		(expected) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle" &&
				canvas?.dataset.projectId === expected &&
				canvas.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false"
			);
		},
		fixture.projectId,
		{ timeout: 20_000 },
	);
	const measured = await activePage.getByTestId("rail-canvas").evaluate((canvas) => ({
		readyMilliseconds: performance.now() - window.__openfabRelationshipStartedAt,
		activationMilliseconds: Number(canvas.dataset.startupActivationTotalMs),
		maxSliceMilliseconds: Number(canvas.dataset.startupActivationMaxSliceMs),
		maxSlicePhase: canvas.dataset.startupActivationMaxSlicePhase,
		yields: Number(canvas.dataset.startupActivationYields),
		checksum: canvas.dataset.workerChecksum,
		targetChecksum: canvas.dataset.workerTargetChecksum,
		startupChecksum: canvas.dataset.startupAuthoredChecksum,
		physicalFingerprint: canvas.dataset.workerPhysicalFingerprint,
		mirrorFingerprintMatch: canvas.dataset.startupMirrorFingerprintMatch,
		physicalPaths: Number(canvas.dataset.physicalPaths),
		simulationReady: canvas.dataset.workerSimulationReady,
	}));
	// Deliver observer entries from the final activation/paint task before reading the window.
	await activePage.waitForTimeout(50);
	measured.longTasks = await activePage.evaluate(() => window.__openfabRelationshipLongTasks);
	assertEqual(measured.checksum, fixture.checksum, "relationship startup checksum");
	assertEqual(measured.targetChecksum, fixture.checksum, "relationship mirror target checksum");
	assertEqual(measured.startupChecksum, fixture.checksum, "relationship source checksum");
	assertEqual(measured.mirrorFingerprintMatch, "true", "relationship physical mirror match");
	assertEqual(measured.physicalPaths, 30_856, "relationship physical paths");
	assertEqual(measured.simulationReady, "false", "relationship simulation remains closed");
	assertEqual(measured.longTasks.length, 0, "relationship startup Long Tasks");
	if (
		!(
			measured.yields > 0 &&
			measured.maxSliceMilliseconds > 0 &&
			measured.maxSliceMilliseconds <= 8
		)
	) {
		throw new Error(
			`Relationship startup exceeds the 8 ms scale slice budget: ${JSON.stringify(measured)}`,
		);
	}
	return measured;
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

async function buildFiveMeterRail(activePage) {
	const canvas = activePage.getByTestId("rail-canvas");
	const bounds = await canvas.boundingBox();
	if (!bounds) throw new Error("Rail canvas has no visible bounds.");
	const start = { x: bounds.x + bounds.width * 0.38, y: bounds.y + bounds.height * 0.45 };
	await activePage.mouse.move(start.x, start.y);
	await activePage.mouse.down();
	await activePage.mouse.move(start.x + 4 * 38, start.y, { steps: 8 });
	await activePage.mouse.up();
	await waitForReady(activePage, 5);
}

async function chooseBlankCanvasForFirstRun(activePage) {
	const dialog = activePage.getByTestId("openfab-start-dialog");
	if (!(await dialog.isVisible().catch(() => false))) return;
	await dialog.getByRole("button", { name: /BLANK CANVAS/ }).click();
	await dialog.waitFor({ state: "hidden" });
}

async function createBlankProject(activePage) {
	const createProject = activePage.getByRole("button", { name: "새 프로젝트", exact: true });
	if (!(await createProject.isVisible().catch(() => false))) {
		await activePage.getByRole("button", { name: /^프로젝트 메뉴 ·/ }).click();
	}
	await createProject.click();
	const dialog = activePage.getByTestId("synthetic-fab-starter-dialog");
	await dialog.waitFor({ state: "visible" });
	await activePage.getByTestId("synthetic-fab-starter-blank").click();
	await activePage.getByTestId("create-synthetic-fab-project").click();
	const discard = activePage.getByRole("button", { name: "저장하지 않고 계속" });
	if (await discard.isVisible().catch(() => false)) await discard.click();
	await waitForReady(activePage, 0);
}

async function waitForReady(activePage, physicalPaths) {
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
		{ timeout: 10_000 },
	);
}

async function waitForBoundProject(activePage, projectId, physicalPaths) {
	await activePage.waitForFunction(
		(expected) => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const app = document.querySelector(".tilefab-app");
			return (
				canvas?.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				app?.dataset.projectOperation === "idle" &&
				canvas.dataset.projectId === expected.projectId &&
				canvas.dataset.physicalPaths === String(expected.physicalPaths)
			);
		},
		{ projectId, physicalPaths },
		{ timeout: 10_000 },
	);
}

async function waitForProjectOperation(activePage, operation) {
	await activePage.waitForFunction(
		(expected) => document.querySelector(".tilefab-app")?.dataset.projectOperation === expected,
		operation,
		{ timeout: 10_000 },
	);
}

async function readProjectMetrics(activePage) {
	return activePage.getByTestId("rail-canvas").evaluate((canvas) => ({
		physicalPaths: canvas.dataset.physicalPaths ?? "",
		projectDirty: canvas.dataset.projectDirty ?? "",
		projectId: canvas.dataset.projectId ?? "",
		workerStatus: canvas.dataset.workerStatus ?? "",
		workerChecksum: canvas.dataset.workerChecksum ?? "",
		workerPhysicalFingerprint: canvas.dataset.workerPhysicalFingerprint ?? "",
		workerSimulationReady: canvas.dataset.workerSimulationReady ?? "",
	}));
}

async function seedIsolatedRecoveryCleanupInventory(activePage, count) {
	await activePage.evaluate(async (recordCount) => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open("openfab-native-projects", 5);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			await new Promise((resolve, reject) => {
				const transaction = database.transaction(
					["recovery-projects", "recovery-project-summaries"],
					"readwrite",
				);
				const payloads = transaction.objectStore("recovery-projects");
				const summaries = transaction.objectStore("recovery-project-summaries");
				payloads.clear();
				summaries.clear();
				for (let index = 0; index < recordCount; index++) {
					const json = JSON.stringify({ seed: index, payload: "x".repeat(index + 1) });
					const summary = {
						projectId: `cleanup-seed-${index}`,
						name: `Cleanup seed ${index}`,
						updatedAt: `2026-07-18T01:${String(index).padStart(2, "0")}:00.000Z`,
						authoredChecksum: `cleanup-seed-checksum-${index}`,
						jsonCharacters: json.length,
					};
					payloads.put({ ...summary, json });
					summaries.put(summary);
				}
				transaction.oncomplete = () => resolve();
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
		} finally {
			database.close();
		}
	}, count);
}

async function readRecoveryStoreCounts(activePage) {
	return activePage.evaluate(async () => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open("openfab-native-projects", 5);
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const transaction = database.transaction(
					["recovery-projects", "recovery-project-summaries"],
					"readonly",
				);
				const payloadRequest = transaction.objectStore("recovery-projects").count();
				const summaryStore = transaction.objectStore("recovery-project-summaries");
				const summaryRequest = summaryStore.count();
				const summariesRequest = summaryStore.getAll();
				transaction.oncomplete = () => {
					const ordered = summariesRequest.result.sort(
						(left, right) =>
							right.updatedAt.localeCompare(left.updatedAt) ||
							left.projectId.localeCompare(right.projectId),
					);
					resolve({
						payloads: payloadRequest.result,
						summaries: summaryRequest.result,
						oldestProjectId: ordered.at(-1)?.projectId ?? null,
					});
				};
				transaction.onerror = () => reject(transaction.error);
				transaction.onabort = () => reject(transaction.error);
			});
		} finally {
			database.close();
		}
	});
}

async function readRecoveryRecord(activePage, projectId) {
	return activePage.evaluate(async (id) => {
		const request = indexedDB.open("openfab-native-projects");
		const database = await new Promise((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		try {
			const transaction = database.transaction("recovery-projects", "readonly");
			const read = transaction.objectStore("recovery-projects").get(id);
			return await new Promise((resolve, reject) => {
				read.onsuccess = () => resolve(read.result ?? null);
				read.onerror = () => reject(read.error);
			});
		} finally {
			database.close();
		}
	}, projectId);
}

function assertBoundIdentity(actual, expected, phase) {
	assertEqual(actual.physicalPaths, expected.physicalPaths, `${phase} physical paths`);
	assertEqual(actual.projectId, expected.projectId, `${phase} project id`);
	assertEqual(actual.workerChecksum, expected.workerChecksum, `${phase} authored checksum`);
	assertEqual(
		actual.workerPhysicalFingerprint,
		expected.workerPhysicalFingerprint,
		`${phase} physical fingerprint`,
	);
	assertEqual(actual.workerStatus, "ready", `${phase} Worker status`);
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

function assertIncludes(actual, expected, label) {
	if (!actual.includes(expected)) {
		throw new Error(
			`${label}: expected ${JSON.stringify(actual)} to include ${JSON.stringify(expected)}`,
		);
	}
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
	throw new Error(`OpenFab project preview did not start at ${url}.`);
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
