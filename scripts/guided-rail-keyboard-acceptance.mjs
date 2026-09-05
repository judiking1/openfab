import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), "..");
const artifactRoot = path.join(root, "artifacts", "guided-rail-keyboard");
const port = Number(process.env.OPENFAB_GUIDED_RAIL_KEYBOARD_PORT ?? 5214);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const availableWidths = [
	{ width: 390, height: 844 },
	{ width: 760, height: 900 },
	{ width: 1440, height: 900 },
];
const requestedWidths = new Set(
	(process.env.OPENFAB_GUIDED_RAIL_KEYBOARD_WIDTHS ?? "")
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.map(Number)
		.filter(Number.isFinite),
);
const widths =
	requestedWidths.size === 0
		? availableWidths
		: availableWidths.filter(({ width }) => requestedWidths.has(width));
if (widths.length === 0) {
	throw new Error("No supported Guided Rail keyboard viewport was selected.");
}
const result = { status: "FAIL", widths: [] };
const server = startPreviewServer();
let browser;

try {
	await auditKeyboardOnlySource();
	await mkdir(artifactRoot, { recursive: true });
	await waitForServer(`${baseUrl}/`, server);
	const executablePath = await resolveChromePath();
	for (const viewport of widths) {
		browser = await chromium.launch({ executablePath, headless: true });
		try {
			result.widths.push(await runKeyboardAuthoringFlow(browser, viewport));
		} finally {
			await closeBrowserResource(browser, `browser ${viewport.width}`);
			browser = undefined;
		}
	}
	result.status = "PASS";
	console.log(
		`PASS Guided Rail keyboard acceptance | ${widths.map(({ width }) => width).join("/")} px | 4 atomic commits each | pointer events 0`,
	);
} catch (error) {
	result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	console.error(result.error);
	throw error;
} finally {
	await writeFile(
		path.join(artifactRoot, "result.json"),
		`${JSON.stringify(result, null, 2)}\n`,
	).catch(() => undefined);
	await closeBrowserResource(browser, "browser");
	if (server.exitCode === null) server.kill("SIGTERM");
}

process.exit(result.status === "PASS" ? 0 : 1);

