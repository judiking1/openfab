import { Boxes, ListChecks, Map as MapIcon, Maximize2, Network } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from "react";
import type {
	StaticFabOrganizationColor,
	StaticFabOrganizationKind,
} from "../core/StaticFabOrganization";
import {
	createStaticFabMinimapTransform,
	type StaticFabMinimapTransform,
	type StaticFabMinimapWorldBounds,
	staticFabMinimapPointAtWorld,
	staticFabMinimapRectForWorldBounds,
	staticFabMinimapWorldAtPoint,
} from "../render/StaticFabMinimapGeometry";

export type StaticFabNavigatorTab = "map" | "organizations" | "checks";

export interface StaticFabNavigatorOrganizationRegion {
	readonly id: number;
	readonly kind: StaticFabOrganizationKind;
	readonly color: StaticFabOrganizationColor;
	readonly directBounds: StaticFabMinimapWorldBounds | null;
	readonly effectiveBounds: StaticFabMinimapWorldBounds | null;
}

export interface StaticFabNavigatorModel {
	readonly sourceKey: string;
	readonly bounds: StaticFabMinimapWorldBounds;
	readonly railCellCount: number;
	readonly railX: Int32Array;
	readonly railY: Int32Array;
	readonly organizations: readonly StaticFabNavigatorOrganizationRegion[];
}

export interface StaticFabNavigatorIssueMarker {
	readonly id: string;
	/** World-space marker center expressed in authored cell coordinates. */
	readonly x: number;
	readonly y: number;
	readonly role: "primary" | "consequence";
}

interface StaticFabNavigatorProps {
	readonly tab: StaticFabNavigatorTab;
	readonly model: StaticFabNavigatorModel | null;
	readonly preparing: boolean;
	readonly selectedOrganizationIds: readonly number[];
	readonly organizationMode: "DIRECT" | "EFFECTIVE";
	readonly issues: readonly StaticFabNavigatorIssueMarker[];
	readonly totalIssueCount: number;
	readonly equipmentGroupCount: number;
	readonly equipmentActionDisabled: boolean;
	readonly unavailableMessage?: string | null;
	readonly focusedIssueId: string | null;
	readonly getViewportBounds: () => StaticFabMinimapWorldBounds | null;
	readonly onTabChange: (tab: StaticFabNavigatorTab) => void;
	readonly onCenterWorld: (x: number, y: number) => void;
	readonly onFitAll: () => void;
	readonly onInspectEquipment: () => void;
}

const ORGANIZATION_COLORS: Readonly<Record<StaticFabOrganizationColor, string>> = Object.freeze({
	TEAL: "#6dcfd3",
	CYAN: "#4fc3df",
	BLUE: "#638ee3",
	AMBER: "#d2a947",
	VIOLET: "#9b7cdb",
	ROSE: "#d47787",
	LIME: "#81bd62",
	GRAY: "#8a9698",
});

