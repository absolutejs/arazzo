import { defineManifest } from "@absolutejs/manifest";
import { Type } from "@sinclair/typebox";

export const manifest = defineManifest<Record<string, never>>()({
  contract: 2,
  discovery: {
    audiences: ["agent-hosts", "api-platforms"],
    intents: [
      "plan API workflows",
      "project typed HTTP actions into Arazzo and OpenAPI",
      "validate Arazzo documents",
      "execute policy-gated workflows",
    ],
    keywords: [
      "agents",
      "arazzo",
      "openapi",
      "workflows",
      "planning",
      "authorization",
    ],
    protocols: ["Arazzo 1.1", "OpenAPI"],
  },
  identity: {
    accent: "#0ea5e9",
    category: "ai",
    description:
      "Arazzo 1.1 workflow discovery, typed HTTP action projection, parsing, semantic validation, dependency planning, runtime expressions, and policy-gated provider-neutral execution.",
    docsUrl: "https://github.com/absolutejs/arazzo",
    name: "@absolutejs/arazzo",
    tagline: "Give agents a standard map from API capability to safe outcome.",
  },
  settings: Type.Object({}),
  wiring: [],
});
