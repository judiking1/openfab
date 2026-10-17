import {
	ArrowLeft,
	ArrowRight,
	Box,
	ChevronLeft,
	ChevronRight,
	Copy,
	Cpu,
	Factory,
	HelpCircle,
	Home,
	LayoutGrid,
	LibraryBig,
	Link2,
	ListChecks,
	MousePointer2,
	Route,
	Search,
	SquareDashed,
	Warehouse,
} from "lucide-react";
import { type ReactElement, useId } from "react";

export type AuthoringCategory = "fab" | "rail" | "equipment" | "blueprints";

export interface AuthoringAction {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: ReactElement;
	readonly preview?: ReactElement;
	readonly hint?: string;
	readonly primary?: boolean;
	readonly active?: boolean;
	readonly availability:
		| Readonly<{ state: "ready"; reason?: string }>
		| Readonly<{ state: "blocked"; reason: string }>;
	readonly onActivate: (trigger: HTMLButtonElement) => void;
}

export interface AuthoringSection {
	readonly collapsible?: boolean;
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
	readonly currentTask?: Readonly<{ title: string; onReturn: () => void }>;
	readonly onExpandedChange: (expanded: boolean) => void;
	readonly onBrowseCategory: (
		category: AuthoringCategory | null,
		trigger: HTMLButtonElement,
	) => void;
}

const CATEGORIES = [
	{ id: "fab", label: "공장·구역", icon: Factory },
	{ id: "rail", label: "레일", icon: Route },
	{ id: "equipment", label: "장비", icon: Warehouse },
	{ id: "blueprints", label: "청사진", icon: LibraryBig },
] as const;
const COMPACT_CATEGORIES = [CATEGORIES[1], CATEGORIES[2], CATEGORIES[0], CATEGORIES[3]];