export function StaticFabNavigator({
	tab,
	model,
	preparing,
	selectedOrganizationIds,
	organizationMode,
	issues,
	totalIssueCount,
	equipmentGroupCount,
	equipmentActionDisabled,
	unavailableMessage,
	focusedIssueId,
	getViewportBounds,
	onTabChange,
	onCenterWorld,
	onFitAll,
	onInspectEquipment,
}: StaticFabNavigatorProps): React.ReactElement {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const backingRef = useRef<HTMLCanvasElement | null>(null);
	const transformRef = useRef<StaticFabMinimapTransform | null>(null);
	const lastOverlayKeyRef = useRef("");
	const pendingCenterRef = useRef<Readonly<{ x: number; y: number }> | null>(null);
	const centerFrameRef = useRef(0);
	const issueMarkerKey = createIssueMarkerOverlayKey(issues);

	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			const active = document.activeElement;
			if (active instanceof HTMLElement && active.matches('[data-guided-target="true"]')) {
				return;
			}
			document
				.querySelector<HTMLButtonElement>(`[data-testid="static-fab-navigator-tab-${tab}"]`)
				?.focus();
		});
		return () => cancelAnimationFrame(frame);
	}, [tab]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !model) return;
		const backing = backingRef.current ?? document.createElement("canvas");
		backingRef.current = backing;
		const drawBacking = (): void => {
			const rect = canvas.getBoundingClientRect();
			const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
			const width = Math.max(1, Math.round(rect.width * dpr));
			const height = Math.max(1, Math.round(rect.height * dpr));
			canvas.width = width;
			canvas.height = height;
			backing.width = width;
			backing.height = height;
			const context = backing.getContext("2d");
			if (!context) return;
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			const cssWidth = width / dpr;
			const cssHeight = height / dpr;
			context.clearRect(0, 0, cssWidth, cssHeight);
			context.fillStyle = "#091011";
			context.fillRect(0, 0, cssWidth, cssHeight);
			const transform = createStaticFabMinimapTransform(model.bounds, cssWidth, cssHeight, 9);
			transformRef.current = transform;

			context.fillStyle = "rgba(96, 118, 121, 0.34)";
			for (let index = 0; index < model.railX.length; index++) {
				const point = staticFabMinimapPointAtWorld(transform, {
					x: (model.railX[index] as number) + 0.5,
					y: (model.railY[index] as number) + 0.5,
				});
				context.fillRect(Math.floor(point.x), Math.floor(point.y), 1.4, 1.4);
			}

			for (const organization of model.organizations) {
				const bounds =
					organizationMode === "EFFECTIVE"
						? organization.effectiveBounds
						: organization.directBounds;
				if (!bounds) continue;
				const region = staticFabMinimapRectForWorldBounds(transform, bounds);
				context.fillStyle = colorWithAlpha(ORGANIZATION_COLORS[organization.color], 0.09);
				context.strokeStyle = colorWithAlpha(ORGANIZATION_COLORS[organization.color], 0.34);
				context.lineWidth = 1;
				context.fillRect(region.x, region.y, Math.max(1, region.width), Math.max(1, region.height));
				context.strokeRect(
					region.x + 0.5,
					region.y + 0.5,
					Math.max(1, region.width - 1),
					Math.max(1, region.height - 1),
				);
			}
			lastOverlayKeyRef.current = "";
		};
		drawBacking();
		const observer = new ResizeObserver(drawBacking);
		observer.observe(canvas);
		return () => observer.disconnect();
	}, [model, organizationMode]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !model) return;
		let frame = 0;
		let timer = 0;
		const selected = new Set(selectedOrganizationIds);
		const draw = (): void => {
			const backing = backingRef.current;
			const transform = transformRef.current;
			const context = canvas.getContext("2d");
			if (!backing || !transform || !context) return;
			const viewport = getViewportBounds();
			const overlayKey = [
				canvas.width,
				canvas.height,
				selectedOrganizationIds.join(","),
				focusedIssueId ?? "",
				issueMarkerKey,
				viewport
					? `${viewport.minX.toFixed(2)},${viewport.minY.toFixed(2)},${viewport.maxX.toFixed(2)},${viewport.maxY.toFixed(2)}`
					: "",
			].join(":");
			if (overlayKey === lastOverlayKeyRef.current) return;
			lastOverlayKeyRef.current = overlayKey;
			context.setTransform(1, 0, 0, 1, 0, 0);
			context.clearRect(0, 0, canvas.width, canvas.height);
			context.drawImage(backing, 0, 0);
			const dpr = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
			context.setTransform(dpr, 0, 0, dpr, 0, 0);

			for (const organization of model.organizations) {
				if (!selected.has(organization.id)) continue;
				const bounds =
					organizationMode === "EFFECTIVE"
						? organization.effectiveBounds
						: organization.directBounds;
				if (!bounds) continue;
				const region = staticFabMinimapRectForWorldBounds(transform, bounds);
				context.strokeStyle = ORGANIZATION_COLORS[organization.color];
				context.lineWidth = 2;
				context.strokeRect(
					region.x + 1,
					region.y + 1,
					Math.max(2, region.width - 2),
					Math.max(2, region.height - 2),
				);
			}

			for (const issue of issues) {
				const point = staticFabMinimapPointAtWorld(transform, {
					x: issue.x + 0.5,
					y: issue.y + 0.5,
				});
				const focused = issue.id === focusedIssueId;
				context.beginPath();
				context.arc(point.x, point.y, focused ? 5 : 3, 0, Math.PI * 2);
				context.fillStyle =
					issue.role === "consequence" ? "rgba(231, 184, 92, 0.86)" : "rgba(255, 111, 126, 0.94)";
				context.fill();
				if (focused) {
					context.strokeStyle = "#ffffff";
					context.lineWidth = 1.5;
					context.stroke();
				}
			}

			if (viewport) {
				const region = staticFabMinimapRectForWorldBounds(transform, viewport);
				if (region.width > 0 && region.height > 0) {
					context.fillStyle = "rgba(102, 218, 224, 0.08)";
					context.strokeStyle = "rgba(173, 241, 244, 0.94)";
					context.lineWidth = 1.5;
					context.fillRect(
						region.x,
						region.y,
						Math.max(2, region.width),
						Math.max(2, region.height),
					);
					context.strokeRect(
						region.x + 0.75,
						region.y + 0.75,
						Math.max(2, region.width - 1.5),
						Math.max(2, region.height - 1.5),
					);
				}
			}
		};
		const queueDraw = (): void => {
			if (document.hidden) {
				timer = window.setTimeout(queueDraw, 250);
				return;
			}
			frame = requestAnimationFrame(() => {
				draw();
				timer = window.setTimeout(queueDraw, 100);
			});
		};
		draw();
		queueDraw();
		return () => {
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
		};
	}, [
		focusedIssueId,
		getViewportBounds,
		issueMarkerKey,
		issues,
		model,
		organizationMode,
		selectedOrganizationIds,
	]);

	useEffect(
		() => () => {
			if (centerFrameRef.current !== 0) cancelAnimationFrame(centerFrameRef.current);
		},
		[],
	);

	const queueCenter = (event: PointerEvent<HTMLCanvasElement>): void => {
		const canvas = canvasRef.current;
		const transform = transformRef.current;
		if (!canvas || !transform) return;
		const rect = canvas.getBoundingClientRect();
		pendingCenterRef.current = staticFabMinimapWorldAtPoint(transform, {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		});
		if (centerFrameRef.current !== 0) return;
		centerFrameRef.current = requestAnimationFrame(() => {
			centerFrameRef.current = 0;
			const next = pendingCenterRef.current;
			pendingCenterRef.current = null;
			if (next) onCenterWorld(next.x, next.y);
		});
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
		if (event.key === "Enter" || event.key === "Home") {
			event.preventDefault();
			onFitAll();
			return;
		}
		if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
		const viewport = getViewportBounds();
		if (!viewport) return;
		event.preventDefault();
		const width = Math.max(1, viewport.maxX - viewport.minX);
		const height = Math.max(1, viewport.maxY - viewport.minY);
		const centerX = (viewport.minX + viewport.maxX) * 0.5;
		const centerY = (viewport.minY + viewport.maxY) * 0.5;
		onCenterWorld(
			centerX +
				(event.key === "ArrowLeft" ? -width * 0.25 : event.key === "ArrowRight" ? width * 0.25 : 0),
			centerY +
				(event.key === "ArrowUp" ? -height * 0.25 : event.key === "ArrowDown" ? height * 0.25 : 0),
		);
	};

	return (
		<div className="tilefab-navigator-overview" data-tab={tab}>
			<div className="tilefab-navigator-tabs" role="tablist" aria-label="FAB 내비게이터 보기">
				<NavigatorTabButton
					active={tab === "map"}
					tabId="map"
					label="MAP"
					icon={<MapIcon size={14} />}
					onClick={() => onTabChange("map")}
				/>
				<NavigatorTabButton
					active={tab === "organizations"}
					tabId="organizations"
					label="ORGANIZATIONS"
					count={model?.organizations.length ?? 0}
					icon={<Network size={14} />}
					onClick={() => onTabChange("organizations")}
				/>
				<NavigatorTabButton
					active={tab === "checks"}
					tabId="checks"
					label="CHECKS"
					count={totalIssueCount}
					icon={<ListChecks size={14} />}
					onClick={() => onTabChange("checks")}
				/>
			</div>
			<div
				className="tilefab-navigator-body"
				{...(tab === "map"
					? {
							role: "tabpanel" as const,
							id: navigatorPanelId("map"),
							"aria-labelledby": navigatorTabId("map"),
						}
					: { role: "region" as const, "aria-label": "FAB 공통 미니맵" })}
			>
				{tab === "map" ? (
					<nav className="tilefab-navigator-tasks" aria-label="FAB에서 찾을 항목">
						<button type="button" onClick={() => onTabChange("checks")}>
							<ListChecks size={14} aria-hidden="true" />
							<span>
								<strong>문제 찾기</strong>
								<small>{preparing ? "검사 중" : `${totalIssueCount.toLocaleString()}건`}</small>
							</span>
						</button>
						<button type="button" onClick={() => onTabChange("organizations")}>
							<Network size={14} aria-hidden="true" />
							<span>
								<strong>FAB 구조</strong>
								<small>{model?.organizations.length.toLocaleString() ?? "0"}개</small>
							</span>
						</button>
						<button
							type="button"
							disabled={equipmentActionDisabled}
							title={
								equipmentActionDisabled ? "프로젝트와 편집 명령이 준비된 뒤 사용하세요" : undefined
							}
							onClick={onInspectEquipment}
						>
							<Boxes size={14} aria-hidden="true" />
							<span>
								<strong>{equipmentGroupCount > 0 ? "장비 보기" : "Port 추가하기"}</strong>
								<small>
									{equipmentGroupCount > 0
										? `${equipmentGroupCount.toLocaleString()}개`
										: "배치된 장비 없음"}
								</small>
							</span>
						</button>
					</nav>
				) : null}
				<div className="tilefab-navigator-map">
					{model ? (
						<canvas
							ref={canvasRef}
							className="tilefab-navigator-canvas"
							data-testid="static-fab-minimap"
							tabIndex={0}
							aria-label="FAB 미니맵. 클릭 또는 드래그로 이동하고 Enter로 전체 맵을 맞춥니다"
							onKeyDown={handleKeyDown}
							onPointerDown={(event) => {
								if (event.button !== 0) return;
								event.currentTarget.setPointerCapture(event.pointerId);
								queueCenter(event);
							}}
							onPointerMove={(event) => {
								if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
								queueCenter(event);
							}}
							onPointerUp={(event) => {
								if (event.currentTarget.hasPointerCapture(event.pointerId)) {
									event.currentTarget.releasePointerCapture(event.pointerId);
								}
							}}
						/>
					) : (
						<div className="tilefab-navigator-empty">
							{preparing ? "PREPARING OVERVIEW" : (unavailableMessage ?? "EMPTY MAP")}
						</div>
					)}
					<button
						type="button"
						className="tilefab-navigator-fit"
						title="전체 FAB 맞추기"
						aria-label="전체 FAB 맞추기"
						onClick={onFitAll}
					>
						<Maximize2 size={14} />
					</button>
				</div>
				<footer className="tilefab-navigator-footer">
					<span>{model ? `${model.railCellCount.toLocaleString()} CELLS` : "NO RAIL"}</span>
					<span>{model ? `${model.organizations.length.toLocaleString()} ORGS` : "0 ORGS"}</span>
					<span>{totalIssueCount.toLocaleString()} ISSUES</span>
				</footer>
			</div>
			{(["map", "organizations", "checks"] as const)
				.filter((candidate) => candidate !== tab)
				.map((candidate) => (
					<div
						key={candidate}
						id={navigatorPanelId(candidate)}
						role="tabpanel"
						aria-labelledby={navigatorTabId(candidate)}
						hidden
					/>
				))}
		</div>
	);
}