async function runKeyboardAuthoringFlow(activeBrowser, viewport) {
	const label = `${viewport.width}x${viewport.height}`;
	console.log(`RUN Guided Rail keyboard ${label}`);
	const context = await activeBrowser.newContext({ viewport, acceptDownloads: true });
	let page;
	try {
		await context.addInitScript(() => {
			Object.defineProperty(window, "showSaveFilePicker", {
				configurable: true,
				value: undefined,
			});
			Object.defineProperty(window, "showOpenFilePicker", {
				configurable: true,
				value: undefined,
			});
			const counts = {
				pointerdown: 0,
				pointermove: 0,
				pointerup: 0,
				mousedown: 0,
				mousemove: 0,
				mouseup: 0,
				touchstart: 0,
				touchmove: 0,
				touchend: 0,
				wheel: 0,
				contextmenu: 0,
				detailClick: 0,
			};
			Object.defineProperty(window, "__openFabInputCounts", {
				configurable: false,
				value: counts,
			});
			for (const type of Object.keys(counts).filter((type) => type !== "detailClick")) {
				window.addEventListener(
					type,
					() => {
						counts[type] += 1;
					},
					true,
				);
			}
			window.addEventListener(
				"click",
				(event) => {
					if (event.detail !== 0) counts.detailClick += 1;
				},
				true,
			);
		});
		page = await context.newPage();
		const runtimeErrors = [];
		page.on("pageerror", (error) => runtimeErrors.push(`pageerror: ${error.message}`));
		page.on("console", (message) => {
			if (message.type() === "error") runtimeErrors.push(`console.error: ${message.text()}`);
		});
		await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
		await waitForWorker(
			page,
			(metrics) => metrics.workerStatus === "ready" && metrics.authoredEdges === "0",
		);

		const startDialog = page.getByTestId("openfab-start-dialog");
		const guidedStart = startDialog.getByRole("button", { name: /GUIDED BUILD/ });
		await guidedStart.focus();
		await guidedStart.press("Enter");
		await startDialog.waitFor({ state: "hidden" });

		const panel = page.getByTestId("guided-build-panel");
		await panel.waitFor({ state: "visible" });
		const orientationAction = panel.getByRole("button", { name: "이동을 익혔어요", exact: true });
		await orientationAction.focus();
		await orientationAction.press("Enter");
		await waitForMission(panel, "first-rail");

		const entry = panel.getByTestId("guided-build-keyboard-rail-entry");
		await entry.waitFor({ state: "visible" });
		const canvas = page.getByTestId("rail-canvas");
		await assertGuidedCanvasPrimaryTarget(page, `${label} first-rail`);
		assertEqual(
			await entry.getAttribute("data-guided-target"),
			null,
			`${label} keyboard entry remains a secondary action`,
		);
		await assertMinimumTarget(entry, 44, `${label} keyboard entry`);
		await assertNoHorizontalOverflow(page, `${label} first-rail`);

		await entry.focus();
		await entry.press("Enter");
		await assertCanvasFocused(canvas, `${label} first entry focus handoff`);
		await assertSessionPhase(canvas, "choose-start", `${label} initial phase`);
		const describedBy = await canvas.getAttribute("aria-describedby");
		if (!describedBy?.includes("tilefab-guided-rail-keyboard-readout")) {
			throw new Error(`${label} canvas does not describe the live keyboard readout.`);
		}
		const ariaKeyShortcuts = await canvas.getAttribute("aria-keyshortcuts");
		for (const key of ["W", "A", "S", "D", "ArrowRight", "Enter", "Escape"]) {
			if (!ariaKeyShortcuts?.includes(key)) {
				throw new Error(`${label} canvas aria-keyshortcuts is missing ${key}.`);
			}
		}
		const initialAccessibleReadout = await assertAccessibleRailReadout(
			page,
			["시작점 단계", "길이 0미터", "Enter로 시작점 선택"],
			`${label} initial accessible readout`,
		);
		await canvas.press("ArrowRight");
		const movedAccessibleReadout = await assertAccessibleRailReadout(
			page,
			["시작점 단계", "길이 0미터", "Enter로 시작점 선택"],
			`${label} 1 m start movement readout`,
		);
		if (movedAccessibleReadout === initialAccessibleReadout) {
			throw new Error(`${label} 1 m start movement did not update the accessible coordinate.`);
		}
		await assertGuidedRailAnnouncement(
			page,
			movedAccessibleReadout,
			`${label} 1 m start movement announcement`,
		);
		await assertMinimumTarget(
			panel.getByTestId("guided-build-keyboard-rail-apply"),
			44,
			`${label} apply`,
		);
		await assertMinimumTarget(
			panel.getByTestId("guided-build-keyboard-rail-cancel"),
			44,
			`${label} cancel`,
		);

		await canvas.press("Digit2");
		await assertSessionPhase(canvas, "", `${label} construction-mode cancellation`);
		const cancelledMetrics = await readMetrics(page);
		if (!cancelledMetrics.cursorReadout.startsWith("X ")) {
			throw new Error(
				`${label} construction-mode cursor residue: ${JSON.stringify(cancelledMetrics.cursorReadout)}.`,
			);
		}
		await entry.focus();
		await entry.press("Enter");
		await assertCanvasFocused(canvas, `${label} mode-switch restart focus handoff`);

		await canvas.press("Escape");
		await assertSessionPhase(canvas, "", `${label} Escape cancellation`);
		await page.waitForFunction(
			() =>
				document.activeElement?.getAttribute("data-testid") === "guided-build-keyboard-rail-entry",
			undefined,
			{ timeout: 10_000 },
		);
		assertEqual(
			await entry.evaluate((element) => element === document.activeElement),
			true,
			`${label} cancellation focus restore`,
		);
		await entry.press("Enter");
		await assertCanvasFocused(canvas, `${label} restart focus handoff`);

		const blankProjectTrigger = page.locator(".tilefab-project-trigger");
		await blankProjectTrigger.focus();
		await blankProjectTrigger.press("Enter");
		const blankProjectMenu = page.locator("#tilefab-project-menu");
		await waitForProjectMenuReady(page, blankProjectMenu, `${label} active-session save menu`);
		const blankSaveAction = blankProjectMenu.getByRole("button", {
			name: "프로젝트 파일 저장 (.openfab)",
			exact: true,
		});
		await blankSaveAction.focus();
		await assertLocatorFocused(blankSaveAction, `${label} active-session save focus`);
		const [blankDownload] = await Promise.all([
			page.waitForEvent("download"),
			assertGuidedPrimaryTargetWaiting(
				page,
				"saving",
				`${label} active-session save waiting state`,
			),
			blankSaveAction.press("Enter"),
		]);
		const blankProjectPath = await blankDownload.path();
		if (!blankProjectPath) throw new Error(`${label} active-session save has no path.`);
		await waitForWorker(
			page,
			(next) => next.projectDirty === "false" && next.projectOperation === "idle",
		);
		await assertSessionPhase(canvas, "choose-start", `${label} save preserves transient session`);
		await assertCanvasFocused(canvas, `${label} save completion focus restore`);
		await blankProjectTrigger.focus();
		await blankProjectTrigger.press("Enter");
		await waitForProjectMenuReady(page, blankProjectMenu, `${label} active-session open menu`);
		const blankOpenAction = blankProjectMenu.getByRole("button", { name: "열기", exact: true });
		assertEqual(await blankOpenAction.isEnabled(), true, `${label} active-session open enabled`);
		await blankOpenAction.focus();
		await assertLocatorFocused(blankOpenAction, `${label} active-session open focus`);
		const blankChooserPromise = page.waitForEvent("filechooser");
		await blankOpenAction.press("Enter");
		const blankChooser = await blankChooserPromise;
		await blankChooser.setFiles(blankProjectPath);
		await waitForWorker(
			page,
			(next) =>
				next.projectDirty === "false" &&
				next.projectOperation === "idle" &&
				next.authoredEdges === "0",
			{ timeout: 30_000 },
		);
		await assertSessionPhase(
			canvas,
			"",
			`${label} project open cancels active session immediately`,
		);
		await waitForMission(panel, "first-rail");
		await entry.waitFor({ state: "visible" });
		await entry.focus();
		await entry.press("Enter");
		await assertCanvasFocused(canvas, `${label} project-open restart focus handoff`);

		const missionHelp = panel.getByTestId("guided-build-command-help");
		await missionHelp.focus();
		await missionHelp.press("Enter");
		const missionHelpPanel = panel.getByTestId("guided-build-mission-help");
		await missionHelpPanel.waitFor({ state: "visible" });
		const missionHelpText = (await missionHelpPanel.textContent()) ?? "";
		if (!missionHelpText.includes("방향키로 시작점을 1미터씩")) {
			throw new Error(`${label} active keyboard help does not explain keyboard start movement.`);
		}
		if (missionHelpText.includes("현재 도구 드래그")) {
			throw new Error(`${label} active keyboard help still advertises pointer drag.`);
		}
		await missionHelp.press("Enter");
		await missionHelpPanel.waitFor({ state: "hidden" });
		await canvas.focus();
		await assertRepeatBurstCoalesces(page, canvas, `${label} held-key repeat`);
		await canvas.press("Escape");
		await assertSessionPhase(canvas, "", `${label} repeat-probe cancellation`);
		await entry.waitFor({ state: "visible" });
		await entry.focus();
		await entry.press("Enter");
		await assertCanvasFocused(canvas, `${label} repeat-probe restart focus handoff`);

		let metrics = await readMetrics(page);
		metrics = await commitLeg(
			page,
			metrics,
			[
				"ArrowRight",
				"Shift+ArrowRight",
				"Shift+ArrowRight",
				"ArrowRight",
				"ArrowRight",
				"ArrowRight",
				"ArrowRight",
			],
			"first straight",
		);
		assertEqual(metrics.authoredEdges, "15", `${label} first straight edges`);
		await waitForMission(panel, "process-loop");
		await assertGuidedCanvasPrimaryTarget(page, `${label} process-loop entry`);
		metrics = await commitLeg(
			page,
			metrics,
			["Shift+ArrowDown", "ArrowDown", "ArrowDown"],
			"right side",
		);
		await assertGuidedCanvasPrimaryTarget(page, `${label} process-loop right side`);
		metrics = await commitLeg(
			page,
			metrics,
			["Shift+ArrowLeft", "Shift+ArrowLeft", "Shift+ArrowLeft"],
			"return straight",
		);
		await assertGuidedCanvasPrimaryTarget(page, `${label} process-loop return straight`);
		metrics = await commitLeg(page, metrics, ["Shift+ArrowUp", "ArrowUp", "ArrowUp"], "left side");

		assertEqual(metrics.modelSequence, "4", `${label} canonical patch sequence`);
		assertEqual(metrics.workerSequence, "4", `${label} Worker patch sequence`);
		assertEqual(metrics.authoredEdges, "44", `${label} loop edges`);
		assertEqual(metrics.openTerminals, "0", `${label} loop open terminals`);
		assertEqual(metrics.strongComponents, "1", `${label} loop strong components`);
		assertEqual(metrics.readinessReady, "true", `${label} loop readiness`);
		assertEqual(metrics.workerChecksum, metrics.modelChecksum, `${label} model/Worker checksum`);
		assertEqual(
			metrics.workerChecksum,
			metrics.workerTargetChecksum,
			`${label} target/Worker checksum`,
		);
		assertEqual(metrics.workerSimulationReady, "false", `${label} simulation gate`);
		assertEqual(metrics.modelCanUndo, "true", `${label} document owns committed undo history`);
		assertEqual(metrics.keyboardPhase, "", `${label} completed keyboard session`);
		if (!metrics.cursorReadout.startsWith("X ")) {
			throw new Error(
				`${label} keyboard cursor residue: ${JSON.stringify(metrics.cursorReadout)}.`,
			);
		}
		await page.getByTestId("guided-build-chapter-checkpoint").waitFor({ state: "visible" });
		await page.waitForFunction(
			() =>
				(document
					.querySelector('[data-testid="rail-canvas"]')
					?.getAttribute("data-fitted-map-bounds") ?? "") !== "",
			undefined,
			{ timeout: 10_000 },
		);
		metrics = await readMetrics(page);
		assertEqual(
			await panel.getAttribute("data-chapter-checkpoint"),
			"quick-start",
			`${label} chapter checkpoint`,
		);
		if (!metrics.statusText.includes("Process Loop 완료")) {
			throw new Error(`${label} stale completion status: ${JSON.stringify(metrics.statusText)}.`);
		}
		await assertNoHorizontalOverflow(page, `${label} completed loop`);
		await page.screenshot({
			path: path.join(artifactRoot, `keyboard-loop-${label}.png`),
			fullPage: true,
		});

		const saved = metrics;
		const projectTrigger = page.locator(".tilefab-project-trigger");
		await projectTrigger.focus();
		await projectTrigger.press("Enter");
		const projectMenu = page.locator("#tilefab-project-menu");
		await waitForProjectMenuReady(page, projectMenu, `${label} final save menu`);
		const saveAction = projectMenu.getByRole("button", {
			name: "프로젝트 파일 저장 (.openfab)",
			exact: true,
		});
		assertEqual(await saveAction.isEnabled(), true, `${label} save action enabled`);
		await saveAction.focus();
		await assertLocatorFocused(saveAction, `${label} final save focus`);
		const [download] = await Promise.all([
			page.waitForEvent("download"),
			saveAction.press("Enter"),
		]);
		const savedPath = await download.path();
		if (!savedPath) throw new Error(`${label} saved download has no path.`);
		await waitForWorker(
			page,
			(next) =>
				next.projectDirty === "false" &&
				next.projectOperation === "idle" &&
				next.workerChecksum === saved.workerChecksum,
		);

		await projectTrigger.focus();
		await projectTrigger.press("Enter");
		await waitForProjectMenuReady(page, projectMenu, `${label} final open menu`);
		const openAction = projectMenu.getByRole("button", { name: "열기", exact: true });
		assertEqual(await openAction.isEnabled(), true, `${label} final open enabled`);
		await openAction.focus();
		await assertLocatorFocused(openAction, `${label} final open focus`);
		const chooserPromise = page.waitForEvent("filechooser");
		await openAction.press("Enter");
		const chooser = await chooserPromise;
		await chooser.setFiles(savedPath);
		const reopened = await waitForWorker(
			page,
			(next) =>
				next.projectDirty === "false" &&
				next.projectOperation === "idle" &&
				next.projectId === saved.projectId &&
				next.workerChecksum === saved.workerChecksum &&
				next.modelChecksum === saved.modelChecksum &&
				next.modelSequence === saved.modelSequence &&
				next.workerTargetSequence === saved.workerTargetSequence &&
				next.workerSequence === saved.workerSequence,
			{ timeout: 30_000 },
		);
		assertEqual(reopened.authoredEdges, "44", `${label} reopen edges`);
		assertEqual(reopened.openTerminals, "0", `${label} reopen open terminals`);
		assertEqual(reopened.strongComponents, "1", `${label} reopen strong components`);
		assertEqual(reopened.readinessReady, "true", `${label} reopen readiness`);
		assertEqual(reopened.workerSimulationReady, "false", `${label} reopen simulation gate`);
		assertEqual(reopened.modelSequence, "4", `${label} reopen document patch sequence`);
		assertEqual(reopened.workerTargetSequence, "4", `${label} reopen Worker target sequence`);
		assertEqual(reopened.workerSequence, "4", `${label} reopen Worker applied sequence`);
		await assertNoHorizontalOverflow(page, `${label} reopened project`);
		await page.screenshot({
			path: path.join(artifactRoot, `keyboard-reopen-${label}.png`),
			fullPage: true,
		});

		const inputCounts = await page.evaluate(() => window.__openFabInputCounts);
		for (const [eventType, count] of Object.entries(inputCounts)) {
			assertEqual(count, 0, `${label} ${eventType} count`);
		}
		if (runtimeErrors.length > 0) {
			throw new Error(`${label} browser runtime errors: ${JSON.stringify(runtimeErrors)}`);
		}
		return {
			viewport: label,
			commits: Number(reopened.workerSequence),
			edges: Number(reopened.authoredEdges),
			checksum: reopened.workerChecksum,
			inputCounts,
			reopened: true,
		};
	} catch (error) {
		if (page) {
			await page
				.screenshot({ path: path.join(artifactRoot, `failure-${label}.png`), fullPage: true })
				.catch(() => undefined);
		}
		throw error;
	} finally {
		await closeBrowserResource(context, `context ${label}`);
	}
}

