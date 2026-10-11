import { useEffect, useRef, useState } from "react";
import type {
	StaticFabAisleIntegrationOption,
	StaticFabAisleIntegrationPlan,
} from "../core/StaticFabAisleIntegration";
import {
	deriveStaticFabOrganizationSemanticRoles,
	type StaticFabOrganizationRecord,
} from "../core/StaticFabOrganization";
import type { RailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import {
	StaticFabAisleIntegrationBridge,
	type StaticFabAisleIntegrationLiveSource,
} from "./StaticFabAisleIntegrationBridge";

export interface AisleIntegrationSession {
	readonly aisle: StaticFabOrganizationRecord;
	readonly bays: readonly StaticFabOrganizationRecord[];
	readonly bayId: number | null;
	readonly options: readonly StaticFabAisleIntegrationOption[];
	readonly optionId: string;
	readonly phase: "choosing" | "searching" | "reviewing" | "ready" | "rejected";
	readonly reason: string;
	readonly plan: StaticFabAisleIntegrationPlan | null;
}
interface Input {
	readonly getSource: () => StaticFabAisleIntegrationLiveSource;
	readonly captureSnapshot: (signal: AbortSignal) => Promise<RailMirrorSnapshot>;
	readonly ready: () => boolean;
	readonly onCommitted: (aisle: StaticFabOrganizationRecord) => void;
}
export function useStaticFabAisleIntegration(input: Input) {
	const callbacks = useRef(input);
	callbacks.current = input;
	const [session, setSession] = useState<AisleIntegrationSession | null>(null);
	const current = useRef<AisleIntegrationSession | null>(null);
	const source = useRef<StaticFabAisleIntegrationLiveSource | null>(null);
	const bridge = useRef<StaticFabAisleIntegrationBridge | null>(null);
	const controller = useRef<AbortController | null>(null);
	const request = useRef(0);
	const launcher = useRef<HTMLElement | null>(null);
	const publish = (next: AisleIntegrationSession | null) => {
		current.current = next;
		setSession(next);
	};
	const release = () => {
		++request.current;
		controller.current?.abort();
		controller.current = null;
		bridge.current?.dispose();
		bridge.current = null;
	};
	const cancel = (restoreFocus = true) => {
		release();
		publish(null);
		source.current = null;
		const target = launcher.current;
		launcher.current = null;
		if (restoreFocus)
			requestAnimationFrame(() => {
				if (target?.isConnected) target.focus({ preventScroll: true });
			});
	};
	useEffect(
		() => () => {
			++request.current;
			controller.current?.abort();
			bridge.current?.dispose();
		},
		[],
	);
	const getSource = () => {
		const live = callbacks.current.getSource(),
			original = source.current;
		if (
			!original ||
			original.document !== live.document ||
			original.scope.projectId !== live.scope.projectId ||
			original.scope.projectGeneration !== live.scope.projectGeneration
		)
			throw new Error("프로젝트가 변경되었습니다 · 편입을 다시 시작하세요");
		return live;
	};
	const begin = () => {
		release();
		if (!callbacks.current.ready()) throw new Error("현재 문서의 동기화를 기다리세요");
		getSource();
		const abort = new AbortController();
		controller.current = abort;
		const adapter = new StaticFabAisleIntegrationBridge();
		bridge.current = adapter;
		return { abort, adapter, sequence: request.current };
	};
	const reject = (sequence: number, error: unknown) => {
		if (request.current !== sequence || !current.current) return;
		bridge.current?.dispose();
		bridge.current = null;
		publish({
			...current.current,
			plan: null,
			phase: "rejected",
			reason: error instanceof Error ? error.message : "편입을 검토하지 못했습니다",
		});
	};
	const chooseOption = async (id: string): Promise<void> => {
		const active = current.current,
			option = active?.options.find((item) => item.id === id);
		if (!active || !option || active.bayId === null) return;
		publish({
			...active,
			optionId: id,
			plan: null,
			phase: "reviewing",
			reason: "두 연결을 검토하고 있습니다",
		});
		let sequence = request.current + 1;
		try {
			const task = begin();
			sequence = task.sequence;
			const snapshot = await callbacks.current.captureSnapshot(task.abort.signal);
			if (task.abort.signal.aborted || request.current !== sequence) return;
			const prepared = await task.adapter.prepare({
				snapshot,
				getCurrentSource: getSource,
				intent: {
					version: 1,
					aisleOrganizationId: active.aisle.id,
					bayOrganizationId: active.bayId,
					entryGateway: option.entryGateway,
					exitGateway: option.exitGateway,
				},
			});
			if (request.current !== sequence || !current.current) return;
			publish({
				...current.current,
				plan: prepared.plan,
				phase: prepared.plan ? "ready" : "rejected",
				reason: prepared.reason,
			});
		} catch (error) {
			reject(sequence, error);
		}
	};
	const chooseBay = async (id: number): Promise<void> => {
		const active = current.current;
		if (!active?.bays.some((bay) => bay.id === id)) return;
		publish({
			...active,
			bayId: id,
			options: [],
			optionId: "",
			plan: null,
			phase: "searching",
			reason: "연결 위치를 찾고 있습니다",
		});
		let sequence = request.current + 1;
		try {
			const task = begin();
			sequence = task.sequence;
			const snapshot = await callbacks.current.captureSnapshot(task.abort.signal);
			if (task.abort.signal.aborted || request.current !== sequence) return;
			const result = await task.adapter.discover({
				snapshot,
				getCurrentSource: getSource,
				aisleOrganizationId: active.aisle.id,
				bayOrganizationId: id,
			});
			if (request.current !== sequence || !current.current) return;
			publish({
				...current.current,
				options: result.options,
				phase: result.options.length ? "choosing" : "rejected",
				reason: result.reason,
			});
			if (result.options[0]) await chooseOption(result.options[0].id);
		} catch (error) {
			reject(sequence, error);
		}
	};
	const start = (aisle: StaticFabOrganizationRecord, target: HTMLElement) => {
		release();
		source.current = callbacks.current.getSource();
		launcher.current = target;
		const organizations = source.current.document.organizations,
			roles = deriveStaticFabOrganizationSemanticRoles(organizations);
		const bays = organizations.records.filter(
			(record) => record.kind === "BAY" && roles.get(record.id) === "BAY",
		);
		publish({
			aisle,
			bays,
			bayId: null,
			options: [],
			optionId: "",
			plan: null,
			phase: "choosing",
			reason: bays.length ? "대상 Bay를 선택하세요" : "편입할 Production Bay가 없습니다",
		});
	};
	const apply = () => {
		const active = current.current;
		if (!active || active.phase !== "ready" || !active.plan) return;
		try {
			if (!callbacks.current.ready())
				throw new Error("현재 문서의 동기화가 변경되었습니다 · 다시 검토하세요");
			const live = getSource();
			if (!live.document.commitStaticFabAisleIntegration(active.plan, live.scope))
				throw new Error(live.document.getLastCommandError() ?? "편입 인증이 만료되었습니다");
			cancel(false);
			callbacks.current.onCommitted(active.aisle);
		} catch (error) {
			reject(request.current, error);
		}
	};
	return { session, current, start, cancel, chooseBay, chooseOption, apply };
}
