export function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": status === 200
        ? "public, max-age=60, s-maxage=300"
        : "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function apiHandler(action) {
  try {
    return jsonResponse(await action());
  } catch (error) {
    console.error(error);
    const hasPublicStatus = Number.isInteger(error?.status);
    const status = hasPublicStatus ? error.status : 500;
    return jsonResponse(
      { error: hasPublicStatus ? (error.message || "Request failed.") : "Internal server error." },
      status
    );
  }
}

export async function privateApiHandler(action) {
  const response = await apiHandler(action);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