/** Browsing is presentation only; the caller owns command admission and active tasks. */
export function AuthoringSidebar({
	browseCategory,
	sections,
	utilityActions,
	compact,
	expanded,
	currentTask,
	onExpandedChange,
	onBrowseCategory,
}: AuthoringSidebarProps): ReactElement {
	const instanceId = useId();
	const titleId = `${instanceId}-title`;
	const bodyId = `${instanceId}-body`;
	const contentId = `${instanceId}-content`;
	const utilityTitleId = `${instanceId}-utility-title`;
	const compactStrip = compact && !expanded;
	const currentLabel = CATEGORIES.find(({ id }) => id === browseCategory)?.label ?? "제작 홈";

	return (
		<aside
			id="openfab-authoring-sidebar"
			className="tilefab-authoring-sidebar"
			data-testid="authoring-sidebar"
			data-browse-category={browseCategory ?? "home"}
			data-compact={compact}
			data-expanded={expanded}
			aria-labelledby={compactStrip ? undefined : titleId}
			aria-label={compactStrip ? "제작 도구" : undefined}
		>
			<header className="tilefab-authoring-sidebar-heading" hidden={compactStrip}>
				<div className="tilefab-authoring-sidebar-heading-copy">
					<h2 id={titleId}>{browseCategory === null ? "OpenFab" : currentLabel}</h2>
					{browseCategory === null ? (
						<p className="tilefab-authoring-sidebar-current">공장의 레일과 장비를 설계하세요</p>
					) : null}
				</div>
				<button
					type="button"
					className="tilefab-authoring-sidebar-toggle"
					data-testid="authoring-sidebar-toggle"
					aria-label={expanded ? "제작 도구 접기" : "제작 도구 펼치기"}
					aria-expanded={expanded}
					aria-controls={bodyId}
					onClick={(event) => {
						const category = event.currentTarget
							.closest("aside")
							?.querySelector<HTMLButtonElement>(
								`[data-authoring-category="${browseCategory ?? "rail"}"]`,
							);
						onExpandedChange(!expanded);
						if (compact && expanded)
							requestAnimationFrame(() => category?.focus({ preventScroll: true }));
					}}
				>
					{expanded ? (
						<ChevronLeft size={18} aria-hidden="true" />
					) : (
						<ChevronRight size={18} aria-hidden="true" />
					)}
					<span>{expanded ? "접기" : "제작 도구"}</span>
				</button>
			</header>
			<div className="tilefab-authoring-sidebar-scroll">
				<nav
					className="tilefab-authoring-sidebar-categories"
					aria-label="제작 카테고리"
					data-compact-strip={compactStrip}
				>
					<button
						type="button"
						className="tilefab-authoring-sidebar-category tilefab-authoring-sidebar-home"
						data-authoring-category="home"
						hidden={compactStrip || browseCategory === null}
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
					{(compactStrip ? COMPACT_CATEGORIES : CATEGORIES).map(({ id, label, icon: Icon }) => (
						<button
							key={id}
							type="button"
							className="tilefab-authoring-sidebar-category"
							data-authoring-category={id}
							aria-label={label}
							data-active={browseCategory === id}
							aria-current={browseCategory === id ? "true" : undefined}
							aria-expanded={browseCategory === id && expanded}
							aria-controls={contentId}
							onClick={(event) => onBrowseCategory(id, event.currentTarget)}
						>
							<Icon size={20} aria-hidden="true" />
							<span>{compactStrip && id === "fab" ? "공장" : label}</span>
						</button>
					))}
				</nav>
				<div
					id={bodyId}
					className="tilefab-authoring-sidebar-body"
					hidden={!expanded}
					inert={!expanded}
				>
					{compact && currentTask ? (
						<button
							type="button"
							className="tilefab-authoring-return"
							data-testid="authoring-return-to-task"
							onClick={currentTask.onReturn}
						>
							<ArrowLeft size={16} aria-hidden="true" />
							<span>현재 작업 · {currentTask.title}</span>
						</button>
					) : null}
					<div id={contentId} className="tilefab-authoring-sidebar-content">
						{sections.map((section) => (
							<AuthoringSectionView key={section.id} section={section} />
						))}
					</div>
					{utilityActions.length > 0 ? (
						<section
							className="tilefab-authoring-sidebar-utilities"
							aria-labelledby={utilityTitleId}
						>
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
			</div>
		</aside>
	);
}

function AuthoringSectionView({ section }: { readonly section: AuthoringSection }): ReactElement {
	const titleId = useId();
	const content = (
		<>
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
		</>
	);
	return section.collapsible ? (
		<details
			className="tilefab-authoring-sidebar-section tilefab-authoring-disclosure"
			data-authoring-section={section.id}
		>
			<summary id={titleId}>
				<ChevronRight size={16} aria-hidden="true" />
				{section.title}
			</summary>
			{content}
		</details>
	) : (
		<section
			className="tilefab-authoring-sidebar-section"
			data-authoring-section={section.id}
			aria-labelledby={titleId}
		>
			<h3 id={titleId}>{section.title}</h3>
			{content}
		</section>
	);
}

function actionIcon(id: string): ReactElement {
	const Icon =
		id === "new-fab" || id.includes("fab-preset") || id === "fab-presets"
			? Factory
			: id === "add-bay" || id === "structure-list"
				? LayoutGrid
				: id === "equipment-ohb"
					? Box
					: id === "equipment-eq"
						? Cpu
						: id === "equipment-stk"
							? Warehouse
							: id === "select"
								? MousePointer2
								: id === "checks"
									? ListChecks
									: id === "guide"
										? HelpCircle
										: id.includes("copy") || id === "blueprint-recent"
											? Copy
											: id.includes("connect")
												? Link2
												: id === "blueprint-select-area"
													? SquareDashed
													: id.startsWith("blueprint")
														? LibraryBig
														: id === "find-equipment"
															? Search
															: Route;
	return <Icon size={22} aria-hidden="true" />;
}

function AuthoringActionButton({ action }: { readonly action: AuthoringAction }): ReactElement {
	const instanceId = useId();
	const descriptionId = `${instanceId}-description`;
	const reasonId = `${instanceId}-reason`;
	const hintId = `${instanceId}-hint`;
	const blocked = action.availability.state === "blocked";
	const reason = action.availability.reason;
	const showReason = Boolean(reason && reason !== action.description);
	const descriptionIds = [
		action.description ? descriptionId : null,
		action.hint ? hintId : null,
		showReason ? reasonId : null,
	]
		.filter(Boolean)
		.join(" ");

	return (
		<button
			type="button"
			className="tilefab-authoring-sidebar-action"
			data-authoring-action={action.id}
			data-active={action.active ?? false}
			data-primary={action.primary ?? false}
			data-has-preview={Boolean(action.preview)}
			data-availability={action.availability.state}
			aria-label={action.label}
			aria-describedby={descriptionIds || undefined}
			aria-pressed={action.active}
			aria-disabled={blocked || undefined}
			onClick={(event) => {
				if (!blocked) action.onActivate(event.currentTarget);
			}}
		>
			<span
				className={
					action.preview ? "tilefab-authoring-action-preview" : "tilefab-authoring-action-icon"
				}
				aria-hidden="true"
			>
				{action.preview ?? action.icon ?? actionIcon(action.id)}
			</span>
			<span className="tilefab-authoring-sidebar-action-copy">
				<strong>{action.id === "guide" ? "도움말·실습" : action.label}</strong>
				{action.hint ? (
					<span id={hintId} className="tilefab-authoring-action-hint">
						{action.hint}
					</span>
				) : null}
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
