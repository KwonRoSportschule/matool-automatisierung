export interface ZipEntry {
  data: Uint8Array;
  name: string;
}

const UTF8_FLAG = 0x0800;
const STORED_METHOD = 0;

/**
 * Small, dependency-free ZIP writer for Cloudflare Workers. XLSX files are
 * ZIP containers themselves, so keeping this implementation isolated avoids
 * adding a Node-only spreadsheet dependency to the existing Worker bundle.
 */
export function createStoredZip(
  entries: readonly ZipEntry[],
  modifiedAt: Date
): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  const dos = dosTimestamp(modifiedAt);

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    if (name.length === 0 || name.length > 65_535) {
      throw new Error("invalid_zip_entry_name");
    }
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, UTF8_FLAG);
    writeUint16(localView, 8, STORED_METHOD);
    writeUint16(localView, 10, dos.time);
    writeUint16(localView, 12, dos.date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, entry.data.length);
    writeUint32(localView, 22, entry.data.length);
    writeUint16(localView, 26, name.length);
    writeUint16(localView, 28, 0);
    local.set(name, 30);
    localParts.push(local, entry.data);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, UTF8_FLAG);
    writeUint16(centralView, 10, STORED_METHOD);
    writeUint16(centralView, 12, dos.time);
    writeUint16(centralView, 14, dos.date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, entry.data.length);
    writeUint32(centralView, 24, entry.data.length);
    writeUint16(centralView, 28, name.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    central.set(name, 46);
    centralParts.push(central);
    localOffset += local.length + entry.data.length;
  }

  const central = concatenate(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, central.length);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);
  return concatenate([...localParts, central, end]);
}

function dosTimestamp(value: Date): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, value.getUTCFullYear()));
  return {
    date:
      ((year - 1980) << 9) |
      ((value.getUTCMonth() + 1) << 5) |
      value.getUTCDate(),
    time:
      (value.getUTCHours() << 11) |
      (value.getUTCMinutes() << 5) |
      Math.floor(value.getUTCSeconds() / 2)
  };
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0)
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}
