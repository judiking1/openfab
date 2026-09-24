import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Real file-adapter/pointer/history workflow; diagnostics only read identity and camera. */
export async function exerciseRailCapacityProject(page, artifactRoot) {
	const fixture = await createFixture(artifactRoot);
	const canvas = page.getByTestId("rail-canvas");
	const errors = [];
	const onError = (error) => errors.push(String(error));
	page.on("pageerror", onError);
	try {
		await openFile(page, fixture.file);
		await waitForIdentity(page, fixture.checksum, fixture.cells);
		const before = await identity(page);
		assert.equal(before.dirty, "false");
		assert.equal(before.undo, "false");
		assert.equal(before.redo, "false");
		await rejectCapacityExtension(page, path.join(artifactRoot, "capacity-rejected-preview.png"));
		// An isolated 1m rail has two terminal sources and zero LINEAR equipment rows.
		// It must remain editable even when the long rail already fills the row budget.
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "레일 건설", exact: true }).click();
		const legalStart = await point(page, { x: 0.5, y: 5.5 });
		const legalEnd = await point(page, { x: 1.5, y: 5.5 });
		await page.mouse.move(legalStart.x, legalStart.y);
		await page.mouse.down();
		await page.mouse.move(legalEnd.x, legalEnd.y, { steps: 8 });
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="rail-canvas"]')?.dataset.draftPreviewValid === "true",
			undefined,
			{ timeout: 10_000 },
		);
		await page.mouse.up();
		await waitForIdentity(page, null, fixture.cells + 2);
		const added = await identity(page);
		assert.equal(Number(added.sequence), Number(before.sequence) + 1);
		await page.getByRole("button", { name: "실행 취소", exact: true }).click();
		await waitForIdentity(page, fixture.checksum, fixture.cells);
		assert.equal((await identity(page)).redo, "true");
		await page.getByRole("button", { name: "다시 실행", exact: true }).click();
		await waitForIdentity(page, added.checksum, fixture.cells + 2);
		await page.getByRole("button", { name: "실행 취소", exact: true }).click();
		await waitForIdentity(page, fixture.checksum, fixture.cells);
		const beforeSave = await identity(page);
		const downloadPromise = page.waitForEvent("download");
		await projectAction(page, "프로젝트 저장");
		const download = await downloadPromise;
		const savedPath = await download.path();
		assert.ok(savedPath);
		await page.waitForFunction(
			() => document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle",
		);
		await projectAction(page, "새 프로젝트");
		await page.getByTestId("synthetic-fab-starter-dialog").waitFor({ state: "visible" });
		await page.getByTestId("synthetic-fab-starter-blank").click();
		await page.getByTestId("create-synthetic-fab-project").click();
		await page.waitForFunction(
			() => {
				const data = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
				return (
					data?.workerStatus === "ready" &&
					data.modelSyncPending === "false" &&
					data.physicalPaths === "0" &&
					data.projectId !== "synthetic-capacity-boundary"
				);
			},
			undefined,
			{ timeout: 20_000 },
		);
		await openFile(page, savedPath);
		await waitForIdentity(page, fixture.checksum, fixture.cells);
		const reopened = await identity(page);
		assert.equal(reopened.fingerprint, beforeSave.fingerprint);
		assert.equal(reopened.undo, "false");
		assert.equal(reopened.redo, "false");
		assert.equal(reopened.dirty, "false");
		assert.equal(reopened.simulationReady, "false");
		assert.deepEqual(errors, []);
		await canvas.screenshot({ path: path.join(artifactRoot, "capacity-reopened.png") });
		await page.setViewportSize({ width: 390, height: 600 });
		await rejectCapacityExtension(page, path.join(artifactRoot, "capacity-compact-preview.png"));
		assert.deepEqual(errors, []);
		return { sourceCells: fixture.cells, before, added, beforeSave, reopened, errors };
	} finally {
		page.off("pageerror", onError);
	}
}

