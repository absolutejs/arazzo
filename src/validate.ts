import { ArazzoDocumentError } from "./parse";
import type { ArazzoDocument, ArazzoIssue, ArazzoStep } from "./types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const ID = /^[A-Za-z0-9_-]+$/u;
const SUPPORTED = /^1\.(0|1)\.\d+$/u;

export const validateArazzo = (value: unknown): ArazzoIssue[] => {
  const issues: ArazzoIssue[] = [];
  const add = (pointer: string, code: string, message: string) =>
    issues.push({ code, message, pointer });
  if (!record(value)) {
    add("", "type", "Arazzo document must be an object");
    return issues;
  }
  if (typeof value.arazzo !== "string" || !SUPPORTED.test(value.arazzo))
    add("/arazzo", "version", "Supported Arazzo versions are 1.0.x and 1.1.x");
  if (!record(value.info)) add("/info", "required", "info is required");
  else {
    if (typeof value.info.title !== "string" || value.info.title === "")
      add("/info/title", "required", "info.title is required");
    if (typeof value.info.version !== "string" || value.info.version === "")
      add("/info/version", "required", "info.version is required");
  }
  if (
    !Array.isArray(value.sourceDescriptions) ||
    value.sourceDescriptions.length === 0
  )
    add(
      "/sourceDescriptions",
      "required",
      "At least one source description is required",
    );
  else {
    const names = new Set<string>();
    value.sourceDescriptions.forEach((source, index) => {
      const pointer = `/sourceDescriptions/${index}`;
      if (!record(source))
        return add(pointer, "type", "Source description must be an object");
      if (typeof source.name !== "string" || !ID.test(source.name))
        add(
          `${pointer}/name`,
          "id",
          "Source name must contain letters, digits, _ or -",
        );
      else if (names.has(source.name))
        add(`${pointer}/name`, "duplicate", "Source name must be unique");
      else names.add(source.name);
      if (typeof source.url !== "string" || source.url === "")
        add(`${pointer}/url`, "required", "Source URL is required");
    });
  }
  if (!Array.isArray(value.workflows) || value.workflows.length === 0)
    add("/workflows", "required", "At least one workflow is required");
  else {
    const workflows = new Set<string>();
    value.workflows.forEach((workflow, workflowIndex) => {
      const pointer = `/workflows/${workflowIndex}`;
      if (!record(workflow))
        return add(pointer, "type", "Workflow must be an object");
      if (
        typeof workflow.workflowId !== "string" ||
        !ID.test(workflow.workflowId)
      )
        add(`${pointer}/workflowId`, "id", "workflowId is invalid");
      else if (workflows.has(workflow.workflowId))
        add(`${pointer}/workflowId`, "duplicate", "workflowId must be unique");
      else workflows.add(workflow.workflowId);
      if (!Array.isArray(workflow.steps) || workflow.steps.length === 0) {
        add(
          `${pointer}/steps`,
          "required",
          "Workflow must contain at least one step",
        );
        return;
      }
      const stepIds = new Set<string>();
      workflow.steps.forEach((candidate, stepIndex) => {
        const stepPointer = `${pointer}/steps/${stepIndex}`;
        if (!record(candidate))
          return add(stepPointer, "type", "Step must be an object");
        const step = candidate as ArazzoStep;
        if (typeof step.stepId !== "string" || !ID.test(step.stepId))
          add(`${stepPointer}/stepId`, "id", "stepId is invalid");
        else if (stepIds.has(step.stepId))
          add(
            `${stepPointer}/stepId`,
            "duplicate",
            "stepId must be unique in its workflow",
          );
        else stepIds.add(step.stepId);
        const targets = [
          step.operationId,
          step.operationPath,
          step.workflowId,
        ].filter((target) => typeof target === "string");
        if (targets.length !== 1)
          add(
            stepPointer,
            "target",
            "Step must define exactly one operationId, operationPath, or workflowId",
          );
      });
      workflow.steps.forEach((candidate, stepIndex) => {
        if (!record(candidate) || !Array.isArray(candidate.dependsOn)) return;
        candidate.dependsOn.forEach((dependency, dependencyIndex) => {
          if (typeof dependency !== "string" || !stepIds.has(dependency))
            add(
              `${pointer}/steps/${stepIndex}/dependsOn/${dependencyIndex}`,
              "reference",
              "dependsOn must reference a step in this workflow",
            );
        });
      });
    });
  }
  return issues;
};

export const assertValidArazzo = (value: unknown): ArazzoDocument => {
  const issues = validateArazzo(value);
  if (issues.length > 0)
    throw new ArazzoDocumentError("Invalid Arazzo document", issues);
  return structuredClone(value) as ArazzoDocument;
};
