// The signed-in layout (journey 002): Your Space's navigation around every page.
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { appsQuery } from "../apps-api.ts";

export function Layout() {
  const apps = useQuery(appsQuery);
  const installed = apps.data?.apps ?? [];

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
        {installed.length > 0 ? (
          <ul aria-label="Your apps">
            {installed.map((app) => (
              <li key={app.name}>
                <Link to="/apps/$name" params={{ name: app.name }}>
                  {app.title}
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
