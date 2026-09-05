#!/usr/bin/env node

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const outputDirectory = path.join(repositoryRoot, "src/tilefab/generated/synthetic-fab-presets");
const presetSpecifications = Object.freeze([
	Object.freeze({
		requestId: "paired-circulation-fab-52",
		artifactId: "paired-circulation-fab-52.default.v3",
		fileName: "paired-circulation-fab-52.default.v3.json",
		label: "Paired-Circulation Production FAB",
	}),
	Object.freeze({
		requestId: "full-fab-52",
		artifactId: "full-fab-52.default.v2",
		fileName: "full-fab-52.default.v2.json",
		label: "Full Production FAB",
	}),
	Object.freeze({
		requestId: "large-fab-60",
		artifactId: "large-fab-60.default.v2",
		fileName: "large-fab-60.default.v2.json",
		label: "Legacy Large FAB",
	}),
	Object.freeze({
		requestId: "parallel-hall-fab-12",
		artifactId: "parallel-hall-fab-12.default.v2",
		fileName: "parallel-hall-fab-12.default.v2.json",
		label: "Parallel Hall FAB",
	}),
	Object.freeze({
		requestId: "central-spine-fab-24",
		artifactId: "central-spine-fab-24.default.v2",
		fileName: "central-spine-fab-24.default.v2.json",
		label: "Central Spine FAB",
	}),
	Object.freeze({
		requestId: "production-fab-60",
		artifactId: "production-fab-60.default.v2",
		fileName: "production-fab-60.default.v2.json",
		label: "Production FAB",
	}),
]);
const temporaryPaths = presetSpecifications.map((specification) =>
	path.join(outputDirectory, `${specification.fileName}.tmp`),
);

const vite = await createServer({
	root: repositoryRoot,
	configFile: false,
	appType: "custom",
	logLevel: "error",
	optimizeDeps: { noDiscovery: true },
	server: { middlewareMode: true },
});

