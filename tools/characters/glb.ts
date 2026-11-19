/**
 * Minimal glTF 2.0 binary (GLB) reading and writing for the character generator.
 * Reads what the generator needs from the CC0 source rig (nodes, skin, animations) and writes
 * skinned meshes + that rig + its animations into one self-contained GLB.
 */
import { readFileSync, writeFileSync } from 'node:fs';

export interface Gltf {
  json: any;
  bin: Buffer;
}

export function readGlb(path: string): Gltf {
  const b = readFileSync(path);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let off = 12;
  let json: any = null;
  let bin = Buffer.alloc(0);
  while (off < b.length) {
    const len = b.readUInt32LE(off);
    const type = b.readUInt32LE(off + 4);
    const chunk = b.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    else if (type === 0x004e4942) bin = Buffer.from(chunk);
    off += 8 + len;
  }
  return { json, bin };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

/** An accessor's data as plain numbers (one flat array). */
export function accessor(g: Gltf, index: number): number[] {
  const a = g.json.accessors[index];
  const bv = g.json.bufferViews[a.bufferView];
  const comps = COMPONENTS[a.type];
  const size = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 || a.componentType === 5122 ? 2 : 1;
  const stride = bv.byteStride ?? comps * size;
  const base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < comps; c++) {
      const o = base + i * stride + c * size;
      switch (a.componentType) {
        case 5126: out.push(g.bin.readFloatLE(o)); break;
        case 5125: out.push(g.bin.readUInt32LE(o)); break;
        case 5123: out.push(g.bin.readUInt16LE(o)); break;
        case 5122: out.push(g.bin.readInt16LE(o)); break;
        case 5121: out.push(g.bin.readUInt8(o)); break;
        default: out.push(g.bin.readInt8(o));
      }
    }
  }
  return out;
}

/** Builds a GLB: append typed arrays as accessors, then `finish`. */
export class GlbWriter {
  readonly json: any = {
    asset: { version: '2.0', generator: 'WHOOPA TOWNE Urban Ink character generator' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  private chunks: Buffer[] = [];
  private length = 0;

  /** Adds raw bytes as a buffer view (4-byte aligned). */
  private view(bytes: Buffer, target?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) {
      this.chunks.push(Buffer.alloc(pad));
      this.length += pad;
    }
    this.json.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.length, ...(target ? { target } : {}) });
    this.chunks.push(bytes);
    this.length += bytes.length;
    return this.json.bufferViews.length - 1;
  }

  /** Float32 / Uint16 / Uint32 / Uint8 accessor. `minmax` adds bounds (required for POSITION). */
  accessor(data: Float32Array | Uint16Array | Uint32Array | Uint8Array, type: string, opts: { target?: number; minmax?: boolean; normalized?: boolean } = {}): number {
    const comps = COMPONENTS[type];
    const componentType = data instanceof Float32Array ? 5126 : data instanceof Uint16Array ? 5123 : data instanceof Uint32Array ? 5125 : 5121;
    const view = this.view(Buffer.from(data.buffer, data.byteOffset, data.byteLength), opts.target);
    const acc: any = { bufferView: view, componentType, count: data.length / comps, type };
    if (opts.normalized) acc.normalized = true;
    if (opts.minmax) {
      const min = new Array(comps).fill(Infinity), max = new Array(comps).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        const c = i % comps;
        if (data[i] < min[c]) min[c] = data[i];
        if (data[i] > max[c]) max[c] = data[i];
      }
      acc.min = min;
      acc.max = max;
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }

  /** Copies an accessor (data + type) from another file. */
  copyAccessor(src: Gltf, index: number): number {
    const a = src.json.accessors[index];
    const vals = accessor(src, index);
    const data = a.componentType === 5126 ? Float32Array.from(vals) : a.componentType === 5125 ? Uint32Array.from(vals) : a.componentType === 5123 ? Uint16Array.from(vals) : Uint8Array.from(vals);
    const i = this.accessor(data, a.type, { minmax: a.min !== undefined });
    if (a.normalized) this.json.accessors[i].normalized = true;
    return i;
  }

  material(name: string, color: [number, number, number], roughness = 0.85, metallic = 0): number {
    this.json.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...color, 1], roughnessFactor: roughness, metallicFactor: metallic } });
    return this.json.materials.length - 1;
  }

  write(path: string): number {
    const binary = Buffer.concat(this.chunks);
    this.json.buffers[0].byteLength = binary.length;
    const jsonBuf = Buffer.from(JSON.stringify(this.json), 'utf8');
    const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
    const binPad = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)]);
    const total = 12 + 8 + jsonPad.length + 8 + binPad.length;
    const head = Buffer.alloc(12);
    head.writeUInt32LE(0x46546c67, 0);
    head.writeUInt32LE(2, 4);
    head.writeUInt32LE(total, 8);
    const jh = Buffer.alloc(8);
    jh.writeUInt32LE(jsonPad.length, 0);
    jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(binPad.length, 0);
    bh.writeUInt32LE(0x004e4942, 4);
    writeFileSync(path, Buffer.concat([head, jh, jsonPad, bh, binPad]));
    return total;
  }
}
