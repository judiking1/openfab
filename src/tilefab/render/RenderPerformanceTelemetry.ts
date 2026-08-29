export type RenderInteractionCategory =
	| "none"
	| "blueprint-snapshot"
	| "blueprint-hover"
	| "hierarchy-snapshot"
	| "module-hover"
	| "organization-preview"
	| "port-membership"
	| "port-membership-plan"
	| "port-row-draft"
	| "rail-draft"
	| "rail-drag"
	| "rail-hover"
	| "template-hover";

export interface RenderPerformanceSnapshot {
	readonly startupSamples: number;
	readonly startupTotalMilliseconds: number;
	readonly startupMaxMilliseconds: number;
	readonly interactionSamples: number;
	readonly interactionLastMilliseconds: number;
	readonly interactionMeanMilliseconds: number;
	readonly interactionMaxMilliseconds: number;
	readonly interactionMaxCategory: RenderInteractionCategory;
	readonly interactionOver16Milliseconds: number;
	readonly interactionOver50Milliseconds: number;
	readonly renderSamples: number;
	readonly renderLastMilliseconds: number;
	readonly renderMeanMilliseconds: number;
	readonly renderMaxMilliseconds: number;
	readonly renderOver16Milliseconds: number;
	readonly renderOver32Milliseconds: number;
	readonly renderOver50Milliseconds: number;
	readonly longTaskCount: number;
	readonly longTaskSupported: boolean;
	readonly longTaskTotalMilliseconds: number;
	readonly longTaskMaxMilliseconds: number;
	readonly heapBaselineBytes: number;
	readonly heapTelemetrySupported: boolean;
	readonly heapCurrentBytes: number;
	readonly heapPeakBytes: number;
	readonly heapGrowthBytes: number;
}

/** Fixed-size counters for browser scale proof. No per-frame sample history is retained. */
export class RenderPerformanceTelemetry {
	private startupSamples = 0;
	private startupTotalMilliseconds = 0;
	private startupMaxMilliseconds = 0;
	private interactionSamples = 0;
	private interactionLastMilliseconds = 0;
	private interactionTotalMilliseconds = 0;
	private interactionMaxMilliseconds = 0;
	private interactionMaxCategory: RenderInteractionCategory = "none";
	private interactionOver16Milliseconds = 0;
	private interactionOver50Milliseconds = 0;
	private renderSamples = 0;
	private renderLastMilliseconds = 0;
	private renderTotalMilliseconds = 0;
	private renderMaxMilliseconds = 0;
	private renderOver16Milliseconds = 0;
	private renderOver32Milliseconds = 0;
	private renderOver50Milliseconds = 0;
	private longTaskCount = 0;
	private longTaskSupported = false;
	private longTaskTotalMilliseconds = 0;
	private longTaskMaxMilliseconds = 0;
	private heapBaselineBytes = 0;
	private heapTelemetrySupported = false;
	private heapCurrentBytes = 0;
	private heapPeakBytes = 0;

	recordStartup(durationMilliseconds: number): void {
		if (!validDuration(durationMilliseconds)) return;
		this.startupSamples++;
		this.startupTotalMilliseconds += durationMilliseconds;
		this.startupMaxMilliseconds = Math.max(this.startupMaxMilliseconds, durationMilliseconds);
	}

	recordInteraction(
		durationMilliseconds: number,
		category: Exclude<RenderInteractionCategory, "none">,
	): void {
		if (!validDuration(durationMilliseconds)) return;
		this.interactionSamples++;
		this.interactionLastMilliseconds = durationMilliseconds;
		this.interactionTotalMilliseconds += durationMilliseconds;
		if (durationMilliseconds > this.interactionMaxMilliseconds) {
			this.interactionMaxMilliseconds = durationMilliseconds;
			this.interactionMaxCategory = category;
		}
		if (durationMilliseconds > 16) this.interactionOver16Milliseconds++;
		if (durationMilliseconds > 50) this.interactionOver50Milliseconds++;
	}

	recordRender(durationMilliseconds: number): void {
		if (!validDuration(durationMilliseconds)) return;
		this.renderSamples++;
		this.renderLastMilliseconds = durationMilliseconds;
		this.renderTotalMilliseconds += durationMilliseconds;
		this.renderMaxMilliseconds = Math.max(this.renderMaxMilliseconds, durationMilliseconds);
		if (durationMilliseconds > 16) this.renderOver16Milliseconds++;
		if (durationMilliseconds > 32) this.renderOver32Milliseconds++;
		if (durationMilliseconds > 50) this.renderOver50Milliseconds++;
	}

	recordLongTask(durationMilliseconds: number): void {
		if (!validDuration(durationMilliseconds)) return;
		this.longTaskCount++;
		this.longTaskTotalMilliseconds += durationMilliseconds;
		this.longTaskMaxMilliseconds = Math.max(this.longTaskMaxMilliseconds, durationMilliseconds);
	}

	recordHeap(usedBytes: number): void {
		if (!Number.isFinite(usedBytes) || usedBytes < 0) return;
		this.heapTelemetrySupported = true;
		if (this.heapBaselineBytes === 0) this.heapBaselineBytes = usedBytes;
		this.heapCurrentBytes = usedBytes;
		this.heapPeakBytes = Math.max(this.heapPeakBytes, usedBytes);
	}

	setLongTaskSupported(supported: boolean): void {
		this.longTaskSupported = supported;
	}

	snapshot(): RenderPerformanceSnapshot {
		return Object.freeze({
			startupSamples: this.startupSamples,
			startupTotalMilliseconds: this.startupTotalMilliseconds,
			startupMaxMilliseconds: this.startupMaxMilliseconds,
			interactionSamples: this.interactionSamples,
			interactionLastMilliseconds: this.interactionLastMilliseconds,
			interactionMeanMilliseconds:
				this.interactionSamples === 0
					? 0
					: this.interactionTotalMilliseconds / this.interactionSamples,
			interactionMaxMilliseconds: this.interactionMaxMilliseconds,
			interactionMaxCategory: this.interactionMaxCategory,
			interactionOver16Milliseconds: this.interactionOver16Milliseconds,
			interactionOver50Milliseconds: this.interactionOver50Milliseconds,
			renderSamples: this.renderSamples,
			renderLastMilliseconds: this.renderLastMilliseconds,
			renderMeanMilliseconds:
				this.renderSamples === 0 ? 0 : this.renderTotalMilliseconds / this.renderSamples,
			renderMaxMilliseconds: this.renderMaxMilliseconds,
			renderOver16Milliseconds: this.renderOver16Milliseconds,
			renderOver32Milliseconds: this.renderOver32Milliseconds,
			renderOver50Milliseconds: this.renderOver50Milliseconds,
			longTaskCount: this.longTaskCount,
			longTaskSupported: this.longTaskSupported,
			longTaskTotalMilliseconds: this.longTaskTotalMilliseconds,
			longTaskMaxMilliseconds: this.longTaskMaxMilliseconds,
			heapBaselineBytes: this.heapBaselineBytes,
			heapTelemetrySupported: this.heapTelemetrySupported,
			heapCurrentBytes: this.heapCurrentBytes,
			heapPeakBytes: this.heapPeakBytes,
			heapGrowthBytes: Math.max(0, this.heapCurrentBytes - this.heapBaselineBytes),
		});
	}
}

function validDuration(durationMilliseconds: number): boolean {
	return Number.isFinite(durationMilliseconds) && durationMilliseconds >= 0;
}
