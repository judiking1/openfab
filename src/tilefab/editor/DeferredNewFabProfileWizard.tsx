import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NewFabProfileWizardProps } from "./NewFabProfileWizard";
import "./DeferredOperationalConfigurationPanel.css";

type Wizard = typeof import("./NewFabProfileWizard").NewFabProfileWizard;
let loadedWizard: Wizard | null = null;

/** Defer only presentation; preparation and project replacement remain editor-owned. */
export function DeferredNewFabProfileWizard<TPreparedEvidence extends object>(
	props: NewFabProfileWizardProps<TPreparedEvidence>,
): React.ReactElement {
	const { onCancel } = props;
	const [WizardComponent, setWizard] = useState<Wizard | null>(() => loadedWizard);
	const [failed, setFailed] = useState(false);
	const closeRef = useRef<HTMLButtonElement>(null);
	const backdropRef = useRef<HTMLDivElement>(null);
	const returnFocusRef = useRef(props.returnFocus ?? document.activeElement);
	const close = useCallback((): void => {
		onCancel();
		requestAnimationFrame(() => {
			const target = returnFocusRef.current;
			if (target instanceof HTMLElement && target.isConnected)
				target.focus({ preventScroll: true });
		});
	}, [onCancel]);
	useEffect(() => {
		if (WizardComponent) return;
		let current = true;
		void import("./NewFabProfileWizard").then(
			(module) => {
				loadedWizard = module.NewFabProfileWizard;
				if (current) setWizard(() => module.NewFabProfileWizard);
			},
			() => {
				if (current) setFailed(true);
			},
		);
		return () => {
			current = false;
		};
	}, [WizardComponent]);
	useLayoutEffect(() => {
		if (WizardComponent || props.suspended) return;
		closeRef.current?.focus();
		const previous = [...document.body.children]
			.filter(
				(element): element is HTMLElement =>
					element instanceof HTMLElement && element !== backdropRef.current,
			)
			.map((element) => ({
				element,
				inert: element.inert,
				ariaHidden: element.getAttribute("aria-hidden"),
			}));
		for (const { element } of previous) {
			element.inert = true;
			element.setAttribute("aria-hidden", "true");
		}
		return () => {
			for (const { element, inert, ariaHidden } of previous) {
				element.inert = inert;
				if (ariaHidden === null) element.removeAttribute("aria-hidden");
				else element.setAttribute("aria-hidden", ariaHidden);
			}
		};
	}, [WizardComponent, props.suspended]);
	useEffect(() => {
		if (WizardComponent || props.suspended) return;
		const onEscape = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			close();
		};
		window.addEventListener("keydown", onEscape, { capture: true });
		return () => window.removeEventListener("keydown", onEscape, { capture: true });
	}, [WizardComponent, props.suspended, close]);
	if (WizardComponent) return <WizardComponent {...props} />;

	return createPortal(
		<div ref={backdropRef} className="tilefab-operational-loading-backdrop" inert={props.suspended}>
			<section
				className="tilefab-operational-loading"
				role="dialog"
				aria-modal="true"
				aria-labelledby="tilefab-new-fab-loading-title"
				aria-describedby="tilefab-new-fab-loading-status"
				data-testid="new-fab-profile-loading"
				onKeyDown={(event) => {
					if (event.key === "Tab") {
						event.preventDefault();
						closeRef.current?.focus();
					}
				}}
			>
				<h2 id="tilefab-new-fab-loading-title">새 FAB 만들기</h2>
				<p id="tilefab-new-fab-loading-status" role="status">
					{failed
						? "새 FAB 설정을 불러오지 못했습니다. 닫고 편집을 계속할 수 있습니다. 저장 후 새로고침하여 다시 열어 주세요."
						: "새 FAB 설정을 불러오는 중입니다…"}
				</p>
				<button ref={closeRef} type="button" aria-label="새 FAB 설정 닫기" onClick={close}>
					닫기
				</button>
			</section>
		</div>,
		document.body,
	);
}
