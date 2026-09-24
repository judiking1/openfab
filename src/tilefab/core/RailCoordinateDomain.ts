import type { Cell } from "./TileMap";

/**
 * V1 authored domain, in one-metre cells. Keep a 1,024 m derived-position margin below
 * the Float32 2^17 exponent boundary. This is an admission limit, not a clearance or
 * simulation accuracy certificate; the physical compiler still validates its own contracts.
 * Raw diagnostic maps and signed-Int32 transport may represent a wider range.
 */
export const RAIL_COORDINATE_MAX_METERS = 130_048;

export const RAIL_COORDINATE_DOMAIN_REASON =
	"레일과 분기 예약 영역은 X/Z 좌표 -130,048~130,048m 안에 배치해 주세요. 현재 V1의 지원 범위를 벗어났습니다.";

export function isSupportedRailCoordinate(x: number, y: number): boolean {
	return (
		Number.isSafeInteger(x) &&
		Number.isSafeInteger(y) &&
		Math.abs(x) <= RAIL_COORDINATE_MAX_METERS &&
		Math.abs(y) <= RAIL_COORDINATE_MAX_METERS
	);
}

export function isSupportedRailFootprint(origin: Cell, claimedCells: readonly Cell[]): boolean {
	return (
		isSupportedRailCoordinate(origin.x, origin.y) &&
		claimedCells.every((cell) => isSupportedRailCoordinate(cell.x, cell.y))
	);
}

export function assertRailCoordinateDomain(unsupportedSourceCount: number): void {
	if (unsupportedSourceCount !== 0) throw new Error(RAIL_COORDINATE_DOMAIN_REASON);
}
