// Code written by: Claude (Anthropic), via Claude Code.
import { useEffect, useMemo, useState } from "react";
import Form, { getDefaultRegistry } from "@rjsf/core";
import type { RJSFSchema, WidgetProps } from "@rjsf/utils";
import { customizeValidator } from "@rjsf/validator-ajv8";
import Ajv2020 from "ajv/dist/2020";

// The FluidNC schema is JSON Schema draft 2020-12; the default rjsf validator
// uses draft-07 and errors with "no schema with key or ref draft/2020-12".
// Use the 2020 Ajv class so validation actually runs.
const validator = customizeValidator({ AjvClass: Ajv2020 });
import yaml from "js-yaml";
import schemaJson from "./vendor/fluidnc-config-schema.json";
import { validateConfig } from "./validate";
import {
	buildGuidedConfig,
	AXIS_NAMES,
	STEPPING_DEFAULT,
	type GuidedAnswers,
	type Driver,
	type Spindle,
	type Corner,
} from "./guided";
import PinAwareTextWidget from "./PinWidget";

// FluidNC wiki page per config section (verified against wiki.fluidnc.com).
const WIKI = "http://wiki.fluidnc.com/en/config/";
const IO_WIKI = `${WIKI}config_IO`;
const VFD_WIKI = `${WIKI}modbus_vfd`;
const SECTION_WIKI: Record<string, string> = {
	__top: `${WIKI}top_level_config_items`,
	__motor: `${WIKI}trinamic_drivers`,
	__spindle: `${WIKI}config_spindles`,
	axes: `${WIKI}axes`,
	kinematics: `${WIKI}kinematics`,
	control: `${WIKI}control`,
	coolant: `${WIKI}coolant`,
	probe: `${WIKI}probe`,
	user_inputs: `${WIKI}user_inputs`,
	user_outputs: `${WIKI}user_outputs`,
	status_outputs: `${WIKI}status_outputs`,
	sdcard: `${WIKI}sd_card`,
	macros: `${WIKI}macros`,
	start: `${WIKI}start_group`,
	oled: IO_WIKI,
	i2c0: IO_WIKI,
	i2c1: IO_WIKI,
	i2so: IO_WIKI,
	spi: IO_WIKI,
	uart1: `${WIKI}uart_sections`,
	uart2: `${WIKI}uart_sections`,
	uart_channel1: `${WIKI}uart_sections`,
	uart_channel2: `${WIKI}uart_sections`,
	ModbusVFD: VFD_WIKI,
	Huanyang: VFD_WIKI,
	H2A: VFD_WIKI,
	YL620: VFD_WIKI,
	DeltaMS300: VFD_WIKI,
	FolinnBD600: VFD_WIKI,
	H100: VFD_WIKI,
	MollomG70: VFD_WIKI,
	NowForever: VFD_WIKI,
	SiemensV20: VFD_WIKI,
	DanfossVLT2800: VFD_WIKI,
};
const wikiFor = (key?: string) =>
	(key && SECTION_WIKI[key]) || `${WIKI}overview`;

// Per-field help: an ⓘ button that expands a small panel with what the field
// does (the schema description), the allowed values if it's an enum, and a
// "FluidNC wiki ↗" link to the relevant section page (from formContext.wikiUrl).
function HelpTooltip(props: {
	id?: string;
	description?: unknown;
	schema?: {
		enum?: unknown[];
		type?: string | string[];
		default?: unknown;
		minimum?: number;
		maximum?: number;
	};
	registry?: { formContext?: { wikiUrl?: string } };
}) {
	const [open, setOpen] = useState(false);
	const text =
		typeof props.description === "string" ? props.description.trim() : "";
	const s = props.schema ?? {};
	const values = Array.isArray(s.enum) ? s.enum : null;
	const wikiUrl = props.registry?.formContext?.wikiUrl;
	if (!text && !wikiUrl && !values && s.default === undefined) return null;

	// FluidNC-style meta: Type / Range / Default (like the wiki field docs).
	const isPin =
		text.startsWith("FluidNC pin string") || /_pin$/.test(props.id ?? "");
	const jsonType = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
	const typeLabel = isPin ? "Pin" : jsonType;
	let range: string | null = null;
	if (isPin) range = "gpio or i2so";
	else if (values) range = values.map((v) => String(v)).join(", ");
	else if (s.minimum !== undefined || s.maximum !== undefined)
		range = `${s.minimum ?? "…"} to ${s.maximum ?? "…"}`;

	return (
		<span
			className="fnc-help-wrap"
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
			onFocus={() => setOpen(true)}
			onBlur={(e) => {
				// Keep open while focus moves within the widget (e.g. tabbing to the
				// wiki link) — only close when focus leaves it entirely.
				if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
			}}
		>
			<button
				type="button"
				className="fnc-help"
				aria-label="Help"
				title="Help"
				aria-expanded={open}
			>
				?
			</button>
			{open && (
				<div className="fnc-help-panel">
					{typeLabel && (
						<p className="fnc-help-meta">
							<strong>Type:</strong> {typeLabel}
						</p>
					)}
					{range && (
						<p className="fnc-help-meta">
							<strong>Range:</strong> {range}
						</p>
					)}
					{s.default !== undefined && (
						<p className="fnc-help-meta">
							<strong>Default:</strong> <code>{String(s.default)}</code>
						</p>
					)}
					{text && <p className="fnc-help-desc">{text}</p>}
					{wikiUrl && (
						<a href={wikiUrl} target="_blank" rel="noreferrer">
							FluidNC wiki ↗
						</a>
					)}
				</div>
			)}
		</span>
	);
}

// Apple-style toggle switch.
function Toggle({
	on,
	onChange,
	label,
	ariaLabel,
}: {
	on: boolean;
	onChange: (v: boolean) => void;
	label?: string;
	ariaLabel?: string;
}) {
	return (
		<label className="fnc-switch">
			<input
				type="checkbox"
				checked={on}
				aria-label={ariaLabel ?? label}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span className="fnc-switch-track">
				<span className="fnc-switch-thumb" />
			</span>
			{label && <span className="fnc-switch-label">{label}</span>}
		</label>
	);
}

// Number widget that shows the schema default as an example placeholder.
const BaseNumberWidget = getDefaultRegistry().widgets.NumberWidget;
function NumberWidgetWithExample(props: WidgetProps) {
	const ph =
		props.schema?.default !== undefined
			? String(props.schema.default)
			: props.placeholder;
	return <BaseNumberWidget {...props} placeholder={ph} />;
}

// rjsf boolean widget: field name on the left, Apple toggle on the right —
// consistent with the other horizontal rows.
function ToggleWidget(props: WidgetProps) {
	return (
		<div className="fnc-bool-row">
			<span className="fnc-bool-label">{props.label}</span>
			<Toggle
				on={props.value === true}
				onChange={(v) => props.onChange(v)}
				ariaLabel={props.label}
			/>
		</div>
	);
}

// Machine configs vendored from bdring/fluidnc-config-files (official +
// contributed) and FluidNC's example_configs (all GPL-3, same as gSender).
// Lazy glob keeps them out of the main bundle; each loads on selection.
const TEMPLATE_LOADERS = import.meta.glob("./vendor/configs/**/*.yaml", {
	query: "?raw",
	import: "default",
}) as Record<string, () => Promise<string>>;

// "./vendor/configs/official/6_Pack_OLED.yaml" -> { group: "official", label: "6 Pack OLED" }
const templateMeta = (path: string) => {
	const parts = path.replace("./vendor/configs/", "").split("/");
	const group = parts[0];
	const label = parts
		.slice(1)
		.join(" / ")
		.replace(/\.yaml$/, "")
		.replace(/_/g, " ");
	return { group, label };
};

const TEMPLATE_GROUPS: Record<string, { label: string; path: string }[]> = {};
for (const path of Object.keys(TEMPLATE_LOADERS).sort()) {
	const { group, label } = templateMeta(path);
	(TEMPLATE_GROUPS[group] ??= []).push({ label, path });
}

