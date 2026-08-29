import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishedSimulationReadinessSnapshot } from "../compile/SimulationReadinessCertificate";
import type { StaticFabProjectChecks } from "../compile/StaticFabProjectChecks";
import {
	checksumOperationalConfigurationState,
	collectOperationalConfigurationReadinessIssues,
} from "../core/OperationalConfiguration";
import type { RailDocument } from "../core/RailDocument";
import { checksumRailPhysicalLayout } from "../worker/RailPhysicalLayout";
import type { RailWorkerBridgeState } from "../worker/RailWorkerBridge";
import {
	type BoundLiveSimulationReadinessPublication,
	boundLiveSimulationReadinessMatchesSource,
	type LiveSimulationReadinessEligibility,
	liveSimulationReadinessSourceKey,
	resolveLiveSimulationReadinessEligibility,
} from "./LiveSimulationReadiness";
import type { RailEditorStartupModel } from "./RailEditorStartup";
import type { SimulationReadinessBridge } from "./SimulationReadinessBridge";
import type { SimulationReadinessCertificationPhase } from "./SimulationReadinessCertificationCard";

interface LiveSimulationReadinessEditorModel extends RailEditorStartupModel {
	readonly generation: number;
}

export interface LiveSimulationReadinessRuntime {
	readonly model: LiveSimulationReadinessEditorModel;
	readonly worker: RailWorkerBridgeState;
}

export interface UseLiveSimulationReadinessInput {
	readonly railDocument: RailDocument;
	readonly currentStaticChecks: StaticFabProjectChecks | null;
	readonly operationalConfigurationFingerprint: string;
	readonly operationalIssueCount: number;
	readonly getCurrentStaticChecks: () => StaticFabProjectChecks | null;
	readonly getCurrentRuntime: () => LiveSimulationReadinessRuntime;
	readonly setStatus: (message: string) => void;
}

export interface LiveSimulationReadinessView {
	readonly phase: SimulationReadinessCertificationPhase;
	readonly message: string;
	readonly binding: BoundLiveSimulationReadinessPublication | null;
	readonly eligible: boolean;
	readonly canCertify: boolean;
	readonly certify: () => void;
	readonly cancel: () => void;
}

interface LiveSimulationReadinessAttempt {
	readonly phase: "idle" | "preparing" | "certifying" | "error";
	readonly generation: number;
	readonly sourceKey: string | null;
	readonly message: string | null;
}

const INITIAL_ATTEMPT: LiveSimulationReadinessAttempt = Object.freeze({
	phase: "idle",
	generation: 0,
	sourceKey: null,
	message: null,
});