async function commitLeg(page, before, movements, label) {
	const canvas = page.getByTestId("rail-canvas");
	await assertSessionPhase(canvas, "choose-start", `${label} start phase`);
	await canvas.press("Enter");
	await assertSessionPhase(canvas, "choose-end", `${label} endpoint phase`);
	await assertAccessibleRailReadout(
		page,
		["끝점 단계", "시작점 기준 0미터", "배치 불가"],
		`${label} zero-length readout`,
	);
	const invalidBefore = await readMetrics(page);
	await canvas.press("Enter");
	await assertSessionPhase(canvas, "choose-end", `${label} invalid Enter retains endpoint phase`);
	await assertCanvasFocused(canvas, `${label} invalid Enter retains canvas focus`);
	const invalidAfter = await readMetrics(page);
	for (const sequenceField of ["modelSequence", "workerTargetSequence", "workerSequence"]) {
		assertEqual(
			invalidAfter[sequenceField],
			invalidBefore[sequenceField],
			`${label} invalid Enter preserves ${sequenceField}`,
		);
	}
	let expectedLength = 0;
	for (const movement of movements) {
		expectedLength += movement.startsWith("Shift+") ? 5 : 1;
		await canvas.press(movement);
		const readout = await assertAccessibleRailReadout(
			page,
			["끝점 단계", `시작점 기준 ${expectedLength}미터`, "배치 가능"],
			`${label} ${movement} readout`,
		);
		await assertGuidedRailAnnouncement(page, readout, `${label} ${movement} announcement`);
	}
	const expectedSequence = Number(before.workerTargetSequence) + 1;
	await canvas.press("Enter");
	const committed = await waitForWorker(
		page,
		(metrics) =>
			Number(metrics.workerTargetSequence) === expectedSequence &&
			Number(metrics.workerSequence) === expectedSequence,
	);
	assertEqual(Number(committed.modelSequence), expectedSequence, `${label} model sequence delta`);
	assertEqual(committed.workerChecksum, committed.modelChecksum, `${label} checksum parity`);
	assertEqual(committed.workerSimulationReady, "false", `${label} simulation gate`);
	return committed;
}

