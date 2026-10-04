// Bounded actual-input admission checks for cooperative editing-history replay.
import { isDeepStrictEqual } from "node:util";

const BAY_ACTIONS = Object.freeze([
	["assemble-edit-selected-bay-alternating", "assemble-edit-flow-status", "Alternating"],
	["assemble-edit-selected-bay-co-rotating", "assemble-edit-flow-status", "Co-rotating"],
	["assemble-disconnect-selected-bay", "assemble-disconnect-status", "Disconnect"],
	["assemble-delete-selected-bay", "assemble-delete-status", "Delete"],
]);

function requireEqual(actual, expected, label) {
	if (!isDeepStrictEqual(actual, expected)) {
		throw new Error(`${label}: ${JSON.stringify({ actual, expected })}`);
	}
}

async function twoAnimationFrames(page) {
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
	);
}

export async function readCurrentPhysicalContract(page) {
	return page.evaluate(() => {
		const model = window.__tileFab?.getEditorModel?.();
		const layout = model?.physical;
		if (
			!layout ||
			!Number.isSafeInteger(layout.revision) ||
			layout.revision !== model.document.map.getRevision() ||
			layout.paths?.revision !== layout.revision
		) {
			throw new Error("Required current-source physical layout is missing.");
		}
		const ancestors = new WeakSet();
		const copy = (value) => {
			if (value === undefined) return { scalar: "undefined" };
			if (value === null || typeof value === "string" || typeof value === "boolean") return value;
			if (typeof value === "number") {
				if (!Number.isFinite(value)) throw new Error("Nonfinite physical scalar.");
				return Object.is(value, -0) ? { scalar: "negative-zero" } : value;
			}
			if (ArrayBuffer.isView(value)) {
				return {
					view: value.constructor.name,
					bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
				};
			}
			if (value instanceof ArrayBuffer) {
				return { buffer: "ArrayBuffer", bytes: Array.from(new Uint8Array(value)) };
			}
			if (typeof value !== "object" || ancestors.has(value)) {
				throw new Error("Unsupported or cyclic physical contract value.");
			}
			ancestors.add(value);
			try {
				if (Array.isArray(value)) return value.map(copy);
				const prototype = Object.getPrototypeOf(value);
				if (prototype !== Object.prototype && prototype !== null) {
					throw new Error("Unsupported physical contract prototype.");
				}
				return Object.fromEntries(
					Object.keys(value)
						.sort()
						.map((key) => [key, copy(value[key])]),
				);
			} finally {
				ancestors.delete(value);
			}
		};
		// Both compiler source revisions are bound above. Omit exactly those identity
		// fields from the detached oracle; keep every other field and typed byte.
		const contract = copy(
			Object.fromEntries(
				Object.entries(layout)
					.filter(([key]) => key !== "revision")
					.map(([key, value]) => [
						key,
						key === "paths"
							? Object.fromEntries(
									Object.entries(value).filter(([pathKey]) => pathKey !== "revision"),
								)
							: value,
					]),
			),
		);
		return { revision: layout.revision, contract };
	});
}

export async function readAssembleContext(page) {
	return page.evaluate(() => {
		const app = document.querySelector('[data-testid="tilefab-app"]');
		const status = document.querySelector('[data-testid="rail-status-message"]');
		if (!app || !status || typeof status.textContent !== "string")
			throw new Error("Required OpenFab app/status readout is missing.");
		const required = (name) => {
			if (!app.hasAttribute(name)) throw new Error(`Required App readout is missing: ${name}`);
			return app.getAttribute(name);
		};
		const optional = (name) => ({
			present: app.hasAttribute(name),
			value: app.hasAttribute(name) ? app.getAttribute(name) : null,
		});
		return {
			activity: required("data-editor-activity"),
			tool: required("data-editor-tool"),
			selection: required("data-organization-selection-ids"),
			selectionCount: required("data-organization-selection-count"),
			loopOwner: required("data-process-loop-edit-owner"),
			operation: required("data-project-operation"),
			loopOperation: required("data-process-loop-operation"),
			menuPresent: document.querySelector('[data-testid="static-fab-assemble-menu"]') !== null,
			semanticDialog:
				document.querySelector('[data-testid="semantic-bay-command-dialog"]') !== null,
			flowDialog: document.querySelector('[data-testid="bay-flow-edit-dialog"]') !== null,
			semanticPhase: required("data-semantic-bay-command-phase"),
			flowPhase: required("data-bay-flow-edit-command-phase"),
			semanticStart: optional("data-semantic-bay-command-started-at"),
			flowStart: optional("data-bay-flow-edit-command-started-at"),
			semanticSnapshot: optional("data-semantic-bay-snapshot-status"),
			flowSnapshot: optional("data-bay-flow-edit-snapshot-status"),
			status: status.textContent,
		};
	});
}

