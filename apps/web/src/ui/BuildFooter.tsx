import { useState } from "react";
import { BUILD, diagnosticsText } from "../diagnostics";
import { saveText } from "./download";

// The build and a copy of the recorded problems, for bug reports.
export function BuildFooter() {
  const [status, setStatus] = useState("");
  async function copy() {
    const text = diagnosticsText();
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Diagnostics copied");
    } catch {
      saveText("eratic-diagnostics.txt", text, "text/plain");
      setStatus("Diagnostics saved as a file");
    }
  }
  return (
    <footer className="app-footer">
      <span>Eratic {BUILD}</span>
      <button onClick={() => void copy()}>Copy diagnostics</button>
      <span role="status">{status}</span>
    </footer>
  );
}
