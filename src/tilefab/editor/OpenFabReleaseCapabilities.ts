export interface OpenFabReleaseCapabilityEnvironment {
	readonly development: boolean;
	readonly derived3D: string | undefined;
	readonly simulation: string | undefined;
}

export interface OpenFabReleaseCapabilities {
	readonly derived3D: boolean;
	readonly simulation: boolean;
}

export function deriveOpenFabReleaseCapabilities(
	environment: OpenFabReleaseCapabilityEnvironment,
): OpenFabReleaseCapabilities {
	return Object.freeze({
		derived3D: environment.development || environment.derived3D === "1",
		simulation: environment.development || environment.simulation === "1",
	});
}

export const OPENFAB_RELEASE_CAPABILITIES = deriveOpenFabReleaseCapabilities({
	development: import.meta.env.DEV,
	derived3D: import.meta.env.VITE_OPENFAB_DERIVED_3D,
	simulation: import.meta.env.VITE_OPENFAB_SIMULATION,
});
