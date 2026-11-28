// The signed-in layout (journey 002, FR-016): Your Space's navigation around every page, including
// an app's pane. On a phone-sized screen the navigation becomes a top bar and one app fills the rest.
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { WorkspaceNav } from "./WorkspaceNav.tsx";
import { appsQuery } from "../apps-api.ts";

export function Layout() {
  const apps = useQuery(appsQuery);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Your Space</span>
        <button
          type="button"
          className="secondary menu-button"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </button>
      </header>
      <nav id="main-nav" className={open ? "nav open" : "nav"} aria-label="Your Space">
        <span className="brand">Your Space</span>
        <ul>
          <li>
            <Link to="/" onClick={close} activeOptions={{ exact: true }}>
              <span className="nav-symbol nav-home" aria-hidden="true" />Home
            </Link>
          </li>
          <li>
            <Link to="/apps" onClick={close} activeOptions={{ exact: true }}>
              <span className="nav-symbol nav-apps" aria-hidden="true" />Apps
            </Link>
          </li>
          <li>
            <Link to="/knowledge" onClick={close}>
              <span className="nav-symbol nav-knowledge" aria-hidden="true" />Knowledge
            </Link>
          </li>
          <li>
            <Link to="/agents" onClick={close}><span className="nav-symbol nav-agents" aria-hidden="true" />Agents</Link>
          </li>
        </ul>
        <WorkspaceNav apps={apps.data?.apps ?? []} close={close} />
        <ul>
          <li>
            <Link to="/appearance" onClick={close}><span className="nav-symbol nav-appearance" aria-hidden="true" />Appearance</Link>
          </li>
          <li>
            <Link to="/engine" onClick={close}>
              <span className="nav-symbol nav-engine" aria-hidden="true" />Engine
            </Link>
          </li>
          <li>
            <Link to="/github" onClick={close}><span className="nav-symbol nav-github" aria-hidden="true" />GitHub</Link>
          </li>
        </ul>
      </nav>
      <div className="content">
        <Outlet />
      </div>
    </div>
  );
}
