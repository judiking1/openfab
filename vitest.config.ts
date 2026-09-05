import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@": "/src",
		},
	},
	test: {
		globals: true,
		environment: "node",
		// Functional cases include full 60-Bay compilation on shared CI runners. Latency budgets
		// remain explicit assertions inside performance tests and are not controlled by this guard.
		testTimeout: 30_000,
		exclude: ["**/node_modules/**", "**/.claude/worktrees/**", "src/**/*.scale.test.ts"],
	},
});
