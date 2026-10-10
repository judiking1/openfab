import * as React from "react";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EquipmentGroupRecord, PortEquipmentState } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { DIR_E, DIR_W } from "../core/railShape";
import { copyStaticFabOrganizationState } from "../core/StaticFabOrganization";
import { PortEquipmentInspector, type PortEquipmentInspectorProps } from "./PortEquipmentInspector";
import {
	resolveEditablePortEquipmentSelection,
	resolveExactPortEquipmentSelection,
	resolvePortEquipmentActionAvailability,
} from "./PortEquipmentInspectorSelection";

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof React>();
	return { ...actual, useState: vi.fn(actual.useState), useEffect: vi.fn(actual.useEffect) };
});

import { portEquipmentTransformPolicy } from "./PortEquipmentTransformPolicy";

describe("PortEquipmentInspectorSelection", () => {
	it("selects a stable FLEX STK Port identity from compact coordinates without starting an edit", () => {
		const state = {
			...eqState(
				[4, 8, 12].map((id, index) => ({
					...port(id, 1, `STK-${id}`, 500),
					portType: "STK" as const,
					route: { kind: "CARDINAL_CELL" as const, x: index * 5 + 4, z: 0, from: DIR_W, to: DIR_E },
				})),
				[{ id: 1, kind: "STK", template: "FLEX", portIds: [4, 8, 12] }],
			),
			nextPortId: 13,
		};
		const selected = resolveEditablePortEquipmentSelection(state, {
			portId: 8,
			equipmentGroupId: 1,
		});
		if (!selected) throw new Error("Expected editable FLEX STK");
		const select = vi.fn(),
			move = vi.fn(),
			nextMove = vi.fn(),
			before = JSON.stringify(state);
		const props = {
			...inspectorProps(state, selected),
			selectFlexStkPort: select,
			startSelectedPortEquipmentGroupEdit: move,
			startNextFlexStkPortMove: nextMove,
		};
		const tree = PortEquipmentInspector(props);
		const picker = findInspectorElement(
			tree,
			(e) => e.props["data-testid"] === "select-flex-stk-port",
		);
		expect(picker?.props.value).toBe(8);
		expect(picker?.props.disabled).toBe(false);
		expect(renderToStaticMarkup(picker)).toContain('value="8" selected=""');
		expect(renderToStaticMarkup(picker)).toContain("PORT-12 · X 14 · Z 0");
		(picker?.props.onChange as (e: { currentTarget: { value: string } }) => void)({
			currentTarget: { value: "12" },
		});
		expect(select).toHaveBeenCalledExactlyOnceWith({ portId: 12, equipmentGroupId: 1 });
		expect(move).not.toHaveBeenCalled();
		const next = findInspectorElement(
			tree,
			(e) => e.props["data-testid"] === "move-next-flex-stk-port",
		);
		expect(next?.props["aria-label"]).toBe("다음 Port 이동 · PORT-12");
		(next?.props.onClick as () => void)();
		expect(nextMove).toHaveBeenCalledExactlyOnceWith({ portId: 8, equipmentGroupId: 1 }, 12);
		expect(move).not.toHaveBeenCalled();
		expect(JSON.stringify(state)).toBe(before);
		for (const blocked of [
			{ modelSyncPending: true },
			{ workerState: { status: "error" as const } },
			{ selectedPortEditableDetails: null },
		]) {
			const node = findInspectorElement(
				PortEquipmentInspector({ ...props, ...blocked }),
				(e) => e.props["data-testid"] === "select-flex-stk-port",
			);
			expect(node?.props.disabled).toBe(true);
			expect(
				findInspectorElement(
					PortEquipmentInspector({ ...props, ...blocked }),
					(e) => e.props["data-testid"] === "move-next-flex-stk-port",
				)?.props.disabled,
			).toBe(true);
		}
		expect(
			renderToStaticMarkup(PortEquipmentInspector({ ...props, viewMode: "3d" })),
		).not.toContain('data-testid="select-flex-stk-port"');
		const reordered = { ...selected.equipmentGroup, portIds: [4, 12, 8] };
		const wrapped = findInspectorElement(
			PortEquipmentInspector({ ...props, selectedEquipmentGroup: reordered }),
			(e) => e.props["data-testid"] === "move-next-flex-stk-port",
		);
		expect(wrapped?.props["aria-label"]).toBe("다음 Port 이동 · PORT-4");
	});
	it("exposes explicit EQ Recipe Apply/Cancel only in editable 2D", () => {
		const state = eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw Error("Expected EQ");
		const props = inspectorProps(state, selected);
		const markup = renderToStaticMarkup(createElement(PortEquipmentInspector, props));
		expect(markup).toContain('data-testid="eq-recipe-input"');
		expect(markup).toContain('maxLength="120"');
		expect(markup).toContain('data-testid="apply-eq-recipe"');
		expect(markup).toContain('data-testid="cancel-eq-recipe"');
		expect(
			renderToStaticMarkup(createElement(PortEquipmentInspector, { ...props, viewMode: "3d" })),
		).not.toContain('data-testid="eq-recipe-input"');
	});
	it("opens EQ pitch directly from the selected Port without applying an edit", () => {
		const state = eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected editable EQ selection");
		const before = JSON.stringify(state);
		const start = vi.fn();
		const tree = PortEquipmentInspector({
			...inspectorProps(state, selected),
			startSelectedPortEquipmentMembershipEdit: start,
		});
		const pitch = findInspectorElement(
			tree,
			(element) => element.props["data-testid"] === "edit-eq-port-pitch",
		);
		const count = findInspectorElement(
			tree,
			(element) => element.props["data-testid"] === "edit-port-equipment-membership",
		);
		if (!pitch || !count) throw new Error("Expected both EQ Port edit entries");
		expect(pitch.props.disabled).toBe(false);
		expect(pitch.props["aria-label"]).toBe("Port 간격 편집 · 현재 1 m");
		expect(pitch.props.title).toBe("PORT-1 고정 · Port 수 유지 · 간격 미리보기");
		(pitch.props.onClick as () => void)();
		expect(start).toHaveBeenLastCalledWith("pitch");
		(count.props.onClick as () => void)();
		expect(start).toHaveBeenLastCalledWith();
		expect(start).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(state)).toBe(before);
	});

	it.each([
		{
			kind: "OHB",
			editor: "single-port",
			moveId: "move-ohb-port",
			copyId: "copy-ohb-port",
			moveLabel: "위치 이동",
			copyLabel: "OHB 복제",
			contextMove: "포트 이동",
			contextCopy: "포트 복제",
		},
		{
			kind: "EQ",
			editor: "group",
			moveId: "move-port-equipment-group",
			copyId: "copy-port-equipment-group",
			moveLabel: "장비 이동",
			copyLabel: "장비 복제",
			contextMove: "그룹 전체 이동",
			contextCopy: "그룹 전체 복제",
		},
		{
			kind: "STK",
			editor: "group",
			moveId: "move-port-equipment-group",
			copyId: "copy-port-equipment-group",
			moveLabel: "장비 이동",
			copyLabel: "장비 복제",
			contextMove: "그룹 전체 이동",
			contextCopy: "그룹 전체 복제",
		},
	] as const)("retains $kind transform labels, IDs and the command sent by each button", (expected) => {
		const group: EquipmentGroupRecord =
			expected.kind === "OHB"
				? { id: 1, kind: "OHB", template: "SINGLE", portIds: [1] }
				: expected.kind === "EQ"
					? { id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] }
					: { id: 1, kind: "STK", template: "FLEX", portIds: [1, 2] };
		const state = eqState(
			group.portIds.map((id) => ({
				...port(id, 1, `${group.kind}-${id}`, id * 1_000),
				portType: group.kind,
			})),
			[group],
		);
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected editable transform fixture");
		const transform = vi.fn();
		const tree = PortEquipmentInspector({
			...inspectorProps(state, selected),
			startSelectedPortEquipmentTransform: transform,
		});
		for (const [mode, id, label] of [
			["move", expected.moveId, expected.moveLabel],
			["copy", expected.copyId, expected.copyLabel],
		] as const) {
			const button = findInspectorElement(tree, (element) => element.props["data-testid"] === id);
			if (!button) throw new Error(`Missing ${id}`);
			expect(button.props.disabled).toBe(false);
			expect(renderToStaticMarkup(button)).toContain(label);
			(button.props.onClick as () => void)();
			expect(transform).toHaveBeenLastCalledWith(mode);
		}
		expect(transform).toHaveBeenCalledTimes(2);
		const policy = portEquipmentTransformPolicy(group.kind);
		expect(policy.editor).toBe(expected.editor);
		expect(policy.move.contextLabel).toBe(expected.contextMove);
		expect(policy.copy.contextLabel).toBe(expected.contextCopy);
		expect(Object.isFrozen(policy)).toBe(true);
	});

	it.each([
		"2d",
		"3d",
	] as const)("restricts Loop registration entry to 2D when rendering %s", (viewMode) => {
		const state = eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected an editable EQ selection.");
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, {
				...inspectorProps(state, selected),
				selectedEquipmentProcessLoopRegistrationAvailable: true,
				viewMode,
			}),
		);
		expect(markup.includes('data-testid="select-equipment-process-loop-rail"')).toBe(
			viewMode === "2d",
		);
		expect(markup.includes('data-testid="edit-eq-port-pitch"')).toBe(viewMode === "2d");
		expect(markup.includes('data-primary-process-loop-availability="register"')).toBe(
			viewMode === "2d",
		);
	});

	it.each<{
		name: string;
		group: EquipmentGroupRecord;
		unowned: readonly boolean[];
		owned: readonly boolean[];
	}>([
		{
			name: "OHB",
			group: { id: 1, kind: "OHB", template: "SINGLE", portIds: [1] },
			unowned: [true, true, false, true],
			owned: [false, true, false, false],
		},
		{
			name: "EQ",
			group: { id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
			unowned: [true, true, true, true],
			owned: [false, true, false, false],
		},
		{
			name: "FLEX STK",
			group: { id: 1, kind: "STK", template: "FLEX", portIds: [1] },
			unowned: [true, true, true, true],
			owned: [false, true, false, false],
		},
		{
			name: "FOUR_PORT STK",
			group: { id: 1, kind: "STK", template: "FOUR_PORT", portIds: [1, 2, 3, 4] },
			unowned: [true, true, true, true],
			owned: [false, true, false, false],
		},
		{
			name: "SIX_PORT STK",
			group: { id: 1, kind: "STK", template: "SIX_PORT", portIds: [1, 2, 3, 4, 5, 6] },
			unowned: [true, true, true, true],
			owned: [false, true, false, false],
		},
		{
			name: "BACK_TO_BACK STK",
			group: { id: 1, kind: "STK", template: "BACK_TO_BACK", portIds: [1, 2, 3, 4] },
			unowned: [true, true, true, true],
			owned: [false, true, false, false],
		},
		{
			name: "legacy CUSTOM STK",
			group: { id: 1, kind: "STK", template: "CUSTOM", portIds: [1] },
			unowned: [false, false, false, true],
			owned: [false, false, false, false],
		},
	])("preserves unowned and directly owned $name actions", ({ group, unowned, owned }) => {
		const ports = group.portIds.map((id, index) => ({
			...port(id, group.id, `${group.kind}-${id}`, index * 1_000),
			portType: group.kind,
		}));
		const state = { ...eqState(ports, [group]), nextPortId: ports.length + 1 };
		const before = JSON.stringify(state);
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		expect(selected).not.toBeNull();
		if (!selected) throw new Error("Expected an editable equipment selection.");
		for (const directlyOwned of [false, true]) {
			const actions = resolvePortEquipmentActionAvailability({
				editableSelection: selected,
				directlyOwned,
			});
			const ordered = [actions.move, actions.copy, actions.editMembership, actions.delete];
			expect(actions.reverseServiceDirection).toEqual(actions.move);
			expect(actions.editEqBody.allowed).toBe(group.kind === "EQ" && !directlyOwned);
			expect(actions.editEqRecipe.allowed).toBe(group.kind === "EQ" && !directlyOwned);
			expect(ordered.map((action) => action.allowed)).toEqual(directlyOwned ? owned : unowned);
			expect(Object.isFrozen(actions)).toBe(true);
			for (const action of ordered) {
				expect(Object.isFrozen(action)).toBe(true);
				if (action.allowed) expect(action).toEqual({ allowed: true, code: null, reason: null });
				else {
					expect(action.code).not.toBeNull();
					expect(action.reason.length).toBeGreaterThan(0);
				}
			}
			const markup = renderToStaticMarkup(
				createElement(PortEquipmentInspector, {
					...inspectorProps(state, selected),
					selectedEquipmentDirectlyOwned: directlyOwned,
				}),
			);
			if (group.kind === "EQ") {
				expect(inspectorActionButton(markup, "edit-eq-port-pitch").includes('disabled=""')).toBe(
					!actions.editMembership.allowed,
				);
			} else expect(markup).not.toContain('data-testid="edit-eq-port-pitch"');
			const ids = [
				group.kind === "OHB" ? "move-ohb-port" : "move-port-equipment-group",
				group.kind === "OHB" ? "copy-ohb-port" : "copy-port-equipment-group",
				"edit-port-equipment-membership",
				"delete-port-equipment",
			];
			expect(
				inspectorActionButton(markup, "reverse-port-equipment-service-direction").includes(
					'disabled=""',
				),
			).toBe(!actions.reverseServiceDirection.allowed);
			for (const [index, id] of ids.entries()) {
				const button = markup.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0];
				if (group.kind === "OHB" && index === 2) expect(button).toBeUndefined();
				else {
					expect(button, id).toBeDefined();
					expect(button?.includes('disabled=""'), id).toBe(!ordered[index]?.allowed);
				}
			}
		}
		expect(JSON.stringify(state)).toBe(before);
	});

	it("reports the existing owner-before-CUSTOM refusal order without permitting CUSTOM copy", () => {
		const state = eqState(
			[{ ...port(1, 1, "STK-1", 500), portType: "STK" }],
			[{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1] }],
		);
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection: resolveEditablePortEquipmentSelection(state, selection()),
			directlyOwned: true,
		});
		expect(actions.move.code).toBe("DIRECTLY_OWNED");
		expect(actions.editMembership.code).toBe("DIRECTLY_OWNED");
		expect(actions.delete.code).toBe("DIRECTLY_OWNED");
		expect(actions.copy.code).toBe("LEGACY_CUSTOM");
	});

	it("requires fresh selection facts after source replacement and ownership changes", () => {
		const state = eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		const before = resolvePortEquipmentActionAvailability({
			editableSelection: selected,
			directlyOwned: false,
		});
		const nowOwned = resolvePortEquipmentActionAvailability({
			editableSelection: selected,
			directlyOwned: true,
		});
		expect(before.move.allowed).toBe(true);
		expect(nowOwned.move.code).toBe("DIRECTLY_OWNED");
		expect(nowOwned.copy.allowed).toBe(true);
		const replacement = eqState([], []);
		const removed = resolvePortEquipmentActionAvailability({
			editableSelection: resolveEditablePortEquipmentSelection(replacement, selection()),
			directlyOwned: false,
		});
		for (const action of Object.values(removed)) {
			expect(action).toMatchObject({ allowed: false, code: "SELECTION_NOT_EDITABLE" });
		}
		expect(before.move.allowed).toBe(true);
	});

	it.each([
		"CUSTOM",
		"FLEX",
	] as const)("shows the supported transform actions for %s STK", (template) => {
		const state = eqState(
			[{ ...port(1, 1, "STK-1", 500), portType: "STK" }],
			[{ id: 1, kind: "STK", template, portIds: [1] }],
		);
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		expect(selected).not.toBeNull();
		if (!selected) throw new Error("Expected valid legacy or modular STK selection.");
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, inspectorProps(state, selected)),
		);
		expect(markup).not.toContain('data-testid="select-flex-stk-port"');
		for (const id of [
			"move-port-equipment-group",
			"copy-port-equipment-group",
			"edit-port-equipment-membership",
		]) {
			const button = markup.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0];
			expect(button, id).toBeDefined();
			expect(button?.includes('disabled=""'), id).toBe(template === "CUSTOM");
		}
		expect(markup).not.toContain("장비 전체 이동·복제는 사용할 수");
		if (template === "CUSTOM")
			expect(markup).toContain("이동·복제·Port 편집·서비스 방향 반전을 지원하지 않습니다");
		const deleteButton = markup.match(/<button[^>]*data-testid="delete-port-equipment"[^>]*>/)?.[0];
		expect(deleteButton).toBeDefined();
		expect(deleteButton).not.toContain('disabled=""');
	});

	it("keeps a valid reciprocal equipment group editable", () => {
		const state = eqState();

		expect(resolveEditablePortEquipmentSelection(state, selection())).toMatchObject({
			port: { id: 1 },
			equipmentGroup: { id: 1, kind: "EQ" },
		});
	});

	it("makes the whole group read-only when a different member has a duplicate barcode", () => {
		const state = eqState(
			[
				port(1, 1, "EQ-1", 0),
				port(2, 1, "DUPLICATE", 1_000),
				{ ...port(3, 2, "DUPLICATE", 4_000), portType: "OHB" },
			],
			[
				{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
				{ id: 2, kind: "OHB", template: "SINGLE", portIds: [3] },
			],
		);

		expect(resolveExactPortEquipmentSelection(state, selection())).not.toBeNull();
		expect(resolveEditablePortEquipmentSelection(state, selection())).toBeNull();
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection: resolveEditablePortEquipmentSelection(state, selection()),
			directlyOwned: false,
		});
		for (const action of Object.values(actions)) {
			expect(action).toMatchObject({ allowed: false, code: "SELECTION_NOT_EDITABLE" });
		}
	});

	it("fails closed when an unrelated group would make every atomic commit invalid", () => {
		const state = eqState(undefined, [
			{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
			{ id: 2, kind: "OHB", template: "SINGLE", portIds: [99] },
		]);

		expect(resolveEditablePortEquipmentSelection(state, selection())).toBeNull();
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection: resolveEditablePortEquipmentSelection(state, selection()),
			directlyOwned: true,
		});
		for (const action of Object.values(actions)) {
			expect(action).toMatchObject({ allowed: false, code: "SELECTION_NOT_EDITABLE" });
		}
	});
});