export function useLiveSimulationReadiness({
	railDocument,
	currentStaticChecks,
	operationalConfigurationFingerprint,
	operationalIssueCount,
	getCurrentStaticChecks,
	getCurrentRuntime,
	setStatus,
}: UseLiveSimulationReadinessInput): LiveSimulationReadinessView {
	const controllerRef = useRef<AbortController | null>(null);
	const bridgeRef = useRef<SimulationReadinessBridge | null>(null);
	const publicationRef = useRef<BoundLiveSimulationReadinessPublication | null>(null);
	const generationRef = useRef(0);
	const [attempt, setAttempt] = useState<LiveSimulationReadinessAttempt>(INITIAL_ATTEMPT);

	const release = useCallback((): void => {
		generationRef.current++;
		controllerRef.current?.abort();
		controllerRef.current = null;
		bridgeRef.current?.dispose();
		bridgeRef.current = null;
		publicationRef.current = null;
	}, []);

	useEffect(() => {
		const unsubscribe = railDocument.subscribe(release);
		return () => {
			unsubscribe();
			release();
		};
	}, [railDocument, release]);

	const resolveCurrentEligibility = useCallback(
		(
			checks: StaticFabProjectChecks | null = getCurrentStaticChecks(),
			operationalFacts?: Readonly<{ fingerprint: string; issueCount: number }>,
		): LiveSimulationReadinessEligibility => {
			const { model, worker } = getCurrentRuntime();
			const document = model.document;
			const operationsFingerprint =
				operationalFacts?.fingerprint ??
				checksumOperationalConfigurationState(document.operationalConfiguration);
			const resolvedOperationalIssueCount =
				operationalFacts?.issueCount ??
				collectOperationalConfigurationReadinessIssues(
					document.operationalConfiguration,
					document.portEquipment,
					{
						revision: document.map.getRevision(),
						authoredChecksum: model.authoredChecksum,
					},
				).length;
			return resolveLiveSimulationReadinessEligibility({
				modelGeneration: model.generation,
				patchSequence: document.getPatchSequence(),
				revision: document.map.getRevision(),
				authoredChecksum: model.authoredChecksum,
				railReadinessFingerprint: model.readiness.fingerprint,
				railReadinessReady:
					model.map === document.map && model.readiness.ready && model.readiness.status === "ready",
				operationalConfigurationRevision: document.operationalConfiguration.revision,
				operationalConfigurationFingerprint: operationsFingerprint,
				operationalIssueCount: resolvedOperationalIssueCount,
				nextAdvancedSwitchId: document.map.getAdvancedSwitchIdCursor(),
				nextPortId: document.portEquipment.nextPortId,
				nextEquipmentGroupId: document.portEquipment.nextEquipmentGroupId,
				nextOrganizationId: document.organizations.nextOrganizationId,
				staticChecks: checks,
				worker,
			});
		},
		[getCurrentRuntime, getCurrentStaticChecks],
	);

	const eligibility = resolveCurrentEligibility(currentStaticChecks, {
		fingerprint: operationalConfigurationFingerprint,
		issueCount: operationalIssueCount,
	});
	const sourceKey = eligibility.eligible
		? liveSimulationReadinessSourceKey(eligibility.source)
		: null;
	const binding =
		eligibility.eligible &&
		publicationRef.current &&
		boundLiveSimulationReadinessMatchesSource(publicationRef.current, eligibility.source)
			? publicationRef.current
			: null;
	const ready = binding !== null;
	let phase: SimulationReadinessCertificationPhase;
	let message: string;
	if (ready) {
		phase = "ready";
		message = "The exact current source is certified for the disclosed limited readiness profile.";
	} else if (!eligibility.eligible) {
		phase = "blocked";
		message = eligibility.message;
	} else if (
		attempt.sourceKey === sourceKey &&
		(attempt.phase === "preparing" || attempt.phase === "certifying") &&
		controllerRef.current !== null
	) {
		phase = attempt.phase;
		message = attempt.message ?? "Preparing exact readiness evidence.";
	} else if (attempt.sourceKey === sourceKey && attempt.phase === "error") {
		phase = "error";
		message = attempt.message ?? "Simulation readiness certification failed.";
	} else {
		phase = "eligible";
		message = "Static checks, reviewed operations, and the Rail Worker mirror match this source.";
	}

	const cancel = useCallback((): void => {
		release();
		setAttempt(INITIAL_ATTEMPT);
		setStatus("Simulation readiness 인증을 취소했습니다");
	}, [release, setStatus]);

	const certify = useCallback((): void => {
		const initialEligibility = resolveCurrentEligibility();
		if (!initialEligibility.eligible) {
			setStatus(initialEligibility.message);
			return;
		}
		const source = initialEligibility.source;
		const exactSourceKey = liveSimulationReadinessSourceKey(source);
		release();
		const generation = generationRef.current;
		const controller = new AbortController();
		controllerRef.current = controller;
		setAttempt({
			phase: "preparing",
			generation,
			sourceKey: exactSourceKey,
			message: "Building the immutable static-world and operational component snapshot.",
		});
		setStatus("Simulation readiness exact snapshot을 준비합니다");

		const assertCurrent = (): void => {
			const current = resolveCurrentEligibility();
			if (
				controller.signal.aborted ||
				generationRef.current !== generation ||
				controllerRef.current !== controller ||
				!current.eligible ||
				liveSimulationReadinessSourceKey(current.source) !== exactSourceKey
			) {
				throw new DOMException("Simulation readiness source changed.", "AbortError");
			}
		};

		void waitForPaintOpportunity(controller.signal)
			.then(() =>
				Promise.all([
					import("../compile/SimulationStaticWorldFoundation"),
					import("../compile/SimulationOperationalConfiguration"),
					import("./SimulationReadinessBridge"),
				]),
			)
			.then(([foundationModule, operationalModule, bridgeModule]) => {
				assertCurrent();
				const { model } = getCurrentRuntime();
				const document = model.document;
				const physicalFingerprint = checksumRailPhysicalLayout(model.physical);
				if (physicalFingerprint !== source.physicalFingerprint) {
					throw new Error("Current physical layout does not match the synchronized Rail Worker.");
				}
				const foundation = foundationModule.compileSimulationStaticWorldFoundation({
					patchSequence: source.patchSequence,
					authoredChecksum: source.authoredChecksum,
					physicalFingerprint,
					readiness: model.readiness,
					physical: model.physical,
					portEquipment: document.portEquipment,
				});
				const components =
					operationalModule.compileSimulationReadinessComponentsFromOperationalConfiguration(
						foundation,
						document.portEquipment,
						document.operationalConfiguration,
					);
				assertCurrent();
				setAttempt({
					phase: "certifying",
					generation,
					sourceKey: exactSourceKey,
					message: "The disposable Worker is independently validating every component.",
				});
				const bridge = new bridgeModule.SimulationReadinessBridge();
				bridgeRef.current = bridge;
				return bridge.certify(components, generation, controller.signal);
			})
			.then((published: PublishedSimulationReadinessSnapshot) => {
				assertCurrent();
				const nextBinding = Object.freeze({ source, published });
				if (!boundLiveSimulationReadinessMatchesSource(nextBinding, source)) {
					throw new Error("Published readiness certificate does not match its live source.");
				}
				publicationRef.current = nextBinding;
				controllerRef.current = null;
				setAttempt(INITIAL_ATTEMPT);
				setStatus(
					`Simulation readiness 인증 완료 · ${published.certificate.trackResourceCount.toLocaleString()} resources`,
				);
			})
			.catch((error: unknown) => {
				if (error instanceof DOMException && error.name === "AbortError") return;
				if (generationRef.current !== generation || controllerRef.current !== controller) return;
				const errorMessage =
					error instanceof Error ? error.message : "Simulation readiness certification failed.";
				setAttempt({
					phase: "error",
					generation,
					sourceKey: exactSourceKey,
					message: errorMessage,
				});
				setStatus(errorMessage);
			})
			.finally(() => {
				if (controllerRef.current === controller) controllerRef.current = null;
			});
	}, [getCurrentRuntime, release, resolveCurrentEligibility, setStatus]);

	return {
		phase,
		message,
		binding,
		eligible: eligibility.eligible,
		canCertify: eligibility.eligible && (phase === "eligible" || phase === "error"),
		certify,
		cancel,
	};
}

function waitForPaintOpportunity(signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		let frame = 0;
		const cleanup = (): void => {
			signal.removeEventListener("abort", abort);
			if (frame !== 0) window.cancelAnimationFrame(frame);
		};
		const abort = (): void => {
			cleanup();
			reject(new DOMException("Simulation readiness request cancelled.", "AbortError"));
		};
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener("abort", abort, { once: true });
		frame = window.requestAnimationFrame(() => {
			frame = 0;
			cleanup();
			resolve();
		});
	});
}