async function readReplayHead(page) {
	return page.evaluate(() => {
		if (typeof window.__tileFab?.getDocument !== "function")
			throw new Error("Required document read port is missing.");
		const document = window.__tileFab.getDocument();
		for (const method of [
			"canReplayStaticFabAssemblyConnector",
			"canReplayStaticFabArrangement",
			"canReplayStaticFabProcessLoopRegistration",
			"canReplayStaticFabProcessLoopRepair",
		]) {
			if (typeof document?.[method] !== "function")
				throw new Error(`Required history read port is missing: ${method}`);
		}
		if (typeof document.canUndo !== "boolean" || typeof document.canRedo !== "boolean")
			throw new Error("Required history flags are missing.");
		const available = (direction) => {
			const result = {
				connector: document.canReplayStaticFabAssemblyConnector(direction),
				arrangement: document.canReplayStaticFabArrangement(direction),
				loop:
					document.canReplayStaticFabProcessLoopRegistration(direction) ||
					document.canReplayStaticFabProcessLoopRepair(direction),
			};
			if (Object.values(result).some((value) => typeof value !== "boolean"))
				throw new Error("Required history availability readout is invalid.");
			return result;
		};
		return {
			undo: available("undo"),
			redo: available("redo"),
			canUndo: document.canUndo,
			canRedo: document.canRedo,
		};
	});
}

async function measureActualButton(
	page,
	control,
	{ label, minWidth = 44, minHeight = 44 },
	helpers,
) {
	await control.scrollIntoViewIfNeeded();
	// Reuse the current helper's intersection with every overflow-clipping ancestor.
	await helpers.assertLocatorInsideViewport(page, control);
	await helpers.assertLocatorOwnsHitArea(control, label);
	const measured = await control.evaluate((button) => {
		const menu = button.closest('[data-testid="static-fab-assemble-menu"]');
		const rect = button.getBoundingClientRect();
		const menuRect = menu?.getBoundingClientRect();
		const points = [
			[rect.left + rect.width / 2, rect.top + rect.height / 2],
			[rect.left + 4, rect.top + 4],
			[rect.right - 4, rect.top + 4],
			[rect.left + 4, rect.bottom - 4],
			[rect.right - 4, rect.bottom - 4],
		];
		return {
			x: rect.x,
			y: rect.y,
			width: rect.width,
			height: rect.height,
			insideViewport:
				rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
			insideMenu:
				!menuRect ||
				(rect.left >= menuRect.left &&
					rect.top >= menuRect.top &&
					rect.right <= menuRect.right &&
					rect.bottom <= menuRect.bottom),
			pointsOwned: points.map(([x, y]) => button.contains(document.elementFromPoint(x, y))),
		};
	});
	if (measured.height < minHeight || measured.width < minWidth)
		throw new Error(`${label}: undersized actual button ${JSON.stringify(measured)}`);
	requireEqual(measured.insideViewport, true, `${label} entire button inside current viewport`);
	requireEqual(measured.insideMenu, true, `${label} entire button inside current menu clip`);
	requireEqual(
		measured.pointsOwned,
		[true, true, true, true, true],
		`${label} center and four corners own actual hit area`,
	);
	return measured;
}

