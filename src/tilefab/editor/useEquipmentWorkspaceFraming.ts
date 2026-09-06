import { type RefObject, useLayoutEffect } from "react";

/** Follow chrome size changes, never pointer motion or authored data, when framing a Port. */
export function useEquipmentWorkspaceFraming(
	workspaceKey: string | null,
	canvasRef: RefObject<HTMLCanvasElement | null>,
	frameRef: RefObject<() => void>,
): void {
	useLayoutEffect(() => {
		const workspace = canvasRef.current?.closest(".tilefab-workspace");
		if (workspaceKey === null || !workspace) return;
		let frame = 0;
		const schedule = (): void => {
			if (frame !== 0) return;
			frame = requestAnimationFrame(() => {
				frame = 0;
				frameRef.current();
			});
		};
		const observer = new ResizeObserver(schedule);
		for (const element of [
			workspace,
			...workspace.querySelectorAll(
				".tilefab-equipment-workspace, .tilefab-guided-build-panel, .tilefab-tools, .tilefab-recovery",
			),
		])
			observer.observe(element);
		schedule();
		return () => {
			observer.disconnect();
			if (frame !== 0) cancelAnimationFrame(frame);
		};
	}, [workspaceKey, canvasRef, frameRef]);
}
