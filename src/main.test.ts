import * as core from "@actions/core";
import { run } from "./main"; // Assuming main.ts is in the same directory
import { RestEndpointMethodTypes } from "@octokit/plugin-rest-endpoint-methods";

// Mocking @actions/core
jest.mock("@actions/core", () => ({
  getInput: jest.fn(),
  getBooleanInput: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  debug: jest.fn(),
}));

// Mocking @actions/github
// We'll need to mock the octokit and its methods used in main.ts
const mockOctokit = {
  rest: {
    packages: {
      getAllPackageVersionsForPackageOwnedByOrg: jest.fn(),
      getAllPackageVersionsForPackageOwnedByAuthenticatedUser: jest.fn(),
      deletePackageVersionForOrg: jest.fn(),
      deletePackageVersionForAuthenticatedUser: jest.fn(),
    },
  },
  paginate: jest.fn(),
};
jest.mock("@actions/github", () => ({
  getOctokit: jest.fn(() => mockOctokit),
}));

// Helper function to mock inputs
const mockInput = (inputs: Record<string, string | boolean>) => {
  (core.getInput as jest.Mock).mockImplementation((name) => inputs[name] || "");
  (core.getBooleanInput as jest.Mock).mockImplementation(
    (name) => inputs[name] || false,
  );
};

type PackageVersion =
  RestEndpointMethodTypes["packages"]["getAllPackageVersionsForPackageOwnedByOrg"]["response"]["data"][number];

// Helper function to mock API responses
const mockApiResponse = (data: object[]) => {
  (mockOctokit.paginate as jest.Mock).mockResolvedValue(
    data as PackageVersion[],
  );
};

describe("run", () => {
  const MOCK_TOKEN = "mock-token";
  const MOCK_PACKAGE_NAME = "my-docker-image";
  const MOCK_ORG = "my-org";

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    // Set default inputs that are commonly used
    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7", // Default to 7 days
      dry_run: false,
    });

    // Mock Date.now to control time
    jest.useFakeTimers().setSystemTime(new Date("2023-10-27T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should delete old non-semver versions", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago
    const recentDate = new Date("2023-10-25T10:00:00Z").getTime(); // 2 days ago

    const versions = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["non-semver-old"] } },
      },
      {
        id: 2,
        created_at: new Date(recentDate).toISOString(),
        updated_at: new Date(recentDate).toISOString(),
        metadata: { container: { tags: ["non-semver-recent"] } },
      },
      {
        id: 3,
        created_at: new Date(recentDate).toISOString(),
        updated_at: new Date(recentDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0"] } }, // Semver, should not be deleted by this logic
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect delete to be called only for the old non-semver version
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledWith({
      package_type: "container",
      package_name: MOCK_PACKAGE_NAME,
      package_version_id: 1,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should delete old prerelease semver versions", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago
    const recentDate = new Date("2023-10-25T10:00:00Z").getTime(); // 2 days ago

    const versions = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-beta.1"] } }, // Old prerelease
      },
      {
        id: 2,
        created_at: new Date(recentDate).toISOString(),
        updated_at: new Date(recentDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-beta.2"] } }, // Recent prerelease
      },
      {
        id: 3,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0"] } }, // Old semver, not prerelease
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect delete to be called only for the old prerelease version
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledWith({
      package_type: "container",
      package_name: MOCK_PACKAGE_NAME,
      package_version_id: 1,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it('should not delete versions with "latest" tag', async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago

    const versions = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["latest", "v1.0.0"] } },
      },
      {
        id: 2,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["latest"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect no deletions
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 0);
  });

  it("should not delete whitelisted version", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      keep: "v1.0.0-old", // Whitelist
    });

    const versions = [
      {
        id: 101, // Whitelisted ID
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-old"] } },
      },
      {
        id: 102, // Not whitelisted, old
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.1-old"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect only version 102 to be deleted
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledWith({
      package_type: "container",
      package_name: MOCK_PACKAGE_NAME,
      package_version_id: 102,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should not delete whitelisted versions by regex pattern", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      keep: "v1.0.0-.*,release-.*", // Whitelist patterns
    });

    const versions = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-stable"] } }, // Matches first pattern
      },
      {
        id: 2,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["release-candidate"] } }, // Matches second pattern
      },
      {
        id: 3,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.1-old"] } }, // Old, not matched
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect only version 3 to be deleted
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledWith({
      package_type: "container",
      package_name: MOCK_PACKAGE_NAME,
      package_version_id: 3,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should handle invalid regex patterns in keep input", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      keep: "v1.0.0-.*, [invalid-regex", // Invalid regex
    });

    const versions = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-stable"] } }, // Matches valid pattern
      },
      {
        id: 2,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["some-other-tag"] } }, // Old, not matched, not whitelisted
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect warning for invalid regex
    expect(core.warning).toHaveBeenCalledWith(
      'Regex pattern "[invalid-regex" is potentially unsafe and was ignored.',
    );
    // Expect only version 2 to be deleted
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).toHaveBeenCalledWith({
      package_type: "container",
      package_name: MOCK_PACKAGE_NAME,
      package_version_id: 2,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should perform dry run and not delete anything", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      dry_run: true, // Enable dry run
    });

    const versions = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-old"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect info logs for dry run, but no actual deletion calls
    expect(core.info).toHaveBeenCalledWith(
      "[DRY-RUN] Would delete version 1 (Tags: v1.0.0-old)",
    );
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 1); // Still counts as "would be deleted"
  });

  it("should use deletePackageVersionForOrg when org input is provided", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime(); // 9 days ago

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      org: MOCK_ORG, // Provide org input
      days: "7",
      dry_run: false,
    });

    const versions = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-old"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

    // Expect delete to be called using the org-specific method
    expect(
      mockOctokit.rest.packages.deletePackageVersionForOrg,
    ).toHaveBeenCalledTimes(1);
    expect(
      mockOctokit.rest.packages.deletePackageVersionForOrg,
    ).toHaveBeenCalledWith({
      package_type: "container",
      package_name: MOCK_PACKAGE_NAME,
      package_version_id: 1,
      org: MOCK_ORG,
    });
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should handle no versions found", async () => {
    mockApiResponse([]); // No versions returned

    await run();

    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledWith("deleted", 0);
  });

  it("should handle API errors gracefully", async () => {
    const errorMessage = "GitHub API error";
    (mockOctokit.paginate as jest.Mock).mockRejectedValue(
      new Error(errorMessage),
    );

    await run();

    expect(core.setFailed).toHaveBeenCalledWith(errorMessage);
  });
});
