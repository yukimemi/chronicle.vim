// =============================================================================
// File        : main.ts
// Author      : yukimemi
// Last Change : 2024/12/08 16:30:46.
// =============================================================================

import * as autocmd from "jsr:@denops/std@7.5.0/autocmd";
import * as fn from "jsr:@denops/std@7.5.0/function";
import * as fs from "jsr:@std/fs@1.0.14";
import * as helper from "jsr:@denops/std@7.5.0/helper";
import * as op from "jsr:@denops/std@7.5.0/option";
import * as path from "jsr:@std/path@1.0.8";
import * as v from "jsr:@valibot/valibot@0.42.1";
import * as vars from "jsr:@denops/std@7.5.0/variable";
import type { Denops } from "jsr:@denops/std@7.5.0";
import { Semaphore } from "jsr:@lambdalisue/async@2.1.1";
import { batch } from "jsr:@denops/std@7.5.0/batch";

let debug = false;
let enable = true;
let addEcho = true;
let addNotify = false;
let ignoreFileTypes = ["log", "gitcommit"];
let interval = 500;

const lock = new Semaphore(1);
const cache = new Map<string, number>();

async function getChronoData(chronoPath: string, reverse = false): Promise<string[]> {
  const lines = (await Deno.readTextFile(chronoPath)).split(/\r?\n/).filter((x) => x !== "");
  if (reverse) {
    return lines.reverse();
  }
  return lines;
}

async function setChronoData(chronoPath: string, lines: string[]) {
  await fs.ensureDir(path.dirname(chronoPath));
  await Deno.writeTextFile(chronoPath, lines.reverse().join("\n"));
}

function normalizedAddPath(addPath: string): string {
  return path.normalize(addPath).replace(/\\/g, "/");
}

async function addChronoData(chronoPath: string, addPath: string): Promise<boolean> {
  try {
    if (!(await fs.exists(addPath))) {
      return false;
    }
    const nap = normalizedAddPath(addPath);
    if (await fs.exists(chronoPath)) {
      const lines = (await getChronoData(chronoPath, true)).filter((x) => x !== nap);
      lines.push(nap);
      await setChronoData(chronoPath, lines);
      return true;
    }
    await setChronoData(chronoPath, [nap]);
    return true;
  } catch (_e) {
    // console.error(e);
    return false;
  }
}

export async function main(denops: Denops): Promise<void> {
  // debug.
  debug = await vars.g.get(denops, "chronicle_debug", debug);
  // deno-lint-ignore no-explicit-any
  const clog = (...data: any[]): void => {
    if (debug) {
      console.log(...data);
    }
  };

  // Merge user config.
  enable = await vars.g.get(denops, "chronicle_enable", enable);
  addEcho = await vars.g.get(denops, "chronicle_echo", addEcho);
  addNotify = await vars.g.get(denops, "chronicle_notify", addNotify);
  ignoreFileTypes = await vars.g.get(
    denops,
    "chronicle_ignore_filetypes",
    ignoreFileTypes,
  );
  const readPath = v.parse(
    v.string(),
    await fn.expand(denops, await vars.g.get(denops, "chronicle_read_path")),
  );
  await vars.g.set(denops, "chronicle_read_path", readPath);
  const writePath = v.parse(
    v.string(),
    await fn.expand(denops, await vars.g.get(denops, "chronicle_write_path")),
  );
  await vars.g.set(denops, "chronicle_write_path", writePath);
  interval = v.parse(v.number(), await vars.g.get(denops, "chronicle_throttle_interval", interval));
  await vars.g.set(denops, "chronicle_throttle_interval", interval);

  clog({
    debug,
    enable,
    addEcho,
    addNotify,
    ignoreFileTypes,
    readPath,
    writePath,
    interval,
  });

  denops.dispatcher = {
    async chronicle(chronoPath: unknown): Promise<void> {
      try {
        await lock.lock(async () => {
          const cp = v.parse(v.string(), chronoPath);
          if (!enable) {
            clog(`chronicle skip ! enable: [${enable}]`);
            return;
          }
          // Get filetype and fileformat.
          const ft = await op.filetype.get(denops);
          if (ignoreFileTypes.some((x) => x === ft)) {
            clog(`ft is [${ft}], so skip.`);
            return;
          }

          // Get buffer path.
          const bufPath = v.parse(v.string(), await fn.expand(denops, "%:p"));
          const key = `${cp}:${bufPath}`;
          const lastExecuted = cache.get(key);
          const now = (new Date()).getTime();
          if (lastExecuted && now - lastExecuted < interval) {
            clog(`skip: [${bufPath}]`);
            return;
          }
          cache.set(key, (new Date()).getTime());

          clog(`addChronoData: (${cp}, ${bufPath})`);
          if (!(await addChronoData(cp, bufPath))) {
            return;
          }

          const msg = `add [${bufPath}] to chronicle.`;
          if (addEcho) {
            console.log(msg);
            await helper.echo(denops, msg);
          }

          if (addNotify && denops.meta.host === "nvim") {
            await helper.execute(
              denops,
              `lua vim.notify([[${msg}]], vim.log.levels.INFO)`,
            );
          }
        });
      } catch (e) {
        clog(e);
      }
    },

    async open(chronoPath: unknown): Promise<void> {
      try {
        const cp = v.parse(v.string(), chronoPath);
        const lines = await getChronoData(cp);
        await batch(denops, async () => {
          await fn.setqflist(denops, [], " ", {
            title: `[chronicle] ${cp}`,
            efm: "%f",
            lines,
          });
          await denops.cmd("botright copen");
        });
      } catch (e) {
        console.error(e);
      }
    },

    // deno-lint-ignore require-await
    async change(enabled: unknown): Promise<void> {
      const e = v.parse(v.boolean(), enabled);
      console.log(`Chronicle change: ${e}`);
      enable = e;
    },

    async reset(chronoPath: unknown): Promise<void> {
      const cp = v.parse(v.string(), chronoPath);
      const msg = `Remove: ${cp}`;

      if (addEcho) {
        console.log(msg);
        await helper.echo(denops, msg);
      }

      if (addNotify && denops.meta.host === "nvim") {
        await helper.execute(
          denops,
          `lua vim.notify([[${msg}]], vim.log.levels.INFO)`,
        );
      }

      await Deno.remove(cp);
    },

    async listRead(): Promise<string[]> {
      return await getChronoData(readPath);
    },
    async listWrite(): Promise<string[]> {
      return await getChronoData(writePath);
    },
  };

  await helper.execute(
    denops,
    `
      function! s:${denops.name}_notify(method, params) abort
        call denops#plugin#wait_async('${denops.name}', function('denops#notify', ['${denops.name}', a:method, a:params]))
      endfunction
      command! EnableChronicle call s:${denops.name}_notify('change', [v:true])
      command! DisableChronicle call s:${denops.name}_notify('change', [v:false])
      command! ResetChronicleWrite call s:${denops.name}_notify('reset', ['${writePath}'])
      command! ResetChronicleRead call s:${denops.name}_notify('reset', ['${readPath}'])
    `,
  );

  await autocmd.group(denops, denops.name, (helper) => {
    helper.remove();
    helper.define(
      "BufWritePost",
      "*",
      `call s:${denops.name}_notify('chronicle', ['${writePath}'])`,
    );
    helper.define(
      ["BufWritePost", "BufRead"],
      "*",
      `call s:${denops.name}_notify('chronicle', ['${readPath}'])`,
    );
  });

  clog("chronicle.vim has loaded");
}
