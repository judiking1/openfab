export interface StaticFabInspection3DVisibility {
	readonly rail: boolean;
	readonly switches: boolean;
	readonly equipment: boolean;
}

export const DEFAULT_STATIC_FAB_INSPECTION_3D_VISIBILITY: StaticFabInspection3DVisibility =
	Object.freeze({ rail: true, switches: true, equipment: true });
