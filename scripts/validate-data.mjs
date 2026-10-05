import { compileDataModel } from "../lib/dataCompiler.mjs";

const compiled = await compileDataModel({ projectRoot: process.cwd() });
console.log(
  `Validated ${compiled.routeCount} routes, `
  + `${compiled.organizationCount.offices} offices and `
  + `${Object.keys(compiled.scopes).length} scopes.`
);
