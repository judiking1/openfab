import { describe, expect, it } from "vitest";
import {
	type CompiledAdvancedSwitches,
	validateCompiledAdvancedSwitches,
} from "../compile/AdvancedSwitchCompiler";
import {
	NO_ADVANCED_SWITCH_CATALOG_PROFILE,
	NO_ADVANCED_SWITCH_PROFILE_CLASS,
	NO_ADVANCED_SWITCH_SEGMENT_ORDINAL,
	NO_ADVANCED_SWITCH_SEGMENT_PORT,
	NO_ADVANCED_SWITCH_SEGMENT_ROLE,
	PATH_KIND,
	PHYSICAL_PATH_SOURCE_KIND,
} from "../compile/PhysicalPathCompiler";
import { compilePhysicalPathMigration } from "../compile/PhysicalPathMigration";
import { type CompiledPhysicalLayout, compilePhysicalRail } from "../compile/PhysicalRailCompiler";
import { compileRailEnvelopes } from "../compile/RailClearanceCompiler";
import { compileRailClearance } from "../compile/RailClearanceValidator";
import {
	ADVANCED_SWITCH_ALL_MOVEMENTS,
	type AdvancedSwitchRecord,
	deriveAdvancedSwitchGeometry,
} from "../core/AdvancedSwitch";
import { planAdvancedSwitch } from "../core/AdvancedSwitchPlanner";
import { planRailConstruction } from "../core/paint";
import { RailDocument } from "../core/RailDocument";
import { planRailModule } from "../core/RailModulePlanner";
import {
	DIR_E,
	DIR_S,
	DIR_W,
	type Direction,
	moveCell,
	oppositeDirection,
} from "../core/railShape";
import { encodeRailCell, TileMap } from "../core/TileMap";
import {
	checksumPhysicalPathMigration,
	checksumRailPhysicalLayout,
	checksumRailPhysicalLayoutCooperatively,
	createRailPhysicalDeltaPublication,
	createRailPhysicalResetPublication,
	describeRailPhysicalPublication,
	validateRailAdvancedSwitchContractCooperatively,
	validateRailPhysicalLayoutContractCooperatively,
} from "./RailPhysicalLayout";