// Board pinout images: auto-discovered from src/assets/pinouts/. Drop an image
// in that folder and it shows up in the Board Pinout viewer — no code change.
// Filename (minus extension, _/- -> space) becomes the label.
const PINOUT_URLS = import.meta.glob(
	"./assets/pinouts/*.{png,jpg,jpeg,svg,webp}",
	{ eager: true, query: "?url", import: "default" },
) as Record<string, string>;
const PINOUTS = Object.entries(PINOUT_URLS)
	.map(([path, url]) => ({
		label: (path.split("/").pop() ?? "")
			.replace(/\.[^.]+$/, "")
			.replace(/[_-]+/g, " "),
		url,
	}))
	.sort((a, b) => a.label.localeCompare(b.label));

// Live template listing from the community repo. GitHub's API and raw hosts
// send CORS headers, so this works straight from the plugin sandbox; the
// vendored set above remains the offline fallback.
const GH_REPO = "bdring/fluidnc-config-files";
const GH_BRANCH = "main";

const fetchGitHubTemplates = async (): Promise<
	{ label: string; path: string }[]
> => {
	const res = await fetch(
		`https://api.github.com/repos/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`,
	);
	if (!res.ok) {
		throw new Error(`GitHub API ${res.status}`);
	}
	const tree = (await res.json()) as {
		tree: { path: string; type: string }[];
	};
	return tree.tree
		.filter((e) => e.type === "blob" && e.path.endsWith(".yaml"))
		.map((e) => ({
			label: e.path.replace(/\.yaml$/, "").replace(/_/g, " "),
			path: e.path,
		}))
		.sort((a, b) => a.label.localeCompare(b.label));
};

// Every pin field references pinAny = oneOf:[pin, pinDeprecated], which rjsf
// renders as a useless "Option 1 / Option 2" type selector. Collapse it to the
// plain pin string so each pin renders as a single field (our PinWidget). The
// deprecated pinext syntax still loads fine — it's just a string.
const schema = structuredClone(schemaJson) as RJSFSchema;
if (schema.$defs?.pinAny && schema.$defs.pin) {
	schema.$defs.pinAny = { ...schema.$defs.pin, default: "NO_PIN" };
}

// "Pick one of many sub-configs" sections (motor driver, kinematics, …) render
// all their options at once. Restructure them into a real oneOf so rjsf shows a
// type picker + only the chosen option's fields. Two shapes:
//  - oneOf with `required:[key]` branches + shared props (motorBlock): move the
//    choice keys into branches, keep shared fields.
//  - maxProperties:1 with all-object properties (kinematicsSection): every
//    property is an exclusive choice.
const makeChoicePicker = (node: unknown): void => {
	if (!node || typeof node !== "object") return;
	const n = node as {
		properties?: Record<string, unknown>;
		oneOf?: { required?: string[] }[];
		maxProperties?: number;
	};
	if (!n.properties) return;

	if (Array.isArray(n.oneOf) && n.oneOf[0]?.required) {
		const keys = n.oneOf
			.map((b) => b.required?.[0])
			.filter((k): k is string => !!k);
		const props = n.properties;
		const shared: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(props)) {
			if (!keys.includes(k)) shared[k] = v;
		}
		n.properties = shared;
		(n as { oneOf: unknown[] }).oneOf = keys.map((k) => ({
			title: k,
			required: [k],
			properties: { [k]: props[k] },
		}));
	} else if (n.maxProperties === 1 && Object.keys(n.properties).length > 1) {
		const props = n.properties;
		(n as { oneOf: unknown[] }).oneOf = Object.keys(props).map((k) => ({
			title: k,
			required: [k],
			properties: { [k]: props[k] },
		}));
		n.properties = {};
		n.maxProperties = undefined;
	}
};
for (const def of Object.values(schema.$defs ?? {})) makeChoicePicker(def);

// oneOf/anyOf branches (e.g. the motor driver picker: standard_stepper,
// tmc_2209, …) carry no title, so rjsf labels them "Option 1..N". Title each
// branch by the property it selects, turning the selector into a real
// driver/type picker that reveals only that choice's fields.
const titleOneOfBranches = (node: unknown): void => {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		node.forEach(titleOneOfBranches);
		return;
	}
	const obj = node as Record<string, unknown>;
	for (const key of ["oneOf", "anyOf"]) {
		const branches = obj[key];
		if (Array.isArray(branches)) {
			for (const b of branches) {
				if (b && typeof b === "object" && !("title" in b)) {
					const req = (b as { required?: string[] }).required?.[0];
					const props = (b as { properties?: object }).properties;
					const name = req || (props && Object.keys(props)[0]);
					if (name) (b as { title?: string }).title = name;
				}
			}
		}
	}
	for (const v of Object.values(obj)) titleOneOfBranches(v);
};
titleOneOfBranches(schema);

// Some fields are intentionally typeless in the schema (e.g. `meta` free-form
// notes, and the on/off flags). rjsf can't render a typeless field ("Unknown
// field type undefined"), which dumps a huge unwrapped error and blows out the
// layout width. Assign a type to every schema leaf that has none: known flags
// become booleans (nice toggles), everything else a string.
const BOOL_KEYS = new Set([
	"verbose_errors",
	"report_inches",
	"use_line_numbers",
	"enable_parking_override_control",
]);
const STRUCTURAL = [
	"type",
	"$ref",
	"properties",
	"oneOf",
	"anyOf",
	"allOf",
	"patternProperties",
	"enum",
	"items",
];
const fixTypelessLeaves = (node: unknown, key?: string): void => {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		node.forEach((n) => fixTypelessLeaves(n));
		return;
	}
	const obj = node as Record<string, unknown>;
	if ("description" in obj && !STRUCTURAL.some((k) => k in obj)) {
		obj.type = key && BOOL_KEYS.has(key) ? "boolean" : "string";
	}
	for (const [k, v] of Object.entries(obj)) fixTypelessLeaves(v, k);
};
fixTypelessLeaves(schema);

// Section groups over the schema's top-level keys, mirroring the FluidNC web
// installer's layout. Keys the schema grows later fall into "Other".
// Tab taxonomy mirrors the FluidNC web installer (General / Axes / IO /
// Spindle), plus a tab for macros/ATC which the installer doesn't cover.
const SECTION_GROUPS: { title: string; keys: string[] }[] = [
	{
		title: "General",
		keys: [
			"name",
			"board",
			"meta",
			"stepping",
			"start",
			"parking",
			"arc_tolerance_mm",
			"junction_deviation_mm",
			"planner_blocks",
			"verbose_errors",
			"report_inches",
			"use_line_numbers",
			"enable_parking_override_control",
		],
	},
	{ title: "Axes", keys: ["axes"] },
	{
		title: "IO",
		keys: [
			"control",
			"probe",
			"user_inputs",
			"coolant",
			"user_outputs",
			"status_outputs",
			"oled",
			"i2so",
			"spi",
			"sdcard",
		],
	},
	{
		title: "Spindle",
		keys: [
			"PWM",
			"10V",
			"DAC",
			"HBridge",
			"Laser",
			"Relay",
			"OnOff",
			"BESC",
			"PlasmaSpindle",
			"NoSpindle",
			"ModbusVFD",
			"Huanyang",
			"H2A",
			"YL620",
			"DeltaMS300",
			"FolinnBD600",
			"H100",
			"MollomG70",
			"NowForever",
			"SiemensV20",
			"DanfossVLT2800",
		],
	},
	{ title: "Macros & ATC", keys: ["macros", "atc_manual"] },
	{
		// uartN / uart_channelN / i2cN are schema patternProperties (any index
		// is legal); we surface the indexes pendants and displays actually use.
		title: "Pendant, UART & Display",
		keys: [
			"oled",
			"i2c0",
			"i2c1",
			"uart1",
			"uart2",
			"uart_channel1",
			"uart_channel2",
		],
	},
];

// Resolve a top-level key to its schema: explicit property, or the matching
// patternProperties entry (uart1, uart_channel1, i2c0, ...).
const schemaForKey = (key: string): unknown => {
	const props = (schema.properties ?? {}) as Record<string, unknown>;
	if (key in props) return props[key];
	for (const [pattern, sub] of Object.entries(
		(schema as { patternProperties?: Record<string, unknown> })
			.patternProperties ?? {},
	)) {
		if (new RegExp(pattern).test(key)) return sub;
	}
	return undefined;
};

// Does a top-level key hold an object section (collapsible) or a scalar field
// (always shown)? Resolves a $ref into $defs before checking.
const resolveRef = (node: unknown): Record<string, unknown> => {
	let cur = node as Record<string, unknown>;
	const defs = (schema.$defs ?? {}) as Record<string, unknown>;
	for (let i = 0; i < 5 && cur && typeof cur.$ref === "string"; i++) {
		const name = cur.$ref.replace("#/$defs/", "");
		cur = defs[name] as Record<string, unknown>;
	}
	return cur ?? {};
};

