import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EquipmentGroupRecord, PortEquipmentState } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { DIR_E, DIR_W } from "../core/railShape";
import { PortEquipmentInspector, type PortEquipmentInspectorProps } from "./PortEquipmentInspector";
import {
	resolveEditablePortEquipmentSelection,
	resolveExactPortEquipmentSelection,
	resolvePortEquipmentActionAvailability,
} from "./PortEquipmentInspectorSelection";

describe("PortEquipmentInspectorSelection", () => {
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
			const ids = [
				group.kind === "OHB" ? "move-ohb-port" : "move-port-equipment-group",
				group.kind === "OHB" ? "copy-ohb-port" : "copy-port-equipment-group",
				"edit-port-equipment-membership",
				"delete-port-equipment",
			];
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
		if (template === "CUSTOM") expect(markup).toContain("이동·복제·Port 편집을 지원하지 않습니다");
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
		expect(markup).toContain(outsideLoop ? "FAB 구조에서 소속을" : "아래 소속을");
		expect(markup).toContain("복제는 계속할 수 있습니다.");
		for (const id of [
			"move-port-equipment-group",
			"edit-port-equipment-membership",
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
	});
});

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
		activePortEquipment: state,
		bindCompactInspectorDisclosure: noop,
		canvasRef: { current: null },
		chooseGuidedEquipmentTool: () => false,
		clearPortEquipmentSelection: noop,
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
		scheduleRender: noop,
		selectConnectedAuthoredComponent: noop,
		selectNextPortEquipmentGroup: noop,
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
		startSelectedOhbPlacementIntent: noop,
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
