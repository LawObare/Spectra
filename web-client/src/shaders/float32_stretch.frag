#version 300 es
precision highp float;

/**
 * Spectra WebGL2 Float32 Streaming Fragment Shader
 * Specification Anchor: SPECIFICATION.md §3.2, §6.1.6, §6.1.7
 * Role: E3 (role:E3-webgl)
 *
 * Capabilities:
 * - Single-channel 32-bit float texture decoding (gl.R32F)
 * - GPU Asinh stretch with dynamic non-linearity parameter (u_asinh_a)
 * - Symmetric signed difference subtraction (t_N - t_0) mapped around 0.5 mid-grey
 * - True inverse-variance co-addition using per-pixel VARIANCE textures (1/sigma^2)
 * - 3-channel RGB false-color super-band synthesis
 * - Colorblind-accessible scientific colormaps (Grayscale, Inverted Grayscale, Viridis, Cividis)
 */

uniform sampler2D u_epoch_current;    // gl.R32F current FLUX
uniform sampler2D u_epoch_reference;  // gl.R32F reference FLUX (epoch 0)
uniform sampler2D u_var_current;      // gl.R32F current VARIANCE
uniform sampler2D u_var_reference;    // gl.R32F reference VARIANCE (epoch 0)

// False-color 3-band RGB inputs (gl.R32F)
uniform sampler2D u_band_r;
uniform sampler2D u_band_g;
uniform sampler2D u_band_b;
uniform int u_is_rgb;                 // 0: Single-channel/Mode, 1: 3-band RGB false color

uniform float u_black;                // Black clipping level (MJy/sr)
uniform float u_white;                // White clipping level (MJy/sr)
uniform float u_asinh_a;              // Asinh non-linearity parameter
uniform float u_diff_scale;           // Signed difference scaling factor
uniform int u_mode;                   // 0: Blink, 1: Difference, 2: Co-Add
uniform int u_color_palette;          // 0: Grayscale, 1: Viridis, 2: Cividis, 3: Inverted Grayscale

in vec2 v_uv;
out vec4 fragColor;

// Asinh stretch equation (SPECIFICATION.md §6.1.6)
float asinh_stretch(float val, float a) {
    float safe_a = max(a, 1e-6);
    return asinh(val / safe_a) / asinh(1.0 / safe_a);
}

// Viridis colormap approximation (CEP polynomial fit)
vec3 colormap_viridis(float t) {
    float c0 = t;
    float c1 = t * t;
    float c2 = c1 * t;
    float c3 = c2 * t;

    float r = 0.2777 - 0.1055 * c0 + 3.3044 * c1 - 4.6341 * c2 + 2.1582 * c3;
    float g = 0.0054 + 1.4046 * c0 - 1.1062 * c1 + 0.4435 * c2 + 0.2526 * c3;
    float b = 0.3340 + 1.3845 * c0 - 3.2504 * c1 + 4.3168 * c2 - 1.7850 * c3;

    return clamp(vec3(r, g, b), 0.0, 1.0);
}

// Cividis colormap approximation (optimized for color-vision deficiency)
vec3 colormap_cividis(float t) {
    float c0 = t;
    float c1 = t * t;
    float c2 = c1 * t;

    float r = -0.0189 + 0.7736 * c0 + 0.7107 * c1 - 0.4654 * c2;
    float g = 0.1345 + 0.4474 * c0 + 0.7077 * c1 - 0.2896 * c2;
    float b = 0.3013 + 0.6974 * c0 - 0.5054 * c1 + 0.5067 * c2;

    return clamp(vec3(r, g, b), 0.0, 1.0);
}

// Apply palette to normalized [0, 1] scalar
vec3 apply_palette(float val) {
    float c = clamp(val, 0.0, 1.0);
    if (u_color_palette == 1) {
        return colormap_viridis(c);
    } else if (u_color_palette == 2) {
        return colormap_cividis(c);
    } else if (u_color_palette == 3) {
        return vec3(1.0 - c); // Inverted Grayscale
    }
    return vec3(c);           // Standard Grayscale
}

void main() {
    if (u_is_rgb == 1) {
        // 3-Band RGB False-Color Composite
        float r_val = texture(u_band_r, v_uv).r;
        float g_val = texture(u_band_g, v_uv).r;
        float b_val = texture(u_band_b, v_uv).r;

        float range = max(u_white - u_black, 1e-6);
        float r_norm = (r_val - u_black) / range;
        float g_norm = (g_val - u_black) / range;
        float b_norm = (b_val - u_black) / range;

        float r_out = clamp(asinh_stretch(r_norm, u_asinh_a), 0.0, 1.0);
        float g_out = clamp(asinh_stretch(g_norm, u_asinh_a), 0.0, 1.0);
        float b_out = clamp(asinh_stretch(b_norm, u_asinh_a), 0.0, 1.0);

        fragColor = vec4(r_out, g_out, b_out, 1.0);
        return;
    }

    // Single-Channel / Time-Domain Differencing Mode
    float f_curr = texture(u_epoch_current, v_uv).r;
    float f_ref  = texture(u_epoch_reference, v_uv).r;
    float v_curr = texture(u_var_current, v_uv).r;
    float v_ref  = texture(u_var_reference, v_uv).r;

    float display = 0.0;
    float range = max(u_white - u_black, 1e-6);

    if (u_mode == 0) {
        // Mode 0: Single-Epoch Asinh Stretch (Blink)
        float norm_flux = (f_curr - u_black) / range;
        display = clamp(asinh_stretch(norm_flux, u_asinh_a), 0.0, 1.0);
    } else if (u_mode == 1) {
        // Mode 1: Pairwise Signed Difference (t_N - t_0)
        // Symmetric stretch mapped around 0.5 mid-grey to preserve dipole structure
        float diff = f_curr - f_ref;
        float signed_norm = diff / max(u_diff_scale, 1e-6);
        float stretched_diff = asinh_stretch(signed_norm, u_asinh_a);
        display = clamp(0.5 + 0.5 * stretched_diff, 0.0, 1.0);
    } else if (u_mode == 2) {
        // Mode 2: True Inverse-Variance Weighted Co-Addition
        float w_curr = 1.0 / max(v_curr, 1e-6);
        float w_ref  = 1.0 / max(v_ref, 1e-6);
        float coadd_flux = (f_curr * w_curr + f_ref * w_ref) / max(w_curr + w_ref, 1e-6);
        float norm_coadd = (coadd_flux - u_black) / range;
        display = clamp(asinh_stretch(norm_coadd, u_asinh_a), 0.0, 1.0);
    }

    fragColor = vec4(apply_palette(display), 1.0);
}
