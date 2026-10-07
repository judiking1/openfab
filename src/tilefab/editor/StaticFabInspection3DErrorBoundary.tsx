import { Component, createRef, type ReactNode } from "react";

interface StaticFabInspection3DErrorBoundaryProps {
	readonly children: ReactNode;
	readonly onExit: () => void;
	readonly onFailure: () => void;
}

/** Keep a failed deferred inspector isolated from the authored 2D session. */
export class StaticFabInspection3DErrorBoundary extends Component<
	StaticFabInspection3DErrorBoundaryProps,
	{ readonly failed: boolean }
> {
	state = { failed: false };
	private readonly exitButton = createRef<HTMLButtonElement>();

	static getDerivedStateFromError(): { readonly failed: boolean } {
		return { failed: true };
	}

	componentDidCatch(): void {
		this.props.onFailure();
		this.exitButton.current?.focus({ preventScroll: true });
	}

	render(): ReactNode {
		if (!this.state.failed) return this.props.children;
		return (
			<section
				className="tilefab-inspection-3d tilefab-inspection-3d--failed"
				data-testid="static-fab-inspection-3d-failure"
				role="alert"
				aria-label="정적 3D 검사 로딩 실패"
			>
				<strong>정적 3D 검사를 불러오지 못했습니다</strong>
				<p>2D 프로젝트는 그대로 유지됩니다.</p>
				<p>
					2D로 돌아가 현재 프로젝트를 파일로 저장하고 확인한 뒤, 페이지를 새로고침해 다시
					시도하세요.
				</p>
				<button
					ref={this.exitButton}
					type="button"
					className="tilefab-inspection-3d-return"
					onClick={this.props.onExit}
				>
					2D 편집으로 돌아가기
				</button>
			</section>
		);
	}
}