describe("RailPhysicalLayout", () => {
	it("fingerprints identical typed layouts deterministically", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		const first = compilePhysicalRail(document.map, 901);
		const second = compilePhysicalRail(document.map, 901);

		expect(checksumRailPhysicalLayout(first)).toBe(checksumRailPhysicalLayout(second));
		const publication = createRailPhysicalResetPublication(first, 73);
		expect(describeRailPhysicalPublication(publication)).toMatchObject({
			physicalPublicationKind: "reset",
			physicalSequence: 73,
			physicalRevision: 901,
			physicalPathCount: first.paths.pathCount,
			physicalPointCount: first.paths.pointCount,
			physicalClearanceEnvelopeCount: first.clearance.envelopes.count,
			physicalClearanceIssueCount: first.clearance.issues.count,
			physicalValid: true,
			previousPhysicalAvailable: false,
			migrationAvailable: false,
		});
	});

	it("cooperatively validates core, envelope, and issue semantics in bounded slices", async () => {
		const layout = clearanceIssueLayout();
		let checkpoints = 0;
		const phases: string[] = [];
		await expect(
			validateRailPhysicalLayoutContractCooperatively(
				layout,
				async () => {
					checkpoints++;
				},
				(phase) => phases.push(phase),
			),
		).resolves.toBeUndefined();
		expect(checkpoints).toBeGreaterThanOrEqual(2);
		expect(phases).toEqual([
			"core",
			"advanced-switch",
			"core-remainder",
			"clearance-offsets",
			"clearance-envelopes",
			"clearance-adjacency-entry-index",
			"clearance-adjacency-exit-index",
			"clearance-adjacency-match",
			"clearance-adjacency-count",
			"clearance-adjacency-populate",
			"clearance-ownership-intervals",
			"clearance-issue-spatial-index",
			"clearance-issue-validation",
		]);

		const envelopeCorruption = structuredClone(layout);
		envelopeCorruption.clearance.envelopes.bounds[0] -= 0.01;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(envelopeCorruption, async () => undefined),
		).rejects.toThrow("differs from derived physical geometry");

		const issueCorruption = structuredClone(layout);
		issueCorruption.clearance.issues.penetrationDepths[0] += 0.01;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(issueCorruption, async () => undefined),
		).rejects.toThrow("differs from derived physical geometry");

		const remapCorruption = structuredClone(layout);
		remapCorruption.pathIntervalRemap.sourceEnds[0] = Number.NaN;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(remapCorruption, async () => undefined),
		).rejects.toThrow("invalid interval metadata");
	});

	it("matches the synchronous signed-int32 clearance chunk-coordinate boundary exactly", async () => {
		const cases = [
			{ startX: -(2 ** 34), endX: -(2 ** 34) + 2_048, accepted: true },
			{ startX: 2 ** 34 - 4_096, endX: 2 ** 34 - 2_048, accepted: true },
			{ startX: -(2 ** 34) - 2_048, endX: -(2 ** 34), accepted: false },
			{ startX: 2 ** 34, endX: 2 ** 34 + 2_048, accepted: false },
		] as const;
		for (const fixture of cases) {
			const layout = singleStraightLayout();
			relocateSingleClearanceSegment(layout, fixture.startX, fixture.endX);
			if (fixture.accepted) {
				layout.clearance = compileRailClearance(
					layout.paths,
					layout.turnoutFootprints,
					layout.advancedSwitches,
				);
				await expect(
					validateRailPhysicalLayoutContractCooperatively(layout, async () => undefined),
				).resolves.toBeUndefined();
				continue;
			}

			const envelopes = compileRailEnvelopes(layout.paths);
			expect(() =>
				compileRailClearance(layout.paths, layout.turnoutFootprints, layout.advancedSwitches),
			).toThrow("chunk coordinates exceed signed int32 capacity");
			layout.clearance = { envelopes, issues: layout.clearance.issues };
			await expect(
				validateRailPhysicalLayoutContractCooperatively(layout, async () => undefined),
			).rejects.toThrow("chunk coordinates exceed signed int32 capacity");
		}
	});

	it("cooperatively accepts turnout, compound, and advanced-switch physical contracts", async () => {
		const turnoutDocument = new RailDocument();
		expect(
			turnoutDocument.commit(
				planRailConstruction(turnoutDocument.map, { x: -3, y: 0 }, { x: 3, y: 0 }),
			),
		).toBe(true);
		expect(
			turnoutDocument.commit(
				planRailConstruction(turnoutDocument.map, { x: 0, y: 0 }, { x: 0, y: 3 }),
			),
		).toBe(true);

		const compoundDocument = new RailDocument();
		expect(
			compoundDocument.commit(
				planRailConstruction(compoundDocument.map, { x: -4, y: 0 }, { x: 0, y: 0 }),
			),
		).toBe(true);
		expect(
			compoundDocument.commit(
				planRailModule(compoundDocument.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact"),
			),
		).toBe(true);

		const switchDocument = new RailDocument();
		expect(
			switchDocument.commit(
				planRailConstruction(switchDocument.map, { x: -3, y: 0 }, { x: 0, y: 0 }),
			),
		).toBe(true);
		const switchPlan = planAdvancedSwitch(switchDocument.map, { x: 0, y: 0 }, { x: 0, y: 2 }, "C");
		expect(switchPlan.valid, switchPlan.reason).toBe(true);
		expect(switchDocument.commit(switchPlan)).toBe(true);

		for (const layout of [
			compilePhysicalRail(turnoutDocument.map),
			compilePhysicalRail(compoundDocument.map),
			compilePhysicalRail(switchDocument.map),
		]) {
			await expect(
				validateRailPhysicalLayoutContractCooperatively(layout, async () => undefined),
			).resolves.toBeUndefined();
		}
	});

	it("preserves advanced-switch corruption diagnostics on the cooperative path", async () => {
		const layout = advancedSwitchLayout();
		const corruptions: readonly {
			readonly mutate: (candidate: CompiledPhysicalLayout) => void;
			readonly message: string;
		}[] = [
			{
				mutate: (candidate) => {
					candidate.advancedSwitches.portCells[0] += 1;
				},
				message: "portCells does not match the geometry derived from switch records",
			},
			{
				mutate: (candidate) => {
					candidate.advancedSwitches.movementPathStarts[0] += 0.00001;
				},
				message: "movementPathStarts does not match the geometry derived from switch records",
			},
			{
				mutate: (candidate) => {
					candidate.advancedSwitches.conflictBounds[0] += 0.00001;
				},
				message: "conflictBounds does not match the geometry derived from switch records",
			},
		];
		for (const { mutate, message } of corruptions) {
			const candidate = structuredClone(layout);
			mutate(candidate);
			const synchronous = validateCompiledAdvancedSwitches(
				candidate.advancedSwitches,
				candidate.paths,
				candidate.pathIntervalRemap,
			);
			expect(synchronous[0]?.message).toBe(message);
			await expect(
				validateRailAdvancedSwitchContractCooperatively(candidate, async () => undefined),
			).rejects.toThrow(message);
		}
	});

	it("checkpoints while validating a switch beside a large unrelated path graph", async () => {
		const layout = padAdvancedSwitchLayoutWithInvalidPaths(advancedSwitchLayout(), 32_768);
		let checkpoints = 0;
		let previousCheckpoint = performance.now();
		let maxSliceMilliseconds = 0;
		await expect(
			validateRailAdvancedSwitchContractCooperatively(layout, async () => {
				const now = performance.now();
				maxSliceMilliseconds = Math.max(maxSliceMilliseconds, now - previousCheckpoint);
				previousCheckpoint = now;
				checkpoints++;
				await Promise.resolve();
			}),
		).resolves.toBeUndefined();
		expect(checkpoints).toBeGreaterThan(700);
		expect(maxSliceMilliseconds).toBeLessThan(50);

		const corrupted = structuredClone(layout);
		corrupted.advancedSwitches.portCells[0] += 1;
		await expect(
			validateRailAdvancedSwitchContractCooperatively(corrupted, async () => undefined),
		).rejects.toThrow("portCells does not match the geometry derived from switch records");
	});

	it("rejects reordered two-switch row blocks on the large cooperative path", async () => {
		const layout = padAdvancedSwitchLayoutWithInvalidPaths(twoAdvancedSwitchLayout(), 32_768);
		reverseTwoAdvancedSwitchRowBlocks(layout.advancedSwitches);
		const message = "ids does not match the geometry derived from switch records";
		const synchronous = validateCompiledAdvancedSwitches(
			layout.advancedSwitches,
			layout.paths,
			layout.pathIntervalRemap,
		);
		expect(synchronous[0]?.message).toBe(message);

		let checkpoints = 0;
		await expect(
			validateRailAdvancedSwitchContractCooperatively(layout, async () => {
				checkpoints++;
			}),
		).rejects.toThrow(message);
		expect(checkpoints).toBeGreaterThan(500);
	});

	it("builds one cooperative turnout endpoint index and retains the lowest path index", async () => {
		const targetPathCount = 8_192;
		const plain = padLayoutToPathCountWithInvalidPaths(straightLayout(), targetPathCount);
		const turnout = padLayoutToPathCountWithInvalidPaths(turnoutLayout(), targetPathCount);
		appendHigherDuplicateTurnoutEndpoint(turnout);
		let plainCheckpoints = 0;
		let turnoutCheckpoints = 0;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(plain, async () => {
				plainCheckpoints++;
			}),
		).resolves.toBeUndefined();
		await expect(
			validateRailPhysicalLayoutContractCooperatively(turnout, async () => {
				turnoutCheckpoints++;
			}),
		).resolves.toBeUndefined();
		expect(turnoutCheckpoints - plainCheckpoints).toBeGreaterThan(targetPathCount / 256);
	});

	it("rejects hostile ingress and egress seam fan-out before adjacency publication", async () => {
		const candidateCount = 4_096;
		const source = straightLayout();
		const targetPathCount = source.paths.pathCount + candidateCount;
		const baseline = padLayoutToPathCountWithInvalidPaths(source, targetPathCount);
		for (const side of ["entry", "exit"] as const) {
			const fanout = structuredClone(baseline);
			appendClearanceSeamCandidates(fanout, candidateCount, side);
			expect(() =>
				compileRailClearance(fanout.paths, fanout.turnoutFootprints, fanout.advancedSwitches),
			).toThrow("directed seam exceeds the canonical 3-path capacity");
			let checkpoints = 0;
			await expect(
				validateRailPhysicalLayoutContractCooperatively(fanout, async () => {
					checkpoints++;
				}),
			).rejects.toThrow("directed seam exceeds the canonical 3-path capacity");
			expect(checkpoints).toBeGreaterThan(candidateCount / 128);
		}

		let cancellationCheckpoints = 0;
		const cancellable = structuredClone(baseline);
		appendClearanceSeamCandidates(cancellable, candidateCount, "entry");
		await expect(
			validateRailPhysicalLayoutContractCooperatively(cancellable, async () => {
				cancellationCheckpoints++;
				throw new Error("fan-out validation cancelled");
			}),
		).rejects.toThrow("fan-out validation cancelled");
		expect(cancellationCheckpoints).toBe(1);
	});

	it("cooperatively copies and coalesces a large real clearance pending set", async () => {
		const layout = subdivideClearanceIssuePaths(clearanceIssueLayout(), 128);
		expect(layout.clearance.issues.testedEnvelopePairs).toBeGreaterThan(10_000);
		let checkpoints = 0;
		let previousCheckpoint = performance.now();
		let maxSliceMilliseconds = 0;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(layout, async () => {
				const now = performance.now();
				maxSliceMilliseconds = Math.max(maxSliceMilliseconds, now - previousCheckpoint);
				previousCheckpoint = now;
				checkpoints++;
				await Promise.resolve();
			}),
		).resolves.toBeUndefined();
		expect(checkpoints).toBeGreaterThan(1_000);
		expect(maxSliceMilliseconds).toBeLessThan(50);
	});

	it("streams forged coincident geometry without retaining all unrelated path pairs", async () => {
		const parity = forgedCoincidentUniqueSeamLayout(32, true);
		expect(parity.clearance.issues.count).toBe((32 * 31) / 2);
		await expect(
			validateRailPhysicalLayoutContractCooperatively(parity, async () => undefined),
		).resolves.toBeUndefined();

		const pathCount = 2_048;
		const bounded = forgedCoincidentUniqueSeamLayout(pathCount, false);
		const quadraticPairCount = (pathCount * (pathCount - 1)) / 2;
		expect(bounded.clearance.issues.candidateEnvelopePairs).toBe(quadraticPairCount);
		let checkpoints = 0;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(bounded, async () => {
				checkpoints++;
				await Promise.resolve();
			}),
		).rejects.toThrow("clearance metadata differs from derived physical geometry");
		expect(checkpoints).toBeGreaterThan(pathCount / 128);
		expect(checkpoints).toBeLessThan(quadraticPairCount / 256);
	});

	it("cooperatively hashes large junction and terminal tables without changing bytes", async () => {
		const source = turnoutLayout();
		const junction = source.junctions[0];
		const terminal = source.terminals[0];
		expect(junction).toBeDefined();
		expect(terminal).toBeDefined();
		const rowCount = 16_384;
		const layout: CompiledPhysicalLayout = {
			...source,
			junctions: new Array(rowCount).fill(junction),
			terminals: new Array(rowCount).fill(terminal),
		};
		const synchronous = checksumRailPhysicalLayout(layout);
		let checkpoints = 0;
		const cooperative = await checksumRailPhysicalLayoutCooperatively(layout, async () => {
			checkpoints++;
		});
		expect(cooperative).toBe(synchronous);
		expect(checkpoints).toBeGreaterThanOrEqual((rowCount * 2) / 128);
	});

	it("rejects an oversized synthetic adjacency span before typed slicing", async () => {
		const layout = twoAdvancedSwitchLayout();
		const paths = layout.paths;
		const pathIndex = paths.sourceKinds.findIndex(
			(sourceKind, index) =>
				sourceKind === PHYSICAL_PATH_SOURCE_KIND.ADVANCED_SWITCH_SEGMENT &&
				(paths.explicitAdjacencyOffsets[index + 1] as number) >
					(paths.explicitAdjacencyOffsets[index] as number),
		);
		expect(pathIndex).toBeGreaterThanOrEqual(0);
		const start = paths.explicitAdjacencyOffsets[pathIndex] as number;
		const end = paths.explicitAdjacencyOffsets[pathIndex + 1] as number;
		const originalTargets = paths.explicitAdjacencyTargets;
		const originalSpan = end - start;
		const oversizedSpan = 4_096;
		const replacement = new Uint32Array(originalTargets.length - originalSpan + oversizedSpan);
		replacement.set(originalTargets.subarray(0, start));
		for (let row = 0; row < oversizedSpan; row++) {
			replacement[start + row] = originalTargets[start + (row % originalSpan)] as number;
		}
		replacement.set(originalTargets.subarray(end), start + oversizedSpan);
		const offsets = paths.explicitAdjacencyOffsets.slice();
		const delta = oversizedSpan - originalSpan;
		for (let offset = pathIndex + 1; offset < offsets.length; offset++) offsets[offset] += delta;
		Object.defineProperty(replacement, "slice", {
			value: () => {
				throw new Error("oversized adjacency must not be sliced");
			},
		});
		paths.explicitAdjacencyOffsets = offsets;
		paths.explicitAdjacencyTargets = replacement;

		await expect(
			validateRailPhysicalLayoutContractCooperatively(layout, async () => undefined),
		).rejects.toThrow("Synthetic physical adjacency differs");
	});

	it("checkpoints every large compound member table", async () => {
		const source = compoundLayout();
		let baselineCheckpoints = 0;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(source, async () => {
				baselineCheckpoints++;
			}),
		).resolves.toBeUndefined();

		const candidate = structuredClone(source);
		const memberCount = 8_192;
		candidate.compoundProfiles.memberPathIndices = new Uint32Array(memberCount);
		candidate.compoundProfiles.memberOffsets = new Uint32Array([0, memberCount]);
		let candidateCheckpoints = 0;
		await expect(
			validateRailPhysicalLayoutContractCooperatively(candidate, async () => {
				candidateCheckpoints++;
			}),
		).resolves.toBeUndefined();
		expect(candidateCheckpoints - baselineCheckpoints).toBeGreaterThan(memberCount / 160);
	});

	it("owns deterministic clearance buffers and rejects corrupted derived data", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const layout = compilePhysicalRail(document.map, 902);
		const baseline = checksumRailPhysicalLayout(layout);
		const envelopeViews = [
			layout.clearance.envelopes.pathOffsets,
			layout.clearance.envelopes.pathIndices,
			layout.clearance.envelopes.pointIndices,
			layout.clearance.envelopes.stationStarts,
			layout.clearance.envelopes.stationEnds,
			layout.clearance.envelopes.startPoints,
			layout.clearance.envelopes.endPoints,
			layout.clearance.envelopes.bounds,
			layout.clearance.envelopes.beamRadiusMillimeters,
			layout.clearance.envelopes.ohtSweepRadiusMillimeters,
			layout.clearance.envelopes.installationRadiusMillimeters,
			layout.clearance.envelopes.approximationToleranceMillimeters,
		] as const;
		for (const view of envelopeViews) {
			expect(view.length).toBeGreaterThan(0);
			const before = view[0] as number;
			view[0] = before + (view instanceof Float32Array ? 0.001 : 1);
			expect(checksumRailPhysicalLayout(layout)).not.toBe(baseline);
			view[0] = before;
			expect(checksumRailPhysicalLayout(layout)).toBe(baseline);
		}

		const profileCorruption = structuredClone(layout);
		(profileCorruption.clearance.envelopes as { profileId: string }).profileId = "UNKNOWN";
		expect(() => createRailPhysicalResetPublication(profileCorruption, 1)).toThrow(
			"not an exact OpenFab catalog version",
		);

		const lengthCorruption = structuredClone(layout);
		(lengthCorruption.clearance.envelopes as unknown as { stationEnds: Float32Array }).stationEnds =
			lengthCorruption.clearance.envelopes.stationEnds.slice(1);
		expect(() => createRailPhysicalResetPublication(lengthCorruption, 1)).toThrow(
			"stationEnds length must equal count",
		);

		const derivedCorruption = structuredClone(layout);
		derivedCorruption.clearance.envelopes.bounds[0] -= 0.01;
		expect(() => createRailPhysicalResetPublication(derivedCorruption, 1)).toThrow(
			"bounds differ from derived physical geometry",
		);

		const sourceGeometryCorruption = structuredClone(layout);
		sourceGeometryCorruption.paths.positions[0] = Number.NaN;
		expect(() => createRailPhysicalResetPublication(sourceGeometryCorruption, 1)).toThrow(
			"non-finite clearance geometry",
		);

		const issueCorruption = structuredClone(layout);
		(issueCorruption.clearance.issues as { count: number }).count = 1;
		expect(() => createRailPhysicalResetPublication(issueCorruption, 1)).toThrow(
			"issue codes length must equal count",
		);
	});

	it("rejects coherently recomputed clearance when turnout ownership is corrupted", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 3, y: 0 }, { x: -3, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 3 }, { x: 0, y: 0 })),
		).toBe(true);
		const corrupted = structuredClone(compilePhysicalRail(document.map));
		expect(corrupted.turnoutFootprints.count).toBe(1);
		const ownedPaths = new Set(corrupted.turnoutFootprints.pathIndices);
		const unrelatedPath = Array.from(
			{ length: corrupted.paths.pathCount },
			(_, index) => index,
		).find((pathIndex) => !ownedPaths.has(pathIndex));
		expect(unrelatedPath).toBeDefined();
		corrupted.turnoutFootprints.pathIndices[0] = unrelatedPath as number;
		corrupted.clearance = compileRailClearance(
			corrupted.paths,
			corrupted.turnoutFootprints,
			corrupted.advancedSwitches,
		);

		expect(() => createRailPhysicalResetPublication(corrupted, 1)).toThrow(
			"path ownership differs from its junction",
		);
	});

	it("fingerprints and validates every interval-exact turnout clearance buffer", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 3, y: 0 })),
		).toBe(true);
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 0, y: 3 })),
		).toBe(true);
		const layout = compilePhysicalRail(document.map, 904);
		const turnouts = layout.turnoutFootprints;
		expect(turnouts.clearancePathIndices).toHaveLength(5);
		const baseline = checksumRailPhysicalLayout(layout);
		for (const view of [
			turnouts.clearancePathOffsets,
			turnouts.clearancePathIndices,
			turnouts.clearancePathStarts,
			turnouts.clearancePathEnds,
		]) {
			const before = view[0] as number;
			view[0] = before + (view instanceof Float32Array ? 0.001 : 1);
			expect(checksumRailPhysicalLayout(layout)).not.toBe(baseline);
			view[0] = before;
			expect(checksumRailPhysicalLayout(layout)).toBe(baseline);
		}

		const corruptions: Array<(candidate: CompiledPhysicalLayout) => void> = [
			(candidate) => {
				const offsets = candidate.turnoutFootprints.clearancePathOffsets;
				offsets[offsets.length - 1] = (offsets[offsets.length - 1] as number) - 1;
			},
			(candidate) => {
				candidate.turnoutFootprints.clearancePathIndices[0] = candidate.paths.pathCount;
			},
			(candidate) => {
				candidate.turnoutFootprints.clearancePathStarts[0] = Number.NaN;
			},
			(candidate) => {
				candidate.turnoutFootprints.clearancePathStarts[0] = -0.01;
			},
			(candidate) => {
				candidate.turnoutFootprints.clearancePathEnds[0] =
					(candidate.turnoutFootprints.clearancePathStarts[0] as number) - 0.01;
			},
			(candidate) => {
				const pathIndex = candidate.turnoutFootprints.clearancePathIndices[0] as number;
				candidate.turnoutFootprints.clearancePathEnds[0] =
					(candidate.paths.lengths[pathIndex] as number) + 0.01;
			},
		];
		for (const corrupt of corruptions) {
			const candidate = structuredClone(layout);
			corrupt(candidate);
			expect(() => createRailPhysicalResetPublication(candidate, 1)).toThrow();
		}

		const coherentlyRecomputed = structuredClone(layout);
		coherentlyRecomputed.turnoutFootprints.clearancePathStarts[0] += 0.01;
		coherentlyRecomputed.clearance = compileRailClearance(
			coherentlyRecomputed.paths,
			coherentlyRecomputed.turnoutFootprints,
			coherentlyRecomputed.advancedSwitches,
		);
		expect(() => createRailPhysicalResetPublication(coherentlyRecomputed, 1)).toThrow(
			"clearance ownership differs from its junction",
		);
	});

	it("fingerprints and reconstructs every populated clearance issue buffer", () => {
		const layout = clearanceIssueLayout();
		expect(layout.clearance.issues.count).toBe(1);
		expect(() => createRailPhysicalResetPublication(layout, 1)).not.toThrow();
		const baseline = checksumRailPhysicalLayout(layout);
		const issueViews = [
			layout.clearance.issues.codes,
			layout.clearance.issues.relations,
			layout.clearance.issues.firstPathIndices,
			layout.clearance.issues.secondPathIndices,
			layout.clearance.issues.firstPathIdentities,
			layout.clearance.issues.secondPathIdentities,
			layout.clearance.issues.firstEnvelopeIndices,
			layout.clearance.issues.secondEnvelopeIndices,
			layout.clearance.issues.firstStations,
			layout.clearance.issues.secondStations,
			layout.clearance.issues.contactPoints,
			layout.clearance.issues.centerlineDistances,
			layout.clearance.issues.requiredClearances,
			layout.clearance.issues.penetrationDepths,
			layout.clearance.issues.cells,
		] as const;
		for (const view of issueViews) {
			const before = view[0] as number;
			view[0] = before + (view instanceof Float32Array ? 0.001 : 1);
			expect(checksumRailPhysicalLayout(layout)).not.toBe(baseline);
			view[0] = before;
			expect(checksumRailPhysicalLayout(layout)).toBe(baseline);
		}

		const scalarMutations: readonly [() => void, () => void][] = [
			[
				() => ((layout.clearance.envelopes as { profileId: string }).profileId += "_changed"),
				() =>
					((layout.clearance.envelopes as { profileId: string }).profileId =
						"OPENFAB_COMPACT_AMHS_CLEARANCE_V1"),
			],
			[
				() => (layout.clearance.envelopes as { profileVersion: number }).profileVersion++,
				() => (layout.clearance.envelopes as { profileVersion: number }).profileVersion--,
			],
			[
				() => (layout.clearance.envelopes as { count: number }).count++,
				() => (layout.clearance.envelopes as { count: number }).count--,
			],
			[
				() => (layout.clearance.issues as { count: number }).count++,
				() => (layout.clearance.issues as { count: number }).count--,
			],
			[
				() =>
					(layout.clearance.issues as { candidateEnvelopePairs: number }).candidateEnvelopePairs++,
				() =>
					(layout.clearance.issues as { candidateEnvelopePairs: number }).candidateEnvelopePairs--,
			],
			[
				() => (layout.clearance.issues as { testedEnvelopePairs: number }).testedEnvelopePairs++,
				() => (layout.clearance.issues as { testedEnvelopePairs: number }).testedEnvelopePairs--,
			],
		];
		for (const [mutate, restore] of scalarMutations) {
			mutate();
			expect(checksumRailPhysicalLayout(layout)).not.toBe(baseline);
			restore();
			expect(checksumRailPhysicalLayout(layout)).toBe(baseline);
		}

		const valueCorruption = structuredClone(layout);
		valueCorruption.clearance.issues.penetrationDepths[0] += 0.01;
		expect(() => createRailPhysicalResetPublication(valueCorruption, 1)).toThrow(
			"issue penetrations differ from derived physical geometry",
		);

		const typeCorruption = structuredClone(layout);
		(typeCorruption.clearance.issues as unknown as { codes: Uint16Array }).codes = new Uint16Array(
			typeCorruption.clearance.issues.codes,
		);
		expect(() => createRailPhysicalResetPublication(typeCorruption, 1)).toThrow(
			"issue codes differ from derived physical geometry",
		);
	});

	it("covers compound profile and interval-remap buffers in the fingerprint", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: -4, y: 0 }, { x: 0, y: 0 })),
		).toBe(true);
		expect(
			document.commit(
				planRailModule(document.map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact"),
			),
		).toBe(true);
		const layout = compilePhysicalRail(document.map);
		const baseline = checksumRailPhysicalLayout(layout);

		expect(layout.compoundProfiles.count).toBe(1);
		expect(layout.pathIntervalRemap.count).toBeGreaterThan(layout.paths.pathCount);
		layout.compoundProfiles.compiledLeadInMillimeters[0] += 1;
		expect(checksumRailPhysicalLayout(layout)).not.toBe(baseline);
		layout.compoundProfiles.compiledLeadInMillimeters[0] -= 1;
		layout.pathIntervalRemap.targetEnds[0] += 0.001;
		expect(checksumRailPhysicalLayout(layout)).not.toBe(baseline);
	});

	it("binds migration fingerprints to both retained physical layouts", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const previousLayout = compilePhysicalRail(document.map, document.map.getRevision());
		const previousPublication = createRailPhysicalResetPublication(previousLayout, 11);
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 3 })),
		).toBe(true);
		const nextLayout = compilePhysicalRail(document.map, document.map.getRevision());
		const migration = compilePhysicalPathMigration(previousLayout, nextLayout);
		const publication = createRailPhysicalDeltaPublication(
			previousPublication.current,
			nextLayout,
			12,
			migration,
		);
		const state = describeRailPhysicalPublication(publication);

		expect(state).toMatchObject({
			physicalPublicationKind: "delta",
			physicalSequence: 12,
			previousPhysicalAvailable: true,
			previousPhysicalSequence: 11,
			migrationAvailable: true,
			migrationFromSequence: 11,
			migrationToSequence: 12,
			migrationSourcePathCount: previousLayout.paths.pathCount,
			migrationTargetPathCount: nextLayout.paths.pathCount,
		});
		expect(state.migrationFromFingerprint).toBe(state.previousPhysicalFingerprint);
		expect(state.migrationToFingerprint).toBe(state.physicalFingerprint);
		const baseline = checksumPhysicalPathMigration(
			migration,
			publication.previous.identity,
			publication.current.identity,
		);
		migration.endpointErrors[0] += 0.001;
		expect(
			checksumPhysicalPathMigration(
				migration,
				publication.previous.identity,
				publication.current.identity,
			),
		).not.toBe(baseline);
	});

	it("rejects a delta when retained worker buffers no longer match their identity", () => {
		const document = new RailDocument();
		expect(
			document.commit(planRailConstruction(document.map, { x: 0, y: 0 }, { x: 4, y: 0 })),
		).toBe(true);
		const previousLayout = compilePhysicalRail(document.map, document.map.getRevision());
		const previous = createRailPhysicalResetPublication(previousLayout, 20).current;
		expect(
			document.commit(planRailConstruction(document.map, { x: 4, y: 0 }, { x: 4, y: 3 })),
		).toBe(true);
		const nextLayout = compilePhysicalRail(document.map, document.map.getRevision());
		const migration = compilePhysicalPathMigration(previousLayout, nextLayout);
		previous.buffers.paths.positions[0] += 0.001;

		expect(() => createRailPhysicalDeltaPublication(previous, nextLayout, 21, migration)).toThrow(
			"identity no longer matches",
		);

		const clearancePreviousLayout = compilePhysicalRail(document.map, document.map.getRevision());
		const clearancePrevious = createRailPhysicalResetPublication(
			clearancePreviousLayout,
			30,
		).current;
		clearancePrevious.buffers.clearance.envelopes.bounds[0] -= 0.001;
		expect(() =>
			createRailPhysicalDeltaPublication(
				clearancePrevious,
				clearancePreviousLayout,
				31,
				compilePhysicalPathMigration(clearancePreviousLayout, clearancePreviousLayout),
			),
		).toThrow("identity no longer matches");
	});
});