async function waitForMission(panel, mission) {
	await panel
		.page()
		.waitForFunction(
			({ selector, missionId }) =>
				document.querySelector(selector)?.getAttribute("data-current-mission") === missionId,
			{ selector: '[data-testid="guided-build-panel"]', missionId: mission },
			{ timeout: 10_000 },
		);
}

async function assertCanvasFocused(canvas, label) {
	await canvas
		.page()
		.waitForFunction(
			() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
			undefined,
			{ timeout: 10_000 },
		);
	assertEqual(await canvas.evaluate((element) => element === document.activeElement), true, label);
}

async function assertGuidedCanvasPrimaryTarget(page, label) {
	await page.waitForFunction(
		() => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			return (
				app?.getAttribute("data-guided-primary-target") === "canvas:rail" &&
				canvas?.getAttribute("data-guided-action-id") === "canvas:rail" &&
				canvas?.getAttribute("data-guided-target") === "true" &&
				document.querySelectorAll('[data-guided-target="true"]').length === 1
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	const target = page.getByTestId("rail-canvas");
	const contract = await target.evaluate((element) => {
		const bounds = element.getBoundingClientRect();
		const hitOwned = [
			[0.5, 0.5],
			[0.25, 0.65],
			[0.75, 0.65],
			[0.5, 0.82],
		].some(([xRatio, yRatio]) => {
			const hit = document.elementFromPoint(
				bounds.left + bounds.width * xRatio,
				bounds.top + bounds.height * yRatio,
			);
			return hit === element || (hit !== null && element.contains(hit));
		});
		return {
			ariaDisabled: element.getAttribute("aria-disabled"),
			describedBy: element.getAttribute("aria-describedby") ?? "",
			hitOwned,
			tabIndex: element.tabIndex,
		};
	});
	assertEqual(contract.ariaDisabled === "true", false, `${label} Canvas is actionable`);
	if (!contract.describedBy.includes("tilefab-guided-primary-target-description")) {
		throw new Error(`${label} Canvas does not own the Guided primary instruction.`);
	}
	if (contract.tabIndex < 0) throw new Error(`${label} Canvas is not keyboard focusable.`);
	assertEqual(contract.hitOwned, true, `${label} Canvas owns a visible hit-test point`);
}

async function assertGuidedPrimaryTargetWaiting(page, operation, label) {
	await page.waitForFunction(
		(expectedOperation) => {
			const app = document.querySelector('[data-testid="tilefab-app"]');
			const panel = document.querySelector('[data-testid="guided-build-panel"]');
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			const waiting =
				app?.getAttribute("data-project-operation") === expectedOperation &&
				app.getAttribute("data-guided-primary-target") === "" &&
				document.querySelectorAll('[data-guided-target="true"]').length === 0 &&
				document.querySelector('[data-testid="guided-build-suggested-action"]') === null &&
				(panel?.textContent?.includes("프로젝트 작업을 마치는 중입니다") ?? false);
			if (!waiting || !(canvas instanceof HTMLCanvasElement)) return false;
			const readout = document.querySelector('[data-testid="guided-rail-keyboard-readout"]');
			const beforeReadout = readout?.textContent ?? "";
			canvas.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowRight",
					code: "ArrowRight",
					bubbles: true,
					cancelable: true,
				}),
			);
			canvas.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "Enter",
					code: "Enter",
					bubbles: true,
					cancelable: true,
				}),
			);
			window.__openFabGuidedWaitingProbe = {
				applyDisabled:
					document
						.querySelector('[data-testid="guided-build-keyboard-rail-apply"]')
						?.hasAttribute("disabled") ?? false,
				ariaDisabled: canvas.getAttribute("aria-disabled"),
				beforeReadout,
				afterReadout: readout?.textContent ?? "",
			};
			return true;
		},
		operation,
		{ timeout: 10_000 },
	);
	assertEqual(
		await page.locator('[data-guided-target="true"]').count(),
		0,
		`${label} has no stale owner`,
	);
	const probe = await page.evaluate(() => window.__openFabGuidedWaitingProbe);
	assertEqual(probe?.applyDisabled, true, `${label} disables Guided apply`);
	assertEqual(probe?.ariaDisabled, "true", `${label} exposes Canvas aria-disabled`);
	assertEqual(probe?.afterReadout, probe?.beforeReadout, `${label} blocks Canvas key input`);
	await page.waitForFunction(
		() => document.activeElement?.getAttribute("data-testid") === "rail-canvas",
		undefined,
		{ timeout: 10_000 },
	);
}

