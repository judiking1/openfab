export interface EditorToolDensityPresentationInput {
	readonly blueprintLibraryOpen: boolean;
	readonly compactNavigatorViewport: boolean;
	readonly staticFabNavigatorOpen: boolean;
	readonly compactInspectorCollisionViewport: boolean;
	readonly contextualInspectorVisible: boolean;
	readonly templatePaletteOpen: boolean;
	readonly compactPortViewport: boolean;
	readonly ordinaryPortAuthoringActive: boolean;
}

export interface EditorToolDensityPresentation {
	readonly hardConstraint: string | null;
	readonly ordinaryPortContextActive: boolean;
	readonly ordinaryPortFocus: boolean;
}

/**
 * Projects transient overlay/task ownership into the left-tool density contract. A hard constraint
 * prevents an overlay collision. Ordinary Port focus is deliberately soft: it starts compact but
 * leaves the user's density toggle available and never rewrites the saved in-session preference.
 */
export function editorToolDensityPresentation(
	input: EditorToolDensityPresentationInput,
): EditorToolDensityPresentation {
	const hardConstraint = input.blueprintLibraryOpen
		? "청사진 라이브러리가 열려 있어 도구 설명을 접었습니다"
		: input.compactNavigatorViewport && input.staticFabNavigatorOpen
			? "내비게이터가 열려 있어 도구 설명을 접었습니다"
			: input.compactInspectorCollisionViewport && input.contextualInspectorVisible
				? "Inspector가 열려 있어 도구 설명을 접었습니다"
				: input.templatePaletteOpen
					? "조립 패널이 열려 있어 도구 설명을 접었습니다"
					: null;
	const ordinaryPortContextActive = input.compactPortViewport && input.ordinaryPortAuthoringActive;
	return Object.freeze({
		hardConstraint,
		ordinaryPortContextActive,
		ordinaryPortFocus: hardConstraint === null && ordinaryPortContextActive,
	});
}