function clearanceIssueLayout(): CompiledPhysicalLayout {
	const map = new TileMap();
	const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
	map.setEncoded(0, 0, straight);
	map.setEncoded(0, 1, straight);
	const layout = compilePhysicalRail(map, 903);
	const shiftedPath = [...layout.paths.cells].findIndex(
		(value, index) => index % 2 === 1 && value === 1,
	);
	const pathIndex = (shiftedPath - 1) / 2;
	for (
		let pointIndex = layout.paths.offsets[pathIndex] as number;
		pointIndex < (layout.paths.offsets[pathIndex + 1] as number);
		pointIndex++
	) {
		layout.paths.positions[pointIndex * 2 + 1] -= 0.2;
	}
	layout.paths.bounds[pathIndex * 4 + 1] -= 0.2;
	layout.paths.bounds[pathIndex * 4 + 3] -= 0.2;
	layout.clearance = compileRailClearance(
		layout.paths,
		layout.turnoutFootprints,
		layout.advancedSwitches,
	);
	return layout;
}

function subdivideClearanceIssuePaths(
	source: CompiledPhysicalLayout,
	segmentCount: number,
): CompiledPhysicalLayout {
	const layout = structuredClone(source);
	const paths = layout.paths;
	const sourceOffsets = paths.offsets;
	const sourcePositions = paths.positions;
	const sourceTangents = paths.tangents;
	const pointCount = paths.pathCount * (segmentCount + 1);
	const positions = new Float32Array(pointCount * 2);
	const tangents = new Float32Array(pointCount * 2);
	const distances = new Float32Array(pointCount);
	const offsets = new Uint32Array(paths.pathCount + 1);
	let write = 0;
	for (let pathIndex = 0; pathIndex < paths.pathCount; pathIndex++) {
		offsets[pathIndex] = write;
		const sourceStart = sourceOffsets[pathIndex] as number;
		const sourceEnd = (sourceOffsets[pathIndex + 1] as number) - 1;
		const x0 = sourcePositions[sourceStart * 2] as number;
		const y0 = sourcePositions[sourceStart * 2 + 1] as number;
		const x1 = sourcePositions[sourceEnd * 2] as number;
		const y1 = sourcePositions[sourceEnd * 2 + 1] as number;
		const tangentX = sourceTangents[sourceStart * 2] as number;
		const tangentY = sourceTangents[sourceStart * 2 + 1] as number;
		for (let point = 0; point <= segmentCount; point++) {
			const amount = point / segmentCount;
			positions[write * 2] = x0 + (x1 - x0) * amount;
			positions[write * 2 + 1] = y0 + (y1 - y0) * amount;
			tangents[write * 2] = tangentX;
			tangents[write * 2 + 1] = tangentY;
			distances[write] = (paths.lengths[pathIndex] as number) * amount;
			write++;
		}
	}
	offsets[paths.pathCount] = write;
	paths.positions = positions;
	paths.tangents = tangents;
	paths.distances = distances;
	paths.offsets = offsets;
	paths.pointCount = pointCount;
	layout.clearance = compileRailClearance(paths, layout.turnoutFootprints, layout.advancedSwitches);
	return layout;
}