async function exerciseOwnMenuScroller(page, menu, label, helpers, assertPreserved) {
	const viewport = page.viewportSize();
	if (!viewport || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height))
		throw new Error(`${label}: required measured viewport is missing.`);
	const read = () =>
		menu.evaluate((element) => {
			const workspace = document
				.querySelector('[data-testid="rail-canvas"]')
				?.closest(".tilefab-workspace");
			const aside = element.closest("#tilefab-static-fab-assemble-panel");
			const header = aside?.querySelector(":scope > header");
			if (!workspace || !aside || !header || !element.isConnected)
				throw new Error("Required current menu/aside/header/workspace surface is missing.");
			const rect = (node) => {
				const bounds = node.getBoundingClientRect();
				return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
			};
			const ancestors = [];
			for (let parent = element.parentElement; parent; parent = parent.parentElement) {
				ancestors.push({
					tag: parent.tagName,
					id: parent.id,
					className: parent.className,
					top: parent.scrollTop,
					left: parent.scrollLeft,
				});
			}
			return {
				top: element.scrollTop,
				left: element.scrollLeft,
				overflowY: getComputedStyle(element).overflowY,
				overflowX: element.scrollWidth - element.clientWidth,
				overflowHeight: element.scrollHeight - element.clientHeight,
				page: [scrollX, scrollY],
				workspaceScroll: [workspace.scrollLeft, workspace.scrollTop],
				menu: rect(element),
				aside: rect(aside),
				header: rect(header),
				workspace: rect(workspace),
				ancestors,
			};
		});
	const before = await read();
	requireEqual(before.overflowY, "auto", `${label} menu owns its actual scroller`);
	if (before.overflowX > 0) throw new Error(`${label}: Assemble menu has horizontal overflow.`);
	if (before.overflowHeight <= 1)
		return {
			viewport,
			before,
			after: before,
			range: before.overflowHeight,
			moves: [],
			trace: null,
			wheelExercised: false,
			coverage: "fit-no-wheel-proof",
		};
	const key = "openfabAssemblePendingWheelEvidenceR2";
	await menu.evaluate((element, key) => {
		if (Reflect.has(element, key)) throw new Error("Assemble wheel observer key is already owned.");
		const events = [],
			scrolls = [];
		const listener = (event) => {
			if (events.length >= 20) return;
			const target = event.target;
			const item = {
				deltaY: event.deltaY,
				deltaMode: event.deltaMode,
				isTrusted: event.isTrusted,
				ctrlKey: event.ctrlKey,
				metaKey: event.metaKey,
				shiftKey: event.shiftKey,
				clientX: event.clientX,
				clientY: event.clientY,
				bodyContainsTarget: target instanceof Node && element.contains(target),
				interactiveTarget:
					target instanceof Element &&
					target.closest('button, select, input, textarea, summary, a, [role="button"]') !== null,
				defaultPrevented: event.defaultPrevented,
				scrollTop: element.scrollTop,
				connected: element.isConnected,
				current: element === document.querySelector('[data-testid="static-fab-assemble-menu"]'),
			};
			events.push(item);
			requestAnimationFrame(() => {
				item.defaultPrevented = event.defaultPrevented;
			});
		};
		const scrollListener = () => {
			if (scrolls.length < 128)
				scrolls.push({ scrollTop: element.scrollTop, at: performance.now() });
		};
		document.addEventListener("wheel", listener, { capture: true, passive: true });
		element.addEventListener("scroll", scrollListener, { passive: true });
		Reflect.set(element, key, { events, scrolls, listener, scrollListener });
	}, key);
	const moves = [];
	let trace;
	const assertStationary = (current, phase) => {
		requireEqual(current.page, before.page, `${label} ${phase} stationary page`);
		requireEqual(
			current.workspaceScroll,
			before.workspaceScroll,
			`${label} ${phase} stationary workspace scroll`,
		);
		requireEqual(
			current.ancestors,
			before.ancestors,
			`${label} ${phase} stationary outer ancestor scroll`,
		);
		requireEqual(current.left, before.left, `${label} ${phase} no horizontal menu movement`);
		for (const node of ["menu", "aside", "header", "workspace"])
			for (const edge of ["top", "bottom", "left", "right"]) {
				if (Math.abs(current[node][edge] - before[node][edge]) > 1)
					throw new Error(`${label}: ${phase} moves ${node}.${edge}.`);
			}
	};
	try {
		if (before.top > 1) {
			moves.push(
				await helpers.checkRepairWheelMovement(page, menu, -2000, `${label} initial up`, false),
			);
			assertStationary(await read(), "initial up");
			await assertPreserved("actual compact menu initial up");
		}
		for (const [delta, end, phase] of [
			[2000, true, "down"],
			[-2000, false, "up"],
			[2000, true, "down again"],
			[-2000, false, "up again"],
		]) {
			// The existing helper finds/rechecks a neutral body-owned point, sends trusted
			// real wheel input, and requires signed movement plus the exact requested endpoint.
			moves.push(
				await helpers.checkRepairWheelMovement(page, menu, delta, `${label} ${phase}`, end),
			);
			assertStationary(await read(), phase);
			await assertPreserved(`actual compact menu ${phase}`);
		}
	} finally {
		trace = await menu.evaluate((element, key) => {
			const state = Reflect.get(element, key);
			if (!state) throw new Error("Assemble wheel observer disappeared before cleanup.");
			document.removeEventListener("wheel", state.listener, true);
			element.removeEventListener("scroll", state.scrollListener);
			Reflect.deleteProperty(element, key);
			return { events: state.events, scrolls: state.scrolls };
		}, key);
	}
	requireEqual(
		trace.events.map((event) => event.deltaY),
		moves.map((move) => move.delta),
		`${label} every actual wheel input delivered exactly`,
	);
	requireEqual(
		trace.events.every(
			(event) =>
				event.isTrusted &&
				event.bodyContainsTarget &&
				event.connected &&
				event.current &&
				!event.interactiveTarget &&
				!event.defaultPrevented &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.shiftKey,
		),
		true,
		`${label} trusted unmodified uncanceled neutral menu wheel`,
	);
	const after = await read();
	if (after.top > 1)
		throw new Error(`${label}: repeated wheel sequence does not restore the actual menu start.`);
	return {
		viewport,
		before,
		after,
		range: before.overflowHeight,
		moves,
		trace,
		wheelExercised: true,
		coverage: "overflow-exact-end-start-repeats",
	};
}

async function installFirstZeroTimerHold(page) {
	await page.evaluate(() => {
		if (window.__openfabAssemblePendingHistoryCheckpoint)
			throw new Error("A prior held-checkpoint harness is still installed.");
		const nativeSet = window.setTimeout,
			nativeClear = window.clearTimeout;
		const queued = new Map();
		let nextId = -1;
		const receipt = { held: 0, released: false, deadlineReleased: false, timer: null };
		const sourceDocument = window.__tileFab.getDocument();
		const sourceMap = sourceDocument.map;
		const restore = () => {
			if (receipt.released) return;
			receipt.released = true;
			window.setTimeout = nativeSet;
			window.clearTimeout = nativeClear;
			nativeClear(deadline);
			for (const { callback, args } of queued.values()) nativeSet(callback, 0, ...args);
			queued.clear();
		};
		const deadline = nativeSet(() => {
			receipt.deadlineReleased = true;
			restore();
		}, 30_000);
		window.setTimeout = (callback, delay, ...args) => {
			if (receipt.held > 0 || Number(delay ?? 0) !== 0 || typeof callback !== "function")
				return nativeSet(callback, delay, ...args);
			const id = nextId--;
			queued.set(id, { callback, args });
			receipt.held++;
			receipt.timer = {
				callback: String(callback),
				stack: new Error().stack,
				loopOperation: document.querySelector('[data-testid="tilefab-app"]')?.dataset
					.processLoopOperation,
			};
			return id;
		};
		window.clearTimeout = (id) => {
			if (!queued.delete(id)) nativeClear(id);
		};
		window.__openfabAssemblePendingHistoryCheckpoint = {
			receipt,
			restore,
			sourceDocument,
			sourceMap,
		};
	});
}

