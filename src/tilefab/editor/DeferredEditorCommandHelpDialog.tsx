import { Keyboard, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorCommandHelpDialogProps } from "./EditorCommandHelpDialog";
import "./EditorCommandHelpDialog.css";

type Dialog = typeof import("./EditorCommandHelpDialog").EditorCommandHelpDialog;
let loadedDialog: Dialog | null = null;

/** Keep optional Help outside startup while preserving a usable modal during loading or failure. */
export function DeferredEditorCommandHelpDialog(
	props: EditorCommandHelpDialogProps,
): React.ReactElement | null {
	const [DialogComponent, setDialog] = useState<Dialog | null>(() => loadedDialog);
	const [failed, setFailed] = useState(false);
	const closeRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!props.open || DialogComponent) return;
		let current = true;
		void import("./EditorCommandHelpDialog").then(
			(module) => {
				loadedDialog = module.EditorCommandHelpDialog;
				if (current) setDialog(() => module.EditorCommandHelpDialog);
			},
			() => {
				if (current) setFailed(true);
			},
		);
		return () => {
			current = false;
		};
	}, [props.open, DialogComponent]);
	useLayoutEffect(() => {
		if (props.open && !DialogComponent) closeRef.current?.focus();
	}, [props.open, DialogComponent]);
	if (!props.open) return null;
	if (DialogComponent) return <DialogComponent {...props} />;
	return createPortal(
		<div
			className="tilefab-command-help-backdrop"
			role="presentation"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) props.onClose();
			}}
		>
			<section
				className="tilefab-command-help"
				role="dialog"
				aria-modal="true"
				aria-labelledby="tilefab-command-help-loading-title"
				aria-describedby="tilefab-command-help-loading-status"
				data-testid="editor-command-help-loading"
				data-command-catalog-expanded="false"
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						props.onClose();
					} else if (event.key === "Tab") {
						event.preventDefault();
						closeRef.current?.focus();
					}
				}}
			>
				<header>
					<span className="tilefab-command-help-mark" aria-hidden="true">
						<Keyboard size={19} />
					</span>
					<strong id="tilefab-command-help-loading-title">도움말·가이드</strong>
					<button
						ref={closeRef}
						type="button"
						aria-label="도움말·가이드 닫기"
						onClick={props.onClose}
					>
						<X size={18} />
					</button>
				</header>
				<div className="tilefab-command-help-loading-message">
					<p id="tilefab-command-help-loading-status" role="status">
						{failed
							? "도움말을 불러오지 못했습니다. 닫고 편집을 계속할 수 있습니다. 저장 후 새로고침하여 다시 열어 주세요."
							: "도움말을 불러오는 중입니다…"}
					</p>
				</div>
			</section>
		</div>,
		document.body,
	);
}
