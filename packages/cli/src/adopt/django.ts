import { closing, insertLines, lines } from "./app.js";
import { addDependency } from "./python.js";
import type { Stack } from "./stack.js";

const middleware = "p9s.django.P9sMiddleware";

export const django: Stack = {
  name: "django",
  title: "Django",
  guide: "django",
  install: "uv sync",
  left: [
    "Delete the permission checks of the views, and read and write as the user: the policies hide the rows the user does not read, and refuse the writes",
    "Answer 403 to a write the policies refuse, which raises a DatabaseError that p9s.is_refused recognizes, and 404 for a row the user does not read",
  ],
  detect: async app => (await app.read("manage.py")) !== undefined,

  async adopt(app, options) {
    await addDependency(app, options, "django");
    const manage = (await app.read("manage.py"))!;
    const module = /DJANGO_SETTINGS_MODULE["']\s*,\s*["']([\w.]+)["']/.exec(manage)?.[1];
    if (!module) throw new Error("No DJANGO_SETTINGS_MODULE in manage.py");
    const settings = `${module.replaceAll(".", "/")}.py`;
    await app.edit(settings, code => {
      if (code.includes(middleware)) return code;
      const start = /^MIDDLEWARE\s*=\s*[[(]/m.exec(code);
      if (!start) throw new Error(`No MIDDLEWARE in ${settings}`);
      const open = start.index + start[0].length - 1;
      const close = closing(code, open);
      const body = code.slice(open + 1, close);
      let result: string;
      if (body.includes("\n")) {
        const bodyLines = lines(body);
        const items = bodyLines.flatMap((line, index) => /^\s*["']/.test(line) ? [index] : []);
        const indent = /^\s*/.exec(bodyLines[items[0] ?? 0] ?? "")![0] || "    ";
        const last = items.at(-1);
        if (last !== undefined && !bodyLines[last]!.trimEnd().endsWith(",")) bodyLines[last] = `${bodyLines[last]!.trimEnd()},`;
        bodyLines.splice((last ?? 0) + 1, 0, `${indent}"${middleware}",`);
        result = `${code.slice(0, open + 1)}${bodyLines.join("\n")}${code.slice(close)}`;
      } else {
        const trimmed = body.trim().replace(/,$/, "");
        result = `${code.slice(0, open + 1)}${trimmed ? `${trimmed}, ` : ""}"${middleware}"${code.slice(close)}`;
      }
      const end = lines(result.slice(0, result.indexOf(middleware))).length - 1;
      const statementEnd = lines(result).findIndex((line, index) => index >= end && /[\])]\s*$/.test(line));
      const config = /^BASE_DIR\s*=/m.test(result) ? `BASE_DIR / "${options.configFile}"` : `"${options.configFile}"`;
      return insertLines(result, statementEnd + 1, [
        "# p9s runs every request in a transaction as its user, after the middleware that signs users in",
        `P9S_CONFIG = ${config}`,
        ...(options.userId ? [`P9S_USER_ID = "${options.userId}"`] : []),
      ]);
    });
  },
};
