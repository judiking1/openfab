import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EDITOR_ACTIVITIES, EDITOR_ACTIVITY_DEFINITIONS } from "./EditorActivity";
import { EditorActivityRail, type EditorActivityRailProps } from "./EditorActivityRail";

function props(overrides: Partial<EditorActivityRailProps> = {}): EditorActivityRailProps {
	return {
		activeActivity: "build",
		onActivityChange: vi.fn(),
		...overrides,
	};
}

describe("EditorActivity contract", () => {
	it("defines the four product activities in stable presentation order", () => {
		expect(EDITOR_ACTIVITIES).toEqual(["build", "assemble", "equip", "inspect"]);
		expect(EDITOR_ACTIVITY_DEFINITIONS.map(({ id }) => id)).toEqual(EDITOR_ACTIVITIES);
		expect(new Set(EDITOR_ACTIVITY_DEFINITIONS.map(({ id }) => id)).size).toBe(4);
	});

	it("does not encode or infer the existing editor tool inside activity metadata", () => {
		for (const definition of EDITOR_ACTIVITY_DEFINITIONS) {
			expect(definition).not.toHaveProperty("tool");
			expect(definition).not.toHaveProperty("editorTool");
		}
	});
});

describe("EditorActivityRail", () => {
	it("renders one native toggle button for every activity", () => {
		const markup = renderToStaticMarkup(<EditorActivityRail {...props()} />);

		expect(markup).toContain('<fieldset class="tilefab-editor-activity-rail"');
		expect(markup).toContain('aria-label="Editor activities"');
		for (const activity of EDITOR_ACTIVITIES) {
			expect(markup).toContain(`data-testid="editor-activity-${activity}"`);
		}
		expect(markup.match(/class="tilefab-editor-activity-button"/g)).toHaveLength(4);
	});

	it("announces exactly one externally controlled active activity", () => {
		const markup = renderToStaticMarkup(
			<EditorActivityRail {...props({ activeActivity: "equip" })} />,
		);

		expect(markup).toMatch(
			/data-testid="editor-activity-equip"[^>]*data-active="true"[^>]*aria-pressed="true"/,
		);
		expect(markup.match(/aria-pressed="true"/g)).toHaveLength(1);
		expect(markup.match(/aria-pressed="false"/g)).toHaveLength(3);
	});

	it("keeps ready activities enabled and exposes their task descriptions", () => {
		const markup = renderToStaticMarkup(<EditorActivityRail {...props()} />);

		expect(markup).toContain("Direct rail construction and repair");
		expect(markup).toContain("Fab, Bank, Bay, and blueprint assembly");
		expect(markup).toContain("Port-first OHB, EQ, and STK authoring");
		expect(markup).toContain("Select, edit, validate, and understand authored truth");
		expect(markup).not.toContain(' disabled="');
	});

	it("makes a blocked activity natively disabled with a visible and accessible reason", () => {
		const markup = renderToStaticMarkup(
			<EditorActivityRail
				{...props({
					availability: {
						assemble: {
							state: "blocked",
							reason: "Apply or cancel the active Connector first.",
						},
					},
				})}
			/>,
		);

		expect(markup).toMatch(
			/data-testid="editor-activity-assemble"[^>]*data-availability="blocked"[^>]*aria-label="ASSEMBLE:[^"]*Unavailable: Apply or cancel the active Connector first\."[^>]*disabled/,
		);
		expect(markup).toContain("Apply or cancel the active Connector first.");
		expect(markup).toMatch(/data-testid="editor-activity-build"[^>]*data-availability="ready"/);
	});

	it("fails every activity closed when the whole editor activity surface is blocked", () => {
		const markup = renderToStaticMarkup(
			<EditorActivityRail {...props({ blockedReason: "Finish the active command first." })} />,
		);

		expect(markup.match(/data-availability="blocked"/g)).toHaveLength(4);
		expect(markup.match(/ disabled=""/g)).toHaveLength(4);
		expect(markup.match(/Finish the active command first\./g)?.length).toBeGreaterThanOrEqual(4);
	});

	it("keeps Assemble activity identity separate from its controlled panel state", () => {
		const markup = renderToStaticMarkup(
			<EditorActivityRail
				{...props({
					activeActivity: "assemble",
					controls: { assemble: "assemble-panel" },
					expanded: { assemble: true },
				})}
			/>,
		);

		expect(markup).toMatch(
			/data-testid="editor-activity-assemble"[^>]*aria-pressed="true"[^>]*aria-controls="assemble-panel"[^>]*aria-expanded="true"/,
		);
	});

	it("accepts a caller-owned accessible group label", () => {
		const markup = renderToStaticMarkup(
			<EditorActivityRail {...props({ label: "OpenFab authoring activities" })} />,
		);

		expect(markup).toContain('aria-label="OpenFab authoring activities"');
	});

	it("renders only the progressively revealed activities while retaining the active owner", () => {
		const guidedBuild = renderToStaticMarkup(
			<EditorActivityRail {...props({ visibleActivities: ["build", "equip"] })} />,
		);
		const transitioning = renderToStaticMarkup(
			<EditorActivityRail
				{...props({ activeActivity: "inspect", visibleActivities: ["build", "equip"] })}
			/>,
		);

		expect(guidedBuild).toContain('data-testid="editor-activity-build"');
		expect(guidedBuild).toContain('data-testid="editor-activity-equip"');
		expect(guidedBuild).not.toContain('data-testid="editor-activity-assemble"');
		expect(guidedBuild).not.toContain('data-testid="editor-activity-inspect"');
		expect(transitioning).toContain('data-testid="editor-activity-inspect"');
		expect(transitioning).toMatch(/data-testid="editor-activity-inspect"[^>]*aria-pressed="true"/);
	});
});
