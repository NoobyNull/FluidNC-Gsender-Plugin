// Rule 10 — pin syntax. Source: FluidNC/src/Pin.cpp (Pin::create / parse).
// Every "*_pin" value must be a recognized pin form; the firmware logs
// "Unknown pin type:<x>" otherwise. Recognized pins are marked checked so the
// failsafe (90) doesn't re-flag them.
import {
	type Rule,
	type Finding,
	KNOWN_PIN_PREFIXES,
	fmtPath,
	isNoPin,
	lc,
	parsePin,
} from "./_shared";

const rule: Rule = {
	id: "10-pin-syntax",
	title: "Pin syntax (Pin.cpp)",
	run(ctx) {
		const out: Finding[] = [];
		for (const { raw, path } of ctx.pins) {
			const base = parsePin(raw).base;
			if (isNoPin(base)) continue;
			const p = fmtPath(path);
			if (!KNOWN_PIN_PREFIXES.some((pre) => lc(base).startsWith(pre))) {
				out.push({ path: p, message: `Unknown pin type:${raw}`, level: "error" });
			} else {
				ctx.checked.add(p); // syntactically recognized
			}
		}
		return out;
	},
};
export default rule;
