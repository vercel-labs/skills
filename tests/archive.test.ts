import { describe, expect, it } from 'vitest';
import { ArchiveValidationError, readZipArchive } from '../src/archive.ts';
import { createZip } from './fixtures/zip.ts';

function convertToZip64(archive: Buffer): Buffer {
  const endOffset = archive.length - 22;
  const entries = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  const prefix = archive.subarray(0, endOffset);

  const zip64End = Buffer.alloc(56);
  zip64End.writeUInt32LE(0x06064b50, 0);
  zip64End.writeBigUInt64LE(44n, 4);
  zip64End.writeUInt16LE(45, 12);
  zip64End.writeUInt16LE(45, 14);
  zip64End.writeBigUInt64LE(BigInt(entries), 24);
  zip64End.writeBigUInt64LE(BigInt(entries), 32);
  zip64End.writeBigUInt64LE(BigInt(centralDirectorySize), 40);
  zip64End.writeBigUInt64LE(BigInt(centralDirectoryOffset), 48);

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(prefix.length), 8);
  locator.writeUInt32LE(1, 16);

  const end = Buffer.from(archive.subarray(endOffset));
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);

  return Buffer.concat([prefix, zip64End, locator, end]);
}

describe('readZipArchive', () => {
  it('returns files from a stored zip archive', () => {
    const archive = createZip([
      { path: 'SKILL.md', contents: '# skill' },
      { path: 'references/README.md', contents: 'reference' },
    ]);

    const files = readZipArchive(archive, {
      maxExtractedBytes: 1024,
      maxEntries: 10,
    });

    expect(Buffer.from(files.get('SKILL.md')!)).toEqual(Buffer.from('# skill'));
    expect(Buffer.from(files.get('references/README.md')!)).toEqual(Buffer.from('reference'));
  });

  it('inflates deflated entries', () => {
    const archive = createZip([
      {
        path: 'SKILL.md',
        contents: '# compressed skill',
        method: 'deflate',
      },
    ]);

    const files = readZipArchive(archive, {
      maxExtractedBytes: 1024,
      maxEntries: 10,
    });

    expect(Buffer.from(files.get('SKILL.md')!)).toEqual(Buffer.from('# compressed skill'));
  });

  it('rejects paths that escape the extraction root', () => {
    const archive = createZip([{ path: '../SKILL.md', contents: '# unsafe' }]);

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 10,
      })
    ).toThrow('Archive contains unsafe path');
  });

  it('rejects drive-prefixed paths', () => {
    const archive = createZip([{ path: 'C:SKILL.md', contents: '# unsafe' }]);

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 10,
      })
    ).toThrow('Archive contains unsafe path');
  });

  it('rejects encrypted entries', () => {
    const archive = createZip([
      {
        path: 'SKILL.md',
        contents: '# encrypted',
        encrypted: true,
      },
    ]);

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 10,
      })
    ).toThrow('Encrypted zip entries are not supported');
  });

  it('rejects symbolic links', () => {
    const archive = createZip([
      {
        path: 'SKILL.md',
        contents: 'target',
        unixMode: 0o120777,
      },
    ]);

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 10,
      })
    ).toThrow('Archive links are not supported');
  });

  it('counts directory entries toward the archive entry limit', () => {
    const archive = createZip([
      {
        path: 'skill/',
        contents: '',
        unixMode: 0o040755,
      },
      {
        path: 'skill/SKILL.md',
        contents: '# skill',
      },
    ]);

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 1,
      })
    ).toThrow(ArchiveValidationError);
  });

  it('omits directory entries after normalizing dot segments', () => {
    const archive = createZip([
      {
        path: './',
        contents: '',
        unixMode: 0o040755,
      },
      {
        path: './SKILL.md',
        contents: '# skill',
      },
    ]);

    const files = readZipArchive(archive, {
      maxExtractedBytes: 1024,
      maxEntries: 10,
    });

    expect([...files.keys()]).toEqual(['SKILL.md']);
  });

  it('rejects entries whose contents do not match their checksum', () => {
    const archive = createZip([{ path: 'SKILL.md', contents: '# skill' }]);
    const contentsOffset = archive.indexOf(Buffer.from('# skill'));
    archive[contentsOffset] ^= 0xff;

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 10,
      })
    ).toThrow('Zip entry checksum mismatch');
  });

  it('decodes legacy cp437 file names', () => {
    const archive = createZip([
      {
        path: Buffer.from([
          0x63, 0x61, 0x66, 0x82, 0x2f, 0x53, 0x4b, 0x49, 0x4c, 0x4c, 0x2e, 0x6d, 0x64,
        ]),
        contents: '# skill',
      },
    ]);

    const files = readZipArchive(archive, {
      maxExtractedBytes: 1024,
      maxEntries: 10,
    });

    expect(Buffer.from(files.get('café/SKILL.md')!)).toEqual(Buffer.from('# skill'));
  });

  it('reads zip64 central directory metadata', () => {
    const archive = convertToZip64(createZip([{ path: 'SKILL.md', contents: '# zip64 skill' }]));

    const files = readZipArchive(archive, {
      maxExtractedBytes: 1024,
      maxEntries: 10,
    });

    expect(Buffer.from(files.get('SKILL.md')!)).toEqual(Buffer.from('# zip64 skill'));
  });

  it('uses a valid info-zip unicode path', () => {
    const archive = createZip([
      {
        path: 'cafe/SKILL.md',
        unicodePath: 'café/SKILL.md',
        contents: '# unicode skill',
      },
    ]);

    const files = readZipArchive(archive, {
      maxExtractedBytes: 1024,
      maxEntries: 10,
    });

    expect(Buffer.from(files.get('café/SKILL.md')!)).toEqual(Buffer.from('# unicode skill'));
  });

  it('reads zip64 entry sizes and offsets', () => {
    const archive = createZip([
      {
        path: 'SKILL.md',
        contents: '# zip64 entry',
        zip64Entry: true,
      },
    ]);

    const files = readZipArchive(archive, {
      maxExtractedBytes: 1024,
      maxEntries: 10,
    });

    expect(Buffer.from(files.get('SKILL.md')!)).toEqual(Buffer.from('# zip64 entry'));
  });

  it('rejects mismatched local and central directory headers', () => {
    const archive = createZip([{ path: 'SKILL.md', contents: '# skill' }]);
    archive[30] = 'X'.charCodeAt(0);

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 10,
      })
    ).toThrow('Zip local header does not match central directory');
  });

  it('rejects inconsistent central directory metadata', () => {
    const archive = createZip([{ path: 'SKILL.md', contents: '# skill' }]);
    const endOffset = archive.length - 22;
    archive.writeUInt32LE(archive.readUInt32LE(endOffset + 12) + 1, endOffset + 12);

    expect(() =>
      readZipArchive(archive, {
        maxExtractedBytes: 1024,
        maxEntries: 10,
      })
    ).toThrow('Invalid zip');
  });
});
