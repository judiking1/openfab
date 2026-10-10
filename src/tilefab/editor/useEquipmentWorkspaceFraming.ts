import { type RefObject, useLayoutEffect } from "react";

/** Frame an intentional task/target transition once; resizing chrome must preserve the camera. */
export function useEquipmentWorkspaceFraming(
	workspaceKey: string | null,
	canvasRef: RefObject<HTMLCanvasElement | null>,
	frameRef: RefObject<() => void>,
): void {
	useLayoutEffect(() => {
		const workspace = canvasRef.current?.closest(".tilefab-workspace");
		if (workspaceKey === null || !workspace) return;
		const frame = requestAnimationFrame(() => frameRef.current());
		return () => cancelAnimationFrame(frame);
	}, [workspaceKey, canvasRef, frameRef]);
}
