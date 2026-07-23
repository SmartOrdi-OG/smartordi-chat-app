// Shared fake window.jspdf for tests that exercise doctor.html's PDF
// builders (buildRezeptPdf/buildUeberweisungPdf/buildPatientReportPdf).
// jsPDF itself loads from an external CDN, which this sandbox's network
// can't reach -- same problem tests/helpers/mockSupabase.js already solves
// for the Supabase CDN script (abort the real request via page.route so a
// network that CAN reach the CDN, like a normal CI runner, doesn't
// silently overwrite this stub either). Records what was actually drawn
// (text/images) instead of rendering a real PDF, so assertions can check
// the right content ended up on the page.
const JSPDF_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

function installJsPdfStub() {
  function FakeJsPDF() {
    this._texts = [];
    this._images = [];
  }
  FakeJsPDF.prototype.setFontSize = function () { return this; };
  FakeJsPDF.prototype.setFont = function () { return this; };
  FakeJsPDF.prototype.setTextColor = function () { return this; };
  FakeJsPDF.prototype.setDrawColor = function () { return this; };
  FakeJsPDF.prototype.setFillColor = function () { return this; };
  FakeJsPDF.prototype.setLineWidth = function () { return this; };
  FakeJsPDF.prototype.setLineDashPattern = function () { return this; };
  FakeJsPDF.prototype.line = function () { return this; };
  FakeJsPDF.prototype.rect = function () { return this; };
  FakeJsPDF.prototype.text = function (str) { this._texts.push(String(str)); return this; };
  FakeJsPDF.prototype.splitTextToSize = function (str) { return [String(str)]; };
  FakeJsPDF.prototype.addImage = function (dataUrl) { this._images.push(dataUrl); return this; };
  FakeJsPDF.prototype.output = function (type) {
    if (type === 'datauristring') return 'data:application/pdf;base64,ZmFrZS1wZGY=';
    return 'blob:fake-pdf-url';
  };
  window.jspdf = { jsPDF: FakeJsPDF };
}

async function installJsPdfMock(page) {
  await page.route(JSPDF_CDN_URL, route => route.abort());
  await page.addInitScript(installJsPdfStub);
}

module.exports = { installJsPdfMock, JSPDF_CDN_URL, installJsPdfStub };