const isObjectKey = (key: string): boolean => {
	const resolved = resolveRef(schemaForKey(key));
	const t = resolved.type;
	const type = Array.isArray(t) ? t : [t];
	return (
		type.includes("object") ||
		"properties" in resolved ||
		"patternProperties" in resolved ||
		"oneOf" in resolved
	);
};

// A collapsible section with an Apple-style enable toggle. Off = the key is
// absent from config and the body is hidden; on = key present and its form
// renders.
function CollapsibleSection({
	sectionKey,
	present,
	onToggle,
	children,
}: {
	sectionKey: string;
	present: boolean;
	onToggle: (on: boolean) => void;
	children: React.ReactNode;
}) {
	return (
		<div className={`fnc-section ${present ? "open" : ""}`}>
			<div className="fnc-section-head">
				<Toggle on={present} onChange={onToggle} ariaLabel={`Enable ${sectionKey}`} />
				<span className="fnc-section-title">{sectionKey}</span>
				<HelpTooltip description={resolveRef(schemaForKey(sectionKey)).description} />
			</div>
			{present && <div className="fnc-section-body">{children}</div>}
		</div>
	);
}

// One-click starting points for common pendant/display hardware.
// FluidDial wired mode: 1M baud 8N1 + uart_channel with 75ms reporting
// (per FluidNC wiki / bdring's published examples).
const HARDWARE_PRESETS: {
	label: string;
	snippet: Record<string, unknown>;
}[] = [
	{
		label: "FluidDial pendant / display (wired, UART1)",
		snippet: {
			// Generic UART wiring — pins depend on the board (assign txd/rxd per
			// your pinout). Baud/mode/channel match FluidDial's wired protocol.
			uart1: {
				txd_pin: "NO_PIN",
				rxd_pin: "NO_PIN",
				baud: 1000000,
				mode: "8N1",
			},
			uart_channel1: { uart_num: 1, report_interval_ms: 75 },
		},
	},
	{
		label: "OLED status display (I2C 128x64)",
		snippet: {
			i2c0: { sda_pin: "gpio.21", scl_pin: "gpio.22" },
			oled: {
				i2c_num: 0,
				i2c_address: 60,
				width: 128,
				height: 64,
				report_interval_ms: 500,
			},
		},
	},
];

// Deprecated sections (e.g. `extenders`) are hidden — the schema flags them
// "DO NOT USE" and they carry no usable fields.
const isDeprecatedKey = (key: string): boolean => {
	const props = (schema.properties ?? {}) as Record<string, unknown>;
	const node = props[key] as { $ref?: string; deprecated?: boolean } | undefined;
	if (!node) return false;
	if (node.deprecated) return true;
	if (node.$ref) {
		const def = (schema.$defs as Record<string, { deprecated?: boolean }>)?.[
			node.$ref.replace("#/$defs/", "")
		];
		return !!def?.deprecated;
	}
	return false;
};

// Advanced sections intentionally not surfaced in the UI — hand-add in YAML if
// needed. kinematics auto-defaults to Cartesian when absent.
const HIDDEN_KEYS = new Set(["kinematics"]);

const groupedKeys = new Set(SECTION_GROUPS.flatMap((g) => g.keys));
const otherKeys = Object.keys(schema.properties ?? {}).filter(
	(k) => !groupedKeys.has(k) && !isDeprecatedKey(k) && !HIDDEN_KEYS.has(k),
);
if (otherKeys.length) {
	SECTION_GROUPS.push({ title: "Other", keys: otherKeys });
}

const pick = (obj: Record<string, unknown>, keys: string[]) => {
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		if (k in obj) out[k] = obj[k];
	}
	return out;
};

const AXIS_LEVEL_KEYS = [
	"shared_stepper_disable_pin",
	"shared_stepper_reset_pin",
	"homing_runs",
];

// Common Form props shared by every section render.
type FormProps = Omit<
	React.ComponentProps<typeof Form>,
	"schema" | "formData" | "onChange"
>;

// Custom Axes editor: all six axes (X/Y/Z/A/B/C) are always-visible sub-tabs;
// each has an Enable toggle that adds/removes it from the config. Axis-level
// shared pins sit above the tabs.
function AxesEditor({
	axes,
	setAxes,
	formProps,
}: {
	axes: Record<string, unknown>;
	setAxes: (next: Record<string, unknown>) => void;
	formProps: FormProps;
}) {
	const [active, setAxis] = useState("x");

	const levelSchema = {
		type: "object",
		properties: pick(
			(schema.$defs?.axesSection as { properties: Record<string, unknown> })
				.properties,
			AXIS_LEVEL_KEYS,
		) as RJSFSchema["properties"],
		$defs: schema.$defs,
	} as RJSFSchema;

	const levelData = pick(axes, AXIS_LEVEL_KEYS);
	const axisData = (axes[active] ?? {}) as Record<string, unknown>;

	// Split the axis schema: the axis's own settings (steps, rates, homing, …)
	// separate from the motors, so motors render as their own sections. motor0
	// is the primary (always shown, "Motor 1"); motor1 is an optional second
	// motor on the axis (dual-drive), gated behind a toggle ("Motor 2").
	const axisProps = (schema.$defs?.axisLetter as {
		properties: Record<string, unknown>;
	}).properties;
	const axisMainSchema = {
		type: "object",
		properties: Object.fromEntries(
			Object.entries(axisProps).filter(
				([k]) => k !== "motor0" && k !== "motor1",
			),
		) as RJSFSchema["properties"],
		$defs: schema.$defs,
	} as RJSFSchema;
	const motorSchema = {
		...resolveRef(axisProps.motor0),
		$defs: schema.$defs,
	} as RJSFSchema;

	const patchAxis = (patch: Record<string, unknown>) =>
		setAxes({ ...axes, [active]: { ...axisData, ...patch } });

	return (
		<div>
			<p className="fnc-axis-note">
				Shared across <strong>all motors</strong> (global). Individual
				disable/reset pins are set per motor, under each motor's driver.
			</p>
			<Form
				{...formProps}
				schema={levelSchema}
				formData={levelData}
				formContext={{
					...formProps.formContext,
					pathPrefix: "axes",
					wikiUrl: wikiFor("axes"),
				}}
				onChange={(e) => {
					const next = { ...axes };
					for (const k of AXIS_LEVEL_KEYS) delete next[k];
					setAxes({ ...next, ...(e.formData ?? {}) });
				}}
			>
				<span />
			</Form>

			<div className="fnc-axis-tabs">
				{AXIS_NAMES.map((a) => (
					<button
						key={a}
						type="button"
						className={`fnc-axis-tab ${a === active ? "active" : ""}`}
						onClick={() => setAxis(a)}
					>
						{a.toUpperCase()}
						{a in axes && <span className="fnc-dot" />}
					</button>
				))}
			</div>

			<div className="fnc-axis-enable">
				<span className="fnc-bool-label">Enable {active.toUpperCase()} axis</span>
				<Toggle
					ariaLabel={`Enable ${active.toUpperCase()} axis`}
					on={active in axes}
					onChange={(on) => {
						const next = { ...axes };
						if (on) {
							next[active] = axes[active] ?? {};
						} else {
							delete next[active];
						}
						setAxes(next);
					}}
				/>
			</div>

			{active in axes ? (
				<>
					<Form
						{...formProps}
						key={`${active}-main`}
						schema={axisMainSchema}
						formData={axisData}
						formContext={{
							...formProps.formContext,
							pathPrefix: `axes.${active}`,
							wikiUrl: wikiFor("axes"),
						}}
						onChange={(e) => patchAxis(e.formData ?? {})}
					>
						<span />
					</Form>

					<div className="fnc-section open">
						<div className="fnc-section-head">
							<span className="fnc-section-title">Motor 1</span>
							<span className="fnc-motor-note">(motor0 — primary)</span>
						</div>
						<div className="fnc-section-body">
							<Form
								{...formProps}
								key={`${active}-m0`}
								schema={motorSchema}
								formData={(axisData.motor0 ?? {}) as Record<string, unknown>}
								formContext={{
									...formProps.formContext,
									pathPrefix: `axes.${active}.motor0`,
									wikiUrl: SECTION_WIKI.__motor,
								}}
								onChange={(e) => patchAxis({ motor0: e.formData ?? {} })}
							>
								<span />
							</Form>
						</div>
					</div>

					<div className={`fnc-section ${"motor1" in axisData ? "open" : ""}`}>
						<div className="fnc-section-head">
							<Toggle
								ariaLabel="Enable Motor 2"
								on={"motor1" in axisData}
								onChange={(on) => {
									if (on) {
										patchAxis({ motor1: axisData.motor1 ?? {} });
									} else {
										const n = { ...axisData };
										delete n.motor1;
										setAxes({ ...axes, [active]: n });
									}
								}}
							/>
							<span className="fnc-section-title">Motor 2</span>
							<span className="fnc-motor-note">
								(motor1 — second motor, e.g. dual-drive)
							</span>
						</div>
						{"motor1" in axisData && (
							<div className="fnc-section-body">
								<Form
									{...formProps}
									key={`${active}-m1`}
									schema={motorSchema}
									formData={axisData.motor1 as Record<string, unknown>}
									formContext={{
										...formProps.formContext,
										pathPrefix: `axes.${active}.motor1`,
											wikiUrl: SECTION_WIKI.__motor,
									}}
									onChange={(e) => patchAxis({ motor1: e.formData ?? {} })}
								>
									<span />
								</Form>
							</div>
						)}
					</div>
				</>
			) : (
				<p className="fnc-axis-off">
					{active.toUpperCase()} axis is disabled. Enable it to configure.
				</p>
			)}
		</div>
	);
}

