import { assertValidArazzo } from "./validate";
import type { ArazzoDocument } from "./types";

const IDENTIFIER = /^[A-Za-z0-9_-]+$/u;

export type ArazzoHttpActionDefinition = {
  description?: string;
  inputSchema: Record<string, unknown>;
  operationId: string;
  outputSchema: Record<string, unknown>;
  path: string;
  summary?: string;
  workflowId: string;
};

export type ArazzoOAuth2AuthorizationCodeSecurity = {
  authorizationUrl: string;
  schemeName: string;
  scopes: Record<string, string>;
  tokenUrl: string;
};

export type ArazzoHttpActionProjection = {
  document: ArazzoDocument;
  openapi: Record<string, unknown>;
};

export type ArazzoHttpActionProjectionOptions = {
  actions: readonly ArazzoHttpActionDefinition[];
  description?: string;
  openapiUrl: string;
  security?: ArazzoOAuth2AuthorizationCodeSecurity;
  self?: string;
  title: string;
  version: string;
};

const assertUnique = (values: readonly string[], field: string) => {
  if (new Set(values).size !== values.length)
    throw new TypeError(`${field} values must be unique`);
};

const assertAction = (action: ArazzoHttpActionDefinition) => {
  if (!IDENTIFIER.test(action.operationId))
    throw new TypeError(`Invalid operationId: ${action.operationId}`);
  if (!IDENTIFIER.test(action.workflowId))
    throw new TypeError(`Invalid workflowId: ${action.workflowId}`);
  if (
    !action.path.startsWith("/") ||
    action.path.includes("?") ||
    action.path.includes("#")
  )
    throw new TypeError(
      `Action path must be an absolute URL path: ${action.path}`,
    );
  const properties = action.inputSchema.properties;
  if (
    action.inputSchema.type !== "object" ||
    typeof properties !== "object" ||
    properties === null ||
    Array.isArray(properties)
  )
    throw new TypeError(
      `Action inputSchema must be an object schema with properties: ${action.operationId}`,
    );
  for (const name of Object.keys(properties))
    if (!IDENTIFIER.test(name))
      throw new TypeError(`Invalid workflow input name: ${name}`);
};

const requestPayload = (action: ArazzoHttpActionDefinition) =>
  Object.fromEntries(
    Object.keys(action.inputSchema.properties as Record<string, unknown>).map(
      (name) => [name, `$inputs.${name}`],
    ),
  );

const securityComponents = (
  security: ArazzoOAuth2AuthorizationCodeSecurity | undefined,
) => {
  if (!security) return {};

  return {
    components: {
      securitySchemes: {
        [security.schemeName]: {
          flows: {
            authorizationCode: {
              authorizationUrl: security.authorizationUrl,
              scopes: structuredClone(security.scopes),
              tokenUrl: security.tokenUrl,
            },
          },
          type: "oauth2",
        },
      },
    },
    security: [{ [security.schemeName]: Object.keys(security.scopes) }],
  };
};

export const createArazzoHttpActionProjection = (
  options: ArazzoHttpActionProjectionOptions,
): ArazzoHttpActionProjection => {
  if (options.actions.length === 0)
    throw new TypeError("Arazzo HTTP action projection requires an action");
  options.actions.forEach(assertAction);
  assertUnique(
    options.actions.map(({ operationId }) => operationId),
    "operationId",
  );
  assertUnique(
    options.actions.map(({ workflowId }) => workflowId),
    "workflowId",
  );
  assertUnique(
    options.actions.map(({ path }) => path),
    "path",
  );

  const document = assertValidArazzo({
    ...(options.self ? { $self: options.self } : {}),
    arazzo: "1.1.0",
    info: {
      ...(options.description ? { description: options.description } : {}),
      title: options.title,
      version: options.version,
    },
    sourceDescriptions: [
      { name: "api", type: "openapi", url: options.openapiUrl },
    ],
    workflows: options.actions.map((action) => ({
      ...(action.description ? { description: action.description } : {}),
      inputs: structuredClone(action.inputSchema),
      outputs: { result: "$steps.execute.outputs.result" },
      steps: [
        {
          description: action.description,
          operationId: action.operationId,
          outputs: { result: "$response.body" },
          requestBody: {
            contentType: "application/json",
            payload: requestPayload(action),
          },
          stepId: "execute",
        },
      ],
      ...(action.summary ? { summary: action.summary } : {}),
      workflowId: action.workflowId,
    })),
  });
  const paths = Object.fromEntries(
    options.actions.map((action) => [
      action.path,
      {
        post: {
          ...(action.description ? { description: action.description } : {}),
          operationId: action.operationId,
          requestBody: {
            content: {
              "application/json": {
                schema: structuredClone(action.inputSchema),
              },
            },
            required: true,
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: structuredClone(action.outputSchema),
                },
              },
              description: "Successful catalog action result",
            },
          },
          ...(action.summary ? { summary: action.summary } : {}),
        },
      },
    ]),
  );

  return {
    document,
    openapi: {
      info: { title: options.title, version: options.version },
      openapi: "3.1.2",
      paths,
      ...securityComponents(options.security),
    },
  };
};
