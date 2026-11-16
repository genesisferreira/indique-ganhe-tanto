import qrcode from "@/lib/partner-merchants/vendor/qrcode-generator.js"

export type QrMatrix = boolean[][]

/** Matriz local. O QR contém somente o link HTTPS informado. */
export function partnerQrMatrix(url: string): QrMatrix {
  const code = qrcode(0, "M")
  code.addData(url)
  code.make()
  const count = code.getModuleCount()
  const matrix: QrMatrix = []
  for (let row = 0; row < count; row += 1) {
    const line: boolean[] = []
    for (let column = 0; column < count; column += 1) line.push(code.isDark(row, column))
    matrix.push(line)
  }
  return matrix
}

export function partnerQrSvg(url: string, margin = 2): string {
  const matrix = partnerQrMatrix(url)
  const count = matrix.length
  const size = count + margin * 2
  const marks: string[] = []
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (matrix[row][column]) marks.push(`<rect x="${column + margin}" y="${row + margin}" width="1" height="1"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${marks.join("")}</g></svg>`
}
