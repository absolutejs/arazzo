import { ArazzoDocumentError } from "./parse";
import type { ArazzoDocument, ArazzoPlan } from "./types";

const implicitDependencies = (value: unknown) => {
  const found = new Set<string>();
  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(/\$steps\.([A-Za-z0-9_-]+)\./gu)) {
        if (match[1]) found.add(match[1]);
      }
    } else if (Array.isArray(candidate)) candidate.forEach(visit);
    else if (typeof candidate === "object" && candidate !== null)
      Object.values(candidate).forEach(visit);
  };
  visit(value);
  return found;
};

export const compileArazzoWorkflow = (
  document: ArazzoDocument,
  workflowId: string,
): ArazzoPlan => {
  const workflow = document.workflows.find(
    (item) => item.workflowId === workflowId,
  );
  if (!workflow)
    throw new ArazzoDocumentError(`Workflow not found: ${workflowId}`);
  const ids = new Set(workflow.steps.map((step) => step.stepId));
  const dependencies = new Map<string, Set<string>>();
  for (const step of workflow.steps) {
    const required = new Set(step.dependsOn ?? []);
    for (const implicit of implicitDependencies(step)) required.add(implicit);
    required.delete(step.stepId);
    for (const dependency of required) {
      if (!ids.has(dependency)) {
        throw new ArazzoDocumentError(
          `Step ${step.stepId} references unknown dependency ${dependency}`,
        );
      }
    }
    dependencies.set(step.stepId, required);
  }
  const remaining = new Set(ids);
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = workflow.steps.find(
      (step) =>
        remaining.has(step.stepId) &&
        [...(dependencies.get(step.stepId) ?? [])].every((id) =>
          ordered.includes(id),
        ),
    );
    if (!ready)
      throw new ArazzoDocumentError(
        `Workflow ${workflowId} contains a dependency cycle`,
      );
    ordered.push(ready.stepId);
    remaining.delete(ready.stepId);
  }
  return {
    documentVersion: document.arazzo,
    sourceDescriptions: structuredClone(document.sourceDescriptions),
    steps: ordered.map((id, index) => ({
      dependencies: [...(dependencies.get(id) ?? [])],
      index,
      step: structuredClone(workflow.steps.find((step) => step.stepId === id)!),
    })),
    workflow: structuredClone(workflow),
  };
};
