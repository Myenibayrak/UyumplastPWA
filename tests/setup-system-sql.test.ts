import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Setup SQL messaging schema", () => {
  const file = readFileSync(join(process.cwd(), "app/api/setup-system/route.ts"), "utf8");

  it("includes direct and task message tables", () => {
    expect(file).toContain("CREATE TABLE IF NOT EXISTS public.direct_messages");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS public.task_messages");
  });

  it("includes realtime publication for message tables", () => {
    expect(file).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.direct_messages");
    expect(file).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE public.task_messages");
  });
});
