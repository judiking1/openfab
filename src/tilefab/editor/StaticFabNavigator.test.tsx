import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StaticFabNavigator, type StaticFabNavigatorModel } from "./StaticFabNavigator";

const MODEL: StaticFabNavigatorModel = Object.freeze({
	sourceKey: "fixture",
	bounds: Object.freeze({ minX: 0, minY: 0, maxX: 8, maxY: 8 }),
	railCellCount: 2,
	railX: new Int32Array([0, 1]),
	railY: new Int32Array([0, 0]),
	organizations: Object.freeze([
		Object.freeze({
			id: 1,
			kind: "AREA" as const,
			color: "TEAL" as const,
			directBounds: Object.freeze({ minX: 0, minY: 0, maxX: 8, maxY: 8 }),
			effectiveBounds: Object.freeze({ minX: 0, minY: 0, maxX: 8, maxY: 8 }),
		}),
	]),
});

function navigatorMarkup(
	overrides: Partial<React.ComponentProps<typeof StaticFabNavigator>> = {},
): string {
	return renderToStaticMarkup(
		<StaticFabNavigator
			tab="map"
			model={MODEL}
			preparing={false}
			selectedOrganizationIds={[]}
			organizationMode="DIRECT"
			issues={[]}
			totalIssueCount={2}
			equipmentGroupCount={3}
			equipmentActionDisabled={false}
			focusedIssueId={null}
			getViewportBounds={() => null}
			onTabChange={vi.fn()}
			onCenterWorld={vi.fn()}
			onFitAll={vi.fn()}
			onInspectEquipment={vi.fn()}
			{...overrides}
		/>,
	);
}

describe("StaticFabNavigator task-first entry", () => {
	it("exposes one stable disclosure target and exactly the three canonical navigator tabs", () => {
		const markup = navigatorMarkup();

		expect(markup.match(/role="tab"/g)).toHaveLength(3);
		for (const tab of ["map", "organizations", "checks"] as const) {
			expect(markup).toContain(`id="tilefab-fab-navigator-tab-${tab}"`);
			expect(markup).toContain(`aria-controls="tilefab-fab-navigator-panel-${tab}"`);
		}
		expect(markup).toContain(
			'id="tilefab-fab-navigator-panel-map" aria-labelledby="tilefab-fab-navigator-tab-map"',
		);
		expect(markup).toContain("MAP");
		expect(markup).toContain("ORGANIZATIONS");
		expect(markup).toContain("CHECKS");
		expect(markup).not.toContain('data-navigator-tab-id="equipment"');
	});

	it("leads Map with problem, structure, and equipment tasks using canonical counts", () => {
		const markup = navigatorMarkup();

		expect(markup).toContain('aria-label="FAB에서 찾을 항목"');
		expect(markup).toContain("문제 찾기");
		expect(markup).toContain("2건");
		expect(markup).toContain("FAB 구조");
		expect(markup).toContain("1개");
		expect(markup).toContain("장비 보기");
		expect(markup).toContain("3개");
	});

	it("turns an empty equipment task into a visible port-first handoff", () => {
		const markup = navigatorMarkup({ equipmentGroupCount: 0 });

		expect(markup).toContain("Port 추가하기");
		expect(markup).toContain("배치된 장비 없음");
		expect(markup).not.toContain('disabled=""');
	});

	it("disables the equipment handoff while project transitions own the editor", () => {
		const markup = navigatorMarkup({ equipmentActionDisabled: true });

		expect(markup).toContain("장비 보기");
		expect(markup).toContain('disabled=""');
		expect(markup).toContain("프로젝트와 편집 명령이 준비된 뒤 사용하세요");
	});

	it("keeps task shortcuts out of non-Map panels", () => {
		const organizations = navigatorMarkup({ tab: "organizations" });
		const checks = navigatorMarkup({ tab: "checks" });

		expect(organizations).not.toContain("FAB에서 찾을 항목");
		expect(checks).not.toContain("FAB에서 찾을 항목");
		expect(organizations).toContain('role="region" aria-label="FAB 공통 미니맵"');
		expect(checks).toContain('role="region" aria-label="FAB 공통 미니맵"');
		expect(organizations).toContain('id="tilefab-fab-navigator-panel-map"');
		expect(organizations).toContain('id="tilefab-fab-navigator-panel-checks"');
		expect(organizations).not.toContain('id="tilefab-fab-navigator-panel-organizations"');
		expect(checks).toContain('id="tilefab-fab-navigator-panel-map"');
		expect(checks).toContain('id="tilefab-fab-navigator-panel-organizations"');
		expect(checks).not.toContain('id="tilefab-fab-navigator-panel-checks"');
	});
});
