import { Helmet } from "react-helmet-async";
import { useLocation, matchPath } from "react-router-dom";

const BASE = "https://app.paycheckmd.com";

import { ROUTE_META, type Meta } from "@/lib/routeMeta";
function resolveMeta(pathname: string): Meta {
  for (const entry of ROUTE_META) {
    if (matchPath({ path: entry.pattern, end: true }, pathname)) return entry.meta;
  }
  return DEFAULT_META;
}

export function RouteHead() {
  const { pathname } = useLocation();
  const meta = resolveMeta(pathname);
  const url = `${BASE}${pathname === "/" ? "/" : pathname.replace(/\/$/, "")}`;
  return (
    <Helmet>
      <title>{meta.title}</title>
      <meta name="description" content={meta.description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={meta.title} />
      <meta property="og:description" content={meta.description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content={meta.type ?? "website"} />
      <meta name="twitter:title" content={meta.title} />
      <meta name="twitter:description" content={meta.description} />
    </Helmet>
  );
}
