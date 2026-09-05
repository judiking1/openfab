/** Count painted text rows without treating a wrapping descendant's box as another text line. */
export async function wrappedTextLineCount(locator) {
	return locator.evaluate((element) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const range = document.createRange();
		const rectangles = [];
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.textContent?.trim()) continue;
			range.selectNodeContents(node);
			for (const rect of range.getClientRects()) {
				if (rect.width > 0 && rect.height > 0) rectangles.push(rect);
			}
		}
		rectangles.sort((left, right) => left.top - right.top || left.left - right.left);
		const rows = [];
		for (const rect of rectangles) {
			// Inline emphasis and fallback fonts can have different glyph tops on the same line.
			const row = rows.find(
				(candidate) =>
					Math.min(candidate.bottom, rect.bottom) - Math.max(candidate.top, rect.top) >
					Math.min(candidate.bottom - candidate.top, rect.height) / 2,
			);
			if (row) {
				row.top = Math.max(row.top, rect.top);
				row.bottom = Math.min(row.bottom, rect.bottom);
			} else rows.push({ top: rect.top, bottom: rect.bottom });
		}
		if (rows.length > 0) return rows.length;
		const style = getComputedStyle(element);
		const lineHeight = Number.parseFloat(style.lineHeight);
		const verticalPadding =
			Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
		return Number.isFinite(lineHeight) && lineHeight > 0
			? Math.max(1, Math.round((element.clientHeight - verticalPadding) / lineHeight))
			: 1;
	});
}

/** Run on the same browser/font engine as acceptance before opening any product journey. */
export async function verifyWrappedTextLineCount(browser) {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.setContent(`
			<style>
				.probe { display: inline-flex; width: 332px; min-height: 44px;
					align-items: center; padding: 0 9px; font: 680 10px/13px Arial, sans-serif; }
				.probe > span { min-width: 0; flex: 1 1 auto; }
			</style>
			<div id="one" class="probe"><span role="status">One <strong>inline</strong> line</span></div>
			<div id="two" class="probe"><span role="status">First line<br>Second line</span></div>
			<div id="three" class="probe"><span role="status">First<br>Second<br>Third</span></div>
			<div id="wrapped" class="probe" style="width:70px;font-family:monospace"><span role="status">XXXXXXXXXX XXXXXXXXXX XXXXXXXXXX</span></div>
			<div id="mixed" class="probe"><span role="status">One <strong style="font-size:12px">inline</strong> line</span></div>
		`);
		for (const [id, expected] of [
			["one", 1],
			["two", 2],
			["three", 3],
			["wrapped", 3],
			["mixed", 1],
		]) {
			const actual = await wrappedTextLineCount(page.locator(`#${id}`));
			if (actual !== expected) {
				throw new Error(`Text line measurement ${id}: expected ${expected}, received ${actual}`);
			}
		}
		return {
			cases: 5,
			coverage: "nested status, explicit breaks, real wrapping, and inline font metrics",
		};
	} finally {
		await context.close();
	}
}
