import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { identity, openFile, point, projectAction } from "./rail-capacity-project-acceptance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Own synthetic native inputs; all authored edits use ordinary pointer/history/file controls. */
export async function exerciseRailCoordinateProject(page, artifactRoot) {
	const fixture = await createFixtures(artifactRoot);
	const errors = [];
	const onError = (error) => errors.push(String(error));
	page.on("pageerror", onError);
	try {
		await openFile(page, fixture.file);
		await waitForReady(page, fixture.checksum, 9);
		const before = await identity(page);
		await rejectExtension(
			page,
			fixture.bound,
			path.join(artifactRoot, "coordinate-rejected-preview.png"),
		);
		await page.keyboard.press("Escape");
		await page.getByRole("button", { name: "레일 건설", exact: true }).click();
		const start = await point(page, { x: fixture.bound - 1.5, y: 5.5 });
		const end = await point(page, { x: fixture.bound - 0.5, y: 5.5 });
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(end.x, end.y, { steps: 8 });
		await page.waitForFunction(
			() =>
				document.querySelector('[data-testid="rail-canvas"]')?.dataset.draftPreviewValid === "true",
		);
		await page.mouse.up();
		await waitForReady(page, null, 11);
		const added = await identity(page);
		assert.equal(Number(added.sequence), Number(before.sequence) + 1);
		await page.getByRole("button", { name: "실행 취소", exact: true }).click();
		await waitForReady(page, before.checksum, 9);
		await page.getByRole("button", { name: "다시 실행", exact: true }).click();
		await waitForReady(page, added.checksum, 11);
		await page.getByRole("button", { name: "실행 취소", exact: true }).click();
		await waitForReady(page, before.checksum, 9);
		const beforeInvalidFile = await identity(page);
		assert.equal(beforeInvalidFile.redo, "true");
		await openFile(page, fixture.invalidFile);
		await page.getByText(/기존 프로젝트 유지/).waitFor({ state: "visible" });
		await page.waitForFunction(
			() => document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle",
		);
		assert.match(await page.getByText(/기존 프로젝트 유지/).innerText(), /지원 범위/);
		assert.deepEqual(await identity(page), beforeInvalidFile);
		await page.screenshot({
			path: path.join(artifactRoot, "coordinate-unsupported-file.png"),
			fullPage: true,
		});
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
		await page.waitForFunction(() => {
			const data = document.querySelector('[data-testid="rail-canvas"]')?.dataset;
			return (
				data?.workerStatus === "ready" &&
				data.modelSyncPending === "false" &&
				data.physicalPaths === "0" &&
				data.projectId !== "synthetic-coordinate-boundary"
			);
		});
		await openFile(page, savedPath);
		await waitForReady(page, fixture.checksum, 9);
		const reopened = await identity(page);
		assert.equal(reopened.fingerprint, beforeInvalidFile.fingerprint);
		assert.equal(reopened.undo, "false");
		assert.equal(reopened.redo, "false");
		assert.equal(reopened.dirty, "false");
		assert.equal(reopened.simulationReady, "false");
		await page.setViewportSize({ width: 390, height: 600 });
		await rejectExtension(
			page,
			fixture.bound,
			path.join(artifactRoot, "coordinate-compact-preview.png"),
		);
		assert.deepEqual(errors, []);
		return { bound: fixture.bound, before, added, beforeInvalidFile, reopened, errors };
	} finally {
		page.off("pageerror", onError);
	}
}

async function rejectExtension(page, bound, screenshot) {
	const before = await identity(page);
	await page.getByTestId("editor-activity-build").click();
	await page.getByRole("button", { name: "레일 건설", exact: true }).click();
	const start = await point(page, { x: bound + 0.5, y: 0.5 });
	const end = await point(page, { x: bound + 1.5, y: 0.5 });
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(end.x, end.y, { steps: 8 });
	await page.waitForFunction(() => {
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		const preview = document.querySelector(".tilefab-status-preview");
		return (
			canvas?.dataset.draftPreviewValid === "false" && preview?.textContent?.includes("지원 범위")
		);
	});
	await page.screenshot({ path: screenshot, fullPage: true });
	await page.mouse.up();
	assert.match(
		(await page.locator(".tilefab-statusbar [role='status']").textContent()) ?? "",
		/지원 범위/,
	);
	assert.deepEqual(await identity(page), before);
}

async function createFixtures(directory) {
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
		const { RAIL_COORDINATE_MAX_METERS: bound } = await source.ssrLoadModule(
			"/src/tilefab/core/RailCoordinateDomain.ts",
		);
		const { captureOpenFabProjectFromRailSnapshot, createOpenFabProjectManifest } =
			await source.ssrLoadModule("/src/tilefab/project/OpenFabProject.ts");
		const { serializeOpenFabProject } = await source.ssrLoadModule(
			"/src/tilefab/project/OpenFabProjectCodec.ts",
		);
		const { captureRailMirrorSnapshot, checksumRailMap } = await source.ssrLoadModule(
			"/src/tilefab/worker/RailMirrorChecksum.ts",
		);
		const document = new RailDocument();
		assert.equal(
			document.commit(
				planRailConstruction(document.map, { x: bound - 8, y: 0 }, { x: bound, y: 0 }),
			),
			true,
		);
		const invalid = document.map.clone();
		invalid.setEncoded(bound, 0, 0x28);
		invalid.setEncoded(bound + 1, 0, 0x08);
		const file = path.join(directory, "synthetic-coordinate.openfab");
		const invalidFile = path.join(directory, "synthetic-unsupported-coordinate.openfab");
		for (const [map, target, id] of [
			[document.map, file, "synthetic-coordinate-boundary"],
			[invalid, invalidFile, "synthetic-unsupported-coordinate"],
		]) {
			const project = captureOpenFabProjectFromRailSnapshot(
				captureRailMirrorSnapshot(map, 0).snapshot,
				{
					manifest: createOpenFabProjectManifest(
						id,
						"Synthetic coordinate boundary",
						"2026-09-25T00:00:00.000Z",
					),
					view: {
						center: [bound + 0.5, 2.5],
						zoomPixelsPerMeter: 38,
						quarterTurns: 0,
						railPresentation: "profiled",
					},
				},
			);
			await writeFile(target, serializeOpenFabProject(project));
		}
		return { file, invalidFile, bound, checksum: checksumRailMap(document.map) };
	} finally {
		await source.close();
	}
}

async function waitForReady(page, checksum, paths) {
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
				data.projectId === "synthetic-coordinate-boundary" &&
				data.physicalPaths === String(expected.paths) &&
				(!expected.checksum || data.workerChecksum === expected.checksum) &&
				document.querySelector(".tilefab-app")?.dataset.projectOperation === "idle"
			);
		},
		{ checksum, paths },
		{ timeout: 20_000 },
	);
}
