// Code written by: Claude (Anthropic), via Claude Code.
import type { WidgetProps } from "@rjsf/utils";
import { getDefaultRegistry } from "@rjsf/core";
import { ESP32_PINS, type PinDef, parsePin, formatPin } from "./pins";

const DefaultText = getDefaultRegistry().widgets.TextWidget;

// rjsf id ("root/axes/x/motor0/step_pin" with idSeparator="/") -> config path
// in the same format collectPins produces ("axes.x.motor0.step_pin"). A
// pathPrefix (from formContext) is prepended for forms scoped to a sub-object
// (e.g. the per-axis editor renders the axis schema at its root, so its ids
// lack the "axes.x" prefix).
const idToPath = (id: string, prefix = "") => {
	const tail = id
		.replace(/^root\/?/, "")
		.split("/")
		.filter(Boolean)
		.map((s) => (/^\d+$/.test(s) ? `[${s}]` : s))
		.join(".")
		.replace(/\.\[/g, "[");
	return [prefix, tail].filter(Boolean).join(".");
};

const isPinSchema = (schema: WidgetProps["schema"], id: string) =>
	(typeof schema.description === "string" &&
		schema.description.startsWith("FluidNC pin string")) ||
	/_pin$/.test(id.split("/").pop() ?? "");

/**
 * Drop-in TextWidget replacement: renders FluidNC pin fields as a dropdown
 * (with per-pin ESP32 capability info), a pull selector, and an invert
 * checkbox — with pins already assigned elsewhere marked in the list.
 * Non-pin string fields fall through to the default text widget.
 * Ported from fluid-installer's PinField (GPL-3).
 */
export default function PinAwareTextWidget(props: WidgetProps) {
	const { schema, id, value, onChange, formContext } = props;

	if (!isPinSchema(schema, id)) {
		// Show the schema default as an example placeholder (e.g. "255").
		const ph =
			schema.default !== undefined ? String(schema.default) : props.placeholder;
		return <DefaultText {...props} placeholder={ph} />;
	}

	const usedPins: Map<string, string[]> = formContext?.usedPins ?? new Map();
	// uart_channelN.M pins are the Airedale expander's slow digital I/O — valid
	// for any input/output pin (limits, estop/control, probe, coolant, user I/O),
	// but NOT for timing-critical stepper pins or dedicated bus pins. Gate by the
	// field itself, not the section (estop_pin lives under control, not user_*).
	const leafKey = (id.split("/").pop() ?? "").toLowerCase();
	const NO_EXPANDER = new Set([
		"step_pin",
		"direction_pin",
		"txd_pin",
		"rxd_pin",
		"rts_pin",
		"cts_pin",
		"sck_pin",
		"miso_pin",
		"mosi_pin",
		"cs_pin",
		"sda_pin",
		"scl_pin",
		"bck_pin",
		"data_pin",
		"ws_pin",
		"oe_pin",
	]);
	const allowExtra = !NO_EXPANDER.has(leafKey);
	const extraPins: PinDef[] = allowExtra ? (formContext?.extraPins ?? []) : [];
	const allPins = extraPins.length ? [...ESP32_PINS, ...extraPins] : ESP32_PINS;
	const pinByName = new Map(allPins.map((p) => [p.pin, p]));
	const selfPath = idToPath(id, formContext?.pathPrefix ?? "");
	const parsed = parsePin(value);
	// FluidNC pin names are case-insensitive (I2SO.2 == i2so.2), and configs off a
	// board are often uppercase. Match case-insensitively so those pins are
	// recognized (capabilities, not "(custom)"). The stored value is untouched
	// until the user actually changes it.
	const canonical = allPins.find(
		(p) => p.pin.toLowerCase() === parsed.base.toLowerCase(),
	);
	const isKnown = !!canonical;
	const def = canonical;

	const otherUsers = (usedPins.get(parsed.base) ?? []).filter(
		(p) => p !== selfPath,
	);

	const update = (patch: Partial<ReturnType<typeof parsePin>>) => {
		onChange(formatPin({ ...parsed, ...patch }));
	};

	return (
		<div className="fnc-pin">
			<div className="fnc-pin-row">
				<select
					id={id}
					className="fnc-pin-gpio"
					value={canonical ? canonical.pin : "__custom"}
					onChange={(e) => {
						if (e.target.value !== "__custom") {
							const nd = pinByName.get(e.target.value);
							update({
								base: e.target.value,
								// drop a pull that the new pin can't do
								pull: nd?.pull ? parsed.pull : "",
							});
						}
					}}
				>
					{!canonical && (
						<option value="__custom">{parsed.base} (custom)</option>
					)}
					{allPins.map((p) => {
						const users = (usedPins.get(p.pin) ?? []).filter(
							(u) => u !== selfPath,
						);
						const inUse = users.length > 0;
						return (
							<option
								key={p.pin}
								value={p.pin}
								disabled={p.restricted}
							>
								{p.pin}
								{p.restricted ? " — restricted" : ""}
								{inUse ? ` — in use (${users[0]})` : ""}
							</option>
						);
					})}
				</select>

				{/* Always render pull + invert in fixed columns (disabled when N/A)
				    so the layout never shifts as pins are selected. */}
				<select
					className="fnc-pin-pull"
					aria-label="Pull resistor"
					value={parsed.pull}
					disabled={parsed.base === "NO_PIN" || !def?.pull}
					onChange={(e) =>
						update({ pull: e.target.value as "" | "pu" | "pd" })
					}
				>
					<option value="">No pull</option>
					<option value="pu">Pull up</option>
					<option value="pd">Pull down</option>
				</select>

				<label className="fnc-pin-invert">
					<input
						type="checkbox"
						checked={parsed.inverted}
						disabled={parsed.base === "NO_PIN"}
						onChange={(e) => update({ inverted: e.target.checked })}
					/>
					Invert
				</label>
			</div>

			{def?.comment && <div className="fnc-pin-note">{def.comment}</div>}

			{otherUsers.length > 0 && (
				<div className="fnc-pin-conflict">
					⚠ This pin is already used by: {otherUsers.join(", ")}
				</div>
			)}
		</div>
	);
}