async function rejectCapacityExtension(page, screenshot) {
	const before = await identity(page);
	await page.getByTestId("editor-activity-build").click();
	await page.getByRole("button", { name: "레일 건설", exact: true }).click();
	const start = await point(page, { x: 0.5, y: 0.5 });
	const end = await point(page, { x: 1.5, y: 0.5 });
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 8 });
	await page.waitForFunction(
		() => {
			const canvas = document.querySelector('[data-testid="rail-canvas"]');
			// Compact chrome hides status text; the canvas callout is checked in screenshots/render tests.
			const preview = document.querySelector(".tilefab-status-preview");
			return (
				canvas?.dataset.draftPreviewValid === "false" && preview?.textContent?.includes("204,098")
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	await page.screenshot({ path: screenshot, fullPage: true });
	await page.mouse.up();
	assert.match(
		(await page.locator(".tilefab-statusbar [role='status']").textContent()) ?? "",
		/204,098/,
	);
	assert.deepEqual(await identity(page), before);
}

async function createFixture(directory) {
	const source = await createServer({
		root,
		configFile: false,
		appType: "custom",
		logLevel: "error",
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true },
	});
	try {
		const { RailDocument } = await source.ssrLoadModule("/src/tilefab/core/RailDocument.ts");
		const { planRailConstruction } = await source.ssrLoadModule("/src/tilefab/core/paint.ts");
		const { PORT_SLOT_MAX_ROWS } = await source.ssrLoadModule(
			"/src/tilefab/core/PortSlotPolicy.ts",
		);
		const { captureOpenFabProject, createOpenFabProjectManifest } = await source.ssrLoadModule(
			"/src/tilefab/project/OpenFabProject.ts",
		);
		const { serializeOpenFabProject } = await source.ssrLoadModule(
			"/src/tilefab/project/OpenFabProjectCodec.ts",
		);
		const { checksumRailMap } = await source.ssrLoadModule(
			"/src/tilefab/worker/RailMirrorChecksum.ts",
		);
		const document = new RailDocument();
		const start = -PORT_SLOT_MAX_ROWS / 2 - 1;
		assert.equal(
			document.commit(planRailConstruction(document.map, { x: start, y: 0 }, { x: 0, y: 0 })),
			true,
		);
		const project = captureOpenFabProject(document, {
			manifest: createOpenFabProjectManifest(
				"synthetic-capacity-boundary",
				"Synthetic rail capacity",
				"2026-09-25T00:00:00.000Z",
			),
			view: {
				center: [0.5, 2.5],
				zoomPixelsPerMeter: 38,
				quarterTurns: 0,
				railPresentation: "profiled",
			},
		});
		const file = path.join(directory, "synthetic-capacity.openfab");
		await writeFile(file, serializeOpenFabProject(project));
		return { file, cells: document.map.size, checksum: checksumRailMap(document.map) };
	} finally {
		await source.close();
	}
}

async function projectAction(page, name) {
	const action = page.getByRole("button", { name, exact: true });
	if (!(await action.isVisible()))
		await page.getByRole("button", { name: /^프로젝트 메뉴 ·/ }).click();
	await action.click();
}

async function openFile(page, file) {
	const chooser = page.waitForEvent("filechooser");
	await projectAction(page, "프로젝트 열기");
	const discard = page.getByRole("button", { name: "저장하지 않고 계속", exact: true });
	if (await discard.isVisible()) await discard.click();
	await (await chooser).setFiles(file);
}

async function identity(page) {
	return page.evaluate(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
		const app = document.querySelector(".tilefab-app")?.dataset;
		return {
			checksum: canvas?.workerChecksum,
			fingerprint: canvas?.workerPhysicalFingerprint,
			sequence: canvas?.workerTargetSequence,
			workerSequence: canvas?.workerSequence,
			revision: canvas?.workerTargetRevision,
			workerRevision: canvas?.workerRevision,
			targetChecksum: canvas?.workerTargetChecksum,
			modelGeneration: canvas?.modelGeneration,
			paths: canvas?.physicalPaths,
			dirty: canvas?.projectDirty,
			undo: app?.historyCanUndo,
			redo: app?.historyCanRedo,
			simulationReady: canvas?.workerSimulationReady,
		};
	});
}

async function waitForIdentity(page, checksum, paths) {
	await page.waitForFunction(
		(expected) => {
			const data = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
			return (
				data?.workerStatus === "ready" &&
				data.modelSyncPending === "false" &&
				data.startupStatus === "ready" &&
				data.workerChecksum === data.workerTargetChecksum &&
				data.workerSequence === data.workerTargetSequence &&
				data.workerRevision === data.workerTargetRevision &&
				data.projectId === "synthetic-capacity-boundary" &&
				data.physicalPaths === String(expected.paths) &&
				(!expected.checksum || data.workerChecksum === expected.checksum) &&
				document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle"
			);
		},
		{ checksum, paths },
		{ timeout: 20_000 },
	);
}

async function point(page, world) {
	const box = await page.getByTestId("rail-canvas").boundingBox();
	assert.ok(box);
	const camera = await page.evaluate(() => {
		const current = window.__tileFab?.camera;
		return current
			? { offsetX: current.offsetX, offsetY: current.offsetY, zoom: current.zoom }
			: null;
	});
	assert.ok(camera);
	const result = {
		x: box.x + camera.offsetX + world.x * camera.zoom,
		y: box.y + camera.offsetY + world.y * camera.zoom,
	};
	assert.ok(
		result.x > box.x &&
			result.x < box.x + box.width &&
			result.y > box.y &&
			result.y < box.y + box.height,
		"saved camera exposes ordinary pointer target",
	);
	return result;
}
