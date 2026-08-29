import { describe, expect, it } from "vitest";
import {
	resolveStaticFabSelectionArrangementRoots,
	staticFabArrangementCommandFromRoots,
} from "../compile/StaticFabArrangementRoots";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import { STATIC_FAB_ARRANGEMENT_SESSION_VERSION } from "../worker/StaticFabArrangementProtocol";
import {
	initializeStaticFabArrangementRuntimeSession,
	prepareStaticFabArrangementInSession,
} from "../worker/StaticFabArrangementRuntime";
import { emptyPortEquipmentState, type PortEquipmentState } from "./EquipmentGroup";
import { planRailConstruction } from "./paint";
import { createRailAreaSelectionFromOwnerships } from "./RailAreaSelection";
import { buildRailModuleOwnershipIndex, type RailModuleOwnership } from "./RailModuleOwnership";
import {
	adoptStaticFabArrangementWorkerPlan,
	consumeCertifiedStaticFabArrangementPlanIssuedFor,
	isIssuedStaticFabArrangementPlan,
	isStaticFabArrangementPlanIssuedFor,
	issueStaticFabArrangementPermit,
	revokeStaticFabArrangementPermit,
	type StaticFabArrangementPermit,
	staticFabArrangementPlanFingerprint,
} from "./StaticFabArrangementCertification";
import {
	STATIC_FAB_ARRANGEMENT_COMMAND_VERSION,
	type StaticFabArrangementCommandIntent,
	staticFabArrangementCommandFingerprint,
} from "./StaticFabArrangementCommand";
import {
	emptyStaticFabOrganizationState,
	type StaticFabOrganizationState,
} from "./StaticFabOrganization";
import { createStaticFabSelection } from "./StaticFabSelection";
import { type Cell, TileMap } from "./TileMap";