describe("PortEquipmentInspector same-Loop editing", () => {
	it.each([
		undefined,
		{ lengthMillimeters: 4_000, widthMillimeters: 1_200 },
	])("separates draft cancellation from restoring Port-derived EQ size (%j)", (bodyDimensions) => {
		const state = eqState(undefined, [
			{
				id: 1,
				kind: "EQ",
				pitchMillimeters: 1_000,
				recipe: null,
				portIds: [1, 2],
				...(bodyDimensions ? { bodyDimensions } : {}),
			},
		]);
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected an editable EQ selection.");
		const commit = vi.fn();
		const clearSelection = vi.fn();
		const onDraftChange = vi.fn();
		const props = {
			...inspectorProps(state, selected),
			commitSelectedEqBodyDimensions: commit,
			clearPortEquipmentSelection: clearSelection,
			onEqBodyDraftChange: onDraftChange,
		};
		const markup = renderToStaticMarkup(createElement(PortEquipmentInspector, props));
		expect(markup).toContain('role="status" data-testid="eq-body-draft-status"');
		expect(markup).toContain("현재 적용된 크기입니다.");
		expect(markup).not.toContain("미적용 입력이 있습니다.");
		const cancel = inspectorActionButton(markup, "cancel-eq-body-dimensions");
		expect(cancel).toContain('type="button"');
		expect(cancel).toContain('disabled=""');
		expect(markup).toContain("입력 취소");
		expect(inspectorActionButton(markup, "reset-eq-body-dimensions").includes('disabled=""')).toBe(
			bodyDimensions === undefined,
		);

		// Exercise the rendered child handlers without a browser or a second document/history model.
		const editor = findInspectorElement(
			PortEquipmentInspector({ ...props, modelSyncPending: true }),
			(element) => element.props.group === selected.equipmentGroup,
		);
		if (!editor || typeof editor.type !== "function") throw new Error("Expected EQ size editor.");
		const setLength = vi.fn();
		const setWidth = vi.fn();
		const setFailure = vi.fn();
		const useState = vi
			.mocked(React.useState)
			.mockReturnValueOnce(["5.5", setLength])
			.mockReturnValueOnce(["", setWidth])
			.mockReturnValueOnce(["겹침으로 적용할 수 없습니다", setFailure]);
		const cleanup: { current: ReturnType<React.EffectCallback> } = { current: undefined };
		const useEffect = vi.mocked(React.useEffect).mockImplementationOnce((effect) => {
			cleanup.current = effect();
		});
		const sourceBefore = JSON.stringify(state);
		try {
			const renderEditor = editor.type as (props: Record<string, unknown>) => ReactNode;
			const draft = renderEditor(editor.props);
			expect(onDraftChange).toHaveBeenLastCalledWith(true);
			const draftMarkup = renderToStaticMarkup(draft);
			expect(draftMarkup).toContain("겹침으로 적용할 수 없습니다");
			expect(draftMarkup).toContain('role="alert" data-testid="eq-body-draft-status"');
			expect(inspectorActionButton(draftMarkup, "apply-eq-body-dimensions")).toContain(
				'disabled=""',
			);
			const cancelDraft = findInspectorElement(
				draft,
				(element) => element.props["data-testid"] === "cancel-eq-body-dimensions",
			);
			expect(cancelDraft?.props.disabled).toBe(false);
			(cancelDraft?.props.onClick as () => void)();
			expect(setLength).toHaveBeenCalledExactlyOnceWith(bodyDimensions ? "4" : "2");
			expect(setWidth).toHaveBeenCalledExactlyOnceWith(bodyDimensions ? "1.2" : "0.9");
			expect(setFailure).toHaveBeenCalledExactlyOnceWith(null);
			expect(commit).not.toHaveBeenCalled();
			expect(clearSelection).not.toHaveBeenCalled();
			expect(JSON.stringify(state)).toBe(sourceBefore);
			expect(props.selectedPortEquipment).toEqual(selection());
			if (typeof cleanup.current === "function") cleanup.current();
			expect(onDraftChange).toHaveBeenLastCalledWith(false);
		} finally {
			useEffect.mockRestore();
			useState.mockRestore();
		}
	});

	it("keeps EQ apply failure local to its draft and clears it on correction or success", () => {
		const state = eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected an editable EQ selection.");
		const failure = "EQ-1 몸체가 EQ-2 몸체와 겹칩니다.";
		const commit = vi.fn().mockReturnValueOnce(failure).mockReturnValueOnce(undefined);
		const props = { ...inspectorProps(state, selected), commitSelectedEqBodyDimensions: commit };
		const editor = findInspectorElement(
			PortEquipmentInspector(props),
			(element) => element.props.group === selected.equipmentGroup,
		);
		if (!editor || typeof editor.type !== "function") throw new Error("Expected EQ size editor.");
		const renderEditor = editor.type as (props: Record<string, unknown>) => ReactNode;
		const setFailure = vi.fn();
		const useState = vi.mocked(React.useState);
		const useEffect = vi.mocked(React.useEffect).mockImplementation((effect) => {
			effect();
		});
		const renderDraft = (error: string | null) => {
			useState
				.mockReturnValueOnce(["4.5", vi.fn()])
				.mockReturnValueOnce(["3", vi.fn()])
				.mockReturnValueOnce([error, setFailure]);
			return renderEditor(editor.props);
		};
		const sourceBefore = JSON.stringify(state);
		try {
			const draft = renderDraft(null);
			const form = findInspectorElement(draft, (element) => element.type === "form");
			const submit = form?.props.onSubmit as (event: { preventDefault: () => void }) => void;
			submit({ preventDefault: vi.fn() });
			expect(commit).toHaveBeenLastCalledWith(
				{ lengthMillimeters: 4500, widthMillimeters: 3000 },
				selection(),
			);
			expect(setFailure).toHaveBeenLastCalledWith(failure);
			const failed = renderDraft(failure);
			const markup = renderToStaticMarkup(failed);
			expect(markup).toContain('role="alert" data-testid="eq-body-draft-status"');
			expect(markup).toContain(failure);
			expect(markup).not.toContain("미적용 입력이 있습니다.");
			expect(markup.match(/aria-describedby="eq-body-apply-feedback"/g)).toHaveLength(2);
			const length = findInspectorElement(
				failed,
				(element) => element.props["data-testid"] === "eq-body-length",
			);
			(length?.props.onChange as (event: { currentTarget: { value: string } }) => void)({
				currentTarget: { value: "4" },
			});
			expect(setFailure).toHaveBeenLastCalledWith(null);
			const width = findInspectorElement(
				failed,
				(element) => element.props["data-testid"] === "eq-body-width",
			);
			(width?.props.onChange as (event: { currentTarget: { value: string } }) => void)({
				currentTarget: { value: "2" },
			});
			expect(setFailure).toHaveBeenLastCalledWith(null);
			submit({ preventDefault: vi.fn() });
			expect(setFailure).toHaveBeenLastCalledWith(null);
			const alternatePort = findInspectorElement(
				PortEquipmentInspector({ ...props, selectedPortEquipment: { ...selection(), portId: 2 } }),
				(element) => element.props.group === selected.equipmentGroup,
			);
			expect(alternatePort?.key).toBe(editor.key);
			if (!alternatePort) throw new Error("Expected EQ editor for the alternate Port.");
			useState
				.mockReturnValueOnce(["4.5", vi.fn()])
				.mockReturnValueOnce(["3", vi.fn()])
				.mockReturnValueOnce([null, setFailure]);
			const alternateDraft = renderEditor(alternatePort.props);
			const alternateForm = findInspectorElement(
				alternateDraft,
				(element) => element.type === "form",
			);
			(alternateForm?.props.onSubmit as (event: { preventDefault: () => void }) => void)({
				preventDefault: vi.fn(),
			});
			expect(commit).toHaveBeenLastCalledWith(
				{ lengthMillimeters: 4500, widthMillimeters: 3000 },
				{ ...selection(), portId: 2 },
			);
			useState
				.mockReturnValueOnce(["2", vi.fn()])
				.mockReturnValueOnce(["0.9", vi.fn()])
				.mockReturnValueOnce([failure, setFailure]);
			const unchangedDraft = renderEditor(editor.props);
			const dismissFailure = findInspectorElement(
				unchangedDraft,
				(element) => element.props["data-testid"] === "cancel-eq-body-dimensions",
			);
			expect(dismissFailure?.props.disabled).toBe(false);
			(dismissFailure?.props.onClick as () => void)();
			expect(setFailure).toHaveBeenLastCalledWith(null);
			expect(JSON.stringify(state)).toBe(sourceBefore);
		} finally {
			useEffect.mockRestore();
			useState.mockRestore();
		}
	});

	it.each([
		"OHB",
		"EQ",
		"STK",
	] as const)("enables owned %s edits with current Loop source and keeps deletion blocked", (kind) => {
		const group: EquipmentGroupRecord =
			kind === "EQ"
				? { id: 1, kind, portIds: [1, 2], pitchMillimeters: 1_000, recipe: null }
				: kind === "STK"
					? { id: 1, kind, portIds: [1, 2], template: "FLEX" }
					: { id: 1, kind, portIds: [1], template: "SINGLE" };
		const state = eqState(
			group.portIds.map((id) => ({ ...port(id, 1, `${kind}-${id}`, id * 1_000), portType: kind })),
			[group],
		);
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected a complete group.");
		const organizations = inspectorLoopOrganizations();
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection: selected,
			directlyOwned: false,
			organizations,
		});
		expect(actions.move.allowed).toBe(true);
		expect(actions.reverseServiceDirection.allowed).toBe(true);
		expect(actions.editEqBody.allowed).toBe(kind === "EQ");
		expect(actions.editEqRecipe.allowed).toBe(kind === "EQ");
		expect(actions.copy.allowed).toBe(true);
		expect(actions.editMembership.allowed).toBe(kind !== "OHB");
		expect(actions.delete).toMatchObject({ allowed: false, code: "DIRECTLY_OWNED" });
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, {
				...inspectorProps(state, selected),
				selectedEquipmentDirectlyOwned: true,
				organizations,
			}),
		);
		expect(
			inspectorActionButton(markup, kind === "OHB" ? "move-ohb-port" : "move-port-equipment-group"),
		).not.toContain('disabled=""');
		if (kind !== "OHB")
			expect(inspectorActionButton(markup, "edit-port-equipment-membership")).not.toContain(
				'disabled=""',
			);
		if (kind === "EQ")
			expect(inspectorActionButton(markup, "edit-eq-port-pitch")).not.toContain('disabled=""');
		expect(inspectorActionButton(markup, "delete-port-equipment")).toContain('disabled=""');
		expect(inspectorActionButton(markup, "reverse-port-equipment-service-direction")).not.toContain(
			'disabled=""',
		);
		expect(markup).toContain("소속을 유지하며 같은 Process Loop 안에서");
		expect(markup).toContain(
			"다른 Loop로 소속을 바꾸거나 철거하려면 Process Loop 소속에서 먼저 분리하세요.",
		);
		expect(markup).not.toContain("아래 소속을 먼저 분리하세요.");
		expect(markup).toContain(actions.delete.reason);
		if (kind === "EQ") {
			expect(markup).toContain('data-testid="eq-body-length"');
			expect(markup).toContain('data-testid="eq-body-width"');
			expect(inspectorActionButton(markup, "apply-eq-body-dimensions")).not.toContain(
				'disabled=""',
			);
		}
		for (const pending of [
			{ modelSyncPending: true },
			{ workerState: { status: "syncing" as const } },
		]) {
			const pendingMarkup = renderToStaticMarkup(
				createElement(PortEquipmentInspector, {
					...inspectorProps(state, selected),
					organizations,
					...pending,
				}),
			);
			expect(
				inspectorActionButton(pendingMarkup, "reverse-port-equipment-service-direction"),
			).toContain('disabled=""');
		}
	});

	it.each([
		"area",
		"multiple",
		"custom",
		"missing-source",
	] as const)("keeps %s ownership constraints visible before starting an edit", (condition) => {
		const state =
			condition === "custom"
				? eqState(
						[{ ...port(1, 1, "STK-1", 500), portType: "STK" }],
						[{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1] }],
					)
				: eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected a complete group.");
		const organizations =
			condition === "missing-source"
				? undefined
				: inspectorLoopOrganizations(
						condition === "area" || condition === "multiple" ? condition : "loop",
					);
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection: selected,
			directlyOwned: true,
			organizations,
		});
		expect(actions.move.allowed).toBe(false);
		expect(actions.reverseServiceDirection.allowed).toBe(false);
		expect(actions.editMembership.allowed).toBe(false);
		expect(actions.delete.allowed).toBe(false);
		expect(actions.copy.allowed).toBe(condition !== "custom");
		expect(actions.move.reason).toMatch(
			condition === "area"
				? /Process Loop가 아닙니다/
				: condition === "multiple"
					? /여러 조직/
					: condition === "custom"
						? /CUSTOM/
						: /소속을 먼저/,
		);
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, {
				...inspectorProps(state, selected),
				selectedEquipmentDirectlyOwned: true,
				organizations,
			}),
		);
		const escapedReason = renderToStaticMarkup(
			createElement("span", null, actions.move.reason),
		).slice(6, -7);
		expect(markup).toContain(escapedReason);
		expect(inspectorActionButton(markup, "move-port-equipment-group")).toContain('disabled=""');
		expect(inspectorActionButton(markup, "reverse-port-equipment-service-direction")).toContain(
			'disabled=""',
		);
	});
});

