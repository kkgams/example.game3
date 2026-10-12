/**
 * WebGL2 Bridge for Sokol GFX WASM
 * Maps C OpenGL ES 3.0 calls to WebGL2 JavaScript API
 */

export class GLBridge {
  constructor(gl, wasmMemory) {
    this.gl = gl
    this.memory = wasmMemory
    this.textDecoder = new TextDecoder()
    this.textEncoder = new TextEncoder()

    // Object tracking for GL resources
    this.buffers = new Map()
    this.framebuffers = new Map()
    this.renderbuffers = new Map()
    this.textures = new Map()
    this.samplers = new Map()
    this.shaders = new Map()
    this.programs = new Map()
    this.vertexArrays = new Map()
    this.uniformLocations = new Map()
    this.attribLocations = new Map()
    this.syncs = new Map()

    // ID counters
    this.nextId = 1

    // State cache
    this.currentProgram = null
    this.boundBuffers = new Map()
    this.boundTextures = new Map()
    this.activeTextureUnit = gl.TEXTURE0
    this.lastGeneratedTexture = null
    this.lastGeneratedTextureId = 0
    this.pendingTextureInitId = 0

    // Error state
    this.lastError = 0
  }

  // Helper: Read string from WASM memory
  readString(ptr) {
    if (!ptr) return null
    const memory = new Uint8Array(this.memory.buffer)
    let end = ptr
    while (memory[end] !== 0) end++
    return this.textDecoder.decode(memory.subarray(ptr, end))
  }

