import qrcode from 'qrcode-generator';

// Same library (and same cellSize/margin) as vendor/qrcode.js's
// renderQrInto() -- kazuhikoarase's QR generator, just via the npm package
// instead of a vendored script tag.
export function renderQrDataUrl(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(6, 4);
}