function inspectorLoopOrganizations(kind: "loop" | "area" | "multiple" = "loop") {
	const membership = {
		railEdges: [{ from: { x: 0, y: 0 }, to: { x: 1, y: 0 } }],
		advancedSwitchIds: [],
		equipmentGroupIds: [1],
	};
	return copyStaticFabOrganizationState({
		nextOrganizationId: 4,
		records: [
			{
				id: 1,
				kind: "BAY",
				name: "Synthetic Bay",
				membership: { ...membership, equipmentGroupIds: [] },
			},
			{
				id: 2,
				kind: kind === "area" ? "AREA" : "AISLE",
				name: "Synthetic Loop",
				parentOrganizationIds: kind === "area" ? [] : [1],
				membership,
			},
			...(kind === "multiple"
				? [{ id: 3, kind: "AREA" as const, name: "Shared Area", membership }]
				: []),
		],
	});
}

describe("PortEquipmentInspector action explanations", () => {
	it.each([
		false,
		true,
	])("explains directly owned equipment with outside-Loop ownership %s", (outsideLoop) => {
		const state = eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected an editable EQ selection.");
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection: selected,
			directlyOwned: true,
		});
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, {
				...inspectorProps(state, selected),
				selectedEquipmentDirectlyOwned: true,
				selectedEquipmentOwnedOutsideProcessLoop: outsideLoop,
			}),
		);
		expect(markup).toContain(actions.move.reason);
		expect(markup).toContain(
			outsideLoop
				? "이동·Port 편집·철거 전에 FAB 구조에서 소속을 정리하세요."
				: "다른 Loop로 소속을 바꾸거나 철거하려면 Process Loop 소속에서 먼저 분리하세요.",
		);
		expect(markup).toContain("복제는 계속할 수 있습니다.");
		for (const id of [
			"move-port-equipment-group",
			"edit-port-equipment-membership",
			"edit-eq-port-pitch",
			"delete-port-equipment",
		]) {
			expect(inspectorActionButton(markup, id)).toContain(
				'aria-describedby="tilefab-equipment-organization-mutation-note"',
			);
		}
		expect(inspectorActionButton(markup, "copy-port-equipment-group")).not.toContain('disabled=""');
	});

	it.each([
		false,
		true,
	])("explains CUSTOM restrictions without promising blocked actions when owned %s", (directlyOwned) => {
		const state = eqState(
			[{ ...port(1, 1, "STK-1", 500), portType: "STK" }],
			[{ id: 1, kind: "STK", template: "CUSTOM", portIds: [1] }],
		);
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected an editable legacy STK selection.");
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection: selected,
			directlyOwned,
		});
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, {
				...inspectorProps(state, selected),
				selectedEquipmentDirectlyOwned: directlyOwned,
			}),
		);
		expect(markup).toContain(actions.copy.reason);
		expect(markup).not.toContain("복제는 계속할 수 있습니다.");
		expect(markup.includes("기존 장비의 철거와 실행 취소는 사용할 수 있습니다.")).toBe(
			!directlyOwned,
		);
		expect(inspectorActionButton(markup, "copy-port-equipment-group")).toContain(
			'aria-describedby="tilefab-stk-membership-note"',
		);
		expect(inspectorActionButton(markup, "move-port-equipment-group")).toContain(
			`aria-describedby="${directlyOwned ? "tilefab-equipment-organization-mutation-note" : "tilefab-stk-membership-note"}"`,
		);
	});

	it.each([
		"integrity",
		"no-selection",
	] as const)("explains every disabled action for %s", (source) => {
		const state =
			source === "integrity"
				? eqState(undefined, [
						{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
						{ id: 2, kind: "OHB", template: "SINGLE", portIds: [99] },
					])
				: eqState();
		const displayed = resolveExactPortEquipmentSelection(state, selection());
		if (!displayed) throw new Error("Expected the retained display selection.");
		const editableSelection =
			source === "no-selection" ? null : resolveEditablePortEquipmentSelection(state, selection());
		const actions = resolvePortEquipmentActionAvailability({
			editableSelection,
			directlyOwned: true,
		});
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, {
				...inspectorProps(state, displayed),
				selectedPortEditableDetails: editableSelection,
				selectedPortEquipment: source === "no-selection" ? null : selection(),
				selectedEquipmentDirectlyOwned: true,
			}),
		);
		expect(markup).toContain(actions.move.reason);
		expect(markup).not.toContain('id="tilefab-equipment-organization-mutation-note"');
		for (const id of [
			"move-port-equipment-group",
			"copy-port-equipment-group",
			"edit-port-equipment-membership",
			"edit-eq-port-pitch",
			"delete-port-equipment",
		]) {
			const button = inspectorActionButton(markup, id);
			expect(button).toContain('disabled=""');
			expect(button).toContain('aria-describedby="tilefab-equipment-selection-mutation-note"');
		}
	});

	it.each([
		"ready",
		"pending",
		"mirror",
		"uneditable",
		"owned",
	] as const)("keeps the primary Loop recovery move guarded for %s", (status) => {
		const state = eqState();
		const selected = resolveEditablePortEquipmentSelection(state, selection());
		if (!selected) throw new Error("Expected an editable EQ selection.");
		const markup = renderToStaticMarkup(
			createElement(PortEquipmentInspector, {
				...inspectorProps(state, selected),
				selectedEquipmentNeedsGroupMoveForProcessLoop: true,
				selectedPortEditableDetails: status === "uneditable" ? null : selected,
				selectedEquipmentDirectlyOwned: status === "owned",
				modelSyncPending: status === "pending",
				workerState: { status: status === "mirror" ? "syncing" : "ready" },
			}),
		);
		expect(
			inspectorActionButton(markup, "move-port-equipment-group-primary").includes('disabled=""'),
		).toBe(status !== "ready");
		expect(inspectorActionButton(markup, "edit-eq-port-pitch").includes('disabled=""')).toBe(
			status !== "ready",
		);
	});
});

