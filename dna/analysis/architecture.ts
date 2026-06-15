import path from "node:path";

export interface ArchitectureInfo {
  routes: string[];
  services: string[];
  repositories: string[];
  controllers: string[];
}

export function analyzeArchitecture(
  files: string[]
): ArchitectureInfo {

  const result: ArchitectureInfo = {
    routes: [],
    services: [],
    repositories: [],
    controllers: []
  };

  for (const file of files) {

    const lower =
      path.basename(file).toLowerCase();

    if (lower.includes("route"))
      result.routes.push(file);

    if (lower.includes("service"))
      result.services.push(file);

    if (lower.includes("repository"))
      result.repositories.push(file);

    if (lower.includes("controller"))
      result.controllers.push(file);
  }

  return result;
}