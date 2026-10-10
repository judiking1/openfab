import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type EqEquipmentGroup, equipmentGroupError } from "../core/EquipmentGroup";
import type { EqRecipeEditSource } from "./PortEquipmentInspectorSelection";

export function EqRecipeEditor({
	group,
	source,
	disabled,
	reason,
	onDraftChange,
	commit,
}: {
	readonly group: EqEquipmentGroup;
	readonly source: EqRecipeEditSource;
	readonly disabled: boolean;
	readonly reason: string | null;
	readonly onDraftChange: (hasDraft: boolean) => void;
	readonly commit: (text: string, source: EqRecipeEditSource) => string | null;
}) {
	const [draft, setDraft] = useState<{ text: string; source: EqRecipeEditSource } | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const hasDraft = draft !== null;
	useEffect(() => {
		onDraftChange(hasDraft);
		return () => onDraftChange(false);
	}, [hasDraft, onDraftChange]);
	const text = draft?.text ?? group.recipe ?? "";
	const recipe = text.trim() || null;
	const invalid = equipmentGroupError({ ...group, recipe });
	const unchanged = recipe === group.recipe;
	const feedback = failure ?? (invalid ? "Recipe는 제어문자 없이 최대 120자로 입력하세요" : reason);
	return (
		<details className="tilefab-equipment-more-actions" data-testid="eq-recipe-editor">
			<summary>
				<span>Recipe 편집</span>
				<ChevronDown size={15} aria-hidden="true" />
			</summary>
			<form
				className="tilefab-equipment-more-actions-body tilefab-equipment-dimensions-form tilefab-equipment-recipe-form"
				onSubmit={(event) => {
					event.preventDefault();
					if (disabled || !draft || invalid || unchanged) return;
					const error = commit(draft.text, draft.source);
					setFailure(error);
					if (error === null) setDraft(null);
				}}
			>
				<label>
					Recipe (선택 사항)
					<input
						data-testid="eq-recipe-input"
						type="text"
						maxLength={120}
						value={text}
						disabled={disabled}
						aria-invalid={failure || invalid ? true : undefined}
						aria-describedby="eq-recipe-feedback"
						onChange={(event) => {
							setDraft({ text: event.currentTarget.value, source: draft?.source ?? source });
							setFailure(null);
						}}
					/>
				</label>
				<p id="eq-recipe-feedback" role="status">
					{feedback ?? "장비를 구분하는 메모입니다 · 비우면 미지정으로 저장됩니다"}
				</p>
				<div className="tilefab-equipment-form-actions">
					<button
						type="submit"
						className="tilefab-inspector-primary"
						data-testid="apply-eq-recipe"
						disabled={disabled || !draft || !!invalid || unchanged}
					>
						<Check size={15} /> Recipe 적용
					</button>
					<button
						type="button"
						className="tilefab-inspector-primary"
						data-testid="cancel-eq-recipe"
						disabled={!draft && !failure}
						onClick={() => {
							setDraft(null);
							setFailure(null);
						}}
					>
						<X size={15} /> 입력 취소
					</button>
				</div>
			</form>
		</details>
	);
}
