import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorReporting } from "@/lib/clientErrorReporting";
import { installDeploymentRecovery } from "@/lib/deploymentRecovery";
import "./index.css";

installGlobalErrorReporting();
installDeploymentRecovery();

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
