import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import "./styles.css";

document.documentElement.dataset.platform =
  window.electronAPI?.platform || (/Mac|iPhone|iPad/.test(navigator.platform) ? "darwin" : "web");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