try {
	const starterModule = await vite.ssrLoadModule("/src/tilefab/compile/SyntheticFabStarter.ts");
	const previewModule = await vite.ssrLoadModule(
		"/src/tilefab/compile/SyntheticFabStarterPreview.ts",
	);
	const artifactModule = await vite.ssrLoadModule(
		"/src/tilefab/editor/SyntheticFabStarterCertifiedArtifact.ts",
	);

	await mkdir(outputDirectory, { recursive: true });
	const expectedArtifactFiles = new Set(
		presetSpecifications.map((specification) => specification.fileName),
	);
	const unexpectedArtifactFiles = (await readdir(outputDirectory))
		.filter((fileName) => fileName.endsWith(".json") && !expectedArtifactFiles.has(fileName))
		.sort();
	if (unexpectedArtifactFiles.length > 0) {
		throw new Error(
			`Unexpected certified FAB artifacts: ${unexpectedArtifactFiles.join(", ")}. Remove or explicitly register every stale generated file.`,
		);
	}
	const staleArtifacts = [];
	for (const specification of presetSpecifications) {
		const request = starterModule.defaultSyntheticFabStarterRequest(specification.requestId);
		const primary = previewModule.prepareSyntheticFabStarter(request);
		const independent = previewModule.prepareSyntheticFabStarter(request);
		const artifact = artifactModule.createSyntheticFabStarterCertifiedArtifact(
			primary,
			independent,
			request,
		);
		if (artifact.artifactId !== specification.artifactId) {
			throw new Error(`${specification.label} generated an unexpected artifact identity.`);
		}

		const firstRoundTrip = artifactModule.hydrateSyntheticFabStarterCertifiedArtifact(
			artifact,
			request,
		);
		const secondRoundTrip = artifactModule.hydrateSyntheticFabStarterCertifiedArtifact(
			artifact,
			request,
		);
		if (!firstRoundTrip || !secondRoundTrip) {
			throw new Error(`${specification.label} artifact failed hydration.`);
		}
		assertHydratedIdentity(specification.label, primary, firstRoundTrip.prepared);
		assertBufferIsolation(
			`${specification.label} primary/hydrated`,
			primary,
			firstRoundTrip.prepared,
		);
		assertBufferIsolation(
			`${specification.label} hydration/hydration`,
			firstRoundTrip.prepared,
			secondRoundTrip.prepared,
		);
		if (
			(specification.requestId === "paired-circulation-fab-52" ||
				specification.requestId === "full-fab-52" ||
				specification.requestId === "parallel-hall-fab-12" ||
				specification.requestId === "central-spine-fab-24" ||
				specification.requestId === "production-fab-60") &&
			(primary.geometry !== null ||
				primary.exactGeometry !== null ||
				firstRoundTrip.prepared.geometry !== null ||
				firstRoundTrip.prepared.exactGeometry !== null)
		) {
			throw new Error(`${specification.label} certified payload must omit preview geometry.`);
		}

		const outputPath = path.join(outputDirectory, specification.fileName);
		const temporaryPath = `${outputPath}.tmp`;
		const output = `${JSON.stringify(artifact)}\n`;
		let existing = null;
		try {
			existing = await readFile(outputPath, "utf8");
		} catch (error) {
			if (error?.code !== "ENOENT") throw error;
		}
		if (existing !== output) {
			if (checkOnly) {
				staleArtifacts.push(specification.fileName);
			} else {
				await writeFile(temporaryPath, output, "utf8");
				await rename(temporaryPath, outputPath);
			}
		}
		console.log(
			[
				checkOnly
					? `${specification.label} artifact checked`
					: `${specification.label} artifact ready`,
				`${firstRoundTrip.prepared.summary.bayCount} Bays`,
				`${firstRoundTrip.prepared.steps.length} steps`,
				`${firstRoundTrip.prepared.summary.railCells} cells`,
				`${artifact.payloadByteLength} payload bytes`,
				`${artifact.typedArrayByteLength} typed bytes`,
			].join(" | "),
		);
	}
	if (staleArtifacts.length > 0) {
		throw new Error(
			`Certified FAB artifacts are stale: ${staleArtifacts.join(", ")}. Run npm run generate:certified-presets.`,
		);
	}
} finally {
	await Promise.all(temporaryPaths.map((temporaryPath) => rm(temporaryPath, { force: true })));
	await vite.close();
}

function assertHydratedIdentity(label, expected, actual) {
	if (
		actual.authoredChecksum !== expected.authoredChecksum ||
		actual.physicalFingerprint !== expected.physicalFingerprint ||
		actual.requestFingerprint !== expected.requestFingerprint ||
		actual.planFingerprint !== expected.planFingerprint ||
		actual.steps.length !== expected.steps.length
	) {
		throw new Error(`${label} artifact failed materialization identity verification.`);
	}
}

function assertBufferIsolation(label, first, second) {
	const firstViews = collectTypedViews(first);
	const secondViews = collectTypedViews(second);
	if (firstViews.size === 0 || firstViews.size !== secondViews.size) {
		throw new Error(`${label} typed-array shape does not match.`);
	}
	for (const [viewPath, firstView] of firstViews) {
		const secondView = secondViews.get(viewPath);
		if (
			!secondView ||
			secondView.constructor !== firstView.constructor ||
			secondView.byteLength !== firstView.byteLength ||
			secondView.buffer === firstView.buffer
		) {
			throw new Error(`${label} does not isolate typed-array buffer ${viewPath}.`);
		}
	}
}

function collectTypedViews(value) {
	const views = new Map();
	visitTypedViews(value, "$", views);
	return views;
}

function visitTypedViews(value, valuePath, views) {
	if (ArrayBuffer.isView(value)) {
		views.set(valuePath, value);
		return;
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			visitTypedViews(value[index], `${valuePath}[${index}]`, views);
		}
		return;
	}
	if (typeof value !== "object" || value === null) return;
	for (const key of Object.keys(value).sort()) {
		visitTypedViews(value[key], `${valuePath}.${key}`, views);
	}
}
