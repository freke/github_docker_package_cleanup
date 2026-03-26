import * as core from "@actions/core";
import * as github from "@actions/github";
import valid from "semver/functions/valid";
import prerelease from "semver/functions/prerelease";
import safe from "safe-regex";
import type { PackageVersion } from "./types";

export async function run(): Promise<void> {
  try {
    const myToken = core.getInput("token");
    if (!myToken) {
      throw new Error("Input 'token' is required");
    }
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

    const versionsToDelete = allVersions.filter((v: PackageVersion) => {
      core.debug(`Examine package ${JSON.stringify(v)}`);

      const tags = v.metadata?.container?.tags || [];

      if (keepInputs.includes(v.id.toString())) {
        core.debug(`White listed by ID`);
        return false;
      }

      if (tags.length > 0) {
        // Never delete 'latest'
        if (tags.includes("latest")) return false;

        const isWhitelisted = tags.some((tag: string) =>
          keepPatterns.some((pattern) => pattern.test(tag)),
        );

        core.debug(`White listed ${isWhitelisted}`);
        if (isWhitelisted) return false;

        // Filter for non-semver OR prereleases (v1.0.0-beta)
        const isCandidate = tags.some(
          (t: string) => !valid(t) || !!prerelease(t),
        );

        core.debug(`Is candidate ${isCandidate}`);
        if (!isCandidate) return false;
      }

      // Calculate Age
      const updatedAt = new Date(v.updated_at).getTime();
      const ageInDays = (now - updatedAt) / msPerDay;

      return ageInDays >= daysThreshold;
    });

    let deletedCount = 0;

    for (const v of versionsToDelete) {
      core.debug(`delete ${JSON.stringify(v)}`);

      const tagList = v.metadata?.container?.tags?.join(", ") || "no tags";

      if (dryRun) {
        core.info(`[DRY-RUN] Would delete version ${v.id} (Tags: ${tagList})`);
        deletedCount++;
      } else {
        core.info(`Deleting version ${v.id} (Tags: ${tagList})...`);

        try {
          if (org) {
            await octokit.rest.packages.deletePackageVersionForOrg({
              package_type: "container" as const,
              package_name: packageName,
              package_version_id: v.id,
              org,
            });
          } else {
            await octokit.rest.packages.deletePackageVersionForAuthenticatedUser(
              {
                package_type: "container" as const,
                package_name: packageName,
                package_version_id: v.id,
              },
            );
          }
          deletedCount++;
        } catch (err) {
          if (
            err instanceof Error &&
            err.message.includes("cannot be deleted")
          ) {
            core.warning(`Skipped deleting version ${v.id}: ${err.message}`);
            continue;
          }
          throw err;
        }
      }
    }

    // Set outputs for other workflow steps to use
    core.setOutput("deleted", deletedCount);
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed(String(error));
    }
  }
}
