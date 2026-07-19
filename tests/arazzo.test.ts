import { describe, expect, test } from "bun:test";
import {
  ArazzoDocumentError,
  ArazzoExecutionError,
  compileArazzoWorkflow,
  createArazzoHttpActionProjection,
  discoverArazzo,
  executeArazzoWorkflow,
  parseArazzo,
  validateArazzo,
} from "../src";

const source = `
arazzo: 1.1.0
info:
  title: Provision customer
  version: 1.0.0
sourceDescriptions:
  - name: crm
    url: https://api.example/openapi.json
    type: openapi
workflows:
  - workflowId: provision
    inputs:
      type: object
    steps:
      - stepId: create
        operationId: createCustomer
        parameters:
          - name: idempotency-key
            in: header
            value: $inputs.key
        requestBody:
          contentType: application/json
          payload:
            email: $inputs.email
        successCriteria:
          - condition: $statusCode == 201
        outputs:
          customerId: $response.body.id
      - stepId: notify
        operationId: sendWelcome
        parameters:
          - name: customerId
            in: path
            value: $steps.create.outputs.customerId
    outputs:
      customerId: $steps.create.outputs.customerId
`;

describe("Arazzo 1.1", () => {
  test("parses YAML and plans implicit output dependencies", () => {
    const document = parseArazzo(source);
    const plan = compileArazzoWorkflow(document, "provision");
    expect(plan.documentVersion).toBe("1.1.0");
    expect(plan.steps.map((item) => item.step.stepId)).toEqual([
      "create",
      "notify",
    ]);
    expect(plan.steps[1]?.dependencies).toEqual(["create"]);
  });

  test("resolves exact operation input before authorization and execution", async () => {
    const seen: unknown[] = [];
    const result = await executeArazzoWorkflow(
      parseArazzo(source),
      "provision",
      {
        adapter: {
          authorize: (input) => {
            seen.push(input);
            return { kind: "allow" };
          },
          executeOperation: (input) =>
            input.stepId === "create"
              ? { body: { id: "cus_1" }, statusCode: 201 }
              : { statusCode: 204 },
        },
        inputs: { email: "agent@example.com", key: "once" },
      },
    );
    expect(seen[0]).toMatchObject({
      parameters: [{ value: "once" }],
      requestBody: { payload: { email: "agent@example.com" } },
    });
    expect(seen[1]).toMatchObject({ parameters: [{ value: "cus_1" }] });
    expect(result.outputs).toEqual({ customerId: "cus_1" });
  });

  test("stops before effects when approval is required", async () => {
    let executed = false;
    try {
      await executeArazzoWorkflow(parseArazzo(source), "provision", {
        adapter: {
          authorize: () => ({ actionId: "act_1", kind: "approval-required" }),
          executeOperation: () => {
            executed = true;
            return { statusCode: 201 };
          },
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ArazzoExecutionError);
      expect((error as ArazzoExecutionError).details).toMatchObject({
        actionId: "act_1",
        kind: "approval-required",
      });
    }
    expect(executed).toBeFalse();
  });

  test("defaults to denying execution without a policy decision", async () => {
    let executed = false;
    await expect(
      executeArazzoWorkflow(parseArazzo(source), "provision", {
        adapter: {
          executeOperation: () => {
            executed = true;
            return { statusCode: 201 };
          },
        },
      }),
    ).rejects.toMatchObject({
      details: { kind: "authorization-missing" },
    });
    expect(executed).toBeFalse();
  });

  test("rejects cycles, duplicate IDs, and ambiguous operation targets", () => {
    const document = parseArazzo(source);
    document.workflows[0]!.steps[0]!.dependsOn = ["notify"];
    document.workflows[0]!.steps[1]!.dependsOn = ["create"];
    expect(() => compileArazzoWorkflow(document, "provision")).toThrow("cycle");
    const invalid = structuredClone(document) as unknown as Record<
      string,
      unknown
    >;
    const workflow = (invalid.workflows as Array<Record<string, unknown>>)[0]!;
    const steps = workflow.steps as Array<Record<string, unknown>>;
    steps[1]!.stepId = "create";
    steps[0]!.operationPath = "$sourceDescriptions.crm#/paths/~1customers/post";
    expect(validateArazzo(invalid).map((issue) => issue.code)).toContain(
      "duplicate",
    );
    expect(validateArazzo(invalid).map((issue) => issue.code)).toContain(
      "target",
    );
  });

  test("hardens remote discovery", async () => {
    await expect(
      discoverArazzo("http://example.com/arazzo.yaml"),
    ).rejects.toThrow("HTTPS");
    const discovered = await discoverArazzo("https://example.com/arazzo.yaml", {
      fetch: async () =>
        new Response(source, {
          headers: { "content-type": "application/yaml" },
        }),
    });
    expect(discovered.workflows[0]?.workflowId).toBe("provision");
    await expect(
      discoverArazzo("https://example.com/arazzo.yaml", {
        fetch: async () =>
          new Response(source, { headers: { "content-type": "text/html" } }),
      }),
    ).rejects.toBeInstanceOf(ArazzoDocumentError);
  });

  test("derives one-step HTTP workflows and OpenAPI operations from one action list", async () => {
    const projection = createArazzoHttpActionProjection({
      actions: [
        {
          description: "Read project health",
          inputSchema: {
            additionalProperties: false,
            properties: { projectId: { type: "string" } },
            required: ["projectId"],
            type: "object",
          },
          operationId: "project_summary_read",
          outputSchema: { type: "object" },
          path: "/api/actions/project_summary_read",
          summary: "Project summary",
          workflowId: "project_summary_read",
        },
      ],
      openapiUrl: "https://api.example/openapi.json",
      security: {
        authorizationUrl: "https://api.example/oauth2/authorize",
        schemeName: "ownerOAuth",
        scopes: { "arazzo:owner:read": "Read owner project state" },
        tokenUrl: "https://api.example/oauth2/token",
      },
      self: "https://api.example/workflows.arazzo.json",
      title: "Owner workflows",
      version: "1.0.0",
    });
    expect(validateArazzo(projection.document)).toEqual([]);
    expect(projection.document.workflows[0]).toMatchObject({
      inputs: { additionalProperties: false, type: "object" },
      steps: [
        {
          operationId: "project_summary_read",
          requestBody: { payload: { projectId: "$inputs.projectId" } },
          stepId: "execute",
        },
      ],
      workflowId: "project_summary_read",
    });
    expect(projection.openapi).toMatchObject({
      openapi: "3.1.2",
      paths: {
        "/api/actions/project_summary_read": {
          post: { operationId: "project_summary_read" },
        },
      },
      security: [{ ownerOAuth: ["arazzo:owner:read"] }],
    });
    const result = await executeArazzoWorkflow(
      projection.document,
      "project_summary_read",
      {
        adapter: {
          authorize: () => ({ kind: "allow" }),
          executeOperation: (input) => ({
            body: input.requestBody?.payload,
            statusCode: 200,
          }),
        },
        inputs: { projectId: "project-1" },
      },
    );
    expect(result.outputs).toEqual({ result: { projectId: "project-1" } });
  });

  test("rejects ambiguous action projections before discovery", () => {
    const action = {
      inputSchema: { properties: {}, type: "object" },
      operationId: "read_project",
      outputSchema: { type: "object" },
      path: "/api/actions/read_project",
      workflowId: "read_project",
    };
    expect(() =>
      createArazzoHttpActionProjection({
        actions: [action, action],
        openapiUrl: "https://api.example/openapi.json",
        title: "Invalid projection",
        version: "1.0.0",
      }),
    ).toThrow("operationId values must be unique");
  });
});
