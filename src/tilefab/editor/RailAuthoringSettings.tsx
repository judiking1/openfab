import { CornerDownRight } from "lucide-react";
import type { BendPreference } from "../core/paint";

/** Route settings are a projection; the editor owns previews and gesture commits. */
export function RailAuthoringSettings({
	bend,
	disabled,
	onChange,
}: {
	readonly bend: BendPreference;
	readonly disabled: boolean;
	readonly onChange: (bend: BendPreference) => void;
}) {
	return (
		<fieldset
			className="tilefab-segmented tilefab-rail-authoring-settings"
			aria-label="코너 경로"
			disabled={disabled}
		>
			<legend>레일 경로</legend>
			{(
				[
					["auto", "자동", "충돌을 피하는 코너를 자동 선택"],
					["horizontal-first", "X→Z", "X축 이후 Z축"],
					["vertical-first", "Z→X", "Z축 이후 X축"],
				] as const
			).map(([value, label, title]) => (
				<button
					key={value}
					type="button"
					data-active={bend === value}
					aria-pressed={bend === value}
					title={title}
					onClick={() => onChange(value)}
				>
					{value === "auto" ? null : (
						<CornerDownRight
							size={14}
							className={value === "vertical-first" ? "tilefab-turn-icon" : undefined}
						/>
					)}
					{label}
				</button>
			))}
		</fieldset>
	);
}
