import {
	ALL_DIRECTIONS,
	bitCount,
	type Direction,
	isTangentJunction,
	oppositeDirection,
} from "./railShape";
import type { RailCell } from "./TileMap";

export type AuthoredRailType =
	| "TERMINAL"
	| "LINEAR"
	| "LEFT_CURVE"
	| "RIGHT_CURVE"
	| "BRANCH"
	| "MERGE"
	| "INVALID";

export function classifyRailCell(rail: RailCell): AuthoredRailType {
	if ((rail.incoming & rail.outgoing) !== 0) return "INVALID";
	const incomingCount = bitCount(rail.incoming);
	const outgoingCount = bitCount(rail.outgoing);
	const degree = bitCount(rail.incoming | rail.outgoing);
	if (degree === 1) return "TERMINAL";
	if (degree === 3 && !isTangentJunction(rail.incoming, rail.outgoing)) return "INVALID";
	if (degree === 3 && incomingCount === 1 && outgoingCount === 2) return "BRANCH";
	if (degree === 3 && incomingCount === 2 && outgoingCount === 1) return "MERGE";
	if (degree !== 2 || incomingCount !== 1 || outgoingCount !== 1) return "INVALID";

	const incomingSide = singleDirection(rail.incoming);
	const outgoingSide = singleDirection(rail.outgoing);
	if (!incomingSide || !outgoingSide) return "INVALID";
	if (outgoingSide === oppositeDirection(incomingSide)) return "LINEAR";
	const incomingTravel = directionVector(oppositeDirection(incomingSide));
	const outgoingTravel = directionVector(outgoingSide);
	const cross = incomingTravel.x * outgoingTravel.y - incomingTravel.y * outgoingTravel.x;
	if (cross > 0) return "RIGHT_CURVE";
	if (cross < 0) return "LEFT_CURVE";
	return "INVALID";
}

function singleDirection(mask: number): Direction | null {
	if (bitCount(mask) !== 1) return null;
	return ALL_DIRECTIONS.find((direction) => (mask & direction) !== 0) ?? null;
}

function directionVector(direction: Direction): { x: number; y: number } {
	if (direction === 1) return { x: 0, y: -1 };
	if (direction === 2) return { x: 1, y: 0 };
	if (direction === 4) return { x: 0, y: 1 };
	return { x: -1, y: 0 };
}
