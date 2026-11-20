		function Switch({ on, onChange, label }) {
			return h(
				"button",
				{
					type: "button",
					className: "lg-switch",
					role: "switch",
					"aria-checked": on,
					"aria-label": label,
					"data-on": on ? "true" : "false",
					onClick: () => onChange(!on)
				},
				h("i")
			);
		}

		function Slider({ label, value, min, max, step, display, onChange }) {
			const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
			return h(
				"label",
				{ className: "lg-field" },
				h("div", { className: "lg-field-head" }, h("span", null, label), h("b", null, display)),
				h("input", {
					type: "range",
					className: "lg-range",
					min,
					max,
					step,
					value,
					style: { "--lg-fill": `${pct}%` },
					onChange: (event) => onChange(Number(event.target.value))
				})
			);
		}

		function Row({ label, hint, children }) {
			return h(
				"div",
				{ className: "lg-row" },
				h("div", { className: "lg-label" }, h("span", null, label), hint ? h("span", { className: "lg-hint" }, hint) : null),
				children
			);
		}