async function assertLocatorFocused(locator, label) {
	assertEqual(await locator.evaluate((element) => element === document.activeElement), true, label);
}

async function waitForProjectMenuReady(page, menu, label) {
	await menu.waitFor({ state: "visible" });
	await page.waitForFunction(
		() =>
			document.activeElement instanceof HTMLButtonElement &&
			document.activeElement.closest("#tilefab-project-menu") !== null,
		undefined,
		{ timeout: 10_000 },
	);
	if (!(await menu.evaluate((element) => element.contains(document.activeElement)))) {
		throw new Error(`${label} did not receive its initial focus handoff.`);
	}
}

async function assertSessionPhase(canvas, expected, label) {
	await canvas
		.page()
		.waitForFunction(
			({ expectedPhase }) =>
				document
					.querySelector('[data-testid="rail-canvas"]')
					?.getAttribute("data-guided-rail-keyboard") === expectedPhase,
			{ expectedPhase: expected },
			{ timeout: 10_000 },
		);
	assertEqual(await canvas.getAttribute("data-guided-rail-keyboard"), expected, label);
}

async function assertMinimumTarget(locator, minimum, label) {
	const target = await locator.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const hit = document.elementFromPoint(centerX, centerY);
		return {
			width: rect.width,
			height: rect.height,
			insideViewport:
				rect.left >= 0 &&
				rect.top >= 0 &&
				rect.right <= window.innerWidth &&
				rect.bottom <= window.innerHeight,
			centerHit: hit !== null && (hit === element || element.contains(hit)),
		};
	});
	if (target.height < minimum || target.width < minimum) {
		throw new Error(
			`${label} is ${target.width}x${target.height}; expected at least ${minimum}x${minimum}.`,
		);
	}
	if (!target.insideViewport || !target.centerHit) {
		throw new Error(`${label} is clipped or its center is not the topmost interactive target.`);
	}
}

