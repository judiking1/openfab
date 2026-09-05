import { describe, expect, it } from "vitest";
import {
	type GuidedBuildPrimaryTargetContext,
	resolveGuidedBuildPrimaryTarget,
} from "./GuidedBuildPrimaryTarget";

const BASE: GuidedBuildPrimaryTargetContext = Object.freeze({
	open: true,
	currentMissionId: "first-rail",
	activeActivity: "build",
	tool: "build",
	buildMode: "route",
	suggestedAction: null,
	keyboardRailActive: false,
	commandsActionable: true,
	portCanvasActionable: true,
	reuseSelectionCanvasActionable: true,
	reuseSelectionSurfaceActive: true,
	reuseSelectionObstructionOpen: false,
	reuseConnectedSelectionActionable: true,
	reuseCopySelectionActionable: true,
});

describe("GuidedBuildPrimaryTarget", () => {
	it("orders the first Rail handoff from Activity to tool, mode, and the real Canvas", () => {
		expect(resolveGuidedBuildPrimaryTarget({ ...BASE, activeActivity: "inspect" })).toMatchObject({
			id: "activity:build",
			kind: "activity",
			activity: "build",
		});
		expect(resolveGuidedBuildPrimaryTarget({ ...BASE, tool: "erase" })).toMatchObject({
			id: "tool:build",
			kind: "rail-tool",
		});
		expect(resolveGuidedBuildPrimaryTarget({ ...BASE, buildMode: "network-link" })).toMatchObject({
			id: "mode:route",
			kind: "route-mode",
		});
		const canvasTarget = resolveGuidedBuildPrimaryTarget(BASE);
		expect(canvasTarget).toMatchObject({
			id: "canvas:rail",
			kind: "canvas",
		});
		expect(canvasTarget?.instruction).toContain("15 m 이상 드래그");
		expect(resolveGuidedBuildPrimaryTarget({ ...BASE, keyboardRailActive: true })).toMatchObject({
			kind: "canvas",
		});
	});

	it("does not name a hidden Port tool before EQUIP is open", () => {
		const portContext: GuidedBuildPrimaryTargetContext = {
			...BASE,
			currentMissionId: "ports",
			activeActivity: "build",
			suggestedAction: "ohb",
		};
		const activityTarget = resolveGuidedBuildPrimaryTarget(portContext);
		expect(activityTarget).toMatchObject({
			id: "activity:equip",
			kind: "activity",
			activity: "equip",
		});
		expect(activityTarget?.instruction).toContain("EQUIP");
		expect(activityTarget?.instruction).not.toContain("강조된 OHB");

		const toolTarget = resolveGuidedBuildPrimaryTarget({
			...portContext,
			activeActivity: "equip",
			tool: "ohb",
		});
		expect(toolTarget).toMatchObject({ id: "canvas:ohb", kind: "canvas" });
		expect(toolTarget?.instruction).toContain("점선 고리");
	});

	it.each([
		"ohb",
		"eq",
		"stk",
	] as const)("resolves one %s tool before its Canvas target", (tool) => {
		const context: GuidedBuildPrimaryTargetContext = {
			...BASE,
			currentMissionId: "ports",
			activeActivity: "equip",
			tool: "inspect",
			suggestedAction: tool,
		};
		expect(resolveGuidedBuildPrimaryTarget(context)).toMatchObject({
			id: `tool:${tool}`,
			kind: "equipment-tool",
			tool,
		});
		expect(resolveGuidedBuildPrimaryTarget({ ...context, tool })).toMatchObject({
			id: `canvas:${tool}`,
			kind: "canvas",
		});
	});

	it("stays absent outside an open Rail or Port mission", () => {
		expect(resolveGuidedBuildPrimaryTarget({ ...BASE, open: false })).toBeNull();
		expect(resolveGuidedBuildPrimaryTarget({ ...BASE, commandsActionable: false })).toBeNull();
		expect(resolveGuidedBuildPrimaryTarget({ ...BASE, currentMissionId: "bay" })).toBeNull();
	});

	it("waits instead of targeting a Port Canvas without a legal action marker", () => {
		expect(
			resolveGuidedBuildPrimaryTarget({
				...BASE,
				currentMissionId: "ports",
				activeActivity: "equip",
				tool: "ohb",
				suggestedAction: "ohb",
				portCanvasActionable: false,
			}),
		).toBeNull();
	});

	it("orders the first Reuse handoff through the real Inspect Activity, tool, and Canvas", () => {
		const reuseContext: GuidedBuildPrimaryTargetContext = {
			...BASE,
			currentMissionId: "reuse-loop",
			activeActivity: "equip",
			tool: "stk",
			suggestedAction: "inspect",
		};
		expect(resolveGuidedBuildPrimaryTarget(reuseContext)).toMatchObject({
			id: "activity:inspect",
			kind: "activity",
			activity: "inspect",
		});
		expect(
			resolveGuidedBuildPrimaryTarget({
				...reuseContext,
				activeActivity: "inspect",
			}),
		).toMatchObject({ id: "tool:inspect", kind: "inspect-tool" });
		const canvasTarget = resolveGuidedBuildPrimaryTarget({
			...reuseContext,
			activeActivity: "inspect",
			tool: "inspect",
		});
		expect(canvasTarget).toMatchObject({ id: "canvas:inspect", kind: "canvas" });
		expect(canvasTarget?.instruction).toContain("이 레일 탭");
	});

	it("waits instead of reviving the Reuse panel proxy before its Canvas marker exists", () => {
		expect(
			resolveGuidedBuildPrimaryTarget({
				...BASE,
				currentMissionId: "reuse-loop",
				activeActivity: "inspect",
				tool: "inspect",
				suggestedAction: "inspect",
				reuseSelectionCanvasActionable: false,
			}),
		).toBeNull();
	});

	it("moves Reuse ownership to the visible Navigator close control while it covers selection", () => {
		expect(
			resolveGuidedBuildPrimaryTarget({
				...BASE,
				currentMissionId: "reuse-loop",
				activeActivity: "inspect",
				tool: "inspect",
				suggestedAction: "inspect",
				reuseSelectionSurfaceActive: false,
				reuseSelectionObstructionOpen: true,
			}),
		).toMatchObject({ id: "navigator:close", kind: "navigator-close" });
	});

	it("moves an anchored Reuse selection to the shared connected-selection command", () => {
		const context: GuidedBuildPrimaryTargetContext = {
			...BASE,
			currentMissionId: "reuse-loop",
			activeActivity: "inspect",
			tool: "inspect",
			suggestedAction: "select-connected",
		};
		const target = resolveGuidedBuildPrimaryTarget(context);
		expect(target).toMatchObject({
			id: "command:selection.connected",
			kind: "selection-command",
		});
		expect(target?.instruction).toContain("O 키");
		expect(
			resolveGuidedBuildPrimaryTarget({
				...context,
				reuseConnectedSelectionActionable: false,
			}),
		).toBeNull();
		expect(
			resolveGuidedBuildPrimaryTarget({
				...context,
				reuseSelectionObstructionOpen: true,
			}),
		).toMatchObject({ id: "navigator:close", kind: "navigator-close" });
	});

	it("moves a reusable Reuse selection to the shared copy command", () => {
		const context: GuidedBuildPrimaryTargetContext = {
			...BASE,
			currentMissionId: "reuse-loop",
			activeActivity: "inspect",
			tool: "inspect",
			suggestedAction: "copy-selection",
		};
		const target = resolveGuidedBuildPrimaryTarget(context);
		expect(target).toMatchObject({
			id: "command:selection.copy",
			kind: "selection-command",
		});
		expect(target?.instruction).toContain("⌘/Ctrl+C");
		expect(
			resolveGuidedBuildPrimaryTarget({
				...context,
				reuseCopySelectionActionable: false,
			}),
		).toBeNull();
		expect(
			resolveGuidedBuildPrimaryTarget({
				...context,
				reuseSelectionObstructionOpen: true,
			}),
		).toMatchObject({ id: "navigator:close", kind: "navigator-close" });
	});
});
