import { describe, expect, it } from "vitest";
import {
	defaultRailTemplateParameters,
	initialRailTemplatePose,
	RAIL_TEMPLATE_CATALOG,
	reverseRailTemplateFlow,
	rotateRailTemplatePose,
	setRailTemplateParameter,
	type RailTemplateId,
	type RailTemplateParameters,
	type RailTemplatePose,
} from "../core/RailTemplateCatalog";
import { PATH_KIND } from "../compile/PhysicalPathCompiler";
import {
	compileRailTemplatePhysicalPreview,
	railTemplatePhysicalPreviewCacheEvictionCount,
	railTemplatePhysicalPreviewCacheStats,
	tryCompileRailTemplatePhysicalPreview,
} from "./RailTemplatePhysicalPreview";

describe("RailTemplatePhysicalPreview", () => {
	it.each(RAIL_TEMPLATE_CATALOG)("compiles $id through the authored and physical pipelines", (item) => {
		const preview = compileRailTemplatePhysicalPreview(
			item.id,
			defaultRailTemplateParameters(item.id),
			initialRailTemplatePose(),
		);
		expect(preview.presentation.source.pathCount).toBeGreaterThan(0);
		expect(preview.presentation.source.pointCount).toBeGreaterThan(1);
		expect(preview.buildLengthMeters).toBeGreaterThan(0);
		expect(preview.totalLengthMeters).toBeGreaterThan(0);
		expect(preview.bounds.maxX).toBeGreaterThan(preview.bounds.minX);
		expect(preview.bounds.maxY).toBeGreaterThan(preview.bounds.minY);
		expect(
			compileRailTemplatePhysicalPreview(
				item.id,
				defaultRailTemplateParameters(item.id),
				initialRailTemplatePose(),
			),
		).toBe(preview);
	});

	it.each(["attached-return", "branch-bypass", "outerbay-link"] as const)(
		"builds the public support trunk and physical turnouts for %s",
		(id) => {
			const preview = compileRailTemplatePhysicalPreview(
				id,
				defaultRailTemplateParameters(id),
				initialRailTemplatePose(),
			);
			expect(preview.connectors).toHaveLength(1);
			const connector = preview.connectors[0];
			expect(connector?.spanMeters).toBeGreaterThan(0);
			expect(preview.turnoutPathCount).toBeGreaterThanOrEqual(2);
			const positions = preview.presentation.source.positions;
			const xCoordinates = Array.from(
				{ length: positions.length / 2 },
				(_, index) => positions[index * 2] as number,
				);
				if (connector) {
					expect(connector.start.x + 0.5 - Math.min(...xCoordinates)).toBeCloseTo(
						connector.supportBeforeMeters + 1,
						4,
					);
					expect(Math.max(...xCoordinates) - (connector.end.x + 0.5)).toBeCloseTo(
						connector.supportAfterMeters + 1,
						4,
					);
				}
		},
	);

	it("preserves physical extent while reversing a closed pattern's directed flow", () => {
		const parameters = defaultRailTemplateParameters("long-bay");
		const pose = initialRailTemplatePose();
		const forward = compileRailTemplatePhysicalPreview("long-bay", parameters, pose);
		const reverse = compileRailTemplatePhysicalPreview(
			"long-bay",
			parameters,
			reverseRailTemplateFlow(pose),
		);
		expect(reverse.key).not.toBe(forward.key);
		expect(reverse.totalLengthMeters).toBeCloseTo(forward.totalLengthMeters, 4);
		expect(reverse.bounds.maxX - reverse.bounds.minX).toBeCloseTo(
			forward.bounds.maxX - forward.bounds.minX,
			4,
		);
		expect(reverse.bounds.maxY - reverse.bounds.minY).toBeCloseTo(
			forward.bounds.maxY - forward.bounds.minY,
			4,
		);
		expectStableReversedMarkers(forward, reverse, "long-bay");
	});

	it("keeps flow locations stable and covers every default turnout across the catalog", () => {
		for (const item of RAIL_TEMPLATE_CATALOG) {
			const parameters = defaultRailTemplateParameters(item.id);
			const pose = initialRailTemplatePose();
			const forward = compileRailTemplatePhysicalPreview(item.id, parameters, pose);
			const reverse = compileRailTemplatePhysicalPreview(
				item.id,
				parameters,
				reverseRailTemplateFlow(pose),
			);
			expect(forward.flowMarkers.length, item.id).toBeGreaterThan(0);
			expect(forward.flowMarkers.length, item.id).toBeLessThanOrEqual(12);
			expect(
				forward.flowMarkers.filter((marker) => marker.pathKind === PATH_KIND.TURNOUT_DIVERGE),
				item.id,
			).toHaveLength(forward.turnoutPathCount);
			expectStableReversedMarkers(forward, reverse, item.id);
		}
	});

	it("compiles every catalog motif in all quarter-turn, side, and flow poses", () => {
		for (const item of RAIL_TEMPLATE_CATALOG) {
			for (const pose of allPoses()) {
				const preview = compileRailTemplatePhysicalPreview(
					item.id as RailTemplateId,
					defaultRailTemplateParameters(item.id),
					pose,
				);
				expect(preview.presentation.source.pathCount, `${item.id}:${preview.key}`).toBeGreaterThan(
					0,
				);
			}
		}
	});

	it("compiles minimum and maximum attached-pattern dimensions on the synthetic support trunk", () => {
		for (const id of ["attached-return", "branch-bypass", "outerbay-link"] as const) {
			const item = RAIL_TEMPLATE_CATALOG.find((candidate) => candidate.id === id);
			expect(item).toBeDefined();
			if (!item) continue;
			for (const boundary of ["minimum", "maximum"] as const) {
				let parameters = defaultRailTemplateParameters(id);
				for (const descriptor of item.parameters) {
					parameters = setRailTemplateParameter(
						id,
						parameters,
						descriptor.key,
						descriptor[boundary],
					);
				}
				for (const pose of allPoses()) {
					const preview = compileRailTemplatePhysicalPreview(id, parameters, pose);
					expect(preview.presentation.source.pathCount, `${id}:${boundary}:${preview.key}`).toBeGreaterThan(
						0,
					);
					expect(preview.turnoutPathCount, `${id}:${boundary}:${preview.key}`).toBeGreaterThanOrEqual(2);
				}
			}
		}
	});

	it("contains invalid preview input instead of throwing through a UI render", () => {
		const mismatched = defaultRailTemplateParameters("long-bay") as RailTemplateParameters;
		expect(
			tryCompileRailTemplatePhysicalPreview("attached-return", mismatched, initialRailTemplatePose()),
		).toBeNull();
	});

	it("validates clearance identity before returning a matching numeric cache entry", () => {
		const parameters = defaultRailTemplateParameters("long-bay");
		const pose = initialRailTemplatePose();
		compileRailTemplatePhysicalPreview("long-bay", parameters, pose);
		const unsupported = Object.freeze({
			...parameters,
			clearanceProfileId: "unsupported-preview-profile",
		}) as unknown as RailTemplateParameters;
		expect(() => compileRailTemplatePhysicalPreview("long-bay", unsupported, pose)).toThrow(
			/unsupported|지원되지 않는/i,
		);
		expect(tryCompileRailTemplatePhysicalPreview("long-bay", unsupported, pose)).toBeNull();
	});

	it("bounds cached typed-array presentations by both entry count and retained bytes", () => {
		const stats = railTemplatePhysicalPreviewCacheStats();
		expect(stats.entryCount).toBeLessThanOrEqual(stats.entryLimit);
		expect(stats.retainedTypedArrayBytes).toBeLessThanOrEqual(stats.typedArrayByteLimit);
		expect(
			railTemplatePhysicalPreviewCacheEvictionCount([
				4 * 1024 * 1024,
				4 * 1024 * 1024,
				1,
			]),
		).toBe(1);
		expect(railTemplatePhysicalPreviewCacheEvictionCount([8 * 1024 * 1024 + 1])).toBe(1);
		expect(railTemplatePhysicalPreviewCacheEvictionCount(new Array(65).fill(1))).toBe(1);
		expect(() => railTemplatePhysicalPreviewCacheEvictionCount([Number.MAX_VALUE])).toThrow(
			/safe integer/i,
		);
	});
});

