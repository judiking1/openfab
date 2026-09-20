export function stableDomStringMap(dataset: DOMStringMap): DOMStringMap {
	// React and input-paint callbacks also publish some of these attributes. Compare with the
	// actual DOM value so a later Canvas frame repairs an intervening writer's stale value.
	return new Proxy(dataset, {
		set(target, property, value): boolean {
			if (typeof property !== "string") return Reflect.set(target, property, value, target);
			const next = String(value);
			if (target[property] !== next) {
				target[property] = next;
			}
			return true;
		},
	});
}
