import { afterEach, describe, expect, it, vi } from "vitest";
import { RailDocument } from "../core/RailDocument";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type {
	StaticFabSemanticBankDeleteWorkerRequest,
	StaticFabSemanticBankDeleteWorkerResponse,
} from "../worker/StaticFabSemanticBankDeleteProtocol";
import { prepareStaticFabSemanticBankDelete } from "../worker/StaticFabSemanticBankDeleteRuntime";
import {
	StaticFabSemanticBankDeleteBridge,
	type StaticFabSemanticBankDeleteBridgeInput,
	type StaticFabSemanticBankDeleteLiveState,
	type StaticFabSemanticBankDeleteWorkerPort,
} from "./StaticFabSemanticBankDeleteBridge";

class ManualWorker implements StaticFabSemanticBankDeleteWorkerPort {
	onmessage: StaticFabSemanticBankDeleteWorkerPort["onmessage"] = null;
	onerror: StaticFabSemanticBankDeleteWorkerPort["onerror"] = null;
	onmessageerror: StaticFabSemanticBankDeleteWorkerPort["onmessageerror"] = null;
	request: StaticFabSemanticBankDeleteWorkerRequest | null = null;
	terminated = false;
	postMessage(
		message: StaticFabSemanticBankDeleteWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.request = structuredClone(message, { transfer });
	}
	terminate(): void {
		this.terminated = true;
	}
	deliver(
		transform: (value: StaticFabSemanticBankDeleteWorkerResponse) => unknown = (value) => value,
	): void {
		if (!this.request) throw new Error("Expected a Bank delete request.");
		this.onmessage?.({
			data: transform({
				type: "STATIC_FAB_SEMANTIC_BANK_DELETE_PREPARED",
				version: 1,
				requestId: this.request.requestId,
				prepared: prepareStaticFabSemanticBankDelete(this.request),
			}),
		} as MessageEvent<StaticFabSemanticBankDeleteWorkerResponse>);
	}
}

function fixture(): {
	document: RailDocument;
	input: StaticFabSemanticBankDeleteBridgeInput;
	replace: (next: Partial<StaticFabSemanticBankDeleteLiveState>) => void;
} {
	const document = new RailDocument();
	let live: StaticFabSemanticBankDeleteLiveState = {
		document,
		scope: { projectId: "synthetic-bank-review", projectGeneration: 1 },
	};
	return {
		document,
		input: {
			intent: {
				version: 1,
				action: "DELETE",
				targetRole: "BAY_BANK",
				targetOrganizationId: 3,
				expectedParentOrganizationId: 1,
			},
			snapshot: captureRailMirrorSnapshot(
				document.map,
				document.getPatchSequence(),
				document.portEquipment,
				document.organizations,
				document.relationships,
			).snapshot,
			getCurrentState: () => live,
		},
		replace: (next) => {
			live = { ...live, ...next };
		},
	};
}

afterEach(() => vi.useRealTimers());

describe("Bank delete Worker bridge lifecycle", () => {
	it("reports a planner rejection without granting authority or mutating the document", async () => {
		const { document, input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		worker.deliver();
		expect(await promise).toMatchObject({
			certified: false,
			plan: null,
			validation: { valid: false },
		});
		expect(document.getPatchSequence()).toBe(0);
		expect(document.canUndo).toBe(false);
		expect(worker.terminated).toBe(true);
		bridge.dispose();
	});
	it("binds the separately transported operational configuration to the source identity", async () => {
		const { document, input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		if (!worker.request) throw new Error("Expected a Delete request.");
		expect(worker.request.operationalConfiguration).toEqual(document.operationalConfiguration);
		worker.request = {
			...worker.request,
			operationalConfiguration: {
				...worker.request.operationalConfiguration,
				revision: worker.request.operationalConfiguration.revision + 1,
			},
		};
		worker.deliver();
		expect(await promise).toMatchObject({
			certified: false,
			plan: null,
			validation: { valid: false, failureCode: "STALE_SOURCE" },
		});
		expect(document.canUndo).toBe(false);
		bridge.dispose();
	});

	it("refuses a cloned or already consumed snapshot", async () => {
		const { input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker);
		await expect(
			bridge.prepare({ ...input, snapshot: structuredClone(input.snapshot) }),
		).rejects.toThrow("캡처 인증");
		const promise = bridge.prepare(input);
		worker.deliver();
		await promise;
		await expect(bridge.prepare(input)).rejects.toThrow("캡처 인증");
	});

	it.each([
		"document",
		"project",
		"generation",
	] as const)("rejects a changed %s with the same rail revision", async (change) => {
		const { input, replace, document } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		if (change === "document") replace({ document: new RailDocument() });
		else
			replace({
				scope: {
					projectId: change === "project" ? "another-project" : "synthetic-bank-review",
					projectGeneration: change === "generation" ? 2 : 1,
				},
			});
		worker.deliver();
		await expect(promise).rejects.toThrow("프로젝트·문서·연결 관계 또는 운영 설정이 변경");
		expect(document.canUndo).toBe(false);
		expect(worker.terminated).toBe(true);
	});

	it("rejects a changed rail generation before adopting even a rejection response", async () => {
		const { input, document } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		document.map.setEncoded(0, 0, 1);
		worker.deliver();
		await expect(promise).rejects.toThrow("프로젝트·문서·연결 관계 또는 운영 설정이 변경");
	});

	it.each([
		"request",
		"envelope",
		"rejection",
	] as const)("rejects a malformed %s", async (change) => {
		const { input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		worker.deliver((value) =>
			change === "request"
				? { ...value, requestId: value.requestId + 1 }
				: change === "envelope"
					? { ...value, unexpected: true }
					: { ...value, prepared: { ...value.prepared, ticket: {} } },
		);
		await expect(promise).rejects.toThrow();
		expect(worker.terminated).toBe(true);
	});

	it("revokes a cancelled request and ignores its late handler", async () => {
		const { input, document } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		const lateHandler = worker.onmessage;
		bridge.cancel();
		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		lateHandler?.({ data: {} } as MessageEvent<StaticFabSemanticBankDeleteWorkerResponse>);
		expect(document.canUndo).toBe(false);
		expect(worker.terminated).toBe(true);
	});

	it("revokes timed-out authority and terminates its Worker", async () => {
		vi.useFakeTimers();
		const { input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticBankDeleteBridge(() => worker, 10);
		const promise = bridge.prepare(input);
		const rejection = expect(promise).rejects.toThrow("시간이 초과");
		await vi.advanceTimersByTimeAsync(11);
		await rejection;
		expect(worker.terminated).toBe(true);
	});

	it("ignores a cancelled Worker's late message and errors after a fresh request starts", async () => {
		const first = new ManualWorker();
		const second = new ManualWorker();
		let calls = 0;
		const bridge = new StaticFabSemanticBankDeleteBridge(() => (calls++ === 0 ? first : second));
		const oldPromise = bridge.prepare(fixture().input);
		const lateHandler = first.onmessage;
		const lateError = first.onerror;
		const lateMessageError = first.onmessageerror;
		bridge.cancel();
		await expect(oldPromise).rejects.toMatchObject({ name: "AbortError" });
		const freshPromise = bridge.prepare(fixture().input);
		lateHandler?.({ data: {} } as MessageEvent<StaticFabSemanticBankDeleteWorkerResponse>);
		lateError?.({} as ErrorEvent);
		lateMessageError?.({} as MessageEvent<unknown>);
		expect(second.terminated).toBe(false);
		second.deliver();
		expect(await freshPromise).toMatchObject({ certified: false, plan: null });
	});
});