async function assertAccessibleRailReadout(page, expectedParts, label) {
	const readout = page.getByTestId("guided-rail-keyboard-readout");
	await page.waitForFunction(
		({ selector, parts }) => {
			const text = document.querySelector(selector)?.textContent?.trim() ?? "";
			return parts.every((part) => text.includes(part));
		},
		{ selector: '[data-testid="guided-rail-keyboard-readout"]', parts: expectedParts },
		{ timeout: 10_000 },
	);
	const text = (await readout.textContent())?.trim() ?? "";
	for (const part of expectedParts) {
		if (!text.includes(part)) {
			throw new Error(`${label} is missing ${JSON.stringify(part)}: ${JSON.stringify(text)}.`);
		}
	}
	return text;
}

async function assertGuidedRailAnnouncement(page, expected, label) {
	await page.waitForFunction(
		({ selector, expectedText }) =>
			document.querySelector(selector)?.textContent?.trim() === expectedText,
		{
			selector: '[data-testid="guided-rail-keyboard-announcement"]',
			expectedText: expected,
		},
		{ timeout: 10_000 },
	);
	assertEqual(
		(await page.getByTestId("guided-rail-keyboard-announcement").textContent())?.trim() ?? "",
		expected,
		label,
	);
}

async function assertRepeatBurstCoalesces(page, canvas, label) {
	await canvas.press("Enter");
	await assertSessionPhase(canvas, "choose-end", `${label} endpoint phase`);
	await canvas.press("ArrowRight");
	const validReadout = await assertAccessibleRailReadout(
		page,
		["시작점 기준 1미터", "배치 가능"],
		`${label} stable validity`,
	);
	await assertGuidedRailAnnouncement(page, validReadout, `${label} initial announcement`);
	await page.evaluate(() => {
		const canvasElement = document.querySelector('[data-testid="rail-canvas"]');
		const announcement = document.querySelector(
			'[data-testid="guided-rail-keyboard-announcement"]',
		);
		if (!(canvasElement instanceof HTMLCanvasElement) || !(announcement instanceof HTMLElement)) {
			throw new Error("Guided repeat probe targets are unavailable.");
		}
		const probe = { count: 0, observer: null };
		probe.observer = new MutationObserver(() => {
			probe.count += 1;
		});
		probe.observer.observe(announcement, { childList: true, characterData: true, subtree: true });
		window.__openFabGuidedRepeatProbe = probe;
		for (let index = 0; index < 3; index++) {
			canvasElement.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "ArrowRight",
					code: "ArrowRight",
					bubbles: true,
					cancelable: true,
					repeat: true,
				}),
			);
		}
	});
	await page.waitForTimeout(90);
	assertEqual(
		await page.evaluate(() => window.__openFabGuidedRepeatProbe?.count ?? -1),
		0,
		`${label} remains silent before debounce`,
	);
	await page.waitForFunction(() => window.__openFabGuidedRepeatProbe?.count === 1, undefined, {
		timeout: 1_000,
	});
	await assertAccessibleRailReadout(
		page,
		["시작점 기준 4미터", "배치 가능"],
		`${label} final repeat readout`,
	);
	const finalAnnouncement =
		(await page.getByTestId("guided-rail-keyboard-announcement").textContent())?.trim() ?? "";
	if (!finalAnnouncement.includes("시작점 기준 4미터")) {
		throw new Error(`${label} did not announce the final repeat endpoint.`);
	}
	assertEqual(
		await page.evaluate(() => {
			const probe = window.__openFabGuidedRepeatProbe;
			probe?.observer?.disconnect();
			const count = probe?.count ?? -1;
			delete window.__openFabGuidedRepeatProbe;
			return count;
		}),
		1,
		`${label} publishes one coalesced announcement`,
	);
}

