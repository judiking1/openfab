import { X } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import {
	nextCanvasOrganizationOverlapFocusTarget,
	nextCanvasOrganizationOverlapIndex,
} from "./CanvasOrganizationOverlapChooserNavigation";

export type CanvasOrganizationOverlapRole = "FAB" | "BAY_BANK" | "BAY";

export interface CanvasOrganizationOverlapCandidate {
	readonly organizationId: number;
	readonly semanticRole: CanvasOrganizationOverlapRole;
	readonly displayName: string;
}

export interface CanvasOrganizationOverlapChooserProps {
	readonly candidates: readonly CanvasOrganizationOverlapCandidate[];
	readonly anchor: Readonly<{
		clientX: number;
		clientY: number;
	}>;
	readonly onChoose: (organizationId: number) => void;
	readonly onCancel: () => void;
	readonly onActiveChange?: (organizationId: number) => void;
}

function semanticRoleLabel(role: CanvasOrganizationOverlapRole): string {
	if (role === "BAY_BANK") return "BAY BANK";
	return role;
}

function sameRoleCandidates(
	candidates: readonly CanvasOrganizationOverlapCandidate[],
): readonly CanvasOrganizationOverlapCandidate[] {
	const firstRole = candidates[0]?.semanticRole;
	if (!firstRole) return [];
	return candidates.filter((candidate) => candidate.semanticRole === firstRole);
}

export function CanvasOrganizationOverlapChooser({
	candidates,
	anchor,
	onChoose,
	onCancel,
	onActiveChange,
}: CanvasOrganizationOverlapChooserProps) {
	const visibleCandidates = sameRoleCandidates(candidates);
	const [requestedActiveIndex, setRequestedActiveIndex] = useState(0);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const closeButtonRef = useRef<HTMLButtonElement | null>(null);
	const hasFocusedInitialOptionRef = useRef(false);
	const lastAnnouncedActiveIdRef = useRef<number | null>(null);
	const titleId = useId();
	const instructionsId = useId();
	const activeIndex = Math.min(requestedActiveIndex, Math.max(0, visibleCandidates.length - 1));
	const activeCandidate = visibleCandidates[activeIndex] ?? null;

	useEffect(() => {
		if (hasFocusedInitialOptionRef.current || !activeCandidate) return;
		const option = optionRefs.current[activeIndex];
		if (!option) return;
		hasFocusedInitialOptionRef.current = true;
		option.focus();
		if (lastAnnouncedActiveIdRef.current !== activeCandidate.organizationId) {
			lastAnnouncedActiveIdRef.current = activeCandidate.organizationId;
			onActiveChange?.(activeCandidate.organizationId);
		}
	});

	if (!activeCandidate) return null;

	const activate = (index: number, focus: boolean): void => {
		const candidate = visibleCandidates[index];
		if (!candidate) return;
		setRequestedActiveIndex(index);
		if (lastAnnouncedActiveIdRef.current !== candidate.organizationId) {
			lastAnnouncedActiveIdRef.current = candidate.organizationId;
			onActiveChange?.(candidate.organizationId);
		}
		if (focus) optionRefs.current[index]?.focus();
	};

	const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			event.stopPropagation();
			const candidate = visibleCandidates[index];
			if (candidate) onChoose(candidate.organizationId);
			return;
		}
		if (
			event.key !== "ArrowDown" &&
			event.key !== "ArrowUp" &&
			event.key !== "Home" &&
			event.key !== "End"
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		const nextIndex = nextCanvasOrganizationOverlapIndex({
			currentIndex: index,
			itemCount: visibleCandidates.length,
			key: event.key,
		});
		if (nextIndex !== null) activate(nextIndex, true);
	};

	const handleChooserKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			onCancel();
			return;
		}
		if (event.key !== "Tab") return;
		const activeOption = optionRefs.current[activeIndex];
		const closeButton = closeButtonRef.current;
		if (!activeOption || !closeButton) return;
		event.preventDefault();
		event.stopPropagation();
		const currentTarget = event.target === closeButton ? "close" : "active-option";
		const nextTarget = nextCanvasOrganizationOverlapFocusTarget(currentTarget);
		if (nextTarget === "close") closeButton.focus();
		else activeOption.focus();
	};

	const style = {
		"--tilefab-overlap-anchor-x": `${Math.round(anchor.clientX)}px`,
		"--tilefab-overlap-anchor-y": `${Math.round(anchor.clientY)}px`,
	} as CSSProperties;

	return (
		<section
			className="tilefab-canvas-organization-overlap-chooser"
			style={style}
			aria-labelledby={titleId}
			data-semantic-role={activeCandidate.semanticRole}
			onKeyDown={handleChooserKeyDown}
		>
			<header>
				<span>
					<strong id={titleId}>겹친 조직 선택</strong>
					<small>{semanticRoleLabel(activeCandidate.semanticRole)} 후보</small>
				</span>
				<button
					ref={closeButtonRef}
					type="button"
					className="tilefab-canvas-organization-overlap-close"
					aria-label="겹침 선택 닫기"
					onClick={onCancel}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<p id={instructionsId}>
				방향키로 후보를 이동하고 Enter 또는 Space로 선택하세요. Tab은 선택기 안에서 이동합니다.
			</p>
			<div
				className="tilefab-canvas-organization-overlap-list"
				role="listbox"
				aria-label="겹친 FAB 조직 선택"
				aria-describedby={instructionsId}
			>
				{visibleCandidates.map((candidate, index) => {
					const selected = index === activeIndex;
					return (
						<button
							key={candidate.organizationId}
							ref={(element) => {
								optionRefs.current[index] = element;
							}}
							type="button"
							role="option"
							aria-selected={selected}
							aria-label={`${candidate.displayName} ${semanticRoleLabel(candidate.semanticRole)} 선택`}
							tabIndex={selected ? 0 : -1}
							data-active={selected}
							data-organization-id={candidate.organizationId}
							onFocus={() => activate(index, false)}
							onPointerEnter={() => activate(index, true)}
							onKeyDown={(event) => handleOptionKeyDown(event, index)}
							onClick={() => onChoose(candidate.organizationId)}
						>
							<span>{candidate.displayName}</span>
							<small>{semanticRoleLabel(candidate.semanticRole)}</small>
						</button>
					);
				})}
			</div>
		</section>
	);
}
