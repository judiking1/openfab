import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "docs", "openfab-production-dependency-licenses.json");
const noticesPath = path.join(root, "THIRD_PARTY_NOTICES.md");
const packageManifestPath = path.join(root, "package.json");
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const packageManifest = JSON.parse(await readFile(packageManifestPath, "utf8"));
validateBaseline(baseline);

const required = await readPnpmLicenseRows(["--prod", "--no-optional", "--json"]);
const installed = await readPnpmLicenseRows(["--prod", "--json"]);
const expected = baseline.dependencies.map(normalizeDependency).sort(compareDependencies);
const failures = [];

compareExactDependencies(expected, required, failures);

const allowedLicenseIds = new Set(baseline.allowedInstalledLicenseIds);
const requiredKeys = new Set(required.map(dependencyKey));
for (const dependency of installed) {
	if (!allowedLicenseIds.has(dependency.license)) {
		failures.push(
			`unreviewed installed license ${dependency.license}: ${dependency.name}@${dependency.version}`,
		);
	}
	if (
		!requiredKeys.has(dependencyKey(dependency)) &&
		!baseline.allowedOptionalDependencies.some((candidate) =>
			matchesOptionalDependency(candidate, dependency),
		)
	) {
		failures.push(`unreviewed optional production dependency: ${dependencyKey(dependency)}`);
	}
}

const notices = await readFile(noticesPath, "utf8");
const directProductionNames = Object.keys(packageManifest.dependencies ?? {}).sort();
for (const name of directProductionNames) {
	const directManifest = JSON.parse(
		await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"),
	);
	const directDependency = `${name}@${directManifest.version}`;
	const directRows = installed.filter(
		(dependency) => dependency.name === name && dependency.version === directManifest.version,
	);
	if (directRows.length !== 1) {
		failures.push(
			`direct production dependency has ${directRows.length} license rows: ${directDependency}`,
		);
	}
	if (!notices.includes(`\`${directDependency}\``)) {
		failures.push(
			`direct production dependency is absent from THIRD_PARTY_NOTICES.md: ${directDependency}`,
		);
	}
}
for (const licenseId of baseline.allowedInstalledLicenseIds) {
	if (!notices.includes(`\`${licenseId}\``)) {
		failures.push(`reviewed license ID is absent from THIRD_PARTY_NOTICES.md: ${licenseId}`);
	}
}

const licenseCounts = countByLicense(installed);
console.log(
	[
		"OpenFab production dependency license audit",
		`${required.length} platform-neutral packages`,
		`${installed.length} installed packages`,
		[...licenseCounts.entries()]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([license, count]) => `${license} ${count}`)
			.join(" / "),
	].join(" | "),
);

if (failures.length > 0) {
	for (const failure of failures) console.error(`DEPENDENCY LICENSE AUDIT: ${failure}`);
	process.exitCode = 1;
} else {
	console.log("PASS OpenFab production dependency license metadata and notice boundary");
}

async function readPnpmLicenseRows(arguments_) {
	const { stdout } = await execFileAsync("pnpm", ["licenses", "list", ...arguments_], {
		cwd: root,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
	const report = JSON.parse(stdout);
	const rows = [];
	for (const [license, packages] of Object.entries(report)) {
		if (!Array.isArray(packages)) throw new Error(`pnpm returned invalid rows for ${license}.`);
		for (const packageRow of packages) {
			for (const version of packageRow.versions ?? []) {
				rows.push(normalizeDependency({ name: packageRow.name, version, license }));
			}
		}
	}
	return rows.sort(compareDependencies);
}

function compareExactDependencies(expectedRows, actualRows, output) {
	const expectedKeys = new Set(expectedRows.map(dependencyKey));
	const actualKeys = new Set(actualRows.map(dependencyKey));
	for (const key of expectedKeys) {
		if (!actualKeys.has(key)) output.push(`reviewed dependency missing or changed: ${key}`);
	}
	for (const key of actualKeys) {
		if (!expectedKeys.has(key))
			output.push(`unreviewed dependency entered production graph: ${key}`);
	}
}

function normalizeDependency(candidate) {
	if (
		!candidate ||
		typeof candidate.name !== "string" ||
		typeof candidate.version !== "string" ||
		typeof candidate.license !== "string"
	) {
		throw new Error("Dependency license rows require string name, version, and license fields.");
	}
	return Object.freeze({
		name: candidate.name,
		version: candidate.version,
		license: candidate.license,
	});
}

function compareDependencies(left, right) {
	return (
		left.name.localeCompare(right.name) ||
		left.version.localeCompare(right.version) ||
		left.license.localeCompare(right.license)
	);
}

function dependencyKey(dependency) {
	return `${dependency.name}@${dependency.version} [${dependency.license}]`;
}

function countByLicense(dependencies) {
	const counts = new Map();
	for (const dependency of dependencies) {
		counts.set(dependency.license, (counts.get(dependency.license) ?? 0) + 1);
	}
	return counts;
}

function matchesOptionalDependency(candidate, dependency) {
	const normalized = normalizeDependency(candidate);
	const nameMatches = normalized.name.endsWith("*")
		? dependency.name.startsWith(normalized.name.slice(0, -1))
		: dependency.name === normalized.name;
	return (
		nameMatches &&
		dependency.version === normalized.version &&
		dependency.license === normalized.license
	);
}

function validateBaseline(candidate) {
	if (!candidate || candidate.schemaVersion !== 1) {
		throw new Error("Production dependency license baseline schemaVersion must be 1.");
	}
	if (
		!Array.isArray(candidate.allowedInstalledLicenseIds) ||
		candidate.allowedInstalledLicenseIds.length === 0 ||
		candidate.allowedInstalledLicenseIds.some((value) => typeof value !== "string") ||
		new Set(candidate.allowedInstalledLicenseIds).size !==
			candidate.allowedInstalledLicenseIds.length
	) {
		throw new Error("Production dependency license baseline requires unique license IDs.");
	}
	if (!Array.isArray(candidate.dependencies) || candidate.dependencies.length === 0) {
		throw new Error("Production dependency license baseline requires dependency rows.");
	}
	if (
		!Array.isArray(candidate.allowedOptionalDependencies) ||
		candidate.allowedOptionalDependencies.length === 0
	) {
		throw new Error("Production dependency license baseline requires optional dependency rows.");
	}
	for (const dependency of [...candidate.dependencies, ...candidate.allowedOptionalDependencies]) {
		if (!candidate.allowedInstalledLicenseIds.includes(normalizeDependency(dependency).license)) {
			throw new Error(
				`Dependency baseline uses an unreviewed license: ${dependencyKey(dependency)}`,
			);
		}
	}
	const keys = candidate.dependencies.map((dependency) =>
		dependencyKey(normalizeDependency(dependency)),
	);
	if (new Set(keys).size !== keys.length) {
		throw new Error("Production dependency license baseline contains duplicate rows.");
	}
}
