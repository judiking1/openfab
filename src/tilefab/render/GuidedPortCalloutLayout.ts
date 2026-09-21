export const GUIDED_PORT_CALLOUT_FONTS = Object.freeze({
	label: "700 12px ui-sans-serif, system-ui, sans-serif",
	instruction: "11px ui-sans-serif, system-ui, sans-serif",
});

type CalloutTextKind = keyof typeof GUIDED_PORT_CALLOUT_FONTS;

interface GuidedPortCalloutInput {
	readonly width: number;
	readonly height: number;
	readonly anchor: Readonly<{ x: number; y: number }>;
	readonly markerRadius: number;
	readonly label: string;
	readonly instruction: string;
	readonly reservedLeftPixels?: number;
	readonly reservedRightPixels?: number;
	readonly reservedTopPixels?: number;
	readonly reservedBottomPixels?: number;
	readonly measure: (text: string, kind: CalloutTextKind) => number;
}

export interface GuidedPortCalloutLayout {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly labelLines: readonly string[];
	readonly instructionLines: readonly string[];
	readonly instructionOffset: number;
	readonly connector: Readonly<{ x: number; fromY: number; toY: number }>;
}

/** Renderer-only layout: never cover reserved chrome or the Port this callout explains. */
export function guidedPortCalloutLayout(
	input: GuidedPortCalloutInput,
): GuidedPortCalloutLayout | null {
	const left = Math.max(0, input.reservedLeftPixels ?? 0) + 8;
	const right = input.width - Math.max(0, input.reservedRightPixels ?? 0) - 8;
	const top = Math.max(0, input.reservedTopPixels ?? 0) + 8;
	const bottom = input.height - Math.max(0, input.reservedBottomPixels ?? 0) - 8;
	const width = Math.min(
		right - left,
		Math.max(
			184,
			input.measure(input.label, "label") + 20,
			input.measure(input.instruction, "instruction") + 20,
		),
	);
	if (width <= 20 || bottom <= top) return null;
	const wrap = (text: string, kind: CalloutTextKind): string[] | null => {
		if (input.measure(text, kind) <= width - 20) return text ? [text] : [];
		const lines: string[] = [];
		let line = "";
		for (const character of text) {
			if (input.measure(character, kind) > width - 20) return null;
			if (line && input.measure(line + character, kind) > width - 20) {
				lines.push(line.trimEnd());
				line = "";
			}
			if (line || character.trim()) line += character;
		}
		if (line) lines.push(line.trimEnd());
		return lines;
	};
	const labelLines = wrap(input.label, "label");
	const instructionLines = wrap(input.instruction, "instruction");
	if (!labelLines || !instructionLines) return null;
	const instructionOffset = 8 + labelLines.length * 16 + 4;
	const height = instructionOffset + instructionLines.length * 14 + 8;
	const gap = input.markerRadius + 10;
	const above = input.anchor.y - gap - height;
	const below = input.anchor.y + gap;
	// If neither placement fits, the existing accessible Guide panel retains the full instruction.
	const y = above >= top ? above : below + height <= bottom ? below : null;
	if (y === null || y < top || y + height > bottom) return null;
	const x = Math.max(left, Math.min(input.anchor.x - width / 2, right - width));
	const isAbove = y < input.anchor.y;
	return {
		x,
		y,
		width,
		height,
		labelLines,
		instructionLines,
		instructionOffset,
		connector: {
			x: Math.max(x + 5, Math.min(input.anchor.x, x + width - 5)),
			fromY: isAbove ? y + height : y,
			toY: input.anchor.y + (isAbove ? -1 : 1) * (input.markerRadius + 4),
		},
	};
}