describe("StaticFabArrangementCertification", () => {
	it("adopts and consumes one exact Worker plan once for the bound authored identities", () => {
		const proof = workerProof();
		const workerPlan = structuredClone(proof.plan);
		const workerTicket = structuredClone(proof.ticket);

		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				structuredClone(proof.permit) as StaticFabArrangementPermit,
				workerTicket,
				workerPlan,
				workerTicket.prospectiveChecksum,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.patchSequence,
				proof.fixture.organizations,
				proof.fixture.intent,
			),
		).toThrow(/missing|consumed/i);

		const adopted = adoptStaticFabArrangementWorkerPlan(
			proof.permit,
			workerTicket,
			workerPlan,
			workerTicket.prospectiveChecksum,
			proof.fixture.map,
			proof.fixture.portEquipment,
			proof.fixture.patchSequence,
			proof.fixture.organizations,
			proof.fixture.intent,
		);

		expect(adopted).toEqual(workerPlan);
		expect(adopted).not.toBe(workerPlan);
		expect(isIssuedStaticFabArrangementPlan(workerPlan)).toBe(false);
		expect(isIssuedStaticFabArrangementPlan(adopted)).toBe(true);
		expect(
			isStaticFabArrangementPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabArrangementPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(true);
		expect(
			consumeCertifiedStaticFabArrangementPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(false);
		expect(isIssuedStaticFabArrangementPlan(adopted)).toBe(false);
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				proof.permit,
				workerTicket,
				workerPlan,
				workerTicket.prospectiveChecksum,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.patchSequence,
				proof.fixture.organizations,
				proof.fixture.intent,
			),
		).toThrow(/missing|consumed/i);
	});

	it("consumes the permit when checksum, plan, or intent fingerprints are tampered", () => {
		const checksumProof = workerProof();
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				checksumProof.permit,
				checksumProof.ticket,
				checksumProof.plan,
				`${checksumProof.ticket.prospectiveChecksum}:tampered`,
				checksumProof.fixture.map,
				checksumProof.fixture.portEquipment,
				checksumProof.fixture.patchSequence,
				checksumProof.fixture.organizations,
				checksumProof.fixture.intent,
			),
		).toThrow(/ticket|permit/i);
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				checksumProof.permit,
				checksumProof.ticket,
				checksumProof.plan,
				checksumProof.ticket.prospectiveChecksum,
				checksumProof.fixture.map,
				checksumProof.fixture.portEquipment,
				checksumProof.fixture.patchSequence,
				checksumProof.fixture.organizations,
				checksumProof.fixture.intent,
			),
		).toThrow(/missing|consumed/i);

		const planProof = workerProof();
		const tamperedPlan = structuredClone(planProof.plan);
		const mutation = tamperedPlan.mutations[0] as { after: number } | undefined;
		if (!mutation) throw new Error("Expected a moving arrangement mutation.");
		mutation.after ^= 1;

		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				planProof.permit,
				planProof.ticket,
				tamperedPlan,
				planProof.ticket.prospectiveChecksum,
				planProof.fixture.map,
				planProof.fixture.portEquipment,
				planProof.fixture.patchSequence,
				planProof.fixture.organizations,
				planProof.fixture.intent,
			),
		).toThrow(/fingerprint diverged/i);
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				planProof.permit,
				planProof.ticket,
				planProof.plan,
				planProof.ticket.prospectiveChecksum,
				planProof.fixture.map,
				planProof.fixture.portEquipment,
				planProof.fixture.patchSequence,
				planProof.fixture.organizations,
				planProof.fixture.intent,
			),
		).toThrow(/missing|consumed/i);

		const intentProof = workerProof();
		const changedIntent: StaticFabArrangementCommandIntent = {
			...intentProof.fixture.intent,
			mode: "ALIGN_MAX",
		};
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				intentProof.permit,
				intentProof.ticket,
				intentProof.plan,
				intentProof.ticket.prospectiveChecksum,
				intentProof.fixture.map,
				intentProof.fixture.portEquipment,
				intentProof.fixture.patchSequence,
				intentProof.fixture.organizations,
				changedIntent,
			),
		).toThrow(/no longer matches/i);
	});

	it("deep-copies the Worker graph so later transport-buffer mutation cannot change certification", () => {
		const proof = workerProof();
		const workerPlan = structuredClone(proof.plan);
		const adopted = adoptStaticFabArrangementWorkerPlan(
			proof.permit,
			proof.ticket,
			workerPlan,
			proof.ticket.prospectiveChecksum,
			proof.fixture.map,
			proof.fixture.portEquipment,
			proof.fixture.patchSequence,
			proof.fixture.organizations,
			proof.fixture.intent,
		);
		const certifiedFingerprint = staticFabArrangementPlanFingerprint(adopted);
		const adoptedCellX = adopted.cells[0]?.x;
		const adoptedMutationAfter = adopted.mutations[0]?.after;
		const adoptedTargetMinZ = adopted.arrangement?.translations[0]?.after.minZ;

		const workerCell = workerPlan.cells[0] as { x: number } | undefined;
		const workerMutation = workerPlan.mutations[0] as { after: number } | undefined;
		const workerTranslations = workerPlan.arrangement?.translations;
		const workerTranslation = workerTranslations?.[0] as { after: { minZ: number } } | undefined;
		if (!workerCell || !workerMutation || !workerTranslations || !workerTranslation) {
			throw new Error("Expected a populated arrangement plan.");
		}
		workerCell.x += 1_000;
		workerMutation.after ^= 1;
		workerTranslation.after.minZ += 1_000;

		expect(adopted.cells).not.toBe(workerPlan.cells);
		expect(adopted.mutations).not.toBe(workerPlan.mutations);
		expect(adopted.arrangement?.translations).not.toBe(workerTranslations);
		expect(adopted.cells[0]?.x).toBe(adoptedCellX);
		expect(adopted.mutations[0]?.after).toBe(adoptedMutationAfter);
		expect(adopted.arrangement?.translations[0]?.after.minZ).toBe(adoptedTargetMinZ);
		expect(staticFabArrangementPlanFingerprint(adopted)).toBe(certifiedFingerprint);
		expect(
			consumeCertifiedStaticFabArrangementPlanIssuedFor(
				adopted,
				proof.fixture.map,
				proof.fixture.portEquipment,
				proof.fixture.organizations,
			),
		).toBe(true);
	});

	it("revocation and live-source drift invalidate their one-shot permits", () => {
		const revoked = workerProof();
		revokeStaticFabArrangementPermit(revoked.permit);
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				revoked.permit,
				revoked.ticket,
				revoked.plan,
				revoked.ticket.prospectiveChecksum,
				revoked.fixture.map,
				revoked.fixture.portEquipment,
				revoked.fixture.patchSequence,
				revoked.fixture.organizations,
				revoked.fixture.intent,
			),
		).toThrow(/missing|consumed/i);

		const stale = workerProof();
		addLine(stale.fixture.map, { x: -20, y: -20 }, { x: -16, y: -20 });
		expect(() =>
			adoptStaticFabArrangementWorkerPlan(
				stale.permit,
				stale.ticket,
				stale.plan,
				stale.ticket.prospectiveChecksum,
				stale.fixture.map,
				stale.fixture.portEquipment,
				stale.fixture.patchSequence,
				stale.fixture.organizations,
				stale.fixture.intent,
			),
		).toThrow(/no longer matches/i);
	});
});

