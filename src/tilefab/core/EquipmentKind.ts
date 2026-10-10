/** Authored string kinds only. Worker wire codes belong to each protocol. */
export const EQUIPMENT_KINDS = ["OHB", "EQ", "STK"] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

/** Internal exhaustiveness guard; external input must pass its boundary validator first. */
export function unreachableEquipmentKind(value: never): never {
	throw new TypeError("equipment group kind is invalid", { cause: value });
}