function allPoses(): readonly RailTemplatePose[] {
	const poses: RailTemplatePose[] = [];
	let rotated = initialRailTemplatePose();
	for (let quarterTurn = 0; quarterTurn < 4; quarterTurn++) {
		for (const side of ["left", "right"] as const) {
			const pose = Object.freeze({ ...rotated, side });
			poses.push(pose, reverseRailTemplateFlow(pose));
		}
		rotated = rotateRailTemplatePose(rotated, 1);
	}
	return Object.freeze(poses);
}

function expectStableReversedMarkers(
	forward: ReturnType<typeof compileRailTemplatePhysicalPreview>,
	reverse: ReturnType<typeof compileRailTemplatePhysicalPreview>,
	label: string,
): void {
	expect(reverse.flowMarkers, label).toHaveLength(forward.flowMarkers.length);
	for (const marker of forward.flowMarkers) {
		const opposite = reverse.flowMarkers.find(
			(candidate) =>
				candidate.pathKind === marker.pathKind &&
				Math.hypot(candidate.x - marker.x, candidate.y - marker.y) < 0.0001,
		);
		expect(opposite, `${label}: missing reverse marker at ${marker.x},${marker.y}`).toBeDefined();
		if (opposite) {
			expect(
				opposite.tangentX * marker.tangentX + opposite.tangentY * marker.tangentY,
				`${label}: marker tangent at ${marker.x},${marker.y}`,
			).toBeLessThan(-0.999);
		}
	}
}
