import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PortEquipmentState } from "../core/EquipmentGroup";
import { emptyOperationalConfigurationState } from "../core/OperationalConfiguration";
import {
	addOperationalEqCapability,
	replaceOperationalEqGroupQualification,
	replaceOperationalStationCapability,
} from "./OperationalConfigurationEditorModel";
import { OperationalConfigurationPanel } from "./OperationalConfigurationPanel";

describe("OperationalConfigurationPanel", () => {
	it("exposes the six explicit configuration stages without manufacturing defaults", () => {
		const markup = renderToStaticMarkup(
			<OperationalConfigurationPanel
				configuration={emptyOperationalConfigurationState()}
				portEquipment={emptyPortEquipment()}
				source={{ revision: 0, authoredChecksum: "empty-source" }}
				onApply={vi.fn()}
				onReview={vi.fn()}
				onClose={vi.fn()}
			/>,
		);

		expect(markup).toContain('role="dialog"');
		expect(markup).toContain("STATIONS");
		expect(markup).toContain("<span>EQ</span>");
		expect(markup).toContain("OHB / STK");
		expect(markup).toContain("VEHICLE");
		expect(markup).toContain("RESIDENT HOME");
		expect(markup).toContain("REVIEW");
		expect(markup).toContain("0/0 CONFIGURED");
		expect(markup).toContain("<strong>1</strong> CONFIGURATION ISSUES");
		expect(markup).toContain("REVIEW EXACT SOURCE");
	});

	it("renders authored port and physical group identities as the station policy anchors", () => {
		let configuration = replaceOperationalStationCapability(
			emptyOperationalConfigurationState(),
			7,
			"BIDIRECTIONAL",
		);
		configuration = addOperationalEqCapability(configuration, "ETCH");
		configuration = replaceOperationalEqGroupQualification(configuration, 11, [1]);

		const markup = renderToStaticMarkup(
			<OperationalConfigurationPanel
				configuration={configuration}
				portEquipment={eqPortEquipment()}
				source={{ revision: 12, authoredChecksum: "authored-source" }}
				onApply={vi.fn()}
				onReview={vi.fn()}
				onClose={vi.fn()}
				onFocusPort={vi.fn()}
			/>,
		);

		expect(markup).toContain("EQ-PORT-A");
		expect(markup).toContain("PORT-7 · EQ-11");
		expect(markup).toContain('value="BIDIRECTIONAL" selected=""');
		expect(markup).toContain("1/1 CONFIGURED");
	});
});

function emptyPortEquipment(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 1,
		nextEquipmentGroupId: 1,
		ports: Object.freeze([]),
		equipmentGroups: Object.freeze([]),
	});
}

function eqPortEquipment(): PortEquipmentState {
	return Object.freeze({
		nextPortId: 8,
		nextEquipmentGroupId: 12,
		ports: Object.freeze([
			Object.freeze({
				id: 7,
				equipmentGroupId: 11,
				route: Object.freeze({
					kind: "CARDINAL_CELL" as const,
					x: 4,
					z: 2,
					from: 0 as const,
					to: 2 as const,
				}),
				stationMillimeters: 500,
				side: "RIGHT" as const,
				lateralOffsetMillimeters: 600,
				direction: "WITH_TRAVEL" as const,
				portType: "EQ" as const,
				barcode: "EQ-PORT-A",
			}),
		]),
		equipmentGroups: Object.freeze([
			Object.freeze({
				id: 11,
				kind: "EQ" as const,
				portIds: Object.freeze([7]),
				pitchMillimeters: 1_000,
				recipe: null,
			}),
		]),
	});
}