// ---- Pin usage analysis ----------------------------------------------------
// The schema validates pin syntax per field; cross-field constraints (a GPIO
// assigned twice, ESP32 hardware limits) need document-wide analysis.

interface PinUse {
	pin: string; // normalized, e.g. "gpio.22"
	path: string; // config path, e.g. "axes.x.motor0.step_pin"
	key: string; // leaf key name
}

const PIN_RE = /^(gpio|i2so|uart_channel\d+)\.(\d+)/i;

// Append v to the array stored at key k, creating it if absent.
const pushInto = <V,>(map: Map<string, V[]>, k: string, v: V) => {
	const arr = map.get(k);
	if (arr) arr.push(v);
	else map.set(k, [v]);
};

// Render a dotted config path (axes.x.motor0.step_pin) in the firmware's
// /axes/X/motor0/step_pin style, so both findings panels read the same way.
const dispPath = (p: string) =>
	"/" +
	p
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.filter(Boolean)
		.map((s) => (s.length === 1 && /[a-z]/.test(s) ? s.toUpperCase() : s))
		.join("/");

const collectPinUses = (
	node: unknown,
	path: string,
	out: PinUse[],
): PinUse[] => {
	if (typeof node === "string") {
		const m = node.trim().match(PIN_RE);
		if (m) {
			out.push({
				pin: `${m[1].toLowerCase()}.${m[2]}`,
				path,
				key: path.split(".").pop() ?? path,
			});
		}
	} else if (node && typeof node === "object" && !Array.isArray(node)) {
		for (const [k, v] of Object.entries(node)) {
			collectPinUses(v, path ? `${path}.${k}` : k, out);
		}
	} else if (Array.isArray(node)) {
		node.forEach((v, i) => collectPinUses(v, `${path}[${i}]`, out));
	}
	return out;
};

// Output-driving leaf keys (heuristic; used for the ESP32 input-only check).
const OUTPUT_KEY_RE =
	/(step|direction|disable|enable|output|pwm|forward|reverse|cs|txd|sck|mosi|data|ws|bck|flood|mist|relay)_pin$/i;

interface PinIssue {
	level: "error" | "warn";
	message: string;
}

const analyzePins = (config: Record<string, unknown>): PinIssue[] => {
	const uses = collectPinUses(config, "", []);
	const issues: PinIssue[] = [];

	const byPin = new Map<string, PinUse[]>();
	for (const u of uses) {
		pushInto(byPin, u.pin, u);
	}

	for (const [pin, list] of byPin) {
		if (list.length > 1) {
			issues.push({
				level: "error",
				message: `${pin} assigned ${list.length}×: ${list.map((u) => dispPath(u.path)).join(", ")}`,
			});
		}
		const m = pin.match(/^gpio\.(\d+)$/);
		if (m) {
			const n = Number(m[1]);
			// Pin existence/flash-pin validity is owned by the firmware-derived
			// validator (rules/20-pin-capability) to avoid double-reporting. The
			// only hardware check unique to this live panel is input-only-as-output.
			if (n >= 34 && n <= 39 && list.some((u) => OUTPUT_KEY_RE.test(u.key))) {
				issues.push({
					level: "warn",
					message: `${pin} is input-only on ESP32 but used as an output (${list
						.filter((u) => OUTPUT_KEY_RE.test(u.key))
						.map((u) => dispPath(u.path))
						.join(", ")})`,
				});
			}
		}
	}

	return issues;
};

// Spindle types grouped so the tab isn't a wall of 20 options: pick a category,
// then a model, then configure only that one. FluidNC stores the spindle as a
// single top-level key (PWM:, Huanyang:, …), so selecting one removes the rest.
const SPINDLE_CATEGORIES: Record<string, string[]> = {
	None: [],
	"Simple (relay / on-off / PWM / 0-10V)": [
		"PWM",
		"10V",
		"DAC",
		"Relay",
		"OnOff",
		"HBridge",
		"BESC",
		"Laser",
		"PlasmaSpindle",
	],
	"VFD (generic Modbus)": ["ModbusVFD"],
	"Commercial / professional": [
		"Huanyang",
		"H2A",
		"YL620",
		"DeltaMS300",
		"FolinnBD600",
		"H100",
		"MollomG70",
		"NowForever",
		"SiemensV20",
		"DanfossVLT2800",
	],
};
const ALL_SPINDLE_KEYS = Object.values(SPINDLE_CATEGORIES).flat();
const spindleCategoryOf = (type: string) =>
	Object.keys(SPINDLE_CATEGORIES).find((c) =>
		SPINDLE_CATEGORIES[c].includes(type),
	) ?? "None";

