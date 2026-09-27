import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const auditSource = readFileSync(new URL("./openfab-public-bundle-audit.mjs", import.meta.url));

function auditFixture(initialEntry, staticVendor) {
	const root = mkdtempSync(path.join(os.tmpdir(), "openfab-public-bundle-test-"));
	const write = (relativePath, content) => {
		mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
		writeFileSync(path.join(root, relativePath), content);
	};
	try {
		write("scripts/openfab-public-bundle-audit.mjs", auditSource);
		write(
			"dist/.vite/manifest.json",
			JSON.stringify({
				"index.html": {
					file: "assets/index.js",
					isEntry: true,
					imports: ["src/vendor.js"],
					dynamicImports: ["src/StaticFabInspection3DView.tsx"],
				},
				"src/vendor.js": { file: "assets/vendor.js" },
				"src/StaticFabInspection3DView.tsx": {
					file: "assets/StaticFabInspection3DView.js",
					isDynamicEntry: true,
				},
			}),
		);
		write("dist/assets/index.js", initialEntry);
		write("dist/assets/vendor.js", staticVendor);
		write("dist/assets/StaticFabInspection3DView.js", "class WebGLRenderer {}");
		return spawnSync(process.execPath, ["scripts/openfab-public-bundle-audit.mjs"], {
			cwd: root,
			encoding: "utf8",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("allows WebGLRenderer in a deferred 3D chunk", () => {
	const result = auditFixture("console.log('ready');", "console.log('vendor');");
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, result.stdout + result.stderr);
	assert.match(result.stdout, /PASS OpenFab Builder v1 initial bundle boundary/);
});

test("rejects WebGLRenderer merged into the initial entry", () => {
	const result = auditFixture("class WebGLRenderer {}", "console.log('vendor');");
	assert.equal(result.error, undefined);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /WebGLRenderer entered the initial JS graph: assets\/index\.js/);
});

test("rejects WebGLRenderer in a statically imported initial chunk", () => {
	const result = auditFixture("console.log('ready');", "class WebGLRenderer {}");
	assert.equal(result.error, undefined);
	assert.equal(result.status, 1, result.stdout + result.stderr);
	assert.match(result.stderr, /WebGLRenderer entered the initial JS graph: assets\/vendor\.js/);
});
