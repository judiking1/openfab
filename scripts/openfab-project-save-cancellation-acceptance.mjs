import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "openfab-project-save-cancellation");
const port = Number(process.env.OPENFAB_PROJECT_SAVE_CANCELLATION_PORT ?? 5202);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const chromePath = await resolveChromePath();
const server = startPreviewServer();
let browser;
let page;
const result = {
	status: "FAIL",
	directStatus: "",
	guardStatus: "",
	pickerCalls: 0,
	guardRetryable: false,
};

try {
	await mkdir(artifactRoot, { recursive: true });
	await waitForServer(`${baseUrl}/`);
	browser = await chromium.launch({ executablePath: chromePath, headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
	await context.addInitScript(() => {
		Object.defineProperty(window, "__openFabSavePickerCalls", {
			configurable: true,
			writable: true,
			value: 0,
		});
		Object.defineProperty(window, "showSaveFilePicker", {
			configurable: true,
			value: async () => {
				window.__openFabSavePickerCalls += 1;
				throw new DOMException("User cancelled the save picker.", "AbortError");
			},
		});
	});
	page = await context.newPage();
	await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
	await waitForReady(page, 0);
	await chooseBlankCanvasForFirstRun(page);
	await buildFiveMeterRail(page);

	const before = await readCancellationInvariants(page);
	assertEqual(before.projectDirty, "true", "authored unsaved project is protected");
	assertEqual(before.projectFile, "", "unsaved project has no file reference");
	assertEqual(before.projectOperation, "idle", "initial project operation");

	await page.getByRole("button", { name: "프로젝트 저장", exact: true }).click();
	const directStatus = "프로젝트 저장을 취소했습니다 · 현재 프로젝트를 유지합니다";
	await page.getByText(directStatus, { exact: true }).waitFor({ state: "visible" });
	const afterDirect = await readCancellationInvariants(page);
	assertInvariantEquality(afterDirect, before, "direct chooser cancellation");
	assertEqual(afterDirect.projectOperation, "idle", "direct cancellation operation");
	assertEqual(await readSavePickerCalls(page), 1, "direct cancellation picker count");
	result.directStatus = directStatus;

	await page.getByRole("button", { name: "프로젝트 열기", exact: true }).click();
	const guard = page.getByRole("dialog", { name: "저장되지 않은 변경 사항", exact: true });
	await guard.waitFor({ state: "visible" });
	const saveAndContinue = guard.getByRole("button", { name: "저장 후 계속", exact: true });
	await saveAndContinue.click();
	const guardStatus = "저장이 취소되었습니다 · 현재 프로젝트와 전환 선택을 유지합니다";
	await page.getByText(guardStatus, { exact: true }).waitFor({ state: "visible" });
	await page.waitForFunction(
		() => document.activeElement?.classList.contains("tilefab-project-guard-save") === true,
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(await guard.isVisible(), true, "guard remains visible after chooser cancellation");
	assertEqual(
		await saveAndContinue.evaluate((element) => element === document.activeElement),
		true,
		"guard save action regains focus",
	);
	const afterGuard = await readCancellationInvariants(page);
	assertInvariantEquality(afterGuard, before, "guarded chooser cancellation");
	assertEqual(afterGuard.pendingProjectAction, "open", "pending transition remains selected");
	assertEqual(await readSavePickerCalls(page), 2, "guarded cancellation picker count");
	result.guardStatus = guardStatus;

	await saveAndContinue.press("Enter");
	await page.waitForFunction(() => window.__openFabSavePickerCalls === 3, undefined, {
		timeout: 10_000,
	});
	await page.waitForFunction(
		() => document.activeElement?.classList.contains("tilefab-project-guard-save") === true,
		undefined,
		{ timeout: 10_000 },
	);
	assertEqual(await guard.isVisible(), true, "guard remains retryable after keyboard retry");
	assertInvariantEquality(
		await readCancellationInvariants(page),
		before,
		"keyboard retry cancellation",
	);
	result.pickerCalls = await readSavePickerCalls(page);
	result.guardRetryable = true;
	result.status = "PASS";
	console.log(
		`PASS project save cancellation | ${result.pickerCalls} cancelled pickers | guard focus restored`,
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
	await closeBrowserResource(browser, "browser");
	server.kill("SIGTERM");
}

process.exit(result.status === "PASS" ? 0 : 1);

async function chooseBlankCanvasForFirstRun(activePage) {
	const dialog = activePage.getByTestId("openfab-start-dialog");
	if (!(await dialog.isVisible().catch(() => false))) return;
	await dialog.getByRole("button", { name: /BLANK CANVAS/ }).click();
	await dialog.waitFor({ state: "hidden" });
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

async function readCancellationInvariants(activePage) {
	return activePage.evaluate(() => {
		const app = document.querySelector(".tilefab-app");
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		return {
			projectId: canvas?.dataset.projectId ?? "",
			projectDirty: canvas?.dataset.projectDirty ?? "",
			projectFile: canvas?.dataset.projectFile ?? "",
			projectOperation: app?.dataset.projectOperation ?? "",
			pendingProjectAction: app?.dataset.pendingProjectAction ?? "",
			physicalPaths: canvas?.dataset.physicalPaths ?? "",
			workerStatus: canvas?.dataset.workerStatus ?? "",
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerPhysicalFingerprint: canvas?.dataset.workerPhysicalFingerprint ?? "",
			historyCanUndo: app?.dataset.historyCanUndo ?? "",
			historyCanRedo: app?.dataset.historyCanRedo ?? "",
		};
	});
}

function assertInvariantEquality(actual, expected, phase) {
	for (const key of [
		"projectId",
		"projectDirty",
		"projectFile",
		"physicalPaths",
		"workerStatus",
		"workerChecksum",
		"workerPhysicalFingerprint",
		"historyCanUndo",
		"historyCanRedo",
	]) {
		assertEqual(actual[key], expected[key], `${phase} ${key}`);
	}
	assertEqual(actual.projectOperation, "idle", `${phase} project operation`);
}

async function readSavePickerCalls(activePage) {
	return activePage.evaluate(() => window.__openFabSavePickerCalls ?? 0);
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
	throw new Error(`OpenFab project cancellation preview did not start at ${url}.`);
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
			await import("node:fs/promises").then(({ access }) => access(candidate));
			return candidate;
		} catch {
			// Try the next supported browser installation.
		}
	}
	throw new Error("Chrome or Chromium is required for project cancellation acceptance.");
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
