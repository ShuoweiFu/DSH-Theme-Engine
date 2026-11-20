		const VERTEX_SHADER = "attribute vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }";

		const FRAGMENT_SHADER = String.raw`
precision highp float;
uniform vec2 uRes;
uniform vec2 uScreen;
uniform vec2 uWin;
uniform float uScale;
uniform float uDpr;
uniform vec2 uTexRes;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform float uBlend;
uniform float uTime;
uniform float uSat;
uniform float uDim;
uniform float uFlow;
uniform float uRipple;
uniform vec2 uMouse;

float hash(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
		mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
		u.y
	);
}

// Two octaves only: on an iGPU the third and fourth octave are invisible after
// the blur prepass but cost 2x the noise instructions per pixel.
float fbm(vec2 p) {
	float value = 0.5 * noise(p);
	value += 0.25 * noise(p * 2.03);
	return value;
}

void main() {
	vec2 frag = gl_FragCoord.xy;

	// Screen-space mapping: this fragment shows a real desktop pixel, so the
	// picture behind the window matches the wallpaper around it instead of
	// being stretched over the window rectangle. Everything is computed in CSS
	// pixels so dynamic resolution scaling cannot shift the picture.
	vec2 fragCss = frag / uScale;
	vec2 screenUv = (uWin + fragCss) / uScreen;
	vec2 screenDev = uScreen * uDpr;
	float cover = max(screenDev.x / uTexRes.x, screenDev.y / uTexRes.y);
	// gl_FragCoord counts upwards from the bottom; texture rows count from the
	// top, so flip V here instead of relying on UNPACK_FLIP_Y_WEBGL (which
	// Chromium ignores for ImageBitmap uploads).
	screenUv.y = 1.0 - screenUv.y;
	vec2 uv = (screenUv - 0.5) * (screenDev / (uTexRes * cover)) + 0.5;

	float t = uTime;
	vec2 p = uv * vec2(uTexRes.x / uTexRes.y, 1.0) * 2.0;

	// Liquid domain warp. This is the original 0.8 "liquid" amount: the picture
	// swims like water and icons bend slightly, which is the look the glass was
	// designed around. The sharper 1.2% variant read as flat glass.
	float n = fbm(p + vec2(t * 0.03, -t * 0.02));
	float n2 = fbm(p * 1.3 + vec2(-t * 0.025, t * 0.03) + n);
	vec2 warp = vec2(n - 0.5, n2 - 0.5) * 0.05 * uFlow;

	// Ripple around the pointer. uRipple is 0 whenever the cursor is parked, so
	// the sin/exp pair is skipped entirely (branch coherency: whole-screen skip).
	vec2 rippled = uv;
	if (uRipple > 0.001) {
		vec2 delta = uv - uMouse;
		float dist = length(delta) + 1e-4;
		float ripple = sin(dist * 26.0 - t * 2.2) * exp(-dist * 5.0) * 0.012 * uFlow * uRipple;
		rippled += (delta / dist) * ripple;
	}

	vec2 fuv = clamp(rippled + warp, 0.002, 0.998);

	// Chromatic dispersion: the "thick glass" look. The texture is already
	// blurred by the prepass, so this is one cheap tap per channel. At rest the
	// split collapses, which saves two dependent texture fetches per pixel.
	vec2 ca = (fuv - 0.5) * 0.004 * step(0.02, uFlow);
	vec3 color;
	color.r = texture2D(uTex, clamp(fuv + ca, 0.002, 0.998)).r;
	color.g = texture2D(uTex, fuv).g;
	color.b = texture2D(uTex, clamp(fuv - ca, 0.002, 0.998)).b;
	// Cross-fade after a wallpaper swap: a 1.1 s recapture otherwise lands as a
	// visible jump every time, even when only a caret moved on the desktop.
	if (uBlend < 0.999) {
		vec3 before = texture2D(uPrev, fuv).rgb;
		color = mix(before, color, uBlend);
	}

	// Slow caustics: two crossing sines read as slow water. This is the analytic
	// 0.11 form the user asked for by name; the *strength* stays at the 0.8 value
	// (0.22) because 0.11's 0.055 multiplied the water away.
	float caustic = 0.5 + 0.5 * sin(p.x * 1.7 + t * 0.9) * sin(p.y * 1.3 - t * 0.7);
	color *= 0.9 + caustic * 0.22 * uFlow + (1.0 - uFlow) * 0.05;

	// A slow specular band sweeping diagonally.
	float band = smoothstep(0.36, 0.56, abs(sin((uv.x + uv.y * 0.6) * 3.2 - t * 0.35)));
	color += band * 0.03 * uFlow;

	float luma = dot(color, vec3(0.299, 0.587, 0.114));
	color = mix(vec3(luma), color, uSat);
	color *= 1.0 - uDim * 0.85;

	gl_FragColor = vec4(color, 1.0);
}
`;

		// Blur prepass: one 13-tap poisson blur into a half-resolution FBO, run
		// once per wallpaper upload (or when the blur slider moves) instead of
		// letting the compositor run backdrop-filter over the whole window every
		// frame. This is what keeps the GPU cost to a single pass.
		const BLUR_FRAGMENT_SHADER = String.raw`
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
	vec2 uv = gl_FragCoord.xy * uTexel;
	vec2 r = uTexel * uRadius;
	vec3 color = texture2D(uTex, uv).rgb * 0.1633;
	color += texture2D(uTex, uv + vec2(r.x * 1.41, 0.0)).rgb * 0.1245;
	color += texture2D(uTex, uv - vec2(r.x * 1.41, 0.0)).rgb * 0.1245;
	color += texture2D(uTex, uv + vec2(0.0, r.y * 1.41)).rgb * 0.1245;
	color += texture2D(uTex, uv - vec2(0.0, r.y * 1.41)).rgb * 0.1245;
	color += texture2D(uTex, uv + vec2(r.x, r.y)).rgb * 0.0977;
	color += texture2D(uTex, uv - vec2(r.x, r.y)).rgb * 0.0977;
	color += texture2D(uTex, uv + vec2(r.x, -r.y)).rgb * 0.0977;
	color += texture2D(uTex, uv - vec2(r.x, -r.y)).rgb * 0.0977;
	color += texture2D(uTex, uv + vec2(r.x * 2.2, 0.0)).rgb * 0.035;
	color += texture2D(uTex, uv - vec2(r.x * 2.2, 0.0)).rgb * 0.035;
	color += texture2D(uTex, uv + vec2(0.0, r.y * 2.2)).rgb * 0.035;
	color += texture2D(uTex, uv - vec2(0.0, r.y * 2.2)).rgb * 0.035;
	gl_FragColor = vec4(color, 1.0);
}
`;

		function compileShader(gl, type, source) {
			const shader = gl.createShader(type);
			gl.shaderSource(shader, source);
			gl.compileShader(shader);
			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				const info = gl.getShaderInfoLog(shader);
				gl.deleteShader(shader);
				throw new Error(`liquid-glass shader: ${info}`);
			}
			return shader;
		}
