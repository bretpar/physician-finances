import { writeFileSync } from "node:fs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Re-implement minimal save patch via global hook: jsPDF.API.save (prototype-ish)
// jsPDF assigns save on instances inside constructor; we wrap by patching API.
const API = jsPDF.API;
const originalSave = API.save;
API.save = function(name) {
  try {
    const buf = this.output("arraybuffer");
    writeFileSync("/tmp/pdfqa/out.pdf", Buffer.from(buf));
    console.error("saved", name, buf.byteLength, "bytes");
  } catch (e) { console.error("patch err", e); }
};

const { exportTaxPrepPdf } = await import("./src/lib/taxPrepPdf.ts");
try {
  exportTaxPrepPdf((await import("./gen-pdf-qa-data.mjs")).data);
} catch (e) { console.error("EXPORT ERR", e); }
console.error("done");
