import { isCanonicalPortEquipmentState, type PortEquipmentState } from "../core/EquipmentGroup";
import { copyPortRecord, type PortRecord, portRecordEquals } from "../core/PortRecord";
import type { CompiledPhysicalLayout } from "./PhysicalRailCompiler";
import {
	createPortAttachmentSourceIndex,
	type PortAttachmentSourceIndex,
	portAttachmentSourceIndexMatchesLayout,
	type ResolvedPortAttachment,
	resolvePortAttachmentWithSourceIndex,
} from "./PortAttachmentResolver";

const PORT_EQUIPMENT_RESOLVED_POSITION_CAPABILITY_KIND =
	"port-equipment-resolved-position-capability" as const;

/** Opaque runtime-only proof that positions came from the canonical attachment resolver. */
export interface PortEquipmentResolvedPositionCapability {
	readonly kind: typeof PORT_EQUIPMENT_RESOLVED_POSITION_CAPABILITY_KIND;
}

interface ResolvedPositionRecord {
	readonly layoutIdentity: object;
	readonly stateIdentity: object;
	readonly portIds: Int32Array;
	readonly worldPositions: Float64Array;
	readonly mutableSourceSnapshots: readonly PortRecord[] | null;
}

const resolvedPositionRecords = new WeakMap<object, ResolvedPositionRecord>();
const resolvedPositionLayoutIdentities = new WeakMap<object, object>();
const resolvedPositionStateIdentities = new WeakMap<object, object>();

function exactSourceIdentity(source: object, identities: WeakMap<object, object>): object {
	const existing = identities.get(source);
	if (existing) return existing;
	const identity = Object.freeze({});
	identities.set(source, identity);
	return identity;
}

/**
 * Resolve each authored Port exactly once, retain double-precision availability coordinates behind
 * an unforgeable capability, and optionally stream the same resolution into a renderer derivative.
 */
export function compilePortEquipmentResolvedPositionCapability(
	layout: CompiledPhysicalLayout,
	state: PortEquipmentState,
	consume?: (row: number, port: PortRecord, resolution: ResolvedPortAttachment) => void,
	attachmentSourceIndex?: PortAttachmentSourceIndex,
): PortEquipmentResolvedPositionCapability {
	if (
		attachmentSourceIndex !== undefined &&
		!portAttachmentSourceIndexMatchesLayout(attachmentSourceIndex, layout)
	) {
		throw new Error("Port attachment source index is not certified for this physical layout.");
	}
	const portIds = new Int32Array(state.ports.length);
	const worldPositions = new Float64Array(state.ports.length * 2);
	const mutableSourceSnapshots: PortRecord[] | null = isCanonicalPortEquipmentState(state)
		? null
		: [];
	let sourceIndex = attachmentSourceIndex ?? null;
	for (let row = 0; row < state.ports.length; row++) {
		const port = state.ports[row];
		if (!port) throw new Error(`Missing resolved Port row ${row}.`);
		mutableSourceSnapshots?.push(copyPortRecord(port));
		sourceIndex ??= createPortAttachmentSourceIndex(layout);
		const resolution = resolvePortAttachmentWithSourceIndex(layout, port, sourceIndex);
		if (!resolution.ok) {
			throw new Error(
				`Port ${port.id} attachment is invalid (${resolution.code}): ${resolution.message}`,
			);
		}
		portIds[row] = port.id;
		worldPositions[row * 2] = resolution.worldXMeters;
		worldPositions[row * 2 + 1] = resolution.worldZMeters;
		consume?.(row, port, resolution);
	}
	const capability = Object.freeze({
		kind: PORT_EQUIPMENT_RESOLVED_POSITION_CAPABILITY_KIND,
	});
	resolvedPositionRecords.set(
		capability,
		Object.freeze({
			layoutIdentity: exactSourceIdentity(layout, resolvedPositionLayoutIdentities),
			stateIdentity: exactSourceIdentity(state, resolvedPositionStateIdentities),
			portIds,
			worldPositions,
			mutableSourceSnapshots:
				mutableSourceSnapshots === null ? null : Object.freeze(mutableSourceSnapshots),
		}),
	);
	return capability;
}

/**
 * Visit exact positions without exposing the private Float64 buffer. A structural clone or a
 * capability from another layout/state identity is rejected before any coordinate becomes visible.
 */
export function visitPortEquipmentResolvedPositions(
	capability: PortEquipmentResolvedPositionCapability,
	layout: CompiledPhysicalLayout,
	state: PortEquipmentState,
	consume: (row: number, port: PortRecord, worldX: number, worldZ: number) => void,
): void {
	const record = resolvedPositionRecords.get(capability);
	if (
		!record ||
		record.layoutIdentity !== resolvedPositionLayoutIdentities.get(layout) ||
		record.stateIdentity !== resolvedPositionStateIdentities.get(state)
	) {
		throw new Error("Resolved Port position capability is not certified for this source.");
	}
	if (
		record.portIds.length !== state.ports.length ||
		record.worldPositions.length !== state.ports.length * 2
	) {
		throw new Error("Resolved Port position capability has an invalid private shape.");
	}
	for (let row = 0; row < state.ports.length; row++) {
		const port = state.ports[row];
		const snapshot = record.mutableSourceSnapshots?.[row];
		if (
			!port ||
			(record.portIds[row] as number) !== port.id ||
			(snapshot !== undefined && !portRecordEquals(snapshot, port))
		) {
			throw new Error(`Resolved Port position row ${row} no longer matches the authored Port.`);
		}
		consume(
			row,
			port,
			record.worldPositions[row * 2] as number,
			record.worldPositions[row * 2 + 1] as number,
		);
	}
}
