type ErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

function toErrorLike(error: unknown): ErrorLike {
  if (typeof error !== "object" || error === null) return {};
  return error as ErrorLike;
}

export function getErrorMessage(error: unknown): string {
  const e = toErrorLike(error);
  return String(e.message || "");
}

export function isMissingTableError(error: unknown, table: string): boolean {
  const e = toErrorLike(error);
  const msg = String(e.message || "").toLowerCase();
  const lowerTable = table.toLowerCase();

  return (
    msg.includes(`could not find the table 'public.${lowerTable}'`) ||
    msg.includes(`relation "public.${lowerTable}" does not exist`) ||
    (String(e.code || "") === "42P01" && msg.includes(lowerTable))
  );
}

export function isMissingColumnError(error: unknown, column: string): boolean {
  const e = toErrorLike(error);
  const msg = String(e.message || "").toLowerCase();
  const lowerColumn = column.toLowerCase();
  return (
    msg.includes(`column "${lowerColumn}" does not exist`) ||
    msg.includes(`could not find the '${lowerColumn}' column`) ||
    (String(e.code || "") === "42703" && msg.includes(lowerColumn))
  );
}

export function isMissingRelationshipError(error: unknown, left: string, right?: string): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  const l = left.toLowerCase();
  const r = right?.toLowerCase();
  if (!msg.includes("could not find a relationship")) return false;
  if (!msg.includes(`'${l}'`)) return false;
  if (r && !msg.includes(`'${r}'`)) return false;
  return true;
}