async function assertNoHorizontalOverflow(page, label) {
	const overflow = await page.evaluate(() => ({
		viewport: window.innerWidth,
		document: document.documentElement.scrollWidth,
		body: document.body.scrollWidth,
	}));
	if (overflow.document > overflow.viewport || overflow.body > overflow.viewport) {
		throw new Error(`${label} horizontal overflow: ${JSON.stringify(overflow)}.`);
	}
}

async function waitForWorker(page, predicate, options = {}) {
	const timeout = options.timeout ?? 15_000;
	const deadline = Date.now() + timeout;
	let metrics = await readMetrics(page);
	while (Date.now() < deadline) {
		if (metrics.workerStatus === "ready" && predicate(metrics)) return metrics;
		await page.waitForTimeout(50);
		metrics = await readMetrics(page);
	}
	throw new Error(`Worker condition timed out: ${JSON.stringify(metrics)}.`);
}

async function readMetrics(page) {
	return page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const model = window.__tileFab?.getEditorModel?.();
		const worker = window.__tileFab?.getWorkerState?.();
		return {
			projectId: canvas?.dataset.projectId ?? "",
			projectDirty: canvas?.dataset.projectDirty ?? "",
			projectOperation: app?.dataset.projectOperation ?? "",
			authoredEdges: canvas?.dataset.authoredEdges ?? "",
			modelSequence: String(model?.document?.getPatchSequence?.() ?? ""),
			modelCanUndo: String(model?.document?.canUndo ?? ""),
			modelChecksum: model?.authoredChecksum ?? "",
			workerStatus: canvas?.dataset.workerStatus ?? "",
			workerTargetSequence: canvas?.dataset.workerTargetSequence ?? "",
			workerTargetChecksum: canvas?.dataset.workerTargetChecksum ?? "",
			workerSequence: canvas?.dataset.workerSequence ?? "",
			workerChecksum: canvas?.dataset.workerChecksum ?? "",
			workerSimulationReady: String(worker?.simulationReady ?? ""),
			readinessReady: canvas?.dataset.readinessReady ?? "",
			strongComponents: canvas?.dataset.readinessStrongComponents ?? "",
			openTerminals: canvas?.dataset.readinessOpenTerminals ?? "",
			keyboardPhase: canvas?.dataset.guidedRailKeyboard ?? "",
			cursorReadout:
				document.querySelector('[data-testid="rail-cursor-readout"]')?.textContent?.trim() ?? "",
			statusText:
				document.querySelector('.tilefab-statusbar [role="status"]')?.textContent?.trim() ?? "",
		};
	});
}