function advancedSwitchLayout(): CompiledPhysicalLayout {
	const document = new RailDocument();
	expect(document.commit(planRailConstruction(document.map, { x: -3, y: 0 }, { x: 0, y: 0 }))).toBe(
		true,
	);
	const plan = planAdvancedSwitch(document.map, { x: 0, y: 0 }, { x: 0, y: 2 }, "C");
	expect(plan.valid, plan.reason).toBe(true);
	expect(document.commit(plan)).toBe(true);
	return compilePhysicalRail(document.map);
}

function twoAdvancedSwitchLayout(): CompiledPhysicalLayout {
	const map = new TileMap();
	for (const record of [advancedSwitchRecord(1, 0), advancedSwitchRecord(2, 64)]) {
		for (const cell of deriveAdvancedSwitchGeometry(record).cellStates) {
			map.setEncoded(cell.x, cell.y, cell.encoded);
		}
		expect(map.setAdvancedSwitch(record)).toBe(true);
	}
	const layout = compilePhysicalRail(map);
	expect(layout.diagnostics).toEqual([]);
	expect(layout.advancedSwitches.count).toBe(2);
	return layout;
}

function advancedSwitchRecord(id: number, x: number): AdvancedSwitchRecord {
	return {
		id,
		profileClass: "C",
		origin: { x, y: 0 },
		forward: DIR_E,
		lateral: DIR_S,
		movementMask: ADVANCED_SWITCH_ALL_MOVEMENTS,
	};
}

