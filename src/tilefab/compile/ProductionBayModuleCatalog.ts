import {
	type ProductionBayInternalFlowPattern,
	type ProductionBayModuleRequest,
	type ProductionBayProcessLoopCount,
	validateProductionBayModuleRequest,
} from "../core/ProductionBayModulePlanner";
import { DIR_E } from "../core/railShape";
import {
	type CertifiedProductionBayModule,
	certifyProductionBayModule,
} from "./ProductionBayModuleCompiler";

export type ProductionBayModuleCatalogId = "single-production-bay" | "twin-production-bay";
export type ProductionBayModuleFlow = "forward" | "reverse";

export interface ProductionBayModuleCatalogItem {
	readonly id: ProductionBayModuleCatalogId;
	readonly label: string;
	readonly shortLabel: string;
	readonly description: string;
	readonly processLoopCount: ProductionBayProcessLoopCount;
	readonly defaultOuterLengthMeters: number;
	readonly defaultOuterDepthMeters: number;
	readonly defaultShellMarginMeters: number;
	readonly defaultProcessLoopGapMeters: number;
	readonly defaultGatewayLengthMeters: number;
}

export interface ProductionBayModuleCatalogRequest {
	readonly id: ProductionBayModuleCatalogId;
	readonly outerLengthMeters: number;
	readonly outerDepthMeters: number;
	readonly shellMarginMeters: number;
	readonly processLoopGapMeters: number;
	readonly gatewayLengthMeters: number;
	readonly flow: ProductionBayModuleFlow;
	readonly internalFlowPattern: ProductionBayInternalFlowPattern;
}

export const PRODUCTION_BAY_MODULE_CATALOG: readonly ProductionBayModuleCatalogItem[] =
	Object.freeze([
		Object.freeze({
			id: "single-production-bay" as const,
			label: "SINGLE-LOOP PRODUCTION BAY",
			shortLabel: "SINGLE BAY",
			description: "One large circulation shell with one internal Process Loop and two gateways.",
			processLoopCount: 1 as const,
			defaultOuterLengthMeters: 36,
			defaultOuterDepthMeters: 16,
			defaultShellMarginMeters: 3,
			defaultProcessLoopGapMeters: 3,
			defaultGatewayLengthMeters: 6,
		}),
		Object.freeze({
			id: "twin-production-bay" as const,
			label: "TWIN-LOOP PRODUCTION BAY",
			shortLabel: "TWIN BAY",
			description:
				"One large circulation shell with two internal Process Loops and paired gateways.",
			processLoopCount: 2 as const,
			defaultOuterLengthMeters: 40,
			defaultOuterDepthMeters: 22,
			defaultShellMarginMeters: 3,
			defaultProcessLoopGapMeters: 4,
			defaultGatewayLengthMeters: 6,
		}),
	]);

const CATALOG_BY_ID = new Map(PRODUCTION_BAY_MODULE_CATALOG.map((item) => [item.id, item]));
const CERTIFIED_CACHE = new Map<string, CertifiedProductionBayModule>();

export function productionBayModuleCatalogItem(
	id: ProductionBayModuleCatalogId,
): ProductionBayModuleCatalogItem {
	const item = CATALOG_BY_ID.get(id);
	if (!item) throw new RangeError(`Unknown Production Bay catalog item: ${id}`);
	return item;
}

export function defaultProductionBayModuleCatalogRequest(
	id: ProductionBayModuleCatalogId,
): ProductionBayModuleCatalogRequest {
	const item = productionBayModuleCatalogItem(id);
	return Object.freeze({
		id,
		outerLengthMeters: item.defaultOuterLengthMeters,
		outerDepthMeters: item.defaultOuterDepthMeters,
		shellMarginMeters: item.defaultShellMarginMeters,
		processLoopGapMeters: item.defaultProcessLoopGapMeters,
		gatewayLengthMeters: item.defaultGatewayLengthMeters,
		flow: "forward" as const,
		internalFlowPattern: "alternating" as const,
	});
}

export function productionBayModuleCatalogRequestError(
	request: ProductionBayModuleCatalogRequest,
): string | null {
	return validateProductionBayModuleRequest(productionBayModuleRequest(request));
}

export function certifyProductionBayModuleCatalogRequest(
	request: ProductionBayModuleCatalogRequest,
): CertifiedProductionBayModule {
	const normalized = productionBayModuleRequest(request);
	const error = validateProductionBayModuleRequest(normalized);
	if (error) throw new RangeError(error);
	const key = productionBayModuleCatalogRequestFingerprint(request);
	const cached = CERTIFIED_CACHE.get(key);
	if (cached) return cached;
	const certified = certifyProductionBayModule(normalized);
	CERTIFIED_CACHE.set(key, certified);
	return certified;
}

export function productionBayModuleCatalogRequestFingerprint(
	request: ProductionBayModuleCatalogRequest,
): string {
	const item = productionBayModuleCatalogItem(request.id);
	return [
		request.id,
		item.processLoopCount,
		request.outerLengthMeters,
		request.outerDepthMeters,
		request.shellMarginMeters,
		request.processLoopGapMeters,
		request.gatewayLengthMeters,
		request.flow,
		request.internalFlowPattern,
	].join(":");
}

export function productionBayModuleRequest(
	request: ProductionBayModuleCatalogRequest,
): ProductionBayModuleRequest {
	const item = productionBayModuleCatalogItem(request.id);
	return Object.freeze({
		anchor: Object.freeze({ x: 0, y: 0 }),
		outerLengthMeters: request.outerLengthMeters,
		outerDepthMeters: request.outerDepthMeters,
		shellMarginMeters: request.shellMarginMeters,
		processLoopGapMeters: request.processLoopGapMeters,
		gatewayLengthMeters: request.gatewayLengthMeters,
		processLoopCount: item.processLoopCount,
		internalFlowPattern: request.internalFlowPattern,
		pose: Object.freeze({ forward: DIR_E, side: "right" as const, flow: request.flow }),
	});
}
