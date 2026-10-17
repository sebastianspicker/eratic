import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { recordUncaught } from "./diagnostics";
import App from "./ui/App";
import "@fontsource-variable/bricolage-grotesque/standard.css";
import "./ui/styles.css";
recordUncaught();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
