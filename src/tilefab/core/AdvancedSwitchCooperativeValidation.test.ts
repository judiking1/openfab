import { describe, expect, it } from "vitest";
import { validateAdvancedSwitchPatchSteps } from "./AdvancedSwitch";

describe("cooperative advanced switch patch validation", () => {
	it("bounds source reads per step and retains a malformed final mutation", () => {
		const mutations = Array.from({ length: 10_000 }, (_, x) => ({
			x,
			y: 0,
			before: 0,
			after: 0x82,
		}));
		mutations.push({ x: 9_999, y: 0, before: 0, after: 0x82 });
		let reads = 0;
		const steps = validateAdvancedSwitchPatchSteps(
			{
				getEncoded: () => {
					reads++;
					return 0;
				},
				getAdvancedSwitch: () => undefined,
				getAdvancedSwitchOwningCell: () => {
					reads++;
					return undefined;
				},
			},
			mutations,
		);
		let checkpoints = 0;
		for (;;) {
			reads = 0;
			const step = steps.next();
			expect(reads).toBeLessThanOrEqual(1);
			if (step.done) {
				expect(step.value).toEqual([
					{
						code: "INVALID_CELL_MUTATION",
						message: expect.any(String),
						cells: [{ x: 9_999, y: 0 }],
						switchIds: [],
					},
				]);
				break;
			}
			checkpoints++;
		}
		expect(checkpoints).toBeGreaterThanOrEqual(mutations.length * 2);
	});
});
