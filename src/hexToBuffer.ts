export default function hexToBuffer(hex: string) {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    b[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return b;
}
