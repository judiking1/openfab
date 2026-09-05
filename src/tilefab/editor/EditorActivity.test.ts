import { describe, expect, it } from "vitest";
import { EDITOR_ACTIVITIES, editorActivityCanvasLabel } from "./EditorActivity";

describe("editor activity Canvas accessibility", () => {
	it("names the shared Canvas for the active product task", () => {
		expect(EDITOR_ACTIVITIES.map((activity) => editorActivityCanvasLabel(activity))).toEqual([
			"단방향 AMHS 레일 건설 캔버스",
			"정적 FAB 조립 및 조직 편집 캔버스",
			"정적 FAB Port 및 장비 편집 캔버스",
			"정적 FAB 선택 및 검사 캔버스",
		]);
	});
});
