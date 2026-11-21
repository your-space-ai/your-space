import { expect, it } from "vitest";
import { interfaceAddress, interfaceTarget, INSTALLATION } from "../src/apps.ts";
import type { ContainerSummary } from "../src/engine.ts";

const appId = "656f43f0-8780-42a2-ac44-0b8e546a8c51";
const project = "ys-example";
const labels = {
  "ai.your-space.installation": INSTALLATION,
  "ai.your-space.app": "example",
  "com.docker.compose.project": project,
};
const app: ContainerSummary = {
  Id: "container-1",
  Names: [],
  State: "running",
  Status: "Up",
  Labels: {
    ...labels,
    "ai.your-space.app-id": appId,
    "com.docker.compose.service": "web",
    "ai.your-space.interface-port": "8080",
  },
};
const network = {
  Name: project + "_app",
  Driver: "bridge",
  Internal: true,
  Labels: { ...labels, "com.docker.compose.network": "app" },
  Containers: { "container-1": { IPv4Address: "172.20.0.8/16" } },
};
it("selects the exact running interface and its IPv4 on this app's sealed network", () => {
  expect(interfaceAddress(project, appId, "web", 8080, [app], network)).toBe("172.20.0.8");
  for (const key of Object.keys(app.Labels)) {
    const other = { ...app, Labels: { ...app.Labels, [key]: "other" } };
    expect(() => interfaceAddress(project, appId, "web", 8080, [other], network)).toThrow();
  }
  for (const key of Object.keys(network.Labels)) {
    expect(() =>
      interfaceAddress(project, appId, "web", 8080, [app], {
        ...network,
        Labels: { ...network.Labels, [key]: "other" },
      }),
    ).toThrow();
  }
});
it("fails closed without a unique running service connected to the expected network", () => {
  const resolve = (containers: ContainerSummary[], net = network) =>
    interfaceAddress(project, appId, "web", 8080, containers, net);
  expect(() => resolve([])).toThrow();
  expect(() => resolve([app, { ...app, Id: "duplicate" }])).toThrow();
  const unlabelled = { ...app, Id: "legacy", Labels: { ...app.Labels } };
  delete unlabelled.Labels["ai.your-space.app-id"];
  delete unlabelled.Labels["ai.your-space.interface-port"];
  expect(() => resolve([unlabelled])).toThrow();
  expect(() => resolve([app, unlabelled])).toThrow();
  expect(() => resolve([{ ...app, State: "exited" }])).toThrow();
  expect(() => resolve([{ ...app, Id: "disconnected" }])).toThrow();
  expect(() => resolve([app], { ...network, Internal: false })).toThrow();
  expect(() => resolve([app], { ...network, Name: "other_app" })).toThrow();
  expect(() => resolve([app], { ...network, Containers: { "container-1": { IPv4Address: "" } } })).toThrow();
});

it("accepts only a fully unlabelled legacy target for operator refresh and still refuses agent traffic", () => {
  const legacy = { ...app, Labels: { ...app.Labels } };
  delete legacy.Labels["ai.your-space.app-id"];
  delete legacy.Labels["ai.your-space.interface-port"];
  const inspect = (c: ContainerSummary) => interfaceTarget(project, appId, "web", 8080, [c], network);
  expect(inspect(legacy)).toEqual({ address: "172.20.0.8", legacy: true });
  expect(inspect(app)).toEqual({ address: "172.20.0.8", legacy: false });
  expect(() => interfaceAddress(project, appId, "web", 8080, [legacy], network)).toThrow();
  const mismatches: Record<string, string>[] = [
    { "ai.your-space.app-id": appId },
    { "ai.your-space.interface-port": "8080" },
    { "ai.your-space.installation": "other" },
    { "com.docker.compose.service": "database" },
  ];
  for (const mismatched of mismatches) {
    expect(() => inspect({ ...legacy, Labels: { ...legacy.Labels, ...mismatched } })).toThrow();
  }
});
