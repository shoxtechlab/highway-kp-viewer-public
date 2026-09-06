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
    return jsonResponse(
      { error: error.message || "Internal server error." },
      error.status || 500
    );
  }
}
