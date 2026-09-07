// Rule 40 — I2S stepping needs an i2so bus. Source: FluidNC/src/Stepping.cpp:45
//   Assert(strncmp("I2S", engine->name, 3) || config->_i2so,
//          "I2SO bus must be configured for this stepping type");
import { type Rule, type Finding, isObj } from "./_shared";

const rule: Rule = {
	id: "40-i2s-bus",
	title: "I2S engine requires i2so bus (Stepping.cpp)",
	run(ctx) {
		const out: Finding[] = [];
		ctx.checked.add("/stepping/engine");
		if (ctx.pinType === "i2so" && !isObj(ctx.config.i2so)) {
			out.push({
				path: "/stepping/engine",
				message: "I2SO bus must be configured for this stepping type",
				level: "error",
			});
		}
		return out;
	},
};
export default rule;
