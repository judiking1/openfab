import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const audit = fileURLToPath(
	new URL("./openfab-public-fixture-provenance-audit.mjs", import.meta.url),
);
const provenance = JSON.parse(
	readFileSync(
		new URL("../docs/openfab-synthetic-fixture-provenance.json", import.meta.url),
		"utf8",
	),
);

function verifyCase(mutate, expectedError = null) {
	const root = mkdtempSync(path.join(os.tmpdir(), "openfab-provenance-test-"));
	const write = (relativePath, content) => {
		mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
		writeFileSync(path.join(root, relativePath), content);
	};
	try {
		const fixture = structuredClone(provenance);
		// Copy only the audit's declared, public-safe inputs. No private repository history or data.
		const sources = new Set([
			...fixture.commonGeneratorSources,
			...fixture.artifacts.flatMap((row) => [row.path, row.profileSource]),
			...fixture.historicalMigrationFixtures.flatMap((row) => [row.path, row.fixtureSource]),
			...fixture.authoredUiIllustrations.flatMap((row) => [row.path, row.presentationSource]),
		]);
		for (const source of sources)
			write(source, readFileSync(new URL(`../${source}`, import.meta.url)));
		write("scripts/openfab-public-fixture-provenance-audit.mjs", readFileSync(audit));
		mutate(fixture, write);
		write("docs/openfab-synthetic-fixture-provenance.json", JSON.stringify(fixture));
		execFileSync("git", ["init", "--quiet"], { cwd: root });
		execFileSync("git", ["add", "--all"], { cwd: root });
		const result = spawnSync(
			process.execPath,
			["scripts/openfab-public-fixture-provenance-audit.mjs"],
			{ cwd: root, encoding: "utf8" },
		);
		assert.equal(result.error, undefined);
		if (expectedError === null) {
			assert.equal(result.status, 0, result.stdout + result.stderr);
		} else {
			assert.equal(result.status, 1, result.stdout + result.stderr);
			assert.match(result.stdout + result.stderr, expectedError);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("accepts the checked-in synthetic data and authored illustration declarations", () => {
	verifyCase(() => {});
});

test("rejects a rehashed artifact using the retired certification contract", () => {
	verifyCase((fixture, write) => {
		const row = fixture.artifacts[0];
		const payload = JSON.parse(readFileSync(new URL(`../${row.path}`, import.meta.url), "utf8"));
		payload.certificationContract = "independent-materialization-v3";
		const bytes = JSON.stringify(payload);
		row.sha256 = createHash("sha256").update(bytes).digest("hex");
		write(row.path, bytes);
	}, /certification contract mismatch/);
});

test("rejects an undeclared SVG even inside the illustration asset directory", () => {
	verifyCase(
		(_fixture, write) => write("src/tilefab/editor/assets/undeclared.svg", "<svg/>"),
		/lacks provenance/,
	);
});

test("rejects an authored SVG whose bytes drift from the reviewed digest", () => {
	verifyCase(
		(fixture, write) => write(fixture.authoredUiIllustrations[0].path, "<svg/>"),
		/illustration checksum drift/,
	);
});

test("rejects duplicate, unsafe and non-UI illustration identities", () => {
	for (const mutate of [
		(fixture) => fixture.authoredUiIllustrations.push(fixture.authoredUiIllustrations[0]),
		(fixture) => {
			fixture.authoredUiIllustrations[0].path = "src/tilefab/editor/assets/../imported.svg";
		},
		(fixture) => {
			fixture.authoredUiIllustrations[0].kind = "IMPORTED_FACTORY_LAYOUT";
		},
	])
		verifyCase(mutate, /invalid or duplicate row/);
});

test("requires a tracked presentation source and explicit illustration declarations", () => {
	verifyCase((fixture) => {
		fixture.authoredUiIllustrations[0].presentationSource = "src/tilefab/editor/Missing.tsx";
	}, /presentation source is not tracked/);
	verifyCase((fixture) => {
		delete fixture.authoredUiIllustrations;
	}, /illustration declarations are missing/);
});

test("preserves the generated-artifact checksum gate", () => {
	verifyCase(
		(fixture, write) => write(fixture.artifacts[0].path, "{}"),
		/synthetic artifact checksum drift/,
	);
});

test("cannot declare imported inputs or waive the no-company-data attestation", () => {
	verifyCase((fixture) => {
		fixture.externalInputFiles = ["factory.map"];
	}, /cannot declare external input files/);
	verifyCase((fixture) => {
		fixture.attestations.containsImportedFactoryCoordinates = true;
	}, /attestations must explicitly remain false/);
});
