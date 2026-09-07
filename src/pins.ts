// Code written by: Claude (Anthropic), via Claude Code.
// ESP32 pin capability table, ported from fluid-installer's Boards.ts
// (breiler/fluid-installer, GPL-3 — same license as gSender).

export interface PinDef {
	pin: string; // "gpio.22"
	input: boolean;
	output: boolean;
	pull: boolean; // supports internal pull-up/down
	restricted?: boolean; // never selectable (flash pins etc.)
	comment?: string;
}

const g = (
	n: number,
	input: boolean,
	output: boolean,
	pull: boolean,
	comment?: string,
	restricted = false,
): PinDef => ({ pin: `gpio.${n}`, input, output, pull, comment, restricted });

export const ESP32_PINS: PinDef[] = [
	{ pin: "NO_PIN", input: true, output: true, pull: false },
	g(0, true, true, true, "Bootloader strap pin — usable, but experts only"),
	g(1, false, true, false, "USB/serial TX — using this breaks the console", true),
	g(2, true, true, true, "Boot strap pin; often the on-board LED"),
	g(3, true, false, false, "USB/serial RX — using this breaks the console", true),
	g(4, true, true, true),
	g(5, true, true, true, "Boot strap pin — must be high at reset"),
	g(6, true, true, true, "Used for external flash", true),
	g(7, true, true, true, "Used for external flash", true),
	g(8, true, true, true, "Used for external flash", true),
	g(9, true, true, true, "Used for external flash", true),
	g(10, true, true, true, "Used for external flash", true),
	g(11, true, true, true, "Used for external flash", true),
	g(12, true, true, true, "Boot strap pin — must be low at reset"),
	g(13, true, true, true),
	g(14, true, true, true),
	g(15, true, true, true, "Boot strap pin"),
	g(16, true, true, true),
	g(17, true, true, true),
	g(18, true, true, true),
	g(19, true, true, true),
	g(21, true, true, true, "Default I2C SDA"),
	g(22, true, true, true, "Default I2C SCL"),
	g(23, true, true, true),
	g(25, true, true, true, "DAC capable"),
	g(26, true, true, true, "DAC capable"),
	g(27, true, true, true),
	g(32, true, true, true),
	g(33, true, true, true),
	g(34, true, false, false, "Input only, no internal pull resistors"),
	g(35, true, false, false, "Input only, no internal pull resistors"),
	g(36, true, false, false, "Input only, no internal pull resistors"),
	g(39, true, false, false, "Input only, no internal pull resistors"),
	// I2SO expander outputs (available when an i2so section is configured)
	...Array.from({ length: 32 }, (_, i) => ({
		pin: `i2so.${i}`,
		input: false,
		output: true,
		pull: false,
	})),
];

export const PIN_BY_NAME = new Map(ESP32_PINS.map((p) => [p.pin, p]));

// Parse "gpio.12:pu:low" -> parts. Attribute order in FluidNC is free-form.
export interface ParsedPin {
	base: string; // "gpio.12" | "NO_PIN"
	pull: "" | "pu" | "pd";
	inverted: boolean;
	extras: string[]; // attributes we don't model (":ds", ":high") — preserved
}

export const parsePin = (value: string | undefined): ParsedPin => {
	const parts = String(value ?? "")
		.trim()
		.split(":")
		.filter(Boolean);
	const base = parts.shift() ?? "";
	const norm = base.toLowerCase() === "no_pin" || base === "" ? "NO_PIN" : base;
	const out: ParsedPin = { base: norm, pull: "", inverted: false, extras: [] };
	for (const a of parts) {
		const la = a.toLowerCase();
		if (la === "pu" || la === "pd") out.pull = la;
		else if (la === "low") out.inverted = true;
		else if (la === "high") out.inverted = false;
		else out.extras.push(a);
	}
	return out;
};

export const formatPin = (p: ParsedPin): string => {
	if (p.base === "NO_PIN") return "NO_PIN";
	const attrs = [
		p.pull ? `:${p.pull}` : "",
		p.inverted ? ":low" : "",
		...p.extras.map((e) => `:${e}`),
	].join("");
	return `${p.base}${attrs}`;
};
