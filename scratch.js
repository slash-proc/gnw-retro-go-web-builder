// RGB565 to RGBA conversion logic check
function rawToImageData(raw) {
  const width = 320;
  const height = 240;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const rgb565 = new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
  let o = 0;
  for (let i = 0; i < rgb565.length; i++) {
    const p = rgb565[i];
    const r = ((p >> 11) & 0x1f) * 255 / 31;
    const g = ((p >> 5) & 0x3f) * 255 / 63;
    const b = (p & 0x1f) * 255 / 31;
    rgba[o++] = r;
    rgba[o++] = g;
    rgba[o++] = b;
    rgba[o++] = 255;
  }
  return { rgba, width, height };
}
