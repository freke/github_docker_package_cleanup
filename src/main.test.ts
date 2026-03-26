import { jest } from "@jest/globals";
import type { PackageVersion } from "./types";

const mockCore = {
  getInput: jest.fn(),
  getBooleanInput: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  debug: jest.fn(),
};

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

const mockGithub = {
  getOctokit: jest.fn(() => mockOctokit),
};

jest.unstable_mockModule("@actions/core", () => mockCore);
jest.unstable_mockModule("@actions/github", () => mockGithub);

const { run } = await import("./main");

const mockInput = (inputs: Record<string, string | boolean>) => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (mockCore.getInput as any).mockImplementation(
    (name: unknown) => inputs[name as string] || "",
  );
  (mockCore.getBooleanInput as any).mockImplementation(
    (name: unknown) => !!inputs[name as string],
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
};

const mockApiResponse = (data: PackageVersion[]) => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (mockOctokit.paginate as any).mockResolvedValue(data);
  /* eslint-enable @typescript-eslint/no-explicit-any */
};

describe("run", () => {
  const MOCK_TOKEN = "mock-token";
  const MOCK_PACKAGE_NAME = "my-docker-image";
  const MOCK_ORG = "my-org";

  beforeEach(() => {
    jest.clearAllMocks();

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      dry_run: false,
    });

    jest.useFakeTimers().setSystemTime(new Date("2023-10-27T10:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should delete old non-semver versions", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();
    const recentDate = new Date("2023-10-25T10:00:00Z").getTime();

    const versions: PackageVersion[] = [
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
        metadata: { container: { tags: ["v1.0.0"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should delete old prerelease semver versions", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();
    const recentDate = new Date("2023-10-25T10:00:00Z").getTime();

    const versions: PackageVersion[] = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-beta.1"] } },
      },
      {
        id: 2,
        created_at: new Date(recentDate).toISOString(),
        updated_at: new Date(recentDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-beta.2"] } },
      },
      {
        id: 3,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should delete old versions with no tag", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();
    const recentDate = new Date("2023-10-25T10:00:00Z").getTime();

    const versions: PackageVersion[] = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: [] } },
      },
      {
        id: 2,
        created_at: new Date(recentDate).toISOString(),
        updated_at: new Date(recentDate).toISOString(),
        metadata: { container: { tags: [] } },
      },
    ];
    mockApiResponse(versions);

    await run();

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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it('should not delete versions with "latest" tag', async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();

    const versions: PackageVersion[] = [
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

    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).not.toHaveBeenCalled();
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 0);
  });

  it("should not delete whitelisted version", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      keep: "v1.0.0-old",
    });

    const versions: PackageVersion[] = [
      {
        id: 101,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-old"] } },
      },
      {
        id: 102,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.1-old"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should not delete whitelisted versions by regex pattern", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      keep: "v1.0.0-.*,release-.*",
    });

    const versions: PackageVersion[] = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-stable"] } },
      },
      {
        id: 2,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["release-candidate"] } },
      },
      {
        id: 3,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.1-old"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should not delete whitelisted version by ID", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      keep: "101",
    });

    const versions: PackageVersion[] = [
      {
        id: 101,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["old-tag"] } },
      },
      {
        id: 102,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["another-old-tag"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should handle invalid regex patterns in keep input", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      keep: "v1.0.0-.*, [invalid-regex",
    });

    const versions: PackageVersion[] = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-stable"] } },
      },
      {
        id: 2,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["some-other-tag"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

    expect(mockCore.warning).toHaveBeenCalledWith(
      'Regex pattern "[invalid-regex" is potentially unsafe and was ignored.',
    );
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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should perform dry run and not delete anything", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      days: "7",
      dry_run: true,
    });

    const versions: PackageVersion[] = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-old"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

    expect(mockCore.info).toHaveBeenCalledWith(
      "[DRY-RUN] Would delete version 1 (Tags: v1.0.0-old)",
    );
    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).not.toHaveBeenCalled();
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should use deletePackageVersionForOrg when org input is provided", async () => {
    const oldDate = new Date("2023-10-18T10:00:00Z").getTime();

    mockInput({
      token: MOCK_TOKEN,
      package: MOCK_PACKAGE_NAME,
      org: MOCK_ORG,
      days: "7",
      dry_run: false,
    });

    const versions: PackageVersion[] = [
      {
        id: 1,
        created_at: new Date(oldDate).toISOString(),
        updated_at: new Date(oldDate).toISOString(),
        metadata: { container: { tags: ["v1.0.0-old"] } },
      },
    ];
    mockApiResponse(versions);

    await run();

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
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 1);
  });

  it("should handle no versions found", async () => {
    mockApiResponse([]);

    await run();

    expect(
      mockOctokit.rest.packages.deletePackageVersionForAuthenticatedUser,
    ).not.toHaveBeenCalled();
    expect(mockCore.setOutput).toHaveBeenCalledWith("deleted", 0);
  });

  it("should handle API errors gracefully", async () => {
    const errorMessage = "GitHub API error";
    /* eslint-disable @typescript-eslint/no-explicit-any */
    (mockOctokit.paginate as any).mockRejectedValue(new Error(errorMessage));
    /* eslint-enable @typescript-eslint/no-explicit-any */

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(errorMessage);
  });
});