function SpindleEditor({
	config,
	setConfig,
	formProps,
}: {
	config: Record<string, unknown>;
	setConfig: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
	formProps: FormProps;
}) {
	const currentType = ALL_SPINDLE_KEYS.find((k) => k in config) ?? null;
	const [category, setCategory] = useState(() =>
		currentType ? spindleCategoryOf(currentType) : "None",
	);
	useEffect(() => {
		if (currentType) setCategory(spindleCategoryOf(currentType));
	}, [currentType]);

	const clearSpindle = (prev: Record<string, unknown>) => {
		const next = { ...prev };
		for (const k of ALL_SPINDLE_KEYS) delete next[k];
		return next;
	};

	const chooseType = (type: string) => {
		setConfig((prev) => {
			const next = clearSpindle(prev);
			if (type) next[type] = prev[type] ?? {};
			return next;
		});
	};

	const spindleSchema = currentType
		? ({ ...resolveRef(schema.properties?.[currentType]), $defs: schema.$defs } as RJSFSchema)
		: null;

	return (
		<div>
			<div className="fnc-axis-enable">
				<span className="fnc-bool-label">Spindle type</span>
				<select
					value={category}
					onChange={(e) => {
						setCategory(e.target.value);
						setConfig(clearSpindle);
					}}
				>
					{Object.keys(SPINDLE_CATEGORIES).map((c) => (
						<option key={c} value={c}>
							{c}
						</option>
					))}
				</select>
			</div>

			{category !== "None" && (
				<div className="fnc-axis-enable">
					<span className="fnc-bool-label">Model</span>
					<select
						value={currentType ?? ""}
						onChange={(e) => chooseType(e.target.value)}
					>
						<option value="">Select a model…</option>
						{SPINDLE_CATEGORIES[category].map((t) => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</select>
				</div>
			)}

			{currentType && spindleSchema ? (
				<div className="fnc-section open">
					<div className="fnc-section-head">
						<span className="fnc-section-title">{currentType}</span>
					</div>
					<div className="fnc-section-body">
						<Form
							{...formProps}
							key={currentType}
							schema={spindleSchema}
							formData={(config[currentType] ?? {}) as Record<string, unknown>}
							formContext={{
								...formProps.formContext,
								pathPrefix: currentType,
									wikiUrl: SECTION_WIKI[currentType] ?? SECTION_WIKI.__spindle,
							}}
							onChange={(e) =>
								setConfig((prev) => ({
									...prev,
									[currentType]: e.formData ?? {},
								}))
							}
						>
							<span />
						</Form>
					</div>
				</div>
			) : (
				category !== "None" && (
					<p className="fnc-axis-off">Select a model to configure it.</p>
				)
			)}
		</div>
	);
}

// Renders a section group: scalar fields in one always-shown form, and each
// object sub-section as a collapsible card with an Apple enable toggle.
function SectionEditor({
	group,
	config,
	setConfig,
	formProps,
}: {
	group: { title: string; keys: string[] };
	config: Record<string, unknown>;
	setConfig: (fn: (prev: Record<string, unknown>) => Record<string, unknown>) => void;
	formProps: FormProps;
}) {
	const scalarKeys = group.keys.filter(
		(k) => schemaForKey(k) && !isObjectKey(k),
	);
	const objectKeys = group.keys.filter((k) => isObjectKey(k));

	// A uart_channelN needs its physical uartN enabled (linked via uart_num).
	// Prompt when a channel is turned on but its uart isn't configured.
	const [uartPrompt, setUartPrompt] = useState<string | null>(null);
	const enableUart = (n: string, scroll = false) => {
		setConfig((prev) => ({ ...prev, [`uart${n}`]: prev[`uart${n}`] ?? {} }));
		setUartPrompt(null);
		if (scroll) {
			setTimeout(() => {
				const title = [...document.querySelectorAll(".fnc-section-title")].find(
					(t) => t.textContent === `uart${n}`,
				);
				title?.scrollIntoView({ behavior: "smooth", block: "center" });
			}, 100);
		}
	};

	const scalarSchema = {
		type: "object",
		properties: Object.fromEntries(
			scalarKeys.map((k) => [k, schemaForKey(k)]),
		) as RJSFSchema["properties"],
		$defs: schema.$defs,
	} as RJSFSchema;

	return (
		<div>
			{scalarKeys.length > 0 && (
				<Form
					{...formProps}
					schema={scalarSchema}
					formData={pick(config, scalarKeys)}
					formContext={{ ...formProps.formContext, wikiUrl: SECTION_WIKI.__top }}
					onChange={(e) => {
						const data = (e.formData ?? {}) as Record<string, unknown>;
						setConfig((prev) => {
							const next = { ...prev };
							for (const k of scalarKeys) delete next[k];
							return { ...next, ...data };
						});
					}}
				>
					<span />
				</Form>
			)}

			{objectKeys.map((k) => (
				<CollapsibleSection
					key={k}
					sectionKey={k}
					present={k in config}
					onToggle={(on) => {
						setConfig((prev) => {
							if (on) return { ...prev, [k]: prev[k] ?? {} };
							const next = { ...prev };
							delete next[k];
							return next;
						});
						const m = k.match(/^uart_channel(\d+)$/);
						if (on && m && !(`uart${m[1]}` in config)) {
							setUartPrompt(m[1]);
						}
					}}
				>
					<Form
						{...formProps}
						schema={{ ...resolveRef(schemaForKey(k)), $defs: schema.$defs } as RJSFSchema}
						formData={(config[k] ?? {}) as Record<string, unknown>}
						formContext={{ ...formProps.formContext, pathPrefix: k, wikiUrl: wikiFor(k) }}
						onChange={(e) =>
							setConfig((prev) => ({ ...prev, [k]: e.formData ?? {} }))
						}
					>
						<span />
					</Form>
				</CollapsibleSection>
			))}


			{uartPrompt && (
				<div className="fnc-modal-overlay" onClick={() => setUartPrompt(null)}>
					<div className="fnc-modal" onClick={(e) => e.stopPropagation()}>
						<p>
							<strong>UART{uartPrompt} isn't configured.</strong>
						</p>
						<p>
							A UART channel needs its physical port (uart{uartPrompt}) enabled —
							they're linked by the channel's <code>uart_num</code>. Enable it
							now?
						</p>
						<div className="fnc-modal-btns">
							<button
								type="button"
								className="fnc-btn fnc-primary"
								onClick={() => enableUart(uartPrompt)}
							>
								Enable uart{uartPrompt}
							</button>
							<button
								type="button"
								className="fnc-btn"
								onClick={() => enableUart(uartPrompt, true)}
							>
								Enable &amp; go to it
							</button>
							<button
								type="button"
								className="fnc-btn"
								onClick={() => setUartPrompt(null)}
							>
								Not now
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// A fresh FluidNC board always has a config; start from a sensible default
// 3-axis machine (like the firmware's Test Drive) rather than an empty doc.
const DEFAULT_CONFIG: Record<string, unknown> = {
	name: "My CNC",
	board: "None",
	stepping: { ...STEPPING_DEFAULT },
	axes: {
		shared_stepper_disable_pin: "NO_PIN",
		x: {
			steps_per_mm: 80,
			max_rate_mm_per_min: 5000,
			acceleration_mm_per_sec2: 100,
			max_travel_mm: 300,
			motor0: {
				standard_stepper: {
					step_pin: "NO_PIN",
					direction_pin: "NO_PIN",
					disable_pin: "NO_PIN",
				},
			},
		},
		y: {
			steps_per_mm: 80,
			max_rate_mm_per_min: 5000,
			acceleration_mm_per_sec2: 100,
			max_travel_mm: 300,
			motor0: {
				standard_stepper: {
					step_pin: "NO_PIN",
					direction_pin: "NO_PIN",
					disable_pin: "NO_PIN",
				},
			},
		},
		z: {
			steps_per_mm: 400,
			max_rate_mm_per_min: 1000,
			acceleration_mm_per_sec2: 50,
			max_travel_mm: 100,
			motor0: {
				standard_stepper: {
					step_pin: "NO_PIN",
					direction_pin: "NO_PIN",
					disable_pin: "NO_PIN",
				},
			},
		},
	},
};

// Each configured uart_channelN exposes companion I/O pins uart_channelN.0..M-1.
// 18 matches bdring's Airedale STM32 expander; raise if a wider expander ships.
const UART_CHANNEL_PIN_COUNT = 18;

export default function App() {
	const [config, setConfig] = useState<Record<string, unknown>>(
		() => structuredClone(DEFAULT_CONFIG),
	);
	const [sourceName, setSourceName] = useState<string>("(default config)");
	const [error, setError] = useState<string>("");
	const [showYaml, setShowYaml] = useState(true);
	const [section, setSection] = useState(SECTION_GROUPS[0].title);
	const [ghTemplates, setGhTemplates] = useState<
		{ label: string; path: string }[] | null
	>(null);
	const [ghLoading, setGhLoading] = useState(false);
	const [boardHost, setBoardHost] = useState("127.0.0.1");
	const [boardBusy, setBoardBusy] = useState("");
	const [boardMsg, setBoardMsg] = useState("");
	// Editable YAML pane: local draft text + parse error. While the pane is
	// focused we don't overwrite the user's text from the form side.
	const [yamlDraft, setYamlDraft] = useState("");
	const [yamlEditing, setYamlEditing] = useState(false);
	const [yamlError, setYamlError] = useState("");

	const activeGroup =
		SECTION_GROUPS.find((g) => g.title === section) ?? SECTION_GROUPS[0];

	const yamlOut = useMemo(() => {
		try {
			return yaml.dump(config, { noRefs: true, lineWidth: 120 });
		} catch (e) {
			return `# serialization error: ${e}`;
		}
	}, [config]);

	// Keep the editable pane in sync with the form, except while the user is
	// typing in it (so their edits/cursor aren't clobbered).
	useEffect(() => {
		if (!yamlEditing) setYamlDraft(yamlOut);
	}, [yamlOut, yamlEditing]);

	// Parse the pane's YAML back into the config as the user types.
	const onYamlEdit = (text: string) => {
		setYamlDraft(text);
		try {
			const doc = yaml.load(text, { json: true });
			if (doc && typeof doc === "object" && !Array.isArray(doc)) {
				setConfig(doc as Record<string, unknown>);
				setYamlError("");
			} else if (text.trim() === "") {
				setConfig({});
				setYamlError("");
			} else {
				setYamlError("YAML must be a mapping");
			}
		} catch (e) {
			setYamlError(String((e as Error).message).split("\n")[0]);
		}
	};

	const pinIssues = useMemo(() => analyzePins(config), [config]);

	// Firmware-derived validation (TS port of FluidNC's validate() pass).
	// Debounced: the live panel settles ~300ms after you stop editing rather
	// than recomputing on every keystroke. Save validates fresh (below), so a
	// save mid-debounce is never stale.
	const [debouncedConfig, setDebouncedConfig] = useState(config);
	useEffect(() => {
		const t = setTimeout(() => setDebouncedConfig(config), 300);
		return () => clearTimeout(t);
	}, [config]);
	const fwFindings = useMemo(
		() => validateConfig(debouncedConfig),
		[debouncedConfig],
	);
	const fwErrors = fwFindings.filter((f) => f.level === "error").length;

	// Board pinout viewer.
	const [pinoutOpen, setPinoutOpen] = useState(false);
	const [pinoutTab, setPinoutTab] = useState(0);
	const [pinoutZoom, setPinoutZoom] = useState(false);

	// Guided setup wizard (null = closed).
	const [guided, setGuided] = useState<GuidedAnswers | null>(null);
	const [guidedStep, setGuidedStep] = useState(0);
	const openGuided = () => {
		setGuidedStep(0);
		setGuided({
			name: "My CNC",
			units: "mm",
			driver: "standard_stepper",
			axisCount: 3,
			dualMotor: false,
			dualAxis: "y",
			homing: false,
			corner: "front-left",
			spindle: "none",
		});
	};
	const finishGuided = () => {
		if (!guided) return;
		const cfg = buildGuidedConfig(guided);
		loadYamlText(
			yaml.dump(cfg, { noRefs: true, lineWidth: 120 }),
			`${(guided.name || "config").replace(/\s+/g, "_")}.yaml`,
		);
		setGuided(null);
	};

	// pin -> paths using it; consumed by PinAwareTextWidget via formContext.
	const usedPins = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const u of collectPinUses(config, "", [])) {
			pushInto(map, u.pin, u.path);
		}
		return map;
	}, [config]);

	// Extra selectable pins contributed by the current config: each configured
	// uart_channelN exposes uart_channelN.0..17 addressable pins (companion IO
	// over UART — e.g. bdring's Airedale expander adds 18). They appear in the
	// user_inputs/user_outputs pin dropdowns.
	const extraPins = useMemo(() => {
		const pins: { pin: string; pull: boolean; comment?: string }[] = [];
		for (const key of Object.keys(config)) {
			const m = key.match(/^uart_channel(\d+)$/);
			if (m) {
				for (let i = 0; i < UART_CHANNEL_PIN_COUNT; i++) {
					pins.push({
						pin: `uart_channel${m[1]}.${i}`,
						pull: false,
						comment: `UART channel ${m[1]} companion pin ${i}`,
					});
				}
			}
		}
		return pins;
	}, [config]);

	const commonFormProps: FormProps = {
		validator,
		widgets: {
			TextWidget: PinAwareTextWidget,
			NumberWidget: NumberWidgetWithExample,
			CheckboxWidget: ToggleWidget,
		},
		templates: { DescriptionFieldTemplate: HelpTooltip },
		formContext: { usedPins, extraPins },
		idSeparator: "/",
		experimental_defaultFormStateBehavior: {
			emptyObjectFields: "skipDefaults",
		},
		liveValidate: false,
		showErrorList: false,
	};

	const loadYamlText = (text: string, name: string) => {
		try {
			// json:true tolerates duplicated mapping keys (last wins) — FluidNC's
			// own parser accepts them and community configs contain them.
			const doc = yaml.load(text, { json: true });
			if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
				throw new Error("not a YAML mapping");
			}
			setConfig(doc as Record<string, unknown>);
			setSourceName(name);
			setError("");
		} catch (e) {
			setError(`Could not parse ${name}: ${e}`);
		}
	};

	const loadGhList = () => {
		setGhLoading(true);
		fetchGitHubTemplates()
			.then((list) => {
				setGhTemplates(list);
				setError("");
			})
			.catch((e) => setError(`GitHub listing failed: ${e}`))
			.finally(() => setGhLoading(false));
	};

	const loadGhTemplate = (path: string) => {
		fetch(`https://raw.githubusercontent.com/${GH_REPO}/${GH_BRANCH}/${path}`)
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.text();
			})
			.then((text) =>
				loadYamlText(text, path.split("/").pop() ?? "config.yaml"),
			)
			.catch((e) => setError(`GitHub download failed: ${e}`));
	};

	const openFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
		const file = ev.target.files?.[0];
		if (!file) return;
		file.text().then((text) => loadYamlText(text, file.name));
		ev.target.value = "";
	};

	const saveConfigAs = async () => {
		const result = validator.validateFormData(config, schema);
		// Validate fresh here (the live panel is debounced and may lag).
		const liveFindings = validateConfig(config);
		const liveErrors = liveFindings.filter((f) => f.level === "error");
		// Firmware validation takes precedence in the message — it's the one the
		// controller will actually reject on. Structural schema issues are noted too.
		if (liveErrors.length > 0) {
			setError(
				`Firmware validation: ${liveErrors.length} error(s) — the controller will reject this. Saving anyway. First: ${liveErrors[0].message}`,
			);
		} else {
			setError(
				result.errors.length
					? `Config has ${result.errors.length} schema issue(s) — saving anyway. First: ${result.errors[0].stack}`
					: "",
			);
		}
		const name = sourceName.endsWith(".yaml") ? sourceName : "config.yaml";
		// Native "Save As" dialog (lets the user pick the directory) when the
		// File System Access API is available — it is in gSender's Electron
		// Chromium. Fall back to a plain download elsewhere (e.g. Firefox).
		const picker = (
			window as unknown as {
				showSaveFilePicker?: (o: unknown) => Promise<{
					createWritable: () => Promise<{
						write: (d: string) => Promise<void>;
						close: () => Promise<void>;
					}>;
				}>;
			}
		).showSaveFilePicker;
		if (picker) {
			try {
				const handle = await picker({
					suggestedName: name,
					types: [
						{
							description: "FluidNC config",
							accept: { "text/yaml": [".yaml", ".yml"] },
						},
					],
				});
				const w = await handle.createWritable();
				await w.write(yamlOut);
				await w.close();
				return;
			} catch (e) {
				if ((e as Error).name === "AbortError") return; // user cancelled
				// any other error: fall through to the download fallback
			}
		}
		const blob = new Blob([yamlOut], { type: "text/yaml" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		URL.revokeObjectURL(a.href);
	};

	// Escape closes the pinout viewer / guided wizard (modals this component owns).
	useEffect(() => {
		if (!pinoutOpen && !guided) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (pinoutOpen) setPinoutOpen(false);
			else if (guided) setGuided(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [pinoutOpen, guided]);

	// Board sync via gSender's same-origin FluidNC proxy (server relays to the
	// board's WebUI HTTP file API — the sandbox can't reach the board directly).
	const loadFromBoard = () => {
		setBoardBusy("load");
		setBoardMsg("");
		fetch(
			`/api/fluidnc/download?host=${encodeURIComponent(boardHost)}&name=config.yaml`,
		)
			.then(async (r) => {
				const text = await r.text();
				if (!r.ok) {
					let msg = text;
					try {
						msg = JSON.parse(text).msg || text;
					} catch {
						/* plain text */
					}
					throw new Error(msg);
				}
				loadYamlText(text, `config.yaml (from ${boardHost})`);
				setBoardMsg(`Loaded config.yaml from ${boardHost}`);
			})
			.catch((e) => setBoardMsg(`Load failed: ${e.message}`))
			.finally(() => setBoardBusy(""));
	};

	const saveToBoard = () => {
		setBoardBusy("save");
		setBoardMsg("");
		fetch(
			`/api/fluidnc/upload?host=${encodeURIComponent(boardHost)}&name=config.yaml`,
			{
				method: "POST",
				headers: { "Content-Type": "text/plain" },
				body: yamlOut,
			},
		)
			.then(async (r) => {
				const text = await r.text();
				if (!r.ok) {
					let msg = text;
					try {
						msg = JSON.parse(text).msg || text;
					} catch {
						/* plain text */
					}
					throw new Error(msg);
				}
				setBoardMsg(
					`Saved config.yaml to ${boardHost}. Restart the controller ($Bye) to apply.`,
				);
			})
			.catch((e) => setBoardMsg(`Save failed: ${e.message}`))
			.finally(() => setBoardBusy(""));
	};

	return (
		<div className="fnc-root">
			{pinoutOpen && PINOUTS.length > 0 && (
				<div
					className="fnc-modal-overlay"
					onClick={() => setPinoutOpen(false)}
				>
					<div
						className="fnc-modal fnc-pinout-modal"
						role="dialog"
						aria-modal="true"
						aria-label="Board Pinout"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="fnc-guided-head">
							<strong>Board Pinout</strong>
							<button
								type="button"
								className="fnc-btn"
								onClick={() => setPinoutOpen(false)}
							>
								Close
							</button>
						</div>
						{PINOUTS.length > 1 && (
							<div className="fnc-pinout-tabs">
								{PINOUTS.map((p, i) => (
									<button
										key={p.label}
										type="button"
										className={`fnc-btn ${i === pinoutTab ? "fnc-primary" : ""}`}
										onClick={() => {
											setPinoutTab(i);
											setPinoutZoom(false);
										}}
									>
										{p.label}
									</button>
								))}
							</div>
						)}
						<div className={`fnc-pinout-viewport ${pinoutZoom ? "zoomed" : ""}`}>
							<img
								src={PINOUTS[pinoutTab].url}
								alt={PINOUTS[pinoutTab].label}
								className="fnc-pinout-img"
								title="Click to toggle zoom"
								role="button"
								tabIndex={0}
								aria-pressed={pinoutZoom}
								onClick={() => setPinoutZoom((z) => !z)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setPinoutZoom((z) => !z);
									}
								}}
							/>
						</div>
						<p className="fnc-pinout-hint">
							Click the image to toggle zoom.{" "}
							<a
								href={PINOUTS[pinoutTab].url}
								target="_blank"
								rel="noreferrer"
							>
								Open in a window ↗
							</a>{" "}
							to keep it beside the config.
						</p>
					</div>
				</div>
			)}

			{guided &&
				(() => {
					const g = guided;
					// Conservative step-through. Each entry = one screen.
					const steps: { title: string; body: React.ReactNode }[] = [
						{
							title: "Welcome",
							body: (
								<p>
									This builds a <strong>bootable starter config</strong> from a
									few basics. Pins are left empty on purpose — after you finish,
									the firmware validator flags the required <strong>step pins</strong>;
									fill in the rest (direction, limits, spindle) per your wiring in
									the normal editor. You can change anything afterward.
								</p>
							),
						},
						{
							title: "Machine name",
							body: (
								<label className="fnc-guided-row">
									<span>Name</span>
									<input
										value={g.name}
										onChange={(e) => setGuided({ ...g, name: e.target.value })}
									/>
								</label>
							),
						},
						{
							title: "Units",
							body: (
								<label className="fnc-guided-row">
									<span>Display units</span>
									<select
										value={g.units}
										onChange={(e) =>
											setGuided({ ...g, units: e.target.value as "mm" | "inch" })
										}
									>
										<option value="mm">Millimeters</option>
										<option value="inch">Inches</option>
									</select>
								</label>
							),
						},
						{
							title: "Stepper driver",
							body: (
								<label className="fnc-guided-row">
									<span>Driver</span>
									<select
										value={g.driver}
										onChange={(e) =>
											setGuided({ ...g, driver: e.target.value as Driver })
										}
									>
										<option value="standard_stepper">
											External driver (step/dir)
										</option>
										<option value="stepstick">StepStick / Pololu socket</option>
										<option value="tmc_2209">Trinamic TMC2209 (UART)</option>
									</select>
								</label>
							),
						},
						{
							title: "Axes",
							body: (
								<>
									<label className="fnc-guided-row">
										<span>Number of axes</span>
										<select
											value={g.axisCount}
											onChange={(e) =>
												setGuided({ ...g, axisCount: Number(e.target.value) })
											}
										>
											<option value={3}>3 — XYZ</option>
											<option value={4}>4 — XYZA</option>
											<option value={5}>5 — XYZAB</option>
											<option value={6}>6 — XYZABC</option>
										</select>
									</label>
									<label className="fnc-guided-row">
										<span>Dual-motor axis (gantry)</span>
										<Toggle
											on={g.dualMotor}
											onChange={(v) => setGuided({ ...g, dualMotor: v })}
										/>
									</label>
									{g.dualMotor && (
										<label className="fnc-guided-row">
											<span>Which axis has two motors?</span>
											<select
												value={g.dualAxis}
												onChange={(e) =>
													setGuided({ ...g, dualAxis: e.target.value })
												}
											>
												<option value="x">X</option>
												<option value="y">Y</option>
												<option value="z">Z</option>
											</select>
										</label>
									)}
								</>
							),
						},
						{
							title: "Homing",
							body: (
								<>
									<label className="fnc-guided-row">
										<span>Homing</span>
										<select
											value={g.homing ? "yes" : "no"}
											onChange={(e) =>
												setGuided({ ...g, homing: e.target.value === "yes" })
											}
										>
											<option value="no">None</option>
											<option value="yes">Home to a corner (limit switches)</option>
										</select>
									</label>
									{g.homing && (
										<label className="fnc-guided-row">
											<span>Home corner</span>
											<select
												value={g.corner}
												onChange={(e) =>
													setGuided({ ...g, corner: e.target.value as Corner })
												}
											>
												<option value="front-left">Front-left</option>
												<option value="front-right">Front-right</option>
												<option value="back-left">Back-left</option>
												<option value="back-right">Back-right</option>
											</select>
										</label>
									)}
								</>
							),
						},
						{
							title: "Spindle",
							body: (
								<label className="fnc-guided-row">
									<span>Spindle</span>
									<select
										value={g.spindle}
										onChange={(e) =>
											setGuided({ ...g, spindle: e.target.value as Spindle })
										}
									>
										<option value="none">None</option>
										<option value="relay">Relay (on/off)</option>
										<option value="pwm">PWM</option>
										<option value="vfd">VFD (Huanyang / RS485)</option>
									</select>
								</label>
							),
						},
						{
							title: "Review",
							body: (
								<ul className="fnc-guided-review">
									<li>Name: <strong>{g.name}</strong></li>
									<li>Units: <strong>{g.units}</strong></li>
									<li>Driver: <strong>{g.driver}</strong></li>
									<li>Axes: <strong>{g.axisCount}</strong></li>
									<li>
										Dual motor:{" "}
										<strong>
											{g.dualMotor ? `yes (${g.dualAxis.toUpperCase()})` : "no"}
										</strong>
									</li>
									<li>
										Homing:{" "}
										<strong>{g.homing ? `yes (${g.corner})` : "none"}</strong>
									</li>
									<li>Spindle: <strong>{g.spindle}</strong></li>
									<li className="fnc-guided-note">
										Motion values are conservative starters; pins are empty for
										you to fill — the validator flags the required step pins.
									</li>
								</ul>
							),
						},
					];
					const last = guidedStep >= steps.length - 1;
					const step = steps[guidedStep];
					return (
						<div className="fnc-modal-overlay">
							<div
								className="fnc-modal fnc-guided"
								role="dialog"
								aria-modal="true"
								aria-label="Guided Setup"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="fnc-guided-head">
									<strong>Guided Setup</strong>
									<span className="fnc-guided-count">
										Step {guidedStep + 1} of {steps.length} — {step.title}
									</span>
								</div>
								<div className="fnc-guided-body">{step.body}</div>
								<div className="fnc-modal-btns">
									<button
										type="button"
										className="fnc-btn"
										disabled={guidedStep === 0}
										onClick={() => setGuidedStep((s) => Math.max(0, s - 1))}
									>
										Back
									</button>
									{last ? (
										<button
											type="button"
											className="fnc-btn fnc-primary"
											onClick={finishGuided}
										>
											Build config
										</button>
									) : (
										<button
											type="button"
											className="fnc-btn fnc-primary"
											onClick={() =>
												setGuidedStep((s) => Math.min(steps.length - 1, s + 1))
											}
										>
											Next
										</button>
									)}
									<button
										type="button"
										className="fnc-btn"
										onClick={() => setGuided(null)}
									>
										Cancel
									</button>
								</div>
							</div>
						</div>
					);
				})()}
			<header className="fnc-toolbar">
				<strong>FluidNC Configurator</strong>
				<span className="fnc-source">{sourceName}</span>
				<button
					type="button"
					className="fnc-btn fnc-primary"
					onClick={openGuided}
				>
					✨ Guided Setup
				</button>
				{PINOUTS.length > 0 && (
					<button
						type="button"
						className="fnc-btn"
						onClick={() => {
							setPinoutOpen(true);
							setPinoutTab(0);
							setPinoutZoom(false);
						}}
					>
						📌 Board Pinout
					</button>
				)}
				<label className="fnc-btn">
					Open YAML…
					<input
						type="file"
						accept=".yaml,.yml"
						onChange={openFile}
						hidden
					/>
				</label>
				<select
					className="fnc-btn"
					value=""
					onChange={(e) => {
						const path = e.target.value;
						if (!path) return;
						const name = templateMeta(path).label.replace(/ /g, "_");
						TEMPLATE_LOADERS[path]()
							.then((text) => loadYamlText(text, `${name}.yaml`))
							.catch((err) => setError(`Could not load template: ${err}`));
					}}
				>
					<option value="">Start from template…</option>
					{Object.entries(TEMPLATE_GROUPS).map(([group, items]) => (
						<optgroup key={group} label={`${group} (bundled)`}>
							{items.map((t) => (
								<option key={t.path} value={t.path}>
									{t.label}
								</option>
							))}
						</optgroup>
					))}
				</select>
				{ghTemplates === null ? (
					<button
						type="button"
						className="fnc-btn"
						disabled={ghLoading}
						onClick={loadGhList}
					>
						{ghLoading ? "Fetching…" : "Fetch latest from GitHub"}
					</button>
				) : (
					<select
						className="fnc-btn"
						value=""
						onChange={(e) => {
							if (e.target.value) loadGhTemplate(e.target.value);
						}}
					>
						<option value="">
							GitHub templates ({ghTemplates.length})…
						</option>
						{ghTemplates.map((t) => (
							<option key={t.path} value={t.path}>
								{t.label}
							</option>
						))}
					</select>
				)}
				<button
					type="button"
					className="fnc-btn"
					onClick={() => setShowYaml((v) => !v)}
				>
					{showYaml ? "Hide YAML" : "View YAML"}
				</button>
				<button
					type="button"
					className="fnc-btn fnc-primary"
					onClick={saveConfigAs}
				>
					Save Config As…
				</button>
			</header>

			<div className="fnc-board">
				<span className="fnc-board-label">Board</span>
				<input
					className="fnc-board-host"
					value={boardHost}
					onChange={(e) => setBoardHost(e.target.value)}
					placeholder="IP or hostname"
					aria-label="Board IP or hostname"
				/>
				<button
					type="button"
					className="fnc-btn"
					disabled={!!boardBusy}
					onClick={loadFromBoard}
				>
					{boardBusy === "load" ? "Loading…" : "Load from board"}
				</button>
				<button
					type="button"
					className="fnc-btn fnc-primary"
					disabled={!!boardBusy}
					onClick={saveToBoard}
				>
					{boardBusy === "save" ? "Saving…" : "Save to board"}
				</button>
				{boardMsg && <span className="fnc-board-msg">{boardMsg}</span>}
			</div>

			{error && <div className="fnc-error">{error}</div>}

			{pinIssues.length > 0 && (
				<div className="fnc-pins">
					<strong>Pin conflicts ({pinIssues.length})</strong>
					<ul>
						{pinIssues.map((i) => (
							<li
								key={i.message}
								className={i.level === "error" ? "fnc-pin-err" : "fnc-pin-warn"}
							>
								{i.message}
							</li>
						))}
					</ul>
				</div>
			)}

			{fwFindings.length > 0 && (
				<div className="fnc-pins">
					<strong>
						Firmware validation ({fwErrors} error
						{fwErrors === 1 ? "" : "s"}
						{fwFindings.length - fwErrors > 0
							? `, ${fwFindings.length - fwErrors} warning${fwFindings.length - fwErrors === 1 ? "" : "s"}`
							: ""}
						)
					</strong>
					<ul>
						{fwFindings.map((f) => (
							<li
								key={`${f.path}:${f.message}`}
								className={f.level === "error" ? "fnc-pin-err" : "fnc-pin-warn"}
								title={f.rule ? `rule ${f.rule}` : undefined}
							>
								<code>{f.path}</code> — {f.message}
							</li>
						))}
					</ul>
				</div>
			)}

			<div className={`fnc-body ${showYaml ? "with-yaml" : ""}`}>
				<nav className="fnc-nav">
					{SECTION_GROUPS.map((g) => {
						const hasData = g.keys.some((k) => k in config);
						return (
							<button
								key={g.title}
								type="button"
								className={`fnc-nav-item ${g.title === section ? "active" : ""}`}
								onClick={() => setSection(g.title)}
							>
								{g.title}
								{hasData && <span className="fnc-dot" />}
							</button>
						);
					})}
				</nav>

				<main className="fnc-content">
					{activeGroup.title === "Pendant, UART & Display" && (
						<div className="fnc-presets">
							{HARDWARE_PRESETS.map((p) => (
								<button
									key={p.label}
									type="button"
									className="fnc-btn"
									onClick={() =>
										setConfig((prev) => ({ ...prev, ...p.snippet }))
									}
								>
									+ {p.label}
								</button>
							))}
							<span className="fnc-preset-hint">
								Presets insert typical wiring — adjust pins to your board.
							</span>
						</div>
					)}
					{activeGroup.title === "Axes" ? (
						<AxesEditor
							axes={(config.axes ?? {}) as Record<string, unknown>}
							setAxes={(next) =>
								setConfig((prev) => ({ ...prev, axes: next }))
							}
							formProps={commonFormProps}
						/>
					) : activeGroup.title === "Spindle" ? (
						<SpindleEditor
							config={config}
							setConfig={setConfig}
							formProps={commonFormProps}
						/>
					) : (
						<SectionEditor
							key={activeGroup.title}
							group={activeGroup}
							config={config}
							setConfig={setConfig}
							formProps={commonFormProps}
						/>
					)}
				</main>

				{showYaml && (
					<aside className={`fnc-yaml-pane ${yamlEditing ? "expanded" : ""}`}>
						<div className="fnc-yaml-head">
							<span>
								config.yaml{yamlEditing ? " — manual edit" : " (live preview)"}
							</span>
							{yamlError && <span className="fnc-yaml-err"> — {yamlError}</span>}
							<button
								type="button"
								className={`fnc-btn fnc-yaml-editbtn ${yamlEditing ? "active" : ""}`}
								onClick={() => {
									setYamlEditing((v) => !v);
									setYamlError("");
								}}
							>
								{yamlEditing ? "Done" : "Manual Edit"}
							</button>
						</div>
						<textarea
							className="fnc-yaml fnc-yaml-edit"
							spellCheck={false}
							readOnly={!yamlEditing}
							value={yamlDraft}
							onChange={(e) => onYamlEdit(e.target.value)}
						/>
					</aside>
				)}
			</div>

			<footer className="fnc-footer">
				<a
					href="http://wiki.fluidnc.com/en/config/overview"
					target="_blank"
					rel="noreferrer"
				>
					📖 FluidNC wiki
				</a>
				<span className="fnc-footer-sep">·</span>
				<span className="fnc-footer-credits">
					Built on{" "}
					<a href="https://github.com/bdring/FluidNC" target="_blank" rel="noreferrer">
						FluidNC
					</a>
					,{" "}
					<a
						href="https://github.com/bdring/fluidnc-config-files"
						target="_blank"
						rel="noreferrer"
					>
						config-files
					</a>
					,{" "}
					<a
						href="https://github.com/breiler/fluid-installer"
						target="_blank"
						rel="noreferrer"
					>
						fluid-installer
					</a>
					,{" "}
					<a href="https://github.com/cncjs/cncjs" target="_blank" rel="noreferrer">
						cncjs
					</a>
					,{" "}
					<a
						href="https://github.com/Sienci-Labs/gsender"
						target="_blank"
						rel="noreferrer"
					>
						gSender
					</a>
					. Plugin:{" "}
					<a
						href="https://github.com/NoobyNull/FluidNC-Gsender-Plugin"
						target="_blank"
						rel="noreferrer"
					>
						FluidNC-Gsender-Plugin
					</a>
					.
				</span>
			</footer>
		</div>
	);
}
