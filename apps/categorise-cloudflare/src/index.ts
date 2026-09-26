import { logSummary, runClassifier, type ClassifierEnv } from "./run.js";

export default {
  async scheduled(_event: unknown, env: ClassifierEnv): Promise<void> {
    try {
      logSummary(await runClassifier(env));
    } catch (err: unknown) {
      console.log(
        JSON.stringify({
          msg: "classifier_failed",
          error: err instanceof Error ? err.message : "unknown",
        }),
      );
    }
  },
};
