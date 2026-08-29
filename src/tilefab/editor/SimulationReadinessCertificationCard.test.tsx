import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { compileSimulationReadinessCertificate } from "../compile/SimulationReadinessCertificate";
import { buildSimulationReadinessTestComponents } from "../compile/SimulationReadinessTestFixture";
import { SimulationReadinessCertificationCard } from "./SimulationReadinessCertificationCard";

describe("SimulationReadinessCertificationCard", () => {
	it("keeps certification disabled while an exact prerequisite is blocked", () => {
		const markup = renderToStaticMarkup(
			<SimulationReadinessCertificationCard
				phase="blocked"
				message="Review operational configuration."
				certificate={null}
				canCertify={false}
				onCertify={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="blocked"');
		expect(markup).toContain("Review operational configuration.");
		expect(markup).toContain("disabled");
		expect(markup).toContain("CERTIFY");
	});

	it("discloses the exact limited profile without presenting a run action", () => {
		const certificate = compileSimulationReadinessCertificate(
			buildSimulationReadinessTestComponents(),
		);
		const markup = renderToStaticMarkup(
			<SimulationReadinessCertificationCard
				phase="ready"
				message="Exact source certified."
				certificate={certificate}
				canCertify={false}
				onCertify={vi.fn()}
				onCancel={vi.fn()}
			/>,
		);

		expect(markup).toContain('data-phase="ready"');
		expect(markup).toContain(certificate.readinessProfileId);
		expect(markup).toContain("NO RESIDENT FLEET");
		expect(markup).toContain("No run starts here");
		expect(markup).not.toContain("START RUN");
	});
});
