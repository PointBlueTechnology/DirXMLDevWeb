import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./monaco";
import "./styles.css";
import "./fishbone/fishbone.css";
import { App } from "./App";

// back from a sign-in: the view the person was on (api.ts keeps the hash before redirecting)
try {
  const back = sessionStorage.getItem("idmweb.return");
  if (back) {
    sessionStorage.removeItem("idmweb.return");
    if (!window.location.hash || window.location.hash === "#") {
      window.location.hash = back;
    }
  }
} catch {
  // no storage: the page opens at home
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
