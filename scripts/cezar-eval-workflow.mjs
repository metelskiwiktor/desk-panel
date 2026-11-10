export async function executeAgentWorkflow({
  order, evaluation, workflow, brief, worktree, artifacts, hookDir, env, inputModel, reasoning, state = {},
  agent, check, command, git, renderPrompt, nodeValues,
  createReviewWorkspace, snapshotReviewTree, changedSnapshotPaths, removeReviewWorkspace, onPhase = () => {},
}) {
  const actions = [];
  let phase = 'verify';
  let verifyCount = 0;
  let fixCount = 0;
  let reviewCount = 0;
  let firstVerify = null;
  let finalVerify = null;
  let lastReview = null;
  const retryLimits = workflow.retries;
  const verifyNode = workflow.nodes.get('verify');
  const commandResult = async (path, args, output, timeoutMs) => command(worktree, path, args, env, output, timeoutMs);
  const record = action => {
    actions.push(action);
    onPhase(phase, { actions: [...actions], verifyCount, fixCount, reviewCount, firstVerify, finalVerify });
  };
  const setPhase = next => {
    phase = next;
    onPhase(phase, { actions: [...actions], verifyCount, fixCount, reviewCount, firstVerify, finalVerify });
  };
  const makePrompt = node => renderPrompt(node.prompt, { task: brief, ...nodeValues(state, workflow.workflow) });

  const verifyCycle = async () => {
    let retries = 0;
    setPhase(`verify-${verifyCount + 1}`);
    let current = await check(worktree, hookDir, artifacts, `verify-${verifyCount + 1}`, verifyNode);
    verifyCount++;
    const initial = { ...current };
    if (!firstVerify) firstVerify = initial;
    finalVerify = current;
    record({
      step: `verify-${verifyCount}`, exitCode: current.exitCode, passed: current.passed,
      timedOut: current.timedOut, error: current.error, durationMs: current.durationMs,
    });
    while (!current.passed && retries < retryLimits.verify) {
      const fixNode = workflow.nodes.get('fix');
      const errorText = `${current.stderrText ?? ''}\n${current.stdoutText ?? ''}`.slice(-30_000)
        || `just check failed; details in ${artifacts}/verify-${verifyCount}/check.json`;
      state.verify = { summary: errorText, output: errorText, passed: false };
      state['verify-retry'] = { iteration: retries + 1, max: retryLimits.verify };
      fixCount++;
      const fixId = `fix-${fixCount}`;
      setPhase(fixId);
      const fixed = await agent({
        node: { ...fixNode, runner: order.runner }, prompt: makePrompt(fixNode), worktree,
        artifacts: `${artifacts}/${fixId}`, hookDir, modelOverride: inputModel, reasoning,
        timeoutMs: fixNode.timeoutMs,
      });
      record({ step: fixId, exitCode: fixed.exitCode, timedOut: fixed.timedOut, error: fixed.error, durationMs: fixed.durationMs, model: inputModel, reasoning: fixed.reasoning, usage: fixed.usage });
      if (fixed.exitCode !== 0) throw new Error(`${order.id}: fix CLI failed; see ${artifacts}/${fixId}`);

      const scopeId = `fix-scope-${fixCount}`;
      setPhase(scopeId);
      const fixScopeNode = workflow.nodes.get('fix-scope');
      const scoped = await commandResult('scripts/executor-scope.mjs', ['--check'], `${artifacts}/${scopeId}`, fixScopeNode.timeoutMs);
      record({ step: scopeId, exitCode: scoped.code, timedOut: scoped.timedOut, error: scoped.error, durationMs: scoped.durationMs });
      if (scoped.code !== 0) throw new Error(`${order.id}: fix scope check failed; see ${artifacts}/${scopeId}`);

      retries++;
      setPhase(`verify-${verifyCount + 1}`);
      current = await check(worktree, hookDir, artifacts, `verify-${verifyCount + 1}`, verifyNode);
      verifyCount++;
      finalVerify = current;
      record({
        step: `verify-${verifyCount}`, exitCode: current.exitCode, passed: current.passed,
        timedOut: current.timedOut, error: current.error, durationMs: current.durationMs,
      });
    }
    return { initial, check: current };
  };

  try {
    const cycle = await verifyCycle();
    firstVerify = cycle.initial;
    finalVerify = cycle.check;
    state.verify = {
      summary: `just check ${finalVerify.passed ? 'passed' : 'failed'} (${verifyCount} run(s))`,
      output: `just check ${finalVerify.passed ? 'passed' : 'failed'} (${verifyCount} run(s))`,
      passed: finalVerify.passed,
    };
    let changedPaths = git(worktree, ['diff', '--name-only', 'HEAD'], env).split(/\r?\n/).filter(Boolean);
    if (!changedPaths.length) throw new Error(`${order.id}: changed.false -> no-changes; no review or hidden acceptance`);
    if (!finalVerify.passed) throw new Error(`${order.id}: verify-retry.exhausted -> verify-failed`);

    let reviewRound = 0;
    while (reviewRound <= retryLimits.review) {
      const reviewNode = workflow.nodes.get('review');
      const reviewId = `review-${reviewRound + 1}`;
      setPhase(reviewId);
      const reviewCopy = createReviewWorkspace(worktree);
      let review;
      try {
        review = await agent({
          node: reviewNode, prompt: makePrompt(reviewNode), worktree: reviewCopy.path,
          artifacts: `${artifacts}/${reviewId}`, hookDir, modelOverride: reviewNode.model,
          reasoning: reviewNode.variant ?? 'workflow/default', timeoutMs: reviewNode.timeoutMs,
        });
        review.verdict = parseReviewerVerdict(review.summary);
        record({ step: reviewId, exitCode: review.exitCode, timedOut: review.timedOut, error: review.error, verdict: review.verdict, durationMs: review.durationMs, model: review.model, usage: review.usage });
        const changed = changedSnapshotPaths(reviewCopy.snapshot, snapshotReviewTree(reviewCopy.path));
        if (changed.length) throw new Error(`${order.id}: reviewer mutation guard detected changes: ${changed.join(', ')}`);
        review.readOnlyGuard = { allowedTools: [...reviewNode.allowedTools], separateCopy: true, noGitHistory: true, mutationPaths: changed };
      } finally {
        removeReviewWorkspace(reviewCopy.path);
      }
      reviewCount++;
      lastReview = review;
      state.review = review;
      if (review.exitCode !== 0 || review.verdict === 'invalid') throw new Error(`${order.id}: reviewer failed or omitted verdict marker; see ${artifacts}/${reviewId}`);
      if (review.verdict === 'approve') break;
      if (reviewRound >= retryLimits.review) break;

      const addressNode = workflow.nodes.get('address');
      const addressId = `address-${reviewRound + 1}`;
      setPhase(addressId);
      const address = await agent({
        node: { ...addressNode, runner: order.runner }, prompt: makePrompt(addressNode), worktree,
        artifacts: `${artifacts}/${addressId}`, hookDir, modelOverride: inputModel, reasoning,
        timeoutMs: addressNode.timeoutMs,
      });
      record({ step: addressId, exitCode: address.exitCode, timedOut: address.timedOut, error: address.error, durationMs: address.durationMs, model: inputModel, reasoning: address.reasoning, usage: address.usage });
      if (address.exitCode !== 0) throw new Error(`${order.id}: address CLI failed; see ${artifacts}/${addressId}`);

      const scopeId = 'address-scope';
      setPhase(scopeId);
      const addressScopeNode = workflow.nodes.get('address-scope');
      const scoped = await commandResult('scripts/executor-scope.mjs', ['--check'], `${artifacts}/${scopeId}`, addressScopeNode.timeoutMs);
      record({ step: scopeId, exitCode: scoped.code, timedOut: scoped.timedOut, error: scoped.error, durationMs: scoped.durationMs });
      if (scoped.code !== 0) throw new Error(`${order.id}: address scope check failed; see ${artifacts}/${scopeId}`);

      const addressedCycle = await verifyCycle();
      finalVerify = addressedCycle.check;
      state.verify = {
        summary: `just check ${finalVerify.passed ? 'passed' : 'failed'} after address (${verifyCount} run(s))`,
        output: `just check ${finalVerify.passed ? 'passed' : 'failed'} after address`,
        passed: finalVerify.passed,
      };
      if (!finalVerify.passed) throw new Error(`${order.id}: verification failed after address; see ${artifacts}`);
      reviewRound++;
    }

    changedPaths = git(worktree, ['diff', '--name-only', 'HEAD'], env).split(/\r?\n/).filter(Boolean);
    if (lastReview?.verdict !== 'approve') throw new Error(`${order.id}: review-retry.exhausted -> review-failed`);
    return {
      runner: order.runner, model: inputModel,
      reasoning: order.runner === 'codex' ? 'high' : workflow.nodes.get('implement').variant ?? 'workflow/default',
      reviewer: { runner: workflow.nodes.get('review').runner, model: workflow.nodes.get('review').model, verdict: lastReview.verdict, readOnlyGuard: lastReview.readOnlyGuard },
      firstVerify, finalVerify, verificationRuns: verifyCount, reviewRounds: reviewCount,
      workflowCompleted: true, changedPaths, actions,
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.workflowContext = {
      phase, actions: [...actions], firstVerify, finalVerify, verificationRuns: verifyCount,
      reviewRounds: reviewCount, reviewerVerdict: lastReview?.verdict ?? null,
    };
    throw failure;
  }
}

function parseReviewerVerdict(text) {
  const match = text.match(/CEZ:VERDICT\s+(approve|changes)\s*$/m);
  return match?.[1] ?? 'invalid';
}
