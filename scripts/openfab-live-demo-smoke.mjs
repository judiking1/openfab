import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(root, "artifacts", "openfab-live-demo");
const distRoot = path.join(root, "dist");
const host = "127.0.0.1";
const requestedPort = Number(process.env.OPENFAB_LIVE_DEMO_PORT ?? 0);
const previewBasePath = "/openfab-demo/";
const result = {
	status: "FAIL",
	failure: null,
	basePath: previewBasePath,
	crossOriginIsolated: null,
	consoleErrors: [],
	pageErrors: [],
	failedRequests: [],
	httpErrors: [],
	header: null,
	desktop: null,
	compact: null,
};
let server;
let browser;
let page;

try {
	await mkdir(artifactRoot, { recursive: true });
	server = await startStaticServer();
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("OpenFab live-demo static server did not publish a TCP address.");
	}
	const baseUrl = `http://${host}:${address.port}${previewBasePath}`;
	browser = await chromium.launch({
		executablePath: await resolveChromePath(),
		headless: true,
		timeout: 20_000,
	});
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	page = await context.newPage();
	page.on("console", (message) => {
		if (message.type() === "error") result.consoleErrors.push(message.text());
	});
	page.on("pageerror", (error) => result.pageErrors.push(error.message));
	page.on("requestfailed", (request) => {
		result.failedRequests.push(
			`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
		);
	});
	page.on("response", (response) => {
		if (response.status() >= 400) {
			result.httpErrors.push(
				`${response.status()} ${response.request().method()} ${response.url()}`,
			);
		}
	});

	await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
	await assertPortableAssetBase(page);
	assertEqual(await page.title(), "OpenFab Builder", "production document title");
	assertEqual(
		await page.locator("html").getAttribute("lang"),
		"ko",
		"production document language",
	);
	assertEqual(
		await page.locator('meta[name="application-name"]').getAttribute("content"),
		"OpenFab Builder",
		"production application identity",
	);
	const description =
		(await page.locator('meta[name="description"]').getAttribute("content")) ?? "";
	if (!description.includes("OpenFab Builder") || !description.includes("FAB")) {
		throw new Error(`production description is incomplete: ${JSON.stringify(description)}`);
	}
	result.crossOriginIsolated = await page.evaluate(() => globalThis.crossOriginIsolated);
	assertEqual(result.crossOriginIsolated, false, "ordinary static-host isolation");
	await waitForReady(page);
	result.header = { desktop: await readHeaderEvidence(page, "desktop") };
	await page.setViewportSize({ width: 1280, height: 900 });
	result.header.notebook = await readHeaderEvidence(page, "notebook");
	await page.setViewportSize({ width: 886, height: 932 });
	result.header.medium = await readHeaderEvidence(page, "medium");
	await page.setViewportSize({ width: 1440, height: 900 });
	const startDialog = page.getByTestId("openfab-start-dialog");
	await startDialog.waitFor({ state: "visible" });
	assertEqual(
		await startDialog.locator(".tilefab-openfab-start-option").count(),
		3,
		"first-run choice count",
	);
	assertEqual(
		await startDialog
			.getByText(
				"처음이라면 Guided Build로 첫 정적 FAB를 완성하세요. 같은 프로젝트와 편집 명령으로 레일부터 검증·저장까지 이어집니다.",
				{ exact: true },
			)
			.count(),
		1,
		"first-run complete static FAB promise",
	);
	assertEqual(
		await startDialog
			.getByText("레일 → Port → Bay/Bank → Fab → 검증·저장", { exact: true })
			.count(),
		1,
		"first-run Guided Build journey summary",
	);
	await assertFocused(page, /GUIDED BUILD/, "recommended first-run focus");
	await startDialog.getByRole("button", { name: /GUIDED BUILD/ }).click();
	await startDialog.waitFor({ state: "hidden" });
	const guidedPanel = page.getByTestId("guided-build-panel");
	await guidedPanel.waitFor({ state: "visible" });

	assertEqual(
		await page.getByRole("button", { name: "2D 편집 뷰", exact: true }).count(),
		1,
		"Builder 2D entry count",
	);
	assertEqual(
		await page.getByRole("button", { name: "3D 검사 뷰", exact: true }).count(),
		0,
		"Builder deferred Twin View count",
	);
	assertEqual(
		await page
			.getByRole("button", { name: "2D 편집 뷰", exact: true })
			.getAttribute("aria-pressed"),
		"true",
		"Builder 2D pressed state",
	);
	const canvasMetrics = await page.getByTestId("rail-canvas").evaluate((canvas) => ({
		startupStatus: canvas.dataset.startupStatus ?? "",
		workerStatus: canvas.dataset.workerStatus ?? "",
		workerSimulationReady: canvas.dataset.workerSimulationReady ?? "",
		physicalPaths: canvas.dataset.physicalPaths ?? "",
	}));
	assertEqual(canvasMetrics.workerSimulationReady, "false", "static Worker simulation gate");
	assertEqual(canvasMetrics.physicalPaths, "0", "initial authored path count");

	result.desktop = await readViewportEvidence(page, guidedPanel);
	result.desktop.progressiveSurface = await readGuidedProgressiveSurface(page, "desktop initial");
	result.desktop.firstRailSurface = await advanceToFirstRailSurface(page, guidedPanel);
	result.desktop.checks = await exerciseChecksSurface(page, guidedPanel, "desktop");
	await page.setViewportSize({ width: 390, height: 844 });
	result.header.compact = await readHeaderEvidence(page, "compact");
	result.compact = await readViewportEvidence(page, guidedPanel);
	result.compact.checks = await exerciseChecksSurface(page, guidedPanel, "compact");
	assertEqual(result.consoleErrors.length, 0, "console error count");
	assertEqual(result.pageErrors.length, 0, "page error count");
	assertEqual(result.failedRequests.length, 0, "failed request count");
	assertEqual(result.httpErrors.length, 0, "HTTP error response count");
	result.status = "PASS";
	console.log(
		`PASS OpenFab live demo smoke | production Builder | 1440 + 1280 + 886 + 390 px | ${canvasMetrics.workerStatus} Worker`,
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
	await closeBrowser(browser);
	await stopStaticServer(server);
}

process.exit(result.status === "PASS" ? 0 : 1);

async function exerciseChecksSurface(activePage, guidedPanel, label) {
	const checksToggle = activePage.getByTestId("rail-readiness-toggle");
	assertEqual((await checksToggle.innerText()).trim(), "CHECKS", `${label} deferred check warning`);
	assertEqual(
		await checksToggle.getAttribute("data-state"),
		"guided",
		`${label} neutral check state`,
	);
	await checksToggle.click();
	const readinessPanel = activePage.getByTestId("rail-readiness-panel");
	await readinessPanel.waitFor({ state: "visible" });
	if ((await checksToggle.innerText()).trim() === "CHECKS") {
		throw new Error(`${label}: explicit Checks detour did not restore the real check status.`);
	}
	if ((await checksToggle.getAttribute("data-state")) === "guided") {
		throw new Error(`${label}: explicit Checks detour retained the neutral presentation.`);
	}
	assertEqual(
		await readinessPanel
			.locator(
				'.tilefab-operational-launch, [data-testid*="simulation-scenario"], [data-testid*="simulation-resident"], [data-testid="simulation-readiness-certification"]',
			)
			.count(),
		0,
		`${label} Builder deferred simulation surface count`,
	);
	const guidedBounds = await guidedPanel.boundingBox();
	const checksBounds = await readinessPanel.boundingBox();
	if (!guidedBounds || !checksBounds) {
		throw new Error(`${label}: Guided/Checks bounds are unavailable.`);
	}
	const viewport = activePage.viewportSize();
	if (!viewport) throw new Error(`${label}: viewport size is unavailable.`);
	assertRectWithinViewport(guidedBounds, viewport, `${label} Guided`);
	assertRectWithinViewport(checksBounds, viewport, `${label} Checks`);
	if (rectanglesOverlap(guidedBounds, checksBounds)) {
		throw new Error(
			`${label}: Guided and Checks surfaces overlap ${JSON.stringify({ guidedBounds, checksBounds })}`,
		);
	}
	await readinessPanel.getByRole("button", { name: "정적 FAB 검사 패널 닫기" }).click();
	await readinessPanel.waitFor({ state: "hidden" });
	await guidedPanel.waitFor({ state: "visible" });
	assertEqual(
		(await checksToggle.innerText()).trim(),
		"CHECKS",
		`${label} check warning re-deferral`,
	);
	assertEqual(
		await checksToggle.getAttribute("data-state"),
		"guided",
		`${label} neutral check state restoration`,
	);
	return { guidedBounds, checksBounds, overlap: false, closeOperable: true, activeOwner: true };
}

async function readGuidedProgressiveSurface(activePage, label) {
	const progress = activePage.getByRole("progressbar", { name: "Guided Build 진행률" });
	assertEqual(await progress.getAttribute("value"), "1", `${label} current mission progress`);
	assertEqual(await progress.getAttribute("max"), "12", `${label} mission count`);
	assertEqual(
		await progress.getAttribute("aria-valuetext"),
		"1 / 12 · 캔버스 익히기",
		`${label} accessible mission progress`,
	);
	assertEqual(
		await activePage.getByTestId("guided-build-mission-detail").count(),
		0,
		`${label} duplicate mission eyebrow deferral`,
	);
	assertEqual(
		await activePage.getByText("MISSION 1 · ORIENT", { exact: true }).count(),
		0,
		`${label} legacy mission eyebrow removal`,
	);
	const checksToggle = activePage.getByTestId("rail-readiness-toggle");
	assertEqual((await checksToggle.innerText()).trim(), "CHECKS", `${label} deferred check warning`);
	assertEqual(
		await checksToggle.getAttribute("data-state"),
		"guided",
		`${label} neutral check state`,
	);
	const activities = {};
	for (const activity of ["build", "assemble", "equip", "inspect"]) {
		activities[activity] = await activePage.getByTestId(`editor-activity-${activity}`).count();
		assertEqual(
			activities[activity],
			activity === "build" ? 1 : 0,
			`${label} ${activity} activity count`,
		);
	}
	const assemblyLaunchers = await activePage
		.getByRole("group", { name: "규격 FAB 레일 템플릿" })
		.count();
	assertEqual(assemblyLaunchers, 0, `${label} deferred Assembly launcher count`);
	const actionHints = await activePage
		.getByTestId("editor-action-hints")
		.locator(":scope > span")
		.count();
	assertEqual(actionHints, 0, `${label} duplicate action hint deferral`);
	const buildTool = await activePage
		.getByRole("button", { name: "레일 건설", exact: true })
		.count();
	assertEqual(buildTool, 0, `${label} duplicate Build tool deferral`);
	const erase = await activePage.getByRole("button", { name: "모듈 철거", exact: true }).count();
	assertEqual(erase, 0, `${label} Erase deferral`);
	const constructionBar = await activePage.getByTestId("rail-buildbar").count();
	assertEqual(constructionBar, 0, `${label} Orient construction bar deferral`);
	return {
		progress: { value: 1, max: 12 },
		activities,
		assemblyLaunchers,
		actionHints,
		buildTool,
		erase,
		constructionBar,
	};
}

async function advanceToFirstRailSurface(activePage, guidedPanel) {
	const acknowledgeNavigation = guidedPanel.getByRole("button", {
		name: "이동을 익혔어요",
		exact: true,
	});
	await acknowledgeNavigation.click();
	await activePage.waitForFunction(
		() =>
			document
				.querySelector('[data-testid="guided-build-panel"]')
				?.getAttribute("data-current-mission") === "first-rail",
		undefined,
		{ timeout: 10_000 },
	);
	const constructionBar = activePage.getByTestId("rail-buildbar");
	assertEqual(await constructionBar.count(), 0, "First Rail single-option construction deferral");
	const progress = activePage.getByRole("progressbar", { name: "Guided Build 진행률" });
	assertEqual(await progress.getAttribute("value"), "2", "First Rail current mission progress");
	assertEqual(
		await progress.getAttribute("aria-valuetext"),
		"2 / 12 · 첫 단방향 레일",
		"First Rail accessible mission progress",
	);
	assertEqual(
		await activePage.getByTestId("guided-build-mission-detail").count(),
		0,
		"First Rail duplicate mission eyebrow deferral",
	);
	assertEqual(
		await activePage.getByText("MISSION 2 · FIRST RAIL", { exact: true }).count(),
		0,
		"First Rail legacy mission eyebrow removal",
	);
	const checksToggle = activePage.getByTestId("rail-readiness-toggle");
	assertEqual(
		(await checksToggle.innerText()).trim(),
		"CHECKS",
		"First Rail deferred check warning",
	);
	assertEqual(
		await checksToggle.getAttribute("data-state"),
		"guided",
		"First Rail neutral check state",
	);
	const railModules = activePage.getByRole("group", { name: "레일 건설 모듈" });
	assertEqual(await railModules.count(), 0, "First Rail module-group deferral");
	const cornerPath = activePage.getByRole("group", { name: "코너 경로" });
	assertEqual(await cornerPath.count(), 0, "First Rail corner-path deferral");
	return { progress: { value: 2, max: 12 }, constructionBar: 0, moduleCount: 0, cornerPath: 0 };
}

function rectanglesOverlap(left, right) {
	return !(
		left.x + left.width <= right.x ||
		right.x + right.width <= left.x ||
		left.y + left.height <= right.y ||
		right.y + right.height <= left.y
	);
}

function assertRectWithinViewport(rectangle, viewport, label, tolerance = 0) {
	if (
		rectangle.x < -tolerance ||
		rectangle.y < -tolerance ||
		rectangle.x + rectangle.width > viewport.width + tolerance ||
		rectangle.y + rectangle.height > viewport.height + tolerance
	) {
		throw new Error(`${label} surface is clipped ${JSON.stringify({ rectangle, viewport })}`);
	}
}

async function readHeaderEvidence(activePage, label) {
	const evidence = await activePage.evaluate(() => {
		const topbar = document.querySelector(".tilefab-topbar");
		const viewport = { width: window.innerWidth, height: window.innerHeight };
		const items = topbar
			? [...topbar.children]
					.filter((element) => {
						const rectangle = element.getBoundingClientRect();
						return getComputedStyle(element).display !== "none" && rectangle.width > 0;
					})
					.map((element) => {
						const rectangle = element.getBoundingClientRect();
						return {
							name: element.className,
							x: rectangle.x,
							y: rectangle.y,
							width: rectangle.width,
							height: rectangle.height,
						};
					})
			: [];
		const commands = topbar
			? [...topbar.querySelectorAll("button[aria-label]")]
					.filter((element) => {
						const rectangle = element.getBoundingClientRect();
						return getComputedStyle(element).display !== "none" && rectangle.width > 0;
					})
					.map((element) => element.getAttribute("aria-label") ?? "")
			: [];
		return { viewport, items, commands };
	});
	if (evidence.items.length < 4) {
		throw new Error(`${label}: expected at least four visible topbar regions`);
	}
	for (const item of evidence.items) {
		assertRectWithinViewport(item, evidence.viewport, `${label} ${item.name}`, 1);
	}
	for (let leftIndex = 0; leftIndex < evidence.items.length; leftIndex += 1) {
		for (let rightIndex = leftIndex + 1; rightIndex < evidence.items.length; rightIndex += 1) {
			const left = evidence.items[leftIndex];
			const right = evidence.items[rightIndex];
			if (rectanglesOverlap(left, right)) {
				throw new Error(`${label}: topbar regions overlap ${JSON.stringify({ left, right })}`);
			}
		}
	}
	if (label !== "compact") {
		for (const command of [
			"FAB 프리셋",
			"프로젝트 열기",
			"프로젝트 저장",
			"실행 취소",
			"다시 실행",
			"2D 편집 뷰",
			"전체 보기",
			"명령·단축키",
		]) {
			if (!evidence.commands.includes(command)) {
				throw new Error(`${label}: required topbar command is hidden: ${command}`);
			}
		}
		for (const command of [
			"새 프로젝트",
			"FAB 조립",
			"다른 이름으로 저장",
			"물리 레일 외형",
			"전체 삭제",
		]) {
			if (evidence.commands.includes(command)) {
				throw new Error(`${label}: duplicate topbar command is still visible: ${command}`);
			}
		}
		const mapVisible = evidence.commands.includes("FAB 전체 지도");
		const organizationsVisible = evidence.commands.some((command) =>
			command.startsWith("FAB 조직"),
		);
		const wideNotebook = label === "desktop" || label === "notebook";
		assertEqual(mapVisible, wideNotebook, `${label} Map command visibility`);
		assertEqual(organizationsVisible, wideNotebook, `${label} Organization command visibility`);
	}
	return evidence;
}

async function readViewportEvidence(activePage, guidedPanel) {
	const evidence = await activePage.evaluate(() => {
		const panel = document.querySelector('[data-testid="guided-build-panel"]');
		const bounds = panel?.getBoundingClientRect();
		return {
			width: window.innerWidth,
			height: window.innerHeight,
			documentOverflow:
				Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
				window.innerWidth,
			panel: bounds
				? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }
				: null,
		};
	});
	if (evidence.documentOverflow > 0) {
		throw new Error(`viewport ${evidence.width}: horizontal overflow ${evidence.documentOverflow}`);
	}
	if (
		!evidence.panel ||
		evidence.panel.left < 0 ||
		evidence.panel.top < 0 ||
		evidence.panel.right > evidence.width ||
		evidence.panel.bottom > evidence.height
	) {
		throw new Error(
			`viewport ${evidence.width}: Guided panel is clipped ${JSON.stringify(evidence)}`,
		);
	}
	const buttons = guidedPanel.getByRole("button");
	for (let index = 0; index < (await buttons.count()); index++) {
		const button = buttons.nth(index);
		if (!(await button.isVisible())) continue;
		const bounds = await button.boundingBox();
		if (!bounds || bounds.width < 44 || bounds.height < 44) {
			throw new Error(
				`viewport ${evidence.width}: Guided target ${index} is below 44px (${JSON.stringify(bounds)})`,
			);
		}
	}
	return evidence;
}

async function assertFocused(activePage, accessibleName, label) {
	const focusedText = await activePage.evaluate(
		() => document.activeElement?.textContent?.trim() ?? "",
	);
	if (!accessibleName.test(focusedText)) {
		throw new Error(`${label}: received ${JSON.stringify(focusedText)}`);
	}
}

async function assertPortableAssetBase(activePage) {
	const evidence = await activePage.evaluate(() => ({
		pathname: window.location.pathname,
		assets: [...document.querySelectorAll("script[src], link[href]")]
			.map((element) => {
				const reference = element.getAttribute("src") ?? element.getAttribute("href") ?? "";
				const asset = new URL(reference, window.location.href);
				return asset.origin === window.location.origin ? asset.pathname : null;
			})
			.filter((asset) => asset !== null),
	}));
	assertEqual(evidence.pathname, previewBasePath, "portable preview pathname");
	if (evidence.assets.length === 0) {
		throw new Error("portable preview did not publish any document assets");
	}
	const outsideBase = evidence.assets.filter((asset) => !asset.startsWith(previewBasePath));
	if (outsideBase.length > 0) {
		throw new Error(`portable preview emitted root-owned assets: ${JSON.stringify(outsideBase)}`);
	}
}

async function waitForReady(activePage) {
	await activePage.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				canvas?.dataset.startupStatus === "ready" &&
				canvas.dataset.workerStatus === "ready" &&
				canvas.dataset.modelSyncPending === "false" &&
				canvas.dataset.workerSimulationReady === "false"
			);
		},
		undefined,
		{ timeout: 20_000 },
	);
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}

async function startStaticServer() {
	await access(path.join(distRoot, "index.html"));
	const staticServer = createServer((request, response) => {
		serveStaticRequest(request, response).catch((error) => {
			response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			response.end(error instanceof Error ? error.message : String(error));
		});
	});
	await new Promise((resolve, reject) => {
		staticServer.once("error", reject);
		staticServer.listen(requestedPort, host, () => {
			staticServer.off("error", reject);
			resolve();
		});
	});
	return staticServer;
}

async function serveStaticRequest(request, response) {
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { Allow: "GET, HEAD" });
		response.end();
		return;
	}
	const requestUrl = new URL(request.url ?? "/", `http://${host}`);
	if (!requestUrl.pathname.startsWith(previewBasePath)) {
		response.writeHead(404);
		response.end();
		return;
	}
	let relativePath;
	try {
		relativePath = decodeURIComponent(requestUrl.pathname.slice(previewBasePath.length));
	} catch {
		response.writeHead(400);
		response.end();
		return;
	}
	const requestedFile = relativePath.length === 0 ? "index.html" : relativePath;
	const absoluteFile = path.resolve(distRoot, requestedFile);
	if (!absoluteFile.startsWith(`${distRoot}${path.sep}`)) {
		response.writeHead(403);
		response.end();
		return;
	}
	try {
		const fileStat = await stat(absoluteFile);
		if (!fileStat.isFile()) throw new Error("not a file");
		const body = await readFile(absoluteFile);
		response.writeHead(200, {
			"Cache-Control": "no-store",
			"Content-Length": body.byteLength,
			"Content-Type": contentTypeFor(absoluteFile),
		});
		response.end(request.method === "HEAD" ? undefined : body);
	} catch {
		response.writeHead(404);
		response.end();
	}
}

function contentTypeFor(file) {
	switch (path.extname(file)) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".js":
		case ".mjs":
			return "text/javascript; charset=utf-8";
		case ".json":
			return "application/json; charset=utf-8";
		case ".svg":
			return "image/svg+xml";
		case ".png":
			return "image/png";
		case ".wasm":
			return "application/wasm";
		case ".woff2":
			return "font/woff2";
		default:
			return "application/octet-stream";
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
			// Try the next platform path.
		}
	}
	throw new Error("Chrome was not found. Set OPENFAB_CHROME_BIN to its executable path.");
}

async function closeBrowser(resource) {
	if (!resource) return;
	let timeout;
	try {
		await Promise.race([
			resource.close(),
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error("Browser close timed out.")), 10_000);
			}),
		]);
	} catch (error) {
		console.warn(error instanceof Error ? error.message : String(error));
	} finally {
		clearTimeout(timeout);
	}
}

async function stopStaticServer(staticServer) {
	if (!staticServer) return;
	await new Promise((resolve) => {
		const timeout = setTimeout(() => {
			staticServer.closeAllConnections();
			resolve();
		}, 2_000);
		staticServer.close(() => {
			clearTimeout(timeout);
			resolve();
		});
	});
}
