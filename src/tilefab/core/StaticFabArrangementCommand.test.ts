import { describe, expect, it } from "vitest";
import {
	STATIC_FAB_ARRANGEMENT_MAX_ROOTS,
	STATIC_FAB_ARRANGEMENT_VERSION,
} from "./StaticFabArrangement";
import {
	prepareStaticFabArrangementCommand,
	STATIC_FAB_ARRANGEMENT_COMMAND_MAX_KEY_LENGTH,
	STATIC_FAB_ARRANGEMENT_COMMAND_MAX_MODULE_KEYS,
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	staticFabArrangementCommandFingerprint,
} from "./StaticFabArrangementCommand";

describe("StaticFabArrangementCommand", () => {
	it("canonicalizes component module keys without retaining mutable input", () => {
		const moduleKeys = ["module:z", "module:a", "module:m"];
		const prepared = prepareStaticFabArrangementCommand(
			command([{ kind: "STATIC_COMPONENT", moduleKeys }]),
		);

		expect(prepared.valid, prepared.reason).toBe(true);
		if (!prepared.valid) return;
		moduleKeys[0] = "changed-after-prepare";
		expect(prepared.intent.roots).toEqual([
			{ kind: "STATIC_COMPONENT", moduleKeys: ["module:a", "module:m", "module:z"] },
		]);
		expect(Object.isFrozen(prepared.intent)).toBe(true);
		expect(Object.isFrozen(prepared.intent.roots)).toBe(true);
		expect(Object.isFrozen(prepared.intent.roots[0])).toBe(true);
		const root = prepared.intent.roots[0];
		expect(root?.kind === "STATIC_COMPONENT" && Object.isFrozen(root.moduleKeys)).toBe(true);
	});

	it("produces one stable fingerprint for canonically equivalent input", () => {
		const left = command([
			{ kind: "STATIC_COMPONENT", moduleKeys: ["module:b", "module:a"] },
			{ kind: "ORGANIZATION", organizationId: 7, selectionMode: "EFFECTIVE" },
		]);
		const right = command([
			{ kind: "STATIC_COMPONENT", moduleKeys: ["module:a", "module:b"] },
			{ kind: "ORGANIZATION", organizationId: 7, selectionMode: "EFFECTIVE" },
		]);

		expect(staticFabArrangementCommandFingerprint(left)).toBe(
			staticFabArrangementCommandFingerprint(right),
		);
		expect(staticFabArrangementCommandFingerprint({ ...right, axis: "Z" })).not.toBe(
			staticFabArrangementCommandFingerprint(right),
		);
		expect(
			staticFabArrangementCommandFingerprint({
				...right,
				roots: [
					right.roots[0],
					{ kind: "ORGANIZATION", organizationId: 7, selectionMode: "DIRECT" },
				],
			}),
		).not.toBe(staticFabArrangementCommandFingerprint(right));
		expect(() => staticFabArrangementCommandFingerprint({ ...right, version: 99 })).toThrow(
			TypeError,
		);
	});

	it("binds static-component root boundaries instead of hashing one flattened key list", () => {
		const left = command([
			{ kind: "STATIC_COMPONENT", moduleKeys: ["module:a"] },
			{ kind: "STATIC_COMPONENT", moduleKeys: ["module:b", "module:c"] },
		]);
		const right = command([
			{ kind: "STATIC_COMPONENT", moduleKeys: ["module:a", "module:b"] },
			{ kind: "STATIC_COMPONENT", moduleKeys: ["module:c"] },
		]);

		expect(staticFabArrangementCommandFingerprint(left)).not.toBe(
			staticFabArrangementCommandFingerprint(right),
		);
	});

	it("rejects duplicate canonical roots and duplicate keys within a component", () => {
		const duplicateRoot = prepareStaticFabArrangementCommand(
			command([
				{ kind: "STATIC_COMPONENT", moduleKeys: ["module:b", "module:a"] },
				{ kind: "STATIC_COMPONENT", moduleKeys: ["module:a", "module:b"] },
			]),
		);
		const duplicateKey = prepareStaticFabArrangementCommand(
			command([{ kind: "STATIC_COMPONENT", moduleKeys: ["module:a", "module:a"] }]),
		);

		expect(duplicateRoot).toMatchObject({ valid: false });
		expect(duplicateRoot.reason).toContain("중복");
		expect(duplicateKey).toMatchObject({ valid: false });
		expect(duplicateKey.reason).toContain("중복");
	});

	it("enforces root, aggregate module-key, and individual key bounds before hashing", () => {
		const tooManyRoots = prepareStaticFabArrangementCommand(
			command(
				Array.from({ length: STATIC_FAB_ARRANGEMENT_MAX_ROOTS + 1 }, (_, index) => ({
					kind: "ORGANIZATION" as const,
					organizationId: index + 1,
					selectionMode: "DIRECT" as const,
				})),
			),
		);
		const tooManyModuleKeys = prepareStaticFabArrangementCommand(
			command([
				{
					kind: "STATIC_COMPONENT",
					moduleKeys: Array(STATIC_FAB_ARRANGEMENT_COMMAND_MAX_MODULE_KEYS + 1).fill("module:a"),
				},
			]),
		);
		const oversizedKey = prepareStaticFabArrangementCommand(
			command([
				{
					kind: "STATIC_COMPONENT",
					moduleKeys: ["m".repeat(STATIC_FAB_ARRANGEMENT_COMMAND_MAX_KEY_LENGTH + 1)],
				},
			]),
		);

		expect(tooManyRoots).toMatchObject({ valid: false });
		expect(tooManyRoots.reason).toContain(STATIC_FAB_ARRANGEMENT_MAX_ROOTS.toLocaleString());
		expect(tooManyModuleKeys).toMatchObject({ valid: false });
		expect(tooManyModuleKeys.reason).toContain(
			STATIC_FAB_ARRANGEMENT_COMMAND_MAX_MODULE_KEYS.toLocaleString(),
		);
		expect(oversizedKey).toMatchObject({ valid: false });
		expect(oversizedKey.reason).toContain("유효하지");
	});
});

function command(roots: readonly unknown[]) {
	return {
		version: STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
		arrangementVersion: STATIC_FAB_ARRANGEMENT_VERSION,
		axis: "X" as const,
		mode: "ALIGN_MIN" as const,
		roots,
	};
}
