@vs vs
in vec4 position;
in vec4 color0;

out vec4 color;

layout(binding=0) uniform vs_params {
    float angle;
};

void main() {
    float s = sin(angle);
    float c = cos(angle);
    mat2 rot = mat2(c, -s, s, c);
    vec2 pos = rot * position.xy;
    gl_Position = vec4(pos, position.zw);
    color = color0;
}
@end

@fs fs
in vec4 color;
out vec4 frag_color;

void main() {
    frag_color = color;
}

@end

@program triangle vs fs
