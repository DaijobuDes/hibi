import { crc32, deflateRawSync } from 'node:zlib'

// Small ZIP builder for hostile archive cases; never extracts or executes code.
export function zipFiles(files) {
  const local = [],
    central = []
  let offset = 0
  for (const {
    name,
    content = '',
    mode = 0x8000,
    flags = 0,
    declaredSize,
    crc,
    deflate = false,
  } of files) {
    const path = Buffer.from(name),
      data = Buffer.from(content)
    const packed = deflate ? deflateRawSync(data) : data
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(flags, 6)
    header.writeUInt16LE(deflate ? 8 : 0, 8)
    header.writeUInt32LE(crc ?? crc32(data), 14)
    header.writeUInt32LE(packed.length, 18)
    header.writeUInt32LE(declaredSize ?? data.length, 22)
    header.writeUInt16LE(path.length, 26)
    local.push(header, path, packed)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50)
    entry.writeUInt16LE(0x314, 4)
    header.copy(entry, 6, 4, 28)
    entry.writeUInt32LE((mode << 16) >>> 0, 38)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, path)
    offset += header.length + path.length + packed.length
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end])
}
