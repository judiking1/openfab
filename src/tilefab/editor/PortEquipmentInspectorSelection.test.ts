import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
			expect(actions.reverseServiceDirection).toEqual(actions.move);
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
		expect(inspectorActionButton(markup, "delete-port-equipment")).toContain('disabled=""');
		expect(inspectorActionButton(markup, "reverse-port-equipment-service-direction")).not.toContain(
			'disabled=""',
		);
		expect(markup).toContain("소속을 유지하며 같은 Process Loop 안에서");
		expect(markup).toContain(actions.delete.reason);
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
		reverseSelectedPortEquipmentServiceDirection: noop,
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
