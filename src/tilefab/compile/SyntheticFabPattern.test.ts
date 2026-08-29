import { describe, expect, it } from "vitest";
import { analyzeRailNetwork } from "../core/network";
import {
	initialRailAreaStampPose,
	planRailAreaStamp,
	reverseRailAreaStampFlow,
	rotateRailAreaStampPose,
} from "../core/RailAreaStamp";
import { RailDocument } from "../core/RailDocument";
import { compilePhysicalRail } from "./PhysicalRailCompiler";
import { buildSyntheticFabPattern, SYNTHETIC_FAB_PATTERN_CATALOG } from "./SyntheticFabPattern";
import {
	defaultSyntheticFabStarterRequest,
	SYNTHETIC_FAB_STARTER_CATALOG,
	type SyntheticFabStarterId,
	type SyntheticFabStarterRequest,
	setSyntheticFabStarterParameter,
} from "./SyntheticFabStarter";

describe("SyntheticFabPattern", () => {
	it("publishes only placeable non-empty definitions in catalog order", () => {
		expect(SYNTHETIC_FAB_PATTERN_CATALOG.map((item) => item.id)).toEqual([
			"bay-assembly",
			"bay-bank",
		]);
		expect(SYNTHETIC_FAB_PATTERN_CATALOG[0]).toMatchObject({
			label: "BAY ASSEMBLY",
			title: expect.stringMatching(/외곽 순환.*두 개의 긴 Process Loop/),
		});
	});

	it("converts every non-empty synthetic definition into an ordinary closed area stamp", () => {
		for (const item of SYNTHETIC_FAB_PATTERN_CATALOG) {
			const pattern = buildSyntheticFabPattern(defaultSyntheticFabStarterRequest(item.id));

			expect(pattern.selection.ownerships.length, item.id).toBeGreaterThan(0);
			expect(pattern.template.sourceEdgeCount, item.id).toBe(pattern.starter.analysis.edges);
			expect(pattern.template.sourceWidthMeters, item.id).toBe(
				pattern.starter.summary.bounds?.widthMeters,
			);
			expect(pattern.template.sourceHeightMeters, item.id).toBe(
				pattern.starter.summary.bounds?.heightMeters,
			);
		}
	});

	it("places each pattern through one ordinary atomic rail command", () => {
		for (const item of SYNTHETIC_FAB_PATTERN_CATALOG) {
			const pattern = buildSyntheticFabPattern(defaultSyntheticFabStarterRequest(item.id));
			const target = new RailDocument();
			const events: Array<{ kind: string; changes: number }> = [];
			target.subscribe((event) => events.push({ kind: event.kind, changes: event.changes.length }));
			const plan = planRailAreaStamp(
				target.map,
				pattern.template,
				{ x: 200, y: 160 },
				initialRailAreaStampPose(),
			);

			expect(plan.valid, `${item.id}: ${plan.reason}`).toBe(true);
			expect(target.commit(plan), item.id).toBe(true);
			expect(events, item.id).toEqual([{ kind: "build", changes: plan.mutations.length }]);
			expect(analyzeRailNetwork(target.map), item.id).toMatchObject({
				components: pattern.starter.analysis.components,
				strongComponents: pattern.starter.analysis.strongComponents,
				openEnds: 0,
			});
			expect(compilePhysicalRail(target.map), item.id).toMatchObject({
				valid: true,
				diagnostics: [],
			});
			expect(target.undo(), item.id).toBe(true);
			expect(target.map.size, item.id).toBe(0);
			expect(target.redo(), item.id).toBe(true);
			expect(target.map.size, item.id).toBe(pattern.starter.document.map.size);
		}
	});

	it("converts every exposed min/default/max configuration through every cardinal pose", () => {
		let configurations = 0;
		for (const item of SYNTHETIC_FAB_PATTERN_CATALOG) {
			for (const request of starterParameterMatrix(item.id)) {
				const pattern = buildSyntheticFabPattern(request);
				expect(pattern.template.sourceEdgeCount).toBe(pattern.starter.analysis.edges);
				for (let quarterTurn = 0; quarterTurn < 4; quarterTurn++) {
					let pose = initialRailAreaStampPose();
					for (let rotation = 0; rotation < quarterTurn; rotation++) {
						pose = rotateRailAreaStampPose(pose, 1);
					}
					for (const candidate of [pose, reverseRailAreaStampFlow(pose)]) {
						const target = new RailDocument();
						const plan = planRailAreaStamp(
							target.map,
							pattern.template,
							{ x: 500, y: 500 },
							candidate,
						);
						expect(
							plan.valid,
							`${item.id}:${JSON.stringify(request.parameters)}:${quarterTurn}:${candidate.reverseFlow} · ${plan.reason}`,
						).toBe(true);
					}
				}
				configurations++;
			}
		}
		expect(configurations).toBe(18);
	}, 10_000);

	it("supports repeated placement while rejecting an exact duplicate", () => {
		const pattern = buildSyntheticFabPattern(defaultSyntheticFabStarterRequest("single-loop"));
		const target = new RailDocument();
		const pose = initialRailAreaStampPose();
		const first = planRailAreaStamp(target.map, pattern.template, { x: 0, y: 0 }, pose);
		expect(first.valid, first.reason).toBe(true);
		expect(target.commit(first)).toBe(true);

		const overlap = planRailAreaStamp(target.map, pattern.template, { x: 0, y: 0 }, pose);
		expect(overlap).toMatchObject({
			valid: false,
			issueCode: "duplicate",
		});

		const second = planRailAreaStamp(target.map, pattern.template, { x: 0, y: 40 }, pose);
		expect(second.valid, second.reason).toBe(true);
		expect(target.commit(second)).toBe(true);
		expect(analyzeRailNetwork(target.map)).toMatchObject({
			components: 2,
			strongComponents: 2,
			openEnds: 0,
		});
		expect(target.getPatchSequence()).toBe(2);
	});

	it("rejects the empty-grid project starter as a current-map pattern", () => {
		expect(() => buildSyntheticFabPattern(defaultSyntheticFabStarterRequest("blank"))).toThrow(
			/빈 격자/,
		);
	});

	it("keeps the complete factory example in project starters instead of repeatable FAB blocks", () => {
		expect(SYNTHETIC_FAB_PATTERN_CATALOG.some((item) => item.id === "complete-fab")).toBe(false);
		expect(SYNTHETIC_FAB_PATTERN_CATALOG.some((item) => item.id === "large-fab-60")).toBe(false);
		expect(SYNTHETIC_FAB_PATTERN_CATALOG.some((item) => item.id === "production-fab-60")).toBe(
			false,
		);
		expect(() =>
			buildSyntheticFabPattern(defaultSyntheticFabStarterRequest("complete-fab")),
		).toThrow(/새 프로젝트 Factory Starter/);
		expect(() =>
			buildSyntheticFabPattern(defaultSyntheticFabStarterRequest("large-fab-60")),
		).toThrow(/새 프로젝트 Factory Starter/);
		expect(() =>
			buildSyntheticFabPattern(defaultSyntheticFabStarterRequest("production-fab-60")),
		).toThrow(/새 프로젝트 Factory Starter/);
	});
});

function starterParameterMatrix(id: SyntheticFabStarterId): SyntheticFabStarterRequest[] {
	const item = SYNTHETIC_FAB_STARTER_CATALOG.find((candidate) => candidate.id === id);
	if (!item) throw new Error(`Missing synthetic FAB starter ${id}.`);
	if (id === "bay-bank") {
		const initial = defaultSyntheticFabStarterRequest(id);
		return [
			initial,
			...item.parameters.flatMap((descriptor) => [
				setSyntheticFabStarterParameter(initial, descriptor.key, descriptor.minimum),
				setSyntheticFabStarterParameter(initial, descriptor.key, descriptor.maximum),
			]),
		];
	}
	let requests = [defaultSyntheticFabStarterRequest(id)];
	for (const descriptor of item.parameters) {
		const expanded: SyntheticFabStarterRequest[] = [];
		for (const request of requests) {
			for (const value of new Set([
				descriptor.minimum,
				request.parameters[descriptor.key],
				descriptor.maximum,
			])) {
				expanded.push(setSyntheticFabStarterParameter(request, descriptor.key, value));
			}
		}
		requests = expanded;
	}
	return requests;
}
