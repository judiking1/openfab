import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { Cell } from "../core/TileMap";
import type { AisleIntegrationSession } from "./useStaticFabAisleIntegration";
import "./StaticFabAisleIntegrationDialog.css";

interface Props {
	readonly session: AisleIntegrationSession;
	readonly onBay: (id: number) => void;
	readonly onOption: (id: string) => void;
	readonly onCancel: () => void;
	readonly onApply: () => void;
}
export function StaticFabAisleIntegrationDialog({
	session,
	onBay,
	onOption,
	onCancel,
	onApply,
}: Props) {
	const dialog = useRef<HTMLDialogElement>(null),
		cancel = useRef(onCancel);
	useEffect(() => {
		cancel.current = onCancel;
	}, [onCancel]);
	const title = useId();
	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		element.showModal();
		element.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				event.stopImmediatePropagation();
				cancel.current();
			}
		};
		window.addEventListener("keydown", key, true);
		return () => {
			window.removeEventListener("keydown", key, true);
			element.close();
		};
	}, []);
	const bay = session.bays.find((record) => record.id === session.bayId);
	const edges = [...session.aisle.membership.railEdges, ...(bay?.membership.railEdges ?? [])];
	const entry = session.plan?.entryCells ?? [],
		exit = session.plan?.exitCells ?? [];
	const points = [...edges.flatMap((edge) => [edge.from, edge.to]), ...entry, ...exit];
	const bounds = points.reduce(
		(b, p) => ({
			minX: Math.min(b.minX, p.x),
			maxX: Math.max(b.maxX, p.x),
			minY: Math.min(b.minY, p.y),
			maxY: Math.max(b.maxY, p.y),
		}),
		{ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
	);
	const line = (cells: readonly Cell[]) => cells.map((cell) => `${cell.x},${cell.y}`).join(" ");
	const busy = session.phase === "searching" || session.phase === "reviewing";
	const content = (
		<dialog
			ref={dialog}
			className="tilefab-aisle-integration-dialog"
			aria-labelledby={title}
			data-testid="aisle-integration-dialog"
			data-phase={session.phase}
			onCancel={(event) => {
				event.preventDefault();
				onCancel();
			}}
		>
			<header>
				<h2 id={title}>Bay에 편입</h2>
				<p>{session.aisle.name} · 현재 위치와 레일·장비를 유지합니다.</p>
			</header>
			<div className="tilefab-aisle-integration-fields">
				<label>
					대상 Bay
					<select
						aria-label="편입 대상 Bay"
						value={session.bayId ?? ""}
						onChange={(event) => onBay(Number(event.currentTarget.value))}
					>
						<option value="" disabled>
							Bay 선택
						</option>
						{session.bays.map((record) => (
							<option key={record.id} value={record.id}>
								{record.name}
							</option>
						))}
					</select>
				</label>
				<label>
					연결 위치
					<select
						aria-label="편입 연결 위치"
						disabled={!session.options.length || session.phase === "searching"}
						value={session.optionId}
						onChange={(event) => onOption(event.currentTarget.value)}
					>
						<option value="" disabled>
							연결 위치 선택
						</option>
						{session.options.map((option, index) => (
							<option key={option.id} value={option.id}>
								{index + 1} · 입구 ({option.entryGateway.x}, {option.entryGateway.y}) → 출구 (
								{option.exitGateway.x}, {option.exitGateway.y}) · {option.lengthMeters} m
							</option>
						))}
					</select>
				</label>
			</div>
			{points.length ? (
				<svg
					role="img"
					aria-label="Bay와 구역의 두 연결 경로 미리보기"
					viewBox={`${bounds.minX - 3} ${bounds.minY - 3} ${Math.max(10, bounds.maxX - bounds.minX + 6)} ${Math.max(10, bounds.maxY - bounds.minY + 6)}`}
				>
					<title>초록색: Bay에서 구역 입구로 · 주황색: 구역 출구에서 Bay로</title>
					<path
						d={edges
							.map((edge) => `M${edge.from.x},${edge.from.y}L${edge.to.x},${edge.to.y}`)
							.join(" ")}
						fill="none"
						stroke="#839c9c"
						strokeWidth="0.45"
					/>
					<polyline
						data-testid="aisle-entry-preview"
						points={line(entry)}
						fill="none"
						stroke="#69e2b4"
						strokeWidth="0.8"
					/>
					<polyline
						data-testid="aisle-exit-preview"
						points={line(exit)}
						fill="none"
						stroke="#ffbe75"
						strokeWidth="0.8"
					/>
				</svg>
			) : null}
			<p className="tilefab-aisle-integration-legend">
				입구 연결 <span>초록</span> · 출구 연결 <span>주황</span>
			</p>
			<p role="status" aria-live="polite">
				{session.reason}
			</p>
			<footer>
				<button type="button" onClick={onCancel}>
					취소
				</button>
				<button
					type="button"
					disabled={busy || session.phase !== "ready" || !session.plan}
					onClick={onApply}
				>
					적용
				</button>
			</footer>
		</dialog>
	);
	return typeof document === "undefined" ? content : createPortal(content, document.body);
}
