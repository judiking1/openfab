import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planStaticFabAisleIntegration } from "../core/StaticFabAisleIntegration";
import { aisleIntegrationFixture } from "../worker/StaticFabAisleIntegrationTestFixture";
import { StaticFabAisleIntegrationDialog } from "./StaticFabAisleIntegrationDialog";
import type { AisleIntegrationSession } from "./useStaticFabAisleIntegration";

describe("AISLE integration review", () => {
	it.each([
		"choosing",
		"searching",
		"reviewing",
		"rejected",
	] as const)("disables Apply in %s with one footer action pair", (phase) => {
		const html = render(phase);
		expect(html.match(/<button /g)).toHaveLength(2);
		expect(html).toMatch(/<footer><button[^>]*>취소<\/button><button[^>]*disabled/);
		expect(html).toContain('aria-label="편입 대상 Bay"');
		expect(html).toContain('aria-label="편입 연결 위치"');
	});
	it("previews both certified routes and enables Apply only when ready", () => {
		const html = render("ready");
		expect(html).toMatch(/aisle-entry-preview[^>]*points="[^"]+/);
		expect(html).toMatch(/aisle-exit-preview[^>]*points="[^"]+/);
		expect(html).toMatch(/<footer><button[^>]*>취소<\/button><button type="button">적용/);
		expect(html).toContain("현재 위치와 레일·장비를 유지합니다");
	});
});
function render(phase: AisleIntegrationSession["phase"]) {
	const { document, intent } = aisleIntegrationFixture();
	const plan = planStaticFabAisleIntegration(document, 0, intent).plan;
	const session: AisleIntegrationSession = {
		aisle: document.organizations.records.find(
			(record) => record.id === intent.aisleOrganizationId,
		)!,
		bays: document.organizations.records.filter((record) => record.kind === "BAY"),
		bayId: 1,
		options: [],
		optionId: "",
		phase,
		reason: "검토 중",
		plan: phase === "ready" ? plan : null,
	};
	return renderToStaticMarkup(
		<StaticFabAisleIntegrationDialog
			session={session}
			onBay={() => undefined}
			onOption={() => undefined}
			onCancel={() => undefined}
			onApply={() => undefined}
		/>,
	);
}
