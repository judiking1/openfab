import type { RailTemplatePose } from "./RailTemplateCatalog";
import { DIR_E, DIR_N, DIR_S, DIR_W, type Direction } from "./railShape";

export interface RailTemplatePoseLock {
	readonly forward: boolean;
	readonly side: boolean;
	readonly flow: boolean;
}

export interface RankedRailTemplatePose {
	readonly pose: RailTemplatePose;
	readonly tier: number;
	readonly mutationCount: number;
	readonly order: number;
}

export const AUTO_RAIL_TEMPLATE_POSE_LOCK: RailTemplatePoseLock = Object.freeze({
	forward: false,
	side: false,
	flow: false,
});

export const LOCKED_RAIL_TEMPLATE_POSE: RailTemplatePoseLock = Object.freeze({
	forward: true,
	side: true,
	flow: true,
});

export function isRailTemplatePoseAuto(lock: RailTemplatePoseLock): boolean {
	return !lock.forward && !lock.side && !lock.flow;
}

export function isRailTemplatePoseFullyLocked(lock: RailTemplatePoseLock): boolean {
	return lock.forward && lock.side && lock.flow;
}

export function lockRailTemplatePoseAxis(
	lock: RailTemplatePoseLock,
	axis: keyof RailTemplatePoseLock,
): RailTemplatePoseLock {
	if (lock[axis]) return lock;
	return Object.freeze({ ...lock, [axis]: true });
}

export function rankedRailTemplatePoses(
	preferredPose: RailTemplatePose,
	lock: RailTemplatePoseLock = AUTO_RAIL_TEMPLATE_POSE_LOCK,
): readonly RankedRailTemplatePose[] {
	const candidates: RankedRailTemplatePose[] = [];
	let order = 0;
	const forwardTiers = lock.forward
		? ([[preferredPose.forward]] as const)
		: ([
				[preferredPose.forward],
				[
					rotateCardinalDirection(preferredPose.forward, 1),
					rotateCardinalDirection(preferredPose.forward, -1),
				],
				[rotateCardinalDirection(preferredPose.forward, 2)],
			] as const);
	const preferredFlow = normalizedRailTemplateFlow(preferredPose);
	const sides = lock.side
		? ([preferredPose.side] as const)
		: ([preferredPose.side, preferredPose.side === "left" ? "right" : "left"] as const);
	const flows = lock.flow
		? ([preferredFlow] as const)
		: ([preferredFlow, preferredFlow === "forward" ? "reverse" : "forward"] as const);

	for (let tier = 0; tier < forwardTiers.length; tier++) {
		for (const forward of forwardTiers[tier] ?? []) {
			for (const flow of flows) {
				for (const side of sides) {
					const pose = Object.freeze({ forward, side, flow }) satisfies RailTemplatePose;
					candidates.push(
						Object.freeze({
							pose,
							tier,
							mutationCount:
								(preferredPose.side === side ? 0 : 1) +
								(preferredFlow === flow ? 0 : 1),
							order: order++,
						}),
					);
				}
			}
		}
	}
	return Object.freeze(candidates);
}

export function normalizedRailTemplateFlow(
	pose: RailTemplatePose,
): "forward" | "reverse" {
	return pose.flow === "reverse" ? "reverse" : "forward";
}

function rotateCardinalDirection(direction: Direction, quarterTurns: -1 | 1 | 2): Direction {
	const directions = [DIR_N, DIR_E, DIR_S, DIR_W] as const;
	const index = directions.indexOf(direction);
	if (index < 0) throw new RangeError(`Invalid cardinal direction ${direction}.`);
	return directions[(index + quarterTurns + directions.length) % directions.length] as Direction;
}
