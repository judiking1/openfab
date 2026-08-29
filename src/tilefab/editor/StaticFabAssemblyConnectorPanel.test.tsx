import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
	StaticFabAssemblyConnectorPanel,
	type StaticFabAssemblyConnectorPanelProps,
} from "./StaticFabAssemblyConnectorPanel";
import {
	cycleConnectorSide,
	parseConnectorCandidateIndex,
	staticFabAssemblyConnectorAppliedStatus,
} from "./StaticFabAssemblyConnectorPanelHelpers";

const candidate = Object.freeze({
	id: "gateway-1",
	label: "NORTH · E",
	detail: "24 m directed run",
});
const secondCandidate = Object.freeze({
	id: "gateway-2",
	label: "SOUTH · W",
	detail: "22 m directed run",
});

function props(
	overrides: Partial<StaticFabAssemblyConnectorPanelProps> = {},
): StaticFabAssemblyConnectorPanelProps {
	return {
		phase: "pick-source-gateway",
		hierarchyRole: "BAY_TO_BANK",
		purpose: "HIERARCHY_LINK",
		sourceBayName: "BAY A",
		sourceGatewayLabel: null,
		targetBayName: "BAY B",
		targetGatewayLabel: null,
		sourceCandidates: [candidate],
		sourceCandidateIndex: null,
		targetCandidates: [candidate],
		targetCandidateIndex: null,
		side: null,
		result: null,
		reason: null,
		conflictCount: 0,
		issueCode: null,
		timings: null,
		onSelectSource: vi.fn(),
		onSelectTarget: vi.fn(),
		onCycleSource: vi.fn(),
		onCycleTarget: vi.fn(),
		onSide: vi.fn(),
		onApply: vi.fn(),
		onCancel: vi.fn(),
		...overrides,
	};
}

