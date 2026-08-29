import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "docs", "openfab-public-export-manifest.json");
const strictRelease = process.argv.includes("--strict-release");
const listOnly = process.argv.includes("--list");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);

const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
	cwd: root,
	encoding: "utf8",
	maxBuffer: 32 * 1024 * 1024,
});
const trackedFiles = stdout.split("\0").filter(Boolean).sort();
const tracked = new Set(trackedFiles);
const exportCandidates = trackedFiles.filter((file) => exportCandidate(file, manifest));
const exportCandidateSet = new Set(exportCandidates);
const excludedTrackedFiles = trackedFiles.filter((file) => !exportCandidateSet.has(file));
const failures = [];

for (const file of manifest.includeFiles) {
	if (!tracked.has(file)) failures.push(`manifest include is not tracked: ${file}`);
}
for (const file of manifest.requiredBuildFiles) {
	if (!tracked.has(file)) failures.push(`required build file is not tracked: ${file}`);
	if (!exportCandidateSet.has(file)) failures.push(`required build file is not exported: ${file}`);
}
for (const file of manifest.releaseRequiredFiles) {
	if (tracked.has(file) && !exportCandidateSet.has(file)) {
		failures.push(`tracked release-required file is not exported: ${file}`);
	}
}
for (const file of trackedFiles) {
	const forbiddenReason = forbiddenTrackedAssetReason(file);
	if (forbiddenReason) failures.push(`${forbiddenReason}: ${file}`);
}
for (const file of exportCandidates) {
	if (manifest.excludedPrivatePrefixes.some((prefix) => file.startsWith(prefix))) {
		failures.push(`private prefix entered export allowlist: ${file}`);
	}
}

const contentPatterns = [
	{
		label: "absolute macOS user path",
		pattern: new RegExp(["/", "Users", "/"].join(""), "i"),
	},
	{
		label: "absolute macOS temporary path",
		pattern: new RegExp(["/var", "/folders", "/"].join(""), "i"),
	},
	{
		label: "absolute Windows user path",
		pattern: new RegExp(["[A-Za-z]:", "\\\\", "Users", "\\\\"].join(""), "i"),
	},
	{
		label: "reference-project identifier",
		pattern: new RegExp(["vos", "ui"].join(""), "i"),
	},
	{
		label: "private key material",
		pattern: new RegExp(["BEGIN ", "(?:RSA |OPENSSH |EC )?", "PRIVATE KEY"].join(""), "i"),
	},
	{ label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
	{ label: "GitHub access token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/ },
	{ label: "Slack access token", pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
];
let scannedTextFiles = 0;
let skippedBinaryFiles = 0;
for (const file of exportCandidates) {
	const bytes = await readFile(path.join(root, file));
	if (bytes.includes(0)) {
		skippedBinaryFiles += 1;
		continue;
	}
	scannedTextFiles += 1;
	const text = bytes.toString("utf8");
	for (const { label, pattern } of contentPatterns) {
		const match = pattern.exec(text);
		if (!match) continue;
		const line = text.slice(0, match.index).split("\n").length;
		failures.push(`${label}: ${file}:${line}`);
	}
}

const missingReleaseFiles = manifest.releaseRequiredFiles.filter((file) => !tracked.has(file));
if (strictRelease) {
	for (const file of missingReleaseFiles)
		failures.push(`release-required file is missing: ${file}`);
}

if (listOnly) {
	process.stdout.write(`${exportCandidates.join("\n")}\n`);
} else {
	console.log(
		[
			`OpenFab public ${strictRelease ? "release" : "safety"} audit`,
			`${exportCandidates.length} allowlisted tracked files`,
			`${excludedTrackedFiles.length} private-incubator files excluded`,
			`${scannedTextFiles} text files scanned`,
			`${skippedBinaryFiles} binary files skipped from content scan`,
			`${missingReleaseFiles.length} release files still missing`,
		].join(" | "),
	);
	if (missingReleaseFiles.length > 0) {
		console.log(`Release blockers: ${missingReleaseFiles.join(", ")}`);
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`PUBLIC EXPORT AUDIT: ${failure}`);
	process.exitCode = 1;
} else if (!listOnly) {
	console.log("PASS OpenFab public-safe export allowlist");
}

function exportCandidate(file, candidateManifest) {
	return (
		candidateManifest.includeFiles.includes(file) ||
		candidateManifest.releaseRequiredFiles.includes(file) ||
		candidateManifest.includePrefixes.some((prefix) => file.startsWith(prefix))
	);
}

function forbiddenTrackedAssetReason(file) {
	const lower = file.toLowerCase();
	if (
		/(^|\/)(artifacts|dist|dist-ssr|logs|node_modules)(\/|$)/.test(lower) ||
		lower.startsWith("public/railconfig/")
	) {
		return "generated, local, or proprietary directory is tracked";
	}
	if (
		/(^|\/)(\.env(?:\..*)?|\.ds_store)$/.test(lower) ||
		/\.(?:map|csv|log|heapsnapshot|cpuprofile|pem|key|p12|openfab(?:\.json|bp|lib))$/.test(lower)
	) {
		return "forbidden local data or credential-shaped file is tracked";
	}
	return null;
}

function validateManifest(candidate) {
	if (!candidate || typeof candidate !== "object" || candidate.schemaVersion !== 1) {
		throw new Error("OpenFab public export manifest schemaVersion must be 1.");
	}
	for (const key of [
		"includeFiles",
		"includePrefixes",
		"requiredBuildFiles",
		"releaseRequiredFiles",
		"excludedPrivatePrefixes",
		"manualReleaseReviews",
	]) {
		if (
			!Array.isArray(candidate[key]) ||
			candidate[key].some((value) => typeof value !== "string")
		) {
			throw new Error(`OpenFab public export manifest ${key} must be a string array.`);
		}
	}
	for (const file of [...candidate.includeFiles, ...candidate.requiredBuildFiles]) {
		if (file.startsWith("/") || file.includes("\\") || file.split("/").includes("..")) {
			throw new Error(`OpenFab public export manifest contains an unsafe path: ${file}`);
		}
	}
	for (const prefix of [...candidate.includePrefixes, ...candidate.excludedPrivatePrefixes]) {
		if (!prefix.endsWith("/") || prefix.startsWith("/") || prefix.includes("..")) {
			throw new Error(`OpenFab public export manifest contains an unsafe prefix: ${prefix}`);
		}
	}
}
