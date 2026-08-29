import { Factory, Route, Search, Warehouse } from "lucide-react";
import {
	EDITOR_ACTIVITY_DEFINITIONS,
	type EditorActivity,
	type EditorActivityAvailability,
} from "./EditorActivity";

export type { EditorActivity, EditorActivityAvailability } from "./EditorActivity";

export interface EditorActivityRailProps {
	readonly activeActivity: EditorActivity;
	readonly availability?: Readonly<Partial<Record<EditorActivity, EditorActivityAvailability>>>;
	readonly blockedReason?: string | null;
	readonly controls?: Readonly<Partial<Record<EditorActivity, string>>>;
	readonly expanded?: Readonly<Partial<Record<EditorActivity, boolean>>>;
	readonly label?: string;
	readonly visibleActivities?: readonly EditorActivity[];
	readonly onActivityChange: (activity: EditorActivity, trigger: HTMLButtonElement) => void;
}

const READY: EditorActivityAvailability = { state: "ready" };

export function EditorActivityRail({
	activeActivity,
	availability,
	blockedReason,
	controls,
	expanded,
	label = "Editor activities",
	visibleActivities,
	onActivityChange,
}: EditorActivityRailProps): React.ReactElement {
	const visibleActivitySet = visibleActivities ? new Set(visibleActivities) : null;
	const visibleDefinitions = EDITOR_ACTIVITY_DEFINITIONS.filter(
		(definition) =>
			visibleActivitySet === null ||
			visibleActivitySet.has(definition.id) ||
			definition.id === activeActivity,
	);
	return (
		<fieldset
			className="tilefab-editor-activity-rail"
			aria-label={label}
			data-testid="editor-activity-rail"
		>
			{visibleDefinitions.map((definition) => {
				const activityAvailability = blockedReason
					? ({ state: "blocked", reason: blockedReason } as const)
					: (availability?.[definition.id] ?? READY);
				const blocked = activityAvailability.state === "blocked";
				const status = blocked
					? activityAvailability.reason
					: (activityAvailability.reason ?? definition.description);
				const accessibleLabel = blocked
					? `${definition.label}: ${definition.description}. Unavailable: ${activityAvailability.reason}`
					: `${definition.label}: ${definition.description}`;

				return (
					<button
						key={definition.id}
						type="button"
						className="tilefab-editor-activity-button"
						data-testid={`editor-activity-${definition.id}`}
						data-activity={definition.id}
						data-active={definition.id === activeActivity}
						data-availability={activityAvailability.state}
						aria-label={accessibleLabel}
						aria-pressed={definition.id === activeActivity}
						aria-controls={controls?.[definition.id]}
						aria-expanded={expanded?.[definition.id]}
						disabled={blocked}
						title={status}
						onClick={(event) => onActivityChange(definition.id, event.currentTarget)}
					>
						<span className="tilefab-editor-activity-icon" aria-hidden="true">
							<EditorActivityIcon activity={definition.id} />
						</span>
						<span className="tilefab-editor-activity-copy">
							<strong>{definition.label}</strong>
							<small>{status}</small>
						</span>
					</button>
				);
			})}
		</fieldset>
	);
}

function EditorActivityIcon({
	activity,
}: {
	readonly activity: EditorActivity;
}): React.ReactElement {
	if (activity === "build") return <Route size={20} />;
	if (activity === "assemble") return <Factory size={20} />;
	if (activity === "equip") return <Warehouse size={20} />;
	return <Search size={20} />;
}