async function auditKeyboardOnlySource() {
	const source = await readFile(scriptPath, "utf8");
	for (const forbidden of ["page" + ".mouse", "." + "click()", "touchscreen" + ".", "." + "tap("]) {
		if (source.includes(forbidden))
			throw new Error(`Keyboard acceptance contains forbidden input token: ${forbidden}`);
	}
}

function assertEqual(actual, expected, label) {
	if (actual !== expected) {
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
		);
	}
}

function startPreviewServer() {
	const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
	const child = spawn(
		process.execPath,
		[vite, "preview", "--host", host, "--port", String(port), "--strictPort"],
		{
			cwd: root,
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	child.stderr.on("data", (chunk) => process.stderr.write(chunk));
	return child;
}

async function waitForServer(url, child) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(`Guided Rail preview exited before readiness with code ${child.exitCode}.`);
		}
		let response;
		try {
			response = await fetch(url);
		} catch {
			// Preview is still starting.
		}
		if (response?.ok) {
			await new Promise((resolve) => setTimeout(resolve, 150));
			if (child.exitCode !== null) {
				throw new Error(
					`Guided Rail preview exited during ownership check with code ${child.exitCode}.`,
				);
			}
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Guided Rail keyboard preview did not start at ${url}.`);
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
	throw new Error("Chrome or Chromium is required for Guided Rail keyboard acceptance.");
}

async function closeBrowserResource(resource, label) {
	if (!resource) return;
	let timeout;
	try {
		await Promise.race([
			resource.close(),
			new Promise((_, reject) => {
				timeout = setTimeout(() => reject(new Error(`${label} close timed out.`)), 10_000);
			}),
		]);
	} catch (error) {
		console.warn(error instanceof Error ? error.message : String(error));
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}
