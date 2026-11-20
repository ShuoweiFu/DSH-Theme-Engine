				/**
		 * Second line of defence behind the host luminance check. A capture can
		 * still land black (a compositor pause, a decoder hiccup, the PowerShell
		 * fallback): swapping such a frame in shows up as the whole glass blinking
		 * black, so a near-black frame is refused while a bright one is on screen
		 * and the previous texture stays.
		 *
		 * `accepted` records the last frame that was actually shown and is not
		 * updated for a refused frame — otherwise the next near-black frame would be
		 * compared against black and pass. After two refusals the third frame is
		 * believed, so switching to a dark wallpaper is not fought forever.
		 */
		const blackWatch = { accepted: -1, last: -1, skips: 0 };
		function isBlackSwap(sample) {
			const lum = Number(sample?.lum);
			if (!Number.isFinite(lum)) return false;
			blackWatch.last = lum;
			const previous = blackWatch.accepted;
			if (lum < BLACK_LUM && previous > RECOVER_LUM && blackWatch.skips < 2) {
				blackWatch.skips += 1;
				return true;
			}
			blackWatch.skips = 0;
			blackWatch.accepted = lum;
			return false;
		}

		function currentMode() {
			if (document.body?.hasAttribute("data-ds-dark-theme")) return "dark";
			return "light";
		}

		function formatBytes(bytes) {
			if (!bytes || bytes <= 0) return "—";
			const units = ["B", "KB", "MB", "GB"];
			let value = bytes;
			let unit = 0;
			while (value >= 1024 && unit < units.length - 1) {
				value /= 1024;
				unit += 1;
			}
			return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
		}

		let reportedAt = 0;

		/** Forward client-side failures to the host so they survive a reload.
		 * Returns false when the throttle swallowed the message, so callers that
		 * dedupe on a signature know to retry instead of losing the report. */
		function reportClientError(message, urgent = false) {
			try {
				const now = Date.now();
				if (!urgent && now - reportedAt < 1500) return false;
				reportedAt = now;
				const text = encodeURIComponent(String(message).slice(0, 3500));
				void fetch(`${API}/log?msg=${text}`, { credentials: "same-origin" }).catch(() => {});
				return true;
			} catch {
				// Diagnostics are best effort.
				return false;
			}
		}

		/** Keeps one failing overlay from deactivating the whole slot entry. */
		class Guard extends React.Component {
			constructor(props) {
				super(props);
				this.state = { error: null };
			}

			static getDerivedStateFromError(error) {
				return { error: String(error?.message ?? error) };
			}

			componentDidCatch(error) {
				reportClientError(`overlay: ${String(error?.stack ?? error)}`);
			}

			render() {
				return this.state.error ? null : this.props.children;
			}
		}
