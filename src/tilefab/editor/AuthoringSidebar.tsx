import {
	ArrowLeft,
	ArrowRight,
	ChevronLeft,
	ChevronRight,
	Factory,
	Home,
	LibraryBig,
	Route,
	Search,
	Warehouse,
} from "lucide-react";
import { type ReactElement, useId } from "react";

export type AuthoringCategory = "fab" | "rail" | "equipment" | "blueprints";

export interface AuthoringAction {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly active?: boolean;
	readonly availability:
		| Readonly<{ state: "ready"; reason?: string }>
		| Readonly<{ state: "blocked"; reason: string }>;
	readonly onActivate: (trigger: HTMLButtonElement) => void;
}

export interface AuthoringSection {
	readonly id: string;
	readonly title: string;
	readonly description?: string;
	readonly actions: readonly AuthoringAction[];
}

export interface AuthoringSidebarProps {
	readonly browseCategory: AuthoringCategory | null;
	readonly sections: readonly AuthoringSection[];
	readonly utilityActions: readonly AuthoringAction[];
	readonly compact: boolean;
	readonly expanded: boolean;
	readonly onExpandedChange: (expanded: boolean) => void;
	readonly onBrowseCategory: (
		category: AuthoringCategory | null,
		trigger: HTMLButtonElement,
	) => void;
}

const CATEGORIES = [
	{ id: "fab", label: "FAB 제작", icon: Factory },
	{ id: "rail", label: "레일", icon: Route },
	{ id: "equipment", label: "장비", icon: Warehouse },
	{ id: "blueprints", label: "청사진", icon: LibraryBig },
] as const;

/** Browsing is presentation only; the caller owns command admission and active tasks. */
export function AuthoringSidebar({
	browseCategory,
	sections,
	utilityActions,
	compact,
	expanded,
	onExpandedChange,
	onBrowseCategory,
}: AuthoringSidebarProps): ReactElement {
	const instanceId = useId();
	const titleId = `${instanceId}-title`;
	const bodyId = `${instanceId}-body`;
	const contentId = `${instanceId}-content`;
	const utilityTitleId = `${instanceId}-utility-title`;
	const currentLabel = CATEGORIES.find(({ id }) => id === browseCategory)?.label ?? "제작 홈";

	return (
		<aside
			id="openfab-authoring-sidebar"
			className="tilefab-authoring-sidebar"
			data-testid="authoring-sidebar"
			data-browse-category={browseCategory ?? "home"}
			data-compact={compact}
			data-expanded={expanded}
			aria-labelledby={titleId}
		>
			<header className="tilefab-authoring-sidebar-heading">
				<div className="tilefab-authoring-sidebar-heading-copy">
					<h2 id={titleId}>만들기</h2>
					<p className="tilefab-authoring-sidebar-current">{currentLabel}</p>
				</div>
				<button
					type="button"
					className="tilefab-authoring-sidebar-toggle"
					data-testid="authoring-sidebar-toggle"
					aria-label={expanded ? "제작 도구 접기" : "제작 도구 펼치기"}
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={() => onExpandedChange(!expanded)}
				>
					{expanded ? (
						<ChevronLeft size={18} aria-hidden="true" />
					) : (
						<ChevronRight size={18} aria-hidden="true" />
					)}
					<span>{expanded ? "접기" : "제작 도구"}</span>
				</button>
			</header>
			<div
				id={bodyId}
				className="tilefab-authoring-sidebar-body"
				hidden={!expanded}
				inert={!expanded}
			>
				<nav className="tilefab-authoring-sidebar-categories" aria-label="제작 카테고리">
					<button
						type="button"
						className="tilefab-authoring-sidebar-category tilefab-authoring-sidebar-home"
						data-authoring-category="home"
						data-active={browseCategory === null}
						aria-current={browseCategory === null ? "true" : undefined}
						aria-expanded={browseCategory === null && expanded}
						aria-controls={contentId}
						onClick={(event) => onBrowseCategory(null, event.currentTarget)}
					>
						{browseCategory === null ? (
							<Home size={18} aria-hidden="true" />
						) : (
							<ArrowLeft size={18} aria-hidden="true" />
						)}
						<span>{browseCategory === null ? "제작 홈" : "제작 홈으로"}</span>
					</button>
					{CATEGORIES.map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							className="tilefab-authoring-sidebar-category"
							data-authoring-category={id}
							data-active={browseCategory === id}
							aria-current={browseCategory === id ? "true" : undefined}
							aria-expanded={browseCategory === id && expanded}
							aria-controls={contentId}
							onClick={(event) => onBrowseCategory(id, event.currentTarget)}
						>
							<Icon size={20} aria-hidden="true" />
							<span>{label}</span>
						</button>
					))}
				</nav>
				<div id={contentId} className="tilefab-authoring-sidebar-content">
					{sections.map((section) => (
						<AuthoringSectionView key={section.id} section={section} />
					))}
				</div>
				{utilityActions.length > 0 ? (
					<section className="tilefab-authoring-sidebar-utilities" aria-labelledby={utilityTitleId}>
						<h3 id={utilityTitleId}>
							<Search size={16} aria-hidden="true" />
							<span>선택·검사</span>
						</h3>
						<ul className="tilefab-authoring-sidebar-actions">
							{utilityActions.map((action) => (
								<li key={action.id}>
									<AuthoringActionButton action={action} />
								</li>
							))}
						</ul>
					</section>
				) : null}
			</div>
		</aside>
	);
}

function AuthoringSectionView({ section }: { readonly section: AuthoringSection }): ReactElement {
	const titleId = useId();
	return (
		<section
			className="tilefab-authoring-sidebar-section"
			data-authoring-section={section.id}
			aria-labelledby={titleId}
		>
			<h3 id={titleId}>{section.title}</h3>
			{section.description ? (
				<p className="tilefab-authoring-sidebar-description">{section.description}</p>
			) : null}
			<ul className="tilefab-authoring-sidebar-actions">
				{section.actions.map((action) => (
					<li key={action.id}>
						<AuthoringActionButton action={action} />
					</li>
				))}
			</ul>
		</section>
	);
}

function AuthoringActionButton({ action }: { readonly action: AuthoringAction }): ReactElement {
	const instanceId = useId();
	const descriptionId = `${instanceId}-description`;
	const reasonId = `${instanceId}-reason`;
	const blocked = action.availability.state === "blocked";
	const reason = action.availability.reason;
	const showReason = Boolean(reason && reason !== action.description);
	const descriptionIds = [action.description ? descriptionId : null, showReason ? reasonId : null]
		.filter(Boolean)
		.join(" ");

	return (
		<button
			type="button"
			className="tilefab-authoring-sidebar-action"
			data-authoring-action={action.id}
			data-active={action.active ?? false}
			data-availability={action.availability.state}
			aria-label={action.label}
			aria-describedby={descriptionIds || undefined}
			aria-pressed={action.active}
			aria-disabled={blocked || undefined}
			onClick={(event) => {
				if (!blocked) action.onActivate(event.currentTarget);
			}}
		>
			<span className="tilefab-authoring-sidebar-action-copy">
				<strong>{action.label}</strong>
				{action.description ? (
					<span id={descriptionId} className="tilefab-authoring-sidebar-description">
						{action.description}
					</span>
				) : null}
				{showReason ? (
					<span id={reasonId} className="tilefab-authoring-sidebar-reason">
						{reason}
					</span>
				) : null}
			</span>
			{!blocked ? <ArrowRight size={16} aria-hidden="true" /> : null}
		</button>
	);
}
