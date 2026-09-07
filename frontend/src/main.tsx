import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { Toaster } from "react-hot-toast";
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
} from "react-router-dom";
import RunEvalsPage from "./components/evals/RunEvalsPage.tsx";
import BestOfNEvalsPage from "./components/evals/BestOfNEvalsPage.tsx";
import AllEvalsPage from "./components/evals/AllEvalsPage.tsx";
import OpenAIInputComparePage from "./components/evals/OpenAIInputComparePage.tsx";
import PromptReportsPage from "./components/evals/PromptReportsPage.tsx";
import AgentRunsPage from "./components/evals/AgentRunsPage.tsx";
import EvalSessionsPage from "./components/evals/EvalSessionsPage.tsx";
import EvalComparePage from "./components/evals/EvalComparePage.tsx";
import ErrorBoundary from "./components/ErrorBoundary.tsx";

// The desktop build loads the UI from disk, where location.pathname is the
// file's path (/C:/.../index.html). BrowserRouter matches no route there and
// the app renders blank, so fall back to hash routing off the web.
const Router =
  typeof window !== "undefined" && window.location.protocol === "file:"
    ? HashRouter
    : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/evals" element={<AllEvalsPage />} />
          <Route path="/evals/best-of-n" element={<BestOfNEvalsPage />} />
          <Route path="/evals/run" element={<RunEvalsPage />} />
          <Route
            path="/evals/openai-input-compare"
            element={<OpenAIInputComparePage />}
          />
          <Route path="/evals/prompt-reports" element={<PromptReportsPage />} />
          <Route path="/evals/agent-runs" element={<AgentRunsPage />} />
          <Route path="/evals/sessions" element={<EvalSessionsPage />} />
          <Route path="/evals/compare" element={<EvalComparePage />} />
        </Routes>
      </Router>
    </ErrorBoundary>
    <Toaster toastOptions={{ className: "dark:bg-zinc-950 dark:text-white" }} />
  </React.StrictMode>
);
