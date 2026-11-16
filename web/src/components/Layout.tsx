// The signed-in layout (journey 002, FR-016): Your Space's navigation around every page, including
// an app's pane.
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { appsQuery } from "../apps-api.ts";

export function Layout() {
  const apps = useQuery(appsQuery);
  const openable = (apps.data?.apps ?? []).filter((a) => a.hasInterface);

  return (
    <div className="shell">
      <nav className="nav" aria-label="Your Space">
        <span className="brand">Your Space</span>
        <ul>
          <li>
            <Link to="/" activeOptions={{ exact: true }}>
              Home
            </Link>
          </li>
          <li>
            <Link to="/apps" activeOptions={{ exact: true }}>
              Apps
            </Link>
          </li>
        </ul>
        {openable.length > 0 ? (
          <ul aria-label="Your apps">
            {openable.map((app) => (
              <li key={app.name}>
                <Link to="/open/$name" params={{ name: app.name }} search={{}}>
                  {app.title}
                  {app.pendingRequests > 0 ? <span className="badge" title="Access requests waiting">{app.pendingRequests}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <ul>
          <li>
            <Link to="/engine">
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