function straightLayout(): CompiledPhysicalLayout {
	const map = new TileMap();
	const plan = planRailConstruction(map, { x: -3, y: 0 }, { x: 3, y: 0 });
	expect(plan.valid, plan.reason).toBe(true);
	expect(map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? [])).toBe(true);
	return compilePhysicalRail(map);
}

function singleStraightLayout(): CompiledPhysicalLayout {
	const map = new TileMap();
	map.setEncoded(0, 0, encodeRailCell({ incoming: DIR_W, outgoing: DIR_E }));
	const layout = compilePhysicalRail(map);
	expect(layout.paths.pathCount).toBe(1);
	return layout;
}

function relocateSingleClearanceSegment(
	layout: CompiledPhysicalLayout,
	startX: number,
	endX: number,
): void {
	const pointStart = layout.paths.offsets[0] as number;
	const pointEnd = layout.paths.offsets[1] as number;
	expect(pointEnd - pointStart).toBe(2);
	layout.paths.positions[pointStart * 2] = startX;
	layout.paths.positions[(pointStart + 1) * 2] = endX;
}

function forgedCoincidentUniqueSeamLayout(
	pathCount: number,
	compileIssues: boolean,
): CompiledPhysicalLayout {
	const map = new TileMap();
	const straight = encodeRailCell({ incoming: DIR_W, outgoing: DIR_E });
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		map.setEncoded(pathIndex * 4, 0, straight);
	}
	const layout = compilePhysicalRail(map);
	expect(layout.paths.pathCount).toBe(pathCount);
	for (let pathIndex = 0; pathIndex < pathCount; pathIndex++) {
		const pointStart = layout.paths.offsets[pathIndex] as number;
		const pointEnd = layout.paths.offsets[pathIndex + 1] as number;
		expect(pointEnd - pointStart).toBe(2);
		layout.paths.positions[pointStart * 2] = 0;
		layout.paths.positions[pointStart * 2 + 1] = 0.5;
		layout.paths.positions[(pointStart + 1) * 2] = 1;
		layout.paths.positions[(pointStart + 1) * 2 + 1] = 0.5;
	}
	if (compileIssues) {
		layout.clearance = compileRailClearance(
			layout.paths,
			layout.turnoutFootprints,
			layout.advancedSwitches,
		);
		return layout;
	}
	const pairCount = (pathCount * (pathCount - 1)) / 2;
	layout.clearance = {
		envelopes: compileRailEnvelopes(layout.paths),
		issues: {
			...layout.clearance.issues,
			candidateEnvelopePairs: pairCount,
			testedEnvelopePairs: pairCount,
		},
	};
	return layout;
}

