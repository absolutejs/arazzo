# @absolutejs/arazzo

Provider-neutral Arazzo **1.1** workflow discovery, validation, dependency
planning, and policy-aware execution for AI agents.

Arazzo is the OpenAPI Initiative standard for describing the sequence of API
calls needed to produce an outcome. This package lets an AbsoluteJS agent find
that map, validate it, turn explicit `dependsOn` declarations and implicit
`$steps.*.outputs.*` references into a deterministic plan, and execute each
operation through an adapter you control.

```ts
import { discoverArazzo, executeArazzoWorkflow } from "@absolutejs/arazzo";

const document = await discoverArazzo(
  "https://api.example/.well-known/workflows.arazzo.yaml",
);

const result = await executeArazzoWorkflow(document, "provisionCustomer", {
  inputs: { email: "customer@example.com" },
  adapter: {
    authorize: async (resolvedAction) => agencyDecisionFor(resolvedAction),
    executeOperation: async (resolvedAction) =>
      openApiAdapter.execute(resolvedAction),
  },
});
```

Authorization receives the final resolved parameters and request body before
`executeOperation` can run. A denial or approval requirement stops execution
without producing an external effect. That makes the contract usable with
`@absolutejs/agency`, another policy engine, or a provider-specific approval
system without coupling Arazzo to any of them. Execution is default-deny when
no authorization adapter is supplied; trusted read-only callers must opt out
explicitly with `allowUnreviewed: true`.

The built-in evaluator handles simple comparisons and regular expressions. An
`evaluateCriterion` adapter is required for JSONPath or XPath so the package
never silently guesses expression-version semantics. Nested workflows and
advanced control-flow or payload-replacement expansion are similarly rejected
before any effect at execution time; they remain available in the validated
document and plan for a specialized adapter.

Remote discovery requires HTTPS outside localhost, rejects embedded URL
credentials and redirects, caps response size, enforces a timeout, validates
the media type, and parses JSON or YAML with bounded aliases.

Applications that already own a typed HTTP action catalog can derive matching
one-step Arazzo workflows and OpenAPI operations with
`createArazzoHttpActionProjection`. The helper accepts one action list, rejects
duplicate identifiers and paths, carries the exact input/output JSON Schemas
into both documents, and can describe an OAuth 2.0 authorization-code boundary.
It does not execute or authorize the actions; the application's existing HTTP
handler remains the effect and policy boundary.

Specification: <https://spec.openapis.org/arazzo/latest.html>

## License

MIT