describe("StaticFabAssemblyConnectorPanel", () => {
	it("cycles corridor sides in the same order advertised by Q and E", () => {
		expect(cycleConnectorSide(null, 1)).toBe("left");
		expect(cycleConnectorSide("left", 1)).toBe("right");
		expect(cycleConnectorSide("right", 1)).toBeNull();
		expect(cycleConnectorSide(null, -1)).toBe("right");
	});

	it("does not turn the gateway placeholder into candidate zero", () => {
		expect(parseConnectorCandidateIndex("", 2)).toBeNull();
		expect(parseConnectorCandidateIndex("0", 2)).toBe(0);
		expect(parseConnectorCandidateIndex("1", 2)).toBe(1);
		expect(parseConnectorCandidateIndex("2", 2)).toBeNull();
		expect(parseConnectorCandidateIndex("1.0", 2)).toBeNull();
	});

	it("reports the authored hierarchy result instead of leaking a rail-planner reason", () => {
		expect(staticFabAssemblyConnectorAppliedStatus("BAY_TO_BANK", "HIERARCHY_LINK")).toBe(
			"두 Production Bay를 연결해 Bay Bank를 만들었습니다 · 실행 취소 1회로 되돌릴 수 있습니다",
		);
		expect(staticFabAssemblyConnectorAppliedStatus("BANK_TO_FAB", "HIERARCHY_LINK")).toBe(
			"두 Bay Bank를 연결해 Fab을 만들었습니다 · 실행 취소 1회로 되돌릴 수 있습니다",
		);
		expect(staticFabAssemblyConnectorAppliedStatus("BANK_TO_FAB", "FAB_LOOP")).toBe(
			"Fab 외곽 순환을 추가했습니다 · 실행 취소 1회로 되돌릴 수 있습니다",
		);
	});

	it("renders nothing while the connector command is idle", () => {
		expect(
			renderToStaticMarkup(<StaticFabAssemblyConnectorPanel {...props({ phase: "idle" })} />),
		).toBe("");
	});

	it("keeps target, side, and apply controls locked until a source gateway is chosen", () => {
		const markup = renderToStaticMarkup(<StaticFabAssemblyConnectorPanel {...props()} />);
		expect(markup).toContain("CONNECT BAYS");
		expect(markup).toContain("PICK SOURCE");
		expect(markup).toContain("Select a highlighted source gateway.");
		expect(markup.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(6);
	});

	it("exposes apply only for a certified result and reports exact patch scope", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssemblyConnectorPanel
				{...props({
					phase: "ready",
					sourceCandidateIndex: 0,
					targetCandidateIndex: 0,
					sourceGatewayLabel: "NORTH · E · 24 m",
					targetGatewayLabel: "SOUTH · W · 22 m",
					result: {
						hierarchyRole: "BAY_TO_BANK",
						purpose: "HIERARCHY_LINK",
						outboundLengthMeters: 38,
						returnLengthMeters: 42,
						railChangeCount: 80,
						organizationChangeCount: 3,
						parentAction: "create",
						parentName: "Bay Bank 1",
					},
					timings: {
						workerRoundTripMilliseconds: 8.2,
						responseValidationMilliseconds: 0.4,
						adoptionMilliseconds: 0.2,
					},
				})}
			/>,
		);
		expect(markup).toContain(">READY<");
		expect(markup).toContain("38 m");
		expect(markup).toContain("80 RAIL · 3 ORG");
		expect(markup).toContain("CREATE BANK · Bay Bank 1");
		expect(markup.match(/class="tilefab-assembly-connector-result"/g)).toHaveLength(1);
		expect(markup).toContain(">APPLY<");
		expect(markup).not.toMatch(/class="tilefab-assembly-connector-apply"[^>]*disabled/);
	});

	it("presents the same certified surface as CONNECT BANKS for typed Interbay", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssemblyConnectorPanel
				{...props({
					hierarchyRole: "BANK_TO_FAB",
					sourceBayName: "BANK A",
					targetBayName: "BANK B",
				})}
			/>,
		);
		expect(markup).toContain("CONNECT BANKS");
		expect(markup).toContain('data-hierarchy-role="BANK_TO_FAB"');
	});

	it("names the reviewed second route as a Fab Loop without changing the apply contract", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssemblyConnectorPanel
				{...props({
					hierarchyRole: "BANK_TO_FAB",
					purpose: "FAB_LOOP",
					sourceBayName: "BANK A",
					targetBayName: "BANK B",
				})}
			/>,
		);
		expect(markup).toContain("ADD FAB LOOP");
		expect(markup).toContain('data-purpose="FAB_LOOP"');
		expect(markup).toContain("Pick an outer source gateway below the selected Bank.");
	});

	it("keeps gateway and side controls available while the latest route is verifying", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssemblyConnectorPanel
				{...props({
					phase: "verifying",
					sourceCandidates: [candidate, secondCandidate],
					targetCandidates: [candidate, secondCandidate],
					sourceCandidateIndex: 0,
					targetCandidateIndex: 1,
				})}
			/>,
		);
		const selects = markup.match(/<select[^>]*>/g) ?? [];
		expect(markup).toContain('aria-busy="true"');
		expect(selects).toHaveLength(2);
		expect(selects.every((select) => !select.includes("disabled"))).toBe(true);
		expect(markup).toMatch(
			/<fieldset class="tilefab-assembly-connector-side"[^>]*aria-label="Connector corridor side">/,
		);
		expect(markup).not.toMatch(/<button[^>]*class="tilefab-assembly-connector-cycle"[^>]*disabled/);
	});

	it("renders compact pointer and keyboard cues inside the connector surface", () => {
		const markup = renderToStaticMarkup(<StaticFabAssemblyConnectorPanel {...props()} />);
		expect(markup).toContain('<fieldset class="tilefab-assembly-connector-cues">');
		expect(markup).toContain("Assembly connector controls</legend>");
		expect(markup).toContain('aria-label="마우스 왼쪽 클릭"');
		expect(markup).toContain('aria-label="마우스 오른쪽 드래그"');
		expect(markup).toContain("GATEWAY");
		expect(markup).toContain("PAN");
		expect(markup).toContain("SIDE");
		expect(markup).toContain("<kbd>Q</kbd>");
		expect(markup).toContain("<kbd>E</kbd>");
		expect(markup).toContain("<kbd>ESC</kbd>");
		expect(markup).toContain("<kbd>ENTER</kbd>");
	});

	it("announces rejection reason and conflict count without offering a commit", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssemblyConnectorPanel
				{...props({
					phase: "rejected",
					sourceCandidateIndex: 0,
					targetCandidateIndex: 0,
					reason: "Corridor clearance is occupied.",
					conflictCount: 4,
				})}
			/>,
		);
		expect(markup).toContain("4 CONFLICTS");
		expect(markup).toContain(
			'<small class="tilefab-assembly-connector-reason">Corridor clearance is occupied.</small>',
		);
		expect(markup).toContain('role="status" aria-live="polite"');
		expect(markup).toContain('data-rejected="true"');
		expect(markup).toMatch(/class="tilefab-assembly-connector-apply"[^>]*disabled/);
	});

	it("distinguishes an already connected Bay pair from a geometric conflict", () => {
		const markup = renderToStaticMarkup(
			<StaticFabAssemblyConnectorPanel
				{...props({
					phase: "rejected",
					sourceCandidateIndex: 0,
					targetCandidateIndex: 0,
					issueCode: "ALREADY_CONNECTED",
					reason: "The two Bays already share one FAB circulation network.",
					conflictCount: 1,
				})}
			/>,
		);
		expect(markup).toContain("ALREADY CONNECTED");
		expect(markup).not.toContain("1 CONFLICT<");
	});
});
