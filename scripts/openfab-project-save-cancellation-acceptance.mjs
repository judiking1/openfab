import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.resolve(
	process.env.OPENFAB_ACCEPTANCE_ARTIFACT_DIR ??
		path.join(root, "artifacts", "openfab-project-save-cancellation"),
);
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
	selectionShortcuts: [],
	compactSave: [],
	projectHeaderWidths: [],
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

	const canvas = page.getByTestId("rail-canvas");
	await canvas.focus();
	await page.keyboard.press("Control+A");
	await page.waitForFunction(
		() => Number(document.querySelector(".tilefab-app")?.dataset.areaSelectionModules) > 0,
		undefined,
		{ timeout: 10_000 },
	);
	const selectedModules = await page
		.locator(".tilefab-app")
		.getAttribute("data-area-selection-modules");
	for (const shortcut of ["Control+S", "Meta+S"]) {
		const expectedCalls = (await readSavePickerCalls(page)) + 1;
		await canvas.focus();
		await page.keyboard.press(shortcut);
		await page.waitForFunction(
			(expected) =>
				window.__openFabSavePickerCalls === expected &&
				document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle",
			expectedCalls,
			{ timeout: 10_000 },
		);
		assertEqual(
			await page.getByTestId("contextual-blueprint-save-dialog").isVisible(),
			false,
			`${shortcut} saves the project rather than opening a Blueprint dialog`,
		);
		assertInvariantEquality(
			await readCancellationInvariants(page),
			before,
			`${shortcut} selected project cancellation`,
		);
		assertEqual(
			await page.locator(".tilefab-app").getAttribute("data-area-selection-modules"),
			selectedModules,
			`${shortcut} preserves selected rail modules`,
		);
		result.selectionShortcuts.push(shortcut);
	}
	const callsBeforeGuard = await readSavePickerCalls(page);

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
	assertEqual(
		await readSavePickerCalls(page),
		callsBeforeGuard + 1,
		"guarded cancellation picker count",
	);
	result.guardStatus = guardStatus;

	await saveAndContinue.press("Enter");
	await page.waitForFunction(
		(expected) => window.__openFabSavePickerCalls === expected,
		callsBeforeGuard + 2,
		{ timeout: 10_000 },
	);
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
	for (const viewport of [
		{ width: 390, height: 600 },
		{ width: 760, height: 900 },
	]) {
		result.compactSave.push(await exerciseCompactDirectSave(browser, viewport));
	}
	result.status = "PASS";
	console.log(
		`PASS project save cancellation | ${result.pickerCalls} cancelled pickers | compact direct Save at 390/760px`,
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
	const start = {
		x: bounds.x + (bounds.width <= 450 ? Math.max(190, bounds.width * 0.53) : bounds.width * 0.38),
		y: bounds.y + bounds.height * 0.45,
	};
	await activePage.mouse.move(start.x, start.y);
	await activePage.mouse.down();
	await activePage.mouse.move(start.x + 4 * 38, start.y, { steps: 8 });
	await activePage.mouse.up();
	await waitForReady(activePage, 5);
}

