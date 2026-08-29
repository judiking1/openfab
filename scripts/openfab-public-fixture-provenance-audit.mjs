import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provenancePath = path.join(root, "docs", "openfab-synthetic-fixture-provenance.json");
const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
validateProvenance(provenance);

const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
	cwd: root,
	encoding: "utf8",
	maxBuffer: 32 * 1024 * 1024,
});
const trackedFiles = stdout.split("\0").filter(Boolean).sort();
const tracked = new Set(trackedFiles);
const declaredPaths = new Set(provenance.artifacts.map((artifact) => artifact.path));
const dataBearingFiles = trackedFiles.filter(isPublicDataBearingFile);
const failures = [];

for (const file of dataBearingFiles) {
	if (!declaredPaths.has(file)) failures.push(`public data-bearing file lacks provenance: ${file}`);
}
for (const file of declaredPaths) {
	if (!tracked.has(file)) failures.push(`declared synthetic artifact is not tracked: ${file}`);
	if (!dataBearingFiles.includes(file)) {
		failures.push(`declared synthetic artifact is outside the public data-file boundary: ${file}`);
	}
}
for (const source of provenance.commonGeneratorSources) {
	if (!tracked.has(source)) failures.push(`common generator source is not tracked: ${source}`);
}

let totalBytes = 0;
for (const artifact of provenance.artifacts) {
	if (!tracked.has(artifact.profileSource)) {
		failures.push(
			`profile source is not tracked for ${artifact.artifactId}: ${artifact.profileSource}`,
		);
	}
	let bytes;
	try {
		bytes = await readFile(path.join(root, artifact.path));
	} catch (error) {
		failures.push(`synthetic artifact cannot be read: ${artifact.path} (${error.code ?? "error"})`);
		continue;
	}
	totalBytes += bytes.byteLength;
	const actualSha256 = createHash("sha256").update(bytes).digest("hex");
	if (actualSha256 !== artifact.sha256) {
		failures.push(`synthetic artifact checksum drift: ${artifact.path}`);
	}
	let payload;
	try {
		payload = JSON.parse(bytes.toString("utf8"));
	} catch {
		failures.push(`synthetic artifact is not valid JSON: ${artifact.path}`);
		continue;
	}
	if (payload.artifactId !== artifact.artifactId) {
		failures.push(`synthetic artifact ID mismatch: ${artifact.path}`);
	}
	if (payload.payloadKind !== "openfab-prepared-synthetic-fab-starter") {
		failures.push(`synthetic artifact payload kind mismatch: ${artifact.path}`);
	}
	if (payload.certificationContract !== "independent-materialization-v1") {
		failures.push(`synthetic artifact certification contract mismatch: ${artifact.path}`);
	}
}

console.log(
	[
		"OpenFab public fixture provenance audit",
		`${dataBearingFiles.length} public data-bearing files`,
		`${provenance.artifacts.length} independently generated artifacts`,
		`${totalBytes} bytes`,
		"0 external input files",
	].join(" | "),
);

if (failures.length > 0) {
	for (const failure of failures) console.error(`FIXTURE PROVENANCE AUDIT: ${failure}`);
	process.exitCode = 1;
} else {
	console.log("PASS OpenFab synthetic fixture provenance boundary");
}

function isPublicDataBearingFile(file) {
	if (!(file.startsWith("src/") || file.startsWith("public/"))) return false;
	return /\.(?:csv|db|geojson|glb|gltf|jpeg|jpg|json|map|parquet|png|sqlite|svg|tsv|wasm|webp)$/i.test(
		file,
	);
}

function validateProvenance(candidate) {
	if (!candidate || candidate.schemaVersion !== 1) {
		throw new Error("Synthetic fixture provenance schemaVersion must be 1.");
	}
	if (candidate.classification !== "INDEPENDENT_SYNTHETIC_CODE_GENERATED") {
		throw new Error("Synthetic fixture provenance requires the independent synthetic class.");
	}
	if (candidate.generatorCommand !== "npm run generate:certified-presets") {
		throw new Error("Synthetic fixture provenance generator command is not canonical.");
	}
	if (!Array.isArray(candidate.externalInputFiles) || candidate.externalInputFiles.length !== 0) {
		throw new Error("Public synthetic artifacts cannot declare external input files.");
	}
	if (
		candidate.attestations?.containsImportedFactoryCoordinates !== false ||
		candidate.attestations?.containsCustomerOrCompanyIdentifiers !== false ||
		candidate.attestations?.containsOperationalRecords !== false
	) {
		throw new Error("Synthetic fixture provenance attestations must explicitly remain false.");
	}
	if (
		!Array.isArray(candidate.commonGeneratorSources) ||
		candidate.commonGeneratorSources.length === 0 ||
		candidate.commonGeneratorSources.some((value) => !isSafeRepositoryPath(value))
	) {
		throw new Error("Synthetic fixture provenance requires safe common generator sources.");
	}
	if (!Array.isArray(candidate.artifacts) || candidate.artifacts.length === 0) {
		throw new Error("Synthetic fixture provenance requires artifact rows.");
	}
	const paths = new Set();
	const artifactIds = new Set();
	for (const artifact of candidate.artifacts) {
		if (
			!artifact ||
			!isSafeRepositoryPath(artifact.path) ||
			!artifact.path.startsWith("src/tilefab/generated/synthetic-fab-presets/") ||
			!isSafeRepositoryPath(artifact.profileSource) ||
			typeof artifact.artifactId !== "string" ||
			!/^[a-z0-9][a-z0-9.-]+$/.test(artifact.artifactId) ||
			typeof artifact.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(artifact.sha256)
		) {
			throw new Error("Synthetic fixture provenance contains an invalid artifact row.");
		}
		if (paths.has(artifact.path) || artifactIds.has(artifact.artifactId)) {
			throw new Error("Synthetic fixture provenance contains duplicate artifact identity.");
		}
		paths.add(artifact.path);
		artifactIds.add(artifact.artifactId);
	}
}

function isSafeRepositoryPath(value) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		!value.split("/").includes("..")
	);
}