async function readHeldCheckpoint(page) {
	return page.evaluate(() => {
		const hold = window.__openfabAssemblePendingHistoryCheckpoint;
		if (!hold) throw new Error("Held checkpoint harness is missing.");
		return {
			...hold.receipt,
			sameDocument: window.__tileFab.getDocument() === hold.sourceDocument,
			sameMap: window.__tileFab.getDocument().map === hold.sourceMap,
		};
	});
}

async function readRequiredMetrics(page, readMetrics) {
	const metrics = await readMetrics(page);
	for (const key of [
		"physicalPaths",
		"projectId",
		"projectName",
		"projectDirty",
		"modelSequence",
		"modelRevision",
		"modelChecksum",
		"modelPhysicalFingerprint",
		"workerTargetSequence",
		"workerTargetRevision",
		"workerTargetChecksum",
		"workerSequence",
		"workerRevision",
		"workerChecksum",
		"workerPhysicalSequence",
		"workerPhysicalRevision",
		"workerPhysicalFingerprint",
		"equipmentGroups",
		"equipmentPorts",
		"projectBlueprints",
		"staticFabOrganizations",
		"historyCanUndo",
		"historyCanRedo",
		"workerSimulationReady",
		"documentCanUndo",
		"documentCanRedo",
	]) {
		if (
			!Object.hasOwn(metrics, key) ||
			typeof metrics[key] !== "string" ||
			metrics[key].length === 0
		)
			throw new Error(`Required metrics readout is missing: ${key}`);
	}
	for (const key of [
		"physicalPaths",
		"modelSequence",
		"modelRevision",
		"workerTargetSequence",
		"workerTargetRevision",
		"workerSequence",
		"workerRevision",
		"workerPhysicalSequence",
		"workerPhysicalRevision",
		"equipmentGroups",
		"equipmentPorts",
		"projectBlueprints",
		"staticFabOrganizations",
	]) {
		if (!/^\d+$/.test(metrics[key]) || !Number.isSafeInteger(Number(metrics[key])))
			throw new Error(`Required numeric metric is invalid: ${key}`);
	}
	for (const key of [
		"projectDirty",
		"historyCanUndo",
		"historyCanRedo",
		"workerSimulationReady",
		"documentCanUndo",
		"documentCanRedo",
	]) {
		if (!["true", "false"].includes(metrics[key]))
			throw new Error(`Required boolean metric is invalid: ${key}`);
	}
	return metrics;
}

async function readRequiredSource(page, readSource) {
	const source = await readSource(page);
	if (!source || !Array.isArray(source.cells))
		throw new Error("Required canonical authored cells readout is missing.");
	for (const key of ["organizations", "equipment", "relationships", "operations"]) {
		if (!Object.hasOwn(source, key) || !source[key] || typeof source[key] !== "object")
			throw new Error(`Required canonical authored contract is missing: ${key}`);
	}
	return source;
}

