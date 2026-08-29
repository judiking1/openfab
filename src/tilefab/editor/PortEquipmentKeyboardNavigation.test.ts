import { describe, expect, it } from "vitest";
import type { CompiledPortSlots } from "../compile/PortSlotCompiler";
import { DIR_E, DIR_N, DIR_S, DIR_W } from "../core/railShape";
import {
	directionalPortEquipmentSlotRow,
	progressiveDirectionalPortEquipmentSlotRow,
} from "./PortEquipmentKeyboardNavigation";

describe("directionalPortEquipmentSlotRow", () => {
	it("moves an EQ endpoint only along the same directed lane", () => {
		const slots = fixtureSlots([
			[0, 0, DIR_W, DIR_E],
			[1, 0, DIR_W, DIR_E],
			[2, 0, DIR_W, DIR_E],
			[1, 1, DIR_W, DIR_E],
			[2, 0, DIR_E, DIR_W],
		]);

		expect(
			directionalPortEquipmentSlotRow({
				slots,
				currentRow: 1,
				deltaX: 1,
				deltaZ: 0,
				candidateRows: [4, 3, 2, 0],
				scope: "same-directed-lane",
			}),
		).toBe(2);
		expect(
			directionalPortEquipmentSlotRow({
				slots,
				currentRow: 1,
				deltaX: 0,
				deltaZ: 1,
				candidateRows: [3],
				scope: "same-directed-lane",
			}),
		).toBeNull();
	});

	it("moves an STK keyboard cursor to the nearest directional slot across nearby runs", () => {
		const slots = fixtureSlots([
			[0, 0, DIR_W, DIR_E],
			[4, 0, DIR_W, DIR_E],
			[1, 2, DIR_N, DIR_S],
			[2, 2, DIR_N, DIR_S],
		]);

		expect(
			directionalPortEquipmentSlotRow({
				slots,
				currentRow: 0,
				deltaX: 1,
				deltaZ: 0,
				candidateRows: [1, 2, 3],
				scope: "nearby",
			}),
		).toBe(1);
		expect(
			directionalPortEquipmentSlotRow({
				slots,
				currentRow: 0,
				deltaX: 0,
				deltaZ: 1,
				candidateRows: [1, 2, 3],
				scope: "nearby",
			}),
		).toBe(2);
	});

	it("is deterministic and scans only the caller-provided bounded candidates", () => {
		const slots = fixtureSlots(
			Array.from({ length: 50_000 }, (_, row) => [row, 0, DIR_W, DIR_E] as const),
		);
		const candidates = [25_001, 25_004, 25_002, 25_003];

		expect(
			directionalPortEquipmentSlotRow({
				slots,
				currentRow: 25_000,
				deltaX: 1,
				deltaZ: 0,
				candidateRows: candidates,
				scope: "same-directed-lane",
			}),
		).toBe(25_001);
		expect(
			directionalPortEquipmentSlotRow({
				slots,
				currentRow: -1,
				deltaX: 1,
				deltaZ: 0,
				candidateRows: candidates,
				scope: "nearby",
			}),
		).toBeNull();
	});

	it("expands indexed search beyond 32 m and reports every attempted window", () => {
		const slots = fixtureSlots([
			[0, 0, DIR_W, DIR_E],
			[80, 0, DIR_W, DIR_E],
		]);
		const radii: number[] = [];
		const result = progressiveDirectionalPortEquipmentSlotRow({
			slots,
			currentRow: 0,
			deltaX: 1,
			deltaZ: 0,
			scope: "nearby",
			target: [],
			query: (bounds, target) => {
				const radius = bounds.maxX - 0.5;
				radii.push(radius);
				target.length = 0;
				if (radius >= 128) target.push(1);
				return target;
			},
		});

		expect(result).toEqual({
			row: 1,
			searchRadius: 128,
			searchSteps: 3,
			candidateRows: 1,
			maximumCandidateRows: 1,
		});
		expect(radii).toEqual([32, 64, 128]);
	});

	it("returns bounded diagnostics when no directional slot exists", () => {
		const slots = fixtureSlots([[0, 0, DIR_W, DIR_E]]);
		const result = progressiveDirectionalPortEquipmentSlotRow({
			slots,
			currentRow: 0,
			deltaX: -1,
			deltaZ: 0,
			scope: "same-directed-lane",
			target: [],
			searchRadii: [16, 32],
			query: (_bounds, target) => {
				target.length = 0;
				target.push(0);
				return target;
			},
		});

		expect(result).toEqual({
			row: null,
			searchRadius: 32,
			searchSteps: 2,
			candidateRows: 1,
			maximumCandidateRows: 1,
		});
	});
});

function fixtureSlots(
	rows: readonly (readonly [x: number, z: number, from: number, to: number])[],
): CompiledPortSlots {
	const count = rows.length;
	const routeXs = new Int32Array(count);
	const routeZs = new Int32Array(count);
	const routeFromDirections = new Uint8Array(count);
	const routeToDirections = new Uint8Array(count);
	const worldPositions = new Float32Array(count * 2);
	for (let row = 0; row < count; row++) {
		const source = rows[row] as readonly [number, number, number, number];
		routeXs[row] = source[0];
		routeZs[row] = source[1];
		routeFromDirections[row] = source[2];
		routeToDirections[row] = source[3];
		worldPositions[row * 2] = source[0] + 0.5;
		worldPositions[row * 2 + 1] = source[1] + 0.5;
	}
	return {
		revision: 1,
		portType: "EQ",
		count,
		legalCount: count,
		sourcePathOffsets: new Uint32Array(count + 1),
		sourcePathIndices: new Uint32Array(0),
		finalPathIndices: new Uint32Array(count),
		routeXs,
		routeZs,
		routeFromDirections,
		routeToDirections,
		stationMillimeters: new Int32Array(count),
		sides: new Uint8Array(count),
		lateralOffsetMillimeters: new Uint16Array(count),
		directions: new Uint8Array(count),
		portTypes: new Uint8Array(count),
		railPositions: new Float32Array(count * 2),
		worldPositions,
		tangents: new Float32Array(count * 2),
		yawRadians: new Float32Array(count),
		statuses: new Uint8Array(count),
		conflictingPortIds: new Int32Array(count),
		conflictingRailPathIndices: new Int32Array(count),
	};
}
