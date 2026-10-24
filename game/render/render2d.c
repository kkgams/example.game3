#include "render2d.h"
#include "tilemap.glsl.h"
#include "sprite.glsl.h"
#include <assert.h>
#include <stddef.h>
#include <string.h>

_Static_assert(sizeof(r2_tilemap) == 64, "tilemap instance ABI");
_Static_assert(sizeof(r2_sprite) == 60, "sprite instance ABI");

#define INSTANCE_ATTR(type, field, fmt) \
    { .buffer_index = 1, .offset = offsetof(type, field), .format = fmt }

static sg_pipeline_desc batch_desc(sg_shader shader, int stride) {
    return (sg_pipeline_desc){
        .shader = shader,
        .index_type = SG_INDEXTYPE_UINT16,
        .layout.buffers = {
            [0] = {.stride = 2 * sizeof(float)},
            [1] = {.stride = stride, .step_func = SG_VERTEXSTEP_PER_INSTANCE},
        },
        .colors[0].blend = {
            .enabled = true,
            .src_factor_rgb = SG_BLENDFACTOR_SRC_ALPHA,
            .dst_factor_rgb = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA,
            .src_factor_alpha = SG_BLENDFACTOR_ONE,
            .dst_factor_alpha = SG_BLENDFACTOR_ONE_MINUS_SRC_ALPHA,
        },
    };
}

static sg_buffer instance_buffer(int count, size_t stride) {
    sg_buffer buffer = sg_make_buffer(&(sg_buffer_desc){
        .size = count * stride,
        .usage = {.vertex_buffer = true, .stream_update = true},
    });
    assert(sg_query_buffer_state(buffer) == SG_RESOURCESTATE_VALID);
    return buffer;
}

