import { Info } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./EditorInfoPopover.css";

/** Short, supplementary help only; required decisions and errors stay in the view. */
export function EditorInfoPopover({ label, text }: { label: string; text: string }) {
	const id = useId();
	const trigger = useRef<HTMLButtonElement>(null);
	const tooltip = useRef<HTMLDivElement>(null);
	const pinned = useRef(false);
	const hovered = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [open, setOpen] = useState(false);

	const clearCloseTimer = useCallback(() => {
		if (timer.current !== null) clearTimeout(timer.current);
		timer.current = null;
	}, []);
	function show() {
		clearCloseTimer();
		setOpen(true);
	}
	const close = useCallback(() => {
		clearCloseTimer();
		pinned.current = false;
		hovered.current = false;
		setOpen(false);
	}, [clearCloseTimer]);
	function scheduleClose() {
		clearCloseTimer();
		timer.current = setTimeout(() => {
			if (!pinned.current && !hovered.current && document.activeElement !== trigger.current) {
				setOpen(false);
			}
		}, 120);
	}

	useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);
	useLayoutEffect(() => {
		if (!open) return;
		function position() {
			const button = trigger.current;
			const popup = tooltip.current;
			if (!button || !popup) return;
			const viewport = window.visualViewport;
			const left = (viewport?.offsetLeft ?? 0) + 8;
			const top = (viewport?.offsetTop ?? 0) + 8;
			const right = left + (viewport?.width ?? window.innerWidth) - 16;
			const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
			const anchor = button.getBoundingClientRect();
			if (
				anchor.bottom < top ||
				anchor.top > bottom ||
				anchor.right < left ||
				anchor.left > right
			) {
				close();
				return;
			}
			popup.style.maxWidth = `${Math.max(0, Math.min(280, right - left))}px`;
			popup.style.maxHeight = `${Math.max(0, bottom - top)}px`;
			const box = popup.getBoundingClientRect();
			const x = anchor.right - box.width;
			let y = anchor.top - box.height - 8;
			if (y < top) {
				y = anchor.bottom + 8;
			}
			popup.style.left = `${Math.max(left, Math.min(x, right - box.width))}px`;
			popup.style.top = `${Math.max(top, Math.min(y, bottom - box.height))}px`;
			popup.style.visibility = "visible";
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			close();
		}
		function onPointerDown(event: PointerEvent) {
			if (
				event.target instanceof Node &&
				!trigger.current?.contains(event.target) &&
				!tooltip.current?.contains(event.target)
			)
				close();
		}
		position();
		const observer = new ResizeObserver(position);
		if (tooltip.current) observer.observe(tooltip.current);
		const visibilityObserver = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => !entry.isIntersecting)) close();
			},
			{ threshold: 0 },
		);
		if (trigger.current) visibilityObserver.observe(trigger.current);
		window.addEventListener("resize", position);
		window.addEventListener("scroll", position, true);
		window.visualViewport?.addEventListener("resize", position);
		window.visualViewport?.addEventListener("scroll", position);
		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("pointerdown", onPointerDown, true);
		return () => {
			observer.disconnect();
			visibilityObserver.disconnect();
			window.removeEventListener("resize", position);
			window.removeEventListener("scroll", position, true);
			window.visualViewport?.removeEventListener("resize", position);
			window.visualViewport?.removeEventListener("scroll", position);
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("pointerdown", onPointerDown, true);
		};
	}, [open, close]);

	return (
		<>
			<button
				ref={trigger}
				type="button"
				className="tilefab-info-trigger"
				aria-label={label}
				aria-expanded={open}
				aria-controls={open ? id : undefined}
				aria-describedby={open ? id : undefined}
				onPointerEnter={(event) => {
					if (event.pointerType !== "mouse") return;
					hovered.current = true;
					show();
				}}
				onPointerLeave={() => {
					hovered.current = false;
					scheduleClose();
				}}
				onFocus={show}
				onBlur={() => {
					pinned.current = false;
					scheduleClose();
				}}
				onClick={() => {
					if (pinned.current) close();
					else {
						pinned.current = true;
						show();
					}
				}}
			>
				<Info size={16} aria-hidden="true" />
			</button>
			{open &&
				createPortal(
					<div
						ref={tooltip}
						id={id}
						role="tooltip"
						className="tilefab-info-popover"
						style={{ visibility: "hidden" }}
						onPointerEnter={(event) => {
							if (event.pointerType !== "mouse") return;
							hovered.current = true;
							clearCloseTimer();
						}}
						onPointerLeave={() => {
							hovered.current = false;
							scheduleClose();
						}}
					>
						{text}
					</div>,
					document.body,
				)}
		</>
	);
}