function turnoutLayout(): CompiledPhysicalLayout {
	const map = new TileMap();
	for (const plan of [planRailConstruction(map, { x: -3, y: 0 }, { x: 3, y: 0 })]) {
		expect(plan.valid, plan.reason).toBe(true);
		expect(map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? [])).toBe(true);
	}
	const branch = planRailConstruction(map, { x: 0, y: 0 }, { x: 0, y: 3 });
	expect(branch.valid, branch.reason).toBe(true);
	expect(map.applyAtomicMutations(branch.mutations, branch.switchMutations ?? [])).toBe(true);
	const layout = compilePhysicalRail(map);
	expect(layout.turnoutFootprints.count).toBe(1);
	return layout;
}

function compoundLayout(): CompiledPhysicalLayout {
	const map = new TileMap();
	const lead = planRailConstruction(map, { x: -4, y: 0 }, { x: 0, y: 0 });
	expect(lead.valid, lead.reason).toBe(true);
	expect(map.applyAtomicMutations(lead.mutations, lead.switchMutations ?? [])).toBe(true);
	const module = planRailModule(map, { x: 0, y: 0 }, { x: 0, y: 3 }, "shift", "compact");
	expect(module.valid, module.reason).toBe(true);
	expect(map.applyAtomicMutations(module.mutations, module.switchMutations ?? [])).toBe(true);
	const layout = compilePhysicalRail(map);
	expect(layout.compoundProfiles.count).toBe(1);
	return layout;
}

type NumericTypedArray = Uint8Array | Uint16Array | Uint32Array | Int32Array | Float32Array;

function copyTypedRows<T extends NumericTypedArray>(values: T, length: number): T {
	const Constructor = values.constructor as { new (length: number): T };
	const result = new Constructor(length);
	result.set(values);
	return result;
}

