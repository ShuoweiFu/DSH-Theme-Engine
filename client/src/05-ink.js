		/** sRGB channel → linear light, per WCAG 2.1 relative luminance. */
		function linearize(channel) {
			const c = Math.min(1, Math.max(0, channel));
			return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
		}

		/** Contrast ratio between two relative luminances (1 … 21). */
		function contrastRatio(a, b) {
			const hi = Math.max(a, b);
			const lo = Math.min(a, b);
			return (hi + 0.05) / (lo + 0.05);
		}

		/** WCAG relative luminance of a raw `r,g,b` triple in 0…255. */
		function relativeLum(r, g, b) {
			return 0.2126 * linearize(r / 255) + 0.7152 * linearize(g / 255) + 0.0722 * linearize(b / 255);
		}

		/** Inverse of `linearize`, so a required luminance can become an alpha. */
		function encodeLum(lum) {
			const value = Math.min(1, Math.max(0, lum));
			return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
		}

		/**
		 * Decides the ink colour *and* how dense the frost has to be.
		 *
		 * Picking black or white by WCAG contrast is not enough on a busy desktop:
		 * 5:1 white-on-grey still reads as a smudge when icons sit behind the text.
		 * So the column targets 7:1 — if the current frost cannot reach it, the
		 * frost is thickened just enough for the chosen ink. The slider keeps the
		 * user's own look as a floor; the auto value can only add density.
		 */
		function decideInk(contentLum, tint, veil, darkTheme) {
			const blackInk = relativeLum(12, 14, 20);
			const whiteInk = relativeLum(246, 248, 252);
			// Surface colour of the frost itself: white in light mode, near-black
			// in dark mode (matches --dsw-alias-bg-base for each theme).
			const surfaceEnc = darkTheme ? 0.1 : 1;
			const target = 7;
			const alphaFor = (inkLum, wantDarkInk) => {
				// Contrast against the black ink needs a bright backdrop; against the
				// white ink it needs a dark one.
				const needLum = wantDarkInk ? target * (inkLum + 0.05) - 0.05 : (inkLum + 0.05) / target - 0.05;
				const needEnc = encodeLum(needLum);
				if (!Number.isFinite(needEnc)) return 1;
				const span = surfaceEnc - contentLum;
				if (Math.abs(span) < 0.02) return 0.85;
				// The frost can only push the backdrop towards the surface colour:
				// white ink over a bright wallpaper is unreachable no matter how
				// dense the veil gets, so that option is reported as infeasible.
				if (wantDarkInk ? span < 0 : span > 0) return 1;
				return Math.min(0.9, Math.max(0, (needEnc - contentLum) / span));
			};
			const darkAlpha = alphaFor(blackInk, true);
			const lightAlpha = alphaFor(whiteInk, false);
			const useDark = darkAlpha <= lightAlpha;
			const ink = useDark ? "dark" : "light";
			const alpha = useDark ? darkAlpha : lightAlpha;
			// The tokens derive the column alpha as `(0.02 + 0.45 * veil) *
			// (0.9 + 0.2 * tint)`; invert that so the decision can name a veil.
			const tintLift = 0.9 + 0.2 * tint;
			const floor = darkTheme ? 0.05 : 0.02;
			const neededVeil = Math.min(1, Math.max(0, (alpha / tintLift - floor) / 0.45));
			return { ink, veil: Math.max(veil, neededVeil) };
		}

		/**
		 * Decides the ink colour by contrast, not by a raw brightness threshold.
		 * The wallpaper is only part of the answer: the column in front of the text
		 * also paints the frost tint, so a bright wallpaper plus a white veil is
		 * still a *bright* backdrop and needs dark text. The sampled wallpaper
		 * luminance is composited with the surface colour first, then both label
		 * candidates are scored with WCAG contrast.
		 */
		function pickInk(contentLum, tint, veil, darkTheme) {
			const tokens = glassTokens(tint, veil, null);
			const surface = darkTheme ? tokens["--dsw-alias-bg-base"].dark : tokens["--dsw-alias-bg-base"].light;
			const match = /rgba?\(([^)]+)\)/.exec(surface);
			const parts = match ? match[1].split(",").map((s) => Number.parseFloat(s)) : [255, 255, 255, 0.2];
			const alpha = Number.isFinite(parts[3]) ? parts[3] : 0.2;
			// Alpha compositing happens in encoded sRGB, not in linear light: the
			// blend is applied first, *then* converted. Mixing linear values here was
			// what made a dark wallpaper read as "bright enough for dark text".
			const surfaceSrgb = (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255;
			const composed = linearize(contentLum * (1 - alpha) + surfaceSrgb * alpha);
			const darkInk = relativeLum(12, 14, 20);
			const lightInk = relativeLum(246, 248, 252);
			const onDark = contrastRatio(composed, lightInk);
			const onLight = contrastRatio(composed, darkInk);
			// A 0.35 gap stops the colour from flickering on borderline wallpaper.
			if (onLight >= onDark + 0.35) return "dark";
			if (onDark >= onLight + 0.35) return "light";
			return darkTheme ? "light" : "dark";
		}
