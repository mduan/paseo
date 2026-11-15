import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createAntigravityProvider } from "./server/provider.js";
import { discover, fetchUsage, inputSchema } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerProvider(createAntigravityProvider());
  server.registerUsageSource({
    id: "antigravity",
    label: "Antigravity",
    icon: "icon.svg",
    input: inputSchema,
    discover,
    fetch: fetchUsage,
  });
  return () => {};
}
