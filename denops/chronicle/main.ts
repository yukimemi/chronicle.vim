// =============================================================================
// File        : main.ts
// Author      : yukimemi
// Last Change : 2023/07/17 18:39:00.
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
const chronoDir = path.join(home, ".cache", "dps-chronicle");
let readPath = path.join(chronoDir, "read");
let writePath = path.join(chronoDir, "write");

const lock = new Semaphore(1);

async function getChronoData(chronoPath: string) {
  return (await Deno.readTextFile(chronoPath)).split(/\r?\n/);
}

async function setChronoData(chronoPath: string, lines: string[]) {
  await fs.ensureDir(path.dirname(chronoPath));
  await Deno.writeTextFile(chronoPath, lines.join("\n"));
}

async function addChronoData(chronoPath: string, addPath: string): Promise<boolean> {
  try {
    if (!(await fs.exists(addPath))) {
      return false;
    }
    if (await fs.exists(chronoPath)) {
      const lines = await getChronoData(chronoPath);
      if (!lines.includes(addPath)) {
        lines.push(addPath);
        await setChronoData(chronoPath, lines);
        return true;
      }
    } else {
      await setChronoData(chronoPath, [addPath]);
      return true;
    }
    return false;
  } catch (e) {
    console.error(e);
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
        const lines = (await getChronoData(chronoPath)).reverse();
        await batch(denops, async (denops) => {
          await fn.setqflist(denops, [], "r");
          await fn.setqflist(denops, [], "a", {
            title: `[chronicle] ${chronoPath}`,
            efm: "%f",
            lines: lines,
          });
        });
        await denops.cmd("botright copen");
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
  };

  await helper.execute(
    denops,
    `
      function! s:${denops.name}_notify(method, params) abort
        call denops#plugin#wait_async('${denops.name}', function('denops#notify', ['${denops.name}', a:method, a:params]))
      endfunction
      command! EnableChronicle call s:${denops.name}_notify('change', [v:true])
      command! DisableChronicle call s:${denops.name}_notify('change', [v:false])
      command! OpenChronicleWrite call s:${denops.name}_notify('open', ['${writePath}'])
      command! OpenChronicleRead call s:${denops.name}_notify('open', ['${readPath}'])
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

  clog("dps-chronicle has loaded");
}
