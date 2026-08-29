import { describe, expect, it, vi } from "vitest";
import {
	BrowserOpenFabUserBlueprintLibraryChangePort,
	type BrowserOpenFabUserBlueprintLibraryChannelFactory,
} from "./BrowserOpenFabUserBlueprintLibraryChangePort";

describe("BrowserOpenFabUserBlueprintLibraryChangePort", () => {
	it("delivers only valid remote monotonic change signals", () => {
		const hub = new FakeBroadcastChannelHub();
		const first = new BrowserOpenFabUserBlueprintLibraryChangePort({
			channelFactory: hub.create,
			sourceId: "first",
		});
		const second = new BrowserOpenFabUserBlueprintLibraryChangePort({
			channelFactory: hub.create,
			sourceId: "second",
		});
		const firstListener = vi.fn();
		const secondListener = vi.fn();
		first.subscribe(firstListener);
		const unsubscribeSecond = second.subscribe(secondListener);

		first.publishChange();
		first.publishChange();

		expect(firstListener).not.toHaveBeenCalled();
		expect(secondListener).toHaveBeenCalledTimes(2);
		hub.broadcast(hub.messages.at(-1));
		hub.broadcast({ schemaVersion: 1, kind: "changed", sourceId: "first", sequence: 0 });
		hub.broadcast({ schemaVersion: 99, kind: "changed", sourceId: "third", sequence: 1 });
		expect(secondListener).toHaveBeenCalledTimes(2);

		unsubscribeSecond();
		unsubscribeSecond();
		first.publishChange();
		expect(secondListener).toHaveBeenCalledTimes(2);
		first.dispose();
		second.dispose();
		expect(hub.closedChannelCount).toBe(2);
	});

	it("fails closed when BroadcastChannel is unavailable and disposes idempotently", () => {
		const listener = vi.fn();
		const port = new BrowserOpenFabUserBlueprintLibraryChangePort({
			channelFactory: () => null,
			sourceId: "unavailable",
		});

		expect(port.available).toBe(false);
		port.subscribe(listener);
		port.publishChange();
		port.dispose();
		port.dispose();
		expect(listener).not.toHaveBeenCalled();
		expect(port.subscribe(listener)).toBeTypeOf("function");
	});

	it("rejects invalid source identities before opening a channel", () => {
		const channelFactory = vi.fn(() => null);
		expect(
			() =>
				new BrowserOpenFabUserBlueprintLibraryChangePort({
					channelFactory,
					sourceId: "",
				}),
		).toThrow(/source id/i);
		expect(channelFactory).not.toHaveBeenCalled();
	});
});

class FakeBroadcastChannelHub {
	readonly messages: unknown[] = [];
	closedChannelCount = 0;
	private readonly channels = new Set<FakeBroadcastChannel>();

	readonly create: BrowserOpenFabUserBlueprintLibraryChannelFactory = () => {
		const channel = new FakeBroadcastChannel(this);
		this.channels.add(channel);
		return channel;
	};

	broadcast(message: unknown): void {
		for (const channel of this.channels) channel.receive(message);
	}

	post(message: unknown): void {
		this.messages.push(message);
		this.broadcast(message);
	}

	close(channel: FakeBroadcastChannel): void {
		if (!this.channels.delete(channel)) return;
		this.closedChannelCount += 1;
	}
}

class FakeBroadcastChannel {
	private readonly listeners = new Set<(event: MessageEvent<unknown>) => void>();
	private readonly hub: FakeBroadcastChannelHub;

	constructor(hub: FakeBroadcastChannelHub) {
		this.hub = hub;
	}

	postMessage(message: unknown): void {
		this.hub.post(message);
	}

	addEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners.add(listener);
	}

	removeEventListener(_type: "message", listener: (event: MessageEvent<unknown>) => void): void {
		this.listeners.delete(listener);
	}

	close(): void {
		this.hub.close(this);
		this.listeners.clear();
	}

	receive(data: unknown): void {
		for (const listener of [...this.listeners]) listener({ data } as MessageEvent<unknown>);
	}
}