void r2_init(r2_renderer *r, sg_image atlas, sg_image lut) {
    assert(r && !r->quad.id);
    assert(sg_query_image_state(atlas) == SG_RESOURCESTATE_VALID);
    assert(sg_query_image_state(lut) == SG_RESOURCESTATE_VALID);
    sg_image_desc atlas_desc = sg_query_image_desc(atlas);
    sg_image_desc lut_desc = sg_query_image_desc(lut);
    assert(atlas_desc.type == SG_IMAGETYPE_2D && lut_desc.type == SG_IMAGETYPE_2D);
    assert(lut_desc.pixel_format == SG_PIXELFORMAT_RGBA8);
    r->atlas_size[0] = (float)atlas_desc.width;
    r->atlas_size[1] = (float)atlas_desc.height;
    r->lut_size[0] = (float)lut_desc.width;
    r->lut_size[1] = (float)lut_desc.height;
    const float quad[][2] = {{-.5f,-.5f},{-.5f,.5f},{.5f,-.5f},{.5f,.5f}};
    const uint16_t indices[] = {0,1,2,2,1,3};
    r->quad = sg_make_buffer(&(sg_buffer_desc){.data = SG_RANGE(quad)});
    r->indices = sg_make_buffer(&(sg_buffer_desc){
        .usage.index_buffer = true, .data = SG_RANGE(indices),
    });
    r->sampler = sg_make_sampler(&(sg_sampler_desc){
        .min_filter = SG_FILTER_NEAREST, .mag_filter = SG_FILTER_NEAREST,
        .wrap_u = SG_WRAP_CLAMP_TO_EDGE, .wrap_v = SG_WRAP_CLAMP_TO_EDGE,
    });
    r->atlas_view = sg_make_view(&(sg_view_desc){.texture.image = atlas});
    r->lut_view = sg_make_view(&(sg_view_desc){.texture.image = lut});
    assert(sg_query_buffer_state(r->quad) == SG_RESOURCESTATE_VALID);
    assert(sg_query_buffer_state(r->indices) == SG_RESOURCESTATE_VALID);
    assert(sg_query_sampler_state(r->sampler) == SG_RESOURCESTATE_VALID);
    assert(sg_query_view_state(r->atlas_view) == SG_RESOURCESTATE_VALID);
    assert(sg_query_view_state(r->lut_view) == SG_RESOURCESTATE_VALID);

    r->tilemap.shader = sg_make_shader(tilemap_tilemap_shader_desc(sg_query_backend()));
    sg_pipeline_desc td = batch_desc(r->tilemap.shader, sizeof(r2_tilemap));
    td.layout.attrs[ATTR_tilemap_tilemap_pos] = (sg_vertex_attr_state){.format = SG_VERTEXFORMAT_FLOAT2};
    td.layout.attrs[ATTR_tilemap_tilemap_inst_pos] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_tilemap, pos, SG_VERTEXFORMAT_FLOAT2);
    td.layout.attrs[ATTR_tilemap_tilemap_inst_tile_size] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_tilemap, tile_size, SG_VERTEXFORMAT_FLOAT2);
    td.layout.attrs[ATTR_tilemap_tilemap_inst_tileset_uv] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_tilemap, tileset_uv, SG_VERTEXFORMAT_FLOAT4);
    td.layout.attrs[ATTR_tilemap_tilemap_inst_lut_uv] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_tilemap, lut_uv, SG_VERTEXFORMAT_FLOAT4);
    td.layout.attrs[ATTR_tilemap_tilemap_inst_parallax] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_tilemap, parallax, SG_VERTEXFORMAT_FLOAT2);
    td.layout.attrs[ATTR_tilemap_tilemap_inst_repeat] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_tilemap, repeat, SG_VERTEXFORMAT_FLOAT2);
    r->tilemap.pipeline = sg_make_pipeline(&td);
    r->tilemap.bindings = (sg_bindings){
        .vertex_buffers = {r->quad, instance_buffer(R2_MAX_TILEMAPS, sizeof(r2_tilemap))},
        .index_buffer = r->indices,
        .views = {[VIEW_tilemap_tileset_tex] = r->atlas_view, [VIEW_tilemap_lut_tex] = r->lut_view},
        .samplers = {[SMP_tilemap_tileset_smp] = r->sampler, [SMP_tilemap_lut_smp] = r->sampler},
    };

    r->sprite.shader = sg_make_shader(sprite_sprite_shader_desc(sg_query_backend()));
    sg_pipeline_desc sd = batch_desc(r->sprite.shader, sizeof(r2_sprite));
    sd.depth.compare = SG_COMPAREFUNC_LESS_EQUAL;
    sd.depth.write_enabled = true;
    sd.layout.attrs[ATTR_sprite_sprite_pos] = (sg_vertex_attr_state){.format = SG_VERTEXFORMAT_FLOAT2};
    sd.layout.attrs[ATTR_sprite_sprite_inst_pos] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_sprite, pos, SG_VERTEXFORMAT_FLOAT2);
    sd.layout.attrs[ATTR_sprite_sprite_inst_z] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_sprite, z, SG_VERTEXFORMAT_FLOAT);
    sd.layout.attrs[ATTR_sprite_sprite_inst_opacity] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_sprite, opacity, SG_VERTEXFORMAT_FLOAT);
    sd.layout.attrs[ATTR_sprite_sprite_inst_flip_flags] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_sprite, flip, SG_VERTEXFORMAT_UINT);
    sd.layout.attrs[ATTR_sprite_sprite_inst_uv] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_sprite, uv, SG_VERTEXFORMAT_FLOAT4);
    sd.layout.attrs[ATTR_sprite_sprite_inst_color_add] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_sprite, color_add, SG_VERTEXFORMAT_FLOAT4);
    sd.layout.attrs[ATTR_sprite_sprite_inst_offset] = (sg_vertex_attr_state)INSTANCE_ATTR(r2_sprite, offset, SG_VERTEXFORMAT_INT2);
    r->sprite.pipeline = sg_make_pipeline(&sd);
    r->sprite.bindings = (sg_bindings){
        .vertex_buffers = {r->quad, instance_buffer(R2_MAX_SPRITES, sizeof(r2_sprite))},
        .index_buffer = r->indices,
        .views[VIEW_sprite_tex0] = r->atlas_view,
        .samplers[SMP_sprite_default_sampler] = r->sampler,
    };
    assert(sg_query_shader_state(r->tilemap.shader) == SG_RESOURCESTATE_VALID);
    assert(sg_query_shader_state(r->sprite.shader) == SG_RESOURCESTATE_VALID);
    assert(sg_query_pipeline_state(r->tilemap.pipeline) == SG_RESOURCESTATE_VALID);
    assert(sg_query_pipeline_state(r->sprite.pipeline) == SG_RESOURCESTATE_VALID);
}

