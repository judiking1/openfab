import { execFile, spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestFile = "docs/openfab-public-export-manifest.json";
const strictRelease = process.argv.includes("--strict-release");
const listOnly = process.argv.includes("--list");

const staged = process.argv.includes("--staged");
const { stdout } = await execFileAsync("git", ["ls-files", "--stage", "-z"], {
	cwd: root,
	encoding: "utf8",
	maxBuffer: 32 * 1024 * 1024,
});
const entries = stdout
	.split("\0")
	.filter(Boolean)
	.map((record) => {
		const match = /^(\d{6}) ([a-f0-9]+) ([0-3])\t(.+)$/s.exec(record);
		if (!match) throw new Error("Invalid Git index entry.");
		if (match[3] !== "0") throw new Error(`Unresolved Git index entry: ${match[4]}`);
		return { mode: match[1], oid: match[2], file: match[4] };
	});
const index = new Map(entries.map((entry) => [entry.file, entry]));
const ordinaryEntries = entries.filter(
	(entry) => ["100644", "100755"].includes(entry.mode) && !forbiddenTrackedAssetReason(entry.file),
);
if (!["100644", "100755"].includes(index.get(manifestFile)?.mode)) {
	throw new Error("The public manifest must be a regular file in the index.");
}
const stagedBlobs = staged ? await readIndexBlobs(ordinaryEntries) : null;
const manifestBytes = staged ? stagedBlobs.get(manifestFile) : await workingTreeBytes(manifestFile);
if (!manifestBytes) throw new Error("The public manifest must be a regular file in the index.");
const manifest = JSON.parse(manifestBytes.toString("utf8"));
validateManifest(manifest);
const trackedFiles = [...index.keys()].sort();
const tracked = new Set(trackedFiles);
const exportCandidates = trackedFiles.filter((file) => exportCandidate(file, manifest));
const exportCandidateSet = new Set(exportCandidates);
const excludedTrackedFiles = trackedFiles.filter((file) => !exportCandidateSet.has(file));
const failures = [];
for (const file of excludedTrackedFiles) {
	failures.push(`tracked file is outside the public allowlist: ${file}`);
}

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
for (const file of trackedFiles) {
	if (!["100644", "100755"].includes(index.get(file).mode)) {
		failures.push(`symlink or non-file index entry is not permitted: ${file}`);
	}
	if (manifest.excludedPrivatePrefixes.some((prefix) => file.startsWith(prefix))) {
		failures.push(`private prefix is tracked: ${file}`);
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
let scannedBinaryFiles = 0;
for (const file of trackedFiles) {
	if (!["100644", "100755"].includes(index.get(file).mode) || forbiddenTrackedAssetReason(file))
		continue;
	let bytes;
	if (staged) {
		bytes = stagedBlobs.get(file);
	} else {
		bytes = await workingTreeBytes(file);
		if (!bytes) {
			failures.push(`tracked working-tree entry has a symlink or is not a regular file: ${file}`);
			continue;
		}
	}
	const binary = bytes.includes(0);
	if (binary) scannedBinaryFiles += 1;
	else scannedTextFiles += 1;
	const text = bytes.toString("utf8");
	for (const { label, pattern } of contentPatterns) {
		const match = pattern.exec(text);
		if (!match) continue;
		const line = text.slice(0, match.index).split("\n").length;
		failures.push(`${label}: ${file}:${binary ? "binary" : line}`);
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
			`OpenFab public ${strictRelease ? "release" : "safety"} audit (${staged ? "index" : "working tree"})`,
			`${exportCandidates.length} allowlisted tracked files`,
			`${excludedTrackedFiles.length} tracked files outside public allowlist`,
			`${scannedTextFiles} text files scanned`,
			`${scannedBinaryFiles} binary files scanned for forbidden content`,
			`${missingReleaseFiles.length} release files still missing`,
		].join(" | "),
	);
	if (missingReleaseFiles.length > 0) {
		console.log(`Release blockers: ${missingReleaseFiles.join(", ")}`);
	}
}

if (failures.length > 0) {
	for (const failure of failures) console.error(`PUBLIC SAFETY AUDIT: ${failure}`);
	process.exitCode = 1;
} else if (!listOnly) {
	console.log("PASS OpenFab public tracked-source safety");
}

async function workingTreeBytes(file) {
	const parts = file.split("/");
	let location = root;
	for (let index = 0; index < parts.length; index += 1) {
		location = path.join(location, parts[index]);
		const status = await lstat(location);
		if (status.isSymbolicLink()) return null;
		if (index === parts.length - 1 ? !status.isFile() : !status.isDirectory()) return null;
	}
	return readFile(location);
}

async function readIndexBlobs(indexEntries) {
	const objectIds = [...new Set(indexEntries.map((entry) => entry.oid))];
	if (objectIds.length === 0) return new Map();
	const output = await new Promise((resolve, reject) => {
		const child = spawn("git", ["cat-file", "--batch"], {
			cwd: root,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const chunks = [];
		const errors = [];
		child.stdout.on("data", (chunk) => chunks.push(chunk));
		child.stderr.on("data", (chunk) => errors.push(chunk));
		child.once("error", reject);
		child.stdin.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve(Buffer.concat(chunks));
			else
				reject(new Error(`Git index blob read failed: ${Buffer.concat(errors).toString("utf8")}`));
		});
		child.stdin.end(`${objectIds.join("\n")}\n`);
	});
	const blobs = new Map();
	let offset = 0;
	for (const oid of objectIds) {
		const newline = output.indexOf(10, offset);
		const [returnedOid, type, sizeText] = output
			.subarray(offset, newline)
			.toString("ascii")
			.split(" ");
		const size = Number(sizeText);
		if (
			newline < offset ||
			returnedOid !== oid ||
			type !== "blob" ||
			!Number.isSafeInteger(size) ||
			size < 0
		) {
			throw new Error("Invalid Git index blob response.");
		}
		const start = newline + 1;
		const end = start + size;
		if (end >= output.length || output[end] !== 10)
			throw new Error("Truncated Git index blob response.");
		blobs.set(oid, output.subarray(start, end));
		offset = end + 1;
	}
	return new Map(indexEntries.map((entry) => [entry.file, blobs.get(entry.oid)]));
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
		/\.(?:map|csv|log|heapsnapshot|cpuprofile|pem|key|p12|openfab(?:\.json|bp|lib)?)$/.test(lower)
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
