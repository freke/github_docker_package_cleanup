import * as core from "@actions/core";
import * as github from "@actions/github";
import valid from "semver/functions/valid";
import prerelease from "semver/functions/prerelease";
import safe from "safe-regex";

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const myToken = core.getInput("token");
    const packageName = core.getInput("package");
    const org = core.getInput("org");

    const keepInputs = core.getInput("keep")
      ? core
          .getInput("keep")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
    const keepPatterns = keepInputs
      .map((input) => {
        if (!safe(input)) {
          core.warning(
            `Regex pattern "${input}" is potentially unsafe and was ignored.`,
          );
          return null;
        }

        try {
          return new RegExp(input);
        } catch {
          core.warning(`Invalid regex pattern ignored: ${input}`);
          return null;
        }
      })
      .filter((p): p is RegExp => p !== null);
    const daysInput = core.getInput("days").trim();
    const daysThreshold = Number.parseInt(daysInput, 10);
    if (!Number.isFinite(daysThreshold) || daysThreshold < 0) {
      throw new Error(`Invalid days input: ${daysInput}`);
    }
    const dryRun = core.getBooleanInput("dry_run");

    const octokit = github.getOctokit(myToken);
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    const listOptions = {
      package_type: "container" as const,
      package_name: packageName,
      per_page: 100,
    };
    const allVersions = org
      ? await octokit.paginate(
          octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg,
          { ...listOptions, org },
        )
      : await octokit.paginate(
          octokit.rest.packages
            .getAllPackageVersionsForPackageOwnedByAuthenticatedUser,
          listOptions,
        );

    const versionsToDelete = allVersions.filter((v) => {
      const tags = v.metadata?.container?.tags || [];

      // Never delete 'latest'
      if (tags.includes("latest")) return false;

      const isWhitelisted =
        keepInputs.includes(v.id.toString()) ||
        tags.some((tag) => keepPatterns.some((pattern) => pattern.test(tag)));

      if (isWhitelisted) return false;

      // Filter for non-semver OR prereleases (v1.0.0-beta)
      const isCandidate = tags.some((t) => !valid(t) || !!prerelease(t));
      if (!isCandidate) return false;

      // Calculate Age
      const updatedAt = new Date(v.updated_at).getTime();
      const ageInDays = (now - updatedAt) / msPerDay;

      return ageInDays >= daysThreshold;
    });

    // Debug logs are only output if the `ACTIONS_STEP_DEBUG` secret is true
    core.debug(`to be deleted ${JSON.stringify(versionsToDelete)}`);

    for (const v of versionsToDelete) {
      const tagList = v.metadata?.container?.tags?.join(", ") || "no tags";

      if (dryRun) {
        core.info(`[DRY-RUN] Would delete version ${v.id} (Tags: ${tagList})`);
      } else {
        core.info(`Deleting version ${v.id} (Tags: ${tagList})...`);

        const baseParams = {
          package_type: "container" as const,
          package_name: packageName,
          package_version_id: v.id,
        };

        if (org) {
          await octokit.rest.packages.deletePackageVersionForOrg({
            ...baseParams,
            org,
          });
        } else {
          await octokit.rest.packages.deletePackageVersionForAuthenticatedUser({
            ...baseParams,
          });
        }
      }
    }

    // Set outputs for other workflow steps to use
    core.setOutput("deleted", versionsToDelete.length);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}
