import { evaluateArazzoExpression, resolveArazzoValue } from "./expressions";
import { compileArazzoWorkflow } from "./plan";
import type {
  ArazzoCriterion,
  ArazzoDocument,
  ArazzoExecutionAdapter,
  ArazzoExecutionResult,
  ArazzoExpressionContext,
  ArazzoOperationInput,
} from "./types";

export class ArazzoExecutionError extends Error {
  constructor(
    message: string,
    readonly details?: { actionId?: string; kind: string; stepId?: string },
  ) {
    super(message);
    this.name = "ArazzoExecutionError";
  }
}

const literal = (source: string) => {
  if (source === "true") return true;
  if (source === "false") return false;
  if (source === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(source)) return Number(source);
  if (source.startsWith("'") && source.endsWith("'"))
    return source.slice(1, -1).replace(/''/gu, "'");
  return undefined;
};

const evaluateSimple = (
  criterion: ArazzoCriterion,
  context: ArazzoExpressionContext,
) => {
  const match = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/u.exec(
    criterion.condition.trim(),
  );
  if (!match?.[1] || !match[2] || !match[3]) {
    return Boolean(
      evaluateArazzoExpression(criterion.condition.trim(), context),
    );
  }
  const value = (token: string) =>
    token.trim().startsWith("$")
      ? evaluateArazzoExpression(token.trim(), context)
      : literal(token.trim());
  const left = value(match[1]);
  const right = value(match[3]);
  if (match[2] === "==")
    return typeof left === "string" && typeof right === "string"
      ? left.toLowerCase() === right.toLowerCase()
      : left == right;
  if (match[2] === "!=") return left != right;
  if (match[2] === "<") return (left as number) < (right as number);
  if (match[2] === ">") return (left as number) > (right as number);
  if (match[2] === "<=") return (left as number) <= (right as number);
  return (left as number) >= (right as number);
};

const criteriaPass = async (
  criteria: ArazzoCriterion[] | undefined,
  context: ArazzoExpressionContext,
  adapter: ArazzoExecutionAdapter,
) => {
  if (!criteria || criteria.length === 0) return true;
  for (const criterion of criteria) {
    const type =
      typeof criterion.type === "object" ? criterion.type.type : criterion.type;
    let passed: boolean;
    if (!type || type === "simple") passed = evaluateSimple(criterion, context);
    else if (type === "regex") {
      if (!criterion.context)
        throw new ArazzoExecutionError("Regex criterion requires context");
      passed = new RegExp(criterion.condition, "u").test(
        String(evaluateArazzoExpression(criterion.context, context) ?? ""),
      );
    } else if (adapter.evaluateCriterion)
      passed = await adapter.evaluateCriterion(criterion, context);
    else {
      throw new ArazzoExecutionError(
        `${type} criteria require an evaluateCriterion adapter; execution did not guess`,
      );
    }
    if (!passed) return false;
  }
  return true;
};

export const executeArazzoWorkflow = async (
  document: ArazzoDocument,
  workflowId: string,
  options: {
    adapter: ArazzoExecutionAdapter;
    /** Explicit opt-out for trusted, read-only workflows. Authorization is required by default. */
    allowUnreviewed?: boolean;
    inputs?: Record<string, unknown>;
    maxSteps?: number;
  },
): Promise<ArazzoExecutionResult> => {
  const plan = compileArazzoWorkflow(document, workflowId);
  if (!options.adapter.authorize && options.allowUnreviewed !== true) {
    throw new ArazzoExecutionError(
      "Execution requires an authorization adapter or allowUnreviewed: true",
      { kind: "authorization-missing" },
    );
  }
  if (
    plan.workflow.successActions ||
    plan.workflow.failureActions ||
    plan.steps.some(
      ({ step }) =>
        step.onSuccess ||
        step.onFailure ||
        (step.requestBody?.replacements?.length ?? 0) > 0,
    )
  ) {
    throw new ArazzoExecutionError(
      "This workflow uses control actions or payload replacements that require a specialized execution adapter",
      { kind: "unsupported" },
    );
  }
  const context: ArazzoExpressionContext = {
    inputs: structuredClone(options.inputs ?? {}),
    steps: {},
  };
  let executions = 0;
  for (const planned of plan.steps) {
    if (++executions > (options.maxSteps ?? 1_000))
      throw new ArazzoExecutionError("Arazzo execution step limit exceeded");
    const parameters = [
      ...(plan.workflow.parameters ?? []),
      ...(planned.step.parameters ?? []),
    ].map((parameter) => ({
      ...parameter,
      value: resolveArazzoValue(parameter.value, context),
    }));
    const input: ArazzoOperationInput = {
      attempt: 1,
      ...(planned.step.operationId
        ? { operationId: planned.step.operationId }
        : {}),
      ...(planned.step.operationPath
        ? { operationPath: planned.step.operationPath }
        : {}),
      parameters,
      ...(planned.step.requestBody
        ? {
            requestBody: {
              contentType: planned.step.requestBody.contentType,
              payload: resolveArazzoValue(
                planned.step.requestBody.payload,
                context,
              ),
            },
          }
        : {}),
      stepId: planned.step.stepId,
      workflowId,
    };
    if (planned.step.workflowId) {
      throw new ArazzoExecutionError(
        "Nested workflow execution requires an operation adapter expansion",
        { kind: "unsupported", stepId: planned.step.stepId },
      );
    }
    const authorization = await options.adapter.authorize?.(
      structuredClone(input),
    );
    if (options.adapter.authorize && authorization?.kind !== "allow") {
      if (authorization === undefined) {
        throw new ArazzoExecutionError(
          "Authorization adapter returned no decision",
          { kind: "authorization-invalid", stepId: planned.step.stepId },
        );
      }
    }
    if (authorization?.kind === "deny")
      throw new ArazzoExecutionError(authorization.reason, {
        kind: "denied",
        stepId: planned.step.stepId,
      });
    if (authorization?.kind === "approval-required")
      throw new ArazzoExecutionError(
        authorization.reason ?? "Approval required",
        {
          actionId: authorization.actionId,
          kind: "approval-required",
          stepId: planned.step.stepId,
        },
      );
    const response = await options.adapter.executeOperation(
      structuredClone(input),
    );
    context.response = response;
    if (
      !(await criteriaPass(
        planned.step.successCriteria,
        context,
        options.adapter,
      ))
    ) {
      throw new ArazzoExecutionError(
        `Success criteria failed for ${planned.step.stepId}`,
        {
          kind: "criteria-failed",
          stepId: planned.step.stepId,
        },
      );
    }
    const outputs = Object.fromEntries(
      Object.entries(planned.step.outputs ?? {}).map(([name, expression]) => [
        name,
        resolveArazzoValue(expression, context),
      ]),
    );
    context.steps[planned.step.stepId] = { ...response, outputs };
  }
  context.response = undefined;
  return {
    outputs: Object.fromEntries(
      Object.entries(plan.workflow.outputs ?? {}).map(([name, expression]) => [
        name,
        resolveArazzoValue(expression, context),
      ]),
    ),
    steps: context.steps,
    workflowId,
  };
};