// Pure read of the existing BEFORE-NAVIGATION init observer. No missing field falls
// back to zero. Keep its complete ordered start URLs, aggregate accounting, and
// derived per-URL start/termination/live evidence on every sampled phase.
async function readWorkerAccounting(page) {
	return page.evaluate(() => {
		const descriptor = Object.getOwnPropertyDescriptor(
			globalThis,
			"__openfabAcceptanceWorkerStarts",
		);
		const observed = descriptor?.value;
		if (
			!descriptor ||
			descriptor.writable !== false ||
			descriptor.configurable !== false ||
			!observed ||
			typeof observed !== "object"
		)
			throw new Error("Required owned before-navigation Worker observer is missing.");
		const integer = (value, label) => {
			if (!Number.isSafeInteger(value) || value < 0)
				throw new Error(`Required Worker accounting is invalid: ${label}`);
			return value;
		};
		const aggregate = {
			started: integer(observed.workerTotal, "workerTotal"),
			terminated: integer(observed.workerTerminated, "workerTerminated"),
			live: integer(observed.workerLive, "workerLive"),
		};
		if (
			aggregate.started < 1 ||
			!Array.isArray(observed.urls) ||
			observed.urls.some((url) => typeof url !== "string" || url.length === 0)
		)
			throw new Error("Required complete actual Worker start URL trace is missing.");
		if (
			!observed.workerLiveUrls ||
			typeof observed.workerLiveUrls !== "object" ||
			Array.isArray(observed.workerLiveUrls)
		)
			throw new Error("Required Worker live URL accounting is missing.");
		const urls = [...observed.urls];
		const byUrl = {};
		for (const url of urls) {
			if (!Object.hasOwn(byUrl, url)) byUrl[url] = { started: 0, terminated: 0, live: 0 };
			byUrl[url].started++;
		}
		for (const [url, value] of Object.entries(observed.workerLiveUrls)) {
			if (!Object.hasOwn(byUrl, url)) throw new Error(`Live Worker has no start trace: ${url}`);
			const live = integer(value, `workerLiveUrls[${url}]`);
			if (live > byUrl[url].started) throw new Error(`Worker live count exceeds starts: ${url}`);
			byUrl[url].live = live;
		}
		for (const item of Object.values(byUrl)) item.terminated = item.started - item.live;
		const sum = (key) => Object.values(byUrl).reduce((total, item) => total + item[key], 0);
		if (
			aggregate.started !== urls.length ||
			aggregate.started !== sum("started") ||
			aggregate.live !== sum("live") ||
			aggregate.terminated !== sum("terminated") ||
			aggregate.started !== aggregate.terminated + aggregate.live
		)
			throw new Error("Actual Worker lifetime accounting is inconsistent.");
		const canvas = document.querySelector('[data-testid="rail-canvas"]');
		if (!canvas) throw new Error("Required Recovery telemetry surface is missing.");
		const optional = (name) => ({
			present: canvas.hasAttribute(name),
			value: canvas.hasAttribute(name) ? canvas.getAttribute(name) : null,
		});
		return {
			observedAt: performance.now(),
			aggregate,
			urls,
			byUrl,
			recovery: {
				characters: optional("data-autosave-characters"),
				error: optional("data-autosave-error"),
			},
		};
	});
}

function workerSubset(evidence, predicate) {
	return Object.fromEntries(
		Object.entries(evidence.byUrl)
			.filter(([url]) => predicate(url))
			.sort(([a], [b]) => a.localeCompare(b)),
	);
}

function isBayReviewWorker(url) {
	return /staticFabSemanticBayMutationWorker|staticFabBayFlowEditWorker/i.test(url);
}

function requireNoNewBayWorker(baseline, current, label) {
	requireEqual(
		current.urls.slice(0, baseline.urls.length),
		baseline.urls,
		`${label} existing Worker start trace is retained`,
	);
	requireEqual(
		workerSubset(current, isBayReviewWorker),
		workerSubset(baseline, isBayReviewWorker),
		`${label} both actual Bay-review Worker URL lifecycles are unchanged`,
	);
}

function workerDelta(baseline, current) {
	const changes = [];
	for (const url of new Set([...Object.keys(baseline.byUrl), ...Object.keys(current.byUrl)])) {
		// Zero here means absence from an already validated COMPLETE start inventory,
		// never absence of the observer/readout itself.
		const before = baseline.byUrl[url] ?? { started: 0, terminated: 0, live: 0 };
		const after = current.byUrl[url] ?? { started: 0, terminated: 0, live: 0 };
		if (!isDeepStrictEqual(before, after))
			changes.push({
				url,
				before,
				after,
				classification: /openFabProjectSerializationWorker/i.test(url)
					? "source-confirmed-recovery-serialization-permitted"
					: "other-observed-worker-transition",
			});
	}
	return { newStartUrls: current.urls.slice(baseline.urls.length), changes };
}

async function establishWorkerBaseline(page, helpers) {
	// Finish legitimate fixture/startup/review work before taking the held baseline.
	// A later scheduled 1500 ms Recovery serialization remains allowed and runnable.
	await readWorkerAccounting(page);
	await helpers.waitForWorker(page, () => true);
	await page.waitForFunction(
		() => {
			const observer = globalThis.__openfabAcceptanceWorkerStarts;
			if (!observer?.workerLiveUrls)
				throw new Error("Required Worker observer disappeared during fixture settling.");
			return Object.entries(observer.workerLiveUrls).every(
				([url, live]) =>
					live === 0 ||
					!/staticFabAssemblyConnectorWorker|staticFabArrangementWorker|staticFabSemanticBayMutationWorker|staticFabBayFlowEditWorker|openFabProjectSerializationWorker/i.test(
						url,
					),
			);
		},
		undefined,
		{ timeout: 10_000 },
	);
	await helpers.checkRepairSettleFrames(page);
	return readWorkerAccounting(page);
}

