import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const auditScript = path.join(root, "scripts", "openfab-public-safety-audit.mjs");
const temporaryPrefix = path.join(os.tmpdir(), "openfab-public-export-");
let temporaryRoot = null;

try {
	const candidateOutput = await capture(process.execPath, [auditScript, "--list"], root);
	const candidates = candidateOutput.split("\n").filter(Boolean).sort();
	if (candidates.length === 0) throw new Error("Public export allowlist is empty.");

	const candidateSet = new Set(candidates);
	const unstagedOutput = await capture("git", ["diff", "--name-only", "-z"], root);
	const unstagedCandidates = unstagedOutput
		.split("\0")
		.filter((file) => file.length > 0 && candidateSet.has(file));
	if (unstagedCandidates.length > 0) {
		throw new Error(
			`Public export candidates have unstaged changes: ${unstagedCandidates.join(", ")}`,
		);
	}

	const sourceEntries = selectIndexEntries(
		await capture("git", ["ls-files", "--stage", "-z"], root),
		candidateSet,
	);
	assertExactCandidatePaths(sourceEntries, candidates, "source index");

	temporaryRoot = await mkdtemp(temporaryPrefix);
	await runWithInput(
		"git",
		["checkout-index", "--stdin", "-z", `--prefix=${temporaryRoot}${path.sep}`],
		root,
		`${candidates.join("\0")}\0`,
	);
	await capture("git", ["-c", "init.defaultBranch=main", "init", "--quiet"], temporaryRoot);
	await capture("git", ["add", "--all"], temporaryRoot);

	const exportedEntries = selectIndexEntries(
		await capture("git", ["ls-files", "--stage", "-z"], temporaryRoot),
		candidateSet,
	);
	assertExactCandidatePaths(exportedEntries, candidates, "temporary export index");
	if (JSON.stringify(exportedEntries) !== JSON.stringify(sourceEntries)) {
		throw new Error("Temporary export file modes or blob identities differ from the source index.");
	}

	const historyCount = Number(
		(await capture("git", ["rev-list", "--all", "--count"], temporaryRoot)).trim(),
	);
	if (historyCount !== 0) {
		throw new Error(`Temporary export unexpectedly contains ${historyCount} Git commits.`);
	}

	console.log(
		`OpenFab clean export | ${candidates.length} indexed files | fingerprint ${fingerprint(sourceEntries)}`,
	);
	await run(
		process.execPath,
		[path.join(temporaryRoot, "scripts", "openfab-public-safety-audit.mjs")],
		temporaryRoot,
	);
	await run(
		"pnpm",
		["install", "--prefer-offline", "--frozen-lockfile", "--ignore-scripts"],
		temporaryRoot,
	);
	await run("pnpm", ["run", "check:release-identity"], temporaryRoot);
	await run("pnpm", ["run", "check:dependency-licenses"], temporaryRoot);
	await run("pnpm", ["run", "check:fixture-provenance"], temporaryRoot);
	await run("pnpm", ["run", "check:authoring"], temporaryRoot, fullAuthoringEnvironment());
	await run("pnpm", ["run", "check:public-bundle"], temporaryRoot);
	await run("pnpm", ["run", "test:live-demo"], temporaryRoot);
	await capture("git", ["diff", "--quiet"], temporaryRoot);

	const untracked = await capture(
		"git",
		["ls-files", "--others", "--exclude-standard", "-z"],
		temporaryRoot,
	);
	if (untracked.length > 0) {
		throw new Error("Temporary export build changed or added an unignored source-tree file.");
	}
	console.log(
		"PASS history-independent OpenFab public export, authoring acceptance, and production build",
	);
} finally {
	if (temporaryRoot !== null) {
		const temporaryParent = path.dirname(temporaryRoot);
		if (
			temporaryParent !== os.tmpdir() ||
			!path.basename(temporaryRoot).startsWith("openfab-public-export-")
		) {
			console.error("Refusing to clean an unexpected public-export temporary path.");
			process.exitCode = 1;
		} else {
			await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 3 });
		}
	}
}

async function capture(command, args, cwd) {
	const { stdout } = await execFileAsync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
	return stdout;
}

async function run(command, args, cwd, env = process.env) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, env, stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}.`));
		});
	});
}

function fullAuthoringEnvironment() {
	const environment = { ...process.env };
	// A clean export must exercise the whole journey even when launched from a diagnostic shell.
	// Keep browser selection and ordinary configuration, but remove every narrow acceptance scope.
	for (const key of Object.keys(environment)) {
		if (key === "OPENFAB_AUTHORING_PORT" || (key.startsWith("OPENFAB_") && key.endsWith("_ONLY"))) {
			delete environment[key];
		}
	}
	return environment;
}

async function runWithInput(command, args, cwd, input) {
	await new Promise((resolve, reject) => {
		const child = spawn(command, args, { cwd, stdio: ["pipe", "inherit", "inherit"] });
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) resolve();
			else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}.`));
		});
		child.stdin.end(input);
	});
}

function selectIndexEntries(output, candidateSet) {
	return output
		.split("\0")
		.filter(Boolean)
		.map((entry) => {
			const separator = entry.indexOf("\t");
			if (separator < 0) throw new Error("Unexpected git ls-files --stage output.");
			return { identity: entry.slice(0, separator), file: entry.slice(separator + 1) };
		})
		.filter(({ file }) => candidateSet.has(file))
		.sort((left, right) => (left.file < right.file ? -1 : left.file > right.file ? 1 : 0))
		.map(({ identity, file }) => `${identity}\t${file}`);
}

function assertExactCandidatePaths(entries, candidates, label) {
	const paths = entries.map((entry) => entry.slice(entry.indexOf("\t") + 1));
	if (JSON.stringify(paths) !== JSON.stringify(candidates)) {
		throw new Error(`${label} does not exactly match the public export allowlist.`);
	}
}

function fingerprint(entries) {
	return createHash("sha256").update(entries.join("\0")).digest("hex").slice(0, 16);
}
