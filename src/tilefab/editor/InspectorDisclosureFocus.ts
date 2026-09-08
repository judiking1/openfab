/** A queued native toggle must not move the viewport away from a newer keyboard target. */
export function scrollFocusedInspectorDisclosure(details: HTMLDetailsElement): void {
	if (details.open) return;
	const summary = details.querySelector<HTMLElement>(":scope > summary");
	if (summary && details.ownerDocument.activeElement === summary) {
		summary.scrollIntoView({ block: "nearest" });
	}
}
