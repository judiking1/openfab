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
		exclude: ["**/node_modules/**", "**/.claude/worktrees/**", "src/**/*.scale.test.ts"],
	},
});
