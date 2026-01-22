import * as core from "@actions/core";
import * as github from "@actions/github";
import valid from "semver/functions/valid";
import prerelease from "semver/functions/prerelease";
import RE2 from "re2";

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
        try {
          return new RE2(input);
        } catch (e) {
          core.warning(`Invalid regex pattern ignored: ${input}`);
          return null;
        }
      })
      .filter(Boolean) as RegExp[];
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

    let versionsToDelete = allVersions.filter((v) => {
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

        const deleteParams = {
          package_type: "container" as const,
          package_name: packageName,
          package_version_id: v.id,
          ...(org ? { org } : {}),
        };

        if (org) {
          await octokit.rest.packages.deletePackageVersionForOrg(
            deleteParams as any,
          );
        } else {
          await octokit.rest.packages.deletePackageVersionForAuthenticatedUser(
            deleteParams as any,
          );
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