interface CertificationFixture {
	readonly map: TileMap;
	readonly portEquipment: PortEquipmentState;
	readonly organizations: StaticFabOrganizationState;
	readonly patchSequence: number;
	readonly intent: StaticFabArrangementCommandIntent;
	readonly snapshot: ReturnType<typeof captureRailMirrorSnapshot>["snapshot"];
}

function workerProof() {
	const fixture = certificationFixture();
	const permit = issueStaticFabArrangementPermit(
		fixture.map,
		fixture.portEquipment,
		fixture.patchSequence,
		fixture.organizations,
		fixture.intent,
		fixture.snapshot.checksum,
	);
	const session = initializeStaticFabArrangementRuntimeSession(fixture.snapshot).session;
	const prepared = prepareStaticFabArrangementInSession(session, {
		type: "PREPARE_STATIC_FAB_ARRANGEMENT",
		version: STATIC_FAB_ARRANGEMENT_SESSION_VERSION,
		sessionId: 1,
		requestId: permit.ticketId,
		ticketId: permit.ticketId,
		intent: fixture.intent,
		expectedIntentFingerprint: staticFabArrangementCommandFingerprint(fixture.intent),
	}).prepared;
	if (!prepared.valid || !prepared.plan || !prepared.ticket) {
		throw new Error(`Expected exact Worker proof: ${prepared.reason}`);
	}
	return {
		fixture,
		permit,
		plan: prepared.plan,
		ticket: prepared.ticket,
	};
}

function certificationFixture(): CertificationFixture {
	const map = new TileMap();
	addLine(map, { x: 0, y: 0 }, { x: 8, y: 0 });
	addLine(map, { x: 20, y: 10 }, { x: 28, y: 10 });
	const portEquipment = emptyPortEquipmentState();
	const organizations = emptyStaticFabOrganizationState();
	const patchSequence = 23;
	const ownership = buildRailModuleOwnershipIndex(map);
	const intent = arrangementIntent(map, ownership.modules, portEquipment, patchSequence);
	const snapshot = captureRailMirrorSnapshot(
		map,
		patchSequence,
		portEquipment,
		organizations,
	).snapshot;
	return { map, portEquipment, organizations, patchSequence, intent, snapshot };
}

function arrangementIntent(
	map: TileMap,
	modules: readonly RailModuleOwnership[],
	portEquipment: PortEquipmentState,
	patchSequence: number,
): StaticFabArrangementCommandIntent {
	const ownership = buildRailModuleOwnershipIndex(map);
	const rail = createRailAreaSelectionFromOwnerships(ownership, modules, "fully-contained");
	const selection = createStaticFabSelection(rail, portEquipment, patchSequence, []);
	const resolution = resolveStaticFabSelectionArrangementRoots(
		map,
		ownership,
		portEquipment,
		patchSequence,
		selection,
	);
	if (!resolution.valid) throw new Error(resolution.reason);
	const intent = staticFabArrangementCommandFromRoots("Z", "ALIGN_MIN", resolution.roots);
	if (intent.version !== STATIC_FAB_ARRANGEMENT_COMMAND_VERSION) {
		throw new Error("Unexpected arrangement command version.");
	}
	return intent;
}

function addLine(map: TileMap, start: Cell, end: Cell): void {
	const plan = planRailConstruction(new TileMap(), start, end);
	if (!plan.valid) throw new Error(plan.reason);
	map.applyAtomicMutations(plan.mutations, plan.switchMutations ?? []);
}
