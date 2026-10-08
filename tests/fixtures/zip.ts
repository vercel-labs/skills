import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipFixtureEntry {
  path: string | Buffer;
  contents: string;
  method?: 'store' | 'deflate';
  encrypted?: boolean;
  unicodePath?: string;
  unixMode?: number;
  zip64Entry?: boolean;
}

export function createZip(entries: ZipFixtureEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.isBuffer(entry.path) ? entry.path : Buffer.from(entry.path);
    const contents = Buffer.from(entry.contents);
    const method = entry.method === 'deflate' ? 8 : 0;
    const flags = entry.encrypted ? 0x1 : 0;
    const compressed = method === 8 ? deflateRawSync(contents) : contents;
    const checksum = crc32(contents);
    const extraParts: Buffer[] = [];

    if (entry.zip64Entry) {
      const zip64Extra = Buffer.alloc(28);
      zip64Extra.writeUInt16LE(0x0001, 0);
      zip64Extra.writeUInt16LE(24, 2);
      zip64Extra.writeBigUInt64LE(BigInt(contents.length), 4);
      zip64Extra.writeBigUInt64LE(BigInt(compressed.length), 12);
      zip64Extra.writeBigUInt64LE(BigInt(offset), 20);
      extraParts.push(zip64Extra);
    }

    if (entry.unicodePath) {
      const unicodeName = Buffer.from(entry.unicodePath);
      const unicodeExtra = Buffer.alloc(9 + unicodeName.length);
      unicodeExtra.writeUInt16LE(0x7075, 0);
      unicodeExtra.writeUInt16LE(5 + unicodeName.length, 2);
      unicodeExtra[4] = 1;
      unicodeExtra.writeUInt32LE(crc32(name), 5);
      unicodeName.copy(unicodeExtra, 9);
      extraParts.push(unicodeExtra);
    }

    const centralExtra = Buffer.concat(extraParts);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(contents.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE((3 << 8) | 20, 4);
    centralHeader.writeUInt16LE(entry.zip64Entry ? 45 : 20, 6);
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.zip64Entry ? 0xffffffff : compressed.length, 20);
    centralHeader.writeUInt32LE(entry.zip64Entry ? 0xffffffff : contents.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(centralExtra.length, 30);
    centralHeader.writeUInt32LE((entry.unixMode ?? 0o100644) * 0x10000, 38);
    centralHeader.writeUInt32LE(entry.zip64Entry ? 0xffffffff : offset, 42);
    centralParts.push(centralHeader, name, centralExtra);

    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
