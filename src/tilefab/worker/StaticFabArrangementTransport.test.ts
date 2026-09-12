import { describe, expect, it } from "vitest";
import {
	isIssuedStaticFabArrangementPlan,
	staticFabArrangementPlanFingerprint,
} from "../core/StaticFabArrangementCertification";
import {
	remapStaticFabAssemblyRelationshipRecord,
	staticFabAssemblyRelationshipTransitionFootprint,
} from "../core/StaticFabAssemblyRelationship";
import { createStaticFabArrangementColumnCapture } from "./StaticFabArrangementColumnCapture";
import { STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS } from "./StaticFabArrangementResponseValidator";
import {
	arrangementRelationshipTestRecord,
	validPreparedArrangement,
} from "./StaticFabArrangementTestFixture";
import {
	decodeStaticFabArrangementTransport,
	encodeStaticFabArrangementTransport,
} from "./StaticFabArrangementTransport";
import { collectTransferableBuffers } from "./TransferableBuffers";

const checkpoint = async () => {};
function movement() {
	const wire = structuredClone(encodeStaticFabArrangementTransport(validPreparedArrangement()));
	if (wire.kind !== "movement") throw new Error("Expected movement");
	return wire;
}

describe("Arrangement movement transport", () => {
	it("retains Arrangement's larger Port budget instead of the Bundle addition limit", async () => {
		const source = validPreparedArrangement();
		const original = source.plan?.portMutations[0];
		if (!source.plan?.arrangement || !source.ticket || !original?.before || !original.after)
			throw new Error("Missing Port fixture");
		const before = original.before;
		const after = original.after;
		const count = 4_097;
		const portMutations = Array.from({ length: count }, (_, index) => ({
			id: index + 1,
			before: { ...before, id: index + 1, barcode: null },
			after: { ...after, id: index + 1, barcode: null },
		}));
		const plan = {
			...source.plan,
			portMutations,
			arrangement: { ...source.plan.arrangement, portCount: count },
		};
		const prepared = {
			...source,
			plan,
			ticket: {
				...source.ticket,
				sourceNextPortId: count + 1,
				prospectiveNextPortId: count + 1,
				planFingerprint: staticFabArrangementPlanFingerprint(plan),
			},
		};
		const decoded = await decodeStaticFabArrangementTransport(
			encodeStaticFabArrangementTransport(prepared),
			checkpoint,
		);
		expect(decoded.plan?.portMutations).toEqual(portMutations);
		expect(decoded.ticket).toEqual(prepared.ticket);
	});

	it("cooperatively restores both sides of an exact 65,536-reference relationship", async () => {
		const source = validPreparedArrangement();
		if (!source.plan || !source.ticket) throw new Error("Missing fixture plan");
		const before = arrangementRelationshipTestRecord(65_528);
		const after = remapStaticFabAssemblyRelationshipRecord(before, {
			relationshipId: before.id,
			organizationIds: new Map([
				[1, 1],
				[2, 2],
			]),
			quarterTurns: 0,
			offset: { x: 0, y: -10 },
		});
		const mutation = { id: before.id, before, after };
		expect(
			staticFabAssemblyRelationshipTransitionFootprint([{ ...mutation, before: null }])
				.edgeReferenceCount,
		).toBe(65_536);
		const plan = {
			...source.plan,
			nextRelationshipIdBefore: 2,
			nextRelationshipIdAfter: 2,
			relationshipMutations: [mutation],
		};
		const prepared = {
			...source,
			plan,
			ticket: {
				...source.ticket,
				sourceNextRelationshipId: 2,
				prospectiveNextRelationshipId: 2,
				planFingerprint: staticFabArrangementPlanFingerprint(plan),
			},
		};
		const wire = encodeStaticFabArrangementTransport(prepared);
		let checkpoints = 0;
		let last = performance.now();
		let maximum = 0;
		const decoded = await decodeStaticFabArrangementTransport(wire, async () => {
			const now = performance.now();
			maximum = Math.max(maximum, now - last);
			last = now;
			checkpoints++;
		});
		expect(decoded.ticket?.planFingerprint).toBe(prepared.ticket.planFingerprint);
		expect(decoded.plan?.relationshipMutations).toEqual([mutation]);
		expect(checkpoints).toBeGreaterThan(65_536 / 64);
		expect(maximum).toBeLessThan(50);
		if (wire.kind !== "movement") throw new Error("Expected movement");
		const late = wire.columns.relationships.after.edgeCoordinates;
		late[late.length - 1] = (late[late.length - 1] ?? 0) + 1;
		await expect(decodeStaticFabArrangementTransport(wire, checkpoint)).rejects.toThrow();
	});

	it("round-trips existing switch/Port/organization records and exact ticket without issuing authority", async () => {
		const source = validPreparedArrangement();
		const wire = encodeStaticFabArrangementTransport(source);
		const transfer = collectTransferableBuffers(wire);
		const received = structuredClone(wire, { transfer });
		const decoded = await decodeStaticFabArrangementTransport(received, checkpoint);
		expect(decoded).toEqual(source);
		expect(transfer.every((buffer) => buffer.byteLength === 0)).toBe(true);
		expect(source.plan?.mutations.length).toBeGreaterThan(0);
		expect(decoded.plan && isIssuedStaticFabArrangementPlan(decoded.plan)).toBe(false);
		expect(Object.isFrozen(decoded.plan?.portMutations[0]?.after?.route)).toBe(true);
	});

	it.each([
		["wrong type", () => new Float64Array(8)],
		["shared", () => new Int32Array(new SharedArrayBuffer(32))],
		["partial", () => new Int32Array(new ArrayBuffer(36), 4, 8)],
		["oversized", () => new Int32Array(STATIC_FAB_ARRANGEMENT_MAX_PLAN_CELLS + 1)],
	])("rejects %s columns before yielding", async (_name, column) => {
		const wire = movement();
		Object.assign(wire.columns.cells, { xs: column() });
		let yields = 0;
		await expect(
			decodeStaticFabArrangementTransport(wire, async () => {
				yields++;
			}),
		).rejects.toThrow("column type or length bounds");
		expect(yields).toBe(0);
	});

	it("rejects aliases across both sides and domains", async () => {
		const wire = movement();
		Object.assign(wire.columns.ports.after, { routeXs: wire.columns.ports.before.routeXs });
		await expect(decodeStaticFabArrangementTransport(wire, checkpoint)).rejects.toThrow("aliases");
	});

	it("rejects malformed offsets, unknown Port route and cursor or fingerprint forgery", async () => {
		for (const corrupt of [
			(wire: ReturnType<typeof movement>) => {
				wire.columns.organizations.before.railEdgeOffsets[1] = 99;
			},
			(wire: ReturnType<typeof movement>) => {
				wire.columns.ports.after.routeKinds[0] = 255;
			},
			(wire: ReturnType<typeof movement>) => {
				Object.assign(wire.prepared.ticket ?? {}, { prospectiveNextPortId: 99 });
			},
			(wire: ReturnType<typeof movement>) => {
				wire.columns.rail.after[0] = 0;
			},
		]) {
			const wire = movement();
			corrupt(wire);
			await expect(decodeStaticFabArrangementTransport(wire, checkpoint)).rejects.toThrow();
		}
	});

	it("captures headers and every column reference before the first await", async () => {
		const wire = movement();
		const expected = validPreparedArrangement();
		let first = true;
		const decoded = await decodeStaticFabArrangementTransport(wire, async () => {
			if (!first) return;
			first = false;
			Object.assign(wire.prepared, { reason: "replaced", plan: null, ticket: null });
			Object.assign(wire.columns, { organizations: null, relationships: null });
		});
		expect(decoded).toEqual(expected);
	});

	it("rejects late changed bytes and text without returning a plan", async () => {
		for (const corrupt of [
			(wire: ReturnType<typeof movement>) => {
				wire.columns.rail.xs[0] = 9999;
			},
			(wire: ReturnType<typeof movement>) => {
				Object.assign(wire.columns.organizations.before.names, { 0: "x".repeat(121) });
			},
		]) {
			const wire = movement();
			let first = true;
			await expect(
				decodeStaticFabArrangementTransport(
					wire,
					async () => {
						if (first) {
							first = false;
							corrupt(wire);
						}
					},
					1,
				),
			).rejects.toThrow();
		}
	});

	it("rejects accessor and sparse header data without executing the getter", async () => {
		const wire = movement();
		let called = false;
		Object.defineProperty(wire.prepared, "reason", {
			get() {
				called = true;
				return "value";
			},
		});
		await expect(decodeStaticFabArrangementTransport(wire, checkpoint)).rejects.toThrow(
			"plain data",
		);
		expect(called).toBe(false);
		const sparse = movement();
		Object.assign(sparse.prepared.plan, { organizationImpactAuthorizations: new Array(1) });
		await expect(decodeStaticFabArrangementTransport(sparse, checkpoint)).rejects.toThrow(
			"dense data",
		);
	});

	it("honors cancellation at every actual checkpoint including final completion", async () => {
		let total = 0;
		await decodeStaticFabArrangementTransport(
			movement(),
			async () => {
				total++;
			},
			64,
		);
		expect(total).toBeGreaterThan(10);
		for (let stop = 1; stop <= total; stop++) {
			let count = 0;
			await expect(
				decodeStaticFabArrangementTransport(
					movement(),
					async () => {
						if (++count === stop) throw new Error("cancelled");
					},
					64,
				),
			).rejects.toThrow("cancelled");
		}
	});

	it("keeps compact rejection bounded and cannot accept a success graph as compact", async () => {
		const rejected = {
			...validPreparedArrangement(),
			valid: false,
			plan: null,
			ticket: null,
			failureCode: "plan" as const,
		};
		const encoded = encodeStaticFabArrangementTransport(rejected);
		expect(await decodeStaticFabArrangementTransport(encoded, checkpoint)).toEqual(rejected);
		await expect(
			decodeStaticFabArrangementTransport({ ...movement(), kind: "compact" }, checkpoint),
		).rejects.toThrow("cannot authorize");
	});

	it("captures rail columns beyond the unrelated Bundle limit and detects late detachment", () => {
		const wire = movement();
		const count = 65_537;
		Object.assign(wire.columns, {
			cells: { xs: new Int32Array(count), ys: new Int32Array(count) },
		});
		const capture = createStaticFabArrangementColumnCapture(wire.columns);
		while (!capture.done) capture.step(64);
		expect(capture.finish().cells.xs).toHaveLength(count);
		const late = createStaticFabArrangementColumnCapture(wire.columns);
		late.step(3);
		const buffer = wire.columns.cells.xs.buffer;
		if (!(buffer instanceof ArrayBuffer)) throw new Error("Expected transferable buffer");
		structuredClone(buffer, { transfer: [buffer] });
		expect(() => late.step(1)).toThrow("buffer changed");
		expect(() => late.finish()).toThrow("buffer changed");
	});
});
