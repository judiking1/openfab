import { type RefObject, useLayoutEffect } from "react";

/** Report clipped navigation content without changing the user's chosen menu density. */
export function useEditorNavigationScroll(
	navigationRef: RefObject<HTMLElement | null>,
	activity: string,
	expanded: boolean,
): void {
	useLayoutEffect(() => {
		const navigation = navigationRef.current;
		if (!navigation) return;
		navigation.dataset.scrollContext = `${activity}:${expanded ? "expanded" : "compact"}`;
		let resetScroll = true;
		const update = (): void => {
			// Reset and measure after the observer's initial layout notification. Even writing
			// scrollTop during mount would synchronously lay out the whole editor.
			if (resetScroll) {
				resetScroll = false;
				navigation.scrollTop = 0;
			}
			navigation.dataset.moreTools = String(
				navigation.scrollHeight - navigation.clientHeight - navigation.scrollTop > 1,
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(navigation);
		for (const child of navigation.querySelectorAll(
			".tilefab-editor-activity-rail, .tilefab-editor-activity-tools",
		)) {
			observer.observe(child);
		}
		navigation.addEventListener("scroll", update, { passive: true });
		return () => {
			observer.disconnect();
			navigation.removeEventListener("scroll", update);
			delete navigation.dataset.moreTools;
			delete navigation.dataset.scrollContext;
		};
	}, [navigationRef, activity, expanded]);
}