function findInspectorElement(
	node: ReactNode,
	matches: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | null {
	if (Array.isArray(node)) {
		for (const child of node) {
			const found = findInspectorElement(child, matches);
			if (found) return found;
		}
	} else if (isValidElement<Record<string, unknown>>(node)) {
		if (matches(node)) return node;
		return findInspectorElement(node.props.children as ReactNode, matches);
	}
	return null;
}

function inspectorActionButton(markup: string, id: string): string {
	const button = markup.match(new RegExp(`<button[^>]*data-testid="${id}"[^>]*>`))?.[0];
	expect(button, id).toBeDefined();
	return button as string;
}

function inspectorProps(
	state: PortEquipmentState,
	selected: NonNullable<ReturnType<typeof resolveEditablePortEquipmentSelection>>,
): PortEquipmentInspectorProps {
	const noop = (): void => undefined;
	return {
		eqRecipeSource:
			selected.equipmentGroup.kind === "EQ"
				? {
						...selection(),
						modelGeneration: 1,
						baseRevision: 0,
						basePatchSequence: 0,
						recipe: selected.equipmentGroup.recipe,
					}
				: null,
		eqBodyDraftPending: false,
		eqRecipeDraftPending: false,
		onEqRecipeDraftChange: noop,
		commitSelectedEqRecipe: () => null,
		activePortEquipment: state,
		onEqBodyDraftChange: noop,
		bindCompactInspectorDisclosure: noop,
		canvasRef: { current: null },
		chooseGuidedEquipmentTool: () => false,
		clearPortEquipmentSelection: noop,
		commitSelectedEqBodyDimensions: noop,
		commitSelectedEquipmentProcessLoopMembership: noop,
		compactInspectorCloseRef: { current: null },
		compactInspectorDisclosureFocusedRef: { current: false },
		compactInspectorExpanded: true,
		compactInspectorSheetActive: false,
		completedModuleHandoff: null,
		deleteSelected: noop,
		eqToStkHandoff: null,
		modelSyncPending: false,
		nextPortEquipmentButtonRef: { current: null },
		organizationRecordsById: new Map(),
		organizationSemanticRoles: new Map(),
		portRouteDetail: () => "Rail",
		portRouteSummary: () => "Rail",
		processLoopMembershipDisclosureRef: { current: null },
		processLoopPrimaryActionRef: { current: null },
		processLoopPrimaryStatusRef: { current: null },
		reverseSelectedPortEquipmentServiceDirection: noop,
		scheduleRender: noop,
		selectConnectedAuthoredComponent: noop,
		selectEquipmentProcessLoopRailForRegistration: noop,
		selectedEquipmentProcessLoopRegistrationAvailable: false,
		selectNextPortEquipmentGroup: noop,
		selectFlexStkPort: noop,
		startNextFlexStkPortMove: noop,
		selectedEquipmentDirectlyOwned: false,
		selectedEquipmentGroup: selected.equipmentGroup,
		selectedEquipmentNeedsGroupMoveForProcessLoop: false,
		selectedEquipmentNoProcessLoopHint: "",
		selectedEquipmentOwnedOutsideProcessLoop: false,
		selectedEquipmentOwnedProcessLoopId: null,
		selectedEquipmentPrimaryProcessLoopId: null,
		selectedEquipmentProcessLoopMembership: null,
		selectedEquipmentUnownedProcessLoopMembership: null,
		selectedPortDetails: selected,
		selectedPortEditableDetails: selected,
		selectedPortEquipment: selection(),
		setCompactInspectorExpanded: noop,
		setStatus: noop,
		startEquipmentAuthoringContinuation: noop,
		startSelectedPortEquipmentTransform: noop,
		startSelectedPortEquipmentGroupEdit: noop,
		startSelectedPortEquipmentMembershipEdit: noop,
		stkAuthoringTemplateLabel: (template) => template,
		viewMode: "2d",
		workerState: { status: "ready" },
	};
}

function selection(): { readonly portId: number; readonly equipmentGroupId: number } {
	return { portId: 1, equipmentGroupId: 1 };
}

function eqState(
	ports: readonly PortRecord[] = [port(1, 1, "EQ-1", 0), port(2, 1, "EQ-2", 1_000)],
	equipmentGroups: PortEquipmentState["equipmentGroups"] = [
		{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
	],
): PortEquipmentState {
	return {
		nextPortId: 4,
		nextEquipmentGroupId: 3,
		ports,
		equipmentGroups,
	};
}

function port(
	id: number,
	equipmentGroupId: number,
	barcode: string,
	stationMillimeters: number,
): PortRecord {
	return {
		id,
		equipmentGroupId,
		route: { kind: "CARDINAL_CELL", x: 0, z: 0, from: DIR_W, to: DIR_E },
		stationMillimeters,
		side: "CENTER",
		lateralOffsetMillimeters: 0,
		direction: "WITH_TRAVEL",
		portType: "EQ",
		barcode,
	};
}