function padLayoutToPathCountWithInvalidPaths(
	source: CompiledPhysicalLayout,
	targetPathCount: number,
): CompiledPhysicalLayout {
	const layout = structuredClone(source);
	const paths = layout.paths;
	const originalCount = paths.pathCount;
	expect(targetPathCount).toBeGreaterThanOrEqual(originalCount);
	paths.kinds = copyTypedRows(paths.kinds, targetPathCount);
	paths.kinds.fill(PATH_KIND.INVALID, originalCount);
	paths.fromDirections = copyTypedRows(paths.fromDirections, targetPathCount);
	paths.toDirections = copyTypedRows(paths.toDirections, targetPathCount);
	paths.lengths = copyTypedRows(paths.lengths, targetPathCount);
	paths.startInsets = copyTypedRows(paths.startInsets, targetPathCount);
	paths.endInsets = copyTypedRows(paths.endInsets, targetPathCount);
	paths.startExtensions = copyTypedRows(paths.startExtensions, targetPathCount);
	paths.endExtensions = copyTypedRows(paths.endExtensions, targetPathCount);
	paths.sourceKinds = copyTypedRows(paths.sourceKinds, targetPathCount);
	paths.sourceKinds.fill(PHYSICAL_PATH_SOURCE_KIND.CARDINAL_CELL, originalCount);
	paths.advancedSwitchIds = copyTypedRows(paths.advancedSwitchIds, targetPathCount);
	paths.advancedSwitchProfileClasses = copyTypedRows(
		paths.advancedSwitchProfileClasses,
		targetPathCount,
	);
	paths.advancedSwitchProfileClasses.fill(NO_ADVANCED_SWITCH_PROFILE_CLASS, originalCount);
	paths.advancedSwitchSegmentRoles = copyTypedRows(
		paths.advancedSwitchSegmentRoles,
		targetPathCount,
	);
	paths.advancedSwitchSegmentRoles.fill(NO_ADVANCED_SWITCH_SEGMENT_ROLE, originalCount);
	paths.advancedSwitchSegmentPorts = copyTypedRows(
		paths.advancedSwitchSegmentPorts,
		targetPathCount,
	);
	paths.advancedSwitchSegmentPorts.fill(NO_ADVANCED_SWITCH_SEGMENT_PORT, originalCount);
	paths.advancedSwitchSegmentOrdinals = copyTypedRows(
		paths.advancedSwitchSegmentOrdinals,
		targetPathCount,
	);
	paths.advancedSwitchSegmentOrdinals.fill(NO_ADVANCED_SWITCH_SEGMENT_ORDINAL, originalCount);
	paths.advancedSwitchCatalogProfiles = copyTypedRows(
		paths.advancedSwitchCatalogProfiles,
		targetPathCount,
	);
	paths.advancedSwitchCatalogProfiles.fill(NO_ADVANCED_SWITCH_CATALOG_PROFILE, originalCount);
	paths.cells = copyTypedRows(paths.cells, targetPathCount * 2);
	paths.exitCells = copyTypedRows(paths.exitCells, targetPathCount * 2);
	paths.bounds = copyTypedRows(paths.bounds, targetPathCount * 4);
	paths.offsets = copyTypedRows(paths.offsets, targetPathCount + 1);
	paths.offsets.fill(paths.pointCount, originalCount + 1);
	paths.coverageOffsets = copyTypedRows(paths.coverageOffsets, targetPathCount + 1);
	paths.coverageOffsets.fill(paths.coverageCells.length / 2, originalCount + 1);
	paths.sharedSegmentOffsets = copyTypedRows(paths.sharedSegmentOffsets, targetPathCount + 1);
	paths.sharedSegmentOffsets.fill(paths.sharedSegmentIds.length, originalCount + 1);
	paths.explicitAdjacencyOffsets = copyTypedRows(
		paths.explicitAdjacencyOffsets,
		targetPathCount + 1,
	);
	paths.explicitAdjacencyOffsets.fill(paths.explicitAdjacencyTargets.length, originalCount + 1);
	paths.pathCount = targetPathCount;
	layout.clearance = compileRailClearance(paths, layout.turnoutFootprints, layout.advancedSwitches);
	return layout;
}

function appendHigherDuplicateTurnoutEndpoint(layout: CompiledPhysicalLayout): void {
	const turnout = layout.junctions[0];
	expect(turnout).toBeDefined();
	const sourcePathIndex = [...layout.turnoutFootprints.clearancePathIndices].find(
		(pathIndex) => pathIndex !== turnout?.trunkPathIndex && pathIndex !== turnout?.divergePathIndex,
	);
	expect(sourcePathIndex).toBeDefined();
	const paths = layout.paths;
	const duplicatePathIndex = paths.pathCount - 1;
	expect(duplicatePathIndex).toBeGreaterThan(sourcePathIndex as number);
	paths.kinds[duplicatePathIndex] = paths.kinds[sourcePathIndex as number] as number;
	paths.fromDirections[duplicatePathIndex] = paths.fromDirections[
		sourcePathIndex as number
	] as number;
	paths.toDirections[duplicatePathIndex] = paths.toDirections[sourcePathIndex as number] as number;
	paths.cells[duplicatePathIndex * 2] = paths.cells[(sourcePathIndex as number) * 2] as number;
	paths.cells[duplicatePathIndex * 2 + 1] = paths.cells[
		(sourcePathIndex as number) * 2 + 1
	] as number;
	paths.exitCells[duplicatePathIndex * 2] = paths.exitCells[
		(sourcePathIndex as number) * 2
	] as number;
	paths.exitCells[duplicatePathIndex * 2 + 1] = paths.exitCells[
		(sourcePathIndex as number) * 2 + 1
	] as number;
}

function appendClearanceSeamCandidates(
	layout: CompiledPhysicalLayout,
	candidateCount: number,
	side: "entry" | "exit",
): void {
	const paths = layout.paths;
	const originalCount = paths.pathCount - candidateCount;
	const sourcePathIndex = paths.toDirections.findIndex(
		(to, pathIndex) => pathIndex < originalCount && to !== 0,
	);
	expect(sourcePathIndex).toBeGreaterThanOrEqual(0);
	const to = paths.toDirections[sourcePathIndex] as Direction;
	const next = moveCell(
		{
			x: paths.exitCells[sourcePathIndex * 2] as number,
			y: paths.exitCells[sourcePathIndex * 2 + 1] as number,
		},
		to,
	);
	for (let pathIndex = originalCount; pathIndex < paths.pathCount; pathIndex++) {
		paths.kinds[pathIndex] = PATH_KIND.TERMINAL;
		if (side === "entry") {
			paths.cells[pathIndex * 2] = next.x;
			paths.cells[pathIndex * 2 + 1] = next.y;
			paths.exitCells[pathIndex * 2] = next.x;
			paths.exitCells[pathIndex * 2 + 1] = next.y;
			paths.fromDirections[pathIndex] = oppositeDirection(to);
		} else {
			paths.exitCells[pathIndex * 2] = paths.exitCells[sourcePathIndex * 2] as number;
			paths.exitCells[pathIndex * 2 + 1] = paths.exitCells[sourcePathIndex * 2 + 1] as number;
			paths.toDirections[pathIndex] = to;
		}
	}
}