async function exerciseCompactDirectSave(activeBrowser, viewport) {
	const label = `${viewport.width}x${viewport.height}`;
	const context = await activeBrowser.newContext({ viewport, acceptDownloads: true });
	await context.addInitScript(() => {
		Object.defineProperty(window, "__openFabSavePickerCalls", {
			configurable: true,
			writable: true,
			value: 0,
		});
		Object.defineProperty(window, "__openFabRejectSavePicker", {
			configurable: true,
			writable: true,
			value: null,
		});
		Object.defineProperty(window, "showSaveFilePicker", {
			configurable: true,
			value: () => {
				window.__openFabSavePickerCalls += 1;
				return new Promise((_, reject) => {
					window.__openFabRejectSavePicker = () =>
						reject(new DOMException("User cancelled the save picker.", "AbortError"));
				});
			},
		});
	});
	const compactPage = await context.newPage();
	const browserErrors = [];
	compactPage.on("console", (message) => {
		if (message.type() === "error") browserErrors.push(message.text());
	});
	compactPage.on("pageerror", (error) => browserErrors.push(error.message));
	try {
		await compactPage.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
		await waitForReady(compactPage, 0);
		await chooseBlankCanvasForFirstRun(compactPage);
		const projectName = await compactPage.locator(".tilefab-project-trigger strong").innerText();
		assertEqual(projectName.length > 0, true, `${label} Blank project name is visible`);
		await assertProjectStatus(compactPage, "미저장", `${label} Blank before editing`);
		await buildFiveMeterRail(compactPage);
		const before = await readCancellationInvariants(compactPage);
		assertEqual(before.projectDirty, "true", `${label} first Rail leaves Blank dirty`);
		assertEqual(before.projectFile, "", `${label} Blank has no file reference`);
		await assertProjectStatus(compactPage, "수정됨 · 저장 필요", `${label} Rail edit`);
		const topbar = compactPage.locator(".tilefab-topbar");
		const topbarSize = await topbar.evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			commandsClientWidth: element.querySelector(".tilefab-commands")?.clientWidth ?? 0,
			commandsScrollWidth: element.querySelector(".tilefab-commands")?.scrollWidth ?? 0,
			rootScrollLeft: document.getElementById("root")?.scrollLeft ?? null,
		}));
		assertEqual(topbarSize.scrollWidth <= topbarSize.clientWidth, true, `${label} topbar fits`);
		assertEqual(topbarSize.commandsClientWidth >= 44, true, `${label} command scrollport usable`);
		assertEqual(topbarSize.rootScrollLeft, 0, `${label} root stays at left edge`);
		const viewSwitch = compactPage.locator('.tilefab-view-switch[data-derived-3d="false"]');
		assertEqual(await viewSwitch.count(), 1, `${label} public V1 single view`);
		assertEqual(await viewSwitch.isVisible(), false, `${label} redundant 2D switch hidden`);
		const save = compactPage.getByRole("button", { name: "프로젝트 저장", exact: true });
		await save.waitFor({ state: "visible" });
		const saveBounds = await save.boundingBox();
		if (!saveBounds) throw new Error(`${label} direct Save has no bounds.`);
		assertEqual(saveBounds.width >= 44 && saveBounds.height >= 44, true, `${label} 44px Save`);
		assertEqual(
			saveBounds.x >= 0 && saveBounds.x + saveBounds.width <= viewport.width,
			true,
			`${label} Save fits viewport`,
		);
		const saveHits = await save.evaluate((button) => {
			const bounds = button.getBoundingClientRect();
			const inset = 4;
			return [
				[bounds.left + bounds.width / 2, bounds.top + bounds.height / 2],
				[bounds.left + inset, bounds.top + inset],
				[bounds.right - inset, bounds.top + inset],
				[bounds.left + inset, bounds.bottom - inset],
				[bounds.right - inset, bounds.bottom - inset],
			].map(([x, y]) => button.contains(document.elementFromPoint(x, y)));
		});
		assertEqual(saveHits.every(Boolean), true, `${label} Save owns all five hit points`);
		await save.click();
		await compactPage.waitForFunction(
			() =>
				window.__openFabSavePickerCalls === 1 &&
				document.querySelector(".tilefab-app")?.dataset.projectOperation === "saving",
			undefined,
			{ timeout: 10_000 },
		);
		await assertProjectStatus(compactPage, "저장 중", `${label} pending file picker`);
		await compactPage.evaluate(() => window.__openFabRejectSavePicker());
		await compactPage
			.getByText("프로젝트 저장을 취소했습니다 · 현재 프로젝트를 유지합니다", { exact: true })
			.waitFor({ state: "visible" });
		await compactPage.waitForFunction(
			() =>
				window.__openFabSavePickerCalls === 1 &&
				document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle" &&
				document.activeElement?.classList.contains("tilefab-project-trigger") === true,
			undefined,
			{ timeout: 10_000 },
		);
		assertInvariantEquality(
			await readCancellationInvariants(compactPage),
			before,
			`${label} native picker cancellation`,
		);
		await assertProjectStatus(compactPage, "수정됨 · 저장 필요", `${label} cancelled save`);
		await compactPage.evaluate(() => {
			Object.defineProperty(window, "showSaveFilePicker", { configurable: true, value: undefined });
		});
		const downloadPromise = compactPage.waitForEvent("download");
		await save.click();
		const download = await downloadPromise;
		const downloadPath = await download.path();
		if (!downloadPath) throw new Error(`${label} fallback Save has no downloaded file.`);
		assertEqual(
			download.suggestedFilename().endsWith(".openfab"),
			true,
			`${label} fallback extension`,
		);
		const saved = JSON.parse(await readFile(downloadPath, "utf8"));
		assertEqual(saved.manifest.id, before.projectId, `${label} downloaded project identity`);
		assertEqual(
			saved.rail.patchSequence,
			Number(before.modelSequence),
			`${label} downloaded Rail sequence`,
		);
		assertEqual(saved.rail.cells.length, 5, `${label} downloaded Rail cells`);
		await compactPage.waitForFunction(
			() =>
				document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle" &&
				document.querySelector('[data-testid="rail-canvas"]')?.dataset.projectDirty === "false" &&
				document.activeElement?.classList.contains("tilefab-project-trigger") === true,
			undefined,
			{ timeout: 10_000 },
		);
		const after = await readCancellationInvariants(compactPage);
		assertEqual(after.projectDirty, "false", `${label} fallback save clears dirty state`);
		assertEqual(after.projectId, before.projectId, `${label} fallback keeps project identity`);
		assertEqual(
			after.modelChecksum,
			before.modelChecksum,
			`${label} fallback keeps authored model`,
		);
		assertEqual(
			after.workerChecksum,
			before.workerChecksum,
			`${label} fallback keeps Worker mirror`,
		);
		assertEqual(after.historyCanUndo, before.historyCanUndo, `${label} fallback keeps Undo`);
		assertEqual(after.historyCanRedo, before.historyCanRedo, `${label} fallback keeps Redo`);
		await assertProjectStatus(
			compactPage,
			"파일 사본 있음",
			`${label} downloaded file`,
			viewport.width <= 650 ? "사본 있음" : "파일 사본 있음",
		);
		await compactPage.getByRole("button", { name: "실행 취소", exact: true }).click();
		await waitForReady(compactPage, 0);
		await assertProjectStatus(compactPage, "수정됨 · 저장 필요", `${label} edit after download`);
		if (viewport.width === 390) {
			result.projectHeaderWidths = await auditProjectHeaderWidths(compactPage);
		}
		assertEqual(browserErrors.length, 0, `${label} browser errors: ${browserErrors.join(" | ")}`);
		await compactPage.screenshot({
			path: path.join(artifactRoot, `compact-direct-save-${label}.png`),
		});
		return {
			viewport: label,
			pickerCalls: 1,
			downloadBytes: (await readFile(downloadPath)).length,
		};
	} catch (error) {
		await compactPage
			.screenshot({ path: path.join(artifactRoot, `compact-direct-save-failed-${label}.png`) })
			.catch(() => undefined);
		await writeFile(
			path.join(artifactRoot, `compact-direct-save-failed-${label}.json`),
			`${JSON.stringify(await readCancellationInvariants(compactPage), null, 2)}\n`,
		).catch(() => undefined);
		throw error;
	} finally {
		await context.close();
	}
}

