// =============================================================================
// File        : main.ts
// Author      : yukimemi
// Last Change : 2024/07/28 20:39:56.
// =============================================================================

import * as autocmd from "jsr:@denops/std@7.3.0/autocmd";
import * as fn from "jsr:@denops/std@7.3.0/function";
import * as fs from "jsr:@std/fs@1.0.5";
import * as helper from "jsr:@denops/std@7.3.0/helper";
import * as op from "jsr:@denops/std@7.3.0/option";
import * as path from "jsr:@std/path@1.0.8";
import * as vars from "jsr:@denops/std@7.3.0/variable";
import { batch } from "jsr:@denops/std@7.3.0/batch";
import { dir } from "jsr:@cross/dir@1.1.0";
import type { Denops } from "jsr:@denops/std@7.3.0";
import { Semaphore } from "jsr:@lambdalisue/async@2.1.1";
import { assert, ensure, is } from "jsr:@core/unknownutil@4.3.0";

let debug = false;
let enable = true;
let addEcho = true;
let addNotify = false;
let ignoreFileTypes = ["log", "gitcommit"];
const home = ensure(await dir("home"), is.String);
const chronoDir = path.join(home, ".cache", "chronicle");
let readPath = path.join(chronoDir, "read");
let writePath = path.join(chronoDir, "write");
let interval = 500;

const lock = new Semaphore(1);
const cache = new Map<string, number>();

async function getChronoData(chronoPath: string, reverse = true): Promise<string[]> {
  const lines = (await Deno.readTextFile(chronoPath)).split(/\r?\n/).filter((x) => x !== "");
  if (reverse) {
    return lines.reverse();
  }
  return lines;
}

async function setChronoData(chronoPath: string, lines: string[]) {
  await fs.ensureDir(path.dirname(chronoPath));
  await Deno.writeTextFile(chronoPath, lines.join("\n"));
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
      const lines = (await getChronoData(chronoPath, false)).filter((x) => x !== nap);
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
  readPath = ensure(
    await fn.expand(denops, await vars.g.get(denops, "chronicle_read_path", readPath)),
    is.String,
  );
  writePath = ensure(
    await fn.expand(denops, await vars.g.get(denops, "chronicle_write_path", writePath)),
    is.String,
  );
  interval = ensure(await vars.g.get(denops, "chronicle_throttle_interval", interval), is.Number);

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
          assert(chronoPath, is.String);
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
          const bufPath = ensure(await fn.expand(denops, "%:p"), is.String);
          const key = `${chronoPath}:${bufPath}`;
          const lastExecuted = cache.get(key);
          const now = (new Date()).getTime();
          if (lastExecuted && now - lastExecuted < interval) {
            clog(`skip: [${bufPath}]`);
            return;
          }
          cache.set(key, (new Date()).getTime());

          clog(`addChronoData: (${chronoPath}, ${bufPath})`);
          if (!(await addChronoData(chronoPath, bufPath))) {
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
        assert(chronoPath, is.String);
        const lines = await getChronoData(chronoPath);
        await batch(denops, async () => {
          await fn.setqflist(denops, [], " ", {
            title: `[chronicle] ${chronoPath}`,
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
    async change(e: unknown): Promise<void> {
      assert(e, is.Boolean);
      console.log(`Chronicle change: ${e}`);
      enable = e;
    },

    async reset(chronoPath: unknown): Promise<void> {
      assert(chronoPath, is.String);

      const msg = `Remove: ${chronoPath}`;

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

      await Deno.remove(chronoPath);
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
