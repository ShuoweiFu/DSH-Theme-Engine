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
			return h(
				"label",
				{ className: "lg-slider" },
				h("div", { className: "lg-slider-head" }, h("span", null, label), h("b", null, display)),
				h("input", {
					type: "range",
					min,
					max,
					step,
					value,
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
