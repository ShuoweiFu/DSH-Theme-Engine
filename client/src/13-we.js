		/* ---- Wallpaper Engine center (task 7 / task 10) --------------------- */
		/*
		 * The panel components below are declared at module scope, but the settings
		 * store, the locale subscription and setSettings() live inside apply()'s
		 * closure. apply() publishes those live bindings into panelHooks when it
		 * runs; the thin wrappers keep the components readable (and keep React's
		 * hook order intact — each wrapper adds no hooks of its own).
		 */
		const panelHooks = {
			useSettings: null,
			setSettings: null,
			useLang: null,
			useWallpaper: null,
			useIntelColor: null,
			resampleIntel: null
		};

		function useSettings() {
			return panelHooks.useSettings();
		}

		function setSettings(patch) {
			return panelHooks.setSettings(patch);
		}

		function useLang() {
			return panelHooks.useLang();
		}

		function useWallpaper() {
			return panelHooks.useWallpaper();
		}

		function useIntelColor() {
			return panelHooks.useIntelColor();
		}

		function resampleIntel() {
			return panelHooks.resampleIntel();
		}

		/*
		 * A read-only bridge to the local Steam / Wallpaper Engine installation:
		 * the grid lists the real workshop projects, the apply buttons pin a video
		 * file as the glass wallpaper (the only kind we can read directly), and the
		 * remaining buttons launch Steam / Wallpaper Engine for everything else.
		 * Scenes and web wallpapers have no readable file, so applying one falls
		 * back to the live desktop capture and tells the user to play it in WE.
		 */

		function WeTypeLabel(props) {
			const t = props.t;
			return h("span", { className: "lg-we-type", "data-type": props.type }, t(`weType_${props.type}`));
		}

		function WeFileBrowser(props) {
			const lang = useLang();
			const t = makeTranslate(lang);
			const [path, setPath] = useState(props.path || "");
			const [data, setData] = useState(null);
			useEffect(() => {
				let alive = true;
				fetch(`${API}/fs?path=${encodeURIComponent(path)}`, { cache: "no-store" })
					.then((response) => response.json())
					.then((value) => {
						if (alive) setData(value);
					})
					.catch(() => {
						if (alive) setData({ ok: false, roots: [], dirs: [], files: [] });
					});
				return () => {
					alive = false;
				};
			}, [path]);
			const audioOnly = props.kind === "audio";
			const files = (data && data.files ? data.files : []).filter((file) => (audioOnly ? file.kind === "audio" : file.kind !== "audio"));
			const dirs = data && data.dirs ? data.dirs : [];
			const roots = data && data.roots ? data.roots : [];
			return h(
				"div",
				{ className: "lg-browser" },
				h(
					"div",
					{ className: "lg-browser-bar" },
					h("button", { type: "button", className: "lg-button", onClick: () => setPath("") }, t("browserRoots")),
					data && data.path ? h("button", { type: "button", className: "lg-button", onClick: () => setPath(data.parent || "") }, t("browserUp")) : null,
					h("span", { className: "lg-browser-path", title: (data && data.path) || "" }, (data && data.path) || t("browserRoots")),
					h("button", { type: "button", className: "lg-button", onClick: props.onClose }, t("noticeClose"))
				),
				roots.length
					? h("div", { className: "lg-chips" }, roots.map((root) => h("button", { key: root, type: "button", className: "lg-chip", onClick: () => setPath(root) }, root)))
					: null,
				dirs.length
					? h(
							"div",
							{ className: "lg-browser-list" },
							dirs.map((dir) =>
								h("button", { key: dir.path, type: "button", className: "lg-browser-row", onClick: () => setPath(dir.path) }, `📁 ${dir.name}`)
							)
						)
					: null,
				files.length
					? h(
							"div",
							{ className: "lg-browser-list" },
							files.map((file) =>
								h(
									"button",
									{ key: file.path, type: "button", className: "lg-browser-row", onClick: () => props.onPick(file) },
									`${file.kind === "audio" ? "🎵" : "🎞"} ${file.name} · ${formatBytes(file.size)}`
								)
							)
						)
					: null,
				!roots.length && !dirs.length && !files.length ? h("p", { className: "lg-group-hint" }, t("browserEmpty")) : null
			);
		}

		function WallpaperCenter() {
			const value = useSettings();
			const lang = useLang();
			const t = makeTranslate(lang);
			const [library, setLibrary] = useState(null);
			const [loading, setLoading] = useState(false);
			const [error, setError] = useState("");
			const [search, setSearch] = useState("");
			const [filter, setFilter] = useState("all");
			const [browser, setBrowser] = useState(false);
			const [notice, setNotice] = useState("");
			const [presetName, setPresetName] = useState("");
			const [share, setShare] = useState("");
			const load = useCallback((force) => {
				setLoading(true);
				setError("");
				fetch(`${API}/we${force ? "?force=1" : ""}`, { cache: "no-store" })
					.then((response) => response.json())
					.then((next) => {
						setLibrary(next);
						if (next && next.ok === false) setError(String(next.error ?? "failed"));
					})
					.catch((failure) => setError(String((failure && failure.message) || failure)))
					.finally(() => setLoading(false));
			}, []);
			useEffect(() => {
				load(false);
			}, [load]);
			const launch = (target) => {
				fetch(`${API}/launch?target=${target}`).catch(() => {});
			};
			const installed = Boolean(library && library.installed);
			const current = library && library.current;
			const items = (library && library.items) || [];
			const needle = search.trim().toLowerCase();
			const shown = items.filter((item) => {
				if (filter !== "all" && item.type !== filter) return false;
				return !needle || String(item.title || "").toLowerCase().includes(needle);
			});
			const wp = value.wp || DEFAULT_SETTINGS.wp;
			const presets = Array.isArray(value.wpPresets) ? value.wpPresets : [];
			const patchWp = (patchValue) => setSettings({ wp: { ...wp, ...patchValue } });

			/*
			 * Applying a library entry. A video is readable on disk, so it becomes the
			 * texture directly. Scenes and web wallpapers have no frame we can sample, so
			 * WE is asked to play the item and the glass falls back to the live desktop
			 * capture underneath it; the panel says so instead of silently doing nothing.
			 */
			const applyItem = (item) => {
				if (!item) return;
				if (item.type === "video") {
					setSettings({ module: "wallpaper", source: "we", wePath: item.filePath, weId: item.id, wallpaper: true });
					setNotice(t("weApplied"));
					return;
				}
				setSettings({ module: "wallpaper", source: "desktop", weId: item.id, wallpaper: true });
				fetch(`${API}/we/open?id=${encodeURIComponent(item.id)}`).catch(() => {});
				setNotice(t("weLiveHint"));
			};
			const pickFile = (file) => {
				if (!file || !file.path) return;
				setSettings({ module: "wallpaper", source: "file", filePath: file.path, wallpaper: true });
				setBrowser(false);
			};
			const savePreset = () => {
				const name = presetName.trim() || `${t("wePresets")} ${presets.length + 1}`;
				setSettings({
					wpPresets: [...presets.filter((entry) => entry.name !== name), { name, value: { ...wp } }].slice(-24)
				});
				setPresetName("");
				setNotice(t("wePresetSaved"));
			};
			const loadPreset = (preset) => {
				if (!preset || !preset.value) return;
				setSettings({ wp: { ...wp, ...preset.value } });
				setNotice(t("wePresetLoaded"));
			};
			const removePreset = (name) => setSettings({ wpPresets: presets.filter((entry) => entry.name !== name) });
			const exportPreset = () => setShare(JSON.stringify({ wp }, null, 2));
			const importPreset = () => {
				try {
					const parsed = JSON.parse(share);
					const next = parsed && typeof parsed === "object" && parsed.wp ? parsed.wp : parsed;
					if (!next || typeof next !== "object") throw new Error("no wp");
					setSettings({ wp: { ...wp, ...next } });
					setNotice(t("wePresetLoaded"));
				} catch {
					setNotice(t("weJsonBad"));
				}
			};

			/* The property sheet mirrors Wallpaper Engine's own panel. */
			const sheet = h(
				"div",
				{ className: "lg-wp-sheet" },
				h("h3", { className: "lg-group-title" }, t("weProps")),
				h(
					Row,
					{ label: t("wePropAlign"), hint: t("weHintAlign") },
					h(
						"select",
						{ className: "lg-select", value: wp.fit, onChange: (event) => patchWp({ fit: event.target.value }) },
						h("option", { value: "cover" }, t("weAlignCover")),
						h("option", { value: "contain" }, t("weAlignContain")),
						h("option", { value: "stretch" }, t("weAlignStretch")),
						h("option", { value: "pixel" }, t("weAlignPixel"))
					)
				),
				h(Slider, {
					label: `${t("wePropOffset")} X`,
					value: wp.panX,
					min: 0,
					max: 100,
					step: 1,
					display: `${Math.round(wp.panX)}%`,
					onChange: (next) => patchWp({ panX: next })
				}),
				h(Slider, {
					label: `${t("wePropOffset")} Y`,
					value: wp.panY,
					min: 0,
					max: 100,
					step: 1,
					display: `${Math.round(wp.panY)}%`,
					onChange: (next) => patchWp({ panY: next })
				}),
				h(
					Row,
					{ label: t("wePropFlip") },
					h(
						"div",
						{ className: "lg-actions" },
						h(Switch, { on: wp.flipX, onChange: (next) => patchWp({ flipX: next }), label: `${t("wePropFlip")} X` }),
						h("span", { className: "lg-hint" }, "X"),
						h(Switch, { on: wp.flipY, onChange: (next) => patchWp({ flipY: next }), label: `${t("wePropFlip")} Y` }),
						h("span", { className: "lg-hint" }, "Y")
					)
				),
				h(Slider, {
					label: t("wePropSpeed"),
					value: wp.rate,
					min: 0.25,
					max: 2,
					step: 0.05,
					display: `${Math.round(wp.rate * 100)}%`,
					onChange: (next) => patchWp({ rate: next })
				}),
				h(Slider, {
					label: t("wePropVolume"),
					value: wp.volume,
					min: 0,
					max: 1,
					step: 0.01,
					display: `${Math.round(wp.volume * 100)}`,
					onChange: (next) => patchWp({ volume: next, muted: next > 0 ? false : true })
				}),
				h(
					Row,
					{ label: t("wePropMute"), hint: t("wePropMuteHint") },
					h(Switch, { on: wp.muted, onChange: (next) => patchWp({ muted: next }), label: t("wePropMute") })
				),
				h(
					"div",
					{ className: "lg-actions" },
					h(
						"button",
						{ type: "button", className: "lg-button", onClick: () => setSettings({ wp: { ...DEFAULT_SETTINGS.wp } }) },
						t("wePropReset")
					)
				)
			);

			const presetsBlock = h(
				"div",
				{ className: "lg-wp-sheet" },
				h("h3", { className: "lg-group-title" }, t("wePresets")),
				h(
					"div",
					{ className: "lg-wp-saverow" },
					h("input", {
						className: "lg-input",
						type: "text",
						placeholder: t("wePresetName"),
						value: presetName,
						onChange: (event) => setPresetName(event.target.value)
					}),
					h("button", { type: "button", className: "lg-button", onClick: savePreset }, t("wePresetSave")),
					h("button", { type: "button", className: "lg-button", onClick: exportPreset }, t("weShare")),
					h("button", { type: "button", className: "lg-button", onClick: importPreset }, t("weImport"))
				),
				h("textarea", {
					className: "lg-textarea",
					rows: 3,
					placeholder: t("weShareHint"),
					value: share,
					onChange: (event) => setShare(event.target.value)
				}),
				presets.length
					? h(
							"div",
							{ className: "lg-wp-presets" },
							presets.map((preset) =>
								h(
									"div",
									{ key: preset.name, className: "lg-wp-preset" },
									h("span", { className: "lg-wp-preset-name" }, preset.name),
									h("button", { type: "button", className: "lg-button", onClick: () => loadPreset(preset) }, t("wePresetLoad")),
									h("button", { type: "button", className: "lg-button", onClick: () => removePreset(preset.name) }, t("wePresetDelete"))
								)
							)
						)
					: h("p", { className: "lg-group-hint" }, t("wePresetEmpty"))
			);

			return h(
				"section",
				{ className: "lg-group" },
				h("h2", { className: "lg-group-title" }, t("weGroup")),
				h("p", { className: "lg-group-hint" }, t("weHint")),
				h(
					"div",
					{ className: "lg-we-status" },
					h("span", { className: "lg-dot", "data-state": installed ? (library.running ? "ready" : "idle") : "error" }),
					h("span", null, installed ? (library.running ? t("weRunning") : t("weNotRunning")) : t("weMissing")),
					current && current.title ? h("span", { className: "lg-hint" }, `${t("weCurrent")} ${current.title}`) : null
				),
				installed ? null : h("p", { className: "lg-group-hint" }, t("weNoEngine")),
				installed
					? h(
							"div",
							{ className: "lg-we-tools" },
							h("input", {
								className: "lg-input lg-we-search",
								type: "search",
								placeholder: t("weSearch"),
								value: search,
								onChange: (event) => setSearch(event.target.value)
							}),
							h(
								"div",
								{ className: "lg-chips" },
								["all", "video", "scene", "web"].map((id) =>
									h(
										"button",
										{
											key: id,
											type: "button",
											className: "lg-chip",
											"data-on": filter === id ? "on" : undefined,
											onClick: () => setFilter(id)
										},
										t(`weFilter_${id}`)
									)
								)
							),
							h("button", { type: "button", className: "lg-button", disabled: loading, onClick: () => load(true) }, loading ? t("weLoading") : t("weRefresh")),
							h("button", { type: "button", className: "lg-button", onClick: () => launch("we") }, t("weOpen")),
							h("button", { type: "button", className: "lg-button", onClick: () => launch("steam") }, t("weSteam"))
						)
					: h(
							"div",
							{ className: "lg-we-tools" },
							h("button", { type: "button", className: "lg-button", onClick: () => launch("steam") }, t("weSteam")),
							h(
								"a",
								{
									className: "lg-button",
									href: "https://store.steampowered.com/app/431960/Wallpaper_Engine/",
									target: "_blank",
									rel: "noreferrer"
								},
								t("weStorePage")
							)
						),
				installed && shown.length
					? h(
							"div",
							{ className: "lg-we-grid" },
							shown.map((item) =>
								h(
									"button",
									{
										key: item.id,
										type: "button",
										className: "lg-we-card",
										title: item.title,
										"data-applied": value.source === "we" && value.weId === item.id ? "on" : undefined,
										onClick: () => applyItem(item)
									},
									h(
										"span",
										{ className: "lg-we-thumb" },
										item.preview
											? h("img", { src: `${API}/we/preview?id=${encodeURIComponent(item.id)}`, alt: "", loading: "lazy" })
											: h("span", { className: "lg-we-fallback" }, String(item.type || "").toUpperCase())
									),
									h("span", { className: "lg-we-name" }, item.title),
									h("span", { className: "lg-we-meta" }, h("span", { className: "lg-we-gold", title: t("weGold") }, "WE"), h(WeTypeLabel, { t, type: item.type }))
								)
							)
						)
					: installed
						? h("p", { className: "lg-group-hint" }, t("weEmpty"))
						: null,
				sheet,
				h(
					"div",
					{ className: "lg-row" },
					h(
						"div",
						{ className: "lg-label" },
						h("span", null, t("weCustom")),
						h("span", { className: "lg-hint" }, value.filePath || t("weCustomHint"))
					),
					h(
						"div",
						{ className: "lg-actions" },
						h("button", { type: "button", className: "lg-button", onClick: () => setBrowser((open) => !open) }, t("weBrowse")),
						value.filePath
							? h("button", { type: "button", className: "lg-button", onClick: () => setSettings({ source: "desktop", filePath: "", wallpaper: true }) }, t("weClear"))
							: null
					)
				),
				browser ? h(WeFileBrowser, { path: value.filePath || "", kind: "media", onPick: pickFile, onClose: () => setBrowser(false) }) : null,
				presetsBlock,
				notice ? h("p", { className: "lg-group-hint" }, notice) : null,
				error ? h("p", { className: "lg-group-hint", "data-warn": "on" }, error) : null
			);
		}
		function AppearanceModes() {
			const value = useSettings();
			const lang = useLang();
			const t = makeTranslate(lang);
			const intelColor = useIntelColor();
			const mode = value.colorMode;
			const autoInvertRow = h(
				Row,
				{ label: t("modeAutoInvert"), hint: t("modeAutoInvertHint") },
				h(Switch, { on: value.autoInvert, onChange: (next) => setSettings({ autoInvert: next }), label: t("modeAutoInvert") })
			);
			const hint = (id) => h("p", { className: "lg-group-hint" }, t(`modeHint_${id}`));
			let body = null;
			if (mode === "auto") {
				body = h(Fragment, null, autoInvertRow, hint("auto"));
			} else if (mode === "light" || mode === "dark") {
				// Forced modes derive their ink from the mode itself; the invert switch
				// has no effect there, so it is not rendered (no dead controls).
				body = hint(mode);
			} else if (mode === "custom") {
				body = h(
					Row,
					{ label: t("modeCustomColor"), hint: t("modeHint_custom") },
					h(
						"div",
						{ className: "lg-actions" },
						h("input", {
							className: "lg-color",
							type: "color",
							value: value.customColor,
							onChange: (event) => setSettings({ customColor: event.target.value })
						}),
						h("span", { className: "lg-color-value" }, String(value.customColor).toUpperCase()),
						h(
							"button",
							{ type: "button", className: "lg-button", onClick: () => setSettings({ customColor: DEFAULT_SETTINGS.customColor }) },
							t("modeResetColor")
						)
					)
				);
			} else if (mode === "intelligent") {
				body = h(
					Fragment,
					null,
					h(
						Row,
						{ label: t("modeSampledColor"), hint: t("modeHint_intelligent") },
						h(
							"div",
							{ className: "lg-actions" },
							h("span", { className: "lg-swatch", style: { background: intelColor || "transparent" } }),
							h("span", { className: "lg-color-value" }, intelColor ? String(intelColor).toUpperCase() : "—"),
							h("button", { type: "button", className: "lg-button", onClick: () => resampleIntel() }, t("modeResample"))
						)
					),
					autoInvertRow
				);
			}
			return h(
				"section",
				{ className: "lg-group" },
				h("h2", { className: "lg-group-title" }, t("modesGroup")),
				h("p", { className: "lg-group-hint" }, t("modesHint")),
				h("p", { className: "lg-group-hint" }, t("modesIndependentHint")),
				h(
					"div",
					{ className: "lg-modes" },
					MODE_IDS.map((id) =>
						h(
							"button",
							{
								key: id,
								type: "button",
								className: "lg-mode",
								"data-on": mode === id || undefined,
								onClick: () => setSettings({ colorMode: id })
							},
							h("strong", null, t(`mode_${id}`)),
							h("span", null, t(`modeHint_${id}`))
						)
					)
				),
				// The panel is the only dynamic block: it mounts with the mode as its
				// key, so the entry animation replays on every switch, and unselected
				// modes render nothing at all.
				h("div", { className: "lg-mode-panel", "data-mode": mode, key: mode }, h("div", null, body))
			);
		}
		function AudioPanel() {
			const value = useSettings();
			const lang = useLang();
			const t = makeTranslate(lang);
			const audio = value.audio || {};
			const list = Array.isArray(audio.list) ? audio.list : [];
			const [browser, setBrowser] = useState(false);
			const [system, setSystem] = useState(audioBus.system);
			const [error, setError] = useState(audioBus.error);
			const update = (patch) => setSettings({ audio: { ...audio, ...patch } });
			const addFile = (file) => {
				update({ list: list.concat(file.path).slice(0, 200) });
				setBrowser(false);
			};
			const removeAt = (index) => update({ list: list.filter((_, i) => i !== index) });
			const toggleSystem = () => {
				if (audioBus.system) {
					audioStopSystem();
					setSystem(false);
					return;
				}
				audioStartSystem().then((ok) => {
					setSystem(ok);
					setError(audioBus.error);
				});
			};
			return h(
				"section",
				{ className: "lg-group" },
				h("h2", { className: "lg-group-title" }, t("audioGroup")),
				h("p", { className: "lg-group-hint" }, t("audioHint")),
				h(
					Row,
					{ label: t("audioEnable") },
					h(Switch, {
						on: audio.enabled === true,
						label: t("audioEnable"),
						onChange: (next) => {
							update({ enabled: next });
							if (next) setTimeout(audioKick, 80);
						}
					})
				),
				h(
					Row,
					{ label: t("audioPlaylist"), hint: t("audioPlaylistHint") },
					h("button", { type: "button", className: "lg-button", onClick: () => setBrowser(true) }, t("audioAdd"))
				),
				h(
					"div",
					{ className: "lg-audio-list" },
					list.length === 0
						? h("p", { className: "lg-group-hint" }, t("audioEmpty"))
						: list.map((file, index) =>
								h(
									"div",
									{ className: "lg-audio-row", key: file + "|" + index },
									h("span", { className: "lg-audio-name" }, audioName(file)),
									h("button", { type: "button", className: "lg-audio-remove", onClick: () => removeAt(index) }, "×")
								)
							)
				),
				h(Slider, {
					label: t("audioRate"),
					value: Number(audio.rate) || 1,
					min: 1,
					max: 2,
					step: 0.05,
					display: (Number(audio.rate) || 1).toFixed(2) + "×",
					onChange: (next) => update({ rate: next })
				}),
				h(Slider, {
					label: t("audioVolume"),
					value: Number(audio.volume) || 0,
					min: 0,
					max: 1,
					step: 0.02,
					display: Math.round((Number(audio.volume) || 0) * 100) + "%",
					onChange: (next) => update({ volume: next })
				}),
				h(
					Row,
					{ label: t("audioReactive"), hint: t("audioReactiveHint") },
					h(Switch, {
						on: audio.reactive === true,
						label: t("audioReactive"),
						onChange: (next) => update({ reactive: next })
					})
				),
				h(
					Row,
					{ label: t("audioSystem"), hint: t("audioSystemHint") },
					h("button", { type: "button", className: "lg-button", onClick: toggleSystem }, system ? t("audioSystemOff") : t("audioSystemOn"))
				),
				h(
					Row,
					{ label: t("audioTest") },
					h(
						"button",
						{
							type: "button",
							className: "lg-button",
							onClick: () => {
								audioKick();
								setError(audioBus.error);
							}
						},
						t("audioTest")
					)
				),
				error ? h("p", { className: "lg-warn-inline" }, error) : null,
				browser ? h(WeFileBrowser, { path: "", kind: "audio", onPick: addFile, onClose: () => setBrowser(false) }) : null
			);
		}
