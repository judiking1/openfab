import { defineConfig } from "vitest/config";

// Wall-clock budgets must not compete with unrelated compilation/fixture tests for CPU.
// These files retain every original assertion and run once, after the parallel functional group.
const latencyTestFiles = [
	"src/tilefab/compile/PortEquipmentPresentation.test.ts",
	"src/tilefab/core/PortEquipment.test.ts",
	"src/tilefab/core/PortEquipmentLayoutValidator.test.ts",
	"src/tilefab/core/RailNetworkLinkPlanner.test.ts",
	"src/tilefab/core/StaticFabAssemblyRelationshipActivation.test.ts",
	"src/tilefab/core/StaticFabAssemblyRelationshipRelocation.test.ts",
	"src/tilefab/core/StaticFabAssemblyRelationshipRemap.test.ts",
	"src/tilefab/core/StaticFabOrganization.test.ts",
	"src/tilefab/core/StaticFabOuterCirculation.test.ts",
	"src/tilefab/core/TileMapMutationCandidate.test.ts",
	"src/tilefab/editor/OpenFabStationProposalBridge.test.ts",
	"src/tilefab/editor/OrdinaryConnectedBayBankDuplicateHandoff.test.ts",
	"src/tilefab/editor/OrdinaryConnectedFabLoopHandoff.test.ts",
	"src/tilefab/editor/OrdinaryResilientFabChecksHandoff.test.ts",
	"src/tilefab/editor/RailEditorRelationshipActivation.test.ts",
	"src/tilefab/editor/StaticFabBayFlowEditBridge.test.ts",
	"src/tilefab/editor/StaticFabSemanticBayMutationBridge.test.ts",
	"src/tilefab/render/SyntheticFabStarterSchematic.test.ts",
	"src/tilefab/render/TileRenderer.test.ts",
	"src/tilefab/worker/OpenFabProjectSerializationRuntime.test.ts",
	"src/tilefab/worker/OpenFabStationProposalReviewDraftSoA.test.ts",
	"src/tilefab/worker/OpenFabStationProposalReviewedPlanArtifact.test.ts",
	"src/tilefab/worker/OpenFabStationProposalRuntime.test.ts",
	"src/tilefab/worker/RailPhysicalLayout.test.ts",
	"src/tilefab/worker/RailStartupRuntime.test.ts",
	"src/tilefab/worker/StaticFabArrangementTransport.test.ts",
	"src/tilefab/worker/StaticFabAssemblyRelationshipSoA.test.ts",
	"src/tilefab/worker/StaticFabOrganizationOverviewRuntime.test.ts",
];
const excludedTests = ["**/node_modules/**", "**/.claude/worktrees/**", "src/**/*.scale.test.ts"];

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
		exclude: excludedTests,
		projects: [
			{
				extends: true,
				test: {
					name: "functional",
					exclude: [...excludedTests, ...latencyTestFiles],
					sequence: { groupOrder: 0 },
				},
			},
			{
				extends: true,
				test: {
					name: "latency",
					include: latencyTestFiles,
					fileParallelism: false,
					sequence: { groupOrder: 1 },
				},
			},
		],
	},
});
