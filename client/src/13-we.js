		/* ---- Wallpaper Engine center (task 7 / task 10) --------------------- */
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
			const [we, setWe] = useState(null);
			const [loading, setLoading] = useState(false);
			const [filter, setFilter] = useState("all");
			const [search, setSearch] = useState("");
			const [hint, setHint] = useState("");
			const [browser, setBrowser] = useState("");

			const load = useCallback((force) => {
				setLoading(true);
				fetch(`${API}/we${force ? "?force=1" : ""}`, { cache: "no-store" })
					.then((response) => response.json())
					.then((data) => setWe(data))
					.catch(() => setWe({ ok: false, installed: false, items: [], current: null }))
					.finally(() => setLoading(false));
			}, []);
			useEffect(() => {
				load(false);
			}, [load]);

			const launch = (target) => {
				fetch(`${API}/launch?target=${target}`, { cache: "no-store" }).catch(() => {});
			};
			const apply = (item) => {
				if (item.type === "video") {
					setSettings({ source: "we", wePath: item.filePath, weId: item.id, wallpaper: true });
					setHint(t("weApplied"));
					return;
				}
				setSettings({ source: "desktop", wallpaper: true });
				setHint(t("weLiveHint"));
			};
			const installed = Boolean(we && we.installed);
			const items = (we && we.items ? we.items : []).filter(
				(item) => (filter === "all" || item.type === filter) && (!search || String(item.title).toLowerCase().includes(search.toLowerCase()))
			);
			const shown = items.slice(0, 160);
			const current = we && we.current ? we.current : null;

			return h(
				"section",
				{ className: "lg-group" },
				h("h2", { className: "lg-group-title" }, t("weGroup")),
				h("p", { className: "lg-group-hint" }, t("weHint")),
				h(
					"div",
					{ className: "lg-we-status" },
					h("span", { className: "lg-dot", "data-state": we && we.running ? "ready" : "off" }),
					h("span", null, installed ? (we.running ? t("weRunning") : t("weNotRunning")) : t("weMissing")),
					current ? h("span", { className: "lg-hint" }, `${t("weCurrent")} ${current.title}`) : null
				),
				h(
					"div",
					{ className: "lg-actions" },
					h("button", { type: "button", className: "lg-button", onClick: () => load(true), disabled: loading }, loading ? t("weLoading") : t("weRefresh")),
					h("button", { type: "button", className: "lg-button", onClick: () => launch("we") }, t("weOpen")),
					h("button", { type: "button", className: "lg-button", onClick: () => launch("steam") }, t("weSteam")),
					h(
						"a",
						{
							className: "lg-button",
							href: "https://apps.microsoft.com/search?query=%E7%93%A6%E7%89%B9%E5%8A%A0%E9%80%9F%E5%99%A8",
							target: "_blank",
							rel: "noreferrer"
						},
						t("weStore")
					)
				),
				installed
					? h(
							"div",
							{ className: "lg-we-tools" },
							h("input", {
								className: "lg-input lg-we-search",
								type: "search",
								value: search,
								placeholder: t("weSearch"),
								onChange: (event) => setSearch(event.target.value)
							}),
							h(
								"div",
								{ className: "lg-chips" },
								["all", "video", "scene", "web"].map((id) =>
									h("button", { key: id, type: "button", className: "lg-chip", "data-on": filter === id || undefined, onClick: () => setFilter(id) }, t(`weFilter_${id}`))
								)
							)
						)
					: null,
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
										"data-active": value.source === "we" && value.weId === item.id ? "on" : undefined,
										title: item.title,
										onClick: () => apply(item)
									},
									h(
										"span",
										{ className: "lg-we-thumb" },
										item.preview
											? h("img", { src: `${API}/we/preview?id=${encodeURIComponent(item.id)}`, alt: "", loading: "lazy" })
											: h("span", { className: "lg-we-fallback" }, String(item.type).toUpperCase())
									),
									h("span", { className: "lg-we-name" }, item.title),
									h(
										"span",
										{ className: "lg-we-meta" },
										h(WeTypeLabel, { t, type: item.type }),
										` · ${formatBytes(item.size)}`
									)
								)
							)
						)
					: installed
						? h("p", { className: "lg-group-hint" }, t("weEmpty"))
						: null,
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
						h("button", { type: "button", className: "lg-button", onClick: () => setBrowser(browser === "wallpaper" ? "" : "wallpaper") }, t("weBrowse")),
						value.filePath
							? h("button", { type: "button", className: "lg-button", onClick: () => setSettings({ source: "desktop", filePath: "" }) }, t("weClear"))
							: null
					)
				),
				browser === "wallpaper"
					? h(WeFileBrowser, {
							path: value.filePath || "",
							kind: "media",
							onPick: (file) => {
								setSettings({ source: "file", filePath: file.path, wallpaper: true });
								setBrowser("");
								setHint(t("weApplied"));
							},
							onClose: () => setBrowser("")
						})
					: null,
				hint ? h("p", { className: "lg-group-hint" }, hint) : null
			);
		}

		/* ---- Appearance modes (task 12 / task 14 / task 15) ----------------- */

		function AppearanceModes() {
			const value = useSettings();
			const lang = useLang();
			const t = makeTranslate(lang);
			const modes = ["auto", "light", "dark", "custom", "intelligent"];
			return h(
				"section",
				{ className: "lg-group" },
				h("h2", { className: "lg-group-title" }, t("modesGroup")),
				h("p", { className: "lg-group-hint" }, t("modesHint")),
				h(
					"div",
					{ className: "lg-modes" },
					modes.map((id) =>
						h(
							"button",
							{
								key: id,
								type: "button",
								className: "lg-mode",
								"data-on": value.colorMode === id || undefined,
								onClick: () => setSettings({ colorMode: id })
							},
							h("strong", null, t(`mode_${id}`)),
							h("span", null, t(`modeHint_${id}`))
						)
					)
				),
				value.colorMode === "custom"
					? h(
							"div",
							{ className: "lg-row" },
							h("div", { className: "lg-label" }, h("span", null, t("modeCustomColor")), h("span", { className: "lg-hint" }, value.customColor)),
							h("input", {
								className: "lg-color",
								type: "color",
								value: value.customColor,
								onChange: (event) => setSettings({ customColor: event.target.value })
							})
						)
					: null,
				h(
					Row,
					{ label: t("modeAutoInvert"), hint: t("modeAutoInvertHint") },
					h(Switch, { on: value.autoInvert, onChange: (next) => setSettings({ autoInvert: next }), label: t("modeAutoInvert") })
				)
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
