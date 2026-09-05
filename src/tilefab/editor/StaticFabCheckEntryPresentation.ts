export type StaticFabCheckEntryState =
	| "closed"
	| "disconnected"
	| "guided"
	| "loading"
	| "open"
	| "unchecked"
	| "unsafe";

export interface StaticFabCheckEntryPresentation {
	readonly state: StaticFabCheckEntryState;
	readonly label: string;
	readonly ariaLabel: string;
	readonly taskFirst: boolean;
	readonly glyph: "checks" | "status";
}

export function staticFabCheckEntryPresentation(input: {
	readonly baseState: Exclude<StaticFabCheckEntryState, "guided">;
	readonly baseLabel: string;
	readonly open: boolean;
	readonly guidedDeferred: boolean;
	readonly emptyRail: boolean;
}): StaticFabCheckEntryPresentation {
	const ordinaryTaskFirst = input.emptyRail && !input.open && !input.guidedDeferred;
	if (input.guidedDeferred || ordinaryTaskFirst) {
		return Object.freeze({
			state: "guided",
			label: "CHECKS",
			ariaLabel: ordinaryTaskFirst ? "FAB 검사 열기 · 먼저 Rail을 만드세요" : "FAB 검사 열기",
			taskFirst: ordinaryTaskFirst,
			glyph: ordinaryTaskFirst ? "checks" : "status",
		});
	}
	return Object.freeze({
		state: input.baseState,
		label: input.baseLabel,
		ariaLabel: `FAB 검사 ${input.open ? "닫기" : "열기"} · ${input.baseLabel}`,
		taskFirst: false,
		glyph: "status",
	});
}
