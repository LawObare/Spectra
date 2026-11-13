#version 300 es
precision highp float;

/**
 * Spectra WebGL2 Screen-Quad Vertex Shader
 * Specification Anchor: SPECIFICATION.md §6.1.6
 * Role: E3 (role:E3-webgl)
 */

in vec2 a_position;
in vec2 a_uv;

out vec2 v_uv;

void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
