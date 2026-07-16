export const ARAZZO_VERSION = "1.1.0" as const;

export type ArazzoParameter = {
  in?: string;
  name: string;
  value: unknown;
};

export type ArazzoCriterion = {
  condition: string;
  context?: string;
  type?:
    | "simple"
    | "regex"
    | "jsonpath"
    | "xpath"
    | { type: string; version: string };
};

export type ArazzoAction = {
  criteria?: ArazzoCriterion[];
  name: string;
  parameters?: ArazzoParameter[];
  retryAfter?: number;
  retryLimit?: number;
  stepId?: string;
  type: "end" | "goto" | "retry";
  workflowId?: string;
};

export type ArazzoStep = {
  action?: "send" | "receive";
  dependsOn?: string[];
  description?: string;
  onFailure?: ArazzoAction[];
  onSuccess?: ArazzoAction[];
  operationId?: string;
  operationPath?: string;
  outputs?: Record<string, unknown>;
  parameters?: ArazzoParameter[];
  requestBody?: {
    contentType?: string;
    payload?: unknown;
    replacements?: unknown[];
  };
  stepId: string;
  successCriteria?: ArazzoCriterion[];
  workflowId?: string;
  [extension: `x-${string}`]: unknown;
};

export type ArazzoWorkflow = {
  dependsOn?: string[];
  description?: string;
  failureActions?: ArazzoAction[];
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  parameters?: ArazzoParameter[];
  steps: ArazzoStep[];
  successActions?: ArazzoAction[];
  summary?: string;
  workflowId: string;
  [extension: `x-${string}`]: unknown;
};

export type ArazzoDocument = {
  $self?: string;
  arazzo: string;
  components?: Record<string, unknown>;
  info: {
    description?: string;
    summary?: string;
    title: string;
    version: string;
  };
  sourceDescriptions: Array<{
    name: string;
    type?: "openapi" | "asyncapi" | "arazzo" | (string & {});
    url: string;
  }>;
  workflows: ArazzoWorkflow[];
  [extension: `x-${string}`]: unknown;
};

export type ArazzoIssue = {
  code: string;
  message: string;
  pointer: string;
};

export type ArazzoPlanStep = {
  dependencies: string[];
  index: number;
  step: ArazzoStep;
};

export type ArazzoPlan = {
  documentVersion: string;
  sourceDescriptions: ArazzoDocument["sourceDescriptions"];
  steps: ArazzoPlanStep[];
  workflow: ArazzoWorkflow;
};

export type ArazzoOperationInput = {
  attempt: number;
  operationId?: string;
  operationPath?: string;
  parameters: ArazzoParameter[];
  requestBody?: { contentType?: string; payload?: unknown };
  stepId: string;
  workflowId: string;
};

export type ArazzoOperationResult = {
  body?: unknown;
  headers?: Record<string, string>;
  outputs?: Record<string, unknown>;
  statusCode: number;
};

export type ArazzoAuthorization =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { actionId: string; kind: "approval-required"; reason?: string };

export type ArazzoExecutionAdapter = {
  authorize?: (
    input: ArazzoOperationInput,
  ) => Promise<ArazzoAuthorization> | ArazzoAuthorization;
  evaluateCriterion?: (
    criterion: ArazzoCriterion,
    context: ArazzoExpressionContext,
  ) => Promise<boolean> | boolean;
  executeOperation: (
    input: ArazzoOperationInput,
  ) => Promise<ArazzoOperationResult> | ArazzoOperationResult;
  wait?: (milliseconds: number) => Promise<void>;
};

export type ArazzoExpressionContext = {
  inputs: Record<string, unknown>;
  response?: ArazzoOperationResult;
  steps: Record<
    string,
    ArazzoOperationResult & { outputs: Record<string, unknown> }
  >;
};

export type ArazzoExecutionResult = {
  outputs: Record<string, unknown>;
  steps: ArazzoExpressionContext["steps"];
  workflowId: string;
};
