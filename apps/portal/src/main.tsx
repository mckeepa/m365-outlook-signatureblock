import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/dm-sans";
import App from "./PortalApp.js";
import "./portal.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);