async function assertProjectStatus(activePage, expected, phase, visibleExpected = null) {
	const trigger = activePage.locator(".tilefab-project-trigger");
	const name = trigger.locator("strong");
	const status = activePage.getByTestId("project-save-status");
	const compact = (activePage.viewportSize()?.width ?? 0) <= 650;
	const renderedStatus =
		visibleExpected ??
		(compact && expected === "수정됨 · 저장 필요"
			? "저장 필요"
			: compact && expected === "파일 사본 있음"
				? "사본 있음"
				: expected);
	await name.waitFor({ state: "visible" });
	await status.waitFor({ state: "visible" });
	assertEqual((await name.innerText()).length > 0, true, `${phase} project name`);
	assertEqual(await status.innerText(), renderedStatus, `${phase} save status`);
	assertEqual(await trigger.getAttribute("data-save-status"), expected, `${phase} trigger status`);
	const visibleStatus = await status.evaluate((element) => {
		const line = element.closest("small")?.getBoundingClientRect();
		const bounds = element.getBoundingClientRect();
		return Boolean(
			line && bounds.width > 0 && bounds.left >= line.left && bounds.right <= line.right + 1,
		);
	});
	assertEqual(visibleStatus, true, `${phase} save status remains inside caption`);
	if (compact) {
		const statusWidth = await status.evaluate((element) => {
			const line = element.closest("small");
			return { visible: line?.clientWidth ?? 0, content: line?.scrollWidth ?? 0 };
		});
		assertEqual(
			statusWidth.content <= statusWidth.visible,
			true,
			`${phase} compact status fits without ellipsis`,
		);
	}
}

