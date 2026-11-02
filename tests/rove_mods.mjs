// Run with node --experimental-vm-modules tests/rove_mods.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

let live = [], shown = [], workspaces = [], calls = [];
const api = {
  View: class {}, div() {}, svg() {}, v_flex() {}, h_flex() {}, InputState: {}, Input: {}, Scrollbar: {},
  agents: () => [], spaces: () => workspaces, terminals: () => live, panes: () => shown,
  run: (...args) => calls.push(args), hc: async () => ({ code: 0, stdout: JSON.stringify({ terminals: live }) }),
  theme: () => ({}), props: () => ({}), closeOverlay() {}, openOverlay() {}, shared() {}, setShared() {}, home() {},
  exec: async () => { throw new Error("must not run git while work is live"); },
};
async function load(name) {
  const module = new vm.SourceTextModule(await readFile(new URL(`../defaults/mods/${name}/main.js`, import.meta.url), "utf8"));
  await module.link(() => new vm.SyntheticModule(Object.keys(api), function () {
    for (const [name, value] of Object.entries(api)) this.setExport(name, value);
  }));
  await module.evaluate();
  return new module.namespace.default();
}

const picker = await load("picker");
picker.filter = ""; picker.machines = []; picker.showEarlier = false;
live = [
  { address: "box/t1", name: "build", state: "live", labels: { "rove.detached": "1" } },
  { address: "t2", state: "finished", labels: { "rove.detached": "1" } },
  { address: "t3", state: "live", labels: {} },
  { address: "t4", state: "live", labels: { "rove.detached": "1" } },
];
shown = [{ terminal: "t4" }];
let detached = picker.rows().filter(r => r.kind === "detached");
assert.equal(detached.length, 1, "only detached live work without a pane appears even with no spaces");
assert.equal(detached[0].terminal.address, "box/t1");
picker.go(detached[0]);
assert.deepEqual(calls, [["terminal.keep", { terminal: "box/t1" }]]);
picker.filter = "missing";
assert.equal(picker.rows().filter(r => r.kind === "detached").length, 0);

const worktree = await load("worktree");
worktree.repo = { top: "/work/project" }; worktree.on = "box";
live = [{ address: "box/t1", state: "live", cwd: "/work/project/child", labels: { "rove.detached": "1" } }];
assert.match(await worktree.remove(), /Stop the terminals/);
live = [{ address: "box/t1", state: "live", cwd: "/elsewhere", foreground: { cwd: "/work/project" } }];
assert.match(await worktree.remove(), /Stop the terminals/);
console.log("Rove mod regressions passed: detached discovery/reattach/filter and worktree ownership");
