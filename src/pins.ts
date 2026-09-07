// Code written by: Claude (Anthropic), via Claude Code.
// ESP32 pin capability table, ported from fluid-installer's Boards.ts
// (breiler/fluid-installer, GPL-3 — same license as gSender).

export interface PinDef {
	pin: string; // "gpio.22"
	pull: boolean; // supports internal pull-up/down
	restricted?: boolean; // never selectable (flash pins etc.)
	comment?: string;
}

const g = (
	n: number,
	pull: boolean,
	comment?: string,
	restricted = false,
): PinDef => ({ pin: `gpio.${n}`, pull, comment, restricted });

export const ESP32_PINS: PinDef[] = [
	{ pin: "NO_PIN", pull: false },
	g(0, true, "Bootloader strap pin — usable, but experts only"),
	g(1, false, "USB/serial TX — using this breaks the console", true),
	g(2, true, "Boot strap pin; often the on-board LED"),
	g(3, false, "USB/serial RX — using this breaks the console", true),
	g(4, true),
	g(5, true, "Boot strap pin — must be high at reset"),
	g(6, true, "Used for external flash", true),
	g(7, true, "Used for external flash", true),
	g(8, true, "Used for external flash", true),
	g(9, true, "Used for external flash", true),
	g(10, true, "Used for external flash", true),
	g(11, true, "Used for external flash", true),
	g(12, true, "Boot strap pin — must be low at reset"),
	g(13, true),
	g(14, true),
	g(15, true, "Boot strap pin"),
	g(16, true),
	g(17, true),
	g(18, true),
	g(19, true),
	g(21, true, "Default I2C SDA"),
	g(22, true, "Default I2C SCL"),
	g(23, true),
	g(25, true, "DAC capable"),
	g(26, true, "DAC capable"),
	g(27, true),
	g(32, true),
	g(33, true),
	g(34, false, "Input only, no internal pull resistors"),
	g(35, false, "Input only, no internal pull resistors"),
	g(36, false, "Input only, no internal pull resistors"),
	g(39, false, "Input only, no internal pull resistors"),
	// I2SO expander outputs (available when an i2so section is configured)
	...Array.from({ length: 32 }, (_, i) => ({ pin: `i2so.${i}`, pull: false })),
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
