import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const manifest = JSON.parse(await readFile(path.join(distRoot, ".vite", "manifest.json"), "utf8"));
const entries = Object.entries(manifest).filter(([, value]) => value.isEntry === true);
if (entries.length !== 1) {
	throw new Error(`Expected one public application entry, received ${entries.length}.`);
}

const initialKeys = new Set();
const initialFiles = new Set();
collectStaticEntry(entries[0][0]);

const deferredSourcePattern =
	/(?:StaticFabInspection3DView|SimulationReadinessBridge|SimulationOperationalConfiguration|synthetic-fab-presets)/;
const deferredInitialKeys = [...initialKeys].filter((key) => deferredSourcePattern.test(key));
if (deferredInitialKeys.length > 0) {
	throw new Error(
		`Deferred public capabilities entered the initial graph: ${deferredInitialKeys.join(", ")}`,
	);
}

const allowedInitialLaterStageFoundations = new Set([
	"SimulationStaticWorldFoundation",
	"SimulationTrackOccupancyPolicy",
]);
const initialLaterStageNames = [...initialKeys]
	.map((key) => manifest[key]?.name ?? key)
	.filter((name) => /(?:Simulation|Inspection3D)/.test(name));
const unexpectedLaterStageNames = initialLaterStageNames.filter(
	(name) => !allowedInitialLaterStageFoundations.has(name),
);
if (unexpectedLaterStageNames.length > 0) {
	throw new Error(
		`Unexpected later-stage foundation entered the initial graph: ${unexpectedLaterStageNames.join(", ")}`,
	);
}

let rawBytes = 0;
let compressedBytes = 0;
let compressedCssBytes = 0;
for (const file of initialFiles) {
	const bytes = await readFile(path.join(distRoot, file));
	const compressed = gzipSync(bytes, { level: 9 }).byteLength;
	rawBytes += bytes.byteLength;
	compressedBytes += compressed;
	if (file.endsWith(".css")) compressedCssBytes += compressed;
}

assertAtMost(rawBytes, 4.5 * 1024 * 1024, "initial raw asset budget");
assertAtMost(compressedBytes, 1.25 * 1024 * 1024, "initial gzip asset budget");
assertAtMost(compressedCssBytes, 64 * 1024, "initial gzip CSS budget");

console.log(
	[
		"OpenFab public bundle audit",
		`${initialFiles.size} initial files`,
		`${rawBytes} raw bytes`,
		`${compressedBytes} gzip bytes`,
		`${compressedCssBytes} gzip CSS bytes`,
		`${initialLaterStageNames.length} allowed later-stage foundation chunks`,
	].join(" | "),
);
console.log("PASS OpenFab Builder v1 initial bundle boundary");

function collectStaticEntry(key) {
	if (initialKeys.has(key)) return;
	const entry = manifest[key];
	if (!entry) throw new Error(`Manifest references a missing static import: ${key}`);
	initialKeys.add(key);
	if (entry.file) initialFiles.add(entry.file);
	for (const css of entry.css ?? []) initialFiles.add(css);
	for (const importedKey of entry.imports ?? []) collectStaticEntry(importedKey);
}

function assertAtMost(actual, maximum, label) {
	if (actual > maximum) {
		throw new Error(`${label} exceeded: ${actual} > ${maximum}.`);
	}
}
