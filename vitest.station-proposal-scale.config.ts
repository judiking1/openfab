import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/tilefab/worker/OpenFabStationProposalScale.scale.test.ts"],
		fileParallelism: false,
		maxWorkers: 1,
	},
});