  // Helper: Read string array from WASM memory
  readStringArray(ptr, count) {
    const result = []
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < count; i++) {
      const strPtr = view.getInt32(ptr + i * 4, true)
      result.push(this.readString(strPtr))
    }
    return result
  }

  // Helper: Read int array from WASM memory
  readIntArray(ptr, count) {
    const result = new Int32Array(this.memory.buffer, ptr, count)
    return Array.from(result)
  }

  // Helper: Read uint array from WASM memory
  readUintArray(ptr, count) {
    const result = new Uint32Array(this.memory.buffer, ptr, count)
    return Array.from(result)
  }

  // Helper: Read float array from WASM memory
  readFloatArray(ptr, count) {
    const result = new Float32Array(this.memory.buffer, ptr, count)
    return Array.from(result)
  }

  // Helper: Get or create ID for GL object
  getId(obj, map) {
    if (!obj) return 0
    for (const [id, o] of map) {
      if (o === obj) return id
    }
    const id = this.nextId++
    map.set(id, obj)
    return id
  }

  findId(obj, map) {
    if (!obj) return 0
    for (const [id, o] of map) {
      if (o === obj) return id
    }
    return 0
  }

  // Helper: Get object by ID
  getObject(id, map) {
    if (id === 0) return null
    return map.get(id) || null
  }

  // Helper: Delete object by ID
  deleteObject(id, map) {
    if (id === 0) return
    map.delete(id)
  }

  // Texture unit management
  getTextureUnit(unit) {
    return this.gl.TEXTURE0 + unit
  }

  // GL Functions

  glActiveTexture(texture) {
    this.activeTextureUnit = texture
    this.gl.activeTexture(texture)
  }

  glAttachShader(program, shader) {
    const prog = this.getObject(program, this.programs)
    const shad = this.getObject(shader, this.shaders)
    if (prog && shad) {
      this.gl.attachShader(prog, shad)
    }
  }

  glBindBuffer(target, buffer) {
    const buf = this.getObject(buffer, this.buffers)
    this.gl.bindBuffer(target, buf)
    this.boundBuffers.set(target, buffer)
  }

  glBindBufferBase(target, index, buffer) {
    const buf = this.getObject(buffer, this.buffers)
    this.gl.bindBufferBase(target, index, buf)
  }

  glBindBufferRange(target, index, buffer, offset, size) {
    const buf = this.getObject(buffer, this.buffers)
    this.gl.bindBufferRange(target, index, buf, offset, size)
  }

  glBindFramebuffer(target, framebuffer) {
    const fb = this.getObject(framebuffer, this.framebuffers)
    this.gl.bindFramebuffer(target, fb)
  }

  glBindImageTexture(unit, texture, level, layered, layer, access, format) {
    // WebGL2 doesn't support bindImageTexture directly
    console.warn("glBindImageTexture not supported in WebGL2")
  }

  glBindRenderbuffer(target, renderbuffer) {
    const rb = this.getObject(renderbuffer, this.renderbuffers)
    this.gl.bindRenderbuffer(target, rb)
  }

  glBindSampler(unit, sampler) {
    const samp = this.getObject(sampler, this.samplers)
    this.gl.bindSampler(unit, samp)
  }

  glBindTexture(target, texture) {
    const tex = this.getObject(texture, this.textures)
    if (texture !== 0 && !tex) {
      console.warn("glBindTexture: missing texture object", {
        target,
        texture,
        known: Array.from(this.textures.keys()).slice(0, 8),
      })
    }
    this.gl.bindTexture(target, tex)
    this.boundTextures.set(`${this.activeTextureUnit}:${target}`, texture)
    if (texture === this.pendingTextureInitId) {
      this.pendingTextureInitId = 0
    }
  }

  glBindVertexArray(array) {
    const vao = this.getObject(array, this.vertexArrays)
    this.gl.bindVertexArray(vao)
  }

  glBlendColor(red, green, blue, alpha) {
    this.gl.blendColor(red, green, blue, alpha)
  }

  glBlendEquationSeparate(modeRGB, modeAlpha) {
    this.gl.blendEquationSeparate(modeRGB, modeAlpha)
  }

  glBlendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha) {
    this.gl.blendFuncSeparate(srcRGB, dstRGB, srcAlpha, dstAlpha)
  }

  glBlitFramebuffer(
    srcX0,
    srcY0,
    srcX1,
    srcY1,
    dstX0,
    dstY0,
    dstX1,
    dstY1,
    mask,
    filter,
  ) {
    this.gl.blitFramebuffer(
      srcX0,
      srcY0,
      srcX1,
      srcY1,
      dstX0,
      dstY0,
      dstX1,
      dstY1,
      mask,
      filter,
    )
  }

  glBufferData(target, size, data, usage) {
    if (data === 0) {
      this.gl.bufferData(target, size, usage)
    } else {
      const memory = new Uint8Array(this.memory.buffer, data, size)
      this.gl.bufferData(target, memory, usage)
    }
  }

  glBufferSubData(target, offset, size, data) {
    const memory = new Uint8Array(this.memory.buffer, data, size)
    this.gl.bufferSubData(target, offset, memory)
  }

  glCheckFramebufferStatus(target) {
    return this.gl.checkFramebufferStatus(target)
  }

  glClearBufferfi(buffer, drawbuffer, depth, stencil) {
    this.gl.clearBufferfi(buffer, drawbuffer, depth, stencil)
  }

  glClearBufferfv(buffer, drawbuffer, value) {
    const memory = new Float32Array(this.memory.buffer, value, 4)
    this.gl.clearBufferfv(buffer, drawbuffer, memory)
  }

  glClearBufferiv(buffer, drawbuffer, value) {
    const memory = new Int32Array(this.memory.buffer, value, 4)
    this.gl.clearBufferiv(buffer, drawbuffer, memory)
  }

  glColorMask(red, green, blue, alpha) {
    this.gl.colorMask(red, green, blue, alpha)
  }

  glColorMaski(index, r, g, b, a) {
    // WebGL2 doesn't support indexed color mask
    if (index === 0) {
      this.gl.colorMask(r, g, b, a)
    }
  }

  glCompileShader(shader) {
    const shad = this.getObject(shader, this.shaders)
    if (shad) {
      this.gl.compileShader(shad)
    }
  }

  glCompressedTexImage2D(
    target,
    level,
    internalformat,
    width,
    height,
    border,
    imageSize,
    data,
  ) {
    const memory = new Uint8Array(this.memory.buffer, data, imageSize)
    this.gl.compressedTexImage2D(
      target,
      level,
      internalformat,
      width,
      height,
      border,
      memory,
    )
  }

  glCompressedTexImage3D(
    target,
    level,
    internalformat,
    width,
    height,
    depth,
    border,
    imageSize,
    data,
  ) {
    const memory = new Uint8Array(this.memory.buffer, data, imageSize)
    this.gl.compressedTexImage3D(
      target,
      level,
      internalformat,
      width,
      height,
      depth,
      border,
      memory,
    )
  }

  glCompressedTexSubImage2D(
    target,
    level,
    xoffset,
    yoffset,
    width,
    height,
    format,
    imageSize,
    data,
  ) {
    const memory = new Uint8Array(this.memory.buffer, data, imageSize)
    this.gl.compressedTexSubImage2D(
      target,
      level,
      xoffset,
      yoffset,
      width,
      height,
      format,
      memory,
    )
  }

  glCompressedTexSubImage3D(
    target,
    level,
    xoffset,
    yoffset,
    zoffset,
    width,
    height,
    depth,
    format,
    imageSize,
    data,
  ) {
    const memory = new Uint8Array(this.memory.buffer, data, imageSize)
    this.gl.compressedTexSubImage3D(
      target,
      level,
      xoffset,
      yoffset,
      zoffset,
      width,
      height,
      depth,
      format,
      memory,
    )
  }

  glCopyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size) {
    this.gl.copyBufferSubData(
      readTarget,
      writeTarget,
      readOffset,
      writeOffset,
      size,
    )
  }

  glCopyTexSubImage2D(target, level, xoffset, yoffset, x, y, width, height) {
    this.gl.copyTexSubImage2D(
      target,
      level,
      xoffset,
      yoffset,
      x,
      y,
      width,
      height,
    )
  }

  glCopyTexSubImage3D(
    target,
    level,
    xoffset,
    yoffset,
    zoffset,
    x,
    y,
    width,
    height,
  ) {
    this.gl.copyTexSubImage3D(
      target,
      level,
      xoffset,
      yoffset,
      zoffset,
      x,
      y,
      width,
      height,
    )
  }

  glCreateProgram() {
    const prog = this.gl.createProgram()
    return this.getId(prog, this.programs)
  }

  glCreateShader(type) {
    const shader = this.gl.createShader(type)
    return this.getId(shader, this.shaders)
  }

  glCullFace(mode) {
    this.gl.cullFace(mode)
  }

  glDeleteBuffers(n, buffers) {
    const bufs = this.readUintArray(buffers, n)
    for (const id of bufs) {
      const buf = this.getObject(id, this.buffers)
      if (buf) {
        this.gl.deleteBuffer(buf)
        this.deleteObject(id, this.buffers)
      }
    }
  }

  glDeleteFramebuffers(n, framebuffers) {
    const fbs = this.readUintArray(framebuffers, n)
    for (const id of fbs) {
      const fb = this.getObject(id, this.framebuffers)
      if (fb) {
        this.gl.deleteFramebuffer(fb)
        this.deleteObject(id, this.framebuffers)
      }
    }
  }

  glDeleteProgram(program) {
    const prog = this.getObject(program, this.programs)
    if (prog) {
      this.gl.deleteProgram(prog)
      this.deleteObject(program, this.programs)
    }
  }

  glDeleteRenderbuffers(n, renderbuffers) {
    const rbs = this.readUintArray(renderbuffers, n)
    for (const id of rbs) {
      const rb = this.getObject(id, this.renderbuffers)
      if (rb) {
        this.gl.deleteRenderbuffer(rb)
        this.deleteObject(id, this.renderbuffers)
      }
    }
  }

  glDeleteSamplers(count, samplers) {
    const samps = this.readUintArray(samplers, count)
    for (const id of samps) {
      const samp = this.getObject(id, this.samplers)
      if (samp) {
        this.gl.deleteSampler(samp)
        this.deleteObject(id, this.samplers)
      }
    }
  }

  glDeleteShader(shader) {
    const shad = this.getObject(shader, this.shaders)
    if (shad) {
      this.gl.deleteShader(shad)
      this.deleteObject(shader, this.shaders)
    }
  }

  glDeleteTextures(n, textures) {
    const texs = this.readUintArray(textures, n)
    for (const id of texs) {
      const tex = this.getObject(id, this.textures)
      if (tex) {
        this.gl.deleteTexture(tex)
        this.deleteObject(id, this.textures)
      }
    }
  }

  glDeleteVertexArrays(n, arrays) {
    const vaos = this.readUintArray(arrays, n)
    for (const id of vaos) {
      const vao = this.getObject(id, this.vertexArrays)
      if (vao) {
        this.gl.deleteVertexArray(vao)
        this.deleteObject(id, this.vertexArrays)
      }
    }
  }

  glDepthFunc(func) {
    this.gl.depthFunc(func)
  }

  glDepthMask(flag) {
    this.gl.depthMask(flag)
  }

  glDisable(cap) {
    this.gl.disable(cap)
  }

  glDisableVertexAttribArray(index) {
    this.gl.disableVertexAttribArray(index)
  }

  glDispatchCompute(num_groups_x, num_groups_y, num_groups_z) {
    this.gl.dispatchCompute(num_groups_x, num_groups_y, num_groups_z)
  }

  glDrawArrays(mode, first, count) {
    this.gl.drawArrays(mode, first, count)
  }

  glDrawArraysInstanced(mode, first, count, instancecount) {
    this.gl.drawArraysInstanced(mode, first, count, instancecount)
  }

  glDrawArraysInstancedBaseInstance(
    mode,
    first,
    count,
    instancecount,
    baseinstance,
  ) {
    // WebGL2 doesn't support base instance directly
    console.warn("glDrawArraysInstancedBaseInstance not supported in WebGL2")
    this.gl.drawArraysInstanced(mode, first, count, instancecount)
  }

  glDrawBuffers(n, bufs) {
    const buffers = this.readUintArray(bufs, n)
    this.gl.drawBuffers(buffers)
  }

  glDrawElements(mode, count, type, indices) {
    this.gl.drawElements(mode, count, type, indices)
  }

  glDrawElementsBaseVertex(mode, count, type, indices, basevertex) {
    // WebGL2 doesn't support base vertex directly
    console.warn("glDrawElementsBaseVertex not supported in WebGL2")
    this.gl.drawElements(mode, count, type, indices)
  }

  glDrawElementsInstanced(mode, count, type, indices, instancecount) {
    this.gl.drawElementsInstanced(mode, count, type, indices, instancecount)
  }

  glDrawElementsInstancedBaseVertex(
    mode,
    count,
    type,
    indices,
    instancecount,
    basevertex,
  ) {
    // WebGL2 doesn't support base vertex directly
    console.warn("glDrawElementsInstancedBaseVertex not supported in WebGL2")
    this.gl.drawElementsInstanced(mode, count, type, indices, instancecount)
  }

  glDrawElementsInstancedBaseVertexBaseInstance(
    mode,
    count,
    type,
    indices,
    instancecount,
    basevertex,
    baseinstance,
  ) {
    // WebGL2 doesn't support base vertex/base instance
    console.warn(
      "glDrawElementsInstancedBaseVertexBaseInstance not supported in WebGL2",
    )
    this.gl.drawElementsInstanced(mode, count, type, indices, instancecount)
  }

  glEnable(cap) {
    this.gl.enable(cap)
  }

  glEnableVertexAttribArray(index) {
    this.gl.enableVertexAttribArray(index)
  }

  glFenceSync(condition, flags) {
    const sync = this.gl.fenceSync(condition, flags)
    return this.getId(sync, this.syncs)
  }

  glFinish() {
    this.gl.finish()
  }

  glFlush() {
    this.gl.flush()
  }

  glFramebufferRenderbuffer(
    target,
    attachment,
    renderbuffertarget,
    renderbuffer,
  ) {
    const rb = this.getObject(renderbuffer, this.renderbuffers)
    this.gl.framebufferRenderbuffer(target, attachment, renderbuffertarget, rb)
  }

  glFramebufferTexture2D(target, attachment, textarget, texture, level) {
    const tex = this.getObject(texture, this.textures)
    this.gl.framebufferTexture2D(target, attachment, textarget, tex, level)
  }

  glFramebufferTextureLayer(target, attachment, texture, level, layer) {
    const tex = this.getObject(texture, this.textures)
    this.gl.framebufferTextureLayer(target, attachment, tex, level, layer)
  }

  glFrontFace(mode) {
    this.gl.frontFace(mode)
  }

  glGenBuffers(n, buffers) {
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < n; i++) {
      const buf = this.gl.createBuffer()
      const id = this.getId(buf, this.buffers)
      view.setUint32(buffers + i * 4, id, true)
    }
  }

  glGenFramebuffers(n, framebuffers) {
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < n; i++) {
      const fb = this.gl.createFramebuffer()
      const id = this.getId(fb, this.framebuffers)
      view.setUint32(framebuffers + i * 4, id, true)
    }
  }

  glGenRenderbuffers(n, renderbuffers) {
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < n; i++) {
      const rb = this.gl.createRenderbuffer()
      const id = this.getId(rb, this.renderbuffers)
      view.setUint32(renderbuffers + i * 4, id, true)
    }
  }

  glGenSamplers(count, samplers) {
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < count; i++) {
      const samp = this.gl.createSampler()
      const id = this.getId(samp, this.samplers)
      view.setUint32(samplers + i * 4, id, true)
    }
  }

  glGenTextures(n, textures) {
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < n; i++) {
      const tex = this.gl.createTexture()
      const id = this.getId(tex, this.textures)
      this.lastGeneratedTexture = tex
      this.lastGeneratedTextureId = id
      this.pendingTextureInitId = id
      view.setUint32(textures + i * 4, id, true)
    }
  }

  ensurePendingTextureBinding(target) {
    if (target !== this.gl.TEXTURE_2D) return
    if (!this.pendingTextureInitId) return
    const tex = this.getObject(this.pendingTextureInitId, this.textures)
    if (!tex) return
    this.gl.bindTexture(target, tex)
    this.boundTextures.set(
      `${this.activeTextureUnit}:${target}`,
      this.pendingTextureInitId,
    )
    this.pendingTextureInitId = 0
  }

  glGenVertexArrays(n, arrays) {
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < n; i++) {
      const vao = this.gl.createVertexArray()
      const id = this.getId(vao, this.vertexArrays)
      view.setUint32(arrays + i * 4, id, true)
    }
  }

  glGetActiveAttrib(program, index, bufSize, length, size, type, name) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    const info = this.gl.getActiveAttrib(prog, index)
    if (info) {
      const view = new DataView(this.memory.buffer)
      if (length) view.setInt32(length, info.name.length, true)
      if (size) view.setInt32(size, info.size, true)
      if (type) view.setInt32(type, info.type, true)
      if (name) {
        const nameBytes = this.textEncoder.encode(info.name)
        const nameArr = new Uint8Array(this.memory.buffer, name, bufSize)
        nameArr.set(nameBytes.slice(0, bufSize - 1))
        nameArr[nameBytes.length] = 0
      }
    }
  }

  glGetActiveUniform(program, index, bufSize, length, size, type, name) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    const info = this.gl.getActiveUniform(prog, index)
    if (info) {
      const view = new DataView(this.memory.buffer)
      if (length) view.setInt32(length, info.name.length, true)
      if (size) view.setInt32(size, info.size, true)
      if (type) view.setInt32(type, info.type, true)
      if (name) {
        const nameBytes = this.textEncoder.encode(info.name)
        const nameArr = new Uint8Array(this.memory.buffer, name, bufSize)
        nameArr.set(nameBytes.slice(0, bufSize - 1))
        nameArr[nameBytes.length] = 0
      }
    }
  }

  glGetActiveUniformBlockiv(program, uniformBlockIndex, pname, params) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    const value = this.gl.getActiveUniformBlockParameter(
      prog,
      uniformBlockIndex,
      pname,
    )
    const view = new DataView(this.memory.buffer)
    view.setInt32(params, value, true)
  }

  glGetActiveUniformBlockName(
    program,
    uniformBlockIndex,
    bufSize,
    length,
    uniformBlockName,
  ) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    const name = this.gl.getActiveUniformBlockName(prog, uniformBlockIndex)
    const view = new DataView(this.memory.buffer)
    if (length) view.setInt32(length, name.length, true)
    if (uniformBlockName) {
      const nameBytes = this.textEncoder.encode(name)
      const nameArr = new Uint8Array(
        this.memory.buffer,
        uniformBlockName,
        bufSize,
      )
      nameArr.set(nameBytes.slice(0, bufSize - 1))
      nameArr[nameBytes.length] = 0
    }
  }

  glGetActiveUniformsiv(program, uniformCount, uniformIndices, pname, params) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    const indices = this.readUintArray(uniformIndices, uniformCount)
    const values = this.gl.getActiveUniforms(prog, indices, pname)
    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < uniformCount; i++) {
      view.setInt32(params + i * 4, values[i], true)
    }
  }

  glGetAttribLocation(program, name) {
    const prog = this.getObject(program, this.programs)
    const nameStr = this.readString(name)
    if (!prog || !nameStr) return -1

    const key = `${program}_${nameStr}`
    if (this.attribLocations.has(key)) {
      return this.attribLocations.get(key)
    }

    const loc = this.gl.getAttribLocation(prog, nameStr)
    this.attribLocations.set(key, loc)
    return loc
  }

  glGetError() {
    return this.gl.getError()
  }

  glGetIntegerv(pname, data) {
    const view = new DataView(this.memory.buffer)
    const gl = this.gl

    // Pre-check unsupported enums to avoid WebGL console errors
    // These are OpenGL ES 3.0 enums not supported in WebGL2
    const unsupportedDefaults = {
      0x821b: 3, // GL_MAJOR_VERSION (WebGL2 = ES 3.0)
      0x821c: 0, // GL_MINOR_VERSION
      0x821d: 0, // GL_CONTEXT_FLAGS
      0x82d9: 16, // GL_MAX_VERTEX_ATTRIB_BINDINGS
      0x8a2f: 24, // GL_MAX_UNIFORM_BUFFER_BINDINGS
      0x8a2d: 8, // GL_MAX_COMBINED_UNIFORM_BLOCKS
      0x8a2e: 8, // GL_MAX_VERTEX_UNIFORM_BLOCKS
      0x8a2c: 8, // GL_MAX_FRAGMENT_UNIFORM_BLOCKS
      0x8a3c: 1024, // GL_MAX_UNIFORM_BLOCK_SIZE
      0x919f: 256, // GL_TEXTURE_BUFFER_OFFSET_ALIGNMENT
      0x8df4: 0, // GL_NUM_EXTENSIONS
      0x8b4c: 0, // GL_MAX_COLOR_ATTACHMENTS
      0x8824: 8, // GL_MAX_DRAW_BUFFERS (WebGL2 supports at least 8)
      0x8b4b: 0, // GL_MAX_DUAL_SOURCE_DRAW_BUFFERS
      0x8b4e: 1, // GL_MAX_COLOR_TEXTURE_SAMPLES
      0x8b4f: 1, // GL_MAX_DEPTH_TEXTURE_SAMPLES
      0x8b50: 1, // GL_MAX_INTEGER_SAMPLES
      0x8e8e: 0, // GL_MAX_VERTEX_STREAMS
      0x82de: 0, // GL_MAX_VERTEX_ATTRIB_RELATIVE_OFFSET
      0x82d8: 16, // GL_MAX_VERTEX_ATTRIB_STRIDE
      0x82e5: 0, // GL_MAX_ELEMENT_INDEX
    }

    if (pname in unsupportedDefaults) {
      view.setInt32(data, unsupportedDefaults[pname], true)
      return
    }

    switch (pname) {
      case gl.CURRENT_PROGRAM:
        view.setInt32(
          data,
          this.findId(gl.getParameter(pname), this.programs),
          true,
        )
        return
      case gl.ARRAY_BUFFER_BINDING:
      case gl.ELEMENT_ARRAY_BUFFER_BINDING:
        view.setInt32(
          data,
          this.findId(gl.getParameter(pname), this.buffers),
          true,
        )
        return
      case gl.VERTEX_ARRAY_BINDING:
        view.setInt32(
          data,
          this.findId(gl.getParameter(pname), this.vertexArrays),
          true,
        )
        return
      case gl.TEXTURE_BINDING_2D:
      case gl.TEXTURE_BINDING_CUBE_MAP:
      case gl.TEXTURE_BINDING_3D:
      case gl.TEXTURE_BINDING_2D_ARRAY:
        view.setInt32(
          data,
          this.findId(gl.getParameter(pname), this.textures),
          true,
        )
        return
      case gl.SAMPLER_BINDING:
        view.setInt32(
          data,
          this.findId(gl.getParameter(pname), this.samplers),
          true,
        )
        return
      case gl.RENDERBUFFER_BINDING:
        view.setInt32(
          data,
          this.findId(gl.getParameter(pname), this.renderbuffers),
          true,
        )
        return
      case gl.DRAW_FRAMEBUFFER_BINDING:
      case gl.READ_FRAMEBUFFER_BINDING:
        view.setInt32(
          data,
          this.findId(gl.getParameter(pname), this.framebuffers),
          true,
        )
        return
    }

    // Wrap in try-catch to catch any remaining unsupported enums
    try {
      const value = gl.getParameter(pname)

      if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        for (let i = 0; i < value.length; i++) {
          view.setInt32(data + i * 4, Number(value[i]) || 0, true)
        }
      } else if (typeof value === "number" || typeof value === "boolean") {
        view.setInt32(data, Number(value) || 0, true)
      } else {
        view.setInt32(data, 0, true)
      }
    } catch (e) {
      console.warn(
        `glGetIntegerv: Unknown unsupported parameter 0x${pname.toString(16)} - add to unsupportedDefaults`,
      )
      view.setInt32(data, 0, true)
    }
  }

  glGetProgramInfoLog(program, bufSize, length, infoLog) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    const log = this.gl.getProgramInfoLog(prog) || ""
    const view = new DataView(this.memory.buffer)
    if (length) view.setInt32(length, log.length, true)
    if (infoLog) {
      const logBytes = this.textEncoder.encode(log)
      const logArr = new Uint8Array(this.memory.buffer, infoLog, bufSize)
      logArr.set(logBytes.slice(0, bufSize - 1))
      logArr[logBytes.length] = 0
    }
  }

  glGetProgramiv(program, pname, params) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    let value
    switch (pname) {
      case 0x8b82: // GL_LINK_STATUS
        value = this.gl.getProgramParameter(prog, this.gl.LINK_STATUS) ? 1 : 0
        break
      case 0x8b84: // GL_INFO_LOG_LENGTH
        const log = this.gl.getProgramInfoLog(prog) || ""
        value = log.length + 1
        break
      case 0x8b86: // GL_ACTIVE_UNIFORMS
        value = this.gl.getProgramParameter(prog, this.gl.ACTIVE_UNIFORMS)
        break
      case 0x8b89: // GL_ACTIVE_ATTRIBUTES
        value = this.gl.getProgramParameter(prog, this.gl.ACTIVE_ATTRIBUTES)
        break
      default:
        value = this.gl.getProgramParameter(prog, pname)
    }

    const view = new DataView(this.memory.buffer)
    view.setInt32(params, value, true)
  }

  glGetShaderInfoLog(shader, bufSize, length, infoLog) {
    const shad = this.getObject(shader, this.shaders)
    if (!shad) return

    const log = this.gl.getShaderInfoLog(shad) || ""
    const view = new DataView(this.memory.buffer)
    if (length) view.setInt32(length, log.length, true)
    if (infoLog) {
      const logBytes = this.textEncoder.encode(log)
      const logArr = new Uint8Array(this.memory.buffer, infoLog, bufSize)
      logArr.set(logBytes.slice(0, bufSize - 1))
      logArr[logBytes.length] = 0
    }
  }

  glGetShaderiv(shader, pname, params) {
    const shad = this.getObject(shader, this.shaders)
    if (!shad) return

    let value
    switch (pname) {
      case 0x8b81: // GL_COMPILE_STATUS
        value = this.gl.getShaderParameter(shad, this.gl.COMPILE_STATUS) ? 1 : 0
        break
      case 0x8b84: // GL_INFO_LOG_LENGTH
        const log = this.gl.getShaderInfoLog(shad) || ""
        value = log.length + 1
        break
      default:
        value = this.gl.getShaderParameter(shad, pname)
    }

    const view = new DataView(this.memory.buffer)
    view.setInt32(params, value, true)
  }

  glGetString(name) {
    const gl = this.gl

    // Clear any previous errors
    gl.getError()

    const str = gl.getParameter(name)
    const error = gl.getError()

    if (error === gl.INVALID_ENUM) {
      console.warn(`glGetString: Unsupported name 0x${name.toString(16)}`)
      return 0
    }

    if (!str) return 0

    // We do not currently expose a WASM-side allocator here, so returning a
    // JS object would violate the import ABI. Return 0 until this bridge can
    // write strings into module memory and hand back a real pointer.
    return 0
  }

  glGetStringi(name, index) {
    const extensions = this.gl.getSupportedExtensions()
    if (!extensions || index >= extensions.length) return 0

    return 0
  }

  glGetUniformBlockIndex(program, uniformBlockName) {
    const prog = this.getObject(program, this.programs)
    const nameStr = this.readString(uniformBlockName)
    if (!prog || !nameStr) return -1

    return this.gl.getUniformBlockIndex(prog, nameStr)
  }

  glGetUniformIndices(program, uniformCount, uniformNames, uniformIndices) {
    const prog = this.getObject(program, this.programs)
    if (!prog) return

    const names = this.readStringArray(uniformNames, uniformCount)
    const indices = this.gl.getUniformIndices(prog, names)

    const view = new DataView(this.memory.buffer)
    for (let i = 0; i < uniformCount; i++) {
      view.setUint32(uniformIndices + i * 4, indices[i], true)
    }
  }

  glGetUniformLocation(program, name) {
    const prog = this.getObject(program, this.programs)
    const nameStr = this.readString(name)
    if (!prog || !nameStr) return -1

    const key = `${program}_${nameStr}`
    if (this.uniformLocations.has(key)) {
      return this.uniformLocations.get(key)
    }

    const loc = this.gl.getUniformLocation(prog, nameStr)
    if (!loc) return -1

    const id = this.nextId++
    this.uniformLocations.set(key, id)
    this.uniformLocations.set(id, loc)
    return id
  }

  glInvalidateFramebuffer(target, numAttachments, attachments) {
    const atts = this.readUintArray(attachments, numAttachments)
    this.gl.invalidateFramebuffer(target, atts)
  }

  glIsSync(sync) {
    const s = this.getObject(sync, this.syncs)
    return s ? 1 : 0
  }

  glLineWidth(width) {
    this.gl.lineWidth(width)
  }

  glLinkProgram(program) {
    const prog = this.getObject(program, this.programs)
    if (prog) {
      this.gl.linkProgram(prog)
    }
  }

  glMapBufferRange(target, offset, length, access) {
    // WebGL2 doesn't support mapBufferRange
    console.warn("glMapBufferRange not supported in WebGL2")
    return 0
  }

  glMemoryBarrier(barriers) {
    // WebGL2 doesn't support memoryBarrier
    console.warn("glMemoryBarrier not supported in WebGL2")
  }

  glPixelStorei(pname, param) {
    this.gl.pixelStorei(pname, param)
  }

  glPolygonOffset(factor, units) {
    this.gl.polygonOffset(factor, units)
  }

  glReadBuffer(src) {
    this.gl.readBuffer(src)
  }

  glReadPixels(x, y, width, height, format, type, pixels) {
    // WebGL2 readPixels requires a buffer
    console.warn("glReadPixels not fully implemented")
  }

  glRenderbufferStorage(target, internalformat, width, height) {
    this.gl.renderbufferStorage(target, internalformat, width, height)
  }

  glRenderbufferStorageMultisample(
    target,
    samples,
    internalformat,
    width,
    height,
  ) {
    this.gl.renderbufferStorageMultisample(
      target,
      samples,
      internalformat,
      width,
      height,
    )
  }

  glSamplerParameterf(sampler, pname, param) {
    const samp = this.getObject(sampler, this.samplers)
    if (samp) {
      this.gl.samplerParameterf(samp, pname, param)
    }
  }

  glSamplerParameteri(sampler, pname, param) {
    const samp = this.getObject(sampler, this.samplers)
    if (samp) {
      this.gl.samplerParameteri(samp, pname, param)
    }
  }

  glScissor(x, y, width, height) {
    this.gl.scissor(x, y, width, height)
  }

  glShaderSource(shader, count, string, length) {
    const shad = this.getObject(shader, this.shaders)
    if (!shad) return

    const sources = this.readStringArray(string, count)
    const source = sources.join("")
    this.gl.shaderSource(shad, source)
  }

  glStencilFunc(func, ref, mask) {
    this.gl.stencilFunc(func, ref, mask)
  }

  glStencilFuncSeparate(face, func, ref, mask) {
    this.gl.stencilFuncSeparate(face, func, ref, mask)
  }

  glStencilMask(mask) {
    this.gl.stencilMask(mask)
  }

  glStencilMaskSeparate(face, mask) {
    this.gl.stencilMaskSeparate(face, mask)
  }

  glStencilOp(fail, zfail, zpass) {
    this.gl.stencilOp(fail, zfail, zpass)
  }

  glStencilOpSeparate(face, sfail, dpfail, dppass) {
    this.gl.stencilOpSeparate(face, sfail, dpfail, dppass)
  }

  glTexImage2D(
    target,
    level,
    internalformat,
    width,
    height,
    border,
    format,
    type,
    pixels,
  ) {
    this.ensurePendingTextureBinding(target)
    if (pixels === 0) {
      this.gl.texImage2D(
        target,
        level,
        internalformat,
        width,
        height,
        border,
        format,
        type,
        null,
      )
    } else {
      // Calculate size based on format and type
      const size = width * height * 4 // Simplified
      const data = new Uint8Array(this.memory.buffer, pixels, size)
      this.gl.texImage2D(
        target,
        level,
        internalformat,
        width,
        height,
        border,
        format,
        type,
        data,
      )
    }
  }

  glTexImage3D(
    target,
    level,
    internalformat,
    width,
    height,
    depth,
    border,
    format,
    type,
    pixels,
  ) {
    if (pixels === 0) {
      this.gl.texImage3D(
        target,
        level,
        internalformat,
        width,
        height,
        depth,
        border,
        format,
        type,
        null,
      )
    } else {
      const size = width * height * depth * 4 // Simplified
      const data = new Uint8Array(this.memory.buffer, pixels, size)
      this.gl.texImage3D(
        target,
        level,
        internalformat,
        width,
        height,
        depth,
        border,
        format,
        type,
        data,
      )
    }
  }

  glTexParameterf(target, pname, param) {
    this.gl.texParameterf(target, pname, param)
  }

  glTexParameteri(target, pname, param) {
    this.ensurePendingTextureBinding(target)
    this.gl.texParameteri(target, pname, param)
  }

  glTexStorage2D(target, levels, internalformat, width, height) {
    this.ensurePendingTextureBinding(target)
    this.gl.texStorage2D(target, levels, internalformat, width, height)
  }

  glTexStorage3D(target, levels, internalformat, width, height, depth) {
    this.gl.texStorage3D(target, levels, internalformat, width, height, depth)
  }

  glTexSubImage2D(
    target,
    level,
    xoffset,
    yoffset,
    width,
    height,
    format,
    type,
    pixels,
  ) {
    this.ensurePendingTextureBinding(target)
    const size = width * height * 4 // Simplified
    const data = new Uint8Array(this.memory.buffer, pixels, size)
    this.gl.texSubImage2D(
      target,
      level,
      xoffset,
      yoffset,
      width,
      height,
      format,
      type,
      data,
    )
  }

  glTexSubImage3D(
    target,
    level,
    xoffset,
    yoffset,
    zoffset,
    width,
    height,
    depth,
    format,
    type,
    pixels,
  ) {
    const size = width * height * depth * 4 // Simplified
    const data = new Uint8Array(this.memory.buffer, pixels, size)
    this.gl.texSubImage3D(
      target,
      level,
      xoffset,
      yoffset,
      zoffset,
      width,
      height,
      depth,
      format,
      type,
      data,
    )
  }

  glUniform1f(location, v0) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform1f(loc, v0)
    }
  }

  glUniform1fv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count)
      this.gl.uniform1fv(loc, arr)
    }
  }

  glUniform1i(location, v0) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform1i(loc, v0)
    }
  }

  glUniform1iv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readIntArray(value, count)
      this.gl.uniform1iv(loc, arr)
    }
  }

  glUniform1ui(location, v0) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform1ui(loc, v0)
    }
  }

  glUniform1uiv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readUintArray(value, count)
      this.gl.uniform1uiv(loc, arr)
    }
  }

  glUniform2f(location, v0, v1) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform2f(loc, v0, v1)
    }
  }

  glUniform2fv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 2)
      this.gl.uniform2fv(loc, arr)
    }
  }

  glUniform2i(location, v0, v1) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform2i(loc, v0, v1)
    }
  }

  glUniform2iv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readIntArray(value, count * 2)
      this.gl.uniform2iv(loc, arr)
    }
  }

  glUniform2ui(location, v0, v1) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform2ui(loc, v0, v1)
    }
  }

  glUniform2uiv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readUintArray(value, count * 2)
      this.gl.uniform2uiv(loc, arr)
    }
  }

  glUniform3f(location, v0, v1, v2) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform3f(loc, v0, v1, v2)
    }
  }

  glUniform3fv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 3)
      this.gl.uniform3fv(loc, arr)
    }
  }

  glUniform3i(location, v0, v1, v2) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform3i(loc, v0, v1, v2)
    }
  }

  glUniform3iv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readIntArray(value, count * 3)
      this.gl.uniform3iv(loc, arr)
    }
  }

  glUniform3ui(location, v0, v1, v2) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform3ui(loc, v0, v1, v2)
    }
  }

  glUniform3uiv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readUintArray(value, count * 3)
      this.gl.uniform3uiv(loc, arr)
    }
  }

  glUniform4f(location, v0, v1, v2, v3) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform4f(loc, v0, v1, v2, v3)
    }
  }

  glUniform4fv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 4)
      this.gl.uniform4fv(loc, arr)
    }
  }

  glUniform4i(location, v0, v1, v2, v3) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform4i(loc, v0, v1, v2, v3)
    }
  }

  glUniform4iv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readIntArray(value, count * 4)
      this.gl.uniform4iv(loc, arr)
    }
  }

  glUniform4ui(location, v0, v1, v2, v3) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      this.gl.uniform4ui(loc, v0, v1, v2, v3)
    }
  }

  glUniform4uiv(location, count, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readUintArray(value, count * 4)
      this.gl.uniform4uiv(loc, arr)
    }
  }

  glUniformBlockBinding(program, uniformBlockIndex, uniformBlockBinding) {
    const prog = this.getObject(program, this.programs)
    if (prog) {
      this.gl.uniformBlockBinding(prog, uniformBlockIndex, uniformBlockBinding)
    }
  }

  glUniformMatrix2fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 4)
      this.gl.uniformMatrix2fv(loc, transpose, arr)
    }
  }

  glUniformMatrix2x3fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 6)
      this.gl.uniformMatrix2x3fv(loc, transpose, arr)
    }
  }

  glUniformMatrix2x4fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 8)
      this.gl.uniformMatrix2x4fv(loc, transpose, arr)
    }
  }

  glUniformMatrix3fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 9)
      this.gl.uniformMatrix3fv(loc, transpose, arr)
    }
  }

  glUniformMatrix3x2fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 6)
      this.gl.uniformMatrix3x2fv(loc, transpose, arr)
    }
  }

  glUniformMatrix3x4fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 12)
      this.gl.uniformMatrix3x4fv(loc, transpose, arr)
    }
  }

  glUniformMatrix4fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 16)
      this.gl.uniformMatrix4fv(loc, transpose, arr)
    }
  }

  glUniformMatrix4x2fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 8)
      this.gl.uniformMatrix4x2fv(loc, transpose, arr)
    }
  }

  glUniformMatrix4x3fv(location, count, transpose, value) {
    const loc = this.uniformLocations.get(location)
    if (loc && typeof loc !== "number") {
      const arr = this.readFloatArray(value, count * 12)
      this.gl.uniformMatrix4x3fv(loc, transpose, arr)
    }
  }

  glUnmapBuffer(target) {
    // WebGL2 doesn't support unmapBuffer
    return 1 // TRUE
  }

  glUseProgram(program) {
    const prog = this.getObject(program, this.programs)
    this.gl.useProgram(prog)
    this.currentProgram = program
  }

  glVertexAttribDivisor(index, divisor) {
    this.gl.vertexAttribDivisor(index, divisor)
  }

  glVertexAttribIPointer(index, size, type, stride, pointer) {
    this.gl.vertexAttribIPointer(index, size, type, stride, pointer)
  }

  glVertexAttribPointer(index, size, type, normalized, stride, pointer) {
    this.gl.vertexAttribPointer(index, size, type, normalized, stride, pointer)
  }

  glViewport(x, y, width, height) {
    this.gl.viewport(x, y, width, height)
  }

  glWaitSync(sync, flags, timeout) {
    const s = this.getObject(sync, this.syncs)
    if (s) {
      this.gl.waitSync(s, flags, timeout)
    }
  }

  // Helper method to create the import object for WASM
  createImportObject() {
    const imports = {}
    const methodNames = Object.getOwnPropertyNames(
      Object.getPrototypeOf(this),
    ).filter((name) => name.startsWith("gl"))

    for (const name of methodNames) {
      imports[name] = this[name].bind(this)
    }

    return imports
  }
}
