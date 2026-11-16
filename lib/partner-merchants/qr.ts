import { deflateSync } from "node:zlib"
import { isPartnerPublicUrl } from "@/lib/partner-merchants/public-url"
import { partnerQrMatrix, partnerQrSvg } from "@/lib/partner-merchants/qr-matrix"

export function assertPartnerQrUrl(url: string): void {
  if (!isPartnerPublicUrl(url) || url.includes("?") || url.includes("#")) {
    throw new Error("qr_url_rejected")
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (~crc) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4)
  const crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  crc.writeUInt32BE(crc32(head))
  return Buffer.concat([length, head, crc])
}

function partnerQrPng(url: string): Buffer {
  const matrix = partnerQrMatrix(url)
  const count = matrix.length
  const margin = 2
  const modules = count + margin * 2
  const scale = Math.max(8, Math.ceil(1024 / modules))
  const size = modules * scale
  const raw = Buffer.alloc((size + 1) * size)
  let offset = 0
  for (let y = 0; y < size; y += 1) {
    raw[offset] = 0
    offset += 1
    const row = Math.floor(y / scale) - margin
    for (let x = 0; x < size; x += 1) {
      const column = Math.floor(x / scale) - margin
      const dark = row >= 0 && column >= 0 && row < count && column < count && matrix[row][column]
      raw[offset] = dark ? 0 : 255
      offset += 1
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 0
  header[10] = 0
  header[11] = 0
  header[12] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

/** QR local, sem API externa. O conteúdo é somente o link HTTPS. */
export async function renderPartnerQr(url: string): Promise<{ svg: string; png: Buffer }> {
  assertPartnerQrUrl(url)
  return { svg: partnerQrSvg(url), png: partnerQrPng(url) }
}
