@module sprite



@vs vs_sprite_base
layout(binding=0) uniform sprite_params {
    mat4 ortho;
    vec2 atlas_size;
};


in vec2 pos;
in vec2 inst_pos;
in float inst_z;
in float inst_opacity;
in uint inst_flip_flags;
in vec4 inst_uv;
in vec4 inst_color_add;  // Additive color for blink/flash effects (RGB + intensity)
in ivec2 inst_offset;


out vec2 fragTexCoord;
out float opacity;
out vec4 colorAdd;



const mat2 FLIP_MATRICES[8] = mat2[](
    mat2(1, 0, 0, 1),      // 0: {}
    mat2(-1, 0, 0, 1),     // 1: H
    mat2(1, 0, 0, -1),     // 2: V
    mat2(-1, 0, 0, -1),    // 3: H | V
    mat2(0, 1, 1, 0),      // 4: AD
    mat2(0, -1, 1, 0),     // 5: AD | H
    mat2(0, 1, -1, 0),     // 6: AD | V
    mat2(0, -1, -1, 0)     // 7: AD | H | V
);


void main() {
    vec2 sprite_size = abs(inst_uv.zw - inst_uv.xy) * atlas_size;
    vec2 pos_in_px = pos * sprite_size + inst_pos + vec2(inst_offset);
    gl_Position = ortho * vec4(pos_in_px, inst_z, 1.0);
    opacity = inst_opacity;
    colorAdd = inst_color_add;

    // Center UV coordinates before transformation
    vec2 uv_centered = pos;

    // Apply transformation
    vec2 transformed_uv = FLIP_MATRICES[inst_flip_flags] * uv_centered;

    // Map back to UV space
    fragTexCoord = inst_uv.xy + (transformed_uv + vec2(0.5)) * (inst_uv.zw - inst_uv.xy);
}
@end

@fs fs_sprite_base
layout(binding=0) uniform texture2D tex0;
layout(binding=0) uniform sampler default_sampler;

in vec2 fragTexCoord;
in float opacity;
in vec4 colorAdd;

out vec4 frag_color;
void main() {
    vec4 texColor = texture(sampler2D(tex0, default_sampler), fragTexCoord);
    texColor.a *= opacity;
    if (texColor.a < 0.001) {
        discard;
    }

    // Apply additive color (for blink/flash effects)
    float luminance = dot(texColor.rgb, vec3(0.299, 0.587, 0.114));
    vec3 result = mix(texColor.rgb, colorAdd.rgb * luminance, colorAdd.a);

    frag_color = vec4(result, texColor.a);
}
@end

@program sprite vs_sprite_base fs_sprite_base

