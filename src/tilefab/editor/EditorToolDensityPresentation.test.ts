import { describe, expect, it } from "vitest";
import { editorToolDensityPresentation } from "./EditorToolDensityPresentation";

const BASE = Object.freeze({
	blueprintLibraryOpen: false,
	compactNavigatorViewport: true,
	staticFabNavigatorOpen: false,
	compactInspectorCollisionViewport: true,
	contextualInspectorVisible: false,
	templatePaletteOpen: false,
	compactPortViewport: true,
	ordinaryPortAuthoringActive: false,
});

describe("editorToolDensityPresentation", () => {
	it("keeps the ordinary editor preference in charge outside a compact Port task", () => {
		expect(editorToolDensityPresentation(BASE)).toEqual({
			hardConstraint: null,
			ordinaryPortContextActive: false,
			ordinaryPortFocus: false,
		});
	});

	it("starts a compact ordinary Port task without turning it into a hard constraint", () => {
		expect(editorToolDensityPresentation({ ...BASE, ordinaryPortAuthoringActive: true })).toEqual({
			hardConstraint: null,
			ordinaryPortContextActive: true,
			ordinaryPortFocus: true,
		});
	});

	it("retains existing overlay priority over Port focus", () => {
		expect(
			editorToolDensityPresentation({
				...BASE,
				blueprintLibraryOpen: true,
				ordinaryPortAuthoringActive: true,
			}),
		).toEqual({
			hardConstraint: "청사진 라이브러리가 열려 있어 도구 설명을 접었습니다",
			ordinaryPortContextActive: true,
			ordinaryPortFocus: false,
		});
	});

	it("does not apply Port focus beyond the compact breakpoint", () => {
		expect(
			editorToolDensityPresentation({
				...BASE,
				compactPortViewport: false,
				ordinaryPortAuthoringActive: true,
			}),
		).toEqual({
			hardConstraint: null,
			ordinaryPortContextActive: false,
			ordinaryPortFocus: false,
		});
	});
});