r2_camera r2_camera_make(float x, float y, float width, float height, float zoom) {
    assert(width > 0 && height > 0 && zoom > 0);
    r2_camera c = {.pos = {x,y}, .viewport = {width,height}, .zoom = zoom};
    c.ortho[0] = 2.0f / (width * zoom);
    c.ortho[5] = 2.0f / (height * zoom);
    // Portable sprite depth is 0 (near)..1 (far). GL clip Z is -1..1;
    // Metal clip Z is 0..1. Do not rely on shader-generator depth fixups.
    bool gl_depth = sg_query_backend() == SG_BACKEND_GLES3 || sg_query_backend() == SG_BACKEND_GLCORE;
    c.ortho[10] = gl_depth ? 2.0f : 1.0f;
    c.ortho[14] = gl_depth ? -1.0f : 0.0f;
    c.ortho[12] = -x * c.ortho[0];
    c.ortho[13] = -y * c.ortho[5];
    c.ortho[15] = 1.0f;
    return c;
}

void r2_draw_tilemaps(r2_renderer *r, const r2_camera *c, const r2_tilemap *maps, int count) {
    assert(r && c && r->tilemap.pipeline.id && count >= 0 && count <= R2_MAX_TILEMAPS);
    if (!count) return;
    assert(maps && c->zoom > 0);
    for (int i = 0; i < count; ++i) {
        assert(maps[i].tile_size[0] > 0 && maps[i].tile_size[1] > 0);
        assert(maps[i].lut_uv[2] > maps[i].lut_uv[0] && maps[i].lut_uv[3] > maps[i].lut_uv[1]);
        assert(maps[i].tileset_uv[2] > maps[i].tileset_uv[0] && maps[i].tileset_uv[3] > maps[i].tileset_uv[1]);
    }
    tilemap_tilemap_params_t params = {.camera_zoom = c->zoom};
    memcpy(params.ortho, c->ortho, sizeof(c->ortho));
    memcpy(params.tileset_tex_size, r->atlas_size, sizeof(r->atlas_size));
    memcpy(params.lut_tex_size, r->lut_size, sizeof(r->lut_size));
    memcpy(params.camera_pos, c->pos, sizeof(c->pos));
    memcpy(params.viewport_size, c->viewport, sizeof(c->viewport));
    sg_update_buffer(r->tilemap.bindings.vertex_buffers[1], &(sg_range){maps, count * sizeof(*maps)});
    sg_apply_pipeline(r->tilemap.pipeline);
    sg_apply_bindings(&r->tilemap.bindings);
    sg_apply_uniforms(UB_tilemap_tilemap_params, &SG_RANGE(params));
    sg_draw(0, 6, count);
}

void r2_draw_sprites(r2_renderer *r, const r2_camera *c, const r2_sprite *sprites, int count) {
    assert(r && c && r->sprite.pipeline.id && count >= 0 && count <= R2_MAX_SPRITES);
    if (!count) return;
    assert(sprites);
    for (int i = 0; i < count; ++i) {
        assert(sprites[i].flip <= 7);
        assert(sprites[i].z >= 0 && sprites[i].z <= 1);
        assert(sprites[i].opacity >= 0 && sprites[i].opacity <= 1);
    }
    sprite_sprite_params_t params = {0};
    memcpy(params.ortho, c->ortho, sizeof(c->ortho));
    memcpy(params.atlas_size, r->atlas_size, sizeof(r->atlas_size));
    sg_update_buffer(r->sprite.bindings.vertex_buffers[1], &(sg_range){sprites, count * sizeof(*sprites)});
    sg_apply_pipeline(r->sprite.pipeline);
    sg_apply_bindings(&r->sprite.bindings);
    sg_apply_uniforms(UB_sprite_sprite_params, &SG_RANGE(params));
    sg_draw(0, 6, count);
}

void r2_destroy(r2_renderer *r) {
    assert(r && r->quad.id);
    sg_destroy_pipeline(r->sprite.pipeline);
    sg_destroy_pipeline(r->tilemap.pipeline);
    sg_destroy_shader(r->sprite.shader);
    sg_destroy_shader(r->tilemap.shader);
    sg_destroy_buffer(r->sprite.bindings.vertex_buffers[1]);
    sg_destroy_buffer(r->tilemap.bindings.vertex_buffers[1]);
    sg_destroy_buffer(r->quad);
    sg_destroy_buffer(r->indices);
    sg_destroy_view(r->atlas_view);
    sg_destroy_view(r->lut_view);
    sg_destroy_sampler(r->sampler);
    *r = (r2_renderer){0};
}
