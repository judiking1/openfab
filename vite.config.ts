import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// SharedArrayBuffer(시뮬 SAB)는 crossOriginIsolated 환경에서만 생성 가능.
const ISOLATION_HEADERS = {
	"Cross-Origin-Opener-Policy": "same-origin",
	"Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => {
	const isolatedRuntime = mode === "runtime";
	return {
		// Keep Builder deployable at either a domain root or an unknown repository path.
		base: "./",
		plugins: [react(), tailwindcss()],
		server: isolatedRuntime ? { headers: ISOLATION_HEADERS } : undefined,
		preview: isolatedRuntime ? { headers: ISOLATION_HEADERS } : undefined,
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "src"),
			},
		},
		worker: {
			format: "es",
		},
		test: {
			environment: "node",
			include: ["src/**/*.test.ts"],
		},
	};
});
