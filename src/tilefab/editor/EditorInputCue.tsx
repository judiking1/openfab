export function EditorInputCue({ input }: { readonly input: string }): React.ReactElement {
	const mouseButton =
		input === "LMB" || input === "LMB DRAG"
			? "left"
			: input === "RMB" || input === "RMB DRAG"
				? "right"
				: input === "MMB" || input === "MMB DRAG" || input === "WHEEL"
					? "middle"
					: null;
	if (!mouseButton) return <kbd>{input}</kbd>;
	const gesture = input === "WHEEL" ? "wheel" : input.endsWith("DRAG") ? "drag" : "click";
	const buttonLabel =
		mouseButton === "left" ? "왼쪽" : mouseButton === "right" ? "오른쪽" : "가운데";
	const accessibleGesture = gesture === "drag" ? "드래그" : gesture === "wheel" ? "휠" : "클릭";
	return (
		<span
			className="tilefab-mouse-cue"
			data-button={mouseButton}
			data-gesture={gesture}
			role="img"
			aria-label={`마우스 ${buttonLabel} ${accessibleGesture}`}
		>
			<span className="tilefab-mouse-cue-device" aria-hidden="true">
				<i data-button="left" />
				<i data-button="middle" />
				<i data-button="right" />
			</span>
			<small>{gesture.toUpperCase()}</small>
		</span>
	);
}
