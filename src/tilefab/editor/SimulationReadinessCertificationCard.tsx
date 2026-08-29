import { AlertTriangle, Check, Cpu, RefreshCcw, ShieldCheck, X } from "lucide-react";
import type { ReactElement } from "react";
import type { SimulationReadinessCertificate } from "../compile/SimulationReadinessCertificate";

export type SimulationReadinessCertificationPhase =
	| "blocked"
	| "eligible"
	| "preparing"
	| "certifying"
	| "ready"
	| "error";

export interface SimulationReadinessCertificationCardProps {
	readonly phase: SimulationReadinessCertificationPhase;
	readonly message: string;
	readonly certificate: SimulationReadinessCertificate | null;
	readonly canCertify: boolean;
	readonly onCertify: () => void;
	readonly onCancel: () => void;
}

export function SimulationReadinessCertificationCard({
	phase,
	message,
	certificate,
	canCertify,
	onCertify,
	onCancel,
}: SimulationReadinessCertificationCardProps): ReactElement {
	const pending = phase === "preparing" || phase === "certifying";
	return (
		<section
			className="tilefab-simulation-certification"
			data-testid="simulation-readiness-certification"
			data-phase={phase}
			aria-label="Simulation readiness certification"
		>
			<header>
				<span>
					{phase === "ready" ? (
						<ShieldCheck size={15} />
					) : phase === "error" || phase === "blocked" ? (
						<AlertTriangle size={15} />
					) : (
						<Cpu size={15} />
					)}
					<strong>SIMULATION READINESS</strong>
				</span>
				<small>{phaseLabel(phase)}</small>
			</header>
			<p>{message}</p>
			{certificate ? (
				<>
					<dl>
						<div>
							<dt>PROFILE</dt>
							<dd>{certificate.readinessProfileId}</dd>
						</div>
						<div>
							<dt>PATHS / RESOURCES</dt>
							<dd>
								{certificate.pathCount.toLocaleString()} /{" "}
								{certificate.trackResourceCount.toLocaleString()}
							</dd>
						</div>
						<div>
							<dt>SNAPSHOT</dt>
							<dd>{formatBytes(certificate.snapshotByteLength)}</dd>
						</div>
					</dl>
					<ul>
						{certificate.limitations.map((limitation) => (
							<li key={limitation}>{limitation.replaceAll("_", " ")}</li>
						))}
					</ul>
				</>
			) : null}
			<footer>
				<small>No run starts here. Every authored mutation invalidates this certificate.</small>
				{pending ? (
					<button type="button" onClick={onCancel}>
						<X size={13} /> CANCEL
					</button>
				) : (
					<button
						type="button"
						className="tilefab-simulation-certify"
						disabled={!canCertify || phase === "ready"}
						onClick={onCertify}
					>
						{phase === "ready" ? (
							<Check size={13} />
						) : phase === "error" ? (
							<RefreshCcw size={13} />
						) : (
							<ShieldCheck size={13} />
						)}
						{phase === "ready" ? "CERTIFIED" : phase === "error" ? "RETRY" : "CERTIFY"}
					</button>
				)}
			</footer>
		</section>
	);
}

function phaseLabel(phase: SimulationReadinessCertificationPhase): string {
	if (phase === "eligible") return "ELIGIBLE";
	if (phase === "preparing") return "BUILDING SNAPSHOT";
	if (phase === "certifying") return "WORKER CERTIFYING";
	if (phase === "ready") return "EXACT CERTIFICATE";
	if (phase === "error") return "CERTIFICATION FAILED";
	return "BLOCKED";
}

function formatBytes(bytes: number): string {
	if (bytes < 1_024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
	return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
