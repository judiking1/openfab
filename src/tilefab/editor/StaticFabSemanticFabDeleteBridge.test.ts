import { afterEach, describe, expect, it, vi } from "vitest";
import { RailDocument } from "../core/RailDocument";
import { captureRailMirrorSnapshot } from "../worker/RailMirrorChecksum";
import type {
	StaticFabSemanticFabDeleteWorkerRequest,
	StaticFabSemanticFabDeleteWorkerResponse,
} from "../worker/StaticFabSemanticFabDeleteProtocol";
import { prepareStaticFabSemanticFabDelete } from "../worker/StaticFabSemanticFabDeleteRuntime";
import {
	StaticFabSemanticFabDeleteBridge,
	type StaticFabSemanticFabDeleteBridgeInput,
	type StaticFabSemanticFabDeleteLiveState,
	type StaticFabSemanticFabDeleteWorkerPort,
} from "./StaticFabSemanticFabDeleteBridge";

class ManualWorker implements StaticFabSemanticFabDeleteWorkerPort {
	onmessage: StaticFabSemanticFabDeleteWorkerPort["onmessage"] = null;
	onerror: StaticFabSemanticFabDeleteWorkerPort["onerror"] = null;
	onmessageerror: StaticFabSemanticFabDeleteWorkerPort["onmessageerror"] = null;
	request: StaticFabSemanticFabDeleteWorkerRequest | null = null;
	terminated = false;
	postMessage(
		message: StaticFabSemanticFabDeleteWorkerRequest,
		transfer: Transferable[] = [],
	): void {
		this.request = structuredClone(message, { transfer });
	}
	terminate(): void {
		this.terminated = true;
	}
	deliver(
		transform: (value: StaticFabSemanticFabDeleteWorkerResponse) => unknown = (value) => value,
	): void {
		if (!this.request) throw new Error("Expected a Fab delete request.");
		this.onmessage?.({
			data: transform({
				type: "STATIC_FAB_SEMANTIC_FAB_DELETE_PREPARED",
				version: 1,
				requestId: this.request.requestId,
				prepared: prepareStaticFabSemanticFabDelete(this.request),
			}),
		} as MessageEvent<StaticFabSemanticFabDeleteWorkerResponse>);
	}
}

function fixture(): {
	document: RailDocument;
	input: StaticFabSemanticFabDeleteBridgeInput;
	replace: (next: Partial<StaticFabSemanticFabDeleteLiveState>) => void;
} {
	const document = new RailDocument();
	let live: StaticFabSemanticFabDeleteLiveState = {
		document,
		scope: { projectId: "synthetic-fab-review", projectGeneration: 1 },
	};
	return {
		document,
		input: {
			intent: {
				version: 1,
				action: "DELETE",
				targetRole: "FAB",
				targetOrganizationId: 3,
				expectedParentOrganizationId: null,
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

describe("Fab delete Worker bridge lifecycle", () => {
	it("reports a planner rejection without granting authority or mutating the document", async () => {
		const { document, input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker);
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
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker);
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
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker);
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
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		if (change === "document") replace({ document: new RailDocument() });
		else
			replace({
				scope: {
					projectId: change === "project" ? "another-project" : "synthetic-fab-review",
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
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		document.map.setEncoded(0, 0, 1);
		worker.deliver();
		await expect(promise).rejects.toThrow("프로젝트·문서·연결 관계 또는 운영 설정이 변경");
	});

	it.each([
		"request",
		"operation",
		"envelope",
		"rejection",
	] as const)("rejects a malformed %s", async (change) => {
		const { input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		worker.deliver((value) =>
			change === "operation"
				? { ...value, type: "STATIC_FAB_SEMANTIC_BANK_DELETE_PREPARED" }
				: change === "request"
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
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker);
		const promise = bridge.prepare(input);
		const lateHandler = worker.onmessage;
		bridge.cancel();
		await expect(promise).rejects.toMatchObject({ name: "AbortError" });
		lateHandler?.({ data: {} } as MessageEvent<StaticFabSemanticFabDeleteWorkerResponse>);
		expect(document.canUndo).toBe(false);
		expect(worker.terminated).toBe(true);
	});

	it("revokes timed-out authority and terminates its Worker", async () => {
		vi.useFakeTimers();
		const { input } = fixture();
		const worker = new ManualWorker();
		const bridge = new StaticFabSemanticFabDeleteBridge(() => worker, 10);
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
		const bridge = new StaticFabSemanticFabDeleteBridge(() => (calls++ === 0 ? first : second));
		const oldPromise = bridge.prepare(fixture().input);
		const lateHandler = first.onmessage;
		const lateError = first.onerror;
		const lateMessageError = first.onmessageerror;
		bridge.cancel();
		await expect(oldPromise).rejects.toMatchObject({ name: "AbortError" });
		const freshPromise = bridge.prepare(fixture().input);
		lateHandler?.({ data: {} } as MessageEvent<StaticFabSemanticFabDeleteWorkerResponse>);
		lateError?.({} as ErrorEvent);
		lateMessageError?.({} as MessageEvent<unknown>);
		expect(second.terminated).toBe(false);
		second.deliver();
		expect(await freshPromise).toMatchObject({ certified: false, plan: null });
	});
});