function reverseTwoAdvancedSwitchRowBlocks(switches: CompiledAdvancedSwitches): void {
	expect(switches.count).toBe(2);
	for (const [values, width] of [
		[switches.ids, 1],
		[switches.profileClasses, 1],
		[switches.origins, 2],
		[switches.forwardDirections, 1],
		[switches.lateralDirections, 1],
		[switches.movementMasks, 1],
		[switches.mergeAnchors, 2],
		[switches.branchAnchors, 2],
		[switches.sharedThroatCells, 2],
		[switches.sharedThroatLengthsMeters, 1],
		[switches.sharedSupportLengthsMeters, 1],
		[switches.mergeSharedLeadMeters, 1],
		[switches.clearTrunkMeters, 1],
		[switches.branchSharedLeadMeters, 1],
		[switches.conflictZoneIds, 1],
		[switches.conflictZoneLengthsMeters, 1],
		[switches.conflictBounds, 4],
		[switches.bounds, 4],
	] as const) {
		swapEqualAdjacentBlocks(values, 0, width, width * 2);
	}

	swapSwitchCsrPayload(switches.portOffsets, switches.portRoles);
	swapSwitchCsrPayload(switches.portOffsets, switches.portLocalIndices);
	swapSwitchCsrPayload(switches.portOffsets, switches.portCells, 2);
	swapSwitchCsrPayload(switches.portOffsets, switches.portDirections);
	swapSwitchCsrPayload(switches.portOffsets, switches.portPathIndices);
	swapSwitchCsrPayload(switches.portOffsets, switches.portPathStations);
	swapSwitchCsrPayload(switches.movementOffsets, switches.movementInputIndices);
	swapSwitchCsrPayload(switches.movementOffsets, switches.movementOutputIndices);
	swapNestedMovementPayload(switches, switches.movementPathOffsets, switches.movementPathIndices);
	swapNestedMovementPayload(switches, switches.movementPathOffsets, switches.movementPathStarts);
	swapNestedMovementPayload(switches, switches.movementPathOffsets, switches.movementPathEnds);
	swapMovementConflictReferences(switches);
	swapSwitchCsrPayload(switches.claimedOffsets, switches.claimedCells, 2);
	swapSwitchCsrPayload(switches.reservedOffsets, switches.reservedCells, 2);
	swapSwitchCsrPayload(switches.conflictPathOffsets, switches.conflictPathIndices);
	swapSwitchCsrPayload(switches.conflictPathOffsets, switches.conflictPathStarts);
	swapSwitchCsrPayload(switches.conflictPathOffsets, switches.conflictPathEnds);
	swapSwitchCsrPayload(switches.conflictPathOffsets, switches.conflictIntervalKinds);
	swapSwitchCsrPayload(switches.conflictPathOffsets, switches.conflictRouteIndices);
}

function swapSwitchCsrPayload(offsets: Uint32Array, values: NumericTypedArray, width = 1): void {
	expect(offsets).toHaveLength(3);
	swapEqualAdjacentBlocks(
		values,
		(offsets[0] as number) * width,
		(offsets[1] as number) * width,
		(offsets[2] as number) * width,
	);
}

function swapNestedMovementPayload(
	switches: CompiledAdvancedSwitches,
	offsets: Uint32Array,
	values: NumericTypedArray,
): void {
	const movementMiddle = switches.movementOffsets[1] as number;
	const movementEnd = switches.movementOffsets[2] as number;
	for (let movement = 0; movement < movementMiddle; movement++) {
		expect((offsets[movement + 1] as number) - (offsets[movement] as number)).toBe(
			(offsets[movementMiddle + movement + 1] as number) -
				(offsets[movementMiddle + movement] as number),
		);
	}
	swapEqualAdjacentBlocks(
		values,
		offsets[0] as number,
		offsets[movementMiddle] as number,
		offsets[movementEnd] as number,
	);
}

function swapMovementConflictReferences(switches: CompiledAdvancedSwitches): void {
	const movementMiddle = switches.movementOffsets[1] as number;
	const movementEnd = switches.movementOffsets[2] as number;
	const offsets = switches.movementConflictOffsets;
	for (let movement = 0; movement < movementMiddle; movement++) {
		expect((offsets[movement + 1] as number) - (offsets[movement] as number)).toBe(
			(offsets[movementMiddle + movement + 1] as number) -
				(offsets[movementMiddle + movement] as number),
		);
	}
	const start = offsets[0] as number;
	const middle = offsets[movementMiddle] as number;
	const end = offsets[movementEnd] as number;
	expect(middle - start).toBe(end - middle);
	const first = switches.movementConflictIntervalIndices.slice(start, middle);
	const second = switches.movementConflictIntervalIndices.slice(middle, end);
	const conflictMiddle = switches.conflictPathOffsets[1] as number;
	const conflictEnd = switches.conflictPathOffsets[2] as number;
	expect(conflictMiddle).toBe(conflictEnd - conflictMiddle);
	for (let index = 0; index < second.length; index++) {
		switches.movementConflictIntervalIndices[start + index] =
			(second[index] as number) - conflictMiddle;
	}
	for (let index = 0; index < first.length; index++) {
		switches.movementConflictIntervalIndices[middle + index] =
			(first[index] as number) + conflictMiddle;
	}
}

function swapEqualAdjacentBlocks(
	values: NumericTypedArray,
	start: number,
	middle: number,
	end: number,
): void {
	expect(middle - start).toBe(end - middle);
	const first = values.slice(start, middle);
	values.copyWithin(start, middle, end);
	values.set(first, middle);
}

function padAdvancedSwitchLayoutWithInvalidPaths(
	source: CompiledPhysicalLayout,
	padding: number,
): CompiledPhysicalLayout {
	const layout = structuredClone(source);
	const paths = layout.paths;
	const originalCount = paths.pathCount;
	const paddedCount = originalCount + padding;
	const copyRows = <T extends Uint8Array | Uint32Array | Int32Array | Float32Array>(
		values: T,
		length: number,
	): T => {
		const Constructor = values.constructor as {
			new (length: number): T;
		};
		const result = new Constructor(length);
		result.set(values);
		return result;
	};
	paths.kinds = copyRows(paths.kinds, paddedCount);
	paths.kinds.fill(PATH_KIND.INVALID, originalCount);
	paths.fromDirections = copyRows(paths.fromDirections, paddedCount);
	paths.toDirections = copyRows(paths.toDirections, paddedCount);
	paths.lengths = copyRows(paths.lengths, paddedCount);
	paths.cells = copyRows(paths.cells, paddedCount * 2);
	paths.exitCells = copyRows(paths.exitCells, paddedCount * 2);
	paths.offsets = copyRows(paths.offsets, paddedCount + 1);
	paths.offsets.fill(paths.pointCount, originalCount + 1);
	paths.coverageOffsets = copyRows(paths.coverageOffsets, paddedCount + 1);
	paths.coverageOffsets.fill(paths.coverageCells.length / 2, originalCount + 1);
	paths.explicitAdjacencyOffsets = copyRows(paths.explicitAdjacencyOffsets, paddedCount + 1);
	paths.explicitAdjacencyOffsets.fill(paths.explicitAdjacencyTargets.length, originalCount + 1);
	paths.pathCount = paddedCount;
	return layout;
}
