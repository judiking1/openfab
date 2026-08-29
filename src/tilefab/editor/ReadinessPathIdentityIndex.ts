import type { CompiledPhysicalPaths } from "../compile/PhysicalPathCompiler";
import {
	compilePhysicalPathIdentityIndex,
	type Int32CsrIndexSnapshot,
} from "../compile/PhysicalPathLookup";

export interface ReadinessPathIdentityIndexBinding {
	readonly paths: CompiledPhysicalPaths;
	readonly snapshot: Int32CsrIndexSnapshot;
}

/** Bind exact issue tracing lazily when no Worker-prepared draft artifact is available. */
export function resolveReadinessPathIdentityIndex(
	paths: CompiledPhysicalPaths,
	prepared: Int32CsrIndexSnapshot | null,
	current: ReadinessPathIdentityIndexBinding | null,
	required: boolean,
): ReadinessPathIdentityIndexBinding | null {
	if (prepared) {
		if (current?.paths === paths && current.snapshot === prepared) return current;
		return Object.freeze({ paths, snapshot: prepared });
	}
	if (!required) return current?.paths === paths ? current : null;
	if (current?.paths === paths) return current;
	return Object.freeze({ paths, snapshot: compilePhysicalPathIdentityIndex(paths) });
}
