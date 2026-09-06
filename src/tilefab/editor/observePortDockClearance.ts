/** React ref cleanup keeps transient notices above the actual, wrapping equipment dock. */
export function observePortDockClearance(dock: HTMLElement | null): (() => void) | undefined {
	const workspace = dock?.closest<HTMLElement>(".tilefab-workspace");
	if (!dock || !workspace) return;
	const property = "--tilefab-port-dock-clearance";
	const measure = (): void => {
		const bounds = dock.getBoundingClientRect();
		if (bounds.height === 0) return;
		const clearance = `${Math.ceil(workspace.getBoundingClientRect().bottom - bounds.top) + 12}px`;
		if (workspace.style.getPropertyValue(property) !== clearance) {
			workspace.style.setProperty(property, clearance);
		}
	};
	measure();
	const observer = new ResizeObserver(measure);
	observer.observe(dock);
	observer.observe(workspace);
	return () => {
		observer.disconnect();
		workspace.style.removeProperty(property);
	};
}
