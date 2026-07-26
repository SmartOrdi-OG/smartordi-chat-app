// Shared fake window.JSZip for tests that exercise secretary.html's bulk
// document import (loadZipFileEntries()). JSZip itself loads from an
// external CDN, which this sandbox's network can't reach -- same problem
// tests/helpers/jspdfStub.js already solves for jsPDF. Rather than faking
// real ZIP byte decompression, the stub reads a test-provided
// window.__fakeZipFiles = {path: base64Content} map and hands back an
// object shaped like a real JSZip instance's .files (each entry exposing
// .async(type) resolving to that stored base64 string), so
// loadZipFileEntries()'s own path/basename lookup logic is exercised
// against real-looking data without needing an actual ZIP binary.
const JSZIP_CDN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

function installJsZipStub() {
  function FakeJSZip() {}
  FakeJSZip.loadAsync = function () {
    const map = window.__fakeZipFiles || {};
    const files = {};
    Object.keys(map).forEach(function (path) {
      files[path] = {
        dir: false,
        async: function (type) {
          if (type !== 'base64') return Promise.reject(new Error('unsupported type in stub: ' + type));
          return Promise.resolve(map[path]);
        },
      };
    });
    return Promise.resolve({ files: files });
  };
  window.JSZip = FakeJSZip;
}

async function installJsZipMock(page) {
  await page.route(JSZIP_CDN_URL, route => route.abort());
  await page.addInitScript(installJsZipStub);
}

module.exports = { installJsZipMock, JSZIP_CDN_URL, installJsZipStub };
