import type { GuidedPortKeyboardSession } from "./GuidedPortKeyboardSession";

export type OrdinaryPortKeyboardApplyDecision =
	| Readonly<{ kind: "apply"; session: GuidedPortKeyboardSession }>
	| Readonly<{ kind: "defer"; session: GuidedPortKeyboardSession }>
	| Readonly<{ kind: "coalesce"; session: GuidedPortKeyboardSession }>;

/**
 * Keeps ordinary Enter bound to the exact immutable session object acknowledged by a Canvas frame.
 * Guided targets retain their existing renderer-owned resolution path.
 */
export function decideOrdinaryPortKeyboardApply(
	current: GuidedPortKeyboardSession,
	painted: GuidedPortKeyboardSession | null,
	pending: GuidedPortKeyboardSession | null,
): OrdinaryPortKeyboardApplyDecision {
	if (current.scope !== "ordinary" || current === painted) {
		return Object.freeze({ kind: "apply", session: current });
	}
	if (pending === current) {
		return Object.freeze({ kind: "coalesce", session: current });
	}
	return Object.freeze({ kind: "defer", session: current });
}

/** A deferred Enter may run only while current, painted, and requested sessions are still exact. */
export function resolveOrdinaryPortKeyboardDeferredApply(
	current: GuidedPortKeyboardSession | null,
	painted: GuidedPortKeyboardSession | null,
	pending: GuidedPortKeyboardSession | null,
): GuidedPortKeyboardSession | null {
	return current?.scope === "ordinary" && current === painted && current === pending
		? current
		: null;
}
