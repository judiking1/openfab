import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const packageJson = JSON.parse(await read("package.json"));
const indexHtml = await read("index.html");
const readme = await read("README.md");
const changelog = await read("CHANGELOG.md");
const pullRequestTemplate = await read(".github/pull_request_template.md");
const licenseText = await read("LICENSE");
const noticeText = await read("NOTICE");
const publicExportManifest = JSON.parse(await read("docs/openfab-public-export-manifest.json"));
const configFile = path.join(root, "vite.config.ts");
const builderViteConfig = await resolveConfig(
	{ configFile, mode: "production" },
	"build",
	"production",
	"production",
);
const runtimeViteConfig = await resolveConfig(
	{ configFile, mode: "runtime" },
	"build",
	"runtime",
	"production",
);

requireEqual(packageJson.name, "openfab-builder", "package name");
requireEqual(packageJson.private, true, "accidental npm publication guard");
requireEqual(packageJson.license, "Apache-2.0", "package license");

const version = typeof packageJson.version === "string" ? packageJson.version : "";
const versionMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
if (!versionMatch) {
	errors.push(
		`package version must use exact release.feature.fix SemVer, received ${json(version)}`,
	);
}
requireIncludes(licenseText, "Apache License", "root license title");
requireIncludes(licenseText, "Version 2.0, January 2004", "root license version");
requireEqual(
	createHash("sha256").update(licenseText).digest("hex"),
	"cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
	"official Apache-2.0 license SHA-256",
);
requireEqual(
	noticeText,
	"OpenFab\nCopyright 2026 이원배\n\nOpenFab is licensed under the Apache License, Version 2.0.\nThird-party attributions are listed in THIRD_PARTY_NOTICES.md.\n",
	"owner notice",
);
if (
	typeof packageJson.packageManager !== "string" ||
	!/^pnpm@\d+\.\d+\.\d+$/.test(packageJson.packageManager)
) {
	errors.push("packageManager must pin an exact pnpm SemVer");
}
if (typeof packageJson.engines?.node !== "string" || packageJson.engines.node.length === 0) {
	errors.push("package engines.node must declare the supported runtime boundary");
}

requireIncludes(indexHtml, '<html lang="ko">', "Korean-first document language");
requireIncludes(indexHtml, "<title>OpenFab Builder</title>", "document title");
requireIncludes(
	indexHtml,
	'<meta name="application-name" content="OpenFab Builder" />',
	"application metadata",
);
requireIncludes(indexHtml, '<meta name="description"', "document description");
requireIncludes(readme, "Status: public `0.x` preview candidate.", "public preview status");
for (const versionLine of ["`1.x`", "`2.x`", "`3.x`"]) {
	requireIncludes(readme, versionLine, `${versionLine} public product line`);
}
requireIncludes(changelog, "## [Unreleased]", "unreleased changelog section");
for (const section of [
	"## Outcome",
	"## Version impact",
	"## Invariants",
	"## Verification",
	"## Public-safety checklist",
]) {
	requireIncludes(pullRequestTemplate, section, `${section} pull-request section`);
}
requireIncludes(
	pullRequestTemplate,
	"release.feature.fix",
	"pull-request version-impact convention",
);
requireIncludes(
	pullRequestTemplate,
	"pnpm check:release-identity",
	"pull-request identity verification",
);
if (await exists("vercel.json")) {
	errors.push("provider-specific vercel.json must not define the default Builder deployment");
}
if (publicExportManifest.includeFiles?.includes("vercel.json")) {
	errors.push("public export manifest must not include provider-specific runtime hosting config");
}
requireEqual(builderViteConfig.base, "./", "Builder static-host base");
requireEqual(runtimeViteConfig.base, "./", "runtime static-host base");
requireNoIsolationHeaders(builderViteConfig.server.headers, "Builder development server");
requireNoIsolationHeaders(builderViteConfig.preview.headers, "Builder preview server");
requireIsolationHeaders(runtimeViteConfig.server.headers, "runtime development server");
requireIsolationHeaders(runtimeViteConfig.preview.headers, "runtime preview server");

if (errors.length > 0) {
	throw new Error(`OpenFab release identity audit failed:\n- ${errors.join("\n- ")}`);
}

console.log(
	`PASS OpenFab release identity | ${packageJson.name}@${version} | private package | lang=ko | Builder headers=none | runtime headers=isolated`,
);

async function read(file) {
	return readFile(path.join(root, file), "utf8");
}

async function exists(file) {
	try {
		await access(path.join(root, file));
		return true;
	} catch {
		return false;
	}
}

function requireEqual(actual, expected, label) {
	if (actual !== expected) {
		errors.push(`${label} must be ${json(expected)}, received ${json(actual)}`);
	}
}

function requireIncludes(source, expected, label) {
	if (!source.includes(expected)) errors.push(`${label} is missing`);
}

function requireNoIsolationHeaders(headers, label) {
	const values = headers ?? {};
	for (const key of ["Cross-Origin-Opener-Policy", "Cross-Origin-Embedder-Policy"]) {
		if (values[key] !== undefined) errors.push(`${label} must not define ${key}`);
	}
}

function requireIsolationHeaders(headers, label) {
	const values = headers ?? {};
	requireEqual(values["Cross-Origin-Opener-Policy"], "same-origin", `${label} COOP`);
	requireEqual(values["Cross-Origin-Embedder-Policy"], "require-corp", `${label} COEP`);
}

function json(value) {
	return JSON.stringify(value);
}
