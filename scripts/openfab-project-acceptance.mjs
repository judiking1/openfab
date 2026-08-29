import { spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

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
	await page.getByRole("button", { name: "복구" }).waitFor({ state: "visible" });
	await page.waitForTimeout(2_000);
	await page.getByRole("button", { name: "복구" }).click();
	await waitForReady(page, 5);
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