async function auditProjectHeaderWidths(activePage) {
	const viewports = [
		{ width: 320, height: 640 },
		{ width: 360, height: 740 },
		{ width: 390, height: 600 },
		{ width: 390, height: 844 },
		{ width: 431, height: 900 },
		{ width: 450, height: 900 },
		{ width: 451, height: 900 },
		{ width: 455, height: 900 },
		{ width: 456, height: 900 },
		{ width: 470, height: 900 },
		{ width: 471, height: 900 },
		{ width: 650, height: 900 },
		{ width: 651, height: 900 },
		{ width: 760, height: 900 },
		{ width: 1440, height: 900 },
	];
	const proof = [];
	const inspect = async (viewport, paused) => {
		const label = `${viewport.width}x${viewport.height} ${paused ? "paused Guide" : "ordinary"}`;
		await activePage.setViewportSize(viewport);
		await activePage.evaluate(
			() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
		);
		await assertProjectStatus(
			activePage,
			"수정됨 · 저장 필요",
			label,
			viewport.width <= 650 ? "저장 필요" : "수정됨 · 저장 필요",
		);
		if (viewport.width >= 651) {
			const longName = await activePage
				.locator(".tilefab-project-trigger .tilefab-project-file-name")
				.evaluate((fileName) => {
					const original = fileName.textContent;
					fileName.textContent = `${"long-project-name-".repeat(20)}.openfab`;
					const status = fileName.nextElementSibling;
					const line = fileName.parentElement;
					const lineBounds = line?.getBoundingClientRect();
					const statusBounds = status?.getBoundingClientRect();
					const proof = {
						fileNameTruncated: fileName.scrollWidth > fileName.clientWidth,
						statusVisible: Boolean(
							lineBounds &&
								statusBounds &&
								statusBounds.left >= lineBounds.left &&
								statusBounds.right <= lineBounds.right + 1,
						),
					};
					fileName.textContent = original;
					return proof;
				});
			assertEqual(longName.fileNameTruncated, true, `${label} long file name truncates`);
			assertEqual(longName.statusVisible, true, `${label} status stays visible after long name`);
		}
		const topbar = await activePage.locator(".tilefab-topbar").evaluate((element) => ({
			clientWidth: element.clientWidth,
			scrollWidth: element.scrollWidth,
			commandsClientWidth: element.querySelector(".tilefab-commands")?.clientWidth ?? 0,
			commandsScrollWidth: element.querySelector(".tilefab-commands")?.scrollWidth ?? 0,
			windowScrollX: window.scrollX,
			rootScrollLeft: document.getElementById("root")?.scrollLeft ?? null,
		}));
		assertEqual(topbar.scrollWidth <= topbar.clientWidth, true, `${label} topbar fits`);
		assertEqual(topbar.commandsClientWidth >= 44, true, `${label} command scrollport usable`);
		if (viewport.width === 390) {
			assertEqual(
				topbar.commandsScrollWidth <= topbar.commandsClientWidth,
				true,
				`${label} essential commands visible without scrolling`,
			);
		}
		assertEqual(topbar.windowScrollX, 0, `${label} page remains at left edge`);
		assertEqual(topbar.rootScrollLeft, 0, `${label} root remains at left edge`);
		for (const [target, locator] of [
			["project", activePage.locator(".tilefab-project-trigger")],
			["checks", activePage.getByTestId("rail-readiness-toggle")],
			["resume", activePage.getByTestId("guided-build-resume")],
			["save", activePage.getByRole("button", { name: "프로젝트 저장", exact: true })],
			["help", activePage.getByRole("button", { name: "도움말·가이드", exact: true })],
		]) {
			if (!(await locator.isVisible())) continue;
			await locator.scrollIntoViewIfNeeded();
			const bounds = await locator.boundingBox();
			if (!bounds) throw new Error(`${label} ${target} has no visible bounds.`);
			const minimum = viewport.width <= 960 ? 44 : 28;
			assertEqual(
				bounds.width >= minimum && bounds.height >= minimum,
				true,
				`${label} ${target} hit size`,
			);
			assertEqual(
				bounds.x >= 0 && bounds.x + bounds.width <= viewport.width,
				true,
				`${label} ${target} inside viewport`,
			);
			const ownsHits = await locator.evaluate((button) => {
				const rect = button.getBoundingClientRect();
				return [
					[rect.left + rect.width / 2, rect.top + rect.height / 2],
					[rect.left + 4, rect.top + 4],
					[rect.right - 4, rect.bottom - 4],
				].every(([x, y]) => button.contains(document.elementFromPoint(x, y)));
			});
			assertEqual(ownsHits, true, `${label} ${target} owns hit area`);
			const scrollState = await activePage.evaluate(() => ({
				page: window.scrollX,
				root: document.getElementById("root")?.scrollLeft ?? null,
			}));
			assertEqual(scrollState.page, 0, `${label} ${target} page stays at left edge`);
			assertEqual(scrollState.root, 0, `${label} ${target} scrolls inside toolbar`);
		}
		assertEqual(
			await activePage.getByTestId("guided-build-resume").isVisible(),
			paused,
			`${label} Guide Resume visibility`,
		);
		if (viewport.width === 390 && viewport.height === 600) {
			await activePage.screenshot({
				path: path.join(
					artifactRoot,
					`project-header-${paused ? "paused" : "ordinary"}-390x600.png`,
				),
			});
		}
		return { viewport: `${viewport.width}x${viewport.height}`, paused, topbar };
	};
	for (const viewport of viewports) proof.push(await inspect(viewport, false));
	await activePage.setViewportSize({ width: 390, height: 600 });
	await activePage.locator(".tilefab-project-trigger").click();
	const menuBounds = await activePage.locator(".tilefab-project-menu").boundingBox();
	assertEqual(
		Boolean(menuBounds && menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 390),
		true,
		"390px project menu fits viewport",
	);
	await activePage
		.getByRole("button", { name: "시작 방법 선택 · Guided Build 추천", exact: true })
		.click();
	const startDialog = activePage.getByRole("dialog", { name: "어떻게 시작할까요?", exact: true });
	await startDialog.waitFor({ state: "visible" });
	await startDialog.getByRole("button", { name: /GUIDED BUILD/ }).click();
	const guidedPanel = activePage.getByTestId("guided-build-panel");
	await guidedPanel.waitFor({ state: "visible" });
	await guidedPanel.getByRole("button", { name: "Guided Build 최소화", exact: true }).click();
	await guidedPanel.waitFor({ state: "hidden" });
	await activePage.getByTestId("guided-build-resume").waitFor({ state: "visible" });
	for (const viewport of viewports) proof.push(await inspect(viewport, true));
	return proof;
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
			modelSequence: String(
				window.__tileFab?.getEditorModel()?.document?.getPatchSequence?.() ?? "",
			),
			modelChecksum: window.__tileFab?.getEditorModel()?.authoredChecksum ?? "",
			projectBlueprints: app?.dataset.projectBlueprints ?? "",
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
		"modelSequence",
		"modelChecksum",
		"projectBlueprints",
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
