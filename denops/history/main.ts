// =============================================================================
// File        : main.ts
// Author      : yukimemi
// Last Change : 2023/07/17 17:12:23.
// =============================================================================

import * as autocmd from "https://deno.land/x/denops_std@v5.0.1/autocmd/mod.ts";
import * as fn from "https://deno.land/x/denops_std@v5.0.1/function/mod.ts";
import * as fs from "https://deno.land/std@0.194.0/fs/mod.ts";
import * as helper from "https://deno.land/x/denops_std@v5.0.1/helper/mod.ts";
import * as op from "https://deno.land/x/denops_std@v5.0.1/option/mod.ts";
import * as path from "https://deno.land/std@0.194.0/path/mod.ts";
import * as vars from "https://deno.land/x/denops_std@v5.0.1/variable/mod.ts";
import { batch } from "https://deno.land/x/denops_std@v5.0.1/batch/mod.ts";
import dir from "https://deno.land/x/dir@1.5.1/mod.ts";
import type { Denops } from "https://deno.land/x/denops_std@v5.0.1/mod.ts";
import { Semaphore } from "https://deno.land/x/async@v2.0.2/mod.ts";
import { assert, ensure, is } from "https://deno.land/x/unknownutil@v3.2.0/mod.ts";

let debug = false;
let enable = true;
let addEcho = true;
let addNotify = false;
let ignoreFileTypes = ["log"];
const home = ensure(dir("home"), is.String);
const histDir = path.join(home, ".cache", "dps-history");
let readPath = path.join(histDir, "read");
let writePath = path.join(histDir, "write");

const lock = new Semaphore(1);

async function getHistoryData(historyPath: string) {
  return (await Deno.readTextFile(historyPath)).split(/\r?\n/);
}

async function setHistoryData(historyPath: string, lines: string[]) {
  await fs.ensureDir(path.dirname(historyPath));
  await Deno.writeTextFile(historyPath, lines.join("\n"));
}

async function addHistoryData(historyPath: string, addPath: string) {
  try {
    if (!(await fs.exists(addPath))) {
      return;
    }
    if (await fs.exists(historyPath)) {
      const lines = await getHistoryData(historyPath);
      if (!lines.includes(addPath)) {
        lines.push(addPath);
        await setHistoryData(historyPath, lines);
      }
    } else {
      await setHistoryData(historyPath, [addPath]);
    }
  } catch (e) {
    console.error(e);
  }
}

export async function main(denops: Denops): Promise<void> {
  // debug.
  debug = await vars.g.get(denops, "history_debug", debug);
  // deno-lint-ignore no-explicit-any
  const clog = (...data: any[]): void => {
    if (debug) {
      console.log(...data);
    }
  };

  // Merge user config.
  enable = await vars.g.get(denops, "history_enable", enable);
  addEcho = await vars.g.get(denops, "history_echo", addEcho);
  addNotify = await vars.g.get(denops, "history_notify", addNotify);
  ignoreFileTypes = await vars.g.get(
    denops,
    "history_ignore_filetypes",
    ignoreFileTypes,
  );
  readPath = await vars.g.get(denops, "history_read_path", readPath);
  writePath = await vars.g.get(denops, "history_write_path", writePath);

  clog({
    debug,
    enable,
    addEcho,
    addNotify,
    ignoreFileTypes,
    readPath,
    writePath,
  });

  denops.dispatcher = {
    async history(historyPath: unknown): Promise<void> {
      try {
        await lock.lock(async () => {
          assert(historyPath, is.String);
          if (!enable) {
            clog(`history skip ! enable: [${enable}]`);
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
          clog(`addHistoryData: (${historyPath}, ${bufPath})`);
          await addHistoryData(historyPath, bufPath);

          if (addEcho) {
            console.log(`add [${bufPath}] to history.`);
            await helper.echo(denops, `add [${bufPath}] to history.`);
          }

          if (addNotify && denops.meta.host === "nvim") {
            await helper.execute(
              denops,
              `lua vim.notify([[add ${bufPath} to history.]], vim.log.levels.INFO)`,
            );
          }
        });
      } catch (e) {
        clog(e);
      }
    },

    async open(path: unknown): Promise<void> {
      try {
        assert(path, is.String);
        const lines = await getHistoryData(path);
        await batch(denops, async (denops) => {
          await fn.setqflist(denops, [], "r");
          await fn.setqflist(denops, [], "a", {
            title: `[history] ${path}`,
            efm: "%f",
            lines: lines,
          });
        });
        await denops.cmd("botright copen");
      } catch (e) {
        await denops.cmd(`echom "Error ${e}"`);
        clog(e);
      }
    },

    // deno-lint-ignore require-await
    async change(e: unknown): Promise<void> {
      assert(e, is.Boolean);
      console.log(`History change: ${e}`);
      enable = e;
    },

    async reset(historyPath: unknown): Promise<void> {
      assert(historyPath, is.String);

      const msg = `Remove: ${historyPath}`;

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

      await Deno.remove(historyPath);
    },
  };

  await helper.execute(
    denops,
    `
      function! s:${denops.name}_notify(method, params) abort
        call denops#plugin#wait_async('${denops.name}', function('denops#notify', ['${denops.name}', a:method, a:params]))
      endfunction
      command! EnableHistory call s:${denops.name}_notify('change', [v:true])
      command! DisableHistory call s:${denops.name}_notify('change', [v:false])
      command! OpenHistoryWrite call s:${denops.name}_notify('open', ['${writePath}'])
      command! OpenHistoryRead call s:${denops.name}_notify('open', ['${readPath}'])
      command! ResetHistoryWrite call s:${denops.name}_notify('reset', ['${writePath}'])
      command! ResetHistoryRead call s:${denops.name}_notify('reset', ['${readPath}'])
  `,
  );

  await autocmd.group(denops, denops.name, (helper) => {
    helper.remove();
    helper.define(
      "BufWritePost",
      "*",
      `call s:${denops.name}_notify('history', ['${writePath}'])`,
    );
    helper.define(
      "BufRead",
      "*",
      `call s:${denops.name}_notify('history', ['${readPath}'])`,
    );
  });

  clog("dps-history has loaded");
}