// Reuse the acceptance script's existing read/assert/wait helpers via `helpers`.
// Prepare the real UI fixture and open Assemble BEFORE invoking this function.
// `expectedUndoSource` is a five-contract canonical snapshot with allocator high-water retained.
// All setup/precondition failures remain failures; this function never injects a replay or selection.
export async function exerciseAssembleBayActionsDuringHeldReplay(
	page,
	{ kind, releaseMode, selectedBayId, expectedUndoSource, label, compactScroller = false },
	helpers,
) {
	const progress = { kind, releaseMode, label, phase: "preconditions" };
	try {
		if (!["connector", "arrangement", "loop"].includes(kind))
			throw new Error("Unknown replay kind.");
		if (!["release", "cancel-button", "escape"].includes(releaseMode))
			throw new Error("Unknown release mode.");
		if (releaseMode === "release" && !expectedUndoSource)
			throw new Error("Exact expected Undo source is required for normal release.");
		for (const name of [
			"readMetrics",
			"readStandaloneLoopAuthoringContract",
			"assertProjectUnchanged",
			"assertSingleGuidedPortCommit",
			"waitForWorker",
			"assertLocatorInsideViewport",
			"assertLocatorOwnsHitArea",
			"checkRepairSettleFrames",
			"checkRepairNeutralBodyPoint",
			"checkRepairWheelMovement",
		]) {
			if (typeof helpers?.[name] !== "function")
				throw new Error(`Required current acceptance helper is missing: ${name}`);
		}
		const viewport = page.viewportSize();
		if (
			!viewport ||
			!Number.isSafeInteger(viewport.width) ||
			viewport.width <= 0 ||
			!Number.isSafeInteger(viewport.height) ||
			viewport.height <= 0
		)
			throw new Error("Required measured acceptance viewport is missing.");
		const { assertProjectUnchanged, assertSingleGuidedPortCommit, waitForWorker } = helpers;
		const readMetrics = (target) => readRequiredMetrics(target, helpers.readMetrics);
		const readStandaloneLoopAuthoringContract = (target) =>
			readRequiredSource(target, helpers.readStandaloneLoopAuthoringContract);
		const menu = page.getByTestId("static-fab-assemble-menu");
		await menu.waitFor({ state: "visible" });
		const originalUi = await readAssembleContext(page);
		requireEqual(originalUi.activity, "assemble", `${label} Assemble is already active`);
		requireEqual(
			originalUi.selection,
			String(selectedBayId),
			`${label} one exact real Bay selection`,
		);
		requireEqual(originalUi.selectionCount, "1", `${label} one selected Bay`);
		requireEqual(originalUi.semanticDialog, false, `${label} no pre-existing semantic review`);
		requireEqual(originalUi.flowDialog, false, `${label} no pre-existing flow review`);
		requireEqual(
			[originalUi.semanticPhase, originalUi.flowPhase],
			["", ""],
			`${label} no pre-existing Bay session phase`,
		);
		requireEqual(originalUi.operation, "idle", `${label} current project is idle`);
		const originalHead = await readReplayHead(page);
		requireEqual(
			originalHead.undo[kind],
			true,
			`${label} actual ${kind} Undo is the current history head`,
		);
		requireEqual(originalUi.loopOperation, "", `${label} no pre-existing Loop preparation`);
		requireEqual(
			await page.getByTestId("static-fab-arrangement-history").count(),
			0,
			`${label} no pre-existing generic history preparation`,
		);
		for (const [id, statusId, action] of BAY_ACTIONS) {
			requireEqual(
				await menu.getByTestId(id).isEnabled(),
				true,
				`${label} ${action} enabled before hold`,
			);
			requireEqual(
				await menu.getByTestId(statusId).getAttribute("data-ready"),
				"true",
				`${label} ${action} original source availability`,
			);
		}
		const originalWorkers = await establishWorkerBaseline(page, helpers);
		const original = await readMetrics(page);
		const originalSource = await readStandaloneLoopAuthoringContract(page);
		const mirrorActors = workerSubset(originalWorkers, (url) => /railMirrorWorker/i.test(url));
		if (!Object.values(mirrorActors).some((item) => item.live > 0))
			throw new Error(`${label}: actual live mirror Worker evidence is missing.`);
		const workerSamples = [
			{
				phase: "before-hold",
				evidence: originalWorkers,
				deltaFromBaseline: { newStartUrls: [], changes: [] },
			},
		];
		progress.workerSamples = workerSamples;
		let replayActors = null;
		const captureWorkerEvidence = async (phase, protectHeldActors = false) => {
			const evidence = await readWorkerAccounting(page);
			workerSamples.push({
				phase,
				evidence,
				deltaFromBaseline: workerDelta(originalWorkers, evidence),
			});
			requireNoNewBayWorker(originalWorkers, evidence, `${label} ${phase}`);
			requireEqual(
				workerSubset(evidence, (url) => /railMirrorWorker/i.test(url)),
				mirrorActors,
				`${label} ${phase} original actual mirror actor lifecycle preserved`,
			);
			if (protectHeldActors && replayActors)
				requireEqual(
					workerSubset(evidence, (url) => Object.hasOwn(replayActors, url)),
					replayActors,
					`${label} ${phase} actual held replay actor lifecycle preserved`,
				);
			return evidence;
		};
		const reason =
			kind === "loop"
				? "작업 루프 준비를 기다리거나 Esc로 취소하세요"
				: "편집 이력 처리를 기다리거나 Esc로 취소하세요";
		let pendingUi, pending, checkpoint, scroller;
		const attempted = [];
		progress.attempted = attempted;
		progress.phase = "held-input";
		await installFirstZeroTimerHold(page);
		try {
			await page.getByRole("button", { name: "실행 취소", exact: true }).click();
			await page.waitForFunction(
				(historyKind) => {
					const hold = window.__openfabAssemblePendingHistoryCheckpoint;
					const app = document.querySelector('[data-testid="tilefab-app"]');
					const pending =
						historyKind === "loop"
							? app?.dataset.processLoopOperation?.includes("실행 취소 준비")
							: document
									.querySelector('[data-testid="static-fab-arrangement-history"]')
									?.textContent?.includes(
										historyKind === "connector"
											? "계층 연결 실행 취소 준비 중"
											: "정렬 실행 취소 준비 중",
									);
					return Boolean(pending && hold?.receipt.held === 1 && !hold.receipt.released);
				},
				kind,
				{ timeout: 10_000 },
			);
			await twoAnimationFrames(page);
			pending = await readMetrics(page);
			pendingUi = await readAssembleContext(page);
			progress.pendingUi = pendingUi;
			const pendingWorkers = await captureWorkerEvidence("initial actual held checkpoint");
			replayActors = workerSubset(
				pendingWorkers,
				(url) =>
					/railMirrorWorker/i.test(url) ||
					(kind === "loop" &&
						/staticFabProcessLoopTopologyWorker/i.test(url) &&
						pendingWorkers.byUrl[url].live > 0),
			);
			requireEqual(pendingUi.menuPresent, true, `${label} original Assemble menu stays open`);
			requireEqual(
				pendingUi.selection,
				String(selectedBayId),
				`${label} pending replay keeps exact Bay selected`,
			);
			requireEqual(
				[pendingUi.semanticDialog, pendingUi.flowDialog],
				[false, false],
				`${label} held replay opens no Bay dialog`,
			);
			for (const field of [
				"semanticPhase",
				"flowPhase",
				"semanticStart",
				"flowStart",
				"semanticSnapshot",
				"flowSnapshot",
			]) {
				requireEqual(
					pendingUi[field],
					originalUi[field],
					`${label} held replay preserves original Bay session/telemetry ${field}`,
				);
			}
			const assertPreserved = async (action) => {
				const hold = await readHeldCheckpoint(page);
				requireEqual(
					[hold.held, hold.released, hold.deadlineReleased, hold.sameDocument, hold.sameMap],
					[1, false, false, true, true],
					`${label} ${action} uses the same actual held replay before publication`,
				);
				assertProjectUnchanged(
					await readMetrics(page),
					original,
					`${label} ${action} exact source/checksum/sequence/revision/mirror/history`,
				);
				requireEqual(
					await readStandaloneLoopAuthoringContract(page),
					originalSource,
					`${label} ${action} all five authored contracts`,
				);
				requireEqual(
					await readReplayHead(page),
					originalHead,
					`${label} ${action} exact replay availability`,
				);
				await captureWorkerEvidence(action, true);
				requireEqual(
					await readAssembleContext(page),
					pendingUi,
					`${label} ${action} context and absent Bay sessions preserved`,
				);
			};
			await assertPreserved("initial held checkpoint");
			if (compactScroller) {
				scroller = await exerciseOwnMenuScroller(page, menu, label, helpers, assertPreserved);
				await assertPreserved("actual compact menu wheel");
			}
			for (const [id, statusId, action] of BAY_ACTIONS) {
				const control = menu.getByTestId(id);
				requireEqual(
					await control.isDisabled(),
					true,
					`${label} ${action} visibly disabled while held`,
				);
				requireEqual(
					await control.getAttribute("title"),
					reason,
					`${label} ${action} current pending title`,
				);
				requireEqual(
					await menu.getByTestId(statusId).getAttribute("data-ready"),
					"false",
					`${label} ${action} current blocked availability`,
				);
				if (!(await menu.getByTestId(statusId).innerText()).includes(reason))
					throw new Error(`${label}: ${action} does not expose the current pending reason.`);
				const box = await measureActualButton(
					page,
					control,
					{ label: `${label} ${action}` },
					helpers,
				);
				await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
				await twoAnimationFrames(page);
				await assertPreserved(`actual disabled ${action} hit`);
				attempted.push({ action, box });
			}
			if (releaseMode === "cancel-button") {
				const cancel =
					kind === "loop"
						? page.getByTestId("cancel-process-loop-operation")
						: page
								.getByTestId("static-fab-arrangement-history")
								.getByRole("button", { name: / 이력 처리 취소$/ });
				await measureActualButton(
					page,
					cancel,
					{ label: `${label} actual Cancel`, minWidth: 1, minHeight: 1 },
					helpers,
				);
				requireEqual(
					await cancel.isEnabled(),
					true,
					`${label} actual Cancel handle remains enabled`,
				);
				await cancel.click();
			} else if (releaseMode === "escape") {
				await page.getByTestId("rail-canvas").focus();
				await page.keyboard.press("Escape");
			}
			if (releaseMode !== "release") {
				const stillHeld = await readHeldCheckpoint(page);
				requireEqual(
					[stillHeld.held, stillHeld.released, stillHeld.deadlineReleased],
					[1, false, false],
					`${label} explicit cancellation happens before native checkpoint release`,
				);
				assertProjectUnchanged(
					await readMetrics(page),
					original,
					`${label} cancellation request publishes no patch`,
				);
				requireEqual(
					await readStandaloneLoopAuthoringContract(page),
					originalSource,
					`${label} cancellation request preserves all five contracts`,
				);
				// Explicit cancellation may retire a Loop topology actor; keep that full trace.
				// Mirror and Bay-review lifecycle guards remain in force.
				await captureWorkerEvidence(`explicit ${releaseMode} request before release`);
			}
		} catch (error) {
			if (error && typeof error === "object")
				error.openfabAssembleDraftEvidence = {
					kind,
					releaseMode,
					viewport,
					pendingUi: pendingUi ?? null,
					workerSamples,
					attempted,
					checkpoint: await readHeldCheckpoint(page),
				};
			throw error;
		} finally {
			checkpoint = await page.evaluate(() => {
				const hold = window.__openfabAssemblePendingHistoryCheckpoint;
				if (!hold) return null;
				hold.restore();
				delete window.__openfabAssemblePendingHistoryCheckpoint;
				return hold.receipt;
			});
			progress.checkpoint = checkpoint;
			progress.scroller = scroller ?? null;
			progress.phase = "settle-release";
		}
		requireEqual(
			checkpoint?.deadlineReleased,
			false,
			`${label} native timer deadline was not a substitute for release`,
		);
		await page.waitForFunction(
			() =>
				!document.querySelector('[data-testid="static-fab-arrangement-history"]') &&
				!document.querySelector('[data-testid="tilefab-app"]')?.dataset.processLoopOperation,
			undefined,
			{ timeout: 30_000 },
		);
		if (releaseMode !== "release") {
			await waitForWorker(page, () => true);
			const cancelled = await readMetrics(page);
			assertProjectUnchanged(
				cancelled,
				original,
				`${label} explicit ${releaseMode} settles with no source/history/Worker patch`,
			);
			requireEqual(
				await readStandaloneLoopAuthoringContract(page),
				originalSource,
				`${label} cancellation exact five contracts`,
			);
			requireEqual(
				await readReplayHead(page),
				originalHead,
				`${label} cancellation consumes no history entry`,
			);
			await captureWorkerEvidence(`settled explicit ${releaseMode}`);
			for (const [id] of BAY_ACTIONS)
				requireEqual(
					await menu.getByTestId(id).isEnabled(),
					true,
					`${label} availability returns after explicit cancellation`,
				);
			return {
				kind,
				releaseMode,
				viewport,
				checkpoint,
				scroller: scroller ?? null,
				attempted,
				pendingUi,
				workerSamples,
				replayActors,
				pendingSequence: pending.modelSequence,
				cancelledSequence: cancelled.modelSequence,
			};
		}
		await waitForWorker(
			page,
			(metrics) => Number(metrics.modelSequence) === Number(original.modelSequence) + 1,
		);
		const undone = await readMetrics(page);
		assertSingleGuidedPortCommit(undone, original, `${label} released real Undo exactly one patch`);
		requireEqual(
			await readStandaloneLoopAuthoringContract(page),
			expectedUndoSource,
			`${label} Undo exact inverse five contracts with allocator high-water`,
		);
		requireEqual(undone.historyCanRedo, "true", `${label} Undo exposes Redo`);
		await captureWorkerEvidence("actual released Undo");
		progress.phase = "actual-redo-input";
		progress.undone = undone;
		const redo = page.getByLabel("다시 실행", { exact: true });
		requireEqual(await redo.count(), 1, `${label} one actual Redo control`);
		requireEqual(await redo.isEnabled(), true, `${label} actual Redo availability`);
		if (await redo.isVisible()) {
			await redo.click();
			progress.redoInput = "visible-button-click";
		} else {
			requireEqual(await redo.isHidden(), true, `${label} actual compact Redo policy`);
			const canvas = page.getByTestId("rail-canvas");
			await canvas.focus();
			requireEqual(
				await canvas.evaluate((element) => element === document.activeElement),
				true,
				`${label} actual Canvas shortcut focus`,
			);
			await page.keyboard.press("ControlOrMeta+Shift+z");
			progress.redoInput = "focused-canvas-ControlOrMeta+Shift+z";
		}
		progress.phase = "settle-redo";
		await waitForWorker(
			page,
			(metrics) =>
				Number(metrics.modelSequence) === Number(undone.modelSequence) + 1 &&
				metrics.modelChecksum === original.modelChecksum,
		);
		const redone = await readMetrics(page);
		assertSingleGuidedPortCommit(redone, undone, `${label} real Redo exactly one patch`);
		requireEqual(
			await readStandaloneLoopAuthoringContract(page),
			originalSource,
			`${label} Redo exact five contracts`,
		);
		requireEqual(redone.historyCanRedo, original.historyCanRedo, `${label} Redo history restored`);
		await captureWorkerEvidence("actual released Redo");
		return {
			kind,
			releaseMode,
			viewport,
			checkpoint,
			scroller: scroller ?? null,
			attempted,
			pendingUi,
			workerSamples,
			replayActors,
			pendingSequence: pending.modelSequence,
			undoneSequence: undone.modelSequence,
			redoneSequence: redone.modelSequence,
			redoInput: progress.redoInput,
		};
	} catch (error) {
		if (error && typeof error === "object")
			error.openfabAssembleDraftEvidence = {
				...progress,
				heldFailure: error.openfabAssembleDraftEvidence ?? null,
			};
		throw error;
	}
}
