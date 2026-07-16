import type { ArazzoExpressionContext } from "./types";

const pathValue = (root: unknown, path: string) => {
  let value = root;
  for (const raw of path.split(".")) {
    if (raw === "") continue;
    const key = raw.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
};

export const evaluateArazzoExpression = (
  expression: string,
  context: ArazzoExpressionContext,
): unknown => {
  if (expression === "$statusCode") return context.response?.statusCode;
  if (expression === "$response.body") return context.response?.body;
  if (expression.startsWith("$response.body."))
    return pathValue(context.response?.body, expression.slice(15));
  if (expression.startsWith("$response.header."))
    return context.response?.headers?.[expression.slice(17).toLowerCase()];
  if (expression.startsWith("$inputs."))
    return pathValue(context.inputs, expression.slice(8));
  const step =
    /^\$steps\.([A-Za-z0-9_-]+)\.(outputs|statusCode|body)(?:\.(.+))?$/u.exec(
      expression,
    );
  if (step?.[1] && step[2]) {
    const result = context.steps[step[1]];
    const root = result?.[step[2] as "outputs" | "statusCode" | "body"];
    return step[3] ? pathValue(root, step[3]) : root;
  }
  throw new Error(
    `Unsupported or unavailable Arazzo expression: ${expression}`,
  );
};

export const resolveArazzoValue = (
  value: unknown,
  context: ArazzoExpressionContext,
): unknown => {
  if (typeof value === "string") {
    if (/^\$(inputs|steps|response|statusCode)/u.test(value))
      return evaluateArazzoExpression(value, context);
    return value.replace(
      /\{(\$(?:inputs|steps|response|statusCode)[^}]+)\}/gu,
      (_, expression) =>
        String(evaluateArazzoExpression(expression, context) ?? ""),
    );
  }
  if (Array.isArray(value))
    return value.map((item) => resolveArazzoValue(item, context));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveArazzoValue(item, context),
      ]),
    );
  return value;
};
