import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import type { PortRecord } from "../core/PortRecord";
import { DIR_E, DIR_W } from "../core/railShape";
import { PortEquipmentInspector, type PortEquipmentInspectorProps } from "./PortEquipmentInspector";
import {
	resolveEditablePortEquipmentSelection,
	resolveExactPortEquipmentSelection,
} from "./PortEquipmentInspectorSelection";

describe("PortEquipmentInspectorSelection", () => {
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
	});

	it("fails closed when an unrelated group would make every atomic commit invalid", () => {
		const state = eqState(undefined, [
			{ id: 1, kind: "EQ", pitchMillimeters: 1_000, recipe: null, portIds: [1, 2] },
			{ id: 2, kind: "OHB", template: "SINGLE", portIds: [99] },
		]);

		expect(resolveEditablePortEquipmentSelection(state, selection())).toBeNull();
	});
});

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
