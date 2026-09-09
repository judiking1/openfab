import type {
	StaticFabArrangementBridge,
	StaticFabArrangementInput,
	StaticFabArrangementLiveState,
	StaticFabArrangementSessionInput,
	ValidatedStaticFabArrangement,
} from "./StaticFabArrangementBridge";

type Delegate = Pick<
	StaticFabArrangementBridge,
	"startSession" | "prepare" | "cancelPending" | "dispose"
>;
type LoadDelegate = () => Promise<() => Delegate>;

interface LoadingSession {
	input: StaticFabArrangementSessionInput | null;
	source: StaticFabArrangementLiveState | null;
	readonly revision: number;
	readonly mutationGeneration: number;
	delegate: Delegate | null;
	readonly ready: Promise<Delegate>;
	readonly rejectLoad: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | null;
}

/** Load exact arrangement planning only after the user opens an arrangement session. */
export class DeferredStaticFabArrangementBridge {
	private session: LoadingSession | null = null;
	private pending: { reject: (error: Error) => void } | null = null;
	private readonly load: LoadDelegate;
	private readonly timeoutMilliseconds: number;

	constructor(
		load: LoadDelegate = () =>
			import("./StaticFabArrangementBridge").then(
				(module) => () => new module.StaticFabArrangementBridge(),
			),
		timeoutMilliseconds = 30_000,
	) {
		this.load = load;
		this.timeoutMilliseconds = timeoutMilliseconds;
	}

	startSession(input: StaticFabArrangementSessionInput): void {
		this.dispose();
		const source = input.getCurrentState();
		let resolveReady!: (delegate: Delegate) => void;
		let rejectReady!: (error: Error) => void;
		const ready = new Promise<Delegate>((resolve, reject) => {
			resolveReady = resolve;
			rejectReady = reject;
		});
		const session: LoadingSession = {
			input,
			source,
			revision: source.map.getRevision(),
			mutationGeneration: source.map.getMutationGeneration(),
			delegate: null,
			ready,
			rejectLoad: rejectReady,
			timer: null,
		};
		this.session = session;
		const fail = (error: unknown): void => {
			clearLoadingSource(session);
			rejectReady(error instanceof Error ? error : new Error("정렬 도구를 불러오지 못했습니다"));
		};
		session.timer = setTimeout(
			() => fail(new Error("정렬 도구를 불러오는 시간이 초과되었습니다. 다시 시도하세요.")),
			this.timeoutMilliseconds,
		);
		void Promise.resolve()
			.then(this.load)
			.then((create) => {
				if (this.session !== session || !session.input || !session.source) return;
				const live = session.input.getCurrentState();
				const before = session.source;
				if (
					live.map !== before.map ||
					live.map.getRevision() !== session.revision ||
					live.map.getMutationGeneration() !== session.mutationGeneration ||
					live.patchSequence !== before.patchSequence ||
					live.portEquipment !== before.portEquipment ||
					live.organizations !== before.organizations ||
					live.relationships !== before.relationships
				)
					throw new Error("정렬 도구를 준비하는 동안 FAB가 변경되었습니다. 다시 선택하세요.");
				const delegate = create();
				if (this.session !== session || !session.input) {
					delegate.dispose();
					return;
				}
				try {
					delegate.startSession(session.input);
				} catch (error) {
					delegate.dispose();
					throw error;
				}
				if (this.session !== session) {
					delegate.dispose();
					return;
				}
				session.delegate = delegate;
				clearLoadingSource(session);
				resolveReady(delegate);
			})
			.catch(fail);

		// A session can be cancelled before the debounced first prepare call is made.
		void session.ready.catch(() => {});
	}

	prepare(input: StaticFabArrangementInput): Promise<ValidatedStaticFabArrangement> {
		this.cancelPending();
		const session = this.session;
		if (!session) return Promise.reject(cancelled());
		return new Promise((resolve, reject) => {
			const pending = { reject };
			this.pending = pending;
			void session.ready
				.then((delegate) => {
					if (this.session !== session || this.pending !== pending) throw cancelled();
					return delegate.prepare(input);
				})
				.then(
					(result) => {
						if (this.pending !== pending) return;
						this.pending = null;
						resolve(result);
					},
					(error: unknown) => {
						if (this.pending !== pending) return;
						this.pending = null;
						reject(error);
					},
				);
		});
	}

	cancelPending(): void {
		const pending = this.pending;
		this.pending = null;
		pending?.reject(cancelled());
		this.session?.delegate?.cancelPending();
	}

	cancel(): void {
		this.dispose();
	}

	dispose(): void {
		this.cancelPending();
		const session = this.session;
		this.session = null;
		if (!session) return;
		clearLoadingSource(session);
		session.rejectLoad(cancelled());
		session.delegate?.dispose();
	}
}

function clearLoadingSource(session: LoadingSession): void {
	if (session.timer !== null) clearTimeout(session.timer);
	session.timer = null;
	session.input = null;
	session.source = null;
}

function cancelled(): DOMException {
	return new DOMException("정렬 준비를 취소했습니다.", "AbortError");
}
