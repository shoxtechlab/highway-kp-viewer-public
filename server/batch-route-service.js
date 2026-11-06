import { apiError } from "./route-service.js";

export const DEFAULT_BATCH_SIZE = 200;
export const MAX_CONFIGURABLE_BATCH_SIZE = 500;

export function batchSizeLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= MAX_CONFIGURABLE_BATCH_SIZE
    ? parsed
    : DEFAULT_BATCH_SIZE;
}

export async function readBatchRequest(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    throw apiError(400, "Request body must be valid JSON.");
  }
  return body;
}

export async function executeBatch(records, convert, { maxRecords = DEFAULT_BATCH_SIZE, mode } = {}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw apiError(400, "records must be a non-empty array.");
  }
  if (records.length > maxRecords) {
    throw apiError(413, `records must contain at most ${maxRecords} items.`);
  }

  const results = [];
  let successCount = 0;

  // Sequential execution lets the route service reuse its in-memory route cache
  // and avoids duplicate R2 reads when many rows refer to the same route.
  for (let index = 0; index < records.length; index += 1) {
    try {
      const result = await convert(records[index], index);
      results.push({ index, status: "ok", ...result });
      successCount += 1;
    } catch (error) {
      const publicError = Number.isInteger(error?.status);
      results.push({
        index,
        status: "error",
        error: publicError ? (error.message || "Conversion failed.") : "Internal server error."
      });
    }
  }

  return {
    mode,
    count: records.length,
    successCount,
    errorCount: records.length - successCount,
    results
  };
}

export function positionInput(record = {}) {
  return {
    routeId: record.route ?? record.routeId,
    direction: record.direction,
    kp: record.kp,
    sectionId: record.section ?? record.sectionId
  };
}

export function nearestInput(record = {}) {
  const sections = Array.isArray(record.sections)
    ? record.sections
    : String(record.sections || "").split(",").map(value => value.trim()).filter(Boolean);
  return {
    routeId: record.route ?? record.routeId,
    lat: record.lat ?? record.latitude,
    lon: record.lon ?? record.longitude,
    preferredRoute: record.preferredRoute,
    preferredDirection: record.preferredDirection ?? record.direction,
    heading: record.heading,
    speed: record.speed,
    accuracy: record.accuracy,
    sectionIds: sections.length ? sections : undefined
  };
}
