import { describe, expect, it } from "vitest";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import {
	chooseGuidedRailKeyboardInitialCell,
	continueGuidedRailKeyboardSession,
	createGuidedRailKeyboardBinding,
	createGuidedRailKeyboardSession,
	createOrdinaryRailKeyboardSession,
	guidedRailKeyboardAccessiblePresentation,
	guidedRailKeyboardOperationInstruction,
	guidedRailKeyboardSessionIsCurrent,
	moveGuidedRailKeyboardEndpoint,
	railKeyboardExitStatus,
	selectGuidedRailKeyboardSource,
} from "./GuidedRailKeyboardSession";

describe("GuidedRailKeyboardSession", () => {
	it("uses phase-specific operation copy for active mission help", () => {
		expect(guidedRailKeyboardOperationInstruction("choose-start")).toContain(
			"방향키로 시작점을 1미터씩",
		);
		expect(guidedRailKeyboardOperationInstruction("choose-start")).toContain("Enter로 선택");
		expect(guidedRailKeyboardOperationInstruction("choose-end")).toContain(
			"방향키로 끝점을 1미터씩",
		);
		expect(guidedRailKeyboardOperationInstruction("choose-end")).toContain("Enter로 구간을 확정");
	});

	it("names ordinary Escape as exit while preserving Guided preview cancellation", () => {
		expect(railKeyboardExitStatus("ordinary")).toBe(
			"키보드 레일 건설을 종료했습니다 · 확정한 구간은 유지됩니다",
		);
		expect(railKeyboardExitStatus("guided")).toBe(
			"키보드 레일 미리보기를 취소했습니다 · 확정한 구간은 유지됩니다",
		);
	});

	it("describes 1 m start and endpoint movement with bounded validity keys", () => {
		const document = new RailDocument();
		const initial = createGuidedRailKeyboardSession(
			"first-rail",
			{ x: 4, y: 8 },
			createGuidedRailKeyboardBinding(0, document, document.map),
		);
		const movedStart = moveGuidedRailKeyboardEndpoint(initial, "right", false);
		const selectingEnd = selectGuidedRailKeyboardSource(movedStart);
		const movedEnd = moveGuidedRailKeyboardEndpoint(selectingEnd, "right", false);

		expect(guidedRailKeyboardAccessiblePresentation(movedStart, null)).toEqual({
			summary: "키보드 레일 시작점 단계 · X 5미터 · Z 8미터 · 길이 0미터 · Enter로 시작점 선택",
			validityKey: "choose-start",
		});
		expect(
			guidedRailKeyboardAccessiblePresentation(selectingEnd, {
				lengthMeters: 0,
				valid: false,
				reason: "시작점과 끝점이 같습니다",
			}),
		).toEqual({
			summary:
				"키보드 레일 끝점 단계 · X 5미터 · Z 8미터 · 시작점 기준 0미터 · 배치 불가 · 시작점과 끝점이 같습니다",
			validityKey: "invalid:시작점과 끝점이 같습니다",
		});
		expect(
			guidedRailKeyboardAccessiblePresentation(movedEnd, {
				lengthMeters: 1,
				valid: true,
				reason: "",
			}),
		).toEqual({
			summary:
				"키보드 레일 끝점 단계 · X 6미터 · Z 8미터 · 시작점 기준 1미터 · 배치 가능 · Enter로 구간 확정",
			validityKey: "valid",
		});
	});

	it("moves a transient cursor by 1 m or 5 m without mutating the map", () => {
		const document = new RailDocument();
		const binding = createGuidedRailKeyboardBinding(3, document, document.map);
		const initial = createGuidedRailKeyboardSession("first-rail", { x: 4, y: 8 }, binding);

		const nudged = moveGuidedRailKeyboardEndpoint(initial, "right", false);
		const accelerated = moveGuidedRailKeyboardEndpoint(nudged, "down", true);

		expect(initial.endpoint).toEqual({ x: 4, y: 8 });
		expect(accelerated.endpoint).toEqual({ x: 5, y: 13 });
		expect(document.map.edgeCount).toBe(0);
		expect(document.canUndo).toBe(false);
	});

	it("keeps an ordinary owner distinct from Guided Build while continuing", () => {
		const document = new RailDocument();
		const initial = createOrdinaryRailKeyboardSession(
			{ x: 9, y: 4 },
			createGuidedRailKeyboardBinding(2, document, document.map),
		);
		const selectingEnd = selectGuidedRailKeyboardSource(initial);
		const continued = continueGuidedRailKeyboardSession(
			selectingEnd,
			{ x: 14, y: 4 },
			createGuidedRailKeyboardBinding(2, document, document.map),
		);

		expect(initial).toMatchObject({ scope: "ordinary", mission: null, phase: "choose-start" });
		expect(continued).toMatchObject({
			scope: "ordinary",
			mission: null,
			phase: "choose-start",
			source: null,
			endpoint: { x: 14, y: 4 },
		});
		expect(document.map.edgeCount).toBe(0);
		expect(document.canUndo).toBe(false);
	});

	it("selects a source and returns to an explicit start phase after an ordinary commit", () => {
		const document = new RailDocument();
		const initial = createGuidedRailKeyboardSession(
			"first-rail",
			{ x: 0, y: 0 },
			createGuidedRailKeyboardBinding(0, document, document.map),
		);
		const selectingEnd = selectGuidedRailKeyboardSource(initial);
		const endpoint = { x: 15, y: 0 };
		const plan = planRailConstruction(
			document.map,
			selectingEnd.source as { x: number; y: number },
			endpoint,
		);

		expect(document.commit(plan)).toBe(true);
		const continued = continueGuidedRailKeyboardSession(
			selectingEnd,
			endpoint,
			createGuidedRailKeyboardBinding(1, document, document.map),
		);

		expect(continued).toMatchObject({
			phase: "choose-start",
			source: null,
			endpoint,
		});
		expect(document.canUndo).toBe(true);
		expect(document.map.edgeCount).toBe(15);
	});

	it("invalidates a session when generation, map revision, or patch sequence changes", () => {
		const document = new RailDocument();
		const binding = createGuidedRailKeyboardBinding(7, document, document.map);
		const session = createGuidedRailKeyboardSession("first-rail", { x: 0, y: 0 }, binding);

		expect(guidedRailKeyboardSessionIsCurrent(session, binding)).toBe(true);
		expect(guidedRailKeyboardSessionIsCurrent(session, { ...binding, modelGeneration: 8 })).toBe(
			false,
		);

		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 1, y: 0 }));
		expect(
			guidedRailKeyboardSessionIsCurrent(
				session,
				createGuidedRailKeyboardBinding(7, document, document.map),
			),
		).toBe(false);
	});

	it("starts a loop from the forward sink and a first rail from nearby empty space", () => {
		const document = new RailDocument();
		document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 15, y: 0 }));

		expect(
			chooseGuidedRailKeyboardInitialCell(
				document.map,
				"process-loop",
				{ x: 4, y: 0 },
				new Int32Array([0, 0, 15, 0]),
			),
		).toEqual({ x: 15, y: 0 });
		expect(
			chooseGuidedRailKeyboardInitialCell(
				document.map,
				"first-rail",
				{ x: 0, y: 0 },
				new Int32Array(),
			),
		).not.toEqual({ x: 0, y: 0 });
	});
});
