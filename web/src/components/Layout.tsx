// The signed-in layout (journey 002, FR-016): Your Space's navigation around every page, including
// an app's pane. On a phone-sized screen the navigation becomes a top bar and one app fills the rest.
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { appsQuery } from "../apps-api.ts";

export function Layout() {
  const apps = useQuery(appsQuery);
  const [open, setOpen] = useState(false);
  const openable = (apps.data?.apps ?? []).filter((a) => a.hasInterface);
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
              Home
            </Link>
          </li>
          <li>
            <Link to="/apps" onClick={close} activeOptions={{ exact: true }}>
              Apps
            </Link>
          </li>
        </ul>
        {openable.length > 0 ? (
          <ul aria-label="Your apps">
            {openable.map((app) => (
              <li key={app.name}>
                <Link to="/open/$name" params={{ name: app.name }} search={{}} onClick={close}>
                  {app.title}
                  {app.pendingRequests > 0 ? <span className="badge" title="Access requests waiting">{app.pendingRequests}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <ul>
          <li>
            <Link to="/engine" onClick={close}>
              Engine
            </Link>
          </li>
        </ul>
      </nav>
      <div className="content">
        <Outlet />
      </div>
    </div>
  );
}