function NavigatorTabButton({
	active,
	tabId,
	label,
	count,
	icon,
	onClick,
}: Readonly<{
	active: boolean;
	tabId: StaticFabNavigatorTab;
	label: string;
	count?: number;
	icon: React.ReactNode;
	onClick: () => void;
}>): React.ReactElement {
	return (
		<button
			type="button"
			id={navigatorTabId(tabId)}
			className="tilefab-navigator-tab"
			role="tab"
			aria-controls={navigatorPanelId(tabId)}
			data-testid={`static-fab-navigator-tab-${tabId}`}
			data-navigator-tab-id={tabId}
			aria-selected={active}
			tabIndex={active ? 0 : -1}
			data-active={active}
			onClick={onClick}
			onKeyDown={handleNavigatorTabKeyDown}
		>
			{icon}
			<span className="tilefab-navigator-tab-label">{label}</span>
			{count === undefined ? null : <small className="tilefab-navigator-tab-count">{count}</small>}
		</button>
	);
}

function navigatorTabId(tab: StaticFabNavigatorTab): string {
	return `tilefab-fab-navigator-tab-${tab}`;
}

function navigatorPanelId(tab: StaticFabNavigatorTab): string {
	return `tilefab-fab-navigator-panel-${tab}`;
}

function createIssueMarkerOverlayKey(issues: readonly StaticFabNavigatorIssueMarker[]): string {
	let primaryHash = 0x811c9dc5;
	let secondaryHash = 0x9e3779b9;
	const include = (value: string): void => {
		for (let index = 0; index < value.length; index++) {
			const code = value.charCodeAt(index);
			primaryHash = Math.imul(primaryHash ^ code, 0x01000193) >>> 0;
			secondaryHash = Math.imul(secondaryHash ^ code, 0x85ebca6b) >>> 0;
		}
		primaryHash = Math.imul(primaryHash ^ 0xff, 0x01000193) >>> 0;
		secondaryHash = Math.imul(secondaryHash ^ 0xff, 0x85ebca6b) >>> 0;
	};

	for (const issue of issues) {
		include(issue.id);
		include(String(issue.x));
		include(String(issue.y));
		include(issue.role);
	}

	return `${issues.length}:${primaryHash.toString(36)}:${secondaryHash.toString(36)}`;
}

function handleNavigatorTabKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
	if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
	const tabs = [
		...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
			[]),
	];
	if (tabs.length === 0) return;
	event.preventDefault();
	const current = Math.max(0, tabs.indexOf(event.currentTarget));
	const next =
		event.key === "Home"
			? 0
			: event.key === "End"
				? tabs.length - 1
				: (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
	const target = tabs[next];
	const targetTab = target?.dataset.navigatorTabId as StaticFabNavigatorTab | undefined;
	target?.click();
	if (!targetTab) return;
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			document
				.querySelector<HTMLButtonElement>(`[data-testid="static-fab-navigator-tab-${targetTab}"]`)
				?.focus();
		});
	});
}

function colorWithAlpha(hex: string, alpha: number): string {
	const value = Number.parseInt(hex.slice(1), 16);
	const red = (value >> 16) & 0xff;
	const green = (value >> 8) & 0xff;
	const blue = value & 0xff;
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
